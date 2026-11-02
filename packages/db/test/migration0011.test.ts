// Migration 0011 (WP20, spec revision 55 §7): search_executions gains stop_cause_json and flight_lists_json, NULL on
// every existing row, and the flight_lists / flight_list_flights tables arrive with the CHECKs the contract holds. A
// world seeded at 0010 comes through unchanged (the two columns are ADD COLUMNs, so no row is copied).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { freshDb, openTracked, sqliteCode, T0, tmpDbPath } from './helpers/db.js';
import { migrationsWithout } from './helpers/migrations.js';

beforeEach(() => {
  expect.hasAssertions();
});

const TAG = '0011_wp20_flight_lists';
// why: 0012 (WP21) builds on 0011's tables, so a world at 0010 lacks it too and gets it after 0011
const NEXT = '0012_wp21_return_leg';
const SEEDED = ['search_definitions', 'search_executions', 'calendar_prices', 'provider_requests'] as const;

/** A database at 0010 with a definition, a paused run holding the old free-text error, a completed run, a price, a ledger row. */
function seedAt0010(): Db {
  const db = openTracked(tmpDbPath());
  applyMigrations(db, migrationsWithout([TAG, NEXT]));
  const run = (sql: string): void => {
    db.raw.prepare(sql).run({ at: T0 });
  };
  run(`INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
      verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
     VALUES ('d1', 'London to New York', '["LHR"]', '["JFK"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 10, 'economy', '{}',
      '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', '{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}',
      '{"discovery":["travelpayouts"],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 0, @at, @at)`);
  run(`INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at, started_at, error_text, paused_at)
     VALUES ('e-paused', 'd1', '{}', 'manual', 'paused_error', @at, @at, 'paused: error', @at)`);
  run(`INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at, started_at, finished_at)
     VALUES ('e-done', 'd1', '{}', 'manual', 'completed', @at, @at, @at)`);
  run(`INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence,
      price_native_minor, currency_native, fx_converted, point_of_sale, fetched_at, max_age_hours, return_date_source)
     VALUES ('e-done', 'travelpayouts', 'authorised-cached', 'economy', 'LHR', 'JFK', '2027-03-14', '2027-03-24', 45100, 45100, 'GBP', 0, 'unknown', @at, 48, 'vendor')`);
  run(`INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms, http_status, outcome,
      billable, cost_micro_gbp, http_attempt)
     VALUES ('travelpayouts', 'e-done', '/aviasales/v3/prices_for_dates', 0, @at, @at, 5, 200, 'ok', 0, 0, 1)`);
  return db;
}

type Row = Record<string, unknown>;
const rowsOf = (db: Db): Record<string, Row[]> =>
  Object.fromEntries(
    SEEDED.map((t) => [t, db.raw.prepare<[], Row>(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );

const columnsOf = (db: Db, table: string) =>
  db.raw
    .prepare<[string], { name: string; type: string; notnull: number; pk: number }>(
      'SELECT name, type, "notnull", pk FROM pragma_table_info(?)',
    )
    .all(table);

/** The CONSTRAINT names a table's stored SQL carries (the CHECKs). */
const checksOf = (db: Db, table: string): string[] =>
  (
    db.raw
      .prepare<[string], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
      ?.sql.match(/CONSTRAINT "([a-z_]+)"/g) ?? []
  ).map((m) => m.slice(12, -1));

/** A flight list insert with every column given, `over` replacing any of them. */
function insertList(db: Db, over: Record<string, unknown> = {}): string | null {
  const row = {
    definition_id: 'd1',
    execution_id: null,
    provider_id: 'camoufox',
    source_kind: 'scraped-self',
    cabin: 'economy',
    origin: 'LHR',
    destination: 'JFK',
    departure_date: '2027-03-14',
    return_date: '2027-03-24',
    fetched_at: T0,
    point_of_sale: 'GB',
    currency_native: 'GBP',
    status: 'read',
    reason: null,
    listed: 'flights',
    min_minor: 45100,
    tab_minor: null,
    cheapest_view: 'cheapest',
    options_unparsed: 0,
    options_other_cell: 0,
    results_stated: null,
    ...over,
  };
  const cols = Object.keys(row);
  return sqliteCode(() =>
    db.raw
      .prepare(
        `INSERT INTO flight_lists (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
      )
      .run(row),
  );
}

/** A flight insert into list 1, `over` replacing any column. */
function insertFlight(db: Db, over: Record<string, unknown> = {}): string | null {
  const row = {
    list_id: 1,
    position: 0,
    departs_local: '09:40',
    arrives_local: '12:35',
    arrives_day_offset: 0,
    duration_minutes: 475,
    stops: 0,
    carriers_json: '["Example Air"]',
    operated_by: null,
    price_pence: 45100,
    ...over,
  };
  const cols = Object.keys(row);
  return sqliteCode(() =>
    db.raw
      .prepare(
        `INSERT INTO flight_list_flights (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
      )
      .run(row),
  );
}

describe('migration 0011 (spec revision 55 §7)', () => {
  it('keeps every row of a world seeded at 0010, with the two new execution columns NULL on every one', () => {
    const db = seedAt0010();
    const before = rowsOf(db);
    expect(applyMigrations(db, MIGRATIONS_DIR).applied).toEqual([TAG, NEXT]);
    const after = rowsOf(db);
    // why: every old column keeps its value (the paused run's free-text error_text included); only the two new ones appear
    for (const t of SEEDED) {
      expect(after[t]?.length, t).toBe(before[t]?.length);
      // why: provider_requests' page_count is 0012's, applied after this one (NEXT), NULL on the seeded row as well
      const added =
        t === 'search_executions'
          ? { stop_cause_json: null, flight_lists_json: null }
          : t === 'provider_requests'
            ? { page_count: null }
            : {};
      expect(after[t], t).toEqual(before[t]?.map((r) => ({ ...r, ...added })));
    }
    expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('adds the two tables with the columns of the spec, and the two indexes', () => {
    const db = freshDb();
    // why: 0012 (WP21) appends the return and booking columns after 0011's own; its test pins them
    const since0012 = ['return_status', 'return_rule', 'return_limits_json', 'return_tried_all'];
    const of0011 = columnsOf(db, 'flight_lists').filter(
      (c) => !since0012.includes(c.name) && !c.name.startsWith('booking_'),
    );
    expect(of0011.map((c) => [c.name, c.type, c.notnull])).toEqual([
      ['id', 'INTEGER', 1],
      ['definition_id', 'TEXT', 1],
      ['execution_id', 'TEXT', 0],
      ['provider_id', 'TEXT', 1],
      ['source_kind', 'TEXT', 1],
      ['cabin', 'TEXT', 1],
      ['origin', 'TEXT', 1],
      ['destination', 'TEXT', 1],
      ['departure_date', 'TEXT', 1],
      ['return_date', 'TEXT', 1],
      ['fetched_at', 'TEXT', 1],
      ['point_of_sale', 'TEXT', 1],
      ['currency_native', 'TEXT', 1],
      ['status', 'TEXT', 1],
      ['reason', 'TEXT', 0],
      ['listed', 'TEXT', 0],
      ['min_minor', 'INTEGER', 0],
      ['tab_minor', 'INTEGER', 0],
      ['cheapest_view', 'TEXT', 0],
      ['options_unparsed', 'INTEGER', 1],
      ['options_other_cell', 'INTEGER', 1],
      ['results_stated', 'INTEGER', 0],
    ]);
    expect(columnsOf(db, 'flight_list_flights').map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['list_id', 'INTEGER', 1, 1],
      ['position', 'INTEGER', 1, 2],
      ['departs_local', 'TEXT', 1, 0],
      ['arrives_local', 'TEXT', 1, 0],
      ['arrives_day_offset', 'INTEGER', 1, 0],
      ['duration_minutes', 'INTEGER', 1, 0],
      ['stops', 'INTEGER', 1, 0],
      ['carriers_json', 'TEXT', 1, 0],
      ['operated_by', 'TEXT', 0, 0],
      ['price_pence', 'INTEGER', 1, 0],
    ]);
    const exec = columnsOf(db, 'search_executions');
    expect(exec.filter((c) => c.name === 'stop_cause_json' || c.name === 'flight_lists_json')).toEqual([
      { name: 'stop_cause_json', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'flight_lists_json', type: 'TEXT', notnull: 0, pk: 0 },
    ]);
    const idx = (name: string) =>
      db.raw
        .prepare<[string], { name: string; desc: number }>(
          'SELECT name, "desc" FROM pragma_index_xinfo(?) WHERE key = 1',
        )
        .all(name);
    expect(idx('flight_lists_cell_idx')).toEqual([
      { name: 'definition_id', desc: 0 },
      { name: 'origin', desc: 0 },
      { name: 'destination', desc: 0 },
      { name: 'departure_date', desc: 0 },
      { name: 'return_date', desc: 0 },
      { name: 'cabin', desc: 0 },
      { name: 'point_of_sale', desc: 0 },
      { name: 'fetched_at', desc: 1 },
      { name: 'id', desc: 1 },
    ]);
    expect(idx('flight_lists_execution_idx')).toEqual([{ name: 'execution_id', desc: 0 }]);
  });

  it('refuses a stored cause or plan that is not a JSON object', () => {
    const db = seedAt0010();
    applyMigrations(db, MIGRATIONS_DIR);
    const set = (col: string, v: string) =>
      sqliteCode(() =>
        db.raw.prepare(`UPDATE search_executions SET ${col} = ? WHERE id = 'e-paused'`).run(v),
      );
    expect(set('stop_cause_json', 'paused: error')).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(set('stop_cause_json', '["cancelled"]')).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(set('stop_cause_json', '{"kind":"cancelled"}')).toBeNull();
    expect(set('flight_lists_json', '3')).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(set('flight_lists_json', '{"planned":0,"cells":[],"reused":0,"ended":null}')).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['another provider', { provider_id: 'searchapi' }],
    ['a synthetic source', { source_kind: 'synthetic' }],
    ['another cabin', { cabin: 'business' }],
    ['another currency', { currency_native: 'EUR' }],
    ['a fetch time not in ISO form', { fetched_at: '2026-10-14 12:00' }],
    ['a lower-case point of sale', { point_of_sale: 'gb' }],
    ['a failed list with no reason', { status: 'failed', listed: null, reason: null }],
    ['a read list with a reason', { reason: 'parse' }],
    ['a read list with nothing listed', { listed: null }],
    ['a reason outside STOP_DETAILS', { status: 'failed', listed: null, reason: 'it broke' }],
    ['an unknown listed word', { listed: 'some' }],
    ['a lower-case airport', { origin: 'lhr' }],
    ['a date not in ISO form', { departure_date: '14/03/2027' }],
    ['a minimum of 0', { min_minor: 0 }],
    ['a tab amount of 0', { tab_minor: 0 }],
    ['an unknown view', { cheapest_view: 'best' }],
    ['a negative count', { options_unparsed: -1 }],
  ])('flight_lists refuses %s', (_, over) => {
    const db = freshDb();
    db.raw
      .prepare(`INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
      verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
     SELECT 'd1', 'n', '[]', '[]', '{}', 1, 1, 'economy', '{}', '{}', '{}', '{}', 'UTC', 0, @at, @at`)
      .run({ at: T0 });
    expect(insertList(db)).toBeNull();
    expect(insertList(db, over)).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insertList(db, { status: 'failed', listed: null, reason: 'monthly-cap' })).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['an arrival four days on', { arrives_day_offset: 4 }],
    ['a journey of 0 minutes', { duration_minutes: 0 }],
    ['a fractional price', { price_pence: 478.5 }],
    ['a price of 0', { price_pence: 0 }],
    ['negative stops', { stops: -1 }],
    ['a negative position', { position: -1 }],
    ['a departure not HH:MM', { departs_local: '9:40' }],
    ['carriers that are not a JSON array', { carriers_json: '"Example Air"' }],
    ['carriers that are not JSON', { carriers_json: 'Example Air' }],
  ])('flight_list_flights refuses %s, and a list deleted takes its flights', (_, over) => {
    const db = freshDb();
    db.raw
      .prepare(`INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
      verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
     SELECT 'd1', 'n', '[]', '[]', '{}', 1, 1, 'economy', '{}', '{}', '{}', '{}', 'UTC', 0, @at, @at`)
      .run({ at: T0 });
    expect(insertList(db)).toBeNull();
    expect(insertFlight(db, { position: 1, ...over })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insertFlight(db)).toBeNull();
    expect(insertFlight(db, { position: 1, arrives_day_offset: 3 })).toBeNull();
    db.raw.prepare('DELETE FROM flight_lists').run();
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM flight_list_flights').get()).toEqual({ n: 0 });
  });

  it('the 0011 snapshot drizzle-kit wrote names every CHECK the database carries, so a later generate has no diff', () => {
    const db = freshDb();
    const snapshot = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '0011_snapshot.json'), 'utf8'));
    // why: 0012 (WP21) adds the return and booking CHECKs to flight_lists; its test pins them against the 0012 snapshot
    const since0012 = [
      ...['status', 'rule', 'limits', 'tried_all', 'coupled', 'rule_status', 'read'].map(
        (c) => `flight_lists_return_${c}_ck`,
      ),
      ...[
        'status',
        'rule',
        'attempt',
        'return_position',
        'expanded',
        'more_control',
        'grouped',
        'unparsed',
        'non_gbp',
      ]
        .concat(['offers_stated', 'coupled', 'return'])
        .map((c) => `flight_lists_booking_${c}_ck`),
    ];
    for (const t of ['search_executions', 'flight_lists', 'flight_list_flights'])
      expect(Object.keys(snapshot.tables[t].checkConstraints).sort(), t).toEqual(
        checksOf(db, t)
          .filter((c) => !since0012.includes(c))
          .sort(),
      );
    expect(Object.keys(snapshot.tables.search_executions.columns)).toEqual(
      columnsOf(db, 'search_executions').map((c) => c.name),
    );
  });
});
