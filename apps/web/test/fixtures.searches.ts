import { apiContract } from '@gmt/core';
import type { z } from 'zod';
import type { SearchCard } from '../src/api/types.js';
import { type ProvenanceInput, provCalendar, provSearch } from './fixtures.js';

// Fixtures for the Searches view (WP20 Task 20.3, spec rev 55 §10 `GET /definitions/cards`). Every builder ends in the
// contract schema's parse, so a card that drifts from core/api-contract fails here. Worked examples only:
// Birmingham → Frankfurt (BHX → FRA) and London → New York (LHR, LGW → JFK, EWR); the clock is NOW (render.tsx).

type CardIn = z.input<typeof apiContract.searchCardSchema>;
type RunIn = NonNullable<CardIn['latestRun']>;
type CheapestIn = NonNullable<CardIn['cheapest']>;

/** A finished run of 405 date pairs, 320 of them searched, 85 never searched, finished two hours before NOW. */
export function latestRun(over: Partial<RunIn> = {}): RunIn {
  return {
    id: 'exec-0001',
    status: 'completed',
    trigger: 'manual',
    startedAt: '2026-10-14T12:30:00.000Z',
    finishedAt: '2026-10-14T13:00:00.000Z',
    datePairs: 405,
    datePairsSearched: 320,
    datePairsNeverSearched: 85,
    flights: null,
    estimatedFinishAt: null,
    stop: null,
    ...over,
  };
}

/** The cheapest figure of the worked example: £86, 12 → 23 January, from a SearchApi itinerary read. */
export function cheapest(
  over: Partial<CheapestIn> = {},
  provenance: ProvenanceInput = provSearch,
): CheapestIn {
  return {
    pricePence: 8600,
    provenance,
    stale: false,
    ageHours: 2,
    truncated: false,
    basis: 'verified',
    departureDate: '2027-01-12',
    returnDate: '2027-01-23',
    origin: 'BHX',
    destination: 'FRA',
    fromLatestRun: true,
    ...over,
  };
}

/** A calendar price (Travelpayouts, not checked with the airline). */
export const calendarCheapest = (over: Partial<CheapestIn> = {}): CheapestIn =>
  cheapest({ basis: 'calendar', ...over }, provCalendar);

/** One card: Birmingham → Frankfurt, 10 Jan – 31 Mar 2027, 10–14 nights, scheduled Mondays 05:00, finished 2 h ago. */
export function searchCard(over: Partial<CardIn> = {}): SearchCard {
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
    cheapest: cheapest(),
    ...over,
  });
}

/** The cards response body. */
export function cardsResponse(cards: readonly SearchCard[] = [searchCard()]) {
  return apiContract.searchCardsResponseSchema.parse({ cards });
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
    ...over,
  });
}

/** A list that failed with `reason` (no outcome, no flights). */
export const failedList = (reason: FlightListIn['reason'], over: Partial<FlightListIn> = {}) =>
  flightList({ status: 'failed', reason, listed: null, minMinor: null, flights: [], ...over });

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
    ...over,
  };
}

/**
 * The answer for `pairs`, parsed by the contract: the worker set up, 1,390 pages left this month, one run of the search
 * using 110 browser pages (100 grid pages and 10 flight pages), nothing reading.
 */
export function flightListsResponse(
  pairs: readonly FlightPairIn[],
  over: Partial<Omit<FlightListsIn, 'pairs'>> = {},
) {
  return apiContract.flightListsResponseSchema.parse({
    available: true,
    unavailableReason: null,
    refreshHours: 24,
    monthlyPagesLeft: 1390,
    runPages: 110,
    reading: null,
    pairs,
    ...over,
  });
}
