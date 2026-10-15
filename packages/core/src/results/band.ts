import { resultRowKey } from './rowKey.js';
import type { ResultRow } from './types.js';

/**
 * Spec §6.5, §11: the cheapest row in each travel-time band of `bandHours` (6 in the UI):
 * band = floor(totalMinutes / (bandHours × 60)), so 5h59 is band 0 and 6h00 band 1. Returns the
 * set of marked `resultRowKey`s. Not eligible: rows without a travel time (calendar basis),
 * `failed` rows, and rows the latest search no longer returned (`notSeenInLatest`), so the mark
 * never lands on a fare that breaks a constraint or may be gone (review prov-007, pft-010).
 * Equal prices: the first row in input order wins.
 */
export function bandCheapest(rows: ResultRow[], bandHours: number): Set<string> {
  if (!Number.isInteger(bandHours) || bandHours <= 0) {
    throw new RangeError(`band hours must be a positive integer: ${bandHours}`);
  }
  const best = new Map<number, ResultRow>();
  for (const r of rows) {
    if (r.totalMinutes === null || r.verdictClass === 'failed' || r.notSeenInLatest !== null) continue;
    const band = Math.floor(r.totalMinutes / (bandHours * 60));
    const current = best.get(band);
    if (current === undefined || r.pricePence < current.pricePence) best.set(band, r);
  }
  return new Set([...best.values()].map(resultRowKey));
}
