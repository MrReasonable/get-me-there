import { GRID_MOVE_BUDGET_MS, GRID_MOVE_RESERVE_MS, parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  camoufoxHttpLimits,
  camoufoxStatusHttpLimits,
  nextStartOf,
  pageClassOf,
  pageCountOf,
} from '../../src/camoufox/index.js';

const env = {
  NODE_ENV: 'production',
  DATABASE_PATH: '/data/x.db',
  APP_BASIC_AUTH_USER: 'ian',
  APP_BASIC_AUTH_PASS: 'correct-horse-battery',
  IN_CONTAINER: '1',
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: 'http://host.docker.internal:8090',
  CAMOUFOX_WORKER_KEY: 'test-camoufox-worker-key-0123456789abcdef',
  CAMOUFOX_MIN_SPACING_SECONDS: '45',
};
function camoufox(over: Record<string, string> = {}) {
  const r = parseConfig({ ...env, ...over }, { realpath: (p) => p });
  if (!r.ok || r.config.providers.camoufox === null) throw new Error('config');
  return r.config.providers.camoufox;
}

describe('camoufoxHttpLimits (spec §5.3 rev 32; decision 69)', () => {
  it('in grid mode the timeout is four page timeouts and the page spacing (the first load and its one reload) plus, per allowed scroll, the spacing and the move budget (CA M6)', () => {
    const c = camoufox({
      CAMOUFOX_MODE: 'grid',
      CAMOUFOX_GRID_SCROLL_CAP: '30',
      CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '5',
    });
    const move = (GRID_MOVE_BUDGET_MS + GRID_MOVE_RESERVE_MS) / 1000;
    expect(move).toBe(60);
    expect(camoufoxHttpLimits(c, { maxWaitSeconds: 3900 }).requestTimeoutSeconds).toBe(
      4 * 90 + 45 + 30 * (5 + move) + 15,
    );
  });
  it('page spacing 0 gives minIntervalMs 0 and a limiter with no rate limit (operator, 2026-10-25)', () => {
    const l = camoufoxHttpLimits(camoufox({ CAMOUFOX_MIN_SPACING_SECONDS: '0' }), { maxWaitSeconds: 3900 });
    expect(l).toMatchObject({
      minIntervalMs: 0,
      ratePerMinute: Number.MAX_SAFE_INTEGER,
      ratePerHour: Number.MAX_SAFE_INTEGER,
      concurrency: 1,
    });
    const grid = camoufoxHttpLimits(
      camoufox({
        CAMOUFOX_MODE: 'grid',
        CAMOUFOX_GRID_SCROLL_CAP: '30',
        CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '0',
      }),
      { maxWaitSeconds: 3900 },
    );
    expect(grid.requestTimeoutSeconds).toBe(4 * 90 + 45 + 30 * 60 + 15);
  });
  it('the worker’s origin, never billable, concurrency 1, spacing as minIntervalMs, page timeout + 15 s, no transport retries', () => {
    const l = camoufoxHttpLimits(camoufox(), { maxWaitSeconds: 3900 });
    expect(l).toMatchObject({
      hosts: ['host.docker.internal'],
      workerPort: 8090,
      workerScheme: 'http:',
      ratePerMinute: 1,
      ratePerHour: 80,
      concurrency: 1,
      billable: 'never',
      costPerCallMicroGbp: 0,
      maxWaitSeconds: 3900,
      requestTimeoutSeconds: 105,
      minIntervalMs: 45_000,
      retryTransport: false,
      connectRefusedKind: 'provider-unavailable',
    });
    expect(l.classifyError).toBeTypeOf('function');
    expect(
      camoufoxHttpLimits(camoufox({ CAMOUFOX_WORKER_URL: 'https://[::1]:8443' }), { maxWaitSeconds: 1 }),
    ).toMatchObject({
      hosts: ['[::1]'],
      workerPort: 8443,
      workerScheme: 'https:',
    });
  });
  it('the status route: the same origin, a short timeout, no retries', () => {
    expect(camoufoxStatusHttpLimits(camoufox(), { maxWaitSeconds: 3900 })).toMatchObject({
      hosts: ['host.docker.internal'],
      workerPort: 8090,
      billable: 'never',
      requestTimeoutSeconds: 10,
      retryTransport: false,
    });
  });
  it('pageClass reads x-gmt-google-contacted; an absent header is a page', () => {
    expect(pageClassOf({ status: 429, headers: new Headers({ 'x-gmt-google-contacted': '0' }) })).toBe(
      'no-page',
    );
    expect(pageClassOf({ status: 200, headers: new Headers({ 'x-gmt-google-contacted': '1' }) })).toBe(
      'page',
    );
    expect(pageClassOf({ status: 504, headers: new Headers() })).toBe('page');
    expect(pageClassOf({ status: null, headers: null })).toBe('page');
  });
  // why: spec rev 56 §5.3: a flights request with a return phase sends its own timeout (flightRequestSeconds); the
  // provider's stays discovery's, the page timeout plus 15 s
  it('requestTimeoutSeconds stays discovery’s in list mode (105 s), and the limits read pagesLoaded through pageCountOf', () => {
    const l = camoufoxHttpLimits(camoufox(), { maxWaitSeconds: 3900 });
    expect(l.requestTimeoutSeconds).toBe(105);
    expect(l.pageCountOf).toBe(pageCountOf);
  });
  // why: spec rev 56 §5.3: http-kit holds the next start on any answer that states nextLoadNotBefore (21.4 review I1)
  it('the limits read nextLoadNotBefore through nextStartOf; the status route’s limits read none', () => {
    expect(camoufoxHttpLimits(camoufox(), { maxWaitSeconds: 3900 }).nextStartOf).toBe(nextStartOf);
    expect(camoufoxStatusHttpLimits(camoufox(), { maxWaitSeconds: 3900 }).nextStartOf).toBeUndefined();
  });
});

describe('pageCountOf (spec rev 56 §5.3: the answer’s pagesLoaded for the ledger row’s page_count)', () => {
  it.each([
    ['{"pagesLoaded":2}', 2],
    ['{"pagesLoaded":1}', 1],
    // why: R-zero: a first load the worker refused loaded nothing, and the row says 0
    ['{"pagesLoaded":0}', 0],
    ['{"kind":"blocked","page":"captcha","pagesLoaded":1}', 1],
  ])('reads %s as %i', (body, n) => {
    expect(pageCountOf(body)).toBe(n);
  });
  it.each([
    ['a body without it', '{"kind":"flights"}'],
    ['a non-JSON body', 'not json'],
    ['an empty body', ''],
    ['a JSON null', 'null'],
    ['a JSON array', '[2]'],
    ['a JSON number', '2'],
    ['a JSON string', '"pagesLoaded"'],
    ['a negative count', '{"pagesLoaded":-1}'],
    ['a fraction', '{"pagesLoaded":1.5}'],
    ['a string', '{"pagesLoaded":"2"}'],
  ])('%s is undefined (the guard then keeps its own reading)', (_n, body) => {
    expect(pageCountOf(body)).toBeUndefined();
  });
});

describe('nextStartOf (spec rev 56 §5.3: the answer’s nextLoadNotBefore, which holds the next camoufox start)', () => {
  it.each([
    ['a flights answer', '{"kind":"flights","nextLoadNotBefore":"2026-10-14T15:00:30.000Z"}'],
    [
      'a not-ready answer',
      '{"kind":"not-ready","pagesLoaded":2,"nextLoadNotBefore":"2026-10-14T15:00:30.000Z"}',
    ],
    [
      'a blocked answer',
      '{"kind":"blocked","page":"captcha","nextLoadNotBefore":"2026-10-14T15:00:30.000Z"}',
    ],
  ])('reads it from %s', (_n, body) => {
    expect(nextStartOf(body)).toBe('2026-10-14T15:00:30.000Z');
  });
  it.each([
    ['a body without it', '{"kind":"flights","pagesLoaded":2}'],
    ['a non-JSON body', 'not json'],
    ['an empty body', ''],
    ['a JSON null', 'null'],
    ['a JSON string', '"2026-10-14T15:00:30.000Z"'],
    ['a number', '{"nextLoadNotBefore":1792000000000}'],
    ['a date without a time', '{"nextLoadNotBefore":"2026-10-14"}'],
    ['a time not in toISOString form', '{"nextLoadNotBefore":"2026-10-14T15:00:30Z"}'],
    ['an impossible date', '{"nextLoadNotBefore":"2026-13-14T15:00:30.000Z"}'],
  ])('%s holds nothing (undefined)', (_n, body) => {
    expect(nextStartOf(body)).toBeUndefined();
  });
});
