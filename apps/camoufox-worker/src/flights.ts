import {
  FLIGHT_LIST_MAX_FLIGHTS,
  type FlightsRequest,
  type IsoDate,
  type Listed,
  type ListedFlight,
  listedFlightSchema,
} from '@gmt/core';
import type { ListFacts } from './driver.js';
import { type ListRead, readOptions } from './list.js';
import { INTERSTITIALS, type Interstitial, type ParsedOption } from './names.js';

/**
 * The flights reader (spec revision 55 §2 "The flight-list read"; WP20 Task 20.7). It reads a list page's options as
 * the list reader does (the same cell filter, the same minimum over every parsed option of the cell, the same counts),
 * then turns each of the cell's options into one flight: its local times, the arrival's day offset from the dates its
 * name states, duration, stops, marketing carriers and operator as named, and its "From" price. Every flight passes
 * core's `listedFlightSchema` here, one by one (sec-004, prov-int-008): an option that does not (a time out of range,
 * a name longer than 80 characters, more than 6 carriers, no arrival date) is counted unparsed and the others stand.
 * Of the flights it keeps the 30 cheapest (FLIGHT_LIST_MAX_FLIGHTS), in page order.
 *
 * Google's own no-flights line never reaches a reader (the session answers it first; ruling B8), so `listed` here is
 * `flights` (at least one flight read) or `none-for-cell` (options listed, none of them a flight read for this cell).
 * `optionsUnparsed + optionsOtherCell + parsedForThisCell === names.length` holds as in the list read, where
 * `parsedForThisCell` counts the cell's options read as flights (kept, or dropped past 30).
 */
export interface FlightsRead extends ListRead {
  listed: Listed;
  /** The 30 cheapest of the cell's flights, in page order. */
  flights: ListedFlight[];
}

const DAY_MS = 86_400_000;

/**
 * The days from the departure to the arrival (spec rev 55 §2: 0 to 3), from the month and day each states and the
 * departure date's year; an arrival month before the departure's is the next year's. Null for an arrival before the
 * departure, more than 3 days after it, or a date no calendar has. Calendar arithmetic in UTC only.
 */
export function dayOffset(
  departsOn: { month: number; day: number },
  arrivesOn: { month: number; day: number },
  departureDate: IsoDate,
): number | null {
  const year = Number(departureDate.slice(0, 4));
  const utc = (y: number, d: { month: number; day: number }): number | null => {
    const t = Date.UTC(y, d.month - 1, d.day);
    const back = new Date(t);
    // why: Date.UTC rolls 30 February over to March; a date that does not round-trip is none
    return back.getUTCMonth() === d.month - 1 && back.getUTCDate() === d.day ? t : null;
  };
  const dep = utc(year, departsOn);
  const nextYear = arrivesOn.month < departsOn.month;
  const arr = utc(nextYear ? year + 1 : year, arrivesOn);
  if (dep === null || arr === null) return null;
  const days = (arr - dep) / DAY_MS;
  return days >= 0 && days <= 3 ? days : null;
}

/**
 * One name as a flight list stores it (spec rev 55 §2; sec-004): every whitespace run (tabs and line breaks included)
 * a single space, every other control or format character (bidi overrides, zero-width marks) removed, then trimmed.
 * The length cap and the character rule are the schema's, which refuses rather than truncates.
 */
function clean(s: string): string {
  return s
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** The marketing carriers as the name lists them: split on ", " and " and ", each cleaned. */
export function splitCarriers(s: string): string[] {
  return s.split(/, | and /).map(clean);
}

/** One option as a flight, or null when the flight schema refuses it (counted unparsed). */
function flightOf(p: ParsedOption, departureDate: IsoDate): ListedFlight | null {
  const offset = p.arrivesOn === null ? null : dayOffset(p.departsOn, p.arrivesOn, departureDate);
  if (offset === null) return null;
  const f = listedFlightSchema.safeParse({
    departsLocal: p.departsAt,
    arrivesLocal: p.arrivesAt,
    arrivesDayOffset: offset,
    durationMinutes: p.durationMinutes,
    stops: p.stops,
    carriers: splitCarriers(p.carriers),
    operatedBy: p.operatedBy === null ? null : clean(p.operatedBy),
    amountMinor: p.amountMinor,
  });
  return f.success ? f.data : null;
}

export function readFlights(
  f: ListFacts,
  req: Pick<FlightsRequest, 'departureDate' | 'airportNames'>,
  interstitials: readonly Interstitial[] = INTERSTITIALS,
): FlightsRead {
  const { list, mine } = readOptions(f, req, interstitials);
  const read: Array<{ at: number; flight: ListedFlight }> = [];
  for (const p of mine) {
    const flight = flightOf(p, req.departureDate);
    if (flight !== null) read.push({ at: read.length, flight });
  }
  // why: the 30 cheapest, ties in page order, then shown in page order (spec rev 55 §2)
  const kept = [...read]
    .sort((a, b) => a.flight.amountMinor - b.flight.amountMinor || a.at - b.at)
    .slice(0, FLIGHT_LIST_MAX_FLIGHTS)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.flight);
  const failed = mine.length - read.length;
  return {
    ...list,
    optionsUnparsed: list.optionsUnparsed + failed,
    parsedForThisCell: read.length,
    listed: kept.length > 0 ? 'flights' : 'none-for-cell',
    flights: kept,
  };
}
