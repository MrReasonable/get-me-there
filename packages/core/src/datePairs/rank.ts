import { toEpochDay } from '../dates/epochDay.js';
import { compareAges, effectiveAge } from '../labels/age.js';
import type { IsoDateTime } from '../types/ids.js';
import type { DatePair } from './encode.js';
import type { FigureBasis } from './pairing.js';

/**
 * Spec rev 56 §6.5: at equal prices, a verified figure before a pairing figure before a calendar one. An exhaustive
 * record, so a fourth basis cannot be added without its place.
 */
const BASIS_ORDER: Readonly<Record<FigureBasis, number>> = { verified: 0, pairing: 1, calendar: 2 };

/**
 * The board's rank (spec §11 "Board": the rank is by price whatever the sort), one pure function for the board and the
 * overview's shading. Date pairs without a figure are left out. Current figures first (superseded and not-seen ones
 * rank after every current one, decision 54; a pairing figure's are the calendar candidate's it replaced); then price
 * (a pairing figure's is its offer's); then verified before pairing before calendar (spec rev 56 §6.5); then the
 * fresher (unknown age last); then the index, which orders by departure, then nights.
 */
export function rankDatePairs(pairs: readonly DatePair[], now: IsoDateTime): DatePair[] {
  // why: each pair's key is computed once (decorate, sort, undecorate): 36,400 pairs re-rank inside the 200 ms limit.
  const keyed = pairs.flatMap((p) =>
    p.figure === null
      ? []
      : [
          {
            p,
            current: p.figure.superseded || p.figure.notSeenInLatest !== null ? 1 : 0,
            price: p.figure.price.pricePence,
            basis: BASIS_ORDER[p.figure.basis],
            age: effectiveAge(p.figure.price.provenance, now),
          },
        ],
  );
  keyed.sort(
    (a, b) =>
      a.current - b.current ||
      a.price - b.price ||
      a.basis - b.basis ||
      compareAges(a.age, b.age) ||
      // why: the index orders by departure, then nights; each date pair has one figure and one index, so the order is
      // total here (revision 50 removed §11's airport-pair tie, which could never be reached).
      a.p.index - b.p.index,
  );
  return keyed.map((k) => k.p);
}

/**
 * Revision 50 (Ian ruled 2026-10-26), "best per departure week": the first-ranked date pair of each departure week,
 * Monday to Sunday over departure dates, in rank order. Departure dates are calendar dates as the source states them,
 * so no time zone enters.
 */
export function bestPerWeek(ranked: readonly DatePair[]): DatePair[] {
  const weeks = new Set<number>();
  return ranked.filter((p) => {
    // why: epoch day 0 (1970-01-01) is a Thursday, so day + 3 puts every Monday at a multiple of 7.
    const week = Math.floor((toEpochDay(p.departureDate) + 3) / 7);
    if (weeks.has(week)) return false;
    weeks.add(week);
    return true;
  });
}
