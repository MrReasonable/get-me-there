import { compareAges, effectiveAge, type StaleMark } from '../labels/age.js';
import { resultRowKey } from '../results/rowKey.js';
import type { ResultRow } from '../results/types.js';
import type { CellKey, ResolvedSpace } from '../types/definition.js';
import type { IsoDateTime } from '../types/ids.js';
import type { Provenance } from '../types/provenance.js';
import { type PairingCandidate, type PairingRead, pairingLeads, pairingReadOf } from './pairing.js';
import { datePairIndexer } from './space.js';

/**
 * The figure of a date pair (spec §11 "The figure"; plan decisions 38, 53, 54, 58): the one price the Dates board and
 * overview show for it, chosen across the airport pairs in scope. The api's date-pairs route and the scoped `/results`
 * read both take it from here, so the board and the date pair detail cannot disagree (review prov-014).
 */
export type FigureCandidate = Pick<
  ResultRow,
  | 'cell'
  | 'verdictClass'
  | 'pricePence'
  | 'provenance'
  | 'stale'
  | 'ageHours'
  | 'truncated'
  | 'notSeenInLatest'
  | 'superseded'
  | 'totalMinutes'
  | 'outbound'
  | 'inbound'
  | 'itineraryHash'
  | 'calendarPriceId'
  | 'executionId'
>;

/** The calendar price a pairing figure replaced (spec rev 56 §6.9 "The grid price beside it"), shown beneath it. */
export interface GridPrice {
  pricePence: number;
  provenance: Provenance;
  stale: StaleMark;
  truncated: boolean;
}

/**
 * A chosen figure: a class-verified price (with the cheaper current calendar price it hides), a calendar price, or
 * (spec rev 56 §6.9) a pairing's cheapest offer. A calendar figure carries its cell's `pairingRead` (absent: `not-read`)
 * and the pairing shown beneath it when one exists; a pairing figure keeps the calendar candidate it replaced as
 * `chosen` (its "current" keys and its cell), the offer's stated price as `pricePence`, and that candidate's price as
 * `grid`.
 */
export type Figure<T extends FigureCandidate> =
  | { basis: 'verified'; chosen: T; cheaperCached: T | null }
  | {
      basis: 'calendar';
      chosen: T;
      cheaperCached: null;
      pairingRead?: PairingRead;
      pairing?: PairingCandidate;
    }
  | {
      basis: 'pairing';
      chosen: T;
      cheaperCached: null;
      pricePence: number;
      grid: GridPrice;
      pairing: PairingCandidate;
      pairingRead: 'within';
    };

/**
 * The api's read of a cell's newest flight list (spec rev 56 §6.9): `read` tells apart the list-based values
 * (`not-read`, `outbound-only`, `no-pairing-read`), and `candidate` is the cell's pairing when one was read, from which
 * core derives the rest (`pairingReadOf`) and whether it leads (`pairingLeads`).
 */
export type PairingOf = (cell: CellKey) => { read: PairingRead; candidate: PairingCandidate | null };
/** No flight read for any cell: every figure as it was before the pairing figure (the flight-list step's ranking). */
const NO_PAIRINGS: PairingOf = () => ({ read: 'not-read', candidate: null });

/** Ascending order of two strings by UTF-16 code units (locale-independent, as `generateCells` sorts airports). */
function order(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Generation order of two cells: origin, destination, departure, nights (as generateCells emits them). */
function cellOrder(a: CellKey, b: CellKey): number {
  return (
    order(a.origin, b.origin) ||
    order(a.destination, b.destination) ||
    order(a.departureDate, b.departureDate) ||
    // why: within one departure date, the earlier return is the fewer nights
    order(a.returnDate, b.returnDate)
  );
}

/** Generation order of a candidate's cell, then its row key: the one deterministic tie-break of every pick. */
function tieOrder(a: FigureCandidate, b: FigureCandidate): number {
  return cellOrder(a.cell, b.cell) || order(resultRowKey(a), resultRowKey(b));
}

/** The best class-verified price: one the newest search returned, then a fresh one, then the cheaper. */
export function pickVerifiedFigure<T extends FigureCandidate>(rows: readonly T[]): T | null {
  // why: decision 54 then 58: a price the newest search returned beats one it did not, a fresh one a stale one, then
  // the cheaper; a full tie falls to generation order and the row key, never to database order.
  const better = (a: T, b: T) =>
    (a.notSeenInLatest === null) !== (b.notSeenInLatest === null)
      ? a.notSeenInLatest === null
      : // why: the stale mark carries its kind (ruling 20.6-2); two stale prices of different kinds are equally stale
        (a.stale !== false) !== (b.stale !== false)
        ? a.stale === false
        : a.pricePence !== b.pricePence
          ? a.pricePence < b.pricePence
          : tieOrder(a, b) < 0;
  let best: T | null = null;
  for (const r of rows) if (best === null || better(r, best)) best = r;
  return best;
}

/** The best calendar price: a current one before a superseded one (decision 54), then the cheapest. */
export function pickCalendarFigure<T extends FigureCandidate>(rows: readonly T[]): T | null {
  const cheapest = (xs: readonly T[]) =>
    xs.reduce<T | null>(
      (m, r) =>
        m === null || r.pricePence < m.pricePence || (r.pricePence === m.pricePence && tieOrder(r, m) < 0)
          ? r
          : m,
      null,
    );
  return cheapest(rows.filter((r) => !r.superseded)) ?? cheapest(rows);
}

/**
 * Spec §11: the cheapest class-verified price that is not stale; else the fresher of the best stale verified price and
 * the best calendar price (unknown age loses to known; a tie goes to verified); else none. The pairing figure is
 * `figuresByDatePair`'s, over the calendar figure this chooses.
 */
export function pickFigure<T extends FigureCandidate>(
  candidates: readonly T[],
  now: IsoDateTime,
): Extract<Figure<T>, { basis: 'verified' | 'calendar' }> | null {
  // why: §11: partially-verified and failed prices are never the figure; 'unchecked' is a calendar price.
  const v = pickVerifiedFigure(candidates.filter((x) => x.verdictClass === 'verified'));
  const calendar = candidates.filter((x) => x.verdictClass === 'unchecked');
  const c = pickCalendarFigure(calendar);
  // why: revision 50: "cached from £X" quotes a current calendar price only; a later search found a superseded one empty.
  const current = pickCalendarFigure(calendar.filter((x) => !x.superseded));
  const cheaper = (shown: T) => (current !== null && current.pricePence < shown.pricePence ? current : null);
  if (v !== null && !v.stale) return { basis: 'verified', chosen: v, cheaperCached: cheaper(v) };
  if (v !== null && c !== null)
    // why: §8.1: fresher wins, unknown age loses to known, a tie goes to verified.
    return compareAges(effectiveAge(v.provenance, now), effectiveAge(c.provenance, now)) <= 0
      ? { basis: 'verified', chosen: v, cheaperCached: cheaper(v) }
      : { basis: 'calendar', chosen: c, cheaperCached: null };
  if (v !== null) return { basis: 'verified', chosen: v, cheaperCached: null };
  if (c !== null) return { basis: 'calendar', chosen: c, cheaperCached: null };
  return null;
}

/** The scope a figure is chosen over: the space with its airports already narrowed, and the journey limit. */
export interface FigureScope {
  /** airports already narrowed to the scope */
  space: ResolvedSpace;
  maxJourneyMinutes: number | null;
}

/**
 * Spec rev 56 §6.9: a calendar figure with its cell's flight read: the pairing figure when the cell's candidate leads
 * (`pairingLeads`; a verified figure is never asked, so it still wins, §11's precedence), else the calendar figure with
 * its `pairingRead` (left absent for `not-read`, so a cell with no flight read gives the figure exactly as before) and
 * the candidate shown beneath it.
 */
function withPairing<T extends FigureCandidate>(
  f: Extract<Figure<T>, { basis: 'calendar' }>,
  pairingOf: PairingOf,
): Figure<T> {
  const { read, candidate } = pairingOf(f.chosen.cell);
  if (candidate === null) return read === 'not-read' ? f : { ...f, pairingRead: read };
  const offer = candidate.offer;
  // why: `pairingLeads` requires the offer; reading it first narrows it here without an assertion
  if (offer === null || !pairingLeads(candidate))
    return { ...f, pairingRead: pairingReadOf(candidate), pairing: candidate };
  const c = f.chosen;
  return {
    basis: 'pairing',
    chosen: c,
    cheaperCached: null,
    pricePence: offer.priceMinor,
    grid: { pricePence: c.pricePence, provenance: c.provenance, stale: c.stale, truncated: c.truncated },
    pairing: candidate,
    pairingRead: 'within',
  };
}

/**
 * Every date pair's figure over a scope, keyed by date-pair index (`datePairIndex` of the scope's space), each calendar
 * figure joined with its cell's flight read through `pairingOf` (spec rev 56 §6.9), and, under a
 * journey limit, how many airport pairs of each date pair had every figure-eligible price left out for a known journey
 * time above it (spec §10 `journeyLeftOut`; only non-zero counts are in the map, and it is empty without a limit).
 * Figure-eligible is class verified or a calendar price; the caller has already kept only confirmed offers.
 *
 * why: decision 53: a candidate outside the scope's airports or space is dropped before any pick, so a filtered read
 * equals a definition holding only those airports. One pass groups the rest by date pair; each group is picked once.
 */
export function figuresByDatePair<T extends FigureCandidate>(
  candidates: readonly T[],
  scope: FigureScope,
  now: IsoDateTime,
  // why: defaulted, so the flight-list step's ranking (§8.1: by the calendar figures alone) and every present caller
  // compile and read as before
  pairingOf: PairingOf = NO_PAIRINGS,
): { figures: Map<number, Figure<T>>; journeyLeftOut: Map<number, number> } {
  const { space, maxJourneyMinutes: limit } = scope;
  const origins = new Set<string>(space.origins);
  const destinations = new Set<string>(space.destinations);
  const indexOf = datePairIndexer(space);
  const groups = new Map<number, T[]>();
  // `${index}|${origin}|${destination}` → whether one of the airport pair's figure-eligible prices was kept
  const eligible = new Map<string, boolean>();
  for (const x of candidates) {
    if (!origins.has(x.cell.origin) || !destinations.has(x.cell.destination)) continue;
    const index = indexOf(x.cell.departureDate, x.cell.returnDate);
    if (index === null) continue;
    // why: §10: a known journey time above the limit leaves a price out; an unknown one never does.
    const over = limit !== null && x.totalMinutes !== null && x.totalMinutes > limit;
    if (limit !== null && (x.verdictClass === 'verified' || x.verdictClass === 'unchecked')) {
      const key = `${index}|${x.cell.origin}|${x.cell.destination}`;
      eligible.set(key, eligible.get(key) === true || !over);
    }
    if (over) continue;
    const group = groups.get(index);
    if (group === undefined) groups.set(index, [x]);
    else group.push(x);
  }
  const figures = new Map<number, Figure<T>>();
  for (const [index, group] of groups) {
    const f = pickFigure(group, now);
    if (f !== null) figures.set(index, f.basis === 'calendar' ? withPairing(f, pairingOf) : f);
  }
  const journeyLeftOut = new Map<number, number>();
  for (const [key, kept] of eligible) {
    if (kept) continue;
    const index = Number(key.slice(0, key.indexOf('|')));
    journeyLeftOut.set(index, (journeyLeftOut.get(index) ?? 0) + 1);
  }
  return { figures, journeyLeftOut };
}
