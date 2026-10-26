import type { DatePair } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatMinutes } from '../../format.js';

// Spec §11 "How far checked", from the date pair's own counts: whether its figure is class verified or a calendar
// price; whether its cells were itinerary-searched, selected but not reached, or not selected; its partially-verified
// and unconfirmed prices; its airport pairs without a price, by bucket; "price from an earlier search" exactly when
// the figure says so (revision 50); a truncated read. Never the "searched" umbrella and never a word claiming
// completeness; "verified" only beside a class-verified figure. Pure: words from the catalogue, no DOM.

const H = COPY.datesView.howFar;

/** The unpriced buckets in the spec §3 order, each with its words; `not_run` is worded as a share of the pairs. */
const UNPRICED = ['empty', 'no_data', 'error', 'skipped'] as const;

/**
 * One line's parts for a date pair, over `airportPairs` in scope. A date pair without a figure says why: "none within
 * <limit>" when every price it had was left out for a known journey time (`journeyLeftOut`), then its marks.
 */
export function howFarChecked(pair: DatePair, airportPairs: number, journeyLimit: number | null): string[] {
  const out: string[] = [];
  const f = pair.figure;
  if (f !== null) {
    out.push(f.basis === 'verified' ? H.verified : H.calendar);
    if (f.price.truncated) out.push(H.cutShort);
    if (f.fromEarlierSearch) out.push(H.earlierSearch);
  } else if (pair.journeyLeftOut > 0 && journeyLimit !== null) {
    // why: spec §11 Filters: "none within <limit>" only on a date pair that had a price and saw every one left out
    out.push(H.noneWithin(formatMinutes(journeyLimit)));
  }
  if (f !== null) {
    if (pair.itinerarySearched > 0) out.push(H.itinerarySearched(pair.itinerarySearched, airportPairs));
    if (pair.notReached > 0) out.push(H.notReached(pair.notReached));
    // why: a selected cell neither itinerary-searched nor waiting ended in error (or a non-budget skip): worded as
    // such, never as "not reached" (§6.6: not reached is not_run or skipped:budget only)
    const other = pair.selected - pair.itinerarySearched - pair.notReached;
    if (other > 0) out.push(H.selectedOther(other));
    if (pair.selected === 0) out.push(H.notSelected);
  }
  if (pair.onDemand > 0) out.push(H.onDemand(pair.onDemand));
  if (pair.partiallyVerified > 0) out.push(H.partiallyVerified(pair.partiallyVerified));
  if (pair.unconfirmed > 0) out.push(H.unconfirmed(pair.unconfirmed));
  for (const b of UNPRICED) if (pair.buckets[b] > 0) out.push(H.bucket(pair.buckets[b], COPY.bucket[b]));
  if (pair.buckets.not_run > 0) out.push(H.notSearched(pair.buckets.not_run, airportPairs));
  return out;
}
