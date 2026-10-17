import type { Buckets, Iata, ProviderId } from '@gmt/core';
import type { CalendarDay } from '../../api/types.js';
import { COPY } from '../../copy.js';
import type { DaySlice } from './types.js';

type DiscoveryEntry = CalendarDay['discovery'][number];

/** The six buckets summed (spec §3); `reused` is already counted inside its bucket, never a seventh. */
export function bucketTotal(b: Buckets): number {
  return b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run;
}

/** Cells a provider searched: priced, no fares or no cached data (spec §3 "searched"). */
export function searchedCount(b: Buckets): number {
  return b.priced + b.empty + b.no_data;
}

/**
 * True when the api's total M equals the six buckets' sum (spec §3: they sum to the cell count). A mismatch is a WP8
 * accounting bug; the day says "counts inconsistent" rather than picking one number (plan decision 38).
 */
export function countsConsistent(d: DiscoveryEntry): boolean {
  return d.total === bucketTotal(d.buckets);
}

/** "P priced · E no fares · X no cached data · R error · S skipped · U not searched of M", M from the api (spec §11). */
export function formatDiscoveryMarker(d: DiscoveryEntry): string {
  const line = COPY.calendarView.discoveryMarker(d.buckets, d.total);
  return countsConsistent(d) ? line : `${line} · ${COPY.calendarView.countsInconsistent}`;
}

/** "itinerary-searched K of N selected +C on demand", or the not-configured note (spec §6.6 row 0). */
export function formatVerificationMarker(v: DaySlice['verification']): string {
  return v === null
    ? COPY.calendarView.verificationNotConfigured
    : COPY.calendarView.verificationMarker(v.itinerarySearched, v.selected, v.onDemand);
}

/** R′ for the header: reused outcomes over the slices and every discovery provider (spec §3). */
export function totalReused(slices: readonly DaySlice[]): number {
  return slices.reduce((sum, s) => sum + s.discovery.reduce((acc, d) => acc + d.buckets.reused, 0), 0);
}

/** The day's coverage cue (plan decision 38): searched cells of the day by its best-covered source. */
export type Coverage =
  | { kind: 'fraction'; searched: number; total: number; providerId: DiscoveryEntry['providerId'] }
  | { kind: 'inconsistent' }
  | { kind: 'none' };

/** The provider that searched most cells of the day (the first on a tie), or null when none has rows. */
export function bestCovered(discovery: readonly DiscoveryEntry[]): DiscoveryEntry | null {
  let best: DiscoveryEntry | null = null;
  for (const d of discovery)
    if (best === null || searchedCount(d.buckets) > searchedCount(best.buckets)) best = d;
  return best;
}

/**
 * The coverage cue of a slice, for the destination it was asked for (plan decision 53). With several discovery
 * providers the cue names the one that searched most cells, a lower bound on the cells any source searched; the panel
 * lists every provider.
 */
export function coverageOf(slice: DaySlice): Coverage {
  const best = bestCovered(slice.discovery);
  if (best === null) return { kind: 'none' };
  if (!slice.discovery.every(countsConsistent)) return { kind: 'inconsistent' };
  return {
    kind: 'fraction',
    searched: searchedCount(best.buckets),
    total: best.total,
    providerId: best.providerId,
  };
}

/**
 * Decision 48: a day says "price not confirmed" when its itinerary search priced cells but confirmed none, and only
 * while it shows no class-verified price. One predicate for the desktop and the phone body.
 */
export function showsUnconfirmed(slice: DaySlice): boolean {
  return slice.unconfirmedCells > 0 && slice.cheapestVerified === null;
}

/** The configured discovery providers that have no counts for the day: not searched yet by them (prov-r2-009). */
export function providersNotSearched(slice: DaySlice): ProviderId[] {
  return slice.discoveryProviders.filter((p) => !slice.discovery.some((d) => d.providerId === p));
}

/** Options that come from the definition, not from the day. */
export interface SliceOptions {
  verificationConfigured: boolean;
  /** The definition's discovery providers, in its order. */
  discoveryProviders: readonly ProviderId[];
}

/**
 * The slice a day renders. With a destination filter the api already computed every count, minimum and
 * `unconfirmedCells` for that destination (plan decision 53), so the day is taken as it came; `destination` only names
 * the filter in the panel's words.
 */
export function sliceOf(day: CalendarDay, o: SliceOptions, destination: Iata | null): DaySlice {
  const verification = o.verificationConfigured ? day.verification : null;
  return {
    discovery: day.discovery,
    discoveryProviders: o.discoveryProviders,
    verification,
    unconfirmedCells: verification?.unconfirmedCells ?? 0,
    cheapestVerified: day.cheapestVerified,
    cheapestPartiallyVerified: day.cheapestPartiallyVerified,
    cheapestCalendar: day.cheapestCalendar,
    destination,
  };
}
