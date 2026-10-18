import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { camoufoxProvider } from '../../src/camoufox/index.js';
import { makeKit, SENTINELS } from '../fakes.js';
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
      },
    ],
    [
      'a signed-in refusal',
      status({ ok: false, signedInRefusal: true }),
      { ok: false, skip: 'provider_disabled', detail: 'signed-in profile refused' },
    ],
    [
      'an account cookie',
      status({ ok: false, accountCookie: { found: true, names: ['SID'], checkedAt: AT } }),
      { ok: false, skip: 'provider_disabled', detail: 'signed-in profile refused' },
    ],
    ['healthy', status(), { ok: true }],
    [
      'an unreadable status',
      { ok: true },
      {
        ok: false,
        skip: 'provider_unavailable',
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
  it('worker down → provider_unavailable, no row', async () => {
    const { p, budget } = setup();
    server.use(http.get(STATUS_URL, () => HttpResponse.error()));
    expect(await p.discovery?.preflight?.(ctx)).toEqual({
      ok: false,
      skip: 'provider_unavailable',
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
