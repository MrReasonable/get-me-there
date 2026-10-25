import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { backupDatabase, backupSummary, checkBackup, integrityCheck } from '../src/backup.js';
import { at, count, freshDb, openTracked, T0, tmpDir } from './helpers/db.js';

const NAME = 'get-me-there-2026-10-14T12-00-00-000Z.db';
const insertRow = (db: ReturnType<typeof freshDb>) =>
  db.raw
    .prepare(
      `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('travelpayouts', '/v3', ?, 'ok', 0, 1)`,
    )
    .run(T0);

/** A migrated file database with one ledger row; its writer handle stays open (closed by the helper's afterEach). */
function live() {
  const dir = tmpDir();
  const path = join(dir, 'live.db');
  const db = freshDb(path);
  insertRow(db);
  return { path, db, backups: join(dir, 'backups') };
}

describe('backupDatabase (spec §7 "Migrations", §13 "Backup", decision 14)', () => {
  it('writes a timestamped copy that passes integrity_check and holds the data; directory 0700, file 0600 (sec-003)', () => {
    const { path, backups } = live();
    const { file } = backupDatabase(path, backups, { keep: 5, clock: fixedClock(T0) });
    expect(file).toBe(join(backups, NAME));
    const copy = openTracked(file);
    expect(copy.raw.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(count(copy, 'provider_requests')).toBe(1);
    expect(statSync(backups).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('copies committed rows still in the WAL while the writer is open (sec-004, test-009)', () => {
    const { path, db, backups } = live();
    insertRow(db);
    insertRow(db);
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0); // not checkpointed
    const { file } = backupDatabase(path, backups, { keep: 5, clock: fixedClock(T0) });
    expect(count(openTracked(file), 'provider_requests')).toBe(3);
  });

  it('refuses an existing target and a symlink at the target, following neither (sec-005)', () => {
    const { path, backups } = live();
    const clock = fixedClock(T0);
    backupDatabase(path, backups, { keep: 5, clock });
    expect(() => backupDatabase(path, backups, { keep: 5, clock })).toThrow(/already exists/);
    expect(count(openTracked(join(backups, NAME)), 'provider_requests')).toBe(1); // the earlier backup is untouched
    clock.advance(1000);
    const linked = join(backups, 'get-me-there-2026-10-14T12-00-01-000Z.db');
    const elsewhere = join(tmpDir(), 'planted.db');
    symlinkSync(elsewhere, linked);
    expect(() => backupDatabase(path, backups, { keep: 5, clock })).toThrow(/already exists/);
    expect(existsSync(elsewhere)).toBe(false);
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
  });

  it('refuses a world-writable backups directory', () => {
    const { path } = live();
    const open = join(tmpDir(), 'open');
    mkdirSync(open);
    chmodSync(open, 0o777);
    expect(() => backupDatabase(path, open, { keep: 5, clock: fixedClock(T0) })).toThrow(/world-writable/);
    expect(readdirSync(open)).toEqual([]);
  });

  it('prunes to the newest `keep` backups and leaves other files alone (test-009)', () => {
    const { path, backups } = live();
    const clock = fixedClock(T0);
    mkdirSync(backups, { mode: 0o700 });
    writeFileSync(join(backups, 'notes.txt'), 'operator file');
    for (let i = 0; i < 7; i++) {
      backupDatabase(path, backups, { keep: 5, clock });
      clock.advance(60_000);
    }
    const files = readdirSync(backups).sort();
    expect(files).toEqual([
      'get-me-there-2026-10-14T12-02-00-000Z.db',
      'get-me-there-2026-10-14T12-03-00-000Z.db',
      'get-me-there-2026-10-14T12-04-00-000Z.db',
      'get-me-there-2026-10-14T12-05-00-000Z.db',
      'get-me-there-2026-10-14T12-06-00-000Z.db',
      'notes.txt',
    ]);
  });

  it('an integrity failure throws and removes the file it created (test-009)', () => {
    const { path, backups } = live();
    expect(() =>
      backupDatabase(path, backups, {
        keep: 5,
        clock: fixedClock(T0),
        verify: () => 'row 3 missing from index',
      }),
    ).toThrow(/integrity_check returned row 3 missing/);
    expect(existsSync(join(backups, NAME))).toBe(false);
  });

  it('a really corrupted copy fails the production integrity check, which throws and removes the file (test-strategy M3)', () => {
    const { path, backups } = live();
    // why: rewrite the copy's index definition under writable_schema, so the stored index no longer matches its table:
    // a genuine corruption SQLite's own integrity_check reports, with the file still openable.
    const corrupt = (file: string) => {
      const d = new Database(file);
      d.exec('CREATE TABLE t (x INTEGER, y INTEGER); CREATE INDEX t_x ON t (x);');
      const ins = d.prepare('INSERT INTO t VALUES (?, ?)');
      for (let k = 0; k < 50; k++) ins.run(k, 1000 - k);
      d.unsafeMode(true);
      d.pragma('writable_schema = ON');
      d.prepare("UPDATE sqlite_master SET sql = 'CREATE INDEX t_x ON t (y)' WHERE name = 't_x'").run();
      d.close();
    };
    let seen = '';
    expect(() =>
      backupDatabase(path, backups, {
        keep: 5,
        clock: fixedClock(T0),
        verify: (file) => {
          corrupt(file);
          seen = integrityCheck(file);
          return seen;
        },
      }),
    ).toThrow(/integrity_check returned/);
    expect(seen).not.toBe('ok');
    expect(existsSync(join(backups, NAME))).toBe(false);
  });

  it('throws on a missing source, a non-database source (leaving no file) and a bad keep', () => {
    const dir = tmpDir();
    expect(() =>
      backupDatabase(join(dir, 'absent.db'), join(dir, 'b1'), { keep: 5, clock: fixedClock(T0) }),
    ).toThrow(/does not exist/);
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'not a database');
    expect(() =>
      backupDatabase(junk, join(dir, 'b2'), { keep: 5, clock: fixedClock(at('2026-10-14T13:00:00.000Z')) }),
    ).toThrow(/backup failed/);
    expect(readdirSync(join(dir, 'b2'))).toEqual([]);
    expect(() => backupDatabase(live().path, join(dir, 'b3'), { keep: 0, clock: fixedClock(T0) })).toThrow(
      RangeError,
    );
  });
});

describe('checkBackup (spec §13 "Restore"; the one rule scripts/check-backup.mjs uses)', () => {
  it('accepts a good backup and returns nothing', () => {
    const { path, backups } = live();
    const { file } = backupDatabase(path, backups, { keep: 5, clock: fixedClock(T0) });
    expect(checkBackup(file)).toBeUndefined();
  });

  it('throws for a file that is not a database and for one that does not exist', () => {
    const dir = tmpDir();
    const bad = join(dir, 'bad.db');
    writeFileSync(bad, 'not a database '.repeat(200));
    expect(() => checkBackup(bad)).toThrow(/not a database/);
    expect(() => checkBackup(join(dir, 'absent.db'))).toThrow();
  });

  it('throws naming the verdict when integrity_check says anything but ok', () => {
    const { path } = live();
    expect(() => checkBackup(path, () => '*** in database main ***')).toThrow(
      'integrity_check returned *** in database main ***',
    );
  });
});

describe('backupSummary (cb-b1-010: what starting the app on a restored or imported database will do)', () => {
  const DEFINITION = `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
    verification_policy_json, budget_json, providers_json, schedule_cron, schedule_tz, enabled, deleted_at, created_at, updated_at)
   VALUES (@id, 'London to New York', '["LHR"]', '["JFK"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 10, 'economy', '{}',
    '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', '{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}',
    '{"discovery":["travelpayouts"],"verification":[],"discoveryRefreshHours":{}}', @cron, 'Europe/London', @enabled, @deleted, @at, @at)`;
  const EXECUTION = `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at)
   VALUES (@id, @definitionId, '{"budget":{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}}', 'manual', @status, @at)`;

  it('counts the top-level runs a start would resume and the enabled scheduled searches it may catch up', () => {
    const { path, db } = live();
    const def = db.raw.prepare(DEFINITION);
    def.run({ id: 'd1', cron: '0 6 * * 1', enabled: 1, deleted: null, at: T0 });
    def.run({ id: 'd2', cron: '0 6 * * 2', enabled: 0, deleted: null, at: T0 });
    def.run({ id: 'd3', cron: null, enabled: 1, deleted: null, at: T0 });
    def.run({ id: 'd4', cron: '0 6 * * 3', enabled: 1, deleted: T0, at: T0 });
    const ex = db.raw.prepare(EXECUTION);
    ex.run({ id: 'e1', definitionId: 'd1', status: 'running', at: T0 });
    ex.run({ id: 'e2', definitionId: 'd3', status: 'interrupted', at: T0 });
    ex.run({ id: 'e3', definitionId: 'd1', status: 'completed', at: T0 });
    expect(backupSummary(path)).toEqual({ resumable: 2, scheduled: 1 });
  });

  it('an older schema counts what its columns allow: no is_child means every active row; a definitions table without a schedule counts none', () => {
    const file = join(tmpDir(), 'old.db');
    const db = new Database(file);
    db.exec('CREATE TABLE search_executions (id TEXT PRIMARY KEY, status TEXT NOT NULL)');
    db.exec("INSERT INTO search_executions VALUES ('a', 'running'), ('b', 'completed')");
    db.exec('CREATE TABLE search_definitions (id TEXT PRIMARY KEY, name TEXT)');
    db.close();
    expect(backupSummary(file)).toEqual({ resumable: 1, scheduled: 0 });
  });

  it('a database without those tables (before any migration) counts none', () => {
    const file = join(tmpDir(), 'empty.db');
    new Database(file).close();
    expect(backupSummary(file)).toEqual({ resumable: 0, scheduled: 0 });
  });
});
