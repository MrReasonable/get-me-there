import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { datePairSearched, type ReducedMark, reducedMark } from '../../src/datePairs/marks.js';
import type { Buckets } from '../../src/types/execution.js';

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
