import { describe, expect, it } from 'vitest';
import type { DatePairFigure } from '../../src/datePairs/encode.js';
import type { PairingRead } from '../../src/datePairs/pairing.js';
import { rankDatePairs } from '../../src/datePairs/rank.js';
import {
  cheapestTrips,
  flightsRead,
  isTrip,
  lowerOnCalendar,
  overLimitCount,
} from '../../src/datePairs/views.js';
import { asIsoDate } from '../../src/types/ids.js';
import { calendarFigure, datePair, pairingFigure, verifiedFigure } from '../helpers/datePairs.js';
import { NOW } from '../helpers/rows.js';

// Ruling 3 (Trips and Search plan): the shared rules the api's cards and the web's sections, run line and folds call,
// over a hand-written ranked list. Each entry is a figure-only stand-in for a ranked date pair; `name` keeps a failure
// readable.

const price = (f: DatePairFigure, pence: number): DatePairFigure => ({
  ...f,
  price: { ...f.price, pricePence: pence },
});
const calendar = (pence: number, over: Partial<DatePairFigure> = {}) => price(calendarFigure(over), pence);

/** The list in the board's rank order: current trips, then current calendar prices, then the not-current ones. */
const RANKED = [
  { name: 'trip pairing £450', figure: price(pairingFigure(), 45_000) },
  { name: 'trip verified £600', figure: price(verifiedFigure(), 60_000) },
  { name: 'calendar £300 not-read', figure: calendar(30_000) },
  { name: 'calendar £380 outbound-only', figure: calendar(38_000, { pairingRead: 'outbound-only' }) },
  {
    name: 'calendar £400 list-failed',
    figure: calendar(40_000, { pairingRead: 'list-failed', listReason: 'upstream' }),
  },
  { name: 'calendar £500 over-limit', figure: calendar(50_000, { pairingRead: 'over-limit' }) },
  { name: 'calendar £250 superseded', figure: calendar(25_000, { superseded: true }) },
  {
    name: 'verified £420 not seen again',
    figure: price(verifiedFigure({ notSeenInLatest: { ageHours: 30 } }), 42_000),
  },
  { name: 'no figure', figure: null },
] as const;

const names = (xs: ReadonlyArray<{ name: string }>) => xs.map((x) => x.name);

describe('isTrip (Ruling 3)', () => {
  it('is a current pairing or verified figure', () => {
    expect(isTrip(pairingFigure())).toBe(true);
    expect(isTrip(verifiedFigure())).toBe(true);
    expect(isTrip(calendarFigure())).toBe(false);
  });
  it('is not a verified figure the latest search did not see again', () => {
    expect(isTrip(verifiedFigure({ notSeenInLatest: { ageHours: 30 } }))).toBe(false);
  });
  // why: fix round 1: the calendar candidate a read trip replaced being superseded does not age the trip
  it('is a pairing figure whose calendar price was superseded', () => {
    expect(isTrip(pairingFigure({ superseded: true }))).toBe(true);
    expect(isTrip(pairingFigure({ superseded: true, notSeenInLatest: { ageHours: 30 } }))).toBe(true);
  });
  it('is not a verified figure marked superseded', () => {
    expect(isTrip(verifiedFigure({ superseded: true }))).toBe(false);
  });
  it('is an older read trip, with its age', () => {
    const older = pairingFigure({
      price: { ...pairingFigure().price, stale: 'refresh', ageHours: 80 },
    });
    expect(isTrip(older)).toBe(true);
  });
});

describe('flightsRead (Ruling 3)', () => {
  it('is true for the trips', () => {
    expect(flightsRead(pairingFigure())).toBe(true);
    expect(flightsRead(verifiedFigure())).toBe(true);
  });
  it.each<[PairingRead, boolean]>([
    ['not-read', false],
    ['outbound-only', false],
    ['list-failed', false],
    ['no-pairing-read', true],
    ['over-limit', true],
    ['sellers-not-read', true],
    ['offers-incomplete', true],
    ['within-older', true],
    ['within-other-limits', true],
  ])('a calendar figure reading %s: %s', (read, expected) => {
    expect(flightsRead(calendarFigure({ pairingRead: read }))).toBe(expected);
  });
  it('is false for a verified figure not seen again whose cell was never read', () => {
    expect(flightsRead(verifiedFigure({ notSeenInLatest: { ageHours: 30 } }))).toBe(false);
  });
  it('holds over the hand-written list', () => {
    expect(names(RANKED.filter((p) => p.figure !== null && flightsRead(p.figure)))).toEqual([
      'trip pairing £450',
      'trip verified £600',
      'calendar £500 over-limit',
    ]);
  });
});

describe('cheapestTrips (Ruling 3)', () => {
  it('is the trips in rank order', () => {
    expect(names(cheapestTrips(RANKED))).toEqual(['trip pairing £450', 'trip verified £600']);
  });
  it('keeps the rank order, not the price order', () => {
    const [a, b] = RANKED;
    expect(names(cheapestTrips([b, a]))).toEqual(['trip verified £600', 'trip pairing £450']);
  });
  it('takes a pairing figure whose calendar price was superseded, after the current trips as the rank orders it', () => {
    const space = {
      departureFrom: asIsoDate('2027-03-14'),
      departureTo: asIsoDate('2027-03-20'),
      minNights: 10,
      maxNights: 10,
    };
    const pairs = [
      datePair(space, 0, 1, { figure: price(pairingFigure({ superseded: true }), 30_000) }),
      datePair(space, 1, 1, { figure: price(pairingFigure(), 45_000) }),
      datePair(space, 2, 1, { figure: price(verifiedFigure(), 60_000) }),
      datePair(space, 3, 1, { figure: calendar(20_000) }),
    ];
    expect(cheapestTrips(rankDatePairs(pairs, NOW)).map((p) => p.figure.price.pricePence)).toEqual([
      45_000, 60_000, 30_000,
    ]);
  });
  it('is empty with no trip', () => {
    expect(cheapestTrips(RANKED.slice(2))).toEqual([]);
  });
});

describe('lowerOnCalendar (Ruling 3)', () => {
  it('is the current unread calendar figures below the cheapest trip, by price', () => {
    expect(names(lowerOnCalendar(RANKED))).toEqual([
      'calendar £300 not-read',
      'calendar £380 outbound-only',
      'calendar £400 list-failed',
    ]);
  });
  it('is every current unread calendar figure when there is no trip', () => {
    expect(names(lowerOnCalendar(RANKED.slice(2)))).toEqual([
      'calendar £300 not-read',
      'calendar £380 outbound-only',
      'calendar £400 list-failed',
    ]);
  });
  it('leaves out one priced the same as the cheapest trip', () => {
    const trip = { name: 'trip £400', figure: price(pairingFigure(), 40_000) };
    expect(names(lowerOnCalendar([trip, ...RANKED.slice(2)]))).toEqual([
      'calendar £300 not-read',
      'calendar £380 outbound-only',
    ]);
  });
  it('measures against the cheapest trip, whatever its rank', () => {
    // why: a stale trip ranks after a fresh dearer one, so the first trip is not always the cheapest
    const dear = { name: 'trip £600', figure: price(verifiedFigure(), 60_000) };
    const cheap = { name: 'trip £350', figure: price(pairingFigure(), 35_000) };
    expect(names(lowerOnCalendar([dear, cheap, ...RANKED.slice(2)]))).toEqual(['calendar £300 not-read']);
  });
  it('orders by price, keeping the rank order between equal prices', () => {
    const list = [
      { name: 'b £320', figure: calendar(32_000) },
      { name: 'a £310', figure: calendar(31_000) },
      { name: 'c £320', figure: calendar(32_000, { pairingRead: 'outbound-only' }) },
    ];
    expect(names(lowerOnCalendar(list))).toEqual(['a £310', 'b £320', 'c £320']);
  });
});

describe('overLimitCount (Ruling 3)', () => {
  it('counts the figures whose flights were all over the journey limit', () => {
    expect(overLimitCount(RANKED)).toBe(1);
    const another = { name: 'another', figure: calendar(70_000, { pairingRead: 'over-limit' }) };
    expect(overLimitCount([...RANKED, another])).toBe(2);
    expect(overLimitCount([])).toBe(0);
  });
});
