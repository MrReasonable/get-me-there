import { apiContract, type Iata } from '@gmt/core';
import { type FormEvent, useId, useState } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { CLEARED_FILTERS, type DatesUiState, datesPatch, journeyInBounds } from '../../state/datesState.js';
import { nightsRange } from '../../state/parse.js';
import { updateSearchParams } from '../../state/urlState.js';

const D = COPY.datesView;
const JOURNEY_BOUNDS = D.journeyBounds(
  apiContract.MIN_JOURNEY_LIMIT_MINUTES,
  apiContract.MAX_JOURNEY_LIMIT_MINUTES,
);
const FIELD = 'min-h-11 w-24 rounded border border-slate-500 px-2';

/** A filter edit replaces the URL (spec §11: the filters are in the URL; an edit is not a navigation). */
const apply = (s: Partial<DatesUiState>) => updateSearchParams(datesPatch(s), 'replace');

/**
 * Spec §11 Dates "Filters", above the board, in the URL, applying to the header line, the board and the overview
 * together: the stay range (in the browser), the origins and destinations (sent to the route; subsets of the
 * definition's), the journey limit (sent to the route), the week switch (revision 50) and "Clear filters". Each
 * control is labelled and keyboard-operable; the component stays mounted while a new read loads, so focus stays on
 * the control that changed.
 */
export function Filters({ definition, state }: { definition: DefinitionResponse; state: DatesUiState }) {
  const id = useId();
  // why: typed text is held here until it is a value the URL can carry; a half-typed "1" of "14" never filters
  const [stay, setStay] = useState({ min: textOf(state.nights?.min), max: textOf(state.nights?.max) });
  const [journey, setJourney] = useState(textOf(state.journey ?? undefined));
  const stayError = stayProblem(stay.min, stay.max);
  const typed = journey.trim();
  const journeyError = typed !== '' && !(/^\d+$/.test(typed) && journeyInBounds(Number(typed)));

  const editStay = (next: { min: string; max: string }) => {
    setStay(next);
    if (next.min.trim() === '' && next.max.trim() === '') apply({ nights: null });
    else if (stayProblem(next.min, next.max) === false)
      apply({ nights: nightsRange(`${next.min.trim()}-${next.max.trim()}`) });
  };
  // why: the limit is sent to the route, so it applies on Enter or when the field is left, never on every key, and a
  // value outside the route's bounds is explained beside the field and never sent (the route would refuse it)
  const commitJourney = () => {
    const t = journey.trim();
    if (t === '') apply({ journey: null });
    else if (/^\d+$/.test(t) && journeyInBounds(Number(t))) apply({ journey: Number(t) });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    commitJourney();
  };
  const toggle = (list: readonly Iata[], all: readonly Iata[], code: Iata): Iata[] => {
    const shown = list.length === 0 ? [...all] : [...list];
    const next = shown.includes(code) ? shown.filter((c) => c !== code) : [...shown, code];
    // why: every airport ticked is the unfiltered scope, written as no parameter
    return next.length === all.length ? [] : all.filter((c) => next.includes(c));
  };

  return (
    <form aria-label={D.filtersLabel} onSubmit={onSubmit} className="flex flex-wrap items-end gap-4 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          {D.stayMin}
          <input
            type="text"
            inputMode="numeric"
            className={FIELD}
            value={stay.min}
            aria-describedby={stayError ? `${id}-stay` : undefined}
            onChange={(e) => editStay({ ...stay, min: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          {D.stayMax}
          <input
            type="text"
            inputMode="numeric"
            className={FIELD}
            value={stay.max}
            aria-describedby={stayError ? `${id}-stay` : undefined}
            onChange={(e) => editStay({ ...stay, max: e.target.value })}
          />
        </label>
        {stayError ? (
          <span id={`${id}-stay`} className="font-medium text-red-800">
            {D.stayInvalid}
          </span>
        ) : null}
      </div>
      <AirportPicker
        legend={D.origins}
        all={definition.origins}
        chosen={state.from}
        onToggle={(c) => apply({ from: toggle(state.from, definition.origins, c) })}
      />
      <AirportPicker
        legend={D.destinations}
        all={definition.destinations}
        chosen={state.to}
        onToggle={(c) => apply({ to: toggle(state.to, definition.destinations, c) })}
      />
      <div className="flex flex-col">
        <label htmlFor={`${id}-journey`}>{D.journeyLimit}</label>
        <input
          id={`${id}-journey`}
          type="text"
          inputMode="numeric"
          className={FIELD}
          value={journey}
          aria-invalid={journeyError ? true : undefined}
          aria-describedby={`${id}-journey-bounds`}
          onChange={(e) => setJourney(e.target.value)}
          onBlur={commitJourney}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitJourney();
            }
          }}
        />
        <span
          id={`${id}-journey-bounds`}
          className={journeyError ? 'font-medium text-red-800' : 'text-slate-700'}
        >
          {JOURNEY_BOUNDS}
        </span>
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={state.bestPerWeek}
          onChange={(e) => apply({ bestPerWeek: e.target.checked })}
        />
        {D.weekSwitch}
      </label>
      <button
        type="button"
        className="min-h-11 rounded border border-slate-500 px-3"
        onClick={() => {
          setStay({ min: '', max: '' });
          setJourney('');
          apply(CLEARED_FILTERS);
        }}
      >
        {COPY.clearFilters}
      </button>
    </form>
  );
}

/** One checkbox per airport of the definition; an empty choice means every airport, so all are then ticked. */
function AirportPicker({
  legend,
  all,
  chosen,
  onToggle,
}: {
  legend: string;
  all: readonly Iata[];
  chosen: readonly Iata[];
  onToggle: (c: Iata) => void;
}) {
  const ticked = chosen.length === 0 ? all : chosen;
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend>{legend}</legend>
      {all.map((c) => {
        const on = ticked.includes(c);
        return (
          <label key={c} className="flex min-h-11 items-center gap-1">
            <input
              type="checkbox"
              checked={on}
              // why: the last ticked airport stays: a scope with no airport would be an empty search, not a filter
              disabled={on && ticked.length === 1}
              onChange={() => onToggle(c)}
            />
            {c}
          </label>
        );
      })}
    </fieldset>
  );
}

const textOf = (n: number | undefined): string => (n === undefined ? '' : String(n));

/** True when the typed stay range is not one the filter can apply (blank on both sides is "no range", not an error). */
function stayProblem(min: string, max: string): boolean {
  if (min.trim() === '' && max.trim() === '') return false;
  return nightsRange(`${min.trim()}-${max.trim()}`) === null;
}
