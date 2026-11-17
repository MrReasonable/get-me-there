import type { DatePairFigure } from '@gmt/core';

// The calendar's heat scale (Ruling 18; WP19 §4: the Calendar view's scale.ts, moved). The ramp's colours are the
// theme's tokens (styles/theme.css `--t-heat-1…5`), so this module decides only which step a price takes.
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

export interface QuintileScale {
  mode: ScaleMode;
  count: number;
  minPence: number | null;
  maxPence: number | null;
  /** The band of a price on the scale, or null on a flat scale. */
  band(v: number): Band | null;
}

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

/** The scale over the given prices and its mode. */
export function buildScale(values: readonly number[]): QuintileScale {
  const sorted = [...values].sort((a, b) => a - b);
  const mode = modeOf(sorted);
  return {
    mode,
    count: sorted.length,
    minPence: sorted[0] ?? null,
    maxPence: sorted[sorted.length - 1] ?? null,
    band: (v) => (mode === 'quintile' ? quintileBand(sorted, v) : null),
  };
}

/**
 * A figure on the scale: one a later search did not overturn. A superseded or not-seen price is never printed on a day
 * (Ruling 18), so every step of the ramp holds current prices only.
 */
export function isCurrent(f: Pick<DatePairFigure, 'superseded' | 'notSeenInLatest'>): boolean {
  return !f.superseded && f.notSeenInLatest === null;
}
