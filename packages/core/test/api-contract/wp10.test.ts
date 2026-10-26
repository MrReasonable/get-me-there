import { describe, expect, it } from 'vitest';
import {
  calendarGapResponseSchema,
  cellDetailResponseSchema,
  historyPointSchema,
  itineraryHistoryResponseSchema,
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
  it('history points on the wire carry stale and truncated; the stored point shape is unchanged', () => {
    const series = [
      { providerId: 'travelpayouts', cabin: 'economy', points: [{ ...point, cell, executionId: 'e1' }] },
    ];
    const route = { origin: 'LHR', destination: 'JFK', calendarSeries: series, routeSeries: [] };
    expect(routeHistoryResponseSchema.safeParse(route).success).toBe(false);
    const withFlags = [
      {
        ...series[0],
        points: [{ ...point, stale: true, truncated: true, cell, executionId: 'e1', catchUp: null }],
      },
    ];
    expect(routeHistoryResponseSchema.safeParse({ ...route, calendarSeries: withFlags }).success).toBe(true);
    // review R19: each point names its run's catch-up (when it ran, the firing it ran for) or null; never left out
    const catchUp = { ranAt: '2027-03-01T08:00:00.000Z', for: '2027-03-01T06:00:00.000Z' };
    const labelled = [{ ...withFlags[0], points: [{ ...withFlags[0]?.points[0], catchUp }] }];
    expect(routeHistoryResponseSchema.safeParse({ ...route, calendarSeries: labelled }).success).toBe(true);
    const { catchUp: _gone, ...unlabelled } = withFlags[0]?.points[0] ?? {};
    expect(
      routeHistoryResponseSchema.safeParse({
        ...route,
        calendarSeries: [{ ...withFlags[0], points: [unlabelled] }],
      }).success,
    ).toBe(false);
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
    const full = { ...p, priceConfirmed: false, executionId: 'e1', catchUp: null };
    expect(itineraryHistoryResponseSchema.safeParse(one([full])).success).toBe(true);
    expect(
      itineraryHistoryResponseSchema.safeParse(one([{ ...p, executionId: 'e1', catchUp: null }])).success,
    ).toBe(false);
    expect(
      itineraryHistoryResponseSchema.safeParse(one([{ ...p, priceConfirmed: true, catchUp: null }])).success,
    ).toBe(false);
    // why: decision 52: the destination comes from the api, never from a cached Results row.
    const { cell: _cell, ...noCell } = base;
    expect(itineraryHistoryResponseSchema.safeParse({ ...noCell, series: one([full]).series }).success).toBe(
      false,
    );
  });

  it('the cell detail carries what a per-cell verify would spend, or null without a verification provider', () => {
    const detail = {
      cell,
      outcomes: [],
      browserLeftFor: 'next-scheduled-run',
      latestExecutionId: 'e1',
      calendarPrices: [],
      observations: [],
    };
    expect(cellDetailResponseSchema.safeParse(detail).success).toBe(false);
    // S6, S9: who fetches a left browser cell and the latest run are part of every answer
    const { browserLeftFor: _who, ...noWho } = detail;
    expect(cellDetailResponseSchema.safeParse({ ...noWho, verify: null }).success).toBe(false);
    expect(
      cellDetailResponseSchema.safeParse({ ...detail, browserLeftFor: 'later', verify: null }).success,
    ).toBe(false);
    expect(
      cellDetailResponseSchema.safeParse({ ...detail, latestExecutionId: null, verify: null }).success,
    ).toBe(true);
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify: null }).success).toBe(true);
    const verify = { maxCalls: 6, headroomCalls: 1840, needCalls: 6 };
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify }).success).toBe(true);
    expect(
      cellDetailResponseSchema.safeParse({ ...detail, verify: { ...verify, maxCalls: -1 } }).success,
    ).toBe(false);
    expect(cellDetailResponseSchema.safeParse({ ...detail, verify: { maxCalls: 6 } }).success).toBe(false);
  });

  it('decision 54: verified minima say when the latest search no longer returned them; calendar prices when superseded; route points their staleness', () => {
    const notSeen = { ageHours: 30 };
    const gap = {
      cheapestVerified: { ...price, cell, itineraryHash: 'h1', notSeenInLatest: null },
      cells: [],
    };
    expect(calendarGapResponseSchema.safeParse(gap).success).toBe(true);
    const notSeenGap = { ...gap, cheapestVerified: { ...gap.cheapestVerified, notSeenInLatest: notSeen } };
    expect(calendarGapResponseSchema.safeParse(notSeenGap).success).toBe(true);
    const { notSeenInLatest: _g, ...bareGap } = gap.cheapestVerified;
    expect(calendarGapResponseSchema.safeParse({ ...gap, cheapestVerified: bareGap }).success).toBe(false);
    const detail = {
      cell,
      outcomes: [],
      browserLeftFor: 'next-run',
      latestExecutionId: 'e1',
      observations: [],
      verify: null,
    };
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
      currency: 'GBP',
      fetchedAt: '2026-10-14T13:00:00.000Z',
      providerId: 'searchapi',
      sourceKind: 'scraped-search',
      pointOfSale: 'GB',
      fx: { converted: false },
    };
    const trip = { departureDate: '2027-03-10', returnDate: '2027-03-20' };
    const route = (points: unknown[], t: unknown = trip) => ({
      origin: 'LHR',
      destination: 'JFK',
      calendarSeries: [],
      routeSeries: [{ providerId: 'searchapi', trip: t, cabin: 'economy', points }],
    });
    expect(routeHistoryResponseSchema.safeParse(route([routePoint])).success).toBe(false);
    expect(routeHistoryResponseSchema.safeParse(route([{ ...routePoint, stale: true }])).success).toBe(true);
    // why: ruling 6: a series names its trip, or null for a migrated "trip unknown" series; never omits it.
    expect(routeHistoryResponseSchema.safeParse(route([{ ...routePoint, stale: true }], null)).success).toBe(
      true,
    );
    const series = { providerId: 'searchapi', cabin: 'economy', points: [{ ...routePoint, stale: true }] };
    expect(routeHistoryResponseSchema.safeParse({ ...route([]), routeSeries: [series] }).success).toBe(false);
    // why: prov-004: a point is vendor-stated GBP, by literal.
    expect(
      routeHistoryResponseSchema.safeParse(route([{ ...routePoint, stale: true, currency: 'USD' }])).success,
    ).toBe(false);
    // why: CodeRabbit batch 3 — a point carries its point of sale and an FX status (spec §3), which is never converted
    const { pointOfSale: _pos, ...noPos } = routePoint;
    const { fx: _fx, ...noFx } = routePoint;
    for (const p of [
      noPos,
      noFx,
      { ...routePoint, pointOfSale: 'gb' },
      { ...routePoint, fx: { converted: true } },
    ])
      expect(
        routeHistoryResponseSchema.safeParse(route([{ ...p, stale: true }])).success,
        JSON.stringify(p),
      ).toBe(false);
    expect(
      routeHistoryResponseSchema.safeParse(route([{ ...routePoint, pointOfSale: 'unknown', stale: true }]))
        .success,
    ).toBe(true);
  });
});
