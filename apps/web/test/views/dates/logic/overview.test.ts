import { asIsoDate, asIsoMonth, type Buckets, type DatePair, decodeDatePairs } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  type BucketName,
  bandsOf,
  bucketOf,
  cellModel,
  columnsFor,
  GLYPH_ORDER,
  MARK_ORDER,
  markCounts,
  monthsOf,
  pairsAt,
  weeksOf,
} from '../../../../src/views/Dates/overview.js';
import { shadeScale } from '../../../../src/views/Dates/shade.js';
import {
  bucketsOf,
  calendarFig,
  DATES_SPACE,
  datePairOf,
  datesResponse,
  priced,
  verifiedFig,
} from '../../../fixtures.dates.js';

// Spec §11 Overview and §6.6: the months, each day's strip, the cell's shade or marks. Pure; Stryker runs it.

const d = asIsoDate;

describe('weeksOf (moved from the Calendar view; gridLogic.test.ts ported)', () => {
  it('weeks are Monday-first with null padding', () => {
    const weeks = weeksOf(asIsoMonth('2027-03'));
    expect(weeks[0]?.slice(0, 2)).toEqual([d('2027-03-01'), d('2027-03-02')]);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeksOf(asIsoMonth('2027-05'))[0]?.[0]).toBeNull(); // 1 May 2027 is a Saturday
    expect(
      weeksOf(asIsoMonth('2027-05'))
        .flat()
        .filter((x) => x !== null),
    ).toHaveLength(31);
    expect(weeksOf(asIsoMonth('2027-05')).at(-1)?.at(-1)).toBeNull();
  });
});

describe('monthsOf: the months the window touches', () => {
  it('across a month end and a year boundary, in order', () => {
    expect(monthsOf(DATES_SPACE)).toEqual(['2027-03', '2027-04']);
    expect(monthsOf({ departureFrom: d('2027-12-20'), departureTo: d('2028-02-01') })).toEqual([
      '2027-12',
      '2028-01',
      '2028-02',
    ]);
    expect(monthsOf({ departureFrom: d('2027-03-14'), departureTo: d('2027-03-14') })).toEqual(['2027-03']);
  });
  it('none for an expired window', () => {
    expect(monthsOf({ departureFrom: d('2027-03-15'), departureTo: d('2027-03-14') })).toEqual([]);
  });
});

/** §6.6's table, written out from the spec's rows over a list of airport-pair statuses (the independent enumeration). */
function enumerated(statuses: readonly BucketName[]): BucketName | null {
  if (statuses.length === 0) return null;
  const any = (s: BucketName) => statuses.includes(s);
  if (any('priced')) return 'priced'; // row 1
  if (any('not_run')) return 'not_run'; // row 2
  if (any('error')) return 'error'; // row 3
  if (any('empty') && statuses.every((s) => s === 'empty' || s === 'no_data' || s === 'skipped'))
    return 'empty'; // row 4
  if (any('no_data')) return 'no_data'; // row 5
  return statuses.every((s) => s === 'skipped') ? 'skipped' : null; // row 6
}

describe('bucketOf: §6.6’s precedence over a date pair’s airport pairs', () => {
  it('agrees with the table for every mix of up to two airport pairs in each bucket', () => {
    const names: BucketName[] = ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run'];
    let cases = 0;
    for (let code = 0; code < 3 ** 6; code += 1) {
      const counts = names.map((_n, i) => Math.floor(code / 3 ** i) % 3);
      const statuses = names.flatMap((n, i) => Array.from({ length: counts[i] ?? 0 }, () => n));
      const b: Buckets = {
        priced: counts[0] ?? 0,
        empty: counts[1] ?? 0,
        no_data: counts[2] ?? 0,
        error: counts[3] ?? 0,
        skipped: counts[4] ?? 0,
        not_run: counts[5] ?? 0,
        reused: 0,
      };
      expect(bucketOf(b), statuses.join(',')).toBe(enumerated(statuses));
      cases += 1;
    }
    expect(cases).toBe(729);
  });
});

describe('columnsFor and bandsOf: the day’s strip', () => {
  it('twelve stays or fewer are one column each; more fold into bands', () => {
    expect(columnsFor(bandsOf({ min: 10, max: 12 }), null)).toEqual([
      { from: 10, to: 10 },
      { from: 11, to: 11 },
      { from: 12, to: 12 },
    ]);
    expect(columnsFor(bandsOf({ min: 10, max: 22 }), null)).toHaveLength(7);
    expect(bandsOf(null)).toEqual([]);
  });
  it('an open band opens into its stays, in place; the others stay folded', () => {
    const bands = bandsOf({ min: 10, max: 22 });
    expect(columnsFor(bands, 12)).toEqual([
      { from: 10, to: 11 },
      { from: 12, to: 12 },
      { from: 13, to: 13 },
      { from: 14, to: 15 },
      { from: 16, to: 17 },
      { from: 18, to: 19 },
      { from: 20, to: 21 },
      { from: 22, to: 22 },
    ]);
    // a one-night band (the last) has nothing to open
    expect(columnsFor(bands, 22)).toEqual(columnsFor(bands, null));
    expect(columnsFor(bands, 99)).toEqual(columnsFor(bands, null));
  });
});

describe('pairsAt: a cell’s date pairs', () => {
  const pairs = decodeDatePairs(datesResponse({})).pairs;
  it('a single stay, and a band’s stays in order', () => {
    expect(pairsAt(pairs, DATES_SPACE, d('2027-03-14'), { from: 11, to: 11 }).map((p) => p.nights)).toEqual([
      11,
    ]);
    expect(
      pairsAt(pairs, DATES_SPACE, d('2027-03-15'), { from: 10, to: 12 }).map((p) => [
        p.departureDate,
        p.nights,
      ]),
    ).toEqual([
      ['2027-03-15', 10],
      ['2027-03-15', 11],
      ['2027-03-15', 12],
    ]);
  });
  it('nothing outside the space', () => {
    expect(pairsAt(pairs, DATES_SPACE, d('2027-03-13'), { from: 10, to: 10 })).toEqual([]);
    expect(pairsAt(pairs, DATES_SPACE, d('2027-03-14'), { from: 13, to: 14 })).toEqual([]);
  });
});

/** A date pair with these counts (four airport pairs). */
const p = (over: Partial<DatePair>): DatePair => ({
  ...datePairOf({ departureDate: '2027-03-14', nights: 10, basis: null }),
  buckets: bucketsOf({}),
  ...over,
});
const ranks = (...xs: DatePair[]) => new Map(xs.map((x, i) => [x.index, i + 1]));
/** Ten current figures from £300 to £390, so the scale is banded. */
const tenPrices = Array.from({ length: 10 }, (_x, i) =>
  p({ index: 100 + i, figure: priced(30_000 + i * 1_000) }),
);
const banded = shadeScale(tenPrices);

describe('cellModel: marks never read as no flights (spec §11, §9)', () => {
  it('each unpriced bucket alone is its own mark, never shaded', () => {
    for (const b of ['empty', 'no_data', 'error', 'skipped'] as const) {
      const m = cellModel([p({ buckets: bucketsOf({ [b]: 4 }) })], new Map(), banded);
      expect(m.marks, b).toEqual([b]);
      expect(m.shade, b).toBeNull();
    }
  });
  it('a date pair whose every airport pair is not searched is "not searched", never shaded', () => {
    expect(cellModel([p({ buckets: bucketsOf({}) })], new Map(), banded)).toMatchObject({
      marks: ['not_run'],
      shade: null,
    });
  });
  it('some airport pairs not searched and no price: the striped mark, not "not searched"', () => {
    expect(cellModel([p({ buckets: bucketsOf({ no_data: 3 }) })], new Map(), banded).marks).toEqual([
      'partly',
    ]);
  });
  it('mixed buckets take §6.6’s precedence, and the stripes when some are not searched', () => {
    expect(
      cellModel([p({ buckets: bucketsOf({ error: 1, empty: 3, not_run: 0 }) })], new Map(), banded).marks,
    ).toEqual(['error']);
    expect(
      cellModel([p({ buckets: bucketsOf({ empty: 1, no_data: 3, not_run: 0 }) })], new Map(), banded).marks,
    ).toEqual(['empty']);
    expect(
      cellModel([p({ buckets: bucketsOf({ skipped: 1, no_data: 3, not_run: 0 }) })], new Map(), banded).marks,
    ).toEqual(['no_data']);
  });
  it('a price found but none that can be the figure (partially verified, unconfirmed) says so, never a shade', () => {
    expect(
      cellModel(
        [p({ buckets: bucketsOf({ priced: 1, no_data: 3 }), partiallyVerified: 1 })],
        new Map(),
        banded,
      ),
    ).toMatchObject({
      marks: ['unshown'],
      shade: null,
    });
  });
  it('every price left out for a known journey time: "none within", with its marks, never "no fares"', () => {
    expect(
      cellModel([p({ buckets: bucketsOf({ priced: 1, no_data: 3 }), journeyLeftOut: 1 })], new Map(), banded)
        .marks,
    ).toEqual(['noneWithin']);
    expect(
      cellModel([p({ buckets: bucketsOf({ priced: 1, not_run: 3 }), journeyLeftOut: 1 })], new Map(), banded)
        .marks,
    ).toEqual(['noneWithin', 'partly']);
  });
  it('no airport pair in scope: no mark', () => {
    expect(cellModel([p({ buckets: bucketsOf({}, 0) })], new Map(), banded).marks).toEqual([]);
  });
});

describe('cellModel: shading (spec §11, revision 50)', () => {
  it('a current calendar figure is shaded and carries "not checked"; a verified one does not', () => {
    const cal = p({ index: 100, figure: priced(30_000), buckets: bucketsOf({ priced: 4 }) });
    expect(cellModel([cal], ranks(cal), banded)).toMatchObject({ shade: 0, marks: ['notChecked'] });
    const ver = p({
      index: 109,
      figure: priced(39_000, { basis: 'verified' }),
      buckets: bucketsOf({ priced: 4 }),
    });
    expect(cellModel([ver], ranks(ver), banded)).toMatchObject({ shade: 4, marks: [] });
  });
  it('a figure with an airport pair not searched is shaded and striped', () => {
    const x = p({
      index: 100,
      figure: verifiedFig({ fromEarlierSearch: true }),
      buckets: bucketsOf({ priced: 1, no_data: 2 }),
    });
    expect(cellModel([x], ranks(x), shadeScale([x]))).toMatchObject({ shade: 'flat', marks: ['partly'] });
  });
  it('superseded and not-seen figures are off the scale: no shade, their mark', () => {
    const sup = p({ figure: calendarFig({ superseded: true }), buckets: bucketsOf({ priced: 4 }) });
    expect(cellModel([sup], ranks(sup), banded)).toMatchObject({
      shade: null,
      marks: ['superseded', 'notChecked'],
    });
    const unseen = p({
      figure: verifiedFig({ notSeenInLatest: { ageHours: 3 } }),
      buckets: bucketsOf({ priced: 4 }),
    });
    expect(cellModel([unseen], ranks(unseen), banded)).toMatchObject({ shade: null, marks: ['notSeen'] });
  });
  it('a band cell shows its best-ranked figure’s shade, and the stripes when any date pair in it has a cell not searched', () => {
    const a = p({ index: 1, nights: 10, figure: priced(39_000), buckets: bucketsOf({ priced: 4 }) });
    const b = p({ index: 2, nights: 11, figure: priced(30_000), buckets: bucketsOf({ priced: 4 }) });
    const c = p({ index: 3, nights: 12, buckets: bucketsOf({ no_data: 3 }) });
    const m = cellModel([a, b, c], ranks(b, a), banded);
    expect(m.lead).toBe(b);
    expect(m.shade).toBe(0);
    expect(m.marks).toEqual(['notChecked', 'partly']);
    expect(m.pairs).toEqual([a, b, c]);
    expect(m.buckets).toMatchObject({ priced: 8, no_data: 3, not_run: 1 });
  });
  it('an unranked figure (outside the stay filter’s rank) sorts after a ranked one in a band', () => {
    const a = p({ index: 1, figure: priced(30_000) });
    const b = p({ index: 2, figure: priced(31_000) });
    expect(cellModel([a, b], new Map([[2, 1]]), banded).lead).toBe(b);
    expect(cellModel([a, b], new Map([[1, 1]]), banded).lead).toBe(a);
  });
});

describe('markCounts and the mark order', () => {
  it('counts each date pair’s marks', () => {
    const counts = markCounts(
      [p({ buckets: bucketsOf({}) }), p({ buckets: bucketsOf({}) }), p({ buckets: bucketsOf({ empty: 4 }) })],
      new Map(),
      banded,
    );
    expect(counts).toMatchObject({ not_run: 2, empty: 1, no_data: 0, partly: 0 });
    expect(Object.keys(counts).sort()).toEqual([...MARK_ORDER].sort());
  });
  it('the legend lists the unpriced buckets first, in the Calendar’s glyph order', () => {
    expect(GLYPH_ORDER).toEqual(['empty', 'no_data', 'error', 'skipped', 'not_run']);
    expect(MARK_ORDER.slice(0, 5)).toEqual(GLYPH_ORDER);
    expect(new Set(MARK_ORDER).size).toBe(11);
  });
});
