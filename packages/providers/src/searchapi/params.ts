import {
  asIsoDate,
  type Cabin,
  type DiscoveryQuery,
  type IsoDate,
  type ItineraryQuery,
  type Secret,
  type TileRequest,
} from '@gmt/core';
import { withContentHash } from '../http/recorder.js';
import type { ParamsAllowlist } from '../params/allowlist.js';
import type { ParseWhere } from '../shared/errors.js';

/** SearchApi's single host; `searchApiHttpLimits` gives it to http-kit as the egress allowlist (spec §5.3). */
export const SEARCHAPI_HOST = 'www.searchapi.io';
/** Both engines share one endpoint; `engine` selects calendar or itinerary (vendor docs, 2026-10-14). */
export const SEARCHAPI_ENDPOINT = `https://${SEARCHAPI_HOST}/api/v1/search`;
/** Path only, as written to `provider_requests.endpoint_path` (spec §5.3: no query). */
export const SEARCHAPI_ENDPOINT_PATH = '/api/v1/search';

/** Passed to every shared `parseError`/`parseVendor` call, so parse errors carry `providerId` and the path prefix. */
export const SEARCHAPI_WHERE: ParseWhere = { providerId: 'searchapi', endpointPath: SEARCHAPI_ENDPOINT_PATH };

/** Cabin → vendor `travel_class` (spec §5.4: `first` is `first_class`). */
export const TRAVEL_CLASS: Readonly<Record<Cabin, string>> = {
  economy: 'economy',
  premium_economy: 'premium_economy',
  business: 'business',
  first: 'first_class',
};

/**
 * `sort_by` value for `google_flights` (vendor default `top_flights`; `price` is documented, read 2026-10-15),
 * so step 1's options arrive cheapest first (spec §5.4). The adapter still sorts locally: "cheapest" holds only
 * over the options the vendor returned.
 */
export const SORT_BY_PRICE = 'price';
/**
 * `separate_tickets` value for both engines. Both docs pages say "Set to `1` to hide separate and self-transfer
 * tickets, or `0` to show them" (default `0`; re-read 2026-10-15). Sent on both, so discovery ranks cells by the
 * same kind of fare verification searches (plan decision 29). ItineraryQuery carries no self-transfer permission
 * (a Phase 4 gap, decision 27), so the adapter always excludes them and never states `selfTransfer`.
 */
export const EXCLUDE_SEPARATE_TICKETS = '1';

// why: the date of WP4b's recording run; the Task 5.9 test fails until it equals the recorded file's
// recordedAt (print it with the command in Task 5.9 Step 3). The hash is computed, never copied.
const RECORDED_AT: IsoDate = asIsoDate('2026-10-15');

const TRAVEL_CLASSES = ['business', 'economy', 'first_class', 'premium_economy'];
const CALENDAR_KEY = `${SEARCHAPI_ENDPOINT_PATH}?engine=google_flights_calendar`;
const FLIGHTS_KEY = `${SEARCHAPI_ENDPOINT_PATH}?engine=google_flights`;

/**
 * Every parameter name and value this adapter may send (spec §5.2), in WP4's `ParamsAllowlist` shape, equal to
 * WP4b's recorded `params-<date>.json` (plan decision 24). Both engines share `/api/v1/search`, so each has an
 * engine-qualified key and `assertRequestAllowed` holds it to its own names. `gl` is the recorded point of
 * sale only; another POINT_OF_SALE needs a new recording (the constructor refuses it).
 */
export const SEARCHAPI_PARAMS: ParamsAllowlist = withContentHash({
  provider: 'searchapi',
  recordedAt: RECORDED_AT,
  endpoints: {
    [CALENDAR_KEY]: {
      names: [
        'adults',
        'arrival_id',
        'currency',
        'departure_id',
        'engine',
        'flight_type',
        'gl',
        'hl',
        'outbound_date',
        'outbound_date_end',
        'outbound_date_start',
        'return_date',
        'return_date_end',
        'return_date_start',
        'separate_tickets',
        'travel_class',
      ],
      values: {
        adults: ['1'],
        arrival_id: 'any',
        currency: ['GBP'],
        departure_id: 'any',
        engine: ['google_flights_calendar'],
        flight_type: ['round_trip'],
        gl: ['gb'],
        hl: ['en'],
        outbound_date: 'any',
        outbound_date_end: 'any',
        outbound_date_start: 'any',
        return_date: 'any',
        return_date_end: 'any',
        return_date_start: 'any',
        separate_tickets: [EXCLUDE_SEPARATE_TICKETS],
        travel_class: TRAVEL_CLASSES,
      },
    },
    [FLIGHTS_KEY]: {
      names: [
        'adults',
        'arrival_id',
        'booking_token',
        'currency',
        'departure_id',
        'departure_token',
        'engine',
        'flight_type',
        'gl',
        'hl',
        'outbound_date',
        'return_date',
        'separate_tickets',
        'sort_by',
        'travel_class',
      ],
      values: {
        adults: ['1'],
        arrival_id: 'any',
        booking_token: 'any',
        currency: ['GBP'],
        departure_id: 'any',
        departure_token: 'any',
        engine: ['google_flights'],
        flight_type: ['round_trip'],
        gl: ['gb'],
        hl: ['en'],
        outbound_date: 'any',
        return_date: 'any',
        separate_tickets: [EXCLUDE_SEPARATE_TICKETS],
        sort_by: [SORT_BY_PRICE],
        travel_class: TRAVEL_CLASSES,
      },
    },
  },
});

/**
 * Refuses a POINT_OF_SALE the allowlist cannot send (spec §5.2: `gl` is POINT_OF_SALE lower-cased, and the
 * dated allowlist names values). Called by the constructor, so a misconfiguration fails at boot rather than as
 * a refused request on every tile.
 */
export function assertPointOfSaleAllowed(allow: ParamsAllowlist, pointOfSale: string): void {
  if (!/^[A-Z]{2}$/.test(pointOfSale))
    throw new TypeError(`POINT_OF_SALE must be an upper-case ISO 3166-1 alpha-2 code; got ${pointOfSale}`);
  for (const entry of Object.values(allow.endpoints)) {
    const gl = entry.values.gl;
    if (gl !== undefined && gl !== 'any' && !gl.includes(pointOfSale.toLowerCase()))
      throw new TypeError(
        `POINT_OF_SALE ${pointOfSale} is not in the ${allow.recordedAt} SearchApi allowlist (gl: ${gl.join(', ')}); record fixtures for it first`,
      );
  }
}

/** Spec §5.2 point of sale: GBP and English hard-coded, `gl` from POINT_OF_SALE; one adult (ItineraryQuery.adults is 1). */
function common(pointOfSale: string, cabin: Cabin): Record<string, string> {
  return {
    adults: '1',
    currency: 'GBP',
    gl: pointOfSale.toLowerCase(),
    hl: 'en',
    travel_class: TRAVEL_CLASS[cabin],
  };
}

/** `google_flights_calendar` parameters for one rectangle; `outbound_date`/`return_date` are vendor-required even with ranges. */
export function calendarParams(
  q: Pick<DiscoveryQuery, 'origin' | 'destination' | 'cabin'>,
  r: Extract<TileRequest, { kind: 'rectangle' }>,
  pointOfSale: string,
): Record<string, string> {
  return {
    engine: 'google_flights_calendar',
    departure_id: q.origin,
    arrival_id: q.destination,
    flight_type: 'round_trip',
    outbound_date: r.departFrom,
    outbound_date_start: r.departFrom,
    outbound_date_end: r.departTo,
    return_date: r.returnFrom,
    return_date_start: r.returnFrom,
    return_date_end: r.returnTo,
    separate_tickets: EXCLUDE_SEPARATE_TICKETS,
    ...common(pointOfSale, q.cabin),
  };
}

/**
 * `google_flights` parameters for one cell (spec §5.4). Steps 2 and 3 resend them plus one token: the docs show
 * this for `booking_token`; for `departure_token` it is evidenced by WP4b's SA-05 recording, not by the docs.
 * No `stops`: DiscoveryQuery has no maxStops, so neither engine filters stops (§13, Phase 4 gap).
 */
export function flightsParams(
  q: ItineraryQuery,
  pointOfSale: string,
  token?: { departure_token: string } | { booking_token: string },
): Record<string, string> {
  const p: Record<string, string> = {
    engine: 'google_flights',
    departure_id: q.origin,
    arrival_id: q.destination,
    flight_type: 'round_trip',
    outbound_date: q.departureDate,
    return_date: q.returnDate,
    sort_by: SORT_BY_PRICE,
    separate_tickets: EXCLUDE_SEPARATE_TICKETS,
    ...common(pointOfSale, q.cabin),
  };
  return token === undefined ? p : { ...p, ...token };
}

/** The request URL: endpoint plus the given parameters, nothing else (the key never travels in a URL). */
export function toUrl(params: Readonly<Record<string, string>>): URL {
  const u = new URL(SEARCHAPI_ENDPOINT);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

/** The one place the key is revealed: an Authorization header (spec §2 fact 8, §5.3). */
export function authHeaders(key: Secret): Record<string, string> {
  return { Authorization: `Bearer ${key.reveal()}`, Accept: 'application/json' };
}
