import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { SqliteBudgetGuard } from '../src/budgetGuard.js';
import { LedgerRepo } from '../src/repositories/ledger.js';
import { at, freshDb, T0 } from './helpers/db.js';
import { budgetConfig, limits, rawExecution } from './helpers/factories.js';

const cfg = budgetConfig(
  {
    searchapi: limits({ costPerCallMicroGbp: 3200 }),
    travelpayouts: limits({ billable: false, monthlyCallCap: 50_000 }),
  },
  { monthlyCapMicroGbp: 1_000_000_000 },
);
const ok = { outcome: 'ok', httpStatus: 200, durationMs: 1 } as const;

describe('LedgerRepo (spec §5.3, §7, §8.1 parity)', () => {
  it('sweepPending: pending rows older than the cutoff become unknown and stay counted', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const guard = new SqliteBudgetGuard(db, cfg, clock);
    guard.reserve({
      providerId: 'searchapi',
      executionId: null,
      tileIndex: null,
      costMicroGbp: 3200,
      httpAttempt: 1,
      endpointPath: '/s',
    }); // 12:00, left pending
    clock.advance(9 * 60_000);
    guard.reserve({
      providerId: 'searchapi',
      executionId: null,
      tileIndex: null,
      costMicroGbp: 3200,
      httpAttempt: 1,
      endpointPath: '/s',
    }); // 12:09
    expect(new LedgerRepo(db).sweepPending(at('2026-10-14T12:01:00.000Z'))).toBe(1); // boot 12:11 − 10 min
    expect(db.raw.prepare('SELECT outcome FROM provider_requests ORDER BY id').all()).toEqual([
      { outcome: 'unknown' },
      { outcome: 'pending' },
    ]);
    expect(guard.usage({ kind: 'provider-month', providerId: 'searchapi' })).toMatchObject({
      calls: 2,
      costMicroGbp: 6400,
    });
  });

  it('answeredFor: upstream attempts that recorded an HTTP status, per (provider, endpoint, status); never cache hits, pending rows or socket errors (smoke ledger check, WP13 cost M2)', () => {
    const db = freshDb();
    const { executionId } = rawExecution(db, { maxCalls: 100, maxFreeCalls: 100, maxCostMicroGbp: 100_000 });
    const guard = new SqliteBudgetGuard(db, cfg, fixedClock(T0));
    const reserve = (providerId: 'travelpayouts' | 'searchapi', endpointPath: string, httpAttempt = 1) =>
      guard.reserve({
        providerId,
        executionId,
        tileIndex: providerId === 'travelpayouts' ? 0 : null,
        costMicroGbp: providerId === 'searchapi' ? 3200 : 0,
        httpAttempt,
        endpointPath,
      });
    reserve('travelpayouts', '/p').finalise({ outcome: 'error', httpStatus: 500, durationMs: 1 }); // retried
    reserve('travelpayouts', '/p', 2).finalise(ok);
    reserve('searchapi', '/s').finalise(ok);
    reserve('searchapi', '/s').finalise(ok);
    reserve('searchapi', '/s').finalise({ outcome: 'error', durationMs: 1 }); // socket error
    reserve('searchapi', '/s'); // left pending
    guard.recordCacheHit({ providerId: 'travelpayouts', executionId, tileIndex: 1, endpointPath: '/p' });
    expect(new LedgerRepo(db).answeredFor(executionId)).toEqual([
      { providerId: 'searchapi', endpointPath: '/s', httpStatus: 200, attempts: 2 },
      { providerId: 'travelpayouts', endpointPath: '/p', httpStatus: 200, attempts: 1 },
      { providerId: 'travelpayouts', endpointPath: '/p', httpStatus: 500, attempts: 1 },
    ]);
    expect(new LedgerRepo(db).answeredFor('no-such-execution')).toEqual([]);
  });

  it('countsFor: upstream calls, cost, first-attempt upstream tiles and cache hits, total and per (provider, stage)', () => {
    const db = freshDb();
    const { executionId } = rawExecution(db, { maxCalls: 100, maxFreeCalls: 100, maxCostMicroGbp: 100_000 });
    const guard = new SqliteBudgetGuard(db, cfg, fixedClock(T0));
    const tp = (tileIndex: number, httpAttempt: number) =>
      guard
        .reserve({
          providerId: 'travelpayouts',
          executionId,
          tileIndex,
          costMicroGbp: 0,
          httpAttempt,
          endpointPath: '/p',
        })
        .finalise(ok);
    tp(0, 1);
    tp(0, 1); // tile 0, two pages
    tp(1, 1);
    tp(1, 2); // tile 1, one retry
    guard.recordCacheHit({ providerId: 'travelpayouts', executionId, tileIndex: 2, endpointPath: '/p' }); // tile 2 answered by the cache
    guard
      .reserve({
        providerId: 'searchapi',
        executionId,
        tileIndex: null,
        costMicroGbp: 3200,
        httpAttempt: 1,
        endpointPath: '/s',
      })
      .finalise(ok);
    const ledger = new LedgerRepo(db);
    const c = ledger.countsFor(executionId);
    expect([c.calls, c.costMicroGbp, c.tiles, c.cacheHits]).toEqual([5, 3200, 2, 1]); // parity = tiles + cacheHits = 3
    expect(c.perProvider).toEqual([
      {
        providerId: 'searchapi',
        stage: 'verification',
        calls: 1,
        costMicroGbp: 3200,
        tiles: 0,
        cacheHits: 0,
        scrolls: 0,
      },
      {
        providerId: 'travelpayouts',
        stage: 'discovery',
        calls: 4,
        costMicroGbp: 0,
        tiles: 2,
        cacheHits: 1,
        scrolls: 0,
      },
    ]);
    expect(ledger.firstAttemptTiles(executionId, 'travelpayouts')).toBe(2);
    expect(ledger.firstAttemptTiles(executionId, 'searchapi')).toBe(0);
    expect(ledger.countsFor('none')).toEqual({
      calls: 0,
      costMicroGbp: 0,
      tiles: 0,
      cacheHits: 0,
      perProvider: [],
    });
  });

  it('pruneCacheHits removes only cache_hit rows older than the cutoff for the named providers', () => {
    const db = freshDb();
    const clock = fixedClock(at('2026-06-01T00:00:00.000Z'));
    const guard = new SqliteBudgetGuard(db, cfg, clock);
    guard.recordCacheHit({
      providerId: 'travelpayouts',
      executionId: null,
      tileIndex: 0,
      endpointPath: '/p',
    });
    guard.recordCacheHit({ providerId: 'searchapi', executionId: null, tileIndex: null, endpointPath: '/s' });
    guard
      .reserve({
        providerId: 'travelpayouts',
        executionId: null,
        tileIndex: 0,
        costMicroGbp: 0,
        httpAttempt: 1,
        endpointPath: '/p',
      })
      .finalise(ok);
    expect(new LedgerRepo(db).pruneCacheHits(T0, ['travelpayouts'])).toBe(1);
    expect(
      db.raw.prepare('SELECT provider_id AS p, outcome AS o FROM provider_requests ORDER BY id').all(),
    ).toEqual([
      { p: 'searchapi', o: 'cache_hit' },
      { p: 'travelpayouts', o: 'ok' },
    ]);
    expect(new LedgerRepo(db).pruneCacheHits(T0, [])).toBe(0);
  });
});
