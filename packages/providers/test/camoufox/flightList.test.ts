// Spec revision 55 §2 "The flight-list read" and §5.1 (WP20 Task 20.7): the camoufox adapter's flight-list capability,
// against msw as fetchTile.test.ts. The answers carry the real provenance shape (the contract refuses any provider but
// camoufox) with synthetic flights; the worked example's airports only. Revision 56 "The return phase" (WP21 Task
// 21.4): the limits, the booking ask, the page plan and the request's own timeout; the returns, the page count and the
// spacing hold, which http-kit sets from any answer that states it (21.4 review I1). The http-kit is the real one behind
// a spy, so the test sees each request it was given and, under fake time, when the next one was sent.
import {
  asIata,
  asIsoDate,
  BudgetExceeded,
  FLIGHT_LIST_ENDPOINT_PATH,
  type FlightLimits,
  flightRequestSeconds,
  flightsRequestSchema,
  listRequestSeconds,
  ProviderError,
  returnReadSchema,
} from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMOUFOX_FLIGHT_LIST_INFO, camoufoxProvider } from '../../src/camoufox/index.js';
import { fixtureProvider } from '../../src/fixture/provider.js';
import type { HttpKit, HttpKitRequest } from '../../src/http/types.js';
import { FLIGHT_REQUEST_SECONDS, makeKit, SENTINELS, testLimits } from '../fakes.js';
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
// The spec rev 56 §2 Labels provenance note, copied here so a change to either is a visible diff.
const SPEC_PROVENANCE_NOTE =
  "Google Flights flight list via Camoufox: the outbound flights Google Flights listed for this day pair, each with the lowest round-trip total Google listed with that outbound (its \"From\" price), and, where this app's worker selected the cheapest of the outbound flights it read that was within the search's longest journey, stops and time windows (or, when none was, the cheapest it read; or, when none of that outbound's returns was within them, the next-cheapest within them, from a fresh load of the same page), the return flights Google listed with that outbound, each with the lowest round-trip total Google listed for that outbound and that return (its \"From\" price), and, for the one return this app then selected, the booking options Google listed after its \"more booking options\" were opened: the sellers' stated prices for those two flights that this app read, of which the lowest is the pairing's price shown, the cheapest of the sellers read for these two flights; where no outbound was selected the return flight is neither chosen nor read; when this app's own Camoufox browser read the page on the machine running this app's browser worker, from that machine's address, in the currency the page states. Times are the page's local times. Flight numbers, fare conditions and baggage are not read, no seller is visited; nothing is checked with the airline or the seller.";
// The search's limits (flightLimitsOf's shape): 15 h a leg, at most 1 stop, no windows.
const LIMITS: FlightLimits = {
  maxJourneyMinutes: 900,
  maxStops: 1,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
// A synthetic return read (no recording's): one attempt of outbound 0, one return, its booking read with two offers.
const RETURNS = returnReadSchema.parse({
  limits: LIMITS,
  status: 'read',
  rule: null,
  attempts: [
    {
      outboundIndex: 0,
      outboundFits: true,
      listed: 'returns',
      moreListed: true,
      returns: [
        {
          departsLocal: '19:10',
          arrivesLocal: '07:15',
          arrivesDayOffset: 1,
          durationMinutes: 485,
          stops: 0,
          carriers: ['QQ Atlantic'],
          operatedBy: null,
          fromMinor: 61_200,
        },
      ],
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsStated: null,
    },
  ],
  triedAll: false,
  booking: {
    status: 'read',
    rule: null,
    attempt: 0,
    returnIndex: 0,
    expanded: true,
    moreControl: false,
    grouped: 0,
    offers: [
      { seller: 'QQ Travel', fare: null, priceMinor: 61_200 },
      { seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 63_000 },
    ],
    unparsed: 0,
    nonGbp: 0,
    offersStated: null,
  },
});
const NEXT_LOAD = '2026-10-14T15:00:30.000Z';

function setup() {
  const { kit, budget, log, clock, events } = makeKit({
    limits: testLimits({ camoufox: { workerPort: 8090 }, 'camoufox-status': { workerPort: 8090 } }),
  });
  // why: the spy hands every call to the real kit, so the ledger, the limiter and the hold still run
  const sent: HttpKitRequest[] = [];
  const http_: HttpKit = {
    request: (r) => {
      sent.push(r);
      return kit.request(r);
    },
    stats: () => kit.stats(),
    holdUntil: (id, at) => kit.holdUntil(id, at),
  };
  const p = camoufoxProvider({
    http: http_,
    log,
    clock,
    key: SENTINELS.camoufox,
    workerUrl: 'http://127.0.0.1:8090',
    pointOfSale: 'GB',
    // why: core's one computation at the defaults (CAMOUFOX_PAGE_TIMEOUT_SECONDS 90, CAMOUFOX_MIN_SPACING_SECONDS 30)
    flightRequestSeconds: {
      booking: flightRequestSeconds(90, 30, true),
      returnsOnly: flightRequestSeconds(90, 30, false),
      outboundOnly: listRequestSeconds(90),
    },
  });
  const lists = p.flightLists;
  if (lists === undefined) throw new Error('camoufox has no flightLists');
  return { p, lists, budget, events, log, sent };
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
      returns: null,
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
      flightRequestSeconds: FLIGHT_REQUEST_SECONDS,
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
    // why: a well-formed flights answer under a failing status is never read as a list (classifyWorkerAnswer's
    // `flights` label)
    [502, answer(), false, 'parse', 'unexpected-status'],
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
  // why: final review A-I1: the busy worker states its wait on the answer; the retry waits that long (the header is
  // the same figure from the worker, but the answer's own is enough), so it never spends its attempts while it is busy
  it('429 spacing with the wait only on the answer: the retry waits the stated 200 s, then the page', async () => {
    useFakeTime();
    const { lists, budget } = setup();
    const at: number[] = [];
    const answers = [
      HttpResponse.json(
        { kind: 'spacing', retryAfterSeconds: 200 },
        { status: 429, headers: { 'x-gmt-google-contacted': '0' } },
      ),
      HttpResponse.json(answer(), contacted(true)),
    ];
    server.use(
      http.post(URL_, () => {
        at.push(Date.now());
        return answers.shift() ?? HttpResponse.error();
      }),
    );
    expect(await drive(lists.read(Q, ctx), { stepMs: 1000 })).toMatchObject({
      kind: 'list',
      listed: 'flights',
    });
    expect(budget.rowsOf('camoufox').map((r) => r.pageClass)).toEqual(['no-page', 'page']);
    expect((at[1] ?? 0) - (at[0] ?? 0)).toBeGreaterThanOrEqual(200_000);
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
  it('the sentinel key never appears in the answer, the error, the posted body or the log', async () => {
    const ok = setup();
    server.use(
      capture(() =>
        HttpResponse.json(
          answer({ returns: RETURNS, pagesLoaded: 2, nextLoadNotBefore: NEXT_LOAD }),
          contacted(true),
        ),
      ),
    );
    const a = await ok.lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx);
    expect(a.kind).toBe('list');
    const bad = setup();
    server.use(http.post(URL_, () => HttpResponse.json({}, { status: 401, ...contacted(false) })));
    const b = await bad.lists.read(Q, ctx);
    const key = SENTINELS.camoufox.reveal();
    expect(JSON.stringify(a)).not.toContain(key);
    expect(bodies).toHaveLength(1);
    expect(JSON.stringify(bodies)).not.toContain(key);
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

describe('camoufox flightLists: the return phase (spec rev 56 §2 "The return phase", §5.1, §5.3)', () => {
  it('posts returnLimits exactly, and booking only with them; null limits omit both keys', async () => {
    const { lists } = setup();
    server.use(capture(() => HttpResponse.json(answer(), contacted(true))));
    await lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx);
    await lists.read({ ...Q, returnLimits: LIMITS, booking: false }, ctx);
    // why: absent is read as false, and the request states it
    await lists.read({ ...Q, returnLimits: LIMITS }, ctx);
    await lists.read({ ...Q, returnLimits: null, booking: true }, ctx);
    const base = { mode: 'flights', ...CELL, gl: 'GB', airportNames: NAMES };
    expect(bodies).toEqual([
      { ...base, returnLimits: LIMITS, booking: true },
      { ...base, returnLimits: LIMITS, booking: false },
      { ...base, returnLimits: LIMITS, booking: false },
      base,
    ]);
    for (const b of bodies) expect(flightsRequestSchema.safeParse(b).success).toBe(true);
  });
  it('a request plans its pages and its own timeout: 780 s with the booking read, 600 s without, 210 s outbound-only', async () => {
    const { lists, sent, events } = setup();
    server.use(capture(() => HttpResponse.json(answer(), contacted(true))));
    await lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx);
    await lists.read({ ...Q, returnLimits: LIMITS, booking: false }, ctx);
    await lists.read(Q, ctx);
    // why: 21.6 review M7, final review A-I1: the outbound-only request's timeout is core's listRequestSeconds (the
    // worker's two page periods plus 30 s; the engine's gate holds it to the same 210 s), never the provider's default,
    // which in grid mode is a whole grid page's
    expect(sent.map((r) => [r.pages, r.requestTimeoutSeconds])).toEqual([
      [2, 780],
      [2, 600],
      [1, 210],
    ]);
    expect(reserves(events).map((r) => r.pages)).toEqual([2, 2, 1]);
  });
  it('maps returns field for field; the page count reaches the ledger only and nextLoadNotBefore only http-kit (A-M3)', async () => {
    const { lists, budget } = setup();
    server.use(
      capture(() =>
        HttpResponse.json(
          answer({ returns: RETURNS, pagesLoaded: 2, nextLoadNotBefore: NEXT_LOAD }),
          contacted(true),
        ),
      ),
    );
    const r = await lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx);
    expect(r).toEqual({
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
      returns: RETURNS,
    });
    expect('nextLoadNotBefore' in r).toBe(false);
    // why: arch-r3-014: pagesLoaded is never on the result; it reaches the ledger row's page_count through pageCountOf
    expect('pagesLoaded' in r).toBe(false);
    expect(budget.rowsOf('camoufox').map((x) => [x.pages, x.pageCount])).toEqual([[2, 2]]);
  });
  it('an answer without the keys maps to returns null', async () => {
    const { lists } = setup();
    server.use(capture(() => HttpResponse.json(answer({ pagesLoaded: 1 }), contacted(true))));
    expect(await lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx)).toMatchObject({
      kind: 'list',
      returns: null,
    });
  });
  it('an attempt whose outboundIndex is past the flights is list-error parse unknown-answer', async () => {
    const { lists } = setup();
    const attempt = RETURNS.attempts[0];
    if (attempt === undefined) throw new Error('fixture');
    const bad = { ...RETURNS, attempts: [{ ...attempt, outboundIndex: 1 }] };
    server.use(
      capture(() =>
        HttpResponse.json(answer({ returns: bad, nextLoadNotBefore: NEXT_LOAD }), contacted(true)),
      ),
    );
    const r = await lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx);
    expect(r).toMatchObject({
      kind: 'list-error',
      error: { kind: 'parse', reason: 'parse', retryable: false },
    });
    if (r.kind === 'list-error') expect(r.error.message).toContain('[unknown-answer]');
  });
  // why: final review A-M2: the protocol states `returns` exactly on an answer to a request carrying returnLimits, with
  // those limits; any other return block is refused before it is stored, never judged under limits the run never sent
  it.each([
    ['a return block on a request sent without returnLimits', null, LIMITS],
    ['a return block whose limits differ from those sent', LIMITS, { ...LIMITS, maxStops: 0 }],
  ] as const)('%s is list-error parse returns-mismatch', async (_name, sentLimits, answered) => {
    const { lists } = setup();
    server.use(
      capture(() =>
        HttpResponse.json(
          answer({ returns: { ...RETURNS, limits: answered }, pagesLoaded: 2, nextLoadNotBefore: NEXT_LOAD }),
          contacted(true),
        ),
      ),
    );
    const r = await lists.read({ ...Q, returnLimits: sentLimits, booking: true }, ctx);
    expect(r).toMatchObject({
      kind: 'list-error',
      error: { kind: 'parse', reason: 'parse', retryable: false },
    });
    if (r.kind === 'list-error') expect(r.error.message).toContain('[returns-mismatch]');
  });
  it('a held next read waits for nextLoadNotBefore before it is sent (R-spacing: no refused round trip)', async () => {
    useFakeTime();
    const { lists, events } = setup();
    // why: under fake time the clock port stays fixed while Date moves; the hold is absolute, 30 s from now
    const at = new Date(Date.now() + 30_000).toISOString();
    server.use(
      capture(() =>
        HttpResponse.json(
          answer({
            fetchedAt: '2026-10-14T15:00:00.000Z',
            returns: RETURNS,
            pagesLoaded: 2,
            nextLoadNotBefore: at,
          }),
          contacted(true),
        ),
      ),
    );
    const t0 = Date.now();
    await drive(lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx));
    await drive(lists.read(Q, ctx));
    const fetches = events.flatMap((e) => (e.type === 'fetch' ? [e.at - t0] : []));
    expect(fetches).toHaveLength(2);
    expect(fetches[1] ?? 0).toBeGreaterThanOrEqual(30_000);
  });
  // why: ruling 21.4 (progress.md): any answer that states nextLoadNotBefore holds the next start, a failed one too;
  // http-kit sets the hold from the body, so a 2xx the capability then refuses holds as well (21.4 review I1)
  const outOfRange = () => {
    const attempt = RETURNS.attempts[0];
    if (attempt === undefined) throw new Error('fixture');
    return { ...RETURNS, attempts: [{ ...attempt, outboundIndex: 1 }] };
  };
  it.each([
    ['a 200 list', 200, () => answer({ returns: RETURNS, pagesLoaded: 2 }), 'list', null],
    [
      'a 200 the contract refuses (outboundIndex past the flights)',
      200,
      () => answer({ returns: outOfRange(), pagesLoaded: 2 }),
      'list-error',
      'parse',
    ],
    [
      'a 504 not-ready',
      504,
      () => ({ kind: 'not-ready', elapsedMs: 90_000, pagesLoaded: 2 }),
      'list-error',
      'parse',
    ],
    [
      'a 423 blocked',
      423,
      () => ({ kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z', pagesLoaded: 2 }),
      'list-error',
      'blocked',
    ],
  ])(
    '%s that states nextLoadNotBefore holds the next read until then',
    async (_n, status, body, kind, errorKind) => {
      useFakeTime();
      const { lists, events } = setup();
      const at = new Date(Date.now() + 30_000).toISOString();
      const answers = [
        HttpResponse.json({ ...body(), nextLoadNotBefore: at }, { status, ...contacted(true) }),
        HttpResponse.json(answer(), contacted(true)),
      ];
      server.use(capture(() => answers.shift() ?? HttpResponse.error()));
      const t0 = Date.now();
      const r = await drive(lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx));
      expect(r.kind).toBe(kind);
      if (r.kind === 'list-error') expect(r.error.kind).toBe(errorKind);
      expect(await drive(lists.read(Q, ctx))).toMatchObject({ kind: 'list' });
      const fetches = events.flatMap((e) => (e.type === 'fetch' ? [e.at - t0] : []));
      expect(fetches).toHaveLength(2);
      expect(fetches[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
      expect(fetches[1] ?? 0).toBeGreaterThanOrEqual(30_000);
      expect(fetches[1] ?? Number.POSITIVE_INFINITY).toBeLessThan(31_000);
    },
  );
  it('an answer that states no nextLoadNotBefore holds nothing: the next read goes at the limiter’s own pace', async () => {
    useFakeTime();
    const { lists, events } = setup();
    server.use(capture(() => HttpResponse.json(answer({ pagesLoaded: 1 }), contacted(true))));
    const t0 = Date.now();
    await drive(lists.read({ ...Q, returnLimits: LIMITS, booking: true }, ctx));
    await drive(lists.read(Q, ctx));
    const fetches = events.flatMap((e) => (e.type === 'fetch' ? [e.at - t0] : []));
    expect(fetches).toHaveLength(2);
    expect(fetches[1] ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
  });
});
