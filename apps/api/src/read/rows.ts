/**
 * Result rows of both bases, prices with provenance, staleness and truncation (spec §6.2, §6.9, §8.1). Link
 * re-validation is `links.ts`; picking a figure out of rows is `pick.ts` (review arch-wp08-r2-008).
 */
import {
  type apiContract,
  type CellKey,
  type CellOutcome,
  CONSTRAINT_NAMES,
  type Config,
  type ConstraintName,
  type Constraints,
  cellKeyString,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  daysBetween,
  effectiveAge,
  evaluateConstraints,
  type FlightProvider,
  hoursSince,
  type IsoDateTime,
  isStale,
  type Provenance,
  type ProviderId,
  type SearchDefinition,
  unverifiedNames,
  verdictClass,
  worstCaseAgeHours,
} from '@gmt/core';
import type { CalendarPriceRow, ObservationRow } from '@gmt/db';
import type { z } from 'zod';
import { safeBooking, safeSearchLink } from './links.js';

export type ResultRow = z.infer<typeof apiContract.resultRowSchema>;
export type PriceCell = z.infer<typeof apiContract.priceCellSchema>;
export type Basis = 'verified' | 'calendar';
export interface RowContext {
  def: SearchDefinition;
  now: IsoDateTime;
  config: Config;
  providers: readonly FlightProvider[];
}

/** The definition's discovery refresh for a provider; core's DEFAULT_DISCOVERY_REFRESH_HOURS when unset (decision 21). */
export function refreshHoursFor(def: SearchDefinition, providerId: ProviderId): number {
  return def.providers.discoveryRefreshHours[providerId] ?? DEFAULT_DISCOVERY_REFRESH_HOURS;
}

/**
 * The calendar-basis stale threshold of a provider (spec §8.1): `CALENDAR_STALE_AFTER_HOURS` when set, else the
 * discovery refresh plus the provider's declared cache age (0 when the vendor's age is unknown).
 */
export function calendarThreshold(
  config: Config,
  providers: readonly FlightProvider[],
  providerId: ProviderId,
  refreshHours: number,
): number {
  if (config.calendarStaleAfterHours !== null) return config.calendarStaleAfterHours;
  const declared = providers.find((p) => p.id === providerId)?.discovery?.info.maxAgeHours ?? 0;
  return refreshHours + (declared === 'unknown' ? 0 : declared);
}

/** The calendar threshold for a provider of the row context's definition; the calendar route reports it per provider. */
export function calendarStaleAfterHours(rc: RowContext, providerId: ProviderId): number {
  return calendarThreshold(rc.config, rc.providers, providerId, refreshHoursFor(rc.def, providerId));
}

/** The threshold a price of this basis is judged against (spec §8.1). */
export function thresholdFor(basis: Basis, providerId: ProviderId, rc: RowContext): number {
  return basis === 'verified' ? rc.config.staleAfterHours : calendarStaleAfterHours(rc, providerId);
}

/**
 * Spec §3 and §8.1 at revision 24 (plan decisions 44, 53, 54). `ageHours` is the effective age from core: the observed
 * age when the vendor dates the price, else the fetch age plus a known `maxAgeHours`, else the fetch age alone (the web
 * labels that case "vendor's cache age unknown" from `provenance.maxAgeHours`). A price is stale when its effective age
 * exceeds the threshold, so an unknown vendor age is never stale on that account alone: core's `isStale`, the one copy
 * of the rule (decision 55).
 */
export function staleness(
  p: Provenance,
  thresholdHours: number,
  now: IsoDateTime,
): { ageHours: number; stale: boolean } {
  const ageHours = worstCaseAgeHours(effectiveAge(p, now));
  return { ageHours, stale: isStale(p, now, thresholdHours) };
}

/** A price on the wire: amount, provenance, staleness, age, truncation (decisions 36, 44). */
export function priceCell(
  pricePence: number,
  provenance: Provenance,
  basis: Basis,
  rc: RowContext,
  truncated: boolean,
): PriceCell {
  const s = staleness(provenance, thresholdFor(basis, provenance.providerId, rc), rc.now);
  return { pricePence, provenance, stale: s.stale, ageHours: s.ageHours, truncated };
}

/** The price part of a row, for the views that show a row's price as a PriceCell. */
export function priceOf(r: ResultRow): PriceCell {
  return {
    pricePence: r.pricePence,
    provenance: r.provenance,
    stale: r.stale,
    ageHours: r.ageHours,
    truncated: r.truncated,
  };
}

export function withNights(c: CellKey): ResultRow['cell'] {
  return {
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
    nights: daysBetween(c.departureDate, c.returnDate),
  };
}

/**
 * Constraints the operator set; on calendar rows these are "not applied" (spec §6.9). Core's `CONSTRAINT_NAMES` is the
 * one list (review arch-010); `cabin` and `priceConfirmed` are never keys of `Constraints`, so they never appear.
 */
export function configuredConstraints(c: Constraints): ConstraintName[] {
  const set = new Set(Object.entries(c).flatMap(([k, v]) => (v === undefined ? [] : [k])));
  return CONSTRAINT_NAMES.filter((n) => set.has(n));
}

function adjusted(
  def: SearchDefinition,
  destination: CellKey['destination'],
  pricePence: number,
): number | null {
  const onward = def.onwardCostPence[destination];
  return onward === undefined ? null : pricePence + onward; // why: a separate column, never merged into price (spec §11)
}

/**
 * Spec §6.9 calendar-basis row; `truncated` from the cell's discovery outcome (decisions 36, 47); `superseded` when a
 * newer parent execution found the cell empty or no_data for the same provider (decision 54).
 */
export function calendarRow(
  r: CalendarPriceRow,
  rc: RowContext,
  truncated: boolean,
  superseded: boolean,
): ResultRow {
  const p = priceCell(r.pricePence, r.provenance, 'calendar', rc, truncated);
  return {
    itineraryHash: null,
    basis: 'calendar',
    verdictClass: 'unchecked',
    ...p,
    cell: withNights(r.cell),
    outbound: null,
    inbound: null,
    totalMinutes: null,
    outboundMinutes: null,
    inboundMinutes: null,
    stopsOut: null,
    stopsIn: null,
    layovers: [],
    carriers: [],
    verdicts: {},
    unverified: [],
    notApplied: configuredConstraints(rc.def.constraints),
    seller: null,
    baggage: null,
    fareConditions: null,
    selfTransfer: null,
    booking: { kind: 'none' },
    searchLink: safeSearchLink(r.providerId, r.cell, rc.def, r.vendorLink),
    otherOffers: [],
    notSeenInLatest: null,
    superseded,
    adjustedPence: adjusted(rc.def, r.cell.destination, r.pricePence),
    destinationNote: rc.def.destinationNotes[r.cell.destination] ?? null,
    executionId: r.executionId,
    calendarPriceId: r.id,
    observationId: null,
  };
}

/** Spec §6.2/§6.9 verified-basis row: verdicts evaluated now, against the current definition. */
export function verifiedRow(
  o: ObservationRow,
  rc: RowContext,
  notSeenInLatest: { ageHours: number | 'unknown' } | null,
): ResultRow {
  const it = o.itinerary;
  const verdicts = evaluateConstraints(it, o, rc.def.constraints, rc.def.cabin, o.suppliedFields);
  // why: an itinerary search is never truncated; only calendar tiles are (decision 30).
  const p = priceCell(o.pricePence, o.provenance, 'verified', rc, false);
  return {
    itineraryHash: it.hash,
    basis: 'verified',
    verdictClass: verdictClass(verdicts),
    ...p,
    cell: o.cell,
    outbound: it.outbound,
    inbound: it.inbound,
    totalMinutes:
      it.outboundMinutes !== undefined && it.inboundMinutes !== undefined
        ? it.outboundMinutes + it.inboundMinutes
        : null,
    outboundMinutes: it.outboundMinutes ?? null,
    inboundMinutes: it.inboundMinutes ?? null,
    stopsOut: it.stopsOut,
    stopsIn: it.stopsIn,
    layovers: it.layovers,
    carriers: it.marketingCarriers,
    verdicts,
    unverified: unverifiedNames(verdicts),
    notApplied: [],
    seller: o.seller,
    baggage: o.baggage,
    fareConditions: o.fareConditions,
    selfTransfer: o.selfTransfer,
    booking: safeBooking(o.booking, o.offer.providerId),
    searchLink: safeSearchLink(o.offer.providerId, o.cell, rc.def),
    otherOffers: [],
    notSeenInLatest,
    superseded: false,
    adjustedPence: adjusted(rc.def, it.destination, o.pricePence),
    destinationNote: rc.def.destinationNotes[it.destination] ?? null,
    executionId: o.executionId,
    calendarPriceId: null,
    observationId: o.id,
  };
}

/** An offer's current price is its latest observation (spec §7 `latest` = max fetchedAt, tie id). */
export function latestPerOffer(rows: readonly ObservationRow[]): ObservationRow[] {
  const best = new Map<number, ObservationRow>();
  for (const r of rows) {
    const cur = best.get(r.offer.id);
    const a = r.provenance.fetchedAt;
    if (
      cur === undefined ||
      a > cur.provenance.fetchedAt ||
      (a === cur.provenance.fetchedAt && r.id > cur.id)
    )
      best.set(r.offer.id, r);
  }
  return [...best.values()];
}

/**
 * Spec §8.1: a row is "not seen in latest search" when its cell's newest `priced | empty`
 * verification outcome comes from another execution in which this offer has no observation.
 */
export function notSeenResolver(
  rows: readonly ObservationRow[],
  latestOutcome: (cell: CellKey) => CellOutcome | null,
  now: IsoDateTime,
) {
  const seen = new Set(rows.map((r) => `${r.executionId}|${r.offer.id}`));
  const cache = new Map<string, CellOutcome | null>();
  return (r: ObservationRow): { ageHours: number | 'unknown' } | null => {
    const key = cellKeyString(r.cell);
    let latest = cache.get(key);
    if (latest === undefined) {
      latest = latestOutcome(r.cell);
      cache.set(key, latest);
    }
    if (latest === null || (latest.status !== 'priced' && latest.status !== 'empty')) return null;
    if (latest.executionId === r.executionId || seen.has(`${latest.executionId}|${r.offer.id}`)) return null;
    // why: a priced or empty outcome always has fetchedAt; if one ever lacks it the age is not known, never "now".
    return { ageHours: latest.fetchedAt === null ? 'unknown' : hoursSince(latest.fetchedAt, now) };
  };
}
