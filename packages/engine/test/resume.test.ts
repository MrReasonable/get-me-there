import { asIsoDateTime, cellKeyString, ProviderError } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  JFK,
  LGW,
  LHR,
  refusedWith,
  tileRule,
  withVerification,
} from './support/harness.js';
import { throwOnSearch } from './support/wrappers.js';

const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });
const confirmed = { trigger: 'manual', confirmCostPence: 100, confirmCalls: 1000 } as const;

async function interruptedAfter(h: Harness, k: number, defId = twoPairs(h).id): Promise<string> {
  const first = h.orch();
  h.onTileCommit((n) => {
    if (n === k) void first.shutdown();
  });
  const r = await first.start(defId, { trigger: 'manual' });
  if (!r.ok) throw new Error(r.message);
  await h.waitForSettled(r.executionId);
  h.clearHooks();
  return r.executionId;
}

describe('resume (spec §8.1 "Resume", §7 resume query)', () => {
  it('is a compare-and-set: of two concurrent resumes exactly one proceeds; the loser gets code active', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(h, 1);
    const results = await Promise.all([
      h.orch().resume(id, { manual: false }),
      h.orch().resume(id, { manual: false }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([expect.objectContaining({ ok: false, code: 'active' })]);
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('refuses while another execution of the definition is active', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h);
    const id = await interruptedAfter(h, 1, def.id);
    const o = h.orch();
    expect(await o.cancel(id)).toBe(true); // cancelled: resumable, no longer active
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const other = await o.start(def.id, { trigger: 'manual' });
    expect(other.ok).toBe(true);
    expect(await o.resume(id, { manual: true })).toMatchObject({
      ok: false,
      code: 'active',
      message: 'another execution of this definition is active',
    });
  });

  it('marks not_run cells whose departure date has arrived as skipped:departed and leaves searched cells alone', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(h, 1);
    const searched = new Map(
      h
        .outcomes(id)
        .filter((o) => o.status !== 'not_run')
        .map((o) => [cellKeyString(o), o.status]),
    );
    expect(searched.size).toBe(14);
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // today (London) = 2026-11-03
    expect(await h.orch().resume(id, { manual: false })).toEqual({ ok: true, executionId: id });
    await h.waitForSettled(id);
    const departed = h
      .outcomes(id)
      .filter((o) => !searched.has(cellKeyString(o)) && o.departureDate <= '2026-11-03');
    expect(departed.length).toBe(4); // LGW, 2 and 3 November × 7–8 nights
    expect(departed.every((o) => o.status === 'skipped' && o.reason === 'departed')).toBe(true);
    const after = h.outcomes(id);
    const kept = after.filter((o) => searched.has(cellKeyString(o)));
    expect(kept).toHaveLength(14);
    expect(kept.every((o) => o.status === searched.get(cellKeyString(o)))).toBe(true);
    const later = after.filter((o) => !searched.has(cellKeyString(o)) && o.departureDate > '2026-11-03');
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((o) => o.status === 'priced')).toBe(true);
  });

  it('a refused resume writes nothing: departed cells stay as they were until a resume is claimed (arch-r2-006)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h, { budget: { maxCalls: 6, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 2, costMicroGbpEach: 0, executionId: id }),
    );
    const id = await interruptedAfter(h, 1, def.id);
    h.clearHooks();
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // some not_run cells have departed
    const before = h.outcomes(id);
    expect(
      before.filter((o) => o.status === 'not_run' && o.departureDate <= '2026-11-03').length,
    ).toBeGreaterThan(0);
    refusedWith(await h.orch().resume(id, { manual: false }), 'cap');
    expect(h.outcomes(id)).toEqual(before);
    expect(h.repos.executions.get(id)?.status).toBe('interrupted');
  });

  it('departed cells are left out of the cap check, so they never count against it (po-016)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    // why: the start needs 5 of 6 calls; pass one uses 3 (2 spent by a concurrent pass + 1 tile); 3 tiles left need
    // ceil(3 × 1.2) = 4 > 3, but with the first week departed only 2 tiles (3 calls) remain
    const def = twoPairs(h, { budget: { maxCalls: 6, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 2, costMicroGbpEach: 0, executionId: id }),
    );
    const id = await interruptedAfter(h, 1, def.id);
    expect(await h.orch().resume(id, { manual: false })).toMatchObject({ ok: false, code: 'cap' });
    h.clock.set(asIsoDateTime('2026-11-09T10:00:00.000Z'));
    expect(await h.orch().resume(id, { manual: false })).toEqual({ ok: true, executionId: id });
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('automatic resume of an auth-paused run is refused and leaves it paused_error; a manual resume re-enables the provider (ruling 10)', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const e = await h.runToCompletion(h.orch(), twoPairs(h).id);
    expect(e.status).toBe('paused_error');
    const before = h.requests.length;
    expect(await h.orch().resume(e.id, { manual: false })).toMatchObject({
      ok: false,
      code: 'active',
      message: 'nothing can resume automatically; a manual resume retries the providers that were disabled',
    });
    expect(h.repos.executions.get(e.id)).toMatchObject({ status: 'paused_error' });
    expect(h.requests.length).toBe(before);
    expect(await h.orch().resume(e.id, { manual: true })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it('a completed execution with retryable errors resumes (retry-errors); the plan is added to the stored estimate; without any left it is refused', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.upstream, 3)]);
    const e = await h.runToCompletion(h.orch(), twoPairs(h).id);
    expect(e.status).toBe('completed');
    expect(e.estimate?.totalPlanCalls).toBe(4);
    const errored = new Set(h.outcomes(e.id, { status: 'error' }).map(cellKeyString));
    expect(errored.size).toBe(14);
    expect(await h.orch().resume(e.id, { manual: false })).toEqual({ ok: true, executionId: e.id });
    const after = await h.waitForSettled(e.id);
    for (const o of h.outcomes(e.id).filter((x) => errored.has(cellKeyString(x)))) {
      expect(o.status).toBe('priced');
      expect(o.attempts).toBe(1); // spec §7: attempts count failed passes; the successful retry adds none (ssr-03)
    }
    // why: cost-r1-009 — the retried tile is in the stored plan, so the 1 + 3 + 1 ledger calls are no overrun
    expect(after.estimate?.totalPlanCalls).toBe(5);
    const calls = h.repos.ledger.countsFor(e.id).calls;
    expect(calls).toBeLessThanOrEqual(Math.ceil((after.estimate?.totalPlanCalls ?? 0) * 1.1) + 2);
    expect(await h.orch().resume(e.id, { manual: false })).toMatchObject({
      ok: false,
      code: 'active',
      message: 'nothing left to retry on this execution',
    });
  });

  it('checks every scope against estimateRemaining; a manual resume checks the current definition budget (only that) and writes it only once claimed', async () => {
    const h = createHarness({ fixtureConcurrency: 4 });
    const def = twoPairs(h, { budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.status).toBe('paused_budget');
    h.clearHooks();
    // the definition still says 50
    expect(refusedWith(await h.orch().resume(e.id, { manual: true }), 'cap')).toContain(
      "this run's billed-call cap is 50 calls",
    );
    h.repos.definitions.update(def.id, {
      budget: { maxCalls: 500, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
      origins: [LHR],
    });
    expect(h.repos.executions.get(e.id)?.snapshot.budget.maxCalls).toBe(50); // a refused resume changed nothing (ssr-09)
    expect(await h.orch().resume(e.id, { manual: false })).toMatchObject({ ok: false, code: 'cap' }); // automatic resume never refreshes
    expect(await h.orch().resume(e.id, { manual: true })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    const after = h.repos.executions.get(e.id);
    expect(after?.snapshot.budget.maxCalls).toBe(500);
    expect(after?.snapshot.origins).toEqual([LHR, LGW]); // nothing but the budget was copied
  });

  it('a manual resume that raises the budget needs the definition’s stored confirmation when the remaining run needs one (cost-r1-005)', async () => {
    const h = createHarness({ fixtureConcurrency: 4, env: { SOFT_CONFIRM_PENCE: '0' } });
    const def = twoPairs(h, { budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id, confirmed);
    expect(e.status).toBe('paused_budget');
    h.clearHooks();
    h.repos.definitions.update(def.id, {
      budget: { maxCalls: 500, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    expect(await h.orch().resume(e.id, { manual: true })).toMatchObject({ ok: false, code: 'confirm' });
    h.repos.definitions.setConfirmed(def.id, { pence: 100, calls: 1000 });
    expect(await h.orch().resume(e.id, { manual: true })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
  });

  it('a completed execution whose only errors are no-priced-options has nothing to retry; its stored estimate is unchanged (decision 37, ssr2-04)', async () => {
    const err = new ProviderError({
      kind: 'upstream',
      retryable: false,
      reason: 'no-priced-options',
      providerId: 'fixture',
      message: 'step 1 returned options and none was priced',
    });
    const h = createHarness({ transformFixture: (p) => throwOnSearch(p, err, () => true) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ providers: withVerification() }).id);
    expect(e.status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'error' }).map((o) => o.reason)).toEqual([
      'no-priced-options',
      'no-priced-options',
    ]);
    for (const manual of [false, true])
      expect(refusedWith(await h.orch().resume(e.id, { manual }), 'active')).toBe(
        'nothing left to retry on this execution',
      );
    expect(h.repos.executions.get(e.id)?.estimate).toEqual(e.estimate);
  });

  it('never resumes an execution whose definition was soft-deleted (plan decision 5)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h);
    const id = await interruptedAfter(h, 1, def.id);
    h.repos.definitions.softDelete(def.id);
    expect(await h.orch().resume(id, { manual: true })).toMatchObject({ ok: false, code: 'not_found' });
    expect(h.repos.executions.get(id)?.status).toBe('interrupted');
  });

  it('skipped:budget cells are fetched once the window has headroom (paused_budget resumed at window start)', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const e = await h.runToCompletion(h.orch(), twoPairs(h).id, confirmed);
    expect(e.status).toBe('paused_budget');
    expect(await h.orch().resume(e.id, { manual: false })).toMatchObject({ ok: false, code: 'cap' });
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    h.clearHooks();
    expect(await h.orch().resume(e.id, { manual: false })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it('resume never rewrites priced, empty or no_data outcomes', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(h, 2);
    const done = new Set(
      h
        .outcomes(id)
        .filter((o) => o.status !== 'not_run')
        .map(cellKeyString),
    );
    expect(done.size).toBe(28);
    const write = vi.spyOn(h.repos.cells, 'writeTile');
    await h.orch().resume(id, { manual: true });
    await h.waitForSettled(id);
    const touched = write.mock.calls.flatMap(([, , w]) => w.outcomes.map((o) => cellKeyString(o)));
    expect(touched.length).toBe(28);
    for (const k of touched) expect(done.has(k)).toBe(false);
  });
});
