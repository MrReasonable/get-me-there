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
