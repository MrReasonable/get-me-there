import type { ResultRow } from '../api-contract/results.js';
import type { Iata, IsoDate } from '../types/ids.js';
import type { ConstraintName, VerdictClass } from '../types/itinerary.js';
import type { ProviderId } from '../types/provenance.js';

// why: WP0 already exports `ResultRow` (z.infer of resultRowSchema) from the barrel; WP2 re-uses
// that one type rather than declaring a second name for it.
export type { ResultRow };

/** Spec §6.5 sort keys: price, total travel time, departure, return, nights, stops, adjusted. */
export type SortKey = 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'stops' | 'adjusted';

/**
 * Spec §6.5 filters, composed with AND. `verdictClass` absent means "every class except
 * `failed`" (spec §6.9: failed excluded by default, included by filter). `unverified` keeps a row
 * that leaves any of the named constraints unverified. `departure` keeps rows whose departure date
 * lies in `[from, to]`, both ends inclusive (decision 36: "only March" without leaving the table).
 */
export interface ResultFilters {
  verdictClass?: Array<VerdictClass | 'unchecked'>;
  unverified?: ConstraintName[];
  providerId?: ProviderId[];
  maxStops?: number;
  carriers?: string[];
  destination?: Iata[];
  maxPricePence?: number;
  nights?: { min: number; max: number };
  hideStale?: boolean;
  departure?: { from: IsoDate; to: IsoDate };
}
