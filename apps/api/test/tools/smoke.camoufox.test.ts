// WP14 Task 14.13: the smoke's camoufox rows, offline, against a scripted worker (its /v1/status and /v1/page) through
// the real adapter, http-kit and SqliteBudgetGuard. No Google page is loaded and no vendor is called.
import { asIata, asIsoDateTime, fixedClock } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSmoke, type SmokeResult } from '../../src/tools/smoke.js';
import { EXIT } from '../../src/tools/types.js';
import { buildPorts, loadConfigFromEnv, type Ports } from '../../src/wiring.js';
import { silentLog, testEnv } from '../helpers/env.js';
import { onCleanup, tempRecordedRoot } from '../helpers/tmp.js';

const NOW = asIsoDateTime('2027-02-10T09:00:00.000Z');
const KEY = 'test-camoufox-worker-key-0123456789abcdef';
const WORKER = 'http://127.0.0.1:8090';
const versions = {
  selectors: '2026-10-18-results',
  grammar: '2026-10-18-feasibility',
  camoufoxJs: '0.11.5',
  binary: '152.0.4-beta.28',
};
const STATUS = {
  ok: true,
  coolingDownUntil: null,
  cooldownCause: null,
  signedInRefusal: false,
  lastPageAt: null,
  busySince: null,
  versions,
  flags: { RESULTS_VERIFIED: true, FORM_VERIFIED: true, SOCS_STABLE: true },
  accountCookie: { found: false, names: [], checkedAt: NOW },
  socsCapturedAt: '2027-01-10T09:00:00.000Z',
  socsStable: true,
  cooldownHours: 48,
  pageTimeoutSeconds: 90,
};
const cells = (o: Record<string, unknown> = {}) => ({
  kind: 'cells',
  fetchedAt: NOW,
  currency: 'GBP',
  pointOfSale: 'GB',
  notes: [],
  versions,
  cell: {
    status: 'price',
    amountMinor: 45100,
    tabMinor: 45100,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    returnDateFrom: 'query-and-form',
    ...o,
  },
});
type Answer = { status: number; body: unknown; contacted?: boolean; headers?: Record<string, string> };

function ports(env: Record<string, string> = {}): Ports {
  const p = buildPorts(
    loadConfigFromEnv(
      testEnv({
        TRAVELPAYOUTS_TOKEN: '',
        SEARCHAPI_KEY: '',
        CAMOUFOX_ENABLED: 'true',
        CAMOUFOX_WORKER_URL: WORKER,
        CAMOUFOX_WORKER_KEY: KEY,
        ...env,
      }),
    ),
    { log: silentLog, clock: fixedClock(NOW), migrationsDir: MIGRATIONS_DIR },
  );
  onCleanup(() => p.db.close());
  seedAirports(p.db, loadAirportsDataset(AIRPORTS_DATA_DIR));
  return p;
}
function worker(o: { status?: unknown | 'down'; pages?: Answer[] }) {
  const seen: string[] = [];
  const pages = [...(o.pages ?? [{ status: 200, body: cells(), contacted: true }])];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    seen.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.origin !== WORKER) throw new TypeError(`no stand-in for ${url.origin}`);
    if (new Headers(init?.headers).get('x-gmt-worker-key') !== KEY)
      return new Response(null, { status: 401 });
    if (url.pathname === '/v1/status') {
      if (o.status === 'down')
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      return Response.json(o.status ?? STATUS, { headers: { 'x-gmt-google-contacted': '0' } });
    }
    const a = pages.shift() ?? { status: 200, body: cells(), contacted: true };
    return Response.json(a.body, {
      status: a.status,
      headers: { 'x-gmt-google-contacted': a.contacted === true ? '1' : '0', ...a.headers },
    });
  });
  onCleanup(() => vi.unstubAllGlobals());
  return seen;
}
async function smoke(p: Ports): Promise<SmokeResult> {
  const { root } = tempRecordedRoot();
  const run = runSmoke(
    p,
    {
      args: { origin: asIata('LHR'), destination: asIata('JFK'), budget: 4 },
      confirmRerun: false,
      dryRun: false,
    },
    {
      signal: new AbortController().signal,
      fixtures: { root, recordedBy: '@gmt/api smoke:live (test)' },
    },
  );
  // why: the worker's spacing is the limiter's minimum interval (30 s) and a 429 waits its Retry-After: fake time
  let done = false;
  void run.finally(() => {
    done = true;
  });
  for (let i = 0; i < 400 && !done; i++) await vi.advanceTimersByTimeAsync(500);
  return run;
}
const row = (r: SmokeResult, name: string) => r.checks.find((c) => c.name === name);

beforeEach(() => {
  expect.hasAssertions();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('smoke: camoufox rows (brief Task 14.13; cost-013, prov-014, TS-19)', { timeout: 60_000 }, () => {
  it('a healthy worker and a priced page: every row ok or look, one page row, exit 0', async () => {
    const p = ports();
    const seen = worker({});
    const r = await smoke(p);
    expect(seen).toEqual(['GET /v1/status', 'POST /v1/page']);
    expect(Object.fromEntries(r.checks.map((c) => [c.name, c.status]))).toEqual({
      'camoufox worker': 'pass',
      'camoufox signed out': 'pass',
      'camoufox consent': 'pass',
      'camoufox settings match': 'pass',
      'camoufox one page': 'pass',
      'camoufox not blocked': 'pass',
      'camoufox cell': 'pass',
      'camoufox partial': 'pass',
      'camoufox provenance': 'pass',
      'camoufox selectors': 'pass',
      'camoufox compare': 'look',
    });
    expect(row(r, 'camoufox cell')?.detail).toContain('(the date asked for, shown in the search form)');
    expect(row(r, 'camoufox signed out')?.detail).toContain(`checked ${NOW}`);
    expect(r.exitCode).toBe(EXIT.ok);
  });
  it('camoufox worker: unreachable is FAIL', async () => {
    const p = ports();
    worker({ status: 'down' });
    const r = await smoke(p);
    expect(row(r, 'camoufox worker')).toMatchObject({ status: 'fail' });
    expect(r.exitCode).toBe(EXIT.failed);
  });
  it('camoufox worker: another camoufox-js version is FAIL', async () => {
    const p = ports();
    worker({ status: { ...STATUS, versions: { ...versions, camoufoxJs: '0.12.0' } } });
    expect(row(await smoke(p), 'camoufox worker')?.status).toBe('fail');
  });
  it('camoufox signed out: an account cookie is FAIL with its names; a signed-in refusal is FAIL', async () => {
    const a = ports();
    worker({ status: { ...STATUS, accountCookie: { found: true, names: ['SID'], checkedAt: NOW } } });
    expect(row(await smoke(a), 'camoufox signed out')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('SID'),
    });
    vi.unstubAllGlobals();
    const b = ports();
    worker({ status: { ...STATUS, signedInRefusal: true } });
    expect(row(await smoke(b), 'camoufox signed out')?.status).toBe('fail');
  });
  it('camoufox consent: look while SOCS stability is unproved; FAIL with no capture or a cookie page', async () => {
    const a = ports();
    worker({ status: { ...STATUS, socsStable: false } });
    expect(row(await smoke(a), 'camoufox consent')?.status).toBe('look');
    vi.unstubAllGlobals();
    const b = ports();
    worker({ status: { ...STATUS, socsCapturedAt: null } });
    expect(row(await smoke(b), 'camoufox consent')?.status).toBe('fail');
    vi.unstubAllGlobals();
    const c = ports();
    worker({
      pages: [
        {
          status: 423,
          body: { kind: 'blocked', page: 'consent-unhandled', cooldownUntil: '2027-02-12T09:00:00.000Z' },
          contacted: true,
        },
      ],
    });
    expect(row(await smoke(c), 'camoufox consent')?.status).toBe('fail');
  });
  it('camoufox settings match: a mismatch is FAIL with both values', async () => {
    const p = ports({ CAMOUFOX_COOLDOWN_HOURS: '72' });
    worker({});
    expect(row(await smoke(p), 'camoufox settings match')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('cool-down 48 h (app 72)'),
    });
  });
  it('camoufox one page: a 429 then cells is one page row, the spacing wait printed', async () => {
    const p = ports();
    worker({
      pages: [
        { status: 429, body: { kind: 'spacing', retryAfterSeconds: 1 }, headers: { 'retry-after': '1' } },
        { status: 200, body: cells(), contacted: true },
      ],
    });
    const r = await smoke(p);
    expect(row(r, 'camoufox one page')).toEqual({
      name: 'camoufox one page',
      status: 'pass',
      detail: '1 page(s) loaded; 1 spacing wait(s) or refusals that loaded no page',
    });
    expect(row(r, 'camoufox not blocked')?.status).toBe('pass');
  });
  it('camoufox not blocked: a block is FAIL, exit 1, the cool-down end printed and every further page refused', async () => {
    const p = ports();
    worker({
      pages: [
        {
          status: 423,
          body: { kind: 'blocked', page: 'captcha', cooldownUntil: '2027-02-12T09:00:00.000Z' },
          contacted: true,
        },
      ],
    });
    const r = await smoke(p);
    expect(row(r, 'camoufox not blocked')?.status).toBe('fail');
    expect(r.exitCode).toBe(EXIT.failed);
    expect(r.lines).toContain(
      'camoufox is cooling down until 2027-02-12T09:00:00.000Z; every further page will be refused until then',
    );
    for (const name of ['camoufox cell', 'camoufox partial', 'camoufox provenance', 'camoufox compare'])
      expect(row(r, name), name).toMatchObject({ status: 'skip', detail: 'blocked' });
  });
  it('camoufox not blocked: cooling-down is FAIL and loaded no page', async () => {
    const p = ports();
    worker({
      status: { ...STATUS, coolingDownUntil: '2027-02-12T09:00:00.000Z', cooldownCause: 'captcha' },
      pages: [
        {
          status: 423,
          body: { kind: 'cooling-down', cause: 'captcha', cooldownUntil: '2027-02-12T09:00:00.000Z' },
        },
      ],
    });
    const r = await smoke(p);
    expect(row(r, 'camoufox not blocked')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('cooling down until 2027-02-12T09:00:00.000Z'),
    });
    expect(row(r, 'camoufox one page')?.status).toBe('look');
  });
  it('camoufox partial: dropped options are look with the detail', async () => {
    const p = ports();
    worker({ pages: [{ status: 200, body: cells({ optionsUnparsed: 2 }), contacted: true }] });
    expect(row(await smoke(p), 'camoufox partial')).toMatchObject({
      status: 'look',
      detail: expect.stringContaining('options unread: 2'),
    });
  });
  it('camoufox cell: a no-flights page is look; provenance holds', async () => {
    const p = ports();
    worker({
      pages: [{ status: 200, body: { ...cells(), cell: { status: 'no-flights' } }, contacted: true }],
    });
    const r = await smoke(p);
    expect(row(r, 'camoufox cell')?.status).toBe('look');
    expect(row(r, 'camoufox provenance')?.status).toBe('pass');
  });
  it('camoufox selectors: an unverified flag is look naming it; an unreadable status is FAIL', async () => {
    const a = ports();
    worker({ status: { ...STATUS, flags: { FORM_VERIFIED: true, RESULTS_VERIFIED: false } } });
    expect(row(await smoke(a), 'camoufox selectors')).toMatchObject({
      status: 'look',
      detail: expect.stringContaining('still unverified: RESULTS_VERIFIED'),
    });
    vi.unstubAllGlobals();
    const b = ports();
    worker({ status: { ok: true } });
    expect(row(await smoke(b), 'camoufox selectors')?.status).toBe('fail');
  });
  it('not configured: every camoufox row is skip', async () => {
    const p = ports({
      CAMOUFOX_ENABLED: 'false',
      TRAVELPAYOUTS_TOKEN: 'test-travelpayouts-token-0123456789abcdef',
    });
    vi.stubGlobal('fetch', async () => Response.json({ success: true, data: [], currency: 'gbp' }));
    onCleanup(() => vi.unstubAllGlobals());
    const r = await smoke(p);
    const cf = r.checks.filter((c) => c.name.startsWith('camoufox'));
    expect(cf).toHaveLength(11);
    expect(cf.every((c) => c.status === 'skip' && c.detail === 'not configured')).toBe(true);
  });
});
