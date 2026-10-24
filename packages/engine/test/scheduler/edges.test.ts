// The scheduler modules at the edges the final mutation run found unpinned (WP16a review R39): the window anchor, the
// start side of the catch-up, the browser gate's own refusals, notice and logs, and the tick's guards, blocked record,
// resume arguments and log lines. Fixed clocks and literal UTC instants; the worked example only.
import {
  AbortedError,
  asIsoDateTime,
  type ExecutionStatus,
  ProviderError,
  type SearchDefinition,
} from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import { createOrchestrator } from '../../src/orchestrator.js';
import { laneFor, newRun } from '../../src/run.js';
import { windowAnchor } from '../../src/scheduler/browserWindow.js';
import { findMissedFiring } from '../../src/scheduler/catchUp.js';
import {
  plannedSnapshot,
  SUPERSEDED_BY_FIRING,
  seedCatchUpBrowser,
} from '../../src/scheduler/catchUpStart.js';
import { buildSnapshot } from '../../src/snapshot.js';
import {
  BROWSER_WINDOW_NOTICE,
  browserLeftAtResume,
  browserLeftFor,
  browserWindowNotice,
  mayLoadPage,
  pageGate,
} from '../../src/stages/browserGate.js';
import {
  engineWith,
  outcomes,
  stubCamoufox,
  stubSearchApiVerification,
  stubTravelpayouts,
} from '../support/camoufox.js';
import { createHarness, type Harness, HOUR } from '../support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});

const at = asIsoDateTime;
const RELATIVE = { kind: 'relative', startOffsetDays: 7, lengthDays: 4 } as const;

describe('windowAnchor: the later of the firing and the start', () => {
  const s = at('2027-03-01T06:01:00.000Z');
  it('a later firing anchors; an earlier one, or none, leaves the start', () => {
    expect(windowAnchor(at('2027-03-01T06:02:00.000Z'), s)).toBe('2027-03-01T06:02:00.000Z');
    expect(windowAnchor(at('2027-03-01T06:00:00.000Z'), s)).toBe(s);
    expect(windowAnchor(null, s)).toBe(s);
    expect(windowAnchor(s, s)).toBe(s);
  });
});

/** An engine over camoufox and Travelpayouts with a daily schedule created at the start of 2027-03-01. */
function world() {
  const camoufox = stubCamoufox({ cells: 4 });
  const e = engineWith([camoufox, stubTravelpayouts({ cells: 4 })], {
    scheduleCron: '0 6 * * *',
    window: RELATIVE,
    createdAt: at('2027-03-01T00:00:00.000Z'),
  });
  return { e, camoufox };
}

describe('the start side of the catch-up (catchUpStart.ts)', () => {
  it('SUPERSEDED_BY_FIRING is the words the operator reads on the replaced row', () => {
    expect(SUPERSEDED_BY_FIRING).toBe('superseded: a later scheduled firing replaced this catch-up');
  });

  it('a catch-up plans without its browser provider; any other start plans its snapshot as it is', () => {
    const { e } = world();
    const snapshot = buildSnapshot(e.ctx, e.definition, 'schedule').snapshot;
    expect(snapshot.providers.discovery).toEqual(['camoufox', 'travelpayouts']);
    expect(plannedSnapshot(snapshot, true).providers.discovery).toEqual(['travelpayouts']);
    expect(plannedSnapshot(snapshot, false)).toBe(snapshot);
  });

  it('seedCatchUpBrowser leaves every cell it could not reuse catch-up-no-browser, with or without a discovery capability', async () => {
    const upstream = new ProviderError({
      kind: 'upstream',
      retryable: true,
      providerId: 'camoufox',
      message: 'x',
    });
    const e = engineWith(
      [stubCamoufox({ cells: 4, failCalls: 4, error: upstream }), stubTravelpayouts({ cells: 4 })],
      {
        scheduleCron: '0 6 * * *',
        window: RELATIVE,
        createdAt: at('2027-03-01T00:00:00.000Z'),
      },
    );
    const run = await e.runToEnd();
    for (const o of outcomes(e, run.id, 'camoufox'))
      e.ctx.repos.cells.setOutcome(run.id, o, 'discovery', 'camoufox', {
        status: 'not_run',
        reason: null,
        skipDetail: null,
      });
    const scope = {
      executionId: run.id,
      definitionId: run.definitionId,
      snapshot: run.snapshot,
      manual: false,
    };
    seedCatchUpBrowser({ ...e.ctx, providers: new Map() }, scope, 'camoufox');
    expect(outcomes(e, run.id, 'camoufox').map((o) => [o.status, o.reason, o.skipDetail])).toEqual(
      Array(4).fill(['skipped', 'scheduled_only', 'catch-up-no-browser']),
    );
  });

  it('a superseded catch-up loses its one-shot job, and the log names what replaced it', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    h.clock.set(at('2027-03-01T00:00:00.000Z'));
    const def = h.createDefinition({ scheduleCron: '0 6 * * *', window: RELATIVE });
    h.clock.set(at('2027-03-01T08:00:00.000Z'));
    const ctx = buildContext(h.deps, h.options);
    const e = h.repos.executions.createForFiring({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: buildSnapshot(ctx, def, 'schedule').snapshot,
      estimate: null,
      trigger: 'schedule',
      status: 'running',
      scheduledFor: at('2027-03-01T06:00:00.000Z'),
      isCatchUp: true,
    });
    if (e === null) throw new Error('not written');
    h.repos.executions.setStatus(e.id, 'paused_budget', { resumeAfter: at('2027-03-09T00:00:00.000Z') });
    const cancelResume = vi.spyOn(ctx.hooks, 'cancelResume');
    const orch = createOrchestrator(ctx);
    h.clock.set(at('2027-03-02T06:00:00.000Z'));
    await orch.tick(def.id);
    expect(cancelResume).toHaveBeenCalledWith(e.id);
    const line = h.logs.find((l) => l.msg === 'execution: superseded a paused catch-up');
    const fresh = h.repos.executions.listForDefinition(def.id, { limit: 5, includeChildren: false })[0];
    expect(line?.fields).toEqual({
      executionId: e.id,
      definitionId: def.id,
      by: fresh?.id,
      scheduledFor: '2027-03-02T06:00:00.000Z',
    });
    if (fresh !== undefined) await h.waitForSettled(fresh.id);
  });
});

describe('the cabin filter covers verification too (R11)', () => {
  it('a business definition whose only providers sell economy, discovery and verification alike, has no runnable provider: none', () => {
    const e = engineWith([stubTravelpayouts({ cells: 4 }), stubSearchApiVerification()], {
      scheduleCron: '0 6 * * *',
      window: RELATIVE,
      createdAt: at('2027-03-01T00:00:00.000Z'),
      verification: ['searchapi'],
      env: { SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' },
    });
    const def = e.ctx.repos.definitions.update(e.definition.id, { cabin: 'business' });
    if (def === null) throw new Error('no definition');
    expect(findMissedFiring(e.ctx, def, at('2027-03-01T08:00:00.000Z'))).toEqual({ kind: 'none' });
    expect(findMissedFiring(e.ctx, { ...def, cabin: 'economy' }, at('2027-03-01T08:00:00.000Z'))).toEqual({
      kind: 'catch-up',
      firing: '2027-03-01T06:00:00.000Z',
    });
  });
});

describe('the browser gate’s own refusals, notice and logs', () => {
  it('the notice words: who fetches the cells as the definition reads now, and the others carry on only when one still searches in this run (S6, S7)', async () => {
    expect(BROWSER_WINDOW_NOTICE).toBe('browser pages left: this run is past its browser window');
    const { e } = world();
    const exec = await e.runToEnd();
    const run = () => newRun(e.ctx, exec, { manual: false, fresh: false, blocked: new Set() });
    const notice = (r: ReturnType<typeof run>) => browserWindowNotice(e.ctx, r).detail;
    expect(notice(run())).toBe(
      'browser pages left: this run is past its browser window. Its remaining browser cells are left for the next scheduled run; the other providers carry on.',
    );
    // Travelpayouts' lane stopped (or its line blocked, or the provider disabled): nothing else searches
    const stopped = run();
    laneFor(stopped, 'discovery', 'travelpayouts').intake.abort();
    const blocked = newRun(e.ctx, exec, {
      manual: false,
      fresh: false,
      blocked: new Set(['discovery:travelpayouts']),
    });
    const disabled = run();
    disabled.disabled.add('travelpayouts');
    const healthy = run();
    laneFor(healthy, 'discovery', 'travelpayouts'); // a lane already taking cells still searches
    expect(notice(healthy)).toContain('; the other providers carry on.');
    const capped = run();
    laneFor(capped, 'discovery', 'travelpayouts').budgetOut = true;
    const cabin = run();
    const business = { ...cabin, snapshot: { ...cabin.snapshot, cabin: 'business' as const } };
    for (const r of [stopped, blocked, disabled, capped, business])
      expect(notice(r)).toBe(
        'browser pages left: this run is past its browser window. Its remaining browser cells are left for the next scheduled run; the run stops its browser part with no other discovery provider left to run.',
      );
    e.ctx.repos.definitions.update(e.definition.id, { enabled: false });
    expect(notice(run())).toContain('are left for your next run of this search;');
    e.ctx.repos.definitions.update(e.definition.id, {
      enabled: true,
      providers: { ...e.definition.providers, discovery: ['travelpayouts'] },
    });
    expect(notice(run())).toContain('are not fetched: this search no longer uses the browser provider;');
    expect(notice({ ...run(), definitionId: 'no-such-definition' })).toContain(
      'are not fetched: this search no longer uses the browser provider;',
    );
  });

  it('browserLeftFor (S6): the next scheduled run only when scheduled, enabled and its scheduled runs use the browser provider', () => {
    const { e } = world();
    const def = e.definition;
    expect(browserLeftFor(e.ctx, def)).toBe('next-scheduled-run');
    expect(browserLeftFor(e.ctx, { ...def, scheduleCron: null })).toBe('next-run');
    expect(browserLeftFor(e.ctx, { ...def, enabled: false })).toBe('next-run');
    expect(
      browserLeftFor(e.ctx, { ...def, providers: { ...def.providers, discovery: ['travelpayouts'] } }),
    ).toBe('no-longer-used');
    // a browser provider left out of scheduled runs (excluded on its plan) is fetched only by a run started by hand
    const unscheduled = {
      ...e.ctx,
      limitsOf: (id: Parameters<typeof e.ctx.limitsOf>[0]) => ({
        ...e.ctx.limitsOf(id),
        excludedFromSchedule: id === 'camoufox',
      }),
    };
    expect(browserLeftFor(unscheduled, def)).toBe('next-run');
  });

  it('a lane already stopped refuses the next browser tile and the next page, and stops taking tiles', async () => {
    const { e } = world();
    const exec = await e.runToEnd();
    const run = newRun(e.ctx, exec, { manual: false, fresh: false, blocked: new Set() });
    const lane = laneFor(run, 'discovery', 'camoufox');
    lane.windowOut = 'outside-browser-window';
    expect(mayLoadPage(e.ctx, run, 'camoufox', lane)).toBe(false);
    expect(() => pageGate(e.ctx, run, 'camoufox', lane)()).toThrow(AbortedError);
  });

  it('a catch-up’s refusal stops the lane taking tiles and logs how many cells it left', async () => {
    const { e } = world();
    const exec = await e.runToEnd();
    const run = newRun(
      e.ctx,
      { ...exec, isCatchUp: true },
      { manual: false, fresh: false, blocked: new Set() },
    );
    const lane = laneFor(run, 'discovery', 'camoufox');
    expect(mayLoadPage(e.ctx, run, 'camoufox', lane)).toBe(false);
    expect(lane.intakeSignal.aborted).toBe(true);
    expect(
      e.logs
        .filter((l) => l.msg === 'catch-up: browser cells left unloaded')
        .map((l) => [l.level, l.bindings.providerId, l.fields]),
    ).toEqual([['warn', 'camoufox', { left: 0 }]]);
  });

  it('a page whose run row cannot be read fails closed: left, a notice, logged with its end, and abandoned', async () => {
    const { e } = world();
    const exec = await e.runToEnd();
    const run = newRun(
      e.ctx,
      { ...exec, id: 'no-such-execution' },
      { manual: false, fresh: true, blocked: new Set() },
    );
    const lane = laneFor(run, 'discovery', 'camoufox');
    expect(() => pageGate(e.ctx, run, 'camoufox', lane)()).toThrow(AbortedError);
    expect(lane.windowOut).toBe('outside-browser-window');
    expect(run.notices.map((n) => n.kind)).toEqual(['browser_window']);
    expect(
      e.logs
        .filter((l) => l.msg === 'browser window passed; pages left for the next scheduled run')
        .map((l) => [l.bindings.providerId, l.fields]),
    ).toEqual([['camoufox', { windowEnd: null, left: 0 }]]);
  });

  it('a resume inside the window leaves no browser provider', async () => {
    const { e } = world();
    e.clock.set(at('2027-03-01T05:00:00.000Z'));
    const exec = await e.runToEnd();
    expect(browserLeftAtResume(e.ctx, exec)).toEqual({ providers: [], detail: 'outside-browser-window' });
  });
});

describe('the tick’s guards, blocked record, resume arguments and log lines', () => {
  /** An hourly definition, created at T0 (09:00 UTC, a firing). */
  function hourly(h: Harness, patch: Partial<SearchDefinition> = {}) {
    const def = h.createDefinition({ scheduleCron: '0 * * * *', window: RELATIVE });
    return { ...def, ...patch };
  }
  /** A parent run of `def` left in `status`, with `resumeAfter`, as an earlier pass would have left it. */
  function leftIn(h: Harness, def: SearchDefinition, status: ExecutionStatus, resumeAfter: string | null) {
    const ctx = buildContext(h.deps, h.options);
    const e = h.repos.executions.create({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: buildSnapshot(ctx, def, 'manual').snapshot,
      estimate: null,
      trigger: 'manual',
      status: 'running',
    });
    h.repos.executions.setStatus(e.id, status, {
      resumeAfter: resumeAfter === null ? null : at(resumeAfter),
    });
    return e;
  }

  it.each([
    ['disabled', { enabled: false }],
    ['deleted', { deletedAt: at('2026-10-14T08:00:00.000Z') }],
    ['unscheduled', { scheduleCron: null }],
  ] as const)(
    'a %s definition: no start, no catch-up, no log line, and its blocked entry cleared',
    async (_label, patch) => {
      const h = createHarness();
      const def = hourly(h);
      const o = h.orch();
      leftIn(h, def, 'paused_error', null);
      await o.tick(def.id); // blocked by the paused run
      expect(o.blockedSince()).toBe(h.clock.now());
      h.repos.definitions.update(
        def.id,
        'enabled' in patch ? { enabled: false } : 'scheduleCron' in patch ? { scheduleCron: null } : {},
      );
      if ('deletedAt' in patch) h.repos.definitions.softDelete(def.id);
      h.logs.length = 0;
      await o.tick(def.id);
      expect(o.blockedSince()).toBeNull();
      expect(h.logs.filter((l) => l.msg?.startsWith('tick:'))).toEqual([]);
    },
  );

  it('every tick line carries the definition; a punctual start logs its firing, result and run', async () => {
    const h = createHarness();
    const def = hourly(h);
    await h.orch().tick(def.id);
    const [run] = h.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false });
    const line = h.logs.find((l) => l.msg === 'tick: start');
    expect([line?.bindings.definitionId, line?.fields]).toEqual([
      def.id,
      { firing: '2026-10-14T09:00:00.000Z', result: 'started', executionId: run?.id },
    ]);
    if (run !== undefined) await h.waitForSettled(run.id);
  });

  it('a punctual tick resumes with the live-tick firing; a late one without it, and both log the attempt', async () => {
    const h = createHarness();
    const def = hourly(h);
    const paused = leftIn(h, def, 'paused_error', '2026-10-14T08:30:00.000Z');
    const o = h.orch();
    const resume = vi
      .spyOn(o, 'resume')
      .mockResolvedValue({ ok: false, code: 'cap', message: 'cap', details: null });
    await o.tick(def.id);
    h.clock.advance(HOUR / 2); // 09:30: half an hour past the 09:00 firing, so late
    await o.tick(def.id);
    expect(resume.mock.calls).toEqual([
      [paused.id, { manual: false, liveTickFiring: '2026-10-14T09:00:00.000Z' }],
      [paused.id, { manual: false }],
    ]);
    expect(h.logs.filter((l) => l.msg === 'tick: resume attempted').map((l) => l.fields)).toEqual([
      { executionId: paused.id, status: 'paused_error', late: false, result: 'cap' },
      { executionId: paused.id, status: 'paused_error', late: true, result: 'cap' },
    ]);
    // a refused resume blocks the schedule; a resume that goes ahead clears it
    expect(o.blockedSince()).toBe('2026-10-14T09:00:00.000Z');
    resume.mockResolvedValue({ ok: true, executionId: paused.id });
    await o.tick(def.id);
    expect(o.blockedSince()).toBeNull();
    expect(h.logs.filter((l) => l.msg === 'tick: resume attempted').map((l) => l.fields.result)).toEqual([
      'cap',
      'cap',
      'resumed',
    ]);
  });

  it('an interrupted run is never resumed by the tick, even with a resume_after: it blocks the schedule', async () => {
    const h = createHarness();
    const def = hourly(h);
    const run = leftIn(h, def, 'interrupted', '2026-10-14T08:30:00.000Z');
    const o = h.orch();
    const resume = vi.spyOn(o, 'resume');
    await o.tick(def.id);
    expect(resume).not.toHaveBeenCalled();
    expect(o.blockedSince()).toBe(h.clock.now());
    expect(h.repos.executions.get(run.id)?.status).toBe('interrupted');
  });

  it('a late tick logs its firing and what it replaced, and clears the blocked entry before the catch-up', async () => {
    const h = createHarness();
    const def = hourly(h);
    const o = h.orch();
    const blocker = leftIn(h, def, 'paused_error', null);
    await o.tick(def.id);
    expect(o.blockedSince()).toBe(h.clock.now());
    h.repos.executions.setStatus(blocker.id, 'cancelled', { finishedAt: h.clock.now() });
    h.clock.advance(HOUR / 2);
    await o.tick(def.id);
    expect(o.blockedSince()).toBeNull();
    expect(h.logs.filter((l) => l.msg === 'tick: late, handed to the catch-up').map((l) => l.fields)).toEqual(
      [{ firing: '2026-10-14T09:00:00.000Z', replaced: null }],
    );
  });

  it('T11: a different run blocking later starts its own "blocked since", even when nobody read the first one', async () => {
    const h = createHarness();
    const def = hourly(h);
    const o = h.orch();
    const first = leftIn(h, def, 'paused_error', null);
    await o.tick(def.id); // blocked by the first run at 09:00
    h.repos.executions.setStatus(first.id, 'cancelled', { finishedAt: h.clock.now() });
    leftIn(h, def, 'interrupted', null);
    h.clock.advance(HOUR);
    await o.tick(def.id); // blocked by another run at 10:00, with no read of blockedSince in between
    expect(o.blockedSince()).toBe(h.clock.now());
    h.clock.advance(HOUR);
    await o.tick(def.id); // the same run again: its first date stands
    expect(o.blockedSince()).toBe(at('2026-10-14T10:00:00.000Z'));
  });

  it('a refused punctual start after the blocker ended leaves no blocked entry: the entry goes with the run that blocked', async () => {
    const h = createHarness();
    const def = hourly(h);
    const o = h.orch();
    const blocker = leftIn(h, def, 'paused_error', null);
    await o.tick(def.id);
    expect(o.blockedSince()).toBe(h.clock.now());
    h.repos.executions.setStatus(blocker.id, 'cancelled', { finishedAt: h.clock.now() });
    vi.spyOn(o, 'start').mockResolvedValue({ ok: false, code: 'cap', message: 'cap', details: null });
    h.clock.advance(HOUR);
    await o.tick(def.id);
    expect(o.blockedSince()).toBeNull();
    expect(h.logs.filter((l) => l.msg === 'tick: start').map((l) => l.fields)).toEqual([
      { firing: '2026-10-14T10:00:00.000Z', result: 'cap', executionId: null },
    ]);
  });
});
