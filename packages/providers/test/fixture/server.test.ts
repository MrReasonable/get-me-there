import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ORIGIN, RELEASE_PATH, SCENARIO_HEADER, SCENARIO_PATH } from '../../src/fixture/constants.js';
import { fixtureRouter } from '../../src/fixture/router.js';
import {
  createFixtureServer,
  type FixtureResponse,
  type FixtureRule,
  releaseRequest,
  scenarioRequest,
} from '../../src/fixture/server.js';
import { calendarPriceMinor, defaultFixtureRoot, loadFixtureTree } from '../../src/fixture/tree.js';
import { fixtureHandlers } from '../../src/testing/handlers.js';
import { arr, jsonOf, obj } from '../support/guards.js';
import { server } from '../support/msw.js';

const ROOT = defaultFixtureRoot();
const GATE = {
  nodeEnv: 'test',
  databasePath: ':memory:',
  allowFixtureProvider: null,
  inContainer: false,
} as const;
const PROD = {
  nodeEnv: 'production',
  databasePath: '/data/get-me-there.db',
  allowFixtureProvider: null,
  inContainer: true,
} as const;
const cal = (q: Record<string, string>) => `${FIXTURE_ORIGIN}/calendar?${new URLSearchParams(q)}`;
const tile = {
  origin: 'LHR',
  destination: 'JFK',
  departFrom: '2026-11-02',
  departTo: '2026-11-08',
  returnFrom: '2026-11-12',
  returnTo: '2026-11-29',
  cabin: 'economy',
  currency: 'GBP',
};
const itinQ = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-11-02',
  returnDate: '2026-11-16',
  cabin: 'economy',
  currency: 'GBP',
  expandTop: '2',
};
const itin = (q: Record<string, string> = {}, path = '/itinerary') =>
  `${FIXTURE_ORIGIN}${path}?${new URLSearchParams({ ...itinQ, ...q })}`;
const get = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { status: res.status, body: obj(await jsonOf(res)) };
};
const withScenario = (respond: FixtureResponse | Record<string, unknown>) => ({
  headers: { [SCENARIO_HEADER]: JSON.stringify(respond) },
});
const scenario = (rules: FixtureRule[]) => fetch(scenarioRequest(rules));
function brokenTree(file: string, content: unknown): string {
  const copy = join(mkdtempSync(join(tmpdir(), 'gmt-t-')), 'fixtures', 'synthetic', 'fixture');
  cpSync(ROOT, copy, { recursive: true });
  writeFileSync(join(copy, file), JSON.stringify(content));
  return copy;
}

describe('fixture tree loader (spec §5.5)', () => {
  it('loads the four worked-example pairs, every file synthetic; LGW-EWR is paged and LGW-JFK chained', () => {
    const t = loadFixtureTree(ROOT);
    expect([...t.calendar.keys()].sort()).toEqual(['LGW-EWR', 'LGW-JFK', 'LHR-EWR', 'LHR-JFK']);
    expect([...t.itinerary.keys()].sort()).toEqual(['LGW-EWR', 'LGW-JFK', 'LHR-EWR', 'LHR-JFK']);
    expect(t.calendar.get('LGW-EWR')?.pageSize).toBe(40);
    expect(t.itinerary.get('LGW-JFK')?.chain).toBe(true);
    expect(t.itinerary.get('LHR-JFK')?.chain).toBe(false);
  });
  it('refuses a tree that is not fixtures/synthetic/fixture', () => {
    expect(() => loadFixtureTree(mkdtempSync(join(tmpdir(), 'gmt-t-')))).toThrow(
      /fixtures\/synthetic\/fixture/,
    );
  });
  const goodCal = {
    synthetic: true,
    currency: 'GBP',
    baseMinor: 1,
    weekdayStepMinor: 1,
    perNightMinor: 1,
    noFaresNights: [],
    noDataNights: [],
  };
  const goodLeg = { flightNumber: '101', depart: '09:30', arrive: '12:40', arriveDayOffset: 0 };
  const goodOpt = {
    seller: 'S',
    carrier: 'ZZ',
    outbound: goodLeg,
    inbound: goodLeg,
    priceDeltaMinor: 0,
    cabinBagIncluded: true,
    checkedBags: 0,
  };
  it.each([
    [
      'a calendar file without synthetic: true',
      'calendar/LHR-JFK.json',
      { ...goodCal, synthetic: undefined },
      /synthetic/,
    ],
    ['a missing currency', 'calendar/LHR-JFK.json', { ...goodCal, currency: undefined }, /currency/],
    ['a non-integer baseMinor', 'calendar/LHR-JFK.json', { ...goodCal, baseMinor: 1.5 }, /baseMinor/],
    [
      'a non-integer night list',
      'calendar/LHR-JFK.json',
      { ...goodCal, noDataNights: ['10'] },
      /noDataNights/,
    ],
    ['a zero pageSize', 'calendar/LHR-JFK.json', { ...goodCal, pageSize: 0 }, /pageSize/],
    ['an empty options list', 'itinerary/LHR-JFK.json', { synthetic: true, options: [] }, /options/],
    [
      'a bad carrier',
      'itinerary/LHR-JFK.json',
      { synthetic: true, options: [{ ...goodOpt, carrier: 'Z!' }] },
      /carrier/,
    ],
    [
      'a bad leg time',
      'itinerary/LHR-JFK.json',
      { synthetic: true, options: [{ ...goodOpt, outbound: { ...goodLeg, depart: '9:30' } }] },
      /depart/,
    ],
    [
      'a non-boolean chain',
      'itinerary/LHR-JFK.json',
      { synthetic: true, chain: 'yes', options: [goodOpt] },
      /chain/,
    ],
  ])('refuses %s (test-010)', (_label, file, content, message) => {
    expect(() => loadFixtureTree(brokenTree(file, content))).toThrow(message);
  });
});

describe('the gate (ruling 7, prov-008)', () => {
  it('createFixtureServer, fixtureRouter and fixtureHandlers throw unless syntheticAllowed(gate)', () => {
    expect(() => createFixtureServer(ROOT, PROD)).toThrow(/syntheticAllowed/);
    expect(() => fixtureRouter(ROOT, PROD)).toThrow(/syntheticAllowed/);
    expect(() => fixtureHandlers(ROOT, PROD)).toThrow(/syntheticAllowed/);
    expect(() => createFixtureServer(ROOT, GATE)).not.toThrow();
  });
});

describe('fixture server via msw (http://fixture.local)', () => {
  beforeEach(() => server.use(...fixtureHandlers(ROOT, GATE)));

  it('answers a calendar tile with the formula price for every in-rectangle cell, on one page', async () => {
    const { status, body } = await get(cal(tile));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      synthetic: true,
      currency: 'GBP',
      origin: 'LHR',
      destination: 'JFK',
      noFares: [],
      page: 1,
      pages: 1,
    });
    expect(body.cacheable).toBeUndefined();
    const prices = arr(body.prices).map(obj);
    expect(prices).toHaveLength(126); // 7 departure days × 18 return days, all 4–27 nights
    // 2026-11-02 is epoch day 20759 (mod 7 = 4): 41200 + 4 × 1500 + 14 × 900
    expect(
      prices.find((p) => p.departureDate === '2026-11-02' && p.returnDate === '2026-11-16')?.amountMinor,
    ).toBe(59_800);
    const file = loadFixtureTree(ROOT).calendar.get('LHR-JFK');
    expect(file && calendarPriceMinor(file, '2026-11-02', 14)).toBe(59_800);
  });

  it('applies noFaresNights and noDataNights from the pair file', async () => {
    expect(arr((await get(cal({ ...tile, origin: 'LGW' }))).body.noFares)).toHaveLength(7);
    const ewr = arr((await get(cal({ ...tile, destination: 'EWR' }))).body.prices).map(obj);
    expect(ewr.filter((p) => p.departureDate === '2026-11-02' && p.returnDate === '2026-11-12')).toEqual([]);
  });

  it('pages a paged pair: 126 entries in 4 pages of up to 40; a page out of range → 400', async () => {
    const q = { ...tile, origin: 'LGW', destination: 'EWR' };
    const first = (await get(cal(q))).body;
    expect([first.page, first.pages, arr(first.prices).length]).toEqual([1, 4, 40]);
    const last = (await get(cal({ ...q, page: '4' }))).body;
    expect(arr(last.prices)).toHaveLength(6);
    expect((await get(cal({ ...q, page: '5' }))).status).toBe(400);
    expect((await get(cal({ ...q, page: 'x' }))).status).toBe(400);
  });

  it('404s an unknown pair and 400s a missing or malformed parameter or an over-large rectangle', async () => {
    expect((await get(cal({ ...tile, destination: 'BBB' }))).status).toBe(404);
    const { departFrom: _d, ...missing } = tile;
    expect((await get(cal(missing))).status).toBe(400);
    expect((await get(cal({ ...tile, departTo: '2026-13-40' }))).status).toBe(400);
    expect((await get(cal({ ...tile, departTo: '2028-11-08' }))).status).toBe(400);
    expect((await get(itin({ returnDate: '2026-11-01' }))).status).toBe(400);
    expect((await get(`${FIXTURE_ORIGIN}/nowhere`)).status).toBe(404);
  });

  it('answers a plain itinerary search with offers built from the templates, priced from the calendar', async () => {
    const { body } = await get(itin());
    expect(body).toMatchObject({
      synthetic: true,
      chain: false,
      currency: 'GBP',
      outboundOptions: 2,
      failedExpansions: 0,
    });
    const offers = arr(body.offers).map(obj);
    expect(offers.map((o) => o.amountMinor)).toEqual([59_800 + 3800, 59_800]);
    expect(offers[0]).toMatchObject({
      seller: 'Synthetic Air',
      taxesIncluded: true,
      outbound: [
        {
          carrier: 'ZZ',
          flightNumber: '101',
          from: 'LHR',
          to: 'JFK',
          depart: '2026-11-02T09:30',
          arrive: '2026-11-02T12:40',
          cabin: 'economy',
        },
      ],
      inbound: [
        {
          carrier: 'ZZ',
          flightNumber: '102',
          from: 'JFK',
          to: 'LHR',
          depart: '2026-11-16T18:30',
          arrive: '2026-11-17T06:40',
          cabin: 'economy',
        },
      ],
      baggage: { cabinBag: 'included', checkedBags: 1 },
      selfTransfer: false,
    });
    expect(arr((await get(itin({ expandTop: '1' }))).body.offers)).toHaveLength(1);
  });

  it('answers the chained pair in three steps: outbounds, then a return offer and an agency offer per outbound', async () => {
    const q = { origin: 'LGW', destination: 'JFK' };
    const step1 = (await get(itin(q))).body;
    expect(step1).toMatchObject({ chain: true, outboundOptions: 2, outbounds: ['o0', 'o1'], offers: [] });
    const ret = arr((await get(itin({ ...q, outbound: 'o0' }, '/itinerary/return'))).body.offers).map(obj);
    const book = arr((await get(itin({ ...q, outbound: 'o0' }, '/itinerary/booking'))).body.offers).map(obj);
    expect(ret[0]).toMatchObject({ seller: 'Synthetic Air' });
    expect(book[0]).toMatchObject({ seller: 'Synthetic Agency' });
    expect(Number(book[0]?.amountMinor)).toBe(Number(ret[0]?.amountMinor) - 300);
    expect((await get(itin({ ...q, outbound: 'o9' }, '/itinerary/return'))).status).toBe(404);
    expect((await get(itin({ outbound: 'o0' }, '/itinerary/return'))).status).toBe(404); // LHR-JFK is not chained
  });

  it('scenario rules answer matching requests `times` times, then normal responses resume; DELETE clears', async () => {
    await scenario([
      {
        match: { path: '/calendar', params: { departFrom: '2026-11-02' } },
        respond: { kind: 'status', status: 503 },
        times: 2,
      },
    ]);
    expect((await get(cal(tile))).status).toBe(503);
    expect((await get(cal({ ...tile, departFrom: '2026-11-03' }))).status).toBe(200);
    expect((await get(cal(tile))).status).toBe(503);
    expect((await get(cal(tile))).status).toBe(200);
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 401 } }]);
    expect((await get(cal(tile))).status).toBe(401);
    await fetch(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, { method: 'DELETE' });
    expect((await get(cal(tile))).status).toBe(200);
  });

  it.each([
    ['an unknown kind', { rules: [{ match: {}, respond: { kind: 'nonsense' } }] }],
    ['an unknown path', { rules: [{ match: { path: '/calender' }, respond: { kind: 'empty' } }] }],
    ['a status outside 200–599', { rules: [{ match: {}, respond: { kind: 'status', status: 700 } }] }],
    [
      'a disallowed response header',
      { rules: [{ match: {}, respond: { kind: 'status', status: 429, headers: { 'set-cookie': 'x' } } }] },
    ],
    ['a non-string param', { rules: [{ match: { params: { page: 2 } }, respond: { kind: 'empty' } }] }],
    ['times 0', { rules: [{ match: {}, respond: { kind: 'empty' }, times: 0 }] }],
    ['no rules array', { rule: [] }],
  ])('refuses a scenario with %s → 400 (po-004, sec-012)', async (_label, body) => {
    const res = await fetch(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('refuses a malformed or invalid x-fixture-scenario header and a GET on the control path', async () => {
    expect((await fetch(cal(tile), { headers: { [SCENARIO_HEADER]: '{not json' } })).status).toBe(400);
    expect((await fetch(cal(tile), withScenario({ kind: 'nonsense' }))).status).toBe(400);
    expect((await fetch(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`)).status).toBe(405);
  });

  it('serves every FixtureResponse kind', async () => {
    const r429 = await fetch(
      cal(tile),
      withScenario({ kind: 'status', status: 429, headers: { 'retry-after': '7200' } }),
    );
    expect([r429.status, r429.headers.get('retry-after')]).toEqual([429, '7200']);
    expect(await (await fetch(cal(tile), withScenario({ kind: 'malformed' }))).text()).toBe(
      '{"synthetic": true, "prices": [',
    );
    await expect(fetch(cal(tile), withScenario({ kind: 'network' }))).rejects.toThrow();
    const ac = new AbortController();
    const hung = fetch(cal(tile), { ...withScenario({ kind: 'hang' }), signal: ac.signal });
    ac.abort();
    await expect(hung).rejects.toThrow();
    expect((await get(cal(tile), withScenario({ kind: 'empty' }))).body).toMatchObject({
      prices: [],
      noFares: [],
    });
    expect(arr((await get(cal(tile), withScenario({ kind: 'no-fares' }))).body.noFares)).toHaveLength(126);
    expect((await get(cal(tile), withScenario({ kind: 'no-currency' }))).body.currency).toBeUndefined();
    expect((await get(cal(tile), withScenario({ kind: 'variant', currency: 'USD' }))).body.currency).toBe(
      'USD',
    );
    expect((await get(cal(tile), withScenario({ kind: 'cacheable' }))).body.cacheable).toBe(true);
    expect((await get(itin(), withScenario({ kind: 'empty' }))).body).toMatchObject({
      outboundOptions: 0,
      offers: [],
    });
    expect((await get(itin(), withScenario({ kind: 'no-return-legs' }))).body).toMatchObject({
      outboundOptions: 2,
      offers: [],
    });
    expect((await get(itin(), withScenario({ kind: 'partial', failedExpansions: 1 }))).body).toMatchObject({
      outboundOptions: 2,
      failedExpansions: 1,
    });
    const v = arr(
      (await get(itin(), withScenario({ kind: 'variant', carrier: 'Z!', connectVia: 'QQQ' }))).body.offers,
    ).map(obj);
    expect(
      arr(v[0]?.outbound)
        .map(obj)
        .map((s) => [s.carrier, s.from, s.to]),
    ).toEqual([
      ['Z!', 'LHR', 'QQQ'],
      ['Z!', 'QQQ', 'JFK'],
    ]);
    expect(
      arr(v[1]?.outbound)
        .map(obj)
        .map((s) => s.carrier),
    ).toEqual(['ZX']);
  });

  it('holds requests under an id until released, then answers them with the given or the normal response (po-005)', async () => {
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'hold', id: 'h1' }, times: 2 }]);
    let settled = 0;
    const a = fetch(cal(tile)).then((r) => {
      settled += 1;
      return r.status;
    });
    const b = fetch(cal({ ...tile, departFrom: '2026-11-03' })).then((r) => {
      settled += 1;
      return r.status;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(0);
    const ack = obj(await jsonOf(await fetch(releaseRequest('h1', { kind: 'status', status: 503 }))));
    expect(ack).toEqual({ synthetic: true, released: 2 });
    expect(await Promise.all([a, b])).toEqual([503, 503]);
    expect(obj(await jsonOf(await fetch(releaseRequest('nobody'))))).toEqual({
      synthetic: true,
      released: 0,
    });
    expect((await fetch(`${FIXTURE_ORIGIN}${RELEASE_PATH}`, { method: 'POST', body: '{}' })).status).toBe(
      400,
    );
  });
});

describe('fixtureRouter (Hono) serves the same tree', () => {
  beforeEach(() => server.use(...fixtureHandlers(ROOT, GATE)));

  it('returns byte-identical calendar and itinerary bodies to the msw handlers', async () => {
    const router = fixtureRouter(ROOT, GATE);
    for (const url of [cal(tile), itin()]) {
      expect(await (await router.request(url)).text()).toBe(await (await fetch(url)).text());
    }
  });
  it('honours scenario rules on its own state, sent with scenarioRequest', async () => {
    const router = fixtureRouter(ROOT, GATE);
    const ack = await router.fetch(
      scenarioRequest([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 402 } }]),
    );
    expect(obj(await jsonOf(ack))).toEqual({ synthetic: true, rules: 1 });
    expect((await router.request(cal(tile))).status).toBe(402);
    expect((await router.request(`${FIXTURE_ORIGIN}/health`)).status).toBe(200);
  });
});
