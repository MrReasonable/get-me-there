import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { applyMigrations, pendingMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { freshDb, openTracked, sqliteCode, T0, tmpDbPath, tmpDir } from './helpers/db.js';
import { exampleDefinitionInput } from './helpers/factories.js';

/** A copy of the migrations folder that stops at 0000, as an install made before this migration has it. */
function onlyInitial(): string {
  const dir = join(tmpDir(), 'drizzle');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  rmSync(join(dir, '0001_confirmed_calls.sql'));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => e.tag === '0000_initial');
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0001: search_definitions.confirmed_calls (decision 37)', () => {
  it('upgrades a database made at 0000: existing definitions keep every field and read confirmed_calls as null', () => {
    const source = freshDb();
    const created = new DefinitionsRepo(source, fixedClock(T0)).create({
      ...exampleDefinitionInput(),
      confirmedCostPence: 120,
    });
    const row: Record<string, unknown> =
      source.raw
        .prepare<[string], Record<string, unknown>>('SELECT * FROM search_definitions WHERE id = ?')
        .get(created.id) ?? {};
    const { confirmed_calls: _absentAtInitial, ...initialRow } = row;
    const db = openTracked(tmpDbPath());
    applyMigrations(db, onlyInitial());
    const columns = Object.keys(initialRow);
    db.raw
      .prepare(
        `INSERT INTO search_definitions (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`,
      )
      .run(initialRow);
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([
      '0001_confirmed_calls',
      '0002_alert_event_lifecycle',
      '0003_route_history_by_trip',
    ]);
    expect(applyMigrations(db, MIGRATIONS_DIR)).toEqual({
      applied: ['0001_confirmed_calls', '0002_alert_event_lifecycle', '0003_route_history_by_trip'],
    });
    expect(new DefinitionsRepo(db, fixedClock(T0)).get(created.id)).toEqual({
      ...created,
      confirmedCalls: null,
    });
  });

  it('the column holds only a non-negative integer or null (CHECK, spec §6.3)', () => {
    const db = freshDb();
    const d = new DefinitionsRepo(db, fixedClock(T0)).create(exampleDefinitionInput());
    const set = (v: unknown) =>
      sqliteCode(() =>
        db.raw.prepare('UPDATE search_definitions SET confirmed_calls = ? WHERE id = ?').run(v, d.id),
      );
    expect(set(30)).toBeNull();
    expect(set(null)).toBeNull();
    expect(set(2.5)).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(set(-1)).toBe('SQLITE_CONSTRAINT_CHECK');
  });
});
