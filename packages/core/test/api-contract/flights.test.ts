// Spec revision 55 §10 (WP20 Task 20.7): the flight-list contract. A list carries the browser worker's provenance
// only; `read` lists say what was listed, `failed` lists say why in one STOP_DETAILS word; links stay on Google's host.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  flightListSchema,
  flightListsQuerySchema,
  flightListsResponseSchema,
  readFlightListRequestSchema,
  readFlightListResponseSchema,
} from '../../src/api-contract/flights.js';
import { MAX_FLIGHT_LIST_PAIRS } from '../../src/flights/limits.js';

// A synthetic flight (no recording's), on the worked example's route.
const flight = {
  departsLocal: '09:05',
  arrivesLocal: '12:10',
  arrivesDayOffset: 0,
  durationMinutes: 485,
  stops: 0,
  carriers: ['QQ Air'],
  operatedBy: null,
  amountMinor: 47_800,
};
const list = (o: Record<string, unknown> = {}) => ({
  id: 1,
  executionId: 'exec-1',
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2027-03-14',
  returnDate: '2027-03-24',
  fetchedAt: '2027-03-01T10:00:00.000Z',
  ageHours: 2,
  stale: false,
  provenance: {
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    fetchedAt: '2027-03-01T10:00:00.000Z',
    maxAgeHours: 0,
    fx: { converted: false },
    pointOfSale: 'GB',
    cabin: 'economy',
  },
  status: 'read',
  reason: null,
  listed: 'flights',
  minMinor: 47_800,
  tabMinor: 45_100,
  cheapestView: 'cheapest',
  flights: [flight],
  optionsUnparsed: 0,
  optionsOtherCell: 0,
  resultsStated: 23,
  ...o,
});
const failed = (o: Record<string, unknown> = {}) =>
  list({
    status: 'failed',
    reason: 'blocked',
    listed: null,
    minMinor: null,
    tabMinor: null,
    cheapestView: null,
    flights: [],
    resultsStated: null,
    ...o,
  });
const ok = (x: unknown): boolean => flightListSchema.safeParse(x).success;
const pair = (link: unknown, l: unknown = list()) => ({
  departureDate: '2027-03-14',
  returnDate: '2027-03-24',
  origin: 'LHR',
  destination: 'JFK',
  link,
  list: l,
  listOtherPair: null,
});
const response = (pairs: unknown[]) => ({
  available: true,
  unavailableReason: null,
  refreshHours: 168,
  monthlyPagesLeft: 1390,
  runPages: 110,
  reading: null,
  pairs,
});
const LINK = {
  url: 'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2027-03-14+returning+2027-03-24&curr=GBP&hl=en-GB&gl=GB',
  host: 'www.google.com',
  label: 'search link, not a fare link',
};
const pairsText = (n: number): string =>
  Array.from({ length: n }, (_, i) => `2027-03-${String((i % 28) + 1).padStart(2, '0')}_2027-04-01`).join(
    ',',
  );

beforeEach(() => {
  expect.hasAssertions();
});

describe('flightListSchema (spec rev 55 §10)', () => {
  it('accepts a read list and a failed one', () => {
    expect(ok(list())).toBe(true);
    expect(ok(failed())).toBe(true);
    expect(ok(list({ listed: 'no-flights', flights: [], minMinor: null, tabMinor: null }))).toBe(true);
  });
  it("refuses status 'read' with listed null, and with a reason", () => {
    expect(ok(list({ listed: null }))).toBe(false);
    expect(ok(list({ reason: 'blocked' }))).toBe(false);
  });
  it("refuses status 'failed' with reason null, and with a listed outcome", () => {
    expect(ok(failed({ reason: null }))).toBe(false);
    expect(ok(failed({ listed: 'flights' }))).toBe(false);
  });
  it('refuses a reason outside STOP_DETAILS; accepts the airport-names one (ruling A29)', () => {
    expect(ok(failed({ reason: 'the page went away' }))).toBe(false);
    expect(ok(failed({ reason: 'no-airport-names' }))).toBe(true);
  });
  it('refuses any provenance but the browser worker’s, read in GBP, economy, maxAgeHours 0', () => {
    const p = list().provenance;
    expect(ok(list({ provenance: { ...p, providerId: 'fixture' } }))).toBe(false);
    expect(ok(list({ provenance: { ...p, sourceKind: 'synthetic' } }))).toBe(false);
    expect(ok(list({ provenance: { ...p, cabin: 'business' } }))).toBe(false);
    expect(ok(list({ provenance: { ...p, maxAgeHours: 24 } }))).toBe(false);
    expect(
      ok(
        list({
          provenance: { ...p, fx: { converted: true, rateNano: 1, rateDate: '2027-03-01', source: 'x' } },
        }),
      ),
    ).toBe(false);
  });
  it("refuses 'flights' with an empty list, more than 30 flights, and a flight price of 0 (ruling A28)", () => {
    expect(ok(list({ flights: [] }))).toBe(false);
    expect(ok(list({ flights: Array.from({ length: 31 }, () => flight) }))).toBe(false);
    expect(ok(list({ flights: [{ ...flight, amountMinor: 0 }] }))).toBe(false);
  });
});

describe('flightListSchema prices and stale mark (ruling A28; spec rev 55 §10 "every price-bearing shape")', () => {
  it('refuses a minimum or tab price of 0, as the worker protocol and the database do', () => {
    expect(ok(list({ minMinor: 0 }))).toBe(false);
    expect(ok(list({ tabMinor: 0 }))).toBe(false);
    expect(ok(list({ minMinor: 1, tabMinor: 1 }))).toBe(true);
  });
  it("carries the stale mark ('refresh' once older than the camoufox refresh), never a bare true", () => {
    expect(ok(list({ stale: 'refresh' }))).toBe(true);
    expect(ok(list({ stale: false }))).toBe(true);
    expect(ok(list({ stale: true }))).toBe(false);
  });
});

describe('flightListsResponseSchema links (spec rev 55 §6.9)', () => {
  it('accepts a Google https link and a null one', () => {
    expect(flightListsResponseSchema.safeParse(response([pair(LINK), pair(null, null)])).success).toBe(true);
  });
  it('refuses a link whose url is not https:// or whose host is not www.google.com', () => {
    expect(
      flightListsResponseSchema.safeParse(
        response([pair({ ...LINK, url: LINK.url.replace('https', 'http') })]),
      ).success,
    ).toBe(false);
    expect(
      flightListsResponseSchema.safeParse(response([pair({ ...LINK, host: 'flights.example.com' })])).success,
    ).toBe(false);
  });
});

describe('flightListsResponseSchema runPages (ruling R-pages)', () => {
  it("carries one run's browser pages, or null; never absent or negative", () => {
    expect(flightListsResponseSchema.safeParse({ ...response([]), runPages: null }).success).toBe(true);
    expect(flightListsResponseSchema.safeParse({ ...response([]), runPages: -1 }).success).toBe(false);
    const { runPages: _r, ...without } = response([]);
    expect(flightListsResponseSchema.safeParse(without).success).toBe(false);
  });
});

describe('flightListsResponseSchema link host (20.7 review finding 3)', () => {
  it('refuses a link whose url names another host than the one it states', () => {
    expect(
      flightListsResponseSchema.safeParse(
        response([pair({ ...LINK, url: 'https://flights.example.com/travel/flights?q=x' })]),
      ).success,
    ).toBe(false);
    expect(flightListsResponseSchema.safeParse(response([pair({ ...LINK, url: 'https://' })])).success).toBe(
      false,
    );
  });
});

describe('flightListsQuerySchema and the on-demand read (spec rev 55 §10)', () => {
  // why: spec §10 — 0 or 51 pairs are the handler's 422 `invalid_pairs` (Task 20.9), so the schema lets them through and
  // refuses only a string far past any valid one
  it(`accepts ${MAX_FLIGHT_LIST_PAIRS} and 51 pairs for the handler to judge, and refuses a string past 4,096 characters`, () => {
    expect(flightListsQuerySchema.safeParse({ pairs: pairsText(MAX_FLIGHT_LIST_PAIRS) }).success).toBe(true);
    expect(flightListsQuerySchema.safeParse({ pairs: pairsText(51) }).success).toBe(true);
    expect(flightListsQuerySchema.safeParse({ pairs: 'x'.repeat(4097) }).success).toBe(false);
  });
  it('reads one date pair and accepts it', () => {
    expect(
      readFlightListRequestSchema.safeParse({ departureDate: '2027-03-14', returnDate: '2027-03-24' })
        .success,
    ).toBe(true);
    expect(
      readFlightListRequestSchema.safeParse({ departureDate: '14/03/2027', returnDate: '2027-03-24' })
        .success,
    ).toBe(false);
    expect(readFlightListResponseSchema.safeParse({ accepted: true }).success).toBe(true);
    expect(readFlightListResponseSchema.safeParse({ accepted: false }).success).toBe(false);
  });
});

describe("flightListSchema's returns and the response's pagesPlanned (spec rev 56 §10)", () => {
  const ret = {
    departsLocal: '14:20',
    arrivesLocal: '06:25',
    arrivesDayOffset: 1,
    durationMinutes: 725,
    stops: 1,
    carriers: ['QQ Atlantic'],
    operatedBy: null,
    fromMinor: 118_000,
  };
  const returns = (outboundIndex: number) => ({
    limits: { maxJourneyMinutes: 1500, maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: null },
    status: 'read',
    rule: null,
    attempts: [
      {
        outboundIndex,
        outboundFits: true,
        listed: 'returns',
        moreListed: true,
        returns: [ret],
        optionsUnparsed: 0,
        optionsOtherCell: 0,
        resultsStated: null,
      },
    ],
    triedAll: false,
    booking: null,
  });
  it('accepts a list without returns, with returns: null, and with a read of outbound 0 of one flight', () => {
    expect(flightListSchema.safeParse(list()).success).toBe(true);
    expect(flightListSchema.safeParse(list({ returns: null })).success).toBe(true);
    expect(flightListSchema.safeParse(list({ returns: returns(0) })).error?.issues ?? []).toEqual([]);
  });
  it('refuses outboundIndex 1 with one flight, returns: undefined, and a return read the contract refuses', () => {
    expect(flightListSchema.safeParse(list({ returns: returns(1) })).success).toBe(false);
    expect(flightListSchema.safeParse(list({ returns: undefined })).success).toBe(false);
    expect(flightListSchema.safeParse(list({ returns: { ...returns(0), attempts: [] } })).success).toBe(
      false,
    );
  });
  it('the response takes pagesPlanned (a count) and goes without it', () => {
    expect(flightListsResponseSchema.safeParse({ ...response([]), pagesPlanned: 2 }).success).toBe(true);
    expect(flightListsResponseSchema.safeParse(response([])).success).toBe(true);
    expect(flightListsResponseSchema.safeParse({ ...response([]), pagesPlanned: -1 }).success).toBe(false);
  });
});
