// Migration 0014 (settings plan ruling 4): the settings table, one row per owned name, value as `.env` holds it, its
// time checked as an ISO timestamp; no CHECK on the name (the repository validates names). Additive only: a world
// migrated to 0013 comes through unchanged.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { freshDb, openTracked, sqliteCode, T0, tmpDbPath } from './helpers/db.js';
import { migrationsWithout } from './helpers/migrations.js';

beforeEach(() => {
  expect.hasAssertions();
});

const TAG = '0014_settings';

describe('migration 0014 (the settings table)', () => {
  it('applies to a database migrated to 0013, leaving its tables as they were', () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, migrationsWithout([TAG]));
    const tables = () =>
      db.raw
        .prepare<[], { name: string; sql: string }>(
          "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name <> 'settings' ORDER BY name",
        )
        .all();
    const before = tables();
    expect(applyMigrations(db, MIGRATIONS_DIR).applied).toEqual([TAG]);
    expect(tables()).toEqual(before);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('has a text name key, a non-null value and an ISO updated_at, and no CHECK on the name', () => {
    const db = freshDb();
    expect(
      db.raw
        .prepare('SELECT name, type, "notnull", pk FROM pragma_table_info(?) ORDER BY cid')
        .all('settings'),
    ).toEqual([
      { name: 'name', type: 'TEXT', notnull: 1, pk: 1 },
      { name: 'value', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'updated_at', type: 'TEXT', notnull: 1, pk: 0 },
    ]);
    const insert = db.raw.prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)');
    expect(sqliteCode(() => insert.run('ANY_NAME', '', T0))).toBeNull();
    expect(sqliteCode(() => insert.run('OTHER', 'x', '2026-11-19'))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(() => insert.run('ANY_NAME', 'again', T0))).toBe('SQLITE_CONSTRAINT_PRIMARYKEY');
    expect(
      sqliteCode(() => db.raw.prepare('INSERT INTO settings (name, updated_at) VALUES (?, ?)').run('X', T0)),
    ).toBe('SQLITE_CONSTRAINT_NOTNULL');
  });

  it('the journal lists 15 tags with this one last, and its snapshot follows 0013’s and carries the table', () => {
    const journal: { entries: Array<{ idx: number; tag: string }> } = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
    );
    expect(journal.entries).toHaveLength(15);
    expect(journal.entries.at(-1)).toMatchObject({ idx: 14, tag: TAG });
    const read = (n: string) =>
      JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', `${n}_snapshot.json`), 'utf8'));
    const snapshot = read('0014');
    expect(snapshot.prevId).toBe(read('0013').id);
    expect(Object.keys(snapshot.tables.settings.columns)).toEqual(['name', 'value', 'updated_at']);
    expect(Object.keys(snapshot.tables.settings.checkConstraints)).toEqual(['settings_updated_at_ck']);
  });
});
