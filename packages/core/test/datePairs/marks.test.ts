import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  datePairBuckets,
  datePairSearched,
  type ReducedMark,
  reducedMark,
  searchedDatePairCount,
} from '../../src/datePairs/marks.js';
import type { CellKey, ResolvedSpace } from '../../src/types/definition.js';
import type { Buckets, CellOutcomeStatus } from '../../src/types/execution.js';
import { asIata, asIsoDate } from '../../src/types/ids.js';

const ZERO: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
const b = (over: Partial<Buckets>): Buckets => ({ ...ZERO, ...over });

describe('reducedMark (spec rev 55 §6.6 "The main path\'s reading of a date pair")', () => {
  it.each<[keyof Buckets, ReducedMark]>([
    ['priced', 'priced'],
    ['empty', 'no-price-shown'],
    ['no_data', 'no-price-shown'],
    ['error', 'couldnt-read'],
    ['skipped', 'not-reached'],
    ['not_run', 'not-searched'],
  ])('a date pair whose airport pairs are all %s reads %s', (bucket, mark) => {
    expect(reducedMark(b({ [bucket]: 2 }))).toBe(mark);
  });

  it('reads a date pair with no airport-pair result as not searched (no parent run, a day rolled in)', () => {
    expect(reducedMark(ZERO)).toBe('not-searched');
    expect(reducedMark(b({ reused: 3 }))).toBe('not-searched');
  });

  it('takes the §6.6 precedence bucket, so a partly searched pair is never "no price shown"', () => {
    expect(reducedMark(b({ empty: 1, not_run: 3 }))).toBe('not-searched');
    expect(datePairSearched(b({ empty: 1, not_run: 3 }))).toBe(false);
    expect(reducedMark(b({ priced: 1, not_run: 3 }))).toBe('priced');
    expect(datePairSearched(b({ priced: 1, not_run: 3 }))).toBe(true);
    expect(reducedMark(b({ error: 1, empty: 3 }))).toBe('couldnt-read');
    expect(datePairSearched(b({ error: 1, empty: 3 }))).toBe(false);
    expect(reducedMark(b({ empty: 4 }))).toBe('no-price-shown');
    expect(datePairSearched(b({ empty: 4 }))).toBe(true);
  });

  it('orders the rows as §6.6 does: priced over not run over error over no price over skipped', () => {
    expect(reducedMark(b({ priced: 1, not_run: 1, error: 1, empty: 1, no_data: 1, skipped: 1 }))).toBe(
      'priced',
    );
    expect(reducedMark(b({ not_run: 1, error: 1, empty: 1, no_data: 1, skipped: 1 }))).toBe('not-searched');
    expect(reducedMark(b({ error: 1, empty: 1, no_data: 1, skipped: 1 }))).toBe('couldnt-read');
    expect(reducedMark(b({ empty: 1, skipped: 3 }))).toBe('no-price-shown');
    expect(reducedMark(b({ no_data: 1, skipped: 3 }))).toBe('no-price-shown');
    expect(reducedMark(b({ skipped: 1 }))).toBe('not-reached');
  });

  it('property: a date pair counts as searched exactly when its mark is priced or no price shown', () => {
    const n = fc.integer({ min: 0, max: 4 });
    fc.assert(
      fc.property(
        fc.record({ priced: n, empty: n, no_data: n, error: n, skipped: n, not_run: n, reused: n }),
        (x) => {
          const mark = reducedMark(x);
          expect(datePairSearched(x)).toBe(mark === 'priced' || mark === 'no-price-shown');
        },
      ),
    );
  });

  it('property: matches an independent reading of the §6.6 table', () => {
    const n = fc.integer({ min: 0, max: 3 });
    fc.assert(
      fc.property(
        fc.record({ priced: n, empty: n, no_data: n, error: n, skipped: n, not_run: n, reused: n }),
        (x) => {
          // why: an enumeration of the table's rows, written apart from the module (rows 1 to 6, then no rows at all)
          const want: ReducedMark =
            x.priced > 0
              ? 'priced'
              : x.not_run > 0
                ? 'not-searched'
                : x.error > 0
                  ? 'couldnt-read'
                  : x.empty + x.no_data > 0
                    ? 'no-price-shown'
                    : x.skipped > 0
                      ? 'not-reached'
                      : 'not-searched';
          expect(reducedMark(x)).toBe(want);
        },
      ),
    );
  });
});

describe('datePairBuckets and searchedDatePairCount (spec rev 55 §6.6, §8.1)', () => {
  // why: the worked example, two airport pairs (LHR and LGW to JFK) over two days and stays of 10 or 11 nights
  const space: ResolvedSpace = {
    origins: [asIata('LGW'), asIata('LHR')],
    destinations: [asIata('JFK')],
    departureFrom: asIsoDate('2027-03-14'),
    departureTo: asIsoDate('2027-03-15'),
    minNights: 10,
    maxNights: 11,
  };
  const key = (c: CellKey) => `${c.origin}|${c.departureDate}|${c.returnDate}`;
  const of =
    (m: Record<string, CellOutcomeStatus>) =>
    (c: CellKey): CellOutcomeStatus | null =>
      m[key(c)] ?? null;

  it('reads each date pair over every airport pair, in index order, a cell with no status as not run', () => {
    const statusOf = of({
      'LHR|2027-03-14|2027-03-24': 'priced',
      'LGW|2027-03-14|2027-03-25': 'empty',
      'LHR|2027-03-14|2027-03-25': 'empty',
      'LGW|2027-03-15|2027-03-25': 'error',
    });
    expect(datePairBuckets(space, statusOf)).toEqual([
      b({ priced: 1, not_run: 1 }),
      b({ empty: 2 }),
      b({ error: 1, not_run: 1 }),
      b({ not_run: 2 }),
    ]);
    expect(searchedDatePairCount(space, statusOf)).toBe(2);
  });

  it('one empty and the rest not run is not searched; an empty space counts nothing', () => {
    expect(searchedDatePairCount(space, of({ 'LGW|2027-03-14|2027-03-24': 'empty' }))).toBe(0);
    expect(searchedDatePairCount({ ...space, minNights: 12, maxNights: 11 }, () => 'priced')).toBe(0);
    expect(searchedDatePairCount(space, () => 'no_data')).toBe(4);
  });
});
