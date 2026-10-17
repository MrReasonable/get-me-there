import {
  addDays,
  apiContract,
  asIata,
  asIsoDate,
  type Buckets,
  type Cell,
  type CellKey,
  effectiveAge,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  type Provenance,
  type ProviderId,
  provenanceSchema,
  worstCaseAgeHours,
} from '@gmt/core';
import type { z } from 'zod';
import type {
  CalendarDay,
  CalendarResponse,
  CellDetailResponse,
  DurationResponse,
  ExecutionSummary,
  ItineraryHistoryResponse,
  PriceCellData,
  RouteHistoryResponse,
} from '../src/api/types.js';
import { bucketTotal, type SliceOptions, sliceOf } from '../src/views/Calendar/marker.js';
import type { DaySlice, GridDay } from '../src/views/Calendar/types.js';
import { provCalendar, provSearch, provSynthetic, summary } from './fixtures.js';
import { NOW, type ProvenanceInput } from './render.js';

// WP10's builders on top of WP9's test/fixtures.ts (provenance and execution builders come from there). Every builder
// that returns a contract shape runs it through the contract schema, so a schema change breaks here, at the fixture.

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

/** A known-age itinerary provenance; no current provider produces one, so only the precedence tie test uses it. */
export function provItineraryKnownAge(h: number, maxAgeHours: number): Provenance {
  return prov(provSearch, h, { maxAgeHours });
}

/** Travelpayouts calendar provenance fetched h hours before NOW. */
export function provCalendarAt(h: number, maxAgeHours: number | 'unknown' = 48): Provenance {
  return prov(provCalendar, h, { maxAgeHours });
}

/** The fixture provider's synthetic provenance, from WP9's provSynthetic (spec §5.5). */
export function provSyntheticAt(h: number): Provenance {
  return prov(provSynthetic, h);
}

/** Decision 54's marks on a view figure; a builder that does not set them sends neither. */
export interface Marks {
  notSeenInLatest: { ageHours: number | 'unknown' } | null;
  superseded: boolean;
}

/**
 * A day price as calendarDaySchema sends it, its age from core's effective-age rule. It carries both decision-54
 * fields, so it fits a verified or a calendar minimum (the contract parse keeps the one each shape declares).
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

export function buckets(partial: Partial<Buckets>): Buckets {
  return { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0, ...partial };
}

/** One provider's discovery entry; total is the six buckets' sum unless a test needs it to disagree. */
export function disc(
  providerId: ProviderId,
  partial: Partial<Buckets>,
  total?: number,
): CalendarDay['discovery'][number] {
  const b = buckets(partial);
  return { providerId, buckets: b, total: total ?? bucketTotal(b) };
}

/** A calendar day through the contract schema. */
export function day(date: string, partial: Partial<Omit<CalendarDay, 'date'>> = {}): CalendarDay {
  return apiContract.calendarDaySchema.parse({
    date,
    discovery: [],
    verification: { selected: 0, itinerarySearched: 0, onDemand: 0, unconfirmedCells: 0 },
    cheapestVerified: null,
    cheapestPartiallyVerified: null,
    cheapestCalendar: null,
    ...partial,
  });
}

/** Definition options with both stages configured. */
export const BOTH: SliceOptions = { verificationConfigured: true, discoveryProviders: ['travelpayouts'] };

export function slice(partial: Partial<DaySlice>): DaySlice {
  return {
    discovery: [],
    discoveryProviders: ['travelpayouts'],
    verification: null,
    unconfirmedCells: 0,
    cheapestVerified: null,
    cheapestPartiallyVerified: null,
    cheapestCalendar: null,
    destination: null,
    ...partial,
  };
}

/** A grid day as the unfiltered calendar returns it. */
export function gridDay(
  date: string,
  partial: Partial<Omit<CalendarDay, 'date'>> = {},
  o: SliceOptions = BOTH,
): GridDay {
  return { date: asIsoDate(date), slice: sliceOf(day(date, partial), o, null) };
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

export function calendarResponse(
  days: CalendarDay[],
  over: Partial<CalendarResponse> = {},
): CalendarResponse {
  return apiContract.calendarResponseSchema.parse({
    days,
    executions: [summary()],
    staleAfterHours: 192,
    calendarStaleAfterHours: { travelpayouts: 216, searchapi: 192 },
    ...over,
  });
}

type Night = DurationResponse['byNights'][number];

/** How much of a nights value a series searched: all of it, none of it, or [searched, total] cells. */
type Searched = boolean | [number, number];
function searchedOf(s: Searched, total: number): { searched: number; total: number } {
  if (s === true) return { searched: total, total };
  if (s === false) return { searched: 0, total };
  return { searched: s[0], total: s[1] };
}

/** One nights value; verified/calendar are [pence, n] or null; `searched` says how much each series searched. */
export function night(
  nights: number,
  verified: [number, number] | null,
  calendar: [number, number] | null,
  searched: { verification: Searched; travelpayouts: Searched } = { verification: true, travelpayouts: true },
  at: Cell = cellAt('2027-03-14', nights),
): Night {
  return {
    nights,
    minVerified:
      verified === null
        ? null
        : {
            ...bare(priceAt(verified[0], provItinerary(5), false, at)),
            cell: at,
            n: verified[1],
            notSeenInLatest: null,
          },
    minCalendar:
      calendar === null
        ? []
        : [
            {
              providerId: 'travelpayouts',
              price: {
                ...bare(priceAt(calendar[0], provCalendarAt(2), false, at)),
                cell: at,
                superseded: false,
              },
              n: calendar[1],
            },
          ],
    searched: {
      verification: searchedOf(searched.verification, 4),
      discovery: [{ providerId: 'travelpayouts', ...searchedOf(searched.travelpayouts, 48) }],
    },
  };
}

export function durationResponse(byNights: Night[], over: Partial<DurationResponse> = {}): DurationResponse {
  return apiContract.durationAnalysisResponseSchema.parse({ byNights, executions: [summary()], ...over });
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
    sourceKind: priced ? 'authorised-cached' : null,
    reusedFromExecutionId: null,
    ...over,
  };
}

export function cellDetail(c: Cell, over: Partial<CellDetailResponse> = {}): CellDetailResponse {
  return apiContract.cellDetailResponseSchema.parse({
    cell: c,
    outcomes: [],
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

/** The default calendar the shared msw handlers serve: a priced day, a glyph day and a day no run has reached. */
export function defaultCalendar(): CalendarResponse {
  const c = cellAt('2027-03-14', 14);
  return calendarResponse([
    day('2027-03-14', {
      discovery: [disc('travelpayouts', { priced: 40, no_data: 8 })],
      cheapestCalendar: priceAt(41200, provCalendarAt(2), false, c),
    }),
    day('2027-03-15', { discovery: [disc('travelpayouts', { no_data: 40, not_run: 8 })] }),
    day('2027-03-16'),
  ]);
}
