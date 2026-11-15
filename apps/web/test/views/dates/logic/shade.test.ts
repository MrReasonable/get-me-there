// The calendar's heat scale (Ruling 18; plan decision 38). scale.ts moved here as shade.ts (WP19 §4) with its tests: the
// quintile, flat and invariant cases are scale.test.ts's, ported; the band colours and the legend's printed ranges went
// with the overview (Task 9: the heat ramp is the theme's tokens, pinned by test/views/trip/contrast.test.ts). Pure;
// Stryker runs it.
import { describe, expect, it } from 'vitest';
import { buildScale, isCurrent, quintileBand } from '../../../../src/views/Dates/shade.js';
import { calendarFig, verifiedFig } from '../../../fixtures.dates.js';

/** A small seeded generator (mulberry32): the invariant loops below are reproducible without a new dependency. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ten = (from: number, step: number) => Array.from({ length: 10 }, (_, i) => from + i * step);

describe('quintile scale (spec §11 View B)', () => {
  it('ten distinct values take two per band', () => {
    const sorted = ten(40000, 5000);
    expect(sorted.map((v) => quintileBand(sorted, v))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('ties share the lower band', () => {
    expect(quintileBand([100, 100, 200], 100)).toBe(0);
    expect(quintileBand([100, 100, 200], 200)).toBe(3);
  });
  it('an empty scale refuses to band anything', () => {
    expect(() => quintileBand([], 1)).toThrow(RangeError);
    expect(buildScale([])).toMatchObject({ mode: 'empty', count: 0, minPence: null, maxPence: null });
    expect(buildScale([]).band(1)).toBeNull();
  });
  it('bands a price against the values given in any order, with their count and range', () => {
    const s = buildScale([...ten(40000, 5000)].reverse());
    expect([s.mode, s.count, s.minPence, s.maxPence]).toEqual(['quintile', 10, 40000, 85000]);
    expect([s.band(40000), s.band(45000), s.band(50000), s.band(85000)]).toEqual([0, 0, 1, 4]);
  });
});

describe('flat scale (plan decision 38)', () => {
  it('fewer than ten days give one shade and no bands', () => {
    const s = buildScale(ten(40000, 5000).slice(0, 9));
    expect(s.mode).toBe('flat-few');
    expect(s.band(40000)).toBeNull();
  });
  it('a spread under 10% of the cheapest gives one shade; exactly 10% is banded', () => {
    expect(buildScale(ten(40000, 400)).mode).toBe('flat-narrow'); // 40000–43600: 9%
    expect(buildScale([...ten(40000, 400).slice(0, 9), 44000]).mode).toBe('quintile'); // 10%
  });
});

describe('scale invariants over seeded random inputs (TS-3)', () => {
  it('200 runs: bands in 0..4 and monotone in price; a flat scale bands nothing', () => {
    const rand = seeded(20261015);
    let banded = 0;
    for (let run = 0; run < 200; run += 1) {
      const n = 1 + Math.floor(rand() * 60);
      const values = Array.from(
        { length: n },
        () => 30000 + Math.floor(rand() * 4) * Math.floor(rand() * 20000),
      );
      const s = buildScale(values);
      if (s.mode !== 'quintile') {
        expect(
          values.map((v) => s.band(v)).every((b) => b === null),
          `run ${run}`,
        ).toBe(true);
        continue;
      }
      banded += 1;
      const bands = [...values].sort((a, b) => a - b).map((v) => s.band(v) ?? -1);
      expect(Math.min(...bands), `run ${run}`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...bands), `run ${run}`).toBeLessThanOrEqual(4);
      for (let i = 1; i < bands.length; i += 1)
        expect(bands[i] ?? 0, `run ${run}`).toBeGreaterThanOrEqual(bands[i - 1] ?? 0);
    }
    // why: the loop must exercise the banded path, not only the flat one.
    expect(banded).toBeGreaterThan(50);
  });
});

describe('isCurrent: a price a later search did not overturn (current prices only on the scale)', () => {
  it('superseded and not-seen figures are not current', () => {
    expect(isCurrent(calendarFig())).toBe(true);
    expect(isCurrent(calendarFig({ superseded: true }))).toBe(false);
    expect(isCurrent(verifiedFig({ notSeenInLatest: { ageHours: 'unknown' } }))).toBe(false);
  });
});
