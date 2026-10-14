import type { CellKey, ProviderId, Stage } from '@gmt/core';
import type { Db } from '../../src/client.js';

/** Test-only raw UPDATE of one outcome row. Never used to assert a roll-up that it alone produced. */
export function rawOutcome(
  db: Db,
  executionId: string,
  c: CellKey,
  stage: Stage,
  providerId: ProviderId,
  fields: {
    status: string;
    reason?: string | null;
    attempts?: number;
    minPence?: number;
    reusedFrom?: string;
    fetchedAt?: string;
  },
): void {
  const terminal = ['priced', 'empty', 'no_data'].includes(fields.status);
  const changes = db.raw
    .prepare(
      `UPDATE cell_outcomes SET status = @status, reason = @reason, attempts = @attempts, fetched_at = @fetchedAt, cabin = @cabin, point_of_sale = @pos,
         source_kind = @kind, min_pence = @minPence, reused_from_execution_id = @reusedFrom
       WHERE execution_id = @executionId AND origin = @origin AND destination = @destination AND departure_date = @departureDate AND return_date = @returnDate AND stage = @stage AND provider_id = @providerId`,
    )
    .run({
      executionId,
      ...c,
      stage,
      providerId,
      status: fields.status,
      reason: fields.reason ?? null,
      attempts: fields.attempts ?? 0,
      fetchedAt: terminal ? (fields.fetchedAt ?? '2026-10-14T12:00:00.000Z') : null,
      cabin: terminal ? 'economy' : null,
      pos: terminal ? 'unknown' : null,
      kind: terminal ? 'authorised-cached' : null,
      minPence: fields.status === 'priced' ? (fields.minPence ?? 100) : null,
      reusedFrom: fields.reusedFrom ?? null,
    }).changes;
  if (changes !== 1) throw new Error('rawOutcome matched no row');
}
