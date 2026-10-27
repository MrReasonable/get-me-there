// Builders for the date-pair tests (WP19). A `DecodedDatePairs` is built here and written through `encodeDatePairs`, so
// every response a test parses is one the codec produced. Worked-example airports only (LHR, LGW → JFK, EWR).

import type { CoverageSummary } from '../../src/api-contract/common.js';
import type { DatePairsResponse } from '../../src/api-contract/datePairs.js';
import type { DatePair, DatePairFigure, DecodedDatePairs } from '../../src/datePairs/encode.js';
import { encodeDatePairs } from '../../src/datePairs/encode.js';
import { type DatePairSpace, datePairAt, datePairCount } from '../../src/datePairs/space.js';
import { asIata, asIsoDate, asIsoDateTime, type Iata } from '../../src/types/ids.js';
import type { Provenance } from '../../src/types/provenance.js';

/** A calendar price's provenance: Travelpayouts' cache, fetched two hours before the rows helper's NOW. */
export function calendarProvenance(over: Partial<Provenance> = {}): Provenance {
  return {
    providerId: 'travelpayouts',
    sourceKind: 'authorised-cached',
    fetchedAt: asIsoDateTime('2027-03-01T10:00:00.000Z'),
    maxAgeHours: 48,
    fx: { converted: false },
    pointOfSale: 'unknown',
    cabin: 'economy',
    ...over,
  };
}

/** An itinerary search's provenance (SearchApi), fetched two hours before NOW. */
export function verifiedProvenance(over: Partial<Provenance> = {}): Provenance {
  return calendarProvenance({
    providerId: 'searchapi',
    sourceKind: 'scraped-search',
    maxAgeHours: 0,
    pointOfSale: 'GB',
    ...over,
  });
}

/** A calendar figure on LHR→JFK (airport pair 3 of the worked example's sorted pairs), current, not truncated. */
export function calendarFigure(over: Partial<DatePairFigure> = {}): DatePairFigure {
  return {
    price: {
      pricePence: 31_200,
      provenance: calendarProvenance(),
      stale: false,
      ageHours: 50,
      truncated: false,
    },
    basis: 'calendar',
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    airportPair: 3,
    superseded: false,
    notSeenInLatest: null,
    journeyMinutes: null,
    departOut: null,
    arriveOut: null,
    departBack: null,
    arriveBack: null,
    fromEarlierSearch: false,
    cheaperCached: null,
    ...over,
  };
}

/** A verified figure on LHR→JFK with its segments' local times (an overnight outbound). */
export function verifiedFigure(over: Partial<DatePairFigure> = {}): DatePairFigure {
  return calendarFigure({
    price: {
      pricePence: 41_200,
      provenance: verifiedProvenance(),
      stale: false,
      ageHours: 2,
      truncated: false,
    },
    basis: 'verified',
    journeyMinutes: 850,
    departOut: '2027-03-14T18:30',
    arriveOut: '2027-03-15T06:40',
    departBack: '2027-03-24T09:00',
    arriveBack: '2027-03-24T21:05',
    ...over,
  });
}

const EMPTY_PAIR = {
  selected: 0,
  itinerarySearched: 0,
  notReached: 0,
  onDemand: 0,
  unconfirmed: 0,
  partiallyVerified: 0,
  journeyLeftOut: 0,
  figure: null,
} as const;

/** Date pair `index` of `space`, its dates derived from the index; every airport pair not searched unless overridden. */
export function datePair(
  space: DatePairSpace,
  index: number,
  airportPairs: number,
  over: Partial<DatePair> = {},
): DatePair {
  const at = datePairAt(space, index);
  return {
    index,
    departureDate: at.departureDate,
    returnDate: at.returnDate,
    nights: at.nights,
    buckets: { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: airportPairs, reused: 0 },
    ...EMPTY_PAIR,
    ...over,
  };
}

/** The coverage summary as the sum of the date pairs' columns (spec §10: the refinement holds the api to it). */
export function summaryOf(pairs: readonly DatePair[]): CoverageSummary {
  const s: CoverageSummary = {
    buckets: { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 },
    total: 0,
    selected: 0,
    itinerarySearched: 0,
    onDemand: 0,
    reused: 0,
  };
  for (const p of pairs) {
    for (const k of ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run', 'reused'] as const)
      s.buckets[k] += p.buckets[k];
    s.total += p.buckets.priced + p.buckets.empty + p.buckets.no_data + p.buckets.error + p.buckets.skipped;
    s.total += p.buckets.not_run;
    s.selected += p.selected;
    s.itinerarySearched += p.itinerarySearched;
    s.onDemand += p.onDemand;
  }
  s.reused = s.buckets.reused;
  return s;
}

export interface DecodedOptions {
  space?: DatePairSpace;
  origins?: string[];
  destinations?: string[];
  maxJourneyMinutes?: number | null;
  /** Overrides for date pair i (its dates and index are always derived). */
  pair?: (i: number, airportPairs: number) => Partial<DatePair>;
}

/** A decoded response over a space and scope, its summary and scope counts consistent with its pairs. */
export function decoded(o: DecodedOptions = {}): DecodedDatePairs {
  const space = o.space ?? {
    departureFrom: asIsoDate('2027-03-14'),
    departureTo: asIsoDate('2027-03-17'),
    minNights: 10,
    maxNights: 12,
  };
  const origins: Iata[] = (o.origins ?? ['LGW', 'LHR']).map(asIata);
  const destinations: Iata[] = (o.destinations ?? ['EWR', 'JFK']).map(asIata);
  const airportPairs = origins.length * destinations.length;
  const count = datePairCount(space);
  const pairs = Array.from({ length: count }, (_x, i) =>
    datePair(space, i, airportPairs, o.pair?.(i, airportPairs)),
  );
  return {
    executionId: 'ex-2',
    executions: [
      {
        id: 'ex-2',
        status: 'completed',
        isChild: false,
        startedAt: asIsoDateTime('2027-03-01T05:00:00.000Z'),
        finishedAt: asIsoDateTime('2027-03-01T06:00:00.000Z'),
        ageHours: 6,
        expandTop: 2,
        scheduledFor: null,
        isCatchUp: false,
        skipCode: null,
      },
    ],
    discoveryProviders: ['travelpayouts'],
    verificationProviderConfigured: true,
    staleAfterHours: 192,
    calendarStaleAfterHours: { travelpayouts: 192 },
    space,
    scope: {
      origins,
      destinations,
      airportPairs,
      cells: count * airportPairs,
      maxJourneyMinutes: o.maxJourneyMinutes ?? null,
    },
    summary: summaryOf(pairs),
    pairs,
  };
}

/**
 * The worked example: LGW, LHR → EWR, JFK over 14–17 Mar 2027 and 10–12 nights (12 date pairs, 48 cells), with every
 * kind of figure: calendar, verified, verified hiding a cheaper calendar price on another airport pair, superseded,
 * not seen in the latest search, truncated, stale, and date pairs with no figure.
 */
export function workedExample(): DecodedDatePairs {
  return decoded({
    pair: (i, a) => {
      const priced = i % 4; // 0..3 of the 4 airport pairs priced
      const noData = i % 2;
      const buckets = {
        priced,
        empty: 0,
        no_data: noData,
        error: 0,
        skipped: 0,
        not_run: a - priced - noData,
        reused: 0,
      };
      if (i === 11)
        return { buckets: { ...buckets, priced: 1, error: 1, not_run: 1, no_data: 1, reused: 1 } };
      const counts = {
        selected: i % 3 === 0 ? 1 : 0,
        itinerarySearched: i % 6 === 0 ? 1 : 0,
        notReached: i === 3 ? 1 : 0,
      };
      return { buckets, ...counts, figure: priced === 0 ? null : (FIGURES[i % FIGURES.length] ?? null) };
    },
  });
}

const FIGURES: DatePairFigure[] = [
  calendarFigure(),
  verifiedFigure({
    cheaperCached: {
      pricePence: 29_900,
      provenance: calendarProvenance({ fetchedAt: asIsoDateTime('2027-02-28T09:00:00.000Z') }),
      stale: false,
      truncated: true,
      origin: asIata('LGW'),
      destination: asIata('EWR'),
    },
  }),
  calendarFigure({ superseded: true, origin: asIata('LGW'), destination: asIata('JFK'), airportPair: 1 }),
  verifiedFigure({ notSeenInLatest: { ageHours: 30 }, fromEarlierSearch: true }),
  calendarFigure({
    price: {
      pricePence: 28_000,
      provenance: calendarProvenance({ maxAgeHours: 'unknown' }),
      stale: true,
      ageHours: 'unknown',
      truncated: true,
    },
    origin: asIata('LHR'),
    destination: asIata('EWR'),
    airportPair: 2,
  }),
];

/** The worked example as the route sends it. */
export function workedExampleResponse(): DatePairsResponse {
  return encodeDatePairs(workedExample());
}
