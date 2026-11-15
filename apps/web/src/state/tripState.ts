import { type apiContract, DETAIL_LINK_PARAMS, type Iata, type IsoDate } from '@gmt/core';
import { DATES_PARAMS, parseDatesState, scopeQuery } from './datesState.js';
import { parseDetailPair } from './resultsState.js';

/**
 * The Trip page's URL (design 2026-11-08 §6.1): `view=trip&def=&depart=&return=`, with the search page's airport and
 * journey filters (`d.from`, `d.to`, `d.journey`) carried so the page reads the same filtered airport pairs the board
 * row it was opened from showed. Every other `d.*` parameter belongs to the board and is ignored here, kept in the URL
 * only so "back to the search" restores the board as it was.
 */
export interface TripUiState {
  departureDate: IsoDate;
  returnDate: IsoDate;
  from: Iata[];
  to: Iata[];
  journey: number | null;
}

/**
 * Strict parse against the search: the dates must be a well-formed pair (format only; whether they are inside the
 * search's dates now is the api's answer, `inWindow`), and the filters are the board's own parse (an airport outside
 * the search is dropped, a journey limit outside the route's bounds is ignored). Null with no usable dates.
 */
export function parseTripState(
  p: URLSearchParams,
  def: { origins: readonly Iata[]; destinations: readonly Iata[] },
): TripUiState | null {
  const pair = parseDetailPair(p);
  if (pair === null) return null;
  const { from, to, journey } = parseDatesState(p, def);
  return { ...pair, from, to, journey };
}

/**
 * The trip read's query (`tripQuerySchema`'s wire form): the scope names the api takes, from the board's own
 * `scopeQuery`, so one scope is one query whichever page asks.
 */
export function tripQueryOf(s: TripUiState): apiContract.TripQuery {
  const q = scopeQuery({
    nights: null,
    from: s.from,
    to: s.to,
    journey: s.journey,
    bestPerWeek: false,
    coverageOpen: false,
  });
  return {
    departureDate: s.departureDate,
    returnDate: s.returnDate,
    // why: an absent scope value is left out, not sent as undefined (the schema is strict about keys it knows only)
    ...(q.origins === undefined ? {} : { origins: q.origins }),
    ...(q.destinations === undefined ? {} : { destinations: q.destinations }),
    ...(q.maxJourneyMinutes === undefined ? {} : { maxJourneyMinutes: q.maxJourneyMinutes }),
  };
}

/**
 * The patch that opens a trip's page from the current URL (a board row, a card, a coverage line): the view and the
 * dates, with `basis` and `row` dropped (they named a row of the retired Results view). Applied with `hrefWith` or
 * `navigateTo`, so `def` and every `d.*` filter are kept.
 */
export function tripPatch(dates: {
  departureDate: IsoDate;
  returnDate: IsoDate;
}): Record<string, string | null> {
  return {
    [DETAIL_LINK_PARAMS.view]: 'trip',
    [DETAIL_LINK_PARAMS.depart]: dates.departureDate,
    [DETAIL_LINK_PARAMS.return]: dates.returnDate,
    [DETAIL_LINK_PARAMS.basis]: null,
    [DETAIL_LINK_PARAMS.row]: null,
  };
}

/** A trip page's address from scratch: for a link that is not made from the URL being shown (a search's card). */
export function tripHref(
  defId: string,
  depart: string,
  ret: string,
  filters: { from?: string; to?: string; journey?: string },
): string {
  const p = new URLSearchParams([
    [DETAIL_LINK_PARAMS.view, 'trip'],
    [DETAIL_LINK_PARAMS.def, defId],
    [DETAIL_LINK_PARAMS.depart, depart],
    [DETAIL_LINK_PARAMS.return, ret],
  ]);
  if (filters.from) p.set(DATES_PARAMS.from, filters.from);
  if (filters.to) p.set(DATES_PARAMS.to, filters.to);
  if (filters.journey) p.set(DATES_PARAMS.journey, filters.journey);
  return `?${p.toString()}`;
}
