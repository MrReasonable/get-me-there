import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { SqliteResponseCache } from '../src/responseCache.js';
import { at, count, freshDb, sqliteCode, T0 } from './helpers/db.js';

const K1 = '1'.repeat(64);
const K2 = 'ab'.repeat(32);

describe('SqliteResponseCache (spec §5.3 "Cache", §7 provider_cache)', () => {
  it('returns the body with its original storedAt until the TTL passes, then nothing', () => {
    const clock = fixedClock(T0);
    const cache = new SqliteResponseCache(freshDb(), clock);
    const storedAt = at('2026-10-14T11:59:00.000Z');
    cache.set(K1, { data: [1, 2] }, 3600, storedAt);
    expect(cache.get(K1)).toEqual({ body: { data: [1, 2] }, storedAt });
    clock.set(at('2026-10-14T12:58:59.999Z'));
    expect(cache.get(K1)).toBeDefined();
    clock.set(at('2026-10-14T12:59:00.000Z')); // storedAt + 3600 s: expired
    expect(cache.get(K1)).toBeUndefined();
    expect(cache.get(K2)).toBeUndefined();
  });

  it('set replaces an existing key', () => {
    const cache = new SqliteResponseCache(freshDb(), fixedClock(T0));
    cache.set(K1, { v: 1 }, 60, T0);
    cache.set(K1, { v: 2 }, 60, T0);
    expect(cache.get(K1)?.body).toEqual({ v: 2 });
  });

  it('refuses a key that is not 64 lower-case hex characters (sec-001), writing nothing', () => {
    const db = freshDb();
    const cache = new SqliteResponseCache(db, fixedClock(T0));
    for (const key of [
      'https://www.searchapi.io/api/v1/search?api_key=SECRET',
      'A'.repeat(64),
      '1'.repeat(63),
      `${'1'.repeat(63)}g`,
      '',
    ]) {
      expect(() => cache.set(key, {}, 60, T0)).toThrow(expect.objectContaining({ rule: 'cache-key' }));
    }
    expect(count(db, 'provider_cache')).toBe(0);
  });

  it('rejects a non-positive or non-integer TTL; SQL refuses a non-ISO stored_at', () => {
    const db = freshDb();
    const cache = new SqliteResponseCache(db, fixedClock(T0));
    expect(() => cache.set(K1, {}, 0, T0)).toThrow(/ttl/);
    expect(() => cache.set(K1, {}, 1.5, T0)).toThrow(/ttl/);
    // why: a non-ISO storedAt cannot reach the typed method without a cast (arch-r2-006); the CHECK is its guard.
    expect(
      sqliteCode(() =>
        db.raw
          .prepare(
            `INSERT INTO provider_cache (key, body_json, stored_at, expires_at) VALUES (?, '{}', '2026-10-14', ?)`,
          )
          .run(K1, T0),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });
});
