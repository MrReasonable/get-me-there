import { BudgetExceeded, type BudgetGuard, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { BudgetConfig } from '../src/budgetConfig.js';
import { SqliteBudgetGuard } from '../src/budgetGuard.js';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { count, freshDb, openTracked, sqliteCode, T0, tmpDbPath } from './helpers/db.js';
import { budgetConfig, limits, rawExecution } from './helpers/factories.js';

type Req = Parameters<BudgetGuard['reserve']>[0];
const sub40 = limits({ planFixedMicroGbp: 32_000_000 });
const perCall = limits({ costPerCallMicroGbp: 3200 });
const tp = limits({ billable: false, monthlyCallCap: 50_000 });
const fixture = limits({ costPerCallMicroGbp: 3200 });
const trial = limits({ window: 'lifetime', monthlyCallCap: 100, trialUsed: 9 }); // effective lifetime cap 91
const req = (providerId: Req['providerId'], executionId: string | null, costMicroGbp = 0): Req => ({
  providerId,
  executionId,
  tileIndex: null,
  costMicroGbp,
  httpAttempt: 1,
  endpointPath: '/api/v1/search',
});
const ok = { outcome: 'ok', httpStatus: 200, durationMs: 1 } as const;

/** test-007: a refused reserve throws the expected breach and changes neither the ledger nor any usage figure. */
function expectRefused(
  guard: SqliteBudgetGuard,
  db: ReturnType<typeof freshDb>,
  r: Req,
  match: object,
): void {
  const rows = count(db, 'provider_requests');
  const before = guard.usage({ kind: 'global-month' });
  expect(() => guard.reserve(r)).toThrow(expect.objectContaining(match));
  expect(count(db, 'provider_requests')).toBe(rows);
  expect(guard.usage({ kind: 'global-month' })).toEqual(before);
}

describe('cost rule (ruling 6): the configured rate is the only cost the ledger accepts', () => {
  it('refuses a cost that differs from the provider rate, in both directions, writing nothing', () => {
    const db = freshDb();
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: perCall, travelpayouts: tp }, { monthlyCapMicroGbp: 1_000_000_000 }),
      fixedClock(T0),
    );
    expect(() => guard.reserve(req('searchapi', null, 0))).toThrow(expect.objectContaining({ rule: 'cost' })); // per-call plan, cost 0
    expect(() => guard.reserve(req('travelpayouts', null, 1))).toThrow(
      expect.objectContaining({ rule: 'cost' }),
    ); // free vendor, cost 1
    expect(count(db, 'provider_requests')).toBe(0);
  });
});

describe('billable rule at finalise (spec §5.3, cost-004)', () => {
  it.each([
    // provider, outcome, status, → stored billable, stored cost_micro_gbp, counted in provider scope, counted in global
    ['travelpayouts', 'ok', 200, 0, 0, 1, 0],
    ['fixture', 'ok', 200, 1, 3200, 1, 1],
    ['fixture', 'error', 500, 0, 0, 0, 0],
    ['searchapi', 'ok', 204, 0, 0, 0, 0],
    ['searchapi', 'ok', 200, 1, 3200, 1, 1],
    ['searchapi', 'unknown', undefined, 0, 3200, 1, 1],
  ] as const)(
    '%s %s %s → billable %i, stored cost %i',
    (providerId, outcome, httpStatus, billable, cost, inProvider, inGlobal) => {
      const db = freshDb();
      const guard = new SqliteBudgetGuard(
        db,
        budgetConfig(
          { travelpayouts: tp, fixture, searchapi: perCall },
          { monthlyCapMicroGbp: 1_000_000_000 },
        ),
        fixedClock(T0),
      );
      const rate = providerId === 'travelpayouts' ? 0 : 3200;
      guard
        .reserve(req(providerId, null, rate))
        .finalise(
          httpStatus === undefined ? { outcome, durationMs: 1 } : { outcome, httpStatus, durationMs: 1 },
        );
      expect(db.raw.prepare('SELECT billable, cost_micro_gbp AS cost FROM provider_requests').get()).toEqual({
        billable,
        cost,
      });
      expect(guard.usage({ kind: 'provider-month', providerId }).calls).toBe(inProvider);
      expect(guard.usage({ kind: 'global-month' }).calls).toBe(inGlobal);
    },
  );
});

describe('cap predicates (spec §5.3)', () => {
  it('provider scope: pending and unknown count against a billed provider; error rows do not', () => {
    const db = freshDb();
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig(
        { searchapi: limits({ monthlyCallCap: 3, costPerCallMicroGbp: 3200 }) },
        { monthlyCapMicroGbp: 1_000_000_000 },
      ),
      fixedClock(T0),
    );
    guard.reserve(req('searchapi', null, 3200)); // left pending
    guard.reserve(req('searchapi', null, 3200)).finalise({ outcome: 'unknown', durationMs: 60_000 });
    guard
      .reserve(req('searchapi', null, 3200))
      .finalise({ outcome: 'error', httpStatus: 500, durationMs: 5 });
    expect(guard.usage({ kind: 'provider-month', providerId: 'searchapi' }).calls).toBe(2);
    guard.reserve(req('searchapi', null, 3200)).finalise(ok);
    expectRefused(guard, db, req('searchapi', null, 3200), { scope: 'provider-month', cap: 3, current: 3 });
  });

  it('global scope: pending and unknown count at full cost; error, free-vendor and cache-hit rows add nothing', () => {
    const db = freshDb();
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: perCall, travelpayouts: tp }, { monthlyCapMicroGbp: 12_800 }),
      fixedClock(T0),
    );
    guard.reserve(req('searchapi', null, 3200)); // pending: 3,200
    guard.reserve(req('searchapi', null, 3200)).finalise({ outcome: 'unknown', durationMs: 1 }); // 6,400
    guard
      .reserve(req('searchapi', null, 3200))
      .finalise({ outcome: 'error', httpStatus: 503, durationMs: 1 }); // 0
    guard.reserve(req('travelpayouts', null)).finalise(ok);
    guard.recordCacheHit({
      providerId: 'searchapi',
      executionId: null,
      tileIndex: null,
      endpointPath: '/api/v1/search',
    });
    expect(guard.usage({ kind: 'global-month' })).toMatchObject({ calls: 2, costMicroGbp: 6400 });
    guard.reserve(req('searchapi', null, 3200)).finalise(ok); // 9,600
    guard.reserve(req('searchapi', null, 3200)).finalise(ok); // 12,800: at the cap exactly
    expectRefused(guard, db, req('searchapi', null, 3200), {
      scope: 'global-month',
      cap: 12_800,
      current: 12_800,
      requested: 3200,
    });
  });

  it('global fee counts once per enabled subscription provider; with no subscription provider configured the fee is 0', () => {
    const db = freshDb();
    const withFee = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: sub40, travelpayouts: tp }, { monthlyCapMicroGbp: 3_000_000 }),
      fixedClock(T0),
    );
    expect(withFee.usage({ kind: 'global-month' })).toMatchObject({
      calls: 0,
      costMicroGbp: 32_000_000,
      cap: 3_000_000,
    });
    for (let i = 0; i < 5; i++) withFee.reserve(req('searchapi', null, 0)).finalise(ok); // zero-cost calls pass although the fee alone exceeds the cap
    expect(withFee.usage({ kind: 'global-month' })).toMatchObject({ calls: 5, costMicroGbp: 32_000_000 });
    const feePlusRate = new SqliteBudgetGuard(
      db,
      budgetConfig(
        { searchapi: limits({ planFixedMicroGbp: 32_000_000, costPerCallMicroGbp: 1 }) },
        { monthlyCapMicroGbp: 3_000_000 },
      ),
      fixedClock(T0),
    );
    expectRefused(feePlusRate, db, req('searchapi', null, 1), {
      scope: 'global-month',
      current: 32_000_000,
      requested: 1,
    });
    expect(
      new SqliteBudgetGuard(freshDb(), budgetConfig({ travelpayouts: tp }), fixedClock(T0)).usage({
        kind: 'global-month',
      }).costMicroGbp,
    ).toBe(0);
  });

  it('execution scopes: billed and free counted separately; pending and unknown count; error and cache hits do not', () => {
    const db = freshDb();
    const { executionId } = rawExecution(db, { maxCalls: 3, maxFreeCalls: 3, maxCostMicroGbp: 0 });
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: sub40, travelpayouts: tp }, { monthlyCapMicroGbp: 35_000_000 }),
      fixedClock(T0),
    );
    for (let i = 0; i < 3; i++) guard.reserve(req('travelpayouts', executionId)).finalise(ok);
    expectRefused(guard, db, req('travelpayouts', executionId), {
      scope: 'execution-free-calls',
      cap: 3,
      current: 3,
    });
    guard.reserve(req('searchapi', executionId)); // pending
    guard
      .reserve(req('searchapi', executionId))
      .finalise({ outcome: 'error', httpStatus: 500, durationMs: 1 }); // not counted
    guard.recordCacheHit({
      providerId: 'searchapi',
      executionId,
      tileIndex: null,
      endpointPath: '/api/v1/search',
    }); // not counted
    guard.reserve(req('searchapi', executionId)).finalise({ outcome: 'unknown', durationMs: 1 });
    guard.reserve(req('searchapi', executionId)).finalise(ok);
    expectRefused(guard, db, req('searchapi', executionId), { scope: 'execution-calls', cap: 3, current: 3 });
    expect(guard.usage({ kind: 'execution-calls', executionId })).toMatchObject({
      calls: 3,
      cap: 3,
      windowStart: null,
    });
    expect(guard.usage({ kind: 'execution-free-calls', executionId })).toMatchObject({ calls: 3, cap: 3 });
    expect(guard.usage({ kind: 'execution-cost', executionId })).toMatchObject({ costMicroGbp: 0, cap: 0 });
  });

  it('execution-cost: zero-cost calls pass a 0 cap on a 0-rate plan; a 3,200 rate is refused by a 0 cap; 6,400 allows two', () => {
    const db = freshDb();
    const zero = rawExecution(db, { maxCalls: 100, maxFreeCalls: 100, maxCostMicroGbp: 0 }).executionId;
    const some = rawExecution(db, { maxCalls: 100, maxFreeCalls: 100, maxCostMicroGbp: 6_400 }).executionId;
    const subGuard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: limits() }, { monthlyCapMicroGbp: 1_000_000_000 }),
      fixedClock(T0),
    );
    subGuard.reserve(req('searchapi', zero, 0)).finalise(ok);
    const perCallGuard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: perCall }, { monthlyCapMicroGbp: 1_000_000_000 }),
      fixedClock(T0),
    );
    expectRefused(perCallGuard, db, req('searchapi', zero, 3200), {
      scope: 'execution-cost',
      cap: 0,
      current: 0,
      requested: 3200,
    });
    perCallGuard.reserve(req('searchapi', some, 3200)).finalise(ok);
    perCallGuard.reserve(req('searchapi', some, 3200)).finalise(ok);
    expectRefused(perCallGuard, db, req('searchapi', some, 3200), {
      scope: 'execution-cost',
      current: 6_400,
    });
  });

  it('a child execution is capped by its own snapshot: CHILD_MAX_CALLS for calls, the inherited free and cost caps for the rest', () => {
    const db = freshDb();
    const { executionId } = rawExecution(
      db,
      { maxCalls: 6, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
      { isChild: true },
    );
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: sub40, travelpayouts: tp }, { monthlyCapMicroGbp: 35_000_000 }),
      fixedClock(T0),
    );
    for (let i = 0; i < 6; i++) guard.reserve(req('searchapi', executionId)).finalise(ok);
    expectRefused(guard, db, req('searchapi', executionId), { scope: 'execution-calls', cap: 6 });
    guard.reserve(req('travelpayouts', executionId)).finalise(ok); // inherited free allowance
  });

  it('a call cap of 0 refuses the first call', () => {
    const db = freshDb();
    expectRefused(
      new SqliteBudgetGuard(db, budgetConfig({ searchapi: limits({ monthlyCallCap: 0 }) }), fixedClock(T0)),
      db,
      req('searchapi', null),
      { scope: 'provider-month' },
    );
  });

  it('lifetime window: every row ever counts against the effective cap; the month scope reports cap null', () => {
    const db = freshDb();
    const insert = db.raw.prepare(
      `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, finished_at, outcome, billable, cost_micro_gbp, http_attempt, http_status, duration_ms) VALUES ('searchapi', '/api/v1/search', @at, @at, 'ok', 1, 0, 1, 200, 1)`,
    );
    for (const month of ['2026-08', '2026-09', '2026-10'])
      for (let i = 0; i < 30; i++) insert.run({ at: `${month}-02T00:00:00.000Z` });
    const guard = new SqliteBudgetGuard(db, budgetConfig({ searchapi: trial }), fixedClock(T0));
    expect(guard.usage({ kind: 'provider-lifetime', providerId: 'searchapi' })).toEqual({
      calls: 90,
      costMicroGbp: 0,
      cap: 91,
      windowStart: null,
      windowEnd: null,
    });
    guard.reserve(req('searchapi', null)).finalise(ok);
    expectRefused(guard, db, req('searchapi', null), { scope: 'provider-lifetime', cap: 91, current: 91 });
    expect(guard.usage({ kind: 'provider-month', providerId: 'searchapi' })).toMatchObject({
      calls: 31,
      cap: null,
      windowStart: '2026-10-01T00:00:00.000Z',
    });
    expect(
      new SqliteBudgetGuard(db, budgetConfig({ searchapi: sub40 }), fixedClock(T0)).usage({
        kind: 'provider-lifetime',
        providerId: 'searchapi',
      }),
    ).toMatchObject({ cap: null, windowStart: null });
  });

  it('fails closed: unconfigured provider, unknown execution, double finalise', () => {
    const db = freshDb();
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: sub40 }, { monthlyCapMicroGbp: 35_000_000 }),
      fixedClock(T0),
    );
    expect(() => guard.reserve(req('travelpayouts', null))).toThrow(/no budget configuration/);
    expect(() => guard.reserve(req('searchapi', 'no-such-execution'))).toThrow(/no-such-execution/);
    const r = guard.reserve(req('searchapi', null));
    r.finalise(ok);
    expect(() => r.finalise(ok)).toThrow(/already finalised/);
    expect(count(db, 'provider_requests')).toBe(1);
  });

  it('endpoint_path is a path only, on both writers and in SQL (sec-002, test-006)', () => {
    const db = freshDb();
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig({ searchapi: sub40 }, { monthlyCapMicroGbp: 35_000_000 }),
      fixedClock(T0),
    );
    for (const bad of ['/x?api_key=SECRET', '//h/x', '/x#t', '/x@y', 'x', '/a b']) {
      expect(() => guard.reserve({ ...req('searchapi', null), endpointPath: bad })).toThrow(
        expect.objectContaining({ rule: 'endpoint-path' }),
      );
      expect(() =>
        guard.recordCacheHit({
          providerId: 'searchapi',
          executionId: null,
          tileIndex: null,
          endpointPath: bad,
        }),
      ).toThrow(expect.objectContaining({ rule: 'endpoint-path' }));
    }
    const raw = (path: string) => () =>
      db.raw
        .prepare(
          `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('searchapi', ?, ?, 'ok', 0, 1)`,
        )
        .run(path, T0);
    expect(sqliteCode(raw('/x?api_key=SECRET'))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(raw('no-leading-slash'))).toBe('SQLITE_CONSTRAINT_CHECK');
    for (const bad of ['//h/x', '/x#t', '/x@y', `/${'a'.repeat(200)}`])
      expect(sqliteCode(raw(bad)), bad).toBe('SQLITE_CONSTRAINT_CHECK');
    raw(`/${'a'.repeat(199)}`)(); // 200 characters: the longest path allowed
    expect(count(db, 'provider_requests')).toBe(1);
  });

  it('every ledger row carries tile_index as given, NULL for verification (spec §5.3)', () => {
    const db = freshDb();
    const guard = new SqliteBudgetGuard(db, budgetConfig({ travelpayouts: tp }), fixedClock(T0));
    guard.reserve({ ...req('travelpayouts', null), tileIndex: 4 }).finalise(ok);
    guard.recordCacheHit({
      providerId: 'travelpayouts',
      executionId: null,
      tileIndex: 5,
      endpointPath: '/aviasales/v3/prices_for_dates',
    });
    guard.reserve(req('travelpayouts', null)).finalise(ok);
    expect(db.raw.prepare('SELECT tile_index AS t FROM provider_requests ORDER BY id').all()).toEqual([
      { t: 4 },
      { t: 5 },
      { t: null },
    ]);
  });
});

describe('BEGIN IMMEDIATE: the predicates run under the write lock (spec §7, cost-001, test-004)', () => {
  /** Runs `probe` after the predicates and before the insert, inside reserve's transaction. */
  class ProbeGuard extends SqliteBudgetGuard {
    probe: () => void = () => undefined;
    protected override checkCaps(...args: Parameters<SqliteBudgetGuard['checkCaps']>): void {
      super.checkCaps(...args);
      this.probe();
    }
  }
  const fileDbs = () => {
    const path = tmpDbPath();
    const a = openTracked(path);
    applyMigrations(a, MIGRATIONS_DIR);
    const b = openTracked(path);
    b.raw.pragma('busy_timeout = 50');
    return { a, b };
  };
  const cfg: BudgetConfig = budgetConfig(
    { searchapi: limits({ monthlyCallCap: 1, costPerCallMicroGbp: 3200 }) },
    { monthlyCapMicroGbp: 1_000_000_000 },
  );

  it('while reserve is deciding, another connection cannot write: the lock is already held', () => {
    const { a, b } = fileDbs();
    const guard = new ProbeGuard(a, cfg, fixedClock(T0));
    let code: string | null = 'not probed';
    guard.probe = () => {
      code = sqliteCode(() =>
        b.raw
          .prepare(
            `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('searchapi', '/x', ?, 'pending', 3200, 1)`,
          )
          .run(T0),
      );
    };
    guard.reserve(req('searchapi', null, 3200));
    expect(code).toBe('SQLITE_BUSY');
    expect(count(a, 'provider_requests')).toBe(1);
  });

  it('a reserve on a second connection while the first holds the lock fails busy and inserts nothing', () => {
    const { a, b } = fileDbs();
    a.raw.prepare('BEGIN IMMEDIATE').run();
    expect(
      sqliteCode(() => new SqliteBudgetGuard(b, cfg, fixedClock(T0)).reserve(req('searchapi', null, 3200))),
    ).toBe('SQLITE_BUSY');
    a.raw.prepare('ROLLBACK').run();
    expect(count(a, 'provider_requests')).toBe(0);
  });

  it('two connections at a cap of one call: the second sees the first and is refused', () => {
    const { a, b } = fileDbs();
    new SqliteBudgetGuard(a, cfg, fixedClock(T0)).reserve(req('searchapi', null, 3200));
    expect(() => new SqliteBudgetGuard(b, cfg, fixedClock(T0)).reserve(req('searchapi', null, 3200))).toThrow(
      BudgetExceeded,
    );
    expect(count(a, 'provider_requests')).toBe(1);
  });
});
