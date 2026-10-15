import { AbortedError, asIsoDateTime, ProviderError } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES } from '../../src/http/attempt.js';
import { classifyThrown, parseRetryAfter } from '../../src/http/classify.js';
import type { ResponseFacts } from '../../src/http/types.js';
import { makeKit, req, SEARCH, SENTINELS, TP } from '../fakes.js';
import { asProviderError } from '../support/guards.js';
import { hangUntilAborted, server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const reply = (
  status: number,
  body: unknown = { error: `synthetic ${status}` },
  headers: Record<string, string> = {},
) =>
  server.use(
    http.get(
      SEARCH,
      () =>
        new HttpResponse(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        }),
    ),
  );
const hang = (url: string) => server.use(http.get(url, ({ request }) => hangUntilAborted(request)));
const tpReq = () =>
  req({
    url: TP,
    providerId: 'travelpayouts',
    headers: { 'x-access-token': SENTINELS.travelpayouts.reveal() },
  });
const fetchTimes = (events: ReturnType<typeof makeKit>['events'], t0: number) =>
  events.flatMap((e) => (e.type === 'fetch' ? [e.at - t0] : []));
const finals = (events: ReturnType<typeof makeKit>['events']) =>
  events.flatMap((e) => (e.type === 'finalise' ? [e] : []));

describe('default error mapping (spec §5.2 "Errors", §9 item 2)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'quota'],
    [404, 'upstream'],
    [409, 'upstream'],
  ] as const)('HTTP %i → %s, never retried', async (status, kind) => {
    const { kit, budget } = makeKit();
    reply(status);
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind,
      retryable: false,
      httpStatus: status,
    });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error']);
  });

  it('HTTP 400 → parse; the vendor message is in the message (→ last_error), never in reason; never retried', async () => {
    const { kit, budget } = makeKit();
    reply(400, { error: 'Too many combinations: 240 > 200' });
    const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
    expect(err).toMatchObject({ kind: 'parse', retryable: false, reason: undefined });
    expect(err.message).toContain('Too many combinations: 240 > 200');
    expect(budget.count('fetch')).toBe(1);
  });

  it("Travelpayouts' recorded plain-text 401 (spec §2 fact 5) → auth through the non-JSON path, one attempt", async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get(
        TP,
        () => new HttpResponse('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } }),
      ),
    );
    expect(await driveError(kit.request(tpReq()))).toMatchObject({ kind: 'auth', retryable: false });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error']);
  });

  it('HTTP 429 with Retry-After → rate-limit, retried to 3 attempts', async () => {
    const { kit, budget } = makeKit();
    reply(429, {}, { 'Retry-After': '1' });
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'rate-limit',
      retryable: true,
      httpStatus: 429,
    });
    expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e.httpAttempt] : []))).toEqual([1, 2, 3]);
  });

  it('a 429 is never quota by default, even with the ledger at its cap (the ledger arm is dropped, rev 11)', async () => {
    const { kit, budget } = makeKit();
    budget.caps.set('provider-month:searchapi', 1);
    reply(429, {}, { 'Retry-After': '1' });
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({ kind: 'rate-limit' });
  });

  it('a header-less 429 with no fallback (SearchApi) → non-retryable rate-limit, retry time at the hourly window', async () => {
    const { kit, budget } = makeKit();
    reply(429);
    const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
    expect(err).toMatchObject({
      kind: 'rate-limit',
      retryable: false,
      message: expect.stringContaining('[no-retry-after]'),
    });
    expect(err.retryAfterSeconds ?? 0).toBeGreaterThan(3500);
    expect(budget.count('fetch')).toBe(1);
  });

  it('a header-less 429 with a fallback (Travelpayouts, 60 s) waits the fallback before the next attempt', async () => {
    const { kit, events } = makeKit();
    let n = 0;
    server.use(
      http.get(TP, () =>
        ++n === 1 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json({ success: true, data: [] }),
      ),
    );
    const t0 = Date.now();
    await drive(kit.request(tpReq()));
    expect(fetchTimes(events, t0)[1] ?? 0).toBeGreaterThanOrEqual(60_000);
  });

  it('HTTP 503 → upstream retryable; three finalise(error) rows', async () => {
    const { kit, events } = makeKit();
    reply(503);
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'upstream',
      retryable: true,
      httpStatus: 503,
    });
    expect(finals(events).map((e) => e.outcome)).toEqual(['error', 'error', 'error']);
  });

  it('malformed JSON on a 200 → parse, never retried, finalised ok with status 200 (the vendor billed it)', async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get(
        SEARCH,
        () =>
          new HttpResponse('{"calendar": [', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'parse',
      retryable: false,
      message: expect.stringContaining('[malformed-json]'),
    });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:ok']);
  });

  it('a socket error → network, retried to 3 attempts, finalised error without status', async () => {
    const { kit, events } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.error()));
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'network',
      retryable: true,
      message: expect.stringContaining('[socket]'),
    });
    expect(finals(events).every((e) => e.outcome === 'error' && e.httpStatus === undefined)).toBe(true);
    expect(finals(events)).toHaveLength(3);
  });
});

describe('adapter classifyError (plan decision 15)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('is consulted first: a recognised quota body on a 429 → quota, one attempt', async () => {
    const { kit, budget } = makeKit({
      overrides: {
        searchapi: {
          classifyError: (f) =>
            f.status === 429 && JSON.stringify(f.body).includes('exhausted')
              ? new ProviderError({
                  kind: 'quota',
                  retryable: false,
                  httpStatus: f.status,
                  message: 'searchapi: plan quota body',
                })
              : undefined,
        },
      },
    });
    reply(429, { error: 'monthly searches exhausted' });
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({ kind: 'quota' });
    expect(budget.count('fetch')).toBe(1);
  });

  it('undefined falls through to the default table, and the Retry-After wait still applies', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { classifyError: () => undefined } } });
    let n = 0;
    server.use(
      http.get(SEARCH, () =>
        ++n === 1
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } })
          : HttpResponse.json({ ok: 1 }),
      ),
    );
    const t0 = Date.now();
    await drive(kit.request(req({ url: SEARCH })));
    expect(fetchTimes(events, t0)[1] ?? 0).toBeGreaterThanOrEqual(30_000);
  });

  it('sees a scrubbed body and scrubbed headers, and its message is re-scrubbed (arch-001, sec-001)', async () => {
    const seen: ResponseFacts[] = [];
    const key = SENTINELS.searchapi.reveal();
    const { kit } = makeKit({
      overrides: {
        searchapi: {
          classifyError: (f) => {
            seen.push(f);
            return new ProviderError({
              kind: 'auth',
              retryable: false,
              message: `vendor said ${JSON.stringify(f.body)}; key ${key}; see https://x.example/?k=1`,
            });
          },
        },
      },
    });
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({ error: `Invalid API key ${key}` }, { status: 401, headers: { 'x-echo': key } }),
      ),
    );
    const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
    expect(JSON.stringify(seen[0]?.body)).not.toContain(key);
    expect(seen[0]?.headers.get('x-echo')).toBe('[redacted]');
    expect(err.message).not.toContain(key);
    expect(err.message).not.toContain('?k=1');
    expect(err.message).toContain('[redacted]');
  });
});

describe('Retry-After and backoff (fake timers)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('backs off 1–2 s then 2–4 s between attempts (randomised)', async () => {
    const { kit, events } = makeKit();
    let n = 0;
    server.use(
      http.get(SEARCH, () =>
        ++n < 3 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json({ ok: 1 }),
      ),
    );
    const t0 = Date.now();
    await drive(kit.request(req({ url: SEARCH })), { stepMs: 50 });
    const [a0 = 0, a1 = 0, a2 = 0] = fetchTimes(events, t0);
    expect(a1 - a0).toBeGreaterThanOrEqual(1000);
    expect(a1 - a0).toBeLessThanOrEqual(2200);
    expect(a2 - a1).toBeGreaterThanOrEqual(2000);
    expect(a2 - a1).toBeLessThanOrEqual(4200);
  });

  it('honours Retry-After (seconds) before the next attempt', async () => {
    const { kit, events } = makeKit();
    let n = 0;
    server.use(
      http.get(SEARCH, () =>
        ++n === 1
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } })
          : HttpResponse.json({ ok: 1 }),
      ),
    );
    const t0 = Date.now();
    await drive(kit.request(req({ url: SEARCH })));
    expect(fetchTimes(events, t0)[1] ?? 0).toBeGreaterThanOrEqual(30_000);
  });

  it.each([429, 503])(
    'a Retry-After beyond maxWaitSeconds on %i → limiter-timeout carrying the wait, not retried',
    async (status) => {
      const { kit, budget } = makeKit();
      reply(status, {}, { 'Retry-After': '7200' });
      const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
      expect(err).toMatchObject({
        kind: 'limiter-timeout',
        retryable: false,
        retryAfterSeconds: 7200,
        message: expect.stringContaining('[retry-after-exceeds-max-wait]'),
      });
      expect(budget.count('fetch')).toBe(1);
    },
  );

  it('parses an HTTP-date Retry-After relative to the clock', () => {
    const now = asIsoDateTime('2026-10-14T15:00:00.000Z');
    expect(parseRetryAfter('Wed, 14 Oct 2026 15:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('Wed, 14 Oct 2026 14:00:00 GMT', now)).toBe(0);
  });
});

describe('per-request timeout, abort, body failures and redirect', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('timeout on a billed vendor → network, finalised unknown, not retried, still counted by usage()', async () => {
    const { kit, budget } = makeKit({ overrides: { searchapi: { requestTimeoutSeconds: 5 } } });
    hang(SEARCH);
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'network',
      retryable: false,
      message: expect.stringContaining('[timeout]'),
    });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:unknown']);
    expect(budget.usage({ kind: 'provider-month', providerId: 'searchapi' }).calls).toBe(1);
  });

  it('timeout on a free vendor (billable never) → retried to 3 attempts, each finalised unknown', async () => {
    const { kit, events } = makeKit({ overrides: { travelpayouts: { requestTimeoutSeconds: 5 } } });
    hang(TP);
    expect(await driveError(kit.request(tpReq()))).toMatchObject({ kind: 'network', retryable: true });
    expect(finals(events).map((e) => e.outcome)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('abort mid-fetch → finalise(unknown) before AbortedError, no retry, still counted by usage()', async () => {
    const { kit, budget } = makeKit();
    hang(SEARCH);
    const ac = new AbortController();
    const p = kit.request(req({ url: SEARCH, signal: ac.signal }));
    setTimeout(() => ac.abort(), 1000);
    expect(await driveError(p)).toBeInstanceOf(AbortedError);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:unknown']);
    expect(budget.usage({ kind: 'provider-month', providerId: 'searchapi' }).calls).toBe(1);
  });

  it('an already-aborted signal → AbortedError with no reserve and no fetch', async () => {
    const { kit, budget } = makeKit();
    const ac = new AbortController();
    ac.abort();
    expect(await driveError(kit.request(req({ url: SEARCH, signal: ac.signal })))).toBeInstanceOf(
      AbortedError,
    );
    expect(budget.reserveCalls).toBe(0);
  });

  it('abort during the backoff sleep → AbortedError, no further attempt', async () => {
    const { kit, budget } = makeKit();
    reply(503);
    const ac = new AbortController();
    const p = kit.request(req({ url: SEARCH, signal: ac.signal }));
    setTimeout(() => ac.abort(), 500);
    expect(await driveError(p, { stepMs: 50 })).toBeInstanceOf(AbortedError);
    expect(budget.count('fetch')).toBe(1);
  });

  it('a body above 10 MiB → upstream, non-retryable (sec-014)', async () => {
    const { kit, budget } = makeKit();
    server.use(http.get(SEARCH, () => new HttpResponse('a'.repeat(MAX_BODY_BYTES + 1), { status: 200 })));
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'upstream',
      retryable: false,
      message: expect.stringContaining('[body-too-large]'),
    });
    expect(budget.count('fetch')).toBe(1);
  });

  it("the runtime's refused-redirect rejection maps to upstream redirect-refused, never a retried network error", () => {
    const thrown = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    expect(classifyThrown(thrown, { providerId: 'searchapi', endpointPath: '/api/v1/search' })).toMatchObject(
      {
        kind: 'upstream',
        retryable: false,
        message: expect.stringContaining('[redirect-refused]'),
      },
    );
  });
});

describe('http-kit owns retries: auth, quota, parse and limiter-timeout are never retried (cost minor 3)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it.each(['auth', 'quota', 'parse', 'limiter-timeout'] as const)(
    'an adapter classifier returning %s with retryable: true still makes one attempt',
    async (kind) => {
      const { kit, budget } = makeKit({
        overrides: {
          searchapi: {
            classifyError: (f) =>
              new ProviderError({
                kind,
                retryable: true,
                httpStatus: f.status,
                message: `searchapi: ${kind}`,
              }),
          },
        },
      });
      reply(503);
      const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
      expect(err).toMatchObject({ kind, retryable: false });
      expect(budget.count('fetch')).toBe(1);
    },
  );
});
