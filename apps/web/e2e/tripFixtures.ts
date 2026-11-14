import { apiContract } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import type { Page } from '@playwright/test';

/**
 * The Trip page's states for the layout checks (design 2026-11-08 §6.1; trip-page plan Task 7), served through route
 * interception in the api's own shape and parsed by core's contract first, so the page is only ever shown a trip read
 * the api could send. Synthetic values in the real shapes: London → New York, the one made-up booking address. Nothing
 * here points at a real flight page; the links are never followed.
 */

export const TRIP_DEPART = '2027-03-14';
/** The page's clock in the spec: 3 h after the fixture's reads, so every age agrees with the wire's `ageHours: 3`. */
export const TRIP_NOW = '2026-10-14T15:00:00.000Z';
export const TRIP_RETURN = '2027-03-24';
const READ_AT = '2026-10-14T12:00:00.000Z';

const provList = {
  providerId: 'camoufox',
  sourceKind: 'scraped-self',
  fetchedAt: READ_AT,
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
} as const;
const provGrid = { ...provList, returnDateSource: 'grid-cell' } as const;

const flight = (over: Record<string, unknown>) => ({
  departsLocal: '09:15',
  arrivesLocal: '14:55',
  arrivesDayOffset: 0,
  durationMinutes: 640,
  stops: 1,
  carriers: ['Aer Lingus'],
  operatedBy: null,
  amountMinor: 41_200,
  ...over,
});
const ret = (over: Record<string, unknown>) => ({
  departsLocal: '18:30',
  arrivesLocal: '06:25',
  arrivesDayOffset: 1,
  durationMinutes: 415,
  stops: 0,
  carriers: ['Virgin Atlantic'],
  operatedBy: null,
  fromMinor: 41_200,
  ...over,
});
const LIMITS = { maxJourneyMinutes: 1500, maxStops: 1, departureWindowLocal: null, arrivalWindowLocal: null };

function list(carriers: string[], flights: unknown[] = []) {
  return {
    id: 1,
    executionId: null,
    origin: 'LHR',
    destination: 'JFK',
    departureDate: TRIP_DEPART,
    returnDate: TRIP_RETURN,
    fetchedAt: READ_AT,
    ageHours: 3,
    stale: false,
    provenance: provList,
    status: 'read',
    reason: null,
    listed: 'flights',
    minMinor: 41_200,
    tabMinor: null,
    cheapestView: 'cheapest',
    flights: [
      flight({ carriers }),
      ...flights,
      flight({
        departsLocal: '07:00',
        arrivesLocal: '09:55',
        durationMinutes: 475,
        stops: 0,
        carriers: ['British Airways'],
        amountMinor: 45_500,
      }),
      flight({
        departsLocal: '06:00',
        arrivesLocal: '17:10',
        arrivesDayOffset: 1,
        durationMinutes: 1630,
        carriers: ['QQ Air'],
        amountMinor: 43_000,
      }),
    ],
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: null,
    returns: {
      limits: LIMITS,
      status: 'read',
      rule: null,
      attempts: [
        {
          outboundIndex: 0,
          outboundFits: true,
          listed: 'returns',
          moreListed: false,
          returns: [
            ret({ carriers }),
            ret({
              departsLocal: '21:10',
              arrivesLocal: '09:15',
              durationMinutes: 425,
              carriers: ['British Airways'],
              fromMinor: 43_600,
            }),
          ],
          optionsUnparsed: 0,
          optionsOtherCell: 0,
          resultsStated: null,
        },
      ],
      triedAll: true,
      booking: null,
    },
  };
}

const calendarFigure = (over: Record<string, unknown> = {}) => ({
  price: { pricePence: 38_800, provenance: provGrid, stale: false, ageHours: 3, truncated: false },
  basis: 'calendar',
  origin: 'LHR',
  destination: 'JFK',
  superseded: false,
  notSeenInLatest: null,
  journeyMinutes: null,
  departOut: null,
  arriveOut: null,
  departBack: null,
  arriveBack: null,
  fromEarlierSearch: false,
  cheaperCached: null,
  gridPrice: null,
  pairing: null,
  pairingRead: 'not-read',
  listReason: null,
  hasBookingOptions: false,
  ...over,
});

const pairing = (seller: string, over: Record<string, unknown> = {}) => ({
  pricePence: 41_200,
  fromPence: 41_200,
  isFrom: false,
  seller,
  fare: null,
  offersRead: 16,
  complete: true,
  which: 'cheapest',
  departOut: '09:15',
  arriveOut: '14:55',
  departBack: '18:30',
  arriveBack: '06:25',
  mismatch: false,
  provenance: provList,
  stale: false,
  ageHours: 3,
  bookingUrl: SYNTHETIC_BOOKING_URL,
  ...over,
});

function base(over: Record<string, unknown>) {
  return {
    departureDate: TRIP_DEPART,
    returnDate: TRIP_RETURN,
    nights: 10,
    inWindow: true,
    figure: null,
    journeyLeftOut: 0,
    listFailure: null,
    cells: [
      { origin: 'LHR', destination: 'JFK', bucket: 'priced', skipReason: null },
      { origin: 'LGW', destination: 'JFK', bucket: 'empty', skipReason: null },
    ],
    flightList: null,
    bookingUrl: null,
    searchLink: {
      url: `https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+${TRIP_DEPART}+through+${TRIP_RETURN}&hl=en-GB&gl=GB`,
      host: 'www.google.com',
      label: 'search link, not a fare link',
    },
    figureSearchLink: null,
    booking: null,
    calendar: {
      pricePence: 38_800,
      provenance: provGrid,
      stale: false,
      ageHours: 3,
      truncated: false,
      notSeenAgain: false,
      origin: 'LHR',
      destination: 'JFK',
    },
    cached: null,
    log: [
      {
        at: '2026-10-14T13:40:00.000Z',
        byHand: false,
        calendar: { pricePence: 38_800, provenance: provGrid, stale: false, ageHours: 3, truncated: false },
        flights: { kind: 'not-read' },
      },
    ],
    reading: false,
    read: {
      available: true,
      unavailableReason: null,
      wouldGo: true,
      pagesPlanned: 3,
      origin: 'LHR',
      destination: 'JFK',
    },
    verificationConfigured: true,
    refreshHours: 24,
    limits: LIMITS,
    ...over,
  };
}

/** A read trip led by `seller` on `carriers`: the answer card, its legs, the other flights. */
function readTrip(seller: string, carriers: string[]) {
  const p = pairing(seller);
  return base({
    figure: calendarFigure({
      price: { pricePence: 41_200, provenance: provList, stale: false, ageHours: 3, truncated: false },
      basis: 'pairing',
      journeyMinutes: 1055,
      gridPrice: { pricePence: 38_800, provenance: provGrid, stale: false, truncated: false },
      pairing: p,
      pairingRead: 'within',
    }),
    flightList: list(carriers),
    bookingUrl: SYNTHETIC_BOOKING_URL,
  });
}

/** The states the layout spec checks, each parsed by the contract. */
export const TRIP_STATES = {
  trip: readTrip('Kiwi.com', ['Aer Lingus']),
  'calendar-only': base({ figure: calendarFigure() }),
  'none-within': base({
    figure: calendarFigure({
      pairingRead: 'over-limit',
      pairing: pairing('Kiwi.com', {
        which: 'over-limit',
        isFrom: true,
        seller: null,
        offersRead: 0,
        complete: false,
        pricePence: 43_000,
        fromPence: 43_000,
        bookingUrl: null,
      }),
    }),
    // why: every outbound read is over the 25 h limit, as none-within says; no return was read for them
    flightList: {
      ...list(['QQ Air']),
      minMinor: 43_000,
      flights: [
        flight({
          departsLocal: '06:00',
          arrivesLocal: '17:10',
          arrivesDayOffset: 1,
          durationMinutes: 1630,
          carriers: ['QQ Air'],
          amountMinor: 43_000,
        }),
        flight({
          departsLocal: '08:00',
          arrivesLocal: '20:00',
          arrivesDayOffset: 1,
          durationMinutes: 1680,
          carriers: ['QQ Atlantic'],
          amountMinor: 45_500,
        }),
      ],
      returns: null,
    },
  }),
  'outside-window': base({
    inWindow: false,
    cells: [],
    searchLink: null,
    calendar: null,
    log: [],
    read: {
      available: true,
      unavailableReason: null,
      wouldGo: false,
      pagesPlanned: 3,
      origin: null,
      destination: null,
    },
  }),
  // design §6.1 Review Focus 5: the longest seller and an airline list of three, which must wrap at 375 px
  'long-seller': readTrip('Trip.com Travel Singapore Pte Ltd', [
    'Virgin Atlantic',
    'Delta Air Lines',
    'Air France',
  ]),
} as const;
export type TripState = keyof typeof TRIP_STATES;

/**
 * A search of the fixture provider, London → New York, for a spec run on its own (the smoke makes one when it runs
 * first). Saved only, never started: the trip read is served here.
 */
export const FIXTURE_SEARCH = {
  // why: not the smoke's search name, so the smoke finds its own search by name whatever saved one before it
  name: 'London → New York (layout checks)',
  origins: ['LHR'],
  destinations: ['JFK'],
  window: { kind: 'relative', startOffsetDays: 7, lengthDays: 30 },
  minNights: 10,
  maxNights: 10,
  cabin: 'economy',
  constraints: {},
  verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
  budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
  providers: { discovery: ['fixture'], verification: ['fixture'], discoveryRefreshHours: { fixture: 24 } },
  destinationNotes: {},
  onwardCostPence: {},
  scheduleCron: null,
  scheduleTz: 'Europe/London',
  enabled: false,
};

/** Serves `state` as the trip read of the search `id`; everything else goes to the api. */
export async function serveTrip(page: Page, id: string, state: TripState) {
  const body = JSON.stringify(apiContract.tripResponseSchema.parse(TRIP_STATES[state]));
  await page.route(`**/api/definitions/${id}/trip*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
}
