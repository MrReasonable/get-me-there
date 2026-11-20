import { apiContract } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import { type APIRequestContext, expect, type Page, type Route, test } from '@playwright/test';
import { z } from 'zod';
import { COPY } from '../src/copy.js';
import {
  at,
  bucketsOf,
  calendarFig,
  DATES_SPACE,
  type DatesOptions,
  datesResponse,
  figurePairing,
  pairingFig,
  provCached,
  provGrid,
  provSearched,
  runSummary,
  verifiedFig,
} from '../test/fixtures.dates.js';
import { coverageResponse, execution, statusReport } from '../test/fixtures.js';
import {
  cardsResponse,
  cardTrip,
  flightListProvenance,
  latestRun,
  searchCard,
} from '../test/fixtures.searches.js';
import { cellAt, fetchPoint, routeHistory } from '../test/fixtures.wp10.js';
import { expectNoSidewaysScroll } from './layout.js';
import { SMOKE } from './selectors.js';
import { FIXTURE_SEARCH, TRIP_NOW } from './tripFixtures.js';

// Design 2026-11-08 §5.1–§5.3 (trip-page plan Task 8; Trips and Search Tasks 8 and 9): the Search page's sections, its
// day panel and the Trips page's cards in a real layout, at 375 px and 1280 px, light and dark, with the longest seller
// name: nothing scrolls sideways, a row's label opens in the flow, and a price is a link only where it can be booked.
// The date-pairs, run and cards reads are served by route interception (the fixture provider reads no flights) for a
// search of this spec's own whose window and stays are the served data's.

/**
 * The search these pages are drawn for (Task 9 fix round 1, ruling): its window and stay range are exactly the served
 * date pairs' (DATES_SPACE: leave 14 Mar – 13 Apr 2027, 10–12 nights, LHR → JFK), so the page's header, leads and rows
 * agree. Found by name, else saved, so the smoke's own search (14–15 Mar, 10–11 nights) is never the one drawn here.
 */
const LAYOUT_SEARCH = {
  ...FIXTURE_SEARCH,
  name: 'London → New York (Search page layout)',
  window: { kind: 'absolute', from: DATES_SPACE.departureFrom, to: DATES_SPACE.departureTo },
  minNights: DATES_SPACE.minNights,
  maxNights: DATES_SPACE.maxNights,
};
const saved = z.array(z.object({ id: z.string(), name: z.string() }));
async function searchId(request: APIRequestContext): Promise<string> {
  const mine = saved
    .parse(await (await request.get('/api/definitions')).json())
    .find((d) => d.name === LAYOUT_SEARCH.name);
  if (mine !== undefined) return mine.id;
  const created = await request.post('/api/definitions', {
    data: LAYOUT_SEARCH,
    headers: { 'X-Requested-With': 'get-me-there' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return z.object({ id: z.string() }).parse(await created.json()).id;
}

let id = '';
test.beforeAll(async ({ request }) => {
  id = await searchId(request);
});

const WIDTHS = [375, 1280] as const;
const SCHEMES = ['light', 'dark'] as const;
const LONG_SELLER = 'Trip.com Travel Singapore Pte Ltd';

/** The page's body: a seller's price with a booking page and the longest seller name, Google's price with none, a calendar price. */
const BOARD: DatesOptions = {
  origins: ['LHR'],
  destinations: ['JFK'],
  discoveryProviders: ['camoufox'],
  pairs: {
    [at('2027-03-14', 10)]: {
      figure: pairingFig({
        pairing: figurePairing({ seller: LONG_SELLER, bookingUrl: SYNTHETIC_BOOKING_URL }),
      }),
    },
    [at('2027-03-15', 10)]: {
      figure: pairingFig({
        pairing: figurePairing({ isFrom: true, seller: null, offersRead: 0, complete: false }),
      }),
    },
    [at('2027-03-16', 10)]: {
      figure: calendarFig({ price: { ...calendarFig().price, provenance: provGrid(), ageHours: 3 } }),
    },
    // final review C1: a stale verified price with an older read trip beneath it, that trip's booking page recorded:
    // the row links the verified price's own search, never that booking page
    [at('2027-03-17', 10)]: {
      figure: verifiedFig({
        price: {
          pricePence: 60_000,
          provenance: provSearched(),
          stale: 'setting',
          ageHours: 80,
          truncated: false,
        },
        pairing: figurePairing({ stale: 'refresh', ageHours: 72, bookingUrl: SYNTHETIC_BOOKING_URL }),
        pairingRead: 'within-older',
      }),
    },
  },
};

/** The page's rows, trips then lower calendar dates, as the eye reads them down the page. */
const pageRows = (page: Page) => page.locator(`${SMOKE.tripRow}, ${SMOKE.calendarRow}`);

/**
 * The flight lists of the dates Lower on the calendar asks about, in the api's shape: none read yet, each one a read
 * would go for now, so its rows offer Read flights (the fixture provider reads no flight lists itself).
 */
async function serveReadable(page: Page) {
  await page.route(`**/api/definitions/${id}/flight-lists*`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const asked = (new URL(route.request().url()).searchParams.get('pairs') ?? '').split(',').filter(Boolean);
    const pairs = asked.map((key) => {
      const [departureDate = '', returnDate = ''] = key.split('_');
      return {
        departureDate,
        returnDate,
        origin: 'LHR',
        destination: 'JFK',
        link: null,
        list: null,
        listOtherPair: null,
        readNow: true,
      };
    });
    const body = apiContract.flightListsResponseSchema.parse({
      available: true,
      unavailableReason: null,
      refreshHours: 24,
      pagesPlanned: 2,
      reading: null,
      pairs,
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function openSearch(
  page: Page,
  width: number,
  scheme: 'light' | 'dark',
  options: DatesOptions = BOARD,
) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.clock.setFixedTime(TRIP_NOW);
  const body = JSON.stringify(apiContract.datePairsResponseSchema.parse(datesResponse(options)));
  await page.route(`**/api/definitions/${id}/date-pairs*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
  // why: the run the served read names, finished, with how reading flights ended (Ruling 22's stopping sentence)
  const run = JSON.stringify(
    apiContract.executionResponseSchema.parse(
      execution({
        definitionId: id,
        status: 'completed',
        stage: null,
        startedAt: '2026-10-14T12:00:00.000Z',
        finishedAt: '2026-10-14T12:22:00.000Z',
        flights: {
          planned: 17,
          read: 17,
          reused: 0,
          failed: 0,
          ended: null,
          confirm: { mode: 'confirm', confirmed: 5, unread: 0, uncheckedCheaper: 0, stop: 'patience' },
          stopCause: null,
        },
      }),
    ),
  );
  await page.route('**/api/executions/exec-0001', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: run }),
  );
  await page.goto(`/?view=dates&def=${id}`);
  await expect(pageRows(page).first()).toBeVisible();
}

/**
 * Mockup 02's page in the fixture's shapes, on the smoke's one airport pair: seven trips with flights read (a seller's
 * price, Google's price, two airlines a leg), and five calendar prices below the cheapest of them, from the date grid
 * and the Aviasales cache.
 */
const MOCKUP: DatesOptions = {
  origins: ['LHR'],
  destinations: ['JFK'],
  discoveryProviders: ['camoufox', 'travelpayouts'],
  // why: the other dates answered with no cached data, so the run line counts a searched window
  rest: { no_data: 1 },
  pairs: {
    ...Object.fromEntries(
      [41_200, 43_600, 44_800, 45_500, 47_100, 48_800, 49_900].map((pence, i) => [
        at(`2027-03-${String(14 + i * 2).padStart(2, '0')}`, 10 + (i % 3)),
        {
          buckets: bucketsOf({ priced: 1 }, 1),
          figure: pairingFig({
            pairing: figurePairing({
              pricePence: pence,
              fromPence: pence,
              ...(i === 4 ? { isFrom: true, seller: null, offersRead: 0, complete: false } : {}),
              legs: {
                out: { durationMinutes: 640, stops: 1, carriers: ['Aer Lingus'], arrivesDayOffset: 0 },
                back: {
                  durationMinutes: 415,
                  stops: 0,
                  carriers: i % 2 === 0 ? ['Virgin Atlantic'] : ['British Airways', 'American Airlines'],
                  arrivesDayOffset: 1,
                },
              },
            }),
            price: { ...pairingFig().price, pricePence: pence, ageHours: 3 },
          }),
        },
      ]),
    ),
    ...Object.fromEntries(
      [37_200, 37_600, 38_100, 39_000, 40_100].map((pence, i) => [
        at(`2027-03-${String(15 + i * 2).padStart(2, '0')}`, 10),
        {
          buckets: bucketsOf({ priced: 1 }, 1),
          figure: calendarFig({
            price: {
              ...calendarFig().price,
              pricePence: pence,
              provenance: i === 2 ? provCached() : provGrid(),
              ageHours: i === 2 ? 48 : 3,
            },
          }),
        },
      ]),
    ),
  },
};

/** Seven of this search's runs, newest first, as the served date pairs list them (Ruling 19's Price over time). */
const RUNS = [1, 2, 3, 4, 5, 6, 7].map((k) => ({ id: `exec-000${k}`, hours: k * 24 }));
const FOLDS_BOARD: DatesOptions = {
  ...MOCKUP,
  executions: RUNS.map((r) => runSummary({ id: r.id, ageHours: r.hours })),
};

/**
 * The reads behind the three folds (Ruling 19), served for this search: its card with the latest run's marks over 2,184
 * dates (priced, no price listed, couldn't read, not reached, not searched, so every row has a count), the route history
 * with a point for each of the seven runs and one of another search's, two alert rules and a status report that says
 * email isn't set up, and the coverage the full search log reads.
 */
async function serveFolds(page: Page) {
  const json = (body: unknown) => (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const marks = {
    priced: 2146,
    'no-price-shown': 20,
    'couldnt-read': 10,
    'not-reached': 6,
    'not-searched': 2,
  };
  await page.route(
    '**/api/definitions/cards',
    json(
      apiContract.searchCardsResponseSchema.parse(
        cardsResponse([
          searchCard({
            id,
            latestRun: latestRun({
              datePairs: 2184,
              datePairsSearched: 2166,
              datePairsNeverSearched: 2,
              marks,
            }),
          }),
        ]),
      ),
    ),
  );
  const cell = cellAt('2027-03-14', 10);
  await page.route(
    '**/api/routes/*/*/history*',
    json(
      routeHistory({
        calendarSeries: [
          {
            providerId: 'travelpayouts',
            cabin: 'economy',
            points: [
              ...RUNS.map((r, i) =>
                fetchPoint(r.hours, 37_200 + i * 100, cell, { executionId: r.id, truncated: i === 1 }),
              ),
              fetchPoint(12, 100, cell, { executionId: 'another-search' }),
            ],
          },
        ],
      }),
    ),
  );
  const rule = (n: number, over: Record<string, unknown>) => ({
    id: `rule-${n}`,
    definitionId: id,
    type: 'absolute',
    thresholdPence: 45_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
    // settings plan R13: GET /alerts says when each rule last sent
    lastSentAt: null,
    ...over,
  });
  await page.route(
    '**/api/alerts?*',
    json([
      rule(1, {}),
      rule(2, {
        type: 'dropPct',
        thresholdPence: null,
        pct: 10,
        basis: 'verified',
        requireAllVerified: true,
      }),
    ]),
  );
  await page.route(
    '**/api/status',
    json(
      statusReport([
        { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'email is not set up' },
      ]),
    ),
  );
  await page.route(`**/api/definitions/${id}/coverage*`, json(coverageResponse()));
}

/** The three fold summaries, in order. */
const foldSummaries = (page: Page) =>
  page.getByRole('region', { name: SMOKE.folds }).locator('.sfold > summary');

/** Opens each fold by pressing its summary, as a person does. */
async function openFolds(page: Page) {
  const summaries = foldSummaries(page);
  await expect(summaries).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) await summaries.nth(i).click();
  await expect(page.locator('.search-folds .sfold[open]')).toHaveCount(3);
}

/**
 * The parts of the open folds whose content is wider than their box (a wrapped line that still spills), or that lie
 * beyond the window's right edge outside a region that scrolls itself, as "tag.class: scroll > client".
 */
async function overflowingFolds(page: Page): Promise<string[]> {
  return page.locator('.search-folds').evaluate((group) => {
    const out: string[] = [];
    for (const el of group.querySelectorAll(
      '.sfold-body, .sfold > summary, .sfold-run, .sfold-rules li, td, th',
    )) {
      if (el.scrollWidth > el.clientWidth + 1)
        out.push(`${el.tagName}.${el.className}: ${el.scrollWidth} > ${el.clientWidth}`);
    }
    for (const el of group.querySelectorAll('*')) {
      if (el.closest('.overflow-x-auto') !== null) continue;
      if (el.getBoundingClientRect().right > window.innerWidth + 0.5)
        out.push(`${el.tagName}.${el.className} past the window`);
    }
    return out;
  });
}

async function openTrips(page: Page, width: number, scheme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.clock.setFixedTime(TRIP_NOW);
  const card = searchCard({
    id,
    name: `London → New York, ${LONG_SELLER} fares`,
    origins: ['LHR'],
    destinations: ['JFK'],
    trips: [
      cardTrip(
        {
          basis: 'pairing',
          priceKind: 'seller',
          pricePence: 118_000,
          origin: 'LHR',
          destination: 'JFK',
          departureDate: '2027-03-14',
          returnDate: '2027-03-24',
        },
        flightListProvenance('2026-10-14T12:00:00.000Z'),
      ),
    ],
  });
  const body = JSON.stringify(apiContract.searchCardsResponseSchema.parse(cardsResponse([card])));
  await page.route('**/api/definitions/cards', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
  await page.goto('/?view=searches');
  await expect(page.getByTestId('trip-row')).toBeVisible();
}

for (const width of WIDTHS)
  for (const scheme of SCHEMES) {
    test(`the search page at ${width}px, ${scheme}: no sideways scroll, a link only where it can be booked`, async ({
      page,
    }) => {
      await openSearch(page, width, scheme);
      const rows = pageRows(page);
      // three trips (two read, one verified), then the calendar price below them
      await expect(page.locator(SMOKE.tripRow)).toHaveCount(3);
      await expect(page.locator(SMOKE.calendarRow)).toHaveCount(1);
      const out = (n: number) => rows.nth(n).locator('a[target="_blank"]');
      // the verified trip (£600) is the cheapest: it says "Find", to its own search, never the older trip's booking page
      const verified = page.locator(`${SMOKE.tripRow} a[target="_blank"]`, { hasText: '£600' });
      await expect(verified).toHaveCount(1);
      await expect(verified).toContainText('Find on Google Flights');
      await expect(verified).not.toHaveAttribute('href', SYNTHETIC_BOOKING_URL);
      const booked = page.locator(`${SMOKE.tripRow} a[target="_blank"][href="${SYNTHETIC_BOOKING_URL}"]`);
      await expect(booked).toHaveCount(1);
      await expect(out(2)).toHaveCount(1);
      // the calendar price is no link
      await expect(page.locator(SMOKE.calendarRow).locator('a[target="_blank"]')).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/links-shots/search-${width}-${scheme}.png`,
        fullPage: true,
      });
    });

    test(`the search page as mockup 02 at ${width}px, ${scheme}: header, filter row, both sections, no sideways scroll`, async ({
      page,
    }) => {
      await serveReadable(page);
      await openSearch(page, width, scheme, MOCKUP);
      const trips = page.getByRole('region', { name: SMOKE.cheapestTrips });
      await expect(trips.locator(SMOKE.tripRow)).toHaveCount(5);
      await expect(trips).toContainText('nothing cheaper than these five.');
      await expect(trips.getByRole('button', { name: 'Show 2 more' })).toBeVisible();
      const lower = page.getByRole('region', { name: SMOKE.lowerOnCalendar });
      await expect(lower.locator(SMOKE.calendarRow)).toHaveCount(3);
      await expect(lower).toContainText('5 dates in all.');
      // each lower date offers Read flights, a 44 px target at every width
      const read = lower.getByRole('button', { name: /^Read flights for / });
      await expect(read).toHaveCount(3);
      expect((await read.first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.locator(SMOKE.runLine)).toContainText('calendar prices for');
      // fix round 1 (B): where the booking words show (≥720 px) they sit on one line with their arrow
      if (width >= 720) {
        const lines = await trips
          .locator('.book-words')
          .evaluateAll((all) => all.map((w) => w.getClientRects().length));
        expect(lines.length).toBeGreaterThan(0);
        expect(
          lines.every((n) => n === 1),
          JSON.stringify(lines),
        ).toBe(true);
      }
      // fix round 1 (D): a lower date's price is bold in the body ink, never a link
      const price = lower.locator(SMOKE.calendarRow).first().locator('.book-price');
      await expect(price.locator('a')).toHaveCount(0);
      const look = await price.evaluate((el) => {
        const row = el.closest('.trip-row');
        return {
          weight: Number(getComputedStyle(el).fontWeight),
          color: getComputedStyle(el).color,
          ink: row === null ? '' : getComputedStyle(row).color,
        };
      });
      expect(look.weight).toBeGreaterThanOrEqual(600);
      expect(look.color).toBe(look.ink);
      // each row's box stays inside the window, at every width
      for (const row of await page.locator(`${SMOKE.tripRow}, ${SMOKE.calendarRow}`).all()) {
        const box = await row.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/search-shots/search-${width}-${scheme}.png`,
        fullPage: true,
      });

      // Task 9 (Ruling 18): a day's panel below the calendar, its rows inside the window, nothing sideways
      await page.locator(`${SMOKE.calendarDay}[data-day="2027-03-14"]`).click();
      const day = page.getByRole('region', { name: SMOKE.dayPanel });
      await expect(day).toHaveAccessibleName('Sun 14 Mar: 3 stays');
      await expect(day.locator(SMOKE.tripRow)).toHaveCount(1);
      await expect(day.locator(SMOKE.calendarRow)).toHaveCount(2);
      for (const row of await day.locator(`${SMOKE.tripRow}, ${SMOKE.calendarRow}`).all()) {
        const box = await row.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }
      expect(await overflowingRows(page)).toEqual([]);
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/search-shots/search-day-${width}-${scheme}.png`,
        fullPage: true,
      });
    });

    test(`the three folds at ${width}px, ${scheme}: closed they hold one line each, open they fit, nothing sideways`, async ({
      page,
    }) => {
      await serveReadable(page);
      await serveFolds(page);
      await openSearch(page, width, scheme, FOLDS_BOARD);
      const group = page.getByRole('region', { name: SMOKE.folds });
      await group.scrollIntoViewIfNeeded();
      const summaries = foldSummaries(page);
      await expect(summaries).toHaveCount(3);
      // closed by default, each summary its name and its one-line state
      await expect(page.locator('.search-folds .sfold[open]')).toHaveCount(0);
      await expect(summaries.nth(0)).toContainText('Price over time · lowest calendar price £372');
      await expect(summaries.nth(1)).toContainText('What was searched · 2,146 of 2,184 dates priced, 38 not');
      await expect(summaries.nth(2)).toContainText('Alert · 2 on');
      // one bordered box with single dividers: the group has the only outer border, each later row one top rule
      const rules = await page
        .locator('.search-folds > .sfold')
        .evaluateAll((all) => all.map((d) => getComputedStyle(d).borderTopWidth));
      expect(rules).toEqual(['0px', '1px', '1px']);
      expect(await group.evaluate((g) => getComputedStyle(g).borderTopWidth)).toBe('1px');
      await group.screenshot({ path: `test-results/folds-shots/folds-closed-${width}-${scheme}.png` });
      // a closed fold's content is out of the tab order: Tab from a summary reaches the next summary
      await summaries.nth(0).focus();
      await page.keyboard.press('Tab');
      await expect(summaries.nth(1)).toBeFocused();
      await expect(summaries.nth(0)).toHaveCSS('min-height', '44px');
      await openFolds(page);
      // Price over time: six of the seven runs, newest first, the other search's point left out
      await expect(page.locator('.sfold-runs > li')).toHaveCount(6);
      await expect(page.locator('.sfold-runs')).not.toContainText('£1 ');
      // What was searched: six rows, then the full search log inside it
      await expect(page.locator('.sfold-table tr')).toHaveCount(6);
      await page.getByRole('button', { name: SMOKE.fullLog }).click();
      await expect(page.getByRole('table', { name: COPY.coverageHeading })).toBeVisible();
      // Task 10 re-review: the log's cells are ruled as the fold's own rows (a line under each), with no boxed column
      const sides = await page
        .getByRole('table', { name: COPY.coverageHeading })
        .locator('th, td')
        .evaluateAll((cells) =>
          cells.flatMap((c) => {
            const s = getComputedStyle(c);
            return [s.borderLeftWidth, s.borderRightWidth, s.borderTopWidth];
          }),
        );
      expect(new Set(sides)).toEqual(new Set(['0px']));
      // Alert: both rules in words, and email not set up
      await expect(page.locator('.sfold-rules > li')).toHaveCount(2);
      await expect(page.getByText(COPY.searchPage.folds.emailNotSet)).toBeVisible();
      expect(await overflowingFolds(page)).toEqual([]);
      for (const box of await group.locator('.sfold').all()) {
        const b = await box.boundingBox();
        expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(width);
      }
      await expectNoSidewaysScroll(page);
      // the group alone, to set beside mockup 02's three rows
      await group.screenshot({ path: `test-results/folds-shots/folds-open-${width}-${scheme}.png` });
    });

    test(`the Trips page at ${width}px, ${scheme}: a trip's › opens its page, no sideways scroll`, async ({
      page,
    }) => {
      await openTrips(page, width, scheme);
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/links-shots/trips-${width}-${scheme}.png`,
        fullPage: true,
      });
      await page
        .getByTestId('trip-row')
        .getByRole('link', { name: /^Details for/ })
        .click();
      await expect(page).toHaveURL(/view=trip.*depart=2027-03-14/);
    });
  }

/** Task 8 fix round 2: the widths around the rows' container switch (720 px of list) and the panel's (900 px). */
const SWEEP = [720, 750, 755, 760, 770, 780, 800, 900, 1024] as const;

/** Every trip and calendar row on the page whose content is wider than its box, as "width: scroll > client". */
async function overflowingRows(page: Page): Promise<string[]> {
  return page
    .locator('.trip-row')
    .evaluateAll((rows) =>
      rows.filter((r) => r.scrollWidth > r.clientWidth).map((r) => `${r.scrollWidth} > ${r.clientWidth}`),
    );
}

test('the search page fits every trip row in its box at each width from 720 to 1024 px, a day panel open', async ({
  page,
}) => {
  await serveReadable(page);
  await serveFolds(page);
  await openSearch(page, SWEEP[0], 'light', FOLDS_BOARD);
  // Task 9: the day panel's trip and calendar rows are swept with the sections'
  await page.locator(`${SMOKE.calendarDay}[data-day="2027-03-14"]`).click();
  await expect(page.getByRole('region', { name: SMOKE.dayPanel }).locator(SMOKE.tripRow)).toHaveCount(1);
  // Task 10: the three folds open, with the full search log, swept with them
  await openFolds(page);
  await page.getByRole('button', { name: SMOKE.fullLog }).click();
  await expect(page.getByRole('table', { name: COPY.coverageHeading })).toBeVisible();
  for (const width of SWEEP) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(SMOKE.tripRow).first()).toBeVisible();
    expect(await overflowingRows(page), `${width}px`).toEqual([]);
    expect(await overflowingFolds(page), `the folds at ${width}px`).toEqual([]);
    await expectNoSidewaysScroll(page);
  }
});

test('the Trips page fits every trip row in its box at each width from 720 to 1024 px', async ({ page }) => {
  await openTrips(page, SWEEP[0], 'light');
  for (const width of SWEEP) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('trip-row').first()).toBeVisible();
    expect(await overflowingRows(page), `${width}px`).toEqual([]);
    await expectNoSidewaysScroll(page);
  }
});

for (const width of WIDTHS)
  test(`a row's label opens in the flow at ${width}px, pushing the rows below it down`, async ({ page }) => {
    await openSearch(page, width, 'light');
    const rows = pageRows(page);
    const next = rows.nth(1);
    const top = (el: typeof next) => el.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
    const before = await top(next);
    const label = rows.nth(0).getByTestId('price-label');
    await label.locator('summary').click();
    await expect(label).toHaveAttribute('open', '');
    const pop = await label
      .locator('.price-label-pop')
      .evaluate((e) => e.getBoundingClientRect().bottom + window.scrollY);
    const after = await top(next);
    // why: the detail is in the row: the next row moved down by it, and the detail lies above the next row, covering nothing
    expect(after - before).toBeGreaterThan(0);
    expect(pop).toBeLessThanOrEqual(after + 1);
    // a tap on the label does not open the trip
    expect(page.url()).toContain('view=dates');
    await expectNoSidewaysScroll(page);
    await page.screenshot({
      path: `test-results/links-shots/search-${width}-light-label-open.png`,
      fullPage: true,
    });
  });
