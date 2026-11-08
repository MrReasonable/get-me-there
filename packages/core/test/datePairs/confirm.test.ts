import { describe, expect, it } from 'vitest';
import {
  applyCheck,
  type Check,
  CONFIRM_PATIENCE,
  CONFIRM_TARGET,
  checkOfRead,
  EMPTY_STANDINGS,
  improves,
  patienceSpent,
  type Standings,
  uncheckedCheaper,
} from '../../src/datePairs/confirm.js';
import { pairingPrice } from '../../src/datePairs/pairing.js';
import type { FlightLimits } from '../../src/flights/choose.js';
import { type ReturnRead, returnReadSchema } from '../../src/flights/returns.js';
import type { ListedFlight, ListedReturn } from '../../src/flights/types.js';

// Design 2026-11-08 (confirm the cheapest trips) §4.1, §4.3, §4.4, §4.5; synthetic QQ fixtures.

const conf = (pricePence: number): Check => ({ kind: 'confirmed', pricePence });
const NONE: Check = { kind: 'none' };
const UNREAD: Check = { kind: 'unread' };
const st = (prices: number[], sinceImprovement = 0): Standings => ({ prices, sinceImprovement });

describe('constants', () => {
  it('are the design values', () => {
    expect(CONFIRM_TARGET).toBe(5);
    expect(CONFIRM_PATIENCE).toBe(12);
    expect(EMPTY_STANDINGS).toEqual({ prices: [], sinceImprovement: 0 });
  });
});

describe('improves', () => {
  it('below the target any confirmed price improves', () => {
    expect(improves(st([]), conf(99_999))).toBe(true);
    expect(improves(st([1, 2, 3, 4]), conf(99_999))).toBe(true);
  });
  it('with the target reached only a price strictly below the 5th improves', () => {
    const s = st([100, 200, 300, 400, 500]);
    expect(improves(s, conf(499))).toBe(true);
    expect(improves(s, conf(500))).toBe(false);
    expect(improves(s, conf(501))).toBe(false);
  });
  it('none and unread never improve', () => {
    expect(improves(st([]), NONE)).toBe(false);
    expect(improves(st([]), UNREAD)).toBe(false);
  });
});

describe('applyCheck', () => {
  it('a read that improves inserts in order and resets the count', () => {
    expect(applyCheck(st([100, 300], 4), conf(200), 'read')).toEqual(st([100, 200, 300], 0));
  });
  it('a read that does not improve adds 1; a dearer confirmed price is still inserted', () => {
    const s = st([100, 200, 300, 400, 500], 2);
    expect(applyCheck(s, conf(600), 'read')).toEqual(st([100, 200, 300, 400, 500, 600], 3));
    expect(applyCheck(s, NONE, 'read')).toEqual(st([100, 200, 300, 400, 500], 3));
    expect(applyCheck(s, UNREAD, 'read')).toEqual(st([100, 200, 300, 400, 500], 3));
  });
  it('a reuse inserts a confirmed price and leaves the count alone either way', () => {
    expect(applyCheck(st([100], 5), conf(50), 'reuse')).toEqual(st([50, 100], 5));
    const full = st([100, 200, 300, 400, 500], 5);
    expect(applyCheck(full, conf(600), 'reuse')).toEqual(st([100, 200, 300, 400, 500, 600], 5));
    expect(applyCheck(full, NONE, 'reuse')).toEqual(full);
  });
  it('does not change the standings it was given', () => {
    const s = st([100], 1);
    applyCheck(s, conf(50), 'read');
    expect(s).toEqual(st([100], 1));
  });
});

describe('patienceSpent', () => {
  it('the design 4.4 worked example: false after read 17, true after read 18', () => {
    const checks: Check[] = [
      conf(35_200),
      conf(37_100),
      conf(34_900),
      conf(36_000),
      conf(39_800),
      conf(35_600),
    ];
    for (let i = 0; i < 12; i++) checks.push(i === 3 || i === 7 ? NONE : conf(37_200 + i * 400));
    let s = EMPTY_STANDINGS;
    const spent: boolean[] = [];
    for (const c of checks) {
      s = applyCheck(s, c, 'read');
      spent.push(patienceSpent(s));
    }
    expect(spent).toHaveLength(18);
    expect(spent[16]).toBe(false);
    expect(spent[17]).toBe(true);
    expect(s.prices.slice(0, 5)).toEqual([34_900, 35_200, 35_600, 36_000, 37_100]);
  });
  it('12 unread reads with no prices spend it', () => {
    let s = EMPTY_STANDINGS;
    for (let i = 0; i < 11; i++) s = applyCheck(s, UNREAD, 'read');
    expect(patienceSpent(s)).toBe(false);
    s = applyCheck(s, UNREAD, 'read');
    expect(patienceSpent(s)).toBe(true);
  });
});

describe('uncheckedCheaper', () => {
  it('counts remaining prices strictly below the 5th (equal is not below)', () => {
    const s = st([1, 2, 3, 4, 37_100]);
    expect(uncheckedCheaper([36_000, 37_100, 38_000], s)).toBe(1);
  });
  it('with fewer than 5 confirmed counts every remaining price', () => {
    expect(uncheckedCheaper([36_000, 37_100, 38_000], st([1, 2, 3]))).toBe(3);
  });
});

describe('pairingPrice', () => {
  it('a complete offer is the seller price', () => {
    expect(pairingPrice({ offer: { priceMinor: 100 }, complete: true, fromMinor: 120 })).toEqual({
      pricePence: 100,
      kind: 'seller',
    });
  });
  it('no offer, or an incomplete one, is Googles price', () => {
    expect(pairingPrice({ offer: null, complete: false, fromMinor: 120 })).toEqual({
      pricePence: 120,
      kind: 'google',
    });
    expect(pairingPrice({ offer: { priceMinor: 100 }, complete: false, fromMinor: 120 })).toEqual({
      pricePence: 120,
      kind: 'google',
    });
  });
});

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
const attempt = (outboundIndex: number, returns: ListedReturn[]) => ({
  outboundIndex,
  outboundFits: true,
  listed: returns.length > 0 ? 'returns' : 'none-for-cell',
  moreListed: false,
  returns,
  optionsUnparsed: 0,
  optionsOtherCell: returns.length > 0 ? 0 : 1,
  resultsStated: null,
});
const readOf = (over: Record<string, unknown> = {}, returns: ListedReturn[] = [back(1180)]): ReturnRead =>
  returnReadSchema.parse({
    limits: NO_LIMITS,
    status: 'read',
    rule: null,
    attempts: [attempt(0, returns)],
    triedAll: false,
    booking: null,
    ...over,
  });

describe('checkOfRead', () => {
  const flights = [out(500)];
  it('no read is unread', () => {
    expect(checkOfRead(null, flights, NO_LIMITS)).toEqual(UNREAD);
  });
  it('a no-outbound read is none', () => {
    const r = returnReadSchema.parse({
      limits: NO_LIMITS,
      status: 'no-outbound',
      rule: null,
      attempts: [],
      triedAll: true,
      booking: null,
    });
    expect(checkOfRead(r, [], NO_LIMITS)).toEqual(NONE);
  });
  it('a return status other than read or no-outbound is unread', () => {
    const r = readOf({ status: 'select-failed', rule: 'select-failed', attempts: [] });
    expect(r.status).toBe('select-failed');
    expect(checkOfRead(r, flights, NO_LIMITS)).toEqual(UNREAD);
  });
  it('limits other than today is unread', () => {
    expect(checkOfRead(readOf(), flights, { ...NO_LIMITS, maxStops: 1 })).toEqual(UNREAD);
  });
  it('no pairing within the limits is none', () => {
    const limits = { ...NO_LIMITS, maxStops: 0 };
    const r = readOf({ limits }, [back(1180, { stops: 1 })]);
    expect(checkOfRead(r, flights, limits)).toEqual(NONE);
    expect(checkOfRead(readOf({}, []), flights, NO_LIMITS)).toEqual(NONE);
  });
  it('a fitting pairing without a booking is confirmed at the from price', () => {
    expect(checkOfRead(readOf(), flights, NO_LIMITS)).toEqual(conf(118_000));
  });
  it('a booking that ended transient still confirms at the from price', () => {
    const booking = {
      status: 'expand-failed',
      rule: 'expand-failed',
      attempt: 0,
      returnIndex: 0,
      offers: [],
      moreControl: false,
      grouped: 0,
      unparsed: 0,
      nonGbp: 0,
      expanded: false,
      offersStated: null,
    };
    const r = readOf({ booking });
    expect(checkOfRead(r, flights, NO_LIMITS)).toEqual(conf(118_000));
  });
  it('a no-outbound read under other limits is unread; under the same limits it stays none', () => {
    const noOutbound = (limits: FlightLimits) =>
      returnReadSchema.parse({
        limits,
        status: 'no-outbound',
        rule: null,
        attempts: [],
        triedAll: true,
        booking: null,
      });
    expect(checkOfRead(noOutbound({ ...NO_LIMITS, maxStops: 1 }), [], NO_LIMITS)).toEqual(UNREAD);
    expect(checkOfRead(noOutbound(NO_LIMITS), [], NO_LIMITS)).toEqual(NONE);
  });
  const readBooking = (over: Record<string, unknown>) => ({
    status: 'read',
    rule: null,
    attempt: 0,
    returnIndex: 0,
    offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 117_000 }],
    moreControl: false,
    grouped: 0,
    unparsed: 0,
    nonGbp: 0,
    expanded: false,
    offersStated: null,
    ...over,
  });
  it('a complete booking of the pairing confirms at the cheapest seller offer', () => {
    const r = readOf({ booking: readBooking({}) });
    expect(checkOfRead(r, flights, NO_LIMITS)).toEqual(conf(117_000));
  });
  it('a booking that names a different return is not the pairing: confirmed at the from price', () => {
    // why: returns 1180 (index 0, the pairing) and 1300 (index 1); the booking read return 1 with a 900 offer
    const r = readOf(
      {
        booking: readBooking({
          returnIndex: 1,
          offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 90_000 }],
        }),
      },
      [back(1180), back(1300)],
    );
    expect(checkOfRead(r, flights, NO_LIMITS)).toEqual(conf(118_000));
  });
});
