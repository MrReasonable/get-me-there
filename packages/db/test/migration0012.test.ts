// Migration 0012 (WP21, spec revision 56 §7): flight_lists gains the return read's and the booking read's columns,
// provider_requests gains page_count, and flight_list_attempts / flight_list_returns / flight_list_offers arrive with the
// CHECKs the contract holds. Additive only: a world seeded at 0011 comes through with every old column unchanged and
// every new one NULL (each change is an ADD COLUMN or a CREATE TABLE, so no row is copied).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { freshDb, openTracked, T0, tmpDbPath } from './helpers/db.js';
import { migrationsWithout } from './helpers/migrations.js';

beforeEach(() => {
  expect.hasAssertions();
});

const TAG = '0012_wp21_return_leg';
const SEEDED = [
  'search_definitions',
  'search_executions',
  'flight_lists',
  'flight_list_flights',
  'provider_requests',
] as const;
/** The columns 0012 adds, each NULL on every row stored before it. */
const ADDED: Record<string, readonly string[]> = {
  flight_lists: [
    'return_status',
    'return_rule',
    'return_limits_json',
    'return_tried_all',
    'booking_status',
    'booking_rule',
    'booking_attempt',
    'booking_return_position',
    'booking_expanded',
    'booking_more_control',
    'booking_grouped',
    'booking_unparsed',
    'booking_non_gbp',
    'booking_offers_stated',
  ],
  provider_requests: ['page_count'],
};
const NEW_TABLES = ['flight_list_attempts', 'flight_list_returns', 'flight_list_offers'] as const;
const DEFINITION = `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin,
    constraints_json, verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
   VALUES ('d1', 'London to New York', '["LHR"]', '["JFK"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 10, 'economy', '{}',
    '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', '{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}',
    '{"discovery":["camoufox"],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 0, @at, @at)`;

/** A flight list insert with every 0011 column given, `over` replacing or adding any column. */
function listRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
}
const FAILED = { status: 'failed', reason: 'parse', listed: null, min_minor: null, cheapest_view: null };
/** A return phase's columns as a finished read stores them (the D1 accepting case: all three coupled columns set). */
const RETURN_PHASE = {
  return_status: 'read',
  return_rule: null,
  return_limits_json: '{"maxJourneyMinutes":null,"departureWindowLocal":null,"arrivalWindowLocal":null}',
  return_tried_all: 0,
};
/** A booking read's columns beside it. */
const BOOKING = {
  booking_status: 'read',
  booking_rule: null,
  booking_attempt: 0,
  booking_return_position: 0,
  booking_expanded: 1,
  booking_more_control: 0,
  booking_grouped: 0,
  booking_unparsed: 0,
  booking_non_gbp: 0,
  booking_offers_stated: null,
};
/** No return phase, and no booking read. */
const NO_RETURN = Object.fromEntries(Object.keys(RETURN_PHASE).map((k) => [k, null]));
const NO_BOOKING = Object.fromEntries(Object.keys(BOOKING).map((k) => [k, null]));
const attemptRow = (over: Record<string, unknown> = {}) => ({
  list_id: 1,
  attempt: 0,
  outbound_position: 0,
  outbound_fits: 1,
  listed: 'returns',
  more_listed: 1,
  options_unparsed: 0,
  options_other_cell: 0,
  results_stated: null,
  ...over,
});
const returnRow = (over: Record<string, unknown> = {}) => ({
  list_id: 1,
  attempt: 0,
  position: 0,
  departs_local: '18:05',
  arrives_local: '06:20',
  arrives_day_offset: 1,
  duration_minutes: 435,
  stops: 0,
  carriers_json: '["QQ Atlantic"]',
  operated_by: null,
  from_pence: 45100,
  ...over,
});
const offerRow = (over: Record<string, unknown> = {}) => ({
  list_id: 1,
  position: 0,
  seller: 'QQ Travel',
  fare: null,
  price_pence: 45100,
  ...over,
});

function insert(db: Db, table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  db.raw
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`)
    .run(row);
}

/**
 * What a write is refused by: the named CHECK, or the SQLite code of any other constraint, or null when it is written.
 * Anything but a SQLite error is rethrown, so a wrong failure never passes.
 */
function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (!(e instanceof Database.SqliteError)) throw e;
    const check = /CHECK constraint failed: ([a-z_]+)/.exec(e.message);
    return check?.[1] ?? e.code;
  }
}

/** A database at 0011 with a definition, a completed run, a read list of two flights, a failed list and a camoufox ledger row. */
function seedAt0011(): Db {
  const db = openTracked(tmpDbPath());
  applyMigrations(db, migrationsWithout([TAG]));
  db.raw.prepare(DEFINITION).run({ at: T0 });
  db.raw
    .prepare(
      `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at, started_at, finished_at, flight_lists_json)
       VALUES ('e-done', 'd1', '{}', 'manual', 'completed', @at, @at, @at, '{"planned":1,"cells":[],"reused":0,"ended":null}')`,
    )
    .run({ at: T0 });
  insert(db, 'flight_lists', listRow({ execution_id: 'e-done', results_stated: 12, tab_minor: 45100 }));
  insert(db, 'flight_list_flights', {
    list_id: 1,
    position: 0,
    departs_local: '09:40',
    arrives_local: '12:35',
    arrives_day_offset: 0,
    duration_minutes: 475,
    stops: 0,
    carriers_json: '["QQ Air"]',
    operated_by: null,
    price_pence: 45100,
  });
  insert(db, 'flight_list_flights', {
    list_id: 1,
    position: 1,
    departs_local: '18:40',
    arrives_local: '07:05',
    arrives_day_offset: 1,
    duration_minutes: 625,
    stops: 1,
    carriers_json: '["QQ Air","QQ Atlantic"]',
    operated_by: 'QQ Atlantic',
    price_pence: 47250,
  });
  insert(db, 'flight_lists', listRow({ ...FAILED, execution_id: 'e-done', departure_date: '2027-03-15' }));
  db.raw
    .prepare(
      `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms, http_status, outcome,
        billable, cost_micro_gbp, http_attempt, page_class)
       VALUES ('camoufox', 'e-done', '/v1/flights', NULL, @at, @at, 5, 200, 'ok', 0, 0, 1, 'page')`,
    )
    .run({ at: T0 });
  return db;
}

type Row = Record<string, unknown>;
const rowsOf = (db: Db): Record<string, Row[]> =>
  Object.fromEntries(
    SEEDED.map((t) => [t, db.raw.prepare<[], Row>(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
const countOf = (db: Db, table: string) =>
  db.raw.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n;

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

/** A fresh database with the definition and one read list (id 1) carrying a finished return phase and booking read. */
function withList(over: Record<string, unknown> = {}): Db {
  const db = freshDb();
  db.raw.prepare(DEFINITION).run({ at: T0 });
  insert(db, 'flight_lists', listRow({ ...RETURN_PHASE, ...BOOKING, ...over }));
  return db;
}

describe('migration 0012 (spec revision 56 §7)', () => {
  it('keeps every row of a world seeded at 0011 byte-equal on its old columns, every new column NULL, and no new row', () => {
    const db = seedAt0011();
    const before = rowsOf(db);
    expect(applyMigrations(db, MIGRATIONS_DIR).applied).toEqual([TAG]);
    const after = rowsOf(db);
    for (const t of SEEDED) {
      expect(after[t]?.length, t).toBe(before[t]?.length);
      const added = Object.fromEntries((ADDED[t] ?? []).map((c) => [c, null]));
      expect(after[t], t).toEqual(before[t]?.map((r) => ({ ...r, ...added })));
    }
    for (const t of NEW_TABLES) expect(countOf(db, t), t).toBe(0);
    expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('adds the columns and the three tables of the spec, keyed as it says', () => {
    const db = freshDb();
    const added = (t: string) =>
      columnsOf(db, t)
        .filter((c) => ADDED[t]?.includes(c.name))
        .map((c) => [c.name, c.type, c.notnull]);
    expect(added('flight_lists')).toEqual([
      ['return_status', 'TEXT', 0],
      ['return_rule', 'TEXT', 0],
      ['return_limits_json', 'TEXT', 0],
      ['return_tried_all', 'INTEGER', 0],
      ['booking_status', 'TEXT', 0],
      ['booking_rule', 'TEXT', 0],
      ['booking_attempt', 'INTEGER', 0],
      ['booking_return_position', 'INTEGER', 0],
      ['booking_expanded', 'INTEGER', 0],
      ['booking_more_control', 'INTEGER', 0],
      ['booking_grouped', 'INTEGER', 0],
      ['booking_unparsed', 'INTEGER', 0],
      ['booking_non_gbp', 'INTEGER', 0],
      ['booking_offers_stated', 'INTEGER', 0],
    ]);
    expect(added('provider_requests')).toEqual([['page_count', 'INTEGER', 0]]);
    expect(columnsOf(db, 'flight_list_attempts').map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['list_id', 'INTEGER', 1, 1],
      ['attempt', 'INTEGER', 1, 2],
      ['outbound_position', 'INTEGER', 1, 0],
      ['outbound_fits', 'INTEGER', 1, 0],
      ['listed', 'TEXT', 1, 0],
      ['more_listed', 'INTEGER', 1, 0],
      ['options_unparsed', 'INTEGER', 1, 0],
      ['options_other_cell', 'INTEGER', 1, 0],
      ['results_stated', 'INTEGER', 0, 0],
    ]);
    expect(columnsOf(db, 'flight_list_returns').map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['list_id', 'INTEGER', 1, 1],
      ['attempt', 'INTEGER', 1, 2],
      ['position', 'INTEGER', 1, 3],
      ['departs_local', 'TEXT', 1, 0],
      ['arrives_local', 'TEXT', 1, 0],
      ['arrives_day_offset', 'INTEGER', 1, 0],
      ['duration_minutes', 'INTEGER', 1, 0],
      ['stops', 'INTEGER', 1, 0],
      ['carriers_json', 'TEXT', 1, 0],
      ['operated_by', 'TEXT', 0, 0],
      ['from_pence', 'INTEGER', 1, 0],
    ]);
    expect(columnsOf(db, 'flight_list_offers').map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['list_id', 'INTEGER', 1, 1],
      ['position', 'INTEGER', 1, 2],
      ['seller', 'TEXT', 1, 0],
      ['fare', 'TEXT', 0, 0],
      ['price_pence', 'INTEGER', 1, 0],
    ]);
    const fks = (t: string) =>
      db.raw
        .prepare<[string], { table: string; from: string; to: string; on_delete: string }>(
          'SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list(?) ORDER BY id, seq',
        )
        .all(t);
    expect(fks('flight_list_attempts')).toEqual([
      { table: 'flight_lists', from: 'list_id', to: 'id', on_delete: 'CASCADE' },
    ]);
    expect(fks('flight_list_returns')).toEqual([
      { table: 'flight_list_attempts', from: 'list_id', to: 'list_id', on_delete: 'CASCADE' },
      { table: 'flight_list_attempts', from: 'attempt', to: 'attempt', on_delete: 'CASCADE' },
    ]);
    expect(fks('flight_list_offers')).toEqual([
      { table: 'flight_lists', from: 'list_id', to: 'id', on_delete: 'CASCADE' },
    ]);
  });

  it('accepts a read list with a finished return phase and booking read, its attempt, return and offer, and a list with neither', () => {
    const db = withList();
    expect(refusal(() => insert(db, 'flight_list_attempts', attemptRow()))).toBeNull();
    expect(refusal(() => insert(db, 'flight_list_returns', returnRow()))).toBeNull();
    expect(
      refusal(() => insert(db, 'flight_list_returns', returnRow({ position: 1, arrives_day_offset: -1 }))),
    ).toBeNull();
    expect(refusal(() => insert(db, 'flight_list_offers', offerRow({ fare: 'Economy Light' })))).toBeNull();
    expect(
      refusal(() => insert(db, 'flight_list_offers', offerRow({ position: 1, seller: 'Q'.repeat(80) }))),
    ).toBeNull();
    expect(refusal(() => insert(db, 'flight_lists', listRow()))).toBeNull();
    // a rule on a transient end, and on a read whose second attempt ended early
    expect(
      refusal(() =>
        insert(db, 'flight_lists', listRow({ ...RETURN_PHASE, return_rule: 'reload:not-settled' })),
      ),
    ).toBeNull();
    expect(
      refusal(() =>
        insert(
          db,
          'flight_lists',
          listRow({ ...RETURN_PHASE, return_status: 'skipped', return_rule: 'monthly-headroom' }),
        ),
      ),
    ).toBeNull();
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['a read return status with no limits', { return_limits_json: null }, 'flight_lists_return_coupled_ck'],
    [
      'return_tried_all NULL with a return status',
      { return_tried_all: null },
      'flight_lists_return_coupled_ck',
    ],
    ['an unknown return status', { return_status: 'maybe' }, 'flight_lists_return_status_ck'],
    [
      'a rule not in token form',
      { return_status: 'skipped', return_rule: 'Select' },
      'flight_lists_return_rule_ck',
    ],
    [
      'a rule on no-outbound',
      { return_status: 'no-outbound', return_rule: 'spacing' },
      'flight_lists_return_rule_status_ck',
    ],
    [
      'a rule with no return phase',
      { ...NO_RETURN, ...NO_BOOKING, return_rule: 'spacing' },
      'flight_lists_return_rule_status_ck',
    ],
    ['limits that are not a JSON object', { return_limits_json: '[]' }, 'flight_lists_return_limits_ck'],
    ['a return phase on a failed list', FAILED, 'flight_lists_return_read_ck'],
    [
      'booking_expanded NULL with a booking status',
      { booking_expanded: null },
      'flight_lists_booking_coupled_ck',
    ],
    ['a booking read with no return phase', NO_RETURN, 'flight_lists_booking_return_ck'],
    ['an unknown booking status', { booking_status: 'maybe' }, 'flight_lists_booking_status_ck'],
    [
      'a booking rule not in token form',
      { booking_status: 'skipped', booking_rule: 'Spacing' },
      'flight_lists_booking_rule_ck',
    ],
    [
      'a negative booking position',
      { booking_return_position: -1 },
      'flight_lists_booking_return_position_ck',
    ],
  ])('flight_lists refuses %s', (_, over, ck) => {
    const db = withList();
    expect(refusal(() => insert(db, 'flight_lists', listRow({ ...RETURN_PHASE, ...BOOKING, ...over })))).toBe(
      ck,
    );
  });

  it.each<[string, string, Record<string, unknown>, string]>([
    [
      'an outbound position of -1',
      'flight_list_attempts',
      attemptRow({ outbound_position: -1 }),
      'flight_list_attempts_outbound_position_ck',
    ],
    ['attempt 2', 'flight_list_attempts', attemptRow({ attempt: 2 }), 'flight_list_attempts_attempt_ck'],
    [
      'an unknown listed word',
      'flight_list_attempts',
      attemptRow({ listed: 'flights' }),
      'flight_list_attempts_listed_ck',
    ],
    [
      'an arrival two days before',
      'flight_list_returns',
      returnRow({ arrives_day_offset: -2 }),
      'flight_list_returns_offset_ck',
    ],
    [
      'a return whose attempt row does not exist',
      'flight_list_returns',
      returnRow({ attempt: 1 }),
      'SQLITE_CONSTRAINT_FOREIGNKEY',
    ],
    [
      'a return "from" price of 0',
      'flight_list_returns',
      returnRow({ from_pence: 0 }),
      'flight_list_returns_from_ck',
    ],
    [
      'an offer price of 0',
      'flight_list_offers',
      offerRow({ price_pence: 0 }),
      'flight_list_offers_price_ck',
    ],
    [
      'an 81-character seller',
      'flight_list_offers',
      offerRow({ seller: 'Q'.repeat(81) }),
      'flight_list_offers_seller_ck',
    ],
    ['an empty fare', 'flight_list_offers', offerRow({ fare: '' }), 'flight_list_offers_fare_ck'],
  ])('%s is refused', (_, table, row, ck) => {
    const db = withList();
    insert(db, 'flight_list_attempts', attemptRow());
    expect(refusal(() => insert(db, table, row))).toBe(ck);
  });

  it('page_count: refuses -1 and any value on a row of another provider, and accepts 0 on a camoufox row', () => {
    const db = freshDb();
    const ledger = (provider: string, pageCount: number | null) =>
      refusal(() =>
        db.raw
          .prepare(
            `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, cost_micro_gbp, http_attempt, page_count)
             VALUES (?, '/v1/flights', ?, 'pending', 0, 1, ?)`,
          )
          .run(provider, T0, pageCount),
      );
    expect(ledger('camoufox', -1)).toBe('provider_requests_page_count_ck');
    expect(ledger('travelpayouts', 1)).toBe('provider_requests_page_count_ck');
    expect(ledger('camoufox', 0)).toBeNull();
    expect(ledger('camoufox', 2)).toBeNull();
    expect(ledger('travelpayouts', null)).toBeNull();
  });

  it('a list deleted takes its attempts, their returns and its offers', () => {
    const db = withList();
    insert(db, 'flight_list_attempts', attemptRow());
    insert(db, 'flight_list_returns', returnRow());
    insert(db, 'flight_list_offers', offerRow());
    db.raw.prepare('DELETE FROM flight_lists WHERE id = 1').run();
    for (const t of NEW_TABLES) expect(countOf(db, t), t).toBe(0);
  });

  it('the journal names the tag at entry 12, and its snapshot follows 0011’s and names every CHECK the database carries', () => {
    const db = freshDb();
    const journal: { entries: Array<{ idx: number; tag: string }> } = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
    );
    expect(journal.entries.find((e) => e.idx === 12)?.tag).toBe(TAG);
    const read = (n: string) =>
      JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', `${n}_snapshot.json`), 'utf8'));
    const snapshot = read('0012');
    expect(snapshot.prevId).toBe(read('0011').id);
    for (const t of ['flight_lists', ...NEW_TABLES, 'provider_requests'])
      expect(Object.keys(snapshot.tables[t].checkConstraints).sort(), t).toEqual(checksOf(db, t).sort());
    for (const t of ['flight_lists', ...NEW_TABLES, 'provider_requests'])
      expect(Object.keys(snapshot.tables[t].columns), t).toEqual(columnsOf(db, t).map((c) => c.name));
  });
});
