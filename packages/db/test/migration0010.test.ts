// Migration 0010 (plan-a-search, spec §7 revision 51): airports gains nullable kind and scheduled, from OurAirports;
// a row seeded before it keeps NULL in both (unknown), and the CHECKs refuse other values.
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { openTracked, sqliteCode, tmpDbPath } from './helpers/db.js';
import { migrationsWithout } from './helpers/migrations.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('migration 0010', () => {
  it('adds nullable kind and scheduled and leaves an airport seeded at 0009 unknown in both', () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, migrationsWithout(['0010_airport_kind']));
    db.raw
      .prepare(
        `INSERT INTO airports (iata, icao, name, city, country, tz, lat, lon, metro, source, dataset_version) VALUES ('AAA', NULL, 'Synthetic', 'Nowhere', 'ZZ', 'UTC', 0, 0, NULL, 's', 'v')`,
      )
      .run();
    expect(applyMigrations(db, MIGRATIONS_DIR).applied).toEqual(['0010_airport_kind']);
    expect(db.raw.prepare('SELECT kind, scheduled FROM airports').all()).toEqual([
      { kind: null, scheduled: null },
    ]);
    db.raw.prepare(`UPDATE airports SET kind = 'large', scheduled = 1`).run();
    expect(db.raw.prepare('SELECT kind, scheduled FROM airports').get()).toEqual({
      kind: 'large',
      scheduled: 1,
    });
    expect(sqliteCode(() => db.raw.prepare(`UPDATE airports SET kind = 'huge'`).run())).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(() => db.raw.prepare('UPDATE airports SET scheduled = 2').run())).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok');
  });
});
