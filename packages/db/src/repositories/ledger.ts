import type { IsoDateTime, ProviderId, Stage } from '@gmt/core';
import type { Db } from '../client.js';
import { PROVIDER_IDS, STAGES } from '../internal/enums.js';
import { oneOf, readTime } from '../internal/read.js';
import { assertIsoDateTime } from '../internal/validate.js';

/** Distinct tiles fetched upstream on a first attempt (ruling 7); cache hits are counted separately so parity = tiles + cacheHits. */
const TILE_EXPR = `COUNT(DISTINCT CASE WHEN tile_index IS NOT NULL AND http_attempt = 1 AND outcome <> 'cache_hit' THEN provider_id || ':' || tile_index END)`;
const COUNTS = `COALESCE(SUM(outcome <> 'cache_hit'), 0) AS calls, COALESCE(SUM(cost_micro_gbp), 0) AS cost, ${TILE_EXPR} AS tiles, COALESCE(SUM(outcome = 'cache_hit'), 0) AS cacheHits, COALESCE(SUM(scroll_count), 0) AS scrolls`;
interface CountsRow {
  calls: number;
  cost: number;
  tiles: number;
  cacheHits: number;
  scrolls: number;
}

/** Reads and housekeeping over `provider_requests` (spec §7). Inserts and finalisation belong to `SqliteBudgetGuard`. */
export class LedgerRepo {
  constructor(private readonly db: Db) {}

  /**
   * Actuals for one execution, total and per (provider, stage). `calls` are upstream attempts, not cap usage
   * (cap usage comes from `BudgetGuard.usage`); spec §8.1 parity is `tiles + cacheHits`.
   */
  countsFor(executionId: string): {
    calls: number;
    costMicroGbp: number;
    tiles: number;
    cacheHits: number;
    perProvider: Array<{
      providerId: ProviderId;
      stage: Stage | null;
      calls: number;
      costMicroGbp: number;
      tiles: number;
      cacheHits: number;
      /** camoufox grid pages' scroll clicks (spec §7 rev 34); 0 for every other provider. */
      scrolls: number;
    }>;
  } {
    const total = this.db.raw
      .prepare<[string], CountsRow>(`SELECT ${COUNTS} FROM provider_requests WHERE execution_id = ?`)
      .get(executionId);
    const rows = this.db.raw
      .prepare<[string], CountsRow & { providerId: string; stage: string }>(
        `SELECT provider_id AS providerId, CASE WHEN tile_index IS NULL THEN 'verification' ELSE 'discovery' END AS stage, ${COUNTS}
         FROM provider_requests WHERE execution_id = ? GROUP BY providerId, stage ORDER BY providerId, stage`,
      )
      .all(executionId);
    return {
      calls: total?.calls ?? 0,
      costMicroGbp: total?.cost ?? 0,
      tiles: total?.tiles ?? 0,
      cacheHits: total?.cacheHits ?? 0,
      perProvider: rows.map((r) => ({
        providerId: oneOf('provider_id', PROVIDER_IDS, r.providerId),
        stage: oneOf('stage', STAGES, r.stage),
        calls: r.calls,
        costMicroGbp: r.cost,
        tiles: r.tiles,
        cacheHits: r.cacheHits,
        scrolls: r.scrolls,
      })),
    };
  }

  /**
   * Upstream attempts of one execution that recorded an HTTP status, counted per (provider, endpoint, status), ordered
   * by those three. Cache hits, pending rows and attempts that ended without a status (a socket error, a timeout) are
   * left out. The smoke matches each answer it received against these, like with like (WP13 cost review M2).
   */
  answeredFor(
    executionId: string,
  ): Array<{ providerId: ProviderId; endpointPath: string; httpStatus: number; attempts: number }> {
    return this.db.raw
      .prepare<[string], { providerId: string; endpointPath: string; httpStatus: number; attempts: number }>(
        `SELECT provider_id AS providerId, endpoint_path AS endpointPath, http_status AS httpStatus, COUNT(*) AS attempts
         FROM provider_requests
         WHERE execution_id = ? AND outcome <> 'cache_hit' AND outcome <> 'pending' AND http_status IS NOT NULL
         GROUP BY provider_id, endpoint_path, http_status ORDER BY provider_id, endpoint_path, http_status`,
      )
      .all(executionId)
      .map((r) => ({ ...r, providerId: oneOf('provider_id', PROVIDER_IDS, r.providerId) }));
  }

  /**
   * Spec §10 `GET /status` (brief WP18 §6): the provider's newest completed upstream call. `errorKind` is the adapters'
   * own class (migration 0008), and a call is a success only when it ended `ok` with no class recorded: a 2xx whose
   * body http-kit or an adapter rejected carries `parse` and is not one (V4). Cache hits, pending rows and swept
   * `unknown` rows are not completed calls. Null when the provider has made none. The ledger's text is never read.
   */
  lastCompleted(providerId: ProviderId): {
    at: IsoDateTime;
    outcome: 'ok' | 'error';
    httpStatus: number | null;
    errorKind: string | null;
  } | null {
    const r = this.db.raw
      .prepare<
        [string],
        { at: string; outcome: string; httpStatus: number | null; errorKind: string | null }
      >(
        `SELECT COALESCE(finished_at, started_at) AS at, outcome, http_status AS httpStatus, error_kind AS errorKind FROM provider_requests WHERE provider_id = ? AND outcome IN ('ok', 'error') ORDER BY COALESCE(finished_at, started_at) DESC, id DESC LIMIT 1`,
      )
      .get(providerId);
    if (r === undefined) return null;
    return {
      at: readTime('provider_requests.finished_at', r.at),
      outcome: oneOf('outcome', ['ok', 'error'] as const, r.outcome),
      httpStatus: r.httpStatus,
      errorKind: r.errorKind,
    };
  }

  /**
   * V4: an adapter rejected the body of a call http-kit had finalised `ok` (a 2xx whose JSON the adapter could not use).
   * Marks the newest such row of this provider in this execution `kind`, if it has none yet, so it is no longer read as a
   * success. Returns whether a row was marked.
   */
  markRejected(providerId: ProviderId, executionId: string | null, kind: string): boolean {
    return (
      this.db.raw
        .prepare<[string, string, string | null]>(
          `UPDATE provider_requests SET error_kind = ? WHERE id = (SELECT id FROM provider_requests WHERE provider_id = ? AND execution_id IS ? AND outcome = 'ok' AND error_kind IS NULL ORDER BY id DESC LIMIT 1)`,
        )
        .run(kind, providerId, executionId).changes === 1
    );
  }

  /** Spec §8.1 parity numerator for one provider (add its cache hits for the full count). */
  firstAttemptTiles(executionId: string, providerId: ProviderId): number {
    return (
      this.db.raw
        .prepare<[string, string], { n: number }>(
          `SELECT ${TILE_EXPR} AS n FROM provider_requests WHERE execution_id = ? AND provider_id = ?`,
        )
        .get(executionId, providerId)?.n ?? 0
    );
  }

  /** Spec §5.3 "boot sweep marks pending older than 10 minutes unknown (still counted)". The caller passes boot − 10 min. */
  sweepPending(olderThan: IsoDateTime): number {
    assertIsoDateTime('olderThan', olderThan);
    return this.db.raw
      .prepare(
        `UPDATE provider_requests SET outcome = 'unknown' WHERE outcome = 'pending' AND started_at < ?`,
      )
      .run(olderThan).changes;
  }

  /** Spec §7 retention: prune `cache_hit` rows older than the cutoff for the named (monthly-window) providers. */
  pruneCacheHits(olderThan: IsoDateTime, providerIds: ProviderId[]): number {
    assertIsoDateTime('olderThan', olderThan);
    if (providerIds.length === 0) return 0;
    return this.db.raw
      .prepare(
        `DELETE FROM provider_requests WHERE outcome = 'cache_hit' AND started_at < @olderThan AND provider_id IN (SELECT value FROM json_each(@ids))`,
      )
      .run({ olderThan, ids: JSON.stringify(providerIds) }).changes;
  }
}
