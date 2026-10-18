import dns from 'node:dns';
import { createServer, type Server } from 'node:http';
import { asIata, asIsoDate, BudgetExceeded, Secret } from '@gmt/core';
import { passthrough } from 'msw';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { camoufoxProvider, planSingleCells } from '../../src/camoufox/index.js';
import { makeKit, SENTINELS, testLimits } from '../fakes.js';
import { respondAfter, server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const URL_ = 'http://127.0.0.1:8090/v1/page';
const Q = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2027-03-11'),
  departureTo: asIsoDate('2027-03-11'),
  minNights: 10,
  maxNights: 10,
  cabin: 'economy' as const,
  currency: 'GBP' as const,
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
};
const ctx = { executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: false };
const contacted = (yes: boolean) => ({ headers: { 'x-gmt-google-contacted': yes ? '1' : '0' } });
const versions = { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' };
const price = (
  o: Partial<{
    amountMinor: number;
    tabMinor: number | null;
    optionsUnparsed: number;
    optionsOtherCell: number;
  }> = {},
) => ({
  kind: 'cells',
  fetchedAt: '2026-10-14T15:00:00.000Z',
  currency: 'GBP',
  pointOfSale: 'GB',
  notes: [],
  versions,
  cell: {
    status: 'price',
    amountMinor: 45100,
    tabMinor: 45100,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    returnDateFrom: 'query-and-form',
    ...o,
  },
});
// The spec §2 provenance note, copied here so a change to either is a visible diff.
const SPEC_PROVENANCE_NOTE =
  "Google Flights prices via Camoufox: the cheapest round-trip price Google Flights listed for this day pair when this app's own Camoufox browser read the page on the operator's machine, from the operator's IP address, in the currency the page states. Return date: the date asked for, which the page's search form showed; the listed options state only the departure. The operator turned this provider on. Constraints are not checked; no return leg, seller or baggage is read.";

function setup(port = 8090) {
  const { kit, budget, log, clock, events } = makeKit({
    limits: testLimits({ camoufox: { workerPort: port }, 'camoufox-status': { workerPort: port } }),
  });
  const p = camoufoxProvider({
    http: kit,
    log,
    clock,
    key: SENTINELS.camoufox,
    workerUrl: `http://127.0.0.1:${port}`,
    pointOfSale: 'GB',
  });
  const tile = planSingleCells(Q)[0];
  if (tile === undefined) throw new Error('no tile');
  return { p, budget, events, tile };
}
const classes = (b: ReturnType<typeof setup>['budget']) => b.rowsOf('camoufox').map((x) => x.pageClass);

let real: Server | null = null;
let restoreLookup: (() => void) | null = null;
/**
 * The loopback literal only, for the passthrough tests. why: the network guards refuse every DNS lookup and msw's
 * passthrough socket looks up even an IP literal; real names stay refused.
 */
function allowLoopbackLookup(): void {
  const refused = dns.lookup;
  const lookup = (hostname: string, ...rest: unknown[]): void => {
    const cb = rest.find((x) => typeof x === 'function');
    const opts = rest[0];
    const all = typeof opts === 'object' && opts !== null && 'all' in opts && opts.all === true;
    if (hostname !== '127.0.0.1' || typeof cb !== 'function') {
      Reflect.apply(refused, dns, [hostname, ...rest]);
      return;
    }
    process.nextTick(() =>
      all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4),
    );
  };
  Object.defineProperty(dns, 'lookup', { value: lookup, writable: true, configurable: true });
  restoreLookup = () =>
    Object.defineProperty(dns, 'lookup', { value: refused, writable: true, configurable: true });
}
afterEach(async () => {
  restoreLookup?.();
  restoreLookup = null;
  server.resetHandlers();
  vi.useRealTimers();
  const s = real;
  real = null;
  if (s !== null) await new Promise((r) => s.close(r));
});
beforeEach(() => {
  expect.hasAssertions();
});

/** A real socket behind msw's passthrough(): `destroy` accepts then drops the connection; `closed` is a port bound then freed. */
async function setupWithRealSocket(mode: 'destroy' | 'closed') {
  allowLoopbackLookup();
  const s = createServer((req) => {
    req.socket.destroy();
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const a = s.address();
  if (a === null || typeof a === 'string') throw new Error('not listening on TCP');
  const { port } = a;
  if (mode === 'closed') await new Promise((r) => s.close(r));
  else real = s;
  server.use(http.post(`http://127.0.0.1:${port}/v1/page`, () => passthrough()));
  return { ...setup(port) };
}

describe('camoufox fetchTile (spec §2, §5.2)', () => {
  it('a price: one RawCalendarPrice, the return-date label stored on the cell, one page row', async () => {
    const { p, budget, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json(price(), contacted(true))));
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect(r.prices).toEqual([{ ...tile.coveredCells[0], amountMinor: 45100, currency: 'GBP' }]);
    expect(r.cellIssues).toEqual([
      {
        cell: tile.coveredCells[0],
        reason: 'parse',
        offersDropped: 0,
        detail: 'return date: the date asked for',
      },
    ]);
    expect(r.pointOfSale).toBe('GB');
    expect(classes(budget)).toEqual(['page']);
  });
  // why: ruling of 2026-10-18 (the honesty rule): a Cheapest tab below every price read is named, and the cell partial
  it('a Cheapest tab price below every option read: partial, the note naming the tab price', async () => {
    const { p, tile } = setup();
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(price({ amountMinor: 46200, tabMinor: 44300 }), contacted(true)),
      ),
    );
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect(r.prices[0]?.amountMinor).toBe(46200);
    expect(r.cellIssues).toEqual([
      {
        cell: tile.coveredCells[0],
        reason: 'parse',
        offersDropped: 1,
        detail:
          'return date: the date asked for; Google shows a lower fare under Cheapest that could not be read (£443)',
      },
    ]);
  });
  it('unparsed options and a cheaper tab mark the cell partial (offers-dropped), never only a note', async () => {
    const { p, tile } = setup();
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(
          price({ tabMinor: 39900, optionsUnparsed: 2, optionsOtherCell: 1 }),
          contacted(true),
        ),
      ),
    );
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect(r.cellIssues).toEqual([
      {
        cell: tile.coveredCells[0],
        reason: 'parse',
        offersDropped: 3,
        detail:
          'return date: the date asked for; options unread: 2; Google shows a lower fare under Cheapest that could not be read (£399); options for another cell: 1',
      },
    ]);
  });
  it('no flights: neither a price nor noFares (written no_data)', async () => {
    const { p, tile } = setup();
    server.use(
      http.post(URL_, () =>
        HttpResponse.json({ ...price(), cell: { status: 'no-flights' } }, contacted(true)),
      ),
    );
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect([r.prices, r.noFares, r.cellIssues ?? []]).toEqual([[], [], []]);
  });
  it.each([
    [
      423,
      { kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' },
      true,
      'blocked',
      'page',
    ],
    [
      423,
      { kind: 'cooling-down', cause: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' },
      false,
      'blocked',
      'no-page',
    ],
    [409, { kind: 'mode-unavailable', mode: 'grid' }, false, 'parse', 'no-page'],
    [504, { kind: 'not-ready', elapsedMs: 90_000 }, true, 'parse', 'page'],
    [502, { kind: 'browser-error', stage: 'launch', detail: 'x' }, false, 'upstream', 'no-page'],
    [401, {}, false, 'auth', 'no-page'],
    [400, { kind: 'bad-request' }, false, 'parse', 'no-page'],
    [500, { what: 'unreadable' }, true, 'parse', 'page'],
  ])(
    'HTTP %i %j → tile-error %s, called once, row class %s',
    async (status, body, isContacted, kind, cls) => {
      const { p, budget, tile } = setup();
      let hits = 0;
      server.use(
        http.post(URL_, () => {
          hits++;
          return HttpResponse.json(body, { status, ...contacted(isContacted) });
        }),
      );
      expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({
        kind: 'tile-error',
        error: { kind, retryable: false },
      });
      expect(hits).toBe(1);
      expect(classes(budget)).toEqual([cls]);
    },
  );
  it('a blocked answer words the page kind and the cool-down end for last_error', async () => {
    const { p, tile } = setup();
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(
          { kind: 'blocked', page: 'unrecognised', cooldownUntil: '2026-10-14T16:00:00.000Z' },
          { status: 423, ...contacted(true) },
        ),
      ),
    );
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    expect(r?.kind === 'tile-error' ? r.error.message : '').toBe(
      "camoufox /v1/page: Google's page was not one this app reads (it may have changed); cooling down until 2026-10-14T16:00:00.000Z [blocked:unrecognised]",
    );
  });
  // why: fix round 1 (arch I1): the end travels as data, so the engine's once-per-cool-down key never parses wording
  it('a blocked or cooling-down answer carries its cool-down end on the error', async () => {
    for (const body of [
      { kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-16T15:00:00.000Z' },
      { kind: 'cooling-down', cause: 'captcha', cooldownUntil: '2026-10-16T15:00:00.000Z' },
    ]) {
      const { p, tile } = setup();
      server.use(http.post(URL_, () => HttpResponse.json(body, { status: 423, ...contacted(false) })));
      const r = await p.discovery?.fetchTile(tile, Q, ctx);
      expect(r?.kind === 'tile-error' ? r.error.cooldownUntil : null, body.kind).toBe(
        '2026-10-16T15:00:00.000Z',
      );
    }
  });
  // why: fix round 1 (prov I1): every option was for another cell: read, but no price for this one; a cell issue, no block
  it('none for this cell: no price, a parse issue naming the other-cell and unread counts', async () => {
    const { p, tile } = setup();
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(
          { ...price(), cell: { status: 'none-for-cell', optionsOtherCell: 4, optionsUnparsed: 1 } },
          contacted(true),
        ),
      ),
    );
    const r = await p.discovery?.fetchTile(tile, Q, ctx);
    if (r?.kind !== 'tile') throw new Error('tile');
    expect([r.prices, r.noFares]).toEqual([[], []]);
    expect(r.cellIssues).toEqual([
      {
        cell: tile.coveredCells[0],
        reason: 'parse',
        offersDropped: 1,
        detail: 'no option for this cell; options for another cell: 4; options unread: 1',
      },
    ]);
  });
  // why: fix round 1 (prov I2, prov-004): the point of sale is the page's own, never the one asked for
  it.each(['unknown', 'US'])(
    'the point of sale is the answer’s (%s), not POINT_OF_SALE (GB)',
    async (pos) => {
      const { p, tile } = setup();
      server.use(http.post(URL_, () => HttpResponse.json({ ...price(), pointOfSale: pos }, contacted(true))));
      const r = await p.discovery?.fetchTile(tile, Q, ctx);
      expect(r?.kind === 'tile' ? r.pointOfSale : null).toBe(pos);
    },
  );
  // why: fix round 1 (arch M12): the adapter's own key bound, at its edge
  it('the adapter refuses a 31-character key and accepts 32', () => {
    const { kit, log, clock } = makeKit();
    const make = (k: string) => () =>
      camoufoxProvider({
        http: kit,
        log,
        clock,
        key: new Secret(k),
        workerUrl: 'http://127.0.0.1:8090',
        pointOfSale: 'GB',
      });
    expect(make('k'.repeat(31))).toThrow(/at least 32/);
    expect(make('k'.repeat(32))).not.toThrow();
  });
  it('a missing contacted header reads as a page (the conservative reading)', async () => {
    const { p, budget, tile } = setup();
    server.use(
      http.post(URL_, () => HttpResponse.json({ kind: 'not-ready', elapsedMs: 1 }, { status: 504 })),
    );
    await p.discovery?.fetchTile(tile, Q, ctx);
    expect(classes(budget)).toEqual(['page']);
  });
  it('a timeout past the request timeout is one attempt, one page row, no second POST', async () => {
    useFakeTime();
    const { p, budget, tile } = setup();
    let hits = 0;
    server.use(
      http.post(URL_, ({ request }) => {
        hits++;
        return respondAfter(request, 120_000, () => HttpResponse.json(price(), contacted(true)));
      }),
    );
    const r = await drive(p.discovery?.fetchTile(tile, Q, ctx) ?? Promise.reject(new Error('no discovery')), {
      stepMs: 1000,
    });
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'network', retryable: false } });
    expect(hits).toBe(1);
    expect(classes(budget)).toEqual(['page']);
  });
  // why: fix round 1 (CodeRabbit): real loopback sockets get an explicit short timeout
  it('a dropped socket (a real server that destroys the connection) is one attempt, never retried, a page row', {
    timeout: 10_000,
  }, async () => {
    const { p, budget, tile } = await setupWithRealSocket('destroy');
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'network', retryable: false },
    });
    expect(classes(budget)).toEqual(['page']);
  });
  it('a refused connection (a real closed port) is provider-unavailable, one no-page row', {
    timeout: 10_000,
  }, async () => {
    const { p, budget, tile } = await setupWithRealSocket('closed');
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'provider-unavailable', retryable: false },
    });
    expect(classes(budget)).toEqual(['no-page']);
  });
  it('429 spacing honours Retry-After, then the page: two rows, one page', async () => {
    useFakeTime();
    const { p, budget, tile } = setup();
    const answers = [
      HttpResponse.json(
        { kind: 'spacing', retryAfterSeconds: 1 },
        { status: 429, headers: { 'retry-after': '1', 'x-gmt-google-contacted': '0' } },
      ),
      HttpResponse.json(price(), contacted(true)),
    ];
    server.use(http.post(URL_, () => answers.shift() ?? HttpResponse.error()));
    expect(
      await drive(p.discovery?.fetchTile(tile, Q, ctx) ?? Promise.reject(new Error('no discovery'))),
    ).toMatchObject({ kind: 'tile' });
    expect(classes(budget)).toEqual(['no-page', 'page']);
  });
  it('an unknown answer kind (consent-rejected) is a parse error', async () => {
    const { p, tile } = setup();
    server.use(
      http.post(URL_, () =>
        HttpResponse.json(
          { kind: 'consent-rejected', fetchedAt: '2026-10-14T15:00:00.000Z' },
          contacted(true),
        ),
      ),
    );
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'parse' },
    });
  });
  // why: fix round 1 (CodeRabbit): the container's clock may trail or lead the host's by a little; 5 s either way
  it.each([
    ['6 s after the adapter clock', '2026-10-14T15:00:06.000Z'],
    ['6 s before the request', '2026-10-14T14:59:54.000Z'],
    ['a minute before the request', '2026-10-14T14:59:00.000Z'],
  ])('a fetchedAt %s is refused as parse', async (_n, at) => {
    const { p, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json({ ...price(), fetchedAt: at }, contacted(true))));
    expect(await p.discovery?.fetchTile(tile, Q, ctx)).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'parse' },
    });
  });
  it.each([
    ['5 s after the adapter clock', '2026-10-14T15:00:05.000Z'],
    ['5 s before the request', '2026-10-14T14:59:55.000Z'],
  ])('a fetchedAt %s (clock skew within 5 s) is read', async (_n, at) => {
    const { p, tile } = setup();
    server.use(http.post(URL_, () => HttpResponse.json({ ...price(), fetchedAt: at }, contacted(true))));
    expect((await p.discovery?.fetchTile(tile, Q, ctx))?.kind).toBe('tile');
  });
  it('the key travels in x-gmt-worker-key, never in the URL; the body is one valid page request', async () => {
    const { p, events, tile } = setup();
    let body: unknown;
    server.use(
      http.post(URL_, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(price(), contacted(true));
      }),
    );
    await p.discovery?.fetchTile(tile, Q, ctx);
    const f = events.find((e) => e.type === 'fetch');
    expect(f !== undefined && 'headers' in f ? f.headers['x-gmt-worker-key'] : undefined).toBe(
      SENTINELS.camoufox.reveal(),
    );
    expect(f !== undefined && 'url' in f ? f.url : '').not.toContain(SENTINELS.camoufox.reveal());
    expect(body).toEqual({
      mode: 'list',
      origin: 'LHR',
      destination: 'JFK',
      departureDate: '2027-03-11',
      returnDate: '2027-03-21',
      gl: 'GB',
      airportNames: Q.airportNames,
    });
  });
  it('a query without airport names, or a tile of more than one cell, sends nothing', async () => {
    const { p, budget, tile } = setup();
    const { airportNames: _a, ...noNames } = Q;
    expect(await p.discovery?.fetchTile(tile, noNames, ctx)).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'parse' },
    });
    expect(await p.discovery?.fetchTile({ ...tile, coveredCells: [] }, Q, ctx)).toMatchObject({
      kind: 'tile-error',
    });
    expect(
      await p.discovery?.fetchTile(tile, { ...Q, airportNames: { origin: [''], destination: [] } }, ctx),
    ).toMatchObject({ kind: 'tile-error' });
    // why: fix round 1 (prov M2, CodeRabbit): two empty lists are no names at all
    expect(
      await p.discovery?.fetchTile(tile, { ...Q, airportNames: { origin: [], destination: [] } }, ctx),
    ).toMatchObject({ kind: 'tile-error', error: { kind: 'parse' } });
    expect(budget.rowsOf('camoufox')).toEqual([]);
  });
  it('a budget refusal propagates to the engine', async () => {
    const { p, budget, tile } = setup();
    budget.refuse = () =>
      new BudgetExceeded({
        scope: 'provider-execution',
        cap: 1,
        current: 1,
        requested: 1,
        providerId: 'camoufox',
      });
    await expect(p.discovery?.fetchTile(tile, Q, ctx)).rejects.toBeInstanceOf(BudgetExceeded);
  });
  it('declares discovery only, scraped-self, maxAgeHours 0, economy only, and the spec §2 provenance note verbatim', async () => {
    const { p } = setup();
    expect(p.verification).toBeUndefined();
    expect(p.cabins).toEqual(['economy']);
    expect(p.displayName).toBe('Google Flights via Camoufox');
    expect(p.discovery?.info).toEqual({
      sourceKind: 'scraped-self',
      maxAgeHours: 0,
      provenanceNote: SPEC_PROVENANCE_NOTE,
    });
    expect(await p.healthcheck(ctx)).toMatchObject({ ok: true });
  });
  it('refuses a short key at construction', () => {
    const { kit, log, clock } = makeKit();
    expect(() =>
      camoufoxProvider({
        http: kit,
        log,
        clock,
        key: new Secret('short-worker-key'),
        workerUrl: 'http://127.0.0.1:8090',
        pointOfSale: 'GB',
      }),
    ).toThrow(/32 characters/);
  });
});
