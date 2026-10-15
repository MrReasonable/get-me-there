import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { AppLock, LOCK_STALE_AFTER_MS, readOnlyLockState } from '../src/appLock.js';
import { at, freshDb, silentLog, T0, tmpDbPath, tmpDir } from './helpers/db.js';

const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

/** A migrated file database holding an app lock taken at T0, closed again (so no -wal/-shm remains). */
function lockedFile(): string {
  const path = tmpDbPath();
  const db = freshDb(path);
  expect(new AppLock(db, 'app', fixedClock(T0), silentLog).acquire({ waitMs: 0 })).toBe('acquired');
  db.close();
  return path;
}

describe('readOnlyLockState (spec §7 app_lock; plan decision 20)', () => {
  it('a missing file is absent and is not created', () => {
    const path = join(tmpDir(), 'none.db');
    expect(readOnlyLockState(path, fixedClock(T0))).toEqual({ state: 'absent' });
    expect(existsSync(path)).toBe(false);
  });

  it('a database without the app_lock table (pre-migration) is absent, and nothing is migrated', () => {
    const path = tmpDbPath();
    const raw = new Database(path);
    raw.exec('CREATE TABLE t (x INTEGER)');
    raw.close();
    expect(readOnlyLockState(path, fixedClock(T0))).toEqual({ state: 'absent' });
    const check = new Database(path, { readonly: true });
    expect(
      check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'").get(),
    ).toEqual({ n: 0 });
    check.close();
  });

  it('a migrated database with no lock row is absent', () => {
    const path = tmpDbPath();
    freshDb(path).close();
    expect(readOnlyLockState(path, fixedClock(T0))).toEqual({ state: 'absent' });
  });

  it('a heartbeat within LOCK_STALE_AFTER_MS is fresh, older is stale; the file is never written', () => {
    const path = lockedFile();
    const before = { digest: digest(path), mtime: statSync(path).mtimeMs };
    const clock = fixedClock(T0);
    clock.advance(LOCK_STALE_AFTER_MS);
    expect(readOnlyLockState(path, clock)).toEqual({
      state: 'fresh',
      holder: 'app',
      heartbeatAt: at('2026-10-14T12:00:00.000Z'),
    });
    clock.advance(1);
    expect(readOnlyLockState(path, clock)).toEqual({ state: 'stale', holder: 'app', heartbeatAt: T0 });
    expect({ digest: digest(path), mtime: statSync(path).mtimeMs }).toEqual(before);
    // why: a read-only connection to a WAL database needs SQLite's -wal/-shm sidecars and creates empty ones when
    // absent; nothing is ever written to the log
    expect(existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0).toBe(0);
    const check = new Database(path, { readonly: true });
    expect(check.pragma('journal_mode', { simple: true })).toBe('wal');
    check.close();
  });

  it("sees a live app's heartbeat that is still only in the WAL", () => {
    const path = tmpDbPath();
    const live = freshDb(path);
    const clock = fixedClock(T0);
    expect(new AppLock(live, 'app', clock, silentLog).acquire({ waitMs: 0 })).toBe('acquired');
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
    expect(readOnlyLockState(path, clock)).toEqual({ state: 'fresh', holder: 'app', heartbeatAt: T0 });
  });

  it(':memory: is absent', () => {
    expect(readOnlyLockState(':memory:', fixedClock(T0))).toEqual({ state: 'absent' });
  });

  it('throws for a file that is not a SQLite database (the tool maps it to exit 73)', () => {
    const path = join(tmpDir(), 'garbage.db');
    writeFileSync(path, 'this is not a database, just text long enough to fill a header page');
    expect(() => readOnlyLockState(path, fixedClock(T0))).toThrow(/not a database/);
  });

  it('throws RowCorrupt for a malformed heartbeat_at (a hand-made table; the migrated schema CHECKs the column)', () => {
    const path = tmpDbPath();
    const raw = new Database(path);
    raw.exec(
      'CREATE TABLE app_lock (id INTEGER PRIMARY KEY, holder TEXT, heartbeat_at TEXT, acquired_at TEXT)',
    );
    raw.prepare("INSERT INTO app_lock VALUES (1, 'app', 'yesterday', 'yesterday')").run();
    raw.close();
    expect(() => readOnlyLockState(path, fixedClock(T0))).toThrow(/heartbeat_at/);
  });
});
