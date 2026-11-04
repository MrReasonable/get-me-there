import {
  FLIGHT_LIST_MAX_FLIGHTS,
  type FlightLimits,
  type FlightsRequest,
  fitsLimits,
  type IsoDate,
  type ListedReturn,
  listedReturnSchema,
} from '@gmt/core';
import { airportMatches } from './airports.js';
import type { ListFacts } from './driver.js';
import { cleanName, splitCarriers } from './flights.js';
import { INTERSTITIALS, type Interstitial, type ParsedOption, parseOptionName } from './names.js';

/**
 * The return reader (spec revision 56 §2 "The returns"; WP21 Task 21.3). It reads the return view the selected
 * outbound's activation showed: every link's name through the one option grammar (names.ts: the return names share the
 * outbound's, "From" clause included, 38 of 38 recorded), an option being the pair's when it departs on the RETURN date
 * from a DESTINATION name and arrives at an ORIGIN name. Each of the pair's options becomes one return through core's
 * `listedReturnSchema` (a refusal counts unparsed): its local times, its day offset from the return date (−1 to 3), the
 * leg's duration, stops, carriers and operator, and `fromMinor`, its "From" figure (the cheapest seller's price for that
 * outbound and that return, a lower bound). R-returns30: the returns fitting the request's limits on the return leg
 * come first by price, then the rest by price, cut to FLIGHT_LIST_MAX_FLIGHTS, and are kept in page order with their
 * names (aligned, never in an answer). Only returnPhase.ts imports this module (rules.test.ts pins that).
 */
export interface ReturnsRead {
  listed: 'returns' | 'none-for-cell';
  returns: ListedReturn[];
  /** Each kept return's link name, aligned with `returns`: the booking read activates the picked return by it. */
  names: string[];
  /** R-viewmore: a "View more" control showed, or the view stated more results than it listed. */
  moreListed: boolean;
  optionsUnparsed: number;
  optionsOtherCell: number;
  /** The pair's options read as returns, kept or past the cut. */
  parsedForThisCell: number;
  resultsStated: number | null;
  /** The currency the page states (`Currency <code>`), or null when it states none. */
  currency: string | null;
}

const DAY_MS = 86_400_000;

/**
 * Spec rev 56 §2: the calendar days from the return date to the arrival (−1 to 3: −1 a date-line return arriving the
 * previous calendar day), from the month and day each states and the return date's year; the arrival's year is the one
 * (that year, the one before or the one after) that puts it within the range, so 31 Dec to 1 Jan is 1 and 1 Jan to
 * 31 Dec is −1. Null for anything outside −1..3 or a date no calendar has. Calendar arithmetic in UTC only.
 */
export function returnDayOffset(
  departsOn: { month: number; day: number },
  arrivesOn: { month: number; day: number },
  returnDate: IsoDate,
): number | null {
  const year = Number(returnDate.slice(0, 4));
  const utc = (y: number, d: { month: number; day: number }): number | null => {
    const t = Date.UTC(y, d.month - 1, d.day);
    const back = new Date(t);
    // why: Date.UTC rolls 30 February over to March; a date that does not round-trip is none
    return back.getUTCMonth() === d.month - 1 && back.getUTCDate() === d.day ? t : null;
  };
  const dep = utc(year, departsOn);
  if (dep === null) return null;
  for (const y of [year, year + 1, year - 1]) {
    const arr = utc(y, arrivesOn);
    if (arr === null) return null;
    const days = (arr - dep) / DAY_MS;
    if (days >= -1 && days <= 3) return days;
  }
  return null;
}

/** One of the pair's options as a return, or null when the return schema refuses it (counted unparsed). */
function returnOf(p: ParsedOption, returnDate: IsoDate): ListedReturn | null {
  const offset = p.arrivesOn === null ? null : returnDayOffset(p.departsOn, p.arrivesOn, returnDate);
  if (offset === null) return null;
  const r = listedReturnSchema.safeParse({
    departsLocal: p.departsAt,
    arrivesLocal: p.arrivesAt,
    arrivesDayOffset: offset,
    durationMinutes: p.durationMinutes,
    stops: p.stops,
    carriers: splitCarriers(p.carriers),
    operatedBy: p.operatedBy === null ? null : cleanName(p.operatedBy),
    // why: the name's "From" figure, named for what it is (prov-r3-003): never the total
    fromMinor: p.amountMinor,
  });
  return r.success ? r.data : null;
}

/** Spec rev 56 §2: the return view's facts read for the pair the request names, under the request's limits. */
export function readReturns(
  f: ListFacts,
  req: Pick<FlightsRequest, 'returnDate' | 'airportNames'> & { returnLimits: FlightLimits },
  interstitials: readonly Interstitial[] = INTERSTITIALS,
): ReturnsRead {
  const ret = new Date(`${req.returnDate}T00:00:00.000Z`);
  let unparsed = 0;
  let other = 0;
  const read: Array<{ at: number; r: ListedReturn; name: string; fits: boolean }> = [];
  for (const name of f.names) {
    // why: spec rev 56 §2: one grammar for both legs (names.ts), with no alias and no second version
    const p = name === null || name === '' ? null : parseOptionName(name, interstitials);
    if (name === null || p === null) unparsed++;
    else if (
      p.departsOn.month === ret.getUTCMonth() + 1 &&
      p.departsOn.day === ret.getUTCDate() &&
      airportMatches(p.from, req.airportNames.destination, req.airportNames.otherDestinations) &&
      airportMatches(p.to, req.airportNames.origin, req.airportNames.otherOrigins)
    ) {
      const r = returnOf(p, req.returnDate);
      if (r === null) unparsed++;
      else read.push({ at: read.length, r, name, fits: fitsLimits(r, req.returnLimits, 'return') });
    } else other++;
  }
  // why: R-returns30: the fitting returns first by price, then the rest by price (ties in page order), cut to 30, then
  // shown in page order, so a fitting return dearer than 30 others is never dropped
  const kept = [...read]
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.r.fromMinor - b.r.fromMinor || a.at - b.at)
    .slice(0, FLIGHT_LIST_MAX_FLIGHTS)
    .sort((a, b) => a.at - b.at);
  const listedCount = f.names.length;
  return {
    listed: kept.length > 0 ? 'returns' : 'none-for-cell',
    returns: kept.map((x) => x.r),
    names: kept.map((x) => x.name),
    // why: R-viewmore: every name listed was read, refused or another cell's, so "more" is a control or a larger count
    moreListed: f.viewMore === true || (f.resultsStated !== null && f.resultsStated > listedCount),
    optionsUnparsed: unparsed,
    optionsOtherCell: other,
    parsedForThisCell: read.length,
    resultsStated: f.resultsStated,
    currency: f.currencyName === null ? null : (/^Currency ([A-Z]{3})$/.exec(f.currencyName)?.[1] ?? null),
  };
}
