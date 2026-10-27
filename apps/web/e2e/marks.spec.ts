import { expect, test } from '@playwright/test';
import { PERF_DEFINITION_ID, type PerfCase, servePerfCase } from './perfFixtures.js';
import { SMOKE } from './selectors.js';

// Spec §11 Overview, the marks in a real layout (jsdom has no paint): the "partly not searched" stripes are drawn in
// the cell's own ink, the same colour as its glyphs, so the glyphs sit on the cell's own fill and no stripe crosses
// their strokes (CodeRabbit on PR #32). The smoke's fixture run searches every cell, so this case is served through
// route interception with some date pairs partly not searched.

/** Four weeks × 3 stays × the example's 4 airport pairs, every date pair priced, every fifth partly not searched. */
const PARTLY_CASE: PerfCase = {
  name: 'partly not searched',
  from: '2027-01-04',
  days: 28,
  minNights: 10,
  maxNights: 12,
  origins: ['LGW', 'LHR'],
  destinations: ['EWR', 'JFK'],
  everyPriced: true,
  partly: true,
};

test('a partly-not-searched cell keeps its stripes, and its glyphs sit on its own fill', async ({ page }) => {
  await servePerfCase(page, PARTLY_CASE);
  await page.goto(`/?view=dates&def=${PERF_DEFINITION_ID}`);
  await expect(page.getByRole('table', { name: SMOKE.boardTable })).toBeVisible();
  const striped = page.locator(`${SMOKE.overviewCell}[data-marks~="partly"]`);
  await expect(striped.first()).toBeVisible();
  await expect(striped.first()).toHaveCSS('background-image', /repeating-linear-gradient/);
  const backings = await striped.evaluateAll(
    (cells, glyphs) =>
      cells.map((c) => {
        const g = c.querySelector(glyphs);
        return {
          cell: c.getAttribute('data-cell'),
          fill: getComputedStyle(c).backgroundColor,
          glyph: g === null ? null : getComputedStyle(g).backgroundColor,
        };
      }),
    SMOKE.cellGlyphs,
  );
  expect(backings.length).toBeGreaterThan(0);
  for (const b of backings) {
    // why: an opaque backing in the cell's own fill colour, so the stripes show only around the glyphs
    expect(b.fill, `${b.cell}`).not.toBe('rgba(0, 0, 0, 0)');
    expect(b.glyph, `${b.cell}`).toBe(b.fill);
  }
});
