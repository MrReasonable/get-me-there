// Migration 0009 (WP19, spec §10 bounds): calendar_prices gains the covering index the latest-price read groups by;
// rows written at 0008 stay as they were and the grouped read uses the index.
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { openTracked, tmpDbPath } from './helpers/db.js';
import { migrationsWithout } from './helpers/migrations.js';

beforeEach(() => {
  expect.hasAssertions();
});

const indexes = (db: ReturnType<typeof openTracked>) =>
  db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'calendar_prices'")
    .all()
    .map((r) => String(Object.getOwnPropertyDescriptor(r, 'name')?.value));

describe('migration 0009', () => {
  it('adds calendar_prices_latest_idx over (provider, cell, fetched_at, id) and the columns the read filters on', () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, migrationsWithout(['0009_wp19_latest_price_idx', '0010_airport_kind']));
    expect(indexes(db)).not.toContain('calendar_prices_latest_idx');
    const second = applyMigrations(db, MIGRATIONS_DIR);
    expect(second.applied).toEqual(['0009_wp19_latest_price_idx', '0010_airport_kind']);
    expect(indexes(db)).toContain('calendar_prices_latest_idx');
    const columns = db.raw
      .prepare("PRAGMA index_info('calendar_prices_latest_idx')")
      .all()
      .map((r) => String(Object.getOwnPropertyDescriptor(r, 'name')?.value));
    expect(columns).toEqual([
      'provider_id',
      'origin',
      'destination',
      'departure_date',
      'return_date',
      'fetched_at',
      'id',
      'execution_id',
      'cabin',
      'reused_from_execution_id',
    ]);
  });
});
