/**
 * Spec revision 55 §8.1 "The flight-list step", Candidates: which of the board's ranked date pairs a run reads flight
 * lists for. Pure (no repository, no clock): the caller passes the ranking, the newest list per cell and the instants.
 */
import { cellKeyString, FLIGHT_LIST_COUNT, type IsoDate, type IsoDateTime, type Listed } from '@gmt/core';
import type { RankedDatePair } from '../../types.js';
import { HOUR_MS } from '../../units.js';
import { REUSE_TOLERANCE } from '../reuse.js';

/** The newest stored list of one cell (same airport pair, dates, cabin and point of sale), as the selection reads it. */
export interface NewestList {
  fetchedAt: IsoDateTime;
  status: 'read' | 'failed';
  listed: Listed | null;
}

/**
 * The key a pair's newest list is looked up by: `cellKeyString` over the figure's airport pair and the dates, so a list
 * for another airport pair on the same dates never counts (data-001).
 */
export function cellKeyOf(p: RankedDatePair): string {
  return cellKeyString(p);
}

/**
 * Spec revision 55 §8.1: the first `count` (FLIGHT_LIST_COUNT, 10) date pairs of `ranked` that depart after
 * `todayLondon`, in the ranking's order, split into those to `read` and those `reused`: a pair is reused when the newest
 * list for its cell is `read` and younger than 0.9 × `refreshHours` (the reuse tolerance discovery uses); a `failed`
 * newest list, of any age, is read again. `read.length + reused.length ≤ count`.
 */
export function selectFlightPairs(
  ranked: readonly RankedDatePair[],
  newest: ReadonlyMap<string, NewestList>,
  now: IsoDateTime,
  refreshHours: number,
  todayLondon: IsoDate,
  count: number = FLIGHT_LIST_COUNT,
): { read: RankedDatePair[]; reused: RankedDatePair[] } {
  const read: RankedDatePair[] = [];
  const reused: RankedDatePair[] = [];
  // why: elapsed milliseconds, never calendar days (the reuse rule of §8.2, tested across a clock change there)
  const youngest = Date.parse(now) - REUSE_TOLERANCE * refreshHours * HOUR_MS;
  // why: a pair departing today or earlier is no pick on the board, and its page would list flights already gone
  const candidates = ranked.filter((p) => p.departureDate > todayLondon).slice(0, count);
  for (const p of candidates) {
    const n = newest.get(cellKeyOf(p));
    if (n !== undefined && n.status === 'read' && Date.parse(n.fetchedAt) > youngest) reused.push(p);
    else read.push(p);
  }
  return { read, reused };
}
