import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  BOOKING_OFFERS_MAX,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  flightPagesPerPair,
  flightRequestSeconds,
  RETURN_ATTEMPTS_MAX,
  RETURN_PAGE_PERIODS,
  RETURN_PHASE_SECONDS_MAX,
  RETURN_SECOND_OUTBOUND_RATE,
  RETURN_SPACED_LOADS,
  RETURN_STEP_SECONDS,
} from '../../src/flights/limits.js';
import {
  BOOKING_FINISHED,
  BOOKING_STATUS,
  BOOKING_TRANSIENT,
  type BookingRead,
  bookingReadSchema,
  offerSchema,
  offersComplete,
  RETURN_FINISHED,
  RETURN_STATUS,
  RETURN_TRANSIENT,
  type ReturnRead,
  returnAttemptSchema,
  returnReadSchema,
  returnsOutboundIssue,
} from '../../src/flights/returns.js';
import { type ListedReturn, listedReturnSchema } from '../../src/flights/types.js';

// Spec revision 56 §2 "The return phase", §5.1 and §12: the return read, the booking read and its offers, their statuses
// and refinements, and the return phase's constants. Synthetic returns, sellers (QQ Travel, QQ Fares) and carriers only.

const LIMITS = { maxJourneyMinutes: 1500, maxStops: 0, departureWindowLocal: null, arrivalWindowLocal: null };

/** A direct return from £`pounds` (the return's "From" price), 725 minutes. */
function ret(pounds: number, over: Partial<ListedReturn> = {}): ListedReturn {
  return {
    departsLocal: '14:20',
    arrivesLocal: '06:25',
    arrivesDayOffset: 1,
    durationMinutes: 725,
    stops: 0,
    carriers: ['QQ Atlantic'],
    operatedBy: null,
    fromMinor: pounds * 100,
    ...over,
  };
}

/** One attempt on outbound `outboundIndex`, listing `returns`. */
function attempt(returns: ListedReturn[], over: Record<string, unknown> = {}) {
  return {
    outboundIndex: 0,
    outboundFits: true,
    listed: returns.length > 0 ? 'returns' : 'none-for-cell',
    moreListed: true,
    returns,
    optionsUnparsed: 0,
    optionsOtherCell: returns.length > 0 ? 0 : 2,
    resultsStated: null,
    ...over,
  };
}

const OFFERS = [
  { seller: 'QQ Travel', fare: null, priceMinor: 118_000 },
  { seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 },
];

/** A booking read of attempt `attempt`, return 0: read, expanded, two offers. */
function booking(over: Record<string, unknown> = {}) {
  return {
    status: 'read',
    rule: null,
    attempt: 0,
    returnIndex: 0,
    expanded: true,
    moreControl: false,
    grouped: 0,
    offers: OFFERS,
    unparsed: 0,
    nonGbp: 0,
    offersStated: null,
    ...over,
  };
}

/** A finished read of one attempt with one fitting return and no booking read. */
function read(over: Record<string, unknown> = {}) {
  return {
    limits: LIMITS,
    status: 'read',
    rule: null,
    attempts: [attempt([ret(1180)])],
    triedAll: false,
    booking: null,
    ...over,
  };
}

/** The paths of a value's issues under `schema` ([] when it parses), so each refusal names the rule it broke. */
const pathsOf = (schema: z.ZodType, v: unknown): string[] => {
  const r = schema.safeParse(v);
  if (r.success) return [];
  // why: each rule says what is wrong (zod puts "Invalid input" in place of an empty message)
  for (const i of r.error.issues) expect(i.message, i.path.join('.')).toMatch(/^(?!Invalid input$).*\w{4,}/);
  return r.error.issues.map((i) => i.path.join('.'));
};
const issues = (v: unknown) => pathsOf(returnReadSchema, v);

describe('listedReturnSchema (spec rev 56 §5.1: the leg fields, a day offset from the return date, the "from" price)', () => {
  it('accepts a day offset of −1 (a date-line return); refuses −2 and 4', () => {
    expect(listedReturnSchema.safeParse(ret(1180, { arrivesDayOffset: -1 })).success).toBe(true);
    expect(listedReturnSchema.safeParse(ret(1180, { arrivesDayOffset: -2 })).success).toBe(false);
    expect(listedReturnSchema.safeParse(ret(1180, { arrivesDayOffset: 4 })).success).toBe(false);
  });
  it('refuses a "from" price of 0, an outbound-style amountMinor and 24:00', () => {
    expect(listedReturnSchema.safeParse(ret(0)).success).toBe(false);
    const { fromMinor: _f, ...noFrom } = ret(1180);
    expect(listedReturnSchema.safeParse({ ...noFrom, amountMinor: 118_000 }).success).toBe(false);
    expect(listedReturnSchema.safeParse(ret(1180, { departsLocal: '24:00' })).success).toBe(false);
    expect(listedReturnSchema.safeParse(ret(1180, { departsLocal: '014:20' })).success).toBe(false);
    expect(listedReturnSchema.safeParse(ret(1180, { arrivesLocal: '06:255' })).success).toBe(false);
  });
  it('holds carrier names to the flight text: trimmed, whitespace collapsed (and says so)', () => {
    const r = listedReturnSchema.safeParse(ret(1180, { carriers: ['QQ  Atlantic'] }));
    expect(r.error?.issues.map((i) => i.message)).toEqual(['trimmed, whitespace collapsed']);
    expect(listedReturnSchema.safeParse(ret(1180, { carriers: [' QQ Atlantic'] })).success).toBe(false);
    expect(listedReturnSchema.safeParse(ret(1180, { carriers: ['QQ  Atlantic'] })).success).toBe(false);
    expect(listedReturnSchema.safeParse(ret(1180, { operatedBy: 'QQ Air ' })).success).toBe(false);
  });
});

describe('returnReadSchema (spec rev 56 §5.1 refinements)', () => {
  it('accepts a finished read, and a read whose second attempt could not start (its rule)', () => {
    expect(issues(read())).toEqual([]);
    expect(issues(read({ rule: 'spacing' }))).toEqual([]);
  });

  it('refuses read with no attempt, no-outbound with an attempt, unrecognised without a rule, read with rule "Select"', () => {
    expect(issues(read({ attempts: [] }))).toEqual(['attempts']);
    expect(issues(read({ status: 'no-outbound' }))).toEqual(['attempts']);
    expect(issues(read({ status: 'no-outbound', attempts: [] }))).toEqual([]);
    expect(issues(read({ status: 'unrecognised', attempts: [], rule: null }))).toEqual(['rule']);
    expect(issues(read({ status: 'unrecognised', attempts: [], rule: 'not-return-view' }))).toEqual([]);
    expect(issues(read({ rule: 'Select' }))).toEqual(['rule']);
  });

  it('a rule exactly for skipped, select-failed, not-settled and unrecognised; none for no-outbound and not-verified', () => {
    for (const status of ['skipped', 'select-failed', 'not-settled', 'unrecognised']) {
      expect(issues(read({ status, attempts: [], rule: 'monthly-headroom' })), status).toEqual([]);
      expect(issues(read({ status, attempts: [], rule: null })), status).toEqual(['rule']);
    }
    for (const status of ['no-outbound', 'not-verified']) {
      expect(issues(read({ status, attempts: [], rule: null })), status).toEqual([]);
      expect(issues(read({ status, attempts: [], rule: 'spacing' })), status).toEqual(['rule']);
    }
  });

  it("refuses an attempt listing 'returns' with none, and 'none-for-cell' with one", () => {
    const paths = (v: unknown) => pathsOf(returnAttemptSchema, v);
    expect(paths(attempt([], { listed: 'returns' }))).toEqual(['returns']);
    expect(paths(attempt([ret(1180)], { listed: 'none-for-cell' }))).toEqual(['returns']);
    expect(issues(read({ attempts: [attempt([], { listed: 'returns' })] }))).toEqual(['attempts.0.returns']);
  });

  it('a second attempt only after a fitting first outbound with no return within the limits, and itself fitting', () => {
    const over = ret(1204, { stops: 2 });
    const second = attempt([ret(1180)], { outboundIndex: 1 });
    expect(issues(read({ attempts: [attempt([over]), second] }))).toEqual([]);
    expect(issues(read({ attempts: [attempt([ret(1204)]), second] }))).toEqual(['attempts.1']);
    expect(issues(read({ attempts: [attempt([over]), { ...second, outboundFits: false }] }))).toEqual([
      'attempts.1.outboundFits',
    ]);
    // why: an outbound over the limits is picked only when none fits, so no fitting outbound is left to try second
    expect(issues(read({ attempts: [attempt([over], { outboundFits: false }), second] }))).toEqual([
      'attempts.0.outboundFits',
    ]);
    expect(issues(read({ attempts: [attempt([]), second] }))).toEqual([]);
    // why: a return is judged on the return leg (no window), so one departing outside the outbound's window still fits
    const windowed = { ...LIMITS, departureWindowLocal: { from: '08:00', to: '20:00' } };
    const early = attempt([ret(1180, { departsLocal: '06:10' })]);
    expect(issues(read({ limits: windowed, attempts: [early, second] }))).toEqual(['attempts.1']);
    expect(issues(read({ attempts: [attempt([over]), second, second] }))).toEqual(['attempts']);
    expect(RETURN_ATTEMPTS_MAX).toBe(2);
  });

  it('accepts two attempts of 30 returns each (the first all over the limits) and refuses 31', () => {
    const thirtyOver = Array.from({ length: 30 }, (_x, i) => ret(1200 + i, { stops: 1 }));
    const thirty = Array.from({ length: 30 }, (_x, i) => ret(1200 + i));
    expect(issues(read({ attempts: [attempt(thirtyOver), attempt(thirty, { outboundIndex: 1 })] }))).toEqual(
      [],
    );
    expect(issues(read({ attempts: [attempt([...thirty, ret(1300)])] }))).toEqual(['attempts.0.returns']);
  });

  it('a booking names the LAST attempt and a return inside it; booking: null is accepted', () => {
    const over = ret(1204, { stops: 2 });
    const two = [attempt([over]), attempt([ret(1180), ret(1250)], { outboundIndex: 1 })];
    expect(issues(read({ attempts: two, booking: booking({ attempt: 1, returnIndex: 1 }) }))).toEqual([]);
    expect(issues(read({ attempts: two, booking: booking({ attempt: 0, returnIndex: 0 }) }))).toEqual([
      'booking.attempt',
    ]);
    expect(issues(read({ attempts: two, booking: booking({ attempt: 1, returnIndex: 2 }) }))).toEqual([
      'booking.returnIndex',
    ]);
    expect(issues(read({ booking: null }))).toEqual([]);
    // why: a booking without its return index is the booking's own refusal, reported once (not again by the read)
    const none = read({ attempts: [attempt([])], booking: booking({ attempt: 0, returnIndex: null }) });
    expect(issues(none)).toEqual(['booking.returnIndex']);
    const noPairing = booking({
      status: 'no-pairing',
      rule: null,
      attempt: null,
      returnIndex: null,
      offers: [],
    });
    expect(issues(read({ booking: noPairing }))).toEqual([]);
  });
});

describe('the statuses and their sets (spec rev 56 §2, §5.1)', () => {
  it('RETURN_FINISHED holds exactly read and no-outbound; RETURN_TRANSIENT the four transient ends', () => {
    expect([...RETURN_FINISHED]).toEqual(['read', 'no-outbound']);
    expect([...RETURN_TRANSIENT]).toEqual(['select-failed', 'not-settled', 'unrecognised', 'skipped']);
    expect(RETURN_STATUS).toEqual([
      'read',
      'no-outbound',
      'skipped',
      'select-failed',
      'not-settled',
      'unrecognised',
      'not-verified',
    ]);
  });
  it('BOOKING_FINISHED holds exactly read and no-pairing; BOOKING_TRANSIENT the four transient ends', () => {
    expect([...BOOKING_FINISHED]).toEqual(['read', 'no-pairing']);
    expect([...BOOKING_TRANSIENT]).toEqual(['select-failed', 'not-settled', 'unrecognised', 'expand-failed']);
    expect(BOOKING_STATUS).toEqual([
      'read',
      'no-pairing',
      'skipped',
      'select-failed',
      'not-settled',
      'unrecognised',
      'expand-failed',
      'not-verified',
    ]);
  });
});

describe('the return phase constants (spec rev 56 §12; the 21.0 findings)', () => {
  it('pins every literal', () => {
    expect(FLIGHT_LIST_PAGES_PER_PAIR_MAX).toBe(2);
    expect(RETURN_SPACED_LOADS).toBe(1);
    expect(RETURN_PAGE_PERIODS.booking).toBe(8);
    expect(RETURN_PAGE_PERIODS.returnsOnly).toBe(6);
    expect(RETURN_STEP_SECONDS).toBe(40);
    expect(RETURN_PHASE_SECONDS_MAX.booking).toBe(200);
    expect(RETURN_PHASE_SECONDS_MAX.returnsOnly).toBe(120);
    expect(RETURN_SECOND_OUTBOUND_RATE).toBe(0.5);
    expect(BOOKING_OFFERS_MAX).toBe(40);
  });
  it('flightRequestSeconds: 780 / 600 at the defaults, 1,035 at 120 s and 45 s', () => {
    expect(flightRequestSeconds(90, 30, true)).toBe(780);
    expect(flightRequestSeconds(90, 30, false)).toBe(600);
    expect(flightRequestSeconds(120, 45, true)).toBe(1035);
  });
  it('flightPagesPerPair: 2 only when the worker reported RETURN_SELECT_VERIFIED true', () => {
    expect(flightPagesPerPair({ RETURN_SELECT_VERIFIED: true })).toBe(2);
    expect(flightPagesPerPair({ RETURN_SELECT_VERIFIED: false })).toBe(1);
    expect(flightPagesPerPair({})).toBe(1);
    expect(flightPagesPerPair(null)).toBe(1);
  });
});

describe('offerSchema and bookingReadSchema (spec rev 56 §5.1; test-r3-001)', () => {
  it('offerSchema refuses a 0 price, an 81-character seller and a control character; accepts fare null', () => {
    const offer = { seller: 'QQ Travel', fare: null, priceMinor: 118_000 };
    expect(offerSchema.safeParse(offer).success).toBe(true);
    expect(offerSchema.safeParse({ ...offer, priceMinor: 0 }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, seller: 'Q'.repeat(81) }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, seller: 'Q'.repeat(80) }).success).toBe(true);
    expect(offerSchema.safeParse({ ...offer, fare: 'Economy\u0007Basic' }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, fare: 'Economy‮Basic' }).success).toBe(false);
  });

  const bk = (v: unknown) => pathsOf(bookingReadSchema, v);
  it('refuses read with no offer, no-pairing with an attempt, expand-failed without a rule, 41 offers, not-settled with an offer', () => {
    expect(bk(booking())).toEqual([]);
    expect(bk(booking({ offers: [] }))).toEqual(['offers']);
    expect(bk(booking({ status: 'no-pairing', attempt: 0, returnIndex: 0, offers: [] }))).toEqual([
      'attempt',
      'returnIndex',
    ]);
    expect(bk(booking({ status: 'expand-failed', rule: null, expanded: false }))).toEqual(['rule']);
    const many = Array.from({ length: 41 }, (_x, i) => ({
      seller: 'QQ Fares',
      fare: null,
      priceMinor: 118_000 + i,
    }));
    expect(bk(booking({ offers: many }))).toEqual(['offers']);
    expect(bk(booking({ offers: many.slice(0, 40), offersStated: 41 }))).toEqual([]);
    expect(bk(booking({ status: 'not-settled', rule: 'booking-view' }))).toEqual(['offers']);
  });
  it('accepts expand-failed with two offers (the offers read before the expansion kept)', () => {
    expect(bk(booking({ status: 'expand-failed', rule: 'more-options', expanded: false }))).toEqual([]);
  });
  it('attempt and returnIndex set exactly for read and the transient ends; a rule exactly for the stopped ones', () => {
    for (const status of ['select-failed', 'not-settled', 'unrecognised']) {
      expect(bk(booking({ status, rule: 'booking-view', offers: [] })), status).toEqual([]);
      expect(
        bk(booking({ status, rule: 'booking-view', offers: [], attempt: null, returnIndex: null })),
        status,
      ).toEqual(['attempt', 'returnIndex']);
    }
    const none = { attempt: null, returnIndex: null, offers: [] };
    expect(bk(booking({ status: 'skipped', rule: 'spacing', ...none }))).toEqual([]);
    expect(bk(booking({ status: 'skipped', rule: null, ...none }))).toEqual(['rule']);
    expect(bk(booking({ status: 'skipped', rule: 'spacing', offers: [] }))).toEqual([
      'attempt',
      'returnIndex',
    ]);
    expect(bk(booking({ status: 'not-verified', rule: null, ...none }))).toEqual([]);
    expect(bk(booking({ status: 'not-verified', rule: 'x', ...none }))).toEqual(['rule']);
    expect(bk(booking({ rule: 'more-options' }))).toEqual(['rule']);
    expect(bk(booking({ attempt: 0, returnIndex: null }))).toEqual(['returnIndex']);
    expect(bk(booking({ attempt: null, returnIndex: 0 }))).toEqual(['attempt']);
  });
  it('offersStated, when set, is above the offers kept', () => {
    expect(bk(booking({ offersStated: 2 }))).toEqual(['offersStated']);
    expect(bk(booking({ offersStated: 41 }))).toEqual([]);
  });
});

describe('offersComplete (spec rev 56 §6.9, R-sellers, A8)', () => {
  const b = (over: Partial<BookingRead>): BookingRead => bookingReadSchema.parse(booking(over));
  it.each<[string, Partial<BookingRead>, number, boolean]>([
    ['read: cheapest offer equals the "from" price', { moreControl: true, grouped: 2 }, 118_000, true],
    ['read: no further control and no grouped seller control', {}, 117_000, true],
    ['read: a further control remained', { moreControl: true }, 117_000, false],
    ['read: a grouped seller control remained', { grouped: 1 }, 117_000, false],
    [
      'expand-failed: cheapest equals the "from" price',
      { status: 'expand-failed', rule: 'more-options', expanded: false },
      118_000,
      true,
    ],
    [
      'expand-failed: cheapest above the "from" price, even with no control left (A8)',
      { status: 'expand-failed', rule: 'more-options', expanded: false },
      117_000,
      false,
    ],
    ['not-settled: no offer', { status: 'not-settled', rule: 'booking-view', offers: [] }, 118_000, false],
    // R-unread: an offer the grammar refused, or priced in another currency, is an offer not read
    ['read: no control left, but an offer unparsed', { unparsed: 1 }, 117_000, false],
    ['read: no control left, but an offer not in GBP', { nonGbp: 2 }, 117_000, false],
    [
      'read: an offer unparsed, the cheapest equal to the "from" price',
      { unparsed: 1, nonGbp: 1 },
      118_000,
      true,
    ],
  ])('%s', (_name, over, fromMinor, want) => {
    expect(offersComplete(b(over), fromMinor)).toBe(want);
  });
});

describe("returnsOutboundIssue (the contract checks every outboundIndex against the list's flights)", () => {
  it('names the first attempt whose outbound index is past the flights, else null', () => {
    const r: ReturnRead = returnReadSchema.parse(read());
    expect(returnsOutboundIssue(r, 1)).toBeNull();
    expect(returnsOutboundIssue(r, 0)).toBe(0);
    const two: ReturnRead = returnReadSchema.parse(
      read({ attempts: [attempt([]), attempt([ret(1180)], { outboundIndex: 3 })] }),
    );
    expect(returnsOutboundIssue(two, 3)).toBe(1);
    expect(returnsOutboundIssue(two, 4)).toBeNull();
  });
});
