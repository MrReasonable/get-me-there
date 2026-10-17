import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquire, breakStale, lockPathFor, realOps, release } from './ensure-build-lib.mjs';

// why: review code-architect M5 — two test files each ran `pnpm --filter @gmt/api... build`, and under the root
// `pnpm test` they run in parallel, so one tsc could rewrite a dist file the other's script was importing. One script
// builds under a lock and skips when no source is newer than the last build; both files call it.
const REPO = join(import.meta.dirname, '..');
const ensure = () =>
  execFileSync(process.execPath, [join(REPO, 'scripts', 'ensure-build.mjs')], {
    cwd: REPO,
    encoding: 'utf8',
    // why: a call can wait 10 min for another suite's build lock and then build cold (CodeRabbit batch 3)
    timeout: 1_200_000,
  }).trim();

describe('scripts/ensure-build.mjs', () => {
  it('builds when needed and then reports the build up to date, without rebuilding', () => {
    ensure();
    expect(ensure()).toBe('build up to date');
  }, 2_400_000);

  it('every caller allows the lock wait plus a cold build: 1,200 s on the call and on its hook or test (CodeRabbit batch 3)', async () => {
    const { WAIT_MS } = await import('./ensure-build-lib.mjs');
    // why: a caller can wait WAIT_MS (10 min) for a live holder and then run a cold build itself
    expect(1_200_000).toBeGreaterThanOrEqual(WAIT_MS + 10 * 60_000);
    for (const f of [
      'scripts/backup.test.mjs',
      'apps/api/test/deploy/backupCli.test.ts',
      'scripts/assert-dist-resolution.test.mjs',
      'scripts/ensure-build.test.mjs',
    ]) {
      const text = readFileSync(join(REPO, f), 'utf8');
      expect(text, f).toMatch(/ensure-build\.mjs'\)\], \{[^}]*timeout: 1_200_000/);
      expect(text, f).not.toMatch(/\b(300|600)_000\b/);
    }
  });

  it('is the only thing the CLI tests use to build', () => {
    for (const f of ['scripts/backup.test.mjs', 'apps/api/test/deploy/backupCli.test.ts']) {
      const text = readFileSync(join(REPO, f), 'utf8');
      expect(text, f).toContain('ensure-build.mjs');
      expect(text, f).not.toMatch(/'@gmt\/api\.\.\.', 'build'/);
    }
  });
});

describe('scripts/ensure-build-lib.mjs (re-review N1, N2)', () => {
  it('N1: retries the acquire when the holder releases the lock between the failed create and the read', async () => {
    const { acquire } = await import('./ensure-build-lib.mjs');
    const calls = [];
    let held = true;
    const enoent = Object.assign(new Error('gone'), { code: 'ENOENT' });
    acquire('/lock', {
      create: () => {
        calls.push('create');
        if (held) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      },
      // the holder releases exactly here: after create failed, before our read looks
      read: () => {
        held = false;
        throw enoent;
      },
      alive: () => true,
      claim: () => true,
      remove: () => undefined,
      sleep: () => undefined,
      now: () => 0,
      token: () => 't',
      pid: 1,
    });
    expect(calls).toEqual(['create', 'create']);
  });

  it('N2: a newer root tsconfig, package.json or lockfile makes the stamp stale', async () => {
    const { needsBuild } = await import('./ensure-build-lib.mjs');
    const { mkdirSync, mkdtempSync, utimesSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const repo = mkdtempSync(join(tmpdir(), 'gmt-eb-'));
    for (const p of ['packages/core', 'packages/db', 'packages/providers', 'packages/engine', 'apps/api']) {
      mkdirSync(join(repo, p, 'dist'), { recursive: true });
      mkdirSync(join(repo, p, 'src'), { recursive: true });
      writeFileSync(join(repo, p, 'src', 'a.ts'), '');
      writeFileSync(join(repo, p, 'package.json'), '{}');
    }
    for (const f of ['tsconfig.base.json', 'package.json', 'pnpm-lock.yaml'])
      writeFileSync(join(repo, f), '');
    const stamp = join(repo, '.stamp');
    writeFileSync(stamp, '');
    const old = new Date(Date.now() - 60_000);
    for (const f of ['tsconfig.base.json', 'package.json', 'pnpm-lock.yaml'])
      utimesSync(join(repo, f), old, old);
    utimesSync(join(repo, 'packages/core/src/a.ts'), old, old);
    for (const p of ['packages/core', 'packages/db', 'packages/providers', 'packages/engine', 'apps/api']) {
      utimesSync(join(repo, p, 'src', 'a.ts'), old, old);
      utimesSync(join(repo, p, 'package.json'), old, old);
    }
    expect(needsBuild(repo, stamp)).toBe(false);
    for (const f of ['tsconfig.base.json', 'package.json', 'pnpm-lock.yaml']) {
      utimesSync(join(repo, f), new Date(), new Date());
      expect(needsBuild(repo, stamp), f).toBe(true);
      utimesSync(join(repo, f), old, old);
    }
  });
});

/** @type {string[]} */
const scratch = [];
afterEach(() => {
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});
function lockIn() {
  const d = mkdtempSync(join(tmpdir(), 'gmt-lock-'));
  scratch.push(d);
  return join(d, 'build.lock');
}
/** The pid of a process that has already exited. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;
const noSleep = {
  ...realOps,
  sleep: () => {
    throw new Error('slept on a lock that should be taken at once');
  },
};
/** Resolves once the child prints that it holds the lock; rejects if it exits first. */
const held = (child) =>
  new Promise((ok, fail) => {
    child.stdout.once('data', ok);
    child.once('exit', (code) => fail(new Error(`the lock holder exited early (${code})`)));
  });
const record = (/** @type {string} */ lock) => JSON.parse(readFileSync(lock, 'utf8'));

// why: CodeRabbit batch 3 — the lock was a bare directory: an interrupted build left it to block every later run
// for 15 minutes, two waiters could both clear the same stale lock and build at once, and the holder's cleanup could
// delete a successor's lock. It now records its owner's pid and a token; a stale lock is taken over through a
// per-token claim, so only one waiter can take it, and a holder releases only its own token.
describe('scripts/ensure-build-lib.mjs build lock ownership (CodeRabbit batch 3)', {
  timeout: 60_000,
}, () => {
  it('records the owner pid and a token, and the owner releases it', () => {
    const lock = lockIn();
    const owned = acquire(lock);
    expect(record(lock)).toEqual({ pid: process.pid, token: owned.token });
    expect(owned.token).toMatch(/^[\w-]{16,}$/);
    expect(release(lock, owned)).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  it('a holder never releases a lock it no longer owns', () => {
    const lock = lockIn();
    const owned = acquire(lock);
    // another process took the lock over (the first holder looked stale)
    rmSync(lock);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'successor-token-0001' }));
    expect(release(lock, owned)).toBe(false);
    expect(record(lock).token).toBe('successor-token-0001');
  });

  it('a lock whose owner process has exited is taken over at once, without waiting', () => {
    const lock = lockIn();
    writeFileSync(lock, JSON.stringify({ pid: deadPid(), token: 'dead-owner-token-01' }));
    const owned = acquire(lock, noSleep);
    expect(record(lock)).toEqual({ pid: process.pid, token: owned.token });
  });

  it('a live, fresh owner is waited for, then the waiter gives up naming the owner', () => {
    const lock = lockIn();
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'live-owner-token-01' }));
    let t = Date.now();
    let slept = 0;
    const ops = {
      ...realOps,
      now: () => t,
      sleep: () => {
        slept++;
        t += 60_000;
      },
    };
    expect(() => acquire(lock, ops)).toThrow(
      `ensure-build: gave up waiting for ${lock}, held by pid ${process.pid}`,
    );
    expect(slept).toBeGreaterThan(0);
    expect(record(lock).token).toBe('live-owner-token-01');
  });

  it('two waiters that saw the same stale record: only the first takes it, the second leaves the new lock alone', () => {
    const lock = lockIn();
    writeFileSync(lock, JSON.stringify({ pid: deadPid(), token: 'stale-owner-token-1' }));
    const seenByB = realOps.read(lock);
    const a = acquire(lock, noSleep);
    // B acts on what it read before A's takeover; the claim is per inspected owner, so it removes nothing
    expect(breakStale(lock, seenByB)).toBe(false);
    expect(record(lock).token).toBe(a.token);
  });

  it('a waiter whose claim on the stale record is held by another waiter does not remove the lock', () => {
    const lock = lockIn();
    writeFileSync(lock, JSON.stringify({ pid: deadPid(), token: 'stale-owner-token-2' }));
    const seen = realOps.read(lock);
    writeFileSync(`${lock}.break-${seen.key}`, '1');
    expect(breakStale(lock, seen)).toBe(false);
    expect(record(lock).token).toBe('stale-owner-token-2');
  });

  it('a lock without owner metadata (an older directory lock) is stale only by age', () => {
    const lock = lockIn();
    mkdirSync(lock);
    let t = Date.now();
    const sleeps = [];
    const ops = {
      ...realOps,
      now: () => t,
      sleep: (ms) => {
        sleeps.push(ms);
        t += 16 * 60_000;
      },
    };
    const owned = acquire(lock, ops);
    expect(sleeps.length).toBe(1); // fresh at first, so waited; past 15 minutes, taken over
    expect(record(lock).token).toBe(owned.token);
  });

  it('a build interrupted by SIGINT, SIGTERM or SIGHUP releases the lock before it exits', async () => {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const lock = lockIn();
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          [
            `import { acquire, releaseOnSignal } from ${JSON.stringify(join(import.meta.dirname, 'ensure-build-lib.mjs'))};`,
            `const owned = acquire(${JSON.stringify(lock)});`,
            `releaseOnSignal(${JSON.stringify(lock)}, owned);`,
            "console.log('held');",
            'setInterval(() => {}, 1000);',
          ].join('\n'),
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      await held(child);
      expect(existsSync(lock), sig).toBe(true);
      const exited = new Promise((ok) => child.once('exit', (code, signal) => ok({ code, signal })));
      child.kill(sig);
      expect(await exited, sig).toMatchObject({ code: 128 + { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[sig] });
      expect(existsSync(lock), sig).toBe(false);
    }
  });

  it('a build killed outright (SIGKILL) leaves a lock the next run takes at once', async () => {
    const lock = lockIn();
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          `import { acquire } from ${JSON.stringify(join(import.meta.dirname, 'ensure-build-lib.mjs'))};`,
          `acquire(${JSON.stringify(lock)});`,
          "console.log('held');",
          'setInterval(() => {}, 1000);',
        ].join('\n'),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    await held(child);
    const exited = new Promise((ok) => child.once('exit', ok));
    child.kill('SIGKILL');
    await exited;
    expect(existsSync(lock)).toBe(true);
    const owned = acquire(lock, noSleep);
    expect(record(lock).token).toBe(owned.token);
  });
});

describe('scripts/ensure-build-lib.mjs lock path (CodeRabbit batch 3)', () => {
  it('is keyed by a hash of the whole checkout path, so checkouts that end alike never share a lock', () => {
    const a = lockPathFor('/home/a/get-me-there', '/tmp');
    const b = lockPathFor('/home/a/other/get-me-there', '/tmp');
    expect(a).not.toBe(b);
    expect(lockPathFor('/home/a/get-me-there', '/tmp')).toBe(a);
    expect(a).toMatch(/^\/tmp\/gmt-build-[0-9a-f]{24}\.lock$/);
  });

  it('is what ensure-build.mjs uses', () => {
    const text = readFileSync(join(REPO, 'scripts', 'ensure-build.mjs'), 'utf8');
    expect(text).toContain('const LOCK = lockPathFor(REPO);');
  });
});
