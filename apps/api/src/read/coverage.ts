/** The coverage summary's parts every view header shows (spec §3, §11); `scope.ts` builds the summary itself. */
import type { apiContract, Buckets, CellOutcomeStatus } from '@gmt/core';
import type { z } from 'zod';

export type CoverageSummary = z.infer<typeof apiContract.coverageSummarySchema>;
/**
 * Statuses that mean "searched" (spec §3). A priced verification roll-up with a null price (`price-unconfirmed`,
 * decisions 45 and 48) is searched: it counts as itinerary-searched but contributes no itinerary-search price.
 */
export const SEARCHED: ReadonlySet<CellOutcomeStatus> = new Set(['priced', 'empty', 'no_data']);

export function zeroBuckets(): Buckets {
  return { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
}
