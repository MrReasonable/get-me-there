// Spec §8.2, §10 definitions CRUD, the plan-preset draft, cron validation, schedule sync, both estimate routes, the
// coverage check; the confirmation rule (spec §7, plan decisions 25, 37, 42, 43).
import { apiContract, asIata, asIsoDate, asIsoMonth, type Estimate } from '@gmt/core';
import { confirmationOf, SOFT_CONFIRM_CALL_SHARE } from '@gmt/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_TEXT } from '../../src/text.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { SENTINEL_TP } from '../helpers/env.js';
import { exampleDefinitionInput, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

const DEF = apiContract.definitionResponseSchema;
type Line = Estimate['perProvider'][number];
const line = (costMicroGbp: number, calls: number, blocked: string | null = null): Line => ({
  providerId: 'fixture',
  stage: blocked === null ? 'discovery' : 'verification',
  calls,
  planCalls: calls,
  costMicroGbp,
  costPence: Math.ceil(costMicroGbp / 10_000),
  seconds: 1,
  blocked,
});
/** An estimate of one runnable line (and, when given, more lines; WP7 sums the shown totals over runnable ones). */
const estimateOf = (totalCostMicroGbp: number, totalCalls = 10, extra: Line[] = []): Estimate => ({
  cells: 10,
  perProvider: [line(totalCostMicroGbp, totalCalls), ...extra],
  totalCalls,
  totalPlanCalls: 9,
  totalCostMicroGbp,
  totalCostPence: Math.ceil(totalCostMicroGbp / 10_000),
  seconds: 1,
  assumptions: [],
  windowClamped: false,
  retryFactor: 1.2,
});
const jobIds = (x: Harness) => x.engine.scheduler.jobs().map((j) => j.definitionId);
const ZERO_WINDOW = { kind: 'absolute', from: asIsoDate('2026-01-01'), to: asIsoDate('2026-01-10') } as const;

async function create(x: Harness, body: unknown) {
  return expectContract(await x.request('/api/definitions', { json: body }), 'POST', '/api/definitions', DEF);
}

describe('POST /api/definitions', () => {
  it('with no body creates the disabled draft default definition for the configured plan', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', { method: 'POST' });
    expect(res.status).toBe(201);
    const d = await expectContract(res, 'POST', '/api/definitions', DEF);
    expect([
      d.origins,
      d.enabled,
      d.confirmedCostPence,
      d.confirmedCalls,
      d.estimate,
      d.needsConfirmation,
    ]).toEqual([[], false, null, null, null, null]);
    expect(d.providers).toMatchObject({ discovery: ['fixture'], verification: ['fixture'] });
    expect(d.budgetFit).toEqual({ fits: true, runsPerMonth: 0, perScope: [] });
    expect(d.notices).toEqual([API_TEXT.draftNotice]);
    expect(jobIds(x)).not.toContain(d.id);
  });

  it('with a body validates, persists, estimates and registers the schedule', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', {
      json: exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }),
    });
    expect(res.status).toBe(201);
    const d = await expectContract(res, 'POST', '/api/definitions', DEF);
    expect(d.estimate?.cells).toBeGreaterThan(0);
    expect(jobIds(x)).toContain(d.id);
  });

  it('rejects a sub-hourly cron through the scheduler parseCron with details.fields', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', {
      json: exampleDefinitionInput({ scheduleCron: '*/15 * * * *' }),
    });
    expect(res.status).toBe(422);
    const e = await errorOf(res);
    expect(e.code).toBe('invalid_cron');
    expect(e.details?.fields?.[0]?.field).toBe('scheduleCron');
  });

  it('returns 422 for a window that resolves to zero cells', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', {
      json: exampleDefinitionInput({ window: ZERO_WINDOW }),
    });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('zero_cells');
  });

  it('rejects a malformed body with the validation envelope and its fields', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions', { json: { name: 'x' } });
    expect(res.status).toBe(400);
    const e = await errorOf(res);
    expect(e.code).toBe('validation');
    expect(e.details?.fields?.length).toBeGreaterThan(0);
  });

  it('a malformed JSON body is a 400 validation envelope', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions/coverage-check', { method: 'POST', body: '{not json' });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('validation');
  });
  it('refuses a schedule whose provider-month scope does not fit the monthly load (decision 25)', async () => {
    const x = await harness();
    vi.spyOn(x.engine, 'budgetFit').mockReturnValue({
      fits: false,
      runsPerMonth: 4.33,
      perScope: [{ scope: 'provider-month:fixture', estimated: 900, cap: 100, fits: false }],
    });
    const res = await x.request('/api/definitions', {
      json: exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }),
    });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('schedule_over_budget');
    expect(x.ports.repos.definitions.list()).toHaveLength(0);
  });
});

describe('PUT / DELETE /api/definitions/:id and the schedule (spec §8.2)', () => {
  it('disable, enable and delete each (re)register the job in the same request', async () => {
    const x = await harness();
    const d = await create(x, exampleDefinitionInput({ scheduleCron: '0 5 * * 1' }));
    expect(
      (await x.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: false } })).status,
    ).toBe(200);
    expect(jobIds(x)).not.toContain(d.id);
    expect(
      (await x.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: true } })).status,
    ).toBe(200);
    expect(jobIds(x)).toContain(d.id);
    const del = await x.request(`/api/definitions/${d.id}`, { method: 'DELETE' });
    expect((await expectContract(del, 'DELETE', '/api/definitions/:id', DEF)).deletedAt).not.toBeNull();
    expect(jobIds(x)).not.toContain(d.id);
    expect((await x.request(`/api/definitions/${d.id}`)).status).toBe(404);
    const list = await expectContract(
      await x.request('/api/definitions'),
      'GET',
      '/api/definitions',
      DEF.array(),
    );
    expect(list.map((y) => y.id)).not.toContain(d.id);
  });

  it('a draft can be edited but not enabled until it has airports; codes are upper-cased (review focus 1)', async () => {
    const x = await harness();
    const d = await expectContract(
      await x.request('/api/definitions', { method: 'POST' }),
      'POST',
      '/api/definitions',
      DEF,
    );
    expect(
      (await x.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { name: 'renamed' } })).status,
    ).toBe(200);
    const res = await x.request(`/api/definitions/${d.id}`, { method: 'PUT', json: { enabled: true } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('draft_cannot_enable');
    const ok = await x.request(`/api/definitions/${d.id}`, {
      method: 'PUT',
      json: { origins: ['lhr'], destinations: ['JFK'], enabled: true },
    });
    expect((await expectContract(ok, 'PUT', '/api/definitions/:id', DEF)).origins).toEqual(['LHR']);
    expect(jobIds(x)).toContain(d.id);
  });

  it('stores a confirmation only when its pence and calls both cover the estimate (decisions 37, 43)', async () => {
    const x = await harness();
    const estimate = vi.spyOn(x.engine, 'estimate').mockReturnValue(estimateOf(5_000_000, 40)); // 500p > SOFT_CONFIRM 100p
    const created = await create(x, {
      ...exampleDefinitionInput(),
      confirmedCostPence: 100,
      confirmedCalls: 40,
    });
    expect([created.confirmedCostPence, created.confirmedCalls]).toEqual([null, null]); // 100p does not cover 500p
    expect(created.needsConfirmation).toEqual({
      estimateMicroGbp: 5_000_000,
      totalCalls: 40,
      confirmedCostPence: null,
      confirmedCalls: null,
    });
    const put = (json: unknown) =>
      x
        .request(`/api/definitions/${created.id}`, { method: 'PUT', json })
        .then((r) => expectContract(r, 'PUT', '/api/definitions/:id', DEF));
    const penceOnly = await put({ confirmedCostPence: 500 });
    expect(penceOnly.confirmedCostPence).toBeNull(); // why: a confirmation without its calls covers nothing
    const tooFewCalls = await put({ confirmedCostPence: 500, confirmedCalls: 39 });
    expect(tooFewCalls.confirmedCalls).toBeNull();
    const confirmed = await put({ confirmedCostPence: 500, confirmedCalls: 40 });
    expect([confirmed.confirmedCostPence, confirmed.confirmedCalls, confirmed.needsConfirmation]).toEqual([
      500,
      40,
      null,
    ]);
    const renamed = await put({ name: 'again' });
    expect([renamed.confirmedCostPence, renamed.confirmedCalls]).toEqual([500, 40]); // never rewritten without an explicit value
    estimate.mockReturnValue(estimateOf(6_000_000, 40));
    const raised = await expectContract(
      await x.request(`/api/definitions/${created.id}`),
      'GET',
      '/api/definitions/:id',
      DEF,
    );
    expect(raised.needsConfirmation).toEqual({
      estimateMicroGbp: 6_000_000,
      totalCalls: 40,
      confirmedCostPence: 500,
      confirmedCalls: 40,
    });
  });

  it('asks for a confirmation when a free run needs more than 20% of a provider call cap (decision 25)', async () => {
    const x = await harness();
    const cap = x.ports.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).cap ?? 0;
    expect(cap).toBeGreaterThan(0);
    vi.spyOn(x.engine, 'estimate').mockReturnValue(
      estimateOf(0, Math.floor(SOFT_CONFIRM_CALL_SHARE * cap) + 1),
    );
    const d = await create(x, exampleDefinitionInput());
    expect(d.needsConfirmation).toMatchObject({ estimateMicroGbp: 0 });
    vi.spyOn(x.engine, 'estimate').mockReturnValue(estimateOf(0, Math.floor(SOFT_CONFIRM_CALL_SHARE * cap)));
    expect((await create(x, exampleDefinitionInput())).needsConfirmation).toBeNull();
  });

  it('shows and stores the worst case over every line, blocked ones included (WP7 confirmationOf, decision 54)', async () => {
    const x = await harness();
    // a runnable 300p / 30-call line and a 200p / 10-call line a cap blocks today
    vi.spyOn(x.engine, 'estimate').mockReturnValue({
      ...estimateOf(3_000_000, 30, [line(2_000_000, 10, 'provider-month')]),
    });
    const created = await create(x, exampleDefinitionInput());
    expect(created.needsConfirmation).toMatchObject({ estimateMicroGbp: 5_000_000, totalCalls: 40 });
    const put = (json: unknown) =>
      x
        .request(`/api/definitions/${created.id}`, { method: 'PUT', json })
        .then((r) => expectContract(r, 'PUT', '/api/definitions/:id', DEF));
    expect((await put({ confirmedCostPence: 300, confirmedCalls: 30 })).confirmedCostPence).toBeNull();
    // why: what is stored is the worst case itself, not the operator's larger figure (WP7's confirmationOf)
    expect(await put({ confirmedCostPence: 900, confirmedCalls: 90 })).toMatchObject({
      confirmedCostPence: 500,
      confirmedCalls: 40,
      needsConfirmation: null,
    });
  });

  it('with the real engine: an over-threshold run needs a confirmation, and a confirmation of its figures clears it', async () => {
    // why: review TS-1: the rule runs against a real estimate, not a mocked one (the fixture billed at 10p a call)
    const x = await harness({ FIXTURE_COST_MICRO_GBP: '100000' });
    const created = await create(
      x,
      exampleDefinitionInput({ window: SMALL_WINDOW, minNights: 10, maxNights: 10 }),
    );
    const worst = confirmationOf(x.engine.estimate(created, x.clock.todayLondon()));
    expect(worst.pence).toBeGreaterThan(100);
    expect(created.needsConfirmation).toMatchObject({ totalCalls: worst.calls, confirmedCostPence: null });
    const put = await x.request(`/api/definitions/${created.id}`, {
      method: 'PUT',
      json: { confirmedCostPence: worst.pence, confirmedCalls: worst.calls },
    });
    expect((await expectContract(put, 'PUT', '/api/definitions/:id', DEF)).needsConfirmation).toBeNull();
  });

  it('404 for an unknown definition', async () => {
    const x = await harness();
    const res = await x.request('/api/definitions/nope');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('definition_not_found');
  });
});

describe('estimates and the coverage check', () => {
  it('POST /api/definitions/estimate estimates an unsaved body without persisting it', async () => {
    const x = await harness();
    const before = x.ports.repos.definitions.list().length;
    const res = await x.request('/api/definitions/estimate', { json: exampleDefinitionInput() });
    const body = await expectContract(
      res,
      'POST',
      '/api/definitions/estimate',
      apiContract.estimateResponseSchema,
    );
    expect(body.estimate.cells).toBeGreaterThan(0);
    expect(typeof body.budgetFit.fits).toBe('boolean');
    expect(x.ports.repos.definitions.list()).toHaveLength(before);
    const zero = await x.request('/api/definitions/estimate', {
      json: exampleDefinitionInput({ window: ZERO_WINDOW }),
    });
    expect((await errorOf(zero)).code).toBe('zero_cells');
  });

  it('POST /api/definitions/:id/estimate estimates a saved definition; refuses a draft', async () => {
    const x = await harness();
    const d = await create(x, exampleDefinitionInput());
    const res = await x.request(`/api/definitions/${d.id}/estimate`, { method: 'POST', json: {} });
    await expectContract(res, 'POST', '/api/definitions/:id/estimate', apiContract.estimateResponseSchema);
    const draft = await expectContract(
      await x.request('/api/definitions', { method: 'POST' }),
      'POST',
      '/api/definitions',
      DEF,
    );
    const refused = await x.request(`/api/definitions/${draft.id}/estimate`, { method: 'POST', json: {} });
    expect(refused.status).toBe(422);
    expect((await errorOf(refused)).code).toBe('draft_definition');
  });

  const coverageBody = {
    origins: ['LHR'],
    destinations: ['JFK'],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
  };

  it('needs Travelpayouts (free) and never falls back to a billed provider', async () => {
    const x = await harness();
    const spy = vi.spyOn(x.engine, 'coverageCheck');
    const res = await x.request('/api/definitions/coverage-check', { json: coverageBody });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('coverage_check_unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('delegates to engine.coverageCheck when Travelpayouts is configured; a month it could not check is null', async () => {
    const x = await harness({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP });
    const spy = vi.spyOn(x.engine, 'coverageCheck').mockResolvedValue({
      pairs: [
        {
          origin: asIata('LHR'),
          destination: asIata('JFK'),
          months: [{ month: asIsoMonth('2026-11'), cachedRows: null, cellsInBand: 12 }],
        },
      ],
      calls: 1,
      notes: [],
    });
    const res = await x.request('/api/definitions/coverage-check', { json: coverageBody });
    const body = await expectContract(
      res,
      'POST',
      '/api/definitions/coverage-check',
      apiContract.coverageCheckResponseSchema,
    );
    expect(body.pairs[0]?.months[0]?.cachedRows).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('one coverage check at a time (decision 54): a second while one runs is 429 already_running', async () => {
    const x = await harness({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP });
    let release: (() => void) | undefined;
    vi.spyOn(x.engine, 'coverageCheck')
      .mockResolvedValue({ pairs: [], calls: 0, notes: [] })
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve({ pairs: [], calls: 0, notes: [] }))),
      );
    const first = x.request('/api/definitions/coverage-check', { json: coverageBody });
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = await x.request('/api/definitions/coverage-check', { json: coverageBody });
    expect(second.status).toBe(429);
    expect((await errorOf(second)).code).toBe('already_running');
    release?.();
    expect((await first).status).toBe(200);
    expect((await x.request('/api/definitions/coverage-check', { json: coverageBody })).status).toBe(200);
  });
});
