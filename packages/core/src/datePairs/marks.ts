import type { CellKey, ResolvedSpace } from '../types/definition.js';
import type { Buckets, CellOutcomeStatus } from '../types/execution.js';
import { datePairAt, datePairCount } from './space.js';

/**
 * Spec revision 55 §3 and §6.6 "The main path's reading of a date pair": the five marks a date pair shows on the main
 * path, in place of the six coverage buckets (which stay in every response and in the coverage section).
 */
export type ReducedMark = 'priced' | 'no-price-shown' | 'couldnt-read' | 'not-reached' | 'not-searched';

/**
 * A date pair's mark from the six buckets over its airport pairs in scope: the §6.6 precedence bucket (priced, then not
 * run, then error, then no fares or no cached data, then skipped) mapped to one of five marks. So one airport pair
 * `empty` and three `not_run` is not searched, never "no price shown". A date pair with no airport-pair result at all
 * (no parent run yet, a day a relative window rolled in) counts as not searched, as §6.6 counts it. `reused` is not a
 * bucket (it counts outcomes copied from an earlier run, already in their own bucket), so it never decides a mark.
 */
export function reducedMark(buckets: Buckets): ReducedMark {
  if (buckets.priced > 0) return 'priced';
  if (buckets.not_run > 0) return 'not-searched';
  if (buckets.error > 0) return 'couldnt-read';
  // why: §6.6 rows 4 and 5 (any empty with the rest skipped or no data; any no data) both read as no price shown.
  if (buckets.empty > 0 || buckets.no_data > 0) return 'no-price-shown';
  if (buckets.skipped > 0) return 'not-reached';
  return 'not-searched';
}

/**
 * Spec revision 55 §6.6: the one predicate behind every "searched" count of a date pair (the search cards, a search's
 * header, progress and stopped lines, the stop cause's `searched` and the overview): true exactly when its mark is
 * priced or no price shown.
 */
export function datePairSearched(buckets: Buckets): boolean {
  const mark = reducedMark(buckets);
  return mark === 'priced' || mark === 'no-price-shown';
}

/**
 * Spec revision 55 §6.6: the six buckets of every date pair of `space` over its airport pairs, in date-pair index order.
 * A cell's bucket is `statusOf` it (a run's discovery roll-up status), or `not_run` when that is null: a cell the run
 * never seeded (a day a relative window rolled in, an added airport) is not searched, as `classifyCells` counts it.
 * `reused` stays 0 (it decides no mark).
 */
export function datePairBuckets(
  space: ResolvedSpace,
  statusOf: (cell: CellKey) => CellOutcomeStatus | null,
): Buckets[] {
  const out: Buckets[] = [];
  for (let i = 0, n = datePairCount(space); i < n; i++) {
    const { departureDate, returnDate } = datePairAt(space, i);
    const b: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
    for (const origin of space.origins)
      for (const destination of space.destinations)
        b[statusOf({ origin, destination, departureDate, returnDate }) ?? 'not_run'] += 1;
    out.push(b);
  }
  return out;
}

/**
 * Spec revision 55 §6.6, §8.1: how many date pairs of `space` `datePairSearched` accepts, with each cell's bucket from
 * `statusOf` as `datePairBuckets` reads it: the stop cause's `searched` and the search card's counts.
 */
export function searchedDatePairCount(
  space: ResolvedSpace,
  statusOf: (cell: CellKey) => CellOutcomeStatus | null,
): number {
  return datePairBuckets(space, statusOf).filter(datePairSearched).length;
}
