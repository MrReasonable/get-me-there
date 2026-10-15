import { AbortedError, BudgetExceeded } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH, SENTINELS } from '../fakes.js';
import { respondAfter, server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const URL1 = `${SEARCH}?engine=google_flights_calendar&departure_id=LHR&arrival_id=JFK`;
const slow = (body: unknown = { once: true }) =>
  server.use(
    http.get(SEARCH, ({ request }) =>
      respondAfter(
        request,
        2000,
        () => new HttpResponse(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      ),
    ),
  );
// why: both outcomes are awaited together, so neither promise rejects without a handler attached (arch-r2-006).
const both = (a: Promise<unknown>, b: Promise<unknown>) =>
  drive(Promise.all([a.catch((e: unknown) => e), b.catch((e: unknown) => e)]));
const cacheHits = (events: ReturnType<typeof makeKit>['events']) =>
  events.flatMap((e) => (e.type === 'cache-hit' ? [e] : []));

describe('cache path (spec §5.3 pipeline)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('a hit makes zero upstream calls, records a non-billable cache hit with the caller’s tileIndex, returns the original storedAt', async () => {
    const { kit, budget, cache, clock, events } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ calendar: [1] })));
    const first = await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    clock.advance(30 * 60_000);
    const second = await drive(
      kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 }, executionId: 'exec-2', tileIndex: 5 })),
    );
    expect(budget.count('fetch')).toBe(1);
    expect(second).toMatchObject({
      fromCache: true,
      fetchedAt: '2026-10-14T15:00:00.000Z',
      body: { calendar: [1] },
      cacheKey: first.cacheKey,
    });
    expect(cacheHits(events)).toEqual([
      expect.objectContaining({
        providerId: 'searchapi',
        executionId: 'exec-2',
        tileIndex: 5,
        endpointPath: '/api/v1/search',
      }),
    ]);
    expect(cache.sets).toHaveLength(1);
  });

  it('a miss stores the scrubbed body with the request TTL and storedAt = now', async () => {
    const { kit, cache } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ echo: `key ${SENTINELS.searchapi.reveal()}` })));
    const res = await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    expect(cache.sets).toEqual([
      {
        key: res.cacheKey,
        body: { echo: 'key [redacted]' },
        ttlSeconds: 600,
        storedAt: '2026-10-14T15:00:00.000Z',
      },
    ]);
    expect(res.body).toEqual({ echo: 'key [redacted]' });
  });

  it("cache 'never' (token-bearing responses) is never stored or read", async () => {
    const { kit, cache, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ booking_token: 'opaque' })));
    await drive(kit.request(req({ url: URL1, cache: 'never' })));
    await drive(kit.request(req({ url: URL1, cache: 'never' })));
    expect(cache.sets).toHaveLength(0);
    expect(budget.count('fetch')).toBe(2);
    expect(budget.count('cache-hit')).toBe(0);
  });

  it('error responses are never cached', async () => {
    const { kit, cache } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ error: 'gone' }, { status: 404 })));
    await driveError(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    expect(cache.sets).toHaveLength(0);
  });

  it('an empty 200 body is never cached, so the next identical request asks the vendor again (prov-004)', async () => {
    const { kit, cache, budget } = makeKit();
    server.use(http.get(SEARCH, () => new HttpResponse('', { status: 200 })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    expect(cache.sets).toHaveLength(0);
    expect(budget.count('fetch')).toBe(2);
  });

  it('a body the adapter rejects through accept is not cached (pie-004)', async () => {
    const { kit, cache, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ success: false })));
    const accept = (b: unknown) =>
      typeof b === 'object' && b !== null && 'success' in b && b.success === true;
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600, accept } })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600, accept } })));
    expect(cache.sets).toHaveLength(0);
    expect(budget.count('fetch')).toBe(2);
  });

  it("'fx' requests are never ledgered: no reserve, no cache-hit row", async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get('https://api.frankfurter.dev/v1/latest', () => HttpResponse.json({ rates: { USD: 1.3 } })),
    );
    const r = req({
      url: 'https://api.frankfurter.dev/v1/latest?from=GBP',
      providerId: 'fx',
      headers: {},
      cache: { ttlSeconds: 3600 },
    });
    await drive(kit.request(r));
    await drive(kit.request(r));
    expect([budget.reserveCalls, budget.count('cache-hit'), budget.count('fetch')]).toEqual([0, 0, 1]);
  });
});

describe('in-flight dedup (spec §5.3 rev 11, ruling 4)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('two concurrent identical requests: one reserve, one fetch, and a cache-hit row for the joiner’s own execution and tile', async () => {
    const { kit, budget, events } = makeKit();
    slow();
    const a = kit.request(req({ url: URL1, executionId: 'exec-A', tileIndex: 1 }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B', tileIndex: 2 }));
    expect(kit.stats().inFlight).toBe(1);
    const [ra, rb] = await drive(Promise.all([a, b]));
    expect([budget.reserveCalls, budget.count('fetch')]).toEqual([1, 1]);
    expect(cacheHits(events)).toEqual([
      expect.objectContaining({ executionId: 'exec-B', tileIndex: 2, endpointPath: '/api/v1/search' }),
    ]);
    expect(rb).toMatchObject({ body: ra.body, fetchedAt: ra.fetchedAt, fromCache: true });
    expect(ra.fromCache).toBe(false);
    expect(kit.stats().inFlight).toBe(0);
  });

  it('a joiner that aborts gets AbortedError on its own signal; the leader is unaffected and the joiner writes no row', async () => {
    const { kit, events } = makeKit();
    slow();
    const ac = new AbortController();
    const a = kit.request(req({ url: URL1, executionId: 'exec-A' }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B', signal: ac.signal }));
    setTimeout(() => ac.abort(), 500);
    const [ra, eb] = await both(a, b);
    expect(eb).toBeInstanceOf(AbortedError);
    expect(ra).toMatchObject({ body: { once: true } });
    expect(cacheHits(events)).toEqual([]);
  });

  it('when the leader is aborted the live joiner re-issues the request itself and succeeds', async () => {
    const { kit, budget } = makeKit();
    slow();
    const ac = new AbortController();
    const a = kit.request(req({ url: URL1, executionId: 'exec-A', signal: ac.signal }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B' }));
    setTimeout(() => ac.abort(), 500);
    const [ea, rb] = await both(a, b);
    expect(ea).toBeInstanceOf(AbortedError);
    expect(rb).toMatchObject({ body: { once: true } });
    expect(budget.sequence().filter((s) => s !== 'fetch')).toEqual([
      'reserve',
      'finalise:unknown',
      'reserve',
      'finalise:ok',
    ]);
  });

  it('a BudgetExceeded on the leader’s own execution scope makes a joiner from another execution re-issue', async () => {
    const { kit, budget } = makeKit();
    slow();
    budget.refuse = (p) =>
      p.executionId === 'exec-A'
        ? new BudgetExceeded({ scope: 'execution-calls', cap: 0, current: 0, requested: 1 })
        : null;
    const a = kit.request(req({ url: URL1, executionId: 'exec-A' }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B' }));
    const [ea, rb] = await both(a, b);
    expect(ea).toBeInstanceOf(BudgetExceeded);
    expect(rb).toMatchObject({ body: { once: true } });
    expect(budget.count('fetch')).toBe(1);
  });

  it('a joiner whose leader fails with a ProviderError still leaves its own cache-hit row, so parity counts its tile (cost minor 1)', async () => {
    const { kit, budget, events } = makeKit();
    server.use(
      http.get(SEARCH, ({ request }) =>
        respondAfter(request, 2000, () => HttpResponse.json({ error: 'busy' }, { status: 503 })),
      ),
    );
    const a = kit.request(req({ url: URL1, executionId: 'exec-A', tileIndex: 1 }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-A', tileIndex: 2 }));
    const [ea, eb] = await both(a, b);
    expect(ea).toMatchObject({ kind: 'upstream', httpStatus: 503 });
    expect(eb).toBe(ea);
    expect(budget.count('fetch')).toBe(3);
    expect(cacheHits(events)).toEqual([expect.objectContaining({ executionId: 'exec-A', tileIndex: 2 })]);
  });

  it('a BudgetExceeded on a shared provider scope reaches the joiner unchanged (no re-issue)', async () => {
    const { kit, budget } = makeKit();
    slow();
    budget.refuse = () =>
      new BudgetExceeded({
        scope: 'provider-month',
        cap: 10_000,
        current: 10_000,
        requested: 1,
        providerId: 'searchapi',
      });
    const a = kit.request(req({ url: URL1, executionId: 'exec-A' }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B' }));
    const [ea, eb] = await both(a, b);
    expect(ea).toBeInstanceOf(BudgetExceeded);
    expect(eb).toBeInstanceOf(BudgetExceeded);
    expect([budget.reserveCalls, budget.count('fetch')]).toEqual([1, 0]);
    expect(budget.count('cache-hit')).toBe(0);
  });
});

describe('BudgetExceeded never reaches the network (spec §9 item 2)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('refused on the first attempt: thrown before any msw hit, never retried', async () => {
    const { kit, budget } = makeKit();
    const refusal = new BudgetExceeded({
      scope: 'provider-month',
      cap: 10_000,
      current: 10_000,
      requested: 1,
      providerId: 'searchapi',
    });
    budget.refuse = () => refusal;
    server.use(http.get(SEARCH, () => HttpResponse.json({})));
    expect(await driveError(kit.request(req({ url: URL1 })))).toBe(refusal);
    expect([budget.reserveCalls, budget.count('fetch')]).toEqual([1, 0]);
  });

  it('refused on the retry attempt after a 503: no second fetch, the BudgetExceeded instance is thrown (test-003)', async () => {
    const { kit, budget } = makeKit();
    const refusal = new BudgetExceeded({ scope: 'execution-calls', cap: 1, current: 1, requested: 1 });
    budget.refuse = (p) => (p.httpAttempt === 2 ? refusal : null);
    server.use(http.get(SEARCH, () => HttpResponse.json({}, { status: 503 })));
    expect(await driveError(kit.request(req({ url: URL1 })))).toBe(refusal);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error']);
    expect(budget.reserveCalls).toBe(2);
  });
});
