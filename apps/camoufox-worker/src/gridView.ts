/**
 * One settled view of the date grid (spec §2 rev 34; plan decision 70; the `--grid` recordings of 2026-10-18), read
 * through locators and then checked by a pure function.
 *
 * - The view is the `dates-grid` view only when the dialog "Price insights" is open, its "Dates" tab is selected, the
 *   panel holds one `grid "Date grid"` and the four scroll buttons.
 * - Each cell's dates come from its own name; after a scroll the page reuses and rotates its elements, so position says
 *   nothing. The two lines are a set check: each must hold seven consecutive dates with the right weekdays, and the
 *   dates the cells name must be those sets.
 * - A view holds 49 cells less the pairs whose return precedes the departure. A cell that fails the grammar or names a
 *   date outside the lines is unparsed (counted). A pair named twice, a count that is not the expected one, or cells
 *   whose dates are not the lines' sets make the view structurally unparsed: none of its cells is kept.
 * - More than half of the priced-looking cells (names starting "£") failing is drift: `unrecognised`.
 * - Each date takes the year nearest the query's departure. On the first view the selected cell must be the query's
 *   pair, the range line must name it (and its year, when printed), and the price line must be its price.
 */
import type { GridCell, IsoDate } from '@gmt/core';
import { countOf, type LocatorLike, nameOf, timeoutOf } from './driver.js';
import {
  dayLabels,
  parseCellName,
  parseSelectedPrice,
  parseSelectedRange,
  resolveDay,
  weekdayMatches,
} from './gridNames.js';
import type { Selectors } from './selectors.js';
import type { Deadline } from './timers.js';

const DAY =
  '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)';
/** A line: one element whose text holds at least two day labels. */
const LINE = new RegExp(`${DAY}.*${DAY}`);
/**
 * The selected pair's range and price, found anywhere in an element's text: the live run of 2026-10-18 showed the range
 * is no element of its own (the page runs it together with the price, "14 – 24 Mar 2027£462 · Round trip"), so it is
 * read from whichever element holds it, its spacing normalised, and each distinct value kept once.
 */
const RANGE = /\d{1,2}(?:\s[A-Z][a-z]{2,3})?(?:\s\d{4})?\s–\s\d{1,2}\s[A-Z][a-z]{2,3}(?:\s\d{4})?/;
const PRICE_LINE = /£[\d,]+\s·\sRound trip/;
/** Any run of spaces (no-break and thin ones included) as one space. */
const spaced = (t: string): string => t.replace(/\s+/g, ' ').trim();
/** Each distinct match of `re` in the texts, spacing normalised. */
const found = (xs: readonly string[], re: RegExp): string[] => [
  ...new Set(xs.flatMap((x) => re.exec(spaced(x))?.[0] ?? [])),
];

export interface DatesGridCheck {
  dialog: number;
  datesSelected: number;
  grid: number;
  scrollButtons: number;
}
/** What a view's locators read, before any check. */
export interface RawView {
  lines: string[];
  candidates: Array<string | null>;
  ranges: string[];
  prices: string[];
  datesGrid: DatesGridCheck;
}

async function texts(l: LocatorLike, d: Deadline): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0, n = await countOf(l, d); i < n; i++)
    out.push((await d.race(l.nth(i).textContent(timeoutOf(d)))) ?? '');
  return out;
}

/** Reads one view through locators: the lines, the cell candidates, the selected lines and the dates-grid check. */
export async function readRawView(
  dialog: LocatorLike,
  panel: LocatorLike,
  d: Deadline,
  S: Selectors,
): Promise<RawView> {
  const G = S.results.dateGrid;
  const scrollNames: string[] = [G.scroll.left, G.scroll.right, G.scroll.up, G.scroll.down];
  const buttons = panel.getByRole('button');
  const candidates: Array<string | null> = [];
  for (let i = 0, n = await countOf(buttons, d); i < n; i++) {
    const name = await nameOf(buttons.nth(i), d);
    if (name === null || !scrollNames.includes(name)) candidates.push(name);
  }
  let scrollButtons = 0;
  for (const name of scrollNames)
    if ((await countOf(panel.getByRole('button', { name, exact: true }), d)) === 1) scrollButtons++;
  return {
    lines: await texts(panel.getByText(LINE), d),
    candidates,
    ranges: found(await texts(panel.getByText(RANGE), d), RANGE),
    prices: found(await texts(panel.getByText(PRICE_LINE), d), PRICE_LINE),
    datesGrid: {
      dialog: await countOf(dialog, d),
      datesSelected: await countOf(
        dialog.getByRole('tab', { name: G.datesTab, exact: true, selected: true }),
        d,
      ),
      grid: await countOf(panel.getByRole('grid', { name: G.grid, exact: true }), d),
      scrollButtons,
    },
  };
}

/** What must change before a view after a scroll counts: its lines. */
export const changeKeyOf = (r: Pick<RawView, 'lines'>): string => r.lines.join('|');

export type Interpreted =
  | {
      kind: 'view';
      departures: IsoDate[];
      returns: IsoDate[];
      cells: GridCell[];
      unparsed: number;
      structural: 'ok' | 'unparsed';
      /** Which structural check failed, for the debug decision line (counts only, never names). */
      structuralCheck: 'duplicate' | 'count' | 'sets' | null;
    }
  | {
      kind: 'unrecognised';
      why: 'not-dates-grid' | 'lines' | 'selector-drift' | 'first-view';
      /** Which part of the first view failed (the decision line names it). */
      check?: 'selected-cell' | 'range' | 'price';
    };

/** A view's counts for the debug decision line (never a name, a date or a URL). */
export function viewCounts(r: RawView): Record<string, number> {
  return {
    candidates: r.candidates.length,
    pricedLooking: r.candidates.filter((x) => x?.startsWith('£') === true).length,
    lines: r.lines.length,
    labelsLine1: dayLabels(r.lines[0] ?? '').length,
    labelsLine2: dayLabels(r.lines[1] ?? '').length,
    ranges: r.ranges.length,
    prices: r.prices.length,
    ...r.datesGrid,
  };
}

const epochDay = (s: string): number => Date.parse(`${s}T00:00:00Z`) / 86_400_000;

/** A line's seven dates in order, or null when it is not seven consecutive days with the right weekdays. */
function lineDates(text: string, anchor: IsoDate): IsoDate[] | null {
  const labels = dayLabels(text);
  if (labels.length !== 7) return null;
  const dates: IsoDate[] = [];
  for (const l of labels) {
    const date = resolveDay(l, anchor);
    if (date === null || !weekdayMatches(l.weekday, date)) return null;
    dates.push(date);
  }
  const sorted = [...dates].sort();
  return sorted.every((x, i) => i === 0 || epochDay(x) - epochDay(sorted[i - 1] ?? x) === 1) ? sorted : null;
}

/**
 * Checks one view (see the module comment). `anchor` is the query's departure (each date's year); `first` is the
 * query's pair on the page's first view.
 */
export function interpretView(
  r: RawView,
  anchor: IsoDate,
  first?: { dep: IsoDate; ret: IsoDate },
): Interpreted {
  const g = r.datesGrid;
  if (g.dialog !== 1 || g.datesSelected !== 1 || g.grid !== 1 || g.scrollButtons !== 4)
    return { kind: 'unrecognised', why: 'not-dates-grid' };
  const [depLine, retLine] = r.lines.map(spaced);
  const departures = r.lines.length === 2 && depLine !== undefined ? lineDates(depLine, anchor) : null;
  const returns = r.lines.length === 2 && retLine !== undefined ? lineDates(retLine, anchor) : null;
  if (departures === null || returns === null) return { kind: 'unrecognised', why: 'lines' };
  const depSet = new Set<string>(departures);
  const retSet = new Set<string>(returns);
  const cells: GridCell[] = [];
  const seen = new Set<string>();
  let unparsed = 0;
  let pricedLooking = 0;
  let pricedFailed = 0;
  let duplicate = false;
  let selected: { key: string; pounds: number } | null = null;
  for (const raw of r.candidates) {
    const name = raw === null ? null : spaced(raw);
    const looksPriced = name !== null && name.startsWith('£');
    if (looksPriced) pricedLooking++;
    const c = name === null ? null : parseCellName(name);
    const dep = c === null ? null : resolveDay(c.dep, anchor);
    const ret = c === null ? null : resolveDay(c.ret, anchor);
    if (c === null || dep === null || ret === null || !depSet.has(dep) || !retSet.has(ret) || ret < dep) {
      unparsed++;
      if (looksPriced) pricedFailed++;
      continue;
    }
    const key = `${dep}/${ret}`;
    if (seen.has(key)) duplicate = true;
    seen.add(key);
    if (c.selected) selected = { key, pounds: c.pounds };
    cells.push({
      status: 'price',
      departureDate: dep,
      returnDate: ret,
      amountMinor: c.pounds * 100,
      mark: c.mark,
    });
  }
  if (pricedFailed * 2 > pricedLooking) return { kind: 'unrecognised', why: 'selector-drift' };
  if (first !== undefined) {
    const range = r.ranges.length === 1 ? parseSelectedRange(r.ranges[0] ?? '') : null;
    const price = r.prices.length === 1 ? parseSelectedPrice(r.prices[0] ?? '') : null;
    const named = (
      dm: { day: number; month: number; year: number | null } | undefined,
      iso: IsoDate,
    ): boolean =>
      dm !== undefined &&
      dm.day === Number(iso.slice(8, 10)) &&
      dm.month === Number(iso.slice(5, 7)) &&
      (dm.year === null || dm.year === Number(iso.slice(0, 4)));
    if (selected === null || selected.key !== `${first.dep}/${first.ret}`)
      return { kind: 'unrecognised', why: 'first-view', check: 'selected-cell' };
    if (range === null || !named(range.dep, first.dep) || !named(range.ret, first.ret))
      return { kind: 'unrecognised', why: 'first-view', check: 'range' };
    if (price !== selected.pounds) return { kind: 'unrecognised', why: 'first-view', check: 'price' };
  }
  const possible = departures.flatMap((d) => returns.filter((x) => x >= d)).length;
  const namedDeps = new Set(cells.map((c) => c.departureDate));
  const namedRets = new Set(cells.map((c) => c.returnDate));
  const setsMatch =
    namedDeps.size === depSet.size &&
    [...namedDeps].every((x) => depSet.has(x)) &&
    namedRets.size === retSet.size &&
    [...namedRets].every((x) => retSet.has(x));
  const structuralCheck = duplicate
    ? 'duplicate'
    : r.candidates.length !== possible
      ? 'count'
      : !setsMatch
        ? 'sets'
        : null;
  const structural = structuralCheck === null ? 'ok' : 'unparsed';
  return {
    kind: 'view',
    departures,
    returns,
    cells: structural === 'ok' ? cells : [],
    unparsed,
    structural,
    structuralCheck,
  };
}
