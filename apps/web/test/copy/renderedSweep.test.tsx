import { asIsoDate, asIsoDateTime, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { RunProgress, type RunProgressRun } from '../../src/components/RunProgress.js';
import { CalendarRow } from '../../src/components/rows/CalendarRow.js';
import { TripRow } from '../../src/components/rows/TripRow.js';
import { PLAN_COPY } from '../../src/copy/plan.js';
import { COPY } from '../../src/copy.js';
import { VIEWS } from '../../src/state/view.js';
import {
  at,
  calendarFig,
  type DatesOptions,
  figurePairing,
  pairingFig,
  pricedPair,
  provCached,
} from '../fixtures.dates.js';
import {
  API,
  budgetResponse,
  calendarRow,
  estimate,
  estimateResponse,
  execution,
  failedRow,
  partialRow,
  providersResponse,
  resultsResponse,
  statusReport,
  usage,
  verifiedRow,
} from '../fixtures.js';
import {
  calendarOnly,
  cardTrip,
  flightListProvenance,
  flightPair,
  latestRun,
  lowerOnCalendar,
  noPrices,
  searchCard,
} from '../fixtures.searches.js';
import { readTrip, tripBody } from '../fixtures.trip.js';
import { poundsOutsidePrices, renderedCopy } from '../guards.js';
import { serveDates } from '../msw/datesHandlers.js';
import { serveCards, serveFlightLists } from '../msw/searchesHandlers.js';
import { server } from '../msw/server.js';
import { drawn, renderWithProviders } from '../render.js';
import { jargonIn, mainPathWords } from '../views/dates/jargon.js';
import { airportRows, LHR_JFK } from '../views/searches/support.js';

/**
 * One landmark per view that exists only once the view's data has rendered, so the sweep cannot pass over a view that
 * showed nothing but an error or a skeleton (neither carries a banned word or a "£").
 */
type Swept = (typeof VIEWS)[number];
const SWEPT = VIEWS;
const CONTENT: Record<Swept, () => Promise<HTMLElement>> = {
  // why: the Trip page's own sweep runs over every state of its card (test/views/trip/TripView.test.tsx); this one
  // sweeps it in the shell, its folds closed
  trip: () => screen.findByRole('region', { name: COPY.trip.cardLabel }),
  searches: () => screen.findByRole('list', { name: COPY.searchesView.listLabel }),
  dates: () => screen.findByRole('region', { name: COPY.searchPage.cheapestHeading }),
  // why: the chart draws its axes after the figure renders; the sweep reads them, so it waits for the drawn surface
  history: async () => {
    const figure = await screen.findByRole('figure', { name: COPY.historyView.fetchChartTitle });
    await drawn(figure);
    return figure;
  },
  definitions: () => screen.findByRole('button', { name: COPY.editSearch.save }),
  settings: () => screen.findByRole('heading', { name: COPY.settingsView.heading }),
  alerts: () => screen.findByRole('heading', { name: COPY.alertsView.heading }),
  providers: () => screen.findByRole('heading', { name: COPY.providersHeading }),
  status: () => screen.findByRole('heading', { name: COPY.statusView.heading }),
};

describe('rendered views contain no banned word, and no "£" outside a price or a cost (spec §11, §9 item 6)', () => {
  for (const view of SWEPT) {
    it(`view=${view}`, async () => {
      server.use(
        http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))),
        http.get(`${API}/executions/:id`, () =>
          HttpResponse.json(
            execution({
              status: 'paused_budget',
              stop: {
                sentence: 'Stopped at its monthly limit.',
                fix: { text: 'Search again', command: null },
              },
            }),
          ),
        ),
        http.get(`${API}/definitions/:id/results`, () =>
          HttpResponse.json(
            resultsResponse({
              rows: [verifiedRow(), partialRow(), failedRow(), calendarRow({ truncated: true })],
              truncated: true,
              total: 4210,
            }),
          ),
        ),
        http.get(`${API}/definitions/:id/trip`, () => HttpResponse.json(tripBody(readTrip()))),
      );
      // why: core's filterRows hides failed rows by default (spec §6.9); every class is in the URL so every row's copy is swept.
      const classes = 'f.class=verified,partially-verified,failed,unchecked';
      // why: the Edit page needs `edit=` (spec rev 55 §11 URLs); the first screen's sweep covers the new-search form
      const edit =
        view === 'definitions'
          ? '&edit=def-0001'
          : view === 'trip'
            ? '&depart=2026-11-11&return=2026-11-28'
            : '';
      const { user } = renderWithProviders(<App />, {
        search: `?view=${view}&def=def-0001&${classes}${edit}`,
      });
      await screen.findByRole('navigation', { name: 'Main' });
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      // why: a failed or empty load would pass the sweep untouched, so the view must have rendered its own content
      await CONTENT[view]();
      expect(screen.queryByText(/^Could not load:/)).toBeNull();
      expect(screen.queryByText(/^Provider status unknown/)).toBeNull();
      if (view === 'definitions') await user.click(await screen.findByText(PLAN_COPY.moreOptions));
      const hits = findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST);
      expect(hits.map((h) => h.word)).toEqual([]);
      expect(poundsOutsidePrices()).toEqual([]);
    });
  }
});

describe('the main path in the shell says no set-up term (spec rev 55 §3, §11; WP20 Task 20.6)', () => {
  // why: the first screen, a search's page and the Edit page with its More options, each with the status bar and the
  // nav around it, as the shell draws them; provenance notes (inside a PriceCell) keep their source names
  const MAIN = [
    ['searches', ''],
    ['dates', ''],
    ['definitions', '&edit=def-0001'],
    ['settings', ''],
  ] as const;
  for (const [view, extra] of MAIN) {
    it(`view=${view}`, async () => {
      const { user } = renderWithProviders(<App />, { search: `?view=${view}&def=def-0001${extra}` });
      await screen.findByRole('navigation', { name: 'Main' });
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      await CONTENT[view]();
      if (view === 'definitions') await user.click(await screen.findByText(PLAN_COPY.moreOptions));
      // the top bar's health line and limits are in on every view; a search's page and Edit also carry their trail
      await screen.findByRole('region', { name: COPY.topBar.limitsLabel });
      if (view === 'dates' || view === 'definitions')
        await screen.findByRole('navigation', { name: COPY.crumbsLabel });
      expect(jargonIn(mainPathWords())).toEqual([]);
    });
  }
});

describe('the top bar and run progress say no banned word, no set-up term and no "£" outside a cost (Task 4)', () => {
  it('the health line with problems, SearchApi’s credits left, the spend and a running search', async () => {
    server.use(
      http.get(`${API}/status`, () =>
        HttpResponse.json(
          statusReport([
            { id: 'schedule', area: 'schedule', state: 'fail', summary: 'down' },
            { id: 'backups', area: 'backups', state: 'warn', summary: 'old' },
          ]),
        ),
      ),
      http.get(`${API}/budget`, () =>
        HttpResponse.json(
          budgetResponse({
            scopes: [
              usage('provider-month:searchapi', 49, 100),
              usage('global-month', 0, 35_000_000, 32_000_000),
            ],
          }),
        ),
      ),
      serveCards([searchCard({ name: 'Worked example', latestRun: latestRun({ status: 'running' }) })]),
    );
    renderWithProviders(<App />, { search: '?view=settings' });
    await screen.findByRole('link', { name: '2 things need you · fix' });
    await screen.findByText("SearchApi: 51 of 100 credits left (this app's count)");
    await screen.findByText('Spent £32 of £35 this month');
    await screen.findByRole('link', { name: 'Searching: Worked example' });
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    // why: settings plan ruling 10 — SearchApi's unit is credits; "searches left" is never its words
    expect(renderedCopy()).not.toMatch(/searches left/i);
    expect(jargonIn(mainPathWords())).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it('SearchApi’s own balance, with its reset day, says credits and no banned word', async () => {
    server.use(
      http.get(`${API}/budget`, () =>
        HttpResponse.json(budgetResponse({ scopes: [usage('global-month', 0, 35_000_000, 0)] })),
      ),
      http.get(`${API}/searchapi/account`, () =>
        HttpResponse.json({
          account: {
            remaining: 9_988,
            monthlyAllowance: 10_000,
            periodEnd: '2026-12-01',
            fetchedAt: new Date().toISOString(),
          },
        }),
      ),
    );
    renderWithProviders(<App />, { search: '?view=settings' });
    await screen.findByText('SearchApi: 9,988 credits left · resets 1 Dec');
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(renderedCopy()).not.toMatch(/searches left/i);
  });

  it.each<[string, RunProgressRun]>([
    [
      'the calendar',
      {
        id: 'r',
        status: 'running',
        done: 1203,
        total: 2184,
        estimatedFinishAt: asIsoDateTime('2026-10-14T15:14:00.000Z'),
        flightsRead: null,
        checking: null,
        stop: null,
        resumeAfter: null,
        childRun: 'running',
      },
    ],
    [
      'flights',
      {
        id: 'r',
        status: 'running',
        done: 2184,
        total: 2184,
        estimatedFinishAt: null,
        flightsRead: 9,
        checking: null,
        stop: null,
        resumeAfter: null,
        childRun: null,
      },
    ],
    [
      'checking fares (final review M1)',
      {
        id: 'r',
        status: 'running',
        done: 2184,
        total: 2184,
        estimatedFinishAt: asIsoDateTime('2026-10-14T15:14:00.000Z'),
        flightsRead: 9,
        checking: { done: 3, total: 10 },
        stop: null,
        resumeAfter: null,
        childRun: null,
      },
    ],
    [
      'a stopped run',
      {
        id: 'r',
        status: 'paused_budget',
        done: 10,
        total: 20,
        estimatedFinishAt: null,
        flightsRead: null,
        checking: null,
        stop: {
          sentence: 'Stopped at its monthly limit.',
          fix: { text: 'Raise the limit in Edit, then Resume', command: null, resume: true },
        },
        resumeAfter: asIsoDateTime('2026-11-01T00:00:00.000Z'),
        childRun: null,
      },
    ],
  ])('RunProgress: %s', (_name, run) => {
    renderWithProviders(<RunProgress run={run} onCancel={() => undefined} onResume={() => undefined} />);
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(jargonIn(mainPathWords())).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it.each([
    'not-read',
    'outbound-only',
    'no-pairing-read',
    'list-failed',
    'within-older',
    'over-limit',
  ] as const)('the trip and calendar rows (Task 5): calendar read state %s', (pairingRead) => {
    const search = {
      id: 'd',
      cabin: 'economy',
      multiAirport: true,
      pointOfSale: 'GB',
      showCarriers: true,
    } as const;
    const pair = { departureDate: asIsoDate('2026-11-11'), returnDate: asIsoDate('2026-11-28'), nights: 17 };
    renderWithProviders(
      <ul>
        <TripRow figure={pairingFig()} details={null} search={search} pair={pair} />
        <CalendarRow
          figure={calendarFig({ pairingRead, listReason: pairingRead === 'list-failed' ? 'network' : null })}
          search={search}
          pair={pair}
          onRead={() => undefined}
        />
      </ul>,
    );
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(jargonIn(mainPathWords())).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
  });
});

describe('a search\'s page says no banned word, no set-up term, no "£" outside a price (Task 8)', () => {
  it('view=dates: trips on two airport pairs, lower dates with their read states and Read flights, the stopping sentence and the over-limit line', async () => {
    const page: DatesOptions = {
      discoveryProviders: ['travelpayouts', 'camoufox'],
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(
          pairingFig({
            pairing: figurePairing({ pricePence: 119_500, mismatch: true }),
            price: { ...pairingFig().price, pricePence: 119_500 },
          }),
        ),
        [at('2027-03-15', 10)]: pricedPair(
          calendarFig({ price: { ...calendarFig().price, pricePence: 30_000, provenance: provCached() } }),
        ),
        [at('2027-03-16', 10)]: pricedPair(
          calendarFig({
            price: { ...calendarFig().price, pricePence: 31_000, provenance: provCached() },
            pairingRead: 'list-failed',
            listReason: 'network',
          }),
        ),
        [at('2027-03-17', 10)]: pricedPair(
          calendarFig({
            price: { ...calendarFig().price, pricePence: 32_000 },
            pairingRead: 'over-limit',
            pairing: figurePairing({ which: 'over-limit' }),
          }),
        ),
      },
    };
    server.use(
      serveDates(page),
      serveFlightLists((d, r) => flightPair(d, r), { pagesPlanned: 2 }),
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'completed',
            startedAt: '2026-10-14T12:00:00.000Z',
            finishedAt: '2026-10-14T13:00:00.000Z',
            flights: {
              planned: 9,
              read: 9,
              reused: 0,
              failed: 0,
              ended: null,
              confirm: { mode: 'confirm', confirmed: 6, unread: 1, uncheckedCheaper: 3, stop: 'patience' },
              stopCause: null,
            },
          }),
        ),
      ),
    );
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    await screen.findByRole('region', { name: COPY.searchPage.cheapestHeading });
    await screen.findAllByRole('button', { name: /^Read flights for/ });
    await screen.findByTestId('confirm-line');
    await screen.findByTestId('dates-run');
    // Task 9: the calendar, its key and a day's panel (a trip, calendar prices with every read state, stays with none)
    const day = await screen.findByRole('button', { name: /^Sun 14 Mar, / });
    fireEvent.click(day);
    await screen.findByRole('region', { name: /^Sun 14 Mar: \d+ stays$/ });
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
    expect(jargonIn(mainPathWords())).toEqual([]);
    expect(renderedCopy().replace(/not every seller read/gi, '')).not.toMatch(
      /each seller|every seller|verified/i,
    );
  });
});

describe('the Trips cards say no banned word, no set-up term and no "£" outside a price (Task 6)', () => {
  it('a finished card with trips and a lower calendar price, a running one with earlier trips, a calendar-only one and a nothing-found one', async () => {
    const read = (o: Parameters<typeof cardTrip>[0] = {}) =>
      cardTrip(
        { basis: 'pairing', priceKind: 'seller', ...o },
        flightListProvenance('2026-10-14T10:44:00.000Z'),
      );
    server.use(
      serveCards([
        searchCard({
          id: 'a',
          name: 'Finished',
          trips: [read()],
          readDates: 23,
          lowerOnCalendar: lowerOnCalendar({ count: 155 }),
        }),
        searchCard({
          id: 'b',
          name: 'Running',
          latestRun: latestRun({ status: 'running', finishedAt: null }),
          trips: [read({ fromEarlierSearch: true })],
        }),
        searchCard({ id: 'c', name: 'Calendar only', ...calendarOnly({ count: 2146 }) }),
        searchCard({
          id: 'd',
          name: 'Nothing',
          ...noPrices,
          latestRun: latestRun({
            datePairsSearched: 405,
            datePairsNeverSearched: 0,
            marks: {
              priced: 0,
              'no-price-shown': 405,
              'couldnt-read': 0,
              'not-reached': 0,
              'not-searched': 0,
            },
          }),
        }),
        searchCard({ id: 'e', name: 'Never', latestRun: null, ...noPrices }),
      ]),
    );
    renderWithProviders(<App />, { search: '?view=searches' });
    await screen.findByRole('heading', { level: 2, name: 'Nothing' });
    await screen.findByText(/Calendar prices for 2,146 dates/);
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(jargonIn(mainPathWords())).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
  });
});

describe('the new-search panel says no banned word, no main-path term and no "£" outside a cost (Task 7)', () => {
  // why: the Trips plan's main-path words, beyond the jargon list: the panel and its sentence say "dates", never these
  const PANEL_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
    ['date pair', /\bdate pairs?\b/i],
    ['reused', /\breused\b/i],
    ['superseded', /\bsuperseded\b/i],
    ['billed calls', /\bbilled calls?\b/i],
    ['verdict', /\bverdicts?\b/i],
    ['basis', /\bbasis\b/i],
    ['itinerary search', /\bitinerary search\b/i],
    ['on-demand', /\bon-demand\b/i],
    ['trips you can book', /\btrips you can book\b/i],
  ];

  it('Where to look with two sources and the Settings sentence, More options with Repeat’s picker, the sentence, its notes and the over-limit refusal', async () => {
    const tp = providersResponse().providers[0];
    if (tp === undefined) throw new Error('the fixture names the Aviasales cache first');
    // the browser set up and SearchApi not, so both a checkbox and the Settings sentence are swept
    const providers = providersResponse({
      providers: [tp, { ...tp, providerId: 'camoufox', displayName: 'Camoufox', usage: [] }],
    });
    const fitOver = {
      fits: false,
      runsPerMonth: 4.3,
      perScope: [{ scope: 'provider-month:travelpayouts', estimated: 60_000, cap: 50_000, fits: false }],
    };
    server.use(
      airportRows(LHR_JFK),
      http.get(`${API}/providers`, () => HttpResponse.json(providers)),
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          estimateResponse({
            estimate: estimate({
              seconds: 1500,
              flightLists: {
                pages: 23,
                seconds: 100,
                pairs: 15,
                returns: true,
                pagesMax: 580,
                secondsMax: 1825,
              },
            }),
            datePairs: 405,
            datePairsCovered: 300,
            datePairsReused: 50,
            budgetFit: fitOver,
          }),
        ),
      ),
      serveCards([searchCard({ name: 'Worked example' })]),
    );
    const { user } = renderWithProviders(<App />, { search: '?view=searches' });
    const from = await screen.findByRole('combobox', { name: PLAN_COPY.from });
    await user.type(from, 'LHR{Enter}');
    await user.type(screen.getByRole('combobox', { name: PLAN_COPY.to }), 'JFK{Enter}');
    await screen.findByRole('button', { name: 'Remove JFK' });
    fireEvent.change(screen.getByLabelText(PLAN_COPY.earliest), { target: { value: '2027-01-10' } });
    fireEvent.change(screen.getByLabelText(PLAN_COPY.latest), { target: { value: '2027-03-31' } });
    await user.click(screen.getByText(PLAN_COPY.moreOptions));
    await user.selectOptions(screen.getByLabelText(COPY.newSearch.repeat), 'weekly');
    const region = screen.getByRole('status', { name: COPY.newSearch.estimateRegion });
    await waitFor(() => expect(region).toHaveTextContent('the rest next Monday'));
    await user.click(screen.getByRole('button', { name: /^Search( · .+)?$/ }));
    await screen.findByText(COPY.repeatWeekly.overBudget);
    await user.selectOptions(screen.getByLabelText(COPY.newSearch.repeat), 'other');
    expect(screen.getByText(/set it up in/)).toBeInTheDocument();
    const words = mainPathWords();
    expect(jargonIn(words)).toEqual([]);
    expect(PANEL_WORDS.filter(([, re]) => re.test(words)).map(([w]) => w)).toEqual([]);
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it('view=dates, Task 10: the three folds open, with a thin-coverage line, an alert rule and email not set up', async () => {
    server.use(
      serveDates({ discoveryProviders: ['travelpayouts'] }),
      serveCards([
        searchCard({
          latestRun: latestRun({
            datePairs: 100,
            datePairsSearched: 90,
            datePairsNeverSearched: 5,
            marks: {
              priced: 10,
              'no-price-shown': 80,
              'couldnt-read': 0,
              'not-reached': 5,
              'not-searched': 5,
            },
          }),
        }),
      ]),
      http.get(`${API}/alerts`, () =>
        HttpResponse.json([
          {
            id: 'r1',
            definitionId: 'def-0001',
            type: 'absolute',
            thresholdPence: 45_000,
            pct: null,
            basis: 'calendar',
            requireAllVerified: null,
            cooldownHours: 336,
            enabled: true,
          },
        ]),
      ),
      http.get(`${API}/status`, () =>
        HttpResponse.json(
          statusReport([
            { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'no email' },
          ]),
        ),
      ),
    );
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    await screen.findByRole('region', { name: COPY.searchPage.folds.groupLabel });
    await screen.findByText(COPY.searchPage.folds.emailNotSet);
    await screen.findByText(COPY.searchPage.folds.thin);
    for (const d of document.querySelectorAll('details.sfold')) d.setAttribute('open', '');
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
    expect(jargonIn(mainPathWords())).toEqual([]);
    expect(renderedCopy()).not.toMatch(/\bbasis\b/i);
  });
});
