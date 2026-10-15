import { AbortedError, BudgetExceeded, type DiscoveryTileResult, TRAVELPAYOUTS_DEFAULTS } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderHttpLimits } from '../../src/http/types.js';
import { takeStrays } from '../../src/testing/network.js';
import { travelpayoutsHttpLimits } from '../../src/travelpayouts/limits.js';
import { TP } from '../fakes.js';
import { hangUntilAborted, server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';
import {
  ctx,
  discoveryOf,
  envelope,
  errorOf,
  eventsOf,
  type Harness,
  makeHarness,
  makeProvider,
  only,
  query,
  row,
} from './harness.js';

const cfg = { maxWaitSeconds: 5, requestTimeoutSeconds: 5 };

describe('travelpayoutsHttpLimits (spec §2, §5.3)', () => {
  it('is never billable, costs nothing, allows one host, waits 60 s on a bare 429 and has no classifyError', () => {
    expect(travelpayoutsHttpLimits(TRAVELPAYOUTS_DEFAULTS, cfg)).toEqual({
      hosts: ['api.travelpayouts.com'],
      ratePerMinute: 200,
      ratePerHour: 10_000,
      concurrency: 4,
      billable: 'never',
      costPerCallMicroGbp: 0,
      maxWaitSeconds: 5,
      requestTimeoutSeconds: 5,
      rateLimitFallbackWaitSeconds: 60,
    });
  });

  it('clamps the per-minute rate to the vendor ceiling of 600 (spec §2)', () => {
    expect(
      travelpayoutsHttpLimits({ ...TRAVELPAYOUTS_DEFAULTS, ratePerMinute: 900 }, cfg).ratePerMinute,
    ).toBe(600);
  });
});

/**
 * SYNTHETIC error bodies: none of these was recorded (spec §2 fact 5 recorded only the plain-text 401). The vendor's
 * error body shape is unverified; a success:false envelope with an `error` string is an assumption, and any other
 * shape falls to malformed-envelope. Retry-After values are synthetic too (plan decision 20).
 */
const SYNTHETIC = {
  unauthorised: () =>
    new HttpResponse('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } }),
  status: (status: number, headers: Record<string, string> = {}) =>
    new HttpResponse(JSON.stringify({ error: `synthetic ${status}` }), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
};

describe('fetchTile error mapping through the real http-kit (spec §5.2 Errors; fake timers, spec §9)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  function run(
    handler: (request: Request) => Response | Promise<Response>,
    o: { limits?: ProviderHttpLimits; overrides?: Partial<ProviderHttpLimits>; refuse?: boolean } = {},
  ) {
    let hits = 0;
    server.use(
      http.get(TP, ({ request }) => {
        hits += 1;
        return handler(request);
      }),
    );
    // why: every row runs on the adapter's real limits object (its host list, billing mode and fallback wait), with
    // only the rate raised so the limiter's smoothing gap stays small; a test that passes `limits` brings its own.
    const h = makeHarness({
      limits: o.limits ?? {
        ...travelpayoutsHttpLimits(TRAVELPAYOUTS_DEFAULTS, cfg),
        ratePerMinute: 60_000,
        ratePerHour: 3_600_000,
        ...o.overrides,
      },
      ...(o.refuse === undefined ? {} : { refuse: o.refuse }),
    });
    const d = discoveryOf(makeProvider(h));
    const q = query();
    return { h, result: drive(d.fetchTile(only(d.plan(q)), q, ctx())), hits: () => hits };
  }
  const attempts = (h: Harness) =>
    eventsOf(h, 'reserve').map((e) => [e.httpAttempt, e.costMicroGbp, e.tileIndex]);
  const finals = (h: Harness) => eventsOf(h, 'finalise').map((e) => [e.outcome, e.httpStatus ?? null]);

  it.each([
    [401, 'auth', SYNTHETIC.unauthorised],
    [403, 'auth', () => SYNTHETIC.status(403)],
    [402, 'quota', () => SYNTHETIC.status(402)],
    [400, 'parse', () => SYNTHETIC.status(400)],
    [404, 'upstream', () => SYNTHETIC.status(404)],
  ] as const)(
    'HTTP %i → tile-error %s, sent once, one ledger row finalised error',
    async (status, kind, handler) => {
      const { h, result, hits } = run(handler);
      expect(errorOf(await result)).toMatchObject({ kind, retryable: false, httpStatus: status });
      expect(hits()).toBe(1);
      expect(attempts(h)).toEqual([[1, 0, 0]]);
      expect(finals(h)).toEqual([['error', status]]);
    },
  );

  it.each([500, 503])(
    "HTTP %i → upstream after http-kit's three attempts, three ledger rows with httpAttempt 1, 2, 3",
    async (status) => {
      const { h, result, hits } = run(() => SYNTHETIC.status(status));
      expect(errorOf(await result)).toMatchObject({ kind: 'upstream', retryable: true, httpStatus: status });
      expect(hits()).toBe(3);
      expect(attempts(h)).toEqual([
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ]);
      expect(finals(h)).toEqual([
        ['error', status],
        ['error', status],
        ['error', status],
      ]);
    },
  );

  it("429 with Retry-After: 0 (synthetic) → rate-limit after http-kit's three attempts", async () => {
    const { h, result, hits } = run(() => SYNTHETIC.status(429, { 'Retry-After': '0' }));
    expect(errorOf(await result)).toMatchObject({ kind: 'rate-limit', retryable: true });
    expect(hits()).toBe(3);
    expect(attempts(h)).toHaveLength(3);
  });

  it('travelpayoutsHttpLimits itself drives the kit: a bare 429 waits its 60 s fallback, beyond MAX_WAIT_SECONDS 5 → limiter-timeout (ts2-003)', async () => {
    const { h, result, hits } = run(() => SYNTHETIC.status(429), {
      limits: travelpayoutsHttpLimits(TRAVELPAYOUTS_DEFAULTS, cfg),
    });
    expect(errorOf(await result)).toMatchObject({
      kind: 'limiter-timeout',
      retryable: false,
      retryAfterSeconds: 60,
    });
    expect(hits()).toBe(1);
    // billable 'never': the attempt is ledgered at zero cost and finalised once
    expect(attempts(h)).toEqual([[1, 0, 0]]);
  });

  it('429 without Retry-After waits the 60 s fallback (spec §5.2): beyond MAX_WAIT_SECONDS 5 → limiter-timeout, sent once', async () => {
    const { result, hits } = run(() => SYNTHETIC.status(429), {
      overrides: { rateLimitFallbackWaitSeconds: 60 },
    });
    expect(errorOf(await result)).toMatchObject({
      kind: 'limiter-timeout',
      retryable: false,
      retryAfterSeconds: 60,
    });
    expect(hits()).toBe(1);
  });

  it('429 without Retry-After, MAX_WAIT_SECONDS 3900: retried after the 60 s fallback, three ledger rows', async () => {
    const times: number[] = [];
    const { h, result, hits } = run(
      () => {
        times.push(Date.now());
        return SYNTHETIC.status(429);
      },
      { overrides: { maxWaitSeconds: 3900, rateLimitFallbackWaitSeconds: 60 } },
    );
    expect(errorOf(await result)).toMatchObject({ kind: 'rate-limit' });
    expect(hits()).toBe(3);
    expect(attempts(h)).toHaveLength(3);
    const [t1, t2] = times;
    if (t1 === undefined || t2 === undefined) throw new Error('two attempts expected');
    expect(t2 - t1).toBeGreaterThanOrEqual(60_000);
  });

  it('429 asking to wait beyond MAX_WAIT_SECONDS → limiter-timeout, sent once (Retry-After honoured, spec §5.3)', async () => {
    const { result, hits } = run(() => SYNTHETIC.status(429, { 'Retry-After': '3600' }));
    expect(errorOf(await result)).toMatchObject({ kind: 'limiter-timeout', retryAfterSeconds: 3600 });
    expect(hits()).toBe(1);
  });

  it('a socket failure → network after three attempts', async () => {
    const { result, hits } = run(() => HttpResponse.error());
    expect(errorOf(await result)).toMatchObject({ kind: 'network' });
    expect(hits()).toBe(3);
  });

  it('a per-request timeout (REQUEST_TIMEOUT_SECONDS 5) → network; Travelpayouts is never billed, so it is retried', async () => {
    const { h, result, hits } = run((request) => hangUntilAborted(request));
    expect(errorOf(await result)).toMatchObject({
      kind: 'network',
      message: expect.stringContaining('[timeout]'),
    });
    expect(hits()).toBe(3);
    expect(finals(h).map(([o]) => o)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('a failure on page 2 makes the whole tile a tile-error; page 1 prices are never returned as a partial tile', async () => {
    const full = Array.from({ length: 1000 }, (_, i) =>
      row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 + i }),
    );
    const { h, result } = run((request) =>
      new URL(request.url).searchParams.get('page') === '1'
        ? HttpResponse.json(envelope(full))
        : SYNTHETIC.unauthorised(),
    );
    const r: DiscoveryTileResult = await result;
    expect(errorOf(r)).toMatchObject({ kind: 'auth', httpStatus: 401 });
    expect(finals(h)).toEqual([
      ['ok', 200],
      ['error', 401],
    ]);
  });

  it('success:false (synthetic) → parse, the vendor text only in the message', async () => {
    const { result } = run(() => HttpResponse.json({ success: false, error: 'invalid destination' }));
    const e = errorOf(await result);
    expect(e).toMatchObject({ kind: 'parse', reason: 'parse' });
    expect(e.message).toContain('invalid destination');
    expect(e.message).toContain('[vendor-error]');
  });

  it('a non-JSON 200 body → parse', async () => {
    const { result } = run(
      () =>
        new HttpResponse('<html>maintenance</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    expect(errorOf(await result)).toMatchObject({ kind: 'parse' });
  });

  it('an unusable body is never cached (cache accept hook): fetching the tile again reaches upstream again, no cache-hit row', async () => {
    let hits = 0;
    server.use(
      http.get(TP, () => {
        hits += 1;
        // rows but no currency: readEnvelope refuses it, so the cache must too (cost-wp06-006)
        return HttpResponse.json({
          success: true,
          data: [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 })],
        });
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const tile = only(d.plan(q));
    await drive(d.fetchTile(tile, q, ctx()));
    await drive(d.fetchTile(tile, q, ctx()));
    expect(hits).toBe(2);
    expect(eventsOf(h, 'cache-hit')).toHaveLength(0);
    expect(h.cache.sets).toHaveLength(0);
  });

  it('an aborted signal raises AbortedError, never a tile-error, and sends nothing', async () => {
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const ac = new AbortController();
    ac.abort();
    await expect(d.fetchTile(only(d.plan(q)), q, ctx(ac.signal))).rejects.toBeInstanceOf(AbortedError);
    expect(eventsOf(h, 'reserve')).toHaveLength(0);
  });

  it('an abort while the request is in flight raises AbortedError and finalises the attempt unknown', async () => {
    server.use(http.get(TP, ({ request }) => hangUntilAborted(request)));
    const h = makeHarness({ overrides: { requestTimeoutSeconds: 60 } });
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const ac = new AbortController();
    const p = d.fetchTile(only(d.plan(q)), q, ctx(ac.signal));
    setTimeout(() => ac.abort(), 1000);
    await expect(drive(p)).rejects.toBeInstanceOf(AbortedError);
    expect(finals(h)).toEqual([['unknown', null]]);
  });

  it('BudgetExceeded from reserve propagates, nothing is sent and no reservation is left open', async () => {
    const { h, result, hits } = run(() => HttpResponse.json(envelope([])), { refuse: true });
    await expect(result).rejects.toBeInstanceOf(BudgetExceeded);
    expect(hits()).toBe(0);
    expect(eventsOf(h, 'finalise')).toHaveLength(0);
    expect(h.budget.open()).toEqual([]);
  });

  it('the network guard covers this adapter: a request no handler answers is a stray, never the real vendor (ts-001)', async () => {
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    expect(errorOf(await drive(d.fetchTile(only(d.plan(q)), q, ctx())))).toMatchObject({ kind: 'network' });
    // takeStrays clears the list, so the setup file's after-each stray check passes once it is asserted here
    expect(takeStrays()).toEqual(
      Array(3).fill('GET https://api.travelpayouts.com/aviasales/v3/prices_for_dates'),
    );
  });
});
