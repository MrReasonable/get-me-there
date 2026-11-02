// Spec rev 56 §5.3 "Per-request pages, timeout and hold" (WP21 Task 21.4): one attempt passes the request's planned
// pages to `budget.reserve`, takes the request's own timeout in place of the provider's for that attempt only, and
// passes the answer's `pagesLoaded` (through the provider's `pageCountOf`) to `finalise` as `pageCount`. msw answers on
// the worker's own origin; fake timers drive every timeout (no real waits).
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageCountOf } from '../../src/camoufox/limits.js';
import type { HttpKitRequest } from '../../src/http/types.js';
import { type LedgerEvent, makeKit, SENTINELS, testLimits } from '../fakes.js';
import { hangUntilAborted, respondAfter, server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const FLIGHTS = 'http://127.0.0.1:8090/v1/flights';
const PAGE = 'http://127.0.0.1:8090/v1/page';

/** A worker request as `postToWorker` sends it, on the test worker's origin. */
function workerReq(url: string, over: Partial<HttpKitRequest> = {}): HttpKitRequest {
  const u = new URL(url);
  return {
    providerId: 'camoufox',
    executionId: 'exec-1',
    tileIndex: null,
    endpointPath: u.pathname,
    method: 'POST',
    url: u,
    headers: { 'x-gmt-worker-key': SENTINELS.camoufox.reveal(), 'content-type': 'application/json' },
    body: '{}',
    cache: 'never',
    signal: new AbortController().signal,
    recordFixtures: false,
    ...over,
  };
}
// why: the camoufox limits at their list-mode values (105 s: the page timeout plus 15 s), reading pagesLoaded
const kitWith = () => makeKit({ overrides: { camoufox: { requestTimeoutSeconds: 105, pageCountOf } } });
const reserves = (events: LedgerEvent[]) => events.flatMap((e) => (e.type === 'reserve' ? [e] : []));
const finals = (events: LedgerEvent[]) => events.flatMap((e) => (e.type === 'finalise' ? [e] : []));
const contacted = { 'x-gmt-google-contacted': '1' };

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});

describe('runAttempt: the request’s planned pages reach reserve (spec rev 56 §5.1, §5.3)', () => {
  it('pages 2 is asked of the reservation; a request without pages asks nothing (the guard’s default of 1)', async () => {
    const { kit, events } = kitWith();
    server.use(http.post(FLIGHTS, () => HttpResponse.json({ ok: true }, { headers: contacted })));
    await kit.request(workerReq(FLIGHTS, { pages: 2 }));
    await kit.request(workerReq(`${FLIGHTS}?n=2`, {}));
    const [withPages, without] = reserves(events);
    expect(withPages?.pages).toBe(2);
    expect(without).toBeDefined();
    expect(without !== undefined && 'pages' in without).toBe(false);
  });
});

describe('runAttempt: a request’s own timeout overrides the provider’s for that attempt only (spec rev 56 §5.3)', () => {
  beforeEach(useFakeTime);

  it('a 700 s answer under requestTimeoutSeconds 780 arrives; the provider’s 105 s would have ended it', async () => {
    const { kit, budget } = kitWith();
    server.use(
      http.post(FLIGHTS, ({ request }) =>
        respondAfter(request, 700_000, () => HttpResponse.json({ ok: true }, { headers: contacted })),
      ),
    );
    const res = await drive(kit.request(workerReq(FLIGHTS, { requestTimeoutSeconds: 780 })), {
      stepMs: 1000,
      maxMs: 900_000,
    });
    expect(res.status).toBe(200);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:ok']);
  });
  it('an answer that never comes ends at 780 s with the override, and the next request keeps the provider’s 105 s', async () => {
    const { kit, events } = kitWith();
    server.use(
      http.post(FLIGHTS, ({ request }) => hangUntilAborted(request)),
      http.post(PAGE, ({ request }) => hangUntilAborted(request)),
    );
    const first = await driveError(kit.request(workerReq(FLIGHTS, { requestTimeoutSeconds: 780 })), {
      stepMs: 1000,
      maxMs: 900_000,
    });
    expect(first).toMatchObject({ kind: 'network', message: expect.stringContaining('[timeout]') });
    const second = await driveError(kit.request(workerReq(PAGE)), { stepMs: 1000, maxMs: 900_000 });
    expect(second).toMatchObject({ kind: 'network', message: expect.stringContaining('[timeout]') });
    // why: retryTransport false, so one attempt each; the durations are the two bounds exactly under fake time
    expect(finals(events).map((f) => [f.outcome, f.durationMs])).toEqual([
      ['unknown', 780_000],
      ['unknown', 105_000],
    ]);
  });
});

describe('runAttempt: the answer’s pagesLoaded is the attempt’s pageCount (spec rev 56 §5.3, R-zero)', () => {
  it.each([
    ['a flights answer stating 2', 200, { kind: 'flights', pagesLoaded: 2 }, 2],
    ['a flights answer stating 0 (the first load refused)', 200, { kind: 'flights', pagesLoaded: 0 }, 0],
    [
      'a blocked answer stating 1',
      423,
      { kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z', pagesLoaded: 1 },
      1,
    ],
    ['a not-ready answer stating 2', 504, { kind: 'not-ready', elapsedMs: 90_000, pagesLoaded: 2 }, 2],
  ])('%s → finalise carries that pageCount', async (_n, status, body, n) => {
    const { kit, events, budget } = kitWith();
    server.use(http.post(FLIGHTS, () => HttpResponse.json(body, { status, headers: contacted })));
    await kit.request(workerReq(FLIGHTS, { pages: 2 })).catch(() => undefined);
    expect(finals(events).map((f) => f.pageCount)).toEqual([n]);
    expect(budget.rowsOf('camoufox').map((r) => [r.pages, r.pageCount])).toEqual([[2, n]]);
  });
  it('an answer without pagesLoaded carries no pageCount (the guard then writes 1 on a contacted page)', async () => {
    const { kit, events } = kitWith();
    server.use(http.post(FLIGHTS, () => HttpResponse.json({ kind: 'flights' }, { headers: contacted })));
    await kit.request(workerReq(FLIGHTS));
    const [f] = finals(events);
    expect(f).toBeDefined();
    expect(f !== undefined && 'pageCount' in f).toBe(false);
    expect(f?.pageClass).toBe('page');
  });
  it('an unknown attempt (a timeout, no body) carries no pageCount', async () => {
    useFakeTime();
    const { kit, events } = kitWith();
    server.use(http.post(FLIGHTS, ({ request }) => hangUntilAborted(request)));
    await driveError(kit.request(workerReq(FLIGHTS, { pages: 2 })), { stepMs: 1000, maxMs: 200_000 });
    const [f] = finals(events);
    expect(f?.outcome).toBe('unknown');
    expect(f !== undefined && 'pageCount' in f).toBe(false);
  });
  it('a provider without pageCountOf passes none, whatever the body says', async () => {
    // why: testLimits' camoufox reads pagesLoaded as camoufoxHttpLimits does; these limits name no reader
    const { pageCountOf: _reader, ...camoufox } = testLimits().camoufox;
    const { kit, events } = makeKit({ limits: { ...testLimits(), camoufox } });
    server.use(http.post(FLIGHTS, () => HttpResponse.json({ pagesLoaded: 2 }, { headers: contacted })));
    await kit.request(workerReq(FLIGHTS));
    const [f] = finals(events);
    expect(f !== undefined && 'pageCount' in f).toBe(false);
  });
});
