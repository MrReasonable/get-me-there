/**
 * Spec revision 56 §8.1 "The flight-list step", Candidates and Reuse: which of the board's ranked date pairs a run reads
 * flight lists for. Pure (no repository, no clock): the caller passes the ranking, the newest list per cell, the
 * instants and the plan's return phase.
 */
import {
  BOOKING_FINISHED,
  type BookingStatus,
  cellKeyString,
  FLIGHT_LIST_COUNT,
  type FlightLimits,
  type IsoDate,
  type IsoDateTime,
  type Listed,
  RETURN_FINISHED,
  type ReturnStatus,
  sameFlightLimits,
} from '@gmt/core';
import type { NewestFlightList } from '@gmt/db';
import type { RankedDatePair } from '../../types.js';
import { HOUR_MS } from '../../units.js';
import { REUSE_TOLERANCE } from '../reuse.js';

/**
 * The newest stored list of one cell (same airport pair, dates, cabin and point of sale), as the selection reads it:
 * its statuses, the limits its return phase was read under (null without one) and how many of the cell's two newest
 * lists ended transient (spec rev 56 §7 `transientStreak`; R-retry).
 */
export interface NewestList {
  fetchedAt: IsoDateTime;
  status: 'read' | 'failed';
  listed: Listed | null;
  returnStatus: ReturnStatus | null;
  bookingStatus: BookingStatus | null;
  limits: FlightLimits | null;
  transientStreak: 0 | 1 | 2;
}

/** What a stored list holds that the reuse rule reads (spec rev 56 §8.1), from a newest-per-cell read of the repository. */
export function newestListOf(l: NewestFlightList): NewestList {
  return {
    fetchedAt: l.fetchedAt,
    status: l.status,
    listed: l.listed,
    returnStatus: l.returns?.status ?? null,
    bookingStatus: l.returns?.booking?.status ?? null,
    limits: l.returns?.limits ?? null,
    transientStreak: l.transientStreak,
  };
}

/**
 * The return phase a reuse is judged against (spec rev 56 §8.1): whether the plan reads returns and the booking
 * options, and the current limits (`flightLimitsOf` of the search's constraints) a finished list must have been read
 * under.
 */
export interface ReusePlan {
  returns: boolean;
  booking: boolean;
  current: FlightLimits;
}

/** A plan with no return phase (the worker's flag off or unread, or an older snapshot): reuse reads no status. */
export const OUTBOUND_ONLY: ReusePlan = Object.freeze({
  returns: false,
  booking: false,
  current: Object.freeze({
    maxJourneyMinutes: null,
    maxStops: null,
    departureWindowLocal: null,
    arrivalWindowLocal: null,
  }),
});

/**
 * Spec rev 56 §8.1 "Reuse" (Review Focus 3; R-retry; R-unverified), the one rule the step and the on-demand read's
 * `fresh` share: a newest list is reusable when it is `read` and younger than 0.9 × `refreshHours`, and either no
 * return phase is planned, or its return status is finished (`read` or `no-outbound`) under stored limits equal to the
 * current ones and, with the booking read planned, its return status is `no-outbound` or its booking status is finished
 * (`read` or `no-pairing`), or its `transientStreak` is 2 (its two newest lists both ended with a return or booking status
 * that is read again: it waits for its refresh). A `failed` list, an older one, and a phase-less, transient, `not-verified` or other-limit one are read.
 */
export function listReusable(
  n: NewestList,
  now: IsoDateTime,
  refreshHours: number,
  plan: ReusePlan,
): boolean {
  // why: elapsed milliseconds, never calendar days (the reuse rule of §8.2, tested across a clock change there)
  const youngest = Date.parse(now) - REUSE_TOLERANCE * refreshHours * HOUR_MS;
  if (n.status !== 'read' || Date.parse(n.fetchedAt) <= youngest) return false;
  if (!plan.returns || n.transientStreak === 2) return true;
  if (n.returnStatus === null || !RETURN_FINISHED.has(n.returnStatus)) return false;
  if (n.limits === null || !sameFlightLimits(n.limits, plan.current)) return false;
  return (
    !plan.booking ||
    n.returnStatus === 'no-outbound' ||
    (n.bookingStatus !== null && BOOKING_FINISHED.has(n.bookingStatus))
  );
}

/**
 * The key a pair's newest list is looked up by: `cellKeyString` over the figure's airport pair and the dates, so a list
 * for another airport pair on the same dates never counts (data-001).
 */
export function cellKeyOf(p: RankedDatePair): string {
  return cellKeyString(p);
}

/**
 * Design 2026-11-08 §4.2, §4.3 (confirm the cheapest trips): the step's queue, in the ranking's order: every pair whose
 * figure is current (a calendar price not superseded, a verified one the latest search saw) and is not a fresh verified
 * figure. A fresh verified figure is a confirmed trip already (an itinerary price), so it enters the standings by reuse
 * instead; a stale one is queued and read like a calendar price. Departed pairs are already out of `rankedPairsFor`.
 */
export function confirmQueue(ranked: readonly RankedDatePair[]): RankedDatePair[] {
  return ranked.filter((p) => p.current && !(p.basis === 'verified' && !p.stale));
}

/**
 * Spec revision 56 §8.1: the first `count` (FLIGHT_LIST_COUNT, 10) date pairs of `ranked` that depart after
 * `todayLondon`, in the ranking's order, split into those to `read` and those `reused` (`listReusable` of the newest
 * list for the pair's cell under `plan`). `read.length + reused.length ≤ count`. Design 2026-11-08 §4.2: the step in
 * confirm mode splits its whole queue (`count` Infinity); only the outbound-only fallback keeps the 10.
 */
export function selectFlightPairs(
  ranked: readonly RankedDatePair[],
  newest: ReadonlyMap<string, NewestList>,
  now: IsoDateTime,
  refreshHours: number,
  todayLondon: IsoDate,
  plan: ReusePlan = OUTBOUND_ONLY,
  count: number = FLIGHT_LIST_COUNT,
): { read: RankedDatePair[]; reused: RankedDatePair[] } {
  const read: RankedDatePair[] = [];
  const reused: RankedDatePair[] = [];
  // why: a pair departing today or earlier is no pick on the board, and its page would list flights already gone
  const candidates = ranked.filter((p) => p.departureDate > todayLondon).slice(0, count);
  for (const p of candidates) {
    const n = newest.get(cellKeyOf(p));
    if (n !== undefined && listReusable(n, now, refreshHours, plan)) reused.push(p);
    else read.push(p);
  }
  return { read, reused };
}
