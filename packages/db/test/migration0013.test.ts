// Migration 0013 (design §6.3): flight_lists gains booking_url, NULL on every existing row. One ADD COLUMN and no
// CHECK (a CHECK would make drizzle-kit rebuild the table), so a world seeded at 0012 comes through unchanged.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { freshDb, openTracked, T0, tmpDbPath } from './helpers/db.js';
import { migrationsWithout } from './helpers/migrations.js';

beforeEach(() => {
  expect.hasAssertions();
});

const TAG = '0013_booking_url';
const DEFINITION = `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin,
    constraints_json, verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
   VALUES ('d1', 'London to New York', '["LHR"]', '["JFK"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 10, 'economy', '{}',
    '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', '{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}',
    '{"discovery":["camoufox"],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 0, @at, @at)`;
const LIST = `INSERT INTO flight_lists (definition_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date,
    fetched_at, point_of_sale, currency_native, status, reason, listed, min_minor, options_unparsed, options_other_cell)
   VALUES ('d1', 'camoufox', 'scraped-self', 'economy', 'LHR', 'JFK', @dep, '2027-03-24', @at, 'GB', 'GBP', @status, @reason, @listed, @min, 0, 0)`;

/** A database at 0012 with a definition, a read list and a failed list. */
function seedAt0012(): Db {
  const db = openTracked(tmpDbPath());
  applyMigrations(db, migrationsWithout([TAG]));
  db.raw.prepare(DEFINITION).run({ at: T0 });
  const insertList = db.raw.prepare(LIST);
  insertList.run({ at: T0, dep: '2027-03-14', status: 'read', reason: null, listed: 'flights', min: 45100 });
  insertList.run({ at: T0, dep: '2027-03-15', status: 'failed', reason: 'parse', listed: null, min: null });
  return db;
}

type Row = Record<string, unknown>;
const listsOf = (db: Db): Row[] => db.raw.prepare<[], Row>('SELECT * FROM flight_lists ORDER BY id').all();

describe('migration 0013 (the booking address)', () => {
  it('keeps every row of a world seeded at 0012 unchanged, booking_url NULL on each', () => {
    const db = seedAt0012();
    const before = listsOf(db);
    expect(before).toHaveLength(2);
    expect(applyMigrations(db, MIGRATIONS_DIR).applied).toEqual([TAG]);
    expect(listsOf(db)).toEqual(before.map((r) => ({ ...r, booking_url: null })));
    expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('adds one nullable text column and no CHECK, and takes any string', () => {
    const db = freshDb();
    expect(
      db.raw
        .prepare('SELECT name, type, "notnull" FROM pragma_table_info(?) WHERE name = ?')
        .all('flight_lists', 'booking_url'),
    ).toEqual([{ name: 'booking_url', type: 'TEXT', notnull: 0 }]);
    const sql = db.raw
      .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'flight_lists'")
      .get()?.sql;
    expect(sql).not.toContain('flight_lists_booking_url');
    db.raw.prepare(DEFINITION).run({ at: T0 });
    const insert = db.raw.prepare(
      `${LIST.replace('options_other_cell)', 'options_other_cell, booking_url)').replace(', 0, 0)', ', 0, 0, @url)')}`,
    );
    // why: CodeRabbit PR #58 finding 27: the booking address, an empty string and a string that is no address at all
    // all go in and come back as written, so a column that constrained its value fails here; each its own departure
    // day, so no uniqueness rule refuses one in its place
    const urls = [SYNTHETIC_BOOKING_URL, '', 'not a booking address'];
    for (const [i, url] of urls.entries())
      insert.run({
        at: T0,
        dep: `2027-03-1${4 + i}`,
        status: 'read',
        reason: null,
        listed: 'flights',
        min: 45100,
        url,
      });
    expect(db.raw.prepare('SELECT booking_url FROM flight_lists ORDER BY departure_date').all()).toEqual(
      urls.map((booking_url) => ({ booking_url })),
    );
  });

  it('the journal lists 14 tags with this one last, and its snapshot follows 0012’s and carries the column', () => {
    const journal: { entries: Array<{ idx: number; tag: string }> } = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
    );
    expect(journal.entries).toHaveLength(14);
    expect(journal.entries.at(-1)).toMatchObject({ idx: 13, tag: TAG });
    const read = (n: string) =>
      JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', `${n}_snapshot.json`), 'utf8'));
    const snapshot = read('0013');
    expect(snapshot.prevId).toBe(read('0012').id);
    expect(snapshot.tables.flight_lists.columns.booking_url).toMatchObject({
      type: 'text',
      notNull: false,
    });
  });
});
