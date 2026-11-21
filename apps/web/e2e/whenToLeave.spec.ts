import { expect, test } from '@playwright/test';
import { PLAN_COPY } from '../src/copy/plan.js';
import { COPY } from '../src/copy.js';
import { expectNoSidewaysScroll } from './layout.js';

// Spec §11 "When to leave" (revision 73): the new-search panel's choice through the built SPA, at 375 and 1280 px in light
// and dark, never scrolling sideways. Screenshots go to test-results/when-shots/ for the review.

for (const width of [375, 1280] as const)
  for (const colorScheme of ['light', 'dark'] as const)
    test(`When to leave at ${width}px, ${colorScheme}: Next 6 months with its dates, then Set date range`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: COPY.searchesView.heading })).toBeVisible();
      const when = page.getByLabel(PLAN_COPY.whenToLeave);
      await expect(when).toHaveValue('6');
      const leave = page.getByRole('group', { name: PLAN_COPY.leaveBetween });
      await expect(leave).toContainText(/^.*Leaving \d{1,2} \w{3} \d{4} to \d{1,2} \w{3} \d{4} as of today/);
      await expect(page.locator('#w-from')).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      await leave.screenshot({ path: `test-results/when-shots/when-6-${width}-${colorScheme}.png` });
      await when.selectOption('range');
      await expect(page.locator('#w-from')).toBeVisible();
      await expect(page.locator('#w-to')).toBeVisible();
      await expectNoSidewaysScroll(page);
      await leave.screenshot({ path: `test-results/when-shots/when-range-${width}-${colorScheme}.png` });
    });
