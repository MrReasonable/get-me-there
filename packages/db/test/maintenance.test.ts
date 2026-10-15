import { fixedClock } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { SqliteBudgetGuard } from '../src/budgetGuard.js';
import { runMaintenance } from '../src/maintenance.js';
import { SqliteResponseCache } from '../src/responseCache.js';
import { at, freshDb, silentLog, T0 } from './helpers/db.js';
import { budgetConfig, limits } from './helpers/factories.js';

const OLD_KEY = '0'.repeat(64);
const FRESH_KEY = 'f'.repeat(64);

describe('runMaintenance (spec §7 "Retention")', () => {
  it('deletes expired cache rows, prunes old cache_hit rows for monthly-window providers only, and logs DB size', () => {
    const db = freshDb();
    const clock = fixedClock(at('2026-06-01T00:00:00.000Z'));
    const guard = new SqliteBudgetGuard(
      db,
      budgetConfig({
        travelpayouts: limits({ billable: false, monthlyCallCap: 50_000 }),
        searchapi: limits({ window: 'lifetime', monthlyCallCap: 100 }),
      }),
      clock,
    );
    guard.recordCacheHit({
      providerId: 'travelpayouts',
      executionId: null,
      tileIndex: 0,
      endpointPath: '/aviasales/v3/prices_for_dates',
    }); // > 90 days before T0
    guard.recordCacheHit({
      providerId: 'searchapi',
      executionId: null,
      tileIndex: null,
      endpointPath: '/api/v1/search',
    }); // lifetime: kept
    const cache = new SqliteResponseCache(db, clock);
    cache.set(OLD_KEY, {}, 60, clock.now());
    clock.set(T0);
    guard.recordCacheHit({
      providerId: 'travelpayouts',
      executionId: null,
      tileIndex: 1,
      endpointPath: '/aviasales/v3/prices_for_dates',
    }); // recent: kept
    cache.set(FRESH_KEY, {}, 3600, T0);
    const info = vi.fn();
    const result = runMaintenance(db, clock, { ...silentLog, info }, { lifetimeProviders: ['searchapi'] });
    expect(result).toMatchObject({ cacheRowsDeleted: 1, ledgerRowsPruned: 1 });
    expect(result.dbBytes).toBeGreaterThan(0);
    expect(db.raw.prepare('SELECT key FROM provider_cache').all()).toEqual([{ key: FRESH_KEY }]);
    expect(
      db.raw.prepare('SELECT provider_id AS p, started_at AS s FROM provider_requests ORDER BY id').all(),
    ).toEqual([
      { p: 'searchapi', s: '2026-06-01T00:00:00.000Z' },
      { p: 'travelpayouts', s: T0 },
    ]);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ dbBytes: result.dbBytes, cacheRowsDeleted: 1, ledgerRowsPruned: 1 }),
      'maintenance',
    );
  });
});
