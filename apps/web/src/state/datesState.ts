import { apiContract, type Iata } from '@gmt/core';
import { int, nightsRange, uniqueIataList } from './parse.js';

/**
 * The Search page's URL parameters (spec §11 URLs and Filters): the one place their names live. The filters, the week
 * switch and the coverage section are in the URL and travel with every nav link (Task 19.7); how many rows a section
 * shows is component state, not a parameter (WP19 §5). The board's sort went with the board (design 2026-11-08
 * Ruling 21): an old `d.sort` is read as nothing.
 */
export const DATES_PARAMS = {
  nights: 'd.nights',
  from: 'd.from',
  to: 'd.to',
  journey: 'd.journey',
  week: 'd.week',
  coverage: 'd.coverage',
} as const;

export interface DatesUiState {
  /** The stay filter, applied in the browser to the decoded date pairs before ranking and shading. */
  nights: { min: number; max: number } | null;
  /** Origins and destinations in scope, subsets of the definition's; empty means all. Sent to the route. */
  from: Iata[];
  to: Iata[];
  /** The journey limit in minutes, sent to the route; null means none (Ruling 16: a removable chip, not a control). */
  journey: number | null;
  /** Revision 50 (Ian ruled 2026-10-26): the first-ranked date pair of each departure week. */
  bestPerWeek: boolean;
  coverageOpen: boolean;
}

/**
 * Strict parse against the definition: a malformed token is ignored, an airport outside the definition is dropped
 * (decision 53: a filter is a subset of the definition's airports) and a journey limit outside the route's bounds is
 * ignored rather than sent to be refused.
 */
export function parseDatesState(
  p: URLSearchParams,
  def: { origins: readonly Iata[]; destinations: readonly Iata[] },
): DatesUiState {
  const journey = int(p.get(DATES_PARAMS.journey));
  return {
    nights: nightsRange(p.get(DATES_PARAMS.nights)),
    from: uniqueIataList(p.get(DATES_PARAMS.from)).filter((c) => def.origins.includes(c)),
    to: uniqueIataList(p.get(DATES_PARAMS.to)).filter((c) => def.destinations.includes(c)),
    journey: journey !== undefined && journeyInBounds(journey) ? journey : null,
    bestPerWeek: p.get(DATES_PARAMS.week) === 'best',
    coverageOpen: p.get(DATES_PARAMS.coverage) === 'open',
  };
}

/** Spec §10: the journey limit the route accepts, whole minutes from 60 to 6000 (core's bounds). */
export function journeyInBounds(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= apiContract.MIN_JOURNEY_LIMIT_MINUTES &&
    minutes <= apiContract.MAX_JOURNEY_LIMIT_MINUTES
  );
}

const joined = (xs: readonly string[]): string | null => (xs.length > 0 ? xs.join(',') : null);

/** The URL patch for the keys given (null removes a parameter at its default); `parseDatesState` reads it back. */
export function datesPatch(s: Partial<DatesUiState>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (s.nights !== undefined)
    out[DATES_PARAMS.nights] = s.nights === null ? null : `${s.nights.min}-${s.nights.max}`;
  if (s.from !== undefined) out[DATES_PARAMS.from] = joined(s.from);
  if (s.to !== undefined) out[DATES_PARAMS.to] = joined(s.to);
  if (s.journey !== undefined) out[DATES_PARAMS.journey] = s.journey === null ? null : String(s.journey);
  if (s.bestPerWeek !== undefined) out[DATES_PARAMS.week] = s.bestPerWeek ? 'best' : null;
  if (s.coverageOpen !== undefined) out[DATES_PARAMS.coverage] = s.coverageOpen ? 'open' : null;
  return out;
}

/** "Clear filters" (the empty state's, spec §11): the stay range, the airports, the journey limit and the week switch. */
export const CLEARED_FILTERS = {
  nights: null,
  from: [],
  to: [],
  journey: null,
  bestPerWeek: false,
} as const satisfies Partial<DatesUiState>;

/** True when the operator set a filter (the coverage section is not one). */
export function filtersActive(s: DatesUiState): boolean {
  return s.nights !== null || s.from.length > 0 || s.to.length > 0 || s.journey !== null || s.bestPerWeek;
}

/** The route's query (spec §10): airports and the journey limit; sorted, so one scope is one query key. */
export function scopeQuery(s: DatesUiState): {
  origins: string | undefined;
  destinations: string | undefined;
  maxJourneyMinutes: string | undefined;
} {
  return {
    origins: joined([...s.from].sort()) ?? undefined,
    destinations: joined([...s.to].sort()) ?? undefined,
    maxJourneyMinutes: s.journey === null ? undefined : String(s.journey),
  };
}
