// WP14 Task 14.13: the smoke's camoufox rows, offline, against a scripted worker (its /v1/status and /v1/page) through
// the real adapter, http-kit and SqliteBudgetGuard. No Google page is loaded and no vendor is called.
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  fixedClock,
  workerAnswerSchema,
  workerStatusSchema,
} from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { CAMOUFOX_DISCOVERY_INFO, CAMOUFOX_GRID_INFO } from '@gmt/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSmoke, type SmokeResult } from '../../src/tools/smoke.js';
import { type CamoufoxRun, camoufoxChecks } from '../../src/tools/smokeCamoufox.js';
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
    expect(row(r, 'camoufox cell')?.detail).toContain(
      "(the dates asked for; the page's search form showed them, the options state only the departure)",
    );
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

  // why: fix round 1 (TS I5, TS M7, prov M4): every row's fail arm is reached
  it('camoufox settings match: a page-timeout mismatch alone is FAIL', async () => {
    const p = ports({ CAMOUFOX_PAGE_TIMEOUT_SECONDS: '120' });
    worker({});
    expect(row(await smoke(p), 'camoufox settings match')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('page timeout 90 s (app 120)'),
    });
  });
  it('camoufox consent: a capture 396 days old passes, 397 fails', async () => {
    for (const [at, status] of [
      ['2026-01-10T09:00:00.000Z', 'pass'],
      ['2026-01-09T09:00:00.000Z', 'fail'],
    ] as const) {
      vi.unstubAllGlobals();
      const p = ports();
      worker({ status: { ...STATUS, socsCapturedAt: at } });
      expect(row(await smoke(p), 'camoufox consent')?.status, at).toBe(status);
    }
  });
  it('camoufox cell: every option for another cell is FAIL with the count', async () => {
    const p = ports();
    worker({
      pages: [
        {
          status: 200,
          body: { ...cells(), cell: { status: 'none-for-cell', optionsOtherCell: 3, optionsUnparsed: 0 } },
          contacted: true,
        },
      ],
    });
    expect(row(await smoke(p), 'camoufox cell')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('every option was for another cell (3)'),
    });
  });
  it('camoufox provenance: a page that states another point of sale is look, naming both', async () => {
    const p = ports();
    worker({ pages: [{ status: 200, body: { ...cells(), pointOfSale: 'unknown' }, contacted: true }] });
    expect(row(await smoke(p), 'camoufox provenance')).toMatchObject({
      status: 'look',
      detail: expect.stringContaining('point of sale unknown as the page stated (POINT_OF_SALE is GB)'),
    });
  });
});

// why: fix round 1 (CodeRabbit): a camoufox-only run's summary, exit code and price line say what camoufox found
describe('a camoufox-only smoke: summary, exit code and provenance', { timeout: 60_000 }, () => {
  it('a priced page is the headline, with its provenance, and the discovery line carries the same', async () => {
    const p = ports();
    worker({});
    const r = await smoke(p);
    expect(r.summary).toBe(
      'cheapest camoufox price £451 · scraped-self · fetched 2027-02-10T09:00:00.000Z · point of sale GB · GBP, not converted',
    );
    expect(r.lines).toContain(
      'camoufox discovery: priced · £451 · scraped-self · fetched 2027-02-10T09:00:00.000Z · point of sale GB · GBP, not converted',
    );
    expect(r.exitCode).toBe(EXIT.ok);
  });
  it('a no-flights page exits smokeEmpty, as a vendor tile with no price does', async () => {
    const p = ports();
    worker({
      pages: [{ status: 200, body: { ...cells(), cell: { status: 'no-flights' } }, contacted: true }],
    });
    const r = await smoke(p);
    expect(r.summary).toBe('no price found');
    expect(r.exitCode).toBe(EXIT.smokeEmpty);
  });
});

describe('camoufoxChecks fail arms on a crafted run (fix round 1, TS I5)', { timeout: 60_000 }, () => {
  const cell = {
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    departureDate: asIsoDate('2027-03-01'),
    returnDate: asIsoDate('2027-03-02'),
  };
  const base = (o: Partial<CamoufoxRun> = {}): CamoufoxRun => ({
    status: workerStatusSchema.parse(STATUS),
    statusError: null,
    cell,
    info: CAMOUFOX_DISCOVERY_INFO,
    answer: cellsAnswer(),
    tile: {
      kind: 'tile',
      index: 0,
      coveredCells: [cell],
      fetchedAt: NOW,
      pointOfSale: 'GB',
      notes: [],
      prices: [
        { ...cell, amountMinor: 45100, currency: 'GBP', returnDateSource: 'asked', vendorPriceMark: null },
      ],
      noFares: [],
    },
    ...o,
  });
  // why: WP15 Task 15.11: a grid page's rows: priced from the grid, the ledger row's scroll_count the worker's, and the
  // grid's provenance (the assumed 24 h age)
  const gridRun = (scrolls: number, over: Partial<CamoufoxRun> = {}): CamoufoxRun =>
    base({
      info: CAMOUFOX_GRID_INFO,
      answer: null,
      gridAnswer: {
        kind: 'grid',
        fetchedAt: NOW,
        currency: 'GBP',
        pointOfSale: 'GB',
        views: [],
        scrolls,
        ended: 'complete',
        notes: [],
        versions: {
          selectors: 's',
          grammar: 'g',
          camoufoxJs: '0.11.5',
          binary: 'b',
          gridGrammar: '2026-10-18',
        },
      },
      tile: {
        kind: 'tile',
        index: 0,
        coveredCells: [cell],
        fetchedAt: NOW,
        pointOfSale: 'GB',
        notes: [],
        prices: [
          {
            ...cell,
            amountMinor: 45100,
            currency: 'GBP',
            returnDateSource: 'grid-cell',
            vendorPriceMark: 'none',
          },
        ],
        noFares: [],
      },
      ...over,
    });
  it('a grid page: cell, partial and provenance pass when the row holds the scrolls; a different count is FAIL', async () => {
    const p = ports();
    worker({});
    const r = await smoke(p);
    const id = r.executionId ?? '';
    p.db.raw
      .prepare(
        "UPDATE provider_requests SET scroll_count = 1 WHERE execution_id = ? AND provider_id = 'camoufox'",
      )
      .run(id);
    const rows = camoufoxChecks(p, gridRun(1), id, NOW);
    for (const name of ['camoufox cell', 'camoufox partial', 'camoufox provenance'])
      expect(rows.find((c) => c.name === name)?.status, name).toBe('pass');
    expect(rows.find((c) => c.name === 'camoufox provenance')?.detail).toContain(
      'Google Flights date grid via Camoufox',
    );
    expect(camoufoxChecks(p, gridRun(2), id, NOW).find((c) => c.name === 'camoufox cell')?.status).toBe(
      'fail',
    );
    expect(
      camoufoxChecks(p, gridRun(1, { info: CAMOUFOX_DISCOVERY_INFO }), id, NOW).find(
        (c) => c.name === 'camoufox provenance',
      )?.status,
    ).toBe('fail');
  });
  it('two page rows → one page FAIL', async () => {
    const p = ports();
    worker({});
    const r = await smoke(p);
    const id = r.executionId ?? '';
    const names = p.db.raw
      .prepare<[string], { name: string }>('SELECT name FROM pragma_table_info(?)')
      .all('provider_requests')
      .map((c) => c.name)
      .filter((n) => n !== 'id');
    p.db.raw
      .prepare(
        `INSERT INTO provider_requests (${names.join(', ')}) SELECT ${names.join(', ')} FROM provider_requests WHERE execution_id = ? AND provider_id = 'camoufox' AND page_class = 'page'`,
      )
      .run(id);
    expect(camoufoxChecks(p, base(), id, NOW).find((c) => c.name === 'camoufox one page')).toMatchObject({
      status: 'fail',
      detail: '2 page(s) loaded',
    });
  });
  it('info with maxAgeHours 48 → provenance FAIL; a stored price not the worker’s → cell FAIL', async () => {
    const p = ports();
    const rows = camoufoxChecks(
      p,
      base({
        info: { ...CAMOUFOX_DISCOVERY_INFO, maxAgeHours: 48 },
        tile: {
          kind: 'tile',
          index: 0,
          coveredCells: [cell],
          fetchedAt: NOW,
          pointOfSale: 'GB',
          notes: [],
          prices: [
            { ...cell, amountMinor: 1, currency: 'GBP', returnDateSource: 'asked', vendorPriceMark: null },
          ],
          noFares: [],
        },
      }),
      'none',
      NOW,
    );
    expect(rows.find((c) => c.name === 'camoufox provenance')?.status).toBe('fail');
    expect(rows.find((c) => c.name === 'camoufox cell')?.status).toBe('fail');
  });
  it('a tile fetched before the run started → provenance FAIL, the fetch time and observed values printed', async () => {
    const p = ports();
    const rows = camoufoxChecks(p, base(), 'none', asIsoDateTime('2027-02-10T09:00:06.000Z'));
    expect(rows.find((c) => c.name === 'camoufox provenance')).toEqual({
      name: 'camoufox provenance',
      status: 'fail',
      detail:
        'scraped-self, maxAgeHours 0, GBP, point of sale GB as the page stated, fetched 2027-02-10T09:00:00.000Z (before this run started)',
    });
  });
  // why: fix round 2 (CodeRabbit): the same 5 s clock-skew allowance the adapter applies to fetchedAt
  it('a tile fetched within 5 s before the run started passes provenance; 6 s before fails', async () => {
    const p = ports();
    const row = (start: string) =>
      camoufoxChecks(p, base(), 'none', asIsoDateTime(start)).find((c) => c.name === 'camoufox provenance')
        ?.status;
    expect(row('2027-02-10T09:00:05.000Z')).toBe('pass');
    expect(row('2027-02-10T09:00:06.000Z')).toBe('fail');
  });
  it('a stored point of sale that is not the page’s → provenance FAIL', async () => {
    const p = ports();
    const t = base();
    const tile = t.tile?.kind === 'tile' ? { ...t.tile, pointOfSale: 'US' } : null;
    expect(
      camoufoxChecks(p, { ...t, tile }, 'none', NOW).find((c) => c.name === 'camoufox provenance')?.status,
    ).toBe('fail');
  });
});

function cellsAnswer() {
  const a = workerAnswerSchema.parse({ ...cells(), fetchedAt: NOW });
  if (a.kind !== 'cells') throw new Error('cells');
  return a;
}
