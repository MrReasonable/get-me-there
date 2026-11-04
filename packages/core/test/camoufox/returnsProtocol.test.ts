// Spec revision 56 §2 "The return phase" and §5.1: the worker protocol's return asks (`returnLimits`, `booking`), the
// answer's `returns`, `pagesLoaded` and `nextLoadNotBefore`, and the offer grammar's version. Synthetic flights,
// returns and sellers (QQ Travel, QQ Fares); the worked example's airports (London → New York) only.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  flightsRequestSchema,
  pageRequestSchema,
  versionsSchema,
  workerAnswerSchema,
  workerRuleSchema,
} from '../../src/camoufox/protocol.js';
import { workerRuleSchema as leafRule } from '../../src/camoufox/rule.js';
import { BOOKING_OFFERS_MAX, FLIGHT_LIST_MAX_FLIGHTS } from '../../src/flights/limits.js';
import { BOOKING_STATUS, RETURN_STATUS } from '../../src/flights/returns.js';

const fields = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2027-11-05',
  returnDate: '2027-11-15',
  gl: 'GB',
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
    otherOrigins: [],
    otherDestinations: [],
  },
};
const versions = { selectors: 's', grammar: '2026-10-31-times', camoufoxJs: '0.11.5', binary: 'b' };
const NULL_LIMITS = {
  maxJourneyMinutes: null,
  maxStops: null,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
const LIMITS = {
  maxJourneyMinutes: 1500,
  maxStops: 1,
  departureWindowLocal: { from: '08:00', to: '20:00' },
  arrivalWindowLocal: { from: '06:00', to: '23:00' },
};

/** The longest name the flight text admits (80 characters), so the size bound is checked at the schema's limits. */
const LONG = 'Q'.repeat(80);
const flight = (long = false) => ({
  departsLocal: '12:25',
  arrivesLocal: '20:05',
  arrivesDayOffset: 0,
  durationMinutes: 760,
  stops: 1,
  carriers: long ? Array.from({ length: 6 }, () => LONG) : ['QQ Air'],
  operatedBy: long ? LONG : null,
  amountMinor: 47_800,
});
const ret = (stops: number, long = false) => ({
  departsLocal: '14:20',
  arrivesLocal: '06:25',
  arrivesDayOffset: 1,
  durationMinutes: 725,
  stops,
  carriers: long ? Array.from({ length: 6 }, () => LONG) : ['QQ Atlantic'],
  operatedBy: long ? LONG : null,
  fromMinor: 118_000,
});
const attempt = (outboundIndex: number, returns: unknown[]) => ({
  outboundIndex,
  outboundFits: true,
  listed: returns.length > 0 ? 'returns' : 'none-for-cell',
  moreListed: true,
  returns,
  optionsUnparsed: 0,
  optionsOtherCell: returns.length > 0 ? 0 : 1,
  resultsStated: null,
});
const NO_BOOKING = {
  status: 'no-pairing',
  rule: null,
  attempt: null,
  returnIndex: null,
  expanded: false,
  moreControl: false,
  grouped: 0,
  offers: [],
  unparsed: 0,
  nonGbp: 0,
  offersStated: null,
};
/** A return read of `status` (its attempts and rule as the refinements require). */
function returnsOf(status: string): Record<string, unknown> {
  const read = status === 'read';
  const ruled = ['skipped', 'select-failed', 'not-settled', 'unrecognised'].includes(status);
  return {
    limits: LIMITS,
    status,
    rule: ruled ? 'monthly-headroom' : null,
    attempts: read ? [attempt(0, [ret(1)])] : [],
    triedAll: false,
    booking: read
      ? {
          ...NO_BOOKING,
          status: 'read',
          attempt: 0,
          returnIndex: 0,
          expanded: true,
          offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 118_000 }],
        }
      : null,
  };
}
const answer = (o: Record<string, unknown> = {}) => ({
  kind: 'flights',
  fetchedAt: '2027-10-01T10:00:00.000Z',
  currency: 'GBP',
  pointOfSale: 'GB',
  listed: 'flights',
  flights: [flight()],
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
const req = (o: Record<string, unknown> = {}) =>
  flightsRequestSchema.safeParse({ mode: 'flights', ...fields, ...o }).success;

beforeEach(() => {
  expect.hasAssertions();
});

describe('flightsRequestSchema: returnLimits and booking (spec rev 56 §2, §5.1)', () => {
  it('accepts returnLimits (all null; with maxStops and windows), with and without booking', () => {
    for (const returnLimits of [NULL_LIMITS, LIMITS]) {
      expect(req({ returnLimits })).toBe(true);
      expect(req({ returnLimits, booking: true })).toBe(true);
      expect(req({ returnLimits, booking: false })).toBe(true);
    }
    expect(req()).toBe(true);
  });
  it('refuses returnLimits: undefined, booking without returnLimits, and limits the schema refuses', () => {
    expect(req({ returnLimits: undefined })).toBe(false);
    expect(req({ booking: true })).toBe(false);
    expect(req({ booking: false })).toBe(false);
    // why: the refusal names the field and says why, so the worker's 400 is actionable
    expect(
      flightsRequestSchema.safeParse({ mode: 'flights', ...fields, booking: true }).error?.issues,
    ).toEqual([{ code: 'custom', path: ['booking'], message: 'booking is asked only with returnLimits' }]);
    expect(req({ returnLimits: { ...LIMITS, maxStops: -1 } })).toBe(false);
    // why: maxStops is required since Task 21.7 (R-order); the app always sends flightLimitsOf's null for "not set"
    const { maxStops: _m, ...noStops } = LIMITS;
    expect(req({ returnLimits: noStops })).toBe(false);
  });
  it('pageRequestSchema refuses a list request carrying returnLimits', () => {
    expect(pageRequestSchema.safeParse({ mode: 'list', ...fields }).success).toBe(true);
    expect(pageRequestSchema.safeParse({ mode: 'list', ...fields, returnLimits: LIMITS }).success).toBe(
      false,
    );
  });
});

describe('the answers to a request with returnLimits (spec rev 56 §2: pagesLoaded and nextLoadNotBefore)', () => {
  const kinds: Array<[string, Record<string, unknown>]> = [
    ['flights', answer()],
    ['blocked', { kind: 'blocked', page: 'unrecognised', cooldownUntil: '2027-10-02T10:00:00.000Z' }],
    ['not-ready', { kind: 'not-ready', elapsedMs: 90_000 }],
    ['browser-error', { kind: 'browser-error', stage: 'navigate', detail: 'x' }],
    ['cooling-down', { kind: 'cooling-down', cause: 'captcha', cooldownUntil: '2027-10-02T10:00:00.000Z' }],
    ['monthly-cap', { kind: 'monthly-cap', cap: 1500, used: 1500, windowEnd: '2027-11-01T00:00:00.000Z' }],
    ['spacing', { kind: 'spacing', retryAfterSeconds: 30 }],
    ['counts-unreadable', { kind: 'counts-unreadable', problem: 'missing' }],
  ];
  it.each(kinds)(
    '%s accepts pagesLoaded (0 included) and nextLoadNotBefore, and goes without them',
    (_k, a) => {
      expect(ok(a)).toBe(true);
      expect(ok({ ...a, pagesLoaded: 0 })).toBe(true);
      expect(ok({ ...a, pagesLoaded: 2, nextLoadNotBefore: '2027-10-01T10:00:30.000Z' })).toBe(true);
      expect(ok({ ...a, pagesLoaded: -1 })).toBe(false);
      expect(ok({ ...a, nextLoadNotBefore: 'soon' })).toBe(false);
    },
  );
  it('the grid and cells answers stay as they were (no page count)', () => {
    expect(ok({ kind: 'mode-unavailable', mode: 'grid', pagesLoaded: 0 })).toBe(false);
  });
});

describe("the flights answer's returns (spec rev 56 §5.1)", () => {
  it.each([...RETURN_STATUS])('accepts returns of status %s', (status) => {
    expect(workerAnswerSchema.safeParse(answer({ returns: returnsOf(status) })).error?.issues ?? []).toEqual(
      [],
    );
  });
  it('goes without the key, and refuses returns: undefined', () => {
    expect(ok(answer())).toBe(true);
    expect(ok(answer({ returns: undefined }))).toBe(false);
  });
  it("refuses an attempt's outboundIndex at or past flights.length", () => {
    const r = returnsOf('read');
    expect(ok(answer({ returns: { ...r, attempts: [attempt(1, [ret(1)])] } }))).toBe(false);
    expect(
      workerAnswerSchema.safeParse(answer({ returns: { ...r, attempts: [attempt(1, [ret(1)])] } })).error
        ?.issues,
    ).toEqual([
      {
        code: 'custom',
        path: ['returns', 'attempts', 0, 'outboundIndex'],
        message: "an attempt's outbound is one of the answer's flights",
      },
    ]);
    expect(
      ok(answer({ flights: [flight(), flight()], returns: { ...r, attempts: [attempt(1, [ret(1)])] } })),
    ).toBe(true);
  });
  it('refuses what returnReadSchema refuses (a read without attempts; a booking past its attempt)', () => {
    expect(ok(answer({ returns: { ...returnsOf('read'), attempts: [] } }))).toBe(false);
    const r = returnsOf('read');
    expect(
      ok(
        answer({
          returns: {
            ...r,
            booking: {
              ...NO_BOOKING,
              status: 'read',
              attempt: 0,
              returnIndex: 1,
              offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 1 }],
            },
          },
        }),
      ),
    ).toBe(false);
  });
  it('the booking statuses each parse inside a read', () => {
    for (const status of BOOKING_STATUS) {
      const withAttempt = ['read', 'select-failed', 'not-settled', 'unrecognised', 'expand-failed'].includes(
        status,
      );
      const ruled = ['skipped', 'select-failed', 'not-settled', 'unrecognised', 'expand-failed'].includes(
        status,
      );
      const offers = ['read', 'expand-failed'].includes(status)
        ? [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }]
        : [];
      const booking = {
        ...NO_BOOKING,
        status,
        rule: ruled ? 'booking-view' : null,
        attempt: withAttempt ? 0 : null,
        returnIndex: withAttempt ? 0 : null,
        offers,
      };
      expect(ok(answer({ returns: { ...returnsOf('read'), booking } })), status).toBe(true);
    }
  });
  it('a flights answer at the limits (two attempts of 30 returns, 30 flights, 40 offers) stays under 100 KB', () => {
    const over = Array.from({ length: FLIGHT_LIST_MAX_FLIGHTS }, () => ret(2, true));
    const fitting = Array.from({ length: FLIGHT_LIST_MAX_FLIGHTS }, () => ret(1, true));
    const offers = Array.from({ length: BOOKING_OFFERS_MAX }, (_x, i) => ({
      seller: LONG,
      fare: LONG,
      priceMinor: 118_000 + i,
    }));
    const big = answer({
      flights: Array.from({ length: FLIGHT_LIST_MAX_FLIGHTS }, () => flight(true)),
      pagesLoaded: 2,
      nextLoadNotBefore: '2027-10-01T10:00:30.000Z',
      returns: {
        limits: LIMITS,
        status: 'read',
        rule: null,
        attempts: [attempt(0, over), attempt(1, fitting)],
        triedAll: true,
        booking: {
          ...NO_BOOKING,
          status: 'read',
          attempt: 1,
          returnIndex: 0,
          expanded: true,
          offers,
          offersStated: 52,
        },
      },
    });
    expect(workerAnswerSchema.safeParse(big).error?.issues ?? []).toEqual([]);
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThan(100 * 1024);
  });
});

describe('versionsSchema and the worker rule (spec rev 56 §5.1)', () => {
  it('accepts offerGrammar and goes without it; refuses a returnGrammar (one grammar for return names)', () => {
    expect(versionsSchema.safeParse({ ...versions, offerGrammar: '2026-11-01-offers' }).success).toBe(true);
    expect(versionsSchema.safeParse(versions).success).toBe(true);
    expect(versionsSchema.safeParse({ ...versions, offerGrammar: '' }).success).toBe(false);
    expect(versionsSchema.safeParse({ ...versions, returnGrammar: 'x' }).success).toBe(false);
  });
  it('workerRuleSchema lives in the leaf rule.ts and the protocol re-exports the same schema', () => {
    expect(workerRuleSchema).toBe(leafRule);
    expect(leafRule.safeParse('reload:not-settled').success).toBe(true);
    expect(leafRule.safeParse('Select').success).toBe(false);
  });
});
