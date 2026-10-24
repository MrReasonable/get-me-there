import {
  type CellKey,
  type CellOutcome,
  type CellOutcomeStatus,
  cellKeyString,
  mergeWithinProvider,
  type ProviderId,
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { Db } from '../client.js';
import type { TileWrite } from '../types.js';
import { CELL_WHERE, keyParams, type OutcomeDbRow, toOutcome } from './outcomeRow.js';
import { RowRejected } from './validate.js';

// Shared by every repository that writes a fetched outcome (CellsRepo, CalendarPricesRepo): the one merge rule,
// the one outcome writer and the closed reason and provenance checks (spec §3, §6.6; brief ruling 3).

export type Incoming = TileWrite['outcomes'][number];
export const SELECT_OUTCOME_SQL = `SELECT * FROM cell_outcomes WHERE ${CELL_WHERE} AND stage = @stage AND provider_id = @providerId`;
export const UPDATE_OUTCOME_SQL = `
UPDATE cell_outcomes SET status = @status, reason = @reason, last_error = @lastError, fetched_at = @fetchedAt, min_pence = @minPence,
  cabin = @cabin, point_of_sale = @pointOfSale, source_kind = @sourceKind, attempts = @attempts, reused_from_execution_id = @reusedFromExecutionId,
  skip_detail = @skipDetail
WHERE ${CELL_WHERE} AND stage = @stage AND provider_id = @providerId`;
export const DELETE_FRESH_PRICE_SQL = `DELETE FROM calendar_prices WHERE ${CELL_WHERE} AND provider_id = @providerId AND reused_from_execution_id IS NULL`;
export const DELETE_REUSED_PRICE_SQL = `DELETE FROM calendar_prices WHERE ${CELL_WHERE} AND provider_id = @providerId AND reused_from_execution_id IS NOT NULL`;
export const TILE_STATUSES = ['priced', 'empty', 'no_data'] as const;

/**
 * The outcome to store when `incoming` (fresh) meets `existing` (ruling 3, spec §6.6). Over not_run, skipped or a reused
 * copy the fresh outcome replaces the row (an error never does: it only counts an attempt); fresh on fresh goes through
 * core's mergeWithinProvider. Attempts are the existing count plus one when this pass failed.
 */
export function nextOutcome(existing: CellOutcome, incoming: CellOutcome, failedPass: boolean): CellOutcome {
  const attempts = existing.attempts + (failedPass ? 1 : 0);
  if (existing.status === 'not_run' || existing.status === 'skipped') return { ...incoming, attempts };
  // why: an error never displaces a stronger result, reused or fresh (plan merge rule, prov-r2-003): the existing outcome
  // stays, with its reused price row, and only the attempt is counted. Decided here so it does not hang on core's reading.
  if (incoming.status === 'error' && existing.status !== 'error') return { ...existing, attempts };
  if (existing.reusedFromExecutionId !== null) return { ...incoming, attempts };
  const merged = mergeWithinProvider(existing, incoming);
  // why: when the merge keeps an error, the newest vendor message is the useful one; status, reason and minPence stay core's.
  return {
    ...merged,
    attempts,
    lastError:
      merged.status === 'error' && incoming.status === 'error' ? incoming.lastError : merged.lastError,
  };
}

export function storeOutcome(db: Db, o: CellOutcome): void {
  db.raw.prepare(UPDATE_OUTCOME_SQL).run({
    ...keyParams(o.executionId, o),
    stage: o.stage,
    providerId: o.providerId,
    status: o.status,
    reason: o.reason,
    lastError: o.lastError === null ? null : stripUrlsInText(o.lastError),
    fetchedAt: o.fetchedAt,
    minPence: o.minPence,
    cabin: o.cabin,
    pointOfSale: o.pointOfSale,
    sourceKind: o.sourceKind,
    attempts: o.attempts,
    reusedFromExecutionId: o.reusedFromExecutionId,
    // why: spec §3 rev 36 — a detail belongs to skipped:scheduled_only alone, so any other outcome written here clears it
    skipDetail: o.status === 'skipped' && o.reason === 'scheduled_only' ? o.skipDetail : null,
  });
}

/** Ruling 2026-10-15: the closed set of priced reasons; offers-dropped counts are positive and unpadded. */
// Decision 19's closed set, with decision 45's `price-unconfirmed`: ';'-joined parts in the order partial-expansion,
// price-unconfirmed, offers-dropped:n, at least one.
export const PRICED_REASON =
  /^(?=[^;])(?:partial-expansion(?:;(?=.)|$))?(?:price-unconfirmed(?:;(?=.)|$))?(?:offers-dropped:[1-9][0-9]*)?$/;

/**
 * Spec §3: `reason` never holds a vendor message (prov-r2-004). A fetched outcome's reason is closed per status:
 * priced → null | PRICED_REASON (core's `pricedReason` writes it),
 * empty → null, no_data → null | 'cabin-not-offered'.
 */
export function assertOutcomeReason(o: { status: CellOutcomeStatus; reason: string | null } & CellKey): void {
  const ok =
    o.reason === null ||
    (o.status === 'priced' && PRICED_REASON.test(o.reason)) ||
    (o.status === 'no_data' && o.reason === 'cabin-not-offered');
  if (!ok || (o.status !== 'priced' && o.status !== 'empty' && o.status !== 'no_data'))
    throw new RowRejected(
      'outcome-reason',
      `${cellKeyString(o)} ${o.status} cannot carry reason ${String(o.reason)}`,
    );
}

/** Ruling 5: a fetched terminal outcome carries the provenance reuse matches on. */
export function assertOutcomeProvenance(o: Incoming): void {
  if (o.fetchedAt === null || o.cabin === null || o.pointOfSale === null || o.sourceKind === null)
    throw new RowRejected(
      'outcome-provenance',
      `${cellKeyString(o)} ${o.status} needs fetchedAt, cabin, pointOfSale and sourceKind`,
    );
}

/** The seeded outcome of one cell, stage and provider; a missing row is refused, never invented. */
export function readOutcome(
  db: Db,
  executionId: string,
  c: CellKey,
  stage: Stage,
  providerId: ProviderId,
): CellOutcome {
  const r = db.raw
    .prepare<Record<string, unknown>, OutcomeDbRow>(SELECT_OUTCOME_SQL)
    .get({ ...keyParams(executionId, c), stage, providerId });
  if (r === undefined)
    throw new RowRejected('missing', `no seeded ${stage} outcome for ${providerId} at ${cellKeyString(c)}`);
  return toOutcome(r);
}
