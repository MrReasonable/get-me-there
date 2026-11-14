import { apiContract } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import {
  at,
  calendarFig,
  type DatesOptions,
  datesResponse,
  figurePairing,
  pairingFig,
  provGrid,
} from '../test/fixtures.dates.js';
import { cardsResponse, cheapest, flightListProvenance, searchCard } from '../test/fixtures.searches.js';
import { FIXTURE_SEARCH, TRIP_NOW } from './tripFixtures.js';

// Design 2026-11-08 §5.1, §5.3 (trip-page plan Task 8): the search page's rows and the Trips page's cards in a real
// layout, at 375 px and 1280 px, light and dark, with the longest seller name: nothing scrolls sideways, a row's label
// opens in the flow, and a price is a link only where it can be booked. The date-pairs and cards reads are served by
// route interception (the fixture provider reads no flights); the search is the one the smoke made.

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

/** The board's body: a seller's price with a booking page and the longest seller name, Google's price with none, a calendar price. */
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
  },
};

async function openSearch(page: Page, width: number, scheme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.clock.setFixedTime(TRIP_NOW);
  const body = JSON.stringify(apiContract.datePairsResponseSchema.parse(datesResponse(BOARD)));
  await page.route(`**/api/definitions/${id}/date-pairs*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
  await page.goto(`/?view=dates&def=${id}`);
  await expect(page.locator('tr[data-pair]').first()).toBeVisible();
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
    cheapest: cheapest(
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
  });
  const body = JSON.stringify(apiContract.searchCardsResponseSchema.parse(cardsResponse([card])));
  await page.route('**/api/definitions/cards', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
  await page.goto('/?view=searches');
  await expect(page.getByTestId('card-trip-price')).toBeVisible();
}

const noSidewaysScroll = async (page: Page) => {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
};

for (const width of WIDTHS)
  for (const scheme of SCHEMES) {
    test(`the search page at ${width}px, ${scheme}: no sideways scroll, a link only where it can be booked`, async ({
      page,
    }) => {
      await openSearch(page, width, scheme);
      const rows = page.locator('tr[data-pair]');
      await expect(rows).toHaveCount(3);
      const out = (n: number) => rows.nth(n).locator('a[target="_blank"]');
      await expect(out(0)).toHaveCount(1);
      await expect(out(0)).toHaveAttribute('href', SYNTHETIC_BOOKING_URL);
      await expect(out(1)).toHaveCount(1);
      await expect(out(2)).toHaveCount(0);
      await noSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/links-shots/search-${width}-${scheme}.png`,
        fullPage: true,
      });
    });

    test(`the Trips page at ${width}px, ${scheme}: the price opens its trip, no sideways scroll`, async ({
      page,
    }) => {
      await openTrips(page, width, scheme);
      await noSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/links-shots/trips-${width}-${scheme}.png`,
        fullPage: true,
      });
      await page.getByTestId('card-trip-price').click();
      await expect(page).toHaveURL(/view=trip.*depart=2027-03-14/);
    });
  }

for (const width of WIDTHS)
  test(`a row's label opens in the flow at ${width}px, pushing the rows below it down`, async ({ page }) => {
    await openSearch(page, width, 'light');
    const rows = page.locator('tr[data-pair]');
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
    await noSidewaysScroll(page);
    await page.screenshot({
      path: `test-results/links-shots/search-${width}-light-label-open.png`,
      fullPage: true,
    });
  });
