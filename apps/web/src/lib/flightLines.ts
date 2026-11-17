import type { ListedFlight } from '@gmt/core';
import type { FlightListsResponse } from '../api/types.js';
import type { COPY } from '../copy.js';
import { formatIsoDateShort, formatMinutes } from '../format.js';

// Spec rev 55 §11 "Flights" (WP20 Task 20.10): the words a flight read is said in, kept beside their users once the
// search page's flights block went (design 2026-11-08 Ruling 21): the key a date pair's list is asked by, the dates of
// a read in short, a journey limit in hours and a flight's carriers. Every word is a COPY template, passed in.

type FlightCopy = (typeof COPY)['flights'];
/** One asked date pair's entry in `GET /definitions/:id/flight-lists`. */
export type FlightPair = FlightListsResponse['pairs'][number];

/** The key a date pair is asked and found by: the wire's `departure_return` form (spec rev 55 §10 `?pairs=`). */
export const pairKey = (p: { departureDate: string; returnDate: string }): string =>
  `${p.departureDate}_${p.returnDate}`;

/** "25h" for whole hours, else formatMinutes' "26h 40m" (spec rev 55 §11's limit words). */
export function hoursText(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : formatMinutes(minutes);
}

/** A flight's carriers in words: "Virgin Atlantic", or "…, operated by …" when the page names the operator. */
export function carriersText(f: Pick<ListedFlight, 'carriers' | 'operatedBy'>, c: FlightCopy): string {
  const carriers = f.carriers.join(', ');
  return f.operatedBy === null ? carriers : c.operatedBy(carriers, f.operatedBy);
}

/** "14 → 24 Mar", or "28 Mar → 7 Apr" across a month end: a read's dates in its live words (spec rev 55 §11). */
export function datesShort(departure: string, back: string, c: FlightCopy): string {
  const [from, to] = [formatIsoDateShort(departure), formatIsoDateShort(back)];
  const [day, month] = from.split(' ');
  return c.datesShort(month !== undefined && to.endsWith(` ${month}`) ? (day ?? from) : from, to);
}
