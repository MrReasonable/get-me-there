/**
 * The categorical series palette for every WP10 chart (dataviz skill: one hue per series, never the only cue; dash
 * styles and labels back every colour). Defined once; Duration and History import it.
 */
export const SERIES_COLOURS = ['#1d4ed8', '#c2410c', '#7c3aed', '#047857', '#be185d', '#4d7c0f'] as const;

/** Colour of the i-th series, cycling. */
export function seriesColour(i: number): string {
  return SERIES_COLOURS[i % SERIES_COLOURS.length] ?? SERIES_COLOURS[0];
}
