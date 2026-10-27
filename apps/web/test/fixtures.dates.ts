import {
  addDays,
  type apiContract,
  asIata,
  asIsoDate,
  asIsoDateTime,
  type Buckets,
  type DatePair,
  type DatePairFigure,
  type DatePairSpace,
  type DecodedDatePairs,
  datePairAt,
  datePairCount,
  datePairIndex,
  encodeDatePairs,
  type Iata,
  type Provenance,
  sortedAirportPairs,
} from '@gmt/core';

// The Dates view's fixtures (WP19 Tasks 19.4–19.9). Every response is built as a `DecodedDatePairs` and written through
// `@gmt/core`'s `encodeDatePairs`, and the web reads it back only through `decodeDatePairs`, so these fixtures never
// touch the wire's columns and stay valid whatever the column encoding becomes. Worked example only: LHR, LGW → JFK,
// EWR. Every provenance is the fixture provider's and synthetic unless a test needs a real source (the synthetic
// banner's absent case passes `real: true`), dated against the web tests' NOW (2026-10-14T15:00:00.000Z).

type DatePairsResponse = apiContract.DatePairsResponse;
type ExecutionSummary = DecodedDatePairs['executions'][number];

/** The worked example's window for the Dates tests: 14 Mar to 13 Apr 2027 (31 days, across a month end), 10–12 nights. */
export const DATES_SPACE: DatePairSpace = {
  departureFrom: asIsoDate('2027-03-14'),
  departureTo: asIsoDate('2027-04-13'),
  minNights: 10,
  maxNights: 12,
};
export const ORIGINS: readonly Iata[] = [asIata('LGW'), asIata('LHR')];
export const DESTINATIONS: readonly Iata[] = [asIata('EWR'), asIata('JFK')];

/** The fixture provider's synthetic provenance, fetched 2h before NOW (spec §5.5). */
export function provSynthetic(over: Partial<Provenance> = {}): Provenance {
  return {
    providerId: 'fixture',
    sourceKind: 'synthetic',
    fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'),
    maxAgeHours: 0,
    fx: { converted: false },
    pointOfSale: 'unknown',
    cabin: 'economy',
    ...over,
  };
}

/** A real cached calendar source (Travelpayouts), for the tests that need a provenance that is not synthetic. */
export function provCached(over: Partial<Provenance> = {}): Provenance {
  return provSynthetic({
    providerId: 'travelpayouts',
    sourceKind: 'authorised-cached',
    maxAgeHours: 48,
    ...over,
  });
}

/** A real itinerary search (SearchApi), UK market, for the tests that need a provenance that is not synthetic. */
export function provSearched(over: Partial<Provenance> = {}): Provenance {
  return provSynthetic({ providerId: 'searchapi', sourceKind: 'scraped-search', pointOfSale: 'GB', ...over });
}

/** The index of an airport pair in the scope's sorted pairs (the figure's `airportPair`). */
export function airportPairIndex(
  origin: string,
  destination: string,
  origins: readonly Iata[] = ORIGINS,
  destinations: readonly Iata[] = DESTINATIONS,
): number {
  const i = sortedAirportPairs(origins, destinations).findIndex(
    (p) => p.origin === origin && p.destination === destination,
  );
  if (i < 0) throw new RangeError(`${origin}→${destination} is not in the scope`);
  return i;
}

/** A calendar figure on LHR→JFK: synthetic, current, not truncated, £312. */
export function calendarFig(over: Partial<DatePairFigure> = {}): DatePairFigure {
  return {
    price: { pricePence: 31_200, provenance: provSynthetic(), stale: false, ageHours: 2, truncated: false },
    basis: 'calendar',
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    airportPair: airportPairIndex('LHR', 'JFK'),
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

/** A verified figure on LHR→JFK with its segments' local times: an overnight outbound arriving the next day. */
export function verifiedFig(over: Partial<DatePairFigure> = {}): DatePairFigure {
  return calendarFig({
    price: { pricePence: 41_200, provenance: provSynthetic(), stale: false, ageHours: 2, truncated: false },
    basis: 'verified',
    journeyMinutes: 850,
    departOut: '2027-03-14T18:30',
    arriveOut: '2027-03-15T06:40',
    departBack: '2027-03-28T09:00',
    arriveBack: '2027-03-28T21:05',
    ...over,
  });
}

/** A figure at another price, everything else as given (the shorthand most board tests use). */
export function priced(pence: number, over: Partial<DatePairFigure> = {}): DatePairFigure {
  const base = over.basis === 'verified' ? verifiedFig(over) : calendarFig(over);
  return { ...base, price: { ...base.price, ...over.price, pricePence: pence } };
}

/** Six buckets (with `reused`) over `airportPairs`, every pair not named counted as not searched. */
export function bucketsOf(b: Partial<Buckets>, airportPairs = 4): Buckets {
  const named = (b.priced ?? 0) + (b.empty ?? 0) + (b.no_data ?? 0) + (b.error ?? 0) + (b.skipped ?? 0);
  return {
    priced: b.priced ?? 0,
    empty: b.empty ?? 0,
    no_data: b.no_data ?? 0,
    error: b.error ?? 0,
    skipped: b.skipped ?? 0,
    not_run: b.not_run ?? airportPairs - named,
    reused: b.reused ?? 0,
  };
}

/** A parent run's summary, completed 2h before NOW unless told otherwise. */
export function runSummary(over: Partial<ExecutionSummary> = {}): ExecutionSummary {
  return {
    id: 'exec-0001',
    status: 'completed',
    isChild: false,
    startedAt: asIsoDateTime('2026-10-14T12:00:00.000Z'),
    finishedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'),
    ageHours: 2,
    expandTop: 2,
    scheduledFor: null,
    isCatchUp: false,
    skipCode: null,
    ...over,
  };
}

/** The coverage summary as the sum of the date pairs' columns (the contract holds the api to this). */
export function summaryOf(pairs: readonly DatePair[]): DecodedDatePairs['summary'] {
  const buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
  let selected = 0;
  let itinerarySearched = 0;
  let onDemand = 0;
  for (const p of pairs) {
    for (const k of ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run', 'reused'] as const)
      buckets[k] += p.buckets[k];
    selected += p.selected;
    itinerarySearched += p.itinerarySearched;
    onDemand += p.onDemand;
  }
  const total =
    buckets.priced + buckets.empty + buckets.no_data + buckets.error + buckets.skipped + buckets.not_run;
  return { buckets, total, selected, itinerarySearched, onDemand, reused: buckets.reused };
}

/** What a test may set on a date pair: its counts and figure (its index and dates are always derived). */
export type PairOver = Partial<Omit<DatePair, 'index' | 'departureDate' | 'returnDate' | 'nights'>>;

export interface DatesOptions {
  space?: DatePairSpace;
  origins?: readonly string[];
  destinations?: readonly string[];
  maxJourneyMinutes?: number | null;
  executionId?: string | null;
  executions?: ExecutionSummary[];
  discoveryProviders?: DecodedDatePairs['discoveryProviders'];
  verificationProviderConfigured?: boolean;
  /** Date pairs by "departure/nights" key (e.g. "2027-03-14/10"), or a function of the index and its dates. */
  pairs?:
    | Record<string, PairOver>
    | ((i: number, at: ReturnType<typeof datePairAt>, airportPairs: number) => PairOver);
  /** Every date pair not named: its buckets (default: every airport pair not searched). */
  rest?: Partial<Buckets>;
}

/** A decoded response over a space and a scope, its summary and counts consistent with its pairs. */
export function decodedDates(o: DatesOptions = {}): DecodedDatePairs {
  const space = o.space ?? DATES_SPACE;
  const origins = (o.origins ?? ORIGINS).map(asIata).sort();
  const destinations = (o.destinations ?? DESTINATIONS).map(asIata).sort();
  const airportPairs = origins.length * destinations.length;
  const byKey = typeof o.pairs === 'object' ? o.pairs : null;
  if (byKey !== null) {
    // why: a key that names no date pair of the space is a test's mistake, never a silently empty fixture
    for (const k of Object.keys(byKey)) {
      const [dep, n] = k.split('/');
      const at = dep === undefined || n === undefined ? null : datePairIndexOf(space, dep, Number(n));
      if (at === null) throw new RangeError(`fixture date pair ${k} is outside the space`);
    }
  }
  const fn = typeof o.pairs === 'function' ? o.pairs : null;
  const pairs: DatePair[] = Array.from({ length: datePairCount(space) }, (_x, i) => {
    const at = datePairAt(space, i);
    const over = fn !== null ? fn(i, at, airportPairs) : (byKey?.[`${at.departureDate}/${at.nights}`] ?? {});
    return {
      index: i,
      departureDate: at.departureDate,
      returnDate: at.returnDate,
      nights: at.nights,
      buckets: bucketsOf(o.rest ?? {}, airportPairs),
      selected: 0,
      itinerarySearched: 0,
      notReached: 0,
      onDemand: 0,
      unconfirmed: 0,
      partiallyVerified: 0,
      journeyLeftOut: 0,
      figure: null,
      ...over,
    };
  });
  const executions = o.executions ?? [runSummary()];
  return {
    executionId:
      o.executionId !== undefined ? o.executionId : (executions.find((e) => !e.isChild)?.id ?? null),
    executions,
    discoveryProviders: o.discoveryProviders ?? ['fixture'],
    verificationProviderConfigured: o.verificationProviderConfigured ?? true,
    staleAfterHours: 192,
    calendarStaleAfterHours: { fixture: 168 },
    space,
    scope: {
      origins,
      destinations,
      airportPairs,
      cells: pairs.length * airportPairs,
      maxJourneyMinutes: o.maxJourneyMinutes ?? null,
    },
    summary: summaryOf(pairs),
    pairs,
  };
}

function datePairIndexOf(space: DatePairSpace, departure: string, nights: number): number | null {
  const dep = asIsoDate(departure);
  return datePairIndex(space, dep, addDays(dep, nights));
}

/** The response the route sends for the same options. */
export function datesResponse(o: DatesOptions = {}): DatePairsResponse {
  return encodeDatePairs(decodedDates(o));
}

/** A key for `DatesOptions.pairs`. */
export const at = (departure: string, nights: number) => `${departure}/${nights}`;

/** A priced date pair: its figure, one airport pair priced and the others with no cached data. */
export function pricedPair(figure: DatePairFigure, over: PairOver = {}, airportPairs = 4): PairOver {
  return { buckets: bucketsOf({ priced: 1, no_data: airportPairs - 1 }, airportPairs), figure, ...over };
}

/**
 * The worked example the view tests share: 31 days × 3 stays (93 date pairs) over the airport pairs in scope (four
 * unless `destinations` or `origins` narrow them), every date pair searched, with eleven priced date pairs of every
 * kind (calendar, verified hiding a cheaper calendar price on another airport pair, superseded, not seen, truncated,
 * stale, from an earlier search, with arrival times) and the rest spread over the unpriced buckets.
 */
export function workedDates(o: Omit<DatesOptions, 'pairs' | 'rest'> = {}): DatesOptions {
  // why: the cheaper calendar price sits on LGW→EWR, so a scope without either airport has none (a figure or price
  // outside the scope is a caller's bug that encodeDatePairs refuses)
  const ewr =
    (o.destinations ?? DESTINATIONS).some((c) => c === 'EWR') &&
    (o.origins ?? ORIGINS).some((c) => c === 'LGW');
  const lgw = (o.origins ?? ORIGINS).some((c) => c === 'LGW');
  const table = (a: number): Record<string, PairOver> => ({
    [at('2027-03-14', 10)]: pricedPair(
      calendarFig({ price: { ...calendarFig().price, pricePence: 30_000 } }),
      {},
      a,
    ),
    [at('2027-03-14', 11)]: pricedPair(
      verifiedFig({
        cheaperCached: !ewr
          ? null
          : {
              pricePence: 29_900,
              provenance: provSynthetic({ fetchedAt: asIsoDateTime('2026-10-13T15:00:00.000Z') }),
              stale: false,
              truncated: false,
              origin: asIata('LGW'),
              destination: asIata('EWR'),
            },
        departOut: '2027-03-14T18:30',
        arriveOut: '2027-03-15T06:40',
        departBack: '2027-03-25T09:00',
        arriveBack: '2027-03-25T21:05',
      }),
      { selected: 1, itinerarySearched: 1 },
      a,
    ),
    [at('2027-03-15', 10)]: pricedPair(priced(30_500), {}, a),
    [at('2027-03-16', 12)]: pricedPair(priced(31_000, { superseded: true }), {}, a),
    [at('2027-03-20', 10)]: pricedPair(
      priced(32_000, { basis: 'verified', notSeenInLatest: { ageHours: 30 }, fromEarlierSearch: true }),
      {},
      a,
    ),
    [at('2027-03-22', 11)]: pricedPair(
      priced(33_000, {
        price: { ...calendarFig().price, truncated: true },
        origin: asIata(lgw ? 'LGW' : 'LHR'),
      }),
      {},
      a,
    ),
    [at('2027-03-25', 10)]: pricedPair(
      priced(34_000, { price: { ...calendarFig().price, stale: true } }),
      {},
      a,
    ),
    [at('2027-03-31', 12)]: pricedPair(priced(35_000), {}, a),
    [at('2027-04-01', 10)]: pricedPair(priced(36_000), {}, a),
    [at('2027-04-05', 11)]: pricedPair(priced(37_000), {}, a),
    [at('2027-04-13', 12)]: pricedPair(priced(38_000), {}, a),
    [at('2027-03-17', 10)]: { buckets: bucketsOf({ empty: a }, a) },
    [at('2027-03-18', 10)]: { buckets: bucketsOf({ error: 1, no_data: a - 1 }, a) },
    [at('2027-03-19', 10)]: { buckets: bucketsOf({ skipped: a }, a) },
    [at('2027-03-21', 10)]: { buckets: bucketsOf({}, a) },
  });
  let memo: { a: number; t: Record<string, PairOver> } | null = null;
  return {
    ...o,
    pairs: (_i, d, a) => {
      if (memo === null || memo.a !== a) memo = { a, t: table(a) };
      return memo.t[at(d.departureDate, d.nights)] ?? { buckets: bucketsOf({ no_data: a }, a) };
    },
  };
}

/** A lone date pair (for the link and state tests): its dates from the departure and nights, a figure of `basis`. */
export function datePairOf(p: {
  departureDate: string;
  nights: number;
  basis: 'verified' | 'calendar' | null;
}): DatePair {
  const space: DatePairSpace = {
    departureFrom: asIsoDate(p.departureDate),
    departureTo: asIsoDate(p.departureDate),
    minNights: p.nights,
    maxNights: p.nights,
  };
  const pair = decodedDates({
    space,
    pairs: () => ({
      figure: p.basis === null ? null : p.basis === 'verified' ? verifiedFig() : calendarFig(),
    }),
  }).pairs[0];
  if (pair === undefined) throw new Error('fixture: no date pair');
  return pair;
}
