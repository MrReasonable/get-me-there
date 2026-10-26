import { addDays, daysBetween, toEpochDay } from '../dates/epochDay.js';
import { windowDays } from '../space/generate.js';
import type { ResolvedSpace } from '../types/definition.js';
import type { IsoDate } from '../types/ids.js';

/**
 * The date-pair arithmetic of spec §10 (WP19). A date pair is a departure date and a stay length; its index is
 * `dayIndex × stays + (nights − minNights)`, the order `generateCells` walks the days and nights of one airport pair.
 * The day count is `windowDays`, the one clamp `countCells` shares, so an expired window has no date pairs.
 */
export type DatePairSpace = Omit<ResolvedSpace, 'origins' | 'destinations'>;

/** Stay lengths in the space: `max(0, maxNights − minNights + 1)`. */
export function stayCount(s: DatePairSpace): number {
  return Math.max(0, s.maxNights - s.minNights + 1);
}

/** Date pairs in the space: `windowDays × stayCount` (spec §10: at most 36,400). */
export function datePairCount(s: DatePairSpace): number {
  return windowDays(s) * stayCount(s);
}

/** Date pair `i` of the space. Throws `RangeError` for an index that is not one of the space's. */
export function datePairAt(
  s: DatePairSpace,
  i: number,
): { departureDate: IsoDate; returnDate: IsoDate; nights: number; dayIndex: number } {
  if (!Number.isInteger(i) || i < 0 || i >= datePairCount(s)) {
    throw new RangeError(`datePairAt: ${i} is not a date pair index of this space`);
  }
  const stays = stayCount(s);
  const dayIndex = Math.floor(i / stays);
  const nights = s.minNights + (i % stays);
  const departureDate = addDays(s.departureFrom, dayIndex);
  return { departureDate, returnDate: addDays(departureDate, nights), nights, dayIndex };
}

/** The index of a date pair in the space, or null when its departure or its stay lies outside it. */
export function datePairIndex(s: DatePairSpace, departureDate: IsoDate, returnDate: IsoDate): number | null {
  return indexOfDays(
    s,
    windowDays(s),
    daysBetween(s.departureFrom, departureDate),
    daysBetween(departureDate, returnDate),
  );
}

/**
 * `datePairIndex` for many dates over one space, each distinct date parsed once (a space has at most 490 of them,
 * while a read has up to 50,000 cells): the grouping of rows and cells into date pairs runs it per row.
 */
export function datePairIndexer(
  s: DatePairSpace,
): (departureDate: IsoDate, returnDate: IsoDate) => number | null {
  const epoch = new Map<string, number>();
  const dayOf = (d: IsoDate): number => {
    let e = epoch.get(d);
    if (e === undefined) {
      e = toEpochDay(d);
      epoch.set(d, e);
    }
    return e;
  };
  const from = toEpochDay(s.departureFrom);
  const days = windowDays(s);
  return (departureDate, returnDate) => {
    const dep = dayOf(departureDate);
    return indexOfDays(s, days, dep - from, dayOf(returnDate) - dep);
  };
}

/** The index from a day offset and a stay, given the space's day count; null outside. */
function indexOfDays(s: DatePairSpace, days: number, dayIndex: number, nights: number): number | null {
  if (dayIndex < 0 || dayIndex >= days || nights < s.minNights || nights > s.maxNights) return null;
  return dayIndex * stayCount(s) + (nights - s.minNights);
}
