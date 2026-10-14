import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/client.js';
import { applyMigrations, pendingMigrations } from '../src/migrate.js';

describe('openDatabase (spec §7 SQLite settings)', () => {
  it('sets busy_timeout and foreign_keys on an in-memory db', () => {
    const db = openDatabase(':memory:');
    expect(db.raw.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
  it('uses WAL on a file db', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'gmt-')), 'x.test.db'));
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
    const dir = mkdtempSync(join(tmpdir(), 'gmt-'));
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
    const dir = mkdtempSync(join(tmpdir(), 'gmt-mig-'));
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
  it('names a failing migrations directory', () => {
    const db = openDatabase(':memory:');
    expect(() => applyMigrations(db, '/nonexistent/drizzle')).toThrow(/nonexistent/);
    db.close();
  });
});
