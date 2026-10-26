import type { apiContract } from '@gmt/core';
import { COPY } from '../copy.js';

/**
 * Spec §11's coverage line, "discovery: P priced · … of M (R′ reused) · itinerary-searched K of N selected (E outbounds
 * each) +C on demand", over the cells a summary counts. The one builder for the Results header, the Dates header and
 * the date pair detail, so the three never word it differently. The itinerary clause describes the shown run: the
 * current configuration speaks only when that run itinerary-searched nothing; "(E outbounds each)" is the run's own
 * policy (decision 42), never the definition's.
 */
export function coverageLineText(
  c: apiContract.CoverageSummary,
  verificationProviderConfigured: boolean,
  latestParent: { expandTop: number } | undefined,
): string {
  const b = c.buckets;
  const itinerary = { searched: c.itinerarySearched, selected: c.selected, onDemand: c.onDemand };
  return (
    COPY.coverageLine({
      priced: b.priced,
      empty: b.empty,
      noData: b.no_data,
      error: b.error,
      skipped: b.skipped,
      notRun: b.not_run,
      total: c.total,
      reused: c.reused,
    }) +
    (!verificationProviderConfigured && c.itinerarySearched === 0 && c.onDemand === 0
      ? COPY.noItinerarySearch
      : latestParent !== undefined
        ? COPY.itineraryLineExpand({ ...itinerary, expandTop: latestParent.expandTop })
        : COPY.itineraryLine(itinerary))
  );
}
