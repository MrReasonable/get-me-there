// The keep-awake lease, the engine's side (spec §2 "The keep-awake lease", §8.2): while any run is in progress the
// engine holds the machine awake through the browser worker, renewing the lease every AWAKE_RENEW_SECONDS, and
// releases it when the last run ends. A hold that fails is logged at warn and never fails a run. The renewal timer is
// injected (a manual table), so no test waits in real time.
import {
  AWAKE_LEASE_SECONDS,
  AWAKE_RENEW_SECONDS,
  type FlightProvider,
  type KeepAwakeCapability,
} from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { AWAKE_RENEW_MS, createAwakeKeeper } from '../src/keepAwake.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { baseDefinition, capturingLogger, createHarness, type LogLine } from './support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});

/** Lets every queued promise settle. */
const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

/** A capability that records each call; `fail` makes each call reject (or throw at once with 'throw'). */
function recorder(fail: false | 'reject' | 'throw' = false) {
  const calls: string[] = [];
  const cap: KeepAwakeCapability = {
    hold: async (seconds) => {
      calls.push(`hold ${seconds}`);
      if (fail === 'reject') throw new Error('worker down');
    },
    release: (_signal) => {
      calls.push('release');
      if (fail === 'throw') throw new Error('worker down');
      return fail === 'reject' ? Promise.reject(new Error('worker down')) : Promise.resolve();
    },
  };
  return { cap, calls };
}

/** A manual interval table: `tick()` runs every live interval once. */
function intervals() {
  const live = new Set<() => void>();
  return {
    every: (fn: () => void, ms: number) => {
      expect(ms).toBe(AWAKE_RENEW_MS);
      live.add(fn);
      return () => {
        live.delete(fn);
      };
    },
    tick: () => {
      for (const fn of [...live]) fn();
    },
    count: () => live.size,
  };
}

function keeper(caps: KeepAwakeCapability[]) {
  const lines: LogLine[] = [];
  const t = intervals();
  const k = createAwakeKeeper({
    holds: caps,
    log: capturingLogger(lines),
    signal: new AbortController().signal,
    every: t.every,
  });
  return { k, lines, t };
}

describe('the engine’s keep-awake lease (spec §2 "The keep-awake lease")', () => {
  it('renews every minute with a five-minute lease', () => {
    expect([AWAKE_RENEW_MS, AWAKE_LEASE_SECONDS]).toEqual([AWAKE_RENEW_SECONDS * 1000, 300]);
  });
  it('holds at the first run’s start, renews while any run is in progress, and releases when the last ends', async () => {
    const r = recorder();
    const { k, t } = keeper([r.cap]);
    k.started();
    await settle();
    expect(r.calls).toEqual(['hold 300']);
    t.tick();
    await settle();
    expect(r.calls).toEqual(['hold 300', 'hold 300']);
    // why: a second run in progress takes no hold of its own; the first one's end keeps the lease
    k.started();
    k.ended();
    t.tick();
    await settle();
    expect(r.calls).toEqual(['hold 300', 'hold 300', 'hold 300']);
    k.ended();
    await settle();
    expect(r.calls).toEqual(['hold 300', 'hold 300', 'hold 300', 'release']);
    expect(t.count()).toBe(0);
    t.tick();
    await settle();
    expect(r.calls).toHaveLength(4);
  });
  it('a release never overtakes a hold still in flight', async () => {
    const order: string[] = [];
    let answer: () => void = () => undefined;
    const cap: KeepAwakeCapability = {
      hold: () =>
        new Promise<void>((resolve) => {
          answer = () => {
            order.push('hold answered');
            resolve();
          };
        }),
      release: async () => {
        order.push('release sent');
      },
    };
    const { k } = keeper([cap]);
    k.started();
    k.ended();
    await settle();
    expect(order).toEqual([]);
    answer();
    await settle();
    expect(order).toEqual(['hold answered', 'release sent']);
    await k.settled();
  });
  it.each(['reject', 'throw'] as const)(
    'a hold or release that fails (%s) is logged at warn and never thrown',
    async (fail) => {
      const r = recorder(fail);
      const { k, lines, t } = keeper([r.cap]);
      expect(() => k.started()).not.toThrow();
      t.tick();
      expect(() => k.ended()).not.toThrow();
      await k.settled();
      expect(r.calls).toEqual(['hold 300', 'hold 300', 'release']);
      const warns = lines.filter((l) => l.level === 'warn');
      expect(warns.length).toBe(fail === 'reject' ? 3 : 1);
      expect(warns[0]?.msg).toBe('keep-awake: the lease could not be renewed or released');
    },
  );
  it('without a provider that can hold it, nothing is held and no timer runs', async () => {
    const { k, t } = keeper([]);
    k.started();
    expect(t.count()).toBe(0);
    k.ended();
    await k.settled();
  });
  it('settled() waits for the release the last run’s end sent', async () => {
    let released = false;
    const cap: KeepAwakeCapability = {
      hold: async () => undefined,
      release: async () => {
        await settle();
        released = true;
      },
    };
    const { k } = keeper([cap]);
    k.started();
    k.ended();
    await k.settled();
    expect(released).toBe(true);
  });
});

/** The fixture, with a keep-awake capability added (no other change). */
const withKeepAwake =
  (cap: KeepAwakeCapability) =>
  (p: FlightProvider): FlightProvider => ({
    id: p.id,
    displayName: p.displayName,
    suppliedFields: p.suppliedFields,
    cabins: p.cabins,
    ...(p.discovery === undefined ? {} : { discovery: p.discovery }),
    ...(p.verification === undefined ? {} : { verification: p.verification }),
    healthcheck: (ctx) => p.healthcheck(ctx),
    keepAwake: cap,
  });

describe('the lease around a real run', () => {
  it('a run holds the machine awake from its start and releases it at its end', async () => {
    const r = recorder();
    const h = createHarness({ transformFixture: withKeepAwake(r.cap) });
    const def = h.createDefinition(baseDefinition());
    let atDiscovery: string[] = [];
    h.onStageStart('discovery', () => {
      atDiscovery = [...r.calls];
    });
    const ctx = buildContext(h.deps, h.options);
    const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), def.id);
    await ctx.awake.settled();
    expect(e.status).toBe('completed');
    expect(atDiscovery).toEqual(['hold 300']);
    expect(r.calls[0]).toBe('hold 300');
    expect(r.calls.at(-1)).toBe('release');
  });
  it('a worker that refuses every hold never fails the run', async () => {
    const r = recorder('reject');
    const h = createHarness({ transformFixture: withKeepAwake(r.cap) });
    const def = h.createDefinition(baseDefinition());
    const ctx = buildContext(h.deps, h.options);
    const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), def.id);
    await ctx.awake.settled();
    expect(e.status).toBe('completed');
    expect(r.calls).toEqual(['hold 300', 'release']);
    expect(
      h.logs.filter((l) => l.msg === 'keep-awake: the lease could not be renewed or released'),
    ).toHaveLength(2);
  });
});
