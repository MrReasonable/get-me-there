/**
 * Hand-built vendor requests and response readers for record:fixtures (brief section 6, spec §5.2,
 * §5.4, docs/providers.md). Credentials go in headers only (spec §2 fact 8); nothing here is an
 * airport, every code arrives as an argument.
 */
import { type Config, daysBetween, type IsoDate, isoDateSchema } from '@gmt/core';
import type { HttpKitDeps } from '@gmt/providers';

export const TP_URL = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
export const SA_URL = 'https://www.searchapi.io/api/v1/search';
/** Spec §5.2 measured page size. */
export const TP_PAGE_LIMIT = 1000;
/** Deliberately invalid credentials for the 401 probes; not secrets, never real keys. */
export const INVALID_SEARCHAPI_KEY = 'invalid-key-for-401-recording';
export const INVALID_TRAVELPAYOUTS_TOKEN = 'invalid-token-for-401-recording';

/** The worked example's cabin, sent as SearchApi `travel_class` on every request (spec §5.4, plan decision 20). */
export const RECORD_TRAVEL_CLASS = 'economy';

/** Passengers on every SearchApi request, sent explicitly (plan decision 24; vendor default 1). */
export const RECORD_ADULTS = '1';
/** google_flights only (plan decision 24): results sorted by price. */
export const RECORD_SORT_BY = 'price';
/** Both engines (plan decisions 24 and 29; the vendor documents it for both): separate-ticket itineraries excluded. */
export const RECORD_SEPARATE_TICKETS = '1';

/** A calendar rectangle (spec §5.2): outbound and return date ranges, both inclusive. */
export interface Rect {
  outFrom: IsoDate;
  outTo: IsoDate;
  retFrom: IsoDate;
  retTo: IsoDate;
  combinations: number;
}
/** One cell's dates. */
export interface CellDates {
  departure: IsoDate;
  return: IsoDate;
}

/**
 * Vendor limits while recording, from the configured provider limits (no preset fallback: the tool's
 * precheck has refused a missing provider). why: httpLimitsFor gains these providers only when WP5/WP6
 * add their lines; WP4b records before either exists. Costs equal the guard's configured per-call rates,
 * which reserve requires (WP3 rule 'cost'). Follow-up (arch M-5): once WP5/WP6 land, the body becomes
 * `{ travelpayouts: travelpayoutsHttpLimits(…), searchapi: searchApiHttpLimits(…) }`, so each vendor's hosts, billing
 * mode and classifyError have one definition.
 */
export function recordingLimits(
  tp: NonNullable<Config['providers']['travelpayouts']>,
  sa: NonNullable<Config['providers']['searchapi']>,
  timing: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>,
): HttpKitDeps['limits'] {
  const t = { maxWaitSeconds: timing.maxWaitSeconds, requestTimeoutSeconds: timing.requestTimeoutSeconds };
  return {
    travelpayouts: {
      hosts: ['api.travelpayouts.com'],
      ratePerMinute: tp.limits.ratePerMinute,
      ratePerHour: tp.limits.ratePerHour,
      concurrency: tp.limits.concurrency,
      billable: 'never',
      costPerCallMicroGbp: tp.limits.costPerCallMicroGbp,
      ...t,
    },
    searchapi: {
      hosts: ['www.searchapi.io'],
      ratePerMinute: sa.limits.ratePerMinute,
      ratePerHour: sa.limits.ratePerHour,
      concurrency: sa.limits.concurrency,
      billable: 'http-200',
      costPerCallMicroGbp: sa.limits.costPerCallMicroGbp,
      ...t,
    },
  };
}

/** One prices_for_dates page (spec §5.2 Travelpayouts month tiles). */
export function tpUrl(origin: string, destination: string, month: string, page: number): URL {
  const url = new URL(TP_URL);
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  url.searchParams.set('departure_at', month);
  url.searchParams.set('one_way', 'false');
  url.searchParams.set('currency', 'gbp');
  url.searchParams.set('limit', String(TP_PAGE_LIMIT));
  url.searchParams.set('page', String(page));
  return url;
}

export function saUrl(params: Readonly<Record<string, string>>): URL {
  const url = new URL(SA_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/** google_flights_calendar over one rectangle. outbound_date/return_date are required by the docs. */
export function calendarParams(
  origin: string,
  destination: string,
  r: Rect,
  gl: string,
): Record<string, string> {
  return {
    engine: 'google_flights_calendar',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: r.outFrom,
    outbound_date_start: r.outFrom,
    outbound_date_end: r.outTo,
    return_date: r.retFrom,
    return_date_start: r.retFrom,
    return_date_end: r.retTo,
    flight_type: 'round_trip',
    travel_class: RECORD_TRAVEL_CLASS,
    adults: RECORD_ADULTS,
    separate_tickets: RECORD_SEPARATE_TICKETS,
    currency: 'GBP',
    gl,
    hl: 'en',
  };
}

/** google_flights for one cell; steps 2 and 3 add one token (spec §5.4). */
export function flightsParams(
  origin: string,
  destination: string,
  cell: CellDates,
  gl: string,
  token: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    engine: 'google_flights',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: cell.departure,
    return_date: cell.return,
    flight_type: 'round_trip',
    travel_class: RECORD_TRAVEL_CLASS,
    adults: RECORD_ADULTS,
    sort_by: RECORD_SORT_BY,
    separate_tickets: RECORD_SEPARATE_TICKETS,
    currency: 'GBP',
    gl,
    hl: 'en',
    ...token,
  };
}

/** Plain-object guard for vendor JSON; the one copy the record tool's modules share. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Cheapest priced calendar entry inside the requested rectangle whose nights fall inside `band` (pie-006: the chain
 * is recorded for a cell the worked example would verify; prov-wp04b-r2-002: an entry outside the rectangle the vendor
 * returns anyway is ignored, so step 1 can never equal the 401 probe's cell). Entries with has_no_flights, no price or
 * malformed dates are skipped.
 */
export function cheapestCalendarCell(
  body: unknown,
  band: { minNights: number; maxNights: number },
  rect: Rect,
): (CellDates & { price: number }) | null {
  if (!isRecord(body) || !Array.isArray(body.calendar)) return null;
  let best: (CellDates & { price: number }) | null = null;
  for (const e of body.calendar) {
    if (!isRecord(e) || e.has_no_flights === true || typeof e.price !== 'number') continue;
    const departure = isoDateSchema.safeParse(e.departure);
    const ret = isoDateSchema.safeParse(e.return);
    if (!departure.success || !ret.success) continue;
    if (
      departure.data < rect.outFrom ||
      departure.data > rect.outTo ||
      ret.data < rect.retFrom ||
      ret.data > rect.retTo
    )
      continue;
    const nights = daysBetween(departure.data, ret.data);
    if (nights < band.minNights || nights > band.maxNights) continue;
    if (best === null || e.price < best.price)
      best = { departure: departure.data, return: ret.data, price: e.price };
  }
  return best;
}

/** True when a calendar body carries no priced entry (the over-limit probe's "empty response" from the docs). */
export function calendarIsEmpty(body: unknown): boolean {
  return !isRecord(body) || !Array.isArray(body.calendar) || body.calendar.length === 0;
}

/** Cheapest option carrying a price and the given token, over best_flights then other_flights; unpriced options are skipped (spec §5.4). */
export function cheapestOption(
  body: unknown,
  tokenField: 'departure_token' | 'booking_token',
): { token: string; price: number } | null {
  if (!isRecord(body)) return null;
  let best: { token: string; price: number } | null = null;
  for (const list of [body.best_flights, body.other_flights]) {
    if (!Array.isArray(list)) continue;
    for (const o of list) {
      if (!isRecord(o)) continue;
      const token = o[tokenField];
      const price = o.price;
      if (typeof token !== 'string' || typeof price !== 'number') continue;
      if (best === null || price < best.price) best = { token, price };
    }
  }
  return best;
}

/** Row count of a prices_for_dates envelope (0 for a malformed one). */
export function dataRowCount(body: unknown): number {
  return isRecord(body) && Array.isArray(body.data) ? body.data.length : 0;
}

/** Step-3 booking options as (seller, price), cheapest first; options without both are skipped. */
export function bookingOptions(body: unknown): Array<{ bookWith: string; price: number }> {
  if (!isRecord(body) || !Array.isArray(body.booking_options)) return [];
  const out: Array<{ bookWith: string; price: number }> = [];
  for (const o of body.booking_options) {
    if (isRecord(o) && typeof o.book_with === 'string' && typeof o.price === 'number')
      out.push({ bookWith: o.book_with, price: o.price });
  }
  return out.sort((a, b) => a.price - b.price);
}
