import type { z } from 'zod';
import { resultRowSchema } from '../../src/api-contract/results.js';
import type { ResultRow } from '../../src/results/types.js';
import { asIsoDateTime } from '../../src/types/ids.js';

export const NOW = asIsoDateTime('2027-03-01T12:00:00.000Z');

type RowInput = z.input<typeof resultRowSchema>;
/** Overrides in the schema's *input* shape (plain strings), so fixtures need no casts. */
type Over = Partial<Omit<RowInput, 'provenance' | 'cell'>> & {
  provenance?: Partial<RowInput['provenance']>;
  cell?: Partial<RowInput['cell']>;
};

/**
 * A verified-basis row on the worked example, parsed through WP0's `resultRowSchema` so a
 * fixture that drifts from the contract fails here, not silently in a later package.
 */
export function row(over: Over = {}): ResultRow {
  const { provenance, cell, ...rest } = over;
  return resultRowSchema.parse({
    itineraryHash: 'h1',
    basis: 'verified',
    verdictClass: 'verified',
    pricePence: 41_200,
    provenance: {
      providerId: 'searchapi',
      sourceKind: 'scraped-search',
      fetchedAt: '2027-03-01T10:00:00.000Z',
      maxAgeHours: 0,
      fx: { converted: false },
      pointOfSale: 'GB',
      cabin: 'economy',
      ...provenance,
    },
    stale: false,
    ageHours: 2,
    cell: {
      origin: 'LHR',
      destination: 'JFK',
      departureDate: '2027-03-14',
      returnDate: '2027-03-28',
      nights: 14,
      ...cell,
    },
    outbound: [],
    inbound: [],
    totalMinutes: 850,
    outboundMinutes: 420,
    inboundMinutes: 430,
    stopsOut: 0,
    stopsIn: 0,
    layovers: [],
    carriers: ['VS'],
    verdicts: { cabin: 'pass' },
    unverified: [],
    notApplied: [],
    seller: 'Virgin Atlantic',
    baggage: null,
    fareConditions: null,
    selfTransfer: null,
    booking: { kind: 'none' },
    searchLink: {
      url: 'https://www.google.com/travel/flights?q=x',
      host: 'www.google.com',
      label: 'search link, not a fare link',
    },
    otherOffers: [],
    notSeenInLatest: null,
    adjustedPence: null,
    destinationNote: null,
    executionId: 'ex-2',
    calendarPriceId: null,
    observationId: 1,
    ...rest,
  });
}

/** A calendar-basis row: no segments, class unchecked, Travelpayouts provenance. */
export function calendarRow(over: Over = {}): ResultRow {
  return row({
    itineraryHash: null,
    basis: 'calendar',
    verdictClass: 'unchecked',
    outbound: null,
    inbound: null,
    totalMinutes: null,
    outboundMinutes: null,
    inboundMinutes: null,
    stopsOut: null,
    stopsIn: null,
    carriers: [],
    verdicts: {},
    seller: null,
    observationId: null,
    calendarPriceId: 7,
    ...over,
    provenance: {
      providerId: 'travelpayouts',
      sourceKind: 'authorised-cached',
      maxAgeHours: 48,
      pointOfSale: 'unknown',
      ...over.provenance,
    },
  });
}
