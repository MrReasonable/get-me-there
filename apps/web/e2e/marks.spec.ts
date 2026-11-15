import { expect, type Page, test } from '@playwright/test';
import { expectNoSidewaysScroll } from './layout.js';
import { PERF_DEFINITION_ID, type PerfCase, servePerfCase } from './perfFixtures.js';
import { SMOKE } from './selectors.js';

// Ruling 18 (Task 9), the calendar's days in a real layout (jsdom has no paint): a day not searched or not reached keeps
// its hatching, every day's price, words or glyph sit inside its box at 375 px and 1280 px, light and dark, and under
// forced colours every day keeps its edge (the hatching turns to a dashed one) and the key keeps its words. The smoke's
// fixture run prices every day, so this case is served through route interception with every other day unpriced.

/** Four weeks × 3 stays × the example's 4 airport pairs, every second day without a price, each in turn of its kind. */
const DAYS_CASE: PerfCase = {
  name: 'days of every kind',
  from: '2027-01-04',
  days: 28,
  minNights: 10,
  maxNights: 12,
  origins: ['LGW', 'LHR'],
  destinations: ['EWR', 'JFK'],
  everyPriced: true,
  unpricedDays: true,
};

async function open(page: Page) {
  await servePerfCase(page, DAYS_CASE);
  await page.goto(`/?view=dates&def=${PERF_DEFINITION_ID}`);
  await expect(page.locator(SMOKE.calendarTabStop)).toBeVisible();
}

/**
 * Every day whose content is wider or taller than its box, or whose printed price or words are cut (the printed part
 * clips its own overflow, so it is measured too), as its date.
 */
const spilled = (page: Page) =>
  page.locator(SMOKE.calendarDay).evaluateAll((days) =>
    days
      .filter((d) => {
        const printed = d.querySelector('.cal-dp');
        const over = (e: Element) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1;
        return over(d) || (printed !== null && over(printed));
      })
      .map((d) => d.getAttribute('data-day')),
  );

for (const width of [375, 1280] as const)
  for (const scheme of ['light', 'dark'] as const)
    test(`at ${width}px, ${scheme}: a day not searched or not reached is hatched, and every day's content fits its box`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      const hatched = page.locator(
        `${SMOKE.calendarDay}:is([data-mark="not-searched"], [data-mark="not-reached"])`,
      );
      await expect(hatched.first()).toBeVisible();
      await expect(hatched.first()).toHaveCSS('background-image', /repeating-linear-gradient/);
      // a day with no price says "no price", a day that couldn't be read prints its cross
      await expect(page.locator(`${SMOKE.calendarDay}[data-mark="no-price-shown"]`).first()).toHaveText(
        /no price$/,
      );
      await expect(page.locator(`${SMOKE.calendarDay}[data-mark="couldnt-read"]`).first()).toHaveText(/×$/);
      expect(await spilled(page)).toEqual([]);
      // why: a day is a touch target: at least 24 × 24 px at every width
      const small = await page
        .locator(SMOKE.calendarDay)
        .evaluateAll((days) =>
          days
            .filter((d) => d.getBoundingClientRect().width < 24 || d.getBoundingClientRect().height < 24)
            .map((d) => d.getAttribute('data-day')),
        );
      expect(small).toEqual([]);
      await expectNoSidewaysScroll(page);
    });

test('forced colours: every day keeps its edge, the hatching a dashed one, and the key its words', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await open(page);
  const edges = await page.locator(SMOKE.calendarDay).evaluateAll((days) =>
    days.map((d) => ({
      mark: d.getAttribute('data-mark'),
      style: getComputedStyle(d).borderTopStyle,
      width: getComputedStyle(d).borderTopWidth,
    })),
  );
  expect(edges.length).toBeGreaterThan(0);
  for (const e of edges) {
    expect(e.width, `${e.mark}`).not.toBe('0px');
    expect(e.style, `${e.mark}`).toBe(
      e.mark === 'not-searched' || e.mark === 'not-reached' ? 'dashed' : 'solid',
    );
  }
  const key = page.getByRole('list', { name: SMOKE.calendarKey }).getByRole('listitem');
  await expect(key).toHaveCount(5);
  for (const item of await key.all()) await expect(item).not.toHaveText('');
});
