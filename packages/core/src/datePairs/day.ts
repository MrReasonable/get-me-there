import type { Buckets } from '../types/execution.js';
import { type ReducedMark, reducedMark } from './marks.js';

/**
 * Trips and Search plan, Ruling 18: a calendar day's mark, core's `reducedMark` over the buckets of the day's stays in
 * view summed, so a day takes the same precedence a date pair does: any priced stay makes it priced, then any airport
 * pair not searched makes it not searched (one stay with no price and three not run is never "no price"), then any
 * error, then no price, then not reached. A day with no stay reads not searched, as an empty set of buckets does.
 * `reused` is left at 0: it counts outcomes already in their own bucket and decides no mark.
 */
export function dayMark(stays: Iterable<Buckets>): ReducedMark {
  const sum: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
  for (const s of stays) {
    sum.priced += s.priced;
    sum.empty += s.empty;
    sum.no_data += s.no_data;
    sum.error += s.error;
    sum.skipped += s.skipped;
    sum.not_run += s.not_run;
  }
  return reducedMark(sum);
}
