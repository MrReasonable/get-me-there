import { expect, test } from '@playwright/test';
import { COPY } from '../src/copy.js';
import { SMOKE } from './selectors.js';

// Spec §9 item 6: one Playwright smoke in fixture mode, through the real api and the built SPA. Every price here is
// synthetic, and every view must say so beside the red banner (spec §5.5).
test('fixture mode: import, run, then Results, Calendar, Duration and History show synthetic prices with provenance', async ({
  page,
}) => {
  await page.goto('/?view=definitions');
  await page.getByRole('button', { name: /^Import example/ }).click();
  // why: the provider checkboxes sit in WP9's advanced fold.
  await page.getByText(COPY.advanced).click();
  // why: the example JSON names the real providers, which fixture mode does not configure; switch both stages to the fixture provider.
  for (const prefix of ['p-d-', 'p-v-']) {
    for (const box of await page.locator(`input[type="checkbox"][id^="${prefix}"]`).all())
      await box.uncheck();
    await page.locator(`#${prefix}fixture`).check();
  }
  // why: a new definition is created disabled (spec rev 27), and the api refuses "Run now" for a disabled one (409).
  // The budget is not touched: Import example leaves the plan preset's budget, which the api's EXECUTION_MAX_CALLS sets.
  await page.getByLabel(COPY.enabled).check();
  // why: WP9's form offers the create click only after an estimate for the current draft.
  await page.getByRole('button', { name: COPY.showEstimate }).click();
  await page.getByRole('button', { name: /^Create and confirm about/ }).click();
  await page.getByRole('button', { name: /^Run now/ }).click();

  // why: WP9's headline is a flex div whose first child is the lead span.
  const headline = page.getByText(COPY.headlineLead, { exact: true }).first().locator('..');
  await expect(async () => {
    await page.goto('/?view=results');
    await expect(headline).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(headline).toContainText(COPY.source.synthetic);
  await expect(headline).toContainText(/ago|just now/);
  const banner = page.getByRole('alert').filter({ hasText: COPY.syntheticBanner });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/bg-red-700/);

  // View B: month tables of day buttons, a priced day carrying the synthetic badge, visible focus in a real browser.
  await page.goto('/?view=calendar');
  await expect(page.getByRole('table', { name: SMOKE.monthTable }).first()).toBeVisible();
  const priced = page.locator(SMOKE.pricedDay).first();
  await expect(priced).toContainText(COPY.providerShort.fixture);
  await expect(page.getByTestId('calendar-legend')).toBeVisible();
  await expect(banner).toBeVisible();
  await expect(page.locator(SMOKE.dayTabStop)).toHaveCount(1);
  // why: focus-visible applies once the keyboard is in use: focus() puts focus on the tab stop and the arrow keys that
  // follow switch the page to keyboard modality, so the outline is then computed as for a Tab user.
  await page.locator(SMOKE.dayTabStop).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(SMOKE.dayTabStop)).toHaveCSS('outline-style', 'solid');

  // View C and History: the charts draw in a real layout and their tables name the synthetic source.
  await page.goto('/?view=duration');
  await expect(
    page.getByRole('figure', { name: COPY.durationView.chartTitle }).locator('svg[role="application"]'),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: COPY.durationView.tableCaption })).toContainText(
    COPY.source.synthetic,
  );
  await page.goto('/?view=history');
  await expect(
    page.getByRole('figure', { name: COPY.historyView.fetchChartTitle }).locator('svg[role="application"]'),
  ).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText(COPY.source.synthetic);
});

test('at 375px the calendar shows one month of compact days, nothing spilling out of its cell @phone', async ({
  page,
}) => {
  await page.goto('/?view=calendar');
  await expect(page.getByRole('table', { name: SMOKE.monthTable })).toHaveCount(1);
  await expect(page.getByRole('button', { name: SMOKE.nextMonth })).toBeVisible();
  await expect(page.getByTestId('calendar-legend')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // why: ui-r2-001 — every day's content stays inside its button, and the amount is never cut off.
  const spilled = await page
    .locator(SMOKE.dayButton)
    .evaluateAll((days) =>
      days.filter((d) => d.scrollWidth > d.clientWidth).map((d) => d.getAttribute('data-date')),
    );
  expect(spilled).toEqual([]);
  const face = page.locator(SMOKE.pricedDayPhone).first();
  await expect(face).toContainText('£');
  await expect(face.getByTestId('price-cell')).toHaveAttribute('title', new RegExp(COPY.provider.fixture));
});
