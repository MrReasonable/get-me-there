import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// why: review code-architect M5 — two test files each ran `pnpm --filter @gmt/api... build`, and under the root
// `pnpm test` they run in parallel, so one tsc could rewrite a dist file the other's script was importing. One script
// builds under a lock and skips when no source is newer than the last build; both files call it.
const REPO = join(import.meta.dirname, '..');
const ensure = () =>
  execFileSync(process.execPath, [join(REPO, 'scripts', 'ensure-build.mjs')], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 600_000,
  }).trim();

describe('scripts/ensure-build.mjs', () => {
  it('builds when needed and then reports the build up to date, without rebuilding', () => {
    ensure();
    expect(ensure()).toBe('build up to date');
  }, 600_000);

  it('is the only thing the CLI tests use to build', () => {
    for (const f of ['scripts/backup.test.mjs', 'apps/api/test/deploy/backupCli.test.ts']) {
      const text = readFileSync(join(REPO, f), 'utf8');
      expect(text, f).toContain('ensure-build.mjs');
      expect(text, f).not.toMatch(/'@gmt\/api\.\.\.', 'build'/);
    }
  });
});

describe('scripts/ensure-build-lib.mjs (re-review N1, N2)', () => {
  it('N1: retries the acquire when the holder releases the lock between the failed mkdir and the stat', async () => {
    const { acquire } = await import('./ensure-build-lib.mjs');
    const calls = [];
    let held = true;
    const enoent = Object.assign(new Error('gone'), { code: 'ENOENT' });
    await acquire('/lock', {
      mkdir: () => {
        calls.push('mkdir');
        if (held) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      },
      // the holder releases exactly here: after mkdir failed, before our stat looks
      stat: () => {
        held = false;
        throw enoent;
      },
      rm: () => undefined,
      sleep: () => undefined,
      now: () => 0,
    });
    expect(calls).toEqual(['mkdir', 'mkdir']);
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
