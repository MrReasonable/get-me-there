import {
  bestPerWeek,
  type DatePair,
  type DatePairFigure,
  type DatePairPairing,
  type DecodedDatePairs,
  daysBetween,
  type FigureBasis,
  type IsoDate,
  type IsoDateTime,
  isoDateSchema,
  type PairingRead,
  rankDatePairs,
  resultBasisOf,
  type StopDetail,
} from '@gmt/core';
import type { DefinitionResponse } from '../../api/types.js';
import type { COPY } from '../../copy.js';
import type { DatesUiState } from '../../state/datesState.js';
import { inStay } from './stayScope.js';

// The board's model (spec §11 Board): the stay filter first, then core's rank over the date pairs in view, then the
// week switch, then the sort, which changes the order and never the rank. Pure: the clock is a parameter.

/** Spec §11: the first 10 rows, then "Show 10 more" (the later clarify step may change the number). */
export const PAGE_SIZE = 10;

export interface BoardOptions {
  nights: DatesUiState['nights'];
  bestPerWeek: boolean;
  sort: DatesUiState['sort'];
}

export interface BoardModel {
  /** The date pairs in the stay range, with or without a figure: the header, the overview and the shading read these. */
  inView: readonly DatePair[];
  /** The date pairs in view with a figure, best first (core's `rankDatePairs`). */
  ranked: readonly DatePair[];
  /** A date pair's price rank, 1 for the best, by index; only date pairs with a figure have one. */
  rankOf: ReadonlyMap<number, number>;
  /** The board's rows: ranked, then one per departure week when switched on, then sorted. */
  rows: readonly DatePair[];
  /** With the week switch on, the departure weeks shown; else null. */
  weeks: number | null;
}

/** The board's whole model for one read, one set of filters and one instant. */
export function boardModel(pairs: readonly DatePair[], o: BoardOptions, now: IsoDateTime): BoardModel {
  const inView = inStay(pairs, o.nights);
  const ranked = rankDatePairs(inView, now);
  const rankOf = new Map(ranked.map((p, i) => [p.index, i + 1]));
  // why: revision 50 (Ian ruled): the week switch applies after ranking, so each week's row is its best by the rank.
  const weekly = o.bestPerWeek ? bestPerWeek(ranked) : ranked;
  return {
    inView,
    ranked,
    rankOf,
    rows: sortBoard(weekly, o.sort, rankOf),
    weeks: o.bestPerWeek ? weekly.length : null,
  };
}

/** The sort's key of a date pair; a null key (an unknown journey time) sorts last in either direction. */
function keyOf(p: DatePair, key: DatesUiState['sort']['key'], rank: number): number | null {
  switch (key) {
    case 'price':
      return rank;
    case 'departure':
      // why: the index orders by departure, then nights (core's date-pair order)
      return p.index;
    case 'nights':
      return p.nights;
    case 'journey':
      return p.figure?.journeyMinutes ?? null;
  }
}

/** Rows in the chosen order; ties fall to the price rank, so the order is total. Returns a new array. */
export function sortBoard(
  rows: readonly DatePair[],
  sort: DatesUiState['sort'],
  rankOf: ReadonlyMap<number, number>,
): DatePair[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const keyed = rows.map((p) => {
    const rank = rankOf.get(p.index) ?? Number.MAX_SAFE_INTEGER;
    return { p, rank, key: keyOf(p, sort.key, rank) };
  });
  keyed.sort((a, b) => {
    if (a.key === null || b.key === null) {
      // why: spec §11: an unknown journey time sorts last either way
      if (a.key !== b.key) return a.key === null ? 1 : -1;
      return a.rank - b.rank;
    }
    return sign * (a.key - b.key) || a.rank - b.rank;
  });
  return keyed.map((k) => k.p);
}

export interface Arrival {
  /** "HH:MM", as the source states it (the airport's local time) */
  time: string;
  date: IsoDate;
  /** Days after the direction's departure date; 0 when the same day, earlier, or the departure is not known. */
  dayOffset: number;
}

const LOCAL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** A `YYYY-MM-DDTHH:MM` local time's date and time, or null when it is not one (a real date, hours 00–23). */
function localParts(v: string | null): { date: IsoDate; time: string } | null {
  const m = v === null ? null : LOCAL.exec(v);
  const date = isoDateSchema.safeParse(m?.[1]);
  return m === null || !date.success ? null : { date: date.data, time: `${m[2]}:${m[3]}` };
}

/**
 * "arrives HH:MM" for one direction (spec §11 Board, revision 50): only from a well-formed local time the figure's own
 * segments state, never invented; the day offset when the arrival's date is later than the direction's departure date
 * ("arrives 06:40 +1"). Both are calendar dates as the source states them, so no time zone enters.
 */
export function arrival(depart: string | null, arrive: string | null): Arrival | null {
  const a = localParts(arrive);
  if (a === null) return null;
  const d = localParts(depart);
  const offset = d === null ? 0 : daysBetween(d.date, a.date);
  return { time: a.time, date: a.date, dayOffset: Math.max(0, offset) };
}

/** A provenance that names the fixture provider or a synthetic source (spec §5.5). */
const synthetic = (p: { providerId: string; sourceKind: string }) =>
  p.providerId === 'fixture' || p.sourceKind === 'synthetic';

/**
 * Spec §11 Dates, revision 50: the red synthetic banner shows when any provenance in the read (figures and
 * cheaper-cached prices alike), the discovery providers or any execution read (the shown run's progress) names the
 * fixture provider or a synthetic source; judged on the whole decoded read, never the rows the board shows, and
 * whatever `/providers` says. Revision 56 (R-synthetic, prov-r3-008): every price group in the read, a pairing
 * figure's grid price and every pairing (leading or beneath) included.
 */
export function isSyntheticRead(
  d: Pick<DecodedDatePairs, 'pairs' | 'discoveryProviders'>,
  run: { progress: ReadonlyArray<{ providerId: string }> } | undefined,
): boolean {
  if (d.discoveryProviders.includes('fixture')) return true;
  if (run?.progress.some((p) => p.providerId === 'fixture') === true) return true;
  return d.pairs.some((p) => {
    const f = p.figure;
    if (f === null) return false;
    return (
      synthetic(f.price.provenance) ||
      (f.cheaperCached !== null && synthetic(f.cheaperCached.provenance)) ||
      (f.gridPrice !== null && synthetic(f.gridPrice.provenance)) ||
      (f.pairing !== null && synthetic(f.pairing.provenance))
    );
  });
}

/**
 * Whether a figure of this basis is calendar-styled (spec rev 56 §6.9, §11): a calendar price, and a pairing figure,
 * which is never checked with the airline (the dashed outline, "not checked"); core's exhaustive `resultBasisOf`
 * decides, so a new basis fails to compile there before it reaches a face here.
 */
export function calendarStyled(basis: FigureBasis): boolean {
  return resultBasisOf(basis) === 'calendar';
}

/**
 * What a figure says of its date pair's flight read on the board (spec rev 56 §6.9, §11 Board), or null when it says
 * nothing: its lead words (`lead`) and the pairing shown beneath it (`pairing`, its own price, provenance and age).
 */
export interface FlightReadLine {
  lead: string | null;
  pairing: DatePairPairing | null;
}

/** The lead words of each read that is not a pairing figure's own (`within`), with its pairing's age where it has one. */
function leadOf(
  read: Exclude<PairingRead, 'within'>,
  f: DatePairFigure,
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
      // worded "return leg not read" (which is an outbound-only list's alone)
      return D.listFailed(f.listReason === null ? '' : reason(f.listReason));
    case 'within-older':
      return D.pairingBeneath(c.agoOf(f.pairing?.ageHours ?? 'unknown'));
    case 'within-other-limits':
      return D.pairingOtherLimits;
    case 'sellers-not-read':
    case 'offers-incomplete':
      // why: their words ride on the pairing's own line ("from £X · sellers not read", "a cheaper seller may not have
      // been read"), beside the price they qualify
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
 * and grid price are its own lines) or a fresh verified one. "flights not read" is said only where no flight list
 * exists and flight lists are read for this search (`available`), so a search without the browser worker is not told
 * on every row what it never asked for. `reason` words a failed list's cause (the 21.6 ruling).
 */
export function flightReadLine(
  f: DatePairFigure,
  available: boolean,
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
  if (read === 'within' || (read === 'not-read' && !available)) return null;
  return { lead: leadOf(read, f, c, reason), pairing: f.pairing };
}

/**
 * Whether a search sets any airline or layover setting (spec rev 56 §11 Board): a pairing figure then says "airline
 * settings not applied to flights read", since a flight read applies only the journey, stops and window limits.
 */
export function setsAirlineOrLayover(
  c: Pick<
    DefinitionResponse['constraints'],
    'includeAirlines' | 'excludeAirlines' | 'minLayoverMinutes' | 'maxLayoverMinutes' | 'noOvernightLayover'
  >,
): boolean {
  return (
    (c.includeAirlines?.length ?? 0) > 0 ||
    (c.excludeAirlines?.length ?? 0) > 0 ||
    c.minLayoverMinutes !== undefined ||
    c.maxLayoverMinutes !== undefined ||
    c.noOvernightLayover === true
  );
}
