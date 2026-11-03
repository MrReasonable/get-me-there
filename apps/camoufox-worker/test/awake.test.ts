// The keep-awake lease on the worker's side (spec §2 "The keep-awake lease"): a fake spawn and a fake timer table, so
// no test runs caffeinate or systemd-inhibit and none waits in real time. The platform is injected, so every test here
// runs the same on any OS.
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { AWAKE_MAX_SECONDS, awakeAnswerSchema } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AWAKE_OVERLAP_MS,
  type AwakeDeps,
  type AwakeEnd,
  AwakeKeeper,
  awakeCommand,
  findOnPathOf,
  realAwakeKeeper,
  spawnChild,
} from '../src/awake.js';
import { memoryLog } from './support/log.js';
import { tmpDir } from './support/tmp.js';

const T0 = Date.parse('2026-10-18T05:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

interface FakeChild {
  command: string;
  args: readonly string[];
  killed: boolean;
  /** How many times the child was killed (each replaced child is killed exactly once). */
  kills: number;
  end(e: AwakeEnd): void;
}

/** A fake world: a clock, a timer table that fires on `advance`, and a spawn that records each child. */
function world(o: { platform?: string; onPath?: boolean; spawnThrows?: boolean } = {}) {
  let now = T0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const children: FakeChild[] = [];
  const log = memoryLog();
  const deps: AwakeDeps = {
    platform: o.platform ?? 'darwin',
    pid: 4242,
    log,
    now: () => now,
    later: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    spawn: (command, args, onEnd) => {
      if (o.spawnThrows === true) throw new Error('spawn refused');
      const c: FakeChild = { command, args, killed: false, kills: 0, end: onEnd };
      children.push(c);
      return {
        kill: () => {
          c.killed = true;
          c.kills += 1;
        },
      };
    },
    findOnPath: (name) => (o.onPath === false ? null : `/usr/bin/${name}`),
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const t of timers)
      if (t.live && t.at <= now) {
        t.live = false;
        t.fn();
      }
  };
  const live = (): FakeChild[] => children.filter((c) => !c.killed);
  return { deps, log, children, live, advance, keeper: new AwakeKeeper(deps) };
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('the platform’s hold (spec §2 "The keep-awake lease")', () => {
  it('macOS: caffeinate holding idle sleep only, tied to the worker’s pid, for the lease', () => {
    expect(awakeCommand('darwin', 4242, 300, () => null)).toEqual({
      mechanism: 'caffeinate',
      command: '/usr/bin/caffeinate',
      args: ['-i', '-w', '4242', '-t', '300'],
    });
  });
  it('Linux: systemd-inhibit blocking idle and sleep around a sleep of the lease, when it is on the PATH', () => {
    expect(
      awakeCommand('linux', 4242, 300, (n) => (n === 'systemd-inhibit' ? '/usr/bin/systemd-inhibit' : null)),
    ).toEqual({
      mechanism: 'systemd-inhibit',
      command: '/usr/bin/systemd-inhibit',
      args: [
        '--what=idle:sleep',
        '--who=get-me-there',
        '--why=a search is running',
        '--mode=block',
        'sleep',
        '300',
      ],
    });
  });
  it('Linux without systemd-inhibit, and any other platform: nothing', () => {
    const found = (n: string): string => `/usr/bin/${n}`;
    expect(awakeCommand('linux', 4242, 300, () => null)).toBeNull();
    expect(awakeCommand('win32', 4242, 300, found)).toBeNull();
    expect(awakeCommand('freebsd', 4242, 300, found)).toBeNull();
  });
});

describe('the lease', () => {
  it('grants: one child for the lease, the answer saying until when and by what', () => {
    const w = world();
    const a = w.keeper.hold(300);
    expect(a).toEqual({ held: true, until: iso(T0 + 300_000), mechanism: 'caffeinate' });
    expect(awakeAnswerSchema.safeParse(a).success).toBe(true);
    expect(w.children.map((c) => c.args)).toEqual([['-i', '-w', '4242', '-t', '300']]);
    expect(w.keeper.state()).toEqual(a);
  });
  // why: the live run of 2026-11-03: the old child killed at once left the machine unheld while the new one started,
  // and an idle Mac slept in that gap; the two now overlap for AWAKE_OVERLAP_MS
  it('renews without a gap: the old child is killed only AWAKE_OVERLAP_MS after the new one starts', () => {
    const w = world();
    w.keeper.hold(300);
    w.advance(60_000);
    const a = w.keeper.hold(300);
    expect(a.until).toBe(iso(T0 + 360_000));
    expect(w.children).toHaveLength(2);
    expect(w.live()).toHaveLength(2);
    w.advance(AWAKE_OVERLAP_MS - 1);
    expect(w.children[0]?.killed).toBe(false);
    w.advance(1);
    expect(w.children[0]?.killed).toBe(true);
    expect(w.live()).toHaveLength(1);
    // why: the old child's end (its kill) never clears the new one
    w.children[0]?.end({ error: null, code: null });
    expect(w.keeper.state().held).toBe(true);
    expect(AWAKE_OVERLAP_MS).toBe(5000);
  });
  // why: CodeRabbit on PR #41: renewals inside one overlap never stack children; the one still retiring is killed at
  // once (the current one has started by then), so at most two are alive
  it('a renewal during an overlap kills the child still retiring: never more than two alive', () => {
    const w = world();
    for (let i = 0; i < 5; i++) {
      w.keeper.hold(300);
      expect(w.live().length).toBeLessThanOrEqual(2);
      w.advance(1000);
    }
    expect(w.live()).toHaveLength(2);
    w.advance(AWAKE_OVERLAP_MS);
    expect(w.live()).toHaveLength(1);
    expect(w.children.map((c) => c.kills)).toEqual([1, 1, 1, 1, 0]);
  });
  it('a release or shutdown during the overlap kills both children at once', () => {
    for (const end of ['release', 'stop'] as const) {
      const w = world();
      w.keeper.hold(300);
      w.keeper.hold(300);
      expect(w.live()).toHaveLength(2);
      if (end === 'release') w.keeper.release();
      else w.keeper.stop();
      expect(w.live()).toHaveLength(0);
      // why: CodeRabbit on PR #41: the overlap's timer was cancelled, so nothing is killed twice
      w.advance(AWAKE_OVERLAP_MS);
      expect(w.children.map((c) => c.kills)).toEqual([1, 1]);
      // why: the overlap's own timer kills nothing later
      w.keeper.hold(300);
      w.advance(AWAKE_OVERLAP_MS);
      expect(w.live()).toHaveLength(end === 'release' ? 1 : 0);
    }
  });
  it('expires: the child is killed at the lease’s end and nothing is held', () => {
    const w = world();
    w.keeper.hold(300);
    w.advance(299_999);
    expect(w.keeper.state().held).toBe(true);
    w.advance(1);
    expect(w.live()).toHaveLength(0);
    expect(w.keeper.state()).toEqual({ held: false, until: null, mechanism: 'caffeinate' });
  });
  it('a renewal moves the expiry: the earlier lease’s end kills nothing', () => {
    const w = world();
    w.keeper.hold(300);
    w.advance(200_000);
    w.keeper.hold(300);
    w.advance(100_000);
    expect(w.live()).toHaveLength(1);
    w.advance(200_000);
    expect(w.live()).toHaveLength(0);
  });
  it('releases: hold(0) and release() kill the child and say nothing is held', () => {
    const w = world();
    w.keeper.hold(300);
    expect(w.keeper.hold(0)).toEqual({ held: false, until: null, mechanism: 'caffeinate' });
    expect(w.live()).toHaveLength(0);
    w.keeper.hold(300);
    expect(w.keeper.release()).toEqual({ held: false, until: null, mechanism: 'caffeinate' });
    expect(w.live()).toHaveLength(0);
    // why: the released lease's timer kills nothing later
    w.keeper.hold(300);
    w.advance(299_000);
    expect(w.live()).toHaveLength(1);
  });
  it('a release with nothing held is harmless', () => {
    const w = world();
    expect(w.keeper.release()).toEqual({ held: false, until: null, mechanism: 'caffeinate' });
    expect(w.children).toHaveLength(0);
  });
  it('shutdown kills the child, and nothing is held after it, whatever is asked', () => {
    const w = world();
    w.keeper.hold(300);
    w.keeper.stop();
    expect(w.live()).toHaveLength(0);
    expect(w.keeper.hold(300)).toEqual({ held: false, until: null, mechanism: 'caffeinate' });
    expect(w.children).toHaveLength(1);
  });
  it('refuses a lease past the bound by clamping to it, never longer', () => {
    const w = world();
    const a = w.keeper.hold(AWAKE_MAX_SECONDS * 10);
    expect(a.until).toBe(iso(T0 + AWAKE_MAX_SECONDS * 1000));
    expect(w.children[0]?.args.at(-1)).toBe(String(AWAKE_MAX_SECONDS));
  });
});

describe('failures are logged at warn and never thrown', () => {
  it('a spawn that throws: warned once, nothing held, the next renewal tries again', () => {
    const w = world({ spawnThrows: true });
    expect(w.keeper.hold(300)).toEqual({ held: false, until: null, mechanism: 'caffeinate' });
    w.keeper.hold(300);
    const warns = w.log.lines.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.msg).toBe('keep-awake: the machine could not be held awake');
  });
  it('a child that fails (no binary, or refused): warned, nothing held; a later renewal starts a new one', () => {
    const w = world({ platform: 'linux' });
    w.keeper.hold(300);
    w.children[0]?.end({ error: 'ENOENT', code: null });
    // why: Node may report the same failure as an error and then an exit; the one failure is one warning
    w.children[0]?.end({ error: null, code: 1 });
    expect(w.keeper.state()).toEqual({ held: false, until: null, mechanism: 'systemd-inhibit' });
    expect(w.log.lines.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(w.log.lines[0]?.o).toEqual({ mechanism: 'systemd-inhibit', error: 'ENOENT', code: null });
    expect(w.keeper.hold(300).held).toBe(true);
    expect(w.live()).toHaveLength(2);
  });
  it('a child that ends with a failing code is warned; one that ends cleanly is not', () => {
    const w = world();
    w.keeper.hold(300);
    w.children[0]?.end({ error: null, code: 0 });
    expect(w.keeper.state().held).toBe(false);
    w.keeper.hold(300);
    w.children[1]?.end({ error: null, code: 1 });
    expect(w.log.lines.filter((l) => l.level === 'warn')).toHaveLength(1);
  });
  it('a child ending at once, before spawn returns, is never kept as the hold', () => {
    const w = world();
    const deps: AwakeDeps = {
      ...w.deps,
      spawn: (_c, _a, onEnd) => {
        onEnd({ error: 'EACCES', code: null });
        return { kill: () => undefined };
      },
    };
    const k = new AwakeKeeper(deps);
    expect(k.hold(300)).toEqual({ held: false, until: null, mechanism: 'caffeinate' });
  });
  it('Linux without systemd-inhibit: logged once, nothing spawned, nothing held', () => {
    const w = world({ platform: 'linux', onPath: false });
    expect(w.keeper.hold(300)).toEqual({ held: false, until: null, mechanism: 'none' });
    w.keeper.hold(300);
    expect(w.children).toHaveLength(0);
    const lines = w.log.lines.filter((l) => l.msg === 'keep-awake: systemd-inhibit is not available');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('warn');
  });
  it('another platform: a no-op, nothing logged', () => {
    const w = world({ platform: 'win32' });
    expect(w.keeper.hold(300)).toEqual({ held: false, until: null, mechanism: 'none' });
    expect(w.children).toHaveLength(0);
    expect(w.log.lines).toHaveLength(0);
  });
});

describe('the real seams', () => {
  it('findOnPathOf finds a file in a PATH directory, and nothing elsewhere', () => {
    const a = tmpDir();
    const b = join(tmpDir(), 'bin');
    mkdirSync(b);
    writeFileSync(join(b, 'tool'), '', { mode: 0o755 });
    mkdirSync(join(a, 'dir-not-file'));
    const path = ['', a, b].join(delimiter);
    expect(findOnPathOf(path, 'tool')).toBe(join(b, 'tool'));
    expect(findOnPathOf(path, 'absent')).toBeNull();
    expect(findOnPathOf(path, 'dir-not-file')).toBeNull();
    expect(findOnPathOf('', 'tool')).toBeNull();
  });
  it('the production keeper looks systemd-inhibit up on the given PATH, and holds nothing without it', () => {
    const log = memoryLog();
    const k = realAwakeKeeper({ platform: 'linux', pid: 4242, log, path: tmpDir() });
    expect(k.hold(300)).toEqual({ held: false, until: null, mechanism: 'none' });
    expect(log.lines.map((l) => l.msg)).toEqual(['keep-awake: systemd-inhibit is not available']);
    k.stop();
  });
  it('spawnChild reports a clean exit, and a missing binary as its error code', async () => {
    const clean = await new Promise<AwakeEnd>((resolve) => {
      spawnChild(process.execPath, ['-e', ''], resolve);
    });
    expect(clean).toEqual({ error: null, code: 0 });
    const missing = await new Promise<AwakeEnd>((resolve) => {
      spawnChild(join(tmpDir(), 'no-such-binary'), [], resolve);
    });
    expect(missing.error).toBe('ENOENT');
  });
  it('spawnChild’s kill ends the child', async () => {
    const ended = new Promise<AwakeEnd>((resolve) => {
      const c = spawnChild(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], resolve);
      c.kill();
    });
    expect((await ended).error).toBeNull();
  });
});
