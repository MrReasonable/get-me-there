import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH } from '../fakes.js';
import { respondAfter, server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const URL1 = `${SEARCH}?engine=google_flights_calendar&page=2`;

describe('HttpKitRequest.ledgerCacheHit (plan decision 24: one cache-hit row per tile, never per page)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('false: a cache hit returns the cached body and writes no cache-hit row', async () => {
    const { kit, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ page: 2 })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    const hit = await drive(
      kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 }, ledgerCacheHit: false })),
    );
    expect(hit).toMatchObject({ fromCache: true, body: { page: 2 } });
    expect(budget.count('fetch')).toBe(1);
    expect(budget.count('cache-hit')).toBe(0);
  });

  it('false: a joined in-flight request writes no cache-hit row; the leader still ledgers its upstream attempt', async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get(SEARCH, ({ request }) => respondAfter(request, 2000, () => HttpResponse.json({ page: 2 }))),
    );
    const leader = kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } }));
    const joiner = kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 }, ledgerCacheHit: false }));
    const [a, b] = await drive(Promise.all([leader, joiner]));
    expect(a.body).toEqual(b.body);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:ok']);
  });

  it('absent: the cache hit is ledgered as before', async () => {
    const { kit, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ page: 2 })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    expect(budget.count('cache-hit')).toBe(1);
  });
});
