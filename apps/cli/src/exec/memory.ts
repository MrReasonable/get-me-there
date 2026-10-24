import { dirname } from 'node:path';
import type { Action, Executor } from '../plan/action.js';
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
        return;
    }
  }
}

/** A recorded child process call. */
export interface RunCall {
  argv: readonly string[];
  cwd: string;
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
    const call: RunCall = { argv, cwd: opts.cwd, stdin: opts.stdin, env: opts.env };
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
  } = {},
): Executor & { log: Action[] } {
  const log: Action[] = [];
  const runner = opts.runner ?? memoryRunner(fs);
  return {
    log,
    async run(a: Action): Promise<void> {
      log.push(a);
      if (opts.fail?.(a, log.length - 1) === true) throw new Error(`injected failure at step ${log.length}`);
      if (a.kind === 'run') {
        const r = await runner(a.argv, {
          cwd: a.cwd,
          timeoutMs: 1000,
          ...(a.stdin === undefined ? {} : { stdin: a.stdin }),
        });
        if (r.code !== 0) throw new Error(`${a.describe} exited with ${r.code}`);
        return;
      }
      if (a.kind === 'waitHealthy' && opts.healthy !== undefined && !opts.healthy(a.url))
        throw new Error(`${a.url} did not answer healthy within ${a.timeoutSeconds} s`);
      fs.applyEffect(a);
    },
  };
}
