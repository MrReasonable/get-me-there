import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { applyMigrations } from '../src/migrate.js';
import { freshDb, openTracked, tmpDbPath } from './helpers/db.js';
import { migrationsWithout, REBUILT_0005, seedEveryRebuiltTableAt0004 } from './helpers/migrations.js';

const PROVIDER_CK = [
  'calendar_prices',
  'cell_outcomes',
  'fare_offers',
  'provider_requests',
  'route_price_history',
];
const SOURCE_KIND_CK = ['calendar_prices', 'cell_outcomes', 'price_observations'];
const ddl = (db: Db, t: string): string => {
  const row: unknown = db.raw.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(t);
  if (typeof row !== 'object' || row === null || !('sql' in row) || typeof row.sql !== 'string')
    throw new Error(`no table ${t}`);
  return row.sql;
};
beforeEach(() => {
  expect.hasAssertions();
});

describe('migration 0005 (spec §5.1 rev 32)', () => {
  it.each(PROVIDER_CK)('%s accepts camoufox in its provider CHECK', (t) => {
    expect(ddl(freshDb(), t)).toContain("'camoufox'");
  });
  it.each(SOURCE_KIND_CK)('%s accepts scraped-self in its source_kind CHECK', (t) => {
    expect(ddl(freshDb(), t)).toContain("'scraped-self'");
  });
  it('cell_outcomes accepts the skip reason provider_unavailable', () => {
    expect(ddl(freshDb(), 'cell_outcomes')).toContain("'provider_unavailable'");
  });
  it('a camoufox provider_requests row inserts with a page class; an unknown provider and an unknown class are refused', () => {
    const insert = freshDb().raw.prepare(
      "INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, billable, cost_micro_gbp, http_attempt, page_class) VALUES (?, '/v1/page', '2026-10-18T05:00:00.000Z', 'ok', 0, 0, 1, ?)",
    );
    expect(() => insert.run('camoufox', 'no-page')).not.toThrow();
    expect(() => insert.run('camoufox', null)).not.toThrow();
    expect(() => insert.run('kayak', 'page')).toThrow(/CHECK/);
    expect(() => insert.run('camoufox', 'sometimes')).toThrow(/CHECK/);
  });
  it('creates operator_notice_keys with a timestamped primary key', () => {
    const db = freshDb();
    const insert = db.raw.prepare('INSERT INTO operator_notice_keys (key, sent_at) VALUES (?, ?)');
    insert.run('camoufox-cooldown:2026-10-20T05:00:00.000Z', '2026-10-18T05:00:00.000Z');
    expect(() =>
      insert.run('camoufox-cooldown:2026-10-20T05:00:00.000Z', '2026-10-18T05:00:00.000Z'),
    ).toThrow(/UNIQUE/);
    expect(() => insert.run('k', 'yesterday')).toThrow(/CHECK/);
  });
  it('keeps every row of a database migrated to 0004, and every reference still holds', () => {
    const { before, migrate, after, db } = seedEveryRebuiltTableAt0004();
    for (const t of REBUILT_0005) expect(before[t], t).toHaveLength(1);
    migrate();
    expect(after()).toEqual(before);
    expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.raw.prepare('SELECT page_class FROM provider_requests').all()).toEqual([{ page_class: null }]);
  });
  it('a migration that leaves a broken reference fails, and foreign keys are back on afterwards', () => {
    const dir = migrationsWithout([]);
    appendFileSync(
      join(dir, '0005_camoufox_provider.sql'),
      "\n--> statement-breakpoint\nINSERT INTO search_cells (execution_id, origin, destination, departure_date, return_date) VALUES ('ghost', 'LHR', 'JFK', '2027-03-14', '2027-03-24');",
    );
    const journal = join(dir, 'meta', '_journal.json');
    writeFileSync(journal, readFileSync(journal, 'utf8'));
    const db = openTracked(tmpDbPath());
    expect(() => applyMigrations(db, dir)).toThrow(/foreign_key_check found 1 broken/);
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
