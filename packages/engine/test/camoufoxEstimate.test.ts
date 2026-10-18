import { asIsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkBudget, spendOf } from '../src/budgetCheck.js';
import { budgetFitFor } from '../src/budgetFit.js';
import { estimateStart } from '../src/estimate.js';
import { runsPerMonth } from '../src/scheduler/parseCron.js';
import { buildSnapshot } from '../src/snapshot.js';
import { engineWith, stubCamoufox } from './support/camoufox.js';
import { T0 } from './support/harness.js';

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
      'camoufox list mode prices 100 of 2184 cells this run; a full pass takes 22 runs; the month cap allows about 1500 cells',
    );
  });
  it('is not blocked at start by provider-month or by the shared free-calls cap', () => {
    const { e, def } = workedExample();
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    const check = checkBudget(e.ctx, spendOf(est), built.snapshot.budget, null, def.id);
    expect(check.breaches).toEqual([]);
  });
  it('budgetFit counts runs × the page cap a month and warns that a refresh needs more cells than the month allows', () => {
    const { e, def } = workedExample();
    const fit = budgetFitFor(e.ctx, def, def.id);
    const runs = runsPerMonth('0 5 * * 1', 'Europe/London', new Date(T0));
    const month = fit.perScope.find((s) => s.scope === 'provider-month:camoufox');
    expect(month?.estimated).toBe(Math.ceil(Math.min(runs * 100, runs * 2184)));
    expect(month?.fits).toBe(true);
    expect(fit.perScope.find((s) => s.scope === 'cells-per-refresh:camoufox')).toEqual({
      scope: 'cells-per-refresh:camoufox',
      estimated: 2184,
      cap: 1500,
      fits: false,
    });
    // why: fix round 1 (CodeRabbit): the coverage line warns; it is no cap, so the overall fit stays true
    expect(fit.fits).toBe(true);
  });
  it('SECONDS_PER_CALL has no per-call figure for scraped-self', async () => {
    const { SECONDS_PER_CALL } = await import('../src/estimate.js');
    expect(SECONDS_PER_CALL['scraped-self']).toBe(0);
  });
});

// WP15 Task 15.8 (spec §2, §8.1 rev 34; rulings 12 and 13): the grid estimate counts pages and scrolls at the measured
// times, with no retry factor, since camoufox never retries.
describe('the camoufox grid estimate', () => {
  function workedGrid(grid: { pageAllowance: number; scrollAllowance: number }) {
    const e = engineWith([stubCamoufox({ cells: 1, grid })]);
    const def = e.ctx.repos.definitions.update(e.definition.id, {
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
      minNights: 10,
      maxNights: 21,
    });
    return { e, def };
  }
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
  it('under a tight page allowance: pages up to the cap and scrolls within theirs, at 9.3 s a scroll', () => {
    const { e, def } = workedGrid({ pageAllowance: 25, scrollAllowance: 150 });
    const built = buildSnapshot(e.ctx, def);
    const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
    const line = est.perProvider.find((p) => p.providerId === 'camoufox');
    expect(line?.scrolls).toBeGreaterThan(0);
    expect(line?.scrolls).toBeLessThanOrEqual(150);
    expect(line?.calls).toBe(57);
    expect(line?.seconds).toBe(Math.ceil(57 * 30 + (line?.scrolls ?? 0) * 9.3));
  });
});
