import { apiContract, DETAIL_LINK_PARAMS, type Iata } from '@gmt/core';
import { datesPatch } from './datesState.js';
import { BACK_TO_DATES, BASIS_PARAM, parseBasis, parseDetailPair, parseSelectedRow } from './resultsState.js';
import { isView, type ViewId } from './view.js';

/**
 * Where a URL lands (spec §11 URLs, WP19 Task 19.7): a view with the patch that rewrites the URL to it (applied with
 * `replace`; empty when the URL already says it), or a row lookup that needs the whole-space `/results` read first.
 */
export type Landing =
  | { kind: 'view'; view: ViewId; patch: Record<string, string | null> }
  | { kind: 'row-lookup'; row: string; basis: 'verified' | 'calendar' | null };

/**
 * The retired Calendar's URL keys (WP10's `CALENDAR_PARAMS`, deleted with the view in WP19 Task 19.8; bookmarks still
 * carry them): `cal.dest` was its destination filter, the rest its own display state.
 */
const CAL_PREFIX = 'cal.';
const CAL_DEST = 'cal.dest';

/**
 * Spec rev 55 §11 URLs (WP20 Task 20.3): `?view=` names the view; an absent, empty or unknown value is Searches, the
 * first screen, whatever the number of searches. `dates` is a search's page and needs `def=`: without it the URL lands on
 * Searches. `definitions` is the Edit page and needs `edit=`: without it, Searches. The retired values land on a
 * search's page, keeping `def=`: `calendar` and `duration` open it as it stands (a Calendar `cal.dest=<IATA>` of the
 * definition becomes the Dates destination filter; every other `cal.*` is removed), `coverage` opens it with its coverage
 * section open (all of them land on Searches when they name no `def=`). `results` with a well-formed date pair is
 * the detail; without one but with `row=` (an alert email sent before revision 48) it is a row lookup; otherwise the
 * search's page. A parameter that no longer applies is ignored, never an error.
 *
 * Format only, no clock: whether the date pair is inside the current resolved space is the server's answer (`/results`'
 * 422 `date_pair_outside_space`, on which the detail replaces the URL with Dates).
 */
export function land(params: URLSearchParams, def: { destinations: readonly Iata[] } | null): Landing {
  // why: an absent view reads as the empty string, which names no view and so lands on Searches like an unknown one
  const v = params.get(DETAIL_LINK_PARAMS.view) ?? '';
  if (v === 'results') {
    if (parseDetailPair(params) !== null) return { kind: 'view', view: 'results', patch: {} };
    const row = parseSelectedRow(params);
    if (row !== null) return { kind: 'row-lookup', row, basis: parseBasis(params.get(BASIS_PARAM)) };
    return dates(params, BACK_TO_DATES);
  }
  if (v === 'calendar' || v === 'duration') return dates(params, calendarPatch(params, def));
  if (v === 'coverage') return dates(params, datesPatch({ coverageOpen: true }));
  // why: a search's page without `def=` has no search to show; the Edit page without `edit=` has none to edit
  if (v === 'dates')
    return named(params, DEF_PARAM) ? { kind: 'view', view: 'dates', patch: {} } : searches();
  if (v === 'definitions')
    return named(params, EDIT_PARAM) ? { kind: 'view', view: 'definitions', patch: {} } : searches();
  if (isView(v)) return { kind: 'view', view: v, patch: {} };
  return searches();
}

/** The URL parameter naming a search's page, and the Edit page's (spec §11 URLs). */
const DEF_PARAM = 'def';
const EDIT_PARAM = 'edit';

/** True when the URL carries a non-empty value for `key` (an empty `def=` names no search). */
const named = (params: URLSearchParams, key: string): boolean => (params.get(key) ?? '') !== '';

/** Searches, with `view=searches` written into the URL. */
function searches(): Landing {
  return { kind: 'view', view: 'searches', patch: { [DETAIL_LINK_PARAMS.view]: 'searches' } };
}

/**
 * A search's page with `view=dates` written into the URL and `extra` applied; with no search named (`def=` missing or
 * empty) there is no page to open, so Searches (spec rev 55 §11 URLs).
 */
function dates(params: URLSearchParams, extra: Readonly<Record<string, string | null>>): Landing {
  if (!named(params, DEF_PARAM)) return searches();
  return { kind: 'view', view: 'dates', patch: { [DETAIL_LINK_PARAMS.view]: 'dates', ...extra } };
}

/** Every `cal.*` removed, and `cal.dest` carried into the Dates destination filter when the definition has it. */
function calendarPatch(
  params: URLSearchParams,
  def: { destinations: readonly Iata[] } | null,
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const key of params.keys()) if (key.startsWith(CAL_PREFIX)) patch[key] = null;
  const raw = params.get(CAL_DEST);
  // why: the schema accepts the code exactly as spelled (a lower-case `jfk` would be another token than the filter
  // applies, as parse.ts's uniqueIataList rules), and the definition must hold it (decision 53: a filter is a subset)
  const parsed = apiContract.cellKeySchema.shape.destination.safeParse(raw);
  const destination =
    parsed.success && parsed.data === raw && def !== null
      ? def.destinations.find((d) => d === parsed.data)
      : undefined;
  return destination === undefined ? patch : { ...patch, ...datesPatch({ to: [destination] }) };
}
