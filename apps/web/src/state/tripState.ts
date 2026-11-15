import { type apiContract, DETAIL_LINK_PARAMS, type Iata, type IsoDate } from '@gmt/core';
import { DATES_PARAMS, parseDatesState, scopeQuery } from './datesState.js';
import { parseDetailPair, TRIP_PAIR_PARAMS } from './resultsState.js';

/**
 * The Trip page's URL (design 2026-11-08 §6.1): `view=trip&def=&depart=&return=`, a multi-airport trip's own pair
 * (`t.from`, `t.to`: final review M3) and the search page's airport and journey filters (`d.from`, `d.to`,
 * `d.journey`) carried so the page reads the same filtered airport pairs the row it was opened from showed. Every
 * other `d.*` parameter belongs to the search page and is ignored here, kept in the URL only so "back to the search"
 * restores the page as it was.
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
 * search's dates now is the api's answer, `inWindow`), and the filters are the search page's own parse (an airport
 * outside the search is dropped, a journey limit outside the route's bounds is ignored). A side the trip names its own
 * airport for (`t.from`, `t.to`) is scoped to it over the page's filter. Null with no usable dates.
 */
export function parseTripState(
  p: URLSearchParams,
  def: { origins: readonly Iata[]; destinations: readonly Iata[] },
): TripUiState | null {
  const pair = parseDetailPair(p);
  if (pair === null) return null;
  const { from, to, journey } = parseDatesState(p, def);
  // why: the trip's own pair goes through the same strict parse as the page's filter
  const own = parseDatesState(
    new URLSearchParams({
      [DATES_PARAMS.from]: p.get(TRIP_PAIR_PARAMS.from) ?? '',
      [DATES_PARAMS.to]: p.get(TRIP_PAIR_PARAMS.to) ?? '',
    }),
    def,
  );
  return {
    ...pair,
    from: p.has(TRIP_PAIR_PARAMS.from) ? own.from : from,
    to: p.has(TRIP_PAIR_PARAMS.to) ? own.to : to,
    journey,
  };
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

/**
 * A trip page's address from scratch: for a link that is not made from the URL being shown (a search's card). A
 * multi-airport trip names its own pair (`t.from`, `t.to`), never the page's airport filter (final review M3).
 */
export function tripHref(
  defId: string,
  depart: string,
  ret: string,
  pair: { from?: string; to?: string },
): string {
  const p = new URLSearchParams([
    [DETAIL_LINK_PARAMS.view, 'trip'],
    [DETAIL_LINK_PARAMS.def, defId],
    [DETAIL_LINK_PARAMS.depart, depart],
    [DETAIL_LINK_PARAMS.return, ret],
  ]);
  if (pair.from) p.set(TRIP_PAIR_PARAMS.from, pair.from);
  if (pair.to) p.set(TRIP_PAIR_PARAMS.to, pair.to);
  return `?${p.toString()}`;
}

/**
 * A trip's address from a search's page (Trips and Search Task 9 fix round 1, ruling): `tripHref`'s, carrying every
 * `d.*` parameter the page holds (its stay range, airports, journey limit, week switch), so the Trip page's crumb back
 * (`BACK_TO_DATES`, which keeps `d.*` and drops the trip's pair) returns to the same filtered view: the page's own
 * airport filter, or none (final review M3). Cheapest trips and the day panel both link through it; a Trips card keeps
 * `tripHref` alone.
 */
export function searchPageTripHref(
  defId: string,
  depart: string,
  ret: string,
  pair: { from?: string; to?: string },
  page: URLSearchParams,
): string {
  const p = new URLSearchParams(tripHref(defId, depart, ret, pair));
  for (const [k, v] of page) if (k.startsWith('d.')) p.set(k, v);
  return `?${p.toString()}`;
}
