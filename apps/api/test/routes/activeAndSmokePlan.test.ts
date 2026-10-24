// Spec §10 `GET /api/executions/active` (gmt update reads it, decision 80) and `GET /api/tools/smoke/plan` (gmt smoke
// prints it before it asks; ledgers nothing). WP16a Task 16a.3. The worked example only.
import { apiContract, type Estimate } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SMOKE_EXPAND_TOP, smokeWorstCase } from '../../src/tools/smokeArgs.js';
import { expectContract } from '../helpers/contract.js';
import { SENTINEL_SA, SENTINEL_TP } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

beforeEach(() => {
  expect.hasAssertions();
});
let h: Harness | undefined;
afterEach(async () => {
  // why: review T7 — a stub left by a failed assertion must not reach the next test
  vi.unstubAllGlobals();
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

const ACTIVE = apiContract.activeExecutionResponseSchema;
const PLAN = apiContract.smokePlanResponseSchema;
const estimate = (seconds: number): Estimate => ({
  cells: 0,
  perProvider: [],
  totalCalls: 0,
  totalPlanCalls: 0,
  totalCostMicroGbp: 0,
  totalCostPence: 0,
  seconds,
  assumptions: [],
  windowClamped: false,
  retryFactor: 1.2,
});

describe('GET /api/executions/active (spec §10)', () => {
  it('needs auth when auth is configured', async () => {
    const x = await harness();
    expect((await x.request('/api/executions/active', { auth: false })).status).toBe(401);
  });

  it('idle: { execution: null }; a paused run and a finished one are not in flight', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    expect(
      await expectContract(
        await x.request('/api/executions/active'),
        'GET',
        '/api/executions/active',
        ACTIVE,
      ),
    ).toEqual({
      execution: null,
    });
    s.execution('done', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.execution('paused', { def, status: 'paused_budget', startedAt: at(-2) });
    expect(await (await x.request('/api/executions/active')).json()).toEqual({ execution: null });
  });

  it('a running single-cell verification is in flight too (it spends credits): kind cell-verification (R15)', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const id = s.execution('child', {
      def,
      status: 'running',
      startedAt: at(-1),
      child: cell('LHR', 'JFK', '2026-11-02', '2026-11-12'),
    });
    expect(ACTIVE.parse(await (await x.request('/api/executions/active')).json())).toEqual({
      execution: {
        id,
        definitionId: def.id,
        definitionName: def.name,
        kind: 'cell-verification',
        startedAt: at(-1),
        estimatedFinishAt: null,
      },
    });
  });

  it('the oldest run in flight with its estimated finish: now plus its remaining cells’ seconds, never in the past for a resumed run; null without an estimate (R16)', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    // why: started three days ago and resumed since; its stored estimate covers every pass
    const id = s.execution('run', { def, status: 'running', startedAt: at(-72) });
    s.cells('run', [
      cell('LHR', 'JFK', '2026-11-02', '2026-11-12'),
      cell('LHR', 'JFK', '2026-11-03', '2026-11-13'),
    ]);
    expect(
      await expectContract(
        await x.request('/api/executions/active'),
        'GET',
        '/api/executions/active',
        ACTIVE,
      ),
    ).toEqual({
      execution: {
        id,
        definitionId: def.id,
        definitionName: def.name,
        kind: 'run',
        startedAt: at(-72),
        estimatedFinishAt: null,
      },
    });
    x.ports.repos.executions.patch(id, { estimate: estimate(5400) });
    const remaining = x.engine.estimateRemaining(id).seconds;
    expect(remaining).toBeGreaterThan(0);
    const body = ACTIVE.parse(await (await x.request('/api/executions/active')).json());
    expect(body.execution?.estimatedFinishAt).toBe(
      new Date(Date.parse(x.ports.clock.now()) + Math.round(remaining * 1000)).toISOString(),
    );
    expect(Date.parse(body.execution?.estimatedFinishAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(x.ports.clock.now()),
    );
  });
});

describe('GET /api/tools/smoke/plan (spec §10; ledgers nothing)', () => {
  const CAMOUFOX = {
    CAMOUFOX_ENABLED: 'true',
    CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
    CAMOUFOX_WORKER_KEY: 'test-camoufox-worker-key-0123456789abcdef',
  };
  it.each([
    ['none', {}, { searchApi: null, travelpayouts: null, camoufox: null }],
    [
      'SearchApi on the trial (24 used)',
      { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: 'trial', SEARCHAPI_TRIAL_USED: '24' },
      {
        searchApi: { calendar: 1, itinerary: 1 + 2 * SMOKE_EXPAND_TOP, trialLeft: 76 },
        travelpayouts: null,
        camoufox: null,
      },
    ],
    [
      'SearchApi on 40usd',
      { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd' },
      {
        searchApi: { calendar: 1, itinerary: 1 + 2 * SMOKE_EXPAND_TOP, trialLeft: null },
        travelpayouts: null,
        camoufox: null,
      },
    ],
    [
      'Travelpayouts',
      { TRAVELPAYOUTS_TOKEN: SENTINEL_TP },
      { searchApi: null, travelpayouts: { freeCalls: 3 }, camoufox: null },
    ],
    [
      'camoufox in list mode',
      CAMOUFOX,
      { searchApi: null, travelpayouts: null, camoufox: { pages: 1, scrolls: 0 } },
    ],
    [
      'camoufox in grid mode',
      { ...CAMOUFOX, CAMOUFOX_MODE: 'grid', CAMOUFOX_GRID_SCROLL_CAP: '12' },
      { searchApi: null, travelpayouts: null, camoufox: { pages: 1, scrolls: 12 } },
    ],
  ] as const)('%s: the worst case smokeWorstCase states, split per stage', async (_label, env, expected) => {
    const x = await harness(env);
    const fetch = vi.fn(async () => {
      throw new Error('the smoke plan called a provider');
    });
    vi.stubGlobal('fetch', fetch);
    const ledger = () =>
      x.ports.db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM provider_requests').get()?.n ?? 0;
    const before = ledger();
    const res = await x.request('/api/tools/smoke/plan');
    const plan = await expectContract(res, 'GET', '/api/tools/smoke/plan', PLAN);
    expect(plan).toEqual(expected);
    const worst = smokeWorstCase(x.ports.config);
    expect((plan.searchApi?.calendar ?? 0) + (plan.searchApi?.itinerary ?? 0)).toBe(worst.credits);
    expect(plan.travelpayouts?.freeCalls ?? 0).toBe(worst.freeCalls);
    expect(ledger()).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('needs auth when auth is configured', async () => {
    const x = await harness();
    expect((await x.request('/api/tools/smoke/plan', { auth: false })).status).toBe(401);
  });
});
