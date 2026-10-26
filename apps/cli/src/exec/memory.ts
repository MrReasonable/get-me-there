import { dirname } from 'node:path/posix';
import type { Action, Executor } from '../plan/action.js';
import { notAnswering } from '../worker/answer.js';
import { liveHolder, stillHeld } from '../worker/lock.js';
import { refusalOfText } from '../worker/refusal.js';
import type { Files } from './files.js';
import type { Runner } from './runner.js';

type Entry =
  | { kind: 'file'; contents: string; mode: number; owner: number }
  | { kind: 'dir'; mode: number; owner: number }
  | { kind: 'symlink'; target: string };

/**
 * An in-memory file tree for planner and command tests (spec §9 item 9): the `Files` a planner reads and the state
 * `memoryExecutor` changes, so a planner re-run after some actions took effect sees exactly what they did.
 */
export class MemoryFs implements Files {
  private readonly entries = new Map<string, Entry>();
  private readonly locked = new Set<string>();
  constructor(readonly uid = 501) {}

  file(path: string, contents: string, mode = 0o644): this {
    this.mkdirp(dirname(path));
    this.entries.set(path, { kind: 'file', contents, mode, owner: this.uid });
    return this;
  }
  dir(path: string, mode = 0o755): this {
    this.mkdirp(dirname(path));
    this.entries.set(path, { kind: 'dir', mode, owner: this.uid });
    return this;
  }
  symlink(path: string, target: string): this {
    this.mkdirp(dirname(path));
    this.entries.set(path, { kind: 'symlink', target });
    return this;
  }
  /** Makes reading the file fail as an unreadable one does (EACCES). */
  unreadable(path: string): this {
    this.locked.add(path);
    return this;
  }
  chown(path: string, owner: number): this {
    const e = this.entries.get(path);
    if (e !== undefined && e.kind !== 'symlink') this.entries.set(path, { ...e, owner });
    return this;
  }
  delete(path: string, recursive = true): void {
    for (const p of [...this.entries.keys()])
      if (p === path || (recursive && p.startsWith(`${path}/`))) this.entries.delete(p);
  }
  paths(): string[] {
    return [...this.entries.keys()].sort();
  }
  private mkdirp(path: string): void {
    if (path === '/' || path === '.' || this.entries.has(path)) return;
    this.mkdirp(dirname(path));
    this.entries.set(path, { kind: 'dir', mode: 0o755, owner: this.uid });
  }
  private resolved(path: string, depth = 0): Entry | undefined {
    const e = this.entries.get(path);
    return e?.kind === 'symlink' && depth < 8 ? this.resolved(e.target, depth + 1) : e;
  }

  read(path: string): string | null {
    if (this.locked.has(path))
      throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: 'EACCES' });
    const e = this.resolved(path);
    return e?.kind === 'file' ? e.contents : null;
  }
  mode(path: string): number | null {
    const e = this.resolved(path);
    return e === undefined || e.kind === 'symlink' ? null : e.mode;
  }
  owner(path: string): number | null {
    const e = this.resolved(path);
    return e === undefined || e.kind === 'symlink' ? null : e.owner;
  }
  size(path: string): number | null {
    const e = this.resolved(path);
    return e?.kind === 'file' ? Buffer.byteLength(e.contents) : null;
  }
  isDir(path: string): boolean {
    return this.resolved(path)?.kind === 'dir';
  }
  realpath(path: string): string | null {
    let p = path;
    for (let i = 0; i < 8; i++) {
      const e = this.entries.get(p);
      if (e === undefined) return null;
      if (e.kind !== 'symlink') return p;
      p = e.target;
    }
    return null;
  }
  isSymlink(path: string): boolean {
    return this.entries.get(path)?.kind === 'symlink';
  }
  writable(path: string): boolean {
    const e = this.resolved(path);
    return e !== undefined && e.kind !== 'symlink' && e.owner === this.uid && (e.mode & 0o200) !== 0;
  }
  list(dir: string): string[] | null {
    if (!this.isDir(dir)) return null;
    const prefix = `${dir}/`;
    return [...this.entries.keys()]
      .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map((p) => p.slice(prefix.length))
      .sort();
  }

  /** Applies one action's effect on files; `run` and `waitHealthy` change nothing here. */
  applyEffect(a: Action): void {
    switch (a.kind) {
      case 'mkdir':
        this.mkdirp(dirname(a.path));
        this.entries.set(a.path, { kind: 'dir', mode: a.mode, owner: this.uid });
        return;
      case 'writeFile':
        this.file(a.path, a.contents, a.mode);
        return;
      case 'download':
        this.file(a.to, `downloaded ${a.url}`, 0o600);
        return;
      case 'unpack':
        this.dir(a.to, 0o755);
        return;
      case 'rename': {
        const e = this.entries.get(a.from);
        if (e === undefined) throw new Error(`rename: ${a.from} does not exist`);
        const moved = [...this.entries].filter(([p]) => p === a.from || p.startsWith(`${a.from}/`));
        this.delete(a.to);
        for (const [p] of moved) this.entries.delete(p);
        this.mkdirp(dirname(a.to));
        for (const [p, v] of moved) this.entries.set(a.to + p.slice(a.from.length), v);
        return;
      }
      case 'copy': {
        const text = this.read(a.from);
        if (text === null) throw new Error(`copy: ${a.from} is not a file`);
        this.file(a.to, text, a.mode);
        return;
      }
      case 'remove':
        this.delete(a.path, a.recursive);
        return;
      case 'run':
      case 'waitHealthy':
      case 'waitGone':
      case 'waitState':
      case 'waitUnlocked':
      case 'waitWorkerAnswers':
        return;
    }
  }
}

/** A recorded child process call. */
export interface RunCall {
  argv: readonly string[];
  cwd: string;
  timeoutMs: number;
  stdin: string | undefined;
  env: Readonly<Record<string, string>> | undefined;
}
export type RunHandler = (
  argv: readonly string[],
  call: RunCall,
) => { code: number; stdout?: string; stderr?: string } | undefined;

/**
 * A `Runner` over a `MemoryFs`: `cat <path>` answers from the tree (how service managers read their files); every other
 * argv goes to `handler`, which answers by returning a result (default exit 0, empty output). Every call is recorded.
 */
export function memoryRunner(
  fs: MemoryFs,
  handler: RunHandler = () => undefined,
): Runner & { calls: RunCall[] } {
  const calls: RunCall[] = [];
  const runner: Runner = async (argv, opts) => {
    const call: RunCall = {
      argv,
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      stdin: opts.stdin,
      env: opts.env,
    };
    calls.push(call);
    const answered = handler(argv, call);
    if (answered !== undefined)
      return { code: answered.code, stdout: answered.stdout ?? '', stderr: answered.stderr ?? '' };
    if (argv[0] === 'cat' && argv.length === 2 && argv[1] !== undefined) {
      const text = fs.read(argv[1]);
      return text === null
        ? { code: 1, stdout: '', stderr: `cat: ${argv[1]}: No such file or directory` }
        : { code: 0, stdout: text, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return Object.assign(runner, { calls });
}

/**
 * The in-memory executor: applies each action's file effect to `fs`, sends `run` actions to `runner` (a non-zero exit
 * throws, as the system executor's does) and records every action it was given in `log`, in order. `fail` makes the
 * named action throw before it takes effect, for stop-at-first-failure tests.
 */
export function memoryExecutor(
  fs: MemoryFs,
  opts: {
    runner?: Runner;
    fail?: (a: Action, index: number) => boolean;
    healthy?: (url: string) => boolean;
    /** Whether a pid is a live process, for `waitUnlocked`; none is by default. */
    alive?: (pid: number) => boolean;
    /** Whether the worker answers on a port when asked, for `waitWorkerAnswers`; it does at once by default. */
    answers?: (port: number) => boolean;
  } = {},
): Executor & { log: Action[] } {
  const log: Action[] = [];
  const runner = opts.runner ?? memoryRunner(fs);
  const alive = opts.alive ?? (() => false);
  const answers = opts.answers ?? (() => true);
  return {
    log,
    async run(a: Action): Promise<{ stdout: string }> {
      log.push(a);
      if (opts.fail?.(a, log.length - 1) === true) throw new Error(`injected failure at step ${log.length}`);
      if (a.kind === 'run') {
        const r = await runner(a.argv, {
          cwd: a.cwd,
          timeoutMs: 1000,
          ...(a.stdin === undefined ? {} : { stdin: a.stdin.text }),
          ...(a.env === undefined ? {} : { env: a.env }),
        });
        if (r.code !== 0) throw new Error(`${a.describe} exited with ${r.code}`);
        return { stdout: r.stdout };
      }
      if (a.kind === 'waitGone') {
        for (let i = 0; i < 10; i++)
          if ((await runner(a.argv, { cwd: '/', timeoutMs: 1000 })).code !== 0) return { stdout: '' };
        throw new Error(`${a.describe} still answers after ${a.timeoutSeconds} s`);
      }
      // why: one check a simulated second, as the system executor's, so a bound of n seconds is n + 1 checks
      if (a.kind === 'waitState') {
        for (let i = 0; i <= a.timeoutSeconds; i++) {
          const r = await runner(a.argv, { cwd: '/', timeoutMs: 1000 });
          if (r.code === 0 && a.until.includes(r.stdout.trim())) return { stdout: '' };
        }
        throw new Error(`${a.describe} still prints something else after ${a.timeoutSeconds} s`);
      }
      if (a.kind === 'waitUnlocked') {
        let pid: number | null = null;
        for (let i = 0; i <= a.timeoutSeconds; i++) {
          pid = liveHolder(fs.read(a.path), alive);
          if (pid === null) return { stdout: '' };
        }
        throw new Error(stillHeld(a, pid ?? 0));
      }
      // why: one ask a simulated second, as the system executor's, so a bound of n seconds is n + 1 asks
      if (a.kind === 'waitWorkerAnswers') {
        for (let i = 0; i <= a.timeoutSeconds; i++) if (answers(a.port)) return { stdout: '' };
        let refusal: ReturnType<typeof refusalOfText>;
        try {
          refusal = refusalOfText(fs.read(a.refusalFile));
        } catch {
          refusal = 'unreadable';
        }
        throw new Error(notAnswering(a, refusal));
      }
      if (a.kind === 'waitHealthy' && opts.healthy !== undefined && !opts.healthy(a.url))
        throw new Error(`${a.url} did not answer healthy within ${a.timeoutSeconds} s`);
      fs.applyEffect(a);
      return { stdout: '' };
    },
  };
}
