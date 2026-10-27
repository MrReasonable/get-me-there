import {
  addDays,
  apiContract,
  asIata,
  asIsoDate,
  type Cell,
  type CellKey,
  effectiveAge,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  type Provenance,
  type ProviderId,
  provenanceSchema,
  type SourceKind,
  worstCaseAgeHours,
} from '@gmt/core';
import type { z } from 'zod';
import type {
  CellDetailResponse,
  ExecutionSummary,
  ItineraryHistoryResponse,
  PriceCellData,
  RouteHistoryResponse,
} from '../src/api/types.js';
import { provCalendar, provSearch, summary } from './fixtures.js';
import { NOW, type ProvenanceInput } from './render.js';

// WP10's builders on top of WP9's test/fixtures.ts (provenance and execution builders come from there). Every builder
// that returns a contract shape runs it through the contract schema, so a schema change breaks here, at the fixture.
// WP19 removed the Calendar and Duration views with their builders; what stays serves the date pair detail's
// airport-pair panels (the cell route) and History.

/** An instant h hours before NOW, through core's instant helper. */
export function hoursBefore(h: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(NOW) - h * 3_600_000);
}

/** A worked-example cell (LHR → JFK unless given). */
export function cellAt(departure: string, nights: number, origin = 'LHR', destination = 'JFK'): Cell {
  const dep = asIsoDate(departure);
  return {
    origin: asIata(origin),
    destination: asIata(destination),
    departureDate: dep,
    returnDate: addDays(dep, nights),
    nights,
  };
}

export function keyOf(c: Cell): CellKey {
  return {
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
  };
}

/** WP9's wire-form provenance, re-dated and parsed through core's schema (brands minted by zod, never by hand). */
function prov(base: ProvenanceInput, h: number, over: Partial<ProvenanceInput> = {}): Provenance {
  return provenanceSchema.parse({ ...base, fetchedAt: hoursBefore(h), ...over });
}

/** SearchApi itinerary provenance as stored: maxAgeHours 'unknown' (spec rev 15 §3, plan decision 24). */
export function provItinerary(h: number): Provenance {
  return prov(provSearch, h, { maxAgeHours: 'unknown' });
}

/** Travelpayouts calendar provenance fetched h hours before NOW. */
export function provCalendarAt(h: number, maxAgeHours: number | 'unknown' = 48): Provenance {
  return prov(provCalendar, h, { maxAgeHours });
}

/** Decision 54's marks on a view figure; a builder that does not set them sends neither. */
export interface Marks {
  notSeenInLatest: { ageHours: number | 'unknown' } | null;
  superseded: boolean;
}

/**
 * A cell price, its age from core's effective-age rule. It carries both decision-54 fields, so it fits a verified or a
 * calendar figure (the contract parse keeps the one each shape declares); `bare` strips it for the panel's prices.
 */
export function priceAt(
  pricePence: number,
  provenance: Provenance,
  stale: boolean,
  at: Cell,
  truncated = false,
  marks: Partial<Marks> = {},
): PriceCellData & { cell: Cell; itineraryHash: string } & Marks {
  const ageHours = worstCaseAgeHours(effectiveAge(provenance, NOW));
  return {
    pricePence,
    provenance,
    stale,
    ageHours,
    truncated,
    cell: at,
    itineraryHash: `it-${at.departureDate}-${pricePence}`,
    notSeenInLatest: marks.notSeenInLatest ?? null,
    superseded: marks.superseded ?? false,
  };
}

/** A price cell without its cell and hash (calendar-gap, panel prices). */
export function bare(p: PriceCellData & { cell: Cell }): PriceCellData {
  return {
    pricePence: p.pricePence,
    provenance: p.provenance,
    stale: p.stale,
    ageHours: p.ageHours,
    truncated: p.truncated,
  };
}

/**
 * Parent runs started h hours before NOW, newest first as the executions list sends them, each with id `exec-<h>`
 * (the run ids fetchPoint and offerPoint give their points), so History's run order can be set per test.
 */
export function runsAt(...hours: number[]): ExecutionSummary[] {
  return [...hours]
    .sort((a, b) => a - b)
    .map((h) =>
      summary({ id: `exec-${h}`, startedAt: hoursBefore(h), finishedAt: hoursBefore(h), ageHours: h }),
    );
}

type Outcome = CellDetailResponse['outcomes'][number];

/** One cell outcome of the panel's table. */
export function outcome(
  c: Cell,
  stage: Outcome['stage'],
  providerId: ProviderId,
  status: Outcome['status'],
  over: Partial<Outcome> = {},
): Outcome {
  const priced = status === 'priced';
  // why: the provider and the source kind agree (spec §5.5, §5.6): SearchApi's calendar is an aggregate, its itinerary
  // search a search; Travelpayouts is the authorised cache; the fixture provider is synthetic. `over` is the escape hatch.
  const kind: SourceKind =
    providerId === 'searchapi'
      ? stage === 'verification'
        ? 'scraped-search'
        : 'scraped-aggregate'
      : providerId === 'fixture'
        ? 'synthetic'
        : 'authorised-cached';
  return {
    ...keyOf(c),
    executionId: 'exec-0001',
    stage,
    providerId,
    status,
    reason: null,
    attempts: priced ? 1 : 0,
    lastError: null,
    fetchedAt: priced ? hoursBefore(2) : null,
    minPence: priced ? 41200 : null,
    cabin: priced ? 'economy' : null,
    pointOfSale: priced ? 'unknown' : null,
    sourceKind: priced ? kind : null,
    reusedFromExecutionId: null,
    skipDetail: null,
    ...over,
  };
}

export function cellDetail(c: Cell, over: Partial<CellDetailResponse> = {}): CellDetailResponse {
  return apiContract.cellDetailResponseSchema.parse({
    cell: c,
    outcomes: [],
    browserLeftFor: 'next-scheduled-run',
    latestExecutionId: 'exec-0001',
    calendarPrices: [],
    observations: [],
    verify: { maxCalls: 6, headroomCalls: 1840, needCalls: 6 },
    ...over,
  });
}

type RouteFetchPoint = RouteHistoryResponse['calendarSeries'][number]['points'][number];

/** A calendar fetch point h hours ago: the pair's minimum that run, with its cell and run id. */
export function fetchPoint(
  h: number,
  pricePence: number,
  at: Cell = cellAt('2027-03-14', 14),
  over: Partial<RouteFetchPoint> = {},
): RouteFetchPoint {
  return {
    at: hoursBefore(h),
    pricePence,
    provenance: provCalendarAt(h),
    stale: false,
    truncated: false,
    cell: at,
    executionId: `exec-${h}`,
    catchUp: null,
    ...over,
  };
}

/** Accepts the schema's input shape (plain strings for dates), so tests can write literals; returns the parsed shape. */
export function routeHistory(
  over: Partial<z.input<typeof apiContract.routeHistoryResponseSchema>> = {},
): RouteHistoryResponse {
  return apiContract.routeHistoryResponseSchema.parse({
    origin: 'LHR',
    destination: 'JFK',
    calendarSeries: [
      {
        providerId: 'travelpayouts',
        cabin: 'economy',
        points: [fetchPoint(2, 39900), fetchPoint(170, 42000)],
      },
    ],
    routeSeries: [
      {
        providerId: 'searchapi',
        trip: { departureDate: '2027-03-10', returnDate: '2027-03-20' },
        cabin: 'economy',
        points: ['2027-03-10', '2027-03-11', '2027-03-12'].map((d, i) => ({
          date: d,
          pricePence: 38000 + i * 500,
          currency: 'GBP',
          fetchedAt: hoursBefore(2),
          providerId: 'searchapi',
          sourceKind: 'scraped-search',
          pointOfSale: 'GB',
          fx: { converted: false },
          stale: false,
        })),
      },
    ],
    ...over,
  });
}

type OfferPoint = ItineraryHistoryResponse['series'][number]['points'][number];

export function offerPoint(
  h: number,
  pricePence: number,
  priceConfirmed = true,
  over: Partial<OfferPoint> = {},
): OfferPoint {
  return {
    at: hoursBefore(h),
    pricePence,
    provenance: provItinerary(h),
    stale: false,
    truncated: false,
    priceConfirmed,
    executionId: `exec-${h}`,
    catchUp: null,
    ...over,
  };
}

export function itineraryHistory(over: Partial<ItineraryHistoryResponse> = {}): ItineraryHistoryResponse {
  return apiContract.itineraryHistoryResponseSchema.parse({
    itineraryHash: 'hash-verified-1',
    cell: cellAt('2027-03-14', 14),
    carriers: ['BA'],
    series: [
      {
        providerId: 'searchapi',
        seller: 'Example Travel',
        cabin: 'economy',
        points: [
          offerPoint(5, 41200),
          offerPoint(173, 43000),
          offerPoint(6, 39000, false),
          offerPoint(174, 40000, false),
        ],
      },
    ],
    ...over,
  });
}
