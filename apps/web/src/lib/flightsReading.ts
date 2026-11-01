import type { ExecutionResponse } from '../api/types.js';

/** A run's flight-list counts as the api gives them on the run and on its card (spec rev 55 §10 `flights`). */
export type FlightCounts = ExecutionResponse['flights'];

/**
 * Spec rev 55 §11; ruling R-reading (WP20 Task 20.6 review): the one rule for "Reading flights · N of M" on a card and on
 * a search's page. A run is reading flights while its flight step has not ended (`ended` null) and still has lists to
 * get (fewer read, reused and failed than planned); N is the lists in hand, read now or reused from an earlier run.
 * Null when it is not reading (no plan, a step that ended, every list in hand or failed): the caller then says what
 * else the run is doing.
 */
export function readingCount(f: FlightCounts): number | null {
  if (f === null || f.ended !== null) return null;
  return f.read + f.reused + f.failed < f.planned ? f.read + f.reused : null;
}
