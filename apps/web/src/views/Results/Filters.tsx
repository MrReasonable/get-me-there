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
  DEFAULT_CLASSES,
  type ResultsUiState,
  resultsStatePatch,
  setFilter,
} from '../../state/resultsState.js';
import { updateSearchParams } from '../../state/urlState.js';

function toggle<T extends string>(list: readonly T[], v: T): T[] | undefined {
  const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  return next.length > 0 ? next : undefined;
}

const unique = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];
const intOrUndefined = (s: string): number | undefined =>
  /^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined;

const intMeaning = (t: string) => {
  const n = intOrUndefined(t);
  return n === undefined ? '' : String(n);
};

const field = 'min-h-11 rounded border border-slate-400 px-1';

export interface FiltersProps {
  state: ResultsUiState;
  rows: readonly ResultRow[];
  calendarBasis: boolean;
  /** Collapsed by default on a narrow screen so the table stays above the fold (review UI-7). */
  narrow: boolean;
}

/**
 * Spec §6.5 filters, all client-side; state lives in the URL so it persists across views. Checkboxes,
 * selects and dates apply on change; typed boxes apply on Enter, on Apply and on leaving the box.
 */
export function Filters({ state, rows, calendarBasis, narrow }: FiltersProps) {
  const f = state.filters;
  const apply = (next: ResultFilters) => updateSearchParams(resultsStatePatch({ ...state, filters: next }));
  const [carriers, setCarriers] = useSynced((f.carriers ?? []).join(','), carriersText);
  const [maxPrice, setMaxPrice] = useSynced(penceToPoundsInput(f.maxPricePence), poundsText);
  const [nightsMin, setNightsMin] = useSynced(f.nights === undefined ? '' : String(f.nights.min), intMeaning);
  const [nightsMax, setNightsMax] = useSynced(f.nights === undefined ? '' : String(f.nights.max), intMeaning);
  const providers = unique(rows.map((r) => r.provenance.providerId));
  const destinations = unique(rows.map((r) => r.cell.destination));
  const constraints = apiContract.constraintNameSchema.options.filter((c) =>
    rows.some((r) => r.unverified.includes(c)),
  );
  const classes = f.verdictClass ?? DEFAULT_CLASSES;
  const nights = rows.map((r) => r.cell.nights);
  const dates = rows.map((r) => r.cell.departureDate).sort();
  const ignored = parseCarriers(carriers).ignored;

  /** Applies every typed box at once; a nights box left blank takes the data's own end of the range. */
  const typed = (base: ResultFilters): ResultFilters => {
    const min = intOrUndefined(nightsMin);
    const max = intOrUndefined(nightsMax);
    const range =
      min === undefined && max === undefined
        ? undefined
        : { min: min ?? Math.min(...nights, max ?? 0), max: max ?? Math.max(...nights, min ?? 0) };
    const codes = parseCarriers(carriers).codes;
    let next = setFilter(base, 'carriers', codes.length > 0 ? codes : undefined);
    next = setFilter(next, 'maxPricePence', parsePoundsToPence(maxPrice));
    return setFilter(
      next,
      'nights',
      range === undefined
        ? undefined
        : { min: Math.min(range.min, range.max), max: Math.max(range.min, range.max) },
    );
  };
  // why: typed text that does not parse is flagged, not silently ignored (UI-8).
  const priceInvalid = maxPrice.trim() !== '' && parsePoundsToPence(maxPrice) === undefined;
  const nightsMinInvalid = nightsMin.trim() !== '' && intOrUndefined(nightsMin) === undefined;
  const nightsMaxInvalid = nightsMax.trim() !== '' && intOrUndefined(nightsMax) === undefined;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    apply(typed(f));
  };
  const setDeparture = (end: 'from' | 'to', value: string) => {
    const parsed = apiContract.cellKeySchema.shape.departureDate.safeParse(value);
    const current = f.departure;
    const first = dates[0];
    const last = dates.at(-1);
    if (!parsed.success) {
      // why: clearing one end leaves the range open-ended on that side (the data's own bound); only clearing
      // the last explicit end removes the filter (UI-9).
      const other = end === 'from' ? current?.to : current?.from;
      const bound = end === 'from' ? first : last;
      if (other === undefined || bound === undefined) {
        apply(setFilter(f, 'departure', undefined));
        return;
      }
      apply(
        setFilter(f, 'departure', end === 'from' ? { from: bound, to: other } : { from: other, to: bound }),
      );
      return;
    }
    const from = end === 'from' ? parsed.data : (current?.from ?? first);
    const to = end === 'to' ? parsed.data : (current?.to ?? last);
    if (from === undefined || to === undefined) return;
    apply(setFilter(f, 'departure', from <= to ? { from, to } : { from: to, to: from }));
  };

  return (
    <details open={!narrow} className="text-sm">
      <summary className="min-h-11 cursor-pointer font-semibold">
        {COPY.filtersSummary(activeFilterCount(f))}
      </summary>
      <form
        aria-label={COPY.filtersHeading}
        onSubmit={onSubmit}
        className="flex flex-wrap items-start gap-3 pt-2"
      >
        <fieldset className="flex flex-wrap gap-2">
          <legend className="font-semibold">{COPY.filterClass}</legend>
          {CLASSES.map((c) => (
            <label key={c} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={classes.includes(c)}
                onChange={() => apply(setFilter(f, 'verdictClass', toggle(classes, c)))}
              />
              {COPY.classLabel[c]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="font-semibold">{COPY.filterProvider}</legend>
          {providers.map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={f.providerId?.includes(p) ?? false}
                onChange={() => apply(setFilter(f, 'providerId', toggle(f.providerId ?? [], p)))}
              />
              {COPY.provider[p]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="font-semibold">{COPY.filterDestinations}</legend>
          {destinations.map((d) => (
            <label key={d} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={f.destination?.includes(d) ?? false}
                onChange={() => apply(setFilter(f, 'destination', toggle(f.destination ?? [], d)))}
              />
              {d}
            </label>
          ))}
        </fieldset>
        <span className="flex flex-col">
          <label htmlFor="filter-max-stops">{COPY.filterMaxStops}</label>
          <select
            id="filter-max-stops"
            className={field}
            disabled={calendarBasis}
            value={f.maxStops === undefined ? '' : String(f.maxStops)}
            onChange={(e) => apply(setFilter(f, 'maxStops', intOrUndefined(e.target.value)))}
          >
            <option value="">{COPY.any}</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-carriers">{COPY.filterCarriers}</label>
          <input
            id="filter-carriers"
            className={field}
            disabled={calendarBasis}
            value={carriers}
            aria-describedby={ignored.length > 0 ? 'filter-carriers-ignored' : undefined}
            onChange={(e) => setCarriers(e.target.value)}
            onBlur={() => apply(typed(f))}
          />
          {ignored.length > 0 ? (
            <span id="filter-carriers-ignored" className="text-xs text-red-800">
              {COPY.carriersIgnored(ignored.join(', '))}
            </span>
          ) : null}
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-max-price">{COPY.filterMaxPrice}</label>
          <input
            id="filter-max-price"
            className={field}
            aria-invalid={priceInvalid}
            aria-describedby={priceInvalid ? 'filter-max-price-error' : undefined}
            inputMode="decimal"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            onBlur={() => apply(typed(f))}
          />
          {priceInvalid ? (
            <span id="filter-max-price-error" role="alert" className="text-xs text-red-800">
              {COPY.invalidPounds}
            </span>
          ) : null}
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-nights-min">{COPY.filterNightsMin}</label>
          <input
            id="filter-nights-min"
            className={field}
            aria-invalid={nightsMinInvalid}
            aria-describedby={nightsMinInvalid ? 'filter-nights-min-error' : undefined}
            inputMode="numeric"
            value={nightsMin}
            onChange={(e) => setNightsMin(e.target.value)}
            onBlur={() => apply(typed(f))}
          />
          {nightsMinInvalid ? (
            <span id="filter-nights-min-error" role="alert" className="text-xs text-red-800">
              {COPY.invalidWholeNumber}
            </span>
          ) : null}
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-nights-max">{COPY.filterNightsMax}</label>
          <input
            id="filter-nights-max"
            className={field}
            aria-invalid={nightsMaxInvalid}
            aria-describedby={nightsMaxInvalid ? 'filter-nights-max-error' : undefined}
            inputMode="numeric"
            value={nightsMax}
            onChange={(e) => setNightsMax(e.target.value)}
            onBlur={() => apply(typed(f))}
          />
          {nightsMaxInvalid ? (
            <span id="filter-nights-max-error" role="alert" className="text-xs text-red-800">
              {COPY.invalidWholeNumber}
            </span>
          ) : null}
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-depart-from">{COPY.filterDepartFrom}</label>
          <input
            id="filter-depart-from"
            className={field}
            type="date"
            value={f.departure?.from ?? ''}
            onChange={(e) => setDeparture('from', e.target.value)}
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor="filter-depart-to">{COPY.filterDepartTo}</label>
          <input
            id="filter-depart-to"
            className={field}
            type="date"
            value={f.departure?.to ?? ''}
            onChange={(e) => setDeparture('to', e.target.value)}
          />
        </span>
        <label className="flex min-h-11 items-center gap-1">
          <input
            type="checkbox"
            checked={f.hideStale === true}
            onChange={() => apply(setFilter(f, 'hideStale', f.hideStale === true ? undefined : true))}
          />
          {COPY.filterHideStale}
        </label>
        <span className="flex flex-col">
          <label htmlFor="filter-unverified">{COPY.filterUnverified}</label>
          <select
            id="filter-unverified"
            className={field}
            disabled={calendarBasis}
            // why: core's filter takes a list; this control picks one constraint (a row matches if it is unverified there).
            value={f.unverified?.[0] ?? ''}
            onChange={(e) => {
              const name = apiContract.constraintNameSchema.safeParse(e.target.value);
              apply(setFilter(f, 'unverified', name.success ? [name.data] : undefined));
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
        <button type="submit" className="min-h-11 rounded border border-slate-500 px-3">
          {COPY.applyFilters}
        </button>
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3"
          onClick={() => apply({})}
        >
          {COPY.clearFilters}
        </button>
        {calendarBasis ? <p className="w-full">{COPY.filtersDisabledCalendar}</p> : null}
      </form>
    </details>
  );
}
