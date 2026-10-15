import { asIsoDateTime, type Clock, type Logger, type ProviderId } from '@gmt/core';
import type { Db } from './client.js';
import { PROVIDER_IDS } from './internal/enums.js';
import { oneOf } from './internal/read.js';
import { LedgerRepo } from './repositories/ledger.js';

/** Spec §7: `cache_hit` ledger rows older than this are pruned for monthly-window providers. */
const CACHE_HIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Spec §7 "Retention", run daily by the engine (WP7): delete expired `provider_cache` rows, prune old `cache_hit`
 * rows for providers on monthly windows only (lifetime plans keep every row, since their cap needs them), and log
 * the database size.
 */
export function runMaintenance(
  db: Db,
  clock: Clock,
  log: Logger,
  opts: { lifetimeProviders: ProviderId[] },
): { cacheRowsDeleted: number; ledgerRowsPruned: number; dbBytes: number } {
  const now = clock.now();
  const cacheRowsDeleted = db.raw
    .prepare('DELETE FROM provider_cache WHERE expires_at <= ?')
    .run(now).changes;
  const lifetime = new Set(opts.lifetimeProviders);
  const monthly = db.raw
    .prepare<[], { p: string }>(
      `SELECT DISTINCT provider_id AS p FROM provider_requests WHERE outcome = 'cache_hit'`,
    )
    .all()
    .map((r) => oneOf('provider_requests.provider_id', PROVIDER_IDS, r.p))
    .filter((p) => !lifetime.has(p));
  const cutoff = asIsoDateTime(new Date(Date.parse(now) - CACHE_HIT_RETENTION_MS).toISOString());
  const ledgerRowsPruned = new LedgerRepo(db).pruneCacheHits(cutoff, monthly);
  const dbBytes =
    Number(db.raw.pragma('page_count', { simple: true })) *
    Number(db.raw.pragma('page_size', { simple: true }));
  log.info({ dbBytes, cacheRowsDeleted, ledgerRowsPruned }, 'maintenance');
  return { cacheRowsDeleted, ledgerRowsPruned, dbBytes };
}
