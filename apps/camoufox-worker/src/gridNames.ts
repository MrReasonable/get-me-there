/**
 * The date grid's dated grammar (spec §2 rev 34; plan decision 70; observed 2026-10-18 in the `--grid` recordings,
 * GRID_GRAMMAR_VERSION). Pure: no locator, no clock. A name that does not match is unparsed and counted, never guessed.
 *
 * - A cell: `£<price>[, cheapest price | , low price], <d> <Mon> to <d> <Mon>[, selected]`, the price in whole pounds
 *   with thousands separators ("£1,308").
 * - An unpriced cell (observed 2026-10-26, grid/2026-10-26/7 and 8): `no flights, <d> <Mon> to <d> <Mon>` or
 *   `price unknown, <d> <Mon> to <d> <Mon>`, each a button like a priced cell, printing "no flights" or "price unknown".
 * - A day label: `<Ddd> <d> <Mon>` ("Thu 11 Mar"); a line prints its seven labels with no space between them
 *   ("0000Thu 11 MarFri 12 Mar…"), so labels are matched without word boundaries.
 * - The selected-pair line: "14 – 24 Mar 2027", "28 Mar – 7 Apr 2027", "27 Dec 2026 – 6 Jan 2027", or "20 – 23 Oct" (the
 *   current year left out); its price line: "£462 · Round trip".
 *
 * Month tokens: the recordings showed Jan, Mar, Apr, Oct and Dec; the others are the same en-GB short forms (and "Sept",
 * which en-GB pages sometimes print). A token read as the wrong month cannot pass the views' weekday check.
 */
import type { IsoDate, VendorPriceMark } from '@gmt/core';
import { asIsoDate } from '@gmt/core';

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Sept: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};
const WEEKDAYS: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const MON = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';
const POUNDS = '([1-9]\\d{0,2}(?:,\\d{3})*)';

const CELL = new RegExp(
  `^£${POUNDS}(, cheapest price|, low price)?, (\\d{1,2}) (${MON}) to (\\d{1,2}) (${MON})(, selected)?$`,
);
const UNPRICED = new RegExp(`^(no flights|price unknown), (\\d{1,2}) (${MON}) to (\\d{1,2}) (${MON})$`);
const LABEL = new RegExp(`(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\\d{1,2}) (${MON})`, 'g');
const RANGE = new RegExp(`^(\\d{1,2})(?: (${MON}))?(?: (\\d{4}))? – (\\d{1,2}) (${MON})(?: (\\d{4}))?$`);
const PRICE_LINE = new RegExp(`^£${POUNDS} · Round trip$`);

export interface DayMonth {
  day: number;
  month: number;
}
export interface CellName {
  pounds: number;
  mark: VendorPriceMark;
  selected: boolean;
  dep: DayMonth;
  ret: DayMonth;
}

const pounds = (s: string): number => Number(s.replaceAll(',', ''));
/** A regular expression group's text; an optional group that did not take part reads as empty. */
const at = (m: RegExpMatchArray, i: number): string => m[i] ?? '';
/** A month token's number (1–12), or null for a token not in the table. */
export function monthOf(token: string): number | null {
  return MONTHS[token] ?? null;
}
/** A weekday token's number (0 Sunday – 6 Saturday), or null for a token not in the table. */
export function weekdayOf(token: string): number | null {
  return WEEKDAYS[token] ?? null;
}
/** The days of a month in a leap year (February 29; resolveDay checks the real year). */
const daysIn = (month: number): number => new Date(Date.UTC(2000, month, 0)).getUTCDate();
const dayMonth = (d: string, token: string): DayMonth | null => {
  const day = Number(d);
  const month = monthOf(token);
  return month !== null && day >= 1 && day <= daysIn(month) ? { day, month } : null;
};

/** A cell the grid shows without a price: its words and both dates (spec §2 "Cells by name"). */
export interface UnpricedCellName {
  /** `no-flights`: the cell says there are no flights for the pair; `price-unknown`: it says no price is known. */
  status: 'no-flights' | 'price-unknown';
  dep: DayMonth;
  ret: DayMonth;
}

/**
 * "no flights, 14 Nov to 20 Nov" and "price unknown, 10 Nov to 24 Nov", exactly as grid/2026-10-26/7 and 8 recorded
 * them (no mark and no ", selected" was ever seen on one, so a name carrying either is unparsed). Read only where
 * GRID_UNPRICED_VERIFIED is set; the caller decides.
 */
export function parseUnpricedCellName(name: string): UnpricedCellName | null {
  const m = UNPRICED.exec(name);
  if (m === null) return null;
  const dep = dayMonth(at(m, 2), at(m, 3));
  const ret = dayMonth(at(m, 4), at(m, 5));
  if (dep === null || ret === null) return null;
  return { status: at(m, 1) === 'no flights' ? 'no-flights' : 'price-unknown', dep, ret };
}

export function parseCellName(name: string): CellName | null {
  const m = CELL.exec(name);
  if (m === null) return null;
  const dep = dayMonth(at(m, 3), at(m, 4));
  const ret = dayMonth(at(m, 5), at(m, 6));
  if (dep === null || ret === null) return null;
  const marked = at(m, 2);
  const mark: VendorPriceMark =
    marked === ', cheapest price' ? 'cheapest' : marked === ', low price' ? 'low' : 'none';
  return { pounds: pounds(at(m, 1)), mark, selected: at(m, 7) !== '', dep, ret };
}

/** Every day label in a text, in order (a scrolled line's order is rotated; callers treat it as a set). */
export function dayLabels(text: string): Array<DayMonth & { weekday: number }> {
  const out: Array<DayMonth & { weekday: number }> = [];
  for (const m of text.matchAll(LABEL)) {
    const dm = dayMonth(at(m, 2), at(m, 3));
    const weekday = weekdayOf(at(m, 1));
    if (dm !== null && weekday !== null) out.push({ weekday, ...dm });
  }
  return out;
}

const iso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const epochDay = (s: string): number => Date.parse(`${s}T00:00:00Z`) / 86_400_000;

/**
 * The date a day and month name: the year in {Y − 1, Y, Y + 1} (Y the anchor's) nearest the anchor (the query's
 * departure), or null when that day does not exist in that year (29 February).
 */
export function resolveDay(dm: DayMonth, anchor: IsoDate): IsoDate | null {
  const y = Number(anchor.slice(0, 4));
  const a = epochDay(anchor);
  // why: the nearest year is chosen first (by a date that exists in every year), then the day is checked in it, so a
  // "29 Feb" read in a year without one is refused rather than moved to another year
  const distance = (year: number): number =>
    Math.abs(epochDay(iso(year, dm.month, Math.min(dm.day, 28))) - a);
  const year = [y - 1, y + 1].reduce((best, c) => (distance(c) < distance(best) ? c : best), y);
  const s = iso(year, dm.month, dm.day);
  return new Date(`${s}T00:00:00Z`).getUTCDate() === dm.day ? asIsoDate(s) : null;
}

export function weekdayMatches(weekday: number, date: IsoDate): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === weekday;
}

export interface SelectedRange {
  dep: DayMonth & { year: number | null };
  ret: DayMonth & { year: number | null };
}

/** "14 – 24 Mar 2027" and its other observed forms; the departure's month is the return's when left out. */
export function parseSelectedRange(text: string): SelectedRange | null {
  const m = RANGE.exec(text.trim());
  if (m === null) return null;
  const retYear = m[6] === undefined ? null : Number(m[6]);
  const ret = dayMonth(at(m, 4), at(m, 5));
  const dep = dayMonth(at(m, 1), m[2] ?? at(m, 5));
  if (ret === null || dep === null) return null;
  return {
    dep: { ...dep, year: m[3] === undefined ? retYear : Number(m[3]) },
    ret: { ...ret, year: retYear },
  };
}

/** "£462 · Round trip" → 462. */
export function parseSelectedPrice(text: string): number | null {
  const m = PRICE_LINE.exec(text.trim());
  return m === null ? null : pounds(at(m, 1));
}
