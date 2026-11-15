import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dayMark } from '../../src/datePairs/day.js';
import { type ReducedMark, reducedMark } from '../../src/datePairs/marks.js';
import type { Buckets } from '../../src/types/execution.js';

// Trips and Search plan, Ruling 18 and Review Focus 4: a calendar day's mark is core's `reducedMark` over the summed
// buckets of its stays in view, so a day reads the same precedence a date pair does (priced, then not searched, then
// couldn't read, then no price, then not reached).

const ZERO: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
const b = (over: Partial<Buckets>): Buckets => ({ ...ZERO, ...over });
const KEYS = ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run', 'reused'] as const;

describe('dayMark (Ruling 18)', () => {
  it.each<[string, Buckets[], ReducedMark]>([
    // Review Focus 4's cases over the four airport pairs of the worked example, one entry per stay
    ['priced plus couldn’t read', [b({ priced: 1, no_data: 3 }), b({ error: 4 })], 'priced'],
    ['only no fares', [b({ empty: 4 })], 'no-price-shown'],
    ['only no price', [b({ empty: 4 }), b({ no_data: 4 }), b({ empty: 2, no_data: 2 })], 'no-price-shown'],
    ['only couldn’t read', [b({ error: 4 }), b({ error: 1, empty: 3 })], 'couldnt-read'],
    ['all not run', [b({ not_run: 4 }), b({ not_run: 4 })], 'not-searched'],
    // one stay with an empty airport pair and three not run: not searched, never "no price"
    ['one empty and three not run', [b({ empty: 1, not_run: 3 })], 'not-searched'],
    ['a stay no price and another not run', [b({ empty: 4 }), b({ not_run: 4 })], 'not-searched'],
    // why: fix round 1 (review M1): no cached data outranks skipped (§6.6), so a day not reached beside a stay with no
    // cached data reads no price; a day whose every stay was skipped reads not reached
    [
      'not reached beside no cached data: no price',
      [b({ skipped: 4 }), b({ skipped: 2, no_data: 2 })],
      'no-price-shown',
    ],
    ['only not reached', [b({ skipped: 4 }), b({ skipped: 4 })], 'not-reached'],
    ['skipped alone', [b({ skipped: 4 })], 'not-reached'],
    ['couldn’t read beats no price', [b({ empty: 4 }), b({ error: 1, empty: 3 })], 'couldnt-read'],
    ['a stay with no airport pair result', [ZERO], 'not-searched'],
    ['reused counts decide nothing', [b({ reused: 4 })], 'not-searched'],
  ])('%s', (_name, stays, mark) => {
    expect(dayMark(stays)).toBe(mark);
  });

  it('a day with no stays in view reads not searched, as an empty set of buckets does', () => {
    expect(dayMark([])).toBe('not-searched');
  });

  it('reads any iterable of buckets, once each', () => {
    function* stays() {
      yield b({ error: 2 });
      yield b({ empty: 2 });
    }
    expect(dayMark(stays())).toBe('couldnt-read');
  });

  it('is reducedMark of the stays’ buckets summed, for any stays', () => {
    const bucket = fc.record({
      priced: fc.nat(3),
      empty: fc.nat(3),
      no_data: fc.nat(3),
      error: fc.nat(3),
      skipped: fc.nat(3),
      not_run: fc.nat(3),
      reused: fc.nat(3),
    });
    fc.assert(
      fc.property(fc.array(bucket, { maxLength: 6 }), (stays) => {
        const sum = { ...ZERO };
        for (const s of stays) for (const k of KEYS) sum[k] += s[k];
        expect(dayMark(stays)).toBe(reducedMark(sum));
      }),
    );
  });
});
