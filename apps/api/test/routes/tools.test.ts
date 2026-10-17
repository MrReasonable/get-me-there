// Spec §10, §7 `POST /api/tools/record` inside the app process.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiContract, FIXTURE_OPT_IN_PHRASE } from '@gmt/core';
import { MIGRATIONS_DIR } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from '../../src/bootstrap/tool.js';
import type { ToolRunResponse } from '../../src/routes/types.js';
import { inProcessTools } from '../../src/tools/inProcess.js';
import type { runRecord } from '../../src/tools/record.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { cleanEnv, SENTINEL_SA, SENTINEL_TP, silentLog } from '../helpers/env.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { onCleanup, tempDir } from '../helpers/tmp.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(opts: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  h = await createHarness(opts);
  return h;
}

const TOOL = apiContract.toolRunResponseSchema;
const ok: ToolRunResponse = {
  exitCode: 0,
  summary: 'done',
  lines: ['1 call'],
  fixturesWritten: ['fixtures/recorded/x.json'],
};
const body = { budget: 5, origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'], month: '2027-03' };

describe('POST /api/tools/record (spec §10, §7 app_lock)', () => {
  it('requires auth', async () => {
    const x = await harness({ app: { tools: { record: async () => ok } } });
    expect((await x.request('/api/tools/record', { method: 'POST', json: body, auth: false })).status).toBe(
      401,
    );
  });

  it('503 when the runner is not registered; the smoke route is not mounted by WP8', async () => {
    const x = await harness();
    const res = await x.request('/api/tools/record', { method: 'POST', json: body });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('tool_unavailable');
    const smoke = await x.request('/api/tools/smoke', {
      method: 'POST',
      json: { origin: 'LHR', destination: 'JFK' },
    });
    expect((await errorOf(smoke)).code).toBe('not_found');
  });

  it('runs the registered runner with the validated arguments', async () => {
    const record = vi.fn(async (_args: unknown, _signal: AbortSignal) => ok);
    const x = await harness({ app: { tools: { record } } });
    const res = await x.request('/api/tools/record', { method: 'POST', json: body });
    expect(await expectContract(res, 'POST', '/api/tools/record', TOOL)).toEqual(ok);
    expect(record.mock.calls[0]?.[0]).toEqual(body);
    expect(
      (await x.request('/api/tools/record', { method: 'POST', json: { ...body, budget: 0 } })).status,
    ).toBe(400);
  });

  it('one tool at a time', async () => {
    let release: (() => void) | undefined;
    const slow = () => new Promise<ToolRunResponse>((resolve) => (release = () => resolve(ok)));
    const x = await harness({ app: { tools: { record: slow } } });
    const first = x.request('/api/tools/record', { method: 'POST', json: body });
    await vi.waitFor(() => expect(release).toBeDefined());
    const busy = await x.request('/api/tools/record', { method: 'POST', json: body });
    expect(busy.status).toBe(409);
    expect((await errorOf(busy)).code).toBe('tool_busy');
    release?.();
    expect((await first).status).toBe(200);
  });

  it('a failing runner answers 500 tool_failed without leaking URLs or secrets', async () => {
    const x = await harness({
      app: {
        tools: {
          record: async () =>
            Promise.reject(new Error('GET https://example.test/x?api_key=SENTINEL-TOOL failed')),
        },
      },
    });
    const res = await x.request('/api/tools/record', { method: 'POST', json: body });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('tool_failed');
    expect(text).not.toContain('SENTINEL-TOOL');
    expect(x.logLines.join('')).not.toContain('SENTINEL-TOOL');
  });

  it('the in-process runner refuses with the CLI exit code while the synthetic gate is open (70)', async () => {
    const x = await harness();
    const record = inProcessTools(x.ports).record;
    expect(record).toBeDefined();
    const r = await record?.(apiContract.toolRecordRequestSchema.parse(body), new AbortController().signal);
    expect(r).toMatchObject({ exitCode: 70, fixturesWritten: [] });
    expect(TOOL.safeParse(r).success).toBe(true);
  });
});

describe('the in-process runner outside the synthetic gate (plan exit-code table)', () => {
  it('refuses another route with 64 and a configuration without both vendors with 78, before any call', async () => {
    const dbPath = join(tempDir('gmt-tools-'), 'app.db');
    const config = loadConfigFromEnv(
      cleanEnv({
        NODE_ENV: 'development',
        DATABASE_PATH: dbPath,
        BIND_ADDRESS: '127.0.0.1',
        LOG_LEVEL: 'error',
      }),
    );
    const ports = buildPorts(config, { log: silentLog, migrationsDir: MIGRATIONS_DIR });
    onCleanup(() => ports.db.close());
    const record = inProcessTools(ports).record;
    const signal = new AbortController().signal;
    const other = apiContract.toolRecordRequestSchema.parse({
      ...body,
      origins: ['LGW'],
      destinations: ['EWR'],
    });
    expect(await record?.(other, signal)).toMatchObject({ exitCode: 64, fixturesWritten: [] });
    expect(await record?.(apiContract.toolRecordRequestSchema.parse(body), signal)).toMatchObject({
      exitCode: 78,
    });
  });
});

describe('the in-process runner: refusal order, scrubbed lines and relative paths (reviews SEC-7, arch-010)', () => {
  const argv = (b: {
    budget: number;
    origins: readonly string[];
    destinations: readonly string[];
    month: string;
  }) => [
    '--budget',
    String(b.budget),
    '--route',
    `${b.origins.join(',')}:${b.destinations.join(',')}`,
    '--month',
    b.month,
  ];
  const vendors = { TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd' };

  function portsFor(env: Record<string, string>, file = 'app.db') {
    const fullEnv = cleanEnv({
      NODE_ENV: 'development',
      DATABASE_PATH: join(tempDir('gmt-tools-'), file),
      BIND_ADDRESS: '127.0.0.1',
      LOG_LEVEL: 'error',
      ...env,
    });
    const ports = buildPorts(loadConfigFromEnv(fullEnv), { log: silentLog, migrationsDir: MIGRATIONS_DIR });
    onCleanup(() => ports.db.close());
    return { ports, env: fullEnv };
  }

  it.each([
    ['an open synthetic gate', { ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE }, 'app.fixture.db', body, 70],
    ['another route', {}, 'app.db', { ...body, origins: ['LGW'], destinations: ['EWR'] }, 64],
    ['no vendor keys', {}, 'app.db', body, 78],
  ] as const)('%s: the same exit code as runTool', async (_label, extra, file, args, code) => {
    const { ports, env } = portsFor(extra, file);
    const lines: string[] = [];
    const cli = await runTool('record', argv(args), {
      env,
      err: (l) => lines.push(l),
      out: (l) => lines.push(l),
    });
    const http = await inProcessTools(ports).record?.(
      apiContract.toolRecordRequestSchema.parse(args),
      new AbortController().signal,
    );
    expect([cli, http?.exitCode]).toEqual([code, code]);
  });

  it('every line has URL queries and secrets scrubbed, and fixturesWritten is relative to the recorded root', async () => {
    const { ports } = portsFor(vendors);
    const root = join(tempDir('gmt-rec-'), 'fixtures', 'recorded');
    const fake: typeof runRecord = async (_ports, _cli, o) => {
      o.out(`GET https://api.example.test/v1?token=${SENTINEL_TP} 200`);
      o.err(`key ${SENTINEL_SA} rejected`);
      mkdirSync(join(o.recordedRoot, 'travelpayouts'), { recursive: true });
      writeFileSync(join(o.recordedRoot, 'travelpayouts', 'x.json'), '{}');
      return 0;
    };
    const r = await inProcessTools(ports, {
      recording: { root, recordedBy: 'test' },
      runRecord: fake,
    }).record?.(apiContract.toolRecordRequestSchema.parse(body), new AbortController().signal);
    expect(r?.exitCode).toBe(0);
    expect(r?.fixturesWritten).toEqual([join('travelpayouts', 'x.json')]);
    const text = JSON.stringify(r);
    for (const leak of [SENTINEL_TP, SENTINEL_SA, 'token=', root]) expect(text).not.toContain(leak);
  });
});
