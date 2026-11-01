import { AbortedError, apiContract, type Estimate, ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { budgetFitFor, scheduleLoad } from '../src/budgetFit.js';
import { buildContext } from '../src/context.js';
import {
  addPass,
  estimateRemainingFor,
  estimateStart,
  monthlyPagesOf,
  withBlocked,
} from '../src/estimate.js';
import { lineKey } from '../src/lines.js';
import { runsPerMonth } from '../src/scheduler/parseCron.js';
import { buildSnapshot } from '../src/snapshot.js';
import { confirmationNeeded } from '../src/start.js';
import { engineWith, flightRows, rankedPairs, stubCamoufox, stubTravelpayouts } from './support/camoufox.js';
import {
  createHarness,
  EWR,
  expectedTiles,
  type Harness,
  HOUR,
  JFK,
  LGW,
  LHR,
  T0,
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
    // why: 3 factored calls × min(365/12, ⌈730 / (0.9 × 168)⌉) = 3 × 5 = 15, against 3 × 30.4 = 92 if every firing re-fetched
    expect(fit.perScope.find((x) => x.scope === 'provider-month:fixture')?.estimated).toBe(15);
  });

  it('a schedule that fires before the window closes holds a whole discovery, never a fraction of one (cost M-3)', () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const b = buildSnapshot(ctx, def, 'schedule');
    const perRun = estimateStart(ctx, b.snapshot, b.cells, null);
    const discovery = perRun.perProvider.find((p) => p.stage === 'discovery')?.calls ?? 0;
    expect(discovery).toBe(3);
    // why: 3 days left of a weekly refresh is 72 / 151.2 ≈ 0.48 of a reuse window, but the next firing re-fetches in
    // full when the last fetch is older than 0.9 × refresh, so the reservation holds the whole discovery
    expect(scheduleLoad(ctx, perRun, b.snapshot, 1, 72).get('fixture')?.calls).toBe(discovery);
    expect(scheduleLoad(ctx, perRun, b.snapshot, 0, 72).get('fixture')?.calls).toBe(0);
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

// Spec revision 55 §8.1 "Estimate" (WP20 Task 20.9): with camoufox in discovery the estimate carries the flight-list
// step's `flightLists { pages, seconds }`: pages the least of 10 less the reusable date pairs, the monthly pages left
// after the grid plan and the run's free calls left; seconds pages × (spacing + 40). Its seconds count in the total and
// the browser window; its pages never in totalCalls, but in camoufox's calls for the soft confirmation, the monthly
// pages and budgetFit. Without camoufox the stored estimate has no `flightLists` key.
describe('the estimate flight line (spec rev 55 §8.1)', () => {
  /** A camoufox engine over `cells` one-page cells (with a flight capability) and its start-time estimate. */
  function flightEstimate(cells: number, o: Parameters<typeof engineWith>[1] = {}, saved = false) {
    const e = engineWith([stubCamoufox({ cells, flights: {} })], { rankedDatePairs: rankedPairs(15), ...o });
    const b = buildSnapshot(e.ctx, e.definition);
    return { e, b, est: estimateStart(e.ctx, b.snapshot, b.cells, saved ? e.definition.id : null) };
  }

  it('reads 10 date pairs at spacing + 40 s a page (700 s at the defaults): in seconds, never in totalCalls', () => {
    const { est } = flightEstimate(15);
    expect(est.flightLists).toEqual({ pages: 10, seconds: 700 });
    const grid = est.perProvider.find((p) => p.providerId === 'camoufox');
    expect(est.totalCalls).toBe(grid?.calls);
    expect(est.seconds).toBe((grid?.seconds ?? 0) + 700);
    expect(est.assumptions).toContain('+ flights for up to 10 date pairs, about 12 minutes');
    expect(apiContract.estimateSchema.parse(est).flightLists).toEqual({ pages: 10, seconds: 700 });
  });

  it('leaves out the reusable date pairs of a saved search', () => {
    const { e } = flightEstimate(15);
    const pairs = rankedPairs(3)({
      definitionId: e.definition.id,
      space: buildSnapshot(e.ctx, e.definition).snapshot.resolved,
      cabin: 'economy',
      maxJourneyMinutes: null,
      now: T0,
    });
    for (const p of pairs)
      e.ctx.repos.flightLists.insert({
        definitionId: e.definition.id,
        executionId: null,
        providerId: 'camoufox',
        sourceKind: 'scraped-self',
        cabin: 'economy',
        origin: p.origin,
        destination: p.destination,
        departureDate: p.departureDate,
        returnDate: p.returnDate,
        fetchedAt: T0,
        pointOfSale: 'GB',
        status: 'read',
        reason: null,
        listed: 'no-flights',
        minMinor: null,
        tabMinor: null,
        cheapestView: null,
        optionsUnparsed: 0,
        optionsOtherCell: 0,
        resultsStated: null,
        flights: [],
      });
    const b = buildSnapshot(e.ctx, e.definition);
    expect(estimateStart(e.ctx, b.snapshot, b.cells, e.definition.id).flightLists?.pages).toBe(7);
    expect(estimateStart(e.ctx, b.snapshot, b.cells, null).flightLists?.pages).toBe(10);
  });

  it("names the browser worker's monthly page cap when it binds (4 pages left after a 100-page grid)", () => {
    const { est } = flightEstimate(120, { monthlyCap: 104 });
    expect(est.flightLists?.pages).toBe(4);
    expect(est.assumptions).toContain("flights for 4 date pairs: the browser worker's monthly page cap");
  });

  it("names the run's free-call limit when maxFreeCalls 105 binds after 100 grid pages", () => {
    const { est } = flightEstimate(100, { maxFreeCalls: 105 });
    expect(est.flightLists?.pages).toBe(5);
    expect(est.assumptions).toContain("flights for 5 date pairs: the run's free-call limit");
  });

  it('is carried through withBlocked (zero when the browser line is blocked) and addPass', () => {
    const { est } = flightEstimate(15);
    const blockedTp = withBlocked(est, new Map());
    expect(blockedTp.flightLists).toEqual({ pages: 10, seconds: 700 });
    expect(blockedTp.seconds).toBe(est.seconds);
    const blocked = withBlocked(est, new Map([[lineKey('discovery', 'camoufox'), 'provider-month']]));
    expect(blocked.flightLists).toEqual({ pages: 0, seconds: 0 });
    expect(blocked.seconds).toBe(0);
    const twice = addPass(est, est);
    expect(twice.flightLists).toEqual({ pages: 20, seconds: 1400 });
    expect(twice.seconds).toBe(2 * est.seconds);
  });

  it('counts the flight pages in camoufox calls for the soft confirmation: 100 + 10 of a 500 cap trips the share', () => {
    const { e, est } = flightEstimate(120, { monthlyCap: 500 });
    const need = confirmationNeeded(e.ctx, est, new Set(), { pence: null, calls: null });
    expect(need?.why).toEqual({
      reason: 'call-share',
      providerId: 'camoufox',
      calls: 110,
      cap: 500,
      window: 'month',
    });
    const { flightLists: _none, ...gridOnly } = est;
    expect(confirmationNeeded(e.ctx, gridOnly, new Set(), { pence: null, calls: null })).toBeNull();
  });

  it("counts them in the browser worker's monthly pages and in budgetFit's month", () => {
    const { e, est } = flightEstimate(15, { scheduleCron: '0 5 * * 1' });
    expect(monthlyPagesOf(e.ctx, est, null)?.planned).toBe(25);
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    const runs = runsPerMonth('0 5 * * 1', 'Europe/London', new Date(T0));
    expect(fit.perScope.find((x) => x.scope === 'provider-month:camoufox')?.estimated).toBe(
      Math.ceil(runs * 25),
    );
  });

  it('estimateRemaining counts the planned cells with no row yet', async () => {
    const cam = stubCamoufox({
      cells: 15,
      // why: from the fifth page the gate's refusal (an AbortedError, the run not cancelled) ends the step with no row
      flights: {
        answer: (_q, n) => {
          if (n > 4) throw new AbortedError();
          return undefined;
        },
      },
    });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(15) });
    const r = await e.orch.start(e.definition.id, {
      trigger: 'manual',
      confirmCostPence: 1_000_000,
      confirmCalls: 1_000_000,
    });
    if (!r.ok) throw new Error(r.message);
    const done = await e.settled(r.executionId);
    expect(flightRows(e, r.executionId)).toHaveLength(4);
    expect(estimateRemainingFor(e.ctx, done, true).flightLists?.pages).toBe(6);
  });

  /** `n` browser pages already spent this month (outside any run), as the guard counts them. */
  function spendPages(e: ReturnType<typeof engineWith>, n: number): void {
    const at = e.clock.now();
    const insert = e.ctx.db.raw.prepare(
      `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at,
         duration_ms, http_status, outcome, billable, cost_micro_gbp, http_attempt, page_class)
       VALUES ('camoufox', NULL, '/v1/page', NULL, ?, ?, 1, 200, 'ok', 0, 0, 1, 'page')`,
    );
    for (let i = 0; i < n; i++) insert.run(at, at);
  }

  it("R-load: a schedule's load counts its full flight allowance a run, even with the month spent", () => {
    // why: 15 of a 30-page month are spent, so this run's grid (15) leaves none for flights; a schedule still needs
    // 10 flight pages on every run it makes
    const { e, b } = flightEstimate(15, { monthlyCap: 30, scheduleCron: '0 5 * * 1' });
    spendPages(e, 15);
    expect(estimateStart(e.ctx, b.snapshot, b.cells, null).flightLists?.pages).toBe(0);
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    const runs = runsPerMonth('0 5 * * 1', 'Europe/London', new Date(T0));
    expect(fit.perScope.find((x) => x.scope === 'provider-month:camoufox')?.estimated).toBe(
      Math.ceil(runs * 25),
    );
    expect(fit.perScope.find((x) => x.scope.startsWith('execution-free-calls'))?.estimated).toBe(25);
  });

  it('never says "+ flights for up to 0 date pairs"; a cap that leaves none is still named', () => {
    const { est } = flightEstimate(15, { monthlyCap: 15 });
    expect(est.flightLists).toEqual({ pages: 0, seconds: 0 });
    expect(est.assumptions.some((a) => a.startsWith('+ flights'))).toBe(false);
    expect(est.assumptions).toContain("flights for 0 date pairs: the browser worker's monthly page cap");
  });

  it('withBlocked drops the flight notes when it zeroes the flight pages', () => {
    const { est } = flightEstimate(120, { monthlyCap: 104 });
    expect(est.assumptions.filter((a) => a.includes('flights for'))).toHaveLength(2);
    const blocked = withBlocked(est, new Map([[lineKey('discovery', 'camoufox'), 'provider-month']]));
    expect(blocked.assumptions.filter((a) => a.includes('flights for'))).toEqual([]);
  });

  it('without camoufox the estimate has no flightLists key', () => {
    const e = engineWith([stubTravelpayouts({ cells: 15 })], { rankedDatePairs: rankedPairs(15) });
    const b = buildSnapshot(e.ctx, e.definition);
    const est = estimateStart(e.ctx, b.snapshot, b.cells, null);
    expect('flightLists' in est).toBe(false);
    expect('flightLists' in apiContract.estimateSchema.parse(est)).toBe(false);
  });
});
