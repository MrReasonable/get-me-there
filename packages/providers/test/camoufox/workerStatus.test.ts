// readWorkerStatus split out of the preflight (decision 76; WP16a Task 16a.6), the preflight's shared-settings check
// through core's sharedSettingDiffs (spec §12), and the app-instance header (decision 82). msw stands in for the worker.
import { AbortedError, APP_INSTANCE_HEADER, effectiveSharedSettings, type SharedSettings } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { camoufoxProvider } from '../../src/camoufox/index.js';
import { readWorkerStatus } from '../../src/camoufox/preflight.js';
import { hangUntilAborted } from '../../src/testing/network.js';
import { makeKit, SENTINELS, testLimits } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const WORKER = 'http://127.0.0.1:8090';
const STATUS_URL = `${WORKER}/v1/status`;
const PAGE_URL = `${WORKER}/v1/page`;
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
  socsStable: true,
  cooldownHours: 48,
  pageTimeoutSeconds: 90,
  ...o,
});
const ctx = { executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: false };
/** The provider's preflight, driven on fake time (CodeRabbit R43: the http-kit limiter and timeouts never run on the
 * real clock here). */
function preflightOf(p: ReturnType<typeof camoufoxProvider>) {
  const preflight = p.discovery?.preflight;
  if (preflight === undefined) throw new Error('no preflight');
  return drive(preflight(ctx));
}

afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
beforeEach(() => {
  expect.hasAssertions();
});

describe('readWorkerStatus (decision 76): one read, four kinds, never a ledger row', () => {
  it.each([
    ['ok', () => HttpResponse.json(status()), { kind: 'ok', status: status() }],
    ['unreachable', () => HttpResponse.error(), { kind: 'unreachable' }],
    [
      'refused (the key, 401)',
      () => new HttpResponse(null, { status: 401 }),
      { kind: 'refused', errorKind: 'auth', httpStatus: 401 },
    ],
    [
      'refused (the key, 403: the classifier says auth too)',
      () => new HttpResponse(null, { status: 403 }),
      { kind: 'refused', errorKind: 'auth', httpStatus: 403 },
    ],
    [
      'refused (an error answer)',
      () => HttpResponse.json({}, { status: 503 }),
      { kind: 'refused', errorKind: 'upstream', httpStatus: 503 },
    ],
    ['unreadable', () => HttpResponse.json({ ok: true }), { kind: 'unreadable' }],
  ] as const)('%s', async (_label, answer, expected) => {
    useFakeTime();
    const { kit, budget } = makeKit();
    server.use(http.get(STATUS_URL, answer));
    expect(
      await drive(
        readWorkerStatus({
          http: kit,
          key: SENTINELS.camoufox,
          url: WORKER,
          signal: new AbortController().signal,
        }),
      ),
    ).toEqual(expected);
    expect(budget.rows).toEqual([]);
  });

  it('a caller’s 2 s deadline ends a read the worker never answers (fake timers): the abort propagates', async () => {
    useFakeTime();
    const { kit } = makeKit();
    server.use(http.get(STATUS_URL, ({ request }) => hangUntilAborted(request)));
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 2000);
    const started = Date.now();
    expect(
      await driveError(
        readWorkerStatus({ http: kit, key: SENTINELS.camoufox, url: WORKER, signal: ac.signal }),
      ),
    ).toBeInstanceOf(AbortedError);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('takes no camoufox rate-limiter token: after 100 status reads a page acquires its slot without waiting', async () => {
    useFakeTime();
    // why: the page limiter at one page a minute, so a page that had to wait for a slot would take fake minutes
    const { kit } = makeKit({
      limits: testLimits({ camoufox: { ratePerMinute: 1, ratePerHour: 60, minIntervalMs: 60_000 } }),
    });
    server.use(
      http.get(STATUS_URL, () => HttpResponse.json(status())),
      http.post(PAGE_URL, () => HttpResponse.json({ any: 'body' })),
    );
    for (let i = 0; i < 100; i++)
      expect(
        (
          await drive(
            readWorkerStatus({
              http: kit,
              key: SENTINELS.camoufox,
              url: WORKER,
              signal: new AbortController().signal,
            }),
          )
        ).kind,
      ).toBe('ok');
    const before = Date.now();
    await drive(
      kit.request({
        providerId: 'camoufox',
        executionId: 'exec-1',
        tileIndex: 0,
        endpointPath: '/v1/page',
        method: 'POST',
        url: new URL(PAGE_URL),
        headers: { 'x-gmt-worker-key': SENTINELS.camoufox.reveal(), 'content-type': 'application/json' },
        body: '{}',
        cache: 'never',
        signal: new AbortController().signal,
        recordFixtures: false,
      }),
    );
    expect(Date.now() - before).toBeLessThan(1000);
  });
});

describe('a refusal keeps the classifier’s kind (R33)', () => {
  it.each([
    [401, 'provider_disabled', 'the worker refused CAMOUFOX_WORKER_KEY (the app and worker.env differ)'],
    [403, 'provider_disabled', 'the worker refused CAMOUFOX_WORKER_KEY (the app and worker.env differ)'],
    [503, 'provider_unavailable', 'the browser worker answered HTTP 503'],
  ] as const)('HTTP %i: %s', async (code, skip, detail) => {
    useFakeTime();
    server.use(http.get(STATUS_URL, () => new HttpResponse(null, { status: code })));
    const { kit, log, clock } = makeKit();
    const p = camoufoxProvider({
      http: kit,
      log,
      clock,
      key: SENTINELS.camoufox,
      workerUrl: WORKER,
      pointOfSale: 'GB',
      sharedSettings: effectiveSharedSettings({}),
      appInstance: 'd'.repeat(36),
    });
    expect(await preflightOf(p)).toEqual({ ok: false, skip, detail });
  });
});

describe('the preflight compares the shared settings through sharedSettingDiffs (spec §12)', () => {
  const app = effectiveSharedSettings({});
  function provider(mode: 'list' | 'grid', sharedSettings: SharedSettings = app) {
    const { kit, budget, log, clock, events } = makeKit();
    const p = camoufoxProvider({
      http: kit,
      log,
      clock,
      key: SENTINELS.camoufox,
      workerUrl: WORKER,
      pointOfSale: 'GB',
      sharedSettings,
      appInstance: 'a'.repeat(64),
      grid: {
        mode,
        executionPageCap: 100,
        executionScrollCap: 600,
        scrollCap: 30,
        scrollSpacingSeconds: 5,
        pageTimeoutSeconds: 90,
      },
    });
    return { p, budget, events };
  }
  const grid = {
    gridStepDays: { departures: 1, returns: 1 },
    gridScrollCap: 30,
    gridScrollSpacingSeconds: 5,
  };

  it.each(['list', 'grid'] as const)(
    '%s mode: any differing name skips the provider provider_disabled, naming the settings only',
    async (mode) => {
      useFakeTime();
      const { p, budget } = provider(mode);
      const worker = effectiveSharedSettings({ CAMOUFOX_MONTHLY_PAGE_CAP: '900', POINT_OF_SALE: 'US' });
      server.use(http.get(STATUS_URL, () => HttpResponse.json(status({ ...grid, sharedSettings: worker }))));
      expect(await preflightOf(p)).toEqual({
        ok: false,
        skip: 'provider_disabled',
        detail: 'settings differ: CAMOUFOX_MONTHLY_PAGE_CAP, POINT_OF_SALE',
      });
      expect(budget.rows).toEqual([]);
    },
  );

  it('the grid-only two differ only in grid mode', async () => {
    useFakeTime();
    const worker = effectiveSharedSettings({ CAMOUFOX_GRID_SCROLL_CAP: '12' });
    server.use(http.get(STATUS_URL, () => HttpResponse.json(status({ ...grid, sharedSettings: worker }))));
    expect(await preflightOf(provider('list').p)).toEqual({ ok: true });
    expect(await preflightOf(provider('grid').p)).toEqual({
      ok: false,
      skip: 'provider_disabled',
      detail: 'settings differ: CAMOUFOX_GRID_SCROLL_CAP',
    });
  });

  it.each(['list', 'grid'] as const)(
    '%s mode: a worker.env with no monthly-cap and no billing-day lines beside an app config with none passes',
    async (mode) => {
      useFakeTime();
      // why: the operator's current worker.env: only the key, the port, the spacing and (for grid) the grid lines
      const worker = effectiveSharedSettings({
        CAMOUFOX_COOLDOWN_HOURS: '48',
        CAMOUFOX_PAGE_TIMEOUT_SECONDS: '90',
        ...(mode === 'grid'
          ? {
              CAMOUFOX_MODE: 'grid',
              CAMOUFOX_GRID_SCROLL_CAP: '30',
              CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '5',
            }
          : {}),
      });
      const appSide = effectiveSharedSettings(mode === 'grid' ? { CAMOUFOX_MODE: 'grid' } : {});
      server.use(http.get(STATUS_URL, () => HttpResponse.json(status({ ...grid, sharedSettings: worker }))));
      expect(await preflightOf(provider(mode, appSide).p)).toEqual({ ok: true });
    },
  );

  it('a worker too old to report sharedSettings falls back to the grid-only comparison', async () => {
    useFakeTime();
    server.use(http.get(STATUS_URL, () => HttpResponse.json(status({ ...grid, gridScrollCap: 12 }))));
    expect(await preflightOf(provider('list').p)).toEqual({ ok: true });
    expect(await preflightOf(provider('grid').p)).toMatchObject({
      ok: false,
      skip: 'provider_disabled',
      detail: expect.stringMatching(/^CAMOUFOX_GRID_SCROLL_CAP differs/),
    });
  });
});

describe('the app-instance header (decision 82)', () => {
  it('is sent on the status read and on every page request', async () => {
    useFakeTime();
    const seen: Array<string | null> = [];
    server.use(
      http.get(STATUS_URL, ({ request }) => {
        seen.push(request.headers.get(APP_INSTANCE_HEADER));
        return HttpResponse.json(status());
      }),
    );
    const { kit, log, clock } = makeKit();
    const p = camoufoxProvider({
      http: kit,
      log,
      clock,
      key: SENTINELS.camoufox,
      workerUrl: WORKER,
      pointOfSale: 'GB',
      sharedSettings: effectiveSharedSettings({}),
      appInstance: 'b'.repeat(64),
    });
    await preflightOf(p);
    expect(seen).toEqual(['b'.repeat(64)]);
    expect(
      await drive(
        readWorkerStatus({
          http: kit,
          key: SENTINELS.camoufox,
          url: WORKER,
          signal: new AbortController().signal,
          appInstance: 'c'.repeat(64),
        }),
      ),
    ).toMatchObject({ kind: 'ok' });
    expect(seen).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
  });
});
