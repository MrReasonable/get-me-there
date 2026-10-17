import { asIsoDateTime, BudgetExceeded, type Execution, type ProviderId } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { finalStatus } from '../src/execute.js';
import { lineKey } from '../src/lines.js';
import { renderOperatorMessage } from '../src/notifiers/operatorTemplates.js';
import { createOrchestrator, type Orchestrator } from '../src/orchestrator.js';
import { applyBudgetBreach, newRun } from '../src/run.js';
import {
  createHarness,
  EWR,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  JFK,
  LGW,
  LHR,
  tileRule,
  withVerification,
} from './support/harness.js';

const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const spent = (h: Harness, id: string) =>
  h.ledgerRows(id).filter((r) => r.endpointPath !== '/test-spend' && r.outcome !== 'cache_hit');
// why: a small call cap makes the run ask for confirmation (ruling 6, Task 7.13); every start here confirms its pence and
// calls up front (decision 37)
const confirmed = { trigger: 'manual', confirmCostPence: 100, confirmCalls: 1000 } as const;
const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });
const rule = (h: Harness, definitionId: string) =>
  h.repos.alerts.create({
    definitionId,
    type: 'absolute',
    thresholdPence: 100_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });

describe('BudgetExceeded execution-* (spec §8.1, decision 25)', () => {
  it('concurrency 4 with 1 call left → exactly 1 billable call, and its tile is written; the others stay not_run; paused_budget; never an error', async () => {
    const h = createHarness({ fixtureConcurrency: 4 });
    const def = twoPairs(h, { budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    // why: spend arrives after the pre-start check, as a concurrent pass of the same execution would leave it
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }),
    );
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), def.id);
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBeNull();
    expect(scheduleResume).not.toHaveBeenCalled();
    expect(spent(h, e.id)).toHaveLength(1);
    // why: the reservation that passed is honoured (decision 25): its 14 cells are priced, the other three tiles never reserved
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(42);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['paused_budget']);
    expect(h.notifications[0]?.body).toContain("this run's billed-call cap is 50 calls; 50 calls used");
  });

  it('execution-cost: the spend cap stops the pass before the call that would pass it (test-strategy-reviewer-027)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h, { budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 100_000 } });
    // why: after the pre-start check the execution has spent all but 3 199 µGBP, less than one 3 200 µGBP call
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 100_000 - 3_199, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e).toMatchObject({ status: 'paused_budget', resumeAfter: null });
    expect(spent(h, e.id)).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(56);
    expect(h.notifications[0]?.body).toContain(
      "this run's spend cap is £0.10; £0.10 used; the next call needed £0.01",
    );
  });

  it('execution-free-calls: a free provider stops at the free-call cap before its next call', async () => {
    // why: the guard counts the fixture as free here, as it does Travelpayouts
    const h = createHarness({ fixtureConcurrency: 1, fixtureBillable: false });
    const def = twoPairs(h, { budget: { maxCalls: 1000, maxFreeCalls: 1, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 0, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e).toMatchObject({ status: 'paused_budget', resumeAfter: null });
    expect(spent(h, e.id)).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(56);
    expect(h.notifications[0]?.body).toContain(
      "this run's free-call cap is 1 call; 1 call used; the next call needed 1 call",
    );
  });
});

describe('BudgetExceeded provider-month with another provider in the stage (spec §8.1; ssr2-02, prov-wp07-r2-003)', () => {
  /**
   * A running execution whose snapshot lists a second discovery provider. Layer A registers only the fixture, so the
   * second provider exists in the snapshot alone: blocked by the pre-start check, or still able to run.
   */
  async function breachWithSecondProvider(blocked: ProviderId[]) {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const ctx = buildContext(h.deps, h.options);
    const r = await h.orch().start(h.createDefinition().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const exec = h.repos.executions.get(r.executionId);
    if (exec === null) throw new Error('missing execution');
    const two: Execution = {
      ...exec,
      snapshot: {
        ...exec.snapshot,
        providers: { ...exec.snapshot.providers, discovery: ['fixture', 'travelpayouts'] },
      },
    };
    const run = newRun(ctx, two, {
      manual: false,
      fresh: false,
      blocked: new Set(blocked.map((id) => lineKey('discovery', id))),
    });
    const err = new BudgetExceeded({
      scope: 'provider-month',
      providerId: 'fixture',
      cap: 20,
      current: 20,
      requested: 1,
    });
    applyBudgetBreach(ctx, run, 'fixture', 'discovery', err);
    return { h, run };
  }

  it('a provider the pre-start check blocked does not remain: the pass pauses until the window reopens (ssr2-02)', async () => {
    const { h, run } = await breachWithSecondProvider(['travelpayouts']);
    expect(run.stop).toMatchObject({
      kind: 'budget',
      resumeAfter: h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd,
    });
    expect(run.notices).toEqual([]);
  });

  it('a provider that can still run remains: the pass goes on, and the notice says the capped cells stay skipped in this run', async () => {
    const { run } = await breachWithSecondProvider([]);
    expect(run.stop).toBeNull();
    expect(run.notices.map((n) => n.kind)).toEqual(['provider_capped']);
    const { body } = renderOperatorMessage('provider_capped', {
      definitionName: 'x',
      executionId: null,
      detail: run.notices[0]?.detail ?? '',
    });
    expect(body).toContain('Its remaining discovery cells are skipped (budget) in this run');
    expect(body).toContain(
      'resume the run by hand once the cap window reopens or the cap is raised, or the next scheduled run searches them',
    );
  });
});

describe('BudgetExceeded provider-month (spec §8.1)', () => {
  it('no other provider remains: remaining cells skipped:budget; paused_budget with resume_after = next window start; one-shot job; no call after the breach', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), twoPairs(h).id, confirmed);
    const windowEnd = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd;
    expect(windowEnd).toBe('2026-11-01T00:00:00.000Z');
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBe(windowEnd);
    expect(scheduleResume).toHaveBeenCalledWith(e.id, e.definitionId, windowEnd);
    expect(spent(h, e.id)).toHaveLength(1); // 19 pre-spent + 1 = the cap; nothing reserved after the breach
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(42);
    expect(h.outcomes(e.id, { status: 'skipped' }).every((o) => o.reason === 'budget')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['paused_budget']);
  });

  it('two executions sharing the cap never exceed it together; the one that hits it pauses at the window start (cost-r1-012)', async () => {
    // why: each needs 5 calls (4 tiles × 1.2) and both pass the pre-start check against an empty ledger; together they need 8 > 7
    const h = createHarness({ fixtureConcurrency: 2, fixtureMonthlyCallCap: 7 });
    const orch = h.orch();
    // why: other pairs than the first definition's, so http-kit never joins one request to the other's (in-flight dedup)
    const [a, b] = await Promise.all([
      orch.start(twoPairs(h).id, confirmed),
      orch.start(twoPairs(h, { name: 'second', destinations: [EWR] }).id, confirmed),
    ]);
    if (!a.ok || !b.ok) throw new Error('start refused');
    const both = [await h.waitForSettled(a.executionId), await h.waitForSettled(b.executionId)];
    expect(both.reduce((n, e) => n + spent(h, e.id).length, 0)).toBe(7);
    expect(h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls).toBe(7);
    const paused = both.filter((e) => e.status === 'paused_budget');
    expect(paused.length).toBeGreaterThan(0);
    for (const e of paused) expect(e.resumeAfter).toBe('2026-11-01T00:00:00.000Z');
    for (const e of both) {
      expect(['paused_budget', 'completed']).toContain(e.status);
      expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
      expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    }
  });
});

describe('BudgetExceeded global-month (spec §8.1 with decision 25)', () => {
  it('the in-flight call that reserved is written; the sibling refused at reserve and every idle cell become skipped:budget; paused_budget at the global window start', async () => {
    const h = createHarness({ fixtureConcurrency: 2 });
    // why: after the pre-start check, another process leaves room for exactly one fixture call under the £1,000 global cap
    h.onStageStart('discovery', () =>
      h.spendLedger({
        providerId: 'fixture',
        rows: 1,
        costMicroGbpEach: 1_000_000_000 - FIXTURE_COST_MICRO_GBP,
      }),
    );
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK, EWR] }); // 4 pairs × 2 tiles; the fixture pool holds 2
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBe(h.deps.budget.usage({ kind: 'global-month' }).windowEnd);
    expect(spent(h, e.id)).toHaveLength(1);
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(98);
    expect(h.outcomes(e.id, { status: 'skipped' }).every((o) => o.reason === 'budget')).toBe(true);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.notifications[0]?.body).toContain('the monthly spend cap is £1,000');
  });

  it('cost scopes read as money, call scopes as calls; never a bare micro-GBP figure (arch-018)', () => {
    const notice = finalStatus(
      {
        kind: 'budget',
        error: new BudgetExceeded({
          scope: 'global-month',
          cap: 350_000_000,
          current: 350_000_000,
          requested: 3200,
        }),
        resumeAfter: asIsoDateTime('2026-11-01T00:00:00.000Z'),
      },
      asIsoDateTime('2026-10-14T09:00:00.000Z'),
      'Europe/London',
    ).notice;
    expect(notice?.detail).toContain('the monthly spend cap is £350; £350 used; the next call needed £0.01');
    expect(notice?.detail).toContain('Sun, 1 Nov 2026, 00:00 (Europe/London)');
    expect(notice?.detail).not.toMatch(/350000000|3200/);
  });
});

describe('the alerts step and "alerts running on calendar basis only" (spec §6.8, §8.1, decision 25)', () => {
  it('runs once after a completed pass with (deps, executionId, pass); a failing hook is logged, not fatal', async () => {
    const h = createHarness();
    const alerts = vi.fn(async () => ({ digests: 1, events: 2 }));
    const orch = h.orch({ ...h.options, alerts });
    const done = await h.runToCompletion(orch, h.createDefinition().id);
    expect(done.status).toBe('completed');
    expect(alerts).toHaveBeenCalledExactlyOnceWith(h.deps, done.id, { stop: 'completed' });
    alerts.mockRejectedValueOnce(new Error('digest render failed'));
    const second = await h.runToCompletion(orch, h.createDefinition().id);
    expect(second.status).toBe('completed');
    expect(h.logs.some((l) => l.msg === 'alerts: step failed')).toBe(true);
  });

  it('never runs after a pass that paused for errors', async () => {
    const h = createHarness({ fakeTimers: true });
    const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const paused = await h.runToCompletion(h.orch({ ...h.options, alerts }), h.createDefinition().id);
    expect(paused.status).toBe('paused_error');
    expect(alerts).not.toHaveBeenCalled();
  });

  it.each([
    ['cancel', (o: Orchestrator, id: string) => o.cancel(id), 'cancelled'],
    ['SIGTERM', (o: Orchestrator) => o.shutdown(), 'interrupted'],
  ] as const)(
    'never runs after a pass stopped by %s (decision 25, test-strategy-reviewer-026)',
    async (_name, stop, status) => {
      const h = createHarness();
      const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
      await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
      const orch = h.orch({ ...h.options, alerts });
      const r = await orch.start(h.createDefinition().id, { trigger: 'manual' });
      if (!r.ok) throw new Error(r.message);
      await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(0));
      await stop(orch, r.executionId);
      expect((await h.waitForSettled(r.executionId)).status).toBe(status);
      expect(alerts).not.toHaveBeenCalled();
    },
  );

  it('a provider-month breach in verification pauses for the window, runs the alerts step over what was written, and tells the operator once', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const def = h.createDefinition({ providers: withVerification() });
    rule(h, def.id);
    const e = await h.runToCompletion(h.orch({ ...h.options, alerts }), def.id);
    expect(e.status).toBe('paused_budget');
    expect(alerts).toHaveBeenCalledExactlyOnceWith(h.deps, e.id, { stop: 'budget' });
    const v = h.outcomes(e.id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');
    expect(v).toHaveLength(2);
    expect(v.every((o) => o.status === 'skipped' && o.reason === 'budget')).toBe(true);
    expect(kinds(h)).toEqual(['paused_budget', 'alerts_calendar_only']);
  });

  it('no calendar-only notice when the definition has no alert rule', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ providers: withVerification() }).id);
    expect(e.status).toBe('paused_budget');
    expect(kinds(h)).toEqual(['paused_budget']);
  });
});
