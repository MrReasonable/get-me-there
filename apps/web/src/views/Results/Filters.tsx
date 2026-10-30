import { apiContract, type ResultFilters } from '@gmt/core';
import type { FormEvent } from 'react';
import type { ResultRow } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { parsePoundsToPence, penceToPoundsInput, poundsText } from '../../format.js';
import { useSynced } from '../../hooks/useSynced.js';
import { carriersText, parseCarriers } from '../../state/carriers.js';
import {
  activeFilterCount,
  CLASSES,
  effectiveClasses,
  type ResultsUiState,
  resultsStatePatch,
} from '../../state/resultsState.js';
import { updateSearchParams } from '../../state/urlState.js';
import { withKey } from '../../state/withKey.js';

function toggle<T extends string>(list: readonly T[], v: T): T[] | undefined {
  const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  return next.length > 0 ? next : undefined;
}

const unique = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];
// why: a typed whole number beyond 2^53 would round into a different limit, so it is invalid like any other bad text.
const intOrUndefined = (s: string): number | undefined => {
  const n = Number(s.trim());
  return /^\d+$/.test(s.trim()) && Number.isSafeInteger(n) ? n : undefined;
};

const field = 'input min-h-11';

export interface FiltersProps {
  state: ResultsUiState;
  rows: readonly ResultRow[];
  calendarBasis: boolean;
  /** Collapsed by default on a narrow screen so the table stays above the fold (review UI-7). */
  narrow: boolean;
}

/**
 * Spec §6.5 filters, all client-side; state lives in the URL so it persists across views. Checkboxes and selects apply
 * on change; typed boxes apply on Enter, on Apply and on leaving the box. Inside the date pair detail (spec §11, WP19
 * Task 19.6) the stay, departure and destination filters are gone: the date pair and the Dates airport filter fix them.
 */
export function Filters({ state, rows, calendarBasis, narrow }: FiltersProps) {
  const f = state.filters;
  const apply = (next: ResultFilters) => updateSearchParams(resultsStatePatch({ ...state, filters: next }));
  const [carriers, setCarriers] = useSynced((f.carriers ?? []).join(','), carriersText);
  const [maxPrice, setMaxPrice] = useSynced(penceToPoundsInput(f.maxPricePence), poundsText);
  // why: a value the URL filters on stays in its list even when no shown row has it, so it can still be seen and unticked.
  const providers = unique([...rows.map((r) => r.provenance.providerId), ...(f.providerId ?? [])]);
  const constraints = apiContract.constraintNameSchema.options.filter(
    (c) => rows.some((r) => r.unverified.includes(c)) || (f.unverified?.includes(c) ?? false),
  );
  const classes = effectiveClasses(f);
  const ignored = parseCarriers(carriers).ignored;

  /** Applies every typed box at once. */
  const typed = (base: ResultFilters): ResultFilters => {
    const codes = parseCarriers(carriers).codes;
    const next = withKey(base, 'carriers', codes.length > 0 ? codes : undefined);
    return withKey(next, 'maxPricePence', parsePoundsToPence(maxPrice));
  };
  // why: typed text that does not parse is flagged, not silently ignored (UI-8).
  const priceInvalid = maxPrice.trim() !== '' && parsePoundsToPence(maxPrice) === undefined;
  // why: while a typed box is invalid nothing typed is applied, so an active filter is never dropped by bad text (UI-8).
  const applyTyped = () => {
    if (!priceInvalid) apply(typed(f));
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    applyTyped();
  };

  return (
    <details open={!narrow} className="fold text-sm">
      <summary className="min-h-11 cursor-pointer">{COPY.filtersSummary(activeFilterCount(f))}</summary>
      <form
        aria-label={COPY.filtersHeading}
        onSubmit={onSubmit}
        className="flex flex-wrap items-start gap-x-5 gap-y-3 pt-2"
      >
        <fieldset className="flex flex-wrap gap-2">
          <legend className="label-caps mb-1">{COPY.filterClass}</legend>
          {CLASSES.map((c) => (
            <label key={c} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={classes.includes(c)}
                onChange={() => apply(withKey(f, 'verdictClass', toggle(classes, c)))}
              />
              {COPY.classLabel[c]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="label-caps mb-1">{COPY.filterProvider}</legend>
          {providers.map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={f.providerId?.includes(p) ?? false}
                onChange={() => apply(withKey(f, 'providerId', toggle(f.providerId ?? [], p)))}
              />
              {COPY.provider[p]}
            </label>
          ))}
        </fieldset>
        <span className="flex flex-col gap-1">
          <label className="field-label" htmlFor="filter-max-stops">
            {COPY.filterMaxStops}
          </label>
          <select
            id="filter-max-stops"
            className={field}
            disabled={calendarBasis}
            value={f.maxStops === undefined ? '' : String(f.maxStops)}
            onChange={(e) => apply(withKey(f, 'maxStops', intOrUndefined(e.target.value)))}
          >
            <option value="">{COPY.any}</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </span>
        <span className="flex flex-col gap-1">
          <label className="field-label" htmlFor="filter-carriers">
            {COPY.filterCarriers}
          </label>
          <input
            id="filter-carriers"
            className={field}
            disabled={calendarBasis}
            value={carriers}
            aria-describedby={ignored.length > 0 ? 'filter-carriers-ignored' : undefined}
            onChange={(e) => setCarriers(e.target.value)}
            onBlur={applyTyped}
          />
          {ignored.length > 0 ? (
            <span id="filter-carriers-ignored" className="text-xs bad-text">
              {COPY.carriersIgnored(ignored.join(', '))}
            </span>
          ) : null}
        </span>
        <span className="flex flex-col gap-1">
          <label className="field-label" htmlFor="filter-max-price">
            {COPY.filterMaxPrice}
          </label>
          <input
            id="filter-max-price"
            className={field}
            aria-invalid={priceInvalid}
            aria-describedby={priceInvalid ? 'filter-max-price-error' : undefined}
            inputMode="decimal"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            onBlur={applyTyped}
          />
          {priceInvalid ? (
            <span id="filter-max-price-error" role="alert" className="text-xs bad-text">
              {COPY.invalidPounds}
            </span>
          ) : null}
        </span>
        <label className="flex min-h-11 items-center gap-1">
          <input
            type="checkbox"
            checked={f.hideStale === true}
            onChange={() => apply(withKey(f, 'hideStale', f.hideStale === true ? undefined : true))}
          />
          {COPY.filterHideStale}
        </label>
        <span className="flex flex-col gap-1">
          <label className="field-label" htmlFor="filter-unverified">
            {COPY.filterUnverified}
          </label>
          <select
            id="filter-unverified"
            className={field}
            disabled={calendarBasis}
            // why: core's filter takes a list; this control picks one constraint (a row matches if it is unverified there).
            value={f.unverified?.[0] ?? ''}
            onChange={(e) => {
              const name = apiContract.constraintNameSchema.safeParse(e.target.value);
              apply(withKey(f, 'unverified', name.success ? [name.data] : undefined));
            }}
          >
            <option value="">{COPY.any}</option>
            {constraints.map((c) => (
              <option key={c} value={c}>
                {COPY.constraint[c]}
              </option>
            ))}
          </select>
        </span>
        <button type="submit" className="btn btn-primary min-h-11 self-end">
          {COPY.applyFilters}
        </button>
        <button type="button" className="btn min-h-11 self-end" onClick={() => apply({})}>
          {COPY.clearFilters}
        </button>
        {calendarBasis ? <p className="w-full text-fg-2">{COPY.filtersDisabledCalendar}</p> : null}
      </form>
    </details>
  );
}
