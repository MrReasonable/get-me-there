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
    expect(link.getAttribute('href')).toContain('view=searches');
  });

  it('never run: "Not searched yet" with the estimate sentence and Search now (no Run now); no board; every date pair not searched', async () => {
    renderDates({ body: { executions: [], executionId: null } });
    expect(await screen.findByText('Not searched yet', { selector: 'p.font-bold' })).toBeInTheDocument();
    // the estimate sentence beside the press (spec rev 55 §11 never-run state)
    const sentence = await screen.findByRole('status', { name: COPY.newSearch.estimateRegion });
    await waitFor(() => expect(sentence).toHaveTextContent(/^About /));
    expect(screen.getByRole('button', { name: /^Search now/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
    expect(screen.queryByRole('table', { name: /^Best dates/ })).toBeNull();
    expect(screen.queryByTestId('dates-run')).toBeNull();
    const cells = document.querySelectorAll('[data-cell]');
    expect(cells.length).toBeGreaterThan(0);
    expect([...cells].every((c) => c.getAttribute('data-marks') === 'not-searched')).toBe(true);
  });

  it('on-demand searches but no parent run: "Not searched yet" with their count and their figures', async () => {
    renderDates({
      body: {
        executionId: null,
        executions: [runSummary({ id: 'child-1', isChild: true })],
        pairs: { [at('2027-03-14', 10)]: pricedPair(priced(41_200, { basis: 'verified' }), { onDemand: 1 }) },
      },
    });
    expect(
      await screen.findByText(/^Not searched yet: fares were checked for 1 date pair on their own so far/),
    ).toBeInTheDocument();
    expect(await findBoard()).toHaveTextContent('£412');
  });

  it('run in progress: the board captioned "partial: still searching", the searching line, unreached date pairs not searched', async () => {
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
    await waitFor(() => expect(table.querySelector('caption')).toHaveTextContent('partial: still searching'));
    await waitFor(() =>
      expect(screen.getByTestId('state-line')).toHaveTextContent(/^Searching · 1 of 93 date pairs/),
    );
    // a run going has no header line yet: its state line says how far it has got
    expect(screen.queryByTestId('dates-run')).toBeNull();
    expect(table).toHaveTextContent('3 of 4 airport pairs not searched');
  });

  it('stopped: the stop’s sentence and fix and Resume (the fix names it), the board shows the prices found before the stop, and the header line', async () => {
    serveRun({
      status: 'paused_budget',
      stop: {
        sentence: "Stopped at 1 Nov 00:00: SearchApi's monthly limit was reached.",
        fix: { text: 'Raise the limit in Edit, then Resume', command: null, resume: true },
      },
    });
    const { user } = renderDates({
      body: {
        executions: [runSummary({ status: 'paused_budget', finishedAt: null })],
        pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000)) },
      },
    });
    expect(
      await screen.findByText("Stopped at 1 Nov 00:00: SearchApi's monthly limit was reached.", {
        selector: '[data-testid="stop-sentence"]',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Raise the limit in Edit, then Resume')).toBeInTheDocument();
    expect(screen.queryByText(/^Paused:/)).toBeNull();
    expect(screen.getByText('The board shows the prices found before the stop.')).toBeInTheDocument();
    // the header line counts what the run got to (a stopped run has no end yet: it names its start)
    expect(screen.getByTestId('dates-run')).toHaveTextContent(
      /^Searched today from 13:00 · 1 of 93 date pairs priced, 92 not searched · the Aviasales cache$/,
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
    const stale = calendarFig({ price: { ...calendarFig().price, stale: 'refresh' } });
    renderDates({
      body: {
        pairs: { [at('2027-03-14', 10)]: pricedPair(stale), [at('2027-03-15', 10)]: pricedPair(stale) },
      },
    });
    await findBoard();
    expect(screen.getByText("Every price shown is older than this search's refresh.")).toBeInTheDocument();
    expect(within(await findBoard()).getAllByText("older than this search's refresh")).toHaveLength(2);
  });

  it('not every figure stale: no header label, the stale figure still labelled', async () => {
    const stale = calendarFig({ price: { ...calendarFig().price, stale: 'refresh' } });
    renderDates({
      body: {
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(stale),
          [at('2027-03-15', 10)]: pricedPair(calendarFig()),
        },
      },
    });
    const table = await findBoard();
    expect(screen.queryByText(/^Every price shown is/)).toBeNull();
    expect(within(table).getAllByText("older than this search's refresh")).toHaveLength(1);
  });

  it('no prices but coverage: "No prices in this run" with the header line and the six buckets under it, never "no flights"', async () => {
    renderDates({ body: { rest: { empty: 1, no_data: 1, error: 1, skipped: 1 } } });
    expect(await screen.findByText('No prices in this run.')).toBeInTheDocument();
    const line = await screen.findByTestId('dates-run');
    expect(line).toHaveTextContent(/· 0 of 93 date pairs priced, 93 couldn't be read · /);
    expect(screen.getByTestId('dates-run-buckets')).toHaveTextContent(
      'by airport pair: 93 no fares, 93 no cached data, 93 error, 93 skipped',
    );
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
      edit: 'def-0001',
    });
  });

  it('too many to read: the 422’s count of date pairs on airport pairs, the bound, and the airport filter as the way under it', async () => {
    server.use(
      datesError(422, 'too_many_cells', 'the scope has 100000 cells, above 50000', {
        cells: 100_000,
        bound: 50_000,
      }),
    );
    renderDates();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'This search asks about 100000 date pairs on its airport pairs in scope, more than the 50000 this page reads at once.',
    );
    expect(alert).toHaveTextContent('Narrow the origins or destinations in the filters above');
    expect(screen.getByRole('form', { name: 'Filters' })).toBeInTheDocument();
  });

  it('no price within the filters: the board’s line, the counts over the filtered scope with the six buckets under them, and Clear filters', async () => {
    const { user } = renderDates({
      body: { destinations: ['JFK'], rest: { error: 1, not_run: 1 } },
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-10',
    });
    expect(
      await screen.findByText('No date pair in these filters has a price found so far.'),
    ).toBeInTheDocument();
    const box = screen.getByText('No date pair in these filters has a price found so far.').closest('div');
    // a date pair with one airport pair in error and one not searched is not searched (§6.6); the error stays in view
    expect(box).toHaveTextContent('0 of 31 date pairs priced, 31 not searched');
    expect(box).toHaveTextContent('by airport pair: 31 error, 31 not searched');
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
