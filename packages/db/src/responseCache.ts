import type { Clock, IsoDateTime, ResponseCache } from '@gmt/core';
import type { Db } from './client.js';
import { readJson, readTime } from './internal/read.js';
import { assertIsoDateTime, RowRejected } from './internal/validate.js';

const KEY = /^[0-9a-f]{64}$/;

/**
 * Spec §5.3 response cache over `provider_cache`. A hit returns the original `storedAt`, which http-kit reports as
 * `fetchedAt` (spec §2 "the original storedAt on a cache hit"). Scrubbing bodies is http-kit's job (WP4).
 */
export class SqliteResponseCache implements ResponseCache {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined {
    const r = this.db.raw
      .prepare<[string, string], { body_json: string; stored_at: string }>(
        'SELECT body_json, stored_at FROM provider_cache WHERE key = ? AND expires_at > ?',
      )
      .get(key, this.clock.now());
    return r === undefined
      ? undefined
      : {
          body: readJson('provider_cache.body_json', r.body_json),
          storedAt: readTime('provider_cache.stored_at', r.stored_at),
        };
  }

  set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void {
    if (!KEY.test(key))
      throw new RowRejected(
        'cache-key',
        'cache keys are 64 lower-case hex characters (sha256 of a credential-free request, spec §5.3)',
      );
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0)
      throw new RowRejected('ttl', `ttlSeconds must be a positive integer, got ${ttlSeconds}`);
    assertIsoDateTime('stored_at', storedAt);
    const expiresAt = new Date(Date.parse(storedAt) + ttlSeconds * 1000).toISOString();
    this.db.raw
      .prepare(
        `INSERT INTO provider_cache (key, provider_id, body_json, stored_at, expires_at) VALUES (@key, NULL, @body, @storedAt, @expiresAt)
         ON CONFLICT(key) DO UPDATE SET body_json = excluded.body_json, stored_at = excluded.stored_at, expires_at = excluded.expires_at`,
      )
      .run({ key, body: JSON.stringify(body), storedAt, expiresAt });
  }
}
