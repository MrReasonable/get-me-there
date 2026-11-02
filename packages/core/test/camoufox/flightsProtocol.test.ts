// Spec revision 55 §2 "The flight-list read" and §5.1 (WP20 Task 20.7): the worker protocol's flights request and
// answer. Synthetic flights; the worked example's airports (London → New York) only.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANSWER_STATUS,
  flightsRequestSchema,
  listRequestSchema,
  pageRequestSchema,
  workerAnswerSchema,
} from '../../src/camoufox/protocol.js';
import { FLIGHT_LIST_ENDPOINT_PATH, FLIGHT_LIST_MAX_FLIGHTS } from '../../src/flights/limits.js';

const fields = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2027-11-05',
  returnDate: '2027-11-15',
  gl: 'GB',
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
};
const versions = { selectors: 's', grammar: '2026-10-31-times', camoufoxJs: '0.11.5', binary: 'b' };
// A synthetic flight (no recording's): the worked example's shape only.
const flight = {
  departsLocal: '12:25',
  arrivesLocal: '20:05',
  arrivesDayOffset: 0,
  durationMinutes: 760,
  stops: 1,
  carriers: ['QQ Air'],
  operatedBy: null,
  amountMinor: 47_800,
};
const answer = (o: Record<string, unknown> = {}) => ({
  kind: 'flights',
  fetchedAt: '2027-10-01T10:00:00.000Z',
  currency: 'GBP',
  pointOfSale: 'GB',
  listed: 'flights',
  flights: [flight],
  minMinor: 47_800,
  tabMinor: 45_100,
  cheapestView: 'cheapest',
  optionsUnparsed: 0,
  optionsOtherCell: 0,
  resultsStated: 23,
  notes: [],
  versions,
  ...o,
});
const ok = (a: unknown): boolean => workerAnswerSchema.safeParse(a).success;

beforeEach(() => {
  expect.hasAssertions();
});

describe('flightsRequestSchema (spec rev 55 §2: POST /v1/flights admits only mode flights)', () => {
  it("accepts the list request's fields with mode 'flights' and refuses mode 'list'", () => {
    expect(flightsRequestSchema.safeParse({ mode: 'flights', ...fields }).success).toBe(true);
    expect(flightsRequestSchema.safeParse({ mode: 'list', ...fields }).success).toBe(false);
  });
  it('keeps the shared refinements: one cell, two different airports', () => {
    expect(
      flightsRequestSchema.safeParse({ mode: 'flights', ...fields, returnDate: fields.departureDate })
        .success,
    ).toBe(false);
    expect(flightsRequestSchema.safeParse({ mode: 'flights', ...fields, destination: 'LHR' }).success).toBe(
      false,
    );
    expect(
      flightsRequestSchema.safeParse({
        mode: 'flights',
        ...fields,
        airportNames: { origin: [], destination: ['x'] },
      }).success,
    ).toBe(false);
  });
  it('leaves the list request as it was, and pageRequestSchema still refuses a flights request', () => {
    expect(listRequestSchema.safeParse({ mode: 'list', ...fields }).success).toBe(true);
    expect(listRequestSchema.safeParse({ mode: 'flights', ...fields }).success).toBe(false);
    expect(listRequestSchema.safeParse({ mode: 'list', ...fields, returnDate: '2027-11-05' }).success).toBe(
      false,
    );
    expect(pageRequestSchema.safeParse({ mode: 'flights', ...fields }).success).toBe(false);
    expect(pageRequestSchema.safeParse({ mode: 'list', ...fields }).success).toBe(true);
  });
});

describe("workerAnswerSchema's flights answer (spec rev 55 §2)", () => {
  it('accepts 30 flights and refuses 31', () => {
    expect(FLIGHT_LIST_MAX_FLIGHTS).toBe(30);
    expect(ok(answer({ flights: Array.from({ length: 30 }, () => flight) }))).toBe(true);
    expect(ok(answer({ flights: Array.from({ length: 31 }, () => flight) }))).toBe(false);
  });
  it('refuses a departure of 24:00, an arrival day offset of 4 and an empty carrier list', () => {
    expect(ok(answer({ flights: [{ ...flight, departsLocal: '24:00' }] }))).toBe(false);
    expect(ok(answer({ flights: [{ ...flight, arrivesLocal: '9:05' }] }))).toBe(false);
    expect(ok(answer({ flights: [{ ...flight, arrivesDayOffset: 3 }] }))).toBe(true);
    expect(ok(answer({ flights: [{ ...flight, arrivesDayOffset: 4 }] }))).toBe(false);
    expect(ok(answer({ flights: [{ ...flight, carriers: [] }] }))).toBe(false);
  });
  it('refuses a carrier holding a control or a bidi character', () => {
    expect(ok(answer({ flights: [{ ...flight, carriers: ['QQ\u0007Air'] }] }))).toBe(false);
    expect(ok(answer({ flights: [{ ...flight, carriers: ['QQ‮Air'] }] }))).toBe(false);
    expect(ok(answer({ flights: [{ ...flight, operatedBy: 'QQ‏Air' }] }))).toBe(false);
  });
  it("refuses listed 'flights' with no flight, and accepts the other two outcomes with none", () => {
    expect(ok(answer({ flights: [] }))).toBe(false);
    expect(ok(answer({ listed: 'no-flights', flights: [], minMinor: null, tabMinor: null }))).toBe(true);
    expect(ok(answer({ listed: 'none-for-cell', flights: [], minMinor: null }))).toBe(true);
    expect(ok(answer({ listed: 'no-flights', flights: [flight] }))).toBe(false);
  });
  it('refuses a price of 0 (ruling A28) and a currency other than GBP', () => {
    expect(ok(answer({ flights: [{ ...flight, amountMinor: 0 }] }))).toBe(false);
    expect(ok(answer({ currency: 'EUR' }))).toBe(false);
    expect(ok(answer({ cheapestView: 'best' }))).toBe(false);
    expect(ok(answer({ cheapestView: null }))).toBe(true);
  });
  it('stays under about 25 KB at the schema’s limits (spec rev 55 §2)', () => {
    const name = 'Q'.repeat(80);
    const widest = {
      ...flight,
      carriers: Array.from({ length: 6 }, () => name),
      operatedBy: name,
      durationMinutes: 6000,
      amountMinor: 99_999_999,
    };
    const a = answer({ flights: Array.from({ length: 30 }, () => widest) });
    expect(ok(a)).toBe(true);
    expect(JSON.stringify(a).length).toBeLessThan(25 * 1024);
  });
  it('answers 200, as cells and grid do', () => {
    expect(ANSWER_STATUS.flights).toBe(200);
  });
  // why: the worker serves the flight-list read at this path and the app posts to it; the two must name the same one
  it('is served at POST /v1/flights', () => {
    expect(FLIGHT_LIST_ENDPOINT_PATH).toBe('/v1/flights');
  });
  it("names the flights field and says why when listed 'flights' holds none", () => {
    expect(workerAnswerSchema.safeParse(answer({ flights: [] })).error?.issues).toEqual([
      { code: 'custom', path: ['flights'], message: "listed 'flights' exactly when a flight was read" },
    ]);
  });
  it.each(['xGB', 'GBx', 'GB unknown', 'unknownGB'])('refuses a stated pointOfSale of %s', (pointOfSale) => {
    expect(ok(answer({ pointOfSale }))).toBe(false);
  });
  it('accepts pointOfSale unknown and either cheapest view the read may have taken', () => {
    expect(ok(answer({ pointOfSale: 'unknown' }))).toBe(true);
    expect(ok(answer({ cheapestView: 'best-fallback' }))).toBe(true);
  });
});
