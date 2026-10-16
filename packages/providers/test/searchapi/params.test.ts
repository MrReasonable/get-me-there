import { asIata, asIsoDate, type ItineraryQuery } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { withContentHash } from '../../src/http/recorder.js';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import {
  assertPointOfSaleAllowed,
  authHeaders,
  calendarParams,
  flightsParams,
  SEARCHAPI_ENDPOINT_PATH,
  SEARCHAPI_PARAMS,
  TRAVEL_CLASS,
  toUrl,
} from '../../src/searchapi/params.js';
import { SENTINELS } from '../fakes.js';

const rect = {
  kind: 'rectangle',
  departFrom: asIsoDate('2026-11-02'),
  departTo: asIsoDate('2026-11-10'),
  returnFrom: asIsoDate('2026-11-12'),
  returnTo: asIsoDate('2026-12-01'),
} as const;
const calQ = { origin: asIata('LHR'), destination: asIata('JFK'), cabin: 'economy' as const };
const cellQ: ItineraryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2026-11-02'),
  returnDate: asIsoDate('2026-11-14'),
  cabin: 'economy',
  adults: 1,
  currency: 'GBP',
  expandTop: 2,
  bookingLinks: true,
};
const allowed = (params: Record<string, string>) => () =>
  assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, toUrl(params));

describe('SEARCHAPI_PARAMS (spec §5.2 dated allowlist, plan decision 24)', () => {
  it('has the two engine-qualified keys, names ascending, and a hash computed over its content', () => {
    expect(Object.keys(SEARCHAPI_PARAMS.endpoints).sort()).toEqual([
      '/api/v1/search?engine=google_flights',
      '/api/v1/search?engine=google_flights_calendar',
    ]);
    for (const e of Object.values(SEARCHAPI_PARAMS.endpoints)) expect(e.names).toEqual([...e.names].sort());
    const { contentSha256, ...rest } = SEARCHAPI_PARAMS;
    expect(withContentHash(rest).contentSha256).toBe(contentSha256);
  });

  it('sends adults=1, travel_class and separate_tickets=1 on both engines, sort_by=price on google_flights, never stops (decision 29)', () => {
    const cal = SEARCHAPI_PARAMS.endpoints['/api/v1/search?engine=google_flights_calendar'];
    const fl = SEARCHAPI_PARAMS.endpoints['/api/v1/search?engine=google_flights'];
    expect(cal?.values).toMatchObject({
      separate_tickets: ['1'],
      adults: ['1'],
      travel_class: ['business', 'economy', 'first_class', 'premium_economy'],
    });
    expect(fl?.values).toMatchObject({ adults: ['1'], sort_by: ['price'], separate_tickets: ['1'] });
    expect(cal?.names).not.toContain('stops');
    expect(fl?.names).not.toContain('stops');
    expect(cal?.names).not.toContain('sort_by');
  });
});

describe('request builders (spec §5.2 point of sale, §5.4 travel_class)', () => {
  it('calendar parameters: exact names and values, gl = POINT_OF_SALE lower-cased, hl=en, currency=GBP', () => {
    const p = calendarParams(calQ, rect, 'GB');
    expect(p).toEqual({
      engine: 'google_flights_calendar',
      departure_id: 'LHR',
      arrival_id: 'JFK',
      flight_type: 'round_trip',
      outbound_date: '2026-11-02',
      outbound_date_start: '2026-11-02',
      outbound_date_end: '2026-11-10',
      return_date: '2026-11-12',
      return_date_start: '2026-11-12',
      return_date_end: '2026-12-01',
      separate_tickets: '1',
      travel_class: 'economy',
      adults: '1',
      currency: 'GBP',
      gl: 'gb',
      hl: 'en',
    });
    expect(allowed(p)).not.toThrow();
  });

  it.each([
    ['economy', 'economy'],
    ['premium_economy', 'premium_economy'],
    ['business', 'business'],
    ['first', 'first_class'],
  ] as const)('cabin %s maps to travel_class %s on both engines', (cabin, value) => {
    expect(TRAVEL_CLASS[cabin]).toBe(value);
    expect(calendarParams({ ...calQ, cabin }, rect, 'GB').travel_class).toBe(value);
    expect(flightsParams({ ...cellQ, cabin }, 'GB').travel_class).toBe(value);
    expect(allowed(flightsParams({ ...cellQ, cabin }, 'GB'))).not.toThrow();
  });

  it('itinerary steps carry exactly the google_flights names; steps 2 and 3 add one token', () => {
    const s1 = flightsParams(cellQ, 'GB');
    expect(Object.keys(s1).sort()).toEqual([
      'adults',
      'arrival_id',
      'currency',
      'departure_id',
      'engine',
      'flight_type',
      'gl',
      'hl',
      'outbound_date',
      'return_date',
      'separate_tickets',
      'sort_by',
      'travel_class',
    ]);
    expect(flightsParams(cellQ, 'GB', { departure_token: 'tok' })).toEqual({ ...s1, departure_token: 'tok' });
    expect(flightsParams(cellQ, 'GB', { booking_token: 'tok' })).toEqual({ ...s1, booking_token: 'tok' });
    expect(allowed({ ...s1, booking_token: 'tok' })).not.toThrow();
  });

  it('ignores ItineraryQuery.maxStops: no stops parameter is ever sent (recorded gap, §13)', () => {
    expect(flightsParams({ ...cellQ, maxStops: 0 }, 'GB')).toEqual(flightsParams(cellQ, 'GB'));
  });

  it('holds each engine to its own names', () => {
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), departure_token: 'tok' })).toThrow();
    expect(allowed({ ...flightsParams(cellQ, 'GB'), outbound_date_start: '2026-11-02' })).toThrow();
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), sort_by: 'price' })).toThrow();
  });

  it('refuses an unknown name, a disallowed value and a stops filter', () => {
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), api_key: 'x' })).toThrow();
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), currency: 'USD' })).toThrow();
    expect(allowed({ ...flightsParams(cellQ, 'GB'), stops: 'nonstop' })).toThrow();
    expect(allowed({ ...flightsParams(cellQ, 'GB'), separate_tickets: '0' })).toThrow();
    expect(allowed({ ...calendarParams(calQ, rect, 'US') })).toThrow();
  });

  it('puts the key in Authorization: Bearer only, never in the URL (spec §2 fact 8)', () => {
    const key = SENTINELS.searchapi;
    expect(authHeaders(key)).toEqual({ Authorization: `Bearer ${key.reveal()}`, Accept: 'application/json' });
    expect(toUrl(flightsParams(cellQ, 'GB')).href).not.toContain(key.reveal());
  });
});

describe('assertPointOfSaleAllowed (spec §5.2)', () => {
  it('accepts the recorded point of sale and refuses another or a malformed one', () => {
    expect(() => assertPointOfSaleAllowed(SEARCHAPI_PARAMS, 'GB')).not.toThrow();
    expect(() => assertPointOfSaleAllowed(SEARCHAPI_PARAMS, 'US')).toThrow(
      /not in the .* SearchApi allowlist/,
    );
    expect(() => assertPointOfSaleAllowed(SEARCHAPI_PARAMS, 'gb')).toThrow(/upper-case ISO 3166-1/);
  });

  it('accepts any point of sale when an allowlist lists gl as any', () => {
    const open = {
      ...SEARCHAPI_PARAMS,
      endpoints: { '/api/v1/search': { names: ['gl'], values: { gl: 'any' as const } } },
    };
    expect(() => assertPointOfSaleAllowed(open, 'US')).not.toThrow();
  });
});
