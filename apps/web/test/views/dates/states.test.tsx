import {
  apiContract,
  asIsoDateTime,
  BANNED_WORD_ALLOWLIST,
  findBannedWords,
  NO_STOP_CAUSE_TEXT,
} from '@gmt/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../../src/api/queries.js';
import { REFUSED_COPY } from '../../../src/copy/refused.js';
import { COPY } from '../../../src/copy.js';
import { at, bucketsOf, priced, pricedPair, runSummary, workedDates } from '../../fixtures.dates.js';
import { API, definition, execution } from '../../fixtures.js';
import { latestRun, searchCard } from '../../fixtures.searches.js';
import { renderedCopy } from '../../guards.js';
import { datesError, heldDates } from '../../msw/datesHandlers.js';
import { type CardRequests, serveCards, serveCardsBy } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { findLower, findTrips, renderDates } from './render.js';

// Spec §11 Dates "States" (design 2026-11-08 Ruling 11): one component test per state, each said in words, never colour
// alone; a run going or stopped is `RunProgress`'s, with Cancel, the stop's sentence and fix, and Resume.

const P = COPY.searchPage;
const RP = COPY.runProgress;
const serveRun = (over: Parameters<typeof execution>[0]) =>
  server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(over))));
const stopped = (status: 'paused_budget' | 'paused_error' | 'interrupted' | 'cancelled') => ({
  ...workedDates(),
  executions: [runSummary({ status, finishedAt: null })],
});
const stateLine = () => screen.findByTestId('state-line');
const actions = () => screen.getByRole('group', { name: P.actionsLabel });

describe('the page’s states (spec §11)', () => {
  it('no search: "No search yet" with a link to Searches', async () => {
    renderDates({ def: null });
    expect(screen.getByText(/^No search yet\./)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Plan one under Trips' });
    expect(link.getAttribute('href')).toContain('view=searches');
  });

  it('never run: "Not searched yet" with the estimate sentence and Search now; no sections; every date not searched', async () => {
    renderDates({ body: { executions: [], executionId: null } });
    expect(await screen.findByText('Not searched yet', { selector: 'p.font-bold' })).toBeInTheDocument();
    const sentence = await screen.findByRole('status', { name: COPY.newSearch.estimateRegion });
    await waitFor(() => expect(sentence).toHaveTextContent(/^About /));
    expect(screen.getByRole('button', { name: /^Search now/ })).toBeEnabled();
    expect(screen.queryByRole('region', { name: P.cheapestHeading })).toBeNull();
    expect(screen.queryByTestId('dates-run')).toBeNull();
    // Ruling 18: every day of the window reads not searched
    const days = document.querySelectorAll('button[data-day]');
    expect(days.length).toBeGreaterThan(0);
    expect([...days].every((c) => c.getAttribute('data-mark') === 'not-searched')).toBe(true);
  });

  it('checks run on their own but no parent run: "Not searched yet" with their count, and their prices', async () => {
    renderDates({
      body: {
        executionId: null,
        executions: [runSummary({ id: 'child-1', isChild: true })],
        pairs: { [at('2027-03-14', 10)]: pricedPair(priced(41_200, { basis: 'verified' }), { onDemand: 1 }) },
      },
    });
    expect(
      await screen.findByText(
        /^Not searched yet: 1 date was checked on its own so far, and the prices found are below\.$/,
      ),
    ).toBeInTheDocument();
    expect(await findTrips()).toHaveTextContent('£412');
  });

  it('too many to read: the 422’s count, the bound, and From or To as the way under it; the filter row stays', async () => {
    server.use(
      datesError(422, 'too_many_cells', 'the scope has 100000 cells, above 50000', {
        cells: 100_000,
        bound: 50_000,
      }),
    );
    renderDates();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'This search covers 100,000 combinations of dates and airports, more than the 50,000 this page reads at once. Pick one airport in From or To above to bring it under 50,000.',
    );
    expect(screen.getByRole('group', { name: P.filterLabel })).toBeInTheDocument();
  });

  it('loading: a labelled loading state in the sections’ place', async () => {
    const held = heldDates();
    server.use(held.handler);
    renderDates();
    await held.arrived();
    expect(screen.getByText(COPY.datesView.loadingFiltered)).toHaveAttribute('role', 'status');
    held.release(workedDates());
    expect(await findTrips()).toBeInTheDocument();
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

  // why: CodeRabbit CR5: a re-read that fails after a read with no runs keeps its error visible with Retry, never
  // the never-run page alone (an error never looks empty)
  it('a failed re-read of a never-run search shows the error with Retry', async () => {
    const { client } = renderDates({ body: { executions: [], executionId: null } });
    expect(await screen.findByText('Not searched yet', { selector: 'p.font-bold' })).toBeInTheDocument();
    server.use(
      http.get(`${API}/definitions/:id/date-pairs`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'internal error' } }, { status: 500 }),
      ),
    );
    await act(() => client.refetchQueries({ queryKey: ['date-pairs'] }));
    expect(await screen.findByText('Could not load: internal error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('no state says a banned word, nor "no flights" outside "that isn\'t the same as no flights" and the key', async () => {
    const r = renderDates({ body: workedDates() });
    await findTrips();
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST)).toEqual([]);
    r.unmount();
    renderDates({ body: { rest: { empty: 4 } } });
    await findTrips();
    // why: Ruling 18: the calendar's key says "no price (not 'no flights')"
    expect(
      renderedCopy()
        .replace(/isn't the same as no flights/g, '')
        .replaceAll(COPY.calendar.key.noPrice, ''),
    ).not.toMatch(/no flights/i);
  });
});

describe('a stopped run (spec rev 55 §8.1 "Stop causes", Ruling 11)', () => {
  it('the sentence as-is and its fix as a line, with Resume when the fix names Resume; the prices before the stop stay', async () => {
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
    await user.click(within(line).getByRole('button', { name: RP.resume }));
    await waitFor(() => expect(resumed).toBe('exec-0001'));
    expect(await findTrips()).toBeInTheDocument();
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
    expect(within(line).queryByRole('button', { name: RP.resume })).toBeNull();
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
    const code = await within(await stateLine()).findByText('pnpm gmt start');
    expect(code.tagName).toBe('CODE');
  });

  it('a run with no stored cause (written before migration 0011) reads NO_STOP_CAUSE_TEXT, never "paused: error"', async () => {
    serveRun({ status: 'paused_error', stop: null });
    renderDates({ body: stopped('paused_error') });
    expect(await within(await stateLine()).findByText(NO_STOP_CAUSE_TEXT.sentence)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/paused: error|Paused: /);
  });
});

describe('a refused Search now and a search naming no source (Review Focus 1 of WP20)', () => {
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
      def: definition({ providers: { discovery: [], verification: [], discoveryRefreshHours: {} } }),
    });
    const line = await stateLine();
    await waitFor(() => expect(line).toHaveTextContent(P.noSource));
    const link = within(line).getByRole('link', { name: P.noSourceFix });
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('view')).toBe('providers');
    expect(within(line).queryByRole('button', { name: /^Search now/ })).toBeNull();
  });
});

describe('a run going (Ruling 11; Review Focus 2)', () => {
  afterEach(() => vi.useRealTimers());
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

  it('the progress counts the whole search, never the filtered stays; prices so far show in their sections', async () => {
    running({}, '?view=dates&def=def-0001&d.nights=10-10');
    const line = await stateLine();
    // one date priced, the other 92 not searched (no rest given)
    await waitFor(() =>
      expect(line).toHaveTextContent('Reading the calendar, 1 of 93 dates · about 100 min left'),
    );
    expect(line).not.toHaveTextContent(/nights|airport/);
    expect(await findLower()).toHaveTextContent('£300');
    // the calendar marks the rest not searched (Ruling 18: each of the other 30 days)
    expect(document.querySelectorAll('button[data-day][data-mark="not-searched"]')).toHaveLength(30);
  });

  // why: concern 3 of the CodeRabbit round (coordinator ruling), as CR6 for the run line: an airport filter narrows
  // the read, so without the card's counts for this run the progress names no count rather than the narrowed one
  it('with an airport filter and no card of this run, the progress counts nothing rather than the narrowed read', async () => {
    server.use(serveCards([searchCard({ id: 'def-0001', latestRun: latestRun({ id: 'exec-0000' }) })]));
    running({}, '?view=dates&def=def-0001&d.from=LHR');
    const state = await stateLine();
    await waitFor(() =>
      expect(within(state).getByTestId('run-line').textContent).toBe(
        'Reading the calendar · about 100 min left',
      ),
    );
    expect(within(state).getByRole('progressbar')).not.toHaveAttribute('value');
  });

  it('with the card’s latest run this very run, the progress says the card’s counts (the same as the first screen)', async () => {
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
    await waitFor(async () =>
      expect(await stateLine()).toHaveTextContent('Reading the calendar, 120 of 405 dates'),
    );
  });

  it('the polite status names the kind of state only, so a poll that moves a count announces nothing', async () => {
    // why: CodeRabbit CR31: a later poll moves the visible count; the status stays exactly "Searching"
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });
    let searched = 120;
    server.use(
      serveCardsBy(() => [
        searchCard({
          id: 'def-0001',
          latestRun: latestRun({
            status: 'running',
            finishedAt: null,
            datePairs: 405,
            datePairsSearched: searched,
          }),
        }),
      ]),
    );
    running();
    const status = await screen.findByRole('status', { name: P.stateLabel });
    const line = await stateLine();
    await waitFor(() => expect(line).toHaveTextContent('Reading the calendar, 120 of 405 dates'));
    expect(status).toHaveTextContent(/^Searching$/);
    searched = 240;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(line).toHaveTextContent('Reading the calendar, 240 of 405 dates'));
    expect(status).toHaveTextContent(/^Searching$/);
  });
});

describe('a finished run (spec rev 55 §11)', () => {
  it('reads the run line once; the status says "Searched"; no state below it', async () => {
    renderDates({ body: workedDates() });
    const status = await screen.findByRole('status', { name: P.stateLabel });
    await waitFor(() => expect(status).toHaveTextContent(/^Searched$/));
    expect(screen.getByTestId('dates-run')).toHaveTextContent(/^Searched today 13:00–14:00 · /);
    expect(screen.getAllByText(/^Searched today/)).toHaveLength(1);
    expect(await stateLine()).toBeEmptyDOMElement();
  });
});

describe('the page’s card read (ruling R-scope)', () => {
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
    await waitFor(() =>
      expect(screen.getByTestId('state-line')).toHaveTextContent(/^Reading the calendar, /),
    );
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
