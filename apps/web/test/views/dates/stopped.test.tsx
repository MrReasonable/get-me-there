import { apiContract, asIsoDateTime, NO_STOP_CAUSE_TEXT } from '@gmt/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../../src/api/queries.js';
import { REFUSED_COPY } from '../../../src/copy/refused.js';
import { COPY } from '../../../src/copy.js';
import { at, bucketsOf, priced, pricedPair, runSummary, workedDates } from '../../fixtures.dates.js';
import { API, definition, execution } from '../../fixtures.js';
import { latestRun, searchCard } from '../../fixtures.searches.js';
import { type CardRequests, serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { findBoard, renderDates } from './render.js';

// Spec rev 55 §11 "A search's page", its state line (WP20 Task 20.6): a stopped run's sentence as-is with its fix as a
// button or line, a run with no stored cause (Review Focus 4), a refused Search now (Review Focus 1), a search naming no
// source, Cancel beside the searching and reading lines, the partial board, and the changed line.

const serveRun = (over: Parameters<typeof execution>[0]) =>
  server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(over))));
const stopped = (status: 'paused_budget' | 'paused_error' | 'interrupted' | 'cancelled') => ({
  ...workedDates(),
  executions: [runSummary({ status, finishedAt: null })],
});
const stateLine = () => screen.findByTestId('state-line');
const actions = () => screen.getByRole('group', { name: COPY.searchPage.actionsLabel });

describe('a stopped run (spec rev 55 §8.1 "Stop causes", §11)', () => {
  it('the sentence as-is and its fix as a line, with Resume when the fix names Resume', async () => {
    serveRun({
      status: 'paused_budget',
      stop: {
        sentence: "Stopped at 1 Nov 00:00: SearchApi's monthly limit was reached.",
        fix: { text: 'Raise the limit in Edit, then Resume', command: null, resume: true },
      },
    });
    const { user } = renderDates({ body: stopped('paused_budget') });
    const line = await stateLine();
    expect(
      await within(line).findByText("Stopped at 1 Nov 00:00: SearchApi's monthly limit was reached."),
    ).toHaveAttribute('data-testid', 'stop-sentence');
    expect(within(line).getByTestId('stop-fix')).toHaveTextContent('Raise the limit in Edit, then Resume');
    expect(line).not.toHaveTextContent(/^(Paused|Stopped):/);
    let resumed = '';
    server.use(
      http.post(`${API}/executions/:id/resume`, ({ params }) => {
        resumed = String(params.id);
        return HttpResponse.json(execution({ status: 'running' }));
      }),
    );
    await user.click(within(line).getByRole('button', { name: COPY.searchPage.resume }));
    await waitFor(() => expect(resumed).toBe('exec-0001'));
    // the board shows the prices found before the stop
    expect(await findBoard()).toBeInTheDocument();
  });

  it('a fix that offers a fresh search: no Resume, and Search again among the actions', async () => {
    serveRun({
      status: 'paused_budget',
      stop: {
        sentence: "Stopped at the browser worker's limit of 100 pages for this run.",
        fix: { text: 'Search again to carry on (prices already found are reused)', command: null },
      },
    });
    renderDates({ body: stopped('paused_budget') });
    const line = await stateLine();
    await within(line).findByTestId('stop-sentence');
    expect(within(line).queryByRole('button', { name: COPY.searchPage.resume })).toBeNull();
    expect(within(actions()).getByRole('button', { name: COPY.searchAgain.label })).toBeInTheDocument();
    expect(line).toHaveTextContent(COPY.searchPage.stoppedBoard);
  });

  it('a fix that names both: Resume beside the sentence and Search again among the actions', async () => {
    serveRun({
      status: 'interrupted',
      stop: {
        sentence: 'The app stopped during this search.',
        fix: { text: 'Resume, or Search again', command: null, resume: true },
      },
    });
    renderDates({ body: stopped('interrupted') });
    const line = await stateLine();
    expect(await within(line).findByRole('button', { name: COPY.searchPage.resume })).toBeInTheDocument();
    expect(within(actions()).getByRole('button', { name: COPY.searchAgain.label })).toBeInTheDocument();
  });

  it('in native mode a fix’s command is a code element', async () => {
    serveRun({
      status: 'paused_error',
      stop: {
        sentence: 'The browser worker could not be reached.',
        fix: { text: 'Start the browser worker, then Search again', command: 'pnpm gmt start' },
      },
    });
    renderDates({ body: stopped('paused_error') });
    const line = await stateLine();
    const code = await within(line).findByText('pnpm gmt start');
    expect(code.tagName).toBe('CODE');
  });

  it('nothing searched: "0 of 93 searched" beside the sentence, never "0 error"', async () => {
    serveRun({
      status: 'paused_error',
      stop: { sentence: 'The source asked the app to slow down.', fix: null },
    });
    renderDates({
      body: {
        executions: [runSummary({ status: 'paused_error', finishedAt: null })],
        rest: { not_run: 4 },
      },
    });
    const line = await stateLine();
    expect(await within(line).findByText('0 of 93 searched')).toBeInTheDocument();
    expect(line).toHaveTextContent('by airport pair: 372 not searched');
    expect(document.body.textContent).not.toMatch(/\b0 error\b/);
  });

  it('a run with no stored cause (written before migration 0011) reads NO_STOP_CAUSE_TEXT, never "paused: error" nor a stored text', async () => {
    serveRun({ status: 'paused_error', stop: null });
    renderDates({ body: stopped('paused_error') });
    const line = await stateLine();
    expect(await within(line).findByText(NO_STOP_CAUSE_TEXT.sentence)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/paused: error|Paused: /);
  });
});

describe('a refused Search now and a search naming no source (Review Focus 1)', () => {
  it('each refusal code in Task 20.5’s words', async () => {
    for (const code of apiContract.startRefusalCodes) {
      const r = renderDates({
        body: { executions: [], executionId: null },
        search: `?view=dates&def=def-0001&refused=${code}`,
      });
      expect(
        await screen.findByText(code === 'cap' ? REFUSED_COPY.cap : REFUSED_COPY[code]),
        code,
      ).toBeInTheDocument();
      r.unmount();
    }
  });

  it('a never-run search naming no source says so from its own data, with the way to set one up', async () => {
    renderDates({
      body: { executions: [], executionId: null, discoveryProviders: [] },
      def: definition({
        providers: { discovery: [], verification: [], discoveryRefreshHours: {} },
      }),
    });
    const line = await stateLine();
    await waitFor(() => expect(line).toHaveTextContent('No price source is set up, so nothing was searched'));
    const link = within(line).getByRole('link', { name: 'Set up a price source (Providers)' });
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('view')).toBe('providers');
    expect(within(line).queryByRole('button', { name: /^Search now/ })).toBeNull();
  });
});

describe('a run going: its line with Cancel, and the board filling (persona-001)', () => {
  const running = (over: Parameters<typeof execution>[0] = {}, search?: string) => {
    serveRun({ status: 'running', estimatedFinishAt: '2026-10-14T16:40:00.000Z', ...over });
    return renderDates({
      ...(search === undefined ? {} : { search }),
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
  };

  it('searching: the line with its count and time left, Cancel beside it; prices so far, captioned partial', async () => {
    let cancelled = '';
    server.use(
      http.post(`${API}/executions/:id/cancel`, ({ params }) => {
        cancelled = String(params.id);
        return HttpResponse.json(execution({ status: 'cancelled' }));
      }),
    );
    const { user } = running();
    const line = await stateLine();
    // one date pair priced, the other 92 not searched (no rest given)
    await waitFor(() => expect(line).toHaveTextContent('Searching · 1 of 93 date pairs · about 1h 40m left'));
    // the six buckets under the count (spec rev 55 §3)
    expect(line).toHaveTextContent('by airport pair: 1 priced, 371 not searched');
    const table = await findBoard();
    expect(table.querySelector('caption')).toHaveTextContent(COPY.datesView.partial);
    expect(COPY.datesView.partial).toBe('partial: still searching');
    expect(table).toHaveTextContent('3 of 4 airport pairs not searched');
    // the overview marks the rest not searched
    expect(document.querySelectorAll('[data-marks~="not-searched"]').length).toBeGreaterThan(80);
    await user.click(within(line).getByRole('button', { name: COPY.searchPage.cancel }));
    await waitFor(() => expect(cancelled).toBe('exec-0001'));
  });

  it('the line counts the whole search, never the filtered stays, and carries no scope (ruling R-scope)', async () => {
    running({}, '?view=dates&def=def-0001&d.nights=10-10');
    const line = await stateLine();
    await waitFor(() => expect(line).toHaveTextContent('Searching · 1 of 93 date pairs'));
    expect(line).not.toHaveTextContent(/nights|airport pairs ·/);
  });

  it('with the card’s latest run this very run, the line says the card’s counts (the same as the first screen)', async () => {
    server.use(
      serveCards([
        searchCard({
          id: 'def-0001',
          latestRun: latestRun({
            status: 'running',
            finishedAt: null,
            datePairs: 405,
            datePairsSearched: 120,
          }),
        }),
      ]),
    );
    running({}, '?view=dates&def=def-0001&d.to=JFK');
    const line = await stateLine();
    await waitFor(() => expect(line).toHaveTextContent('Searching · 120 of 405 date pairs'));
  });

  it('reading flights: the line with Cancel beside it', async () => {
    running({
      flights: { planned: 10, read: 3, reused: 0, failed: 0, ended: null },
      estimatedFinishAt: '2026-10-14T15:08:00.000Z',
    });
    const line = await stateLine();
    await waitFor(() =>
      expect(line).toHaveTextContent('Reading flights · 3 of 10 date pairs · about 8m left'),
    );
    expect(within(line).getByRole('button', { name: COPY.searchPage.cancel })).toBeInTheDocument();
  });

  it('the polite status names the kind of state only, so a poll that moves a count announces nothing', async () => {
    running();
    const status = await screen.findByRole('status', { name: COPY.searchPage.stateLabel });
    await waitFor(() => expect(status).toHaveTextContent(/^Searching$/));
  });
});

describe('dates changed since the latest run (spec rev 55 §11; ruling 20.3 R-changed)', () => {
  it('the api’s own judgement on its card, in count-free words, beside Search again', async () => {
    server.use(serveCards([searchCard({ id: 'def-0001', spaceChangedSince: true })]));
    renderDates({ body: workedDates() });
    const line = await stateLine();
    await waitFor(() => expect(line).toHaveTextContent('Dates changed since this was last searched'));
    expect(within(actions()).getByRole('button', { name: COPY.searchAgain.label })).toBeInTheDocument();
  });

  it('an unchanged space reads the header line once, and the status says "Searched"', async () => {
    renderDates({ body: workedDates() });
    const status = await screen.findByRole('status', { name: COPY.searchPage.stateLabel });
    await waitFor(() => expect(status).toHaveTextContent(/^Searched$/));
    expect(screen.getByTestId('dates-run')).toHaveTextContent(/^Searched today 13:00–14:00 · /);
    expect(screen.getAllByText(/^Searched today/)).toHaveLength(1);
    expect(await stateLine()).toBeEmptyDOMElement();
  });
});

describe('the page’s card read (WP20 Task 20.6; ruling R-scope)', () => {
  afterEach(() => vi.useRealTimers());
  // why: only the interval is faked and the clock never moves by itself, so each step is exact
  const fakeClock = () =>
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });
  it('re-reads the cards while its run is going, for the whole search’s counts', async () => {
    fakeClock();
    const cards: CardRequests = [];
    server.use(
      serveCards(
        [searchCard({ id: 'def-0001', latestRun: latestRun({ status: 'running', finishedAt: null }) })],
        cards,
      ),
    );
    serveRun({ status: 'running' });
    renderDates({
      body: { ...workedDates(), executions: [runSummary({ status: 'running', finishedAt: null })] },
    });
    await waitFor(() => expect(screen.getByTestId('state-line')).toHaveTextContent(/^Searching · /));
    const before = cards.length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(cards.length).toBeGreaterThan(before));
  });
  it('reads them once for a run that is not going', async () => {
    fakeClock();
    const cards: CardRequests = [];
    server.use(serveCards([searchCard({ id: 'def-0001' })], cards));
    renderDates({ body: workedDates() });
    await screen.findByTestId('dates-run');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(cards).toHaveLength(1);
  });
});
