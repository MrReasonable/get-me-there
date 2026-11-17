import type { Iata } from '@gmt/core';
import { useId, useState } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { hoursText } from '../../lib/flightLines.js';
import { type DatesUiState, datesPatch } from '../../state/datesState.js';
import { nightsRange } from '../../state/parse.js';
import { updateSearchParams } from '../../state/urlState.js';
import { type AirportDetails, useAirportDetails } from '../Definitions/airports.js';
import { airportLabel } from '../Searches/cardWords.js';

const P = COPY.searchPage;

/** A filter edit replaces the URL (spec §11: the filters are in the URL; an edit is not a navigation). */
const apply = (s: Partial<DatesUiState>) => updateSearchParams(datesPatch(s), 'replace');

/**
 * Design 2026-11-08 Ruling 16 (mockup 02): the Search page's one filter row, in the URL, applying to the run line, both
 * sections and the calendar together: the stay (min–max nights, in the browser), From and To (all, or one airport; sent
 * to the route, so they change the date pairs read), and One per week. A journey limit applied from elsewhere (`d.journey`:
 * a Trip page's breadcrumb back, an old bookmark) shows as a removable chip, so nothing hides trips unseen; the search's
 * own limit is the header's. Each control is labelled and keyboard-operable; the row stays mounted while a new read
 * loads, so focus stays on the control that changed.
 */
export function Filters({ definition, state }: { definition: DefinitionResponse; state: DatesUiState }) {
  const id = useId();
  const airports = useAirportDetails([...definition.origins, ...definition.destinations]);
  // why: fix round 1 (A): with no stay filter the fields show the search's own range, as mockup 02's "10 – 21"; a range
  // equal to it is no filter, so nothing goes in the URL
  const own = { min: definition.minNights, max: definition.maxNights };
  const shown = state.nights ?? own;
  // why: typed text is held here until it is a value the URL can carry; a half-typed "1" of "14" never filters
  const [stay, setStay] = useState({ min: textOf(shown.min), max: textOf(shown.max) });
  // why: the row stays mounted for the page's life, so a URL change made outside it (back and forward, a link, the empty
  // state's Clear filters) must reach the typed text, or the fields disagree with the filter applied. The text is
  // replaced only when it doesn't already say the URL's value, so the operator's own edit (which wrote the URL) is never
  // rewritten mid-typing. React's "adjust state while rendering" pattern: no effect, so no frame shows the stale text.
  const urlStay = stayKey(shown.min, shown.max);
  const [seenStay, setSeenStay] = useState(urlStay);
  if (seenStay !== urlStay) {
    setSeenStay(urlStay);
    if (typedStayKey(stay.min, stay.max, own) !== urlStay)
      setStay({ min: textOf(shown.min), max: textOf(shown.max) });
  }
  const stayError = stayProblem(stay.min, stay.max);
  const editStay = (next: { min: string; max: string }) => {
    setStay(next);
    if (stayProblem(next.min, next.max)) return;
    const range =
      next.min.trim() === '' && next.max.trim() === ''
        ? null
        : nightsRange(`${next.min.trim()}-${next.max.trim()}`);
    apply({ nights: range === null || isOwnStay(range, own) ? null : range });
  };
  const journey = state.journey === null ? null : hoursText(state.journey);
  return (
    <fieldset className="search-filters" data-testid="dates-filters">
      <legend className="sr-only">{P.filterLabel}</legend>
      <span className="search-filter">
        <span aria-hidden="true">{P.stay}</span>
        <input
          type="text"
          inputMode="numeric"
          className="search-filter-nights"
          aria-label={P.stayShortest}
          value={stay.min}
          aria-describedby={stayError ? `${id}-stay` : undefined}
          aria-invalid={stayError ? true : undefined}
          onChange={(e) => editStay({ ...stay, min: e.target.value })}
        />
        <span aria-hidden="true">–</span>
        <input
          type="text"
          inputMode="numeric"
          className="search-filter-nights"
          aria-label={P.stayLongest}
          value={stay.max}
          aria-describedby={stayError ? `${id}-stay` : undefined}
          aria-invalid={stayError ? true : undefined}
          onChange={(e) => editStay({ ...stay, max: e.target.value })}
        />
        <span aria-hidden="true">{P.nights}</span>
      </span>
      {stayError ? (
        <span id={`${id}-stay`} className="search-filter-error">
          {P.stayInvalid}
        </span>
      ) : null}
      {definition.origins.length > 1 ? (
        <AirportSelect
          label={P.from}
          all={definition.origins}
          chosen={state.from}
          airports={airports.rows}
          onChange={(from) => apply({ from })}
        />
      ) : null}
      {definition.destinations.length > 1 ? (
        <AirportSelect
          label={P.to}
          all={definition.destinations}
          chosen={state.to}
          airports={airports.rows}
          onChange={(to) => apply({ to })}
        />
      ) : null}
      <label className="search-filter">
        <input
          type="checkbox"
          checked={state.bestPerWeek}
          onChange={(e) => apply({ bestPerWeek: e.target.checked })}
        />
        {P.onePerWeek}
      </label>
      {journey === null ? null : (
        <button
          type="button"
          className="search-chip"
          aria-label={P.journeyChipRemove(journey)}
          onClick={() => apply({ journey: null })}
        >
          {P.journeyChip(journey)} <span aria-hidden="true">×</span>
        </button>
      )}
    </fieldset>
  );
}

/**
 * From or To as one select (Ruling 16): every airport of the search (no parameter), or one of them. A narrower set than
 * every airport that is more than one (an old link's) is an option of its own while it is the URL's, so the select
 * always says what is applied; every airport named one by one reads as every airport.
 */
function AirportSelect({
  label,
  all,
  chosen,
  airports,
  onChange,
}: {
  label: string;
  all: readonly Iata[];
  chosen: readonly Iata[];
  airports: AirportDetails['rows'];
  onChange: (codes: Iata[]) => void;
}) {
  const name = (codes: readonly Iata[]) => codes.map((c) => airportLabel(c, airports.get(c))).join(', ');
  // why: every airport named one by one (an old link) is every airport, the first option, never a second copy of it
  const several = chosen.length > 1 && chosen.length < all.length ? chosen.join(',') : null;
  const value = chosen.length === 1 ? (chosen[0] ?? '') : (several ?? '');
  return (
    <label className="search-filter">
      {label}
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? [] : all.filter((c) => v.split(',').includes(c)));
        }}
      >
        <option value="">{name(all)}</option>
        {several !== null ? <option value={several}>{name(chosen)}</option> : null}
        {all.map((c) => (
          <option key={c} value={c}>
            {name([c])}
          </option>
        ))}
      </select>
    </label>
  );
}

const textOf = (n: number): string => String(n);

/** A stay range as one comparable string. */
const stayKey = (min: number, max: number): string => `${min}-${max}`;

/** A range that is the search's own: no filter (fix round 1, A). */
export function isOwnStay(r: { min: number; max: number }, own: { min: number; max: number }): boolean {
  return r.min === own.min && r.max === own.max;
}

/**
 * The typed stay range's key when the filter can apply it (blank on both sides is the search's own range), else null
 * (it then matches no URL value).
 */
function typedStayKey(min: string, max: string, own: { min: number; max: number }): string | null {
  if (min.trim() === '' && max.trim() === '') return stayKey(own.min, own.max);
  const r = nightsRange(`${min.trim()}-${max.trim()}`);
  return r === null ? null : stayKey(r.min, r.max);
}

/** True when the typed stay range is not one the filter can apply (blank on both sides is "no range", not an error). */
function stayProblem(min: string, max: string): boolean {
  if (min.trim() === '' && max.trim() === '') return false;
  return nightsRange(`${min.trim()}-${max.trim()}`) === null;
}
