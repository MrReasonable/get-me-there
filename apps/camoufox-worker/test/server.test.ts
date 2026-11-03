import type { Server } from 'node:http';
import {
  asIsoDateTime,
  type FlightsRequest,
  type PageRequest,
  Secret,
  type WorkerAnswer,
  type WorkerStatus,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkerServer, MAX_BODY_BYTES, portOf } from '../src/server.js';
import type { PageResult } from '../src/session.js';
import { memoryLog } from './support/log.js';

const KEY = 'synthetic-worker-key-0123456789abcdef';
const AT = asIsoDateTime('2026-10-18T05:00:00.000Z');
const BODY = {
  mode: 'list',
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-11-05',
  returnDate: '2026-11-15',
  gl: 'GB',
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
};
const versions = { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' };
const STATUS: WorkerStatus = {
  ok: true,
  coolingDownUntil: null,
  cooldownCause: null,
  signedInRefusal: false,
  lastPageAt: null,
  busySince: null,
  versions,
  flags: { RESULTS_VERIFIED: true },
  accountCookie: { found: false, names: [], checkedAt: AT },
  socsCapturedAt: AT,
  socsStable: false,
  cooldownHours: 48,
  pageTimeoutSeconds: 90,
};

let server: Server | null = null;
afterEach(async () => {
  const s = server;
  server = null;
  if (s !== null) await new Promise((r) => s.close(r));
});
beforeEach(() => {
  expect.hasAssertions();
});

async function start(
  result: PageResult | ((req: PageRequest | FlightsRequest) => Promise<PageResult>),
  status: WorkerStatus = STATUS,
) {
  const log = memoryLog();
  const seen: Array<PageRequest | FlightsRequest> = [];
  const awakeAsked: number[] = [];
  let fatal = 0;
  const s = createWorkerServer({
    key: new Secret(KEY),
    log,
    now: () => 0,
    page: async (req) => {
      seen.push(req);
      return typeof result === 'function' ? result(req) : result;
    },
    status: async () => status,
    awake: (seconds) => {
      awakeAsked.push(seconds);
      return seconds === 0
        ? { held: false, until: null, mechanism: 'caffeinate' }
        : { held: true, until: AT, mechanism: 'caffeinate' };
    },
    onFatal: () => {
      fatal += 1;
    },
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  server = s;
  const base = `http://127.0.0.1:${portOf(s)}`;
  const post = (body: unknown, o: { key?: string | null; type?: string; raw?: string; path?: string } = {}) =>
    fetch(`${base}${o.path ?? '/v1/page'}`, {
      method: 'POST',
      headers: {
        'content-type': o.type ?? 'application/json',
        ...(o.key === null ? {} : { 'x-gmt-worker-key': o.key ?? KEY }),
      },
      body: o.raw ?? JSON.stringify(body),
    });
  return { base, post, log, seen, awakeAsked, fatalCount: () => fatal };
}
const cells: WorkerAnswer = {
  kind: 'cells',
  fetchedAt: AT,
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
  },
};

describe('the worker server (brief §6 table, one it per row)', () => {
  it('200 cells with its body, Google contacted', async () => {
    const t = await start({ answer: cells, googleContacted: true });
    const r = await t.post(BODY);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-gmt-google-contacted')).toBe('1');
    expect(await r.json()).toEqual(cells);
    expect(t.seen[0]?.origin).toBe('LHR');
  });
  it('423 blocked, contacted', async () => {
    const t = await start({
      answer: { kind: 'blocked', page: 'captcha', cooldownUntil: AT },
      googleContacted: true,
    });
    const r = await t.post(BODY);
    expect([r.status, r.headers.get('x-gmt-google-contacted')]).toEqual([423, '1']);
  });
  it('423 cooling-down, not contacted', async () => {
    const t = await start({
      answer: { kind: 'cooling-down', cause: 'signed-in', cooldownUntil: AT },
      googleContacted: false,
    });
    const r = await t.post(BODY);
    expect([r.status, r.headers.get('x-gmt-google-contacted')]).toEqual([423, '0']);
  });
  it('429 spacing with Retry-After, not contacted', async () => {
    const t = await start({ answer: { kind: 'spacing', retryAfterSeconds: 12 }, googleContacted: false });
    const r = await t.post(BODY);
    expect([r.status, r.headers.get('retry-after'), r.headers.get('x-gmt-google-contacted')]).toEqual([
      429,
      '12',
      '0',
    ]);
  });
  it('504 not-ready, contacted', async () => {
    const t = await start({ answer: { kind: 'not-ready', elapsedMs: 90_000 }, googleContacted: true });
    expect((await t.post(BODY)).status).toBe(504);
  });
  it('502 browser-error; contacted except at launch', async () => {
    const t = await start({
      answer: { kind: 'browser-error', stage: 'launch', detail: 'x' },
      googleContacted: false,
    });
    const r = await t.post(BODY);
    expect([r.status, r.headers.get('x-gmt-google-contacted')]).toEqual([502, '0']);
  });
  it('409 for grid', async () => {
    const t = await start({ answer: { kind: 'mode-unavailable', mode: 'grid' }, googleContacted: false });
    const grid = {
      mode: 'grid',
      origin: 'LHR',
      destination: 'JFK',
      gl: 'GB',
      start: { departureDate: '2026-11-05', returnDate: '2026-11-15' },
      moves: ['down'],
      reads: [true, true],
      scrollAllowance: 1,
    };
    expect((await t.post(grid)).status).toBe(409);
    // why: spec §2 rev 34: a grid request past the worker's scroll cap is refused, 400
    const capped = await start({
      answer: { kind: 'mode-unavailable', mode: 'grid' },
      googleContacted: false,
      rejected: true,
    });
    expect((await capped.post(grid)).status).toBe(400);
  });
  it.each([
    ['an oversize body', { raw: JSON.stringify({ ...BODY, pad: 'x'.repeat(MAX_BODY_BYTES) }) }],
    ['a wrong content type', { type: 'text/plain' }],
    ['a schema failure (an invalid IATA code)', { raw: JSON.stringify({ ...BODY, origin: 'L1' }) }],
    ['not JSON', { raw: '{not json' }],
  ])('400 for %s, nothing paged', async (_n, o) => {
    const t = await start({ answer: cells, googleContacted: true });
    const r = await t.post(BODY, o);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ kind: 'bad-request' });
    expect(r.headers.get('x-gmt-google-contacted')).toBe('0');
    expect(t.seen).toEqual([]);
  });
  it.each([
    ['no header', null],
    ['a wrong key', 'synthetic-worker-key-0123456789abcdeX'],
    ['a key of another length', 'short'],
  ])('401 with %s, no body', async (_n, key) => {
    const t = await start({ answer: cells, googleContacted: true });
    const r = await t.post(BODY, { key });
    expect(r.status).toBe(401);
    expect(await r.text()).toBe('');
    expect(t.seen).toEqual([]);
  });
  it('401 on /v1/status without the key; 200 with it, the live body', async () => {
    const found: WorkerStatus = {
      ...STATUS,
      ok: false,
      accountCookie: { found: true, names: ['SID'], checkedAt: AT },
    };
    const t = await start({ answer: cells, googleContacted: true }, found);
    expect((await fetch(`${t.base}/v1/status`)).status).toBe(401);
    const r = await fetch(`${t.base}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-gmt-google-contacted')).toBe('0');
    expect(await r.json()).toMatchObject({ accountCookie: { found: true, names: ['SID'] } });
  });
  it('404 for anything else', async () => {
    const t = await start({ answer: cells, googleContacted: true });
    for (const [method, path] of [
      ['GET', '/v1/page'],
      ['POST', '/v1/status'],
      ['GET', '/'],
    ] as const)
      expect((await fetch(`${t.base}${path}`, { method, headers: { 'x-gmt-worker-key': KEY } })).status).toBe(
        404,
      );
  });
  it('a fatal page result answers, then calls onFatal', async () => {
    const t = await start({
      answer: { kind: 'browser-error', stage: 'read', detail: 'cool-down store unreadable' },
      googleContacted: false,
      fatal: true,
    });
    expect((await t.post(BODY)).status).toBe(502);
    expect(t.fatalCount()).toBe(1);
  });
  it('a page handler that throws answers 500, saying Google may have been contacted (the conservative reading)', async () => {
    const t = await start(async () => {
      throw new Error('boom');
    });
    const r = await t.post(BODY);
    expect(r.status).toBe(500);
    // why: fix round 1 (arch M8): the server cannot know whether goto ran, so the page caps count it
    expect(r.headers.get('x-gmt-google-contacted')).toBe('1');
  });
  it('logs one line per request with route, status and kind, and never the key', async () => {
    const t = await start({ answer: cells, googleContacted: true });
    await t.post(BODY);
    await t.post(BODY, { key: 'wrong' });
    expect(t.log.lines.map((l) => l.o)).toEqual([
      { route: 'POST /v1/page', status: 200, kind: 'cells', durationMs: 0 },
      { route: 'POST /v1/page', status: 401, kind: 'unauthorised', durationMs: 0 },
    ]);
    expect(JSON.stringify(t.log.lines)).not.toContain(KEY);
  });
  it('portOf refuses a server that is not listening on TCP', () => {
    const s = createWorkerServer({
      key: new Secret(KEY),
      log: memoryLog(),
      now: () => 0,
      page: async () => ({ answer: cells, googleContacted: true }),
      status: async () => STATUS,
      awake: () => ({ held: false, until: null, mechanism: 'none' }),
      onFatal: () => undefined,
    });
    expect(() => portOf(s)).toThrow(/not listening/);
  });
});

// Spec revision 55 §2 "The flight-list read" (WP20 Task 20.7): POST /v1/flights admits only a flights request, under
// the same key, body cap and contacted header as /v1/page; the session reads the page.
describe('POST /v1/flights (spec rev 55 §2)', () => {
  const FLIGHTS = { ...BODY, mode: 'flights' };
  // A synthetic flight (no recording's).
  const flights: WorkerAnswer = {
    kind: 'flights',
    fetchedAt: AT,
    currency: 'GBP',
    pointOfSale: 'GB',
    listed: 'flights',
    flights: [
      {
        departsLocal: '09:05',
        arrivesLocal: '12:10',
        arrivesDayOffset: 0,
        durationMinutes: 485,
        stops: 0,
        carriers: ['QQ Air'],
        operatedBy: null,
        amountMinor: 47_800,
      },
    ],
    minMinor: 47_800,
    tabMinor: 45_100,
    cheapestView: null,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: 1,
    notes: [],
    versions,
  };
  it('answers 200 kind flights for a valid body, Google contacted, the request passed as parsed', async () => {
    const t = await start({ answer: flights, googleContacted: true });
    const r = await t.post(FLIGHTS, { path: '/v1/flights' });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-gmt-google-contacted')).toBe('1');
    expect(await r.json()).toEqual(flights);
    expect(t.seen).toEqual([FLIGHTS]);
    expect(t.log.lines.map((l) => l.o)).toEqual([
      { route: 'POST /v1/flights', status: 200, kind: 'flights', durationMs: 0 },
    ]);
  });
  it('states the contacted header exactly as /v1/page does, each answer', async () => {
    for (const result of [
      { answer: { kind: 'cooling-down', cause: 'captcha', cooldownUntil: AT }, googleContacted: false },
      {
        answer: { kind: 'blocked', page: 'unrecognised', cooldownUntil: AT, rule: 'currency' },
        googleContacted: true,
      },
      { answer: { kind: 'spacing', retryAfterSeconds: 9 }, googleContacted: false },
    ] satisfies PageResult[]) {
      const t = await start(result);
      const a = await t.post(FLIGHTS, { path: '/v1/flights' });
      const b = await t.post(BODY);
      expect([a.status, a.headers.get('x-gmt-google-contacted'), a.headers.get('retry-after')]).toEqual([
        b.status,
        b.headers.get('x-gmt-google-contacted'),
        b.headers.get('retry-after'),
      ]);
      expect(a.headers.get('x-gmt-google-contacted')).toBe(result.googleContacted ? '1' : '0');
      await new Promise((r) => server?.close(r));
      server = null;
    }
  });
  it.each([
    ['a list body', { raw: JSON.stringify(BODY) }],
    ['a grid body', { raw: JSON.stringify({ ...BODY, mode: 'grid' }) }],
    ['a wrong content type', { type: 'text/plain' }],
    ['not JSON', { raw: '{not json' }],
  ])('400 for %s, nothing paged', async (_n, o) => {
    const t = await start({ answer: flights, googleContacted: true });
    const r = await t.post(FLIGHTS, { ...o, path: '/v1/flights' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ kind: 'bad-request' });
    expect(r.headers.get('x-gmt-google-contacted')).toBe('0');
    expect(t.seen).toEqual([]);
  });
  // why: 20.7 review finding 6: a body the schema accepts, padded with JSON whitespace, isolates the byte cap: one byte
  // over is refused before parsing, and the same body at the cap is read
  it('refuses a valid body one byte over the 4,096-byte cap, and reads it at the cap', async () => {
    const text = JSON.stringify(FLIGHTS);
    const padded = (size: number) => `{${' '.repeat(size - text.length)}${text.slice(1)}`;
    expect(JSON.parse(padded(MAX_BODY_BYTES + 1))).toEqual(FLIGHTS);
    const t = await start({ answer: flights, googleContacted: true });
    const over = await t.post(FLIGHTS, { path: '/v1/flights', raw: padded(MAX_BODY_BYTES + 1) });
    expect([over.status, over.headers.get('x-gmt-google-contacted')]).toEqual([400, '0']);
    expect(t.seen).toEqual([]);
    const at = await t.post(FLIGHTS, { path: '/v1/flights', raw: padded(MAX_BODY_BYTES) });
    expect(at.status).toBe(200);
    expect(t.seen).toEqual([FLIGHTS]);
  });
  it('/v1/page refuses a flights body, 400, nothing paged', async () => {
    const t = await start({ answer: flights, googleContacted: true });
    expect((await t.post(FLIGHTS)).status).toBe(400);
    expect(t.seen).toEqual([]);
  });
  it('401 without the key, no body', async () => {
    const t = await start({ answer: flights, googleContacted: true });
    const r = await t.post(FLIGHTS, { path: '/v1/flights', key: null });
    expect(r.status).toBe(401);
    expect(await r.text()).toBe('');
    expect(t.seen).toEqual([]);
  });
  it('404 for GET /v1/flights', async () => {
    const t = await start({ answer: flights, googleContacted: true });
    expect((await fetch(`${t.base}/v1/flights`, { headers: { 'x-gmt-worker-key': KEY } })).status).toBe(404);
  });
});

// Spec §2 "The keep-awake lease": POST /v1/awake under the same key, body cap and contacted header; no page is loaded.
describe('POST /v1/awake (spec §2 "The keep-awake lease")', () => {
  const awake = { path: '/v1/awake' };
  it('200 with what is held for a lease, and 0 releases; the contacted header 0, no page asked', async () => {
    const t = await start({ answer: cells, googleContacted: true });
    const r = await t.post({ seconds: 300 }, awake);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-gmt-google-contacted')).toBe('0');
    expect(await r.json()).toEqual({ held: true, until: AT, mechanism: 'caffeinate' });
    const off = await t.post({ seconds: 0 }, awake);
    expect(await off.json()).toEqual({ held: false, until: null, mechanism: 'caffeinate' });
    expect(t.awakeAsked).toEqual([300, 0]);
    expect(t.seen).toEqual([]);
    expect(t.log.lines.map((l) => l.o)).toEqual([
      { route: 'POST /v1/awake', status: 200, kind: 'awake', durationMs: 0 },
      { route: 'POST /v1/awake', status: 200, kind: 'awake', durationMs: 0 },
    ]);
  });
  it.each([
    ['past the bound', { raw: JSON.stringify({ seconds: 601 }) }],
    ['negative', { raw: JSON.stringify({ seconds: -1 }) }],
    ['not whole', { raw: JSON.stringify({ seconds: 1.5 }) }],
    ['missing', { raw: '{}' }],
    ['an extra field', { raw: JSON.stringify({ seconds: 300, mode: 'list' }) }],
    ['a page request', { raw: JSON.stringify(BODY) }],
    ['a wrong content type', { type: 'text/plain', raw: JSON.stringify({ seconds: 300 }) }],
    ['not JSON', { raw: '{not json' }],
    ['an oversize body', { raw: JSON.stringify({ seconds: 300, pad: 'x'.repeat(MAX_BODY_BYTES) }) }],
  ])('400 for %s, nothing held', async (_n, o) => {
    const t = await start({ answer: cells, googleContacted: true });
    const r = await t.post(undefined, { ...awake, ...o });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ kind: 'bad-request' });
    expect(t.awakeAsked).toEqual([]);
  });
  it.each([
    ['no header', null],
    ['a wrong key', 'synthetic-worker-key-0123456789abcdeX'],
  ])('401 with %s, nothing held', async (_n, key) => {
    const t = await start({ answer: cells, googleContacted: true });
    const r = await t.post({ seconds: 300 }, { ...awake, key });
    expect(r.status).toBe(401);
    expect(await r.text()).toBe('');
    expect(t.awakeAsked).toEqual([]);
  });
  it('404 for GET /v1/awake; /v1/page refuses an awake body', async () => {
    const t = await start({ answer: cells, googleContacted: true });
    expect((await fetch(`${t.base}/v1/awake`, { headers: { 'x-gmt-worker-key': KEY } })).status).toBe(404);
    expect((await t.post({ seconds: 300 })).status).toBe(400);
    expect(t.awakeAsked).toEqual([]);
  });
});
