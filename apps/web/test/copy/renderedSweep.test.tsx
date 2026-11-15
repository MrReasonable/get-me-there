import { asIsoDate, asIsoDateTime, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { PAIRING_FIXTURE } from '@gmt/core/testing';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, onTestFinished } from 'vitest';
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
  calendarGap,
  calendarRow,
  execution,
  failedRow,
  partialRow,
  providersResponse,
  resultsResponse,
  statusReport,
  usage,
  verifiedRow,
} from '../fixtures.js';
import { flightPair, latestRun, pairingList, searchCard } from '../fixtures.searches.js';
import { readTrip, tripBody } from '../fixtures.trip.js';
import { poundsOutsidePrices, renderedCopy } from '../guards.js';
import { serveDates } from '../msw/datesHandlers.js';
import { serveCards, serveFlightLists } from '../msw/searchesHandlers.js';
import { server } from '../msw/server.js';
import { drawn, renderWithProviders } from '../render.js';
import { jargonIn, mainPathWords } from '../views/dates/jargon.js';
import { autoOpenFlights } from '../views/dates/render.js';

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
  dates: () => screen.findByRole('table', { name: /^Best dates/ }),
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
        http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(calendarGap())),
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
  it('the health line with problems, SearchApi’s calls left, the spend and a running search', async () => {
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
    await screen.findByText('SearchApi: 51 of 100 calls left this month');
    await screen.findByText('Spent £32 of £35 this month');
    await screen.findByRole('link', { name: 'Searching: Worked example' });
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(jargonIn(mainPathWords())).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
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

describe('a search\'s page with the return leg says no banned word, no set-up term, no "£" outside a price (Task 21.7)', () => {
  it('view=dates: a pairing figure, a calendar figure with its pairing beneath, the pairing section', async () => {
    const board: DatesOptions = {
      discoveryProviders: ['travelpayouts', 'camoufox'],
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(
          pairingFig({
            pairing: figurePairing({ pricePence: 119_500, mismatch: true }),
            price: { ...pairingFig().price, pricePence: 119_500 },
          }),
        ),
        [at('2027-03-15', 10)]: pricedPair(
          calendarFig({
            price: { ...calendarFig().price, pricePence: 130_000, provenance: provCached() },
            pairingRead: 'offers-incomplete',
            pairing: figurePairing({
              isFrom: true,
              seller: null,
              fare: null,
              complete: false,
              offersRead: 2,
            }),
          }),
        ),
        [at('2027-03-16', 10)]: pricedPair(
          calendarFig({
            price: { ...calendarFig().price, pricePence: 131_000, provenance: provCached() },
            pairingRead: 'list-failed',
            listReason: 'network',
          }),
        ),
      },
    };
    server.use(
      serveDates(board),
      serveFlightLists(
        (d, r) =>
          flightPair(
            d,
            r,
            d === '2027-03-14'
              ? {
                  list: pairingList({
                    returns: {
                      ...PAIRING_FIXTURE.returns,
                      booking:
                        PAIRING_FIXTURE.returns.booking === null
                          ? null
                          : {
                              ...PAIRING_FIXTURE.returns.booking,
                              moreControl: true,
                              offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }],
                            },
                    },
                  }),
                }
              : {},
          ),
        { pagesPlanned: 2 },
      ),
    );
    // why: design 2026-11-08 §5.3 — rows are closed by default; the sweep reads their opened detail too
    const stopOpening = autoOpenFlights();
    onTestFinished(stopOpening);
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    await screen.findByRole('table', { name: /^Best dates/ });
    await waitFor(() => expect(document.querySelector('[data-testid="flights-pairing"]')).not.toBeNull());
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
    expect(jargonIn(mainPathWords())).toEqual([]);
    // why: design 2026-11-08 §4.1: "not every seller read" is the one allowed use of the phrase (a negation)
    expect(renderedCopy().replace(/not every seller read/gi, '')).not.toMatch(
      /each seller|every seller|verified/i,
    );
  });
});
