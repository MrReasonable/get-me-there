import type { Server } from 'node:http';
import { asIsoDateTime, type PageRequest, Secret, type WorkerAnswer, type WorkerStatus } from '@gmt/core';
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
  result: PageResult | ((req: PageRequest) => Promise<PageResult>),
  status: WorkerStatus = STATUS,
) {
  const log = memoryLog();
  const seen: PageRequest[] = [];
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
    onFatal: () => {
      fatal += 1;
    },
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  server = s;
  const base = `http://127.0.0.1:${portOf(s)}`;
  const post = (body: unknown, o: { key?: string | null; type?: string; raw?: string } = {}) =>
    fetch(`${base}/v1/page`, {
      method: 'POST',
      headers: {
        'content-type': o.type ?? 'application/json',
        ...(o.key === null ? {} : { 'x-gmt-worker-key': o.key ?? KEY }),
      },
      body: o.raw ?? JSON.stringify(body),
    });
  return { base, post, log, seen, fatalCount: () => fatal };
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
    expect((await t.post({ ...BODY, mode: 'grid' })).status).toBe(409);
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
  it('a page handler that throws answers 500', async () => {
    const t = await start(async () => {
      throw new Error('boom');
    });
    expect((await t.post(BODY)).status).toBe(500);
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
      onFatal: () => undefined,
    });
    expect(() => portOf(s)).toThrow(/not listening/);
  });
});
