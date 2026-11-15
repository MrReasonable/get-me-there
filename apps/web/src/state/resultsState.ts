import { apiContract, DETAIL_LINK_PARAMS, type IsoDate } from '@gmt/core';
import type { Basis } from '../api/types.js';
import { datesPatch } from './datesState.js';

// What is left of the retired Results view's URL state (trip-page plan Task 7): the basis the status bar and History
// read, an old link's pair of dates (landing and the Trip page parse it), and the way back to a search's page.

/** The URL parameter that carries the results basis; the status bar and History read it through this. */
export const BASIS_PARAM = 'basis';

export function parseBasis(v: string | null): Basis | null {
  return v === 'verified' || v === 'calendar' ? v : null;
}

/** The pair of dates a Trip page (or an old detail) URL names. */
export interface DetailPair {
  departureDate: IsoDate;
  returnDate: IsoDate;
}

/**
 * `depart=` and `return=` as two well-formed `YYYY-MM-DD` dates with the return on or after the departure, else null.
 * Format only (spec §11 URLs; WP19 Task 19.7): whether the dates are inside the search's current dates is the server's
 * answer (the trip read's `inWindow`), never the browser's, which has no clock to judge it by.
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
 * A multi-airport trip's own airport pair on the Trip page's URL (final review M3): the trip's, kept apart from the
 * search page's airport filter (`d.from`/`d.to`), so the way back finds that filter as it was, or none.
 */
export const TRIP_PAIR_PARAMS = { from: 't.from', to: 't.to' } as const;

/**
 * Back to a search's page (spec §11): the Dates view with every `d.*` parameter kept (hrefWith keeps every parameter
 * the patch does not name) and the Trip page's own parameters removed (its dates, its pair), names from core's one
 * constant and `TRIP_PAIR_PARAMS`.
 */
export const BACK_TO_DATES: Readonly<Record<string, string | null>> = {
  [DETAIL_LINK_PARAMS.view]: 'dates',
  [DETAIL_LINK_PARAMS.depart]: null,
  [DETAIL_LINK_PARAMS.return]: null,
  [DETAIL_LINK_PARAMS.basis]: null,
  [DETAIL_LINK_PARAMS.row]: null,
  [TRIP_PAIR_PARAMS.from]: null,
  [TRIP_PAIR_PARAMS.to]: null,
};

/** A search's page with its coverage section open (the status bar and the status card link to it). */
export const DATES_COVERAGE: Readonly<Record<string, string | null>> = {
  ...BACK_TO_DATES,
  ...datesPatch({ coverageOpen: true }),
};
