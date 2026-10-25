// Migration 0008 (WP18 V3): provider_requests gains a nullable error_kind; existing rows keep NULL.
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { openTracked, tmpDbPath } from './helpers/db.js';
import { migrationsWithout } from './helpers/migrations.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('migration 0008', () => {
  it('adds a nullable error_kind and leaves a row written at 0007 with none', () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, migrationsWithout(['0008_wp18_error_kind']));
    db.raw
      .prepare(
        `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('searchapi', '/s', '2026-10-01T00:00:00.000Z', 'ok', 0, 1)`,
      )
      .run();
    expect(
      db.raw
        .prepare('PRAGMA table_info(provider_requests)')
        .all()
        .map((c) => String(Object.getOwnPropertyDescriptor(c, 'name')?.value)),
    ).not.toContain('error_kind');
    const second = applyMigrations(db, MIGRATIONS_DIR);
    expect(second.applied).toEqual(['0008_wp18_error_kind']);
    expect(db.raw.prepare('SELECT error_kind AS k FROM provider_requests').all()).toEqual([{ k: null }]);
    db.raw.prepare(`UPDATE provider_requests SET error_kind = 'quota'`).run();
    expect(db.raw.prepare('SELECT error_kind AS k FROM provider_requests').get()).toEqual({ k: 'quota' });
  });
});
