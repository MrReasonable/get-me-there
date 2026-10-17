// Spec §10 `POST /api/tools/smoke`, §13 (the operator calls it from the host with curl; the image has no curl): the
// smoke inside the app process, which holds app_lock. Mounted by WP13 (plan decision 4).
import { join } from 'node:path';
import { apiContract } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunResponse } from '../../src/routes/types.js';
import { inProcessTools } from '../../src/tools/inProcess.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { cleanEnv, SENTINEL_SA, SENTINEL_TP, silentLog } from '../helpers/env.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { stubSmokeVendors } from '../helpers/smokeVendors.js';
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
const body = { origin: 'LHR', destination: 'JFK', budget: 4 };
const ok: ToolRunResponse = { exitCode: 0, summary: 'cheapest found £1', lines: ['x'], fixturesWritten: [] };

describe('POST /api/tools/smoke (spec §10, §13)', () => {
  it('requires auth; 503 when the runner is not registered', async () => {
    const x = await harness();
    expect((await x.request('/api/tools/smoke', { method: 'POST', json: body, auth: false })).status).toBe(
      401,
    );
    const res = await x.request('/api/tools/smoke', { method: 'POST', json: body });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('tool_unavailable');
  });

  it('validates the body, then runs the runner with the upper-cased airports and answers the contract', async () => {
    const smoke = vi.fn(async (_args: unknown, _signal: AbortSignal) => ok);
    const x = await harness({ app: { tools: { smoke } } });
    for (const bad of [
      { ...body, origin: 'L1R' },
      { origin: 'LHR', destination: 'JFK' },
      { ...body, budget: 0 },
    ])
      expect((await x.request('/api/tools/smoke', { method: 'POST', json: bad })).status).toBe(400);
    const res = await x.request('/api/tools/smoke', { method: 'POST', json: { ...body, origin: 'lhr' } });
    expect(await expectContract(res, 'POST', '/api/tools/smoke', TOOL)).toEqual(ok);
    expect(smoke.mock.calls[0]?.[0]).toEqual(body);
    await x.request('/api/tools/smoke', { method: 'POST', json: { ...body, dryRun: true } });
    expect(smoke.mock.calls[1]?.[0]).toEqual({ ...body, dryRun: true });
  });

  it('runs inside a container too: plan decision 62 refuses only recording there', async () => {
    const smoke = vi.fn(async (_args: unknown, _signal: AbortSignal) => ok);
    const x = await harness({ env: { IN_CONTAINER: '1' }, app: { tools: { smoke } } });
    expect((await x.request('/api/tools/smoke', { method: 'POST', json: body })).status).toBe(200);
    expect(smoke).toHaveBeenCalledTimes(1);
  });

  it('one tool at a time, whichever it is: a smoke while a recording runs is 409 tool_busy', async () => {
    let release: (() => void) | undefined;
    const record = () => new Promise<ToolRunResponse>((resolve) => (release = () => resolve(ok)));
    const x = await harness({ app: { tools: { record, smoke: async () => ok } } });
    const first = x.request('/api/tools/record', {
      method: 'POST',
      json: { budget: 5, origins: ['LHR'], destinations: ['JFK'], month: '2027-03' },
    });
    await vi.waitFor(() => expect(release).toBeDefined());
    const busy = await x.request('/api/tools/smoke', { method: 'POST', json: body });
    expect(busy.status).toBe(409);
    expect((await errorOf(busy)).code).toBe('tool_busy');
    release?.();
    expect((await first).status).toBe(200);
  });

  it('a failing runner answers 500 tool_failed without leaking URLs or secrets', async () => {
    const x = await harness({
      app: {
        tools: { smoke: async () => Promise.reject(new Error('GET https://x.test/?token=SENTINEL-SMOKE')) },
      },
    });
    const res = await x.request('/api/tools/smoke', { method: 'POST', json: body });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('SENTINEL-SMOKE');
    expect(x.logLines.join('')).not.toContain('SENTINEL-SMOKE');
  });
});

describe('the in-process smoke runner', () => {
  it('refuses with the CLI code 70 while the synthetic gate is open', async () => {
    const x = await harness();
    const r = await inProcessTools(x.ports).smoke?.(
      apiContract.toolSmokeRequestSchema.parse(body),
      new AbortController().signal,
    );
    expect(r).toMatchObject({ exitCode: 70, fixturesWritten: [] });
    expect(TOOL.safeParse(r).success).toBe(true);
  });

  it("runs on the app's ports, writes no fixture and says so", async () => {
    const env = cleanEnv({
      NODE_ENV: 'development',
      DATABASE_PATH: join(tempDir('gmt-smoke-route-'), 'app.db'),
      BIND_ADDRESS: '127.0.0.1',
      LOG_LEVEL: 'error',
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_RATE_PER_MINUTE: '60000',
      SEARCHAPI_RATE_PER_HOUR: '600000',
    });
    const ports = buildPorts(loadConfigFromEnv(env), { log: silentLog, migrationsDir: MIGRATIONS_DIR });
    onCleanup(() => ports.db.close());
    seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DATA_DIR));
    const seen = stubSmokeVendors();
    const r = await inProcessTools(ports).smoke?.(
      apiContract.toolSmokeRequestSchema.parse(body),
      new AbortController().signal,
    );
    expect(TOOL.parse(r)).toMatchObject({ exitCode: 0, fixturesWritten: [] });
    expect(r?.lines).toContain('fixtures not written (app process)');
    expect(r?.summary).toMatch(/^cheapest confirmed price £573 · LHR→JFK /);
    expect(seen.urls).toHaveLength(5);
    expect(JSON.stringify(r)).not.toContain(SENTINEL_SA);
    // why: decision 66: the operator's dry run goes through the route too, on the container's one ledger
    const dry = await inProcessTools(ports).smoke?.(
      apiContract.toolSmokeRequestSchema.parse({ ...body, budget: 8, dryRun: true }),
      new AbortController().signal,
    );
    expect(dry?.exitCode).toBe(0);
    expect(dry?.lines.at(-1)).toBe('dry run: nothing sent, no execution opened');
    expect(dry?.lines[2]).toBe(
      'SearchApi credits already ledgered to tool runs in this budget window: 4; this run ≤4; --budget 8',
    );
    expect(seen.urls).toHaveLength(5);
  });
});
