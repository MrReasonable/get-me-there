import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock, type IsoDateTime } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecorder, loadRecordedFixture } from '../../src/http/recorder.js';
import { loadRecorded, replayHandlers } from '../../src/testing/replay.js';
import { ALL_SECRETS, makeKit, req, SEARCH } from '../fakes.js';
import { arr, jsonOf, obj, str } from '../support/guards.js';
import { server } from '../support/msw.js';
import { driveError, useFakeTime } from '../support/time.js';

const T0 = '2026-10-14T15:00:00.000Z';
function tree(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'gmt-rep-')), 'fixtures', 'recorded');
  mkdirSync(root, { recursive: true });
  return root;
}
const rec = (root: string) =>
  createRecorder({
    root,
    secrets: ALL_SECRETS,
    clock: fixedClock(asIsoDateTime(T0)),
    recordedBy: 'wp04-test',
  });
const at = (url: string, body: unknown, status = 200, fetchedAt: IsoDateTime = asIsoDateTime(T0)) => ({
  providerId: 'searchapi' as const,
  endpointPath: '/api/v1/search',
  request: req({ url }),
  status,
  body,
  fetchedAt,
});
/** Counts any request that would leave for the real vendor: registered first, so it runs only if replay falls through. */
function networkGuard(): { hits: () => number } {
  let hits = 0;
  server.use(
    http.all('https://www.searchapi.io/*', () => {
      hits += 1;
      return HttpResponse.error();
    }),
  );
  return { hits: () => hits };
}

async function recordChain(): Promise<string> {
  const root = tree();
  const r = rec(root);
  await r.record(
    at(`${SEARCH}?engine=google_flights&departure_id=LHR`, {
      best_flights: [{ departure_token: 'RAW-TOKEN-AAAA', price: 603 }],
    }),
  );
  await r.record(
    at(`${SEARCH}?engine=google_flights&departure_token=RAW-TOKEN-AAAA`, {
      best_flights: [{ booking_token: 'RAW-TOKEN-BBBB', price: 573 }],
    }),
  );
  await r.record(
    at(`${SEARCH}?engine=google_flights_calendar&departure_id=LGW`, { error: 'Too many combinations' }, 400),
  );
  writeFileSync(join(root, 'searchapi', 'params-2026-10-14.json'), '{"not":"a recording"}');
  return root;
}

describe('replayHandlers and loadRecorded (WP5/WP6 adapter tests, WP13 layer B)', () => {
  it('replays a recorded chain: the served placeholder, sent back, matches the next recorded request', async () => {
    const replay = replayHandlers(await recordChain());
    server.use(...replay.handlers);
    const step1 = obj(await jsonOf(await fetch(`${SEARCH}?departure_id=LHR&engine=google_flights`)));
    const token = str(obj(arr(step1.best_flights)[0]).departure_token);
    expect(token).toMatch(/^<departure_token:0@20261014T150000000Z-[0-9a-f]{6}>$/);
    const step2 = await fetch(
      `${SEARCH}?engine=google_flights&departure_token=${encodeURIComponent(token)}`,
      { headers: { authorization: 'Bearer anything' } },
    );
    expect(obj(arr(obj(await jsonOf(step2)).best_flights)[0])).toMatchObject({ price: 573 });
    expect(replay.misses()).toEqual([]);
  });

  it('replays the recorded status and body of an error response', async () => {
    server.use(...replayHandlers(await recordChain()).handlers);
    const res = await fetch(`${SEARCH}?engine=google_flights_calendar&departure_id=LGW`);
    expect([res.status, await jsonOf(res)]).toEqual([400, { error: 'Too many combinations' }]);
  });

  it('serves the recorded response headers with the body (plan decision 20)', async () => {
    const root = tree();
    await rec(root).record({
      ...at(`${SEARCH}?engine=google_flights&departure_id=JFK`, { error: 'slow down' }, 429),
      responseHeaders: new Headers({ 'retry-after': '7', 'x-ratelimit-remaining': '0' }),
    });
    const replay = replayHandlers(root);
    server.use(...replay.handlers);
    const res = await fetch(`${SEARCH}?engine=google_flights&departure_id=JFK`);
    expect([res.status, res.headers.get('retry-after'), res.headers.get('x-ratelimit-remaining')]).toEqual([
      429,
      '7',
      '0',
    ]);
    expect(replay.misses()).toEqual([]);
  });

  it('an unrecorded request is logged as a miss (names only), answered with a network error, and never reaches the network (arch-r2-001)', async () => {
    const guard = networkGuard();
    const replay = replayHandlers(await recordChain());
    server.use(...replay.handlers);
    await expect(fetch(`${SEARCH}?engine=google_flights&departure_id=EWR`)).rejects.toThrow();
    expect(replay.misses()).toEqual(['GET https://www.searchapi.io/api/v1/search ?departure_id&engine']);
    expect(guard.hits()).toBe(0);
  });

  it('identical requests from one session replay in recordedAt order, then repeat the last; loadRecorded skips raw bodies and allowlists', async () => {
    const root = tree();
    const r = rec(root);
    const url = `${SEARCH}?engine=google_flights&departure_id=LHR`;
    await r.record(at(url, { search: 1 }, 200, asIsoDateTime('2026-10-14T15:00:00.000Z')));
    await r.record(at(url, { search: 2 }, 200, asIsoDateTime('2026-10-14T15:00:01.000Z')));
    writeFileSync(join(root, 'searchapi', 'params-2026-10-14.json'), '{}');
    expect(loadRecorded(root, 'searchapi', '/api/v1/search').map((f) => f.body)).toEqual([
      { search: 1 },
      { search: 2 },
    ]);
    expect(loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates')).toEqual([]);
    server.use(...replayHandlers(root).handlers);
    const bodies = [
      await jsonOf(await fetch(url)),
      await jsonOf(await fetch(url)),
      await jsonOf(await fetch(url)),
    ];
    expect(bodies).toEqual([{ search: 1 }, { search: 2 }, { search: 2 }]);
  });

  it('refuses a request recorded by two same-day sessions unless opts.session picks one (prov-r2-001)', async () => {
    const root = tree();
    const url = `${SEARCH}?engine=google_flights&departure_id=LHR`;
    const first = await rec(root).record(at(url, { run: 1 }));
    await rec(root).record(at(url, { run: 2 }, 200, asIsoDateTime('2026-10-14T18:00:00.000Z')));
    expect(() => replayHandlers(root)).toThrow(/opts\.session/);
    const session = loadRecordedFixture(first, root).session;
    server.use(...replayHandlers(root, { session }).handlers);
    expect(await jsonOf(await fetch(url))).toEqual({ run: 1 });
  });
});

describe('a replay miss through http-kit (prov-001)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('shows up in misses() as a retried network error, so the consumer’s afterEach fails; nothing reaches the network', async () => {
    const guard = networkGuard();
    const replay = replayHandlers(await recordChain());
    server.use(...replay.handlers);
    const { kit } = makeKit();
    expect(
      await driveError(kit.request(req({ url: `${SEARCH}?engine=google_flights&departure_id=EWR` }))),
    ).toMatchObject({ kind: 'network' });
    expect(replay.misses()).toHaveLength(3);
    expect(guard.hits()).toBe(0);
  });
});
