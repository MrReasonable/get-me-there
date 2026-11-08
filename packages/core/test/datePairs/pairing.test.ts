import { describe, expect, it } from 'vitest';
import {
  bookingReturnOf,
  cheapestOffer,
  cheapestPairing,
  FIGURE_BASES,
  listFresh,
  PAIRING_READ,
  type PairingCandidate,
  pairingKindOf,
  pairingLeads,
  pairingOffer,
  pairingReadOf,
  resultBasisOf,
} from '../../src/datePairs/pairing.js';
import type { FlightLimits } from '../../src/flights/choose.js';
import {
  type BookingRead,
  bookingReadSchema,
  type ReturnRead,
  returnReadSchema,
} from '../../src/flights/returns.js';
import type { ListedFlight, ListedReturn } from '../../src/flights/types.js';
import * as testing from '../../src/testing/index.js';
import {
  PAIRING_BOOKING_RETURN,
  PAIRING_CHEAPEST,
  PAIRING_FIXTURE,
  PAIRING_LIMITS,
  PAIRING_OFFER,
  SYNTHETIC,
} from '../../src/testing/pairing.js';
import { asIsoDateTime } from '../../src/types/ids.js';

// Spec revision 56 §6.9 "Flight lists and the date pair's figure" (Ian's ruling 1; R-pick; R-sellers; A8): which pairing,
// the one return-pick rule, the cheapest offer, when a pairing leads; and the shared fixture (`@gmt/core/testing`) the
// api and web tests of Tasks 21.6 and 21.7 assert the same literals over.

/** A direct outbound at £`pounds`, 465 minutes, departing 08:00. */
function out(pounds: number, over: Partial<ListedFlight> = {}): ListedFlight {
  return {
    departsLocal: '08:00',
    arrivesLocal: '11:45',
    arrivesDayOffset: 0,
    durationMinutes: 465,
    stops: 0,
    carriers: ['QQ Air'],
    operatedBy: null,
    amountMinor: pounds * 100,
    ...over,
  };
}
/** A direct return from £`pounds`, 485 minutes, departing 19:10. */
function back(pounds: number, over: Partial<ListedReturn> = {}): ListedReturn {
  return {
    departsLocal: '19:10',
    arrivesLocal: '07:15',
    arrivesDayOffset: 1,
    durationMinutes: 485,
    stops: 0,
    carriers: ['QQ Atlantic'],
    operatedBy: null,
    fromMinor: pounds * 100,
    ...over,
  };
}
const NO_LIMITS: FlightLimits = {
  maxJourneyMinutes: null,
  maxStops: null,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
const attempt = (outboundIndex: number, returns: ListedReturn[], outboundFits = true) => ({
  outboundIndex,
  outboundFits,
  listed: returns.length > 0 ? 'returns' : 'none-for-cell',
  moreListed: false,
  returns,
  optionsUnparsed: 0,
  optionsOtherCell: returns.length > 0 ? 0 : 1,
  resultsStated: null,
});
const readOf = (limits: FlightLimits, attempts: unknown[], over: Record<string, unknown> = {}): ReturnRead =>
  returnReadSchema.parse({
    limits,
    status: 'read',
    rule: null,
    attempts,
    triedAll: false,
    booking: null,
    ...over,
  });

describe('the shared fixture (src/testing/pairing.ts, `@gmt/core/testing`)', () => {
  it('is synthetic, built through the contract, and its expected picks hold', () => {
    expect(SYNTHETIC).toBe(true);
    expect(testing.SYNTHETIC).toBe(true);
    expect(returnReadSchema.parse(PAIRING_FIXTURE.returns)).toEqual(PAIRING_FIXTURE.returns);
    expect(PAIRING_FIXTURE.flights).toHaveLength(4);
    const [first, second] = PAIRING_FIXTURE.returns.attempts;
    expect(first?.outboundIndex).toBe(2);
    expect(second?.outboundIndex).toBe(3);
    expect(PAIRING_FIXTURE.flights[3]?.amountMinor).toBe(52_000);
    expect(PAIRING_LIMITS.maxStops).toBe(1);
  });

  it('is deep-frozen, so no test can change what another reads', () => {
    const r = PAIRING_FIXTURE.returns;
    for (const v of [
      PAIRING_FIXTURE,
      PAIRING_FIXTURE.flights,
      PAIRING_FIXTURE.flights[3],
      PAIRING_FIXTURE.flights[3]?.carriers,
      r,
      r.limits,
      r.attempts,
      r.attempts[1]?.returns,
      r.attempts[1]?.returns[0],
      r.booking,
      r.booking?.offers[0],
      PAIRING_LIMITS,
      PAIRING_CHEAPEST,
      PAIRING_OFFER,
      PAIRING_OFFER.offer,
      PAIRING_BOOKING_RETURN,
    ])
      expect(Object.isFrozen(v)).toBe(true);
  });

  it('under maxStops 1: cheapestPairing, cheapestOffer and bookingReturnOf are the pinned literals', () => {
    const { flights, returns } = PAIRING_FIXTURE;
    expect(cheapestPairing(returns, flights, PAIRING_LIMITS)).toEqual({
      attempt: 1,
      returnIndex: 0,
      fromMinor: 118_000,
      outboundFits: true,
      returnFits: true,
    });
    expect(cheapestOffer(returns.booking)).toEqual({
      index: 0,
      offer: { seller: 'QQ Travel', fare: null, priceMinor: 118_000 },
    });
    expect(bookingReturnOf(returns, flights)).toEqual({ attempt: 1, returnIndex: 0 });
    expect(PAIRING_CHEAPEST).toEqual(cheapestPairing(returns, flights, PAIRING_LIMITS));
    expect(PAIRING_OFFER).toEqual(cheapestOffer(returns.booking));
    expect(PAIRING_BOOKING_RETURN).toEqual(bookingReturnOf(returns, flights));
  });
});

describe('cheapestPairing (spec rev 56 §6.9: the cheapest fitting pairing over every attempt, else the cheapest of all)', () => {
  it('a single attempt whose outbound is over the limits, with a fitting return: outboundFits false', () => {
    const flights = [out(500, { stops: 2 })];
    const limits = { ...NO_LIMITS, maxStops: 1 };
    const r = readOf(limits, [attempt(0, [back(1180)], false)]);
    expect(cheapestPairing(r, flights, limits)).toEqual({
      attempt: 0,
      returnIndex: 0,
      fromMinor: 118_000,
      outboundFits: false,
      returnFits: true,
    });
  });

  it('a single attempt whose returns are all over the limits: the cheapest of all, returnFits false', () => {
    const limits = { ...NO_LIMITS, maxStops: 0 };
    const r = readOf(limits, [attempt(0, [back(1230, { stops: 1 }), back(1204, { stops: 2 })])]);
    expect(cheapestPairing(r, [out(500)], limits)).toEqual({
      attempt: 0,
      returnIndex: 1,
      fromMinor: 120_400,
      outboundFits: true,
      returnFits: false,
    });
  });

  it('no return at all: null (no attempt, or attempts listing none)', () => {
    expect(cheapestPairing(readOf(NO_LIMITS, [attempt(0, [])]), [out(500)], NO_LIMITS)).toBeNull();
    const none = returnReadSchema.parse({
      limits: NO_LIMITS,
      status: 'no-outbound',
      rule: null,
      attempts: [],
      triedAll: true,
      booking: null,
    });
    expect(cheapestPairing(none, [], NO_LIMITS)).toBeNull();
  });

  it('is judged under the limits passed, not the stored ones (stored maxStops 2, passed maxStops 0)', () => {
    const r = readOf({ ...NO_LIMITS, maxStops: 2 }, [attempt(0, [back(1180, { stops: 1 })])]);
    expect(cheapestPairing(r, [out(500)], { ...NO_LIMITS, maxStops: 0 })).toMatchObject({
      returnFits: false,
    });
    expect(cheapestPairing(r, [out(500)], { ...NO_LIMITS, maxStops: 2 })).toMatchObject({ returnFits: true });
  });

  it('ties on "from" go to the shorter, then fewer stops, the earlier departure, the attempt and the index', () => {
    const r = readOf(NO_LIMITS, [
      attempt(0, [back(1180, { durationMinutes: 700 }), back(1180, { durationMinutes: 600 })]),
    ]);
    expect(cheapestPairing(r, [out(500)], NO_LIMITS)).toMatchObject({ returnIndex: 1 });
    const same = readOf(NO_LIMITS, [attempt(0, [back(1180), back(1180)])]);
    expect(cheapestPairing(same, [out(500)], NO_LIMITS)).toMatchObject({ attempt: 0, returnIndex: 0 });
  });

  it('a fitting pairing beats a cheaper one over the limits', () => {
    const limits = { ...NO_LIMITS, maxStops: 0 };
    const r = readOf(limits, [attempt(0, [back(1100, { stops: 1 }), back(1250)])]);
    expect(cheapestPairing(r, [out(500)], limits)).toMatchObject({ returnIndex: 1, returnFits: true });
  });

  it('an outbound outside the departure window: outboundFits false (the windows apply to the outbound)', () => {
    const limits = { ...NO_LIMITS, departureWindowLocal: { from: '08:00', to: '20:00' } };
    const r = readOf(limits, [attempt(0, [back(1180, { departsLocal: '06:10' })], false)]);
    const flights = [out(500, { departsLocal: '06:10' })];
    expect(cheapestPairing(r, flights, limits)).toEqual({
      attempt: 0,
      returnIndex: 0,
      fromMinor: 118_000,
      outboundFits: false,
      returnFits: true,
    });
    expect(bookingReturnOf(r, flights)).toEqual({ attempt: 0, returnIndex: 0 });
    expect(cheapestPairing(r, [out(500)], limits)).toMatchObject({ outboundFits: true });
  });

  it('a tie across attempts goes to attempt 0; a three-way tie to the lowest index', () => {
    // why: read under maxStops 0 (so a second attempt was made), judged under no limits (so both fit, and tie)
    const over = back(1180, { stops: 1 });
    const r = readOf({ ...NO_LIMITS, maxStops: 0 }, [attempt(0, [over]), attempt(1, [over])]);
    expect(cheapestPairing(r, [out(500), out(520)], NO_LIMITS)).toMatchObject({ attempt: 0, returnIndex: 0 });
    const three = readOf(NO_LIMITS, [attempt(0, [back(1250), back(1180), back(1180), back(1180)])]);
    expect(cheapestPairing(three, [out(500)], NO_LIMITS)).toMatchObject({ returnIndex: 1 });
    expect(bookingReturnOf(three, [out(500)])).toEqual({ attempt: 0, returnIndex: 1 });
  });

  // why: final review B-I2: with no fitting return on either outbound, the pairing shown is the one whose sellers were
  // read (the worker books the last attempt's cheapest, bookingReturnOf), never attempt 0's cheaper "from" return
  it('two attempts, no return fitting on either: the last attempt’s cheapest, the one bookingReturnOf booked', () => {
    const limits = { ...NO_LIMITS, maxStops: 0 };
    const r = readOf(limits, [
      attempt(0, [back(1140, { stops: 1 }), back(1160, { stops: 1 })]),
      attempt(1, [back(1250, { stops: 1 }), back(1210, { stops: 2 })]),
    ]);
    const flights = [out(500), out(520)];
    expect(cheapestPairing(r, flights, limits)).toEqual({
      attempt: 1,
      returnIndex: 1,
      fromMinor: 121_000,
      outboundFits: true,
      returnFits: false,
    });
    expect(bookingReturnOf(r, flights)).toEqual({ attempt: 1, returnIndex: 1 });
  });
  it('two attempts, none fitting, the last listing no return: the cheapest of all', () => {
    const limits = { ...NO_LIMITS, maxStops: 0 };
    const r = readOf(limits, [attempt(0, [back(1140, { stops: 1 })]), attempt(1, [])]);
    expect(cheapestPairing(r, [out(500), out(520)], limits)).toMatchObject({ attempt: 0, returnIndex: 0 });
  });
  it('an outbound index past the flights is a caller error (the contract refuses it)', () => {
    const r = readOf(NO_LIMITS, [attempt(1, [back(1180)])]);
    expect(() => cheapestPairing(r, [out(500)], NO_LIMITS)).toThrow(
      new RangeError('no outbound 1 in 1 flights'),
    );
  });
});

describe('bookingReturnOf (spec rev 56 §6.9; R-pick: the one return-pick rule, over the LAST attempt, under r.limits)', () => {
  it('equals cheapestPairing whenever the last attempt holds it, two fitting returns tied on "from", the later shorter', () => {
    const r = readOf(NO_LIMITS, [
      attempt(0, [back(1180, { durationMinutes: 700 }), back(1180, { durationMinutes: 600 })]),
    ]);
    const flights = [out(500)];
    expect(bookingReturnOf(r, flights)).toEqual({ attempt: 0, returnIndex: 1 });
    expect(cheapestPairing(r, flights, r.limits)).toMatchObject({ attempt: 0, returnIndex: 1 });
  });

  it('the outboundFits false case: the cheapest of the last attempt all the same', () => {
    const limits = { ...NO_LIMITS, maxStops: 0 };
    const r = readOf(limits, [attempt(0, [back(1250), back(1180)], false)]);
    const flights = [out(500, { stops: 1 })];
    expect(bookingReturnOf(r, flights)).toEqual({ attempt: 0, returnIndex: 1 });
    expect(cheapestPairing(r, flights, limits)).toMatchObject({
      attempt: 0,
      returnIndex: 1,
      outboundFits: false,
    });
  });

  it('only the last attempt counts, and null when it listed no return', () => {
    const limits = { ...NO_LIMITS, maxStops: 0 };
    const r = readOf(limits, [attempt(0, [back(1100, { stops: 1 })]), attempt(1, [back(1250)])]);
    expect(bookingReturnOf(r, [out(500), out(520)])).toEqual({ attempt: 1, returnIndex: 0 });
    const empty = readOf(limits, [attempt(0, [back(1100, { stops: 1 })]), attempt(1, [])]);
    expect(bookingReturnOf(empty, [out(500), out(520)])).toBeNull();
    expect(bookingReturnOf({ attempts: [], limits }, [])).toBeNull();
  });
});

describe('cheapestOffer (spec rev 56 §6.9: the lowest stated price of a read or expand-failed booking)', () => {
  const b = (over: Record<string, unknown>): BookingRead =>
    bookingReadSchema.parse({
      status: 'read',
      rule: null,
      attempt: 0,
      returnIndex: 0,
      expanded: true,
      moreControl: false,
      grouped: 0,
      offers: [
        { seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 },
        { seller: 'QQ Travel', fare: null, priceMinor: 118_000 },
        { seller: 'QQ Fares', fare: null, priceMinor: 118_000 },
      ],
      unparsed: 0,
      nonGbp: 0,
      offersStated: null,
      ...over,
    });
  it('ties in price go to the lower index', () => {
    expect(cheapestOffer(b({}))).toEqual({
      index: 1,
      offer: { seller: 'QQ Travel', fare: null, priceMinor: 118_000 },
    });
  });
  it('an expand-failed booking keeps its offers read', () => {
    expect(cheapestOffer(b({ status: 'expand-failed', rule: 'more-options', expanded: false }))?.index).toBe(
      1,
    );
  });
  it('null for null and for every other status', () => {
    expect(cheapestOffer(null)).toBeNull();
    expect(cheapestOffer(b({ status: 'not-settled', rule: 'booking-view', offers: [] }))).toBeNull();
    expect(
      cheapestOffer(b({ status: 'no-pairing', rule: null, attempt: null, returnIndex: null, offers: [] })),
    ).toBeNull();
  });
});

// design 2026-11-08 §4.1: the offer moved here from the api's candidateOf; its api tests pin it through the candidate,
// this pins it directly
describe('pairingOffer (the booking read counts only for the pairing it was read for)', () => {
  const { flights, returns } = PAIRING_FIXTURE;
  it("is the booking's cheapest offer, complete, for the pairing the worker booked", () => {
    expect(pairingOffer(returns, flights, PAIRING_CHEAPEST)).toEqual({
      offer: PAIRING_OFFER.offer,
      complete: true,
    });
  });
  it('is no offer for another pairing, even of the same list', () => {
    expect(pairingOffer(returns, flights, { ...PAIRING_CHEAPEST, attempt: 0, returnIndex: 0 })).toEqual({
      offer: null,
      complete: false,
    });
    expect(pairingOffer(returns, flights, { ...PAIRING_CHEAPEST, returnIndex: 1 })).toEqual({
      offer: null,
      complete: false,
    });
  });
  it('is no offer without a booking read', () => {
    expect(pairingOffer({ ...returns, booking: null }, flights, PAIRING_CHEAPEST)).toEqual({
      offer: null,
      complete: false,
    });
  });
  it('has an offer, not complete, when the offers may be missing one cheaper than the return', () => {
    const booking = returns.booking;
    if (booking === null) throw new Error('the fixture has a booking read');
    // why: a "more options" control left unexpanded means a cheaper seller may not have been read
    const r = { ...returns, booking: { ...booking, status: 'expand-failed' as const, expanded: false } };
    const got = pairingOffer(r, flights, { ...PAIRING_CHEAPEST, fromMinor: 100_000 });
    expect(got.offer).toEqual(PAIRING_OFFER.offer);
    expect(got.complete).toBe(false);
  });
});

describe('pairingLeads and pairingReadOf (spec rev 56 §6.9 "When it leads"; design 2026-11-08 §4.1: no complete offers needed)', () => {
  const candidate = (over: Partial<PairingCandidate>): PairingCandidate => ({
    fromMinor: 118_000,
    offer: { seller: 'QQ Travel', fare: null, priceMinor: 118_000 },
    offersRead: 3,
    complete: true,
    which: 'next-cheapest',
    times: { departOut: '07:15', arriveOut: '18:05', departBack: '14:20', arriveBack: '06:25' },
    journeyMinutes: 1_615,
    mismatch: false,
    provenance: {
      providerId: 'camoufox',
      sourceKind: 'scraped-self',
      fetchedAt: asIsoDateTime('2027-03-01T09:30:00.000Z'),
      maxAgeHours: 0,
      fx: { converted: false },
      pointOfSale: 'GB',
      cabin: 'economy',
    },
    stale: false,
    ageHours: 2,
    fits: true,
    fresh: true,
    underCurrentLimits: true,
    fetchedAt: asIsoDateTime('2027-03-01T09:30:00.000Z'),
    executionId: 'ex-2',
    ...over,
  });
  const flags = [true, false];
  // the list was read at 09:30; a grid price read before it, after it, or none to compare
  const EARLIER = asIsoDateTime('2027-03-01T09:00:00.000Z');
  const LATER = asIsoDateTime('2027-03-01T10:00:00.000Z');
  // why: spec rev 62/63 (Ian, 2026-11-06): its age alone never stops it leading; an older one gives way only to a grid
  // price read after it for the same cell
  // why: design 2026-11-08 §4.1: a pairing with no offer, or with incomplete offers, leads at the return's "from" price
  it('leads only with fits, under current limits, and fresh or not outdated, whatever its offers (every combination)', () => {
    for (const fits of flags)
      for (const fresh of flags)
        for (const underCurrentLimits of flags)
          for (const complete of flags)
            for (const hasOffer of flags)
              for (const grid of [null, EARLIER, LATER]) {
                const c = candidate({
                  fits,
                  fresh,
                  underCurrentLimits,
                  complete,
                  ...(hasOffer ? {} : { offer: null }),
                });
                const want = fits && underCurrentLimits && (fresh || grid !== LATER);
                expect(
                  pairingLeads(c, grid),
                  JSON.stringify({ fits, fresh, underCurrentLimits, complete, hasOffer, grid }),
                ).toBe(want);
                expect(pairingReadOf(c, grid) === 'within').toBe(want);
              }
  });
  // why: final review B-I1: the web's block reads the same predicate from the facts it holds (an offer of its own shape)
  it('pairingLeads reads only the four facts and the grid time, so the block and the api share it', () => {
    const facts = {
      fits: true,
      underCurrentLimits: true,
      fresh: false,
      fetchedAt: asIsoDateTime('2027-03-01T09:30:00.000Z'),
    };
    expect(pairingLeads(facts, null)).toBe(true);
    expect(pairingLeads(facts, EARLIER)).toBe(true);
    // a grid price read at the same instant is not newer
    expect(pairingLeads(facts, facts.fetchedAt)).toBe(true);
    expect(pairingLeads(facts, LATER)).toBe(false);
    expect(pairingLeads({ ...facts, fresh: true }, LATER)).toBe(true);
    expect(pairingLeads({ ...facts, fits: false }, null)).toBe(false);
    expect(pairingLeads({ ...facts, underCurrentLimits: false }, null)).toBe(false);
  });
  // why: final review B-M1: one elapsed-time rule for the list's stale mark and the pairing's freshness
  it('listFresh: within the refresh by elapsed milliseconds, never whole hours', () => {
    const at = asIsoDateTime('2027-03-01T00:00:00.000Z');
    expect(listFresh(at, asIsoDateTime('2027-03-08T00:00:00.000Z'), 168)).toBe(true);
    expect(listFresh(at, asIsoDateTime('2027-03-08T00:00:00.001Z'), 168)).toBe(false);
    expect(listFresh(at, asIsoDateTime('2027-03-08T00:30:00.000Z'), 168)).toBe(false);
  });
  it("names why it does not lead, in the spec's order", () => {
    // why: final review B-M2: a list read under other limits says so first, over today's limits or not, as the search's
    // page block does after a limit edit
    expect(pairingReadOf(candidate({ underCurrentLimits: false, fits: false }), null)).toBe(
      'within-other-limits',
    );
    expect(pairingReadOf(candidate({ fits: false, fresh: false, offer: null }), null)).toBe('over-limit');
    expect(pairingReadOf(candidate({ underCurrentLimits: false, fresh: false }), null)).toBe(
      'within-other-limits',
    );
    // why: spec rev 62/63: a complete pairing leads at any age until a newer grid price; within-older is an older one
    // that does not lead
    expect(pairingReadOf(candidate({ fresh: false }), EARLIER)).toBe('within');
    expect(pairingReadOf(candidate({ fresh: false }), LATER)).toBe('within-older');
    expect(pairingReadOf(candidate({}), LATER)).toBe('within');
    // why: design 2026-11-08 §4.1: no offer, or incomplete offers, lead at the "from" price, so 'sellers-not-read' and
    // 'offers-incomplete' are never produced (their wire codes stay)
    expect(pairingReadOf(candidate({ fresh: false, offer: null }), null)).toBe('within');
    expect(pairingReadOf(candidate({ fresh: false, complete: false }), LATER)).toBe('within-older');
    expect(pairingReadOf(candidate({ offer: null, complete: false }), null)).toBe('within');
    expect(pairingReadOf(candidate({ complete: false }), null)).toBe('within');
    expect(pairingReadOf(candidate({}), null)).toBe('within');
  });
  it('PAIRING_READ is pinned: its order is the wire code (ruling R-sparse); FIGURE_BASES its three', () => {
    expect(PAIRING_READ).toEqual([
      'not-read',
      'outbound-only',
      'no-pairing-read',
      'over-limit',
      'sellers-not-read',
      'offers-incomplete',
      'within',
      'within-older',
      'within-other-limits',
      'list-failed',
    ]);
    expect(FIGURE_BASES).toEqual(['verified', 'calendar', 'pairing']);
  });
});

describe('resultBasisOf (spec rev 56 §6.9: a pairing figure opens the detail on the calendar basis)', () => {
  it("maps 'pairing' to 'calendar' and the others to themselves", () => {
    expect(resultBasisOf('pairing')).toBe('calendar');
    expect(resultBasisOf('calendar')).toBe('calendar');
    expect(resultBasisOf('verified')).toBe('verified');
  });
  it("refuses a basis from untyped JSON (the exhaustive switch's default)", () => {
    expect(() => resultBasisOf(JSON.parse('"offer"'))).toThrow(
      new RangeError('resultBasisOf: no basis offer'),
    );
  });
});

describe('pairingKindOf (design 2026-11-08 §4.1: whose price a pairing shows)', () => {
  it.each([
    ['a seller offer when the price is not a "from" price', { isFrom: false, offersRead: 3 }, 'seller'],
    ['google-unread when a "from" price read no offers', { isFrom: true, offersRead: 0 }, 'google-unread'],
    [
      'google-incomplete when a "from" price read some offers',
      { isFrom: true, offersRead: 2 },
      'google-incomplete',
    ],
  ] as const)('is %s', (_name, group, kind) => {
    expect(pairingKindOf(group)).toBe(kind);
  });
});
