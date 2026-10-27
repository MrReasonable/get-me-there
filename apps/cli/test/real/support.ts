import { copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Deps } from '../../src/deps.js';
import { systemFiles } from '../../src/exec/files.js';
import { type Runner, systemRunner } from '../../src/exec/runner.js';
import { systemExecutor } from '../../src/exec/system.js';
import type { Action, Executor } from '../../src/plan/action.js';
import { currentPlatform } from '../../src/platform/current.js';
import { scriptedAsk, stubHttp, type TestIo, testIo } from '../support/deps.js';
import { tempDir } from '../support/tempdirs.js';

/**
 * The repository root, found upwards: why: the mutation run (U10) runs these tests from a Stryker sandbox copy nested
 * under the package, where a fixed `../../../..` is not the root.
 */
function repoRoot(): string {
  for (let d = import.meta.dirname; d !== dirname(d); d = dirname(d))
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
  throw new Error('no pnpm-workspace.yaml above the cli tests');
}
export const REPO = repoRoot();

/**
 * ts-b1-012: the suite runs the built scripts (backup.mjs, check-backup.mjs, lock-state.mjs) but never builds: the
 * package's test script and CI build first (scripts/ensure-build.mjs). Missing output is a clear refusal.
 */
export function requireBuilt(): void {
  for (const f of ['apps/api/dist/tools/types.js', 'packages/db/dist/index.js'])
    if (!existsSync(join(REPO, f)))
      throw new Error(
        `${f} is missing: build first (node scripts/ensure-build.mjs, or pnpm --filter @gmt/cli test)`,
      );
}
const req = createRequire(join(REPO, 'packages', 'db', 'package.json'));
/** The few better-sqlite3 calls these tests make (its types are @gmt/db's, not this package's). */
interface SqliteDb {
  pragma(source: string, opts?: { simple: boolean }): unknown;
  exec(source: string): void;
  prepare(source: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown };
  close(): void;
}
type SqliteOpen = new (path: string, opts?: { readonly?: boolean; fileMustExist?: boolean }) => SqliteDb;
export const Database: SqliteOpen = req('better-sqlite3');

/** A WAL database with `rows` executions; with `inWal`, the writer stays open so the last rows live only in -wal. */
export function sampleDb(path: string, rows: number, inWal = 0) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  db.exec('CREATE TABLE search_executions (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO search_executions (name) VALUES (?)');
  for (let i = 0; i < rows - inWal; i++) ins.run(`run ${i}`);
  db.pragma('wal_checkpoint(TRUNCATE)');
  for (let i = rows - inWal; i < rows; i++) ins.run(`run ${i}`);
  return db;
}
/**
 * Checks a database and counts its executions, on a copy (opening a WAL database creates its -wal and -shm, which the
 * tests assert are absent); null when it does not exist.
 */
export function inspect(path: string): { rows: number; ok: string } | null {
  if (!existsSync(path)) return null;
  const dir = tempDir('gmt-inspect-');
  try {
    copyFileSync(path, join(dir, 'copy.db'));
    const db = new Database(join(dir, 'copy.db'));
    try {
      const ok = String(db.pragma('integrity_check', { simple: true }));
      const row = db.prepare('SELECT COUNT(*) AS n FROM search_executions').get();
      const n =
        typeof row === 'object' && row !== null && 'n' in row && typeof row.n === 'number' ? row.n : -1;
      return { rows: n, ok };
    } finally {
      db.close();
    }
  } catch {
    return { rows: -1, ok: 'unreadable' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A runner for real-data tests: the node scripts of the repository (backup, check-backup, lock-state) run for real;
 * every service manager, package manager, git and docker command is answered here and never run. `docker` is the
 * optional stand-in over a temporary "volume" directory.
 */
export function realRunner(opts: { volume?: string; log?: string[] } = {}): Runner {
  return async (argv, o) => {
    opts.log?.push(argv.join(' '));
    const [cmd, a1] = argv;
    if (cmd === process.execPath) return systemRunner(argv, o);
    if (cmd === 'docker' && opts.volume !== undefined) {
      const v = opts.volume;
      if (a1 === '--version' || a1 === 'info' || a1 === 'volume') return { code: 0, stdout: '', stderr: '' };
      const sub = argv.slice(4);
      if (sub[0] === 'ps') return { code: 0, stdout: '{"Service":"app","State":"exited"}\n', stderr: '' };
      if (sub[0] === 'run' && sub.includes('scripts/backup.mjs')) {
        const r = await systemRunner(
          [
            process.execPath,
            join(REPO, 'scripts', 'backup.mjs'),
            '--db',
            join(v, 'get-me-there.db'),
            '--dir',
            join(v, 'backups'),
          ],
          o,
        );
        if (r.code !== 0) return r;
        const host = JSON.parse(r.stdout).file;
        return {
          code: 0,
          stdout: `${JSON.stringify({ ok: true, file: `/data/backups/${host.split('/').pop()}` })}\n`,
          stderr: '',
        };
      }
      if (sub[0] === 'cp') {
        copyFileSync(join(v, String(sub[1]).replace(/^app:\/data\//, '')), String(sub[2]));
        return { code: 0, stdout: '', stderr: '' };
      }
      if (sub[0] === 'run' && sub.includes('sh')) {
        writeFileSync(join(v, 'MOVED-TO-NATIVE'), o.stdin ?? '');
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'docker') return { code: 127, stdout: '', stderr: '' };
    if (cmd === 'launchctl' && a1 === 'print')
      return { code: String(argv[2]).split('/').length > 2 ? 113 : 0, stdout: '', stderr: '' };
    if (cmd === 'git' && a1 === 'symbolic-ref') return { code: 0, stdout: 'main\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
}

/** Throws before or after the action numbered `at` among the data actions (copy, rename, remove, run, writeFile). */
export function interrupting(
  inner: Executor,
  at: number,
  when: 'before' | 'after' | 'partial-copy',
): Executor & { hit: boolean } {
  let n = -1;
  const state = { hit: false };
  return Object.assign(state, {
    async run(a: Action) {
      if (a.kind === 'waitHealthy') return { stdout: '' };
      const data = ['copy', 'rename', 'remove', 'run', 'writeFile'].includes(a.kind);
      if (data) n++;
      if (data && n === at && when === 'before') {
        state.hit = true;
        throw new Error('interrupted before');
      }
      if (data && n === at && when === 'partial-copy' && a.kind === 'copy') {
        state.hit = true;
        writeFileSync(`${a.to}`, 'partial');
        throw new Error('interrupted mid-copy');
      }
      const out = await inner.run(a);
      if (data && n === at && when === 'after') {
        state.hit = true;
        throw new Error('interrupted after');
      }
      return out;
    },
  });
}

/** Deps over a temporary HOME with the real files, executor and node scripts. */
export function realDeps(
  opts: {
    home?: string;
    io?: TestIo;
    executor?: (e: Executor) => Executor;
    volume?: string;
    log?: string[];
  } = {},
): {
  deps: Deps;
  home: string;
  io: TestIo;
} {
  const home = opts.home ?? tempDir('gmt-real-');
  const run = realRunner({
    ...(opts.volume ? { volume: opts.volume } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  });
  const base = systemExecutor(run, { sleep: async () => {} });
  const io = opts.io ?? testIo();
  const os = process.platform === 'linux' ? 'linux' : 'darwin';
  const env = { HOME: home };
  return {
    home,
    io,
    deps: {
      platform: currentPlatform({ platform: os, arch: process.arch, uid: process.getuid?.() ?? 0, env }),
      files: systemFiles,
      run,
      executor: (opts.executor ?? ((e) => e))({
        run: (a) => (a.kind === 'waitHealthy' ? Promise.resolve({ stdout: '' }) : base.run(a)),
      }),
      ask: scriptedAsk([]),
      io,
      http: stubHttp({}),
      now: () => new Date('2026-10-24T09:30:00.000Z'),
      sleep: async () => {},
      checkout: REPO,
      execPath: process.execPath,
      nodeVersion: process.versions.node,
      username: 'op',
      home,
      invocationCwd: home,
      secretEnv: () => undefined,
      childEnv: { PATH: '/usr/bin:/bin', HOME: home },
      machineTimeZone: 'Europe/London',
      tmpDir: '/nonexistent-tmp',
      portFree: async () => true,
      randomBytes: (n) => Buffer.alloc(n, 5),
      attach: async () => 0,
      onInterrupt: () => () => undefined,
    },
  };
}
