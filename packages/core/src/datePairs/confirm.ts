/**
 * Design 2026-11-08 (confirm the cheapest trips) §4.1, §4.3, §4.4, §4.5: the pure rule the engine's flight-read step
 * uses to decide when enough trips have flights read. "Confirmed" is the code's term only; the operator reads "trips
 * with flights read" (the app's "price not confirmed" mark owns the other word).
 */
import { type FlightLimits, sameFlightLimits } from '../flights/choose.js';
import type { ReturnRead } from '../flights/returns.js';
import type { ListedFlight } from '../flights/types.js';
import { cheapestPairing, pairingOffer, pairingPrice } from './pairing.js';

/** Design §4.4: how many confirmed trips the operator wants. */
export const CONFIRM_TARGET = 5;
/** Design §4.4: how many finished reads in a row may fail to improve the standings before the step stops. */
export const CONFIRM_PATIENCE = 12;

/** The confirmed trips so far (ascending pence) and the finished reads since one last improved them (§4.3, §4.4). */
export interface Standings {
  prices: readonly number[];
  sinceImprovement: number;
}

export const EMPTY_STANDINGS: Standings = Object.freeze({ prices: Object.freeze([]), sinceImprovement: 0 });

/**
 * What one finished check found (§4.3): `confirmed` a trip at a price; `none` no trip within the limits (the pair is
 * checked, with no confirmed price); `unread` nothing learnt about the pair's flights.
 */
export type Check = { kind: 'confirmed'; pricePence: number } | { kind: 'none' } | { kind: 'unread' };

/**
 * §4.4: a check improves the standings when it adds a confirmed trip and either fewer than `CONFIRM_TARGET` were
 * confirmed before it, or its price is strictly below the `CONFIRM_TARGET`-th confirmed price (equal does not).
 */
export function improves(s: Standings, c: Check): boolean {
  if (c.kind !== 'confirmed') return false;
  const fifth = s.prices[CONFIRM_TARGET - 1];
  return fifth === undefined || c.pricePence < fifth;
}

/**
 * §4.4: the standings after a check. A confirmed price is always inserted in order, improving or not. Patience counts
 * reads, never reuse: a `read` resets it on an improvement and otherwise adds 1 (every unimproving read, `none` and
 * `unread` included); a `reuse` leaves it as it was.
 */
export function applyCheck(s: Standings, c: Check, by: 'read' | 'reuse'): Standings {
  const better = improves(s, c);
  const prices = c.kind === 'confirmed' ? [...s.prices, c.pricePence].sort((a, b) => a - b) : s.prices;
  if (by === 'reuse') return { prices, sinceImprovement: s.sinceImprovement };
  return { prices, sinceImprovement: better ? 0 : s.sinceImprovement + 1 };
}

/** §4.4: the step starts no new read once the last `CONFIRM_PATIENCE` finished reads held no improvement. */
export function patienceSpent(s: Standings): boolean {
  return s.sinceImprovement >= CONFIRM_PATIENCE;
}

/**
 * §4.5: how many of the `remaining` calendar prices (pence) look cheaper than the standings' `CONFIRM_TARGET`-th price
 * and so were left unchecked; with fewer than `CONFIRM_TARGET` confirmed, every remaining one could still have made it.
 */
export function uncheckedCheaper(remaining: readonly number[], s: Standings): number {
  const fifth = s.prices[CONFIRM_TARGET - 1];
  if (fifth === undefined) return remaining.length;
  return remaining.filter((p) => p < fifth).length;
}

/**
 * Check one stored flight read (§4.1, §4.3): `unread` with no read, limits other than today's, or a return status other than
 * `read`/`no-outbound`; `none` for `no-outbound` or no pairing within the limits; otherwise `confirmed` at the
 * pairing's one price (a booking that ended transient is priced at Google's figure: sellers are not required).
 */
export function checkOfRead(
  r: ReturnRead | null,
  flights: readonly ListedFlight[],
  limits: FlightLimits,
): Check {
  if (r === null) return { kind: 'unread' };
  // why: a read under other limits, a no-outbound one included, says nothing about today's limits: the worker picked its
  // outbounds and returns under those limits, so a looser limit today may admit a trip it never read and a tighter one
  // may exclude the one it found; counting it as a trip or as none would put a price in the standings, or leave one
  // out, that today's limits never checked
  if (!sameFlightLimits(r.limits, limits)) return { kind: 'unread' };
  if (r.status === 'no-outbound') return { kind: 'none' };
  if (r.status !== 'read') return { kind: 'unread' };
  const p = cheapestPairing(r, flights, limits);
  if (p === null || !p.outboundFits || !p.returnFits) return { kind: 'none' };
  const { offer, complete } = pairingOffer(r, flights, p);
  return {
    kind: 'confirmed',
    pricePence: pairingPrice({ offer, complete, fromMinor: p.fromMinor }).pricePence,
  };
}
