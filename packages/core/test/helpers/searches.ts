// Builders for the Searches contract tests (WP20 Task 20.1). Worked example only: London → New York (LHR, LGW → JFK,
// EWR), a relative window from a week out for 182 days, stays of 10 to 21 nights, as spec §11's form defaults.
// Values are the wire's input shapes (plain strings), so every test parses what a client or the api would send.

import type { DatePairFigure } from '../../src/datePairs/encode.js';
import { SYNTHETIC_SELLER_BOOKING } from '../../src/testing/booking.js';
import { calendarProvenance, figurePairing, pairingFigure, verifiedFigure } from './datePairs.js';

/**
 * The worked-example card: a manual run that searched 384 of 405 date pairs; two trips (£450 read, £600 verified), three
 * dates with flights read, and three dates lower on the calendar from £300.
 */
export function searchCard(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'def-london-new-york',
    name: 'London to New York',
    origins: ['LHR', 'LGW'],
    destinations: ['JFK', 'EWR'],
    window: cardWindow(),
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    schedule: null,
    discovery: ['travelpayouts', 'camoufox'],
    latestRun: latestRun(),
    spaceChangedSince: false,
    // why: Task 2's hand-written set: the £450 read trip, then the £600 verified one with its seller's booking
    trips: [cardTrip(PAIRING_450, { departureDate: '2027-03-14', returnDate: '2027-03-24' }), cardTrip()],
    verifiedDetails: [verifiedDetail()],
    readDates: 3,
    lowerOnCalendar: lowerOnCalendar(),
    ...over,
  };
}

/** The card's window: relative, a week out for 182 days, resolved on 2027-02-28. */
export function cardWindow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'relative',
    departureFrom: '2027-03-07',
    departureTo: '2027-09-04',
    startOffsetDays: 7,
    lengthDays: 182,
    lengthMonths: null,
    ...over,
  };
}

/** A figure as the wire carries it: the decoder's less its airport-pair index. */
export function wireFigure(f: DatePairFigure): Record<string, unknown> {
  const { airportPair: _a, ...rest } = f;
  return rest;
}

const price = (f: DatePairFigure, pricePence: number): DatePairFigure => ({
  ...f,
  price: { ...f.price, pricePence },
});
/** Task 2's read trip: a pairing figure at £450 on LHR → JFK, its offer's price. */
export const PAIRING_450 = price(
  pairingFigure({ pairing: figurePairing({ pricePence: 45_000, fromPence: 45_000 }) }),
  45_000,
);
/** Task 2's verified trip: £600 on LHR → JFK, a seller's booking from SearchApi's booking options. */
export const VERIFIED_600 = price(verifiedFigure({ hasBookingOptions: true }), 60_000);

/**
 * One trip of a card (Ruling 7): `figure` (the £600 verified trip by default) on 15 → 25 Mar 2027, 10 nights. The figure
 * holds its airports and `fromEarlierSearch`.
 */
export function cardTrip(
  figure: DatePairFigure = VERIFIED_600,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    figure: wireFigure(figure),
    departureDate: '2027-03-15',
    returnDate: '2027-03-25',
    nights: 10,
    ...over,
  };
}

/** Ruling 2's details of the £600 verified trip (15 → 25 Mar 2027, LHR → JFK): its legs and the seller's booking. */
export function verifiedDetail(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    departureDate: '2027-03-15',
    returnDate: '2027-03-25',
    origin: 'LHR',
    destination: 'JFK',
    legs: { out: { durationMinutes: 500, stops: 1 }, back: { durationMinutes: 470, stops: 0 } },
    booking: SYNTHETIC_SELLER_BOOKING,
    ...over,
  };
}

/** Task 2's £300 calendar price from the Aviasales cache, 16 → 26 Mar 2027 on LHR → JFK, its full price cell and kind. */
export const LOWER_CHEAPEST = {
  price: {
    pricePence: 30_000,
    provenance: calendarProvenance(),
    stale: false,
    ageHours: 50,
    truncated: false,
  },
  departureDate: '2027-03-16',
  returnDate: '2027-03-26',
  origin: 'LHR',
  destination: 'JFK',
  kind: 'cached',
} as const;

/** The card's "lower on the calendar" line (Ruling 5): three dates look lower than the £450 trip, from `LOWER_CHEAPEST`. */
export function lowerOnCalendar(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { count: 3, cheapest: LOWER_CHEAPEST, ...over };
}

/**
 * The card's latest run: completed, 384 of 405 date pairs searched, 21 never searched, 10 flight lists read. Its marks
 * (Ruling 7) follow the counts it is given unless stated: the searched date pairs priced, the rest not searched.
 */
export function latestRun(over: Record<string, unknown> = {}): Record<string, unknown> {
  const datePairs = typeof over.datePairs === 'number' ? over.datePairs : 405;
  const searched = typeof over.datePairsSearched === 'number' ? over.datePairsSearched : 384;
  return {
    id: 'exec-1',
    status: 'completed',
    trigger: 'manual',
    startedAt: '2027-02-28T09:12:00.000Z',
    finishedAt: '2027-02-28T11:41:00.000Z',
    datePairs: 405,
    datePairsSearched: 384,
    datePairsNeverSearched: 21,
    stage: 'verification',
    flights: { planned: 10, read: 10, reused: 0, failed: 0, ended: null, confirm: null, stopCause: null },
    estimatedFinishAt: null,
    stop: null,
    marks: {
      priced: searched,
      'no-price-shown': 0,
      'couldnt-read': 0,
      'not-reached': 0,
      'not-searched': datePairs - searched,
    },
    browserUnavailable: 0,
    ...over,
  };
}

/** A create-and-start body for the worked example: free sources only, so the shown totals are £0 and 0 calls. */
export function createAndStartBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'London to New York',
    origins: ['LHR', 'LGW'],
    destinations: ['JFK', 'EWR'],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500 },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: {
      discovery: ['travelpayouts'],
      verification: [],
      discoveryRefreshHours: { travelpayouts: 168 },
    },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: 'Europe/London',
    enabled: false,
    confirmCostPence: 0,
    confirmCalls: 0,
    requestKey: '3f6c1d2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f',
    ...over,
  };
}

/** The stored search a create-and-start answers with (definitionResponseSchema's input shape). */
export function definitionResponse(over: Record<string, unknown> = {}): Record<string, unknown> {
  const { confirmCostPence: _p, confirmCalls: _c, requestKey: _k, ...fields } = createAndStartBody();
  return {
    ...fields,
    id: 'def-london-new-york',
    confirmedCostPence: 0,
    confirmedCalls: 0,
    createdAt: '2027-02-28T09:12:00.000Z',
    updatedAt: '2027-02-28T09:12:00.000Z',
    deletedAt: null,
    budgetFit: { fits: true, runsPerMonth: 0, perScope: [] },
    estimate: null,
    needsConfirmation: null,
    notices: [],
    ...over,
  };
}
