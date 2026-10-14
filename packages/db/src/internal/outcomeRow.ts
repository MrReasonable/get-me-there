import type { CellKey, CellOutcome } from '@gmt/core';
import { CABINS, OUTCOME_STATUSES, PROVIDER_IDS, SOURCE_KINDS, STAGES } from './enums.js';
import { nullableOneOf, oneOf, readDate, readIata, readNullableTime } from './read.js';

/** A `cell_outcomes` row as SQLite returns it (every enum column a plain string, narrowed by `toOutcome`). */
export interface OutcomeDbRow {
  execution_id: string;
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  stage: string;
  provider_id: string;
  status: string;
  reason: string | null;
  attempts: number;
  last_error: string | null;
  fetched_at: string | null;
  min_pence: number | null;
  cabin: string | null;
  point_of_sale: string | null;
  source_kind: string | null;
  reused_from_execution_id: string | null;
}

const C = 'cell_outcomes';
export function toOutcome(r: OutcomeDbRow): CellOutcome {
  return {
    executionId: r.execution_id,
    origin: readIata(`${C}.origin`, r.origin),
    destination: readIata(`${C}.destination`, r.destination),
    departureDate: readDate(`${C}.departure_date`, r.departure_date),
    returnDate: readDate(`${C}.return_date`, r.return_date),
    stage: oneOf(`${C}.stage`, STAGES, r.stage),
    providerId: oneOf(`${C}.provider_id`, PROVIDER_IDS, r.provider_id),
    status: oneOf(`${C}.status`, OUTCOME_STATUSES, r.status),
    reason: r.reason,
    attempts: r.attempts,
    lastError: r.last_error,
    fetchedAt: readNullableTime(`${C}.fetched_at`, r.fetched_at),
    minPence: r.min_pence,
    cabin: nullableOneOf(`${C}.cabin`, CABINS, r.cabin),
    pointOfSale: r.point_of_sale,
    sourceKind: nullableOneOf(`${C}.source_kind`, SOURCE_KINDS, r.source_kind),
    reusedFromExecutionId: r.reused_from_execution_id,
  };
}

/** WHERE fragment for one cell of one execution, with @executionId/@origin/@destination/@departureDate/@returnDate. */
export const CELL_WHERE =
  'execution_id = @executionId AND origin = @origin AND destination = @destination AND departure_date = @departureDate AND return_date = @returnDate';
/** core's `cellKeyString` format built in SQL; the one place db spells it (arch-r2-008, pinned by a test against core). */
export const CELL_KEY_SQL = "(origin || '|' || destination || '|' || departure_date || '|' || return_date)";
export const keyParams = (executionId: string, c: CellKey) => ({
  executionId,
  origin: c.origin,
  destination: c.destination,
  departureDate: c.departureDate,
  returnDate: c.returnDate,
});

export interface CellKeyDbRow {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
}
export const toCellKey = (r: CellKeyDbRow): CellKey => ({
  origin: readIata('origin', r.origin),
  destination: readIata('destination', r.destination),
  departureDate: readDate('departure_date', r.departure_date),
  returnDate: readDate('return_date', r.return_date),
});
