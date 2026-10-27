import { join } from 'node:path';
import { asIsoDateTime, type Logger } from '@gmt/core';
import Database from 'better-sqlite3';
import { afterEach } from 'vitest';
import { type Db, openDatabase } from '../../src/client.js';
import { applyMigrations } from '../../src/migrate.js';
import { MIGRATIONS_DIR } from '../../src/paths.js';
import { tempDir } from '../support/tempdirs.js';

/** The instant every test starts from unless it says otherwise. Minted, never cast (ruling 15). */
export const T0 = asIsoDateTime('2026-10-14T12:00:00.000Z');
/** The one timestamp mint for tests. */
export const at = asIsoDateTime;

const handles: Db[] = [];
// why: test-008. Every handle opened through these helpers is closed after each test, including when the test failed
// half way, before the setup file's own afterEach removes the temp directories. Registered at module scope, so it
// applies to every test file that imports this helper.
afterEach(() => {
  for (const db of handles.splice(0)) if (db.raw.open) db.close();
});

export function openTracked(path: string): Db {
  const db = openDatabase(path);
  handles.push(db);
  return db;
}

/** A migrated database. `:memory:` by default; pass a path for multi-handle tests. */
export function freshDb(path = ':memory:'): Db {
  const db = openTracked(path);
  applyMigrations(db, MIGRATIONS_DIR);
  return db;
}

/** A fresh temp directory removed after the test. */
export function tmpDir(): string {
  return tempDir('gmt-db-');
}

/** A unique file path ending in `.test.db` (the synthetic gate's test suffix, spec §5.5). */
export function tmpDbPath(name = 'wp3.test.db'): string {
  return join(tmpDir(), name);
}

export const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};

export function count(db: Db, table: string): number {
  return db.raw.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
}

/** The SqliteError code a call throws, or null; anything else is rethrown so a wrong failure never passes. */
export function sqliteCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof Database.SqliteError) return e.code;
    throw e;
  }
}
