// The heartbeat (spec §8.2 rev 36; decision 83): sleep is detected from the wall clock, never inferred from page timing.
// Fake timers drive its interval; a separate, controllable wall clock stands for the machine's.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import {
  createHeartbeat,
  HEARTBEAT_MS,
  SUSPENSION_GAP_MS,
  type Suspension,
} from '../../src/scheduler/heartbeat.js';
import { capturingLogger, createHarness, type LogLine } from '../support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  vi.useRealTimers();
});

const T = Date.parse('2027-03-01T06:00:00.000Z');

function setup() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let wall = T;
  const lines: LogLine[] = [];
  const seen: Suspension[] = [];
  const hb = createHeartbeat(capturingLogger(lines), () => wall);
  hb.onSuspension((s) => seen.push(s));
  return {
    hb,
    lines,
    seen,
    jump: (ms: number) => {
      wall += ms;
    },
    beat: async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    },
  };
}

describe('the heartbeat (decision 83)', () => {
  it('beats every 30 s; a gap of 119 s is not a suspension, one of 121 s is (suspendedAt the previous beat, resumedAt now)', async () => {
    expect([HEARTBEAT_MS, SUSPENSION_GAP_MS]).toEqual([30_000, 120_000]);
    const h = setup();
    h.hb.start();
    h.jump(119_000);
    await h.beat();
    expect(h.seen).toEqual([]);
    h.jump(121_000);
    await h.beat();
    expect(h.seen).toEqual([
      { suspendedAt: '2027-03-01T06:01:59.000Z', resumedAt: '2027-03-01T06:04:00.000Z' },
    ]);
    expect(h.lines.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(h.lines[0]?.fields).toEqual(h.seen[0]);
    expect(h.lines[0]?.msg).toBe(
      'heartbeat: the process was suspended; runs in flight check their browser window',
    );
    h.jump(30_000);
    await h.beat();
    expect(h.seen).toHaveLength(1);
    h.hb.stop();
  });

  it('before a page, a last beat older than 120 s counts as a suspension (the up to 30 s after a wake); within 120 s it does not', () => {
    const h = setup();
    h.hb.start();
    h.jump(120_000);
    h.hb.checkBeforePage();
    expect(h.seen).toEqual([]);
    h.jump(15 * 60_000);
    h.hb.checkBeforePage();
    expect(h.seen).toEqual([
      { suspendedAt: '2027-03-01T06:00:00.000Z', resumedAt: '2027-03-01T06:17:00.000Z' },
    ]);
    h.hb.checkBeforePage(); // the detection moved the last beat: no second report
    expect(h.seen).toHaveLength(1);
    h.hb.stop();
  });

  it('a beat exactly 120 s after the last is not a suspension', async () => {
    const h = setup();
    h.hb.start();
    h.jump(120_000);
    await h.beat();
    expect(h.seen).toEqual([]);
    h.hb.stop();
  });

  it('stopped, its timer is gone: later beats, however far apart on the wall clock, report nothing', async () => {
    const h = setup();
    h.hb.start();
    h.hb.stop();
    expect(vi.getTimerCount()).toBe(0);
    h.jump(60 * 60_000);
    await h.beat();
    h.jump(60 * 60_000);
    await h.beat();
    expect(h.seen).toEqual([]);
  });

  it('not started (a bare orchestrator, a tool run), it never detects anything; stopped, it forgets its last beat', () => {
    const h = setup();
    h.jump(60 * 60_000);
    h.hb.checkBeforePage();
    h.jump(60 * 60_000);
    h.hb.checkBeforePage();
    expect(h.seen).toEqual([]);
    h.hb.start();
    h.hb.stop();
    h.jump(60 * 60_000);
    h.hb.checkBeforePage();
    expect(h.seen).toEqual([]);
  });

  it('is unreferenced, so it never keeps the process alive; starting twice keeps one timer', () => {
    const made: Array<{ hasRef(): boolean }> = [];
    const real = globalThis.setInterval;
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, ms) => {
      const t = real(fn, ms);
      made.push(t);
      return t;
    });
    const hb = createHeartbeat(capturingLogger([]));
    hb.start();
    hb.start();
    expect(made).toHaveLength(1);
    expect(made[0]?.hasRef()).toBe(false);
    hb.stop();
    spy.mockRestore();
  });

  it('makes no file, network or database call: it imports only core, and a beat touches no fetch', async () => {
    const source = readFileSync(new URL('../../src/scheduler/heartbeat.ts', import.meta.url), 'utf8');
    expect([...source.matchAll(/from '([^']+)'/g)].map((m) => m[1])).toEqual(['@gmt/core']);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const h = setup();
    h.hb.start();
    h.jump(10 * 60_000);
    await h.beat();
    h.hb.checkBeforePage();
    expect(fetch).not.toHaveBeenCalled();
    h.hb.stop();
  });
});

describe('the engine’s heartbeat reads the Clock port (R13)', () => {
  it('a context on a fixed clock detects a suspension when that clock jumps, as the window check it feeds would see it', () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    const seen: Suspension[] = [];
    ctx.heartbeat.onSuspension((s) => seen.push(s));
    ctx.heartbeat.start();
    h.clock.advance(15 * 60_000); // the engine's clock moves; the process clock does not
    ctx.heartbeat.checkBeforePage();
    ctx.heartbeat.stop();
    expect(seen).toEqual([
      { suspendedAt: '2026-10-14T09:00:00.000Z', resumedAt: '2026-10-14T09:15:00.000Z' },
    ]);
  });
});
