/**
 * One settled view of the date grid (spec §2 rev 34; plan decision 70; the `--grid` recordings of 2026-10-18), read
 * through locators and then checked by a pure function.
 *
 * - The view is the `dates-grid` view only when the dialog "Price insights" is open, its "Dates" tab is selected, the
 *   panel holds one `grid "Date grid"` and the four scroll buttons.
 * - Each cell's dates come from its own name; after a scroll the page reuses and rotates its elements, so position says
 *   nothing. The two lines are a set check: each must hold seven consecutive dates with the right weekdays, and the
 *   dates the cells name must be those sets.
 * - A view holds 49 cells less the pairs whose return precedes the departure. It is taken only once it names that
 *   many (spec §2 rev 46; the darwin-x64 recordings of 2026-10-26): a view whose readable lines call for more cells than
 *   it names is still drawing, and its settle waits, to its bound at most. A cell that fails the grammar or names a
 *   date outside the lines is unparsed (counted). A pair named twice, a count that is not the expected one, or cells
 *   whose dates are not the lines' sets make the view structurally unparsed: none of its cells is kept.
 * - A pair the grid shows without a price (spec §2 "Cells by name"; grid/2026-10-26/7 and 8) is a button like any cell,
 *   named "no flights, <d> <Mon> to <d> <Mon>" or "price unknown, <d> <Mon> to <d> <Mon>". Where GRID_UNPRICED_VERIFIED
 *   is set it is read as an unpriced cell: it counts for the view's cells and its lines' sets, but carries no price.
 *   The query's own pair may be one, then named with ", selected" (grid/2026-10-27/2). Elsewhere it is unparsed, as
 *   any name the grammar does not read.
 * - More than half of the priced-looking cells (names starting "£") failing is drift: `unrecognised`.
 * - Each date takes the year nearest the query's departure. On the first view exactly one cell is selected and it is
 *   the query's pair. A priced one needs the range line naming it (and its year, when printed) and the price line
 *   showing its price; an unpriced one has neither line printed, and a line that is printed must still name the
 *   query's dates and carry no price.
 */
import type { GridCell, IsoDate } from '@gmt/core';
import { countOf, type LocatorLike, nameOf, timeoutOf } from './driver.js';
import {
  dayLabels,
  parseCellName,
  parseSelectedPrice,
  parseSelectedRange,
  parseUnpricedCellName,
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
  ...new Set(xs.flatMap((x) => [...(re.exec(spaced(x)) ?? [])].slice(0, 1))),
];
/** The one value of a list, or null when it holds none or more than one. */
const one = ([x, ...rest]: readonly string[]): string | null =>
  x !== undefined && rest.length === 0 ? x : null;

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

/**
 * What must change before a view after a scroll counts: the dates on its lines, as sets (fix round 1, PIE M2). A
 * re-render that only reorders the label elements is no change, so it ends as a scroll that did not settle, never as a
 * wrong move.
 */
export const changeKeyOf = (r: Pick<RawView, 'lines'>): string =>
  r.lines
    .map((l) =>
      dayLabels(spaced(l))
        .map((x) => `${x.month}-${x.day}`)
        .sort()
        .join(','),
    )
    .join('|');

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
    labelsLine1: dayLabels(r.lines.slice(0, 1).join('')).length,
    labelsLine2: dayLabels(r.lines.slice(1, 2).join('')).length,
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
  // why: seven distinct days spanning six are seven consecutive days
  const days = dates.map(epochDay);
  return new Set(days).size === 7 && Math.max(...days) - Math.min(...days) === 6 ? [...dates].sort() : null;
}

/** The pairs of `departures` × `returns` whose return is on or after the departure (a same-day pair is shown). */
const pairsOf = (departures: readonly IsoDate[], returns: readonly IsoDate[]): number =>
  departures.flatMap((d) => returns.filter((x) => x >= d)).length;

/**
 * How many cells a view's lines call for: the pairs of their seven departures and seven returns whose return is on or
 * after the departure (49, fewer near the diagonal); null when the lines do not read as two lines of seven consecutive
 * days with the right weekdays.
 */
export function cellsCalledFor(lines: readonly string[], anchor: IsoDate): number | null {
  const [depLine, retLine, ...more] = lines;
  if (depLine === undefined || retLine === undefined || more.length > 0) return null;
  const departures = lineDates(spaced(depLine), anchor);
  const returns = lineDates(spaced(retLine), anchor);
  return departures === null || returns === null ? null : pairsOf(departures, returns);
}

/**
 * Whether a view is still drawing its cells (spec §2 rev 46): its lines read, and it names fewer cells than they call
 * for. The darwin-x64 recordings of 2026-10-26 held such views still across two polls (each undrawn cell printed "0000"
 * in its place), so a settle waits while this holds. A view whose lines do not read, or that names more cells than they
 * call for, is not drawing: there is nothing to wait for, and the reading refuses it as it is.
 */
export function stillDrawing(lines: readonly string[], cells: number, anchor: IsoDate): boolean {
  // why: lines that do not read call for none, so nothing is waited for
  return cells < (cellsCalledFor(lines, anchor) ?? 0);
}

/**
 * Checks one view (see the module comment). `anchor` is the query's departure (each date's year); `first` is the
 * query's pair on the page's first view; `o.unpriced` reads the unpriced cells (GRID_UNPRICED_VERIFIED).
 */
export function interpretView(
  r: RawView,
  anchor: IsoDate,
  first?: { dep: IsoDate; ret: IsoDate },
  o: { unpriced: boolean } = { unpriced: false },
): Interpreted {
  const g = r.datesGrid;
  if (g.dialog !== 1 || g.datesSelected !== 1 || g.grid !== 1 || g.scrollButtons !== 4)
    return { kind: 'unrecognised', why: 'not-dates-grid' };
  const [depLine = '', retLine = '', ...more] = r.lines.map(spaced);
  const departures = lineDates(depLine, anchor);
  const returns = lineDates(retLine, anchor);
  if (more.length > 0 || departures === null || returns === null)
    return { kind: 'unrecognised', why: 'lines' };
  const depSet = new Set<string>(departures);
  const retSet = new Set<string>(returns);
  const cells: GridCell[] = [];
  const seen = new Set<string>();
  let unparsed = 0;
  let pricedLooking = 0;
  let pricedFailed = 0;
  let duplicate = false;
  // why: `pounds` is null when the selected pair is unpriced (spec §2: the grid selects the query's pair even when it
  // shows "no flights" or "price unknown" for it, grid/2026-10-27/2); more than one selected cell is never one query
  let selected: { key: string; pounds: number | null } | null = null;
  // why: CodeRabbit on PR #34: counted from the names, so a second selection the reading discards (dates off the
  // lines, a name it does not parse) still makes the first view's selection ambiguous
  const selectedCount = r.candidates.filter((x) => x !== null && spaced(x).endsWith(', selected')).length;
  for (const raw of r.candidates) {
    const name = raw === null ? null : spaced(raw);
    const looksPriced = name?.startsWith('£') === true;
    if (looksPriced) pricedLooking++;
    const priced = name === null ? null : parseCellName(name);
    // why: spec §2 "Cells by name": the unpriced forms are read only where a recording proved them
    const c = priced ?? (o.unpriced && name !== null ? parseUnpricedCellName(name) : null);
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
    if ('status' in c) {
      // why: an unpriced cell explains its pair (it is shown, and says why it has no price) but is never priced
      if (c.selected) selected = { key, pounds: null };
      cells.push({ status: c.status, departureDate: dep, returnDate: ret });
      continue;
    }
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
    const rangeLine = one(r.ranges);
    const priceLine = one(r.prices);
    const range = rangeLine === null ? null : parseSelectedRange(rangeLine);
    const price = priceLine === null ? null : parseSelectedPrice(priceLine);
    const named = (
      dm: { day: number; month: number; year: number | null } | undefined,
      iso: IsoDate,
    ): boolean =>
      dm !== undefined &&
      dm.day === Number(iso.slice(8, 10)) &&
      dm.month === Number(iso.slice(5, 7)) &&
      (dm.year === null || dm.year === Number(iso.slice(0, 4)));
    if (selected === null || selectedCount !== 1 || selected.key !== `${first.dep}/${first.ret}`)
      return { kind: 'unrecognised', why: 'first-view', check: 'selected-cell' };
    if (selected.pounds === null) {
      // why: grid/2026-10-27/2: an unpriced query pair is selected but the dialog prints no range or price line for
      // it; a line that is there must still name the query's dates, and a price for an unpriced pair is a contradiction
      // why: counted from the lines themselves (CodeRabbit on PR #34): `one` is null for two lines as for none
      if (
        r.ranges.length > 1 ||
        (rangeLine !== null &&
          (range === null || !named(range.dep, first.dep) || !named(range.ret, first.ret)))
      )
        return { kind: 'unrecognised', why: 'first-view', check: 'range' };
      if (r.prices.length > 0) return { kind: 'unrecognised', why: 'first-view', check: 'price' };
    } else {
      if (range === null || !named(range.dep, first.dep) || !named(range.ret, first.ret))
        return { kind: 'unrecognised', why: 'first-view', check: 'range' };
      if (price !== selected.pounds) return { kind: 'unrecognised', why: 'first-view', check: 'price' };
    }
  }
  const possible = pairsOf(departures, returns);
  const namedDeps = new Set(cells.map((c) => c.departureDate));
  const namedRets = new Set(cells.map((c) => c.returnDate));
  // why: every kept cell names dates on the lines, so the named sets are the lines' sets when their sizes are
  const setsMatch = namedDeps.size === depSet.size && namedRets.size === retSet.size;
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
