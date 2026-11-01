/**
 * Spec revision 55 §2 "The flight-list read" and §8.1 "The flight-list step" (§12: no new setting): the flight list's
 * fixed figures, the one copy every package reads.
 */

/** The date pairs a run reads flight lists for: the 10 cheapest on its search's board, on an allowance of its own. */
export const FLIGHT_LIST_COUNT = 10;
/** The flights one list keeps: the 30 cheapest of the pair's options, in page order. */
export const FLIGHT_LIST_MAX_FLIGHTS = 30;
/** The flights a search's page shows beside a date pair before "more". */
export const FLIGHTS_SHOWN = 3;
/** The browser worker's flight-list route, also each flight page's ledger `endpoint_path`. */
export const FLIGHT_LIST_ENDPOINT_PATH = '/v1/flights';
/** The date pairs one `GET /definitions/:id/flight-lists` may ask for. */
export const MAX_FLIGHT_LIST_PAIRS = 50;
