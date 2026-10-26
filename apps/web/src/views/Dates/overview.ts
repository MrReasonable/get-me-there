import {
  addDays,
  type Buckets,
  type DatePair,
  type DatePairSpace,
  datePairIndex,
  foldNights,
  type IsoDate,
  type IsoMonth,
  monthOf,
  type NightsBand,
} from '@gmt/core';
import { monthDays, weekdayIndex } from '../../format.js';
import { type Band, isCurrent, type QuintileScale } from './shade.js';

// The overview's model (spec §11 Dates "Overview"): the window's months, each day's strip of stay-length (or folded
// band) cells, and what each cell shows: its shade (one scale, current figures only), or the mark of its bucket by
// §6.6's precedence, with the striped "partly not searched" mark and the figure marks. Pure: no clock, no DOM.

/** Monday-first weeks of one month, null for padding (moved from the Calendar view's grid, WP19 §4). */
export function weeksOf(month: IsoMonth): Array<Array<IsoDate | null>> {
  const dates = monthDays(month);
  const first = dates[0];
  const cells: Array<IsoDate | null> =
    first === undefined ? [] : Array.from({ length: weekdayIndex(first) }, () => null);
  cells.push(...dates);
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
  for (let m = monthOf(space.departureFrom); ; ) {
    out.push(m);
    if (m === last) return out;
    const days = monthDays(m);
    const end = days[days.length - 1];
    if (end === undefined) return out;
    m = monthOf(addDays(end, 1));
  }
}

/** The six buckets of spec §3, and the order the legend lists the unpriced ones (moved from the Calendar's display). */
export type BucketName = 'priced' | 'empty' | 'no_data' | 'error' | 'skipped' | 'not_run';
export const GLYPH_ORDER = [
  'empty',
  'no_data',
  'error',
  'skipped',
  'not_run',
] as const satisfies readonly BucketName[];

/**
 * §6.6's roll-up precedence over a date pair's airport pairs (their buckets as counts): any priced, then any not
 * searched, then any error, then any no fares (the rest being no fares, no cached data or skipped), then any no cached
 * data, then skipped. Null when no airport pair is in scope.
 */
export function bucketOf(b: Buckets): BucketName | null {
  if (b.priced > 0) return 'priced';
  if (b.not_run > 0) return 'not_run';
  if (b.error > 0) return 'error';
  if (b.empty > 0) return 'empty';
  if (b.no_data > 0) return 'no_data';
  if (b.skipped > 0) return 'skipped';
  return null;
}

/**
 * Every non-colour mark a cell can carry (spec §11 Overview): one per unpriced bucket ("not searched" only when every
 * airport pair is), the striped "partly not searched", the figure's "not checked" (a calendar price), "superseded" and
 * "not seen", "none within <limit>" (every price left out for a known journey time), and "unshown" (a price was found
 * but none can be the figure: partially verified, unconfirmed or failed).
 */
export type Mark =
  | (typeof GLYPH_ORDER)[number]
  | 'partly'
  | 'notChecked'
  | 'superseded'
  | 'notSeen'
  | 'noneWithin'
  | 'unshown';
export const MARK_ORDER: readonly Mark[] = [
  ...GLYPH_ORDER,
  'partly',
  'notChecked',
  'superseded',
  'notSeen',
  'noneWithin',
  'unshown',
];

/** One cell of a day's strip: a single stay length, or a folded band of them. */
export interface Column {
  from: number;
  to: number;
}

/**
 * The columns of a day: the folded bands of the stay range in view (at most 12; `foldNights`), with the band at
 * `open` (its `from`) opened into its stay lengths.
 */
export function columnsFor(bands: readonly NightsBand[], open: number | null): Column[] {
  return bands.flatMap((b) =>
    b.from === open && b.to > b.from
      ? Array.from({ length: b.to - b.from + 1 }, (_x, i) => ({ from: b.from + i, to: b.from + i }))
      : [{ from: b.from, to: b.to }],
  );
}

/** The bands of a stay range in view, or none when no stay is in view. */
export function bandsOf(range: { min: number; max: number } | null): NightsBand[] {
  return range === null ? [] : foldNights(range.min, range.max);
}

/** What one cell shows. */
export interface CellModel {
  /** The date pairs in the cell (one, or a band's), in stay order. */
  pairs: DatePair[];
  /** The best-ranked date pair with a figure (a current one first), or null. */
  lead: DatePair | null;
  /** The shade: a band, the flat shade, or null (unshaded: no figure, or one off the scale). */
  shade: Band | 'flat' | null;
  marks: Mark[];
  /** The six buckets summed over the cell's date pairs. */
  buckets: Buckets;
}

const ZERO: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
function sum(pairs: readonly DatePair[]): Buckets {
  const s = { ...ZERO };
  for (const p of pairs) {
    s.priced += p.buckets.priced;
    s.empty += p.buckets.empty;
    s.no_data += p.buckets.no_data;
    s.error += p.buckets.error;
    s.skipped += p.buckets.skipped;
    s.not_run += p.buckets.not_run;
    s.reused += p.buckets.reused;
  }
  return s;
}

/**
 * A cell's model (spec §11 Overview, revision 50): a cell with a current figure is shaded on the one scale (a band
 * cell by its cheapest current figure), and a calendar figure also carries "not checked"; a superseded or not-seen
 * figure is drawn with its mark on a neutral fill, never on the scale; a cell without a figure carries its bucket's
 * mark by §6.6's precedence, never a shade; "not searched" only when every airport pair of it is not searched, and the
 * striped "partly not searched" whenever some (but not all) are, priced or not.
 */
export function cellModel(
  pairs: readonly DatePair[],
  rankOf: ReadonlyMap<number, number>,
  scale: QuintileScale,
): CellModel {
  const ranked = pairs
    .filter((p) => p.figure !== null)
    .sort((a, b) => (rankOf.get(a.index) ?? Infinity) - (rankOf.get(b.index) ?? Infinity));
  const lead = ranked[0] ?? null;
  const buckets = sum(pairs);
  const total =
    buckets.priced + buckets.empty + buckets.no_data + buckets.error + buckets.skipped + buckets.not_run;
  const partly = buckets.not_run > 0 && buckets.not_run < total;
  const marks: Mark[] = [];
  let shade: CellModel['shade'] = null;
  const f = lead?.figure ?? null;
  if (f !== null) {
    // why: a current figure is always on the scale it was built from, so a scale that is not banded is flat
    if (isCurrent(f)) shade = scale.mode === 'quintile' ? scale.band(f.price.pricePence) : 'flat';
    else marks.push(f.superseded ? 'superseded' : 'notSeen');
    if (f.basis === 'calendar') marks.push('notChecked');
    if (partly) marks.push('partly');
    return { pairs: [...pairs], lead, shade, marks, buckets };
  }
  if (pairs.some((p) => p.journeyLeftOut > 0)) marks.push('noneWithin');
  const b = bucketOf(buckets);
  if (b === 'priced') {
    if (!marks.includes('noneWithin')) marks.push('unshown');
  } else if (b === 'not_run') {
    marks.push(partly ? 'partly' : 'not_run');
  } else if (b !== null) {
    marks.push(b);
  }
  if (partly && b !== 'not_run') marks.push('partly');
  return { pairs: [...pairs], lead, shade, marks, buckets };
}

/** The date pairs of a cell on `date` for `column`, from the decoded pairs in index order (none outside the space). */
export function pairsAt(
  pairs: readonly DatePair[],
  space: DatePairSpace,
  date: IsoDate,
  column: Column,
): DatePair[] {
  const out: DatePair[] = [];
  for (let n = column.from; n <= column.to; n += 1) {
    const i = datePairIndex(space, date, addDays(date, n));
    const p = i === null ? undefined : pairs[i];
    if (p !== undefined) out.push(p);
  }
  return out;
}

/** Each mark's count over the date pairs in view, one date pair at a time (the legend's numbers). */
export function markCounts(
  pairs: readonly DatePair[],
  rankOf: ReadonlyMap<number, number>,
  scale: QuintileScale,
): Record<Mark, number> {
  const counts: Record<Mark, number> = {
    empty: 0,
    no_data: 0,
    error: 0,
    skipped: 0,
    not_run: 0,
    partly: 0,
    notChecked: 0,
    superseded: 0,
    notSeen: 0,
    noneWithin: 0,
    unshown: 0,
  };
  for (const p of pairs) for (const m of cellModel([p], rankOf, scale).marks) counts[m] += 1;
  return counts;
}
