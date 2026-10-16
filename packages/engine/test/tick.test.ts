import { asIsoDateTime, type IsoDateTime } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { isStalePaused, SUPERSEDED } from '../src/resume.js';
import { tickDefinition } from '../src/tick.js';
import {
  createHarness,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  HOUR,
  JFK,
  LGW,
  LHR,
  tileRule,
} from './support/harness.js';

const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], scheduleCron: '0 5 * * 1', ...patch });
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });

describe('isStalePaused (spec §8.1/§8.2 supersede, ruling 10: 0.9 × discoveryRefreshHours)', () => {
  it('a paused run with no resume_after is stale once older than 151.2 h, so a weekly tick supersedes one that paused just after the last firing', async () => {
    const h = createHarness({ fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const e = await h.runToCompletion(h.orch(), twoPairs(h).id);
    expect(e).toMatchObject({
      status: 'paused_error',
      resumeAfter: null,
      startedAt: '2026-10-14T09:00:00.000Z',
    });
    const at = (hours: number) =>
      asIsoDateTime(new Date(Date.parse(e.startedAt ?? '') + hours * HOUR).toISOString());
    expect(isStalePaused(e, at(151))).toBe(false);
    expect(isStalePaused(e, at(152))).toBe(true);
    expect(isStalePaused(e, at(167))).toBe(true); // a DST-shortened week
    expect(isStalePaused(e, at(168 - 1 / 120))).toBe(true); // the next weekly firing, 30 s short of 168 h
    expect(isStalePaused({ ...e, resumeAfter: at(200) }, at(169))).toBe(false); // resume_after still in the future
    expect(isStalePaused({ ...e, status: 'interrupted' }, at(400))).toBe(false);
  });
});

describe('tick (spec §8.2 "A tick, in order")', () => {
  it('with nothing active, runs the pre-start checks and starts a scheduled run', async () => {
    const h = createHarness();
    const def = twoPairs(h);
    await h.orch().tick(def.id);
    const [e] = executions(h, def.id);
    if (e === undefined) throw new Error('no execution');
    expect(e.trigger).toBe('schedule');
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
  });

  it('with an execution active, records nothing and keeps the oldest "schedule blocked since" across definitions until a tick starts', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const a = twoPairs(h);
    const b = twoPairs(h, { name: 'second' });
    const o = h.orch();
    const ra = await o.start(a.id, { trigger: 'manual' });
    const rb = await o.start(b.id, { trigger: 'manual' });
    if (!ra.ok || !rb.ok) throw new Error('start refused');
    const first = h.clock.now();
    await o.tick(a.id);
    h.clock.advance(HOUR);
    await o.tick(b.id);
    await o.tick(a.id); // blocked again: the first instant is kept
    expect(executions(h, a.id)).toHaveLength(1);
    expect(
      h.logs
        .filter((l) => l.msg === 'tick: schedule blocked by an active execution')
        .map((l) => l.fields.since),
    ).toEqual([first, h.clock.now(), first]);
    expect(o.blockedSince()).toBe(first);
    await o.cancel(ra.executionId);
    await o.tick(a.id); // starts: a's entry is cleared, b's remains
    expect(o.blockedSince()).toBe(h.clock.now());
  });

  it('resumes a paused_error once resume_after has passed, and not before', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.limiterTimeout, 1)]); // why: a Retry-After beyond MAX_WAIT_SECONDS fails at once, one attempt
    const def = twoPairs(h);
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.status).toBe('paused_error');
    await h.orch().tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_error');
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    await h.orch().tick(def.id);
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(executions(h, def.id)).toHaveLength(1);
  });

  it('resumes a paused_budget only when estimateRemaining passes the cap check (at the window start); a refused resume blocks the schedule (ssr-19)', async () => {
    // why: start near the month end so the window start comes before the pause is stale (0.9 × 168 h)
    const h = createHarness({
      fixtureConcurrency: 1,
      fixtureMonthlyCallCap: 20,
      now: asIsoDateTime('2026-10-28T09:00:00.000Z'),
    });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const def = twoPairs(h);
    const e = await h.runToCompletion(h.orch(), def.id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 1000,
    });
    h.clearHooks();
    expect(e.status).toBe('paused_budget');
    const o = h.orch();
    await o.tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_budget');
    expect(o.blockedSince()).toBe(h.clock.now());
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    await o.tick(def.id);
    expect(o.blockedSince()).toBeNull();
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
  });

  it('never resumes an execution-* paused_budget (no resume_after): it needs a manual /resume, so the schedule is blocked (ruling 4, cost I-1)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    // why: the start needs 5 of 6 calls; 3 spent by a concurrent pass leave room for 3 of the 4 tiles
    const def = twoPairs(h, { budget: { maxCalls: 6, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 3, costMicroGbpEach: 0, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    h.clearHooks();
    expect(e).toMatchObject({ status: 'paused_budget', resumeAfter: null });
    const ctx = buildContext(h.deps, h.options);
    const orch = h.orch();
    const resume = vi.fn(orch.resume);
    const blocked = new Map<string, IsoDateTime>();
    await tickDefinition(ctx, { start: orch.start, resume, cancel: orch.cancel }, def.id, blocked);
    expect(resume).not.toHaveBeenCalled();
    expect(blocked.get(def.id)).toBe(h.clock.now());
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_budget');
  });

  it('cancels and supersedes a paused run older than 0.9 × discoveryRefreshHours whose resume_after is not in the future', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const def = twoPairs(h);
    const old = await h.runToCompletion(h.orch(), def.id);
    expect(old.status).toBe('paused_error');
    h.clock.advance(168 * HOUR - 30_000); // the next weekly firing
    await h.orch().tick(def.id);
    expect(h.repos.executions.get(old.id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED });
    const fresh = executions(h, def.id).find((x) => x.id !== old.id);
    if (fresh === undefined) throw new Error('no fresh execution');
    expect((await h.waitForSettled(fresh.id)).status).toBe('completed');
  });

  it('exempts a paused_budget whose resume_after is still in the future from the supersede', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const def = twoPairs(h);
    const e = await h.runToCompletion(h.orch(), def.id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 1000,
    });
    h.clearHooks();
    h.clock.advance(169 * HOUR); // 2026-10-21, before the 1 November window start
    await h.orch().tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_budget');
    expect(executions(h, def.id)).toHaveLength(1);
  });

  it('a disabled, deleted or unscheduled definition does nothing (plan decision 5, ssr2-06)', async () => {
    const h = createHarness();
    const def = twoPairs(h);
    h.repos.definitions.update(def.id, { enabled: false });
    await h.orch().tick(def.id);
    const gone = twoPairs(h);
    h.repos.definitions.softDelete(gone.id);
    await h.orch().tick(gone.id);
    const manual = twoPairs(h, { scheduleCron: null });
    await h.orch().tick(manual.id);
    expect(executions(h, def.id)).toHaveLength(0);
    expect(executions(h, gone.id)).toHaveLength(0);
    expect(executions(h, manual.id)).toHaveLength(0);
  });
});
