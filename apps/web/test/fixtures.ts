import { apiContract, microGbpToPence } from '@gmt/core';
import type { z } from 'zod';
import type {
  AirportsResponse,
  CalendarGapResponse,
  CoverageCheckResponse,
  CoverageResponse,
  DefinitionResponse,
  Estimate,
  ExecutionResponse,
  ExecutionSummary,
  ProvidersResponse,
  ResultRow,
  ResultsResponse,
  UsageRow,
} from '../src/api/types.js';
import type { ProvenanceInput } from './render.js';

/**
 * Every builder ends in the contract schema's parse, and overrides are in the schema's *input*
 * shape (plain strings), so a fixture that drifts from core/api-contract fails here and no test
 * needs a cast or a brand helper. Worked example only: LHR, LGW → JFK, EWR; carrier `ZZ` and the
 * hub `BBB` are synthetic codes. One small definition: 126 cells, 10 selected for itinerary search.
 */
type In<S extends z.ZodType> = z.input<S>;

export type { ProvenanceInput };

/** Base of every handler URL: the api lives under /api (spec §10). */
export const API = 'http://localhost:3000/api';

/** SearchApi itinerary price: age 'unknown' because the vendor may serve a cached answer (spec rev 15, decision 24). */
export const provSearch: ProvenanceInput = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: '2026-10-14T10:00:00.000Z',
  maxAgeHours: 'unknown',
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
/** Travelpayouts calendar price with the vendor's declared 48h horizon. */
export const provCalendar: ProvenanceInput = {
  providerId: 'travelpayouts',
  sourceKind: 'authorised-cached',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 48,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};
/** A converted price: the rate and its date are the provenance's FX block (spec §3). */
export const fxConverted: ProvenanceInput['fx'] = {
  converted: true,
  rateNano: 790_000_000,
  rateDate: '2026-10-13',
  source: 'frankfurter',
};
/** The fixture provider's price: synthetic, never followable (spec §5.5). */
export const provSynthetic: ProvenanceInput = {
  providerId: 'fixture',
  sourceKind: 'synthetic',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};

type RowIn = In<typeof apiContract.resultRowSchema>;

export function seg(
  carrier: string,
  flight: number,
  from: string,
  to: string,
  depLocal: string,
  arrLocal: string,
) {
  return {
    marketingCarrier: carrier,
    flightNumber: flight,
    from,
    to,
    departLocal: depLocal,
    arriveLocal: arrLocal,
  };
}

export const cell = (o: string, d: string, dep: string, ret: string, nights: number) => ({
  origin: o,
  destination: d,
  departureDate: dep,
  returnDate: ret,
  nights,
});

const verifiedBase: RowIn = {
  itineraryHash: 'hash-verified-1',
  basis: 'verified',
  verdictClass: 'verified',
  pricePence: 41200,
  provenance: provSearch,
  stale: false,
  ageHours: 'unknown',
  truncated: false,
  cell: cell('LHR', 'JFK', '2027-03-14', '2027-03-28', 14),
  outbound: [
    seg('ZZ', 117, 'LHR', 'BBB', '2027-03-14T10:25', '2027-03-14T12:00'),
    seg('ZZ', 9, 'BBB', 'JFK', '2027-03-14T13:30', '2027-03-14T15:10'),
  ],
  inbound: [seg('ZZ', 178, 'JFK', 'LHR', '2027-03-28T19:00', '2027-03-29T07:00')],
  totalMinutes: 1005,
  outboundMinutes: 525,
  inboundMinutes: 480,
  stopsOut: 1,
  stopsIn: 0,
  layovers: [{ at: 'BBB', minutes: 90, overnight: false, airportChange: false }],
  carriers: ['ZZ'],
  verdicts: { cabin: 'pass', maxStops: 'pass', maxJourneyMinutes: 'pass', arrivalWindowLocal: 'pass' },
  unverified: [],
  notApplied: [],
  seller: 'Example Travel',
  baggage: { cabinBag: 'included', checkedBags: 1 },
  fareConditions: { refundable: false, changeable: true },
  selfTransfer: false,
  booking: { kind: 'get', url: 'https://www.google.com/travel/clk/f?id=1', host: 'www.google.com' },
  searchLink: {
    url: 'https://www.google.com/travel/flights?q=LHR.JFK.2027-03-14',
    host: 'www.google.com',
    label: 'search link, not a fare link',
  },
  otherOffers: [],
  notSeenInLatest: null,
  superseded: false,
  adjustedPence: null,
  destinationNote: null,
  executionId: 'exec-0001',
  calendarPriceId: null,
  observationId: 101,
};

/** Class-verified itinerary row: one stop out via a synthetic hub, direct back. */
export function verifiedRow(over: Partial<RowIn> = {}): ResultRow {
  return apiContract.resultRowSchema.parse({ ...verifiedBase, ...over });
}

/** Class partially-verified, cheaper: shown by default (spec §6.9 hides only `failed` by default). */
export function partialRow(over: Partial<RowIn> = {}): ResultRow {
  return verifiedRow({
    itineraryHash: 'hash-partial-1',
    verdictClass: 'partially-verified',
    pricePence: 38800,
    observationId: 102,
    cell: cell('LGW', 'EWR', '2027-03-15', '2027-03-27', 12),
    totalMinutes: 840,
    stopsOut: 0,
    stopsIn: 0,
    layovers: [],
    verdicts: { cabin: 'pass', checkedBagRequired: 'unverified' },
    unverified: ['checkedBagRequired'],
    ...over,
  });
}

/** Class-failed row carrying all three verdicts, with a POST booking and no baggage or conditions. */
export function failedRow(over: Partial<RowIn> = {}): ResultRow {
  return verifiedRow({
    itineraryHash: 'hash-failed-1',
    verdictClass: 'failed',
    pricePence: 37700,
    observationId: 103,
    cell: cell('LGW', 'EWR', '2027-03-16', '2027-03-28', 12),
    verdicts: { cabin: 'pass', arrivalWindowLocal: 'fail', checkedBagRequired: 'unverified' },
    unverified: ['checkedBagRequired'],
    booking: {
      kind: 'post',
      url: 'https://www.google.com/travel/clk/f',
      postData: 'u=abc&tfu=xyz',
      host: 'www.google.com',
    },
    baggage: null,
    fareConditions: null,
    selfTransfer: null,
    ...over,
  });
}

/** Calendar-basis row (spec §6.9): unchecked, no segments, the not-applied note, a search link only. */
export function calendarRow(over: Partial<RowIn> = {}): ResultRow {
  return verifiedRow({
    itineraryHash: null,
    basis: 'calendar',
    verdictClass: 'unchecked',
    pricePence: 39900,
    provenance: provCalendar,
    stale: false,
    ageHours: 50,
    cell: cell('LHR', 'EWR', '2027-04-02', '2027-04-16', 14),
    outbound: null,
    inbound: null,
    totalMinutes: null,
    outboundMinutes: null,
    inboundMinutes: null,
    stopsOut: null,
    stopsIn: null,
    layovers: [],
    carriers: [],
    verdicts: {},
    unverified: [],
    notApplied: ['arrivalWindowLocal', 'maxJourneyMinutes', 'maxStops'],
    seller: null,
    baggage: null,
    fareConditions: null,
    selfTransfer: null,
    booking: { kind: 'none' },
    searchLink: {
      url: 'https://search.aviasales.com/flights/?origin_iata=LHR&destination_iata=EWR&depart_date=2027-04-02&return_date=2027-04-16',
      host: 'search.aviasales.com',
      label: 'search link, not a fare link',
    },
    destinationNote: 'onward leg not included',
    calendarPriceId: 7,
    observationId: null,
    ...over,
  });
}

/** An ExecutionSummary (newest first in every list). */
export function summary(over: Partial<In<typeof apiContract.executionSummarySchema>> = {}): ExecutionSummary {
  return apiContract.executionSummarySchema.parse({
    id: 'exec-0001',
    status: 'completed',
    isChild: false,
    startedAt: '2026-10-14T12:00:00.000Z',
    finishedAt: '2026-10-14T13:00:00.000Z',
    ageHours: 2,
    // the run's own policy (decision 42); the definition() fixture's current expandTop is also 2
    expandTop: 2,
    ...over,
  });
}

const buckets = (
  priced: number,
  empty: number,
  noData: number,
  error: number,
  skipped: number,
  notRun: number,
) => ({
  priced,
  empty,
  no_data: noData,
  error,
  skipped,
  not_run: notRun,
  reused: 0,
});

/** The discovery and verification counts every fixture agrees on: 126 cells, 10 selected, 8 itinerary-searched. */
const discoveryBuckets = buckets(60, 10, 40, 6, 0, 10);
const verificationBuckets = buckets(8, 1, 0, 1, 116, 0);
const coverageSummary = {
  buckets: discoveryBuckets,
  total: 126,
  selected: 10,
  itinerarySearched: 8,
  onDemand: 1,
  reused: 0,
};

export function resultsResponse(
  over: Partial<In<typeof apiContract.resultsResponseSchema>> = {},
): ResultsResponse {
  const rows = over.rows ?? [verifiedBase, partialRow()];
  return apiContract.resultsResponseSchema.parse({
    rows,
    total: rows.length,
    truncated: false,
    basis: 'verified',
    basisReason: 'itinerary-searched observations exist',
    executions: [summary()],
    coverage: coverageSummary,
    excludedByCurrentSpace: 0,
    verificationProviderConfigured: true,
    cheapest: rows[0] ?? null,
    ...over,
  });
}

export function estimate(over: Partial<In<typeof apiContract.estimateSchema>> = {}): Estimate {
  return apiContract.estimateSchema.parse({
    cells: 126,
    perProvider: [
      {
        providerId: 'travelpayouts',
        stage: 'discovery',
        calls: 14,
        planCalls: 12,
        costMicroGbp: 0,
        costPence: 0,
        seconds: 20,
        blocked: null,
      },
      {
        providerId: 'searchapi',
        stage: 'verification',
        calls: 140,
        planCalls: 120,
        costMicroGbp: 0,
        costPence: 0,
        seconds: 600,
        blocked: null,
      },
    ],
    totalCalls: 154,
    totalPlanCalls: 132,
    totalCostMicroGbp: 0,
    totalCostPence: 0,
    seconds: 620,
    assumptions: ['Travelpayouts month tiles per airport pair'],
    windowClamped: false,
    retryFactor: 1.2,
    ...over,
  });
}

export function definition(
  over: Partial<In<typeof apiContract.definitionResponseSchema>> = {},
): DefinitionResponse {
  return apiContract.definitionResponseSchema.parse({
    id: 'def-0001',
    name: 'Worked example',
    origins: ['LHR', 'LGW'],
    destinations: ['JFK', 'EWR'],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: {
      discovery: ['travelpayouts', 'searchapi'],
      verification: ['searchapi'],
      discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 },
    },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: '0 5 * * 1',
    scheduleTz: 'Europe/London',
    confirmedCostPence: 0,
    confirmedCalls: 154,
    enabled: true,
    createdAt: '2026-10-14T09:00:00.000Z',
    updatedAt: '2026-10-14T09:00:00.000Z',
    deletedAt: null,
    budgetFit: {
      fits: true,
      runsPerMonth: 4,
      perScope: [{ scope: 'provider-month:searchapi', estimated: 616, cap: 10000, fits: true }],
    },
    estimate: estimate(),
    needsConfirmation: null,
    notices: [],
    ...over,
  });
}

export function usage(
  scope: string,
  calls: number,
  cap: number | null,
  costMicroGbp = 0,
  start: string | null = null,
  end: string | null = null,
): UsageRow {
  return apiContract.usageSchema.parse({
    scope,
    calls,
    costMicroGbp,
    costPence: microGbpToPence(costMicroGbp),
    cap,
    windowStart: start,
    windowEnd: end,
  });
}

const OCTOBER = ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'] as const;

export function providersResponse(
  over: Partial<In<typeof apiContract.providersResponseSchema>> = {},
): ProvidersResponse {
  return apiContract.providersResponseSchema.parse({
    synthetic: false,
    pointOfSale: 'GB',
    providers: [
      {
        providerId: 'travelpayouts',
        displayName: 'Travelpayouts',
        enabled: true,
        plan: 'free',
        excludedFromSchedule: false,
        notices: [],
        capNote: null,
        capabilities: {
          discovery: {
            sourceKind: 'authorised-cached',
            provenanceNote: 'Aviasales cache of recent user searches',
            maxAgeHours: 48,
          },
          verification: null,
        },
        usage: [usage('provider-month:travelpayouts', 60, 50000, 0, ...OCTOBER)],
      },
      {
        providerId: 'searchapi',
        displayName: 'SearchApi',
        enabled: true,
        plan: '40usd',
        excludedFromSchedule: false,
        notices: [],
        capNote:
          'calls cost £0 each on this plan, so the spend cap does not stop them; the monthly call cap (10000 calls) is the hard stop',
        capabilities: {
          discovery: {
            sourceKind: 'scraped-aggregate',
            provenanceNote: 'Google date grid via SearchApi',
            maxAgeHours: 24,
            maxAgeAssumed: true,
          },
          verification: {
            sourceKind: 'scraped-search',
            provenanceNote: 'Google Flights search via SearchApi; the vendor may serve a cached answer',
            maxAgeHours: 'unknown',
          },
        },
        usage: [usage('provider-month:searchapi', 615, 10000, 0, ...OCTOBER)],
      },
    ],
    presets: {
      policy: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true },
      providers: {
        discovery: ['travelpayouts', 'searchapi'],
        verification: ['searchapi'],
        discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 },
      },
      budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
      discoveryRefreshHours: 168,
      schedulerTimezone: 'Europe/London',
    },
    ...over,
  });
}

export function execution(
  over: Partial<In<typeof apiContract.executionResponseSchema>> = {},
): ExecutionResponse {
  return apiContract.executionResponseSchema.parse({
    id: 'exec-0001',
    definitionId: 'def-0001',
    isChild: false,
    cell: null,
    status: 'running',
    stage: 'discovery',
    reason: null,
    resumeAfter: null,
    trigger: 'manual',
    startedAt: '2026-10-14T14:00:00.000Z',
    finishedAt: null,
    errorText: null,
    progress: [
      { stage: 'discovery', providerId: 'travelpayouts', buckets: discoveryBuckets, total: 126 },
      { stage: 'verification', providerId: 'searchapi', buckets: buckets(0, 0, 0, 0, 116, 10), total: 126 },
    ],
    budget: [
      usage('execution-calls', 42, 2000),
      usage('execution-free-calls', 14, 2000),
      usage('global-month', 0, 35_000_000, 32_000_000),
      usage('provider-month:searchapi', 615, 10000, 0, ...OCTOBER),
    ],
    estimate: estimate(),
    ledger: {
      calls: 56,
      costMicroGbp: 0,
      costPence: 0,
      tiles: 14,
      cacheHits: 0,
      perProvider: [{ providerId: 'travelpayouts', stage: 'discovery', calls: 14, costMicroGbp: 0 }],
    },
    parityBreak: false,
    overrun: false,
    disabledProviders: [],
    ...over,
  });
}

export function coverageResponse(
  over: Partial<In<typeof apiContract.coverageResponseSchema>> = {},
): CoverageResponse {
  return apiContract.coverageResponseSchema.parse({
    executionId: 'exec-0001',
    summary: coverageSummary,
    perStage: [
      {
        stage: 'discovery',
        providerId: 'travelpayouts',
        buckets: discoveryBuckets,
        total: 126,
        requests: { calls: 14, tiles: 14, cacheHits: 0, costMicroGbp: 0, planCalls: 14 },
        overrun: false,
        parityBreak: false,
      },
      {
        stage: 'verification',
        providerId: 'searchapi',
        buckets: verificationBuckets,
        total: 126,
        requests: { calls: 50, tiles: 0, cacheHits: 0, costMicroGbp: 0, planCalls: 50 },
        overrun: false,
        parityBreak: false,
      },
    ],
    selectedNotReached: [
      { cell: cell('LHR', 'JFK', '2027-03-20', '2027-04-01', 12), reason: 'skipped:budget' },
    ],
    errors: [
      {
        cell: cell('LGW', 'EWR', '2027-03-21', '2027-04-02', 12),
        stage: 'discovery',
        providerId: 'travelpayouts',
        reason: 'rate-limit',
        lastError: 'HTTP 429',
        attempts: 3,
        retryable: true,
      },
    ],
    scheduleBlockedSince: null,
    onDemand: [],
    ...over,
  });
}

export function calendarGap(
  over: Partial<In<typeof apiContract.calendarGapResponseSchema>> = {},
): CalendarGapResponse {
  return apiContract.calendarGapResponseSchema.parse({
    cheapestVerified: {
      pricePence: 41200,
      provenance: provSearch,
      stale: false,
      ageHours: 'unknown',
      truncated: false,
      cell: cell('LHR', 'JFK', '2027-03-14', '2027-03-28', 14),
      itineraryHash: 'hash-verified-1',
      notSeenInLatest: null,
    },
    cells: [
      {
        cell: cell('LHR', 'EWR', '2027-04-02', '2027-04-16', 14),
        calendar: {
          pricePence: 39900,
          provenance: provCalendar,
          stale: false,
          ageHours: 50,
          truncated: false,
        },
        verifyAvailable: true,
      },
    ],
    ...over,
  });
}

export const airports: AirportsResponse = apiContract.airportsResponseSchema.parse([
  {
    iata: 'LHR',
    name: 'Heathrow',
    city: 'London',
    country: 'United Kingdom',
    tz: 'Europe/London',
    metro: 'LON',
  },
  {
    iata: 'LGW',
    name: 'Gatwick',
    city: 'London',
    country: 'United Kingdom',
    tz: 'Europe/London',
    metro: 'LON',
  },
]);

export function coverageCheck(
  over: Partial<In<typeof apiContract.coverageCheckResponseSchema>> = {},
): CoverageCheckResponse {
  return apiContract.coverageCheckResponseSchema.parse({
    pairs: [
      {
        origin: 'LHR',
        destination: 'JFK',
        months: [
          { month: '2027-03', cachedRows: 5, cellsInBand: 372 },
          { month: '2027-04', cachedRows: 0, cellsInBand: 360 },
        ],
      },
    ],
    calls: 14,
    notes: [],
    ...over,
  });
}
