// The google_flights step parsers and the route-history conversion, beside the chain that calls them.
import { type ItinerarySearchResult, isoDateSchema } from '@gmt/core';
import { parseError, parseVendor } from '../shared/errors.js';
import { majorToMinor } from '../shared/money.js';
import type { NoteCounter } from '../shared/notes.js';
import { SEARCHAPI_WHERE } from './params.js';
import {
  bookingResponseSchema,
  flightsResponseSchema,
  historyPointSchema,
  optionSchema,
  readEcho,
} from './shapes.js';

type RouteHistory = NonNullable<ItinerarySearchResult['routeHistory']>;

/**
 * Steps 1 and 2 (`step` names which in the message). A body with neither `best_flights` nor `other_flights` is a parse error, never "no options": an
 * unread key must not become positive evidence of no fares (spec §3 `empty`).
 */
export function parseFlights(body: unknown, gl: string, step: 'step 1' | 'step 2', notes: NoteCounter) {
  const data = parseVendor(flightsResponseSchema, body, 'malformed-flights', SEARCHAPI_WHERE);
  const echo = readEcho(data.search_parameters, gl);
  if (data.best_flights === undefined && data.other_flights === undefined)
    throw parseError(
      'no-options-key',
      `${step}: neither best_flights nor other_flights is present`,
      SEARCHAPI_WHERE,
    );
  const raw = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];
  // why: one wrongly shaped option is dropped and counted, never the whole step; options that were all malformed are
  // a vendor fault (parse), never "no options", which would read as no fares (CodeRabbit batch 3)
  const options = raw.flatMap((o) => {
    const r = optionSchema.safeParse(o);
    if (r.success) return [r.data];
    notes.add(`dropped-malformed-option-${step.replace(' ', '')}`);
    return [];
  });
  if (raw.length > 0 && options.length === 0)
    throw parseError(
      'malformed-flights',
      `${step}: every one of the ${raw.length} options is malformed`,
      SEARCHAPI_WHERE,
    );
  return {
    ...echo,
    options,
    // why: null when the vendor sent no series at all (plan decision 40: best-effort), told apart from an empty one.
    priceHistory: data.price_insights?.price_history ?? null,
  };
}

/** Step 3. A body without `booking_options` is a failed step 3 (the step-2 offer is kept, partial). */
export function parseBooking(body: unknown, gl: string) {
  const data = parseVendor(bookingResponseSchema, body, 'malformed-booking-options', SEARCHAPI_WHERE);
  const echo = readEcho(data.search_parameters, gl);
  if (data.booking_options === undefined)
    throw parseError('no-booking-options-key', 'step 3: booking_options is not present', SEARCHAPI_WHERE);
  return { ...echo, options: data.booking_options };
}

/**
 * `price_insights.price_history` as Google's price history for the searched trip, indicative (spec §2 bonus, §7 rev 28;
 * the vendor's docs describe `price_insights` as part of one search's answer for its dates, so the engine stores it in
 * route_price_history keyed by the trip's dates and cabin, GBP points only per plan decision 25, ruling 6). A point that is malformed, has an impossible date or a price the shared `majorToMinor` refuses is dropped and counted
 * `route-history-dropped`; it never fails the step. A response with no series at all yields an empty history and the
 * informational count `route-history-absent` (plan decision 40: best-effort).
 */
export function toRouteHistory(
  points: readonly unknown[] | null,
  currency: string,
  notes: NoteCounter,
): RouteHistory {
  const out: RouteHistory = [];
  if (points === null) {
    // why: plan decision 40: the series is best-effort (WP4b's recorded step 1 carries none), so its absence is an
    // informational count, never an error, an issue or a partial result.
    notes.add('route-history-absent');
    return out;
  }
  for (const raw of points) {
    const p = historyPointSchema.safeParse(raw);
    // why: `iso_date` is an instant (e.g. 2026-09-19T04:00:00Z); its UTC calendar date is the series day.
    const date = p.success ? isoDateSchema.safeParse(p.data.iso_date.slice(0, 10)) : null;
    // why: majorToMinor refuses a currency core has no exponent for, so no separate currency check is needed.
    const minor = p.success ? majorToMinor(p.data.price, currency) : null;
    if (date === null || !date.success || minor === null) {
      notes.add('route-history-dropped');
      continue;
    }
    out.push({ date: date.data, lowestPriceMinor: minor, currency });
  }
  return out;
}
