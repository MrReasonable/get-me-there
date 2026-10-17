import { asIsoDate, asIsoDateTime, parseConfig, type SearchDefinition } from '@gmt/core';
import { takeStrays } from '@gmt/providers/testing';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createEngine } from '../src/index.js';
import { NEVER_STARTED, SUPERSEDED } from '../src/resume.js';
import { buildSnapshot } from '../src/snapshot.js';
import type { Engine } from '../src/types.js';
import { frankfurterBody, stubFrankfurter } from './support/fx.js';
import {
  createHarness,
  EWR,
  FIXTURE_RULES,
  type Harness,
  HOUR,
  JFK,
  LGW,
  LHR,
  T0,
  tileRule,
  withVerification,
} from './support/harness.js';

// why: every test here runs croner, http-kit and the engine on faked timers set to T0, so the process clock and the
// engine clock agree and no job fires on the real clock (test-strategy-reviewer-004)
const fake = { fakeTimers: true } as const;
const engine = (h: Harness, opts = h.options): Engine => h.track(createEngine(h.deps, opts));
const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });
const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });

/** An execution row written directly, as a process that died right after creating it would leave it (pending, nothing seeded). */
function ghost(h: Harness, def: SearchDefinition): string {
  const b = buildSnapshot(buildContext(h.deps, h.options), def);
  return h.repos.executions.create({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot: b.snapshot,
    estimate: null,
    trigger: 'manual',
    status: 'pending',
  }).id;
}

async function interrupted(h: Harness): Promise<string> {
  const first = engine(h);
  h.onTileCommit((n) => {
    if (n === 1) void first.shutdown();
  });
  const r = await first.start(twoPairs(h).id, { trigger: 'manual' });
  if (!r.ok) throw new Error(r.message);
  await h.waitForSettled(r.executionId);
  h.clearHooks();
  return r.executionId;
}

describe('createEngine', () => {
  it('refuses the fixture provider under a production config, as buildContext does (spec §5.5; prov-wp07-012)', () => {
    const h = createHarness();
    const parsed = parseConfig(
      { NODE_ENV: 'production', DATABASE_PATH: '/data/app.db', BIND_ADDRESS: '127.0.0.1' },
      { realpath: (p) => p },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    // why: this suite's other tests are the positive control: the same deps under the harness's open gate build an engine
    expect(() => createEngine({ ...h.deps, config: parsed.config }, h.options)).toThrow(
      'the fixture provider is registered but syntheticAllowed(config) is false (spec §5.5)',
    );
    // nothing ran: no request, no execution, no notification (test-strategy-reviewer-r3-005)
    expect(h.requests).toEqual([]);
    expect(h.count('provider_requests')).toBe(0);
    expect(h.repos.executions.listByStatus(['pending', 'running', 'interrupted'])).toEqual([]);
    expect(h.notifications).toEqual([]);
  });
});

describe('boot (spec §8.1 "Boot order")', () => {
  it('runs sweep → auto-resume → one-shot jobs → cron, in that order', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    // why: a pair the interrupted definition does not have, so the rule cannot touch its resumed pass
    await h.fixtureScenario([
      {
        match: { path: '/calendar', params: { origin: 'LGW', destination: 'EWR', departFrom: '2026-11-02' } },
        respond: FIXTURE_RULES.limiterTimeout,
        times: 1,
      },
    ]);
    const paused = await h.runToCompletion(
      engine(h),
      h.createDefinition({ origins: [LGW], destinations: [EWR] }).id,
    );
    expect(paused.status).toBe('paused_error');
    const scheduled = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    h.logs.length = 0;
    const e2 = engine(h);
    await e2.boot();
    const phases = ['boot: sweep', 'boot: auto-resume', 'boot: one-shot jobs', 'boot: cron'];
    expect(
      h.logs.map((l) => l.msg).filter((m): m is string => m !== undefined && phases.includes(m)),
    ).toEqual(phases);
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: id,
      result: 'resumed',
    });
    expect(h.logs.find((l) => l.msg === 'boot: one-shot jobs')?.fields).toEqual({
      oneShots: 1,
      superseded: 0,
    });
    expect(e2.scheduler.jobs()).toEqual([
      expect.objectContaining({
        kind: 'definition',
        definitionId: scheduled.id,
        cron: '0 5 * * 1',
        tz: 'Europe/London',
        nextRun: '2026-10-19T04:00:00.000Z',
      }),
      expect.objectContaining({ kind: 'resume', executionId: paused.id, nextRun: paused.resumeAfter }),
    ]);
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('SIGTERM then reboot resumes without incrementing auto_resume_count', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    expect(h.repos.executions.get(id)?.autoResumeCount).toBe(0);
    await engine(h).boot();
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: id,
      autoResumeCount: 0,
      result: 'resumed',
    });
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('a row left running by a dead process is crash-marked (count + 1), notified once and resumed', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    h.repos.executions.setStatus(id, 'running'); // what a crash leaves behind
    await engine(h).boot();
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: id,
      autoResumeCount: 1,
      result: 'resumed',
    });
    expect((await h.waitForSettled(id)).status).toBe('completed');
    expect(h.repos.executions.get(id)?.autoResumeCount).toBe(0); // reset by the first commit of the resumed pass
    expect(kinds(h).filter((k) => k === 'interrupted')).toHaveLength(1); // the SIGTERM notice; the crash notice deduplicates
  });

  it('crash-loop cap: auto_resume_count > MAX_AUTO_RESUMES stops auto-resume and sends crash_loop', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    for (let i = 0; i < h.config.maxAutoResumes; i += 1) h.repos.executions.incrementAutoResume(id);
    h.repos.executions.setStatus(id, 'running');
    await engine(h).boot();
    expect(h.repos.executions.get(id)).toMatchObject({
      status: 'interrupted',
      autoResumeCount: h.config.maxAutoResumes + 1,
    });
    const msg = h.notifications.find((m) => m.kind === 'crash_loop' && m.executionId === id);
    expect(msg?.body).toContain(
      `Automatic resume stopped after ${h.config.maxAutoResumes + 1} restarts without progress`,
    );
  });

  it('pending sweep: a pending execution older than the boot becomes interrupted; ledger rows pending > 10 min become unknown', async () => {
    const h = createHarness({ ...fake, env: { AUTO_RESUME: 'false' } });
    const pending = ghost(h, h.createDefinition());
    h.clock.advance(60_000); // the boot comes after the pending row was written
    const insert = h.db.raw.prepare<[string]>(
      `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('fixture', NULL, '/x', NULL, ?, 'pending', 3200, 1)`,
    );
    insert.run('2026-10-14T08:46:00.000Z'); // 15 min before the boot at 09:01
    insert.run('2026-10-14T08:56:00.000Z'); // 5 min before the boot
    await engine(h).boot();
    expect(h.repos.executions.get(pending)).toMatchObject({ status: 'interrupted', autoResumeCount: 1 });
    const outcomes = h.db.raw
      .prepare<[], { outcome: string }>(
        `SELECT outcome FROM provider_requests WHERE endpoint_path = '/x' ORDER BY started_at`,
      )
      .all();
    expect(outcomes).toEqual([{ outcome: 'unknown' }, { outcome: 'pending' }]);
  });

  it('an execution that was never seeded is cancelled on resume, never completed empty (ssr-07)', async () => {
    const h = createHarness(fake);
    const pending = ghost(h, h.createDefinition());
    h.clock.advance(60_000);
    await engine(h).boot();
    expect(h.repos.executions.get(pending)).toMatchObject({ status: 'cancelled', errorText: NEVER_STARTED });
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: pending,
      result: 'not_found',
    });
  });

  it('makes no network call; when no FX rate is a day fresh, the refresh runs a minute after boot (spec §5.6, po-011)', async () => {
    const h = createHarness(fake);
    const fx = stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    await engine(h).boot();
    expect(fx.urls).toEqual([]);
    expect(h.requests).toHaveLength(0);
    expect(h.count('provider_requests')).toBe(0);
    expect(takeStrays()).toEqual([]);
    await vi.advanceTimersByTimeAsync(61_000);
    await h.drive(vi.waitFor(() => expect(fx.urls).toHaveLength(1)));
    await vi.waitFor(() => expect(h.repos.fx.latest('EUR', 1, h.clock.todayLondon())).not.toBeNull());
  });

  it('never auto-resumes an execution of a soft-deleted definition, nor re-registers its one-shot job (plan decision 5)', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    const exec = h.repos.executions.get(id);
    if (exec === null) throw new Error('missing execution');
    h.repos.definitions.softDelete(exec.definitionId);
    const e = engine(h);
    await e.boot();
    expect(h.repos.executions.get(id)?.status).toBe('interrupted');
    expect(h.logs.some((l) => l.msg === 'boot: auto-resume execution' && l.fields.executionId === id)).toBe(
      false,
    );
    expect(e.scheduler.jobs().filter((j) => j.executionId === id)).toEqual([]);
  });

  it.each([
    ['scheduled', '0 5 * * 1'],
    ['manual-only', null],
  ] as const)(
    'a %s definition’s paused run gone stale while the app was down is superseded at boot, never resumed from its old snapshot and never replaced off the cron (ssr-11, ssr2-06)',
    async (_kind, scheduleCron) => {
      const h = createHarness({ ...fake, fixtureConcurrency: 1 });
      await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.limiterTimeout, 1)]);
      const def = twoPairs(h, { scheduleCron });
      const old = await h.runToCompletion(engine(h), def.id);
      expect(old.status).toBe('paused_error');
      h.clock.advance(160 * HOUR); // resume_after (T0 + 4000 s) long past; older than 0.9 × 168 h
      const e = engine(h);
      await e.boot();
      expect(h.logs.find((l) => l.msg === 'boot: one-shot jobs')?.fields).toEqual({
        oneShots: 0,
        superseded: 1,
      });
      expect(e.scheduler.jobs().filter((j) => j.kind === 'resume')).toEqual([]);
      expect(h.repos.executions.get(old.id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED });
      expect(executions(h, def.id)).toHaveLength(1); // the fresh run is the next firing's, or the operator's
      await e.scheduler.tick(def.id);
      expect(executions(h, def.id)).toHaveLength(scheduleCron === null ? 1 : 2);
    },
  );

  it('an interrupted run older than its discovery refresh allows is superseded at boot, not resumed (ssr2-09)', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    h.clock.advance(160 * HOUR);
    const requests = h.requests.length;
    await engine(h).boot();
    expect(h.repos.executions.get(id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED });
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume')?.fields).toMatchObject({
      resumed: 0,
      superseded: 1,
    });
    expect(h.requests.length).toBe(requests);
  });

  it('a stale paused run with no resume_after is superseded at boot even without a schedule, so it never blocks starts (ssr M3)', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const def = twoPairs(h); // no schedule
    const old = await h.runToCompletion(engine(h), def.id);
    expect(old).toMatchObject({ status: 'paused_error', resumeAfter: null });
    h.clock.advance(160 * HOUR);
    await engine(h).boot();
    expect(h.repos.executions.get(old.id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED });
  });

  it('a one-shot job that fires for a run gone stale supersedes it and starts nothing (ssr2-06)', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: 0 }),
    );
    const def = twoPairs(h); // no schedule
    const first = engine(h);
    const old = await h.runToCompletion(first, def.id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 1000,
    });
    h.clearHooks();
    await first.shutdown();
    expect(old).toMatchObject({ status: 'paused_budget', resumeAfter: '2026-11-01T00:00:00.000Z' });
    // why: boot a minute before the window reopens, so the job is registered (resume_after still ahead) and fires on
    // 1 November, 423 h after the run started: older than 0.9 × 168 h
    const eve = asIsoDateTime('2026-10-31T23:59:00.000Z');
    h.clock.set(eve);
    vi.setSystemTime(new Date(eve));
    const e = engine(h);
    await e.boot();
    expect(e.scheduler.jobs().filter((j) => j.kind === 'resume')).toEqual([
      expect.objectContaining({ executionId: old.id, nextRun: '2026-11-01T00:00:00.000Z' }),
    ]);
    h.clock.set(asIsoDateTime('2026-11-01T00:00:00.000Z'));
    // why: boot found no FX rate a day fresh, so the refresh runs a minute after it; it is answered, never the network
    stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.waitFor(() =>
      expect(h.repos.executions.get(old.id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED }),
    );
    expect(executions(h, def.id)).toHaveLength(1);
  });

  it('records skipped_missed once, in local time, when the last scheduled firing was missed (spec §8.2)', async () => {
    const h = createHarness(fake);
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' }); // created Wednesday 14 Oct
    h.clock.set(asIsoDateTime('2026-10-20T09:00:00.000Z')); // Tuesday: Monday 05:00 BST passed with the app down
    await engine(h).boot();
    const missed = executions(h, def.id).filter((x) => x.status === 'skipped_missed');
    expect(missed).toHaveLength(1);
    expect(kinds(h)).toEqual(['skipped_missed']);
    expect(h.notifications[0]?.body).toContain(
      'The run scheduled for Mon, 19 Oct 2026, 05:00 (Europe/London) did not happen',
    );
    await engine(h).boot();
    expect(executions(h, def.id).filter((x) => x.status === 'skipped_missed')).toHaveLength(1);
  });

  it('does not call a firing missed when no configured provider can run the definition: the tick ran and refused (ssr-005)', async () => {
    const h = createHarness(fake);
    // why: the one named provider is not configured here, so every tick is refused 'disabled' and writes no execution
    const def = h.createDefinition({
      scheduleCron: '0 5 * * 1',
      providers: {
        discovery: ['travelpayouts'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168 },
      },
    });
    h.clock.set(asIsoDateTime('2026-10-20T09:00:00.000Z'));
    await engine(h).boot();
    expect(executions(h, def.id).filter((x) => x.status === 'skipped_missed')).toHaveLength(0);
    expect(h.notifications.some((n) => n.body.includes('because the app was not running'))).toBe(false);
  });

  it('does not record skipped_missed for a firing before the schedule took effect (ssr2-11)', async () => {
    const h = createHarness(fake);
    const def = h.createDefinition(); // created Wednesday 14 Oct, no schedule
    h.clock.set(asIsoDateTime('2026-10-20T08:00:00.000Z')); // Tuesday: Monday 05:00 BST has passed
    h.repos.definitions.update(def.id, { scheduleCron: '0 5 * * 1' });
    h.clock.set(asIsoDateTime('2026-10-20T09:00:00.000Z'));
    await engine(h).boot();
    expect(executions(h, def.id)).toHaveLength(0);
    expect(kinds(h)).toEqual([]);
  });

  it('does not record skipped_missed when the firing found an execution active (the tick ran and was blocked, ssr-16)', async () => {
    const h = createHarness(fake);
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const first = engine(h);
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await first.shutdown(); // the execution stays interrupted (active) across Monday's firing
    h.clock.set(asIsoDateTime('2026-10-20T09:00:00.000Z'));
    await engine(h, { ...h.options }).boot();
    expect(executions(h, def.id).filter((x) => x.status === 'skipped_missed')).toHaveLength(0);
  });
});

describe('shutdown and status', () => {
  it('shutdown stops the scheduler, interrupts in-flight cells, and leaves auto_resume_count alone', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold, times: 1 }]);
    const e = engine(h);
    await e.boot();
    e.scheduler.register(h.createDefinition({ scheduleCron: '0 5 * * 1' }));
    const r = await e.start(twoPairs(h).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    expect(e.status().running).toEqual([r.executionId]);
    await e.shutdown();
    expect(e.scheduler.jobs()).toEqual([]);
    expect(h.repos.executions.get(r.executionId)).toMatchObject({
      status: 'interrupted',
      autoResumeCount: 0,
    });
    const all = h.outcomes(r.executionId);
    expect(all).toHaveLength(56);
    expect(all.every((o) => o.status === 'not_run')).toBe(true);
  });

  it('status reports the next run, the last execution, and degraded when a run is stuck', async () => {
    const h = createHarness(fake);
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const e = engine(h);
    await e.boot();
    expect(e.status()).toEqual({
      running: [],
      degraded: false,
      nextRun: '2026-10-19T04:00:00.000Z',
      lastExecutionAt: null,
    });
    const r = await e.start(twoPairs(h).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    h.clock.advance((h.config.stuckAfterHours + 1) * HOUR);
    expect(e.status()).toMatchObject({ degraded: true, lastExecutionAt: T0 });
  });

  it('wires estimate (worst case, blocked filled), estimateRemaining, budgetFit and coverageCheck', async () => {
    const h = createHarness(fake);
    const e = engine(h);
    const def = twoPairs(h, { scheduleCron: '0 5 * * 1' });
    expect(e.estimate(def, h.clock.todayLondon()).cells).toBe(56); // 2 pairs × 14 days × 2 nights
    const {
      id: _id,
      confirmedCostPence: _c,
      confirmedCalls: _cc,
      createdAt: _a,
      updatedAt: _u,
      deletedAt: _d,
      ...unsaved
    } = def;
    expect(e.estimate(unsaved, h.clock.todayLondon()).totalPlanCalls).toBe(4); // POST /api/definitions/estimate: an unsaved DefinitionInput
    expect(e.budgetFit(def).runsPerMonth).toBe(52 / 12);
    const one = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-11-03'),
      returnDate: asIsoDate('2026-11-10'),
    };
    // why: a preview needs a verification provider, as verifyCell does (re-review N4)
    const verifying = twoPairs(h, { name: 'verifying', providers: withVerification() });
    expect(e.childCapPreview(verifying.id, one)).toEqual({ ok: true, maxCalls: 6, headroomCalls: 1000 }); // decision 45
    expect(
      (
        await e.coverageCheck({
          origins: [LHR],
          destinations: [JFK],
          window: def.window,
          minNights: 7,
          maxNights: 8,
        })
      ).calls,
    ).toBe(0);
    const done = await h.runToCompletion(e, def.id);
    const remaining = e.estimateRemaining(done.id);
    expect(remaining.perProvider).toHaveLength(1);
    expect(remaining.perProvider.every((p) => p.planCalls === 0)).toBe(true);
    // why: ruling 9 — right after a run the save-time estimate still plans every tile (no reuse assumed)
    expect(e.estimate(def, h.clock.todayLondon()).totalPlanCalls).toBe(4);
    const capped = twoPairs(h, {
      budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    const blocked = e.estimate(capped, h.clock.todayLondon());
    expect(blocked.perProvider.map((p) => [p.blocked, p.planCalls])).toEqual([['execution-calls', 4]]);
    // cost-r1-014: the totals shown are what would run, here nothing
    expect(blocked).toMatchObject({
      totalCalls: 0,
      totalPlanCalls: 0,
      totalCostMicroGbp: 0,
      totalCostPence: 0,
    });
  });
});
