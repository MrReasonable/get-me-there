// Spec §8.1, §10 executions: start, read, cancel, resume; single-cell verify with membership validation.
import { apiContract, asIata, asIsoDate, cellKeyString, generateCells } from '@gmt/core';
import { RowRejected } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { cellInSpace } from '../../src/read/space.js';
import { API_TEXT } from '../../src/text.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

const EXEC = apiContract.executionResponseSchema;
const STARTED = apiContract.startExecutionResponseSchema;
const small = () => exampleDefinitionInput({ window: SMALL_WINDOW, minNights: 10, maxNights: 10 });

async function execution(x: Harness, id: string) {
  return expectContract(await x.request(`/api/executions/${id}`), 'GET', '/api/executions/:id', EXEC);
}

describe('POST /api/definitions/:id/executions and GET /api/executions/:id (spec §8.1, §10)', () => {
  it('starts a run through the engine and reports progress per stage × provider, every budget scope and the ledger', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const res = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(202);
    const { executionId } = await expectContract(res, 'POST', '/api/definitions/:id/executions', STARTED);
    const e = await execution(x, executionId);
    expect(e.trigger).toBe('manual');
    expect(e.progress.find((p) => p.stage === 'discovery' && p.providerId === 'fixture')?.total).toBe(4);
    expect(e.progress.some((p) => p.stage === 'verification' && p.providerId === 'fixture')).toBe(true);
    expect(e.budget.map((b) => b.scope)).toEqual(
      expect.arrayContaining([
        'execution-calls',
        'execution-free-calls',
        'execution-cost',
        'provider-month:fixture',
        'global-month',
      ]),
    );
    expect(e.budget.map((b) => b.scope)).not.toContain('provider-lifetime:fixture'); // the unused window (ruling 2)
    expect(e.ledger.perProvider.every((p) => p.providerId === 'fixture')).toBe(true);
    expect([e.parityBreak, e.overrun, e.disabledProviders]).toEqual([false, false, []]);
  });

  it('passes the confirmation pence and calls to the engine (decisions 37, 43)', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const start = vi.spyOn(x.engine, 'start').mockResolvedValue({ ok: true, executionId: 'e1' });
    await x.request(`/api/definitions/${def.id}/executions`, {
      json: { confirmCostPence: 500, confirmCalls: 40 },
    });
    expect(start).toHaveBeenCalledWith(def.id, {
      trigger: 'manual',
      confirmCostPence: 500,
      confirmCalls: 40,
    });
    await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(start).toHaveBeenLastCalledWith(def.id, { trigger: 'manual' });
  });

  it.each([
    ['active', 409],
    ['cap', 409],
    ['confirm', 409],
    ['disabled', 409],
    ['window', 422],
    ['not_found', 404],
  ] as const)('maps StartResult %s to %i with the engine message and details', async (code, status) => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    vi.spyOn(x.engine, 'start').mockResolvedValue({
      ok: false,
      code,
      message: `refused: ${code} execution-calls cap 10, current 9, requested 5`,
      details: { scope: 'execution-calls', estimatePence: 500, totalCalls: 40 },
    });
    const res = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(status);
    const e = await errorOf(res);
    expect(e.code).toBe(code);
    expect(e.message).toContain('cap 10');
    expect(e.details).toMatchObject({ scope: 'execution-calls', totalCalls: 40 });
  });

  it('404 for an unknown execution', async () => {
    const x = await harness();
    const res = await x.request('/api/executions/nope');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('execution_not_found');
  });

  it('flags a discovery overrun on distinct tiles from real ledger rows, never on calls (decision 43, review TS-6)', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const s = seeder(x.ports);
    const planned = (name: string) => {
      const id = s.execution(name, { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
      x.ports.repos.executions.patch(id, {
        estimate: {
          cells: 4,
          perProvider: [
            {
              providerId: 'fixture',
              stage: 'discovery',
              calls: 10,
              planCalls: 10,
              costMicroGbp: 0,
              costPence: 0,
              seconds: 1,
              blocked: null,
            },
          ],
          totalCalls: 10,
          totalPlanCalls: 10,
          totalCostMicroGbp: 0,
          totalCostPence: 0,
          seconds: 1,
          assumptions: [],
          windowClamped: false,
          retryFactor: 1.2,
        },
      });
      return id;
    };
    const tiles = (n: number, attempts: number) =>
      Array.from({ length: n }, (_, i) => ({ tileIndex: i, attempts }));
    const paged = planned('E-paged');
    // why: ten tiles as planned, each paging three times: thirty calls, but no overrun
    s.ledger('E-paged', tiles(10, 3));
    const paging = await execution(x, paged);
    expect([paging.ledger.calls, paging.ledger.tiles, paging.overrun]).toEqual([30, 10, false]);
    const extra = planned('E-extra');
    s.ledger('E-extra', tiles(12, 1));
    const over = await execution(x, extra);
    expect([over.ledger.tiles, over.overrun]).toEqual([12, true]);
  });
});

describe('cancel and resume (spec §8.1 Resume, §10)', () => {
  it('cancel: 409 when the engine refuses, 200 with the execution when it accepts', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const s = seeder(x.ports);
    s.execution('E-done', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    vi.spyOn(x.engine, 'cancel').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const refused = await x.request(`/api/executions/${s.id('E-done')}/cancel`, { method: 'POST', json: {} });
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe('not_cancellable');
    const ok = await x.request(`/api/executions/${s.id('E-done')}/cancel`, { method: 'POST', json: {} });
    await expectContract(ok, 'POST', '/api/executions/:id/cancel', EXEC);
  });

  it('resume is always manual and maps a lost compare-and-set or an active sibling to 409', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    const s = seeder(x.ports);
    s.execution('E-cancelled', { def, status: 'cancelled', startedAt: at(-2), finishedAt: at(-1) });
    const resume = vi
      .spyOn(x.engine, 'resume')
      .mockResolvedValueOnce({ ok: true, executionId: s.id('E-cancelled') })
      .mockResolvedValueOnce({
        ok: false,
        code: 'active',
        message: 'another execution is active',
        details: null,
      });
    const ok = await x.request(`/api/executions/${s.id('E-cancelled')}/resume`, { method: 'POST', json: {} });
    await expectContract(ok, 'POST', '/api/executions/:id/resume', EXEC);
    expect(resume).toHaveBeenCalledWith(s.id('E-cancelled'), { manual: true });
    const lost = await x.request(`/api/executions/${s.id('E-cancelled')}/resume`, {
      method: 'POST',
      json: {},
    });
    expect(lost.status).toBe(409);
    expect((await errorOf(lost)).code).toBe('active');
  });
});

describe('POST /api/cells/verify (spec §8.1 Single-cell verification)', () => {
  const inside = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');

  it.each([
    ['departure outside the window', cell('LHR', 'JFK', '2027-09-01', '2027-09-11')],
    ['nights outside the range', cell('LHR', 'JFK', '2026-11-02', '2026-11-27')],
    ['origin not in the definition', cell('LGW', 'JFK', '2026-11-02', '2026-11-12')],
  ])('422 cell_not_in_space: %s, without calling the engine', async (_label, c) => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const spy = vi.spyOn(x.engine, 'verifyCell');
    const res = await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: c } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('cell_not_in_space');
    expect(spy).not.toHaveBeenCalled();
  });

  it('409 cap in plain words when the definition allows 0 billed calls: why, and the call cap that fixes it (N2)', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ budget: { maxCalls: 0, maxFreeCalls: 2000, maxCostMicroGbp: 0 } }),
    );
    const spy = vi.spyOn(x.engine, 'verifyCell');
    const res = await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } });
    expect(res.status).toBe(409);
    const err = await errorOf(res);
    expect([err.code, err.message]).toEqual(['cap', API_TEXT.verifyZeroRunCap(6)]);
    expect(err.message).toBe(
      "this definition allows 0 billed calls, so an itinerary search for one cell cannot start; raise the definition's call cap to at least 6 in Definitions → Run budget (Max billed calls per run)",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('422 no_verification_provider when the definition has none', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} },
      }),
    );
    const res = await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('no_verification_provider');
  });

  it('creates a child execution for a member cell; 409 when a child is active for it', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const res = await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } });
    expect(res.status).toBe(202);
    const { executionId } = await expectContract(res, 'POST', '/api/cells/verify', STARTED);
    expect((await execution(x, executionId)).isChild).toBe(true);
    vi.spyOn(x.engine, 'verifyCell').mockResolvedValue({
      ok: false,
      code: 'active',
      message: 'a child is active for this cell',
      details: null,
    });
    expect(
      (await x.request('/api/cells/verify', { json: { definitionId: def.id, cell: inside } })).status,
    ).toBe(409);
  });

  it('cellInSpace agrees with generateCells on a small space and its neighbours', () => {
    const space = {
      origins: [asIata('LHR')],
      destinations: [asIata('JFK')],
      departureFrom: asIsoDate('2026-11-02'),
      departureTo: asIsoDate('2026-11-04'),
      minNights: 1,
      maxNights: 2,
    };
    const members = new Set(generateCells(space).map(cellKeyString));
    let checked = 0;
    for (const o of ['LHR', 'LGW'])
      for (const d of ['JFK', 'EWR'])
        for (let dep = 1; dep <= 5; dep++)
          for (let n = 0; n <= 3; n++) {
            const ret = new Date(Date.UTC(2026, 10, dep + n)).toISOString().slice(0, 10);
            const c = cell(o, d, `2026-11-0${dep}`, ret);
            expect(cellInSpace(space, c)).toBe(members.has(cellKeyString(c)));
            checked++;
          }
    expect([checked, members.size]).toEqual([80, 6]);
  });
});

describe('refusals with the real engine, the active race, and one request at a time (review TS-1, decision 54)', () => {
  const ledgerRows = (x: Harness) =>
    x.ports.db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM provider_requests').get()?.n ?? -1;
  const startedRuns = (x: Harness, defId: string) =>
    x.ports.repos.executions
      .listForDefinition(defId, { limit: 10, includeChildren: true })
      .filter((e) => e.status === 'running' || e.status === 'completed').length;

  it('a run over its call cap is 409 cap before any provider call', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create({
      ...small(),
      budget: { maxCalls: 1, maxFreeCalls: 1, maxCostMicroGbp: 10_000_000 },
    });
    const res = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('cap');
    expect([ledgerRows(x), startedRuns(x, def.id)]).toEqual([0, 0]);
  });

  it('an unconfirmed run above SOFT_CONFIRM is 409 confirm with its figures; resent with them, it starts', async () => {
    const x = await harness({ FIXTURE_COST_MICRO_GBP: '100000' });
    const def = x.ports.repos.definitions.create(small());
    const refused = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(refused.status).toBe(409);
    const e = await errorOf(refused);
    expect(e.code).toBe('confirm');
    expect([ledgerRows(x), startedRuns(x, def.id)]).toEqual([0, 0]);
    const figures = z.object({ estimatePence: z.number(), totalCalls: z.number() }).parse(e.details);
    const ok = await x.request(`/api/definitions/${def.id}/executions`, {
      json: { confirmCostPence: figures.estimatePence, confirmCalls: figures.totalCalls },
    });
    expect(ok.status).toBe(202);
  });

  it("WP3's RowRejected('active') from a lost race is 409 active", async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(small());
    vi.spyOn(x.engine, 'start').mockRejectedValue(
      new RowRejected('active', 'another execution of this definition is active'),
    );
    const res = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('active');
  });

  it('a verify passes its confirmation on to the engine', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const verify = vi.spyOn(x.engine, 'verifyCell').mockResolvedValue({ ok: true, executionId: 'c1' });
    const c = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    await x.request('/api/cells/verify', {
      json: { definitionId: def.id, cell: c, confirmCostPence: 7, confirmCalls: 6 },
    });
    expect(verify).toHaveBeenCalledWith(def.id, c, { confirmCostPence: 7, confirmCalls: 6 });
  });

  it('a second run or verify of a definition while one is in flight is 429 already_running', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    let release: (() => void) | undefined;
    vi.spyOn(x.engine, 'start')
      .mockResolvedValue({ ok: true, executionId: 'e2' })
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve({ ok: true, executionId: 'e1' }))),
      );
    const first = x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = await x.request(`/api/definitions/${def.id}/executions`, { json: {} });
    expect(second.status).toBe(429);
    expect((await errorOf(second)).code).toBe('already_running');
    const verify = await x.request('/api/cells/verify', {
      json: { definitionId: def.id, cell: cell('LHR', 'JFK', '2026-11-02', '2026-11-12') },
    });
    expect(verify.status).toBe(429);
    const other = x.ports.repos.definitions.create(exampleDefinitionInput({ name: 'another' }));
    vi.spyOn(x.engine, 'verifyCell').mockResolvedValue({ ok: true, executionId: 'c1' });
    const elsewhere = await x.request('/api/cells/verify', {
      json: { definitionId: other.id, cell: cell('LHR', 'JFK', '2026-11-02', '2026-11-12') },
    });
    expect(elsewhere.status).toBe(202); // why: one at a time per definition, not per app
    release?.();
    expect((await first).status).toBe(202);
    expect((await x.request(`/api/definitions/${def.id}/executions`, { json: {} })).status).toBe(202);
  });
});
