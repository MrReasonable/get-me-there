// The overview's shading (spec §11 Overview; plan decision 38; revision 50). scale.ts moved here as shade.ts (WP19 §4)
// with its tests: the quintile, flat, invariant and band-colour cases are scale.test.ts's, ported unchanged; the
// cases after them are the overview's own. Pure; Stryker runs it.
import type { DatePair } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { cellModel } from '../../../../src/views/Dates/overview.js';
import {
  BAND_CLASSES,
  BAND_COLOURS,
  type Band,
  buildScale,
  FLAT_CLASS,
  isCurrent,
  quintileBand,
  shadeScale,
} from '../../../../src/views/Dates/shade.js';
import { contrast, luminance } from '../../../contrast.js';
import { bucketsOf, calendarFig, datePairOf, priced, verifiedFig } from '../../../fixtures.dates.js';

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
    expect(buildScale([])).toMatchObject({ mode: 'empty', count: 0, legend: [], minPence: null });
  });
  it('the legend is numeric: one entry per occupied band with its pence range and day count', () => {
    const s = buildScale([...ten(40000, 5000)].reverse());
    expect(s.mode).toBe('quintile');
    expect(s.legend[0]).toEqual({ band: 0, minPence: 40000, maxPence: 45000, count: 2 });
    expect(s.legend[4]).toEqual({ band: 4, minPence: 80000, maxPence: 85000, count: 2 });
  });
});

describe('flat scale (plan decision 38)', () => {
  it('fewer than ten days give one shade and no bands', () => {
    const s = buildScale(ten(40000, 5000).slice(0, 9));
    expect(s.mode).toBe('flat-few');
    expect(s.band(40000)).toBeNull();
    expect(s.legend).toEqual([]);
  });
  it('a spread under 10% of the cheapest gives one shade; exactly 10% is banded', () => {
    expect(buildScale(ten(40000, 400)).mode).toBe('flat-narrow'); // 40000–43600: 9%
    expect(buildScale([...ten(40000, 400).slice(0, 9), 44000]).mode).toBe('quintile'); // 10%
  });
});

describe('scale invariants over seeded random inputs (TS-3)', () => {
  it('200 runs: bands in 0..4 and monotone in price; legend counts sum to n; legend ranges ordered and disjoint', () => {
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
        expect(s.legend, `run ${run}`).toEqual([]);
        continue;
      }
      banded += 1;
      const bands = [...values].sort((a, b) => a - b).map((v) => s.band(v) ?? -1);
      expect(Math.min(...bands), `run ${run}`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...bands), `run ${run}`).toBeLessThanOrEqual(4);
      for (let i = 1; i < bands.length; i += 1)
        expect(bands[i] ?? 0, `run ${run}`).toBeGreaterThanOrEqual(bands[i - 1] ?? 0);
      expect(
        s.legend.reduce((sum, e) => sum + e.count, 0),
        `run ${run}`,
      ).toBe(n);
      for (let i = 1; i < s.legend.length; i += 1) {
        const prev = s.legend[i - 1];
        const cur = s.legend[i];
        expect(
          cur !== undefined && prev !== undefined && cur.minPence > prev.maxPence && cur.band > prev.band,
          `run ${run}`,
        ).toBe(true);
      }
    }
    // why: the loop must exercise the banded path, not only the flat one.
    expect(banded).toBeGreaterThan(50);
  });
});

describe('band colours (review ui-r2-005)', () => {
  const bands: Band[] = [0, 1, 2, 3, 4];
  /** The Tailwind class that spells a text colour: the two named ones, else an arbitrary value. */
  const textClass = (text: string) =>
    text === '#ffffff' ? 'text-white' : text === '#000000' ? 'text-black' : `text-[${text}]`;
  const hasClass = (classes: string, one: string) => classes.split(/\s+/).includes(one);
  it('every band carries its text at WCAG AA 4.5:1 or better, and its class spells the same colours', () => {
    for (const b of bands) {
      const { fill, text } = BAND_COLOURS[b];
      expect(contrast(fill, text)).toBeGreaterThanOrEqual(4.5);
      expect(BAND_CLASSES[b]).toContain(`bg-[${fill}]`);
      // why: the exact class for the exact colour, so a changed colour with a stale class cannot hide behind a white/black proxy
      expect(hasClass(BAND_CLASSES[b], textClass(text))).toBe(true);
    }
  });
  it('neighbouring lamps differ in lightness by a ratio of 1.3 or more, brightest (cheapest) to dimmest, and each clears 3:1 on the board', () => {
    for (const b of [0, 1, 2, 3] as const) {
      const next = BAND_COLOURS[quintileNext(b)].fill;
      expect(luminance(next)).toBeLessThan(luminance(BAND_COLOURS[b].fill));
      expect(contrast(BAND_COLOURS[b].fill, next)).toBeGreaterThanOrEqual(1.3);
    }
    // the overview's board (#0b0c0d) and an unlit socket (#2a2d30): a lamp is a graphic, so 3:1 and 2:1 (WCAG 1.4.11)
    for (const b of bands) {
      expect(contrast(BAND_COLOURS[b].fill, '#0b0c0d')).toBeGreaterThanOrEqual(3);
      expect(contrast(BAND_COLOURS[b].fill, '#2a2d30')).toBeGreaterThanOrEqual(2);
    }
  });
  it('the dimmest lamp is ringed and the flat shade is a band colour, so neither reads as priceless', () => {
    expect(BAND_CLASSES[4]).toContain('border');
    expect(FLAT_CLASS).toContain(`bg-[${BAND_COLOURS[3].fill}]`);
    // the flat shade's own text must read on its fill at 4.5:1, and its class must spell the band-3 text colour
    expect(hasClass(FLAT_CLASS, textClass(BAND_COLOURS[3].text))).toBe(true);
    expect(contrast(BAND_COLOURS[3].fill, BAND_COLOURS[3].text)).toBeGreaterThanOrEqual(4.5);
  });
});

function quintileNext(b: 0 | 1 | 2 | 3): Band {
  return b === 0 ? 1 : b === 1 ? 2 : b === 2 ? 3 : 4;
}

/** A date pair at index i with a figure (current unless marked). */
const fig = (i: number, f: ReturnType<typeof calendarFig>): DatePair => ({
  ...datePairOf({ departureDate: '2027-03-14', nights: 10, basis: null }),
  index: i,
  buckets: bucketsOf({ priced: 4 }),
  figure: f,
});

describe('the overview’s one scale (spec §11 Overview, revision 50)', () => {
  it('verified and calendar figures share one scale', () => {
    const pairs = Array.from({ length: 10 }, (_x, i) =>
      fig(i, i % 2 === 0 ? priced(30_000 + i * 1_000) : priced(30_000 + i * 1_000, { basis: 'verified' })),
    );
    const s = shadeScale(pairs);
    expect(s.mode).toBe('quintile');
    expect(s.count).toBe(10);
  });
  it('superseded and not-seen figures are not on the scale', () => {
    expect(isCurrent(calendarFig())).toBe(true);
    expect(isCurrent(calendarFig({ superseded: true }))).toBe(false);
    expect(isCurrent(verifiedFig({ notSeenInLatest: { ageHours: 'unknown' } }))).toBe(false);
    const pairs = [
      ...Array.from({ length: 10 }, (_x, i) => fig(i, priced(30_000 + i * 1_000))),
      fig(20, priced(10_000, { superseded: true })),
      fig(21, priced(99_000, { basis: 'verified', notSeenInLatest: { ageHours: 3 } })),
    ];
    const s = shadeScale(pairs);
    expect([s.count, s.minPence, s.maxPence]).toEqual([10, 30_000, 39_000]);
  });
  it('date pairs without a figure are not on it', () => {
    expect(shadeScale([{ ...fig(1, calendarFig()), figure: null }]).mode).toBe('empty');
  });
  it('fewer than ten figures, or a spread under 10% of the cheapest, gives the flat shade', () => {
    const nine = Array.from({ length: 9 }, (_x, i) => fig(i, priced(30_000 + i * 5_000)));
    expect(shadeScale(nine).mode).toBe('flat-few');
    const narrow = Array.from({ length: 10 }, (_x, i) => fig(i, priced(30_000 + i * 100)));
    expect(shadeScale(narrow).mode).toBe('flat-narrow');
    const one = nine[0] ?? fig(0, calendarFig());
    expect(cellModel([one], new Map([[0, 1]]), shadeScale(nine)).shade).toBe('flat');
  });
  it('property: every shaded cell’s price lies within its band’s printed range, and equal prices share a shade', () => {
    const rand = seeded(20261026);
    for (let run = 0; run < 100; run += 1) {
      const n = 10 + Math.floor(rand() * 40);
      const pairs = Array.from({ length: n }, (_x, i) =>
        fig(i, priced(30_000 + Math.floor(rand() * 8) * 2_500)),
      );
      const s = shadeScale(pairs);
      if (s.mode !== 'quintile') continue;
      const ranks = new Map(pairs.map((p, i) => [p.index, i + 1]));
      const byPrice = new Map<number, unknown>();
      for (const p of pairs) {
        const shade = cellModel([p], ranks, s).shade;
        const price = p.figure?.price.pricePence ?? 0;
        const entry = s.legend.find((e) => e.band === shade);
        expect(entry, `run ${run}`).toBeDefined();
        expect(price >= (entry?.minPence ?? Infinity) && price <= (entry?.maxPence ?? -1), `run ${run}`).toBe(
          true,
        );
        if (byPrice.has(price)) expect(byPrice.get(price), `run ${run}`).toBe(shade);
        byPrice.set(price, shade);
      }
    }
  });
});
