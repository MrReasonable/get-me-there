import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate, asIsoDateTime, fixedClock, type IsoDateTime } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRecordedFixture } from '../../src/http/recordedFiles.js';
import { createRecorder, withContentHash } from '../../src/http/recorder.js';
import type { ParamsAllowlist } from '../../src/params/allowlist.js';
import { loadRecorded, replayHandlers } from '../../src/testing/replay.js';
import { ALL_SECRETS, makeKit, req, SEARCH } from '../fakes.js';
import { arr, jsonOf, obj, str } from '../support/guards.js';
import { server } from '../support/msw.js';
import { tempDir } from '../support/tempdirs.js';
import { driveError, useFakeTime } from '../support/time.js';

const T0 = '2026-10-14T15:00:00.000Z';
function tree(): string {
  const root = join(tempDir('gmt-rep-'), 'fixtures', 'recorded');
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

/** A one-entry google_flights allowlist dated `day`, listing `names` with any value. */
const allowlistOn = (day: string, names: string[]): ParamsAllowlist =>
  withContentHash({
    provider: 'searchapi' as const,
    recordedAt: asIsoDate(day),
    endpoints: {
      '/api/v1/search?engine=google_flights': {
        names: [...names].sort(),
        values: Object.fromEntries(
          names.map((n) => [n, n === 'engine' ? ['google_flights'] : ('any' as const)]),
        ),
      },
    },
  });
const BEFORE = allowlistOn('2026-10-14', ['departure_id', 'engine']);
const AFTER = allowlistOn('2026-10-18', ['departure_id', 'engine', 'show_cheapest_flights']);
const HISTORY = [BEFORE, AFTER];
const OLD_URL = `${SEARCH}?engine=google_flights&departure_id=LHR`;

describe('replay through the dated allowlist history (spec §5.2: a parameter added after a recording)', () => {
  async function oldRecording(): Promise<string> {
    const root = tree();
    await rec(root).record(at(OLD_URL, { best_flights: [{ price: 603 }] }));
    return root;
  }

  it('answers a request carrying a parameter added after the recording from the recording made without it', async () => {
    const replay = replayHandlers(await oldRecording(), { allowlists: HISTORY });
    server.use(...replay.handlers);
    const res = await fetch(`${OLD_URL}&show_cheapest_flights=true`);
    expect(obj(await jsonOf(res))).toEqual({ best_flights: [{ price: 603 }] });
    expect(replay.misses()).toEqual([]);
  });

  it('without the history, the same request is a miss (exact match only)', async () => {
    const guard = networkGuard();
    const replay = replayHandlers(await oldRecording());
    server.use(...replay.handlers);
    await expect(fetch(`${OLD_URL}&show_cheapest_flights=true`)).rejects.toThrow();
    expect(replay.misses()).toEqual([
      'GET https://www.searchapi.io/api/v1/search ?departure_id&engine&show_cheapest_flights',
    ]);
    expect(guard.hits()).toBe(0);
  });

  it.each([
    ['a parameter no later allowlist lists', `${OLD_URL}&show_cheapest_flights=true&max_price=1`],
    [
      'another value of a parameter the recording sent',
      `${SEARCH}?engine=google_flights&departure_id=EWR&show_cheapest_flights=true`,
    ],
  ])('still misses on %s', async (_, url) => {
    const replay = replayHandlers(await oldRecording(), { allowlists: HISTORY });
    server.use(...replay.handlers);
    await expect(fetch(url)).rejects.toThrow();
    expect(replay.misses()).toHaveLength(1);
  });

  it('never drops a parameter for a recording made under the allowlist that lists it', async () => {
    const root = tree();
    await rec(root).record(at(OLD_URL, { run: 'after' }, 200, asIsoDateTime('2026-10-19T09:00:00.000Z')));
    const replay = replayHandlers(root, { allowlists: HISTORY });
    server.use(...replay.handlers);
    await expect(fetch(`${OLD_URL}&show_cheapest_flights=true`)).rejects.toThrow();
    expect(replay.misses()).toHaveLength(1);
  });

  it('matches exactly when no allowlist in the history is as old as the recording, or none is the provider’s', async () => {
    for (const allowlists of [[AFTER], [{ ...BEFORE, provider: 'travelpayouts' as const }, AFTER]]) {
      const replay = replayHandlers(await oldRecording(), { allowlists });
      server.use(...replay.handlers);
      await expect(fetch(`${OLD_URL}&show_cheapest_flights=true`)).rejects.toThrow();
      expect(obj(await jsonOf(await fetch(OLD_URL)))).toEqual({ best_flights: [{ price: 603 }] });
      expect(replay.misses()).toHaveLength(1);
    }
  });

  it('picks the governing allowlist by date when the history is supplied out of order (CodeRabbit, PR #6)', async () => {
    const replay = replayHandlers(await oldRecording(), { allowlists: [AFTER, BEFORE] });
    server.use(...replay.handlers);
    const res = await fetch(`${OLD_URL}&show_cheapest_flights=true`);
    expect(obj(await jsonOf(res))).toEqual({ best_flights: [{ price: 603 }] });
    expect(replay.misses()).toEqual([]);
    // why: both allowlists predate this recording, so only a date-ordered pick finds AFTER, which lists the name.
    const later = tree();
    await rec(later).record(at(OLD_URL, { run: 'after' }, 200, asIsoDateTime('2026-10-19T09:00:00.000Z')));
    const strict = replayHandlers(later, { allowlists: [AFTER, BEFORE] });
    server.use(...strict.handlers);
    await expect(fetch(`${OLD_URL}&show_cheapest_flights=true`)).rejects.toThrow();
    expect(strict.misses()).toHaveLength(1);
  });

  it.each([
    ['the last millisecond before the allowlist’s UTC date', '2026-10-17T23:59:59.999Z', true],
    ['the first millisecond of the allowlist’s UTC date', '2026-10-18T00:00:00.000Z', false],
  ])('a recording at %s is governed by the allowlist of its own UTC date', async (_, when, tolerated) => {
    const root = tree();
    await rec(root).record(at(OLD_URL, { at: when }, 200, asIsoDateTime(when)));
    for (const allowlists of [HISTORY, [AFTER, BEFORE]]) {
      const replay = replayHandlers(root, { allowlists });
      server.use(...replay.handlers);
      const sent = fetch(`${OLD_URL}&show_cheapest_flights=true`);
      if (tolerated) expect(obj(await jsonOf(await sent))).toEqual({ at: when });
      else await expect(sent).rejects.toThrow();
      expect(replay.misses()).toHaveLength(tolerated ? 0 : 1);
    }
  });

  it('a request the old allowlist selects no entry for is a miss, never matched loosely', async () => {
    const replay = replayHandlers(await oldRecording(), { allowlists: HISTORY });
    server.use(...replay.handlers);
    await expect(fetch(`${SEARCH}?engine=google_flights_calendar&departure_id=LHR`)).rejects.toThrow();
    expect(replay.misses()).toHaveLength(1);
  });
});
