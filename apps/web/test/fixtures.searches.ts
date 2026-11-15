import {
  apiContract,
  listedReturnSchema,
  type PairingKind,
  type ReturnRead,
  returnAttemptSchema,
  returnReadSchema,
} from '@gmt/core';
import { PAIRING_FIXTURE, PAIRING_LIMITS, SYNTHETIC_SELLER_BOOKING } from '@gmt/core/testing';
import type { z } from 'zod';
import type { SearchCard } from '../src/api/types.js';
import { datePairFigure, type ProvenanceInput, provCalendar, provSearch } from './fixtures.js';

// Fixtures for the Searches view (WP20 Task 20.3, spec rev 55 §10 `GET /definitions/cards`). Every builder ends in the
// contract schema's parse, so a card that drifts from core/api-contract fails here. Worked examples only:
// Birmingham → Frankfurt (BHX → FRA) and London → New York (LHR, LGW → JFK, EWR); the clock is NOW (render.tsx).

type CardIn = z.input<typeof apiContract.searchCardSchema>;
type RunIn = NonNullable<CardIn['latestRun']>;
type TripIn = CardIn['trips'][number];
type LowerIn = NonNullable<CardIn['lowerOnCalendar']>;

/**
 * A finished run of 405 date pairs, 320 of them searched, 85 never searched, finished two hours before NOW. Its marks
 * (Ruling 7) follow the counts it is given unless stated: the searched date pairs priced, the rest not searched.
 */
export function latestRun(over: Partial<RunIn> = {}): RunIn {
  const datePairs = over.datePairs ?? 405;
  const searched = over.datePairsSearched ?? 320;
  return {
    id: 'exec-0001',
    status: 'completed',
    trigger: 'manual',
    startedAt: '2026-10-14T12:30:00.000Z',
    finishedAt: '2026-10-14T13:00:00.000Z',
    datePairs,
    datePairsSearched: searched,
    datePairsNeverSearched: 85,
    flights: null,
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

/** What a test says of a card's trip: its price, age, dates, airports, and for a read trip whose price it is. */
export interface TripOver {
  pricePence?: number;
  stale?: false | 'refresh' | 'setting';
  ageHours?: number | 'unknown';
  departureDate?: string;
  returnDate?: string;
  origin?: string;
  destination?: string;
  /** the trip's basis: a verified price (the default) or a read trip (pairing) */
  basis?: 'verified' | 'pairing';
  /** a read trip's price: a seller's, or Google's with no seller or not every seller read */
  priceKind?: PairingKind;
  /** a verified trip's seller's booking (SearchApi's booking options) */
  hasBookingOptions?: boolean;
  /** an earlier search read this trip (the card shows it while another search runs) */
  fromEarlierSearch?: boolean;
}

/** A read trip's pairing at `pence`, of the kind asked: 07:15 out, 14:20 back, QQ Travel's offer when a seller's. */
function pairingOf(pence: number, kind: PairingKind, provenance: ProvenanceInput, o: TripOver) {
  const seller = kind === 'seller';
  return {
    pricePence: pence,
    fromPence: pence,
    isFrom: !seller,
    seller: seller ? 'QQ Travel' : null,
    fare: null,
    offersRead: kind === 'google-unread' ? 0 : 3,
    complete: seller,
    which: 'cheapest' as const,
    departOut: '07:15',
    arriveOut: '18:05',
    departBack: '14:20',
    arriveBack: '06:25',
    legs: {
      out: { durationMinutes: 890, stops: 1, carriers: ['QQ Atlantic'], arrivesDayOffset: 0 },
      back: { durationMinutes: 725, stops: 1, carriers: ['QQ Atlantic'], arrivesDayOffset: 0 },
    },
    mismatch: false,
    provenance,
    stale: o.stale ?? false,
    ageHours: o.ageHours ?? 2,
    bookingUrl: null,
  };
}

/**
 * One trip of a card (Ruling 7): by default the worked example's verified £86, 12 → 23 January 2027 (11 nights), BHX →
 * FRA, from a SearchApi itinerary read; `basis: 'pairing'` makes it a read trip (pass a flight list's provenance).
 */
export function cardTrip(o: TripOver = {}, provenance: ProvenanceInput = provSearch): TripIn {
  const pricePence = o.pricePence ?? 8600;
  const departureDate = o.departureDate ?? '2027-01-12';
  const returnDate = o.returnDate ?? '2027-01-23';
  const price = {
    pricePence,
    provenance,
    stale: o.stale ?? false,
    ageHours: o.ageHours ?? 2,
    truncated: false,
  };
  const airports = { origin: o.origin ?? 'BHX', destination: o.destination ?? 'FRA' };
  const nights = (Date.parse(returnDate) - Date.parse(departureDate)) / 86_400_000;
  const figure: TripIn['figure'] =
    o.basis === 'pairing'
      ? {
          ...datePairFigure(),
          ...airports,
          price,
          basis: 'pairing',
          journeyMinutes: 890 + 725,
          departOut: null,
          arriveOut: null,
          departBack: null,
          arriveBack: null,
          gridPrice: {
            pricePence: pricePence + 1000,
            provenance: provCalendar,
            stale: false,
            truncated: false,
          },
          pairing: pairingOf(pricePence, o.priceKind ?? 'seller', provenance, o),
          pairingRead: 'within',
        }
      : {
          ...datePairFigure({ hasBookingOptions: o.hasBookingOptions ?? false }),
          ...airports,
          price,
          departOut: `${departureDate}T10:25`,
          arriveOut: `${departureDate}T12:10`,
          departBack: `${returnDate}T19:00`,
          arriveBack: `${returnDate}T21:40`,
        };
  return {
    figure: { ...figure, fromEarlierSearch: o.fromEarlierSearch ?? false },
    departureDate,
    returnDate,
    nights,
  };
}

/** Ruling 2's details of each verified trip of `trips`: legs as the row states them, a seller's booking where it has one. */
function detailsOf(trips: readonly TripIn[]): CardIn['verifiedDetails'] {
  return trips.flatMap((t) =>
    t.figure.basis !== 'verified'
      ? []
      : [
          {
            departureDate: t.departureDate,
            returnDate: t.returnDate,
            origin: t.figure.origin,
            destination: t.figure.destination,
            legs: { out: { durationMinutes: 105, stops: 0 }, back: { durationMinutes: 100, stops: 0 } },
            booking: t.figure.hasBookingOptions ? SYNTHETIC_SELLER_BOOKING : { kind: 'none' as const },
          },
        ],
  );
}

/** What a test says of the lowest calendar price: its price, marks and dates (the Aviasales cache by default). */
export interface LowerOver {
  pricePence?: number;
  stale?: false | 'refresh' | 'setting';
  ageHours?: number | 'unknown';
  truncated?: boolean;
  departureDate?: string;
  returnDate?: string;
  origin?: string;
  destination?: string;
  count?: number;
}

/**
 * The card's "lower on the calendar" line (Ruling 5): by default three dates, from £86 on 12 → 23 January (BHX → FRA), a
 * calendar price from the Aviasales cache (pass another provenance for another source; its label kind follows it).
 */
export function lowerOnCalendar(o: LowerOver = {}, provenance: ProvenanceInput = provCalendar): LowerIn {
  return {
    count: o.count ?? 3,
    cheapest: {
      price: {
        pricePence: o.pricePence ?? 8600,
        provenance,
        stale: o.stale ?? false,
        ageHours: o.ageHours ?? 2,
        truncated: o.truncated ?? false,
      },
      departureDate: o.departureDate ?? '2027-01-12',
      returnDate: o.returnDate ?? '2027-01-23',
      origin: o.origin ?? 'BHX',
      destination: o.destination ?? 'FRA',
      kind: provenance.providerId === 'travelpayouts' ? 'cached' : 'calendar',
    },
  };
}

/** A card with no trip and its calendar prices lower: `lowerOnCalendar(o, provenance)`, no flights read. */
export const calendarOnly = (
  o: LowerOver = {},
  provenance: ProvenanceInput = provCalendar,
): Partial<CardIn> => ({
  trips: [],
  readDates: 0,
  lowerOnCalendar: lowerOnCalendar(o, provenance),
});

/** A card with nothing to show: no trip, no calendar price. */
export const noPrices: Partial<CardIn> = { trips: [], readDates: 0, lowerOnCalendar: null };

/**
 * One card: Birmingham → Frankfurt, 10 Jan – 31 Mar 2027, 10–14 nights, scheduled Mondays 05:00, finished 2 h ago, its one
 * trip the verified £86 (`cardTrip()`). Unless stated, each verified trip's details follow its trips and the dates with
 * flights read are the trips.
 */
export function searchCard(over: Partial<CardIn> = {}): SearchCard {
  const trips = over.trips ?? [cardTrip()];
  return apiContract.searchCardSchema.parse({
    id: 'def-0001',
    name: 'Birmingham → Frankfurt',
    origins: ['BHX'],
    destinations: ['FRA'],
    window: {
      kind: 'absolute',
      departureFrom: '2027-01-10',
      departureTo: '2027-03-31',
      startOffsetDays: null,
      lengthDays: null,
    },
    minNights: 10,
    maxNights: 14,
    cabin: 'economy',
    schedule: { cron: '0 5 * * 1', tz: 'Europe/London' },
    discovery: ['travelpayouts'],
    latestRun: latestRun(),
    spaceChangedSince: false,
    trips,
    verifiedDetails: detailsOf(trips),
    readDates: trips.length,
    lowerOnCalendar: null,
    ...over,
  });
}

/** The cards response body, with the install's point of sale (GB by default). */
export function cardsResponse(cards: readonly SearchCard[] = [searchCard()], pointOfSale = 'GB') {
  return apiContract.searchCardsResponseSchema.parse({ cards, pointOfSale });
}

// --- WP20 Task 20.10: the flight lists on a search's page (spec rev 55 §10 `GET /definitions/:id/flight-lists`) ---
// why: the contract refuses any list but the browser worker's own (`camoufox`, `scraped-self`), so these carry the real
// provenance shape with synthetic flights (shared context §0); the carrier is the worked example's.

type FlightListIn = z.input<typeof apiContract.flightListSchema>;
type ListedFlightIn = FlightListIn['flights'][number];
type FlightListsIn = z.input<typeof apiContract.flightListsResponseSchema>;
type FlightPairIn = FlightListsIn['pairs'][number];

/** One outbound flight a list read: 07:15 → 18:05 the next day, 10h 50m, one change, £92 the lowest round trip. */
export function listedFlight(over: Partial<ListedFlightIn> = {}): ListedFlightIn {
  return {
    departsLocal: '07:15',
    arrivesLocal: '18:05',
    arrivesDayOffset: 1,
    durationMinutes: 650,
    stops: 1,
    carriers: ['Virgin Atlantic'],
    operatedBy: null,
    amountMinor: 9200,
    ...over,
  };
}

/** A list's provenance: the browser worker's page, GBP, economy, UK point of sale, fetched at `fetchedAt`. */
export const flightListProvenance = (fetchedAt: string) => ({
  providerId: 'camoufox' as const,
  sourceKind: 'scraped-self' as const,
  fetchedAt,
  maxAgeHours: 0 as const,
  fx: { converted: false as const },
  pointOfSale: 'GB' as const,
  cabin: 'economy' as const,
});

/**
 * A read list for LHR → JFK, 14 → 24 Mar 2027, read today at 11:44 London (10:44Z, 4 h before NOW), with one flight
 * at £92. Pass `fetchedAt` and `ageHours` together.
 */
export function flightList(over: Partial<FlightListIn> = {}): z.output<typeof apiContract.flightListSchema> {
  const fetchedAt = over.fetchedAt ?? '2026-10-14T10:44:00.000Z';
  return apiContract.flightListSchema.parse({
    id: 1,
    executionId: 'exec-0001',
    origin: 'LHR',
    destination: 'JFK',
    departureDate: '2027-03-14',
    returnDate: '2027-03-24',
    fetchedAt,
    ageHours: 4,
    stale: false,
    provenance: flightListProvenance(fetchedAt),
    status: 'read',
    reason: null,
    listed: 'flights',
    minMinor: 9200,
    tabMinor: null,
    cheapestView: 'cheapest',
    flights: [listedFlight()],
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: null,
    returns: null,
    ...over,
  });
}

/** A list that failed with `reason` (no outcome, no flights). */
export const failedList = (reason: FlightListIn['reason'], over: Partial<FlightListIn> = {}) =>
  flightList({ status: 'failed', reason, listed: null, minMinor: null, flights: [], ...over });

/**
 * Whether a read would go now when the test does not say (final review B-I3: the api's `readNow`): a date pair with no
 * list, or a failed one that no per-run limit stopped, as the read button showed before `readNow`.
 */
function readNowOf(list: FlightPairIn['list']): boolean {
  return list === null || (list.status === 'failed' && list.reason !== 'execution-cap');
}

/** One asked date pair's entry: its figure's airports, its search link, its list and else another pair's list. */
export function flightPair(
  departureDate: string,
  returnDate: string,
  over: Partial<FlightPairIn> = {},
): FlightPairIn {
  return {
    departureDate,
    returnDate,
    origin: 'LHR',
    destination: 'JFK',
    link: {
      url: `https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+${departureDate}+through+${returnDate}&hl=en-GB&gl=GB`,
      host: 'www.google.com',
      label: 'search link, not a fare link',
    },
    list: null,
    listOtherPair: null,
    readNow: readNowOf(over.list ?? null),
    ...over,
  };
}

/**
 * The answer for `pairs`, parsed by the contract: the worker set up, nothing reading.
 */
export function flightListsResponse(
  pairs: readonly FlightPairIn[],
  over: Partial<Omit<FlightListsIn, 'pairs'>> = {},
) {
  return apiContract.flightListsResponseSchema.parse({
    available: true,
    unavailableReason: null,
    refreshHours: 24,
    // why: ruling D3: an outbound-only worker plans 1 page a read; the return-leg tests pass 2 (or rely on prov-008)
    pagesPlanned: 1,
    reading: null,
    pairs,
    ...over,
  });
}

// --- WP21 Task 21.7: the return read on a search's page (spec rev 56 §10 `flightListSchema.returns`) ---
// why: synthetic returns and offers only (carriers QQ Air and QQ Atlantic, sellers QQ Travel and QQ Fares); every
// builder ends in its schema's parse, so a shape the contract refuses fails here, not in a component

type ReturnIn = z.input<typeof listedReturnSchema>;
type AttemptIn = z.input<typeof returnAttemptSchema>;
type ReturnReadIn = z.input<typeof returnReadSchema>;

/** One return a return view listed: 14:20 → 06:25 the next day, 12h 05m, one change, from £1,180 round-trip total. */
export function listedReturn(over: Partial<ReturnIn> = {}) {
  return listedReturnSchema.parse({
    departsLocal: '14:20',
    arrivesLocal: '06:25',
    arrivesDayOffset: 1,
    durationMinutes: 725,
    stops: 1,
    carriers: ['QQ Atlantic'],
    operatedBy: null,
    fromMinor: 118_000,
    ...over,
  });
}

/** One attempt: outbound 0 selected within the limits, its return view listing one return, nothing more listed. */
export function returnAttempt(over: Partial<AttemptIn> = {}) {
  return returnAttemptSchema.parse({
    outboundIndex: 0,
    outboundFits: true,
    listed: 'returns',
    moreListed: false,
    returns: [listedReturn()],
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: null,
    ...over,
  });
}

/** A finished one-attempt return read under the shared fixture's limits (25 h, 1 stop), with no booking read. */
export function returnRead(over: Partial<ReturnReadIn> = {}): ReturnRead {
  return returnReadSchema.parse({
    limits: PAIRING_LIMITS,
    status: 'read',
    rule: null,
    attempts: [returnAttempt()],
    triedAll: true,
    booking: null,
    ...over,
  });
}

/**
 * The shared pairing fixture (`@gmt/core/testing`) as a stored list: LHR → JFK, 14 → 24 Mar 2027, read 3 days before
 * NOW at 11:44 London, its four outbounds and its two attempts (attempt 1, return 0 booked: QQ Travel £1,180 of 3
 * offers). The core and api tests assert the same literals over the same fixture (Review Focus 1).
 */
export function pairingList(over: Partial<FlightListIn> = {}) {
  return flightList({
    fetchedAt: '2026-10-11T10:44:00.000Z',
    ageHours: 76,
    minMinor: 48_000,
    flights: PAIRING_FIXTURE.flights,
    returns: PAIRING_FIXTURE.returns,
    ...over,
  });
}
