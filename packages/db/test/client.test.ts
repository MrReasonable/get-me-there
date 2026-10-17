import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/client.js';
import { applyMigrations, pendingMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { count, openTracked, T0, tmpDbPath, tmpDir } from './helpers/db.js';

describe('openDatabase (spec §7 SQLite settings)', () => {
  it('sets busy_timeout and foreign_keys on an in-memory db', () => {
    const db = openDatabase(':memory:');
    expect(db.raw.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
  it('uses WAL on a file db', () => {
    const db = openDatabase(join(tmpDir(), 'x.test.db'));
    expect(db.raw.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
  });
  it('transaction callbacks must be synchronous (better-sqlite3 commits at the first await)', () => {
    const db = openDatabase(':memory:');
    // @ts-expect-error async callbacks are rejected by the type and at runtime
    expect(() => db.transaction(async () => 1)).toThrow(/synchronous/);
    // @ts-expect-error same guard on the BEGIN IMMEDIATE variant
    expect(() => db.immediateTransaction(async () => 1)).toThrow(/synchronous/);
    expect(db.transaction(() => 41 + 1)).toBe(42);
    expect(db.immediateTransaction(() => 'locked')).toBe('locked');
    db.close();
  });
  it('immediateTransaction takes the write lock before the callback runs', () => {
    const dir = tmpDir();
    const a = openDatabase(join(dir, 'lock.test.db'));
    const b = openDatabase(join(dir, 'lock.test.db'));
    b.raw.pragma('busy_timeout = 50');
    a.raw.exec('CREATE TABLE t (n INTEGER)');
    let other: unknown;
    a.immediateTransaction(() => {
      try {
        b.raw.exec('INSERT INTO t VALUES (1)');
      } catch (e) {
        other = e;
      }
    });
    expect(other).toBeInstanceOf(Error);
    expect(other).toMatchObject({ code: 'SQLITE_BUSY' });
    a.close();
    b.close();
  });
});

describe('migrations (spec §7)', () => {
  it('with an empty journal nothing is pending and nothing is applied', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'meta'));
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }),
    );
    const db = openDatabase(':memory:');
    expect(pendingMigrations(db, dir)).toEqual([]);
    expect(applyMigrations(db, dir)).toEqual({ applied: [] });
    db.close();
  });
  it('applies a real migration once and reports nothing pending afterwards', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'meta'));
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: 1_760_000_000_000, tag: '0000_initial', breakpoints: true }],
      }),
    );
    writeFileSync(join(dir, '0000_initial.sql'), 'CREATE TABLE t (id INTEGER PRIMARY KEY);\n');
    const db = openDatabase(':memory:');
    expect(pendingMigrations(db, dir)).toEqual(['0000_initial']);
    expect(applyMigrations(db, dir)).toEqual({ applied: ['0000_initial'] });
    expect(pendingMigrations(db, dir)).toEqual([]);
    expect(applyMigrations(db, dir)).toEqual({ applied: [] }); // idempotent
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE name = 't'").get()).toBeDefined();
    db.close();
  });
  it('names a failing migrations directory', () => {
    const db = openDatabase(':memory:');
    expect(() => applyMigrations(db, '/nonexistent/drizzle')).toThrow(/nonexistent/);
    db.close();
  });
});

const schemaOf = (db: ReturnType<typeof openTracked>) =>
  db.raw
    .prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
    .all();
const insertLedgerRow = (db: ReturnType<typeof openTracked>) =>
  db.raw
    .prepare(
      `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('travelpayouts', '/v3', ?, 'pending', 0, 1)`,
    )
    .run(T0);

describe('migrations against the first real migration (spec §7 "Migrations", §9 item 3)', () => {
  it('apply twice: the second run applies nothing and changes nothing', () => {
    const db = openTracked(tmpDbPath());
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual(['0000_initial', '0001_confirmed_calls']);
    expect(applyMigrations(db, MIGRATIONS_DIR)).toEqual({
      applied: ['0000_initial', '0001_confirmed_calls'],
    });
    const before = schemaOf(db);
    expect(applyMigrations(db, MIGRATIONS_DIR)).toEqual({ applied: [] });
    expect(schemaOf(db)).toEqual(before);
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([]);
    expect(count(db, '__drizzle_migrations')).toBe(2);
  });

  it('a missing migrations directory fails naming the directory', () => {
    expect(() => applyMigrations(openTracked(':memory:'), '/nonexistent/drizzle')).toThrow(
      /\/nonexistent\/drizzle/,
    );
  });

  it('an async transaction callback is rejected and its synchronous writes are rolled back', () => {
    const db = openTracked(':memory:');
    applyMigrations(db, MIGRATIONS_DIR);
    // @ts-expect-error repository transaction callbacks are typed to return non-Promise values (Task 0.10's conditional type)
    expect(() => db.transaction(async () => insertLedgerRow(db))).toThrow(/synchronous/);
    // why: better-sqlite3 runs the callback up to its first await, so the insert happened; the rollback must undo it.
    expect(count(db, 'provider_requests')).toBe(0);
    // @ts-expect-error the same guard on the BEGIN IMMEDIATE variant (ruling 14)
    expect(() => db.immediateTransaction(async () => insertLedgerRow(db))).toThrow(/synchronous/);
    expect(count(db, 'provider_requests')).toBe(0);
  });
});

describe('SQLite settings on a file database (spec §7, plan Review Focus 5)', () => {
  it('a second handle on the same file gets busy_timeout=5000 too (the tool bootstrap opens its own)', () => {
    const path = tmpDbPath();
    openTracked(path);
    expect(openTracked(path).raw.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('contention shorter than busy_timeout is absorbed: a write waits for another connection and succeeds', async () => {
    const path = tmpDbPath();
    const db = openTracked(path);
    applyMigrations(db, MIGRATIONS_DIR);
    const worker = new Worker(new URL('./helpers/hold-worker.mjs', import.meta.url), {
      workerData: { path, at: T0, holdMs: 200 },
    });
    const released = new Promise((resolve, reject) => {
      worker.on('message', (m) => m === 'released' && resolve(m));
      worker.once('error', reject);
    });
    await new Promise((resolve) => worker.once('message', resolve)); // 'holding'
    insertLedgerRow(db); // blocks inside SQLite until the worker commits, well under 5,000 ms
    await released;
    expect(count(db, 'provider_requests')).toBe(2);
    // why: order, not wall-clock time (test-strategy M2): the held row committed first, so ours waited for the lock.
    expect(db.raw.prepare('SELECT endpoint_path AS p FROM provider_requests ORDER BY id').all()).toEqual([
      { p: '/held' },
      { p: '/v3' },
    ]);
  });

  it('contention longer than busy_timeout surfaces SqliteError SQLITE_BUSY, not a hang or a crash', () => {
    const path = tmpDbPath();
    const db = openTracked(path);
    applyMigrations(db, MIGRATIONS_DIR);
    const other = openTracked(path);
    other.raw.pragma('busy_timeout = 50'); // why: keep the test fast; production uses 5000
    db.raw.prepare('BEGIN IMMEDIATE').run();
    let thrown: unknown;
    try {
      insertLedgerRow(other);
    } catch (e) {
      thrown = e;
    }
    db.raw.prepare('ROLLBACK').run();
    expect(thrown).toBeInstanceOf(Database.SqliteError);
    if (!(thrown instanceof Database.SqliteError)) return;
    expect(thrown.code).toBe('SQLITE_BUSY');
  });
});
