import { apiContract, type ResultFilters, type SortKey } from '@gmt/core';
import type { Basis } from '../api/types.js';
import { oneOf } from './oneOf.js';
import { withKey } from './withKey.js';

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
// why: a limit the URL spells beyond 2^53 would round (or become Infinity) and silently be a different limit; such a
// token is malformed like any other and is dropped.
const safeInt = (v: string): number | undefined => {
  const n = Number(v);
  return /^\d+$/.test(v) && Number.isSafeInteger(n) ? n : undefined;
};
const int = (v: string | null): number | undefined => (v === null ? undefined : safeInt(v));
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
  const rawSort = p.get('sort');
  let sort: ResultsUiState['sort'] = null;
  if (rawSort !== null) {
    // why: exactly two segments; `price.asc.extra` is malformed, never trimmed to `price.asc` (CodeRabbit batch 3)
    const parts = rawSort.split('.');
    const [k, d] = parts;
    if (parts.length === 2 && k !== undefined && isSortKey(k) && (d === 'asc' || d === 'desc'))
      sort = { key: k, dir: d };
  }
  let f: ResultFilters = {};
  const classes = list(p.get('f.class')).filter(isClass);
  if (classes.length > 0) f = withKey(f, 'verdictClass', classes);
  const providers = list(p.get('f.provider')).filter(isProvider);
  if (providers.length > 0) f = withKey(f, 'providerId', providers);
  f = withKey(f, 'maxStops', int(p.get('f.stops')));
  const carriers = list(p.get('f.carriers')).filter((c) => CARRIER.test(c));
  if (carriers.length > 0) f = withKey(f, 'carriers', carriers);
  // why: the URL is operator-editable; only codes core's iataSchema accepts become the Iata the filter takes.
  const dests = list(p.get('f.dest')).flatMap((c) => {
    const r = apiContract.cellKeySchema.shape.destination.safeParse(c);
    return r.success && c === r.data ? [r.data] : [];
  });
  if (dests.length > 0) f = withKey(f, 'destination', dests);
  f = withKey(f, 'maxPricePence', int(p.get('f.maxPrice')));
  const nights = /^(\d+)-(\d+)$/.exec(p.get('f.nights') ?? '');
  const nightsMin = nights?.[1] === undefined ? undefined : safeInt(nights[1]);
  const nightsMax = nights?.[2] === undefined ? undefined : safeInt(nights[2]);
  if (nightsMin !== undefined && nightsMax !== undefined && nightsMin <= nightsMax) {
    f = withKey(f, 'nights', { min: nightsMin, max: nightsMax });
  }
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
