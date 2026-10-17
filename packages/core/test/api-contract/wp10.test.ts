import { describe, expect, it } from 'vitest';
import {
  calendarDaySchema,
  calendarGapResponseSchema,
  calendarQuerySchema,
  cellDetailResponseSchema,
  durationAnalysisResponseSchema,
  historyPointSchema,
  itineraryHistoryResponseSchema,
  ROUTES,
  routeHistoryResponseSchema,
} from '../../src/api-contract/index.js';

// WP10's contract additions (plan decisions 38, 42, 48, 51, 52; spec §11 View B, View C, History). WP8 fills every field.
const provenance = {
  providerId: 'travelpayouts',
  sourceKind: 'authorised-cached',
  fetchedAt: '2026-10-14T13:00:00.000Z',
  maxAgeHours: 48,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};
const cell = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2027-03-14',
  returnDate: '2027-03-28',
  nights: 14,
};
const price = { pricePence: 41200, provenance, stale: false, ageHours: 50, truncated: false };
const point = { at: '2026-10-14T13:00:00.000Z', pricePence: 41200, provenance };

describe('WP10 contract additions (plan decision 38)', () => {
  it('duration analysis: each minimum carries its cell, and searched counts k of N per series', () => {
    const night = {
      nights: 14,
      minVerified: { ...price, cell, n: 3, notSeenInLatest: null },
      minCalendar: [{ providerId: 'travelpayouts', price: { ...price, cell, superseded: false }, n: 5 }],
      searched: {
        verification: { searched: 0, total: 4 },
        discovery: [{ providerId: 'travelpayouts', searched: 30, total: 48 }],
      },
    };
    const ok = durationAnalysisResponseSchema.safeParse({ byNights: [night], executions: [] });
    expect(ok.success).toBe(true);
    // why: a flag cannot tell one searched cell of hundreds from all of them (review prov-r2-007).
    const flags = { verification: true, discovery: [{ providerId: 'travelpayouts', searched: true }] };
    expect(
      durationAnalysisResponseSchema.safeParse({ byNights: [{ ...night, searched: flags }], executions: [] })
        .success,
    ).toBe(false);
    const { cell: _c, ...noCell } = night.minVerified;
    expect(
      durationAnalysisResponseSchema.safeParse({
        byNights: [{ ...night, minVerified: noCell }],
        executions: [],
      }).success,
    ).toBe(false);
    const bareCalendar = [{ providerId: 'travelpayouts', price, n: 5 }];
    expect(
      durationAnalysisResponseSchema.safeParse({
        byNights: [{ ...night, minCalendar: bareCalendar }],
        executions: [],
      }).success,
    ).toBe(false);
  });

  it('history points on the wire carry stale and truncated; the stored point shape is unchanged', () => {
    const series = [
      { providerId: 'travelpayouts', cabin: 'economy', points: [{ ...point, cell, executionId: 'e1' }] },
    ];
    const route = { origin: 'LHR', destination: 'JFK', calendarSeries: series, routeSeries: [] };
    expect(routeHistoryResponseSchema.safeParse(route).success).toBe(false);
    const withFlags = [
      { ...series[0], points: [{ ...point, stale: true, truncated: true, cell, executionId: 'e1' }] },
    ];
    expect(routeHistoryResponseSchema.safeParse({ ...route, calendarSeries: withFlags }).success).toBe(true);
    // why: @gmt/db's repositories return the stored shape; WP8 adds the flags when it answers.
    expect(historyPointSchema.safeParse(point).success).toBe(true);
  });

  it('itinerary history names its cell and carriers, and each point its run and whether its price was confirmed', () => {
    const base = {
      itineraryHash: 'h1',
      cell,
      carriers: ['BA'],
      series: [{ providerId: 'searchapi', seller: 'Example Air', cabin: 'economy' }],
    };
    const p = { ...point, stale: false, truncated: false };
    const one = (points: unknown[], over: object = {}) => ({
      ...base,
      ...over,
      series: [{ ...base.series[0], points }],
    });
    const full = { ...p, priceConfirmed: false, executionId: 'e1' };
    expect(itineraryHistoryResponseSchema.safeParse(one([full])).success).toBe(true);
    expect(itineraryHistoryResponseSchema.safeParse(one([{ ...p, executionId: 'e1' }])).success).toBe(false);
    expect(itineraryHistoryResponseSchema.safeParse(one([{ ...p, priceConfirmed: true }])).success).toBe(
      false,
    );
    // why: decision 52: the destination comes from the api, never from a cached Results row.
    const { cell: _cell, ...noCell } = base;
    expect(itineraryHistoryResponseSchema.safeParse({ ...noCell, series: one([full]).series }).success).toBe(
      false,
    );
  });

  it('the cell detail carries what a per-cell verify would spend, or null without a verification provider', () => {
    const detail = { cell, outcomes: [], calendarPrices: [], observations: [] };
    expect(cellDetailResponseSchema.safeParse(detail).success).toBe(false);
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify: null }).success).toBe(true);
    const verify = { maxCalls: 6, headroomCalls: 1840 };
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify }).success).toBe(true);
    expect(
      cellDetailResponseSchema.safeParse({ ...detail, verify: { ...verify, maxCalls: -1 } }).success,
    ).toBe(false);
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify: { maxCalls: 6 } }).success).toBe(false);
  });

  it('a calendar day counts its unconfirmed cells; the route takes an optional destination (decisions 51, 53)', () => {
    const day = {
      date: '2027-03-14',
      discovery: [],
      verification: { selected: 2, itinerarySearched: 2, onDemand: 0 },
      cheapestVerified: null,
      cheapestPartiallyVerified: null,
      cheapestCalendar: null,
      byDestination: [],
    };
    expect(calendarDaySchema.safeParse(day).success).toBe(false);
    const verification = { ...day.verification, unconfirmedCells: 1 };
    expect(calendarDaySchema.safeParse({ ...day, verification }).success).toBe(true);
    expect(
      calendarDaySchema.safeParse({ ...day, verification: { ...verification, unconfirmedCells: true } })
        .success,
    ).toBe(false);
    expect(calendarQuerySchema.safeParse({}).success).toBe(true);
    expect(calendarQuerySchema.safeParse({ destination: 'JFK' }).success).toBe(true);
    expect(calendarQuerySchema.safeParse({ destination: 'not-an-airport' }).success).toBe(false);
    const calendar = ROUTES.find((r) => r.method === 'GET' && r.path === '/api/definitions/:id/calendar');
    expect(calendar?.query).toBe(calendarQuerySchema);
  });

  it('decision 54: verified minima say when the latest search no longer returned them; calendar prices when superseded; route points their staleness', () => {
    const notSeen = { ageHours: 30 };
    const day = {
      date: '2027-03-14',
      discovery: [],
      verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 0 },
      cheapestVerified: { ...price, cell, itineraryHash: 'h1', notSeenInLatest: notSeen },
      cheapestPartiallyVerified: null,
      cheapestCalendar: { ...price, cell, superseded: true },
      byDestination: [],
    };
    expect(calendarDaySchema.safeParse(day).success).toBe(true);
    const { notSeenInLatest: _n, ...noNotSeen } = day.cheapestVerified;
    expect(calendarDaySchema.safeParse({ ...day, cheapestVerified: noNotSeen }).success).toBe(false);
    expect(calendarDaySchema.safeParse({ ...day, cheapestCalendar: { ...price, cell } }).success).toBe(false);
    const gap = {
      cheapestVerified: { ...price, cell, itineraryHash: 'h1', notSeenInLatest: null },
      cells: [],
    };
    expect(calendarGapResponseSchema.safeParse(gap).success).toBe(true);
    const { notSeenInLatest: _g, ...bareGap } = gap.cheapestVerified;
    expect(calendarGapResponseSchema.safeParse({ ...gap, cheapestVerified: bareGap }).success).toBe(false);
    const night = {
      nights: 14,
      minVerified: { ...price, cell, n: 1, notSeenInLatest: notSeen },
      minCalendar: [{ providerId: 'travelpayouts', price: { ...price, cell, superseded: false }, n: 1 }],
      searched: { verification: { searched: 1, total: 1 }, discovery: [] },
    };
    expect(durationAnalysisResponseSchema.safeParse({ byNights: [night], executions: [] }).success).toBe(
      true,
    );
    const oldCalendar = [{ providerId: 'travelpayouts', price: { ...price, cell }, n: 1 }];
    expect(
      durationAnalysisResponseSchema.safeParse({
        byNights: [{ ...night, minCalendar: oldCalendar }],
        executions: [],
      }).success,
    ).toBe(false);
    const detail = { cell, outcomes: [], observations: [], verify: null };
    const calendarPrice = { ...price, executionId: 'e1', calendarPriceId: 7 };
    expect(cellDetailResponseSchema.safeParse({ ...detail, calendarPrices: [calendarPrice] }).success).toBe(
      false,
    );
    expect(
      cellDetailResponseSchema.safeParse({
        ...detail,
        calendarPrices: [{ ...calendarPrice, superseded: true }],
      }).success,
    ).toBe(true);
    const routePoint = {
      date: '2027-03-10',
      pricePence: 38000,
      fetchedAt: '2026-10-14T13:00:00.000Z',
      providerId: 'searchapi',
      sourceKind: 'scraped-search',
    };
    const route = (points: unknown[]) => ({
      origin: 'LHR',
      destination: 'JFK',
      calendarSeries: [],
      routeSeries: [{ providerId: 'searchapi', cabin: 'unknown', points }],
    });
    expect(routeHistoryResponseSchema.safeParse(route([routePoint])).success).toBe(false);
    expect(routeHistoryResponseSchema.safeParse(route([{ ...routePoint, stale: true }])).success).toBe(true);
  });
});
