import { asIsoDate, type Estimate, type ProviderId } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { checkBudget, reservedForSchedules } from '../src/budgetCheck.js';
import { buildContext } from '../src/context.js';
import { confirmationOf, withBlocked } from '../src/estimate.js';
import { lineKey } from '../src/lines.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { nothingToSearch } from '../src/start.js';
import {
  createHarness,
  EWR,
  FIXTURE_RULES,
  type Harness,
  JFK,
  LGW,
  LHR,
  refusedWith,
  withVerification,
} from './support/harness.js';

const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });
const confirmDetails = z.object({
  estimateMicroGbp: z.number(),
  estimatePence: z.number(),
  calls: z.record(z.string(), z.number()),
  totalCalls: z.number(),
});
const noCalls = { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 };

describe('pre-start checks (spec §8.1 "for every scope check usage(scope) + estimate(scope) ≤ cap")', () => {
  it('active: a second start while one is active → code active', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const orch = h.orch();
    const def = h.createDefinition();
    const first = await orch.start(def.id, { trigger: 'manual' });
    expect(first.ok).toBe(true);
    expect(await orch.start(def.id, { trigger: 'manual' })).toMatchObject({ ok: false, code: 'active' });
  });

  it('active: a start that loses the race to the one-active-parent index → code active (db reports it, code-architect review 3)', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const orch = h.orch();
    const def = h.createDefinition();
    expect((await orch.start(def.id, { trigger: 'manual' })).ok).toBe(true);
    // why: the read-side check races a concurrent start; hiding the first run from it makes the insert hit the index
    vi.spyOn(h.repos.executions, 'activeParent').mockReturnValue(null);
    expect(refusedWith(await orch.start(def.id, { trigger: 'manual' }), 'active')).toBe(
      'another execution of this definition is active',
    );
    expect(executions(h, def.id)).toHaveLength(1);
  });

  it('cap: nothing can run → code cap naming the cap and the figures with units; no execution is created', async () => {
    const h = createHarness();
    const def = h.createDefinition({ budget: noCalls });
    expect(refusedWith(await h.orch().start(def.id, { trigger: 'manual' }), 'cap')).toBe(
      "budget cap: this run's billed-call cap is 0 calls; 0 calls used; this run needs 3 calls",
    );
    expect(executions(h, def.id)).toHaveLength(0);
  });

  it('execution-cost: an estimate above the spend cap is refused before any call (test-strategy-reviewer-027)', async () => {
    const h = createHarness();
    const def = h.createDefinition({
      budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 5_000 },
    });
    expect(refusedWith(await h.orch().start(def.id, { trigger: 'manual' }), 'cap')).toBe(
      "budget cap: this run's spend cap is £0.01; £0 used; this run needs £0.01",
    );
    expect(h.count('provider_requests')).toBe(0);
  });

  it('execution-free-calls: a free provider needing more than the free-call cap is refused before any call', async () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    // why: the fixture is billed; its limits read as a free provider's here stand in for Travelpayouts
    const free = { ...ctx, limitsOf: (id: ProviderId) => ({ ...ctx.limitsOf(id), billed: false }) };
    const def = h.createDefinition({
      budget: { maxCalls: 1000, maxFreeCalls: 0, maxCostMicroGbp: 1_000_000_000 },
    });
    expect(
      refusedWith(await h.track(createOrchestrator(free)).start(def.id, { trigger: 'manual' }), 'cap'),
    ).toBe("budget cap: this run's free-call cap is 0 calls; 0 calls used; this run needs 3 calls");
    expect(h.count('provider_requests')).toBe(0);
  });

  it('global-month: spend already in the month plus the estimate above the global cap is refused; the ledger keeps only the pre-spent row', async () => {
    const h = createHarness({ env: { MONTHLY_SPEND_CAP_PENCE: '1' } });
    h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 5_000 });
    expect(refusedWith(await h.orch().start(h.createDefinition().id, { trigger: 'manual' }), 'cap')).toBe(
      'budget cap: the monthly spend cap is £0.01; £0.01 used; this run needs £0.01',
    );
    expect(h.count('provider_requests')).toBe(1);
  });

  it('cap on a scheduled run → skipped_budget recorded and notified', async () => {
    const h = createHarness();
    const def = h.createDefinition({ budget: noCalls });
    expect(await h.orch().start(def.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'cap' });
    const [e] = executions(h, def.id);
    expect(e).toMatchObject({ status: 'skipped_budget', finishedAt: h.clock.now(), trigger: 'schedule' });
    expect(kinds(h)).toEqual(['skipped_budget']);
  });

  it('a blocked provider makes no call: with nothing else to run the start is refused and the ledger stays empty', async () => {
    const h = createHarness();
    const def = h.createDefinition({ providers: withVerification(), budget: noCalls });
    expect(await h.orch().start(def.id, { trigger: 'manual' })).toMatchObject({ ok: false, code: 'cap' });
    expect(h.count('provider_requests')).toBe(0);
  });

  it('the provider-month check keeps the headroom other enabled schedules need this window (ruling 5)', async () => {
    const h = createHarness({ fixtureMonthlyCallCap: 20 });
    h.spendLedger({ providerId: 'fixture', rows: 12, costMicroGbpEach: 0 });
    const def = h.createDefinition();
    // why: a weekly schedule fires on 19 and 26 October before the 1 November window start: 2 × 3 calls reserved; 12 + 6 + 3 > 20
    h.createDefinition({ destinations: [EWR], scheduleCron: '0 5 * * 1' });
    expect(refusedWith(await h.orch().start(def.id, { trigger: 'manual' }), 'cap')).toContain(
      '(6 more reserved for other scheduled runs this window)',
    );
    const lone = createHarness({ fixtureMonthlyCallCap: 20 });
    lone.spendLedger({ providerId: 'fixture', rows: 12, costMicroGbpEach: 0 });
    expect((await lone.orch().start(lone.createDefinition().id, { trigger: 'manual' })).ok).toBe(true);
  });

  it("the reservation uses budgetFit's model: a daily schedule holds its discovery once per reuse window, not once a firing (cost-r2-002)", async () => {
    const h = createHarness({ fixtureMonthlyCallCap: 30 });
    h.spendLedger({ providerId: 'fixture', rows: 12, costMicroGbpEach: 0 });
    const def = h.createDefinition();
    h.createDefinition({ destinations: [EWR], scheduleCron: '0 5 * * *' });
    const ctx = buildContext(h.deps, h.options);
    const windowEnd = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd;
    expect(windowEnd).toBe('2026-11-01T00:00:00.000Z');
    // why: 17 daily firings (15–31 October) of 3 factored discovery calls, but discovery at most once per 0.9 × 168 h
    // over the 423 h to the window end: 3 × min(17, ⌈423 / 151.2⌉) = 9 (whole discovery runs, cost M-3), where one
    // per firing would hold 51
    expect(reservedForSchedules(ctx, 'fixture', def.id, windowEnd)).toBe(3 * Math.ceil(423 / 151.2));
    expect(reservedForSchedules(ctx, 'fixture', def.id, windowEnd)).toBe(9);
    expect((await h.orch().start(def.id, { trigger: 'manual' })).ok).toBe(true); // 12 + 9 + 3 ≤ 30
  });

  it('a fully reusable discovery line is never blocked: a provider-month breach on verification still starts a calendar-basis run on reused prices (ruling 2, ssr I2)', async () => {
    const h = createHarness({ fixtureMonthlyCallCap: 40 });
    const confirm = { trigger: 'manual', confirmCostPence: 100, confirmCalls: 1000 } as const;
    const def = h.createDefinition({ providers: withVerification() });
    const first = await h.runToCompletion(h.orch(), def.id, confirm);
    expect(first.status).toBe('completed');
    const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
    h.spendLedger({ providerId: 'fixture', rows: 40 - used, costMicroGbpEach: 0 }); // the month's calls are gone
    const before = h.requests.length;
    const second = await h.runToCompletion(h.orch(), def.id, confirm);
    expect(second.status).toBe('completed');
    expect(second.estimate?.perProvider.map((p) => [p.stage, p.calls, p.blocked])).toEqual([
      ['discovery', 0, null],
      ['verification', expect.any(Number), 'provider-month'],
    ]);
    const discovery = h.outcomes(second.id, { stage: 'discovery' });
    expect(discovery).toHaveLength(28);
    expect(discovery.every((o) => o.reusedFromExecutionId === first.id)).toBe(true);
    const verification = h.outcomes(second.id, { stage: 'verification' });
    // why: selection still runs on the reused prices; the selected cells are the ones the blocked line skips
    expect(verification.filter((o) => o.reason === 'budget')).toHaveLength(2);
    expect(
      verification.every(
        (o) => o.status === 'skipped' && ['budget', 'not_selected'].includes(o.reason ?? ''),
      ),
    ).toBe(true);
    expect(h.requests.length).toBe(before);
  });

  it('checkBudget blocks per (provider, stage) line and never a line that needs no call (ruling 2)', () => {
    const h = createHarness({ fixtureMonthlyCallCap: 10 });
    const ctx = buildContext(h.deps, h.options);
    const spend = [
      { providerId: 'fixture', stage: 'discovery', calls: 0, costMicroGbp: 0 },
      { providerId: 'fixture', stage: 'verification', calls: 12, costMicroGbp: 0 },
    ] as const;
    const check = checkBudget(
      ctx,
      spend,
      { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 10 ** 9 },
      null,
      null,
    );
    expect(check.breaches.map((b) => b.scope)).toEqual(['provider-month']);
    expect(check.blocked.has(lineKey('verification', 'fixture'))).toBe(true);
    expect(check.blocked.has(lineKey('discovery', 'fixture'))).toBe(false);
    expect([...check.blockedBy]).toEqual([[lineKey('verification', 'fixture'), 'provider-month']]);
  });

  it('every discovery provider blocked and nothing always included → nothing would be searched, so the start is refused (ssr2-03)', () => {
    const verification = { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 1, bookingLinks: true };
    const line = (providerId: ProviderId, stage: 'discovery' | 'verification', calls: number) => ({
      providerId,
      stage,
      calls,
      planCalls: calls,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 0,
      blocked: null,
    });
    const lines = [line('travelpayouts', 'discovery', 28), line('fixture', 'verification', 8)];
    const sellsAll = () => true;
    const cell = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-11-03'),
      returnDate: asIsoDate('2026-11-10'),
    };
    expect(
      nothingToSearch(
        { verification },
        { perProvider: lines },
        new Set([lineKey('discovery', 'travelpayouts')]),
        sellsAll,
      ),
    ).toBe(true);
    expect(
      nothingToSearch(
        { verification: { ...verification, alwaysInclude: [cell] } },
        { perProvider: lines },
        new Set([lineKey('discovery', 'travelpayouts')]),
        sellsAll,
      ),
    ).toBe(false);
    expect(nothingToSearch({ verification }, { perProvider: lines }, new Set(), sellsAll)).toBe(false);
    expect(
      nothingToSearch(
        { verification },
        { perProvider: lines },
        new Set([lineKey('discovery', 'travelpayouts'), lineKey('verification', 'fixture')]),
        sellsAll,
      ),
    ).toBe(true);
    // a discovery line needing no call (every cell reused) is never blocked, so reused prices still feed selection
    const reused = [line('travelpayouts', 'discovery', 0), line('fixture', 'verification', 8)];
    expect(nothingToSearch({ verification }, { perProvider: reused }, new Set(), sellsAll)).toBe(false);
  });

  it('a discovery line whose provider does not sell the cabin feeds nothing, so it never keeps a starved run going (re-review N1)', () => {
    const verification = { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 1, bookingLinks: true };
    const line = (providerId: ProviderId, stage: 'discovery' | 'verification', calls: number) => ({
      providerId,
      stage,
      calls,
      planCalls: calls,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 0,
      blocked: null,
    });
    // why: the trial preset with a business cabin: Travelpayouts sells economy only, so its line is 0 calls and unblocked
    const economyOnly = (id: ProviderId) => id !== 'travelpayouts';
    // (a) Travelpayouts discovery only; SearchApi verification blocked
    const a = [line('travelpayouts', 'discovery', 0), line('searchapi', 'verification', 8)];
    const verificationBlocked = new Set([lineKey('verification', 'searchapi')]);
    expect(nothingToSearch({ verification }, { perProvider: a }, verificationBlocked, economyOnly)).toBe(
      true,
    );
    // (b) Travelpayouts and SearchApi discovery; SearchApi blocked in both stages
    const b = [
      line('travelpayouts', 'discovery', 0),
      line('searchapi', 'discovery', 6),
      line('searchapi', 'verification', 8),
    ];
    const both = new Set([lineKey('discovery', 'searchapi'), lineKey('verification', 'searchapi')]);
    expect(nothingToSearch({ verification }, { perProvider: b }, both, economyOnly)).toBe(true);
    expect(nothingToSearch({ verification }, { perProvider: b }, new Set(), economyOnly)).toBe(false);
  });

  it("totals leave out a blocked provider's lines, which keep their own figures (cost-r1-014)", () => {
    const fixture = {
      providerId: 'fixture' as const,
      stage: 'discovery' as const,
      calls: 3,
      planCalls: 2,
      costMicroGbp: 7680,
      costPence: 1,
      seconds: 2,
      blocked: null,
    };
    const est: Estimate = {
      cells: 28,
      perProvider: [fixture, { ...fixture, providerId: 'searchapi', calls: 60, planCalls: 50, seconds: 900 }],
      totalCalls: 63,
      totalPlanCalls: 52,
      totalCostMicroGbp: 15_360,
      totalCostPence: 2,
      seconds: 902,
      assumptions: ['every call count includes the retry factor 1.2'],
      windowClamped: false,
      retryFactor: 1.2,
    };
    const shown = withBlocked(est, new Map([[lineKey('discovery', 'searchapi'), 'provider-month']]));
    expect(shown.perProvider.map((p) => [p.providerId, p.blocked, p.calls])).toEqual([
      ['fixture', null, 3],
      ['searchapi', 'provider-month', 60],
    ]);
    expect(shown).toMatchObject({
      totalCalls: 3,
      totalPlanCalls: 2,
      totalCostMicroGbp: 7680,
      totalCostPence: 1,
      seconds: 2,
    });
    expect(shown.assumptions).toContain('totals leave out the provider lines a budget cap blocks');
    expect(withBlocked(est, new Map())).toEqual(est);
    // why: cost M-2 — the confirmation a definition stores is the worst case over every line, blocked ones included, so
    // next month's run with the provider back is still covered: 1 + 1 pence (rounded up per line) and 3 + 60 calls
    expect(confirmationOf(shown)).toEqual({ pence: 2, calls: 63 });
    expect(confirmationOf(shown)).toEqual(confirmationOf(est));
  });
});

describe('not_found, disabled and no runnable provider (plan contract StartResult codes, po-003)', () => {
  it('a missing or soft-deleted definition → not_found; a disabled one → disabled; nothing is created', async () => {
    const h = createHarness();
    const o = h.orch();
    expect(await o.start('no-such-definition', { trigger: 'manual' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    const gone = h.createDefinition();
    h.repos.definitions.softDelete(gone.id);
    expect(await o.start(gone.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'not_found' });
    const off = h.createDefinition({ enabled: false });
    expect(await o.start(off.id, { trigger: 'manual' })).toMatchObject({
      ok: false,
      code: 'disabled',
      message: 'this definition is disabled',
    });
    expect(executions(h, gone.id)).toHaveLength(0);
    expect(executions(h, off.id)).toHaveLength(0);
  });

  it('a scheduled run no configured provider can run is refused as a configuration problem, not a budget one', async () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    // why: the plan flag (the SearchApi trial rule, spec §8.2) set on the fixture's limits; the only provider a layer-A test may register
    const trialLike = {
      ...ctx,
      limitsOf: (id: ProviderId) => ({ ...ctx.limitsOf(id), excludedFromSchedule: true }),
    };
    const orch = h.track(createOrchestrator(trialLike));
    const def = h.createDefinition();
    expect(refusedWith(await orch.start(def.id, { trigger: 'schedule' }), 'disabled')).toBe(
      'no configured provider can run this definition on a schedule: fixture is excluded from scheduled runs on its plan',
    );
    expect(executions(h, def.id)).toHaveLength(0);
    expect(h.notifications.map((m) => m.subject)).toEqual([
      '[get-me-there] London to New York (layer A): scheduled run skipped: no configured provider can run it',
    ]);
    expect((await orch.start(def.id, { trigger: 'manual' })).ok).toBe(true);
  });
});

describe('SOFT_CONFIRM in pence and calls; confirmed_cost_pence and confirmed_calls (spec §8.1, §7; ruling 6, decision 37)', () => {
  it('a manual start above SOFT_CONFIRM needs a confirmation naming at least the runnable pence and calls', async () => {
    const h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const orch = h.orch();
    const def = h.createDefinition();
    const r = await orch.start(def.id, { trigger: 'manual' });
    expect(r).toMatchObject({ ok: false, code: 'confirm' });
    expect(confirmDetails.parse(r.ok ? null : r.details)).toEqual({
      estimateMicroGbp: 7680,
      estimatePence: 1,
      calls: { fixture: 3 },
      totalCalls: 3,
    });
    for (const short of [
      { confirmCostPence: 1 },
      { confirmCostPence: 0, confirmCalls: 3 },
      { confirmCostPence: 1, confirmCalls: 2 },
    ])
      refusedWith(await orch.start(def.id, { trigger: 'manual', ...short }), 'confirm');
    expect((await orch.start(def.id, { trigger: 'manual', confirmCostPence: 1, confirmCalls: 3 })).ok).toBe(
      true,
    );
  });

  it('calls trigger the confirmation too, and 0p alone never covers them (ruling 6, cost-r1-005)', async () => {
    const h = createHarness({ fixtureCostMicroGbp: 0, fixtureMonthlyCallCap: 10 });
    const orch = h.orch();
    const def = h.createDefinition(); // 3 calls > 20% of 10
    expect(refusedWith(await orch.start(def.id, { trigger: 'manual' }), 'confirm')).toBe(
      'this run needs 3 fixture calls, more than 20% of its monthly call cap and has not been confirmed',
    );
    refusedWith(await orch.start(def.id, { trigger: 'manual', confirmCostPence: 0 }), 'confirm');
    expect((await orch.start(def.id, { trigger: 'manual', confirmCostPence: 0, confirmCalls: 3 })).ok).toBe(
      true,
    );
  });

  it('a lifetime plan (the SearchApi trial) asks above 20% of its lifetime cap (cost-r2-004)', async () => {
    const h = createHarness({ fixtureCostMicroGbp: 0, fixtureMonthlyCallCap: 10, fixtureWindow: 'lifetime' });
    const ctx = buildContext(h.deps, h.options);
    // why: the guard and the engine both read the fixture's window as lifetime here, as they read the trial's
    const lifetime = {
      ...ctx,
      limitsOf: (id: ProviderId) => ({
        ...ctx.limitsOf(id),
        window: 'lifetime' as const,
        capKind: 'provider-lifetime' as const,
      }),
    };
    const orch = h.track(createOrchestrator(lifetime));
    const def = h.createDefinition();
    expect(refusedWith(await orch.start(def.id, { trigger: 'manual' }), 'confirm')).toBe(
      'this run needs 3 fixture calls, more than 20% of its lifetime call cap and has not been confirmed',
    );
    expect((await orch.start(def.id, { trigger: 'manual', confirmCostPence: 0, confirmCalls: 3 })).ok).toBe(
      true,
    );
  });

  it('a scheduled start uses only the stored confirmation; without it, or after an edit that needs more calls → skipped_confirm + notify', async () => {
    const h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const orch = h.orch();
    const def = h.createDefinition();
    const r = await orch.start(def.id, { trigger: 'schedule' });
    expect(r).toMatchObject({ ok: false, code: 'confirm' });
    expect(executions(h, def.id)[0]).toMatchObject({ status: 'skipped_confirm' });
    expect(kinds(h)).toEqual(['skipped_confirm']);
    const details = confirmDetails.parse(r.ok ? null : r.details);
    h.repos.definitions.setConfirmed(def.id, { pence: details.estimatePence, calls: details.totalCalls });
    const again = await orch.start(def.id, { trigger: 'schedule' });
    if (!again.ok) throw new Error(again.message);
    await h.waitForSettled(again.executionId);
    expect(h.repos.definitions.get(def.id)).toMatchObject({ confirmedCostPence: 1, confirmedCalls: 3 }); // never recomputed
    // why: cost-r1-005 — a stored confirmation covers no later edit that needs more calls (two pairs not searched yet,
    // so nothing is reused: 5 calls against the 3 confirmed)
    h.repos.definitions.update(def.id, { origins: [LGW], destinations: [JFK, EWR] });
    refusedWith(await orch.start(def.id, { trigger: 'schedule' }), 'confirm');
    expect(executions(h, def.id).filter((e) => e.status === 'skipped_confirm')).toHaveLength(2);
  });
});

describe('zero-cell window (spec §6.1)', () => {
  it('manual → code window; scheduled → skipped_window, notified, schedule disabled and unregistered', async () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    const unregister = vi.fn();
    ctx.hooks.unregisterSchedule = unregister;
    const orch = h.track(createOrchestrator(ctx));
    const def = h.createDefinition({
      window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-03') },
      scheduleCron: '0 5 * * 1',
    });
    expect(await orch.start(def.id, { trigger: 'manual' })).toMatchObject({ ok: false, code: 'window' });
    expect(executions(h, def.id)).toHaveLength(0);
    expect(await orch.start(def.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'window' });
    expect(executions(h, def.id)[0]).toMatchObject({ status: 'skipped_window' });
    expect(kinds(h)).toEqual(['skipped_window']);
    expect(h.repos.definitions.get(def.id)?.enabled).toBe(false);
    expect(unregister).toHaveBeenCalledWith(def.id);
  });

  it('T6: a skip whose notice returns after the engine handed the database back disables and unregisters nothing', async () => {
    const h = createHarness();
    const unregister = vi.fn();
    // why: the notice's send outlives the shutdown's wait, so the engine is closed when it returns
    const ctx = buildContext(
      {
        ...h.deps,
        notifiers: [
          {
            id: 'slow',
            send: async () => {
              ctx.lifecycle.closed = true;
              return { ok: true };
            },
          },
        ],
      },
      h.options,
    );
    ctx.hooks.unregisterSchedule = unregister;
    const orch = h.track(createOrchestrator(ctx));
    const def = h.createDefinition({
      window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-03') },
      scheduleCron: '0 5 * * 1',
    });
    expect(await orch.start(def.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'window' });
    expect(h.repos.definitions.get(def.id)?.enabled).toBe(true);
    expect(unregister).not.toHaveBeenCalled();
  });
});
