import { AbortedError, apiContract, type Estimate, ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { budgetFitFor, scheduleLoad } from '../src/budgetFit.js';
import { buildContext } from '../src/context.js';
import {
  addPass,
  estimateRemainingFor,
  estimateStart,
  flightWindowMarginSeconds,
  withBlocked,
} from '../src/estimate.js';
import { lineKey } from '../src/lines.js';
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
// step's `flightLists { pages, seconds }`: pages the least of 10 less the reusable date pairs and the run's free calls
// left; seconds pages × (spacing + 25). Its seconds count in the total and the browser window; its pages never in
// totalCalls. Without camoufox the stored estimate has no `flightLists` key.
describe('the estimate flight line (spec rev 55 §8.1)', () => {
  /** A camoufox engine over `cells` one-page cells (with a flight capability) and its start-time estimate. */
  function flightEstimate(cells: number, o: Parameters<typeof engineWith>[1] = {}, saved = false) {
    const e = engineWith([stubCamoufox({ cells, flights: {} })], { rankedDatePairs: rankedPairs(15), ...o });
    // why: revision 55's outbound-only line: a worker that reported no return flag (final review B-M3: while the flags
    // are unread the estimate counts the return phase)
    e.ctx.workerFlags.set('camoufox', { RETURN_SELECT_VERIFIED: false });
    const b = buildSnapshot(e.ctx, e.definition);
    return { e, b, est: estimateStart(e.ctx, b.snapshot, b.cells, saved ? e.definition.id : null) };
  }

  it('reads 10 date pairs at spacing + 25 s a page (550 s at the defaults): in seconds, never in totalCalls', () => {
    const { est } = flightEstimate(15);
    expect(est.flightLists).toEqual({ pairs: 10, pages: 10, seconds: 550, returns: false });
    const grid = est.perProvider.find((p) => p.providerId === 'camoufox');
    expect(est.totalCalls).toBe(grid?.calls);
    expect(est.seconds).toBe((grid?.seconds ?? 0) + 550);
    expect(est.assumptions).toContain('+ flights for up to 10 date pairs, about 9 minutes');
    expect(apiContract.estimateSchema.parse(est).flightLists).toEqual({
      pairs: 10,
      pages: 10,
      seconds: 550,
      returns: false,
    });
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
        returns: null,
      });
    const b = buildSnapshot(e.ctx, e.definition);
    expect(estimateStart(e.ctx, b.snapshot, b.cells, e.definition.id).flightLists?.pages).toBe(7);
    expect(estimateStart(e.ctx, b.snapshot, b.cells, null).flightLists?.pages).toBe(10);
  });

  // why: spec rev 65: the browser's pages, its flight pages too, count against no free-call cap
  it("the run's free-call limit never cuts the flight pairs: maxFreeCalls 15 after 100 grid pages still plans 10", () => {
    const { est } = flightEstimate(100, { maxFreeCalls: 15 });
    expect(est.flightLists).toEqual({ pairs: 10, pages: 10, seconds: 550, returns: false });
    expect(est.assumptions.some((a) => a.startsWith('flights for'))).toBe(false);
  });

  it('names no cap when the pairs wanted all fit the free calls left', () => {
    const { est } = flightEstimate(100, { maxFreeCalls: 120 });
    expect(est.flightLists?.pairs).toBe(10);
    expect(est.assumptions.some((a) => a.startsWith('flights for'))).toBe(false);
  });

  it('is carried through withBlocked (zero when the browser line is blocked) and addPass', () => {
    const { est } = flightEstimate(15);
    const blockedTp = withBlocked(est, new Map());
    expect(blockedTp.flightLists).toEqual({ pairs: 10, pages: 10, seconds: 550, returns: false });
    expect(blockedTp.seconds).toBe(est.seconds);
    const blocked = withBlocked(est, new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]));
    expect(blocked.flightLists).toEqual({ pairs: 0, pages: 0, seconds: 0, returns: false });
    expect(blocked.seconds).toBe(0);
    const twice = addPass(est, est);
    expect(twice.flightLists).toEqual({ pairs: 20, pages: 20, seconds: 1100, returns: false });
    expect(twice.seconds).toBe(2 * est.seconds);
  });

  // why: spec rev 64: the browser worker has no monthly cap, so its pages, flight pages included, ask no confirmation
  it('asks no soft confirmation for the browser pages, flight pages included', () => {
    const { e, est } = flightEstimate(120);
    expect(confirmationNeeded(e.ctx, est, new Set(), { pence: null, calls: null })).toBeNull();
  });

  it('budgetFit lists no month scope for the browser worker, which has no cap on its month', () => {
    const { e } = flightEstimate(15, { scheduleCron: '0 5 * * 1' });
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    expect(fit.perScope.some((x) => x.scope === 'provider-month:camoufox')).toBe(false);
    expect(fit.fits).toBe(true);
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

  it('pages already loaded this month leave the flight line whole', () => {
    const { e, b } = flightEstimate(15);
    spendPages(e, 2000);
    expect(estimateStart(e.ctx, b.snapshot, b.cells, null).flightLists?.pages).toBe(10);
  });

  it('withBlocked drops the flight notes when it zeroes the flight pages', () => {
    const { est } = flightEstimate(120);
    expect(est.assumptions.filter((a) => a.includes('flights for'))).toHaveLength(1);
    const blocked = withBlocked(est, new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]));
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

// Spec rev 56 §8.1 "Estimate" (R-estimate; ruling D6): with the worker's RETURN_SELECT_VERIFIED the flight
// line plans each pair out and back: typically 1.5 pages and 230 s (150 s without the booking read), at most 2 pages and
// 285 s (205 s); free calls count requests (one a pair). Exact fits at the defaults (90 s page, 30 s spacing).
describe('the estimate flight line with the return leg (spec rev 56 §8.1)', () => {
  const BOTH = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };
  function returnsEstimate(
    cells: number,
    flags: Record<string, boolean> | null,
    o: Parameters<typeof engineWith>[1] = {},
  ) {
    const e = engineWith([stubCamoufox({ cells, flights: {} })], { rankedDatePairs: rankedPairs(15), ...o });
    if (flags !== null) e.ctx.workerFlags.set('camoufox', flags);
    const b = buildSnapshot(e.ctx, e.definition);
    return { e, b, est: estimateStart(e.ctx, b.snapshot, b.cells, null) };
  }

  it('4 pages at once: the pairs go in waves of 4, never quicker than their page starts spaced apart', () => {
    const at = (env: Record<string, string>, flags: Record<string, boolean>) =>
      returnsEstimate(15, flags, { env: { CAMOUFOX_PAGES_AT_ONCE: '4', ...env } }).est.flightLists;
    // why: at spacing 0, 3 waves of one request: 3 × 25 s outbound-only; 3 × 185 s typical, 3 × 225 s at most
    expect(at({ CAMOUFOX_MIN_SPACING_SECONDS: '0' }, { RETURN_SELECT_VERIFIED: false })).toEqual({
      pairs: 10,
      pages: 10,
      seconds: 75,
      returns: false,
    });
    expect(at({ CAMOUFOX_MIN_SPACING_SECONDS: '0' }, BOTH)).toEqual({
      pairs: 10,
      pages: 15,
      seconds: 555,
      pagesMax: 20,
      secondsMax: 675,
      returns: true,
    });
    // why: at the default 30 s spacing, 10 outbound pages start 30 s apart: 300 s, longer than 3 waves of 55 s
    expect(at({}, { RETURN_SELECT_VERIFIED: false })).toEqual({
      pairs: 10,
      pages: 10,
      seconds: 300,
      returns: false,
    });
  });

  it('both flags: 10 pairs, usually 15 pages and 2,300 s, at most 20 pages and 2,850 s', () => {
    const { est } = returnsEstimate(15, BOTH);
    expect(est.flightLists).toEqual({
      pairs: 10,
      pages: 15,
      seconds: 2300,
      pagesMax: 20,
      secondsMax: 2850,
      returns: true,
    });
    expect(est.assumptions).toContain(
      '+ flights, out and back, for up to 10 date pairs: usually about 15 pages and 38 minutes, at most 20 pages and 48 minutes',
    );
    expect(est.assumptions.some((a) => a.startsWith('+ flights for up to'))).toBe(false);
    const grid = est.perProvider.find((p) => p.providerId === 'camoufox');
    expect(est.seconds).toBe((grid?.seconds ?? 0) + 2300);
    expect(apiContract.estimateSchema.parse(est).flightLists).toEqual(est.flightLists);
  });

  it('without the booking flag: 150 s a pair (1,500 s), at most 205 s (2,050 s)', () => {
    const { est } = returnsEstimate(15, { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false });
    expect(est.flightLists).toEqual({
      pairs: 10,
      pages: 15,
      seconds: 1500,
      pagesMax: 20,
      secondsMax: 2050,
      returns: true,
    });
    expect(est.assumptions).toContain(
      '+ flights, out and back, for up to 10 date pairs: usually about 15 pages and 25 minutes, at most 20 pages and 34 minutes',
    );
  });

  it('21.6 review M5: an older 10-page snapshot with 5 pairs reused plans outbound-only, as the step plans it', () => {
    const e = engineWith([stubCamoufox({ cells: 15, flights: {} })], { rankedDatePairs: rankedPairs(15) });
    e.ctx.workerFlags.set('camoufox', BOTH);
    const b = buildSnapshot(e.ctx, e.definition);
    const snapshot = { ...b.snapshot, budget: { ...b.snapshot.budget, flightListPages: 10 } };
    const pairs = rankedPairs(5)({
      definitionId: e.definition.id,
      space: snapshot.resolved,
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
        returns: null,
      });
    // why: the plan judges the allowance over its 10 candidates (10 < 10 × 2: outbound-only), never over the 5 it reads
    const est = estimateStart(e.ctx, snapshot, b.cells, e.definition.id);
    expect(est.flightLists).toEqual({ pairs: 5, pages: 5, seconds: 275, returns: false });
  });

  it('with the return flag false: outbound-only, 10 pages and 550 s', () => {
    const { est } = returnsEstimate(15, { RETURN_SELECT_VERIFIED: false, BOOKING_SELECT_VERIFIED: true });
    expect(est.flightLists).toEqual({ pairs: 10, pages: 10, seconds: 550, returns: false });
    expect(est.assumptions).toContain('+ flights for up to 10 date pairs, about 9 minutes');
  });

  // why: final review B-M3 (prov-008, 21.6 N2): the run's own preflight may set the flags and plan 2 pages a pair, so
  // while they are unread the estimate counts the whole return phase, booking read included: it never understates
  it('with the flags unread: the return phase with the booking read assumed (the bound), as with both flags', () => {
    const { est } = returnsEstimate(15, null);
    expect(est.flightLists).toEqual(returnsEstimate(15, BOTH).est.flightLists);
    expect(est.flightLists).toMatchObject({ pairs: 10, pagesMax: 20, secondsMax: 2850, returns: true });
  });

  // why: spec rev 65: the browser's pages, its flight pages too, count against no free-call cap
  it('the free-call limit never cuts the out-and-back pairs: maxFreeCalls 15 after 100 grid pages plans all 10', () => {
    const { est } = returnsEstimate(100, BOTH, { maxFreeCalls: 15 });
    expect(est.flightLists).toEqual({
      pairs: 10,
      pages: 15,
      seconds: 2300,
      pagesMax: 20,
      secondsMax: 2850,
      returns: true,
    });
    expect(est.assumptions.some((a) => a.startsWith('flights for'))).toBe(false);
  });

  it('a blocked browser line drops the out-and-back clause', () => {
    const { est } = returnsEstimate(15, BOTH);
    expect(est.assumptions.filter((a) => a.includes('flights'))).toHaveLength(1);
    const blocked = withBlocked(est, new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]));
    expect(blocked.assumptions.filter((a) => a.includes('flights'))).toEqual([]);
    // why: 21.7 code I1: a blocked line reads no pair, so none goes out and back; its bound is kept (the plan's)
    expect(blocked.flightLists).toEqual({
      pairs: 0,
      pages: 0,
      seconds: 0,
      pagesMax: 0,
      secondsMax: 0,
      returns: false,
    });
  });

  it('21.7 code I1: summing a pass with no pair out and back keeps its bound and states no return leg', () => {
    // why: a blocked browser line reads no pair, so none goes out and back
    const none = withBlocked(
      returnsEstimate(15, BOTH).est,
      new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]),
    );
    expect(addPass(none, none).flightLists).toEqual({
      pairs: 0,
      pages: 0,
      seconds: 0,
      pagesMax: 0,
      secondsMax: 0,
      returns: false,
    });
  });

  it('addPass sums every figure', () => {
    const { est } = returnsEstimate(15, BOTH);
    expect(addPass(est, est).flightLists).toEqual({
      pairs: 20,
      pages: 30,
      seconds: 4600,
      pagesMax: 40,
      secondsMax: 5700,
      returns: true,
    });
  });

  it('D5: the browser window carries one return-phase request (780 s, 600 s without the booking read) as margin', () => {
    expect(
      flightWindowMarginSeconds(returnsEstimate(15, BOTH).e.ctx, returnsEstimate(15, BOTH).est, null),
    ).toBe(780);
    const returnsOnly = returnsEstimate(15, { RETURN_SELECT_VERIFIED: true });
    expect(flightWindowMarginSeconds(returnsOnly.e.ctx, returnsOnly.est, null)).toBe(600);
    const outbound = returnsEstimate(15, { RETURN_SELECT_VERIFIED: false });
    expect(flightWindowMarginSeconds(outbound.e.ctx, outbound.est, null)).toBe(0);
    // why: final review B-M3: with the flags unread the margin is the bound's, the booking read included
    const unread = returnsEstimate(15, null);
    expect(flightWindowMarginSeconds(unread.e.ctx, unread.est, null)).toBe(780);
    const none = returnsEstimate(15, BOTH);
    const blocked = withBlocked(
      none.est,
      new Map([[lineKey('discovery', 'camoufox'), 'provider-execution']]),
    );
    expect(flightWindowMarginSeconds(none.e.ctx, blocked, null)).toBe(0);
  });

  it("21.6 review M2: a resume's margin follows the stored plan's booking read, not the flags (none read after a restart)", () => {
    const { est } = returnsEstimate(15, BOTH);
    // why: a new process has read no worker yet: the flags are unread, the stored plan still reads the booking options
    const restarted = returnsEstimate(15, null).e.ctx;
    const plan = {
      planned: 10,
      cells: [],
      reused: 0,
      ended: null,
      returns: true,
      booking: true,
      returnsStopped: null,
      bookingStopped: null,
    };
    expect(flightWindowMarginSeconds(restarted, est, plan)).toBe(780);
    expect(flightWindowMarginSeconds(restarted, est, { ...plan, bookingStopped: 'expand-failed' })).toBe(600);
    // and the other way: flags with the booking read on, a stored plan without it
    expect(flightWindowMarginSeconds(returnsEstimate(15, BOTH).e.ctx, est, { ...plan, booking: false })).toBe(
      600,
    );
    // with no stored plan the flags decide: none read yet assumes the booking read (final review B-M3: the bound)
    expect(flightWindowMarginSeconds(restarted, est, null)).toBe(780);
    // a provider with no flights request seconds has no margin
    const noSeconds = {
      ...restarted,
      limitsOf: (id: Parameters<typeof restarted.limitsOf>[0]) => ({
        ...restarted.limitsOf(id),
        flightRequestSeconds: null,
      }),
    };
    expect(flightWindowMarginSeconds(noSeconds, est, plan)).toBe(0);
  });

  it('estimateRemaining plans the same per planned flight cell left, from the stored plan', async () => {
    const cam = stubCamoufox({
      cells: 15,
      preflight: { ok: true, flags: BOTH },
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
    expect(done.flightLists?.returns).toBe(true);
    expect(flightRows(e, r.executionId)).toHaveLength(4);
    expect(estimateRemainingFor(e.ctx, done, true).flightLists).toEqual({
      pairs: 6,
      pages: 9,
      seconds: 1380,
      pagesMax: 12,
      secondsMax: 1710,
      returns: true,
    });
    // why: a resumed pass keeps the stored plan's phase less what a transient end stopped, and never counts a planned
    // cell that departs today
    const plan = done.flightLists;
    if (plan === null) throw new Error('a stored plan');
    const resumedWith = (over: Partial<typeof plan>) =>
      estimateRemainingFor(e.ctx, { ...done, flightLists: { ...plan, ...over } }, true).flightLists;
    expect(resumedWith({ returnsStopped: 'not-settled' })).toEqual({
      pairs: 6,
      pages: 6,
      seconds: 330,
      returns: false,
    });
    expect(resumedWith({ bookingStopped: 'expand-failed' })).toEqual({
      pairs: 6,
      pages: 9,
      seconds: 900,
      pagesMax: 12,
      secondsMax: 1230,
      returns: true,
    });
    const first = plan.cells[0];
    if (first === undefined) throw new Error('a planned cell');
    const departing = { ...first, departureDate: e.ctx.clock.todayLondon() };
    expect(resumedWith({ cells: [...plan.cells, departing] })?.pairs).toBe(6);
  });
});
