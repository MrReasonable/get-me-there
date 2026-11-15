import {
  apiContract,
  asIata,
  asIsoDateTime,
  isoDateTimeOfEpochMs,
  mainPathSource,
  type StopCause,
  stopText,
} from '@gmt/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactElement, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../../src/api/queries.js';
import type { ExecutionResponse } from '../../../src/api/types.js';
import { TopBar } from '../../../src/components/TopBar.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { REFUSED_COPY } from '../../../src/copy/refused.js';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { DatesView } from '../../../src/views/Dates/DatesView.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import {
  at,
  calendarFig,
  figurePairing,
  priced,
  pricedPair,
  provCached,
  provSearched,
  provSynthetic,
  runSummary,
  verifiedFig,
  workedDates,
} from '../../fixtures.dates.js';
import { API, definition, execution, providersResponse } from '../../fixtures.js';
import { latestRun, searchCard } from '../../fixtures.searches.js';
import { datesError, serveDates as serveDatesFor } from '../../msw/datesHandlers.js';
import { serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { jargonIn, mainPathWords } from './jargon.js';
import { findTrips, renderDates } from './render.js';

// Design 2026-11-08 §5 (mockup 02), Rulings 6, 7, 11, 12 and 16: a search's page's header (crumbs, the name as plain
// text, the meta line, Search again, Edit and Repeat, the run line, RunProgress), the jargon sweep over the page in
// every state, and the red synthetic banner (revision 50).

const P = COPY.searchPage;
const realFig = (pence: number) =>
  calendarFig({ price: { ...calendarFig().price, pricePence: pence, provenance: provCached() } });
const real = { discoveryProviders: ['travelpayouts' as const] };
const banner = () => screen.queryByText(/^Synthetic data: the fixture provider is enabled/);
const serveRun = (over: Parameters<typeof execution>[0]) =>
  server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(over))));
/** The card of the worked search: its latest run the date-pairs read's (exec-0001), 2,146 of 2,184 dates priced. */
const wholeCard = (over: Parameters<typeof latestRun>[0] = {}) =>
  searchCard({
    latestRun: latestRun({
      datePairs: 2184,
      datePairsSearched: 2146,
      datePairsNeverSearched: 38,
      startedAt: '2026-10-14T12:00:00.000Z',
      finishedAt: '2026-10-14T13:00:00.000Z',
      ...over,
    }),
  });

describe('a search’s header (design 2026-11-08 §5, mockup 02)', () => {
  it('the crumbs, the name as plain text, the meta line, the actions and the run line', async () => {
    server.use(serveCards([wholeCard()]));
    renderDates({ body: workedDates() });
    await findTrips();
    const crumbs = screen.getByRole('navigation', { name: COPY.crumbsLabel });
    expect(within(crumbs).getByRole('link', { name: 'Trips' })).toBeInTheDocument();
    expect(within(crumbs).getByText('Worked example')).toHaveAttribute('aria-current', 'page');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/^Worked example$/);
    // why: Ruling 21: the split-flap lettering went; the name is one text node
    expect(h1.querySelector('.flaps, [aria-hidden]')).toBeNull();
    // the airports by name (the table knows LHR and LGW here), the rolling window now with "(moves forward each day)",
    // the stay and the search's own limit
    await waitFor(() =>
      expect(screen.getByTestId('dates-meta')).toHaveTextContent(
        'Heathrow, Gatwick → JFK, EWR · leave 14 Mar – 13 Apr (moves forward each day) · 10–21 nights · each way under 25h',
      ),
    );
    // the run line: when, the card's whole-search calendar counts, the dates with flights read, what was searched
    const line = await screen.findByTestId('dates-run');
    expect(line).toHaveTextContent(
      'Searched today 13:00–14:00 · calendar prices for 2,146 of 2,184 dates · 1 date with flights read · what was searched',
    );
    const link = within(line).getByRole('link', { name: P.whatWasSearched });
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('d.coverage')).toBe('open');
    // the actions: Search again (primary), Edit, and the schedule in words with Change
    const actions = screen.getByRole('group', { name: P.actionsLabel });
    const again = within(actions).getByRole('button', { name: COPY.searchAgain.label });
    expect(again).toHaveClass('btn-primary');
    const edit = within(actions).getByRole('link', { name: COPY.searchesView.edit });
    expect(
      Object.fromEntries(new URL(edit.getAttribute('href') ?? '', 'http://x').searchParams),
    ).toMatchObject({ view: 'definitions', edit: 'def-0001' });
    expect(actions).toHaveTextContent('Repeats Mondays 05:00');
    expect(within(actions).getByRole('button', { name: COPY.repeatWeekly.change })).toBeInTheDocument();
  });

  it('the run line counts the whole search even when From narrows the read; a card of another run is not used', async () => {
    server.use(serveCards([wholeCard()]));
    const r = renderDates({
      body: workedDates({ origins: ['LHR'] }),
      search: '?view=dates&def=def-0001&d.from=LHR',
    });
    expect(await screen.findByTestId('dates-run')).toHaveTextContent(
      'calendar prices for 2,146 of 2,184 dates',
    );
    r.unmount();
    // the card still on an older run: the read's own dates are counted (11 of the worked 93 priced)
    server.use(serveCards([wholeCard({ id: 'exec-0000' })]));
    renderDates({ body: workedDates() });
    expect(await screen.findByTestId('dates-run')).toHaveTextContent('calendar prices for 11 of 93 dates');
  });

  it('the dates with flights read count every date in view whose flights were read (Ruling 6)', async () => {
    const over = { pairingRead: 'over-limit' as const, pairing: figurePairing({ which: 'over-limit' }) };
    renderDates({
      body: {
        pairs: {
          // not read, and a read that failed: neither counts
          [at('2027-03-14', 10)]: pricedPair(priced(30_000)),
          [at('2027-03-17', 10)]: pricedPair(
            priced(30_500, { pairingRead: 'list-failed', listReason: 'network' }),
          ),
          // a trip, and a read that found none within the limits: both count
          [at('2027-03-15', 10)]: pricedPair(verifiedFig()),
          [at('2027-03-16', 10)]: pricedPair(priced(31_000, over)),
        },
      },
    });
    expect(await screen.findByTestId('dates-run')).toHaveTextContent(/ · 2 dates with flights read · /);
  });

  it('with the airports’ names not in (failed or still loading), the meta line says the codes', async () => {
    server.use(
      http.get(`${API}/airports`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'airports read failed' } }, { status: 500 }),
      ),
    );
    renderDates({ body: workedDates() });
    await findTrips();
    await waitFor(() =>
      expect(screen.getByTestId('dates-meta')).toHaveTextContent(/^LHR, LGW → JFK, EWR · /),
    );
  });

  it('a fixed window states its dates; no journey limit says none; an unscheduled search offers Repeat weekly…', async () => {
    renderDates({
      body: workedDates(),
      def: definition({
        window: { kind: 'absolute', from: '2027-01-10', to: '2027-03-31' },
        constraints: {},
        enabled: false,
        scheduleCron: null,
      }),
    });
    await findTrips();
    const meta = screen.getByTestId('dates-meta');
    expect(meta).toHaveTextContent(/ · leave 10 Jan – 31 Mar · 10–21 nights$/);
    expect(meta).not.toHaveTextContent('each way');
    const actions = screen.getByRole('group', { name: P.actionsLabel });
    expect(within(actions).getByRole('button', { name: COPY.repeatWeekly.open })).toBeInTheDocument();
  });

  it('never searched: no run line and no Search again among the actions; the state says so beside Search now', async () => {
    renderDates({ body: { executions: [], executionId: null } });
    const state = await screen.findByTestId('state-line');
    await waitFor(() => expect(state).toHaveTextContent('Not searched yet'));
    expect(screen.queryByTestId('dates-run')).toBeNull();
    const actions = screen.getByRole('group', { name: P.actionsLabel });
    expect(within(actions).queryByRole('button', { name: COPY.searchAgain.label })).toBeNull();
    expect(await within(state).findByRole('button', { name: /^Search now/ })).toBeInTheDocument();
  });
});

describe('RunProgress on the page (Ruling 11; Review Focus 2)', () => {
  const running = { ...workedDates(), executions: [runSummary({ status: 'running', finishedAt: null })] };

  it('while running: the bar and "Reading the calendar, …" over the whole search, no run line; Cancel asks, then cancels once', async () => {
    server.use(
      serveCards([
        wholeCard({
          status: 'running',
          finishedAt: null,
          datePairsSearched: 1203,
          marks: {
            priced: 1203,
            'no-price-shown': 0,
            'couldnt-read': 0,
            'not-reached': 0,
            'not-searched': 981,
          },
        }),
      ]),
    );
    serveRun({ status: 'running', estimatedFinishAt: '2026-10-14T15:14:00.000Z' });
    const cancels: string[] = [];
    server.use(
      http.post(`${API}/executions/:id/cancel`, ({ params }) => {
        cancels.push(String(params.id));
        return HttpResponse.json(execution({ status: 'cancelled' }));
      }),
    );
    const { user } = renderDates({ body: running });
    const state = await screen.findByTestId('state-line');
    expect(
      await within(state).findByRole('progressbar', { name: COPY.runProgress.barLabel }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(state).toHaveTextContent('Reading the calendar, 1,203 of 2,184 dates · about 14 min left'),
    );
    expect(screen.queryByTestId('dates-run')).toBeNull();
    await user.click(within(state).getByRole('button', { name: COPY.runProgress.cancel }));
    await user.click(within(state).getByRole('button', { name: COPY.runProgress.confirmCancel }));
    await waitFor(() => expect(cancels).toEqual(['exec-0001']));
  });

  it('reading flights: "Reading flights for the cheapest dates, N read so far"', async () => {
    serveRun({
      status: 'running',
      flights: { planned: 10, read: 3, reused: 1, failed: 0, ended: null, confirm: null, stopCause: null },
    });
    renderDates({ body: running });
    const state = await screen.findByTestId('state-line');
    await waitFor(() =>
      expect(state).toHaveTextContent('Reading flights for the cheapest dates, 4 read so far'),
    );
    expect(screen.getByRole('status', { name: P.stateLabel })).toHaveTextContent(P.stateKind.reading);
  });

  it('stopped: the stop’s sentence and fix, Resume when the fix names it, Search again among the actions, and the run line', async () => {
    const stop = stopText(
      { kind: 'limiter-timeout', providerId: 'searchapi', resumeAfter: null },
      { tz: 'Europe/London', mode: 'native', scheduled: false },
    );
    serveRun({ status: 'paused_budget', stop, startedAt: '2026-10-14T12:00:00.000Z' });
    renderDates({
      body: { ...workedDates(), executions: [runSummary({ status: 'paused_budget', finishedAt: null })] },
    });
    const state = await screen.findByTestId('state-line');
    expect(await within(state).findByTestId('stop-sentence')).toHaveTextContent(stop.sentence);
    if (stop.fix !== null) expect(within(state).getByTestId('stop-fix')).toHaveTextContent(stop.fix.text);
    expect(within(state).getByRole('button', { name: COPY.runProgress.resume })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: P.actionsLabel })).getByRole('button', {
        name: COPY.searchAgain.label,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('dates-run')).toHaveTextContent(/^Searched today from 13:00 · /);
    expect(screen.getByRole('status', { name: P.stateLabel })).toHaveTextContent(P.stateKind.stopped);
  });

  it('dates changed since the latest run: the card’s own judgement, in count-free words', async () => {
    server.use(serveCards([{ ...wholeCard(), spaceChangedSince: true }]));
    renderDates({ body: workedDates() });
    const state = await screen.findByTestId('state-line');
    await waitFor(() => expect(state).toHaveTextContent(COPY.searchesView.datesChanged));
  });
});

/** Stop words for each kind of stop core words (spec rev 55 §8.1), in native mode, for a search that is scheduled. */
const STOPS: ReadonlyArray<[ExecutionResponse['status'], StopCause]> = [
  [
    'paused_error',
    {
      kind: 'sources-unavailable',
      stage: 'discovery',
      searched: 0,
      sources: [{ providerId: 'camoufox', skip: 'provider_unavailable', detail: 'network', until: null }],
    },
  ],
  [
    'paused_budget',
    {
      kind: 'budget',
      scope: 'provider-execution',
      providerId: 'camoufox',
      unit: 'pages',
      cap: 100,
      resumeAfter: null,
      resetsAt: null,
      flights: { read: 10, planned: 10 },
    },
  ],
  [
    'paused_budget',
    {
      kind: 'budget',
      scope: 'provider-month',
      providerId: 'searchapi',
      unit: 'calls',
      cap: 10_000,
      resumeAfter: null,
      resetsAt: asIsoDateTime('2026-11-01T00:00:00.000Z'),
      flights: null,
    },
  ],
  ['paused_budget', { kind: 'limiter-timeout', providerId: 'searchapi', resumeAfter: null }],
  ['cancelled', { kind: 'cancelled' }],
  ['cancelled', { kind: 'superseded', by: 'search-again' }],
  ['interrupted', { kind: 'interrupted' }],
  ['paused_error', { kind: 'fatal' }],
  ['skipped_confirm', { kind: 'skipped-confirm', estimatePence: 120, confirmedPence: 100 }],
  ['skipped_budget', { kind: 'skipped-budget', scope: 'global-month', providerId: null }],
  ['skipped_window', { kind: 'skipped-window' }],
  ['skipped_missed', { kind: 'skipped-missed', code: 'half-cadence' }],
];

describe('no main-path jargon on a search’s page, in any state (spec rev 55 §3, §11)', () => {
  const sweep = () => expect(jargonIn(mainPathWords())).toEqual([]);

  it('searched (the worked example)', async () => {
    renderDates({ body: workedDates() });
    await findTrips();
    await screen.findByTestId('dates-run');
    sweep();
  });

  it('never searched, and a search naming no source', async () => {
    const r = renderDates({ body: { executions: [], executionId: null } });
    await screen.findByRole('button', { name: /^Search now/ });
    sweep();
    r.unmount();
    renderDates({
      body: { executions: [], executionId: null, discoveryProviders: [] },
      def: definition({ providers: { discovery: [], verification: [], discoveryRefreshHours: {} } }),
    });
    await screen.findByRole('link', { name: P.noSourceFix });
    sweep();
  });

  it('searching and reading flights', async () => {
    for (const over of [
      { status: 'running' as const },
      {
        status: 'running' as const,
        flights: { planned: 10, read: 3, reused: 0, failed: 0, ended: null, confirm: null, stopCause: null },
      },
      { status: 'running' as const, stage: 'verification' as const },
    ]) {
      serveRun(over);
      const r = renderDates({
        body: { ...workedDates(), executions: [runSummary({ status: 'running', finishedAt: null })] },
      });
      await screen.findByRole('button', { name: COPY.runProgress.cancel });
      sweep();
      r.unmount();
    }
  });

  it('each kind of stop, worded by core’s stopText', async () => {
    for (const [status, cause] of STOPS) {
      serveRun({ status, stop: stopText(cause, { tz: 'Europe/London', mode: 'native', scheduled: true }) });
      const r = renderDates({
        body: { ...workedDates(), executions: [runSummary({ status, finishedAt: null })] },
      });
      await screen.findByTestId('stop-sentence');
      expect(jargonIn(mainPathWords()), cause.kind).toEqual([]);
      r.unmount();
    }
  });

  it('each refused Search now', async () => {
    for (const code of apiContract.startRefusalCodes) {
      const r = renderDates({
        body: { executions: [], executionId: null },
        search: `?view=dates&def=def-0001&refused=${code}`,
      });
      await screen.findByText(code === 'cap' ? REFUSED_COPY.cap : REFUSED_COPY[code]);
      expect(jargonIn(mainPathWords()), code).toEqual([]);
      r.unmount();
    }
  });

  it('a filter with no price in it, and too many dates to read', async () => {
    const r = renderDates({
      body: { destinations: ['JFK'], rest: { error: 1, not_run: 1 } },
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-10',
    });
    await screen.findByText(P.noPriceInFilters);
    sweep();
    r.unmount();
    server.use(
      datesError(422, 'too_many_cells', 'the scope has 100000 cells, above 50000', {
        cells: 100_000,
        bound: 50_000,
      }),
    );
    renderDates();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This search covers 100,000 combinations of dates and airports, more than the 50,000 this page reads at once.',
    );
    sweep();
  });
});

describe('the red synthetic banner, judged on the decoded read (revision 50)', () => {
  const realPairs = (extra: Record<string, ReturnType<typeof pricedPair>> = {}) => {
    const pairs: Record<string, ReturnType<typeof pricedPair>> = {};
    for (let d = 14; d <= 24; d += 1) pairs[at(`2027-03-${d}`, 10)] = pricedPair(realFig(30_000 + d * 100));
    return { ...pairs, ...extra };
  };

  it('shows when only the 11th-ranked figure is synthetic (not among the shown rows)', async () => {
    renderDates({
      body: { ...real, pairs: realPairs({ [at('2027-03-31', 10)]: pricedPair(priced(90_000)) }) },
    });
    await findTrips();
    expect(banner()).toBeInTheDocument();
  });

  it('shows when only a cheaper-cached provenance is synthetic', async () => {
    const fig = verifiedFig({
      price: { ...verifiedFig().price, provenance: provSearched() },
      cheaperCached: {
        pricePence: 20_000,
        provenance: provSynthetic(),
        stale: false,
        truncated: false,
        origin: asIata('LGW'),
        destination: asIata('EWR'),
      },
    });
    renderDates({ body: { ...real, pairs: { [at('2027-03-14', 10)]: pricedPair(fig) } } });
    await findTrips();
    expect(banner()).toBeInTheDocument();
  });

  it('shows for a fixture run that priced nothing', async () => {
    renderDates({ body: { discoveryProviders: ['fixture'], rest: { no_data: 4 } } });
    await findTrips();
    expect(banner()).toBeInTheDocument();
  });

  it('is absent when nothing in the read is synthetic, whatever the rows shown', async () => {
    renderDates({ body: { ...real, pairs: realPairs() } });
    await findTrips();
    expect(banner()).toBeNull();
  });
});

describe('the latest run’s own poll beside the top bar (ruling B7, R-coupling)', () => {
  // why: only the interval is faked and the clock never advances by itself, so each POLL_MS step is exact; Testing
  // Library's waits run on the DOM's mutation events. The tests check what the page says as reads arrive, never how the
  // query library schedules them.
  afterEach(() => vi.useRealTimers());
  const fakeClock = () =>
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });

  /** The bar beside a page that mounts on a press, so the two start reading at different instants. */
  function Shell({ bar }: { bar: ReactElement }) {
    const [page, setPage] = useState(false);
    return (
      <>
        {bar}
        <button type="button" onClick={() => setPage(true)}>
          show page
        </button>
        {page ? <DatesView definition={definition()} /> : null}
      </>
    );
  }

  /** Serves the runs by id, each read of exec-0001 twenty minutes nearer its finish; records each read's id. */
  function serveRuns(reads: string[]) {
    let n = 0;
    server.use(
      http.get(`${API}/executions/:id`, ({ params }) => {
        const id = String(params.id);
        reads.push(id);
        if (id !== 'exec-0001') return HttpResponse.json(execution({ id, definitionId: 'def-0002' }));
        const finish = isoDateTimeOfEpochMs(Date.parse('2026-10-14T16:40:00.000Z') - n * 20 * 60_000);
        n += 1;
        return HttpResponse.json(execution({ status: 'running', estimatedFinishAt: finish }));
      }),
    );
  }
  const runningDates = {
    ...workedDates(),
    executions: [runSummary({ status: 'running', finishedAt: null })],
  };

  it('beside the top bar, the page’s line still moves with each read of its own run', async () => {
    fakeClock();
    const reads: string[] = [];
    serveRuns(reads);
    server.use(serveDatesFor(runningDates));
    renderWithProviders(<Shell bar={<TopBar />} />, {
      search: '?view=dates&def=def-0001',
    });
    fireEvent.click(screen.getByRole('button', { name: 'show page' }));
    await waitFor(() => expect(reads).toContain('exec-0001'));
    const line = await screen.findByTestId('state-line');
    await waitFor(() => expect(line).toHaveTextContent(/about \d+ min left/));
    const first = line.textContent;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(line.textContent).not.toBe(first));
  });
});

describe('no main-path jargon on the Edit page and its More options (spec rev 55 §3, §11; rulings 20.5 concern 8, ui-011)', () => {
  const renderEdit = (existing = definition()) =>
    renderWithProviders(
      <DefinitionForm existing={existing} providers={providersResponse()} debounceMs={0} />,
      {
        search: '?view=definitions&edit=def-0001',
      },
    );
  /** The Edit page with More options open and its estimate sentence in. */
  async function opened(existing = definition()) {
    const r = renderEdit(existing);
    await r.user.click(await screen.findByText(PLAN_COPY.moreOptions));
    // design 2026-11-08 Ruling 13: the rest of the old More options is under Limits and checks
    await r.user.click(screen.getByText(COPY.newSearch.limitsHeading));
    await screen.findByRole('button', { name: /^Save and search again/ });
    await waitFor(() => expect(screen.queryByText(COPY.newSearch.working)).toBeNull());
    return r;
  }
  const sweep = (state: string) => expect(jargonIn(mainPathWords()), state).toEqual([]);

  it('as it opens, with More options, Limits and checks and the budget fit', async () => {
    await opened();
    sweep('opened');
  });

  it('a Save that raises a scheduled search’s estimate above its confirmation: the reconfirmation, with no "hard stop"', async () => {
    server.use(
      http.put(`${API}/definitions/:id`, () =>
        HttpResponse.json(
          definition({
            needsConfirmation: {
              estimateMicroGbp: 1_200_000,
              totalCalls: 160,
              confirmedCostPence: 100,
              confirmedCalls: 154,
            },
          }),
        ),
      ),
    );
    const { user } = await opened();
    await user.click(screen.getByRole('button', { name: COPY.editSearch.save }));
    const alert = await screen.findByText(/^The new estimate, about 160 calls/);
    expect(alert).toHaveTextContent('(stops at 2000)');
    sweep('reconfirmation');
  });

  it('each refused start of Save and search again, worded beside its press', async () => {
    // why: the sweep must read the refusal itself, so it waits for that code's own words (the form's mapping: `confirm`
    // asks the estimate again; every other code has its Search again copy), never for any alert already on the page
    const R = COPY.searchAgain.refused;
    const refusalWords: Record<string, string> = {
      active: R.active,
      cap: R.cap,
      confirm: COPY.editSearch.estimateChanged,
      disabled: R.disabled,
      window: R.window,
      'shutting-down': R['shutting-down'],
      not_found: R.not_found,
    };
    for (const [code, words] of Object.entries(refusalWords)) {
      server.use(
        http.post(`${API}/definitions/:id/executions`, () =>
          HttpResponse.json(
            { error: { code, message: 'engine text: definition cells discovery' } },
            { status: code === 'not_found' ? 404 : 409 },
          ),
        ),
      );
      const { user, unmount } = await opened();
      await user.click(screen.getByRole('button', { name: /^Save and search again/ }));
      const said = await screen.findByText(words);
      expect(said.closest('[role="alert"]'), code).not.toBeNull();
      sweep(code);
      unmount();
    }
  });

  it('the set-up terms that stay under More options each carry their one-line explanation', async () => {
    await opened();
    const D = SETUP_COPY.definitions;
    const explained: Array<[string, string]> = [
      [D.refreshLabel(mainPathSource('travelpayouts')), D.refreshHint],
      [D.refreshLabel(mainPathSource('searchapi')), D.refreshHint],
      [COPY.maxCalls, D.maxCallsHint],
      [COPY.maxFreeCalls, D.maxFreeCallsHint],
      [COPY.maxCost, D.maxCostHint],
      [D.maxCells, D.maxCellsHint],
      [D.expandTop, D.expandTopHint(5)],
    ];
    for (const [label, words] of explained)
      expect(screen.getByLabelText(label), label).toHaveAccessibleDescription(words);
    // the sources are named as Where to look names them (Ruling 13), never by a vendor's own product name
    expect(screen.getByRole('checkbox', { name: /^Aviasales cache · / })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Camoufox|Travelpayouts/ })).toBeNull();
    // the budget fit names each limit in words, never by its wire label
    expect(document.body.textContent).not.toMatch(/provider-month:|execution-calls|global-month/);
  });
});
