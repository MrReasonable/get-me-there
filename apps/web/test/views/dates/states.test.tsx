import { asIsoDateTime, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import {
  at,
  bucketsOf,
  calendarFig,
  priced,
  pricedPair,
  runSummary,
  workedDates,
} from '../../fixtures.dates.js';
import { API, execution } from '../../fixtures.js';
import { renderedCopy } from '../../guards.js';
import { datesError, heldDates } from '../../msw/datesHandlers.js';
import { server } from '../../msw/server.js';
import { findBoard, renderDates } from './render.js';

// Spec §11 Dates "States": one component test per state, each said in words, never colour alone.

const serveRun = (over: Parameters<typeof execution>[0]) =>
  server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(over))));
const noFlights = () => expect(renderedCopy()).not.toMatch(/no flights/i);

describe('the Dates view’s states (spec §11)', () => {
  it('no search: "No search yet" with a link to Searches', async () => {
    renderDates({ def: null });
    expect(screen.getByText(/^No search yet\./)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Plan one under Searches' });
    expect(link.getAttribute('href')).toContain('view=definitions');
  });

  it('never run: "Not run yet: nothing has been searched", the estimate and Run now; no board', async () => {
    renderDates({ body: { executions: [], executionId: null } });
    expect(await screen.findByText('Not run yet: nothing has been searched.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.runNow(154, 2000, '£0') })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /^Best dates/ })).toBeNull();
    expect(screen.getByTestId('dates-run')).toHaveTextContent('no run yet');
  });

  it('on-demand searches but no parent run: "Not run yet" with their count and their figures, never "nothing has been searched"', async () => {
    renderDates({
      body: {
        executionId: null,
        executions: [runSummary({ id: 'child-1', isChild: true })],
        pairs: { [at('2027-03-14', 10)]: pricedPair(priced(41_200, { basis: 'verified' }), { onDemand: 1 }) },
      },
    });
    expect(await screen.findByText(/^Not run yet: 1 on-demand itinerary search so far/)).toBeInTheDocument();
    expect(await findBoard()).toHaveTextContent('£412');
    expect(screen.queryByText(/nothing has been searched/)).toBeNull();
  });

  it('run in progress: the board captioned "partial: run in progress", the run’s start in the header, unreached date pairs not searched', async () => {
    serveRun({ status: 'running', startedAt: '2026-10-14T14:20:00.000Z' });
    renderDates({
      body: {
        executions: [
          runSummary({
            status: 'running',
            startedAt: asIsoDateTime('2026-10-14T14:20:00.000Z'),
            finishedAt: null,
          }),
        ],
        pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000), { buckets: bucketsOf({ priced: 1 }) }) },
      },
    });
    const table = await findBoard();
    await waitFor(() => expect(table.querySelector('caption')).toHaveTextContent('partial: run in progress'));
    expect(screen.getByTestId('dates-run')).toHaveTextContent('run in progress, started 40 min ago');
    expect(table).toHaveTextContent('3 of 4 airport pairs not searched');
  });

  it('paused or budget-stopped: the reason and Resume, "the board shows prices found before the pause", the not searched count', async () => {
    serveRun({ status: 'paused_budget', reason: 'searchapi provider-month cap reached' });
    const { user } = renderDates({
      body: {
        executions: [runSummary({ status: 'paused_budget', finishedAt: null })],
        pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000)) },
      },
    });
    expect(await screen.findByText('Paused: searchapi provider-month cap reached')).toBeInTheDocument();
    expect(screen.getByText('The board shows prices found before the pause.')).toBeInTheDocument();
    expect(screen.getByText('368 cells not searched')).toBeInTheDocument();
    expect(screen.getByTestId('dates-run')).toHaveTextContent(
      'run paused 3h ago: searchapi provider-month cap reached',
    );
    let resumed = '';
    server.use(
      http.post(`${API}/executions/:id/resume`, ({ params }) => {
        resumed = String(params.id);
        return HttpResponse.json(execution({ status: 'running' }));
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(resumed).toBe('exec-0001'));
    expect(await findBoard()).toBeInTheDocument();
  });

  it('stale: the header’s stale label only when every figure is stale, and each stale figure labelled', async () => {
    const stale = calendarFig({ price: { ...calendarFig().price, stale: true } });
    renderDates({
      body: {
        pairs: { [at('2027-03-14', 10)]: pricedPair(stale), [at('2027-03-15', 10)]: pricedPair(stale) },
      },
    });
    await findBoard();
    expect(screen.getByText('Every price shown is older than one refresh cycle.')).toBeInTheDocument();
    expect(within(await findBoard()).getAllByText('stale')).toHaveLength(2);
  });

  it('not every figure stale: no header label, the stale figure still labelled', async () => {
    const stale = calendarFig({ price: { ...calendarFig().price, stale: true } });
    renderDates({
      body: {
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(stale),
          [at('2027-03-15', 10)]: pricedPair(calendarFig()),
        },
      },
    });
    const table = await findBoard();
    expect(screen.queryByText('Every price shown is older than one refresh cycle.')).toBeNull();
    expect(within(table).getAllByText('stale')).toHaveLength(1);
  });

  it('no prices but coverage: "No prices in this run" with the coverage line, never "no flights"', async () => {
    renderDates({ body: { rest: { empty: 1, no_data: 1, error: 1, skipped: 1 } } });
    expect(await screen.findByText('No prices in this run.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /^discovery: 0 priced · 93 no fares · 93 no cached data · 93 error · 93 skipped · 0 not searched of 372/,
      }),
    ).toBeInTheDocument();
    noFlights();
  });

  it('thin coverage: the next-move line, with the coverage-check link and "not evidence that no flights exist"', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    expect(screen.getByText(/which is not evidence that no flights exist/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open the coverage check for this search' });
    expect(
      Object.fromEntries(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams),
    ).toMatchObject({
      view: 'definitions',
      def: 'def-0001',
    });
  });

  it('too many cells: the 422’s cell count, the bound, and the airport filter as the way under it', async () => {
    server.use(
      datesError(422, 'too_many_cells', 'the scope has 100000 cells, above 50000', {
        cells: 100_000,
        bound: 50_000,
      }),
    );
    renderDates();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'This search has 100000 cells in scope, more than the 50000 the Dates view reads at once.',
    );
    expect(alert).toHaveTextContent('Narrow the origins or destinations in the filters above');
    expect(screen.getByRole('form', { name: 'Filters' })).toBeInTheDocument();
  });

  it('no price within the filters: the board’s line, the coverage line over the filtered scope with its not searched and error counts, and Clear filters', async () => {
    const { user } = renderDates({
      body: { destinations: ['JFK'], rest: { error: 1, not_run: 1 } },
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-10',
    });
    expect(
      await screen.findByText('No date pair in these filters has a price found so far.'),
    ).toBeInTheDocument();
    const box = screen.getByText('No date pair in these filters has a price found so far.').closest('div');
    expect(box).toHaveTextContent('31 error · 0 skipped · 31 not searched of 62');
    expect(renderedCopy()).not.toMatch(/no date pair exists|no flights/i);
    await user.click(within(box ?? document.body).getByRole('button', { name: 'Clear filters' }));
    const p = new URLSearchParams(window.location.search);
    expect([p.get('d.to'), p.get('d.nights')]).toEqual([null, null]);
  });

  it('loading: a labelled loading state in the board’s place', async () => {
    const held = heldDates();
    server.use(held.handler);
    renderDates();
    await held.arrived();
    expect(screen.getByText('Loading dates for these filters')).toHaveAttribute('role', 'status');
    held.release(workedDates());
    expect(await findBoard()).toBeInTheDocument();
  });

  it('a load error with Retry', async () => {
    let hits = 0;
    server.use(
      http.get(`${API}/definitions/:id/date-pairs`, () => {
        hits += 1;
        return HttpResponse.json({ error: { code: 'internal', message: 'internal error' } }, { status: 500 });
      }),
    );
    const { user } = renderDates();
    expect(await screen.findByText('Could not load: internal error')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(hits).toBe(2));
  });

  it('no state says a banned word', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});
