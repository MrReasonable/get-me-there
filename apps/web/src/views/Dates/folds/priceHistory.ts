import type { IsoDateTime, Provenance, StaleMark } from '@gmt/core';
import type { RouteHistoryResponse } from '../../../api/types.js';

// Ruling 19, Price over time: the lowest calendar price of each of this search's runs, from the route history, as a pure
// function of the reads. The route history is shared by every search over an airport pair, so a point counts only when
// its run is one of this search's own.

/** One run's lowest calendar price across the search's airport pairs and the sources that priced it. */
export interface RunPoint {
  executionId: string;
  at: IsoDateTime;
  pricePence: number;
  provenance: Provenance;
  /** The api's stale mark, as it sent it: never recomputed here. */
  stale: StaleMark;
  truncated: boolean;
}

/** How many runs the fold lists. */
export const PRICE_RUNS_SHOWN = 6;

/**
 * The lowest point of each run in `runIds` over every history given (a history still loading is `undefined`), newest
 * first by the time the price was fetched, at most `limit` runs. A tie on price keeps the first point met.
 */
export function lowestPerRun(
  histories: ReadonlyArray<RouteHistoryResponse | undefined>,
  runIds: ReadonlySet<string>,
  limit: number = PRICE_RUNS_SHOWN,
): RunPoint[] {
  const best = new Map<string, RunPoint>();
  for (const h of histories) {
    if (h === undefined) continue;
    for (const series of h.calendarSeries) {
      for (const p of series.points) {
        if (!runIds.has(p.executionId)) continue;
        const have = best.get(p.executionId);
        if (have === undefined || p.pricePence < have.pricePence) {
          best.set(p.executionId, {
            executionId: p.executionId,
            at: p.at,
            pricePence: p.pricePence,
            provenance: p.provenance,
            stale: p.stale,
            truncated: p.truncated,
          });
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/** The cheapest of `points` (newest first), the newest of equals; null when there are none. */
export function lowestOf(points: readonly RunPoint[]): RunPoint | null {
  let low: RunPoint | null = null;
  for (const p of points) if (low === null || p.pricePence < low.pricePence) low = p;
  return low;
}
