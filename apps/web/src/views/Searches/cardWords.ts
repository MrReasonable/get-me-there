import { formatAgo, hoursSince, IN_FLIGHT_STATUSES, type IsoDateTime, STOPPED_STATUSES } from '@gmt/core';
import type { SearchCard } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatIsoDateShort } from '../../format.js';
import { type AirportRow, shortAirportName } from '../Definitions/airports.js';
import { parseSchedule } from '../Definitions/schedule.js';

// Design 2026-11-08 §5.3 (mockup 01-searches), Rulings 5 and 8: the words of a card, pure functions from the served
// card and the page's clock, composed from COPY's templates, so the catalogue and rendered-sweep tests cover every
// sentence and a card never prints a status word of its own. Dates are formatted from their strings, never through a Date.

const S = COPY.searchesView;

/**
 * The window in words: "10 Jan – 31 Mar", "10 Dec 2026 – 31 Mar 2027" when it crosses a year, and "rolling: 182 days from
 * 7 days ahead" for a relative window. An absolute window states the operator's own dates, as the card serves them.
 */
export function windowText(w: SearchCard['window']): string {
  if (w.kind === 'relative' && w.lengthDays !== null && w.startOffsetDays !== null)
    return S.windowRolling(w.lengthDays, w.startOffsetDays);
  const crossesYear = w.departureFrom.slice(0, 4) !== w.departureTo.slice(0, 4);
  const format = crossesYear ? formatIsoDate : formatIsoDateShort;
  return S.windowSpan(format(w.departureFrom), format(w.departureTo));
}

/** "repeats Mondays 05:00": only a scheduled search has one (the card's `schedule` is null otherwise). */
export function scheduleText(schedule: NonNullable<SearchCard['schedule']>): string {
  const s = parseSchedule(schedule.cron);
  switch (s.kind) {
    case 'weekly':
      return S.repeats(s.days, s.time);
    case 'daily':
      return S.repeatsDaily(s.time);
    default:
      return S.repeatsOther;
  }
}

const IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);
const STOPPED: ReadonlySet<string> = new Set(STOPPED_STATUSES);

/** A card is pending or running: its run shows progress and Cancel, it polls and Remove asks "Cancel and remove". */
export function isActive(card: SearchCard): boolean {
  return card.latestRun !== null && IN_FLIGHT.has(card.latestRun.status);
}

/** The latest run stopped or was skipped (`STOPPED_STATUSES`): `RunProgress` words its stop. */
export function isStopped(card: SearchCard): boolean {
  return card.latestRun !== null && STOPPED.has(card.latestRun.status);
}

/** A run that settled by itself: completed (the one status that is neither in flight, nor stopped). */
const isFinished = (run: NonNullable<SearchCard['latestRun']>): boolean =>
  !IN_FLIGHT.has(run.status) && !STOPPED.has(run.status);

/**
 * An airport named as the mockup does ("Heathrow", "JFK", "Newark"): the table's own short name without its city's name
 * in front ("London Heathrow" reads "Heathrow"), the code when the table does not know the airport (yet) or the name
 * is only its city.
 */
export function airportLabel(code: string, row: AirportRow | undefined): string {
  if (row === undefined) return code;
  const short = shortAirportName(row.name);
  const rest = short.startsWith(`${row.city} `) ? short.slice(row.city.length + 1).trim() : short;
  return rest === '' ? code : rest;
}

/**
 * The card's one meta line (mockup 01): the route's codes, the window, the stay, and when a finished run is on record
 * "searched 3h ago". Only a finished run is "searched"; a running, stopped or never-run search says nothing of when.
 */
export function metaParts(
  card: SearchCard,
  now: IsoDateTime,
  airports: ReadonlyMap<string, AirportRow>,
): string[] {
  const run = card.latestRun;
  const at = run !== null && isFinished(run) ? (run.finishedAt ?? run.startedAt) : null;
  return [
    S.codes(
      card.origins.map((c) => airportLabel(c, airports.get(c))).join(', '),
      card.destinations.map((c) => airportLabel(c, airports.get(c))).join(', '),
    ),
    card.window.kind === 'relative' ? windowText(card.window) : S.leaveWindow(windowText(card.window)),
    COPY.datesView.scopeNights(card.minNights, card.maxNights),
    ...(at === null ? [] : [S.searchedMeta(formatAgo(hoursSince(at, now)))]),
  ];
}

/** What the card's trips list is called: "Cheapest trips, <name>", or the previous search's while one runs. */
export function tripsLabel(card: SearchCard): string {
  return isActive(card) ? S.previousRun : S.tripsLabel(card.name);
}

/** The reasons of Ruling 8, in the order the first that applies is chosen. */
export type NothingFound =
  | { kind: 'stopped-before'; dates: number }
  | { kind: 'browser-unavailable'; dates: number }
  | { kind: 'couldnt-read'; dates: number }
  | { kind: 'browser-off' }
  | { kind: 'no-price-shown' }
  | { kind: 'none-fit' }
  | { kind: 'nothing' };

/**
 * Ruling 8: why a card whose latest run finished, with no trip and no lower-on-calendar figure, shows nothing; the first
 * that applies, or null when the card is not in that state. A run that was cancelled or stopped gives its own stop
 * sentence (`RunProgress` words it), so none is chosen here. The marks cover the run's own dates, so once the search's
 * dates changed (`spaceChangedSince`) none that counts them is chosen: the card says the dates changed instead.
 *
 * - dates not searched, or not reached for a reason other than the browser: "The search stopped before N dates."
 * - the browser was unavailable for N dates
 * - N dates couldn't be read
 * - the browser is off for this search (its sources found nothing)
 * - every date showed no price
 * - prices were found, but none fit the filters
 */
export function nothingFound(card: SearchCard): NothingFound | null {
  const run = card.latestRun;
  if (run === null || !isFinished(run)) return null;
  if (card.trips.length > 0 || card.lowerOnCalendar !== null) return null;
  const counted = !card.spaceChangedSince;
  if (counted) {
    const m = run.marks;
    const before = m['not-searched'] + m['not-reached'] - run.browserUnavailable;
    if (before > 0) return { kind: 'stopped-before', dates: before };
    if (run.browserUnavailable > 0) return { kind: 'browser-unavailable', dates: run.browserUnavailable };
    if (m['couldnt-read'] > 0) return { kind: 'couldnt-read', dates: m['couldnt-read'] };
  }
  if (!card.discovery.includes('camoufox')) return { kind: 'browser-off' };
  if (!counted) return { kind: 'nothing' };
  if (run.datePairs > 0 && run.marks['no-price-shown'] === run.datePairs) return { kind: 'no-price-shown' };
  if (run.marks.priced > 0) return { kind: 'none-fit' };
  return { kind: 'nothing' };
}

const N = S.nothingFound;

/** A reason in words. */
export function nothingFoundText(r: NothingFound): string {
  switch (r.kind) {
    case 'stopped-before':
      return N.stoppedBefore(r.dates);
    case 'browser-unavailable':
      return N.browserUnavailable(r.dates);
    case 'couldnt-read':
      return N.couldntRead(r.dates);
    case 'browser-off':
      return N.browserOff;
    case 'no-price-shown':
      return N.noPriceShown;
    case 'none-fit':
      return N.noneFit;
    case 'nothing':
      return N.nothing;
  }
}
