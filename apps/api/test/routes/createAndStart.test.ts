// Spec revision 55 §10 `POST /definitions/create-and-start`: Search now's one press. The search is created whatever the
// start does; the sent figures are stored as its confirmation only when they cover the recomputed shown totals; a
// refused start is answered in the body (Review Focus 1: no price source); the same requestKey creates nothing more.
import { randomUUID } from 'node:crypto';
import { apiContract, asIsoDate, type CreateAndStartResponse, type DefinitionInput } from '@gmt/core';
import type { StartResult } from '@gmt/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runnableTotalsOf } from '../../src/routes/searches.js';
import { exampleDefinitionInput, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
  vi.restoreAllMocks();
});

const PATH = '/api/definitions/create-and-start';
const input = (over: Partial<DefinitionInput> = {}) =>
  exampleDefinitionInput({ window: SMALL_WINDOW, ...over });

/** The shown totals the server will recompute for `def` (the runnable lines' pence and calls). */
const shownFor = (x: Harness, def: DefinitionInput) =>
  runnableTotalsOf(x.engine.estimate(def, x.clock.todayLondon()));

/** One press that is answered (2xx), its body parsed by the contract; an error answer throws. */
async function press(
  x: Harness,
  body: Record<string, unknown>,
): Promise<{ status: number; body: CreateAndStartResponse }> {
  const res = await x.request(PATH, { json: body });
  if (res.status >= 300) throw new Error(`answered ${res.status}: ${await res.text()}`);
  return { status: res.status, body: apiContract.createAndStartResponseSchema.parse(await res.json()) };
}
const definitions = (x: Harness) => x.ports.repos.definitions.list();

describe('POST /definitions/create-and-start (revision 55 §10)', () => {
  it('creates the search, stores the sent figures when they cover the shown totals, and starts a manual run with requireCovered', async () => {
    h = await createHarness();
    const x = h;
    const def = input();
    const shown = shownFor(x, def);
    const start = vi.spyOn(x.engine, 'start');
    const r = await press(x, {
      ...def,
      confirmCostPence: shown.pence,
      confirmCalls: shown.calls,
      requestKey: randomUUID(),
    });
    expect(r.status).toBe(201);
    const body = r.body;
    expect(body.refusal).toBeNull();
    expect(body.executionId).toEqual(expect.any(String));
    expect(x.ports.repos.definitions.get(body.definition.id)).toMatchObject({
      confirmedCostPence: shown.pence,
      confirmedCalls: shown.calls,
      scheduleCron: null,
    });
    expect(start).toHaveBeenCalledWith(body.definition.id, {
      trigger: 'manual',
      confirmCostPence: shown.pence,
      confirmCalls: shown.calls,
      requireCovered: true,
    });
    if (body.executionId !== null) await x.engine.cancel(body.executionId, { kind: 'cancelled' });
  });

  it('figures below the shown totals: the search is saved, no confirmation stored, and the refusal says confirm with the figures (sec-006)', async () => {
    h = await createHarness();
    const x = h;
    const def = input();
    const shown = shownFor(x, def);
    expect(shown.calls).toBeGreaterThan(0);
    const r = await press(x, {
      ...def,
      confirmCostPence: shown.pence,
      confirmCalls: shown.calls - 1,
      requestKey: randomUUID(),
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      executionId: null,
      refusal: { code: 'confirm', estimatePence: shown.pence, totalCalls: shown.calls, resetsAt: null },
    });
    expect(x.ports.repos.definitions.get(r.body.definition.id)).toMatchObject({
      confirmedCostPence: null,
      confirmedCalls: null,
    });
  });

  it('a soft-confirm estimate starts on the first press when the figures cover it', async () => {
    h = await createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const x = h;
    const def = input();
    const shown = shownFor(x, def);
    const r = await press(x, {
      ...def,
      confirmCostPence: shown.pence,
      confirmCalls: shown.calls,
      requestKey: randomUUID(),
    });
    expect(r.body).toMatchObject({ refusal: null, executionId: expect.any(String) });
    if (r.body.executionId !== null) await x.engine.cancel(r.body.executionId, { kind: 'cancelled' });
  });

  it('no price source: the search is still created and the answer is refusal disabled (Review Focus 1)', async () => {
    h = await createHarness();
    const x = h;
    const def = input({ providers: { discovery: [], verification: [], discoveryRefreshHours: {} } });
    const r = await press(x, { ...def, confirmCostPence: 0, confirmCalls: 0, requestKey: randomUUID() });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ executionId: null, refusal: { code: 'disabled' } });
    expect(definitions(x)).toHaveLength(1);
  });

  it('a cap refusal carries the window it resets with; a start that throws answers failed with the search saved', async () => {
    h = await createHarness();
    const x = h;
    const cap: StartResult = {
      ok: false,
      code: 'cap',
      message: 'budget cap: the monthly spend cap',
      details: {
        breaches: [
          { scope: 'global-month', providerId: null, cap: 1, current: 1, reserved: 0, estimated: 1 },
        ],
      },
    };
    vi.spyOn(x.engine, 'start').mockResolvedValueOnce(cap);
    const def = input();
    const r = await press(x, { ...def, confirmCostPence: 0, confirmCalls: 0, requestKey: randomUUID() });
    expect(r.body.refusal).toEqual({
      code: 'cap',
      estimatePence: null,
      totalCalls: null,
      resetsAt: x.ports.budget.usage({ kind: 'global-month' }).windowEnd,
    });
    vi.spyOn(x.engine, 'start').mockRejectedValueOnce(new Error('SQLITE_FULL at /data/app.db'));
    const thrown = await press(x, {
      ...def,
      name: 'second',
      confirmCostPence: 0,
      confirmCalls: 0,
      requestKey: randomUUID(),
    });
    expect(thrown.status).toBe(201);
    expect(thrown.body).toMatchObject({
      executionId: null,
      refusal: { code: 'failed' },
      definition: { name: 'second' },
    });
    expect(JSON.stringify(thrown.body)).not.toContain('SQLITE_FULL');
  });

  it('a zero-cell window is 422 and creates nothing; the rejected key is evicted, so the corrected press creates the search', async () => {
    h = await createHarness();
    const x = h;
    const key = randomUUID();
    const past = input({
      window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-03') },
    });
    const bad = await x.request(PATH, {
      json: { ...past, confirmCostPence: 0, confirmCalls: 0, requestKey: key },
    });
    expect(bad.status).toBe(422);
    expect(definitions(x)).toEqual([]);
    const shown = shownFor(x, input());
    const good = await press(x, {
      ...input(),
      confirmCostPence: shown.pence,
      confirmCalls: shown.calls,
      requestKey: key,
    });
    expect(good.status).toBe(201);
    expect(definitions(x)).toHaveLength(1);
    if (good.body.executionId !== null) await x.engine.cancel(good.body.executionId, { kind: 'cancelled' });
  });

  it('the same requestKey, sent while the first is still starting or after it settled, creates one search and answers the first result (200)', async () => {
    h = await createHarness();
    const x = h;
    let release: (r: StartResult) => void = () => undefined;
    const held = new Promise<StartResult>((r) => {
      release = r;
    });
    vi.spyOn(x.engine, 'start').mockReturnValueOnce(held);
    const key = randomUUID();
    const body = { ...input(), confirmCostPence: 0, confirmCalls: 0, requestKey: key };
    const first = x.request(PATH, { json: body });
    const second = x.request(PATH, { json: body });
    release({ ok: true, executionId: 'exec-held' });
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([201, 200]);
    const aBody = await a.json();
    expect(await b.json()).toEqual(aBody);
    const third = await x.request(PATH, { json: body });
    expect(third.status).toBe(200);
    expect(await third.json()).toEqual(aBody);
    expect(definitions(x)).toHaveLength(1);
  });

  it('refuses a body carrying the stored confirmation pair (strict), and is not shadowed by /definitions/:id', async () => {
    h = await createHarness();
    const r = await h.request(PATH, {
      json: {
        ...input(),
        confirmedCostPence: 1,
        confirmCostPence: 0,
        confirmCalls: 0,
        requestKey: randomUUID(),
      },
    });
    // why: the route's own schema refuses it (400 validation), so the static path reached this route, not /:id's 404
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: { code: 'validation' } });
    expect(definitions(h)).toEqual([]);
  });
});
