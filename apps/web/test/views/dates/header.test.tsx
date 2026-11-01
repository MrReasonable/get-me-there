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
import { POLL_MS, qk } from '../../../src/api/queries.js';
import type { ExecutionResponse } from '../../../src/api/types.js';
import { StatusBar } from '../../../src/components/StatusBar.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { REFUSED_COPY } from '../../../src/copy/refused.js';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { DatesView } from '../../../src/views/Dates/DatesView.js';
import { DefinitionForm } from '../../../src/views/Definitions/DefinitionForm.js';
import {
  at,
  calendarFig,
  DATES_SPACE,
  priced,
  pricedPair,
  provCached,
  provSearched,
  provSynthetic,
  runSummary,
  verifiedFig,
  workedDates,
} from '../../fixtures.dates.js';
import {
  API,
  calendarGap,
  cell,
  definition,
  execution,
  provCalendar,
  providersResponse,
} from '../../fixtures.js';
import { latestRun, searchCard } from '../../fixtures.searches.js';
import { datesError, serveDates as serveDatesFor } from '../../msw/datesHandlers.js';
import { serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';
import { jargonIn, mainPathWords } from './jargon.js';
import { boardRows, findBoard, renderDates } from './render.js';

// Spec §11 Dates "Header line" (spec rev 55 §11 "A search's page": WP20 Task 20.6), the jargon sweep over the page in
// every state, the calendar-gap banner on Dates and the red synthetic banner (revision 50).

/** The worked window with stays up to 20 nights, so a 20-night gap cell is inside the space. */
const WIDE = { ...DATES_SPACE, maxNights: 20 };
const real = { discoveryProviders: ['travelpayouts' as const] };
const realFig = (pence: number) =>
  calendarFig({ price: { ...calendarFig().price, pricePence: pence, provenance: provCached() } });
const banner = () => screen.queryByText(/^Synthetic data: the fixture provider is enabled/);

describe('a search’s header (spec rev 55 §11)', () => {
  it('the route, window and stay in words, the header line linking to the coverage section, and the actions', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    expect(screen.getByRole('heading', { name: 'Worked example' })).toBeInTheDocument();
    const head = screen.getByTestId('dates-head');
    await waitFor(() => expect(head).toHaveTextContent('London'));
    expect(head).toHaveTextContent('(LHR, LGW → JFK, EWR)');
    // a rolling window says so, with the dates it covers now (dates as "10 Jan 2027")
    expect(head).toHaveTextContent(
      'rolling: 182 days from 7 days ahead, now 14 Mar 2027 – 13 Apr 2027 · 10–21 nights',
    );
    // the latest parent run, 13:00–14:00 London today, read by the board's date pairs; its source from its outcomes
    const line = await screen.findByTestId('dates-run');
    expect(line).toHaveTextContent(/^Searched today 13:00–14:00 · 11 of 93 date pairs priced, /);
    expect(line).toHaveTextContent(/ · the Aviasales cache$/);
    // the six buckets under the count (spec rev 55 §3)
    expect(screen.getByTestId('dates-run-buckets')).toHaveTextContent(
      /^by airport pair: 11 priced, 4 no fares, /,
    );
    const link = within(line).getByRole('link');
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('d.coverage')).toBe('open');
    // the actions: Search again, Edit, and the schedule in words with Change (the worked search repeats Mondays)
    const actions = screen.getByRole('group', { name: COPY.searchPage.actionsLabel });
    expect(within(actions).getByRole('button', { name: COPY.searchAgain.label })).toBeInTheDocument();
    const edit = within(actions).getByRole('link', { name: COPY.searchesView.edit });
    expect(
      Object.fromEntries(new URL(edit.getAttribute('href') ?? '', 'http://x').searchParams),
    ).toMatchObject({
      view: 'definitions',
      edit: 'def-0001',
    });
    expect(actions).toHaveTextContent('Repeats Mondays 05:00');
    expect(within(actions).getByRole('button', { name: COPY.repeatWeekly.change })).toBeInTheDocument();
    // no coverage line, no stored status word on the main path
    expect(screen.queryByRole('link', { name: /^discovery: / })).toBeNull();
    expect(head).not.toHaveTextContent(/run finished|paused: /);
  });

  it('a fixed window states its dates; an unscheduled search offers Repeat weekly…', async () => {
    renderDates({
      body: workedDates(),
      def: definition({
        window: { kind: 'absolute', from: '2027-01-10', to: '2027-03-31' },
        enabled: false,
        scheduleCron: null,
      }),
    });
    await findBoard();
    expect(screen.getByTestId('dates-head')).toHaveTextContent('10 Jan 2027 – 31 Mar 2027 · 10–21 nights');
    const actions = screen.getByRole('group', { name: COPY.searchPage.actionsLabel });
    expect(within(actions).getByRole('button', { name: COPY.repeatWeekly.open })).toBeInTheDocument();
  });

  it('with filters set, the line covers the date pairs and airport pairs in scope and says so', async () => {
    renderDates({
      body: workedDates({ destinations: ['JFK'] }),
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-11',
    });
    await findBoard();
    const line = await screen.findByTestId('dates-run');
    // 31 days × 2 stays
    expect(line).toHaveTextContent(/ of 62 date pairs priced/);
    expect(line).toHaveTextContent('· 2 of 4 airport pairs · 10–11 nights');
  });

  it('the full stay range renders the same line as no filter', async () => {
    renderDates({ body: workedDates(), search: '?view=dates&def=def-0001&d.nights=5-30' });
    await findBoard();
    const line = await screen.findByTestId('dates-run');
    expect(line.textContent).not.toContain('nights');
    expect(line).toHaveTextContent(/ of 93 date pairs priced/);
  });

  it('never searched: no header line and no Search again among the actions; the state says so beside Search now', async () => {
    renderDates({ body: { executions: [], executionId: null } });
    const state = await screen.findByTestId('state-line');
    await waitFor(() => expect(state).toHaveTextContent('Not searched yet'));
    expect(screen.queryByTestId('dates-run')).toBeNull();
    const actions = screen.getByRole('group', { name: COPY.searchPage.actionsLabel });
    expect(within(actions).queryByRole('button', { name: COPY.searchAgain.label })).toBeNull();
    expect(await within(state).findByRole('button', { name: /^Search now/ })).toBeInTheDocument();
  });

  it('the stale mark’s words: the header says every price is older than this search’s refresh, each calendar price says so', async () => {
    const stale = calendarFig({ price: { ...calendarFig().price, stale: true } });
    renderDates({
      body: {
        pairs: { [at('2027-03-14', 10)]: pricedPair(stale), [at('2027-03-15', 10)]: pricedPair(stale) },
      },
    });
    const board = await findBoard();
    expect(screen.getByText("Every price shown is older than this search's refresh.")).toBeInTheDocument();
    expect(within(board).getAllByText("older than this search's refresh")).toHaveLength(2);
    expect(within(board).queryByText('stale')).toBeNull();
  });

  it('a stale verified figure reads "older than your stale setting"', async () => {
    const fig = verifiedFig({ price: { ...verifiedFig().price, stale: true } });
    renderDates({ body: { pairs: { [at('2027-03-14', 10)]: pricedPair(fig) } } });
    const board = await findBoard();
    expect(within(board).getAllByText('older than your stale setting')).toHaveLength(1);
    expect(screen.getByText('Every price shown is older than your stale setting.')).toBeInTheDocument();
  });

  it('the board’s basis words: where a calendar price came from, and checked fares for a verified one', async () => {
    renderDates({
      body: {
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(realFig(30_000)),
          [at('2027-03-15', 10)]: pricedPair(
            calendarFig({
              price: {
                ...calendarFig().price,
                pricePence: 31_000,
                provenance: provSearched({ sourceKind: 'scraped-aggregate', pointOfSale: 'unknown' }),
              },
            }),
          ),
          [at('2027-03-16', 10)]: pricedPair(
            verifiedFig({
              price: { ...verifiedFig().price, pricePence: 32_000, provenance: provSearched() },
            }),
          ),
        },
      },
    });
    const rows = boardRows(await findBoard());
    expect(rows[0]).toHaveTextContent('from the Aviasales cache, constraints not checked');
    expect(rows[1]).toHaveTextContent("from Google's date grid, constraints not checked");
    expect(rows[2]).toHaveTextContent('checked fares, verified');
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
  const serveRun = (over: Parameters<typeof execution>[0]) =>
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(over))));

  it('searched (the worked example, with the calendar-gap banner and the thin-coverage line)', async () => {
    server.use(http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(gapBody())));
    renderDates({ body: workedDates({ space: WIDE }) });
    await findBoard();
    await screen.findByRole('region', { name: COPY.searchPage.gapList });
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
    await screen.findByRole('link', { name: COPY.searchPage.noSourceFix });
    sweep();
  });

  it('searching and reading flights', async () => {
    for (const over of [
      { status: 'running' as const },
      {
        status: 'running' as const,
        flights: { planned: 10, read: 3, reused: 0, failed: 0, ended: null },
      },
      { status: 'running' as const, stage: 'verification' as const },
    ]) {
      serveRun(over);
      const r = renderDates({
        body: { ...workedDates(), executions: [runSummary({ status: 'running', finishedAt: null })] },
      });
      await screen.findByRole('button', { name: COPY.searchPage.cancel });
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

  it('a filter with no price in it, and too many date pairs to read', async () => {
    const r = renderDates({
      body: { destinations: ['JFK'], rest: { error: 1, not_run: 1 } },
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-10',
    });
    await screen.findByText('No date pair in these filters has a price found so far.');
    sweep();
    r.unmount();
    server.use(
      datesError(422, 'too_many_cells', 'the scope has 100000 cells, above 50000', {
        cells: 100_000,
        bound: 50_000,
      }),
    );
    renderDates();
    await screen.findByRole('alert');
    sweep();
  });
});

/** Three gap cells: one in every scope, one on LHR→EWR, one 20 nights long. */
const gapBody = () =>
  calendarGap({
    cells: [
      {
        cell: cell('LHR', 'JFK', '2027-03-20', '2027-04-01', 12),
        calendar: {
          pricePence: 30_100,
          provenance: provCalendar,
          stale: false,
          ageHours: 2,
          truncated: false,
        },
        verifyAvailable: true,
      },
      {
        cell: cell('LHR', 'EWR', '2027-03-21', '2027-04-02', 12),
        calendar: {
          pricePence: 30_200,
          provenance: provCalendar,
          stale: false,
          ageHours: 2,
          truncated: false,
        },
        verifyAvailable: true,
      },
      {
        cell: cell('LGW', 'JFK', '2027-03-22', '2027-04-11', 20),
        calendar: {
          pricePence: 30_300,
          provenance: provCalendar,
          stale: false,
          ageHours: 2,
          truncated: false,
        },
        verifyAvailable: true,
      },
    ],
  });

describe('the calendar-gap banner on Dates (spec §11, revision 50)', () => {
  const gap = gapBody;

  it('lists only the gap cells inside the airport scope and the stay filter, names its reference across the whole search, and links each to its detail', async () => {
    server.use(http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(gap())));
    renderDates({
      body: workedDates({ destinations: ['JFK'], space: WIDE }),
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-14',
    });
    const section = await screen.findByRole('region', { name: COPY.searchPage.gapList });
    // LHR→EWR is outside the airport scope, and the 20-night cell outside the stay filter
    const links = within(section).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['LHR → JFK 20 Mar 2027–1 Apr 2027 (12n)']);
    expect(section).toHaveTextContent('1 date pair on one airport pair has a calendar price');
    expect(section).toHaveTextContent('reference across the whole search:');
    expect(within(section).getAllByTestId('price-cell')[0]).toHaveTextContent('£412');
    expect(
      Object.fromEntries(new URL(links[0]?.getAttribute('href') ?? '', 'http://x').searchParams),
    ).toMatchObject({
      view: 'results',
      depart: '2027-03-20',
      return: '2027-04-01',
      'd.to': 'JFK',
    });
  });

  it('under d.nights=10-14 a 20-night gap cell is not listed and the reference is unchanged', async () => {
    const asked: string[] = [];
    const [twelve, , twenty] = gap().cells;
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(
          calendarGap({ cells: [twelve, twenty].flatMap((c) => (c === undefined ? [] : [c])) }),
        );
      }),
    );
    renderDates({
      body: workedDates({ space: WIDE }),
      search: '?view=dates&def=def-0001&d.nights=10-14',
    });
    const section = await screen.findByRole('region', { name: COPY.searchPage.gapList });
    // the 12-night cell is listed, the 20-night one is not
    expect(
      within(section)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['LHR → JFK 20 Mar 2027–1 Apr 2027 (12n)']);
    // why: the reference is the whole search's cheapest verified price (£412, a 14-night cell): the stay filter
    // never reaches the gap read, so the reference is the one an unfiltered read shows
    expect(section).toHaveTextContent('reference across the whole search:');
    expect(within(section).getAllByTestId('price-cell')[0]).toHaveTextContent('£412');
    expect(asked).toEqual(['']);
  });

  it('under d.nights=10-14 a gap of only a 20-night cell shows no banner', async () => {
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json(
          calendarGap({ cells: [gap().cells[2]].flatMap((c) => (c === undefined ? [] : [c])) }),
        ),
      ),
    );
    const { client } = renderDates({
      body: workedDates({ space: WIDE }),
      search: '?view=dates&def=def-0001&d.nights=10-14',
    });
    await findBoard();
    // why: the gap read must have answered, so an absent banner is the stay filter's doing, not a pending read
    // (review tsr2-002's guard, as basisAndGap.test.tsx)
    await settled(client);
    expect(client.getQueryCache().find({ queryKey: qk.calendarGap('def-0001') })?.state.status).toBe(
      'success',
    );
    expect(screen.queryByRole('region', { name: COPY.searchPage.gapList })).toBeNull();
  });

  // ported from Results' calendar-gap banner (basisAndGap.test.tsx, WP19 Task 19.8): the lead pluralises
  it('two gap cells in scope pluralise the lead', async () => {
    server.use(http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(gap())));
    renderDates({ body: workedDates({ space: WIDE }), search: '?view=dates&def=def-0001&d.nights=10-14' });
    const section = await screen.findByRole('region', { name: COPY.searchPage.gapList });
    expect(within(section).getAllByRole('link')).toHaveLength(2);
    expect(section).toHaveTextContent('2 date pairs on their airport pairs have calendar prices');
  });

  // ported from Results' calendar-gap banner (review prov-019): a failed gap request says so with Retry, and never
  // reads as "no gap"
  it('a failed gap request shows its load error with Retry in the banner’s place, never an empty banner', async () => {
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'gap read failed' } }, { status: 500 }),
      ),
    );
    renderDates({ body: workedDates({ space: WIDE }) });
    await findBoard();
    expect(await screen.findByText(/gap read failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.retryLoad })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: COPY.searchPage.gapList })).toBeNull();
  });

  it('no banner without a verification provider (the gap is never fetched)', async () => {
    let asked = 0;
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () => {
        asked += 1;
        return HttpResponse.json(gap());
      }),
    );
    const { client } = renderDates({ body: { ...workedDates(), verificationProviderConfigured: false } });
    await findBoard();
    // why: settle first, so a gap request the render fired late would be counted (review tsr2-002)
    await settled(client);
    expect(asked).toBe(0);
  });
});

describe('the red synthetic banner, judged on the decoded read (revision 50)', () => {
  const realPairs = (extra: Record<string, ReturnType<typeof pricedPair>> = {}) => {
    const pairs: Record<string, ReturnType<typeof pricedPair>> = {};
    for (let d = 14; d <= 24; d += 1) pairs[at(`2027-03-${d}`, 10)] = pricedPair(realFig(30_000 + d * 100));
    return { ...pairs, ...extra };
  };

  it('shows when only the 11th-ranked figure is synthetic', async () => {
    renderDates({
      body: { ...real, pairs: realPairs({ [at('2027-03-31', 10)]: pricedPair(priced(90_000)) }) },
    });
    await findBoard();
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
    await findBoard();
    expect(banner()).toBeInTheDocument();
  });

  it('shows for a fixture run that priced nothing', async () => {
    renderDates({ body: { discoveryProviders: ['fixture'], rest: { no_data: 4 } } });
    expect(await screen.findByText('No prices in this run.')).toBeInTheDocument();
    expect(banner()).toBeInTheDocument();
  });

  it('is absent when nothing in the read is synthetic, whatever the rows shown', async () => {
    renderDates({ body: { ...real, pairs: realPairs() } });
    await findBoard();
    expect(banner()).toBeNull();
  });
});

describe('the latest run’s poll beside the status bar’s (ruling B7, arch-r2-014)', () => {
  // why: only the interval is faked and the clock never advances by itself, so each POLL_MS step is exact; Testing
  // Library's waits run on the DOM's mutation events. The page mounts POLL_MS / 2 after the bar, so two polls of one run
  // would fall at different instants and could not be merged into one request.
  afterEach(() => vi.useRealTimers());
  const fakeClock = () =>
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });

  /** The bar beside a page that mounts on a press, so the two start polling at different instants. */
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

  it('a search whose run is not the bar’s (another search’s older run is in flight) polls its own, and its line moves', async () => {
    fakeClock();
    const reads: string[] = [];
    serveRuns(reads);
    server.use(
      serveDatesFor(runningDates),
      serveCards([
        searchCard({
          id: 'def-0002',
          name: 'Another search',
          latestRun: latestRun({
            id: 'exec-other',
            status: 'running',
            startedAt: '2026-10-14T10:00:00.000Z',
          }),
        }),
        searchCard({ id: 'def-0001', latestRun: latestRun({ status: 'running', finishedAt: null }) }),
      ]),
    );
    renderWithProviders(<Shell bar={<StatusBar definition={null} />} />, {
      search: '?view=dates&def=def-0001',
    });
    await waitFor(() => expect(reads).toContain('exec-other'));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS / 2));
    fireEvent.click(screen.getByRole('button', { name: 'show page' }));
    const line = await screen.findByTestId('state-line');
    await waitFor(() => expect(line).toHaveTextContent('about 1h 40m left'));
    const own = () => reads.filter((id) => id === 'exec-0001').length;
    const before = own();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(own()).toBe(before + 1));
    await waitFor(() => expect(line).toHaveTextContent('about 1h 20m left'));
  });

  it('when the bar polls the same run, the page shares its query and asks for nothing of its own', async () => {
    fakeClock();
    const reads: string[] = [];
    serveRuns(reads);
    server.use(serveDatesFor(runningDates));
    const { client } = renderWithProviders(<Shell bar={<StatusBar definition={definition()} />} />, {
      search: '?view=dates&def=def-0001',
    });
    await waitFor(() => expect(reads).toContain('exec-0001'));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS / 2));
    fireEvent.click(screen.getByRole('button', { name: 'show page' }));
    const line = await screen.findByTestId('state-line');
    await waitFor(() => expect(line).toHaveTextContent(/^Searching · /));
    // why: TanStack Query restarts every observer's interval on each update of the query, so two polls of one run move
    // in step and their requests merge: the request count cannot tell them apart. What can is who polls: the run's query
    // has two observers (the bar's and the page's) and exactly one of them, the bar's, has an interval
    const query = client.getQueryCache().find({ queryKey: qk.execution('exec-0001') });
    if (query === undefined) throw new Error('no run query');
    const intervals = query.observers.map((o) => {
      const r = o.options.refetchInterval;
      return typeof r === 'function' ? r(query) : r;
    });
    expect(intervals).toHaveLength(2);
    expect(intervals.filter((r) => r === POLL_MS)).toHaveLength(1);
    // and one read an interval, as the bar alone asks
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const before = reads.length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(reads.length).toBe(before + 1));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(reads.length).toBe(before + 2));
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
    await screen.findByRole('button', { name: /^Save and search again/ });
    await waitFor(() => expect(screen.queryByText(COPY.newSearch.working)).toBeNull());
    return r;
  }
  const sweep = (state: string) => expect(jargonIn(mainPathWords()), state).toEqual([]);

  it('as it opens, with More options and the budget fit', async () => {
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
    for (const code of ['active', 'cap', 'confirm', 'disabled', 'window', 'shutting-down', 'not_found']) {
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
      await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
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
    // the sources are named as the main path names them, never by a vendor's product name
    expect(screen.getByRole('checkbox', { name: 'The Aviasales cache' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Camoufox|Travelpayouts/ })).toBeNull();
    // the budget fit names each limit in words, never by its wire label
    expect(document.body.textContent).not.toMatch(/provider-month:|execution-calls|global-month/);
  });
});
