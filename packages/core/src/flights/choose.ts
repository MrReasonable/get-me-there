/**
 * Spec revision 55 §11 "Flights" (Which flights) and ruling persona-010 (WP20 Task 20.10): which of a date pair's
 * flights read a search's page shows beside it. Pure; the page passes the search's own limits. A flight read never
 * changes a date pair's price, rank or coverage (§6.9): this only picks what to show.
 */
import { inWindow } from '../constraints/evaluate.js';
import type { LocalTimeWindow } from '../types/definition.js';
import { FLIGHTS_SHOWN } from './limits.js';
import type { ListedFlight } from './types.js';

/**
 * The search's limits a flight read is judged against (spec rev 55 §11): its longest journey, on the outbound duration
 * (the return leg is not read), and, when set, its arrival and departure windows on the page's local times. Null means
 * not set.
 */
export interface FlightLimits {
  maxJourneyMinutes: number | null;
  arrivalWindowLocal: LocalTimeWindow | null;
  departureWindowLocal: LocalTimeWindow | null;
}

/**
 * What a page shows of one list (spec rev 55 §11): `shown`, at most `FLIGHTS_SHOWN`; `overLimit` when no flight read
 * fits the limits (the shown ones are then each marked); `moreRead`, the flights read and not shown ("3 more read");
 * `moreOutside`, those of them outside a limit ("1 outside your limits").
 */
export interface ShownFlights<T> {
  shown: T[];
  overLimit: boolean;
  moreRead: number;
  moreOutside: number;
}

/**
 * Spec rev 55 §11: a flight against each limit. `journey`: the outbound duration is no longer than the longest
 * journey (inclusive); `arrival` and `departure`: its local arrival or departure time is inside that window (inclusive;
 * a window whose start is later than its end wraps midnight, as §6.2 reads it). A limit not set is met.
 */
export function withinLimits<T extends ListedFlight>(
  f: T,
  l: FlightLimits,
): { journey: boolean; arrival: boolean; departure: boolean } {
  return {
    journey: l.maxJourneyMinutes === null || f.durationMinutes <= l.maxJourneyMinutes,
    arrival: l.arrivalWindowLocal === null || inWindow(f.arrivesLocal, l.arrivalWindowLocal),
    departure: l.departureWindowLocal === null || inWindow(f.departsLocal, l.departureWindowLocal),
  };
}

/**
 * A page's `HH:MM` local time as one number that orders as the time does (07:15 → 715), so two times compare by
 * subtraction (the schema admits only zero-padded 24-hour times).
 */
export function clockOf(t: string): number {
  return Number(t.replace(':', ''));
}

/** Every limit met. */
const fits = (f: ListedFlight, l: FlightLimits): boolean => {
  const w = withinLimits(f, l);
  return w.journey && w.arrival && w.departure;
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
 * Spec rev 55 §11 Which flights: of the flights within the limits, the first `FLIGHTS_SHOWN` by price, then duration,
 * then stops, then departure, always including the shortest flight within them (it replaces the last pick when it is
 * not among them; ruling persona-010). When none fits, the cheapest three of every flight, with `overLimit` (spec: "when
 * none fits, the cheapest three, each marked"). `moreRead` is every flight not shown; `moreOutside`, those of them that
 * miss a limit. The input is not changed.
 */
export function chooseFlightsToShow<T extends ListedFlight>(
  flights: readonly T[],
  l: FlightLimits,
): ShownFlights<T> {
  // why: one entry per position, so the same flight object given twice is still two flights read
  const all = flights.map((f) => ({ f }));
  const order = (a: { f: T }, b: { f: T }) => compareFlights(a.f, b.f);
  const within = all.filter((e) => fits(e.f, l)).sort(order);
  const overLimit = within.length === 0 && flights.length > 0;
  const shown = (overLimit ? [...all].sort(order) : within).slice(0, FLIGHTS_SHOWN);
  // why: ruling persona-010: the shortest flight within the limits is always among those shown; `sort` is stable, so
  // of equally short flights the first in price order is the one kept (none is within when over the limit)
  const shortest = [...within].sort((a, b) => a.f.durationMinutes - b.f.durationMinutes)[0];
  if (shortest !== undefined && !shown.includes(shortest)) shown[shown.length - 1] = shortest;
  const rest = all.filter((e) => !shown.includes(e));
  return {
    shown: shown.map((e) => e.f),
    overLimit,
    moreRead: rest.length,
    moreOutside: rest.filter((e) => !fits(e.f, l)).length,
  };
}
