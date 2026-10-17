// Spec §10 health, airports, providers, budget and scheduler jobs.
import { apiContract } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { API_TEXT } from '../../src/text.js';
import { expectContract } from '../helpers/contract.js';
import { SENTINEL_AUTH, SENTINEL_SA } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { AUTH_USER, basic, createHarness, type Harness, HOST } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

describe('GET /api/health (spec §10, §13)', () => {
  it('public shape without auth; detail with auth, no database path', async () => {
    const x = await harness();
    const pub = await expectContract(
      await x.request('/api/health', { auth: false }),
      'GET',
      '/api/health',
      apiContract.healthPublicSchema,
    );
    expect(pub).toEqual({ ok: true, degraded: false });
    const detail = await expectContract(
      await x.request('/api/health'),
      'GET',
      '/api/health',
      apiContract.healthDetailSchema,
    );
    expect(detail.db.ok).toBe(true);
    expect(detail.db).not.toHaveProperty('path');
    expect(JSON.stringify(detail)).not.toContain(':memory:');
    expect(detail.providers.map((p) => p.providerId)).toContain('fixture');
    expect(detail.scheduler).toMatchObject({ jobCount: 0, blockedSince: null });
  });
  it('with auth off, a foreign Host gets the minimal shape, an allowed Host the detail (review SEC-2)', async () => {
    const x = await harness({ APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' });
    const foreign = await x.request('/api/health', { auth: false, headers: { host: 'rebound.example' } });
    expect(await expectContract(foreign, 'GET', '/api/health', apiContract.healthPublicSchema)).toEqual({
      ok: true,
      degraded: false,
    });
    const local = await x.request('/api/health', { auth: false });
    await expectContract(local, 'GET', '/api/health', apiContract.healthDetailSchema);
  });

  it('reports degraded from the engine without detail', async () => {
    const x = await harness();
    vi.spyOn(x.engine, 'status').mockReturnValue({
      running: [],
      degraded: true,
      nextRun: null,
      lastExecutionAt: null,
    });
    expect(await (await x.request('/api/health', { auth: false })).json()).toEqual({
      ok: true,
      degraded: true,
    });
  });
});

describe('GET /api/airports?q= (spec §10, §11 autocomplete)', () => {
  it('returns at most 20 airports, IATA prefix first', async () => {
    const x = await harness();
    const rows = await expectContract(
      await x.request('/api/airports?q=LHR'),
      'GET',
      '/api/airports',
      apiContract.airportsResponseSchema,
    );
    expect(rows[0]?.iata).toBe('LHR');
    const london = await expectContract(
      await x.request('/api/airports?q=London'),
      'GET',
      '/api/airports',
      apiContract.airportsResponseSchema,
    );
    expect(london.map((a) => a.iata)).toEqual(expect.arrayContaining(['LHR', 'LGW']));
    expect(london.length).toBeLessThanOrEqual(20);
  });
  it('400 without q', async () => {
    const x = await harness();
    expect((await x.request('/api/airports')).status).toBe(400);
  });
});

describe('GET /api/providers (spec §10)', () => {
  it('lists capabilities, plan, usage with window bounds, the synthetic flag and the plan presets', async () => {
    const x = await harness();
    const body = await expectContract(
      await x.request('/api/providers'),
      'GET',
      '/api/providers',
      apiContract.providersResponseSchema,
    );
    const fixture = body.providers.find((p) => p.providerId === 'fixture');
    expect(fixture?.plan).toBe('synthetic');
    // why: only the window the plan uses is reported, so a null cap can only mean "no cap" (ruling 2, decision 67).
    expect(fixture?.usage.map((u) => u.scope)).toEqual(['provider-month:fixture']);
    expect(fixture?.notices).toEqual([]);
    expect(body.synthetic).toBe(true);
    expect(body.presets).toMatchObject({
      policy: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true },
      discoveryRefreshHours: 168,
      schedulerTimezone: 'Europe/London',
    });
  });
  it('a trial plan reports the lifetime window alone, with its cap (ruling 2, F2)', async () => {
    const x = await harness({
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: 'trial',
      SEARCHAPI_TRIAL_USED: '76',
    });
    const body = await expectContract(
      await x.request('/api/providers'),
      'GET',
      '/api/providers',
      apiContract.providersResponseSchema,
    );
    expect(
      body.providers.find((p) => p.providerId === 'searchapi')?.usage.map((u) => [u.scope, u.cap]),
    ).toEqual([['provider-lifetime:searchapi', 24]]);
    const budget = await expectContract(
      await x.request('/api/budget'),
      'GET',
      '/api/budget',
      apiContract.budgetResponseSchema,
    );
    expect(budget.scopes.map((s) => s.scope)).not.toContain('provider-month:searchapi');
  });
  it('says verification will not run only when calls cost money and the spend cap is 0 (ruling 5)', async () => {
    const x = await harness({
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
      SEARCHAPI_COST_PER_CALL_MICRO_GBP: '5000',
      MONTHLY_SPEND_CAP_PENCE: '0',
    });
    const body = await expectContract(
      await x.request('/api/providers'),
      'GET',
      '/api/providers',
      apiContract.providersResponseSchema,
    );
    const sa = body.providers.find((p) => p.providerId === 'searchapi');
    expect(sa?.notices).toEqual([API_TEXT.zeroCapVerification]);
    expect(sa?.capNote).toBeNull();
  });
  it.each([
    [
      'the trial',
      { SEARCHAPI_PLAN: 'trial', SEARCHAPI_TRIAL_USED: '76' },
      API_TEXT.callCapGoverns('lifetime', 24),
    ],
    [
      'the $40 plan under a zero cap',
      { SEARCHAPI_PLAN: '40usd', MONTHLY_SPEND_CAP_PENCE: '0' },
      API_TEXT.callCapGoverns('month', 10_000),
    ],
  ])(
    'on %s calls cost £0, so no zero-cap notice: the card names the call cap that governs (ruling 5)',
    async (_l, env, note) => {
      const x = await harness({ SEARCHAPI_KEY: SENTINEL_SA, ...env });
      const body = await expectContract(
        await x.request('/api/providers'),
        'GET',
        '/api/providers',
        apiContract.providersResponseSchema,
      );
      const sa = body.providers.find((p) => p.providerId === 'searchapi');
      expect(sa?.notices).toEqual([]);
      expect(sa?.capNote).toBe(note);
    },
  );
});

describe('the Providers card says when new definitions allow 0 billed calls (N2, ruling 9)', () => {
  it('on the trial preset (EXECUTION_MAX_CALLS 0) the capNote adds why Verify is unavailable and what to raise', async () => {
    const x = await harness({
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: 'trial',
      SEARCHAPI_TRIAL_USED: '76',
      EXECUTION_MAX_CALLS: '',
    });
    const body = await expectContract(
      await x.request('/api/providers'),
      'GET',
      '/api/providers',
      apiContract.providersResponseSchema,
    );
    expect(body.providers.find((p) => p.providerId === 'searchapi')?.capNote).toBe(
      `${API_TEXT.callCapGoverns('lifetime', 24)}; ${API_TEXT.zeroRunCapDefault}`,
    );
    expect(API_TEXT.zeroRunCapDefault).toBe(
      "new definitions on this plan allow 0 billed calls, so Verify stays unavailable until you raise a definition's call cap in Definitions → Run budget",
    );
  });
});

describe('GET /api/budget and GET /api/scheduler/jobs (spec §7 budget windows, §8.2)', () => {
  it('reports every window with bounds, the cap and the subscription fees counted once', async () => {
    const x = await harness({
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
      MONTHLY_SPEND_CAP_PENCE: '3500',
    });
    const body = await expectContract(
      await x.request('/api/budget'),
      'GET',
      '/api/budget',
      apiContract.budgetResponseSchema,
    );
    expect(body.scopes.map((s) => s.scope)).toEqual(
      expect.arrayContaining(['provider-month:searchapi', 'global-month']),
    );
    for (const s of body.scopes) expect(s).toHaveProperty('windowStart');
    expect([body.monthlyCapPence, body.fixedFeesMicroGbp]).toEqual([3500, 32_000_000]);
    expect(body.ceilingNote).toBe(API_TEXT.ceilingNote(3500, 3200));
  });
  it("counts fixed fees from the guard's own budget entries, as the engine's budgetFit does (review arch Important)", async () => {
    const x = await harness({
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
      MONTHLY_SPEND_CAP_PENCE: '3500',
    });
    const sa = x.ports.config.providers.searchapi;
    if (sa === null) throw new Error('searchapi is configured above');
    // A plan billed on a lifetime window with a fixed fee: the guard and budgetFit count the fee whatever the window.
    const config = {
      ...x.ports.config,
      providers: {
        ...x.ports.config.providers,
        searchapi: {
          ...sa,
          limits: { ...sa.limits, window: 'lifetime' as const, planFixedMicroGbp: 5_000_000 },
        },
      },
    };
    const app = createApp({ ...x.ports, config }, x.engine, { webRoot: null });
    const res = await app.request(`http://${HOST}/api/budget`, {
      headers: { host: HOST, authorization: basic(AUTH_USER, SENTINEL_AUTH) },
    });
    const body = await expectContract(res, 'GET', '/api/budget', apiContract.budgetResponseSchema);
    expect(body.fixedFeesMicroGbp).toBe(5_000_000);
  });
  it('lists registered jobs', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }));
    x.engine.scheduler.register(def);
    const body = await expectContract(
      await x.request('/api/scheduler/jobs'),
      'GET',
      '/api/scheduler/jobs',
      apiContract.schedulerJobsResponseSchema,
    );
    expect(body.jobs.map((j) => j.definitionId)).toContain(def.id);
  });
});
