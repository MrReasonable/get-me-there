/**
 * Spec revision 56 §6.9 "Flight lists and the date pair's figure" (WP21 Task 21.6): the one pairings map the board, the
 * scoped `/results` read and the cards share, so the detail and the board agree. For each asked cell the newest flight
 * list under the read's execution scope is read (`newestOfCells`, whatever its status), and core's rules judge it under
 * today's limits (`flightLimitsOf` of the definition's constraints):
 * `cheapestPairing`, the booking's offers only when they are `bookingReturnOf`'s and the pairing's (`cheapestOffer`,
 * `offersComplete`), and the stored limits against today's (`sameFlightLimits`). A list never changes coverage.
 */
import {
  bookingReturnOf,
  type CellKey,
  cellKeyString,
  cheapestOffer,
  cheapestPairing,
  type DatePairPairing,
  type FlightLimits,
  flightLimitsOf,
  hoursSince,
  type IsoDateTime,
  offersComplete,
  type PairingCandidate,
  type PairingOf,
  type Provenance,
  RETURN_FINISHED,
  type SearchDefinition,
  sameFlightLimits,
} from '@gmt/core';
import type { StoredFlightList } from '@gmt/db';
import { FLIGHT_LIST_PROVIDER, refreshHoursOf } from '@gmt/engine';
import type { Ports } from '../wiring.js';

const HOUR_MS = 3_600_000;

/** A flight list's provenance, as narrow as `flightListSchema` holds it (and a `Provenance`). */
export type FlightListProvenance = Provenance & {
  providerId: 'camoufox';
  sourceKind: 'scraped-self';
  maxAgeHours: 0;
  fx: { converted: false };
  cabin: 'economy';
};

/**
 * The provenance a flight list carries (spec rev 55 §10): the browser worker's own page, economy, GBP as read,
 * `maxAgeHours` 0, the point of sale the page stated. The flight-lists read and the pairing figure share it.
 */
export function flightListProvenance(
  l: Pick<StoredFlightList, 'fetchedAt' | 'pointOfSale'>,
): FlightListProvenance {
  return {
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    fetchedAt: l.fetchedAt,
    maxAgeHours: 0,
    fx: { converted: false },
    pointOfSale: l.pointOfSale,
    cabin: 'economy',
  };
}

/**
 * Spec rev 56 §6.9: one finished list's pairing candidate under `limits` (today's), or null when no return was listed
 * or read (no-outbound, none-for-cell). The booking's offers count only when its attempt and return are both
 * `bookingReturnOf`'s (the one return-pick rule the worker books) and the pairing's, so a price is never shown for a
 * pairing it was not read for.
 */
export function candidateOf(
  l: StoredFlightList,
  limits: FlightLimits,
  now: IsoDateTime,
  refreshHours: number,
): PairingCandidate | null {
  const r = l.returns;
  if (r === null) return null;
  const p = cheapestPairing(r, l.flights, limits);
  const attempt = p === null ? undefined : r.attempts[p.attempt];
  const outbound = attempt === undefined ? undefined : l.flights[attempt.outboundIndex];
  const ret = p === null ? undefined : attempt?.returns[p.returnIndex];
  if (p === null || outbound === undefined || ret === undefined) return null;
  const booked = bookingReturnOf(r, l.flights);
  const b = r.booking;
  const forPairing =
    b !== null &&
    booked !== null &&
    b.attempt === booked.attempt &&
    b.returnIndex === booked.returnIndex &&
    b.attempt === p.attempt &&
    b.returnIndex === p.returnIndex;
  const offer = forPairing ? (cheapestOffer(b)?.offer ?? null) : null;
  const ageHours = hoursSince(l.fetchedAt, now);
  // why: prov-007: freshness is judged on the elapsed milliseconds, as the engine's reuse rule is; `hoursSince` floors to
  // whole hours and is for display only (a list 168 h 59 m old under refresh 168 is past it)
  const fresh = Date.parse(now) - Date.parse(l.fetchedAt) <= refreshHours * HOUR_MS;
  const fits = p.outboundFits && p.returnFits;
  return {
    fromMinor: p.fromMinor,
    offer,
    offersRead: offer === null || b === null ? 0 : b.offers.length,
    complete: offer !== null && b !== null && offersComplete(b, p.fromMinor),
    which: !fits ? 'over-limit' : p.attempt > 0 ? 'next-cheapest' : 'cheapest',
    times: {
      departOut: outbound.departsLocal,
      arriveOut: outbound.arrivesLocal,
      departBack: ret.departsLocal,
      arriveBack: ret.arrivesLocal,
    },
    mismatch: offer !== null && offer.priceMinor !== p.fromMinor,
    provenance: flightListProvenance(l),
    // why: spec rev 55 §10: a list is judged against the camoufox refresh only; stale exactly when not fresh
    stale: fresh ? false : 'refresh',
    ageHours,
    fits,
    fresh,
    underCurrentLimits: sameFlightLimits(r.limits, limits),
    fetchedAt: l.fetchedAt,
    executionId: l.executionId,
  };
}

/**
 * Spec rev 56 §10's `pairing` group from a candidate: the cheapest offer's stated price with its seller and fare, or the
 * return's "from" price (`isFrom`, no seller) when no offer was read for it or it is over the limits; the offers read,
 * whether complete, which outbound, the four times, the mismatch mark, and the list's provenance, stale mark and age.
 */
export function pairingGroupOf(c: PairingCandidate): DatePairPairing {
  // why: an over-limit pairing is shown as its "from" price (spec rev 56 §6.9), whatever was read of its sellers
  const offer = c.fits ? c.offer : null;
  return {
    pricePence: offer?.priceMinor ?? c.fromMinor,
    isFrom: offer === null,
    seller: offer?.seller ?? null,
    fare: offer?.fare ?? null,
    offersRead: offer === null ? 0 : c.offersRead,
    complete: offer !== null && c.complete,
    which: c.which,
    ...c.times,
    mismatch: offer !== null && c.mismatch,
    provenance: c.provenance,
    stale: c.stale,
    ageHours: c.ageHours,
  };
}

/** What a lookup answers for a cell with no flight list in the read's scope. */
const NOT_READ = { read: 'not-read', candidate: null } as const;

/**
 * The pairings of `def` for the cells `asked` (the cells whose figure may take a pairing, from a first pass), under
 * the read's execution scope (null: every list, on-demand ones included; else only those executions' lists). One
 * repository read over the asked cells only (21.6 review M6): the newest list of each in the scope, whatever its status
 * (prov-002, so a newer list outside the scope never makes a cell the scoped run read look unread). No list is
 * `not-read`; a failed one is `list-failed` with its reason (the 21.6 ruling: it read nothing, the outbound included); a
 * list with no finished return phase is `outbound-only`; a finished one gives its candidate, or `no-pairing-read`.
 */
export function pairingsFor(
  ports: Ports,
  def: SearchDefinition,
  executionIds: readonly string[] | null,
  asked: readonly CellKey[],
): PairingOf {
  const now = ports.clock.now();
  const limits = flightLimitsOf(def.constraints);
  const refreshHours = refreshHoursOf(def, FLIGHT_LIST_PROVIDER);
  const newest = new Map(
    ports.repos.flightLists
      .newestOfCells(
        def.id,
        asked,
        def.cabin,
        ports.config.pointOfSale,
        executionIds === null ? null : { executionIds },
      )
      .map((l) => [cellKeyString(l), l]),
  );
  return (cell) => {
    const l = newest.get(cellKeyString(cell));
    if (l === undefined) return NOT_READ;
    // why: a list has a reason exactly when it failed (flight_lists_failed_reason_ck)
    if (l.reason !== null) return { read: 'list-failed', reason: l.reason, candidate: null };
    if (l.returns === null || !RETURN_FINISHED.has(l.returns.status))
      return { read: 'outbound-only', candidate: null };
    const candidate = candidateOf(l, limits, now, refreshHours);
    return candidate === null ? { read: 'no-pairing-read', candidate: null } : { candidate };
  };
}
