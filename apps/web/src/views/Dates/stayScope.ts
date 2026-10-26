import type { apiContract, DatePair, DatePairSpace } from '@gmt/core';

// Spec §11 Filters: the stay range is applied in the browser to the decoded date pairs, before ranking and shading, and
// the header line sums the counts of the date pairs left in view (revision 50: the stay filter applies first, and the
// bands fold the filtered range). Pure: no clock, no DOM.

type Range = { min: number; max: number };

/** The date pairs whose stay lies inside the range (both ends included), in index order; no range keeps every one. */
export function inStay(pairs: readonly DatePair[], nights: Range | null): readonly DatePair[] {
  if (nights === null) return pairs;
  return pairs.filter((p) => p.nights >= nights.min && p.nights <= nights.max);
}

/**
 * The coverage summary of the date pairs in view: every bucket, `reused` and the itinerary counts summed, and the cell
 * total as the six buckets' sum (the contract holds each date pair's buckets to its airport pairs, so this is the
 * cells in view). Over every date pair it equals the route's own summary.
 */
export function countsOf(pairs: readonly DatePair[]): apiContract.CoverageSummary {
  const buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
  let selected = 0;
  let itinerarySearched = 0;
  let onDemand = 0;
  for (const p of pairs) {
    const b = p.buckets;
    buckets.priced += b.priced;
    buckets.empty += b.empty;
    buckets.no_data += b.no_data;
    buckets.error += b.error;
    buckets.skipped += b.skipped;
    buckets.not_run += b.not_run;
    buckets.reused += b.reused;
    selected += p.selected;
    itinerarySearched += p.itinerarySearched;
    onDemand += p.onDemand;
  }
  return {
    buckets,
    total:
      buckets.priced + buckets.empty + buckets.no_data + buckets.error + buckets.skipped + buckets.not_run,
    selected,
    itinerarySearched,
    onDemand,
    reused: buckets.reused,
  };
}

/** The stay range in view: the filter clipped to the space's own range, or null when they do not meet. */
export function stayRange(space: DatePairSpace, nights: Range | null): Range | null {
  const min = Math.max(space.minNights, nights?.min ?? space.minNights);
  const max = Math.min(space.maxNights, nights?.max ?? space.maxNights);
  return min <= max ? { min, max } : null;
}

/** True when the filter leaves the space's whole stay range in view, so the header reads as with no filter. */
export function isFullStay(space: DatePairSpace, nights: Range | null): boolean {
  return nights === null || (nights.min <= space.minNights && nights.max >= space.maxNights);
}
