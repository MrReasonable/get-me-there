import type { IsoDateTime, Provenance, StaleMark } from '@gmt/core';
import type { RouteHistoryResponse } from '../../../api/types.js';

// Ruling 19, Price over time: the lowest calendar price of each of this search's runs, from the route history, as a pure
// function of the reads. The route history is shared by every search over an airport pair, so a point counts only when
// its run is one of this search's own.

/** One run's lowest calendar price across the search's airport pairs and the sources that priced it. */
export interface RunPoint {
  executionId: string;
  /** When the run started (the row's day), or when its price was fetched where the run names no start. */
  at: IsoDateTime;
  pricePence: number;
  provenance: Provenance;
  /** The api's stale mark, as it sent it: never recomputed here. */
  stale: StaleMark;
  truncated: boolean;
}

/** A run of this search as the date-pairs read lists it. */
export interface SearchRun {
  id: string;
  startedAt: IsoDateTime | null;
}

/** How many runs the fold lists. */
const PRICE_RUNS_SHOWN = 6;

/**
 * The lowest point of each of `runs` (this search's parent runs, newest first) over every history given (a history
 * still loading is `undefined`), in the runs' own order and dated by the run's start, at most `limit` runs. A tie on
 * price keeps the first point met. A run with no point is left out.
 */
export function lowestPerRun(
  histories: ReadonlyArray<RouteHistoryResponse | undefined>,
  runs: readonly SearchRun[],
  limit: number = PRICE_RUNS_SHOWN,
): RunPoint[] {
  const best = new Map<string, RunPoint>();
  const startOf = new Map(runs.map((r) => [r.id, r.startedAt]));
  for (const h of histories) {
    if (h === undefined) continue;
    for (const series of h.calendarSeries) {
      for (const p of series.points) {
        if (!startOf.has(p.executionId)) continue;
        const have = best.get(p.executionId);
        if (have === undefined || p.pricePence < have.pricePence) {
          best.set(p.executionId, {
            executionId: p.executionId,
            at: startOf.get(p.executionId) ?? p.at,
            pricePence: p.pricePence,
            provenance: p.provenance,
            stale: p.stale,
            truncated: p.truncated,
          });
        }
      }
    }
  }
  const out: RunPoint[] = [];
  for (const r of runs) {
    const point = best.get(r.id);
    if (point !== undefined) out.push(point);
  }
  return out.slice(0, limit);
}

/** The cheapest of `points` (newest first), the newest of equals; null when there are none. */
export function lowestOf(points: readonly RunPoint[]): RunPoint | null {
  let low: RunPoint | null = null;
  for (const p of points) if (low === null || p.pricePence < low.pricePence) low = p;
  return low;
}
