import {
  apiContract,
  asIata,
  asIsoDate,
  asIsoDateTime,
  type Buckets,
  type DatePair,
  type DatePairFigure,
  type DecodedDatePairs,
  datePairAt,
  datePairCount,
  encodeDatePairs,
  type Iata,
  provenanceSchema,
  sortedAirportPairs,
} from '@gmt/core';

/**
 * The performance test's world (spec §9 item 6, WP19 Task 19.9): a synthetic search and the responses the Dates view
 * reads, every one parsed through `@gmt/core`'s contract schemas so the test serves only bodies the api could send.
 * The date-pairs bodies are built by core's `encodeDatePairs` from a decoded read, so they are the codec's own output.
 * Every price is the fixture provider's, `sourceKind: 'synthetic'` (spec §5.5).
 */

/** The instant the page's clock is installed at; every age and run time is relative to it. */
export const PERF_NOW = '2026-10-26T12:00:00.000Z';
export const PERF_DEFINITION_ID = 'def-perf';
export const PERF_EXECUTION_ID = 'exec-perf';
const RUN_STARTED = '2026-10-26T11:20:00.000Z';
const FETCHED = '2026-10-26T11:30:00.000Z';

/** A worst case the route can answer: its window, stays and airports, and which date pairs carry a figure. */
export interface PerfCase {
  name: string;
  /** The first departure day (a Monday, so weeks start cleanly) and the number of days in the window. */
  from: string;
  days: number;
  minNights: number;
  maxNights: number;
  origins: readonly string[];
  destinations: readonly string[];
  /** Every date pair priced (true), or every seventh left unpriced with a mixture of the other buckets. */
  everyPriced: boolean;
}

/**
 * (a) 36,400 date pairs, every one with a figure: 400 days × 91 stays (0–90 nights) on one airport pair. Its
 * airports are the example's synthetic codes, AAA → BBB.
 */
export const DATE_PAIRS_CASE: PerfCase = {
  name: '36,400 date pairs',
  from: '2027-01-04',
  days: 400,
  minNights: 0,
  maxNights: 90,
  origins: ['AAA'],
  destinations: ['BBB'],
  everyPriced: true,
};

/**
 * (b) 50,000 cells, exactly the route's bound: 250 days × 50 stays (10–59 nights) × the worked example's 4 airport
 * pairs (LGW, LHR → EWR, JFK), as the api's bound test seeds it. why: the brief first said 400 days × 25 nights × 5
 * airport pairs, but a fifth airport pair needs a code outside the example's six (LHR, LGW, JFK, EWR, AAA, BBB).
 */
export const CELLS_CASE: PerfCase = {
  name: '50,000 cells',
  from: '2027-01-04',
  days: 250,
  minNights: 10,
  maxNights: 59,
  origins: ['LGW', 'LHR'],
  destinations: ['EWR', 'JFK'],
  everyPriced: false,
};

const NONE: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
const PROVENANCE = provenanceSchema.parse({
  providerId: 'fixture',
  sourceKind: 'synthetic',
  fetchedAt: FETCHED,
  maxAgeHours: 24,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
});

/** A price for date pair `i`; `seed` changes the whole order, so a second read re-ranks every row. */
function priceOf(i: number, seed: number): number {
  // why: a multiplicative hash over £300–£799 in whole pounds; another seed moves every date pair's rank
  return 30_000 + ((i * 7_919 + seed * 104_729) % 500) * 100;
}

function airports(c: PerfCase): { origins: Iata[]; destinations: Iata[] } {
  return {
    origins: c.origins.map(asIata).sort(),
    destinations: c.destinations.map(asIata).sort(),
  };
}

/** The decoded read: every date pair of the space, its buckets over the airport pairs and its figure. */
export function decodedRead(c: PerfCase, seed: number): DecodedDatePairs {
  const space = {
    departureFrom: asIsoDate(c.from),
    departureTo: asIsoDate(addDaysText(c.from, c.days - 1)),
    minNights: c.minNights,
    maxNights: c.maxNights,
  };
  const { origins, destinations } = airports(c);
  const pairsOfAirports = sortedAirportPairs(origins, destinations);
  const airportPairs = pairsOfAirports.length;
  const pairs: DatePair[] = Array.from({ length: datePairCount(space) }, (_x, i) => {
    const at = datePairAt(space, i);
    const unpriced = !c.everyPriced && i % 7 === 3;
    const which = i % airportPairs;
    const ap = pairsOfAirports[which] ?? pairsOfAirports[0];
    const figure: DatePairFigure | null =
      unpriced || ap === undefined
        ? null
        : {
            price: {
              pricePence: priceOf(i, seed),
              provenance: PROVENANCE,
              stale: false,
              ageHours: 1,
              truncated: false,
            },
            basis: 'calendar',
            origin: ap.origin,
            destination: ap.destination,
            airportPair: which,
            superseded: false,
            notSeenInLatest: null,
            journeyMinutes: null,
            departOut: null,
            arriveOut: null,
            departBack: null,
            arriveBack: null,
            fromEarlierSearch: false,
            cheaperCached: null,
          };
    // why: an unpriced date pair carries each unpriced bucket in turn, so the overview draws every mark
    const buckets: Buckets = unpriced
      ? { ...NONE, ...unpricedBuckets(i, airportPairs) }
      : { ...NONE, priced: airportPairs };
    return {
      index: i,
      departureDate: at.departureDate,
      returnDate: at.returnDate,
      nights: at.nights,
      buckets,
      selected: 0,
      itinerarySearched: 0,
      notReached: 0,
      onDemand: 0,
      unconfirmed: 0,
      partiallyVerified: 0,
      journeyLeftOut: 0,
      figure,
    };
  });
  const sum = (k: keyof Buckets) => pairs.reduce((n, p) => n + p.buckets[k], 0);
  return {
    executionId: PERF_EXECUTION_ID,
    executions: [runSummary()],
    discoveryProviders: ['fixture'],
    verificationProviderConfigured: false,
    staleAfterHours: 192,
    calendarStaleAfterHours: { fixture: 24 },
    space,
    scope: {
      origins,
      destinations,
      airportPairs,
      cells: pairs.length * airportPairs,
      maxJourneyMinutes: null,
    },
    summary: {
      buckets: {
        priced: sum('priced'),
        empty: sum('empty'),
        no_data: sum('no_data'),
        error: sum('error'),
        skipped: sum('skipped'),
        not_run: sum('not_run'),
        reused: sum('reused'),
      },
      total: pairs.length * airportPairs,
      selected: 0,
      itinerarySearched: 0,
      onDemand: 0,
      reused: 0,
    },
    pairs,
  };
}

function unpricedBuckets(i: number, airportPairs: number): Partial<Buckets> {
  const kinds = ['empty', 'no_data', 'error', 'skipped', 'not_run'] as const;
  const k = kinds[Math.floor(i / 7) % kinds.length] ?? 'no_data';
  return { [k]: airportPairs };
}

/** The date-pairs body for a case: `encodeDatePairs` of the decoded read, checked by the route's own schema. */
export function datePairsBody(c: PerfCase, seed: number): string {
  return JSON.stringify(apiContract.datePairsResponseSchema.parse(encodeDatePairs(decodedRead(c, seed))));
}

function addDaysText(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function runSummary() {
  return {
    id: PERF_EXECUTION_ID,
    status: 'running' as const,
    isChild: false,
    startedAt: asIsoDateTime(RUN_STARTED),
    finishedAt: null,
    ageHours: 0,
    expandTop: 2,
    scheduledFor: null,
    isCatchUp: false,
    skipCode: null,
  };
}

const usage = (scope: string, calls: number, cap: number | null) => ({
  scope,
  calls,
  costMicroGbp: 0,
  costPence: 0,
  cap,
  windowStart: null,
  windowEnd: null,
});

const estimate = (cells: number) => ({
  cells,
  perProvider: [
    {
      providerId: 'fixture',
      stage: 'discovery',
      calls: 1,
      planCalls: 1,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 1,
      blocked: null,
    },
  ],
  totalCalls: 1,
  totalPlanCalls: 1,
  totalCostMicroGbp: 0,
  totalCostPence: 0,
  seconds: 1,
  assumptions: [],
  windowClamped: false,
  retryFactor: 1,
});

/** The search the test serves, shaped as the case's space (a relative window is resolved by the api, not the web). */
export function definitionBody(c: PerfCase): string {
  const cells = c.days * (c.maxNights - c.minNights + 1) * c.origins.length * c.destinations.length;
  return JSON.stringify([
    apiContract.definitionResponseSchema.parse({
      id: PERF_DEFINITION_ID,
      name: `Performance: ${c.name}`,
      origins: c.origins,
      destinations: c.destinations,
      window: { kind: 'absolute', from: c.from, to: addDaysText(c.from, c.days - 1) },
      minNights: c.minNights,
      maxNights: c.maxNights,
      cabin: 'economy',
      constraints: {},
      verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
      budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
      providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 24 } },
      destinationNotes: {},
      onwardCostPence: {},
      scheduleCron: null,
      scheduleTz: 'Europe/London',
      confirmedCostPence: 0,
      confirmedCalls: 1,
      enabled: true,
      createdAt: '2026-10-26T09:00:00.000Z',
      updatedAt: '2026-10-26T09:00:00.000Z',
      deletedAt: null,
      budgetFit: { fits: true, runsPerMonth: 0, perScope: [] },
      estimate: estimate(cells),
      needsConfirmation: null,
      notices: [],
    }),
  ]);
}

/** Only the fixture provider, synthetic, so the shell shows the red banner (spec §5.5). */
export function providersBody(): string {
  return JSON.stringify(
    apiContract.providersResponseSchema.parse({
      synthetic: true,
      pointOfSale: 'GB',
      providers: [
        {
          providerId: 'fixture',
          displayName: 'Fixture',
          enabled: true,
          plan: 'synthetic',
          excludedFromSchedule: false,
          notices: [],
          capNote: null,
          capabilities: {
            discovery: { sourceKind: 'synthetic', provenanceNote: 'synthetic fixture data', maxAgeHours: 24 },
            verification: null,
          },
          usage: [],
        },
      ],
      presets: {
        policy: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true },
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 24 } },
        budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
        discoveryRefreshHours: 24,
        schedulerTimezone: 'Europe/London',
      },
    }),
  );
}

/** The status bar's whole-space read: no rows, the running parent run, so the bar and the Dates view poll it. */
export function resultsBody(c: PerfCase): string {
  const read = decodedRead(c, 0);
  return JSON.stringify(
    apiContract.resultsResponseSchema.parse({
      rows: [],
      total: 0,
      truncated: false,
      basis: 'calendar',
      basisReason: 'no itinerary-searched observations',
      executions: [runSummary()],
      coverage: read.summary,
      excludedByCurrentSpace: 0,
      verificationProviderConfigured: false,
      cheapest: null,
      datePairFigure: null,
    }),
  );
}

/** The running parent run; `tick` changes its progress, which the Dates view re-reads on (spec §11 Run landing). */
export function executionBody(c: PerfCase, tick: number): string {
  const total = c.days * (c.maxNights - c.minNights + 1) * c.origins.length * c.destinations.length;
  // why: the run still has ten cells to search, and each tick searches one more, so every tick is a progress change
  // the Dates view's re-read sees (spec §11 Run landing), whatever the case's figures
  const priced = total - 10 + Math.min(10, tick);
  return JSON.stringify(
    apiContract.executionResponseSchema.parse({
      id: PERF_EXECUTION_ID,
      definitionId: PERF_DEFINITION_ID,
      isChild: false,
      cell: null,
      status: 'running',
      stage: 'discovery',
      reason: null,
      resumeAfter: null,
      trigger: 'manual',
      startedAt: RUN_STARTED,
      finishedAt: null,
      errorText: null,
      scheduledFor: null,
      isCatchUp: false,
      skipCode: null,
      progress: [
        {
          stage: 'discovery',
          providerId: 'fixture',
          buckets: { ...NONE, priced, not_run: total - priced },
          total,
        },
      ],
      budget: [usage('execution-calls', 1 + tick, 2000), usage('execution-free-calls', 1 + tick, 2000)],
      estimate: estimate(total),
      ledger: {
        calls: 1 + tick,
        costMicroGbp: 0,
        costPence: 0,
        tiles: 1 + tick,
        cacheHits: 0,
        perProvider: [{ providerId: 'fixture', stage: 'discovery', calls: 1 + tick, costMicroGbp: 0 }],
      },
      parityBreak: false,
      overrun: false,
      disabledProviders: [],
    }),
  );
}
