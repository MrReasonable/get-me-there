import type { Iata } from '@gmt/core';
import type { DayBasis } from '../views/Calendar/types.js';

// The Calendar view's URL state, beside WP9's other state parsers (review arch M3). `parseColourBasis` is named apart
// from resultsState's `parseBasis`, which parses a different type (the results basis).

/** URL keys of the view's state (ui-r1-016: filters survive navigation and links, like WP9's Results state). */
export const CALENDAR_PARAMS = { destination: 'cal.dest', basis: 'cal.basis', month: 'cal.month' } as const;

/** The destination filter from the URL: one of the definition's destinations, else all. */
export function parseDestination(raw: string | null, destinations: readonly Iata[]): Iata | 'all' {
  return destinations.find((d) => d === raw) ?? 'all';
}

/** The operator's chosen colour basis from the URL, or null for the default. */
export function parseColourBasis(raw: string | null): DayBasis | null {
  return raw === 'verified' || raw === 'calendar' ? raw : null;
}
