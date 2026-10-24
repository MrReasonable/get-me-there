// The browser window through the engine (spec §8.2 rev 36; decision 83; WP16a Task 16a.2b): its end is stored at start
// and moved only by a live-tick resume; it is checked at a run's first browser page, at any resume, and before the next
// page after a detected suspension, never otherwise mid-run; outside it the browser provider's remaining cells are left
// for the next scheduled run (skipped:scheduled_only, outside-browser-window) while the other providers carry on.
// Stub providers through the real engine and budget guard; London Heathrow → New York JFK only.
import {
  asIsoDateTime,
  type Execution,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  ProviderError,
} from '@gmt/core';
import { camoufoxHttpLimits } from '@gmt/providers';
import { createLimiter } from '@gmt/providers/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import { createEngine } from '../../src/index.js';
import { createOrchestrator } from '../../src/orchestrator.js';
import { laneFor, newRun } from '../../src/run.js';
import { catchUpDefinition } from '../../src/scheduler/catchUp.js';
import { BROWSER_WINDOW_NOTICE, mayLoadPage } from '../../src/stages/browserGate.js';
import {
  type CamoufoxEngine,
  engineWith,
  outcomes,
  type Stub,
  stubCamoufox,
  stubTravelpayouts,
} from '../support/camoufox.js';
import { frankfurterBody, stubFrankfurter } from '../support/fx.js';

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  vi.useRealTimers();
});

const at = asIsoDateTime;
/** Four departure days a week ahead, 10 nights each: four cells, one browser page each. */
const WINDOW = { kind: 'relative', startOffsetDays: 7, lengthDays: 4 } as const;
const CREATED = at('2027-03-01T00:00:00.000Z');
const MANUAL_AT = at('2027-03-01T05:00:00.000Z');
const F1 = at('2027-03-01T06:00:00.000Z');
const F2 = at('2027-03-02T06:00:00.000Z');
const upstream = (providerId: 'camoufox' | 'travelpayouts') =>
  new ProviderError({ kind: 'upstream', retryable: true, providerId, message: 'the answer did not settle' });
const plus = (t: IsoDateTime, ms: number) => isoDateTimeOfEpochMs(Date.parse(t) + ms);

interface World {
  e: CamoufoxEngine;
  camoufox: Stub;
  travelpayouts: Stub;
}
function world(
  o: {
    camoufoxFails?: number;
    travelpayoutsFails?: number;
    env?: Record<string, string>;
    monthlyCap?: number;
    systemClock?: boolean;
    hold?: Promise<void>;
  } = {},
): World {
  const camoufox = stubCamoufox({
    cells: 4,
    ...(o.camoufoxFails === undefined ? {} : { failCalls: o.camoufoxFails, error: upstream('camoufox') }),
    ...(o.hold === undefined ? {} : { holdCall: { call: 1, until: o.hold } }),
  });
  const travelpayouts = stubTravelpayouts({
    cells: 4,
    ...(o.travelpayoutsFails === undefined
      ? {}
      : { failCalls: o.travelpayoutsFails, error: upstream('travelpayouts') }),
  });
  const e = engineWith([camoufox, travelpayouts], {
    scheduleCron: '0 6 * * *',
    window: WINDOW,
    createdAt: CREATED,
    ...(o.env === undefined ? {} : { env: o.env }),
    ...(o.monthlyCap === undefined ? {} : { monthlyCap: o.monthlyCap }),
    ...(o.systemClock === true ? { systemClock: true } : {}),
  });
  return { e, camoufox, travelpayouts };
}
/** A manual run at MANUAL_AT whose browser pages all failed (retryable), so a resume would fetch them again. */
async function failedRun(w: World): Promise<Execution> {
  w.e.clock.set(MANUAL_AT);
  const run = await w.e.runToEnd();
  expect(outcomes(w.e, run.id, 'camoufox').map((o) => o.status)).toEqual([
    'error',
    'error',
    'error',
    'error',
  ]);
  return run;
}
const endOf = (w: World, id: string): IsoDateTime => {
  const end = w.e.ctx.repos.executions.get(id)?.browserWindowEnd ?? null;
  if (end === null) throw new Error('no browser window end');
  return end;
};
const camoufoxCells = (w: World, id: string) =>
  outcomes(w.e, id, 'camoufox').map((o) => [o.status, o.reason, o.skipDetail]);
const LEFT = ['skipped', 'scheduled_only', 'outside-browser-window'];
/** An orchestrator on the same database under another CAMOUFOX_BROWSER_WINDOW: the setting is read live at each check. */
function under(w: World, mode: 'scheduled' | 'any') {
  const ctx = buildContext({ ...w.e.deps, config: { ...w.e.deps.config, camoufoxBrowserWindow: mode } });
  return { ctx, orch: createOrchestrator(ctx) };
}
const windowNotices = (w: World) => w.e.notifications.filter((n) => n.kind === 'browser_window');

/**
 * A one-shot resume_after job (due now) or a boot auto-resume of an interrupted run, through a full engine on fake
 * timers, whose clock is the faked system time so croner's due instant and the engine's agree.
 */
async function resumeThroughEngine(
  w: World,
  id: string,
  how: 'resume_after' | 'boot',
  resumeAfter: IsoDateTime,
): Promise<void> {
  w.e.ctx.repos.executions.setStatus(
    id,
    how === 'boot' ? 'interrupted' : 'paused_error',
    how === 'boot' ? {} : { resumeAfter },
  );
  stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
  const engine = createEngine(w.e.deps);
  await engine.boot(); // re-registers the one-shot job (due now) or auto-resumes the interrupted run
  await vi.advanceTimersByTimeAsync(1000);
  await w.e.settled(id);
  await engine.shutdown();
}
const FAKE_TIMERS = () =>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });

describe('the stored window (decision 83)', () => {
  it('the start writes browser_window_end = the anchor + 1.5 × the start estimate’s seconds: a manual run’s start; a scheduled run’s later of its firing and its start', async () => {
    const w = world();
    w.e.clock.set(MANUAL_AT);
    const manual = await w.e.runToEnd();
    expect(manual.estimate?.seconds).toBeGreaterThan(0);
    expect(Date.parse(endOf(w, manual.id)) - Date.parse(MANUAL_AT)).toBe(
      Math.ceil(1.5 * (manual.estimate?.seconds ?? 0) * 1000),
    );
    // why: R8 — croner fires a little after the firing, so the anchor is the start itself, never before it
    w.e.clock.set(plus(F1, 400));
    await w.e.tick();
    const scheduled = w.e.ctx.repos.executions
      .listForDefinition(w.e.definition.id, { limit: 10, includeChildren: false })
      .find((x) => x.scheduledFor === F1);
    if (scheduled === undefined) throw new Error('no scheduled run');
    expect(scheduled.startedAt).toBe(plus(F1, 400));
    expect(Date.parse(endOf(w, scheduled.id)) - Date.parse(F1)).toBe(
      400 + Math.ceil(1.5 * (scheduled.estimate?.seconds ?? 0) * 1000),
    );
  });

  it('the end is inclusive at a resume: a resume at the end instant loads pages, one a millisecond later loads none', async () => {
    const inside = world({ camoufoxFails: 4 });
    const a = await failedRun(inside);
    inside.e.clock.set(endOf(inside, a.id));
    await inside.e.resume(a.id, { manual: true });
    expect(inside.camoufox.calls).toHaveLength(8);
    expect(outcomes(inside.e, a.id, 'camoufox').every((o) => o.status === 'priced')).toBe(true);

    const outside = world({ camoufoxFails: 4 });
    const b = await failedRun(outside);
    outside.e.clock.set(plus(endOf(outside, b.id), 1));
    await outside.e.resume(b.id, { manual: true });
    expect(outside.camoufox.calls).toHaveLength(4);
    expect(camoufoxCells(outside, b.id)).toEqual(Array(4).fill(LEFT));
  });

  it('a resume pass that adds camoufox seconds to the stored estimate leaves browser_window_end unchanged, and past it loads no page', async () => {
    const w = world({ camoufoxFails: 4 });
    const run = await failedRun(w);
    const end = endOf(w, run.id);
    w.e.clock.set(plus(MANUAL_AT, 60_000)); // inside the window: the resume fetches again (and fails again: 8 calls)
    w.camoufox.calls.length = 0;
    const camoufoxBefore = run.estimate?.perProvider.find((p) => p.providerId === 'camoufox')?.seconds ?? 0;
    await w.e.resume(run.id, { manual: true });
    const after = w.e.ctx.repos.executions.get(run.id);
    expect(after?.estimate?.perProvider.find((p) => p.providerId === 'camoufox')?.seconds).toBeGreaterThan(
      camoufoxBefore,
    );
    expect(after?.browserWindowEnd).toBe(end);
    w.e.clock.set(plus(end, 1));
    const pages = w.camoufox.calls.length;
    await w.e.resume(run.id, { manual: true });
    expect(w.camoufox.calls).toHaveLength(pages);
  });

  it('a row with no stored end (before migration 0007, null scheduled_for) ends at started_at + STUCK_AFTER_HOURS', async () => {
    const w = world({ camoufoxFails: 4 });
    const run = await failedRun(w);
    w.e.ctx.repos.executions.patch(run.id, { browserWindowEnd: null });
    w.e.clock.set(plus(MANUAL_AT, 12 * 3_600_000 + 1)); // STUCK_AFTER_HOURS is 12 by default
    await w.e.resume(run.id, { manual: true });
    expect(w.camoufox.calls).toHaveLength(4);
    expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));

    const v = world({ camoufoxFails: 4 });
    const ok = await failedRun(v);
    v.e.ctx.repos.executions.patch(ok.id, { browserWindowEnd: null });
    v.e.clock.set(plus(MANUAL_AT, 12 * 3_600_000));
    await v.e.resume(ok.id, { manual: true });
    expect(v.camoufox.calls).toHaveLength(8);
  });

  it('past the window a resume leaves camoufox out before estimateRemainingFor: its monthly cap does not refuse a resume Travelpayouts can run, and the pass adds no camoufox line', async () => {
    const w = world({ camoufoxFails: 4, travelpayoutsFails: 4, monthlyCap: 4 });
    const run = await failedRun(w);
    const stored = run.estimate?.perProvider.find((p) => p.providerId === 'camoufox');
    w.e.clock.set(plus(endOf(w, run.id), 1));
    expect((await w.e.resumeResult(run.id, { manual: true })).ok).toBe(true);
    const done = await w.e.settled(run.id);
    expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));
    expect(outcomes(w.e, run.id, 'travelpayouts').every((o) => o.status === 'priced')).toBe(true);
    expect(done.estimate?.perProvider.find((p) => p.providerId === 'camoufox')).toEqual(stored);

    // positive control: inside the window the cap check sees camoufox and blocks it: no page, its cells keep their
    // errors for a later pass, never scheduled_only
    const v = world({ camoufoxFails: 4, travelpayoutsFails: 4, monthlyCap: 4 });
    const inside = await failedRun(v);
    v.e.clock.set(plus(MANUAL_AT, 60_000));
    await v.e.resume(inside.id, { manual: true });
    expect(v.camoufox.calls).toHaveLength(4);
    expect(outcomes(v.e, inside.id, 'camoufox').map((o) => [o.status, o.reason])).toEqual(
      Array(4).fill(['error', 'upstream']),
    );
  });
});

describe('a live-tick resume re-anchors the window (decision 83)', () => {
  async function pausedAtF1(w: World): Promise<Execution> {
    w.e.clock.set(F1);
    await w.e.tick();
    const run = w.e.ctx.repos.executions.listForDefinition(w.e.definition.id, {
      limit: 1,
      includeChildren: false,
    })[0];
    if (run === undefined) throw new Error('no run');
    await w.e.settled(run.id);
    // why: a pause whose window reopened (resume_after passed), as a provider-month cap leaves one
    w.e.ctx.repos.executions.setStatus(run.id, 'paused_budget', { resumeAfter: plus(F1, 3_600_000) });
    return run;
  }

  it('the next firing’s tick moves scheduled_for to it, rewrites the end from the cells still resumable, and loads the pages', async () => {
    const w = world({ camoufoxFails: 4 });
    const run = await pausedAtF1(w);
    expect(Date.parse(endOf(w, run.id))).toBeLessThan(Date.parse(F2));
    w.e.clock.set(F2);
    await w.e.tick();
    await w.e.settled(run.id);
    const after = w.e.ctx.repos.executions.get(run.id);
    expect(after?.scheduledFor).toBe(F2);
    expect(Date.parse(endOf(w, run.id))).toBeGreaterThan(Date.parse(F2));
    expect(w.camoufox.calls).toHaveLength(8);
    expect(outcomes(w.e, run.id, 'camoufox').every((o) => o.status === 'priced')).toBe(true);
  });

  it('with that firing already held by another row, the tick resumes under the old window: past it, the camoufox cells are left', async () => {
    const w = world({ camoufoxFails: 4 });
    const run = await pausedAtF1(w);
    const end = endOf(w, run.id);
    const held = w.e.ctx.repos.executions.createForFiring({
      definitionId: w.e.definition.id,
      isChild: false,
      cell: null,
      snapshot: run.snapshot,
      estimate: null,
      trigger: 'schedule',
      status: 'skipped_budget',
      scheduledFor: F2,
    });
    expect(held).not.toBeNull();
    w.e.clock.set(F2);
    await w.e.tick();
    await w.e.settled(run.id);
    expect(w.e.ctx.repos.executions.get(run.id)).toMatchObject({ scheduledFor: F1, browserWindowEnd: end });
    expect(w.camoufox.calls).toHaveLength(4);
    expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));
  });
});

describe('under scheduled, every resume past the window loads no page; the others carry on (decision 83)', () => {
  it('a manual /resume: cells left, Travelpayouts retried, one notice however often the check fails', async () => {
    const w = world({ camoufoxFails: 4, travelpayoutsFails: 8 });
    const run = await failedRun(w);
    w.e.clock.set(plus(endOf(w, run.id), 1));
    await w.e.resume(run.id, { manual: true });
    expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));
    expect(w.travelpayouts.calls).toHaveLength(8);
    await w.e.resume(run.id, { manual: true }); // the check fails again; Travelpayouts has a third try
    expect(w.travelpayouts.calls).toHaveLength(12);
    expect(w.camoufox.calls).toHaveLength(4);
    expect(windowNotices(w)).toHaveLength(1);
    expect(windowNotices(w)[0]?.body).toContain(BROWSER_WINDOW_NOTICE);
    // R12: a scheduled, enabled definition's cells are promised to its next scheduled run
    expect(windowNotices(w)[0]?.body).toContain(
      'remaining browser cells are left for the next scheduled run',
    );
  });

  it('an automatic resume (a resume_after job) and a boot auto-resume, at the end + 1 ms: no page, cells left, Travelpayouts runs', async () => {
    for (const how of ['resume_after', 'boot'] as const) {
      FAKE_TIMERS();
      const w = world({ camoufoxFails: 4, travelpayoutsFails: 4, systemClock: true });
      const run = await failedRun(w);
      const end = endOf(w, run.id);
      w.e.clock.set(plus(end, 1));
      await resumeThroughEngine(w, run.id, how, end);
      expect(w.travelpayouts.calls).toHaveLength(8);
      expect(w.camoufox.calls).toHaveLength(4);
      expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));
      vi.useRealTimers();
    }
  });

  it('no later resume runs a scheduled_only cell, even under any; the next scheduled run fetches them (positive control)', async () => {
    const w = world({ camoufoxFails: 4 });
    const run = await failedRun(w);
    w.e.clock.set(plus(endOf(w, run.id), 1));
    await w.e.resume(run.id, { manual: true });
    const { orch } = under(w, 'any');
    const again = await orch.resume(run.id, { manual: true });
    expect(again.ok).toBe(false);
    expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));
    w.e.clock.set(F1);
    await w.e.tick();
    const next = w.e.ctx.repos.executions
      .listForDefinition(w.e.definition.id, { limit: 10, includeChildren: false })
      .find((x) => x.scheduledFor === F1);
    if (next === undefined) throw new Error('no scheduled run');
    await w.e.settled(next.id);
    expect(w.camoufox.calls).toHaveLength(8);
    expect(outcomes(w.e, next.id, 'camoufox').every((o) => o.status === 'priced')).toBe(true);
  });
});

describe('under any (decision 83)', () => {
  it('a manual /resume, a resume_after job and a boot auto-resume well past the window load pages and leave nothing scheduled_only', async () => {
    for (const how of ['manual', 'resume_after', 'boot'] as const) {
      FAKE_TIMERS();
      const w = world({ camoufoxFails: 4, env: { CAMOUFOX_BROWSER_WINDOW: 'any' }, systemClock: true });
      const run = await failedRun(w);
      const end = endOf(w, run.id);
      w.e.clock.set(plus(end, 3 * 3_600_000));
      if (how === 'manual') await w.e.resume(run.id, { manual: true });
      else await resumeThroughEngine(w, run.id, how, end);
      expect(w.camoufox.calls).toHaveLength(8);
      expect(outcomes(w.e, run.id, 'camoufox').every((o) => o.status === 'priced')).toBe(true);
      vi.useRealTimers();
    }
  });

  it('a catch-up still loads no browser page, and its cells are still scheduled_only with catch-up-no-browser', async () => {
    const w = world({ env: { CAMOUFOX_BROWSER_WINDOW: 'any' } });
    w.e.clock.set(plus(F1, 2 * 3_600_000));
    const def = w.e.ctx.repos.definitions.get(w.e.definition.id);
    if (def === null) throw new Error('no definition');
    await catchUpDefinition(w.e.ctx, w.e.orch, def, w.e.clock.now());
    const run = w.e.ctx.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false })[0];
    if (run === undefined) throw new Error('no catch-up');
    await w.e.settled(run.id);
    expect(w.camoufox.calls).toEqual([]);
    expect(camoufoxCells(w, run.id)).toEqual(
      Array(4).fill(['skipped', 'scheduled_only', 'catch-up-no-browser']),
    );
  });

  it('the setting is read live: started under scheduled and resumed under any past the window loads pages (cells already scheduled_only stay so)', async () => {
    const w = world({ camoufoxFails: 4 });
    const run = await failedRun(w);
    const [first, second] = outcomes(w.e, run.id, 'camoufox');
    if (first === undefined || second === undefined) throw new Error('no cells');
    for (const c of [first, second])
      w.e.ctx.repos.cells.setOutcome(run.id, c, 'discovery', 'camoufox', {
        status: 'skipped',
        reason: 'scheduled_only',
        skipDetail: 'outside-browser-window',
      });
    w.e.clock.set(plus(endOf(w, run.id), 60_000));
    const { orch } = under(w, 'any');
    expect((await orch.resume(run.id, { manual: true })).ok).toBe(true);
    await w.e.settled(run.id);
    expect(w.camoufox.calls).toHaveLength(6);
    expect(camoufoxCells(w, run.id)).toEqual([LEFT, LEFT, ['priced', null, null], ['priced', null, null]]);
  });

  it('and started under any and resumed under scheduled past the window loads none', async () => {
    const w = world({ camoufoxFails: 4, env: { CAMOUFOX_BROWSER_WINDOW: 'any' } });
    const run = await failedRun(w);
    w.e.clock.set(plus(endOf(w, run.id), 1));
    const { orch } = under(w, 'scheduled');
    expect((await orch.resume(run.id, { manual: true })).ok).toBe(true);
    await w.e.settled(run.id);
    expect(w.camoufox.calls).toHaveLength(4);
    expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));
  });
});

describe('suspension: the window is checked before the next page after the machine slept (decision 83)', () => {
  /** A run whose first page is held in flight; the heartbeat is started at the run's start. */
  async function holding(endOffsetMs: number | null) {
    FAKE_TIMERS();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const w = world({ systemClock: true, hold });
    w.e.clock.set(MANUAL_AT);
    w.e.ctx.heartbeat.start();
    const r = await w.e.orch.start(w.e.definition.id, {
      trigger: 'manual',
      confirmCostPence: 1_000_000,
      confirmCalls: 1_000_000,
    });
    if (!r.ok) throw new Error(r.message);
    if (endOffsetMs !== null)
      w.e.ctx.repos.executions.patch(r.executionId, { browserWindowEnd: plus(MANUAL_AT, endOffsetMs) });
    await vi.advanceTimersByTimeAsync(10); // the first page is in flight, held
    expect(w.camoufox.calls).toHaveLength(1);
    return { w, id: r.executionId, release };
  }

  it('a 15-minute suspension mid-page past the window: the page in flight finishes and is stored as fetched, the rest are left', async () => {
    const { w, id, release } = await holding(60_000);
    vi.setSystemTime(new Date(Date.parse(MANUAL_AT) + 15 * 60_000)); // asleep 15 min: no beat ran
    release();
    await w.e.settled(id);
    w.e.ctx.heartbeat.stop();
    const cells = outcomes(w.e, id, 'camoufox');
    expect(cells[0]).toMatchObject({
      status: 'priced',
      fetchedAt: '2027-03-01T05:15:00.000Z',
      reusedFromExecutionId: null,
    });
    expect(cells.slice(1).map((o) => [o.status, o.reason, o.skipDetail])).toEqual(Array(3).fill(LEFT));
    expect(w.camoufox.calls).toHaveLength(1);
    expect(outcomes(w.e, id, 'travelpayouts').every((o) => o.status === 'priced')).toBe(true);
    expect(windowNotices(w)).toHaveLength(1);
  });

  it('the same suspension inside the window changes nothing', async () => {
    const { w, id, release } = await holding(60 * 60_000);
    vi.setSystemTime(new Date(Date.parse(MANUAL_AT) + 15 * 60_000));
    release();
    await w.e.settled(id);
    w.e.ctx.heartbeat.stop();
    expect(w.camoufox.calls).toHaveLength(4);
    expect(outcomes(w.e, id, 'camoufox').every((o) => o.status === 'priced')).toBe(true);
  });

  it('a run past its window with no suspension keeps loading its pages (never cut mid-run): within 120 s of the last beat a page starts normally', async () => {
    const { w, id, release } = await holding(1);
    vi.setSystemTime(new Date(Date.parse(MANUAL_AT) + 100_000)); // 100 s: not a suspension
    release();
    await w.e.settled(id);
    w.e.ctx.heartbeat.stop();
    expect(w.camoufox.calls).toHaveLength(4);
    expect(outcomes(w.e, id, 'camoufox').every((o) => o.status === 'priced')).toBe(true);
  });
});

describe('runs sharing the worker keep their tails (decision 83)', () => {
  it('two definitions firing at the same instant through the production createLimiter, interleaving page by page, each past its own window before its last page: every page fetched, none left', {
    timeout: 60_000,
  }, async () => {
    FAKE_TIMERS();
    const pageStarts: Array<{ executionId: string | null; at: number }> = [];
    let shared: ReturnType<typeof createLimiter> | null = null;
    const limiter = {
      run: <T>(fn: () => Promise<T>, o: Parameters<ReturnType<typeof createLimiter>['run']>[1]) => {
        if (shared === null) throw new Error('no limiter');
        return shared.run(fn, o);
      },
      pageMs: 5 * 60_000, // each page takes 5 min: far past the estimate's page time
      pageStarts,
    };
    const camoufox = stubCamoufox({ cells: 4, limiter });
    const e = engineWith([camoufox, stubTravelpayouts({ cells: 4 })], {
      scheduleCron: '0 6 * * *',
      window: WINDOW,
      systemClock: true,
      createdAt: CREATED,
    });
    const cfg = e.deps.config.providers.camoufox;
    if (cfg === null) throw new Error('camoufox not configured');
    shared = createLimiter(camoufoxHttpLimits(cfg, e.deps.config), { usedThisHour: 0 });
    const {
      id: _id,
      confirmedCostPence: _c,
      confirmedCalls: _cc,
      createdAt: _a,
      updatedAt: _u,
      deletedAt: _d,
      ...input
    } = e.definition;
    const other = e.ctx.repos.definitions.create({ ...input, name: 'London to New York, second' });
    e.clock.set(F1);
    e.ctx.heartbeat.start();
    const a = await e.orch.start(e.definition.id, { trigger: 'schedule', scheduledFor: F1 });
    const b = await e.orch.start(other.id, { trigger: 'schedule', scheduledFor: F1 });
    if (!a.ok || !b.ok) throw new Error('refused');
    // why: eight five-minute pages through one worker: far more fake time than the default settle loop advances
    for (let i = 0; i < 400 && e.ctx.repos.executions.listByStatus(['running']).length > 0; i++)
      await vi.advanceTimersByTimeAsync(10_000);
    await e.settled(a.executionId);
    await e.settled(b.executionId);
    e.ctx.heartbeat.stop();
    for (const id of [a.executionId, b.executionId]) {
      expect(outcomes(e, id, 'camoufox').map((o) => o.status)).toEqual([
        'priced',
        'priced',
        'priced',
        'priced',
      ]);
      const last = Math.max(...pageStarts.filter((p) => p.executionId === id).map((p) => p.at));
      expect(last).toBeGreaterThan(Date.parse(e.ctx.repos.executions.get(id)?.browserWindowEnd ?? ''));
    }
    // page by page: the two runs' pages alternate through the one worker
    expect(new Set(pageStarts.slice(0, 2).map((p) => p.executionId)).size).toBe(2);
  });
});

describe('review round 1: the window and its notice at their edges (R4, R5, R6, R8, R10, R14)', () => {
  /** A held gate: the stub's limiter admits each page only once `open` is called. */
  function gatedLimiter() {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const pageStarts: Array<{ executionId: string | null; at: number }> = [];
    return {
      limiter: {
        run: async <T>(fn: () => Promise<T>) => {
          await gate;
          return fn();
        },
        pageMs: 1,
        pageStarts,
      },
      open: () => open(),
      pageStarts,
    };
  }

  it('R5: a page that waited for the limiter across a sleep is checked when the limiter admits it: past the window, no request is sent', async () => {
    FAKE_TIMERS();
    const g = gatedLimiter();
    const camoufox = stubCamoufox({ cells: 4, limiter: g.limiter });
    const e = engineWith([camoufox, stubTravelpayouts({ cells: 4 })], {
      scheduleCron: '0 6 * * *',
      window: WINDOW,
      createdAt: CREATED,
      systemClock: true,
    });
    e.clock.set(MANUAL_AT);
    e.ctx.heartbeat.start();
    const r = await e.orch.start(e.definition.id, {
      trigger: 'manual',
      confirmCostPence: 1_000_000,
      confirmCalls: 1_000_000,
    });
    if (!r.ok) throw new Error(r.message);
    e.ctx.repos.executions.patch(r.executionId, { browserWindowEnd: plus(MANUAL_AT, 60_000) });
    await vi.advanceTimersByTimeAsync(10); // the first page is picked and waits for its slot
    vi.setSystemTime(new Date(Date.parse(MANUAL_AT) + 15 * 60_000)); // asleep 15 min while it waited: no beat ran
    g.open();
    await e.settled(r.executionId);
    e.ctx.heartbeat.stop();
    expect(g.pageStarts).toEqual([]);
    expect(camoufox.calls).toEqual([]);
    expect(outcomes(e, r.executionId, 'camoufox').map((o) => [o.status, o.reason, o.skipDetail])).toEqual(
      Array(4).fill(LEFT),
    );
    expect(outcomes(e, r.executionId, 'travelpayouts').every((o) => o.status === 'priced')).toBe(true);
    // R10: a pass the window cut leaves its tiles unrequested on purpose, which is no parity break
    expect(e.notifications.map((n) => n.kind)).not.toContain('parity_break');
    expect(e.notifications.map((n) => n.kind)).toContain('browser_window');
  });

  it('R4: a live-tick resume refused at the claim writes neither scheduled_for nor browser_window_end', async () => {
    const w = world({ camoufoxFails: 4 });
    w.e.clock.set(F1);
    await w.e.tick();
    const run = w.e.ctx.repos.executions.listForDefinition(w.e.definition.id, {
      limit: 1,
      includeChildren: false,
    })[0];
    if (run === undefined) throw new Error('no run');
    await w.e.settled(run.id);
    w.e.ctx.repos.executions.setStatus(run.id, 'paused_budget', { resumeAfter: plus(F1, 3_600_000) });
    const before = w.e.ctx.repos.executions.get(run.id);
    // why: another resume claims the run first; the tick's resume is then refused after its window was worked out
    vi.spyOn(w.e.ctx.repos.executions, 'claimResume').mockReturnValueOnce(false);
    w.e.clock.set(F2);
    await w.e.tick();
    expect(w.e.ctx.repos.executions.get(run.id)).toMatchObject({
      scheduledFor: before?.scheduledFor,
      browserWindowEnd: before?.browserWindowEnd,
      status: 'paused_budget',
    });
    expect(w.camoufox.calls).toHaveLength(4);
  });

  it('R4: when another row takes the firing between the window check and the claim, the pass carries on under the old window', async () => {
    const w = world({ camoufoxFails: 4 });
    w.e.clock.set(F1);
    await w.e.tick();
    const run = w.e.ctx.repos.executions.listForDefinition(w.e.definition.id, {
      limit: 1,
      includeChildren: false,
    })[0];
    if (run === undefined) throw new Error('no run');
    await w.e.settled(run.id);
    w.e.ctx.repos.executions.setStatus(run.id, 'paused_budget', { resumeAfter: plus(F1, 3_600_000) });
    const end = endOf(w, run.id);
    const repo = w.e.ctx.repos.executions;
    const claim = repo.claimResume.bind(repo);
    // why: the firing is taken by another row just before the claim, after the in-memory window said it was free
    vi.spyOn(repo, 'claimResume').mockImplementationOnce((id) => {
      repo.createForFiring({
        definitionId: w.e.definition.id,
        isChild: false,
        cell: null,
        snapshot: run.snapshot,
        estimate: null,
        trigger: 'schedule',
        status: 'skipped_budget',
        scheduledFor: F2,
      });
      return claim(id);
    });
    w.e.clock.set(F2);
    await w.e.tick();
    await w.e.settled(run.id);
    expect(repo.get(run.id)).toMatchObject({ scheduledFor: F1, browserWindowEnd: end });
    expect(w.camoufox.calls).toHaveLength(4);
    expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));
  });

  it('R6: a catch-up whose browser cell was left runnable still loads no page: the resume leaves it catch-up-no-browser', async () => {
    const w = world();
    w.e.clock.set(plus(F1, 2 * 3_600_000));
    const def = w.e.ctx.repos.definitions.get(w.e.definition.id);
    if (def === null) throw new Error('no definition');
    await catchUpDefinition(w.e.ctx, w.e.orch, def, w.e.clock.now());
    const run = w.e.ctx.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false })[0];
    if (run === undefined) throw new Error('no catch-up');
    await w.e.settled(run.id);
    // why: plant what no code writes today, a not_run camoufox cell on a catch-up, so the rule cannot rest on seeding
    const [cell] = w.e.ctx.repos.cells
      .outcomes(run.id, { stage: 'discovery' })
      .filter((o) => o.providerId === 'camoufox');
    if (cell === undefined) throw new Error('no camoufox cell');
    w.e.ctx.repos.cells.setOutcome(run.id, cell, 'discovery', 'camoufox', {
      status: 'error',
      reason: 'upstream',
    });
    await w.e.resume(run.id, { manual: true });
    expect(w.camoufox.calls).toEqual([]);
    expect(camoufoxCells(w, run.id)).toEqual(
      Array(4).fill(['skipped', 'scheduled_only', 'catch-up-no-browser']),
    );
  });

  it('R6: mayLoadPage refuses a catch-up outright and leaves its runnable browser cells catch-up-no-browser', async () => {
    const w = world();
    w.e.clock.set(plus(F1, 2 * 3_600_000));
    const def = w.e.ctx.repos.definitions.get(w.e.definition.id);
    if (def === null) throw new Error('no definition');
    await catchUpDefinition(w.e.ctx, w.e.orch, def, w.e.clock.now());
    const exec = w.e.ctx.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false })[0];
    if (exec === undefined) throw new Error('no catch-up');
    await w.e.settled(exec.id);
    const camoufoxOutcomes = w.e.ctx.repos.cells
      .outcomes(exec.id, { stage: 'discovery' })
      .filter((o) => o.providerId === 'camoufox');
    for (const o of camoufoxOutcomes)
      w.e.ctx.repos.cells.setOutcome(exec.id, o, 'discovery', 'camoufox', {
        status: 'not_run',
        reason: null,
        skipDetail: null,
      });
    const run = newRun(w.e.ctx, exec, { manual: false, fresh: false, blocked: new Set() });
    const lane = laneFor(run, 'discovery', 'camoufox');
    expect(mayLoadPage(w.e.ctx, run, 'camoufox', lane)).toBe(false);
    expect(lane.windowOut).toBe('catch-up-no-browser');
    expect(camoufoxCells(w, exec.id)).toEqual(
      Array(4).fill(['skipped', 'scheduled_only', 'catch-up-no-browser']),
    );
    expect(mayLoadPage(w.e.ctx, run, 'travelpayouts', laneFor(run, 'discovery', 'travelpayouts'))).toBe(true);
  });

  it('R12: on a definition with no schedule the notice promises the cells to the operator’s next run, never a scheduled one', async () => {
    const w = world({ camoufoxFails: 4 });
    const run = await failedRun(w);
    w.e.ctx.repos.definitions.update(w.e.definition.id, { scheduleCron: null });
    w.e.clock.set(plus(endOf(w, run.id), 1));
    await w.e.resume(run.id, { manual: true });
    expect(camoufoxCells(w, run.id)).toEqual(Array(4).fill(LEFT));
    expect(windowNotices(w)[0]?.body).toContain(
      'remaining browser cells are left for your next run of this search',
    );
    expect(windowNotices(w)[0]?.body).not.toContain('next scheduled run;');
  });

  it('R8: a punctual tick 115 s after its firing, a 72 s estimate: the window runs from the start, so the page loads', async () => {
    const camoufox = stubCamoufox({ cells: 1 });
    const e = engineWith([camoufox, stubTravelpayouts({ cells: 1 })], {
      scheduleCron: '0 6 * * *',
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 1 },
      createdAt: CREATED,
    });
    e.clock.set(plus(F1, 115_000));
    await e.tick();
    const run = e.ctx.repos.executions.listForDefinition(e.definition.id, {
      limit: 1,
      includeChildren: false,
    })[0];
    if (run === undefined) throw new Error('no run');
    const done = await e.settled(run.id);
    expect(done.scheduledFor).toBe(F1);
    // why: from the firing, the end would be F1 + 108 s, already behind the first page
    expect(1.5 * (done.estimate?.seconds ?? 0) * 1000).toBeLessThan(115_000);
    expect(camoufox.calls).toHaveLength(1);
    expect(outcomes(e, run.id, 'camoufox').map((o) => o.status)).toEqual(['priced']);
  });

  it.each(['window first', 'provider_disabled first'] as const)(
    'R14: one pass with both a closed window and a disabled provider sends both notices (%s)',
    async (order) => {
      FAKE_TIMERS();
      const cf = gatedLimiter();
      const tp = gatedLimiter();
      const auth = new ProviderError({
        kind: 'auth',
        retryable: false,
        providerId: 'travelpayouts',
        message: 'token refused',
      });
      const camoufox = stubCamoufox({ cells: 4, limiter: cf.limiter });
      const travelpayouts = stubTravelpayouts({ cells: 4, failCalls: 4, error: auth, limiter: tp.limiter });
      const e = engineWith([camoufox, travelpayouts], {
        scheduleCron: '0 6 * * *',
        window: WINDOW,
        createdAt: CREATED,
        systemClock: true,
      });
      e.clock.set(MANUAL_AT);
      const r = await e.orch.start(e.definition.id, {
        trigger: 'manual',
        confirmCostPence: 1_000_000,
        confirmCalls: 1_000_000,
      });
      if (!r.ok) throw new Error(r.message);
      e.ctx.repos.executions.patch(r.executionId, { browserWindowEnd: plus(MANUAL_AT, -1) });
      await vi.advanceTimersByTimeAsync(10);
      const [first, second] = order === 'window first' ? [cf, tp] : [tp, cf];
      first.open();
      await vi.advanceTimersByTimeAsync(10);
      second.open();
      await e.settled(r.executionId);
      const kinds = e.notifications
        .map((n) => n.kind)
        .filter((k) => k === 'browser_window' || k === 'provider_disabled');
      expect(kinds).toEqual(
        order === 'window first'
          ? ['browser_window', 'provider_disabled']
          : ['provider_disabled', 'browser_window'],
      );
    },
  );
});
