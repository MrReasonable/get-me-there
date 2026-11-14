import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { COPY } from '../src/copy.js';
import { SMOKE } from './selectors.js';
import {
  FIXTURE_SEARCH,
  serveTrip,
  TRIP_DEPART,
  TRIP_NOW,
  TRIP_RETURN,
  type TripState,
} from './tripFixtures.js';

// Design 2026-11-08 §6.1, §6.5 (trip-page plan Task 7): the Trip page in a real layout, at 375 px and 1280 px, light and
// dark, for its main states and the longest seller and airline list (Review Focus 5): nothing scrolls sideways, and the
// keyboard reaches the booking link, the label and both folds. The trip read is served by route interception (the
// fixture provider reads no flights); the search is the one the smoke made.

const ids = z.array(z.object({ id: z.string() }));

/** A search to open the Trip page of: the smoke's when it ran first, else one saved here (the spec runs on its own). */
async function searchId(request: APIRequestContext): Promise<string> {
  const [first] = ids.parse(await (await request.get('/api/definitions')).json());
  if (first !== undefined) return first.id;
  // why: the api refuses a change without the header its own client sends
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
const STATES: readonly TripState[] = [
  'trip',
  'calendar-only',
  'none-within',
  'outside-window',
  'long-seller',
];

async function open(page: Page, state: TripState, width: number, scheme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme });
  // why: the fixtures were read 3 h before TRIP_NOW, so the labels' ages and the details' ages agree
  await page.clock.setFixedTime(TRIP_NOW);
  await serveTrip(page, id, state);
  await page.goto(`/?view=trip&def=${id}&depart=${TRIP_DEPART}&return=${TRIP_RETURN}`);
  await expect(page.getByRole('region', { name: SMOKE.tripCard })).toBeVisible();
}

for (const width of WIDTHS)
  for (const scheme of SCHEMES)
    for (const state of STATES)
      test(`${state} at ${width}px, ${scheme}: no sideways scroll`, async ({ page }) => {
        await open(page, state, width, scheme);
        // why: every label and fold opened, so their details are measured in the page too; opened in the DOM, since an
        // open label's detail lies over the next label at desktop width (as a popover does) and would take its click
        await page.locator(`${SMOKE.tripPage} details`).evaluateAll((all) => {
          for (const d of all) if (d instanceof HTMLDetailsElement) d.open = true;
        });
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(scroll, `${state} ${width} ${scheme}`).toBeLessThanOrEqual(client);
        await page.screenshot({
          path: `test-results/trip-shots/${state}-${width}-${scheme}.png`,
          fullPage: true,
        });
      });

test('at 1280px one open label pushes the card down and covers nothing', async ({ page }) => {
  await open(page, 'trip', 1280, 'light');
  const card = page.getByRole('region', { name: SMOKE.tripCard });
  const seller = card.getByTestId('trip-seller');
  const before = await seller.boundingBox();
  await card.locator(SMOKE.priceLabel).click();
  await expect(card.getByTestId('price-label')).toHaveAttribute('open', '');
  const pop = await card.locator('.price-label-pop').boundingBox();
  const after = await seller.boundingBox();
  // the seller line moved down below the open detail, and the detail sits inside the card's price column
  expect((after?.y ?? 0) - (before?.y ?? 0)).toBeGreaterThan(0);
  expect((pop?.y ?? 0) + (pop?.height ?? 0)).toBeLessThanOrEqual(after?.y ?? 0);
  await page.screenshot({ path: 'test-results/trip-shots/trip-1280-light-label-open.png', fullPage: true });
});

test('Tab reaches the booking link, the label and both folds, and opens a label from the keyboard', async ({
  page,
}) => {
  await open(page, 'trip', 1280, 'light');
  const card = page.getByRole('region', { name: SMOKE.tripCard });
  const targets = [
    card.getByRole('link', { name: /Book on Google Flights/ }),
    card.locator(SMOKE.priceLabel),
    page.locator(SMOKE.aboutPrice),
    page.locator(SMOKE.searchLog),
  ];
  const reached: boolean[] = targets.map(() => false);
  // why: a bounded walk of the page's tab order, never a wait: each press moves focus once
  for (let i = 0; i < 80 && reached.includes(false); i += 1) {
    await page.keyboard.press('Tab');
    for (const [k, t] of targets.entries())
      if (!reached[k] && (await t.evaluate((el) => el === document.activeElement))) reached[k] = true;
  }
  expect(reached).toEqual([true, true, true, true]);
  await card.locator(SMOKE.priceLabel).focus();
  await page.keyboard.press('Enter');
  await expect(card.getByTestId('price-label')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(card.getByTestId('price-label')).not.toHaveAttribute('open', '');
  await expect(card.locator(SMOKE.priceLabel)).toBeFocused();
  // the booking link opens a new tab and says so
  await expect(card.getByRole('link', { name: /Book on Google Flights/ })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(card.getByRole('link', { name: /opens in a new tab/ })).toHaveCount(1);
  expect(COPY.trip.bookOnGoogle).toContain('↗');
});
