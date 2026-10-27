import { compareAges, effectiveAge } from '../labels/age.js';
import { resultRowKey } from '../results/rowKey.js';
import type { ResultRow } from '../results/types.js';
import type { CellKey, ResolvedSpace } from '../types/definition.js';
import type { IsoDateTime } from '../types/ids.js';
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

/** A chosen figure: a class-verified price (with the cheaper current calendar price it hides), or a calendar price. */
export type Figure<T extends FigureCandidate> =
  | { basis: 'verified'; chosen: T; cheaperCached: T | null }
  | { basis: 'calendar'; chosen: T; cheaperCached: null };

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
      : a.stale !== b.stale
        ? !a.stale
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
 * the best calendar price (unknown age loses to known; a tie goes to verified); else none.
 */
export function pickFigure<T extends FigureCandidate>(
  candidates: readonly T[],
  now: IsoDateTime,
): Figure<T> | null {
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
 * Every date pair's figure over a scope, keyed by date-pair index (`datePairIndex` of the scope's space), and, under a
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
    if (f !== null) figures.set(index, f);
  }
  const journeyLeftOut = new Map<number, number>();
  for (const [key, kept] of eligible) {
    if (kept) continue;
    const index = Number(key.slice(0, key.indexOf('|')));
    journeyLeftOut.set(index, (journeyLeftOut.get(index) ?? 0) + 1);
  }
  return { figures, journeyLeftOut };
}
