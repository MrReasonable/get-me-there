import type { Ask } from '../../src/ask.js';
import type { Deps, Http, HttpRequest, Io } from '../../src/deps.js';
import { MemoryFs, memoryExecutor, memoryRunner, type RunHandler } from '../../src/exec/memory.js';
import { currentPlatform } from '../../src/platform/current.js';

/** A scripted Ask: answers are taken in order; every question asked is recorded. Running out of answers fails. */
export function scriptedAsk(
  answers: Array<string | boolean>,
): Ask & { asked: string[]; defaults: Array<{ q: string; def: boolean }> } {
  const asked: string[] = [];
  // why: ts-b1-002: each confirm's offered default, so a test can pin it
  const defaults: Array<{ q: string; def: boolean }> = [];
  const next = (q: string): string | boolean => {
    asked.push(q);
    if (answers.length === 0) throw new Error(`no scripted answer for: ${q}`);
    const a = answers.shift();
    if (a === undefined) throw new Error('unreachable');
    return a;
  };
  return {
    asked,
    defaults,
    text: async (q, def) => {
      const a = next(q);
      if (typeof a !== 'string') throw new Error(`expected text for: ${q}`);
      return a === '' && def !== null ? def : a;
    },
    secret: async (q) => {
      const a = next(q);
      if (typeof a !== 'string') throw new Error(`expected a secret for: ${q}`);
      return a;
    },
    confirm: async (q, def) => {
      defaults.push({ q, def });
      const a = next(q);
      return a === '' ? def : a === true || a === 'y';
    },
    typed: async (q, word) => next(q) === word,
  };
}

export interface TestIo extends Io {
  stdout: string;
  stderr: string;
}
export function testIo(opts: { tty?: boolean; stdin?: string } = {}): TestIo {
  const io: TestIo = {
    stdout: '',
    stderr: '',
    out: (t) => {
      io.stdout += t;
    },
    err: (t) => {
      io.stderr += t;
    },
    stdoutIsTTY: opts.tty ?? false,
    stdinIsTTY: opts.tty ?? false,
    readStdin: async () => opts.stdin ?? '',
  };
  return io;
}

/** An Http stand-in answering from a route table keyed "METHOD path"; every request is recorded. */
export function stubHttp(
  routes: Record<string, (r: HttpRequest) => { status: number; body: unknown } | { error: string }>,
): Http & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  const http: Http = async (r) => {
    requests.push(r);
    const route = routes[`${r.method} ${new URL(r.url).pathname}`];
    if (route === undefined) return { error: `no stub for ${r.method} ${r.url}` };
    const a = route(r);
    return 'error' in a
      ? a
      : { status: a.status, body: typeof a.body === 'string' ? a.body : JSON.stringify(a.body) };
  };
  return Object.assign(http, { requests });
}

export interface TestWorld {
  deps: Deps;
  fs: MemoryFs;
  io: TestIo;
  runner: ReturnType<typeof memoryRunner>;
  executor: ReturnType<typeof memoryExecutor>;
}

/** A machine in memory: a home, a checkout, a memory tree, runner and executor, and the given overrides. */
export function testWorld(
  opts: {
    os?: 'darwin' | 'linux' | 'win32';
    env?: Record<string, string>;
    ask?: Ask;
    io?: TestIo;
    run?: RunHandler;
    http?: Http;
    fs?: MemoryFs;
    deps?: Partial<Deps>;
  } = {},
): TestWorld {
  const os = opts.os ?? 'darwin';
  const home = os === 'darwin' ? '/Users/op' : os === 'linux' ? '/home/op' : 'C:\\Users\\op';
  const fs = opts.fs ?? new MemoryFs(501);
  const runner = memoryRunner(fs, opts.run);
  const executor = memoryExecutor(fs, { runner });
  const io = opts.io ?? testIo();
  const env: Record<string, string> = { HOME: home, PATH: '/usr/bin:/bin', ...opts.env };
  const deps: Deps = {
    platform: currentPlatform({ platform: os, arch: 'arm64', uid: 501, env }),
    files: fs,
    run: runner,
    executor,
    ask: opts.ask ?? scriptedAsk([]),
    io,
    http: opts.http ?? stubHttp({}),
    now: () => new Date('2026-10-24T09:30:00.000Z'),
    sleep: async () => {},
    checkout: '/repo',
    execPath: '/opt/node/bin/node',
    nodeVersion: '22.18.0',
    username: 'op',
    home: env.HOME ?? '',
    invocationCwd: '/work',
    secretEnv: (name) => env[name],
    childEnv: { PATH: env.PATH ?? '', HOME: env.HOME ?? '' },
    machineTimeZone: 'Europe/London',
    tmpDir: '/private/var/folders/x/T',
    portFree: async () => true,
    randomBytes: (n) => Buffer.alloc(n, 7),
    attach: async () => 0,
    ...opts.deps,
  };
  return { deps, fs, io, runner, executor };
}
