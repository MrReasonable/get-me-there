import {
  AbortedError,
  asIata,
  asIsoDate,
  BudgetExceeded,
  cellKeyString,
  type DiscoveryQuery,
  type ItineraryQuery,
  type ProviderContext,
  ProviderError,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureHttpLimits, fixtureProvider, planFixtureTiles } from '../../src/fixture/provider.js';
import { fixtureRouter } from '../../src/fixture/router.js';
import { type FixtureRule, scenarioRequest } from '../../src/fixture/scenario.js';
import { defaultFixtureRoot } from '../../src/fixture/tree.js';
import type { FixtureRecorder } from '../../src/http/types.js';
import { fixtureHandlers } from '../../src/testing/handlers.js';
import { CapturingLogger, FakeBudget, makeKit, testLimits } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const GATE = {
  nodeEnv: 'test',
  databasePath: ':memory:',
  allowFixtureProvider: null,
  inContainer: false,
} as const;
const COST = 3200;
const NOTE =
  'synthetic data from the fixture provider, generated for tests and local development; not a fare';
const q: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2026-11-02'),
  departureTo: asIsoDate('2026-11-29'),
  minNights: 10,
  maxNights: 21,
  cabin: 'economy',
  currency: 'GBP',
};
const iq: ItineraryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2026-11-02'),
  returnDate: asIsoDate('2026-11-16'),
  cabin: 'economy',
  adults: 1,
  currency: 'GBP',
  expandTop: 2,
  bookingLinks: false,
};
const chained: ItineraryQuery = { ...iq, origin: asIata('LGW') };
const ctx = (over: Partial<ProviderContext> = {}): ProviderContext => ({
  executionId: 'exec-1',
  signal: new AbortController().signal,
  recordFixtures: true,
  ...over,
});
const scenario = (rules: FixtureRule[]) => fetch(scenarioRequest(rules));
const limits = () => ({
  ...testLimits(),
  fixture: fixtureHttpLimits({ costPerCallMicroGbp: COST, maxWaitSeconds: 3900, requestTimeoutSeconds: 60 }),
});

function setup(
  o: {
    budget?: FakeBudget;
    recorder?: FixtureRecorder;
    inProcessHosts?: Record<string, (req: Request) => Promise<Response>>;
  } = {},
) {
  const k = makeKit({ limits: limits(), ...o });
  const provider = fixtureProvider({
    http: k.kit,
    log: new CapturingLogger(),
    clock: k.clock,
    config: GATE,
    costMicroGbp: COST,
  });
  const discovery = provider.discovery;
  const verification = provider.verification;
  if (discovery === undefined || verification === undefined)
    throw new Error('fixture provider lacks a capability');
  return { ...k, provider, discovery, verification };
}
const firstTile = (query: DiscoveryQuery = q) => {
  const plan = planFixtureTiles(query)[0];
  if (plan === undefined) throw new Error('no plan');
  return plan;
};

describe('fixture provider gate and declarations (spec §5.5)', () => {
  it.each([
    [
      'production',
      {
        nodeEnv: 'production',
        databasePath: '/data/get-me-there.db',
        allowFixtureProvider: null,
        inContainer: true,
      },
    ],
    [
      'production with the phrase',
      {
        nodeEnv: 'production',
        databasePath: '/tmp/x.fixture.db',
        allowFixtureProvider: 'i-understand-this-is-fake',
        inContainer: false,
      },
    ],
    [
      'development without the phrase',
      {
        nodeEnv: 'development',
        databasePath: '/tmp/x.fixture.db',
        allowFixtureProvider: null,
        inContainer: false,
      },
    ],
    [
      'development in the container',
      {
        nodeEnv: 'development',
        databasePath: '/tmp/x.fixture.db',
        allowFixtureProvider: 'i-understand-this-is-fake',
        inContainer: true,
      },
    ],
    [
      'test with a production db path',
      {
        nodeEnv: 'test',
        databasePath: '/data/get-me-there.db',
        allowFixtureProvider: null,
        inContainer: false,
      },
    ],
  ] as const)('throws for %s', (_label, config) => {
    const { kit, clock } = makeKit();
    expect(() =>
      fixtureProvider({ http: kit, log: new CapturingLogger(), clock, config, costMicroGbp: COST }),
    ).toThrow(/syntheticAllowed/);
  });
  it('constructs under the test gate and the development opt-in', () => {
    const { kit, clock } = makeKit();
    const dev = {
      nodeEnv: 'development',
      databasePath: '/tmp/x.fixture.db',
      allowFixtureProvider: 'i-understand-this-is-fake',
      inContainer: false,
    } as const;
    for (const config of [GATE, dev])
      expect(
        fixtureProvider({ http: kit, log: new CapturingLogger(), clock, config, costMicroGbp: COST }).id,
      ).toBe('fixture');
  });
  it('declares synthetic provenance on both capabilities, fixture.local as its only host, billable on HTTP 200 at the test cost (prov-010)', () => {
    const { provider, discovery, verification } = setup();
    const info = { sourceKind: 'synthetic', provenanceNote: NOTE, maxAgeHours: 0 };
    expect([provider.id, discovery.info, verification.info]).toEqual(['fixture', info, info]);
    expect(
      fixtureHttpLimits({ costPerCallMicroGbp: COST, maxWaitSeconds: 1, requestTimeoutSeconds: 1 }),
    ).toMatchObject({ hosts: ['fixture.local'], billable: 'http-200', costPerCallMicroGbp: COST });
    expect(verification.estimate(iq)).toMatchObject({ calls: 5, costMicroGbp: 5 * COST });
  });
});

describe('planFixtureTiles (tiles partition the cells)', () => {
  const all = (tiles: ReturnType<typeof planFixtureTiles>) =>
    tiles.flatMap((t) => t.coveredCells.map(cellKeyString));

  it('28 departure days × 12 nights = 336 cells in 4 seven-day rectangles, disjoint and complete', () => {
    const tiles = planFixtureTiles(q);
    expect(tiles.map((t) => t.index)).toEqual([0, 1, 2, 3]);
    const keys = all(tiles);
    expect([keys.length, new Set(keys).size]).toEqual([336, 336]);
    expect(tiles[0]?.request).toEqual({
      kind: 'rectangle',
      departFrom: '2026-11-02',
      departTo: '2026-11-08',
      returnFrom: '2026-11-12',
      returnTo: '2026-11-29',
    });
  });
  it('re-plans over q.cells: fewer tiles, still a partition of exactly those cells', () => {
    const subset = planFixtureTiles(q)
      .flatMap((t) => t.coveredCells)
      .filter((c) => c.departureDate === '2026-11-03' || c.departureDate === '2026-11-20');
    const tiles = planFixtureTiles({ ...q, cells: subset });
    expect(tiles).toHaveLength(2);
    expect(all(tiles).sort()).toEqual(subset.map(cellKeyString).sort());
  });
  it('is deterministic', () => expect(planFixtureTiles(q)).toEqual(planFixtureTiles(q)));
});

describe('fixture discovery through the real http-kit and msw', () => {
  beforeEach(() => {
    useFakeTime();
    server.use(...fixtureHandlers(defaultFixtureRoot(), GATE));
  });
  afterEach(() => vi.useRealTimers());

  it('fetchTile returns synthetic prices for exactly its covered cells, drops out-of-band entries, ledgers one billable-rule call', async () => {
    const { discovery, budget } = setup();
    const plan = firstTile();
    const result = await drive(discovery.fetchTile(plan, q, ctx()));
    if (result.kind !== 'tile') throw new Error(`expected a tile, got ${result.kind}`);
    const covered = new Set(plan.coveredCells.map(cellKeyString));
    expect(result.prices).toHaveLength(84);
    expect(result.prices.every((p) => covered.has(cellKeyString(p)) && p.currency === 'GBP')).toBe(true);
    expect(
      result.prices.find((p) => p.returnDate === '2026-11-16' && p.departureDate === '2026-11-02')
        ?.amountMinor,
    ).toBe(59_800);
    expect(result).toMatchObject({
      notes: ['dropped-out-of-band:42'],
      fetchedAt: '2026-10-14T15:00:00.000Z',
      pointOfSale: 'unknown',
    });
    expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e] : []))).toEqual([
      expect.objectContaining({
        providerId: 'fixture',
        costMicroGbp: COST,
        tileIndex: 0,
        endpointPath: '/calendar',
        httpAttempt: 1,
      }),
    ]);
    expect(budget.events.find((e) => e.type === 'finalise')).toMatchObject({
      outcome: 'ok',
      httpStatus: 200,
    });
  });

  it('reports noFares from the pair file and leaves noData nights absent', async () => {
    const { discovery } = setup();
    const lgw = { ...q, origin: asIata('LGW') };
    const r = await drive(discovery.fetchTile(firstTile(lgw), lgw, ctx()));
    if (r.kind !== 'tile') throw new Error(r.kind);
    expect([r.noFares.length, r.prices.length]).toEqual([7, 77]);
  });

  it('fetches every page of a paged tile under one tileIndex (multi-row tile for parity, pie-008)', async () => {
    const { discovery, budget } = setup();
    const paged = { ...q, origin: asIata('LGW'), destination: asIata('EWR') };
    const r = await drive(discovery.fetchTile(firstTile(paged), paged, ctx()));
    if (r.kind !== 'tile') throw new Error(r.kind);
    expect(r.prices).toHaveLength(84);
    const reserves = budget.events.flatMap((e) => (e.type === 'reserve' ? [e] : []));
    expect(reserves).toHaveLength(4);
    expect(reserves.every((e) => e.tileIndex === 0 && e.httpAttempt === 1)).toBe(true);
  });

  it('caches a tile only when the server marks it cacheable; the repeat is a cache-hit row with the tile index', async () => {
    const { discovery, budget } = setup();
    const plan = firstTile();
    await drive(discovery.fetchTile(plan, q, ctx()));
    await drive(discovery.fetchTile(plan, q, ctx()));
    expect([budget.count('fetch'), budget.count('cache-hit')]).toEqual([2, 0]);
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'cacheable' }, times: 1 }]);
    const marked = { ...q, departureFrom: asIsoDate('2026-11-09') };
    await drive(discovery.fetchTile(firstTile(marked), marked, ctx()));
    await drive(discovery.fetchTile(firstTile(marked), marked, ctx({ executionId: 'exec-2' })));
    expect(budget.events.filter((e) => e.type === 'cache-hit')).toEqual([
      expect.objectContaining({ providerId: 'fixture', executionId: 'exec-2', tileIndex: 0 }),
    ]);
  });

  it('returns tile-error for a ProviderError after retries, marking exactly its covered cells', async () => {
    await scenario([
      {
        match: { path: '/calendar', params: { departFrom: '2026-11-02' } },
        respond: { kind: 'status', status: 503 },
        times: 3,
      },
    ]);
    const { discovery } = setup();
    const plan = firstTile();
    const r = await drive(discovery.fetchTile(plan, q, ctx()));
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'upstream', httpStatus: 503 } });
    expect(r.coveredCells).toBe(plan.coveredCells);
  });

  it.each([
    [{ kind: 'no-currency' }, 'missing-currency'],
    [
      {
        kind: 'status',
        status: 200,
        body: {
          currency: 'GBP',
          origin: 'LHR',
          destination: 'JFK',
          page: 1,
          pages: 1,
          prices: [],
          noFares: [],
        },
      },
      'not-synthetic',
    ],
    [
      {
        kind: 'status',
        status: 200,
        body: {
          synthetic: true,
          currency: 'GBP',
          origin: 'LGW',
          destination: 'JFK',
          page: 1,
          pages: 1,
          prices: [],
          noFares: [],
        },
      },
      'pair-mismatch',
    ],
    [
      {
        kind: 'status',
        status: 200,
        body: {
          synthetic: true,
          currency: 'GBP',
          origin: 'LHR',
          destination: 'JFK',
          page: 1,
          pages: 1,
          prices: [{ departureDate: '2026-11-02' }],
          noFares: [],
        },
      },
      'malformed-entry',
    ],
    [{ kind: 'malformed' }, 'malformed-json'],
  ] as const)('a %j response is a parse tile-error ([%s])', async (respond, code) => {
    await scenario([{ match: { path: '/calendar' }, respond }]);
    const { discovery } = setup();
    expect(await drive(discovery.fetchTile(firstTile(), q, ctx()))).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'parse', reason: undefined, message: expect.stringContaining(`[${code}]`) },
    });
  });

  it('AbortedError propagates out of fetchTile (it is not a tile-error)', async () => {
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'hang' } }]);
    const { discovery } = setup();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    expect(await driveError(discovery.fetchTile(firstTile(), q, ctx({ signal: ac.signal })))).toBeInstanceOf(
      AbortedError,
    );
  });
});

describe('fixture verification through the real http-kit and msw', () => {
  beforeEach(() => {
    useFakeTime();
    server.use(...fixtureHandlers(defaultFixtureRoot(), GATE));
  });
  afterEach(() => vi.useRealTimers());

  it('search returns priced synthetic offers with no booking link, the requested cabin and the server’s taxesIncluded', async () => {
    const { verification, budget } = setup();
    const r = await drive(verification.search(iq, ctx()));
    expect(r).toMatchObject({
      coverage: 'priced',
      partial: false,
      failedExpansions: 0,
      fetchedAt: '2026-10-14T15:00:00.000Z',
      pointOfSale: 'unknown',
    });
    expect(r.routeHistory).toBeUndefined();
    expect(r.offers).toHaveLength(2);
    expect(r.offers[0]).toMatchObject({
      seller: 'Synthetic Air',
      requestedCabin: 'economy',
      amountMinor: 63_600,
      currency: 'GBP',
      taxesIncluded: true,
      booking: { kind: 'none' },
      baggage: { cabinBag: 'included', checkedBags: 1 },
      outbound: [
        {
          marketingCarrier: 'ZZ',
          flightNumber: '101',
          from: 'LHR',
          to: 'JFK',
          depart: '2026-11-02T09:30',
          timeKind: 'local',
          cabin: 'economy',
        },
      ],
    });
    expect(budget.events.find((e) => e.type === 'reserve')).toMatchObject({
      endpointPath: '/itinerary',
      tileIndex: null,
      costMicroGbp: COST,
    });
  });

  it('search: empty → coverage empty; no-return-legs → upstream non-retryable with that reason; partial → partial', async () => {
    const { verification } = setup();
    await scenario([{ match: { path: '/itinerary' }, respond: { kind: 'empty' }, times: 1 }]);
    expect(await drive(verification.search(iq, ctx()))).toMatchObject({ coverage: 'empty', offers: [] });
    await scenario([{ match: { path: '/itinerary' }, respond: { kind: 'no-return-legs' }, times: 1 }]);
    const err = await driveError(verification.search(iq, ctx()));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'upstream', reason: 'no-return-legs', retryable: false });
    await scenario([
      { match: { path: '/itinerary' }, respond: { kind: 'partial', failedExpansions: 1 }, times: 1 },
    ]);
    expect(await drive(verification.search(iq, ctx()))).toMatchObject({
      coverage: 'priced',
      partial: true,
      failedExpansions: 1,
    });
  });

  it('a chained pair makes 1 + 2 × expandTop calls and returns the airline and agency offers per outbound', async () => {
    const { verification, budget } = setup();
    const r = await drive(verification.search(chained, ctx()));
    expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e.endpointPath] : []))).toEqual([
      '/itinerary',
      '/itinerary/return',
      '/itinerary/booking',
      '/itinerary/return',
      '/itinerary/booking',
    ]);
    expect(r.offers.map((o) => o.seller)).toEqual([
      'Synthetic Air',
      'Synthetic Agency',
      'Synthetic Travel',
      'Synthetic Agency',
    ]);
    expect(r).toMatchObject({ coverage: 'priced', partial: false });
  });

  it('a chained return step that fails after retries counts as a failed expansion (partial)', async () => {
    await scenario([
      {
        match: { path: '/itinerary/return', params: { outbound: 'o1' } },
        respond: { kind: 'status', status: 503 },
        times: 3,
      },
    ]);
    const { verification } = setup();
    const r = await drive(verification.search(chained, ctx()));
    expect(r).toMatchObject({ partial: true, failedExpansions: 1 });
    expect(r.offers).toHaveLength(2);
  });

  it('every chained return step failing → upstream no-return-legs', async () => {
    await scenario([{ match: { path: '/itinerary/return' }, respond: { kind: 'status', status: 404 } }]);
    const { verification } = setup();
    expect(await driveError(verification.search(chained, ctx()))).toMatchObject({
      kind: 'upstream',
      reason: 'no-return-legs',
    });
  });

  it.each([
    [401, 'auth'],
    [402, 'quota'],
  ] as const)(
    'a %i on a chained step propagates as %s and stops the chain (prov-r2-002, spec §5.4 rev 12)',
    async (status, kind) => {
      await scenario([
        {
          match: { path: '/itinerary/return', params: { outbound: 'o0' } },
          respond: { kind: 'status', status },
        },
      ]);
      const { verification, budget } = setup();
      expect(await driveError(verification.search(chained, ctx()))).toMatchObject({
        kind,
        httpStatus: status,
      });
      expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e.endpointPath] : []))).toEqual([
        '/itinerary',
        '/itinerary/return',
      ]);
    },
  );

  it('a limiter-timeout on a booking step propagates with its retry time instead of becoming a note', async () => {
    await scenario([
      {
        match: { path: '/itinerary/booking' },
        respond: { kind: 'status', status: 429, headers: { 'retry-after': '7200' } },
      },
    ]);
    const { verification } = setup();
    expect(await driveError(verification.search(chained, ctx()))).toMatchObject({
      kind: 'limiter-timeout',
      retryAfterSeconds: 7200,
    });
  });

  it('a BudgetExceeded mid-chain propagates (earlier steps stay ledgered)', async () => {
    const budget = new FakeBudget([]);
    budget.refuse = () =>
      budget.reserveCalls === 3
        ? new BudgetExceeded({ scope: 'execution-calls', cap: 2, current: 2, requested: 1 })
        : null;
    const { verification } = setup({ budget });
    expect(await driveError(verification.search(chained, ctx()))).toBeInstanceOf(BudgetExceeded);
    expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e.endpointPath] : []))).toEqual([
      '/itinerary',
      '/itinerary/return',
    ]);
  });
});

describe('fixture provider transport and recording', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('works over the gated in-process seam (fixture mode) with no msw handler, scenarios sent to that router', async () => {
    const router = fixtureRouter(defaultFixtureRoot(), GATE);
    const { discovery, budget } = setup({
      inProcessHosts: { 'fixture.local': async (req) => router.fetch(req) },
    });
    expect(await drive(discovery.fetchTile(firstTile(), q, ctx()))).toMatchObject({
      kind: 'tile',
      pointOfSale: 'unknown',
    });
    await router.fetch(
      scenarioRequest([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 401 } }]),
    );
    expect(await drive(discovery.fetchTile(firstTile(), q, ctx()))).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'auth' },
    });
    expect([budget.count('fetch'), budget.count('reserve')]).toEqual([0, 2]);
  });

  it('never records, even when ctx.recordFixtures is true (test-002, prov-005)', async () => {
    server.use(...fixtureHandlers(defaultFixtureRoot(), GATE));
    let recordCalls = 0;
    const spy: FixtureRecorder = {
      record: async () => {
        recordCalls += 1;
        return '';
      },
    };
    const { discovery, verification } = setup({ recorder: spy });
    expect(await drive(discovery.fetchTile(firstTile(), q, ctx({ recordFixtures: true })))).toMatchObject({
      kind: 'tile',
    });
    expect(await drive(verification.search(chained, ctx({ recordFixtures: true })))).toMatchObject({
      coverage: 'priced',
    });
    expect(recordCalls).toBe(0);
  });

  it('healthcheck makes no call', async () => {
    const { provider, budget } = setup();
    expect(await provider.healthcheck(ctx())).toEqual({
      ok: true,
      detail: 'synthetic fixture provider; no upstream call',
    });
    expect(budget.reserveCalls).toBe(0);
  });
});
