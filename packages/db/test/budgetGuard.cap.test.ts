import { BudgetExceeded, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { SqliteBudgetGuard } from '../src/budgetGuard.js';
import { at, count, freshDb, T0 } from './helpers/db.js';
import { budgetConfig, limits } from './helpers/factories.js';

const COST = 3_200; // µGBP per call: 0.32p (spec §6.3)
const CAP = 300 * 10_000; // 300p in µGBP = 3,000,000
// A per-call SearchApi plan (no fixed fee): its configured rate is COST, the only cost reserve accepts.
const perCall = budgetConfig(
  { searchapi: limits({ costPerCallMicroGbp: COST }) },
  { monthlyCapMicroGbp: CAP },
);
const call = {
  providerId: 'searchapi',
  executionId: null,
  tileIndex: null,
  costMicroGbp: COST,
  httpAttempt: 1,
  endpointPath: '/api/v1/search',
} as const;

describe('SqliteBudgetGuard global-month cap in SQL (spec §5.3, §9 item 3)', () => {
  it('937 calls of 3,200 µGBP pass a 3,000,000 µGBP cap and the 938th throws global-month without writing a row', {
    timeout: 30_000,
  }, () => {
    const db = freshDb();
    const guard = new SqliteBudgetGuard(db, perCall, fixedClock(T0));
    for (let k = 1; k <= 937; k++)
      guard.reserve(call).finalise({ outcome: 'ok', httpStatus: 200, durationMs: 10 });
    expect(guard.usage({ kind: 'global-month' }).costMicroGbp).toBe(2_998_400);
    let thrown: unknown;
    try {
      guard.reserve(call);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BudgetExceeded);
    expect(thrown).toMatchObject({
      scope: 'global-month',
      cap: 3_000_000,
      current: 2_998_400,
      requested: 3_200,
    });
    expect(count(db, 'provider_requests')).toBe(937);
  });

  it('1,000 ledger rows at 3,200 µGBP (320p) trip a 300p cap in SQL', () => {
    const db = freshDb();
    const insert = db.raw.prepare(
      `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms, http_status, outcome, billable, cost_micro_gbp, http_attempt)
       VALUES ('searchapi', NULL, '/api/v1/search', NULL, @at, @at, 5, 200, 'ok', 1, 3200, 1)`,
    );
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) insert.run({ at: T0 });
    });
    const guard = new SqliteBudgetGuard(db, perCall, fixedClock(T0));
    expect(guard.usage({ kind: 'global-month' })).toMatchObject({
      calls: 1000,
      costMicroGbp: 3_200_000,
      cap: 3_000_000,
    });
    expect(() => guard.reserve(call)).toThrow(
      expect.objectContaining({ scope: 'global-month', current: 3_200_000, requested: 3_200 }),
    );
    expect(count(db, 'provider_requests')).toBe(1000);
  });
});

describe('recentCalls seeds the hourly limiter (core BudgetGuard port, cost-r2-001)', () => {
  it('counts every upstream attempt since `since` (inclusive) for one provider; cache hits, other providers and earlier rows excluded', () => {
    const db = freshDb();
    const insert = db.raw.prepare(
      `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, outcome, billable, cost_micro_gbp, http_attempt) VALUES (@p, NULL, '/x', NULL, @at, @outcome, 0, 0, 1)`,
    );
    const since = '2026-10-14T11:00:00.000Z';
    for (const outcome of ['pending', 'unknown', 'error', 'ok', 'cache_hit'])
      insert.run({ p: 'searchapi', at: since, outcome });
    insert.run({ p: 'searchapi', at: '2026-10-14T10:59:59.999Z', outcome: 'ok' }); // 1 ms before: excluded
    insert.run({ p: 'travelpayouts', at: T0, outcome: 'ok' });
    insert.run({ p: 'travelpayouts', at: T0, outcome: 'error' });
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig(
        {
          searchapi: limits({ costPerCallMicroGbp: COST }),
          travelpayouts: limits({ billable: false, costPerCallMicroGbp: 0 }),
        },
        { monthlyCapMicroGbp: CAP },
      ),
      fixedClock(T0),
    );
    expect(guard.recentCalls('searchapi', at(since))).toBe(4); // pending, unknown, error, ok
    expect(guard.recentCalls('travelpayouts', at(since))).toBe(2); // a free vendor is metered the same way
    expect(() => guard.recentCalls('fixture', at(since))).toThrow(/no budget configuration/);
  });
});
