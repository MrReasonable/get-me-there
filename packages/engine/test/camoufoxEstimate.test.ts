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
function workedExample() {
  const e = engineWith([stubCamoufox({ cells: 1 })]);
  const def = e.ctx.repos.definitions.update(e.definition.id, {
    window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
    minNights: 10,
    maxNights: 21,
    scheduleCron: '0 5 * * 1',
  });
  return { e, def };
}

describe('the camoufox estimate (cost-004, cost-009, cost-011, prov-013)', () => {
  it('estimates 100 pages, clamped after the retry factor, at spacing + 40 s a page, with the coverage note', () => {
    const { e, def } = workedExample();
    const built = buildSnapshot(e.ctx, def);
    expect(built.cells).toHaveLength(2184);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    const line = est.perProvider.find((p) => p.providerId === 'camoufox');
    expect(line).toMatchObject({ planCalls: 100, calls: 100, costMicroGbp: 0 });
    expect(line?.seconds).toBe(7000);
    expect(est.assumptions).toContain(
      'camoufox list mode prices 100 of 2184 cells this run; a full pass takes 22 runs',
    );
  });
  it('with page spacing 0 a page is estimated at 40 s, so 100 pages take 4000 s (operator, 2026-10-25)', () => {
    const e = engineWith([stubCamoufox({ cells: 1 })], { env: { CAMOUFOX_MIN_SPACING_SECONDS: '0' } });
    const def = e.ctx.repos.definitions.update(e.definition.id, {
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
      minNights: 10,
      maxNights: 21,
      scheduleCron: '0 5 * * 1',
    });
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    const line = est.perProvider.find((p) => p.providerId === 'camoufox');
    expect(line).toMatchObject({ planCalls: 100, calls: 100, costMicroGbp: 0 });
    expect(line?.seconds).toBe(4000);
  });
  // why: CAMOUFOX_PAGES_AT_ONCE: pages run that many at a time, their starts still spaced by the page spacing
  it('two pages at once halve the time, but never below the spacing between their starts', () => {
    const at = (env: Record<string, string>) => {
      const e = engineWith([stubCamoufox({ cells: 1 })], { env });
      const def = e.ctx.repos.definitions.update(e.definition.id, {
        window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
        minNights: 10,
        maxNights: 21,
        scheduleCron: '0 5 * * 1',
      });
      const built = buildSnapshot(e.ctx, def);
      return estimateStart(e.ctx, built.snapshot, built.cells, null).perProvider.find(
        (p) => p.providerId === 'camoufox',
      )?.seconds;
    };
    // why: 100 pages at 30 + 40 s are 7000 s one at a time, 3500 s two at a time (above 100 starts × 30 s)
    expect(at({ CAMOUFOX_PAGES_AT_ONCE: '2' })).toBe(3500);
    // why: four at a time would be 1750 s, but 100 starts 30 s apart take 3000 s
    expect(at({ CAMOUFOX_PAGES_AT_ONCE: '4' })).toBe(3000);
    expect(at({ CAMOUFOX_PAGES_AT_ONCE: '4', CAMOUFOX_MIN_SPACING_SECONDS: '0' })).toBe(1000);
  });
  it('is not blocked at start by its month, which has no cap, or by the shared free-calls cap', () => {
    const { e, def } = workedExample();
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    const check = checkBudget(e.ctx, spendOf(est), built.snapshot.budget, null, def.id);
    expect(check.breaches).toEqual([]);
  });
  // why: spec rev 64: the browser worker has no monthly cap, so the fit has no month row and no coverage warning for it
  it('budgetFit lists no month or coverage scope for camoufox, and fits', () => {
    const { e, def } = workedExample();
    const fit = budgetFitFor(e.ctx, def, def.id);
    expect(fit.perScope.map((s) => s.scope).filter((x) => x.includes('camoufox'))).toEqual([]);
    expect(fit.fits).toBe(true);
  });
  it('below the page cap the pages carry no retry factor: 5 cells are 5 pages, never 6 (ruling 13, TS 9)', () => {
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
    grid: { pageAllowance: number; scrollAllowance: number; scrollSeconds?: number },
    env: Record<string, string> = {},
  ) {
    const e = engineWith([stubCamoufox({ cells: 1, grid })], { env });
    const def = e.ctx.repos.definitions.update(e.definition.id, {
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
      minNights: 10,
      maxNights: 21,
      scheduleCron: '0 5 * * 1',
    });
    return { e, def };
  }
  it('a run that would pass STUCK_AFTER_HOURS says so (CB-7): at a 30 s scroll spacing, 57 pages and 147 scrolls', () => {
    const { e, def } = workedGrid(
      { pageAllowance: 25, scrollAllowance: 150, scrollSeconds: 30 },
      { STUCK_AFTER_HOURS: '1' },
    );
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    expect(est.perProvider.find((p) => p.providerId === 'camoufox')?.seconds).toBe(57 * 30 + 147 * 30);
    expect(est.assumptions).toContain(
      'camoufox: this run takes about 1.7 h, past STUCK_AFTER_HOURS (1 h), so /health reports it stuck while it runs',
    );
    const quick = workedGrid({ pageAllowance: 25, scrollAllowance: 150 });
    const b = buildSnapshot(quick.e.ctx, quick.def);
    expect(estimateStart(quick.e.ctx, b.snapshot, b.cells, null).assumptions.join('\n')).not.toMatch(
      /STUCK_AFTER/,
    );
  });
  it('with room for a page a block: 78 pages, no scroll, 30 s a page, and the retry factor 1.0', () => {
    const { e, def } = workedGrid({ pageAllowance: 100, scrollAllowance: 600 });
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    const line = est.perProvider.find((p) => p.providerId === 'camoufox');
    expect(line).toMatchObject({ planCalls: 78, calls: 78, seconds: 78 * 30, scrolls: 0 });
    expect(est.assumptions).toContain(
      'camoufox grid mode reads 2184 of 2184 cells this run in 78 pages and 0 scrolls; a full pass takes 1 run',
    );
    expect(est.assumptions).toContain(
      'camoufox never retries: its pages, scrolls and seconds carry no retry factor',
    );
  });
  it('grid pages at once share the time, never below the spacing between their starts', () => {
    const { e, def } = workedGrid(
      { pageAllowance: 25, scrollAllowance: 150 },
      { CAMOUFOX_PAGES_AT_ONCE: '3' },
    );
    const built = buildSnapshot(e.ctx, def);
    const line = estimateStart(e.ctx, built.snapshot, built.cells, null).perProvider.find(
      (p) => p.providerId === 'camoufox',
    );
    // why: 57 pages and 147 scrolls are 3077.1 s one at a time; a third is 1026 s, under 57 starts × 30 s
    expect(line?.seconds).toBe(57 * 30);
    const wide = workedGrid(
      { pageAllowance: 25, scrollAllowance: 150 },
      {
        CAMOUFOX_PAGES_AT_ONCE: '3',
        CAMOUFOX_MIN_SPACING_SECONDS: '5',
      },
    );
    const b = buildSnapshot(wide.e.ctx, wide.def);
    expect(
      estimateStart(wide.e.ctx, b.snapshot, b.cells, null).perProvider.find(
        (p) => p.providerId === 'camoufox',
      )?.seconds,
    ).toBe(Math.ceil((57 * 30 + 147 * 9.3) / 3));
  });
  it('under a tight page allowance: pages up to the cap and scrolls within theirs, at 9.3 s a scroll', () => {
    const { e, def } = workedGrid({ pageAllowance: 25, scrollAllowance: 150 });
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    const line = est.perProvider.find((p) => p.providerId === 'camoufox');
    // why: fix round 1 (TS 9): 21 in-column moves of 7 scrolls fit the 150 allowed (78 − 21 = 57 pages)
    expect(line?.scrolls).toBe(147);
    expect(line?.calls).toBe(57);
    expect(line?.seconds).toBe(Math.ceil(57 * 30 + (line?.scrolls ?? 0) * 9.3));
  });
});
