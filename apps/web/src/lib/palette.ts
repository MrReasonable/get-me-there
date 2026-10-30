/**
 * The categorical series palette for every chart (dataviz skill: one hue per series, never the only cue; dash styles
 * and labels back every colour). The departure board's own inks, as a station's painted signs use them: board black,
 * signal red, signage blue, ochre, signal green and violet, each at least 5:1 on the enamel plate the charts sit on
 * and on the white of a hollow (stale) dot (test/lib/palette.test.ts). Defined once; History imports it.
 */
export const SERIES_COLOURS = ['#111315', '#a3231a', '#1f5f8b', '#8a5a00', '#3f6b2a', '#6b3f8f'] as const;

/** The plate the charts are drawn on (world.css `--enamel`), for the palette's contrast test. */
export const CHART_GROUND = '#eef0ed';

/** Colour of the i-th series, cycling. */
export function seriesColour(i: number): string {
  return SERIES_COLOURS[i % SERIES_COLOURS.length] ?? SERIES_COLOURS[0];
}
