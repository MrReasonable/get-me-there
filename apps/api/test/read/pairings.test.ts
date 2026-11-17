// Ruling 5 (plan Task 5; Review Focus 2): a booking page's address belongs to one pairing. It is attached only when the
// list's booking read is that pairing's, by the rule `pairingOffer` holds for offers (the booking's attempt and return
// are `bookingReturnOf`'s and the pairing's); otherwise the price says "Find on Google Flights".
import { type BookingRead, type ReturnRead, returnReadSchema } from '@gmt/core';
import { PAIRING_FIXTURE, PAIRING_LIMITS, SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import type { StoredFlightList } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { candidateOf, pairingBookingUrl, pairingGroupOf } from '../../src/read/pairings.js';
import { at, cell } from '../helpers/seed.js';

/** The shared fixture's list (its booking read names attempt 1, return 0) with its booking changed by `booking`. */
function listWith(booking: Partial<BookingRead> | null): StoredFlightList {
  const r = structuredClone(PAIRING_FIXTURE.returns);
  const returns: ReturnRead = returnReadSchema.parse({
    ...r,
    booking: booking === null || r.booking === null ? null : { ...r.booking, ...booking },
  });
  return {
    id: 1,
    definitionId: 'd',
    executionId: null,
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    cabin: 'economy',
    ...cell('LHR', 'JFK', '2026-11-02', '2026-11-12'),
    fetchedAt: at(-1),
    pointOfSale: 'GB',
    status: 'read',
    reason: null,
    listed: 'flights',
    minMinor: 48_000,
    tabMinor: null,
    cheapestView: 'cheapest',
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: 4,
    flights: structuredClone(PAIRING_FIXTURE.flights),
    returns,
  };
}

describe('pairingBookingUrl (Ruling 5)', () => {
  it("the booking read's address for its own pairing", () => {
    expect(
      pairingBookingUrl(listWith({ bookingUrl: SYNTHETIC_BOOKING_URL }), { attempt: 1, returnIndex: 0 }),
    ).toBe(SYNTHETIC_BOOKING_URL);
    // an expand-failed read saw the booking page too
    const expandFailed = listWith({
      status: 'expand-failed',
      rule: 'more-options:not-settled',
      expanded: false,
      bookingUrl: SYNTHETIC_BOOKING_URL,
    });
    expect(pairingBookingUrl(expandFailed, { attempt: 1, returnIndex: 0 })).toBe(SYNTHETIC_BOOKING_URL);
  });

  it("null for a booking read on attempt 1 when the figure's pairing is attempt 0's, and for another return", () => {
    const list = listWith({ bookingUrl: SYNTHETIC_BOOKING_URL });
    expect(pairingBookingUrl(list, { attempt: 0, returnIndex: 0 })).toBeNull();
    expect(pairingBookingUrl(list, { attempt: 1, returnIndex: 1 })).toBeNull();
  });

  it("null when the booking read is not bookingReturnOf's, even for the pairing it names", () => {
    // the worker books attempt 1's return 0 (the cheaper); a booking of its return 1 is not the one the app expects
    const other = listWith({ returnIndex: 1, bookingUrl: SYNTHETIC_BOOKING_URL });
    expect(pairingBookingUrl(other, { attempt: 1, returnIndex: 1 })).toBeNull();
  });

  it('null with no address, no booking read, no return read, or a booking that read no offers', () => {
    expect(pairingBookingUrl(listWith({ bookingUrl: null }), { attempt: 1, returnIndex: 0 })).toBeNull();
    expect(pairingBookingUrl(listWith(null), { attempt: 1, returnIndex: 0 })).toBeNull();
    expect(
      pairingBookingUrl({ ...listWith(null), returns: null }, { attempt: 1, returnIndex: 0 }),
    ).toBeNull();
    const notSettled = listWith({ status: 'not-settled', rule: 'not-settled', offers: [], bookingUrl: null });
    expect(pairingBookingUrl(notSettled, { attempt: 1, returnIndex: 0 })).toBeNull();
  });
});

describe("candidateOf's legs (Ruling 1)", () => {
  // why: the fixture has four outbounds and two attempts' returns; the chosen outbound (index 3) and return (attempt 1,
  // return 0) are given values no other flight or return has, so a wrong pick shows
  const chosenLegs = () => {
    const list = listWith(null);
    const returns = structuredClone(PAIRING_FIXTURE.returns);
    const attempt = returns.attempts[1];
    const ret = attempt?.returns[0];
    const out = list.flights[3];
    if (attempt === undefined || ret === undefined || out === undefined) throw new Error('fixture shape');
    out.durationMinutes = 640;
    out.stops = 1;
    out.carriers = ['Aer Lingus'];
    out.arrivesDayOffset = 1;
    ret.durationMinutes = 415;
    ret.stops = 0;
    ret.carriers = ['Virgin Atlantic'];
    ret.arrivesDayOffset = -1;
    return { ...list, returns: returnReadSchema.parse(returns) };
  };

  it('takes the legs of the outbound and the return it chose, and the group carries them', () => {
    const c = candidateOf(chosenLegs(), PAIRING_LIMITS, at(0), 168);
    const expected = {
      out: { durationMinutes: 640, stops: 1, carriers: ['Aer Lingus'], arrivesDayOffset: 1 },
      back: { durationMinutes: 415, stops: 0, carriers: ['Virgin Atlantic'], arrivesDayOffset: -1 },
    };
    expect(c?.legs).toEqual(expected);
    if (c === null) throw new Error('a candidate');
    expect(pairingGroupOf(c).legs).toEqual(expected);
  });
});

describe("pairingGroupOf's booking address (final review, deferred minor 13)", () => {
  const candidate = () => {
    const c = candidateOf(listWith({ bookingUrl: SYNTHETIC_BOOKING_URL }), PAIRING_LIMITS, at(0), 168);
    if (c === null) throw new Error('the fixture list gives a candidate');
    return c;
  };

  it('carries the address of a pairing within the limits', () => {
    expect(candidate().which).not.toBe('over-limit');
    expect(pairingGroupOf(candidate()).bookingUrl).toBe(SYNTHETIC_BOOKING_URL);
  });

  it('gives no address for an over-limit pairing: a trip over the limits is never offered for booking', () => {
    expect(pairingGroupOf({ ...candidate(), which: 'over-limit', fits: false }).bookingUrl).toBeNull();
  });
});
