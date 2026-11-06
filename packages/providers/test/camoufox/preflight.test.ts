import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { camoufoxProvider } from '../../src/camoufox/index.js';
import { FLIGHT_REQUEST_SECONDS, makeKit, SENTINELS } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const STATUS_URL = 'http://127.0.0.1:8090/v1/status';
const AT = '2026-10-18T05:00:00.000Z';
const status = (o: Record<string, unknown> = {}) => ({
  ok: true,
  coolingDownUntil: null,
  cooldownCause: null,
  signedInRefusal: false,
  lastPageAt: null,
  busySince: null,
  versions: { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' },
  flags: {},
  accountCookie: { found: false, names: [], checkedAt: AT },
  socsCapturedAt: AT,
  socsStable: false,
  cooldownHours: 48,
  pageTimeoutSeconds: 90,
  ...o,
});
const ctx = { executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: false };
function setup() {
  const { kit, budget, log, clock, events } = makeKit();
  const p = camoufoxProvider({
    http: kit,
    log,
    clock,
    key: SENTINELS.camoufox,
    workerUrl: 'http://127.0.0.1:8090',
    pointOfSale: 'GB',
    flightRequestSeconds: FLIGHT_REQUEST_SECONDS,
  });
  return { p, budget, events };
}
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
beforeEach(() => {
  expect.hasAssertions();
});

describe('camoufox preflight (spec §2; decision 69; cost-015): unledgered', () => {
  it.each([
    [
      'cooling down',
      status({ ok: false, coolingDownUntil: '2026-10-20T05:00:00.000Z', cooldownCause: 'captcha' }),
      {
        ok: false,
        skip: 'provider_disabled',
        detail: 'cooling down until 2026-10-20T05:00:00.000Z (captcha)',
        until: '2026-10-20T05:00:00.000Z',
        reason: 'captcha',
        flags: {},
      },
    ],
    [
      'a signed-in refusal',
      status({ ok: false, signedInRefusal: true }),
      {
        ok: false,
        skip: 'provider_disabled',
        detail: 'signed-in profile refused',
        reason: 'signed-in',
        flags: {},
      },
    ],
    [
      'an account cookie',
      status({ ok: false, accountCookie: { found: true, names: ['SID'], checkedAt: AT } }),
      {
        ok: false,
        skip: 'provider_disabled',
        detail: 'signed-in profile refused',
        reason: 'signed-in',
        flags: {},
      },
    ],
    ['healthy', status(), { ok: true, flags: {} }],
    [
      'an unreadable status',
      { ok: true },
      {
        ok: false,
        skip: 'provider_unavailable',
        reason: 'provider-unavailable',
        detail: "the worker's status could not be read by this build (versions differ?)",
      },
    ],
  ])('%s', async (_n, body, expected) => {
    const { p, budget, events } = setup();
    server.use(
      http.get(STATUS_URL, ({ request }) =>
        request.headers.get('x-gmt-worker-key') === SENTINELS.camoufox.reveal()
          ? HttpResponse.json(body)
          : new HttpResponse(null, { status: 401 }),
      ),
    );
    expect(await p.discovery?.preflight?.(ctx)).toEqual(expected);
    expect(budget.rows).toEqual([]);
    expect(budget.count('cache-hit')).toBe(0);
    expect(events.filter((e) => e.type === 'fetch')).toHaveLength(1);
  });
  // why: spec rev 56 §5.1, §8.1: the engine plans the return phase from the flags the worker last reported, so every read
  // that returned a status carries them, whether the preflight passes or refuses on it
  const FLAGS = { GRID_VERIFIED: true, RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false };
  it('an ok status read puts the worker’s flags on the result', async () => {
    const { p } = setup();
    server.use(http.get(STATUS_URL, () => HttpResponse.json(status({ flags: FLAGS }))));
    expect(await p.discovery?.preflight?.(ctx)).toEqual({ ok: true, flags: FLAGS });
  });
  it('a preflight refused on a status body carries the flags too', async () => {
    const { p } = setup();
    server.use(
      http.get(STATUS_URL, () =>
        HttpResponse.json(
          status({
            ok: false,
            flags: FLAGS,
            coolingDownUntil: '2026-10-20T05:00:00.000Z',
            cooldownCause: 'captcha',
          }),
        ),
      ),
    );
    expect(await p.discovery?.preflight?.(ctx)).toMatchObject({
      ok: false,
      skip: 'provider_disabled',
      flags: FLAGS,
    });
  });
  it.each([
    ['an unreadable status', () => HttpResponse.json({ ok: true, flags: FLAGS })],
    ['an HTTP refusal', () => HttpResponse.json({ flags: FLAGS }, { status: 401 })],
    ['no worker', () => HttpResponse.error()],
  ])('%s gives no flags', async (_n, answer) => {
    const { p } = setup();
    server.use(http.get(STATUS_URL, answer));
    const r = await p.discovery?.preflight?.(ctx);
    expect(r?.ok).toBe(false);
    expect(r !== undefined && 'flags' in r).toBe(false);
  });
  it('worker down → provider_unavailable, no row', async () => {
    const { p, budget } = setup();
    server.use(http.get(STATUS_URL, () => HttpResponse.error()));
    expect(await p.discovery?.preflight?.(ctx)).toEqual({
      ok: false,
      skip: 'provider_unavailable',
      reason: 'provider-unavailable',
      detail: 'browser worker not reachable',
    });
    expect(budget.rows).toEqual([]);
  });
  // why: fix round 1 (arch M9, prov M1): a wrong key is not an absent worker, and never retried on every resume
  it('a 401 (wrong CAMOUFOX_WORKER_KEY) → provider_disabled naming the key, no row', async () => {
    const { p, budget } = setup();
    server.use(http.get(STATUS_URL, () => new HttpResponse(null, { status: 401 })));
    expect(await p.discovery?.preflight?.(ctx)).toEqual({
      ok: false,
      skip: 'provider_disabled',
      detail: 'the worker refused CAMOUFOX_WORKER_KEY (the app and worker.env differ)',
      reason: 'auth',
    });
    expect(budget.rows).toEqual([]);
  });
  it('a 5xx → provider_unavailable with its own detail', async () => {
    useFakeTime();
    const { p } = setup();
    server.use(http.get(STATUS_URL, () => HttpResponse.json({}, { status: 503 })));
    expect(await drive(p.discovery?.preflight?.(ctx) ?? Promise.reject(new Error('no preflight')))).toEqual({
      ok: false,
      skip: 'provider_unavailable',
      reason: 'provider-unavailable',
      detail: 'the browser worker answered HTTP 503',
    });
  });
  it('an abort propagates', async () => {
    const { p } = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(p.discovery?.preflight?.({ ...ctx, signal: ac.signal })).rejects.toThrow(/aborted/);
  });
});
