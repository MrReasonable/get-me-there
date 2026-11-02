import type { BookingRead, FlightLimits, ReturnRead } from '@gmt/core';
import { PAIRING_FIXTURE, PAIRING_LIMITS } from '@gmt/core/testing';
import { describe, expect, it } from 'vitest';
import type { FlightList } from '../../../../src/api/types.js';
import { COPY } from '../../../../src/copy.js';
import {
  allReturnsInOrder,
  bookingNote,
  mismatchOf,
  pairingOf,
  readDoneWords,
  returnNote,
  returnsWereRead,
} from '../../../../src/views/Dates/pairing.js';
import {
  flightList,
  listedFlight,
  listedReturn,
  pairingList,
  returnAttempt,
  returnRead,
} from '../../../fixtures.searches.js';

// Spec rev 56 §6.9, §11 "Flights" (WP21 Task 21.7): the pure side of the pairing section. Over the one shared fixture
// (`@gmt/core/testing`, Review Focus 1): the same literals as core's and the api's tests (attempt 1, return 0, £1,180,
// QQ Travel, 3 offers), and the pick is neither the first outbound in page order nor the cheapest.

const F = COPY.flights;
const FIXTURE = pairingList();
/** The fixture's return read with some fields replaced, through its schema (the list's own parse). */
const withReturns = (over: Partial<ReturnRead>): FlightList =>
  pairingList({ returns: { ...PAIRING_FIXTURE.returns, ...over } });
/** The fixture's booking read with some fields replaced. */
const withBooking = (over: Partial<BookingRead>): FlightList => {
  const booking = PAIRING_FIXTURE.returns.booking;
  if (booking === null) throw new Error('fixture: no booking');
  return withReturns({ booking: { ...booking, ...over } });
};
const SKIPPED: Pick<BookingRead, 'attempt' | 'returnIndex' | 'offers'> = {
  attempt: null,
  returnIndex: null,
  offers: [],
};

describe('pairingOf (spec rev 56 §6.9 "Which pairing"; the same literals as core and the api)', () => {
  it('the fixture: attempt 1, the next-cheapest outbound 3, its £1,180 return first, QQ Travel the cheapest of 3 offers', () => {
    const p = pairingOf(FIXTURE, PAIRING_LIMITS);
    expect(p).toMatchObject({
      attempt: 1,
      returnIndex: 0,
      which: 'next-cheapest',
      outboundIndex: 3,
      outboundFits: true,
      fromMinor: 118_000,
      fits: true,
      selectedNow: true,
      underCurrentLimits: true,
      offer: { seller: 'QQ Travel', fare: null, priceMinor: 118_000, offersRead: 3, complete: true },
    });
    expect(p?.returns.shown[0]?.fromMinor).toBe(118_000);
    expect(p?.returns.shown.map((r) => r.fromMinor)).toEqual([118_000, 125_000]);
    expect(p?.outbound).toBe(FIXTURE.flights[3]);
    // the pick is neither the first in page order nor the cheapest outbound read (Review Focus 1)
    expect(p?.outboundIndex).not.toBe(0);
    expect(p?.outbound.amountMinor).toBeGreaterThan(Math.min(...FIXTURE.flights.map((f) => f.amountMinor)));
  });

  it("'cheapest' for a one-attempt read; the outbound's own fit as stored", () => {
    const one = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({ attempts: [returnAttempt({ outboundIndex: 2 })] }),
    });
    expect(pairingOf(one, PAIRING_LIMITS)).toMatchObject({
      attempt: 0,
      which: 'cheapest',
      outboundIndex: 2,
      outboundFits: true,
      offer: null,
    });
  });

  it('selectedNow false when the limits today select another outbound; underCurrentLimits false when they differ', () => {
    const direct: FlightLimits = { ...PAIRING_LIMITS, maxStops: 0 };
    expect(pairingOf(FIXTURE, direct)).toMatchObject({ selectedNow: false, underCurrentLimits: false });
    // the first pick stays (outbound 2) while the second changes: a 14h 10m limit leaves outbound 3 (14h 50m) out, so
    // outbound 0 would be selected next
    const shorter: FlightLimits = { ...PAIRING_LIMITS, maxJourneyMinutes: 850 };
    expect(pairingOf(FIXTURE, shorter)?.selectedNow).toBe(false);
    // the first pick changes: a 27h limit with 2 stops lets outbound 1 (£480) in
    const longer: FlightLimits = { ...PAIRING_LIMITS, maxJourneyMinutes: 1700, maxStops: 2 };
    expect(pairingOf(FIXTURE, longer)?.selectedNow).toBe(false);
    // the same limits, written apart: still under the current limits
    expect(pairingOf(FIXTURE, { ...PAIRING_LIMITS })).toMatchObject({
      selectedNow: true,
      underCurrentLimits: true,
    });
  });

  it('a two-attempt read on one outbound (both picks the same flight) is not selectedNow, and does not throw', () => {
    const one = [PAIRING_FIXTURE.flights[2] ?? listedFlight()];
    const over = returnAttempt({ outboundIndex: 0, returns: [listedReturn({ stops: 2 })] });
    const list = flightList({
      flights: one,
      returns: returnRead({ attempts: [over, returnAttempt({ outboundIndex: 0 })] }),
    });
    expect(pairingOf(list, PAIRING_LIMITS)?.selectedNow).toBe(false);
  });

  it('a one-attempt read whose first pick today is another outbound is not selectedNow', () => {
    const one = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({ attempts: [returnAttempt({ outboundIndex: 3 })] }),
    });
    expect(pairingOf(one, PAIRING_LIMITS)?.selectedNow).toBe(false);
  });

  it('offer null when the booking is of another attempt or return than bookingReturnOf names', () => {
    const second = listedReturn({ departsLocal: '19:10', fromMinor: 125_000 });
    const attempt = returnAttempt({ outboundIndex: 0, returns: [listedReturn(), second] });
    const booked = (returnIndex: number) =>
      flightList({
        flights: PAIRING_FIXTURE.flights,
        returns: returnRead({
          attempts: [attempt],
          booking: {
            status: 'read',
            rule: null,
            attempt: 0,
            returnIndex,
            expanded: true,
            moreControl: false,
            grouped: 0,
            offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 118_000 }],
            unparsed: 0,
            nonGbp: 0,
            offersStated: null,
          },
        }),
      });
    expect(pairingOf(booked(0), PAIRING_LIMITS)?.offer).toMatchObject({ priceMinor: 118_000, offersRead: 1 });
    expect(pairingOf(booked(1), PAIRING_LIMITS)?.offer).toBeNull();
  });

  it('offer null for a booking that kept no offers (not read, or expand-failed before any offer)', () => {
    expect(
      pairingOf(
        withBooking({ status: 'not-settled', rule: 'booking:not-settled', offers: [] }),
        PAIRING_LIMITS,
      )?.offer,
    ).toBeNull();
    expect(
      pairingOf(withBooking({ status: 'expand-failed', rule: 'more-options', offers: [] }), PAIRING_LIMITS)
        ?.offer,
    ).toBeNull();
    expect(pairingOf(withReturns({ booking: null }), PAIRING_LIMITS)?.offer).toBeNull();
  });

  it("offers count only for bookingReturnOf's pairing that is also the one shown (the api's rule)", () => {
    // outbound 0 is direct, so under "direct only" today the pairing is the direct return 1, while the read (1 stop
    // allowed) booked return 0
    const attempt = returnAttempt({
      outboundIndex: 0,
      returns: [
        listedReturn(),
        listedReturn({ departsLocal: '19:10', stops: 0, durationMinutes: 485, fromMinor: 125_000 }),
      ],
    });
    const booking = (returnIndex: number): BookingRead => ({
      status: 'read',
      rule: null,
      attempt: 0,
      returnIndex,
      expanded: true,
      moreControl: false,
      grouped: 0,
      offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 118_000 }],
      unparsed: 0,
      nonGbp: 0,
      offersStated: null,
    });
    const list = (returnIndex: number) =>
      flightList({
        flights: PAIRING_FIXTURE.flights,
        returns: returnRead({ attempts: [attempt], booking: booking(returnIndex) }),
      });
    const direct: FlightLimits = { ...PAIRING_LIMITS, maxStops: 0 };
    // the booking is bookingReturnOf's (return 0) but the pairing today is return 1: no offer for it
    expect(pairingOf(list(0), direct)).toMatchObject({ returnIndex: 1, offer: null });
    // the booking names today's pairing (return 1) but not bookingReturnOf's: no offer either
    expect(pairingOf(list(1), direct)).toMatchObject({ returnIndex: 1, offer: null });
    expect(pairingOf(list(0), PAIRING_LIMITS)?.offer).toMatchObject({ priceMinor: 118_000 });
  });

  it('an over-limit outbound: the pairing (the cheapest of all) leads the returns shown, three at most', () => {
    const outbound = listedFlight({ departsLocal: '09:00', stops: 1 });
    const rs = [
      listedReturn({ fromMinor: 130_000, stops: 0 }),
      listedReturn({ fromMinor: 100_000, stops: 1 }),
      listedReturn({ fromMinor: 110_000, stops: 0 }),
      listedReturn({ fromMinor: 120_000, stops: 0 }),
    ];
    const direct: FlightLimits = { ...PAIRING_LIMITS, maxStops: 0 };
    const list = flightList({
      flights: [outbound],
      returns: returnRead({
        limits: direct,
        attempts: [returnAttempt({ outboundIndex: 0, outboundFits: false, returns: rs })],
      }),
    });
    const p = pairingOf(list, direct);
    expect(p).toMatchObject({ fits: false, fromMinor: 100_000, outboundFits: false });
    expect(p?.returns.shown.map((r) => r.fromMinor)).toEqual([100_000, 110_000, 120_000]);
    expect(p?.returns).toMatchObject({ moreRead: 1, moreOutside: 0 });
  });

  it("ruling A8: an expand-failed booking keeps its offers; complete only when the cheapest equals the return's from", () => {
    const failed = { status: 'expand-failed', rule: 'more-options', expanded: false } as const;
    expect(pairingOf(withBooking(failed), PAIRING_LIMITS)?.offer).toMatchObject({
      priceMinor: 118_000,
      complete: true,
    });
    const dearer = withBooking({
      ...failed,
      offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }],
    });
    expect(pairingOf(dearer, PAIRING_LIMITS)?.offer).toMatchObject({ priceMinor: 119_500, complete: false });
  });

  it('null for every status but read, for a read with no return listed, for a failed list and for no return read', () => {
    for (const status of ['no-outbound', 'not-verified'] as const)
      expect(pairingOf(withReturns({ status, attempts: [], booking: null }), PAIRING_LIMITS)).toBeNull();
    for (const status of ['skipped', 'select-failed', 'not-settled', 'unrecognised'] as const)
      expect(
        pairingOf(withReturns({ status, rule: 'spacing', attempts: [], booking: null }), PAIRING_LIMITS),
      ).toBeNull();
    const none = returnAttempt({ outboundIndex: 2, listed: 'none-for-cell', returns: [] });
    expect(pairingOf(withReturns({ attempts: [none], booking: null }), PAIRING_LIMITS)).toBeNull();
    expect(pairingOf(flightList(), PAIRING_LIMITS)).toBeNull();
    expect(
      pairingOf(
        flightList({ status: 'failed', reason: 'network', listed: null, minMinor: null, flights: [] }),
        PAIRING_LIMITS,
      ),
    ).toBeNull();
  });

  it('a tie on the "from" price goes to the earlier attempt, then the lower index, as core breaks it', () => {
    const twin = listedReturn({ fromMinor: 118_000 });
    const one = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({ attempts: [returnAttempt({ outboundIndex: 2, returns: [twin, twin] })] }),
    });
    expect(pairingOf(one, PAIRING_LIMITS)).toMatchObject({ attempt: 0, returnIndex: 0 });
  });

  it("the pairing's return leads the returns shown, then the chooser's order, at most three", () => {
    const over = listedReturn({ departsLocal: '06:00', fromMinor: 100_000, stops: 2 });
    const rs = [
      listedReturn({ fromMinor: 130_000 }),
      over,
      listedReturn({ fromMinor: 118_000 }),
      listedReturn({ fromMinor: 121_000, durationMinutes: 400, stops: 0 }),
      listedReturn({ fromMinor: 125_000 }),
    ];
    const list = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({ attempts: [returnAttempt({ outboundIndex: 2, returns: rs })] }),
    });
    const p = pairingOf(list, PAIRING_LIMITS);
    expect(p?.returns.shown.map((r) => r.fromMinor)).toEqual([118_000, 121_000, 125_000]);
    expect(p?.returns).toMatchObject({ moreRead: 2, moreOutside: 1, overLimit: false });
    const read = list.returns?.attempts[0]?.returns;
    if (p === null || read === undefined) throw new Error('no pairing');
    // why: the list's own (parsed) returns, as the section passes them: the shown ones are found by identity
    expect(allReturnsInOrder(read, p, PAIRING_LIMITS).map((r) => r.fromMinor)).toEqual([
      118_000, 121_000, 125_000, 100_000, 130_000,
    ]);
  });

  it('every return over the limits: the cheapest of all leads, fits false, overLimit', () => {
    const rs = [
      listedReturn({ fromMinor: 130_000, stops: 2 }),
      listedReturn({ fromMinor: 120_400, stops: 2 }),
    ];
    const list = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({ attempts: [returnAttempt({ outboundIndex: 2, returns: rs })] }),
    });
    const p = pairingOf(list, PAIRING_LIMITS);
    expect(p).toMatchObject({ fits: false, fromMinor: 120_400 });
    expect(p?.returns).toMatchObject({ overLimit: true, moreRead: 0 });
  });
});

describe('mismatchOf (spec rev 56 §6.9: both figures named, nothing reconciled)', () => {
  it('null when the cheapest offer equals the shown return\'s "from" price, and with no offer', () => {
    expect(mismatchOf(pairingOf(FIXTURE, PAIRING_LIMITS))).toBeNull();
    expect(mismatchOf(null)).toBeNull();
    expect(mismatchOf(pairingOf(withReturns({ booking: null }), PAIRING_LIMITS))).toBeNull();
  });
  it('the two prices when the cheapest offer differs', () => {
    const dearer = withBooking({
      offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }],
    });
    expect(mismatchOf(pairingOf(dearer, PAIRING_LIMITS))).toEqual({
      offerMinor: 119_500,
      fromMinor: 118_000,
    });
  });
});

describe('returnNote (spec rev 56 §11 "Status notes", with what happens next)', () => {
  const status = (s: ReturnRead['status'], rule: string | null = null): FlightList =>
    withReturns({ status: s, rule, attempts: [], booking: null });
  it('each non-read status in words; no-outbound says nothing beyond the outbound line', () => {
    const next =
      'return flights not read: tried again at the next search, or press Read flights for this date now';
    expect(returnNote(status('select-failed', 'select-outbound:not-found'), COPY, true)).toBe(next);
    expect(returnNote(status('not-settled', 'returns:not-settled'), COPY, true)).toBe(next);
    expect(returnNote(status('unrecognised', 'returns:shape'), COPY, true)).toBe(next);
    // why: final review B-I3: with no read to go now (two transient ends in a row wait for the refresh), the note says
    // so and names no button
    expect(returnNote(status('not-settled', 'returns:not-settled'), COPY, false)).toBe(
      "return flights not read: read again once older than this search's refresh",
    );
    expect(returnNote(status('not-verified'), COPY, true)).toBe(
      'return flights are not yet read on this kind of machine; see the recording session in docs/setup.md',
    );
    expect(returnNote(status('skipped', 'monthly-headroom'), COPY, true)).toBe(
      'return flights not read: fewer than 2 browser pages left this month',
    );
    expect(returnNote(status('skipped', 'spacing'), COPY, true)).toBe(
      'return flights not read: the wait between pages ran past its time',
    );
    expect(returnNote(status('skipped', 'something-new'), COPY, true)).toBe(
      'return flights not read: a step before them was not made',
    );
    expect(returnNote(status('no-outbound'), COPY, true)).toBeNull();
  });
  it('the more-listed clause: a stated count above the options read; else the control alone; else nothing', () => {
    const note = (o: Parameters<typeof returnAttempt>[0]) =>
      returnNote(flightList({ returns: returnRead({ attempts: [returnAttempt(o)] }) }), COPY, true);
    expect(note({ resultsStated: 2 })).toBe('Google listed 2 return flights; this app read the first 1');
    expect(note({ resultsStated: 1, moreListed: true })).toBe(
      'Google listed more return flights than this app read',
    );
    expect(note({ resultsStated: 1 })).toBeNull();
    expect(note({ resultsStated: 0 })).toBeNull();
  });
  it('returnsWereRead: exactly a return read whose status is read', () => {
    expect(returnsWereRead(FIXTURE)).toBe(true);
    expect(returnsWereRead(flightList())).toBe(false);
    expect(
      returnsWereRead(withReturns({ status: 'not-verified', rule: null, attempts: [], booking: null })),
    ).toBe(false);
  });
  it('21.7 code M6: nothing for a list read without a return phase (or stored before them): it shows as the outbound list', () => {
    expect(returnNote(flightList(), COPY, true)).toBeNull();
  });
  it("21.7 code M1 / prov-010: the read clauses of the attempt asked for (the shown pairing's), the last one by default", () => {
    const two = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({
        attempts: [
          returnAttempt({
            outboundIndex: 2,
            resultsStated: 12,
            returns: [listedReturn({ stops: 2 }), listedReturn({ stops: 2 })],
          }),
          returnAttempt({ outboundIndex: 3, optionsUnparsed: 1 }),
        ],
      }),
    });
    expect(returnNote(two, COPY, true, 0)).toBe('Google listed 12 return flights; this app read the first 2');
    expect(returnNote(two, COPY, true)).toBe('1 return option unread');
  });
  it('a read: the counts clause and the more-listed clause, each only when it applies; null for a clean read', () => {
    const counts = returnRead({
      attempts: [
        returnAttempt({ optionsUnparsed: 2, optionsOtherCell: 1, moreListed: true, resultsStated: 12 }),
      ],
    });
    // why: 1 return + 2 unread + 1 for another cell = the first 4 options the view stated
    expect(returnNote(flightList({ returns: counts }), COPY, true)).toBe(
      '2 return options unread, 1 for other airports or days · Google listed 12 return flights; this app read the first 4',
    );
    const more = returnRead({ attempts: [returnAttempt({ moreListed: true })] });
    expect(returnNote(flightList({ returns: more }), COPY, true)).toBe(
      'Google listed more return flights than this app read',
    );
    const unread = returnRead({ attempts: [returnAttempt({ optionsUnparsed: 2 })] });
    expect(returnNote(flightList({ returns: unread }), COPY, true)).toBe('2 return options unread');
    const other = returnRead({ attempts: [returnAttempt({ optionsOtherCell: 1 })] });
    expect(returnNote(flightList({ returns: other }), COPY, true)).toBe(
      '1 return option for other airports or days',
    );
    expect(returnNote(flightList({ returns: returnRead() }), COPY, true)).toBeNull();
    // the fixture's last attempt showed a "View more" control and stated no count
    expect(returnNote(FIXTURE, COPY, true)).toBe('Google listed more return flights than this app read');
  });
});

describe('bookingNote (spec rev 56 §11: a booking read that did not finish, with what happens next)', () => {
  const note = (over: Partial<BookingRead>) => bookingNote(withBooking(over), COPY, true);
  it('each of the seven non-read statuses in words; null for read and for no booking read', () => {
    const next = 'sellers not read: tried again at the next search, or press Read flights for this date now';
    expect(note({ status: 'select-failed', rule: 'select-return:not-found', offers: [] })).toBe(next);
    expect(note({ status: 'not-settled', rule: 'booking:not-settled', offers: [] })).toBe(next);
    expect(note({ status: 'unrecognised', rule: 'currency', offers: [] })).toBe(next);
    // why: final review B-I3: with no read to go now, after the refresh and no button named
    expect(
      bookingNote(
        withBooking({ status: 'not-settled', rule: 'booking:not-settled', offers: [] }),
        COPY,
        false,
      ),
    ).toBe("sellers not read: read again once older than this search's refresh");
    expect(note({ status: 'expand-failed', rule: 'more-options' })).toBe(
      'sellers read before the list could be expanded; the cheapest may be missing',
    );
    // why: 21.7 prov-014: an expansion that failed before any offer read none: one note, the transient one
    expect(note({ status: 'expand-failed', rule: 'more-options', offers: [] })).toBe(next);
    expect(note({ status: 'skipped', rule: 'monthly-headroom', ...SKIPPED })).toBe(
      'sellers not read: fewer than 2 browser pages left this month',
    );
    expect(note({ status: 'skipped', rule: 'not-cheapest-view', ...SKIPPED })).toBe(
      'sellers not read: the list was not on its Cheapest view',
    );
    expect(note({ status: 'skipped', rule: 'reload:not-settled', ...SKIPPED })).toBe(
      'sellers not read: the list could not be loaded again',
    );
    expect(note({ status: 'skipped', rule: 'second-selection', ...SKIPPED })).toBe(
      'sellers not read: the second outbound could not be selected',
    );
    expect(note({ status: 'not-verified', rule: null, ...SKIPPED })).toBe(
      'sellers are not yet read on this kind of machine',
    );
    expect(note({ status: 'no-pairing', rule: null, ...SKIPPED })).toBe(
      'no return flight to read sellers for',
    );
    expect(bookingNote(FIXTURE, COPY, true)).toBeNull();
    expect(bookingNote(withReturns({ booking: null }), COPY, true)).toBeNull();
    expect(bookingNote(flightList(), COPY, true)).toBeNull();
  });
});

describe('readDoneWords: what the live region says when a pressed read lands (spec rev 56 §11)', () => {
  const dates = '14 → 24 Mar';
  it('"Flights read for 14 → 24 Mar, 2 return flights" with returns; the status note for a non-read status', () => {
    expect(readDoneWords(FIXTURE, dates, COPY, PAIRING_LIMITS, true)).toBe(
      'Flights read for 14 → 24 Mar, 2 return flights',
    );
    expect(readDoneWords(flightList({ returns: returnRead() }), dates, COPY, PAIRING_LIMITS, true)).toBe(
      'Flights read for 14 → 24 Mar, 1 return flight',
    );
    expect(
      readDoneWords(
        withReturns({ status: 'not-verified', rule: null, attempts: [], booking: null }),
        dates,
        COPY,
        PAIRING_LIMITS,
        true,
      ),
    ).toBe(F.returnNotVerified);
    expect(
      readDoneWords(
        withReturns({ status: 'not-settled', rule: 'returns:not-settled', attempts: [], booking: null }),
        dates,
        COPY,
        PAIRING_LIMITS,
        true,
      ),
    ).toBe(F.returnTransient(true));
  });
  it("21.7 code M1: the count is the shown pairing's attempt's returns, not the last attempt's", () => {
    // why: both attempts over the stops limit they were read under (so a second was made); judged under today's limits,
    // 2 changes, attempt 0's returns fit and are the cheapest, and it listed 3 (final review B-I2: with none fitting the
    // last attempt's is shown, so the shown attempt differs from the last only after a limit edit)
    const over = (fromMinor: number) => listedReturn({ stops: 2, fromMinor });
    const list = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({
        attempts: [
          returnAttempt({ outboundIndex: 2, returns: [over(100_000), over(101_000), over(102_000)] }),
          returnAttempt({ outboundIndex: 3, returns: [over(140_000)] }),
        ],
      }),
    });
    expect(readDoneWords(list, dates, COPY, { ...PAIRING_LIMITS, maxStops: 2 }, true)).toBe(
      'Flights read for 14 → 24 Mar, 3 return flights',
    );
  });
  it("WP20's words for a list with no return read, a no-outbound read and a failed list", () => {
    expect(readDoneWords(flightList(), dates, COPY, PAIRING_LIMITS, true)).toBe(
      'Flights read for 14 → 24 Mar',
    );
    expect(
      readDoneWords(
        withReturns({ status: 'no-outbound', rule: null, attempts: [], booking: null }),
        dates,
        COPY,
        PAIRING_LIMITS,
        true,
      ),
    ).toBe('Flights read for 14 → 24 Mar');
    expect(
      readDoneWords(
        flightList({ status: 'failed', reason: 'network', listed: null, minMinor: null, flights: [] }),
        dates,
        COPY,
        PAIRING_LIMITS,
        true,
      ),
    ).toBe('Flights not read for 14 → 24 Mar');
  });
});
