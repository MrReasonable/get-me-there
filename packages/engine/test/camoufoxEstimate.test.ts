import { asIsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkBudget, spendOf } from '../src/budgetCheck.js';
import { budgetFitFor } from '../src/budgetFit.js';
import { estimateStart } from '../src/estimate.js';
import { buildSnapshot } from '../src/snapshot.js';
import { engineWith, stubCamoufox } from './support/camoufox.js';

beforeEach(() => {
  expect.hasAssertions();
});

/** The worked example in list mode: one pair, a 182-day window, 10–21 nights (2,184 cells). */
function workedExample(env: Record<string, string> = {}) {
  const e = engineWith([stubCamoufox({ cells: 1 })], { env });
  const def = e.ctx.repos.definitions.update(e.definition.id, {
    window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
    minNights: 10,
    maxNights: 21,
    scheduleCron: '0 5 * * 1',
  });
  return { e, def };
}
const lineOf = (env: Record<string, string> = {}) => {
  const { e, def } = workedExample(env);
  const built = buildSnapshot(e.ctx, def);
  const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
  return { est, built, line: est.perProvider.find((p) => p.providerId === 'camoufox') };
};

// why: spec rev 65: the browser has no page cap a run, so a run plans a page for every cell it has to read
describe('the camoufox estimate (cost-004, cost-009, cost-011, prov-013)', () => {
  it('estimates a page a cell, every cell of the run, at spacing + 40 s a page, with no retry factor', () => {
    const { est, built, line } = lineOf();
    expect(built.cells).toHaveLength(2184);
    expect(line).toMatchObject({ planCalls: 2184, calls: 2184, costMicroGbp: 0 });
    expect(line?.seconds).toBe(2184 * 70);
    expect(est.assumptions.join('\n')).not.toMatch(/full pass takes|this run;/);
  });
  it('with page spacing 0 a page is estimated at 40 s (operator, 2026-10-25)', () => {
    expect(lineOf({ CAMOUFOX_MIN_SPACING_SECONDS: '0' }).line?.seconds).toBe(2184 * 40);
  });
  // why: CAMOUFOX_PAGES_AT_ONCE: pages run that many at a time, their starts still spaced by the page spacing
  it('two pages at once halve the time, but never below the spacing between their starts', () => {
    const at = (env: Record<string, string>) => lineOf(env).line?.seconds;
    // why: 2,184 pages at 30 + 40 s are 152,880 s one at a time, 76,440 s two at a time (above 2,184 starts × 30 s)
    expect(at({ CAMOUFOX_PAGES_AT_ONCE: '2' })).toBe(76_440);
    // why: four at a time would be 38,220 s, but 2,184 starts 30 s apart take 65,520 s
    expect(at({ CAMOUFOX_PAGES_AT_ONCE: '4' })).toBe(65_520);
    expect(at({ CAMOUFOX_PAGES_AT_ONCE: '4', CAMOUFOX_MIN_SPACING_SECONDS: '0' })).toBe(21_840);
  });
  it('is not blocked at start by its month, which has no cap; a run that fits the shared free-call cap fits', () => {
    const e = engineWith([stubCamoufox({ cells: 100 })]);
    const built = buildSnapshot(e.ctx, e.definition);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    expect(checkBudget(e.ctx, spendOf(est), built.snapshot.budget, null, e.definition.id).breaches).toEqual(
      [],
    );
  });
  // why: spec rev 65: the browser's pages count against no per-run call cap, the free-call cap included
  it('a run of more pages than the free-call cap is never blocked by it', () => {
    const { e, def } = workedExample();
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    expect(built.snapshot.budget.maxFreeCalls).toBeLessThan(2184);
    expect(checkBudget(e.ctx, spendOf(est), built.snapshot.budget, null, def.id).breaches).toEqual([]);
  });
  // why: spec rev 64: the browser worker has no monthly cap, so the fit has no month row and no coverage warning for it
  it('budgetFit lists no month, run or coverage scope for camoufox', () => {
    const { e, def } = workedExample();
    const fit = budgetFitFor(e.ctx, def, def.id);
    expect(fit.perScope.map((s) => s.scope).filter((x) => x.includes('camoufox'))).toEqual([]);
  });
  it('the pages carry no retry factor: 5 cells are 5 pages, never 6 (ruling 13, TS 9)', () => {
    const e = engineWith([stubCamoufox({ cells: 5 })]);
    const built = buildSnapshot(e.ctx, e.definition);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    expect(est.retryFactor).toBeGreaterThan(1);
    expect(est.perProvider.find((p) => p.providerId === 'camoufox')).toMatchObject({
      planCalls: 5,
      calls: 5,
    });
  });
  it('SECONDS_PER_CALL has no per-call figure for scraped-self', async () => {
    const { SECONDS_PER_CALL } = await import('../src/estimate.js');
    expect(SECONDS_PER_CALL['scraped-self']).toBe(0);
  });
});

// WP15 Task 15.8 (spec §2, §8.1 rev 34; rulings 12 and 13): the grid estimate counts pages and scrolls at the measured
// times, with no retry factor, since camoufox never retries.
describe('the camoufox grid estimate', () => {
  function workedGrid(
    grid: { pageSeconds?: number; scrollSeconds?: number } = {},
    env: Record<string, string> = {},
  ) {
    const e = engineWith([stubCamoufox({ cells: 1, grid })], { env });
    const def = e.ctx.repos.definitions.update(e.definition.id, {
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
      minNights: 10,
      maxNights: 21,
      scheduleCron: '0 5 * * 1',
    });
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    return { est, line: est.perProvider.find((p) => p.providerId === 'camoufox') };
  }
  it('a run that would pass STUCK_AFTER_HOURS says so (CB-7): 78 pages at 50 s a page', () => {
    const slow = workedGrid({ pageSeconds: 50 }, { STUCK_AFTER_HOURS: '1' });
    expect(slow.line?.seconds).toBe(78 * 50);
    expect(slow.est.assumptions).toContain(
      'camoufox: this run takes about 1.1 h, past STUCK_AFTER_HOURS (1 h), so /health reports it stuck while it runs',
    );
    expect(workedGrid().est.assumptions.join('\n')).not.toMatch(/STUCK_AFTER/);
  });
  it('a page a block: 78 pages, no scroll, 30 s a page, every cell in one run, and the retry factor 1.0', () => {
    const { est, line } = workedGrid();
    expect(line).toMatchObject({ planCalls: 78, calls: 78, seconds: 78 * 30, scrolls: 0 });
    expect(est.assumptions).toContain('camoufox grid mode reads 2184 cells in 78 pages and 0 scrolls');
    expect(est.assumptions).toContain(
      'camoufox never retries: its pages, scrolls and seconds carry no retry factor',
    );
  });
  it('grid pages at once share the time, never below the spacing between their starts', () => {
    // why: 78 pages of 30 s are 2,340 s one at a time; a third is 780 s, under 78 starts × 30 s
    expect(workedGrid({}, { CAMOUFOX_PAGES_AT_ONCE: '3' }).line?.seconds).toBe(78 * 30);
    expect(
      workedGrid({}, { CAMOUFOX_PAGES_AT_ONCE: '3', CAMOUFOX_MIN_SPACING_SECONDS: '5' }).line?.seconds,
    ).toBe((78 * 30) / 3);
  });
  it('where a scroll is quicker than a page, blocks are joined by scrolls, each at its own time', () => {
    const { line } = workedGrid({ scrollSeconds: 1 });
    expect(line?.scrolls ?? 0).toBeGreaterThan(0);
    expect(line?.calls ?? 78).toBeLessThan(78);
    expect(line?.seconds).toBe(Math.ceil((line?.calls ?? 0) * 30 + (line?.scrolls ?? 0) * 1));
  });
});
