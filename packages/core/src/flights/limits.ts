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

// ---- Spec revision 56 §12 "the return phase's values" (the 21.0 findings; no setting is added) ----

/** The returns a search's page shows beneath a pairing's outbound before "more" (spec rev 56 §6.2, §11). */
export const RETURNS_SHOWN = 3;
/** The outbounds a return phase selects for one pair at most: the cheapest fitting one, then the next (Ian's ruling 2). */
export const RETURN_ATTEMPTS_MAX = 2;
/**
 * R-worst: the documents a flights request with a return phase may load: the first view and the second outbound's
 * fresh load of the list page. An activation never loads a document (the guard refuses one while it settles), so this
 * is the reachable bound, the one source for the worker's and the app's reservation, the allowance and the bound the
 * estimate states; as recorded a pair loads 1, or 2 with a second outbound.
 */
export const FLIGHT_LIST_PAGES_PER_PAIR_MAX = 2;
/** The reload: the one step of the return phase the pacer is re-claimed before. */
export const RETURN_SPACED_LOADS = 1;
/**
 * The page periods of a return-phase request's budget: first view, Cheapest, selection, reload, Cheapest, selection
 * (6), and with a booking read the return's selection and the expansion (8).
 */
export const RETURN_PAGE_PERIODS = { booking: 8, returnsOnly: 6 } as const;
/** Recorded: the largest step, 27,891 ms (the reload's settle), rounds up to 30 s; the floor of 40 applies. */
export const RETURN_STEP_SECONDS = 40;
/** The return phase's worst case in steps: 5 with a booking read (200 s), 3 without (120 s). */
export const RETURN_PHASE_SECONDS_MAX = {
  booking: RETURN_STEP_SECONDS * 5,
  returnsOnly: RETURN_STEP_SECONDS * 3,
} as const;
/**
 * R-estimate: the share of pairs the typical estimate counts as needing the second outbound. None was recorded (the
 * recorder always made the second selection), so the typical figure counts 1.5 pages a pair; a later recording of the
 * served path may replace it.
 */
export const RETURN_SECOND_OUTBOUND_RATE = 0.5;
/** The offers one booking read keeps, the cheapest first by price (recorded: 23 and 19 after the expansion). */
export const BOOKING_OFFERS_MAX = 40;

/** The read-back, close and discard bounds a worker answer adds to its page periods, in seconds. */
const ANSWER_SECONDS = 15;
/** The round trip between the app and the worker, in seconds. */
const ROUND_TRIP_SECONDS = 15;

/**
 * Spec rev 56 §2, §12: the app's timeout for one flights request with a return phase, from the shared settings: its
 * page periods × the page timeout, plus the one spaced reload's spacing, plus the answer's and the round trip's bounds.
 * 780 s with a booking read (600 s without) at the defaults (90 s, 30 s); 1,035 s at 120 s and 45 s.
 */
export function flightRequestSeconds(
  pageTimeoutSeconds: number,
  minSpacingSeconds: number,
  booking: boolean,
): number {
  return (
    RETURN_PAGE_PERIODS[booking ? 'booking' : 'returnsOnly'] * pageTimeoutSeconds +
    RETURN_SPACED_LOADS * minSpacingSeconds +
    ANSWER_SECONDS +
    ROUND_TRIP_SECONDS
  );
}

/**
 * Spec rev 56 §8.1 (ruling D3): the ONE rule for the pages one flights request plans (`pagesPlanned`, the plan, the
 * allowance check and the estimate's bound): `FLIGHT_LIST_PAGES_PER_PAIR_MAX` when the worker last reported
 * `RETURN_SELECT_VERIFIED` true, else 1 (no return phase is planned; a worker not yet read counts as false).
 */
export function flightPagesPerPair(flags: Readonly<Record<string, boolean>> | null): 1 | 2 {
  return flags?.RETURN_SELECT_VERIFIED === true ? FLIGHT_LIST_PAGES_PER_PAIR_MAX : 1;
}
