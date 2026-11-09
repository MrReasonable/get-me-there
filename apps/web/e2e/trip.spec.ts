import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { COPY } from '../src/copy.js';
import { SMOKE } from './selectors.js';
import { serveTrip, TRIP_DEPART, TRIP_RETURN, type TripState } from './tripFixtures.js';

// Design 2026-11-08 §6.1, §6.5 (trip-page plan Task 7): the Trip page in a real layout, at 375 px and 1280 px, light and
// dark, for its main states and the longest seller and airline list (Review Focus 5): nothing scrolls sideways, and the
// keyboard reaches the booking link, the label and both folds. The trip read is served by route interception (the
// fixture provider reads no flights); the search is the one the smoke made.

/** The id of the smoke's search, read from the api. */
async function searchId(page: Page): Promise<string> {
  const res = await page.request.get('/api/definitions');
  const [first] = z.array(z.object({ id: z.string() })).parse(await res.json());
  if (first === undefined) throw new Error('the smoke search was not created');
  return first.id;
}

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
  const id = await searchId(page);
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
