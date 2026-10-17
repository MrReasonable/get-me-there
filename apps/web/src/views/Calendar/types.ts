import type { Cell, Iata, IsoDate, ProviderId } from '@gmt/core';
import type { CalendarDay, PriceCellData } from '../../api/types.js';

/**
 * A price shown on a day, with the cell it came from (plan decisions 38, 52) and its decision-54 mark: a verified-basis
 * minimum carries `notSeenInLatest`, a calendar-basis one `superseded`.
 */
export type DayPrice = PriceCellData & {
  cell: Cell;
  notSeenInLatest?: { ageHours: number | 'unknown' } | null;
  superseded?: boolean;
};

/** What one day renders, for all destinations or for one (spec §11 View B, per-destination filter). */
export interface DaySlice {
  /** Discovery counts per provider, for the filtered destination when one is set (the api computes it, decision 53). */
  discovery: CalendarDay['discovery'];
  /**
   * The definition's discovery providers. Empty when it names none (spec §3, `not_applicable`); a configured provider
   * with no entry for the day is "not searched yet" for it (review prov-r2-009).
   */
  discoveryProviders: readonly ProviderId[];
  /** Null when the definition has no verification provider (spec §6.6 row 0: not applicable). */
  verification: CalendarDay['verification'] | null;
  /** Cells whose itinerary search priced but confirmed no price, under the destination filter (decisions 51, 53). */
  unconfirmedCells: number;
  cheapestVerified: DayPrice | null;
  cheapestPartiallyVerified: (DayPrice & { count: number }) | null;
  cheapestCalendar: DayPrice | null;
  /** The destination filter the day was fetched for, or null for all destinations; it only names the filter in words. */
  destination: Iata | null;
}

/** A day as the grid renders it. */
export interface GridDay {
  date: IsoDate;
  slice: DaySlice;
}

/** Statuses with their own glyph on a day without a price (spec §11 View B; `skipped` added by plan decision 38). */
export type GlyphStatus = 'empty' | 'no_data' | 'error' | 'skipped' | 'not_run';

/** Which kind of price a day shows, and which kind the colour scale uses. */
export type DayBasis = 'verified' | 'calendar';
