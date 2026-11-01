// Spec revision 55 §2 "The flight-list read" and §5.1 (WP20 Task 20.7): the camoufox adapter's flight-list capability,
// against msw as fetchTile.test.ts. The answers carry the real provenance shape (the contract refuses any provider but
// camoufox) with synthetic flights; the worked example's airports only.
import {
  asIata,
  asIsoDate,
  BudgetExceeded,
  FLIGHT_LIST_ENDPOINT_PATH,
  flightsRequestSchema,
  ProviderError,
} from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMOUFOX_FLIGHT_LIST_INFO, camoufoxProvider } from '../../src/camoufox/index.js';
import { fixtureProvider } from '../../src/fixture/provider.js';
import { makeKit, SENTINELS, testLimits } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const URL_ = 'http://127.0.0.1:8090/v1/flights';
const PAGE = 'http://127.0.0.1:8090/v1/page';
const CELL = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2027-03-14'),
  returnDate: asIsoDate('2027-03-24'),
};
const NAMES = { origin: ['London Heathrow Airport'], destination: ['John F Kennedy International Airport'] };
const Q = { cell: CELL, airportNames: NAMES };
const ctx = { executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: false };
const contacted = (yes: boolean) => ({ headers: { 'x-gmt-google-contacted': yes ? '1' : '0' } });
const versions = {
  selectors: 's',
  grammar: '2026-10-31-times',
  camoufoxJs: '0.11.5',
  binary: '152.0.4-beta.28',
};
// A synthetic flight (no recording's).
const FLIGHT = {
  departsLocal: '09:05',
  arrivesLocal: '12:10',
  arrivesDayOffset: 0,
  durationMinutes: 485,
  stops: 0,
  carriers: ['QQ Air'],
  operatedBy: null,
  amountMinor: 47_800,
};
const answer = (o: Record<string, unknown> = {}) => ({
  kind: 'flights',
  fetchedAt: '2026-10-14T15:00:00.000Z',
  currency: 'GBP',
  pointOfSale: 'GB',
  listed: 'flights',
  flights: [FLIGHT],
  minMinor: 47_800,
  tabMinor: 45_100,
  cheapestView: 'cheapest',
  optionsUnparsed: 1,
  optionsOtherCell: 2,
  resultsStated: 4,
  notes: [],
  versions,
  ...o,
});
// The spec rev 55 §2 provenance note, copied here so a change to either is a visible diff.
const SPEC_PROVENANCE_NOTE =
  "Google Flights flight list via Camoufox: the outbound flights Google Flights listed for this day pair, each with the lowest round-trip total Google listed with that outbound (its \"From\" price; the return flight is neither chosen nor read), when this app's own Camoufox browser read the page on the machine running this app's browser worker, from that machine's address, in the currency the page states. Times are the page's local times. Flight numbers, seller and baggage are not read; nothing is checked with the airline.";

function setup() {
  const { kit, budget, log, clock, events } = makeKit({
    limits: testLimits({ camoufox: { workerPort: 8090 }, 'camoufox-status': { workerPort: 8090 } }),
  });
  const p = camoufoxProvider({
    http: kit,
    log,
    clock,
    key: SENTINELS.camoufox,
    workerUrl: 'http://127.0.0.1:8090',
    pointOfSale: 'GB',
  });
  const lists = p.flightLists;
  if (lists === undefined) throw new Error('camoufox has no flightLists');
  return { p, lists, budget, events, log };
}
const reserves = (events: ReturnType<typeof setup>['events']) => events.filter((e) => e.type === 'reserve');
const bodies: unknown[] = [];
const capture = (respond: () => Response) =>
  http.post(URL_, async ({ request }) => {
    bodies.push(await request.json());
    return respond();
  });

afterEach(() => {
  server.resetHandlers();
  bodies.length = 0;
  vi.useRealTimers();
});
beforeEach(() => {
  expect.hasAssertions();
});

describe('camoufox flightLists (spec rev 55 §2, §5.1)', () => {
  it('declares its source, economy only, with the spec’s provenance note', () => {
    const { lists } = setup();
    expect(CAMOUFOX_FLIGHT_LIST_INFO).toEqual({
      sourceKind: 'scraped-self',
      maxAgeHours: 0,
      provenanceNote: SPEC_PROVENANCE_NOTE,
    });
    expect(lists.info).toBe(CAMOUFOX_FLIGHT_LIST_INFO);
    expect(lists.cabins).toEqual(['economy']);
  });
  it('posts a flights request to /v1/flights with the cell, the names and its own gl, ledgered as one page', async () => {
    const { lists, events, budget } = setup();
    server.use(capture(() => HttpResponse.json(answer(), contacted(true))));
    await lists.read(Q, ctx);
    expect(bodies).toEqual([{ mode: 'flights', ...CELL, gl: 'GB', airportNames: NAMES }]);
    expect(flightsRequestSchema.safeParse(bodies[0]).success).toBe(true);
    expect(reserves(events)).toEqual([
      expect.objectContaining({
        providerId: 'camoufox',
        endpointPath: FLIGHT_LIST_ENDPOINT_PATH,
        executionId: 'exec-1',
        tileIndex: null,
      }),
    ]);
    expect(budget.rowsOf('camoufox').map((r) => r.pageClass)).toEqual(['page']);
    // why: the request stays well under the worker's 4,096-byte body cap
    expect(JSON.stringify(bodies[0]).length).toBeLessThan(4096);
  });
  it('an on-demand read (no execution) is ledgered with executionId null', async () => {
    const { lists, events } = setup();
    server.use(capture(() => HttpResponse.json(answer(), contacted(true))));
    await lists.read(Q, { ...ctx, executionId: null });
    expect(reserves(events)[0]).toMatchObject({ executionId: null, endpointPath: '/v1/flights' });
  });
  it('maps a flights answer to a list with every field', async () => {
    const { lists } = setup();
    server.use(capture(() => HttpResponse.json(answer(), contacted(true))));
    expect(await lists.read(Q, ctx)).toEqual({
      kind: 'list',
      fetchedAt: '2026-10-14T15:00:00.000Z',
      pointOfSale: 'GB',
      listed: 'flights',
      flights: [FLIGHT],
      minMinor: 47_800,
      tabMinor: 45_100,
      cheapestView: 'cheapest',
      optionsUnparsed: 1,
      optionsOtherCell: 2,
      resultsStated: 4,
      notes: [],
    });
  });
  it('keeps the other outcomes and the page’s own point of sale', async () => {
    const { lists } = setup();
    server.use(
      capture(() =>
        HttpResponse.json(
          answer({
            listed: 'no-flights',
            flights: [],
            minMinor: null,
            tabMinor: null,
            cheapestView: null,
            resultsStated: null,
            pointOfSale: 'unknown',
          }),
          contacted(true),
        ),
      ),
    );
    expect(await lists.read(Q, ctx)).toMatchObject({
      kind: 'list',
      listed: 'no-flights',
      flights: [],
      pointOfSale: 'unknown',
    });
  });
  it('a query without airport names fails closed, list-error no-airport-names, before any request', async () => {
    const { lists, events } = setup();
    server.use(capture(() => HttpResponse.json(answer(), contacted(true))));
    for (const names of [
      { origin: [], destination: NAMES.destination },
      { origin: NAMES.origin, destination: [] },
    ]) {
      const r = await lists.read({ cell: CELL, airportNames: names }, ctx);
      expect(r.kind).toBe('list-error');
      if (r.kind !== 'list-error') throw new Error('list-error');
      expect(r.error).toBeInstanceOf(ProviderError);
      expect([r.error.kind, r.error.reason, r.error.retryable]).toEqual(['parse', 'no-airport-names', false]);
    }
    expect(bodies).toEqual([]);
    expect(reserves(events)).toEqual([]);
  });
  // why: 20.7 review finding 5: only missing names are `no-airport-names`; any other request the contract refuses is
  // its own parse failure, still before any request
  it('a request the contract refuses for another reason is a parse list-error, not no-airport-names', async () => {
    const { lists, events } = setup();
    server.use(capture(() => HttpResponse.json(answer(), contacted(true))));
    for (const q of [
      {
        cell: CELL,
        airportNames: {
          origin: Array.from({ length: 9 }, () => 'QQ Airport'),
          destination: NAMES.destination,
        },
      },
      { cell: { ...CELL, returnDate: CELL.departureDate }, airportNames: NAMES },
    ]) {
      const r = await lists.read(q, ctx);
      expect(r).toMatchObject({
        kind: 'list-error',
        error: { kind: 'parse', reason: 'parse', retryable: false },
      });
      if (r.kind === 'list-error') expect(r.error.message).toContain('[invalid-request]');
    }
    const bad = camoufoxProvider({
      http: makeKit({ limits: testLimits({ camoufox: { workerPort: 8090 } }) }).kit,
      log: setup().log,
      clock: makeKit().clock,
      key: SENTINELS.camoufox,
      workerUrl: 'http://127.0.0.1:8090',
      pointOfSale: 'gb',
    });
    expect(await bad.flightLists?.read(Q, ctx)).toMatchObject({
      kind: 'list-error',
      error: { reason: 'parse' },
    });
    expect(bodies).toEqual([]);
    expect(reserves(events)).toEqual([]);
  });
  it('a monthly-cap answer throws BudgetExceeded at provider-month with the worker’s own figures', async () => {
    const { lists } = setup();
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(
          { kind: 'monthly-cap', cap: 2000, used: 2003, windowEnd: '2026-11-01T00:00:00.000Z' },
          { status: 429, ...contacted(false) },
        ),
      ),
    );
    const r = lists.read(Q, ctx);
    await expect(r).rejects.toBeInstanceOf(BudgetExceeded);
    await expect(r).rejects.toMatchObject({
      scope: 'provider-month',
      providerId: 'camoufox',
      cap: 2000,
      current: 2003,
      counter: 'worker',
      windowEnd: '2026-11-01T00:00:00.000Z',
    });
  });
  it.each([
    [
      423,
      { kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' },
      true,
      'blocked',
      'blocked:captcha',
    ],
    [
      423,
      { kind: 'cooling-down', cause: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' },
      false,
      'blocked',
      'cooling-down:captcha',
    ],
    [504, { kind: 'not-ready', elapsedMs: 90_000 }, true, 'parse', 'page-not-ready'],
    [502, { kind: 'browser-error', stage: 'launch', detail: 'x' }, false, 'upstream', 'browser-error:launch'],
    [401, {}, false, 'auth', 'worker-key'],
    [400, { kind: 'bad-request' }, false, 'parse', 'bad-request'],
  ])(
    'HTTP %i %j (contacted %s) → list-error %s (%s), called once',
    async (status, body, isContacted, kind, reason) => {
      const { lists } = setup();
      let hits = 0;
      server.use(
        http.post(URL_, () => {
          hits++;
          return HttpResponse.json(body, { status, ...contacted(isContacted) });
        }),
      );
      const r = await lists.read(Q, ctx);
      expect(r).toMatchObject({ kind: 'list-error', error: { kind, reason, retryable: false } });
      if (r.kind === 'list-error') expect(r.error.message).toContain('camoufox /v1/flights');
      expect(hits).toBe(1);
    },
  );
  it('429 spacing honours Retry-After, then the page: two rows, one page', async () => {
    useFakeTime();
    const { lists, budget } = setup();
    const answers = [
      HttpResponse.json(
        { kind: 'spacing', retryAfterSeconds: 1 },
        { status: 429, headers: { 'retry-after': '1', 'x-gmt-google-contacted': '0' } },
      ),
      HttpResponse.json(answer(), contacted(true)),
    ];
    server.use(http.post(URL_, () => answers.shift() ?? HttpResponse.error()));
    expect(await drive(lists.read(Q, ctx))).toMatchObject({ kind: 'list', listed: 'flights' });
    expect(budget.rowsOf('camoufox').map((r) => r.pageClass)).toEqual(['no-page', 'page']);
  });
  it('a spacing answer that never ends is a rate-limit list-error, through classifyWorkerAnswer', async () => {
    useFakeTime();
    const { lists } = setup();
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(
          { kind: 'spacing', retryAfterSeconds: 1 },
          { status: 429, headers: { 'retry-after': '1', 'x-gmt-google-contacted': '0' } },
        ),
      ),
    );
    expect(await drive(lists.read(Q, ctx))).toMatchObject({
      kind: 'list-error',
      error: { kind: 'rate-limit', reason: 'spacing' },
    });
  });
  it('an answer of another kind, or one read outside this request, is a parse list-error', async () => {
    for (const body of [
      {
        kind: 'cells',
        fetchedAt: '2026-10-14T15:00:00.000Z',
        currency: 'GBP',
        pointOfSale: 'GB',
        notes: [],
        versions,
        cell: { status: 'no-flights' },
      },
      answer({ fetchedAt: '2026-10-01T00:00:00.000Z' }),
      answer({ flights: [{ ...FLIGHT, amountMinor: 0 }] }),
    ]) {
      const { lists } = setup();
      server.use(http.post(URL_, () => HttpResponse.json(body, contacted(true))));
      const r = await lists.read(Q, ctx);
      expect(r).toMatchObject({ kind: 'list-error', error: { kind: 'parse' } });
    }
  });
  it('never sends a flights request to /v1/page', async () => {
    const { lists } = setup();
    let pageHits = 0;
    server.use(
      http.post(PAGE, () => {
        pageHits++;
        return HttpResponse.json({}, { status: 500 });
      }),
      capture(() => HttpResponse.json(answer(), contacted(true))),
    );
    await lists.read(Q, ctx);
    expect(pageHits).toBe(0);
  });
  it('the sentinel key never appears in the answer, the error or the log', async () => {
    const ok = setup();
    server.use(capture(() => HttpResponse.json(answer(), contacted(true))));
    const a = await ok.lists.read(Q, ctx);
    const bad = setup();
    server.use(http.post(URL_, () => HttpResponse.json({}, { status: 401, ...contacted(false) })));
    const b = await bad.lists.read(Q, ctx);
    const key = SENTINELS.camoufox.reveal();
    expect(JSON.stringify(a)).not.toContain(key);
    expect(b.kind === 'list-error' ? `${b.error.message}${JSON.stringify(b.error)}` : 'x').not.toContain(key);
    expect(JSON.stringify(ok.log.lines)).not.toContain(key);
    expect(JSON.stringify(bad.log.lines)).not.toContain(key);
  });
  it('the fixture provider exposes no flightLists', () => {
    const { kit, log, clock } = makeKit();
    const f = fixtureProvider({
      http: kit,
      log,
      clock,
      config: { nodeEnv: 'test', databasePath: ':memory:', allowFixtureProvider: null, inContainer: false },
      costMicroGbp: 0,
    });
    expect(f.flightLists).toBeUndefined();
  });
});
