import {
  chooseFlightsToShow,
  compareFlights,
  type DatePair,
  type DatePairFigure,
  type FlightLimits,
  flightLimitsOf,
  type IsoDateTime,
  type LegTimes,
  type ListedFlight,
  MAX_FLIGHT_LIST_PAIRS,
  mainPathSource,
  orderWithinTie,
  type Provenance,
  type ShownFlights,
  type StaleMark,
  tieGroups,
  withinLimits,
} from '@gmt/core';
import type { DefinitionResponse, FlightList, FlightListsResponse } from '../../api/types.js';
import type { COPY } from '../../copy.js';
import { formatIsoDateShort, formatMinutes } from '../../format.js';
import { londonDaysAgo, readAt } from './stateLines.js';

// Spec rev 55 §11 "Flights" and "Ties", §6.9 and §2 (WP20 Task 20.10): the pure side of a search's flights block. Which
// date pairs the board asks flight lists for, the order inside a tie, and every line the block says, composed from
// COPY templates (passed in, so the catalogue covers them) and core's choosers. Amounts are never formatted here: each
// is a PriceCell beside these words (ruling C3); the tie line's price comes from the estimate panel's cost formatter,
// which the caller passes in.

type FlightCopy = (typeof COPY)['flights'];
/** One asked date pair's entry in `GET /definitions/:id/flight-lists`. */
export type FlightPair = FlightListsResponse['pairs'][number];
/** A date pair on the board: it always has a figure (rankDatePairs keeps no other). */
type Row = DatePair & { figure: DatePairFigure };

/** A list's stale mark for PriceCell (spec rev 55 §10: the wire's own mark, `'refresh'` once older than the refresh). */
export const listStale = (list: FlightList): StaleMark => list.stale;

/** The key a date pair is asked and found by: the wire's `departure_return` form (spec rev 55 §10 `?pairs=`). */
export const pairKey = (p: { departureDate: string; returnDate: string }): string =>
  `${p.departureDate}_${p.returnDate}`;

/**
 * The search's limits a flight is judged against (spec rev 56 §6.2): core's `flightLimitsOf` of its constraints, the
 * longest journey and the stops on each leg and the two windows on the outbound, the one set the worker's selection,
 * the choosers and the pairing figure apply.
 */
export function limitsOf(d: DefinitionResponse): FlightLimits {
  return flightLimitsOf(d.constraints);
}

/**
 * A list's flights the page shows (core's `chooseFlightsToShow`), or null when it shows none: a list that is missing,
 * failed or listed no flight, or flight lists not available here (then no row carries a flights line, spec rev 55 §11).
 * Only the figure's own airport pair's list (`list`) is passed: another pair's list never orders a tie (prov-r2-004).
 */
export function shownOf(
  list: FlightList | null,
  limits: FlightLimits,
  available: boolean,
): ShownFlights<ListedFlight> | null {
  if (!available || list === null || list.status !== 'read' || list.flights.length === 0) return null;
  return chooseFlightsToShow(list.flights, limits);
}

/** A row's tie key (spec rev 55 §11 Ties): its figure's price, and whether it is current (not superseded, still seen). */
const tieKey = (p: Row) => ({
  pricePence: p.figure.price.pricePence,
  current: !p.figure.superseded && p.figure.notSeenInLatest === null,
});

/**
 * The board's tie groups (spec rev 55 §11 Ties): runs of rows at one price and of one kind. Ties are runs in the price
 * order, so under another sort (departure, nights, journey time) each row is its own group and the sort is kept.
 */
export function boardGroups(rows: readonly Row[], byPrice: boolean): Row[][] {
  return byPrice ? tieGroups(rows, tieKey) : rows.map((p) => [p]);
}

/**
 * The date pairs each flight-lists request asks for (spec rev 55 §11): one request per page of `pageSize` rows shown,
 * each the date pairs of every tie group that touches that page and no earlier request asked for, the page's own rows
 * first, at most `MAX_FLIGHT_LIST_PAIRS`. "Show 10 more" therefore adds one request and repeats none.
 */
export function requestPages(groups: readonly Row[][], visible: number, pageSize: number): string[][] {
  const at = new Map<string, number>();
  const groupOf = new Map<string, readonly Row[]>();
  let i = 0;
  for (const g of groups)
    for (const p of g) {
      at.set(pairKey(p), i);
      groupOf.set(pairKey(p), g);
      i += 1;
    }
  const rows = groups.flat();
  const asked = new Set<string>();
  const pages: string[][] = [];
  for (let start = 0; start < Math.min(visible, rows.length); start += pageSize) {
    const own = rows.slice(start, start + pageSize).map(pairKey);
    const rest = own.flatMap((k) => (groupOf.get(k) ?? []).map(pairKey));
    const page: string[] = [];
    for (const k of [...own, ...rest]) {
      if (page.length === MAX_FLIGHT_LIST_PAIRS) break;
      if (!asked.has(k)) {
        asked.add(k);
        page.push(k);
      }
    }
    pages.push(page);
  }
  // why: `at` keeps the board's order of a page's pairs stable for the query key
  return pages.map((p) => [...p].sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0)));
}

/**
 * The board's rows with each tie ordered by its flights (spec rev 55 §11 Ties: core's `orderWithinTie` over the lists
 * fetched), group by group, before paging; the rank column stays the price rank. Returns the groups in that order.
 */
export function orderedGroups(
  groups: readonly Row[][],
  shown: (p: Row) => ShownFlights<ListedFlight> | null,
): Row[][] {
  return groups.map((g) => (g.length > 1 ? orderWithinTie(g, shown) : [...g]));
}

/** "25h" for whole hours, else formatMinutes' "26h 40m" (spec rev 55 §11's limit words). */
export function hoursText(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : formatMinutes(minutes);
}

/**
 * A leg's marks against the search's limits (spec rev 56 §6.2, §11; persona-010): over the longest journey, over the
 * stops limit, and on the outbound only outside the arrival or the departure window, each said; a leg within every
 * limit says "outbound 10h 50m, within your 25h limit" when a longest journey is set (and nothing when none is), the
 * outbound adding "; return not read" only when no return was read for its list (`returnsRead` false).
 */
export function legMarks(
  leg: 'outbound' | 'return',
  f: LegTimes,
  limits: FlightLimits,
  c: FlightCopy,
  returnsRead = false,
): string[] {
  const w = withinLimits(f, limits, leg);
  const name = c.legs[leg];
  const duration = hoursText(f.durationMinutes);
  const limit = limits.maxJourneyMinutes === null ? null : hoursText(limits.maxJourneyMinutes);
  const marks = [
    ...(!w.journey && limit !== null ? [c.overLimitLeg(name, duration, limit)] : []),
    ...(!w.stops && limits.maxStops !== null ? [c.stopsOver(name, f.stops, limits.maxStops)] : []),
    ...(!w.arrival ? [c.arrivesOutside(f.arrivesLocal)] : []),
    ...(!w.departure ? [c.departsOutside(f.departsLocal)] : []),
  ];
  if (marks.length > 0 || limit === null) return marks;
  return [
    leg === 'outbound' && !returnsRead ? c.within(duration, limit) : c.withinLeg(name, duration, limit),
  ];
}

/** A flight's carriers in words: "Virgin Atlantic", or "…, operated by …" when the page names the operator. */
export function carriersText(f: Pick<ListedFlight, 'carriers' | 'operatedBy'>, c: FlightCopy): string {
  const carriers = f.carriers.join(', ');
  return f.operatedBy === null ? carriers : c.operatedBy(carriers, f.operatedBy);
}

/** Every flight of a list for "show all" (spec rev 55 §11): those shown first, then the rest in core's order. */
export function allInOrder(flights: readonly ListedFlight[], limits: FlightLimits): ListedFlight[] {
  const shown = chooseFlightsToShow(flights, limits).shown;
  return [...shown, ...flights.filter((f) => !shown.includes(f)).sort(compareFlights)];
}

/** The outcome beside the figure (spec rev 55 §6.9): which of the three, from a read list only; null says nothing. */
export type Outcome =
  | { kind: 'from'; minMinor: number; when: string }
  | { kind: 'not-in' }
  | { kind: 'none' };

/**
 * The cheapest flight a read list holds: the page's own "from" figure (`minMinor`) when it kept one, else the lowest of
 * its flights; null when it holds none.
 */
export function cheapestRead(list: FlightList): number | null {
  if (list.minMinor !== null) return list.minMinor;
  const amounts = list.flights.map((f) => f.amountMinor);
  return amounts.length === 0 ? null : Math.min(...amounts);
}

/** Spec rev 55 §6.9: "Google's list: from £92, 11:44", "not in Google's list" or "Google's list showed no flights". */
export function outcomeOf(list: FlightList | null, now: IsoDateTime, c: typeof COPY): Outcome | null {
  if (list === null || list.status !== 'read') return null;
  if (list.listed === 'none-for-cell') return { kind: 'not-in' };
  if (list.listed === 'no-flights') return { kind: 'none' };
  const min = cheapestRead(list);
  return min === null ? null : { kind: 'from', minMinor: min, when: readAt(list.fetchedAt, now, c) };
}

/**
 * The block's provenance note (spec rev 55 §11, §2): "Outbound flights only · … · read 3d ago, 12 Mar 11:44 · prices
 * from Google Flights, not checked with the airline". A list read today says only its age ("read 4h ago"); one read
 * yesterday adds "yesterday 11:44", an older one its date and time ("12 Mar 11:44"), in readAt's one form; the day is
 * London's (finding 7: the day keys are compared, never the words).
 */
export function headLine(list: FlightList, now: IsoDateTime, c: typeof COPY): string {
  const today = londonDaysAgo(list.fetchedAt, now) === 0;
  return c.flights.head(c.agoOf(list.ageHours), today ? null : readAt(list.fetchedAt, now, c));
}

/**
 * What a list that holds no flights says in the block (spec rev 55 §11), or null for a list with flights: a failed
 * list's reason in words, Google's own no-flights line with when it was read, or the options this app could not read.
 */
export function listNote(
  list: FlightList,
  now: IsoDateTime,
  c: typeof COPY,
  reason: (d: NonNullable<FlightList['reason']>) => string,
): string | null {
  if (list.status === 'failed') return list.reason === null ? null : c.flights.notRead(reason(list.reason));
  if (list.listed === 'no-flights') return c.flights.noFlightsWhen(readAt(list.fetchedAt, now, c));
  if (list.listed === 'none-for-cell')
    return c.flights.noneForCell(list.optionsOtherCell, list.optionsUnparsed);
  return null;
}

/**
 * The figure's source as the difference line names it (spec rev 55 §6.9; po-012): "the date grid" for the browser
 * worker's date-grid price, else the source's main-path name ("the Aviasales cache").
 */
export function figureSource(p: Provenance, c: FlightCopy): string {
  return p.providerId === 'camoufox' && p.returnDateSource === 'grid-cell'
    ? c.dateGrid
    : mainPathSource(p.providerId);
}

/**
 * The read button's words (spec rev 56 §11; rulings D3, prov-008): the pages one read plans, as the flight-lists
 * response states them (`pagesPlanned`: 2 with a return phase or while the worker's flags are unread, else 1), never a
 * hard number.
 */
export function readButtonWords(pagesPlanned: number, c: FlightCopy): string {
  return c.readButton(pagesPlanned);
}

/** "14 → 24 Mar", or "28 Mar → 7 Apr" across a month end: the link's name (spec rev 55 §11). */
export function datesShort(departure: string, back: string, c: FlightCopy): string {
  const [from, to] = [formatIsoDateShort(departure), formatIsoDateShort(back)];
  const [day, month] = from.split(' ');
  return c.datesShort(month !== undefined && to.endsWith(` ${month}`) ? (day ?? from) : from, to);
}

/**
 * Whether a date pair has a flights block (spec rev 55 §11): it was answered, and either flight lists are available
 * here or it has a search link to show (every date pair row has its link, whatever the availability).
 */
export function hasFlightsBlock(entry: FlightPair | undefined, available: boolean): entry is FlightPair {
  return entry !== undefined && (available || googleFlightsHref(entry.link) !== null);
}

/**
 * The search link's href (spec rev 55 §6.9, §11; sec-002/003): only an `https://` URL on `www.google.com` (the host the
 * contract allows), checked again here so no other link is ever an anchor; null otherwise and for no link.
 */
export function googleFlightsHref(link: { url: string; host: string; label: string } | null): string | null {
  if (link === null || !URL.canParse(link.url)) return null;
  const u = new URL(link.url);
  return u.protocol === 'https:' && u.hostname === 'www.google.com' && link.host === 'www.google.com'
    ? u.href
    : null;
}
