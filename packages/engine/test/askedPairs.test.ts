// Task 20.4 (spec §8.1 rev 55, §10 estimate response): the date pairs an estimate asks about. Every expected number is
// written out from the layout rule, never read back from the plan under test.
import { asIsoDate, asIsoDateTime, type BudgetGuard } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { callsLeftIn } from '../src/budgetCheck.js';
import { buildContext } from '../src/context.js';
import { askedPairs, billedCallsOf } from '../src/estimate.js';
import { type LineKey, lineKey } from '../src/lines.js';
import { buildSnapshot } from '../src/snapshot.js';
import { confirmationNeeded } from '../src/start.js';
import {
  engineWith,
  stubCamoufox,
  stubSearchApiVerification,
  stubTravelpayouts,
} from './support/camoufox.js';
import { createHarness, EWR, JFK, LGW, LHR } from './support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});

type Stubs = Parameters<typeof engineWith>[0];
type Options = Parameters<typeof engineWith>[1];

/**
 * The worked example: LHR/LGW to JFK/EWR (4 airport pairs), a window of 182 days (2026-11-02 to 2027-05-02) and stays
 * of 10 to 21 nights (12 stays): 182 × 12 = 2,184 date pairs, 4 × 2,184 = 8,736 cells.
 */
function worked(stubs: Stubs, o: Options = {}) {
  const e = engineWith(stubs, o);
  const def = e.ctx.repos.definitions.update(e.definition.id, {
    origins: [LHR, LGW],
    destinations: [JFK, EWR],
    window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
    minNights: 10,
    maxNights: 21,
    scheduleCron: '0 5 * * 1',
  });
  const built = buildSnapshot(e.ctx, def);
  expect(built.cells).toHaveLength(8736);
  return { e, def, built };
}
const asked = (
  w: ReturnType<typeof worked>,
  definitionId: string | null = null,
  blocked = new Set<LineKey>(),
) => askedPairs(w.e.ctx, w.built.snapshot, w.built.cells, definitionId, blocked);

describe('the date pairs an estimate asks about (Task 20.4)', () => {
  it('Travelpayouts tiles every cell: all 2,184 date pairs are covered, none partly', () => {
    const w = worked([stubTravelpayouts({ cells: 1 })]);
    expect(asked(w)).toEqual({
      datePairs: 2184,
      datePairsCovered: 2184,
      datePairsPartly: 0,
      datePairsReused: 0,
    });
  });

  it('camoufox list mode alone under a 100-page cap plans the first 100 cells, all on the first airport pair: 0 covered, 100 partly', () => {
    // why: planSingleCells yields cells in generation order (origin, destination, day, nights); the first 100 are
    // LHR-JFK's first 100 (departure, stay) cells, so each of their date pairs has 1 of its 4 airport pairs planned
    const w = worked([stubCamoufox({ cells: 1 })]);
    expect(asked(w)).toEqual({
      datePairs: 2184,
      datePairsCovered: 0,
      datePairsPartly: 100,
      datePairsReused: 0,
    });
  });

  /**
   * Grid mode at the defaults, derived by hand from the planner (packages/providers/src/camoufox/grid.ts):
   * - blocks are 7 × 7 views; 182 days of departures are 26 columns of 7, and a column's returns (offsets 0–17 from its
   *   first return) fall in 3 blocks holding 28, 46 and 10 cells (column total 7 × 12 = 84); so 78 blocks and 2,184
   *   cells an airport pair, 57 pages an airport pair in all;
   * - the run has 100 pages and 588 scrolls; 4 pairs share them, so each pair has 25 pages and 147 scrolls;
   * - a move between a column's blocks is 7 scrolls; joining 2 moves makes a 3-block page of 84 cells for 14 scrolls.
   *   147 scrolls allow 10 such pages (140) and 1 more move (7): an 11th page of 2 blocks (28 + 46 = 74 cells). Pages
   *   joining blocks are planned first;
   * - the other 14 of the 25 pages are single blocks in path order: 4 whole columns of 84 and 38 more (10 + 28);
   * - an airport pair therefore has 10 × 84 + 74 + 4 × 84 + 38 = 1,288 of its 2,184 cells planned, and 4 × 1,288 = 5,152
   *   of 8,736 over the four; the page cap of 100 is exactly the 4 × 25.
   * All four airport pairs plan the same date pairs, so every planned date pair has all 4 cells planned: 1,288 covered,
   * 0 partly.
   */
  it('camoufox grid mode at the defaults: 1,288 date pairs covered (5,152 of 8,736 cells), none partly', () => {
    const w = worked([stubCamoufox({ cells: 1, grid: { pageAllowance: 100, scrollAllowance: 588 } })]);
    expect(asked(w)).toEqual({
      datePairs: 2184,
      datePairsCovered: 1288,
      datePairsPartly: 0,
      datePairsReused: 0,
    });
  });

  it('a blocked camoufox line contributes nothing', () => {
    const w = worked([stubCamoufox({ cells: 1 })]);
    expect(asked(w, null, new Set([lineKey('discovery', 'camoufox')]))).toEqual({
      datePairs: 2184,
      datePairsCovered: 0,
      datePairsPartly: 0,
      datePairsReused: 0,
    });
  });

  it('a camoufox line is cut at its 100-page run cap, never by a month', () => {
    const w = worked([stubCamoufox({ cells: 1 })]);
    expect(asked(w, w.def.id)).toEqual({
      datePairs: 2184,
      datePairsCovered: 0,
      datePairsPartly: 100,
      datePairsReused: 0,
    });
  });

  it('two providers planning the same 50 date pairs count 50, not 100', () => {
    // why: one airport pair and 50 departure days of one stay: both providers plan all 50 cells
    const e = engineWith([stubTravelpayouts({ cells: 50 }), stubCamoufox({ cells: 50 })]);
    const built = buildSnapshot(e.ctx, e.definition);
    expect(built.cells).toHaveLength(50);
    expect(askedPairs(e.ctx, built.snapshot, built.cells, null, new Set())).toEqual({
      datePairs: 50,
      datePairsCovered: 50,
      datePairsPartly: 0,
      datePairsReused: 0,
    });
  });
});

describe('the billed calls of an estimate', () => {
  it('billedCalls lists a runnable line of a billable-plan provider with its month’s calls left; a free source has none', () => {
    // why: the $40 plan has a monthly call cap (10,000 calls, spec §5.3) and calls that cost nothing each
    const w = worked([stubCamoufox({ cells: 1 }), stubSearchApiVerification()], {
      env: { SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' },
    });
    const line = (providerId: 'camoufox' | 'searchapi', calls: number, blocked: string | null) => ({
      providerId,
      stage: providerId === 'camoufox' ? ('discovery' as const) : ('verification' as const),
      calls,
      planCalls: calls,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 1,
      blocked,
    });
    expect(
      billedCallsOf(
        w.e.ctx,
        { perProvider: [line('camoufox', 100, null), line('searchapi', 120, null)] },
        null,
      ),
    ).toEqual([{ providerId: 'searchapi', calls: 120, left: 10_000, window: 'month' }]);
    expect(billedCallsOf(w.e.ctx, { perProvider: [line('searchapi', 120, 'provider-month')] }, null)).toEqual(
      [],
    );
  });
});

/** The guard as it is, except that each answer it gives is passed through `over`. */
function guardWith(
  g: BudgetGuard,
  over: (u: ReturnType<BudgetGuard['usage']>) => ReturnType<BudgetGuard['usage']>,
): BudgetGuard {
  return {
    reserve: (p) => g.reserve(p),
    recordCacheHit: (p) => g.recordCacheHit(p),
    usage: (s) => over(g.usage(s)),
    recentCalls: (id, since) => g.recentCalls(id, since),
    scrollsLeft: (id, executionId) => g.scrollsLeft(id, executionId),
  };
}

describe('the calls a provider window has left (callsLeftIn, ruling 5)', () => {
  it('a billable-plan provider whose guard states no cap has no calls-left figure, never 0', () => {
    const w = worked([stubCamoufox({ cells: 1 }), stubSearchApiVerification()], {
      env: { SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' },
    });
    const ctx = { ...w.e.ctx, budget: guardWith(w.e.ctx.budget, (u) => ({ ...u, cap: null })) };
    const line = {
      providerId: 'searchapi' as const,
      stage: 'verification' as const,
      calls: 120,
      planCalls: 120,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 1,
      blocked: null,
    };
    expect(billedCallsOf(ctx, { perProvider: [line] }, null)).toEqual([
      { providerId: 'searchapi', calls: 120, left: null, window: 'month' },
    ]);
  });

  it('other schedules hold calls back from a monthly cap only: a lifetime cap keeps them all, whatever window end its guard states', () => {
    // why: a daily schedule's reservation over the month to 1 November is 9 calls (the prestart test derives it)
    const month = createHarness({ fixtureMonthlyCallCap: 20 });
    const own = month.createDefinition();
    month.createDefinition({ destinations: [EWR], scheduleCron: '0 5 * * *' });
    expect(callsLeftIn(buildContext(month.deps, month.options), 'fixture', own.id)).toBe(11);
    const lifetime = createHarness({ fixtureMonthlyCallCap: 20, fixtureWindow: 'lifetime' });
    const def = lifetime.createDefinition();
    lifetime.createDefinition({ destinations: [EWR], scheduleCron: '0 5 * * *' });
    const ctx = buildContext(lifetime.deps, lifetime.options);
    // why: the harness sets the lifetime window on the guard's entry only; the context reads its cap kind from config
    const kinds = {
      ...ctx,
      limitsOf: (id: Parameters<typeof ctx.limitsOf>[0]) => ({
        ...ctx.limitsOf(id),
        capKind: 'provider-lifetime' as const,
      }),
    };
    expect(callsLeftIn(kinds, 'fixture', def.id)).toBe(20);
    const ended = guardWith(ctx.budget, (u) => ({
      ...u,
      windowEnd: asIsoDateTime('2026-11-01T00:00:00.000Z'),
    }));
    expect(callsLeftIn({ ...kinds, budget: ended }, 'fixture', def.id)).toBe(20);
  });
});

describe('confirmationNeeded states its reason as a code with figures (ruling A22)', () => {
  const none = { pence: null, calls: null };
  const line = (providerId: 'camoufox' | 'searchapi', calls: number, costMicroGbp: number) => ({
    providerId,
    stage: 'discovery' as const,
    calls,
    planCalls: calls,
    costMicroGbp,
    costPence: Math.ceil(costMicroGbp / 10_000),
    seconds: 1,
    blocked: null,
  });
  const estimateOf = (perProvider: ReturnType<typeof line>[]) => ({
    cells: 1,
    perProvider,
    totalCalls: 0,
    totalPlanCalls: 0,
    totalCostMicroGbp: 0,
    totalCostPence: 0,
    seconds: 0,
    assumptions: [],
    windowClamped: false,
    retryFactor: 1,
  });
  const ctxWith = (cap: number | null, kind: 'provider-month' | 'provider-lifetime' = 'provider-month') => ({
    config: {
      spend: { ...engineWith([stubCamoufox({ cells: 1 })]).ctx.config.spend, softConfirmMicroGbp: 1_000_000 },
    },
    budget: {
      usage: () => ({
        calls: 0,
        costMicroGbp: 0,
        cap,
        windowUsed: false,
        windowStart: null,
        windowEnd: null,
      }),
    },
    limitsOf: () => ({ capKind: kind }),
  });

  it('a cost above the threshold is `cost` with the estimate and the threshold in pence', () => {
    const r = confirmationNeeded(
      ctxWith(null),
      estimateOf([line('searchapi', 10, 1_200_000)]),
      new Set(),
      none,
    );
    expect(r?.why).toEqual({ reason: 'cost', estimatePence: 120, thresholdPence: 100 });
  });

  it('calls above a fifth of a monthly cap are `call-share` with the provider, its calls, cap and window', () => {
    const r = confirmationNeeded(ctxWith(10_000), estimateOf([line('searchapi', 2001, 0)]), new Set(), none);
    expect(r?.why).toEqual({
      reason: 'call-share',
      providerId: 'searchapi',
      calls: 2001,
      cap: 10_000,
      window: 'month',
    });
  });

  it('a lifetime cap says so', () => {
    const r = confirmationNeeded(
      ctxWith(91, 'provider-lifetime'),
      estimateOf([line('searchapi', 20, 0)]),
      new Set(),
      none,
    );
    expect(r?.why).toEqual({
      reason: 'call-share',
      providerId: 'searchapi',
      calls: 20,
      cap: 91,
      window: 'lifetime',
    });
  });

  it('a free search within its caps needs no confirmation', () => {
    expect(
      confirmationNeeded(ctxWith(10_000), estimateOf([line('searchapi', 2000, 0)]), new Set(), none),
    ).toBeNull();
  });
});
