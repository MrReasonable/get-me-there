import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { foldNights, MAX_NIGHT_BANDS } from '../../src/datePairs/bands.js';
import { MAX_NIGHTS } from '../../src/space/limits.js';

const range = (b: { from: number; to: number }) => `${b.from}–${b.to}`;

describe('foldNights (spec §11 "Folded bands")', () => {
  it('12 stay lengths (10–21) stay twelve single-night bands', () => {
    const bands = foldNights(10, 21);
    expect(bands).toHaveLength(12);
    expect(bands.every((b) => b.from === b.to)).toBe(true);
    expect(bands.map((b) => b.from)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it('13 (10–22) fold into seven bands, six of 2 nights and the last 22–22', () => {
    expect(foldNights(10, 22).map(range)).toEqual([
      '10–11',
      '12–13',
      '14–15',
      '16–17',
      '18–19',
      '20–21',
      '22–22',
    ]);
  });

  it('91 (0–90) fold into twelve bands, eleven of 8 and the last 88–90', () => {
    const bands = foldNights(0, MAX_NIGHTS);
    expect(bands).toHaveLength(MAX_NIGHT_BANDS);
    expect(bands.slice(0, 11).every((b) => b.to - b.from + 1 === 8)).toBe(true);
    expect(range(bands[11] ?? { from: -1, to: -1 })).toBe('88–90');
  });

  it('one stay length is one band', () => {
    expect(foldNights(7, 7)).toEqual([{ from: 7, to: 7 }]);
  });

  it('for every 0 ≤ min ≤ max ≤ 90 the bands are contiguous, in order, cover [min, max], at most 12, one width but the last', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_NIGHTS }),
        fc.integer({ min: 0, max: MAX_NIGHTS }),
        (a, b) => {
          const [min, max] = a <= b ? [a, b] : [b, a];
          const bands = foldNights(min, max);
          expect(bands.length).toBeLessThanOrEqual(MAX_NIGHT_BANDS);
          expect(bands[0]?.from).toBe(min);
          expect(bands.at(-1)?.to).toBe(max);
          const width = (bands[0]?.to ?? 0) - min + 1;
          bands.forEach((band, i) => {
            expect(band.from).toBeLessThanOrEqual(band.to);
            if (i > 0) expect(band.from).toBe((bands[i - 1]?.to ?? Number.NaN) + 1);
            if (i < bands.length - 1) expect(band.to - band.from + 1).toBe(width);
            else expect(band.to - band.from + 1).toBeLessThanOrEqual(width);
          });
          // a stay range of at most 12 lengths is never folded
          if (max - min + 1 <= MAX_NIGHT_BANDS) expect(width).toBe(1);
        },
      ),
      { numRuns: 500 },
    );
  });

  it.each([
    [5, 4],
    [5.5, 8],
    [5, 8.5],
    [-1, 4],
  ])('foldNights(%d, %d) throws RangeError', (min, max) => {
    expect(() => foldNights(min, max)).toThrow(
      new RangeError(`foldNights: ${min}–${max} is not a stay range`),
    );
  });
});
