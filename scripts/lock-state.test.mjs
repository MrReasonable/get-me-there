import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// why: WP16b: `gmt setup --import-db <path>` must know the checkout's app is not running (its app_lock is free) and may
// not import @gmt/db, so it runs this thin wrapper over readOnlyLockState as a child (decision 72).
const REPO = fileURLToPath(new URL('../', import.meta.url));
const Database = createRequire(join(REPO, 'packages', 'db', 'package.json'))('better-sqlite3');
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
beforeAll(() => {
  execFileSync(process.execPath, [join(REPO, 'scripts', 'ensure-build.mjs')], {
    cwd: REPO,
    stdio: 'ignore',
    timeout: 1_200_000,
  });
}, 1_200_000);
const run = (args) =>
  spawnSync(process.execPath, [join(REPO, 'scripts', 'lock-state.mjs'), ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
  });
function db(lock) {
  const d = mkdtempSync(join(tmpdir(), 'gmt-lock-'));
  dirs.push(d);
  const path = join(d, 'dev.db');
  const h = new Database(path);
  h.exec(
    'CREATE TABLE app_lock (id INTEGER PRIMARY KEY, holder TEXT NOT NULL, heartbeat_at TEXT NOT NULL, acquired_at TEXT NOT NULL)',
  );
  if (lock !== null)
    h.prepare('INSERT INTO app_lock (id, holder, heartbeat_at, acquired_at) VALUES (1, ?, ?, ?)').run(
      'app',
      lock,
      lock,
    );
  h.close();
  return path;
}

describe('scripts/lock-state.mjs', { timeout: 60_000 }, () => {
  it('prints fresh for a live heartbeat, stale for an old one, absent for none', () => {
    const now = new Date().toISOString();
    expect(JSON.parse(run([db(now)]).stdout)).toMatchObject({ state: 'fresh', holder: 'app' });
    expect(JSON.parse(run([db('2020-01-01T00:00:00.000Z')]).stdout)).toMatchObject({ state: 'stale' });
    expect(JSON.parse(run([db(null)]).stdout)).toEqual({ state: 'absent' });
  });
  it('a missing argument is usage (64)', () => {
    expect(run([]).status).toBe(64);
  });
  it('a lock it cannot read is a plain failure (1), its stdout empty: never a lock state (ca-b1-022)', () => {
    const d = mkdtempSync(join(tmpdir(), 'gmt-lock-'));
    dirs.push(d);
    const bad = join(d, 'bad.db');
    writeFileSync(bad, 'not a database '.repeat(200));
    const r = run([bad]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('lock-state failed');
  });
});
