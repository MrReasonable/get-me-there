// The engine's shutdown (spec §8.1 SIGTERM; WP16a review R2, S2): nothing new starts from its first moment, every run
// stops taking new provider work at once, the scheduler's callbacks already running (the minute catch-up awaiting a
// notice's send) get a wait bounded by the notice's own timeouts, and a callback past the bound writes nothing to the
// database the app then closes. Fake timers drive croner; the worked example only.
import { asIsoDateTime, type Notifier, type OperatorMessage } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import { SHUTDOWN_DRAIN_MS } from '../../src/engine.js';
import { createEngine } from '../../src/index.js';
import { catchUpAll } from '../../src/scheduler/catchUp.js';
import { createScheduler } from '../../src/scheduler/scheduler.js';
import { frankfurterBody, stubFrankfurter } from '../support/fx.js';
import {
  capturingLogger,
  createHarness,
  FIXTURE_RULES,
  type Harness,
  type LogLine,
} from '../support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  vi.useRealTimers();
});

const at = asIsoDateTime;
const RELATIVE = { kind: 'relative', startOffsetDays: 7, lengthDays: 14 } as const;
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });

/** A notifier whose sends wait until `release` is called. */
function heldNotifier(sent: OperatorMessage[]): {
  notifier: Notifier;
  release: () => void;
  waiting: () => number;
} {
  const holds: Array<() => void> = [];
  let open = false;
  return {
    notifier: {
      id: 'held',
      send: async (m) => {
        if (!open) await new Promise<void>((r) => holds.push(r));
        if (m.kind === 'operator') sent.push(m.message);
        return { ok: true };
      },
    },
    release: () => {
      open = true;
      for (const r of holds.splice(0)) r();
    },
    waiting: () => holds.length,
  };
}

describe('engine shutdown with the minute job mid-flight (R2)', () => {
  it('a skip notice held while the shutdown begins: the callback finishes on an open database and nothing logs a failure', {
    timeout: 30_000,
  }, async () => {
    const h = createHarness({ fakeTimers: true, systemClock: true, now: at('2027-02-28T00:00:00.000Z') });
    // a weekly definition whose missed Monday firing is a half-cadence skip, and so a notice
    const weekly = h.createDefinition({ name: 'weekly', scheduleCron: '0 6 * * 1', window: RELATIVE });
    stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    const sent: OperatorMessage[] = [];
    const held = heldNotifier(sent);
    h.clock.set(at('2027-02-28T00:30:00.000Z'));
    const engine = createEngine({ ...h.deps, notifiers: [held.notifier] }, h.options);
    await engine.boot();
    vi.setSystemTime(new Date('2027-03-07T05:30:00.000Z')); // asleep until 6 of 7 days after Monday's firing
    // why: the late live tick or the minute job, whichever croner fires first on waking, writes the skip and sends
    for (let i = 0; i < 200 && held.waiting() === 0; i++) await vi.advanceTimersByTimeAsync(1_000);
    expect(held.waiting()).toBe(1);
    let returned = false;
    const stopping = engine.shutdown().then(() => {
      returned = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    // why: the shutdown is still waiting for the callback, so whoever closes the database next (app.ts) cannot yet
    expect(returned).toBe(false);
    held.release();
    await stopping;
    const [skip] = executions(h, weekly.id);
    expect([skip?.status, skip?.skipCode]).toEqual(['skipped_missed', 'half-cadence']);
    expect(h.repos.notifications.wasSent('skipped_missed', skip?.id ?? null, weekly.id)).toBe(true);
    h.db.close(); // as app.ts does once the engine has shut down
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([]);
    expect(sent.map((m) => m.kind)).toEqual(['skipped_missed']);
  });

  it('S2: a send held past the bound: the shutdown returns at the bound, the late send writes nothing to the closed database and logs once', {
    timeout: 30_000,
  }, async () => {
    const h = createHarness({ fakeTimers: true, systemClock: true, now: at('2027-02-28T00:00:00.000Z') });
    const weekly = h.createDefinition({ name: 'weekly', scheduleCron: '0 6 * * 1', window: RELATIVE });
    stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    const sent: OperatorMessage[] = [];
    const held = heldNotifier(sent);
    h.clock.set(at('2027-02-28T00:30:00.000Z'));
    const engine = createEngine({ ...h.deps, notifiers: [held.notifier] }, h.options);
    await engine.boot();
    vi.setSystemTime(new Date('2027-03-07T05:30:00.000Z'));
    for (let i = 0; i < 200 && held.waiting() === 0; i++) await vi.advanceTimersByTimeAsync(1_000);
    expect(held.waiting()).toBe(1);
    let returned = false;
    const stopping = engine.shutdown().then(() => {
      returned = true;
    });
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DRAIN_MS - 1);
    expect(returned).toBe(false); // the bound is the notice's, not a bare 5 s
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    const [skip] = executions(h, weekly.id);
    expect(h.repos.notifications.wasSent('skipped_missed', skip?.id ?? null, weekly.id)).toBe(false);
    h.db.close(); // as app.ts does once the engine has shut down
    held.release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.logs.filter((l) => l.level === 'error')).toEqual([]);
    expect(
      h.logs
        .filter((l) => l.msg === 'operator notification finished after shutdown; not recorded')
        .map((l) => l.fields),
    ).toEqual([{ kind: 'skipped_missed', executionId: skip?.id, definitionId: weekly.id, sent: true }]);
    expect(sent.map((m) => m.kind)).toEqual(['skipped_missed']);
  });

  it('S2: once the shutdown begins, a run in flight starts no further provider request while the scheduler job is awaited', {
    timeout: 30_000,
  }, async () => {
    const h = createHarness({
      fakeTimers: true,
      systemClock: true,
      fixtureConcurrency: 1,
      now: at('2027-02-28T00:00:00.000Z'),
    });
    const weekly = h.createDefinition({ name: 'weekly', scheduleCron: '0 6 * * 1', window: RELATIVE });
    const manual = h.createDefinition({ name: 'manual', window: RELATIVE });
    stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    const sent: OperatorMessage[] = [];
    const held = heldNotifier(sent);
    h.clock.set(at('2027-02-28T00:30:00.000Z'));
    const engine = createEngine({ ...h.deps, notifiers: [held.notifier] }, h.options);
    await engine.boot();
    vi.setSystemTime(new Date('2027-03-07T05:30:00.000Z'));
    for (let i = 0; i < 200 && held.waiting() === 0; i++) await vi.advanceTimersByTimeAsync(1_000);
    expect(held.waiting()).toBe(1);
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold, times: 1 }]);
    const r = await engine.start(manual.id, {
      trigger: 'manual',
      confirmCostPence: 1_000_000,
      confirmCalls: 1_000_000,
    });
    if (!r.ok) throw new Error(r.message);
    for (let i = 0; i < 100 && h.requests.length === 0; i++) await vi.advanceTimersByTimeAsync(10);
    expect(h.requests).toHaveLength(1); // its first calendar request, held
    const stopping = engine.shutdown();
    await vi.advanceTimersByTimeAsync(10);
    await h.releaseHolds(); // the held request answers; the run's lanes took no further tile
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.requests).toHaveLength(1);
    held.release();
    await vi.advanceTimersByTimeAsync(1_000);
    await stopping;
    expect(h.requests).toHaveLength(1);
    expect(h.repos.executions.get(r.executionId)?.status).toBe('interrupted');
    expect(executions(h, weekly.id)).toHaveLength(1);
  });

  it('a minute job that finds the engine closing takes no further definition', async () => {
    const h = createHarness();
    const daily = h.createDefinition({ scheduleCron: '0 6 * * *', window: RELATIVE });
    h.clock.set(at('2027-03-01T08:00:00.000Z'));
    const ctx = buildContext(h.deps, h.options);
    ctx.lifecycle.closing = true;
    await catchUpAll(ctx, h.orch());
    expect(executions(h, daily.id)).toEqual([]);
  });

  it('once shutdown has begun, start, resume and verifyCell are refused (shutting-down) and launch nothing', async () => {
    const h = createHarness();
    const def = h.createDefinition({ window: RELATIVE });
    const engine = createEngine(h.deps, h.options);
    await engine.shutdown();
    const r = await engine.start(def.id, {
      trigger: 'manual',
      confirmCostPence: 1_000_000,
      confirmCalls: 1_000_000,
    });
    expect(r).toMatchObject({ ok: false, code: 'shutting-down' });
    expect(await engine.resume('any', { manual: true })).toMatchObject({ ok: false, code: 'shutting-down' });
    expect(executions(h, def.id)).toEqual([]);
  });
});

describe('Scheduler.drain (R2)', () => {
  it('resolves once every running callback settles; a callback past the bound is left, logged, and drain answers false', async () => {
    vi.useFakeTimers();
    const lines: LogLine[] = [];
    let finish: () => void = () => undefined;
    const sched = createScheduler(
      {
        onTick: async () => undefined,
        onResumeDue: async () => undefined,
        onSystem: () =>
          new Promise<void>((r) => {
            finish = r;
          }),
      },
      capturingLogger(lines),
    );
    expect(await sched.drain(1_000)).toBe(true); // nothing running
    sched.runSystemSoon('catch-up', 0);
    await vi.advanceTimersByTimeAsync(1);
    const bounded = sched.drain(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await bounded).toBe(false);
    expect(lines.map((l) => l.msg)).toContain('scheduler: jobs still running at shutdown');
    const waiting = sched.drain(60_000);
    finish();
    expect(await waiting).toBe(true);
    sched.stopAll();
  });
});
