import { apiContract } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import {
  at,
  bucketsOf,
  calendarFig,
  type DatesOptions,
  datesResponse,
  figurePairing,
  pairingFig,
  provCached,
  provGrid,
  provSearched,
  verifiedFig,
} from '../test/fixtures.dates.js';
import { execution } from '../test/fixtures.js';
import { cardsResponse, cardTrip, flightListProvenance, searchCard } from '../test/fixtures.searches.js';
import { expectNoSidewaysScroll } from './layout.js';
import { SMOKE } from './selectors.js';
import { FIXTURE_SEARCH, TRIP_NOW } from './tripFixtures.js';

// Design 2026-11-08 §5.1–§5.3 (trip-page plan Task 8; Trips and Search Task 8): the Search page's sections and the Trips
// page's cards in a real layout, at 375 px and 1280 px, light and dark, with the longest seller name: nothing scrolls
// sideways, a row's label opens in the flow, and a price is a link only where it can be booked. The date-pairs, run and
// cards reads are served by route interception (the fixture provider reads no flights); the search is the one the smoke
// made.

const ids = z.array(z.object({ id: z.string() }));
async function searchId(request: APIRequestContext): Promise<string> {
  const [first] = ids.parse(await (await request.get('/api/definitions')).json());
  if (first !== undefined) return first.id;
  const saved = await request.post('/api/definitions', {
    data: FIXTURE_SEARCH,
    headers: { 'X-Requested-With': 'get-me-there' },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  return z.object({ id: z.string() }).parse(await saved.json()).id;
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
