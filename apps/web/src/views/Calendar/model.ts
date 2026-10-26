import type { IsoDate, IsoDateTime } from '@gmt/core';
import { type Band, buildScale, type QuintileScale } from '../Dates/shade.js';
import { type DayDisplay, resolveDayDisplay } from './display.js';
import type { DayBasis, GridDay } from './types.js';

/** Per-day displays, the one-basis colour scale and the counts the header and legend need (spec §11 View B). */
export interface CalendarModel {
  colourBasis: DayBasis;
  displays: ReadonlyMap<IsoDate, DayDisplay>;
  /** Quintile band per day on the scale; empty when the scale is flat. */
  bands: ReadonlyMap<IsoDate, Band>;
  /** Days on a flat scale (plan decision 38: too few days or too narrow a spread for bands). */
  flatDays: ReadonlySet<IsoDate>;
  scale: QuintileScale;
  hatchedDays: number;
  /** Days showing a price, and how many of those prices are stale (the header's "N of M stale" line). */
  shownPrices: number;
  stalePrices: number;
}

/** Resolves every day, scales the days whose shown price is of `colourBasis`, and counts the hatched rest. */
export function buildCalendarModel(
  days: readonly GridDay[],
  colourBasis: DayBasis,
  now: IsoDateTime,
): CalendarModel {
  const displays = new Map<IsoDate, DayDisplay>();
  for (const d of days) displays.set(d.date, resolveDayDisplay(d.slice, now));
  const onBasis: Array<{ date: IsoDate; pence: number }> = [];
  let hatchedDays = 0;
  let shownPrices = 0;
  let stalePrices = 0;
  for (const [date, disp] of displays) {
    if (disp.kind !== 'price') continue;
    shownPrices += 1;
    if (disp.stale) stalePrices += 1;
    if (disp.basis === colourBasis) onBasis.push({ date, pence: disp.price.pricePence });
    else hatchedDays += 1; // why: spec §11 — days showing the other basis are hatched and excluded from the scale
  }
  const scale = buildScale(onBasis.map((x) => x.pence));
  const bands = new Map<IsoDate, Band>();
  const flatDays = new Set<IsoDate>();
  for (const x of onBasis) {
    const b = scale.band(x.pence);
    if (b === null) flatDays.add(x.date);
    else bands.set(x.date, b);
  }
  return { colourBasis, displays, bands, flatDays, scale, hatchedDays, shownPrices, stalePrices };
}
