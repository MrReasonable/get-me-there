/**
 * Spec revision 56 §6.9 "Flight lists and the date pair's figure" (Ian's ruling 1 of 2026-11-01; R-pick; R-lead;
 * R-sellers; ruling A8): the pairing figure's pure rules, one set the api and the web share. Which pairing a list read
 * (`cheapestPairing`), the one return-pick rule the worker books and the app expects (`bookingReturnOf`), the cheapest
 * offer of its booking read (`cheapestOffer`), and when it leads a date pair's figure (`pairingLeads`, `pairingReadOf`).
 */
import { compareReturns, type FlightLimits, fitsLimits } from '../flights/choose.js';
import { cheapestOffer, type Offer, type ReturnRead } from '../flights/returns.js';
import type { ListedFlight, ListedReturn } from '../flights/types.js';
import type { StaleMark } from '../labels/age.js';
import type { IsoDateTime } from '../types/ids.js';
import type { ResultBasis } from '../types/itinerary.js';
import type { Provenance } from '../types/provenance.js';

// why: spec rev 56 §6.9 names cheapestOffer among the pairing rules; its one body lives beside the booking read
export { cheapestOffer };

/**
 * A date pair figure's basis (spec rev 56 §6.5, §10): class verified, a calendar price, or the cheapest offer read for
 * a pairing (its price the offer's, its provenance the flight list's).
 */
export const FIGURE_BASES = ['verified', 'calendar', 'pairing'] as const;
export type FigureBasis = (typeof FIGURE_BASES)[number];

/**
 * What a calendar figure says of its cell's flight read when it does not lead (spec rev 56 §6.9; ten values, the first
 * that holds): `not-read` (no flight list for the cell), `list-failed` (the newest list failed: nothing was read, and its
 * cause is sent beside it; the 21.6 ruling), `outbound-only` (a list whose return phase read no return view),
 * `no-pairing-read` (a finished return phase with no return listed or read), `over-limit` (returns read, none fitting),
 * `within-other-limits` (read under other limits), `within-older` (older than the refresh), `sellers-not-read` (no
 * booking read of that pairing kept offers), `offers-incomplete` (offers kept but not complete); and `within`, exactly on
 * a pairing figure (the pairing leads).
 */
export const PAIRING_READ = [
  'not-read',
  'outbound-only',
  'no-pairing-read',
  'over-limit',
  'sellers-not-read',
  'offers-incomplete',
  'within',
  'within-older',
  'within-other-limits',
  // why: appended, so every earlier value keeps its wire code (R-sparse)
  'list-failed',
] as const;
export type PairingRead = (typeof PAIRING_READ)[number];
/** The three reads the api tells apart from the newest list itself, where there is no candidate (spec rev 56 §6.9). */
export type ListPairingRead = Extract<PairingRead, 'not-read' | 'outbound-only' | 'no-pairing-read'>;

/**
 * A list's pairing (spec rev 56 §6.9): the attempt and the return (into `attempts[attempt].returns`), its "from" price,
 * and whether its outbound and its return each fit the limits it was judged under.
 */
export interface Pairing {
  attempt: number;
  returnIndex: number;
  fromMinor: number;
  outboundFits: boolean;
  returnFits: boolean;
}

/** One return of one attempt, with its fits flags under the limits judged. */
interface Entry extends Pairing {
  ret: ListedReturn;
}

/**
 * The pairing of `attempts` (each tagged with its index in the read's attempts, `at`): the first by `compareReturns`
 * (the "from" price, then duration, stops and departure) among those whose outbound and return both fit; with none
 * fitting, the first by the same order of the last attempt's returns (the view the worker booked on: final review
 * B-I2), or of all when the last attempt listed none. Null with no return.
 *
 * why: one scan in attempt then index order keeps the first of equals (a strict `<` only), so a tie goes to the earlier
 * attempt, then the lower index, without a tie-break that could never decide (review finding 2)
 */
function pick(
  attempts: ReadonlyArray<{ at: number; a: ReturnRead['attempts'][number] }>,
  flights: readonly ListedFlight[],
  l: FlightLimits,
): Pairing | null {
  const entries: Entry[] = [];
  for (const { at, a } of attempts) {
    const outbound = flights[a.outboundIndex];
    // why: the contract refuses an outbound index past the list's flights, so this is a caller's bug, never a page's
    if (outbound === undefined)
      throw new RangeError(`no outbound ${a.outboundIndex} in ${flights.length} flights`);
    const outboundFits = fitsLimits(outbound, l, 'outbound');
    for (const [returnIndex, ret] of a.returns.entries())
      entries.push({
        attempt: at,
        returnIndex,
        fromMinor: ret.fromMinor,
        outboundFits,
        returnFits: fitsLimits(ret, l, 'return'),
        ret,
      });
  }
  const fitting = entries.filter((e) => e.outboundFits && e.returnFits);
  // why: final review B-I2: with nothing fitting, the pairing shown is the one whose sellers were read (the worker's
  // bookingReturnOf, over the last attempt), so its offers are kept and shown over the limits, never attempt 0's
  // cheaper "from" return with "sellers not read"
  const lastAt = attempts.at(-1)?.at;
  const last = entries.filter((e) => e.attempt === lastAt);
  let best: Entry | undefined;
  for (const e of fitting.length > 0 ? fitting : last.length > 0 ? last : entries)
    if (best === undefined || compareReturns(e.ret, best.ret) < 0) best = e;
  if (best === undefined) return null;
  return {
    attempt: best.attempt,
    returnIndex: best.returnIndex,
    fromMinor: best.fromMinor,
    outboundFits: best.outboundFits,
    returnFits: best.returnFits,
  };
}

/**
 * Spec rev 56 §6.9 "Which pairing": over every attempt's returns, the cheapest by `fromMinor`, then `compareReturns`,
 * then attempt, then index, among those whose outbound and return both fit `l`; with none fitting, the cheapest of the
 * last attempt's returns (the one the worker booked; of all when it listed none) by the same order with its fits flags;
 * null with no return at all. Judged under the limits passed (the current
 * search's); the stored limits decide reuse and whether the pairing may lead.
 */
export function cheapestPairing(
  r: ReturnRead,
  flights: readonly ListedFlight[],
  l: FlightLimits,
): Pairing | null {
  return pick(
    r.attempts.map((a, at) => ({ at, a })),
    flights,
    l,
  );
}

/**
 * R-pick (spec rev 56 §6.9): the ONE return-pick rule the worker books and the app expects: `cheapestPairing`'s order
 * restricted to the LAST attempt (the view the phase stands on), under `r.limits` (the request's); null when that attempt
 * listed no return (or none was made). The api uses a booking's offers only when its `attempt` and `returnIndex` equal it.
 */
export function bookingReturnOf(
  r: Pick<ReturnRead, 'attempts' | 'limits'>,
  flights: readonly ListedFlight[],
): { attempt: number; returnIndex: number } | null {
  const at = r.attempts.length - 1;
  const last = r.attempts[at];
  if (last === undefined) return null;
  const p = pick([{ at, a: last }], flights, r.limits);
  return p === null ? null : { attempt: p.attempt, returnIndex: p.returnIndex };
}

/**
 * What the api attaches per cell for the pairing figure (spec rev 56 §6.9, §10): the return's "from" price, the
 * cheapest offer of the booking read that names the pairing (`cheapestOffer`; null when none kept offers), how many
 * offers were read, whether they are complete (`offersComplete`), which outbound the pairing used (`cheapest`: the first
 * attempt's, within the limits; `next-cheapest`: the second attempt's; `over-limit`), the two legs' local times, whether
 * the cheapest offer differs from the "from" price (`mismatch`), the flight list's provenance, stale mark and age, and
 * the four facts `pairingLeads` reads.
 */
export interface PairingCandidate {
  fromMinor: number;
  offer: Offer | null;
  offersRead: number;
  complete: boolean;
  which: 'cheapest' | 'next-cheapest' | 'over-limit';
  times: { departOut: string; arriveOut: string; departBack: string; arriveBack: string };
  mismatch: boolean;
  provenance: Provenance;
  stale: StaleMark;
  ageHours: number | 'unknown';
  /** its outbound and its return both fit the current limits */
  fits: boolean;
  /** the list is not stale by the per-price rule (its age within the search's camoufox refresh) */
  fresh: boolean;
  /** the list's stored limits deep-equal today's `flightLimitsOf` */
  underCurrentLimits: boolean;
  fetchedAt: IsoDateTime;
  executionId: string | null;
}

/** The hour in milliseconds. */
const HOUR_MS = 3_600_000;

/**
 * Spec rev 56 §6.9, §10 (prov-007; final review B-M1): whether a flight list read at `fetchedAt` is within the search's
 * camoufox refresh at `now`, judged on the elapsed milliseconds (never whole hours, which `hoursSince` floors for
 * display), as the engine's reuse rule is. The list's stale mark and the pairing's freshness both read it.
 */
export function listFresh(fetchedAt: IsoDateTime, now: IsoDateTime, refreshHours: number): boolean {
  return Date.parse(now) - Date.parse(fetchedAt) <= refreshHours * HOUR_MS;
}

/**
 * The facts the lead rule reads (final review B-I1): a `PairingCandidate`'s, or the search page's own (the web's
 * pairing with an offer of its own shape), so the board and the block share one predicate.
 */
export type LeadFacts = Pick<PairingCandidate, 'fits' | 'fresh' | 'underCurrentLimits' | 'complete'> & {
  offer: object | null;
};

/**
 * R-lead with R-sellers (spec rev 56 §6.9 "When it leads"): the pairing leads its date pair exactly when it fits the
 * current limits, the list is fresh and was read under the current limits, and a booking read of it kept offers that
 * are complete (A8: an expand-failed booking only when its cheapest offer equals the return's "from" price, which
 * `offersComplete` decides). The api's figure and the search page's emphasis both read it (final review B-I1).
 */
export function pairingLeads(p: LeadFacts): boolean {
  return p.fits && p.fresh && p.underCurrentLimits && p.offer !== null && p.complete;
}

/**
 * Spec rev 56 §6.9 (the 21.1 concern-2 ruling; final review B-M2): the candidate-based `pairingRead`, the first that
 * holds in the spec's order: `within-other-limits` (read under other limits, over today's or not: the board then words
 * the limit edit as the search's page block does), `over-limit`, `within-older`, `sellers-not-read`,
 * `offers-incomplete`, else `within` (exactly when `pairingLeads`). The three list-based values (`not-read`,
 * `outbound-only`, `no-pairing-read`) come before these and are the api's to tell apart, from the newest list, where
 * there is no candidate.
 */
export function pairingReadOf(p: PairingCandidate): PairingRead {
  if (!p.underCurrentLimits) return 'within-other-limits';
  if (!p.fits) return 'over-limit';
  if (!p.fresh) return 'within-older';
  if (p.offer === null) return 'sellers-not-read';
  if (!p.complete) return 'offers-incomplete';
  return 'within';
}

/**
 * The `/results` basis a figure's detail opens on (spec rev 56 §6.9): a pairing figure opens on `calendar`, the row it
 * replaced; the others on themselves. The detail link, `datesState.ts` and `ResultsHeader.tsx` read it.
 */
export function resultBasisOf(b: FigureBasis): ResultBasis {
  switch (b) {
    case 'pairing':
      return 'calendar';
    case 'calendar':
    case 'verified':
      return b;
    default: {
      // why: the exhaustive switch's never default; a value from untyped JSON reaches it, and is refused, not passed on
      const unknownBasis: never = b;
      throw new RangeError(`resultBasisOf: no basis ${String(unknownBasis)}`);
    }
  }
}
