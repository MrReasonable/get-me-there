import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import {
  AWAKE_MAX_SECONDS,
  type AwakeAnswer,
  type AwakeMechanism,
  isoDateTimeOfEpochMs,
  type Logger,
} from '@gmt/core';

/**
 * The keep-awake lease on the worker's side (spec §2 "The keep-awake lease"). The worker holds the machine's idle sleep
 * off only while it holds a live lease: `hold(seconds)` starts or renews one, `release()` (or `hold(0)`) ends it, and
 * the lease's end kills the hold by itself, so an app that dies or is suspended stops renewing and the machine may
 * sleep again within the lease. The hold is one child process at a time, bounded by the lease twice over: its own
 * time limit is the lease (caffeinate's `-t`, systemd-inhibit's `sleep`), and the worker kills it at the lease's end,
 * on release and at shutdown; on macOS `-w <pid>` also ends it with the worker. A renewal starts the new child before
 * the old one is killed, so there is no gap. A hold cannot stop a sleep the operator asks for (closing a laptop's lid).
 * A failure to hold is logged at warn, never thrown: it never fails a page or a request.
 */

/** How one child ended: Node's error code when it could not run (`ENOENT`), else its exit code (null when killed). */
export interface AwakeEnd {
  error: string | null;
  code: number | null;
}

export interface AwakeChild {
  kill(): void;
}

export interface AwakeDeps {
  /** process.platform, injected so every platform's choice is tested on any OS. */
  platform: string;
  /** The worker's own pid: caffeinate's `-w`. */
  pid: number;
  log: Logger;
  /** Epoch milliseconds. */
  now(): number;
  /** Runs `fn` after `ms`; returns its cancel. */
  later(fn: () => void, ms: number): () => void;
  /** Starts `command` with `args` (no shell), calling `onEnd` when it ends or cannot start. */
  spawn(command: string, args: readonly string[], onEnd: (end: AwakeEnd) => void): AwakeChild;
  /** The full path of an executable named `name` on the worker's PATH, or null when there is none. */
  findOnPath(name: string): string | null;
}

/** The platform's hold for `seconds`, or null when this machine has none (Linux without systemd-inhibit, any other OS). */
export function awakeCommand(
  platform: string,
  pid: number,
  seconds: number,
  findOnPath: (name: string) => string | null,
): { mechanism: Exclude<AwakeMechanism, 'none'>; command: string; args: string[] } | null {
  if (platform === 'darwin')
    // why: -i holds idle sleep only (the display may still sleep); -w ends it with the worker; -t ends it with the lease
    return {
      mechanism: 'caffeinate',
      command: '/usr/bin/caffeinate',
      args: ['-i', '-w', String(pid), '-t', String(seconds)],
    };
  const inhibit = platform === 'linux' ? findOnPath('systemd-inhibit') : null;
  if (inhibit !== null)
    return {
      mechanism: 'systemd-inhibit',
      command: inhibit,
      args: [
        '--what=idle:sleep',
        '--who=get-me-there',
        '--why=a search is running',
        '--mode=block',
        'sleep',
        String(seconds),
      ],
    };
  return null;
}

/** One child and what became of it; `ended` once it ended or was killed (Node may report one end twice). */
/**
 * How long a renewal's old child keeps holding after the new one starts. A child holds only once it has started and
 * made its assertion, so killing the old one at once left the machine unheld for that moment, and an idle Mac slept in
 * it (the live run of 2026-11-03).
 */
export const AWAKE_OVERLAP_MS = 5000;

interface Held {
  child: AwakeChild | null;
  ended: boolean;
}

export class AwakeKeeper {
  private current: Held | null = null;
  /** Children a renewal replaced, still holding through the overlap; each with its kill's cancel. */
  private readonly retiring = new Map<Held, () => void>();
  private until: number | null = null;
  private cancelExpiry: (() => void) | null = null;
  /** One warning per lease, so a hold that keeps failing does not warn at every renewal. */
  private warned = false;
  private unavailableLogged = false;
  private stopped = false;
  private readonly mechanism: AwakeMechanism;

  constructor(private readonly d: AwakeDeps) {
    this.mechanism = awakeCommand(d.platform, d.pid, 1, d.findOnPath)?.mechanism ?? 'none';
  }

  /** What is held now: `until` is the lease's end while a child holds it. */
  state(): AwakeAnswer {
    const live = this.current !== null && this.until !== null && this.d.now() < this.until;
    return live && this.until !== null
      ? { held: true, until: isoDateTimeOfEpochMs(this.until), mechanism: this.mechanism }
      : { held: false, until: null, mechanism: this.mechanism };
  }

  /** Starts or renews a lease of `seconds` from now (at most AWAKE_MAX_SECONDS); 0 releases it. */
  hold(seconds: number): AwakeAnswer {
    if (seconds <= 0) return this.release();
    if (this.stopped) return this.state();
    const s = Math.min(Math.floor(seconds), AWAKE_MAX_SECONDS);
    const cmd = awakeCommand(this.d.platform, this.d.pid, s, this.d.findOnPath);
    if (cmd === null) {
      // why: Linux without systemd-inhibit says so once; any other platform has nothing to say
      if (this.d.platform === 'linux' && !this.unavailableLogged) {
        this.unavailableLogged = true;
        this.d.log.warn({}, 'keep-awake: systemd-inhibit is not available');
      }
      return this.state();
    }
    const held: Held = { child: null, ended: false };
    try {
      held.child = this.d.spawn(cmd.command, cmd.args, (end) => this.ended(held, end));
    } catch (e) {
      this.failed({ mechanism: cmd.mechanism, error: e instanceof Error ? e.name : 'unknown', code: null });
      return this.state();
    }
    // why: a child that ended before spawn returned is no hold
    if (held.ended) return this.state();
    // why: the old child keeps holding AWAKE_OVERLAP_MS after the new one starts, so a renewal leaves no gap; one still
    // retiring from an earlier renewal is killed now (the old one has started by then), so at most two are alive
    // (CodeRabbit on PR #41)
    this.retireNow();
    const old = this.current;
    this.current = held;
    if (old !== null)
      this.retiring.set(
        old,
        this.d.later(() => {
          this.retiring.delete(old);
          this.kill(old);
        }, AWAKE_OVERLAP_MS),
      );
    this.until = this.d.now() + s * 1000;
    this.cancelExpiry?.();
    this.cancelExpiry = this.d.later(() => this.end(), s * 1000);
    return this.state();
  }

  /** Ends the lease: the child is killed and nothing is held. */
  release(): AwakeAnswer {
    this.end();
    return this.state();
  }

  /** Worker shutdown: the lease ends and no later request holds anything. */
  stop(): void {
    this.stopped = true;
    this.end();
  }

  private end(): void {
    this.cancelExpiry?.();
    this.cancelExpiry = null;
    this.retireNow();
    if (this.current !== null) this.kill(this.current);
    this.current = null;
    this.until = null;
    this.warned = false;
  }

  /** Kills every child a renewal replaced, cancelling its overlap timer. */
  private retireNow(): void {
    for (const [h, cancel] of this.retiring) {
      cancel();
      this.kill(h);
    }
    this.retiring.clear();
  }

  private kill(h: Held): void {
    h.ended = true;
    h.child?.kill();
  }

  private ended(h: Held, end: AwakeEnd): void {
    if (h.ended) return;
    h.ended = true;
    if (this.current === h) this.current = null;
    if (end.error !== null || (end.code !== null && end.code !== 0))
      this.failed({ mechanism: this.mechanism, error: end.error, code: end.code });
  }

  private failed(o: { mechanism: AwakeMechanism; error: string | null; code: number | null }): void {
    if (this.warned) return;
    this.warned = true;
    this.d.log.warn(o, 'keep-awake: the machine could not be held awake');
  }
}

/** The first executable file named `name` in `path`'s directories, or null. */
export function findOnPathOf(path: string, name: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue;
    const f = join(dir, name);
    try {
      accessSync(f, constants.X_OK);
      if (statSync(f).isFile()) return f;
    } catch {
      // why: not here; the next directory may hold it
    }
  }
  return null;
}

/** The real spawn: no shell, no output kept, never keeping the worker's event loop alive. */
export function spawnChild(
  command: string,
  args: readonly string[],
  onEnd: (end: AwakeEnd) => void,
): AwakeChild {
  const child = spawn(command, args, { stdio: 'ignore' });
  child.once('error', (e: NodeJS.ErrnoException) => onEnd({ error: e.code ?? e.name, code: null }));
  child.once('exit', (code) => onEnd({ error: null, code }));
  child.unref();
  return {
    kill: () => {
      child.kill('SIGTERM');
    },
  };
}

/** The production keeper: the real spawn, PATH lookup and timers (unreferenced, so they never hold the worker open). */
export function realAwakeKeeper(o: {
  platform: string;
  pid: number;
  log: Logger;
  path: string;
}): AwakeKeeper {
  return new AwakeKeeper({
    platform: o.platform,
    pid: o.pid,
    log: o.log,
    now: () => Date.now(),
    later: (fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref();
      return () => clearTimeout(t);
    },
    spawn: spawnChild,
    findOnPath: (name) => findOnPathOf(o.path, name),
  });
}
