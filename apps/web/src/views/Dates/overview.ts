import {
  addDays,
  asIsoDate,
  type DatePair,
  type DatePairFigure,
  type DatePairSpace,
  dayMark,
  formatPence,
  type IsoDate,
  type IsoMonth,
  isTrip,
  monthOf,
  type PriceLabelKind,
  type ReducedMark,
  reducedMark,
  staleWords,
} from '@gmt/core';
import { labelAge } from '../../components/PriceLabel.js';
import { COPY } from '../../copy.js';
import { monthDays, weekdayIndex } from '../../format.js';
import { figureLabelKind } from '../../lib/figureLabel.js';
import { rowDay } from '../../lib/legWords.js';
import { buildScale, isCurrent, type QuintileScale } from './shade.js';

// The calendar's model (Trips and Search plan, Ruling 18; mockup 02): the window's months, each departure day's stays in
// view, the one mark of the day (core's `dayMark`, never re-implemented here), the one price it prints and its name,
// the heat scale over the printed prices, and the day panel's order. Pure: no clock (today is a parameter), no DOM.

/** A month's first day. */
const firstOf = (month: IsoMonth): IsoDate => asIsoDate(`${month}-01`);

/** Monday-first weeks of one month, null for padding (moved from the Calendar view's grid, WP19 §4). */
export function weeksOf(month: IsoMonth): Array<Array<IsoDate | null>> {
  const cells: Array<IsoDate | null> = Array.from({ length: weekdayIndex(firstOf(month)) }, () => null);
  cells.push(...monthDays(month));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<IsoDate | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The months the departure window touches, in order; none for an expired window. */
export function monthsOf(space: Pick<DatePairSpace, 'departureFrom' | 'departureTo'>): IsoMonth[] {
  const out: IsoMonth[] = [];
  if (space.departureFrom > space.departureTo) return out;
  const last = monthOf(space.departureTo);
  // why: 31 days after a month's first day is always in the next month (no month is longer)
  for (let m = monthOf(space.departureFrom); m <= last; m = monthOf(addDays(firstOf(m), 31))) out.push(m);
  return out;
}

/** Each departure day of the date pairs in view, with its stays in index order (one pass over the pairs). */
export function staysByDay(pairs: readonly DatePair[]): Map<IsoDate, DatePair[]> {
  const days = new Map<IsoDate, DatePair[]>();
  for (const p of pairs) {
    const day = days.get(p.departureDate);
    if (day === undefined) days.set(p.departureDate, [p]);
    else day.push(p);
  }
  return days;
}

/** A calendar day: its date, and today's date (a day before today has departed). */
export interface CalendarDay {
  date: IsoDate;
  today: IsoDate;
}

/** The one price a day prints: the wire's price cell, the label kind it carries, and whether it is a trip's (the dot). */
export interface DayPrice {
  cell: DatePairFigure['price'];
  kind: PriceLabelKind;
  trip: boolean;
}

/** What a calendar day shows. */
export interface DayModel {
  /** Core's `dayMark` over the day's stays, or `out`: a departed day or one outside the window, blank and inert. */
  mark: ReducedMark | 'out';
  /** The price it prints, or null. */
  price: DayPrice | null;
  /** It has prices, but none is current: it prints none and its name says "not seen again". */
  notSeenOnly: boolean;
  /** Its stays in view, in stay order (none when out). */
  stays: DatePair[];
}

const OUT: DayModel = { mark: 'out', price: null, notSeenOnly: false, stays: [] };

/** The cheaper of two figures, the first on a tie. */
const cheaper = (a: DatePairFigure | null, b: DatePairFigure): DatePairFigure =>
  a !== null && a.price.pricePence <= b.price.pricePence ? a : b;

/**
 * Ruling 18: a day's mark is core's `dayMark` over its stays in view; a departed day (before today) or a day with no
 * stay (outside the window) is out. It prints its cheapest current trip's price (core's `isTrip`) with the dot when it
 * has a trip, else its lowest current calendar price (superseded and not-seen figures left out); a day whose only prices
 * are not current prints none and says "not seen again".
 */
export function dayModel(day: CalendarDay, pairs: readonly DatePair[]): DayModel {
  if (day.date < day.today || pairs.length === 0) return OUT;
  let trip: DatePairFigure | null = null;
  let calendar: DatePairFigure | null = null;
  let priced = false;
  for (const p of pairs) {
    const f = p.figure;
    if (f === null) continue;
    priced = true;
    // why: a figure that is not a trip but is current is a calendar price (a current verified figure is a trip)
    if (isTrip(f)) trip = cheaper(trip, f);
    else if (isCurrent(f)) calendar = cheaper(calendar, f);
  }
  const lead = trip ?? calendar;
  return {
    mark: dayMark(pairs.map((p) => p.buckets)),
    price: lead === null ? null : { cell: lead.price, kind: figureLabelKind(lead), trip: trip !== null },
    notSeenOnly: lead === null && priced,
    stays: [...pairs],
  };
}

/**
 * A day's accessible name (Ruling 18): "Wed 11 Nov, £372, Calendar · 3h" (its label kind and age, with the stale words
 * when the wire marks it stale), "…, £412, Seller · 3h, trip with flights read", or the day and why it prints no price
 * ("…, not searched", "…, not seen again"); a price on a day the latest run did not price says the day's mark after it
 * ("…, trip with flights read, not reached"). An out day has no name: it is no button.
 */
export function dayName(date: IsoDate, m: DayModel): string {
  const C = COPY.calendar;
  const T = COPY.trip;
  const day = rowDay(date);
  // why: an out day is never named (it is no button); its words, were it named, would be a mark's all the same
  const mark = m.mark === 'out' ? 'not-searched' : m.mark;
  const p = m.price;
  if (p !== null) {
    const label = T.labelText(T.label[p.kind], labelAge(p.cell.ageHours));
    const said = p.cell.stale === false ? label : T.labelStale(label, staleWords(p.cell.stale));
    const priced = C.dayPrice(day, formatPence(p.cell.pricePence), said, p.trip);
    // why: fix round 1: a price an earlier search found on a day the latest run has not priced (not reached, not
    // searched) keeps its shade; its name says what the latest run did there
    return mark === 'priced' ? priced : C.dayMark(priced, C.markWords[mark]);
  }
  if (m.notSeenOnly) return C.dayMark(day, C.notSeenAgain);
  return C.dayMark(day, C.markWords[mark]);
}

/** The heat ramp's steps, cheapest first, or the one flat step of a scale with too few or too close prices. */
export type Heat = 1 | 2 | 3 | 4 | 5 | 'flat';
const HEATS = [1, 2, 3, 4, 5] as const;

/**
 * Ruling 18's heat scale: the quintiles of the prices the days print (current prices only: a trip or a current calendar
 * price), flat under ten prices or a spread under 10% of the cheapest (decision 38).
 */
export function dayScale(days: Iterable<DayModel>): QuintileScale {
  const prices: number[] = [];
  for (const m of days) if (m.price !== null) prices.push(m.price.cell.pricePence);
  return buildScale(prices);
}

/** A printed price's step on the ramp: its quintile, cheapest first, or the flat step. */
export function heatOf(scale: QuintileScale, pence: number): Heat {
  const band = scale.band(pence);
  return band === null ? 'flat' : HEATS[band];
}

/** What a stay with no figure shows in the day panel: its mark, every price over the journey limit, or none to show. */
export type StayMark = Exclude<ReducedMark, 'priced'> | 'over-limit' | 'unshown';

/**
 * A stay with no figure, by why it has none: every price left out for the journey limit (`over-limit`), a price found
 * that can't be shown (`unshown`: partly checked or not confirmed), else its own mark (core's `reducedMark`).
 */
export function stayMark(p: DatePair): StayMark {
  if (p.journeyLeftOut > 0) return 'over-limit';
  const mark = reducedMark(p.buckets);
  return mark === 'priced' ? 'unshown' : mark;
}

/**
 * The day panel's order: the trips, cheapest first; then the day's other prices (calendar prices, and those a later
 * search did not see again), cheapest first; then the stays with no price, in stay order. Equal prices keep stay order.
 */
export function panelOrder(stays: readonly DatePair[]): DatePair[] {
  const rank = (p: DatePair): number => (p.figure === null ? 2 : isTrip(p.figure) ? 0 : 1);
  const pence = (p: DatePair): number => p.figure?.price.pricePence ?? 0;
  // why: Array.prototype.sort is stable, so equal ranks and prices keep the stays' own order
  return [...stays].sort((a, b) => rank(a) - rank(b) || pence(a) - pence(b));
}
