import { apiContract, asIata } from '@gmt/core';
import { PAIRING_LIMITS, SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import type { z } from 'zod';
import type { TripResponse } from '../src/api/types.js';
import type { CardState } from '../src/views/Trip/cardState.js';
import { provCached, provFlightList, provGrid, provSynthetic } from './fixtures.dates.js';
import { datePairFigure } from './fixtures.js';
import { flightList, listedFlight, listedReturn, returnAttempt, returnRead } from './fixtures.searches.js';

// The Trip page's fixtures (design 2026-11-08 §6.1; trip-page plan Tasks 6 and 7). Synthetic values in the real shapes:
// London → New York (LHR, LGW → JFK, EWR), dated against the web tests' NOW (2026-10-14T15:00Z, 16:00 London). Every
// builder ends in the contract's parse, so a trip read the api could never send fails here, not in a component.

type TripIn = z.input<typeof apiContract.tripResponseSchema>;
type Figure = NonNullable<TripResponse['figure']>;
type Cell = TripResponse['cells'][number];

/** The browser worker's list and pairing provenance, read 3 h before NOW (13:00 London). */
export const LIST_READ_AT = '2026-10-14T12:00:00.000Z';
const provList = provFlightList(LIST_READ_AT);
/** The browser worker's date grid, 3 h before NOW. */
export const provGridNow = provGrid({ fetchedAt: provList.fetchedAt });
/** The Aviasales cache, 2 days' bound, fetched 2 h before NOW. */
export const provCache = provCached();

/** The airport pair the card's figure is read for, as a calendar or cached price names it (final review I4). */
export const LHR_JFK = { origin: asIata('LHR'), destination: asIata('JFK') };

export const cell = (
  bucket: Cell['bucket'],
  skipReason: Cell['skipReason'] = null,
  origin = 'LHR',
  destination = 'JFK',
): Cell => ({
  origin: asIata(origin),
  destination: asIata(destination),
  bucket,
  skipReason,
});

/** A trip read in the window with no figure, no list and one unsearched cell; `over` says the rest. */
export function trip(over: Partial<TripResponse> = {}): TripResponse {
  return {
    departureDate: apiContract.tripResponseSchema.shape.departureDate.parse('2026-11-11'),
    returnDate: apiContract.tripResponseSchema.shape.returnDate.parse('2026-11-28'),
    nights: 17,
    inWindow: true,
    figure: null,
    journeyLeftOut: 0,
    listFailure: null,
    cells: [cell('not_run')],
    flightList: null,
    bookingUrl: null,
    searchLink: SEARCH_LINK,
    pointOfSale: 'GB',
    booking: null,
    calendar: null,
    cached: null,
    log: [],
    reading: false,
    read: {
      available: true,
      unavailableReason: null,
      wouldGo: true,
      pagesPlanned: 3,
      origin: asIata('LHR'),
      destination: asIata('JFK'),
    },
    verificationConfigured: true,
    refreshHours: 24,
    limits: PAIRING_LIMITS,
    ...over,
  };
}

/** The same, parsed by the contract (a fixture that drifts from it fails here). */
export function tripBody(over: Partial<TripResponse> = {}): TripResponse {
  const r = trip(over);
  const input: TripIn = r;
  return apiContract.tripResponseSchema.parse(input);
}

/** The Google Flights search for the dates, as the api re-validates it. */
export const SEARCH_LINK = {
  url: 'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2026-11-11+through+2026-11-28&hl=en-GB&gl=GB',
  host: 'www.google.com',
  label: 'search link, not a fare link',
};

/** A calendar figure of LHR → JFK, the browser worker's date grid (£388); the contract allows no local times on one. */
export function calendarFigure(over: Partial<Figure> = {}): Figure {
  return {
    ...datePairFigure(),
    price: { pricePence: 38_800, provenance: provGridNow, stale: false, ageHours: 3, truncated: false },
    basis: 'calendar',
    journeyMinutes: null,
    departOut: null,
    arriveOut: null,
    departBack: null,
    arriveBack: null,
    ...over,
  };
}

/** The read trip's pairing: Kiwi.com's £412, the cheapest of 16 sellers, 09:15 out and 18:30 back, its booking page. */
export function readPairing(
  over: Partial<NonNullable<Figure['pairing']>> = {},
): NonNullable<Figure['pairing']> {
  return {
    pricePence: 41_200,
    fromPence: 41_200,
    isFrom: false,
    seller: 'Kiwi.com',
    fare: null,
    offersRead: 16,
    complete: true,
    which: 'cheapest',
    departOut: '09:15',
    arriveOut: '14:55',
    departBack: '18:30',
    arriveBack: '06:25',
    legs: {
      out: { durationMinutes: 640, stops: 1, carriers: ['Aer Lingus'], arrivesDayOffset: 0 },
      back: { durationMinutes: 415, stops: 0, carriers: ['Virgin Atlantic'], arrivesDayOffset: 0 },
    },
    mismatch: false,
    provenance: provList,
    stale: false,
    ageHours: 3,
    bookingUrl: SYNTHETIC_BOOKING_URL,
    ...over,
  };
}

/** A pairing figure on LHR → JFK led by `pairing` (the read trip's by default), the £388 grid price it replaced. */
export function pairingFigure(pairing = readPairing(), over: Partial<Figure> = {}): Figure {
  return calendarFigure({
    price: {
      pricePence: pairing.pricePence,
      provenance: pairing.provenance,
      stale: pairing.stale,
      ageHours: pairing.ageHours,
      truncated: false,
    },
    basis: 'pairing',
    journeyMinutes: 640 + 415,
    gridPrice: { pricePence: 38_800, provenance: provGridNow, stale: false, truncated: false },
    pairing,
    pairingRead: 'within',
    ...over,
  });
}

/** An outbound over the 25 h limit (1 stop), at `pence`. */
const overLimit = (pence: number, minutes: number) =>
  listedFlight({
    departsLocal: '06:00',
    arrivesLocal: '17:10',
    arrivesDayOffset: 1,
    durationMinutes: minutes,
    stops: 1,
    carriers: ['QQ Air'],
    amountMinor: pence,
  });

/**
 * The read trip's list: the trip's outbound (09:15 → 14:55, 10h 40m, 1 change, Aer Lingus) with three returns read (the
 * trip's 18:30 → 06:25 +1, 6h 55m direct, and two dearer), and twelve other outbounds whose returns weren't read: three
 * within the limits shown (£455, £521, £530), three dearer within them and six over the 25 h limit.
 */
export function readList(over: Parameters<typeof flightList>[0] = {}) {
  return flightList({
    departureDate: '2026-11-11',
    returnDate: '2026-11-28',
    fetchedAt: LIST_READ_AT,
    ageHours: 3,
    minMinor: 41_200,
    flights: [
      listedFlight({
        departsLocal: '09:15',
        arrivesLocal: '14:55',
        arrivesDayOffset: 0,
        durationMinutes: 640,
        stops: 1,
        carriers: ['Aer Lingus'],
        amountMinor: 41_200,
      }),
      listedFlight({
        departsLocal: '07:00',
        arrivesLocal: '09:55',
        arrivesDayOffset: 0,
        durationMinutes: 475,
        stops: 0,
        carriers: ['British Airways'],
        amountMinor: 45_500,
      }),
      listedFlight({
        departsLocal: '18:20',
        arrivesLocal: '21:30',
        arrivesDayOffset: 0,
        durationMinutes: 490,
        stops: 0,
        carriers: ['Norse'],
        amountMinor: 52_100,
      }),
      listedFlight({
        departsLocal: '12:00',
        arrivesLocal: '15:30',
        arrivesDayOffset: 0,
        durationMinutes: 510,
        stops: 1,
        carriers: ['KLM'],
        amountMinor: 53_000,
      }),
      listedFlight({
        departsLocal: '13:00',
        arrivesLocal: '16:00',
        arrivesDayOffset: 0,
        durationMinutes: 480,
        stops: 0,
        carriers: ['United'],
        amountMinor: 60_000,
      }),
      listedFlight({
        departsLocal: '14:00',
        arrivesLocal: '17:00',
        arrivesDayOffset: 0,
        durationMinutes: 480,
        stops: 0,
        carriers: ['Delta'],
        amountMinor: 65_000,
      }),
      listedFlight({
        departsLocal: '15:00',
        arrivesLocal: '18:00',
        arrivesDayOffset: 0,
        durationMinutes: 480,
        stops: 0,
        carriers: ['JetBlue'],
        amountMinor: 70_000,
      }),
      overLimit(42_000, 1600),
      overLimit(43_000, 1610),
      overLimit(44_000, 1620),
      overLimit(46_000, 1630),
      overLimit(47_000, 1640),
      overLimit(48_000, 1650),
    ],
    returns: returnRead({
      attempts: [
        returnAttempt({
          outboundIndex: 0,
          returns: [
            listedReturn({
              departsLocal: '18:30',
              arrivesLocal: '06:25',
              arrivesDayOffset: 1,
              durationMinutes: 415,
              stops: 0,
              carriers: ['Virgin Atlantic'],
              fromMinor: 41_200,
            }),
            listedReturn({
              departsLocal: '21:10',
              arrivesLocal: '09:15',
              arrivesDayOffset: 1,
              durationMinutes: 425,
              stops: 0,
              carriers: ['British Airways'],
              fromMinor: 43_600,
            }),
            listedReturn({
              departsLocal: '22:40',
              arrivesLocal: '10:35',
              arrivesDayOffset: 1,
              durationMinutes: 415,
              stops: 0,
              carriers: ['United'],
              fromMinor: 49_800,
            }),
          ],
        }),
      ],
    }),
    ...over,
  });
}

const at = (iso: string) => apiContract.tripResponseSchema.shape.log.element.shape.at.parse(iso);
const listPrice = (pence: number) => ({
  pricePence: pence,
  provenance: provList,
  stale: false as const,
  ageHours: 3,
  truncated: false,
});
export const gridPrice = (pence: number) => ({
  pricePence: pence,
  provenance: provGridNow,
  stale: false as const,
  ageHours: 3,
  truncated: false,
});

/** Seven log rows, newest first: today's trip, a read by hand, a failed read, and four other runs back to 8 Oct. */
export const LOG: TripResponse['log'] = [
  {
    at: at('2026-10-14T13:40:00.000Z'),
    byHand: false,
    calendar: gridPrice(38_800),
    flights: { kind: 'trip', price: listPrice(41_200), pairingKind: 'seller', seller: 'Kiwi.com' },
  },
  {
    at: at('2026-10-13T09:05:00.000Z'),
    byHand: true,
    calendar: null,
    flights: { kind: 'trip', price: listPrice(40_900), pairingKind: 'google-unread', seller: null },
  },
  {
    at: at('2026-10-13T08:00:00.000Z'),
    byHand: false,
    calendar: null,
    flights: { kind: 'failed', cause: 'network' },
  },
  {
    at: at('2026-10-12T08:00:00.000Z'),
    byHand: false,
    calendar: gridPrice(39_000),
    flights: { kind: 'outbound-only' },
  },
  {
    at: at('2026-10-11T08:00:00.000Z'),
    byHand: false,
    calendar: gridPrice(39_500),
    flights: { kind: 'none-within' },
  },
  {
    at: at('2026-10-10T08:00:00.000Z'),
    byHand: false,
    calendar: gridPrice(39_500),
    flights: { kind: 'other-limits' },
  },
  {
    at: at('2026-10-08T08:00:00.000Z'),
    byHand: false,
    calendar: gridPrice(40_000),
    flights: { kind: 'not-read' },
  },
];

/** When the newest read failed, in the failure cases: today's run (14:40 London). */
export const FAILED_AT = LOG[0]?.at ?? at('2026-10-14T13:40:00.000Z');

/** The answer card's read trip: a pairing figure with its list, its booking page, the calendar price and the log. */
export function readTrip(over: Partial<TripResponse> = {}): TripResponse {
  return trip({
    figure: pairingFigure(),
    flightList: readList(),
    bookingUrl: SYNTHETIC_BOOKING_URL,
    calendar: { ...gridPrice(38_800), notSeenAgain: false, ...LHR_JFK },
    cells: [
      cell('priced'),
      cell('empty', null, 'LGW'),
      cell('error', null, 'LHR', 'EWR'),
      cell('not_run', null, 'LGW', 'EWR'),
    ],
    log: LOG,
    ...over,
  });
}

/** A synthetic calendar price, for the banner's case. */
export const syntheticCalendar = {
  pricePence: 30_000,
  provenance: provSynthetic(),
  stale: false as const,
  ageHours: 2,
  truncated: false,
  notSeenAgain: false,
  ...LHR_JFK,
};

/** A pairing beneath a calendar figure that is over the limits (27h 10m out), £455 from Google's list. */
export const overPairing = () =>
  readPairing({
    which: 'over-limit',
    isFrom: true,
    seller: null,
    offersRead: 0,
    complete: false,
    pricePence: 45_500,
    fromPence: 45_500,
  });

/** A read list of these dates with one outbound (£92, 4 h old), for the states that only say a list was read. */
export const datesList = () => flightList({ departureDate: '2026-11-11', returnDate: '2026-11-28' });

/** One trip read per card state (the reachability table of cardState's tests, and the Trip page's per-state tests). */
export const STATE_FIXTURES: Record<CardState['kind'], TripResponse> = {
  unreachable: trip(),
  'outside-window': trip({
    inWindow: false,
    cells: [],
    searchLink: null,
    read: { ...trip().read, wouldGo: false, origin: null, destination: null },
  }),
  verified: trip({ figure: datePairFigure() }),
  trip: readTrip(),
  reading: trip({ reading: true, figure: calendarFigure() }),
  'calendar-with-trip': trip({
    figure: calendarFigure({
      pairingRead: 'within-older',
      pairing: readPairing({ stale: 'refresh', ageHours: 50 }),
    }),
    flightList: readList({ stale: 'refresh', ageHours: 50 }),
  }),
  'none-within': trip({
    figure: calendarFigure({ pairingRead: 'over-limit', pairing: overPairing() }),
    flightList: flightList({
      departureDate: '2026-11-11',
      returnDate: '2026-11-28',
      flights: [listedFlight({ durationMinutes: 1630, amountMinor: 45_500 })],
    }),
  }),
  'other-limits': trip({
    figure: calendarFigure({ pairingRead: 'within-other-limits', pairing: readPairing() }),
    flightList: datesList(),
  }),
  'outbound-only': trip({
    figure: calendarFigure({ pairingRead: 'outbound-only' }),
    flightList: datesList(),
  }),
  'no-return': trip({ figure: calendarFigure({ pairingRead: 'no-pairing-read' }), flightList: datesList() }),
  'read-without-calendar': trip({ flightList: readList(), bookingUrl: null }),
  'calendar-only': trip({ figure: calendarFigure({ pairingRead: 'not-read' }) }),
  gone: trip({ figure: { ...datePairFigure(), notSeenInLatest: { ageHours: 3 } } }),
  'over-journey-limit': trip({ journeyLeftOut: 1 }),
  'could-not-read': trip({ cells: [cell('error')] }),
  'no-price': trip({ cells: [cell('empty')] }),
  'not-offered': trip({ cells: [cell('no_data')] }),
  'not-reached': trip({ cells: [cell('skipped', 'budget')] }),
  'browser-unavailable': trip({ cells: [cell('skipped', 'provider_unavailable')] }),
  'not-searched': trip(),
};
