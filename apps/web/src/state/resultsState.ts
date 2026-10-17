import { apiContract, type ResultFilters, type SortKey } from '@gmt/core';
import type { Basis } from '../api/types.js';
import { oneOf, withKey } from './withKey.js';

/** sortRows's direction parameter (plan "Core domain functions": `dir: 'asc' | 'desc'`). */
export type SortDir = 'asc' | 'desc';

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

const list = (v: string | null): string[] => (v ? v.split(',').filter((s) => s.length > 0) : []);
const int = (v: string | null): number | undefined => (v !== null && /^\d+$/.test(v) ? Number(v) : undefined);
const CARRIER = /^[A-Z0-9]{2}$/;

/** Returns the filters with `key` set, or removed when `value` is undefined. */
export function setFilter<K extends keyof ResultFilters>(
  f: ResultFilters,
  key: K,
  value: ResultFilters[K] | undefined,
): ResultFilters {
  return withKey(f, key, value);
}

export function parseBasis(v: string | null): Basis | null {
  return v === 'verified' || v === 'calendar' ? v : null;
}

/** `row=<resultRowKey>` (plan "Web"): the row an email link points at; bounded so a pasted URL cannot be huge. */
export function parseSelectedRow(p: URLSearchParams): string | null {
  const v = p.get('row');
  return v !== null && v.length > 0 && v.length <= 200 ? v : null;
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
  const rawSort = p.get('sort');
  let sort: ResultsUiState['sort'] = null;
  if (rawSort !== null) {
    const [k, d] = rawSort.split('.');
    if (k !== undefined && isSortKey(k) && (d === 'asc' || d === 'desc')) sort = { key: k, dir: d };
  }
  let f: ResultFilters = {};
  const classes = list(p.get('f.class')).filter(isClass);
  if (classes.length > 0) f = setFilter(f, 'verdictClass', classes);
  const providers = list(p.get('f.provider')).filter(isProvider);
  if (providers.length > 0) f = setFilter(f, 'providerId', providers);
  f = setFilter(f, 'maxStops', int(p.get('f.stops')));
  const carriers = list(p.get('f.carriers')).filter((c) => CARRIER.test(c));
  if (carriers.length > 0) f = setFilter(f, 'carriers', carriers);
  // why: the URL is operator-editable; only codes core's iataSchema accepts become the Iata the filter takes.
  const dests = list(p.get('f.dest')).flatMap((c) => {
    const r = apiContract.cellKeySchema.shape.destination.safeParse(c);
    return r.success && c === r.data ? [r.data] : [];
  });
  if (dests.length > 0) f = setFilter(f, 'destination', dests);
  f = setFilter(f, 'maxPricePence', int(p.get('f.maxPrice')));
  const nights = /^(\d+)-(\d+)$/.exec(p.get('f.nights') ?? '');
  if (nights?.[1] !== undefined && nights[2] !== undefined && Number(nights[1]) <= Number(nights[2])) {
    f = setFilter(f, 'nights', { min: Number(nights[1]), max: Number(nights[2]) });
  }
  const [from, to] = (p.get('f.depart') ?? '').split('..');
  const dateOf = apiContract.cellKeySchema.shape.departureDate;
  const fromDate = dateOf.safeParse(from);
  const toDate = dateOf.safeParse(to);
  if (fromDate.success && toDate.success && fromDate.data <= toDate.data) {
    f = setFilter(f, 'departure', { from: fromDate.data, to: toDate.data });
  }
  if (p.get('f.stale') === 'hide') f = setFilter(f, 'hideStale', true);
  const unverified = list(p.get('f.unverified')).filter(isConstraint);
  if (unverified.length > 0) f = setFilter(f, 'unverified', unverified);
  return { sort, filters: f };
}

const joined = (xs: readonly string[] | undefined): string | null =>
  xs && xs.length > 0 ? xs.join(',') : null;
const num = (n: number | undefined): string | null => (n === undefined ? null : String(n));

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
    'f.nights': f.nights === undefined ? null : `${f.nights.min}-${f.nights.max}`,
    'f.depart': f.departure === undefined ? null : `${f.departure.from}..${f.departure.to}`,
    'f.stale': f.hideStale === true ? 'hide' : null,
    'f.unverified': joined(f.unverified),
  };
}
