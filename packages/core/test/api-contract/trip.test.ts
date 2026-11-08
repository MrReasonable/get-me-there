// Design 2026-11-08 §6.1 (plan Task 5): the trip read's contract. Every price carries its provenance; the query is the
// scope's wire form; the route is in ROUTES (the api's contract sweep iterates it). Synthetic values only.
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../../src/api-contract/index.js';
import { SKIP_REASONS, tripQuerySchema, tripResponseSchema } from '../../src/api-contract/trip.js';
import type { SkipReason } from '../../src/types/execution.js';

const calendarProvenance = {
  providerId: 'fixture',
  sourceKind: 'synthetic',
  fetchedAt: '2026-10-14T07:00:00.000Z',
  maxAgeHours: 24,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
const listProvenance = {
  providerId: 'camoufox',
  sourceKind: 'scraped-self',
  fetchedAt: '2026-10-14T08:00:00.000Z',
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
const price = (pricePence: number, provenance: unknown) => ({
  pricePence,
  provenance,
  stale: false,
  ageHours: 1,
  truncated: false,
});

/** A trip body with a failed newest list, two cells and log rows with and without prices. */
function body(): Record<string, unknown> {
  return {
    departureDate: '2026-11-02',
    returnDate: '2026-11-12',
    nights: 10,
    inWindow: true,
    figure: null,
    journeyLeftOut: 0,
    listFailure: { at: '2026-10-14T08:00:00.000Z', cause: 'network' },
    cells: [
      { origin: 'LHR', destination: 'JFK', bucket: 'priced', skipReason: null },
      { origin: 'LGW', destination: 'JFK', bucket: 'skipped', skipReason: 'budget' },
    ],
    flightList: null,
    bookingUrl: null,
    searchLink: null,
    booking: null,
    calendar: { ...price(38_800, calendarProvenance), notSeenAgain: false },
    cached: null,
    log: [
      {
        at: '2026-10-14T08:00:00.000Z',
        byHand: true,
        calendar: null,
        flights: {
          kind: 'trip',
          price: price(41_200, listProvenance),
          pairingKind: 'seller',
          seller: 'QQ Travel',
        },
      },
      {
        at: '2026-10-14T07:00:00.000Z',
        byHand: false,
        calendar: price(38_800, calendarProvenance),
        flights: { kind: 'failed', cause: 'limiter-timeout' },
      },
      { at: '2026-10-13T07:00:00.000Z', byHand: false, calendar: null, flights: { kind: 'not-read' } },
    ],
    reading: false,
    read: { available: true, unavailableReason: null, wouldGo: true, pagesPlanned: 2 },
    verificationConfigured: false,
    refreshHours: 168,
    limits: { maxJourneyMinutes: 1500, maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: null },
  };
}

describe('the trip contract (design 2026-11-08 §6.1)', () => {
  it('accepts a trip body', () => {
    expect(tripResponseSchema.safeParse(body()).error?.issues ?? []).toEqual([]);
  });

  it('refuses a log price without its provenance, and a calendar price without its stale mark', () => {
    const b = body();
    const [first, ...rest] = b.log as Array<Record<string, unknown>>;
    const noProvenance = {
      ...b,
      log: [
        {
          ...first,
          flights: {
            kind: 'trip',
            price: { ...price(41_200, listProvenance), provenance: undefined },
            pairingKind: 'seller',
            seller: null,
          },
        },
        ...rest,
      ],
    };
    expect(tripResponseSchema.safeParse(noProvenance).success).toBe(false);
    const { stale: _stale, ...unmarked } = price(38_800, calendarProvenance);
    expect(
      tripResponseSchema.safeParse({ ...b, calendar: { ...unmarked, notSeenAgain: false } }).success,
    ).toBe(false);
  });

  it('refuses a list failure without a STOP_DETAILS cause and an unknown skip reason', () => {
    expect(
      tripResponseSchema.safeParse({
        ...body(),
        listFailure: { at: '2026-10-14T08:00:00.000Z', cause: 'oops' },
      }).success,
    ).toBe(false);
    expect(
      tripResponseSchema.safeParse({
        ...body(),
        cells: [{ origin: 'LHR', destination: 'JFK', bucket: 'skipped', skipReason: 'tired' }],
      }).success,
    ).toBe(false);
  });

  it('a booking address is any string up to 2048 characters (Ruling 8: the web re-checks the path)', () => {
    expect(tripResponseSchema.safeParse({ ...body(), bookingUrl: 'x'.repeat(2048) }).success).toBe(true);
    expect(tripResponseSchema.safeParse({ ...body(), bookingUrl: 'x'.repeat(2049) }).success).toBe(false);
  });

  it('the query is strings under the scope names, both dates required', () => {
    expect(tripQuerySchema.safeParse({ departureDate: '2026-13-01', returnDate: 'x' }).success).toBe(true);
    expect(tripQuerySchema.safeParse({ departureDate: '2026-11-02' }).success).toBe(false);
    expect(
      tripQuerySchema.safeParse({
        departureDate: '2026-11-02',
        returnDate: '2026-11-12',
        origins: 'LGW',
        destinations: 'JFK',
        maxJourneyMinutes: '1500',
      }).success,
    ).toBe(true);
    expect(
      tripQuerySchema.safeParse({ departureDate: '2026-11-02', returnDate: '2026-11-12', row: 'x' }).success,
    ).toBe(false);
  });

  it('the route is in ROUTES with its query, behind auth', () => {
    const r = ROUTES.find((x) => x.path === '/api/definitions/:id/trip');
    expect(r).toMatchObject({
      method: 'GET',
      auth: 'required',
      query: tripQuerySchema,
      response: tripResponseSchema,
    });
  });

  it('SKIP_REASONS names every SkipReason once', () => {
    // why: a Record over the union is compile-time exhaustive, so a new SkipReason fails the typecheck here
    const all: Record<SkipReason, true> = {
      not_selected: true,
      budget: true,
      provider_disabled: true,
      provider_unavailable: true,
      scheduled_only: true,
      departed: true,
    };
    expect([...SKIP_REASONS].sort()).toEqual(Object.keys(all).sort());
  });
});
