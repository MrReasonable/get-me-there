import {
  apiContract,
  type DatePair,
  DETAIL_LINK_PARAMS,
  type Iata,
  type IsoDate,
  type ResultBasis,
} from '@gmt/core';
import { oneOf } from './oneOf.js';
import { int, nightsRange, type SortDir, sortToken, uniqueIataList } from './parse.js';
import { hrefWith } from './urlState.js';

/**
 * The Dates view's URL parameters (spec §11 URLs and Filters): the one place their names live. The filters, the sort,
 * the week switch and the coverage section are in the URL and travel with every nav link (Task 19.7); how many board
 * rows are shown is component state, not a parameter (WP19 §5).
 */
export const DATES_PARAMS = {
  nights: 'd.nights',
  from: 'd.from',
  to: 'd.to',
  journey: 'd.journey',
  sort: 'd.sort',
  week: 'd.week',
  coverage: 'd.coverage',
} as const;

export type DatesSortKey = 'price' | 'departure' | 'nights' | 'journey';
export const DATES_SORT_KEYS: readonly DatesSortKey[] = ['price', 'departure', 'nights', 'journey'];
const isDatesSortKey = oneOf(DATES_SORT_KEYS);

export interface DatesUiState {
  /** The stay filter, applied in the browser to the decoded date pairs before ranking and shading. */
  nights: { min: number; max: number } | null;
  /** Origins and destinations in scope, subsets of the definition's; empty means all. Sent to the route. */
  from: Iata[];
  to: Iata[];
  /** The journey limit in minutes, sent to the route; null means none. */
  journey: number | null;
  sort: { key: DatesSortKey; dir: SortDir };
  /** Revision 50 (Ian ruled 2026-10-26): the first-ranked date pair of each departure week. */
  bestPerWeek: boolean;
  coverageOpen: boolean;
}

/** The board's default order: the price rank (spec §11 Board). */
export const DEFAULT_DATES_SORT: DatesUiState['sort'] = { key: 'price', dir: 'asc' };

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
    sort: sortToken(p.get(DATES_PARAMS.sort), isDatesSortKey) ?? DEFAULT_DATES_SORT,
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
const isDefaultSort = (s: DatesUiState['sort']) =>
  s.key === DEFAULT_DATES_SORT.key && s.dir === DEFAULT_DATES_SORT.dir;

/** The URL patch for the keys given (null removes a parameter at its default); `parseDatesState` reads it back. */
export function datesPatch(s: Partial<DatesUiState>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (s.nights !== undefined)
    out[DATES_PARAMS.nights] = s.nights === null ? null : `${s.nights.min}-${s.nights.max}`;
  if (s.from !== undefined) out[DATES_PARAMS.from] = joined(s.from);
  if (s.to !== undefined) out[DATES_PARAMS.to] = joined(s.to);
  if (s.journey !== undefined) out[DATES_PARAMS.journey] = s.journey === null ? null : String(s.journey);
  if (s.sort !== undefined)
    out[DATES_PARAMS.sort] = isDefaultSort(s.sort) ? null : `${s.sort.key}.${s.sort.dir}`;
  if (s.bestPerWeek !== undefined) out[DATES_PARAMS.week] = s.bestPerWeek ? 'best' : null;
  if (s.coverageOpen !== undefined) out[DATES_PARAMS.coverage] = s.coverageOpen ? 'open' : null;
  return out;
}

/** "Clear filters" (spec §11): the stay range, the airports, the journey limit and the week switch; the sort stays. */
export const CLEARED_FILTERS = {
  nights: null,
  from: [],
  to: [],
  journey: null,
  bestPerWeek: false,
} as const satisfies Partial<DatesUiState>;

/** True when the operator set a filter (the sort and the coverage section are not filters). */
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

/**
 * The patch that opens a date pair's detail (spec §11 Board, §8.3): the date pair and the basis to open on, names from
 * core's one constant; `row` dropped (it named a row of another date pair). Applied with `hrefWith`, so `def` and every
 * d.* parameter are kept. A null basis leaves the detail to §6.9's default.
 */
export function detailPatchOf(
  dates: { departureDate: IsoDate; returnDate: IsoDate },
  basis: ResultBasis | null,
): Record<string, string | null> {
  return {
    [DETAIL_LINK_PARAMS.view]: 'results',
    [DETAIL_LINK_PARAMS.depart]: dates.departureDate,
    [DETAIL_LINK_PARAMS.return]: dates.returnDate,
    [DETAIL_LINK_PARAMS.basis]: basis,
    [DETAIL_LINK_PARAMS.row]: null,
  };
}

/** A date pair's detail patch, opening on its figure's basis (WP19 §5). */
export function detailPatch(pair: DatePair): Record<string, string | null> {
  return detailPatchOf(pair, pair.figure?.basis ?? null);
}

/** The detail's href from the current URL (WP19 §5). */
export function detailHref(pair: DatePair): string {
  return hrefWith(detailPatch(pair));
}
