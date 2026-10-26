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
 * Spec §11 URLs: `?view=` names the view; absent or unknown is Dates. The retired values land on Dates, keeping `def=`:
 * `calendar` and `duration` open it as it stands (a Calendar `cal.dest=<IATA>` of the definition becomes the Dates
 * destination filter; every other `cal.*` is removed), `coverage` opens it with its coverage section open. `results`
 * with a well-formed date pair is the detail; without one but with `row=` (an alert email sent before revision 48) it is
 * a row lookup; otherwise Dates. A parameter that no longer applies is ignored, never an error.
 *
 * Format only, no clock: whether the date pair is inside the current resolved space is the server's answer (`/results`'
 * 422 `date_pair_outside_space`, on which the detail replaces the URL with Dates).
 */
export function land(params: URLSearchParams, def: { destinations: readonly Iata[] } | null): Landing {
  // why: an absent view reads as the empty string, which names no view and so lands on Dates like an unknown one
  const v = params.get(DETAIL_LINK_PARAMS.view) ?? '';
  if (v === 'results') {
    if (parseDetailPair(params) !== null) return { kind: 'view', view: 'results', patch: {} };
    const row = parseSelectedRow(params);
    if (row !== null) return { kind: 'row-lookup', row, basis: parseBasis(params.get(BASIS_PARAM)) };
    return dates(BACK_TO_DATES);
  }
  if (v === 'calendar' || v === 'duration') return dates(calendarPatch(params, def));
  if (v === 'coverage') return dates(datesPatch({ coverageOpen: true }));
  if (isView(v)) return { kind: 'view', view: v, patch: {} };
  return dates({});
}

/** Dates, with `view=dates` written into the URL and `extra` applied. */
function dates(extra: Readonly<Record<string, string | null>>): Landing {
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
