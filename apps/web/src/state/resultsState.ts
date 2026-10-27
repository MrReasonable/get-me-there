import { apiContract, DETAIL_LINK_PARAMS, type IsoDate, type ResultFilters, type SortKey } from '@gmt/core';
import type { Basis, ResultsScope } from '../api/types.js';
import { type DatesUiState, datesPatch, scopeQuery } from './datesState.js';
import { oneOf } from './oneOf.js';
import { int, list, nightsRange, type SortDir, sortToken, uniqueIataList } from './parse.js';
import { withKey } from './withKey.js';

/** sortRows's direction parameter (plan "Core domain functions": `dir: 'asc' | 'desc'`). */
export type { SortDir };

/** View A state held in the URL (spec §11). `sort: null` keeps the server's class-then-price order. */
export interface ResultsUiState {
  sort: { key: SortKey; dir: SortDir } | null;
  filters: ResultFilters;
}

type ClassFilter = NonNullable<ResultFilters['verdictClass']>[number];

/** Spec §6.5 sort keys, in the column order of spec §11. */
export const SORT_KEYS: readonly SortKey[] = [
  'price',
  'totalTime',
  'departure',
  'return',
  'nights',
  'stops',
  'adjusted',
];
/** Every verdict class a row can carry, from the contract (calendar rows are `unchecked`). */
export const CLASSES: readonly ClassFilter[] = [...apiContract.verdictClassSchema.options, 'unchecked'];
/** Spec §6.9: `failed` is excluded by default and included by filter (core's filterRows default). */
export const DEFAULT_CLASSES: readonly ClassFilter[] = CLASSES.filter((c) => c !== 'failed');

const isSortKey = oneOf(SORT_KEYS);
const isClass = oneOf(CLASSES);
const isProvider = oneOf(apiContract.providerIdSchema.options);
const isConstraint = oneOf(apiContract.constraintNameSchema.options);

const CARRIER = /^[A-Z0-9]{2}$/;

/** The URL parameter that carries the results basis; the status bar, Results and History all read it through this. */
export const BASIS_PARAM = 'basis';

export function parseBasis(v: string | null): Basis | null {
  return v === 'verified' || v === 'calendar' ? v : null;
}

/** `row=<resultRowKey>` (plan "Web"): the row an email link points at; bounded so a pasted URL cannot be huge. */
export function parseSelectedRow(p: URLSearchParams): string | null {
  const v = p.get('row');
  return v !== null && v.length > 0 && v.length <= 200 ? v : null;
}

/** The verdict classes a state shows: its own list, else the spec §6.9 default (failed rows excluded). */
export function effectiveClasses(f: ResultFilters): readonly ClassFilter[] {
  return f.verdictClass ?? DEFAULT_CLASSES;
}

/** Number of filter keys the operator set (the class default does not count). */
export function activeFilterCount(f: ResultFilters): number {
  return Object.keys(f).length;
}

/**
 * Strict parse: malformed tokens are dropped, never coerced. Codes and dates go through core's
 * schemas, which also give the branded types the filter takes (no casts).
 */
export function parseResultsState(p: URLSearchParams): ResultsUiState {
  const sort: ResultsUiState['sort'] = sortToken(p.get('sort'), isSortKey);
  let f: ResultFilters = {};
  const classes = list(p.get('f.class')).filter(isClass);
  if (classes.length > 0) f = withKey(f, 'verdictClass', classes);
  const providers = list(p.get('f.provider')).filter(isProvider);
  if (providers.length > 0) f = withKey(f, 'providerId', providers);
  f = withKey(f, 'maxStops', int(p.get('f.stops')));
  const carriers = list(p.get('f.carriers')).filter((c) => CARRIER.test(c));
  if (carriers.length > 0) f = withKey(f, 'carriers', carriers);
  // why: the URL is operator-editable; only codes core's iataSchema accepts become the Iata the filter takes.
  const dests = uniqueIataList(p.get('f.dest'));
  if (dests.length > 0) f = withKey(f, 'destination', dests);
  f = withKey(f, 'maxPricePence', int(p.get('f.maxPrice')));
  const nights = nightsRange(p.get('f.nights'));
  if (nights !== null) f = withKey(f, 'nights', nights);
  // why: exactly two dates; a third `..` segment makes the range malformed (CodeRabbit batch 3)
  const range = (p.get('f.depart') ?? '').split('..');
  const [from, to] = range;
  const dateOf = apiContract.cellKeySchema.shape.departureDate;
  const fromDate = dateOf.safeParse(from);
  const toDate = dateOf.safeParse(to);
  if (range.length === 2 && fromDate.success && toDate.success && fromDate.data <= toDate.data) {
    f = withKey(f, 'departure', { from: fromDate.data, to: toDate.data });
  }
  if (p.get('f.stale') === 'hide') f = withKey(f, 'hideStale', true);
  const unverified = list(p.get('f.unverified')).filter(isConstraint);
  if (unverified.length > 0) f = withKey(f, 'unverified', unverified);
  return { sort, filters: f };
}

const joined = (xs: readonly string[] | undefined): string | null =>
  xs && xs.length > 0 ? xs.join(',') : null;
const num = (n: number | undefined): string | null => (n === undefined ? null : String(n));

/** The one place the nights filter's URL key and encoding live; Duration links to Results through it. */
export function nightsFilterPatch(min: number, max: number): Record<string, string> {
  return { 'f.nights': `${min}-${max}` };
}

/** The URL patch for a state; null removes the parameter. */
export function resultsStatePatch(s: ResultsUiState): Record<string, string | null> {
  const f = s.filters;
  return {
    sort: s.sort === null ? null : `${s.sort.key}.${s.sort.dir}`,
    'f.class': joined(f.verdictClass),
    'f.provider': joined(f.providerId),
    'f.stops': num(f.maxStops),
    'f.carriers': joined(f.carriers),
    'f.dest': joined(f.destination),
    'f.maxPrice': num(f.maxPricePence),
    ...(f.nights === undefined ? { 'f.nights': null } : nightsFilterPatch(f.nights.min, f.nights.max)),
    'f.depart': f.departure === undefined ? null : `${f.departure.from}..${f.departure.to}`,
    'f.stale': f.hideStale === true ? 'hide' : null,
    'f.unverified': joined(f.unverified),
  };
}

// --- WP19 Task 19.6: the date pair detail (spec §11 Date pair detail, URLs) ---

/** The date pair a detail URL names. */
export interface DetailPair {
  departureDate: IsoDate;
  returnDate: IsoDate;
}

/**
 * `depart=` and `return=` as two well-formed `YYYY-MM-DD` dates with the return on or after the departure, else null.
 * Format only (spec §11 URLs; WP19 Task 19.7): whether the date pair is inside the current resolved space is the
 * server's answer (`/results`' 422 `date_pair_outside_space`), never the browser's, which has no clock to judge it by.
 */
export function parseDetailPair(p: URLSearchParams): DetailPair | null {
  const dateOf = apiContract.cellKeySchema.shape.departureDate;
  const dep = dateOf.safeParse(p.get(DETAIL_LINK_PARAMS.depart));
  const ret = dateOf.safeParse(p.get(DETAIL_LINK_PARAMS.return));
  return dep.success && ret.success && dep.data <= ret.data
    ? { departureDate: dep.data, returnDate: ret.data }
    : null;
}

/**
 * Results' filters inside the detail (spec §11): the stay, departure and destination filters are fixed by the date pair
 * and the Dates airport filter, so a stale `f.nights`, `f.depart` or `f.dest` in the URL is ignored rather than
 * emptying a detail opened from the board; class, provider, stops, carriers, maximum price, unverified constraint and
 * stale stay.
 */
export function detailState(s: ResultsUiState): ResultsUiState {
  let f = withKey(s.filters, 'nights', undefined);
  f = withKey(f, 'departure', undefined);
  f = withKey(f, 'destination', undefined);
  return { sort: s.sort, filters: f };
}

/** `/results`' scope for the detail (spec §10): the date pair, and the Dates airport filter and journey limit. */
export function detailScope(dates: DatesUiState, pair: DetailPair): ResultsScope {
  return { ...scopeQuery(dates), departureDate: pair.departureDate, returnDate: pair.returnDate };
}

/**
 * "Back to dates" (spec §11): the Dates view with every `d.*` parameter kept (hrefWith keeps every parameter the patch
 * does not name) and the detail's own parameters removed, names from core's one constant.
 */
export const BACK_TO_DATES: Readonly<Record<string, string | null>> = {
  [DETAIL_LINK_PARAMS.view]: 'dates',
  [DETAIL_LINK_PARAMS.depart]: null,
  [DETAIL_LINK_PARAMS.return]: null,
  [DETAIL_LINK_PARAMS.basis]: null,
  [DETAIL_LINK_PARAMS.row]: null,
};

/** The Dates view's coverage section, opened (spec §11: the detail's coverage line and empty state link to it). */
export const DATES_COVERAGE: Readonly<Record<string, string | null>> = {
  ...BACK_TO_DATES,
  ...datesPatch({ coverageOpen: true }),
};
