import {
  bestPerWeek,
  cheapestTrips,
  type DatePair,
  type DatePairFigure,
  type DatePairPairing,
  flightsRead,
  type IsoDateTime,
  lowerOnCalendar,
  overLimitCount,
  type PairingRead,
  rankDatePairs,
  type StopDetail,
} from '@gmt/core';
import type { COPY } from '../../copy.js';
import type { ListsState } from '../../lib/flightReads.js';
import type { DatesUiState } from '../../state/datesState.js';
import { inStay } from './stayScope.js';

// The Search page's model (design 2026-11-08 §5.2, Rulings 3–6): the stay filter first, then core's rank over the date
// pairs in view, then core's shared rules split it into the two sections, Cheapest trips and Lower on the calendar, each
// one per departure week when the switch is on. Pure: the clock is a parameter.

/** Ruling 4: Cheapest trips shows five, then "Show 10 more" adds ten per press. */
export const FIRST_PAGE = 5;
export const PAGE_SIZE = 10;
/** Ruling 5: Lower on the calendar shows three, with the count of them all. */
export const LOWER_SHOWN = 3;

export interface BoardOptions {
  nights: DatesUiState['nights'];
  bestPerWeek: boolean;
}

/** A date pair with its figure (every row of a section has one). */
export type FigurePair = DatePair & { figure: DatePairFigure };

export interface BoardModel {
  /** The date pairs in the stay range, with or without a figure: the run line, the calendar and its shading read these. */
  inView: readonly DatePair[];
  /** The date pairs in view with a figure, best first (core's `rankDatePairs`). */
  ranked: readonly DatePair[];
  /** Ruling 4: the trips (core's `cheapestTrips`), in rank order; one per departure week with the switch on. */
  trips: readonly FigurePair[];
  /** Ruling 5: the calendar prices below the cheapest trip (core's `lowerOnCalendar`), by price; one per week likewise. */
  lower: readonly FigurePair[];
  /** Ruling 4: the dates in view whose read trips were all outside the search's limits (core's `overLimitCount`). */
  overLimit: number;
  /** Ruling 6: the dates in view whose flights were read (core's `flightsRead`), over every search so far. */
  readDates: number;
}

/**
 * Revision 50 (Ian ruled): the first of each departure week in the order given (core's `bestPerWeek`), keeping the
 * list's own type.
 */
function perWeek<P extends DatePair>(rows: readonly P[]): P[] {
  const kept = new Set(bestPerWeek(rows).map((p) => p.index));
  return rows.filter((p) => kept.has(p.index));
}

/** The page's whole model for one read, one set of filters and one instant. */
export function boardModel(pairs: readonly DatePair[], o: BoardOptions, now: IsoDateTime): BoardModel {
  const inView = inStay(pairs, o.nights);
  const ranked = rankDatePairs(inView, now);
  const trips = cheapestTrips(ranked);
  const lower = lowerOnCalendar(ranked);
  let readDates = 0;
  for (const p of inView) if (p.figure !== null && flightsRead(p.figure)) readDates += 1;
  return {
    inView,
    ranked,
    // why: revision 50: the week switch applies after ranking, so each week's row is its best by the section's order
    trips: o.bestPerWeek ? perWeek(trips) : trips,
    lower: o.bestPerWeek ? perWeek(lower) : lower,
    overLimit: overLimitCount(inView),
    readDates,
  };
}

/** How many rows a section with `total` rows shows after `presses` of "Show 10 more": five, then ten more each. */
export function shownCount(total: number, presses: number): number {
  return Math.min(total, FIRST_PAGE + presses * PAGE_SIZE);
}

/** What the next "Show N more" adds: up to ten, never more than are left; 0 when every row is shown. */
export function nextPage(total: number, shown: number): number {
  return Math.max(0, Math.min(PAGE_SIZE, total - shown));
}

/**
 * What a figure says of its date pair's flight read on the board (spec rev 56 §6.9, §11 Board), or null when it says
 * nothing: its lead words (`lead`) and the pairing shown beneath it (`pairing`, its own price, provenance and age).
 */
export interface FlightReadLine {
  lead: string | null;
  pairing: DatePairPairing | null;
}

/** A figure as the board decodes it or as the trip read sends it (the wire's figure has no airport-pair index). */
export type ReadFigure = Omit<DatePairFigure, 'airportPair'>;

/** The lead words of each read that is not a pairing figure's own (`within`), with its pairing's age where it has one. */
function leadOf(
  read: Exclude<PairingRead, 'within'>,
  f: ReadFigure,
  c: typeof COPY,
  reason: (d: StopDetail) => string,
): string | null {
  const D = c.datesView;
  switch (read) {
    case 'not-read':
    case 'outbound-only':
    case 'no-pairing-read':
    case 'over-limit':
      return D.pairingRead[read];
    case 'list-failed':
      // why: the 21.6 ruling: a failed newest list read nothing, its outbound included, so it says why and is never
      // worded "return leg not read" (which is an outbound-only list's alone); 21.7 ui-008: with no reason (the
      // contract always sends one) the words end without a colon, never in an empty cause
      return D.listFailed(f.listReason === null ? null : reason(f.listReason));
    case 'within-older':
      return D.pairingBeneath(c.agoOf(f.pairing?.ageHours ?? 'unknown'));
    case 'within-other-limits':
      return D.pairingOtherLimits;
    case 'sellers-not-read':
    case 'offers-incomplete':
      // why: never produced since design 2026-11-08 (a pairing without complete offers leads at Google's price); their
      // wire codes stay, and a pairing beneath words itself beside its price
      return null;
    default: {
      const unknownRead: never = read;
      throw new RangeError(`flightReadLine: no read ${String(unknownRead)}`);
    }
  }
}

/**
 * Spec rev 56 §6.9, §11 Board (R-heads): a calendar figure's flight read in words, with the pairing that does not lead
 * shown beneath it; a stale verified figure's likewise (ruling 21.2); nothing for a pairing figure (its seller, times
 * and grid price are its own lines) or a fresh verified one. Where no flight list exists the row says "flights not
 * read" when flight lists are read for this search, and keeps it when the flight-lists request failed (21.7 prov-004:
 * the mark is off only when that request succeeded and said they are not read here, so a search without the browser
 * worker is not told on every row what it never asked for); "loading flights" while that request is pending. `reason`
 * words a failed list's cause (the 21.6 ruling).
 */
export function flightReadLine(
  f: ReadFigure,
  lists: ListsState,
  c: typeof COPY,
  reason: (d: StopDetail) => string,
): FlightReadLine | null {
  switch (f.basis) {
    case 'pairing':
      return null;
    case 'verified':
      if (f.price.stale === false) return null;
      break;
    case 'calendar':
      break;
    default: {
      const unknownBasis: never = f.basis;
      throw new RangeError(`flightReadLine: no basis ${String(unknownBasis)}`);
    }
  }
  const read = f.pairingRead;
  if (read === 'within' || (read === 'not-read' && lists === 'unavailable')) return null;
  if (read === 'not-read' && lists === 'loading') return { lead: c.datesView.loadingFlights, pairing: null };
  return { lead: leadOf(read, f, c, reason), pairing: f.pairing };
}

/**
 * The seller of a pairing's offer (spec rev 56 §10: a seller exactly when the price is an offer's). A pairing whose
 * price is an offer's with no seller breaks the contract, so it throws a RangeError naming the rule rather than print
 * a seller line with no seller (21.7 code M9).
 */
export function sellerOf(q: Pick<DatePairPairing, 'seller'>): string {
  if (q.seller === null) throw new RangeError('sellerOf: an offer names its seller (spec rev 56 §10)');
  return q.seller;
}
