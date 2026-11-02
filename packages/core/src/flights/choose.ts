/**
 * Spec revision 56 §6.2 "The limits a flight read is judged against" and §11 "Flights": the search's limits as a flight
 * read applies them, the one outbound selection rule (`selectOutbound`), and which of a date pair's outbound and return
 * flights a search's page shows (the choosers; ruling persona-010). Pure; the page passes the search's own limits.
 */
import { z } from 'zod';
import { inWindow } from '../constraints/evaluate.js';
import type { Constraints } from '../types/definition.js';
import { localTimeWindowSchema } from '../types/window.js';
import { FLIGHTS_SHOWN, RETURNS_SHOWN } from './limits.js';
import type { LegTimes, ListedFlight, ListedReturn } from './types.js';

/**
 * Spec rev 56 §6.2, §5.1: the four constraints a flight read is judged against: the longest journey and `maxStops` on
 * each leg (per direction), and the departure and arrival windows on the outbound's local times only (the definition
 * has no return windows). Null means not set. Strict, so a stored or sent value carries nothing else.
 */
export const flightLimitsSchema = z.strictObject({
  maxJourneyMinutes: z.number().int().min(1).nullable(),
  // why: R-order: optional until Task 21.7 (the web's limitsOf is its last consumer); absent is met, as null is
  maxStops: z.number().int().min(0).nullable().exactOptional(),
  departureWindowLocal: localTimeWindowSchema.nullable(),
  arrivalWindowLocal: localTimeWindowSchema.nullable(),
});
export type FlightLimits = z.infer<typeof flightLimitsSchema>;

/**
 * Spec rev 56 §6.2: the limits of a search's constraints, every one it does not set null (the selection, the
 * choosers, every "within your limits" mark and the pairing figure apply exactly these).
 */
export function flightLimitsOf(
  c: Pick<Constraints, 'maxJourneyMinutes' | 'maxStops' | 'departureWindowLocal' | 'arrivalWindowLocal'>,
): FlightLimits {
  return {
    maxJourneyMinutes: c.maxJourneyMinutes ?? null,
    maxStops: c.maxStops ?? null,
    departureWindowLocal: c.departureWindowLocal ?? null,
    arrivalWindowLocal: c.arrivalWindowLocal ?? null,
  };
}

/** Which leg a flight is: the windows apply to the outbound only (spec rev 56 §6.2). */
export type Leg = 'outbound' | 'return';

/**
 * What a page shows of one list (spec rev 55 §11): `shown`, at most `FLIGHTS_SHOWN` (or `RETURNS_SHOWN`); `overLimit`
 * when no flight read fits the limits (the shown ones are then each marked); `moreRead`, the flights read and not shown
 * ("3 more read"); `moreOutside`, those of them outside a limit ("1 outside your limits").
 */
export interface ShownFlights<T> {
  shown: T[];
  overLimit: boolean;
  moreRead: number;
  moreOutside: number;
}

/**
 * Spec rev 56 §6.2: a leg against each limit. `journey`: its duration is no longer than the longest journey
 * (inclusive); `stops`: its stops are at most `maxStops` (absent or null is met); `arrival` and `departure`: its local
 * arrival or departure time is inside that window (inclusive; a window whose start is later than its end wraps midnight,
 * as §6.2 reads it), always met on the `'return'` leg. A limit not set is met.
 */
export function withinLimits<T extends LegTimes>(
  f: T,
  l: FlightLimits,
  leg: Leg = 'outbound',
): { journey: boolean; stops: boolean; arrival: boolean; departure: boolean } {
  // why: the definition has no return windows, so the page says "windows apply to the outbound" (spec rev 56 §6.2)
  const windows = leg === 'outbound';
  return {
    journey: l.maxJourneyMinutes === null || f.durationMinutes <= l.maxJourneyMinutes,
    stops: l.maxStops === undefined || l.maxStops === null || f.stops <= l.maxStops,
    arrival: !windows || l.arrivalWindowLocal === null || inWindow(f.arrivesLocal, l.arrivalWindowLocal),
    departure:
      !windows || l.departureWindowLocal === null || inWindow(f.departsLocal, l.departureWindowLocal),
  };
}

/**
 * A page's `HH:MM` local time as one number that orders as the time does (07:15 → 715), so two times compare by
 * subtraction (the schema admits only zero-padded 24-hour times).
 */
export function clockOf(t: string): number {
  return Number(t.replace(':', ''));
}

/** Every limit met on that leg. */
const fits = (f: LegTimes, l: FlightLimits, leg: Leg): boolean => {
  const w = withinLimits(f, l, leg);
  return w.journey && w.stops && w.arrival && w.departure;
};

/**
 * Spec rev 55 §11's order of flights read: cheapest first, then shortest, then fewer stops, then the earlier departure. Returns a
 * negative, zero or positive number, as `Array.prototype.sort` takes.
 */
export function compareFlights(a: ListedFlight, b: ListedFlight): number {
  return (
    a.amountMinor - b.amountMinor ||
    a.durationMinutes - b.durationMinutes ||
    a.stops - b.stops ||
    clockOf(a.departsLocal) - clockOf(b.departsLocal)
  );
}

/**
 * Spec rev 56 §6.2: the returns' order, the outbound's mirror: the lower "from" price first, then the shorter, then
 * fewer stops, then the earlier departure. The caller breaks the rest by index.
 */
export function compareReturns(a: ListedReturn, b: ListedReturn): number {
  return (
    a.fromMinor - b.fromMinor ||
    a.durationMinutes - b.durationMinutes ||
    a.stops - b.stops ||
    clockOf(a.departsLocal) - clockOf(b.departsLocal)
  );
}

/**
 * Spec rev 56 §6.2: the one outbound selection rule. Over the flights not in `skip`: the first that fits every limit in
 * `compareFlights` order, ties by the lowest index (page order); with none fitting, the first by the same order, with
 * `fits` false. The worker's outbound pick, its second pick (the first in `skip`) and the page's "selected" mark all come
 * from it. Throws `RangeError` when no flight is left to select (an empty input: the caller answers `no-outbound`
 * before calling).
 */
export function selectOutbound<T extends ListedFlight>(
  flights: readonly T[],
  l: FlightLimits,
  skip: ReadonlySet<number> = new Set(),
): { index: number; flight: T; fits: boolean } {
  let best: { index: number; flight: T; fits: boolean } | null = null;
  for (const [index, flight] of flights.entries()) {
    if (skip.has(index)) continue;
    const ok = fits(flight, l, 'outbound');
    // why: a fitting flight beats any that does not; then the order; a tie keeps the earlier index (strictly lower only)
    if (best === null || (ok && !best.fits) || (ok === best.fits && compareFlights(flight, best.flight) < 0))
      best = { index, flight, fits: ok };
  }
  if (best === null) throw new RangeError('selectOutbound: no flight left to select');
  return best;
}

/**
 * The choosers' shared body (spec rev 55 §11 Which flights; ruling persona-010): of the items within the limits on
 * `leg`, the first `count` in `compare` order, always including the shortest within them (it replaces the last pick when
 * it is not among them). When none fits, the first `count` of every item, with `overLimit`. `moreRead` is every item not
 * shown; `moreOutside`, those of them that miss a limit. The input is not changed.
 */
function chooseToShow<T extends LegTimes>(
  items: readonly T[],
  l: FlightLimits,
  compare: (a: T, b: T) => number,
  count: number,
  leg: Leg,
): ShownFlights<T> {
  // why: one entry per position, so the same object given twice is still two flights read
  const all = items.map((f) => ({ f }));
  const order = (a: { f: T }, b: { f: T }) => compare(a.f, b.f);
  const within = all.filter((e) => fits(e.f, l, leg)).sort(order);
  const overLimit = within.length === 0 && items.length > 0;
  const shown = (overLimit ? [...all].sort(order) : within).slice(0, count);
  // why: ruling persona-010: the shortest flight within the limits is always among those shown; `sort` is stable, so
  // of equally short flights the first in price order is the one kept (none is within when over the limit)
  const shortest = [...within].sort((a, b) => a.f.durationMinutes - b.f.durationMinutes)[0];
  if (shortest !== undefined && !shown.includes(shortest)) shown[shown.length - 1] = shortest;
  const rest = all.filter((e) => !shown.includes(e));
  return {
    shown: shown.map((e) => e.f),
    overLimit,
    moreRead: rest.length,
    moreOutside: rest.filter((e) => !fits(e.f, l, leg)).length,
  };
}

/**
 * Spec rev 55 §11 Which flights, revision 56 §6.2: of the outbounds within the limits (the stops limit included), the
 * first `FLIGHTS_SHOWN` in `compareFlights` order, always including the shortest within them; when none fits, the
 * cheapest three of every flight, with `overLimit` ("when none fits, the cheapest three, each marked").
 */
export function chooseFlightsToShow<T extends ListedFlight>(
  flights: readonly T[],
  l: FlightLimits,
): ShownFlights<T> {
  return chooseToShow(flights, l, compareFlights, FLIGHTS_SHOWN, 'outbound');
}

/**
 * Spec rev 56 §6.2: the outbound chooser's mirror for a pairing's returns: `compareReturns`, `RETURNS_SHOWN`, judged on
 * the `'return'` leg (no window applies).
 */
export function chooseReturnsToShow(
  returns: readonly ListedReturn[],
  l: FlightLimits,
): ShownFlights<ListedReturn> {
  return chooseToShow(returns, l, compareReturns, RETURNS_SHOWN, 'return');
}
