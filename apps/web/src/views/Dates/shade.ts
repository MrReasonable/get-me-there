import type { DatePair, DatePairFigure } from '@gmt/core';

// The overview's shading (WP19 §4: the Calendar view's scale.ts, moved, with the superseded and not-seen rule added).
/** A quintile band; 0 is the cheapest fifth (spec §11 View B). */
export type Band = 0 | 1 | 2 | 3 | 4;
const BANDS = [0, 1, 2, 3, 4] as const satisfies readonly Band[];

/** Plan decision 38: fewer than this many days on the scale is too few for quintiles. */
export const MIN_BANDED_DAYS = 10;

/**
 * How the scale colours its days. `flat-few` and `flat-narrow` give every day one shade (plan decision 38: fewer than
 * ten days, or a spread under 10% of the cheapest price) so the colour never implies a spread the data lacks.
 */
export type ScaleMode = 'quintile' | 'flat-few' | 'flat-narrow' | 'empty';

/** One numeric legend row: the pence range and the number of days in a band. */
export interface LegendEntry {
  band: Band;
  minPence: number;
  maxPence: number;
  count: number;
}

export interface QuintileScale {
  mode: ScaleMode;
  count: number;
  minPence: number | null;
  maxPence: number | null;
  /** The band of a price on the scale, or null on a flat scale. */
  band(v: number): Band | null;
  legend: LegendEntry[];
}

/** A band's fill and text colour, as hex so the contrast test can check them (review ui-r2-005). */
export interface BandColour {
  fill: string;
  text: string;
}

/**
 * Sequential single-hue fills (dataviz skill), every one with text at WCAG AA 4.5:1 or better and neighbours spread
 * far enough in lightness to tell apart (scale.test.ts checks both). The lightest band stays tinted and bordered, so
 * "dearest" never reads as a priceless day (slate-100 with text); the band number is printed on the face as well.
 */
export const BAND_COLOURS: Readonly<Record<Band, BandColour>> = {
  0: { fill: '#134e4a', text: '#ffffff' },
  1: { fill: '#0f766e', text: '#ffffff' },
  2: { fill: '#14b8a6', text: '#000000' },
  3: { fill: '#5eead4', text: '#000000' },
  4: { fill: '#ccfbf1', text: '#000000' },
};
// why: Tailwind generates only class names it finds written out, so each arbitrary value is spelled in full here.
export const BAND_CLASSES: Readonly<Record<Band, string>> = {
  0: 'bg-[#134e4a] text-white',
  1: 'bg-[#0f766e] text-white',
  2: 'bg-[#14b8a6] text-black',
  3: 'bg-[#5eead4] text-black',
  4: 'border border-[#0f766e] bg-[#ccfbf1] text-black',
};
/** The one shade of a flat scale. */
export const FLAT_CLASS = 'bg-[#5eead4] text-black';
/** A day with no price: neutral, never a band colour; it always carries text saying why. */
export const PRICELESS_CLASS = 'border border-slate-300 bg-slate-100 text-black';

/** Band of v within `sorted` (ascending): floor(r × 5 / n), r = count of values strictly below v. */
export function quintileBand(sorted: readonly number[], v: number): Band {
  if (sorted.length === 0) throw new RangeError('quintileBand: empty scale');
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const x = sorted[mid];
    if (x !== undefined && x < v) lo = mid + 1;
    else hi = mid;
  }
  // why: an index into an `as const` tuple, never a cast to Band.
  return BANDS[Math.min(4, Math.floor((lo * 5) / sorted.length))] ?? 4;
}

function modeOf(sorted: readonly number[]): ScaleMode {
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined) return 'empty';
  if (sorted.length < MIN_BANDED_DAYS) return 'flat-few';
  // why: integer arithmetic for "spread under 10% of the cheapest" (money never in a float).
  return (max - min) * 10 < min ? 'flat-narrow' : 'quintile';
}

/** The scale over the shown days of one basis, its mode and its numeric legend. */
export function buildScale(values: readonly number[]): QuintileScale {
  const sorted = [...values].sort((a, b) => a - b);
  const mode = modeOf(sorted);
  const legend: LegendEntry[] = [];
  if (mode === 'quintile') {
    for (const v of sorted) {
      const b = quintileBand(sorted, v);
      const last = legend[legend.length - 1];
      // why: bands never decrease as price rises, so consecutive equal bands merge into one legend row.
      if (last !== undefined && last.band === b) {
        last.maxPence = v;
        last.count += 1;
      } else legend.push({ band: b, minPence: v, maxPence: v, count: 1 });
    }
  }
  return {
    mode,
    count: sorted.length,
    minPence: sorted[0] ?? null,
    maxPence: sorted[sorted.length - 1] ?? null,
    band: (v) => (mode === 'quintile' ? quintileBand(sorted, v) : null),
    legend,
  };
}

// --- The Dates overview's scale (spec §11 Overview; revision 50, Ian confirmed) ---

/**
 * A figure on the scale: one a later search did not overturn. Superseded and not-seen figures are drawn with their
 * mark on a neutral fill and counted in the legend, never shaded, so every printed band range holds every price
 * shaded in it.
 */
export function isCurrent(f: Pick<DatePairFigure, 'superseded' | 'notSeenInLatest'>): boolean {
  return !f.superseded && f.notSeenInLatest === null;
}

/**
 * The overview's one scale: the current verified and calendar figures of the date pairs in view together, by rank
 * quintile (ties in one band), flat under ten figures or a spread under 10% of the cheapest (decision 38). The stay
 * filter applies first (the caller passes the date pairs in view).
 */
export function shadeScale(pairs: readonly DatePair[]): QuintileScale {
  const values: number[] = [];
  for (const p of pairs) if (p.figure !== null && isCurrent(p.figure)) values.push(p.figure.price.pricePence);
  return buildScale(values);
}
