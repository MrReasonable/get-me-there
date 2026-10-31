// Task 20.4 fix round 1: `estimateAsk` through a real engine (createEngine over the harness deps), the cap the guard
// reserves for other schedules, a date pair that lands in no bucket, and one plan for the estimate and its date pairs.
import { asIsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine.js';
import { askedPairs, billedCallsOf, monthlyPagesOf } from '../src/estimate.js';
import { lineKey } from '../src/lines.js';
import { buildSnapshot } from '../src/snapshot.js';
import {
  engineWith,
  stubCamoufox,
  stubSearchApiVerification,
  stubTravelpayouts,
} from './support/camoufox.js';
import { baseDefinition, EWR, JFK, LGW, LHR } from './support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});

const TODAY = asIsoDate('2026-10-14');
const DAY_MS = 24 * 3_600_000;

/** The worked example's space (LHR/LGW to JFK/EWR, 182 days, 10 to 21 nights: 8,736 cells) on the saved definition. */
function widen(e: ReturnType<typeof engineWith>) {
  return e.ctx.repos.definitions.update(e.definition.id, {
    origins: [LHR, LGW],
    destinations: [JFK, EWR],
    window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
    minNights: 10,
    maxNights: 21,
  });
}

describe('estimateAsk through a real engine', () => {
  it('a line the free-call cap blocks (8,736 Travelpayouts tiles against 1,000 free calls) asks about no date pair', () => {
    const e = engineWith([stubTravelpayouts({ cells: 1 })]);
    const def = widen(e);
    const engine = createEngine(e.deps);
    const est = engine.estimate(def, TODAY);
    // why: the guard's own check marks the line blocked; estimateAsk reads that mark from the estimate it is given
    expect(est.perProvider.map((p) => p.blocked !== null)).toEqual([true]);
    expect(engine.estimateAsk(def, TODAY, est)).toEqual({
      datePairs: 2184,
      datePairsCovered: 0,
      datePairsPartly: 0,
      datePairsReused: 0,
      billedCalls: [],
      monthlyPages: null,
    });
  });
});

describe('the pages a month has left, less what other schedules reserve (ruling 5)', () => {
  it('monthlyPagesOf subtracts the other scheduled search’s reservation, as checkBudget does: 1,500 - 200 = 1,300', () => {
    // why: the other search runs weekly (Mondays 19 and 26 October before the month's window closes on 1 November):
    // 2 firings; discovery runs min(2, ceil(423 h / (0.9 × 168 h))) = min(2, 3) = 2, 100 pages each = 200 reserved
    const e = engineWith([stubCamoufox({ cells: 1 })], { monthlyCap: 1500, scheduleCron: '0 5 * * 1' });
    widen(e); // the first search is the worked example too: 100 pages a weekly run
    const other = e.ctx.repos.definitions.create({
      ...baseDefinition(),
      providers: { discovery: ['camoufox'], verification: [], discoveryRefreshHours: { camoufox: 168 } },
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
      minNights: 10,
      maxNights: 21,
      scheduleCron: '0 5 * * 1',
      enabled: true,
    });
    const line = {
      providerId: 'camoufox' as const,
      stage: 'discovery' as const,
      calls: 100,
      planCalls: 100,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 7000,
      blocked: null,
    };
    expect(monthlyPagesOf(e.ctx, { perProvider: [line] }, other.id)).toEqual({
      planned: 100,
      left: 1500 - 200,
    });
    // why: each of the two searches is the other's "other schedule", so both see the same 200 reserved
    expect(monthlyPagesOf(e.ctx, { perProvider: [line] }, e.definition.id)).toEqual({
      planned: 100,
      left: 1500 - 200,
    });
  });
});

describe('the plan is cut by what other schedules leave of the month', () => {
  it('a month of 250 pages with 200 reserved for the other search plans 50 cells: 50 date pairs partly', () => {
    // why: same two weekly searches as above (200 pages reserved against either); 250 - 200 = 50 pages are left
    const e = engineWith([stubCamoufox({ cells: 1 })], { monthlyCap: 250, scheduleCron: '0 5 * * 1' });
    const def = widen(e);
    e.ctx.repos.definitions.create({
      ...baseDefinition(),
      providers: { discovery: ['camoufox'], verification: [], discoveryRefreshHours: { camoufox: 168 } },
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
      minNights: 10,
      maxNights: 21,
      scheduleCron: '0 5 * * 1',
      enabled: true,
    });
    const built = buildSnapshot(e.ctx, def);
    expect(askedPairs(e.ctx, built.snapshot, built.cells, def.id, new Set())).toMatchObject({
      datePairsCovered: 0,
      datePairsPartly: 50,
    });
  });
});

describe('a date pair in no bucket', () => {
  it('some airport pairs reused and none planned is neither covered, partly nor reused (the counts need not sum)', async () => {
    // why: a 5-day space priced from LHR only; LGW is then added and the Travelpayouts line is blocked, so each of the
    // 5 date pairs has its 2 LHR cells reused and its 2 LGW cells neither planned nor reused
    const e = engineWith([stubTravelpayouts({ cells: 5 })], { maxFreeCalls: 20_000 });
    e.ctx.repos.definitions.update(e.definition.id, { origins: [LHR], destinations: [JFK, EWR] });
    await e.runToEnd();
    e.clock.advance(DAY_MS);
    const def = e.ctx.repos.definitions.update(e.definition.id, { origins: [LHR, LGW] });
    const built = buildSnapshot(e.ctx, def);
    expect(built.cells).toHaveLength(20);
    const blocked = new Set([lineKey('discovery', 'travelpayouts')]);
    expect(askedPairs(e.ctx, built.snapshot, built.cells, def.id, blocked)).toEqual({
      datePairs: 5,
      datePairsCovered: 0,
      datePairsPartly: 0,
      datePairsReused: 0,
    });
    // unblocked, the 2 LGW cells of each date pair are planned: partly
    expect(askedPairs(e.ctx, built.snapshot, built.cells, def.id, new Set())).toEqual({
      datePairs: 5,
      datePairsCovered: 0,
      datePairsPartly: 5,
      datePairsReused: 0,
    });
  });
});

describe('one plan for the estimate and its date pairs', () => {
  it('estimateAsk after estimate plans no tile again when nothing is reusable', () => {
    const base = stubTravelpayouts({ cells: 3 });
    let plans = 0;
    const discovery = base.discovery;
    if (discovery === undefined) throw new Error('stub has discovery');
    const counted = {
      ...base,
      discovery: {
        ...discovery,
        plan: (q: Parameters<typeof discovery.plan>[0]) => {
          plans++;
          return discovery.plan(q);
        },
      },
    };
    const e = engineWith([counted]);
    const engine = createEngine(e.deps);
    const est = engine.estimate(e.definition, TODAY);
    const afterEstimate = plans;
    expect(afterEstimate).toBe(1); // one airport pair, planned once
    expect(engine.estimateAsk(e.definition, TODAY, est)).toMatchObject({ datePairs: 3, datePairsCovered: 3 });
    expect(plans).toBe(1);
  });
});

describe('the small space, read back through a real engine', () => {
  const day = 24 * 3_600_000;
  const run = async () => {
    // why: 5 departure days of one 10-night stay, 1 airport pair: 5 date pairs, 5 cells
    const e = engineWith([stubTravelpayouts({ cells: 5 })], { maxFreeCalls: 20_000 });
    await e.runToEnd();
    e.clock.advance(day);
    return e;
  };

  it('a space the last run priced is reused whole: 0 covered, 5 reused', async () => {
    const e = await run();
    const engine = createEngine(e.deps);
    const est = engine.estimate(e.definition, TODAY);
    expect(engine.estimateAsk(e.definition, TODAY, est)).toMatchObject({
      datePairs: 5,
      datePairsCovered: 0,
      datePairsPartly: 0,
      datePairsReused: 5,
    });
  });

  it('a space widened to a new airport asks about the new cells only: 5 date pairs, each partly (its 2 LHR cells reused)', async () => {
    const e = await run();
    // the run priced LHR to JFK and EWR (the stub's default origin); LGW is new
    const first = e.ctx.repos.definitions.get(e.definition.id);
    expect(first?.origins).toHaveLength(1);
    e.ctx.repos.definitions.update(e.definition.id, { destinations: [JFK, EWR] });
    const def = e.ctx.repos.definitions.update(e.definition.id, {
      origins: [...(first?.origins ?? []), LGW],
    });
    const engine = createEngine(e.deps);
    const est = engine.estimate(def, TODAY);
    const ask = engine.estimateAsk(def, TODAY, est);
    expect(ask.datePairs).toBe(5);
    // why: the plan is made over the cells not reused; the estimate's own plan (every cell) must not stand in for it
    expect(ask.datePairsCovered + ask.datePairsPartly + ask.datePairsReused).toBe(5);
    expect(ask.datePairsCovered).toBe(0);
  });

  it('the cells’ order does not matter: list mode plans the same 100 cells whatever order they are given', () => {
    const e = engineWith([stubCamoufox({ cells: 1 })]);
    const def = widen(e);
    const built = buildSnapshot(e.ctx, def);
    const forwards = askedPairs(e.ctx, built.snapshot, built.cells, null, new Set());
    const backwards = askedPairs(e.ctx, built.snapshot, [...built.cells].reverse(), null, new Set());
    expect(forwards).toEqual({
      datePairs: 2184,
      datePairsCovered: 0,
      datePairsPartly: 100,
      datePairsReused: 0,
    });
    expect(backwards).toEqual(forwards);
  });
});

describe('lines that plan nothing', () => {
  it('a provider that does not sell the cabin asks about nothing', () => {
    const e = engineWith([stubTravelpayouts({ cells: 3 })]);
    const def = e.ctx.repos.definitions.update(e.definition.id, { cabin: 'business' });
    const built = buildSnapshot(e.ctx, def);
    expect(askedPairs(e.ctx, built.snapshot, built.cells, null, new Set())).toMatchObject({
      datePairs: 3,
      datePairsCovered: 0,
      datePairsPartly: 0,
    });
  });

  it('a provider with verification only, listed for discovery, asks about nothing; the one that can still covers', () => {
    const e = engineWith([stubTravelpayouts({ cells: 3 }), stubSearchApiVerification()], {
      env: { SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' },
    });
    const def = e.ctx.repos.definitions.update(e.definition.id, {
      providers: { discovery: ['searchapi'], verification: [], discoveryRefreshHours: {} },
    });
    const built = buildSnapshot(e.ctx, def);
    expect(askedPairs(e.ctx, built.snapshot, built.cells, null, new Set())).toMatchObject({
      datePairs: 3,
      datePairsCovered: 0,
    });
  });

  it('a per-run page cap on a provider without page spacing does not cut it', () => {
    const e = engineWith([stubTravelpayouts({ cells: 30 })]);
    const built = buildSnapshot(e.ctx, e.definition);
    // why: only camoufox's snapshot carries a page cap; one is put on Travelpayouts to show spacing decides the cut
    const snapshot = {
      ...built.snapshot,
      budget: { ...built.snapshot.budget, providerMaxCalls: { travelpayouts: 10 } },
    };
    expect(askedPairs(e.ctx, snapshot, built.cells, null, new Set())).toMatchObject({ datePairsCovered: 30 });
  });
});

describe('what the month has left after the pages already used', () => {
  it('monthlyPagesOf and the plan are cut by the 3 pages a run already used: 5 - 3 = 2 left', async () => {
    const e = engineWith([stubCamoufox({ cells: 3 })], { monthlyCap: 5 });
    await e.runToEnd();
    const line = {
      providerId: 'camoufox' as const,
      stage: 'discovery' as const,
      calls: 3,
      planCalls: 3,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 1,
      blocked: null,
    };
    expect(monthlyPagesOf(e.ctx, { perProvider: [line] }, null)).toEqual({ planned: 3, left: 2 });
    const built = buildSnapshot(e.ctx, e.definition);
    // why: 3 cells, 2 pages left: the plan is cut at 2 cells, each its own date pair, on the one airport pair: covered 2
    expect(askedPairs(e.ctx, built.snapshot, built.cells, null, new Set())).toMatchObject({
      datePairs: 3,
      datePairsCovered: 2,
    });
  });

  it('monthlyPagesOf ignores a runnable line of another provider', () => {
    const e = engineWith([stubTravelpayouts({ cells: 3 })]);
    const line = {
      providerId: 'travelpayouts' as const,
      stage: 'discovery' as const,
      calls: 3,
      planCalls: 3,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 1,
      blocked: null,
    };
    expect(monthlyPagesOf(e.ctx, { perProvider: [line] }, null)).toBeNull();
  });

  it('billedCalls names the trial’s lifetime window and what is left of it: 100 - 9 used = 91', () => {
    const e = engineWith([stubTravelpayouts({ cells: 3 }), stubSearchApiVerification()], {
      env: { SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_TRIAL_USED: '9' },
    });
    const line = {
      providerId: 'searchapi' as const,
      stage: 'verification' as const,
      calls: 20,
      planCalls: 20,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 1,
      blocked: null,
    };
    expect(billedCallsOf(e.ctx, { perProvider: [line] }, null)).toEqual([
      { providerId: 'searchapi', calls: 20, left: 91, window: 'lifetime' },
    ]);
  });
});
