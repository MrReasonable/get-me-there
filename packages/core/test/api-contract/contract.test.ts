import { describe, expect, it } from 'vitest';
import {
  alertRuleInputSchema,
  alertRuleUpdateRequestSchema,
  cronSchema,
  definitionCreateRequestSchema,
  healthResponseSchema,
  priceCellSchema,
  ROUTES,
  resultRowSchema,
  resultsQuerySchema,
  resultsResponseSchema,
} from '../../src/api-contract/index.js';
import { verifiedFigure } from '../helpers/datePairs.js';

const provenance = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: '2026-10-14T15:00:00.000Z',
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};

describe('api-contract (spec §10)', () => {
  it('has a route for every spec §10 row, all under /api', () => {
    expect(ROUTES.every((r) => r.path.startsWith('/api/'))).toBe(true);
    const paths = ROUTES.map((r) => `${r.method} ${r.path.replace(/^\/api/, '')}`);
    for (const p of [
      'GET /health',
      'GET /airports',
      'GET /providers',
      'GET /definitions',
      'POST /definitions',
      'POST /definitions/estimate',
      'GET /definitions/:id',
      'PUT /definitions/:id',
      'DELETE /definitions/:id',
      'POST /definitions/:id/estimate',
      'POST /definitions/coverage-check',
      'POST /definitions/:id/executions',
      'GET /executions/:id',
      'POST /executions/:id/cancel',
      'POST /executions/:id/resume',
      'POST /cells/verify',
      'GET /definitions/:id/results',
      'GET /definitions/:id/date-pairs',
      'GET /definitions/:id/calendar',
      'GET /definitions/:id/duration-analysis',
      'GET /definitions/:id/coverage',
      'GET /definitions/:id/calendar-gap',
      'GET /definitions/:id/cells/:origin/:destination/:departureDate/:returnDate',
      'POST /tools/smoke',
      'POST /tools/record',
      'GET /itineraries/:hash/history',
      'GET /routes/:origin/:destination/history',
      'GET /alerts',
      'POST /alerts',
      'PUT /alerts/:id',
      'DELETE /alerts/:id',
      'GET /alerts/events',
      'GET /scheduler/jobs',
      'GET /budget',
    ])
      expect(paths).toContain(p);
    expect(new Set(paths).size).toBe(paths.length);
    expect(ROUTES.filter((r) => r.auth === 'public').map((r) => r.path)).toEqual(['/api/health']);
  });
  it('every price-bearing response requires provenance', () => {
    const cell = { pricePence: 41200, provenance, stale: false, ageHours: 2, truncated: false };
    const { provenance: _drop, ...bare } = cell;
    expect(priceCellSchema.safeParse(bare).success).toBe(false);
    expect(priceCellSchema.safeParse(cell).success).toBe(true);
    expect(priceCellSchema.safeParse({ ...cell, pricePence: 412.5 }).success).toBe(false);
    expect(priceCellSchema.safeParse({ ...cell, stale: true, ageHours: 'unknown' }).success).toBe(true);
  });
  it('a result row without provenance is rejected', () => {
    const row = {
      itineraryHash: null,
      basis: 'calendar',
      verdictClass: 'unchecked',
      pricePence: 41200,
      stale: false,
      ageHours: 2,
      truncated: false,
      cell: {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-14',
        returnDate: '2027-03-28',
        nights: 14,
      },
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
      notApplied: ['arrivalWindowLocal'],
      seller: null,
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
      superseded: false,
      adjustedPence: null,
      destinationNote: null,
      executionId: 'e1',
      calendarPriceId: 7,
      observationId: null,
    };
    expect(resultRowSchema.safeParse(row).success).toBe(false);
    expect(resultRowSchema.safeParse({ ...row, provenance }).success).toBe(true);
    expect(resultRowSchema.safeParse({ ...row, provenance, searchLink: null }).success).toBe(true);
    const other = {
      seller: 'x',
      pricePence: 1,
      provenance,
      booking: { kind: 'none' },
      stale: false,
      ageHours: 1,
      verdictClass: 'failed',
      unverified: [],
      notSeenInLatest: null,
    };
    expect(resultRowSchema.safeParse({ ...row, provenance, otherOffers: [other] }).success).toBe(true);
    expect(
      resultRowSchema.safeParse({
        ...row,
        provenance,
        otherOffers: [{ ...other, verdictClass: 'unchecked' }],
      }).success,
    ).toBe(false);
  });
  it('forces bookingLinks true when searchapi verifies', () => {
    const def = {
      name: 'x',
      origins: ['LHR'],
      destinations: ['JFK'],
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
      minNights: 10,
      maxNights: 21,
      cabin: 'economy',
      constraints: {},
      verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: false },
      budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
      providers: { discovery: ['searchapi'], verification: ['searchapi'], discoveryRefreshHours: {} },
      destinationNotes: {},
      onwardCostPence: {},
      scheduleCron: '0 5 * * 1',
      scheduleTz: 'Europe/London',
      enabled: true,
    };
    expect(definitionCreateRequestSchema.safeParse(def).success).toBe(false);
    const okDef = { ...def, verification: { ...def.verification, bookingLinks: true } };
    expect(definitionCreateRequestSchema.safeParse(okDef).success).toBe(true);
    expect(definitionCreateRequestSchema.safeParse({ ...okDef, confirmedCostPence: 150 }).success).toBe(true);
    expect(definitionCreateRequestSchema.safeParse({ ...okDef, origins: ['lhr'] }).data?.origins).toEqual([
      'LHR',
    ]);
    expect(definitionCreateRequestSchema.safeParse({ ...okDef, destinations: ['LHR'] }).success).toBe(false); // not disjoint
  });
  it('rejects topN above maxCells, startOffsetDays 0 and an absolute window ending before it starts', () => {
    const base = {
      name: 'x',
      origins: ['LHR'],
      destinations: ['JFK'],
      window: { kind: 'relative', startOffsetDays: 0, lengthDays: 10 },
      minNights: 1,
      maxNights: 2,
      cabin: 'economy',
      constraints: {},
      verification: { maxCells: 5, topN: 6, alwaysInclude: [], expandTop: 1, bookingLinks: true },
      budget: { maxCalls: 0, maxFreeCalls: 100, maxCostMicroGbp: 0 },
      providers: { discovery: ['travelpayouts'], verification: [], discoveryRefreshHours: {} },
      destinationNotes: {},
      onwardCostPence: {},
      scheduleCron: null,
      scheduleTz: 'Europe/London',
      enabled: true,
    };
    const r = definitionCreateRequestSchema.safeParse(base);
    expect(r.success).toBe(false);
    const fields = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(fields).toEqual(expect.arrayContaining(['verification.topN', 'window.startOffsetDays']));
    const abs = definitionCreateRequestSchema.safeParse({
      ...base,
      window: { kind: 'absolute', from: '2027-03-10', to: '2027-03-01' },
      verification: { ...base.verification, topN: 5 },
    });
    expect(abs.success).toBe(false);
    const more = definitionCreateRequestSchema.safeParse({
      ...base,
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 10 },
      minNights: 3,
      maxNights: 2,
      verification: {
        ...base.verification,
        topN: 5,
        alwaysInclude: Array.from({ length: 6 }, (_, i) => ({
          origin: 'LHR',
          destination: 'JFK',
          departureDate: `2027-03-0${i + 1}`,
          returnDate: `2027-03-1${i + 1}`,
        })),
      },
    });
    const moreFields = more.success ? [] : more.error.issues.map((i) => i.path.join('.'));
    expect(moreFields).toEqual(expect.arrayContaining(['verification.alwaysInclude', 'maxNights']));
  });
  it('cronSchema is a bounded string only', () => {
    expect(cronSchema.safeParse('0 5 * * 1').success).toBe(true);
    expect(cronSchema.safeParse('rm -rf /').success).toBe(false);
  });
  it('alert rules need the threshold their type uses and requireAllVerified only on the verified basis', () => {
    const base = {
      definitionId: 'd',
      type: 'absolute',
      thresholdPence: 40000,
      pct: null,
      basis: 'verified',
      requireAllVerified: true,
      cooldownHours: 336,
      enabled: true,
    };
    expect(alertRuleInputSchema.safeParse(base).success).toBe(true);
    expect(alertRuleInputSchema.safeParse({ ...base, thresholdPence: null }).success).toBe(false);
    expect(alertRuleInputSchema.safeParse({ ...base, type: 'dropPct', pct: 10 }).success).toBe(true);
    expect(alertRuleInputSchema.safeParse({ ...base, type: 'dropPct' }).success).toBe(false);
    expect(alertRuleInputSchema.safeParse({ ...base, basis: 'calendar' }).success).toBe(false);
    expect(
      alertRuleInputSchema.safeParse({ ...base, basis: 'calendar', requireAllVerified: null }).success,
    ).toBe(true);
  });
  it('results response carries basisReason and excludedByCurrentSpace; health is a union', () => {
    const r = resultsResponseSchema.safeParse({
      rows: [],
      total: 0,
      truncated: false,
      basis: 'calendar',
      basisReason: 'no verification provider configured',
      executions: [],
      coverage: {
        buckets: { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 },
        total: 0,
        selected: 0,
        itinerarySearched: 0,
        onDemand: 0,
        reused: 0,
      },
      excludedByCurrentSpace: 0,
      verificationProviderConfigured: false,
      cheapest: null,
      datePairFigure: null,
    });
    expect(r.success).toBe(true);
    expect(healthResponseSchema.safeParse({ ok: true, degraded: false }).success).toBe(true);
  });
});

describe('alertRuleUpdateRequestSchema (partial PUT)', () => {
  it('parses a partial body to exactly the fields it named, never filling a default', () => {
    expect(alertRuleUpdateRequestSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(alertRuleUpdateRequestSchema.parse({})).toEqual({});
    expect(alertRuleUpdateRequestSchema.parse({ cooldownHours: 24 })).toEqual({ cooldownHours: 24 });
    expect(alertRuleUpdateRequestSchema.safeParse({ cooldownHours: 0 }).success).toBe(false);
  });
});

describe('/results scope parameters and datePairFigure (WP19; spec §10)', () => {
  it('the query takes the five scope strings as the wire gives them; the api answers 422 for their values', () => {
    const scope = {
      departureDate: '2027-03-14',
      returnDate: '2027-03-28',
      origins: 'LHR,LGW',
      destinations: 'JFK',
      maxJourneyMinutes: '600',
    };
    expect(resultsQuerySchema.parse({ basis: 'calendar', ...scope })).toEqual({
      basis: 'calendar',
      ...scope,
    });
    expect(resultsQuerySchema.parse({ departureDate: '14/03/2027', maxJourneyMinutes: 'abc' })).toEqual({
      departureDate: '14/03/2027',
      maxJourneyMinutes: 'abc',
    });
    for (const [key, max] of [
      ['departureDate', 40],
      ['returnDate', 40],
      ['origins', 200],
      ['destinations', 200],
      ['maxJourneyMinutes', 10],
    ] as const) {
      expect(resultsQuerySchema.safeParse({ [key]: '1'.repeat(max) }).success, key).toBe(true);
      expect(resultsQuerySchema.safeParse({ [key]: '1'.repeat(max + 1) }).success, key).toBe(false);
    }
  });

  it("the response requires datePairFigure: null, or the board's figure less its airport pair", () => {
    const base = {
      rows: [],
      total: 0,
      truncated: false,
      basis: 'verified',
      basisReason: 'itinerary-searched observations exist',
      executions: [],
      coverage: {
        buckets: { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 },
        total: 0,
        selected: 0,
        itinerarySearched: 0,
        onDemand: 0,
        reused: 0,
      },
      excludedByCurrentSpace: 0,
      verificationProviderConfigured: true,
      cheapest: null,
    };
    expect(resultsResponseSchema.safeParse(base).success).toBe(false);
    expect(resultsResponseSchema.safeParse({ ...base, datePairFigure: null }).success).toBe(true);
    const { airportPair, ...figure } = verifiedFigure();
    expect(resultsResponseSchema.parse({ ...base, datePairFigure: figure }).datePairFigure).toEqual(figure);
    expect(
      resultsResponseSchema.safeParse({ ...base, datePairFigure: { ...figure, airportPair } }).success,
    ).toBe(false);
  });
});
