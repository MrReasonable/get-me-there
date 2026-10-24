// A paused catch-up's automatic resumes through their real call sites (spec §8.2 rev 36, decision 79; WP16a review
// S1, T1, T5, T12): the boot's auto-resume of an interrupted catch-up and the resume_after one-shot job both hand a
// firing since the pause to the catch-up rule first, through the engine itself, never by calling the rule directly.
// A throw in that check is logged and the resume goes ahead; once the engine is closing nothing more is read or
// started. Fake timers drive croner and the engine reads the faked system time. The worked example only.
import { asIsoDateTime, type Execution, type SearchDefinition } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import { createEngine } from '../../src/index.js';
import { createOrchestrator } from '../../src/orchestrator.js';
import { autoResume, autoResumeYields } from '../../src/scheduler/catchUp.js';
import { SUPERSEDED_BY_FIRING } from '../../src/scheduler/catchUpStart.js';
import { buildSnapshot } from '../../src/snapshot.js';
import { frankfurterBody, stubFrankfurter } from '../support/fx.js';
import { createHarness, type Harness } from '../support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  vi.useRealTimers();
});

const at = asIsoDateTime;
const RELATIVE = { kind: 'relative', startOffsetDays: 7, lengthDays: 14 } as const;
/** Twice a day, so a catch-up paused after the morning firing is still fresh at the evening one (F2, 18:00). */
const CRON = '0 6,18 * * *';
const F1 = at('2027-03-01T06:00:00.000Z');
const F2 = at('2027-03-01T18:00:00.000Z');
const rows = (h: Harness, def: SearchDefinition) =>
  h.repos.executions
    .listForDefinition(def.id, { limit: 100, includeChildren: false })
    .map((e) => [e.status === 'cancelled' ? e.errorText : e.status, e.scheduledFor, e.isCatchUp]);

/** A fake-timer harness, a definition on CRON, and a catch-up for F1 that stopped running at 08:00. */
function world(status: 'interrupted' | 'paused_error', resumeAfter: string | null) {
  const h = createHarness({ fakeTimers: true, systemClock: true, now: at('2027-03-01T00:00:00.000Z') });
  const def = h.createDefinition({ scheduleCron: CRON, window: RELATIVE });
  vi.setSystemTime(new Date('2027-03-01T08:00:00.000Z'));
  const ctx = buildContext(h.deps, h.options);
  const built = buildSnapshot(ctx, def, 'schedule');
  const row = h.repos.executions.createForFiring({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot: built.snapshot,
    estimate: null,
    trigger: 'schedule',
    status: 'running',
    scheduledFor: F1,
    isCatchUp: true,
  });
  if (row === null) throw new Error('no catch-up');
  // why: a catch-up as its start leaves it, every cell seeded (a row with none is cancelled by any resume)
  h.repos.cells.seed(row.id, built.cells, built.snapshot.providers.discovery);
  h.repos.executions.setStatus(row.id, status, {
    ...(resumeAfter === null ? {} : { resumeAfter: at(resumeAfter) }),
  });
  // why: the daily FX job may fire on waking; it is answered here, never the network
  stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
  h.repos.fx.upsert([
    { date: h.clock.todayLondon(), currency: 'EUR', rateNano: 1_150_000_000, source: 'test' },
    { date: h.clock.todayLondon(), currency: 'USD', rateNano: 1_270_000_000, source: 'test' },
  ]);
  return { h, def, catchUp: row };
}

describe('the boot’s auto-resume of an interrupted catch-up (T1)', () => {
  it('woken past F2’s grace: the catch-up is superseded by F2’s own catch-up and never resumed', {
    timeout: 30_000,
  }, async () => {
    const { h, def, catchUp } = world('interrupted', null);
    vi.setSystemTime(new Date('2027-03-01T18:30:00.000Z'));
    const engine = h.track(createEngine(h.deps, h.options));
    await engine.boot();
    expect(rows(h, def)).toEqual([
      ['running', F2, true],
      [SUPERSEDED_BY_FIRING, F1, true],
    ]);
    expect(h.logs.filter((l) => l.msg === 'boot: auto-resume execution')).toEqual([]);
    expect(
      h.logs.find(
        (l) => l.msg === 'catch-up: a later firing decided first' && l.bindings.executionId === catchUp.id,
      )?.fields,
    ).toEqual({ firing: F2, resumes: false });
  });

  it('with no firing since it stopped, the boot resumes it as before', { timeout: 30_000 }, async () => {
    const { h, def, catchUp } = world('interrupted', null);
    vi.setSystemTime(new Date('2027-03-01T09:00:00.000Z'));
    const engine = h.track(createEngine(h.deps, h.options));
    await engine.boot();
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: catchUp.id,
      result: 'resumed',
    });
    expect(rows(h, def)).toEqual([['running', F1, true]]);
  });
});

/**
 * Fires the fake timers one at a time until the one-shot resume job has run (it no longer lists at 17:59:10), so the
 * one-shot acts before the definition's tick and the minute job, whose timers come later.
 */
async function untilResumeJobFired(engine: {
  scheduler: { jobs(): Array<{ kind: string; nextRun: string | null }> };
}) {
  const pending = () =>
    engine.scheduler.jobs().some((j) => j.kind === 'resume' && j.nextRun === '2027-03-01T17:59:10.000Z');
  for (let i = 0; i < 20 && pending(); i++) await vi.advanceTimersToNextTimerAsync();
  // why: the yield awaits its catch-up's start; let it settle before the assertions
  await vi.advanceTimersByTimeAsync(0);
}

describe('the resume_after one-shot of a paused catch-up (T1)', () => {
  it('firing after F2’s grace (first of the jobs on waking): it yields, and F2’s catch-up supersedes it', {
    timeout: 30_000,
  }, async () => {
    const { h, def, catchUp } = world('paused_error', '2027-03-01T17:59:10.000Z');
    vi.setSystemTime(new Date('2027-03-01T17:59:00.000Z'));
    const engine = h.track(createEngine(h.deps, h.options));
    await engine.boot();
    expect(engine.scheduler.jobs().filter((j) => j.kind === 'resume')).toHaveLength(1);
    vi.setSystemTime(new Date('2027-03-01T18:30:00.000Z')); // asleep across F2; the one-shot's timer is due first
    await untilResumeJobFired(engine);
    expect(h.logs.filter((l) => l.msg === 'one-shot resume')).toEqual([]);
    expect(
      h.logs.find(
        (l) => l.msg === 'catch-up: a later firing decided first' && l.bindings.executionId === catchUp.id,
      )?.fields,
    ).toEqual({ firing: F2, resumes: false });
    expect(rows(h, def)).toEqual([
      ['running', F2, true],
      [SUPERSEDED_BY_FIRING, F1, true],
    ]);
  });

  it('firing inside F2’s grace: it re-registers itself just past the grace instead of resuming', {
    timeout: 30_000,
  }, async () => {
    const { h, catchUp } = world('paused_error', '2027-03-01T17:59:10.000Z');
    vi.setSystemTime(new Date('2027-03-01T17:59:00.000Z'));
    const engine = h.track(createEngine(h.deps, h.options));
    await engine.boot();
    vi.setSystemTime(new Date('2027-03-01T18:00:30.000Z'));
    await untilResumeJobFired(engine);
    expect(engine.scheduler.jobs().filter((j) => j.kind === 'resume')).toEqual([
      expect.objectContaining({ executionId: catchUp.id, nextRun: '2027-03-01T18:02:01.000Z' }),
    ]);
    expect(h.repos.executions.get(catchUp.id)?.status).toBe('paused_error');
    expect(h.logs.filter((l) => l.msg === 'one-shot resume')).toEqual([]);
  });
});

describe('autoResume: isolated, and silent once the engine is closing (T5, T12)', () => {
  const paused = (h: Harness, id: string): Execution => {
    const e = h.repos.executions.get(id);
    if (e === null) throw new Error('no catch-up');
    return e;
  };

  it('a throw while deciding is logged with the run and the resume goes ahead as it would', {
    timeout: 30_000,
  }, async () => {
    const { h, catchUp } = world('paused_error', null);
    vi.setSystemTime(new Date('2027-03-01T18:30:00.000Z'));
    const ctx = buildContext(h.deps, h.options);
    const orch = h.track(createOrchestrator(ctx));
    vi.spyOn(ctx.repos.executions, 'coversFiring').mockImplementation(() => {
      throw new Error('a row that does not decode');
    });
    const resume = vi.spyOn(orch, 'resume');
    const r = await autoResume(ctx, orch, paused(h, catchUp.id));
    expect(r).toMatchObject({ ok: true, executionId: catchUp.id });
    expect(resume).toHaveBeenCalledWith(catchUp.id, { manual: false }); // an automatic resume, never a manual one
    expect(h.logs.find((l) => l.msg === 'catch-up: definition failed')?.fields).toMatchObject({
      err: expect.stringContaining('a row that does not decode'),
    });
    // a throw outside the firing's rule (the definition read itself) is caught by autoResume
    const w = world('paused_error', null);
    vi.setSystemTime(new Date('2027-03-01T18:30:00.000Z'));
    const ctx2 = buildContext(w.h.deps, w.h.options);
    const orch2 = w.h.track(createOrchestrator(ctx2));
    const again = paused(w.h, w.catchUp.id);
    vi.spyOn(ctx2.repos.definitions, 'get').mockImplementationOnce(() => {
      throw new Error('the definition read failed');
    });
    expect(await autoResume(ctx2, orch2, again)).toMatchObject({ ok: true, executionId: w.catchUp.id });
    expect(w.h.logs.find((l) => l.msg === 'catch-up: resume check failed; resuming')).toMatchObject({
      bindings: expect.objectContaining({ executionId: w.catchUp.id }),
      fields: { err: expect.stringContaining('the definition read failed') },
    });
  });

  it('once the engine is closing it reads and starts nothing, and after the decision’s await it reads nothing more', {
    timeout: 30_000,
  }, async () => {
    const { h, catchUp } = world('paused_error', null);
    vi.setSystemTime(new Date('2027-03-01T18:30:00.000Z'));
    const ctx = buildContext(h.deps, h.options);
    const orch = h.track(createOrchestrator(ctx));
    ctx.lifecycle.closing = true;
    const get = vi.spyOn(ctx.repos.definitions, 'get');
    expect(await autoResume(ctx, orch, paused(h, catchUp.id))).toBeNull();
    expect(get).not.toHaveBeenCalled();
    ctx.lifecycle.closing = false;
    // the decision's catch-up returns after the engine handed the database back: no read of the run follows
    const start = vi.spyOn(orch, 'start').mockImplementation(async () => {
      ctx.lifecycle.closing = true;
      ctx.lifecycle.closed = true;
      return { ok: false, code: 'shutting-down', message: 'closing', details: {} };
    });
    const read = vi.spyOn(ctx.repos.executions, 'get');
    expect(await autoResume(ctx, orch, paused(h, catchUp.id))).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1); // the test's own read above, none after the await
    // the decision itself answers that it yielded: the catch-up is not read, so it is not resumed
    ctx.lifecycle.closing = false;
    ctx.lifecycle.closed = false;
    expect(await autoResumeYields(ctx, orch, paused(h, catchUp.id))).toBe('yielded');
  });
});
