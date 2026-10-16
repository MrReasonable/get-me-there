import { apiContract, type Estimate, ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { budgetFitFor, estimateRemainingFor, estimateStart } from '../src/estimate.js';
import { buildSnapshot } from '../src/snapshot.js';
import {
  createHarness,
  EWR,
  expectedTiles,
  type Harness,
  HOUR,
  JFK,
  LGW,
  LHR,
  verificationOf,
  withVerification,
} from './support/harness.js';
import { dropPlanCell, extraTile, throwOnSearch } from './support/wrappers.js';

const plan = (e: Estimate) =>
  e.perProvider.map((p) => ({ providerId: p.providerId, stage: p.stage, calls: p.planCalls }));
const estimateOf = (h: Harness, defId: string, reuse: boolean) => {
  const ctx = buildContext(h.deps, h.options);
  const def = h.repos.definitions.get(defId);
  if (def === null) throw new Error('no definition');
  const b = buildSnapshot(ctx, def);
  return { est: estimateStart(ctx, b.snapshot, b.cells, reuse ? def.id : null), cells: b.cells };
};
const fitOf = (h: Harness, defId: string) => {
  const def = h.repos.definitions.get(defId);
  if (def === null) throw new Error('no definition');
  return budgetFitFor(buildContext(h.deps, h.options), def, def.id);
};

describe('estimate (spec §8.1 "Estimate")', () => {
  it('pins one small definition: 2 tiles + 2 cells × 3 calls, × 1.2, at 3200 µGBP a call (test-strategy-022)', () => {
    const h = createHarness();
    const { est } = estimateOf(h, h.createDefinition({ providers: withVerification() }).id, false);
    expect(est.perProvider).toEqual([
      {
        providerId: 'fixture',
        stage: 'discovery',
        calls: 3,
        planCalls: 2,
        costMicroGbp: 7680,
        costPence: 1,
        seconds: 2,
        blocked: null,
      },
      {
        providerId: 'fixture',
        stage: 'verification',
        calls: 8,
        planCalls: 6,
        costMicroGbp: 23_040,
        costPence: 3,
        seconds: 3,
        blocked: null,
      },
    ]);
    expect(est).toMatchObject({
      cells: 28,
      totalCalls: 11,
      totalPlanCalls: 8,
      totalCostMicroGbp: 30_720,
      totalCostPence: 4,
      retryFactor: 1.2,
    });
    expect(est.assumptions[0]).toBe('every call count includes the retry factor 1.2');
    expect(apiContract.estimateSchema.safeParse(est).success).toBe(true);
  });

  it('= Σ discovery plan length + maxCells × verification.estimate per provider and stage', () => {
    const h = createHarness();
    const def = h.createDefinition({
      origins: [LHR, LGW],
      destinations: [JFK],
      providers: withVerification(),
    });
    const { est, cells } = estimateOf(h, def.id, false);
    const first = cells[0];
    if (first === undefined) throw new Error('the definition resolved to no cells');
    const per = verificationOf(h.fixture).estimate({
      ...first,
      cabin: 'economy',
      adults: 1,
      currency: 'GBP',
      expandTop: 1,
      bookingLinks: true,
    });
    expect(plan(est)).toEqual([
      { providerId: 'fixture', stage: 'discovery', calls: expectedTiles(h, def) },
      { providerId: 'fixture', stage: 'verification', calls: 2 * per.calls },
    ]);
  });

  it('the run-time estimate uses the same reuse query as the run; the worst case (no definition id) plans every cell (ruling 9)', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    const soon = estimateOf(h, def.id, true);
    expect(soon.est.perProvider[0]?.planCalls).toBe(0);
    expect(soon.est.assumptions).toContain(
      `fixture: ${soon.cells.length} cells reuse earlier prices and are not planned`,
    );
    expect(estimateOf(h, def.id, false).est.perProvider[0]?.planCalls).toBe(2);
    h.clock.advance(151 * HOUR);
    expect(estimateOf(h, def.id, true).est.perProvider[0]?.planCalls).toBe(expectedTiles(h, def));
  });

  it('a plan that does not partition the cells fails the start before anything is created (ssr-06)', async () => {
    const h = createHarness({ transformFixture: dropPlanCell });
    const def = h.createDefinition();
    await expect(h.orch().start(def.id, { trigger: 'manual' })).rejects.toThrow('does not partition');
    expect(h.repos.executions.listForDefinition(def.id, { limit: 10, includeChildren: true })).toEqual([]);
  });

  it('is stored on the execution at start', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const e = await h.runToCompletion(h.orch(), def.id);
    if (e.estimate === null) throw new Error('no estimate stored');
    expect(plan(e.estimate)).toEqual([
      { providerId: 'fixture', stage: 'discovery', calls: expectedTiles(h, def) },
    ]);
  });
});

describe('estimateRemaining (spec §8.1 "resumable tiles + remaining selected cells × estimate × factor")', () => {
  it('after an interrupt at k of n tiles, plans n − k', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] });
    const first = h.orch();
    h.onTileCommit((c) => {
      if (c === 2) void first.shutdown();
    });
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    const rem = estimateRemainingFor(buildContext(h.deps, h.options), e, true);
    expect(plan(rem)).toEqual([
      { providerId: 'fixture', stage: 'discovery', calls: expectedTiles(h, def) - 2 },
    ]);
  });

  it('leaves out no-priced-options errors, which no resume fetches (decision 37, prov-wp07-r2-001)', async () => {
    const err = new ProviderError({
      kind: 'upstream',
      retryable: false,
      reason: 'no-priced-options',
      providerId: 'fixture',
      message: 'step 1 returned options and none was priced',
    });
    const h = createHarness({ transformFixture: (p) => throwOnSearch(p, err, () => true) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ providers: withVerification() }).id);
    expect(h.outcomes(e.id, { stage: 'verification', status: 'error' })).toHaveLength(2);
    const ctx = buildContext(h.deps, h.options);
    for (const manual of [false, true]) expect(estimateRemainingFor(ctx, e, manual).totalCalls).toBe(0);
  });
});

describe('budgetFit (spec §8.2 "compares runsPerMonth × estimate with every cap and warns")', () => {
  it('weekly: 52/12 runs a month; fits under generous caps and parses as the api contract', () => {
    const h = createHarness();
    const fit = fitOf(h, h.createDefinition({ scheduleCron: '0 5 * * 1' }).id);
    expect(fit.runsPerMonth).toBe(52 / 12);
    expect(fit.fits).toBe(true);
    expect(fit.perScope).toEqual([
      { scope: 'execution-calls', estimated: 3, cap: 1000, fits: true },
      { scope: 'execution-free-calls', estimated: 0, cap: 1000, fits: true },
      { scope: 'execution-cost', estimated: 7680, cap: 1_000_000_000, fits: true },
      { scope: 'provider-month:fixture', estimated: 13, cap: 100_000, fits: true }, // 3 × 4.33
      { scope: 'global-month', estimated: 33_280, cap: 1_000_000_000, fits: true },
    ]);
    expect(apiContract.budgetFitSchema.safeParse(fit).success).toBe(true);
  });

  it('gives the same answer just after a run as with no run (no reuse is assumed, po-004)', async () => {
    const h = createHarness();
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const before = fitOf(h, def.id);
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    expect(fitOf(h, def.id)).toEqual(before);
  });

  it('a daily schedule pays discovery once per refresh window, not daily (cost-r1-003)', () => {
    const h = createHarness();
    const fit = fitOf(h, h.createDefinition({ scheduleCron: '0 5 * * *' }).id);
    // why: 3 factored calls × min(365/12, 730 / (0.9 × 168)) = 3 × 4.83 → 15, against 3 × 30.4 = 92 if every firing re-fetched
    expect(fit.perScope.find((x) => x.scope === 'provider-month:fixture')?.estimated).toBe(15);
  });

  it('adds every other enabled scheduled definition to the shared monthly scopes (ruling 5)', () => {
    const h = createHarness({ fixtureMonthlyCallCap: 20 });
    h.createDefinition({ scheduleCron: '0 5 * * 1', destinations: [EWR] });
    h.createDefinition({ scheduleCron: '0 6 * * 1', enabled: false }); // disabled: not counted
    const fit = fitOf(h, h.createDefinition({ scheduleCron: '0 5 * * 1' }).id);
    expect(fit.perScope.find((x) => x.scope === 'provider-month:fixture')).toEqual({
      scope: 'provider-month:fixture',
      estimated: 26,
      cap: 20,
      fits: false,
    });
    expect(fit.fits).toBe(false);
  });
});

describe('parity and the overrun baseline (spec §8.1)', () => {
  it('an uninterrupted pass whose distinct tile requests equal the plan raises no parity notice', async () => {
    const h = createHarness();
    await h.runToCompletion(h.orch(), h.createDefinition().id);
    expect(h.notifications).toHaveLength(0);
  });
  it('a pass that requests more distinct tiles than planned raises one parity_break notification', async () => {
    const h = createHarness({ transformFixture: extraTile });
    await h.runToCompletion(h.orch(), h.createDefinition().id);
    const parity = h.notifications.filter((m) => m.kind === 'parity_break');
    expect(parity).toHaveLength(1);
    expect(parity[0]?.body).toContain('fixture: planned 2 tile requests; the ledger shows 4');
  });
  it('planCalls, not the factored calls, is the overrun baseline: an uninterrupted single-page pass spends exactly planCalls', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    if (e.estimate === null) throw new Error('no estimate stored');
    const discovery = h.repos.ledger
      .countsFor(e.id)
      .perProvider.find((p) => p.providerId === 'fixture' && p.stage === 'discovery');
    expect(discovery?.calls).toBe(e.estimate.perProvider[0]?.planCalls);
    expect(e.estimate.perProvider[0]?.calls).toBeGreaterThan(discovery?.calls ?? 0);
  });
  it('a paged tile keeps parity (one tile index) but spends a call per page beyond planCalls; discovery overrun is judged on tiles (cost-r1-007)', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(
      h.orch(),
      h.createDefinition({ origins: [LGW], destinations: [EWR] }).id,
    );
    expect(e.status).toBe('completed');
    expect(h.notifications.filter((m) => m.kind === 'parity_break')).toHaveLength(0);
    const counts = h.repos.ledger.countsFor(e.id).perProvider.find((p) => p.stage === 'discovery');
    // why: planCalls counts tiles, so the overrun baseline for discovery is the distinct tiles (WP8's rule, §11): equal
    // here, while the calls exceed it by the extra pages
    expect(counts?.tiles).toBe(e.estimate?.perProvider[0]?.planCalls);
    expect(counts?.calls ?? 0).toBeGreaterThan(counts?.tiles ?? 0);
    expect(e.estimate?.assumptions).toContain(
      `fixture: ${counts?.tiles} discovery tiles planned; a tile that pages spends one call a page`,
    );
  });
  it('a chained verification spends no more calls per cell than verification.estimate (cost-r1-007)', async () => {
    const h = createHarness();
    const def = h.createDefinition({
      origins: [LGW],
      destinations: [JFK],
      providers: withVerification(),
      verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    });
    const e = await h.runToCompletion(h.orch(), def.id);
    const verification = h.repos.ledger.countsFor(e.id).perProvider.find((p) => p.stage === 'verification');
    expect(verification?.calls).toBeGreaterThan(1);
    expect(verification?.calls ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      e.estimate?.perProvider[1]?.planCalls ?? 0,
    );
  });
});
