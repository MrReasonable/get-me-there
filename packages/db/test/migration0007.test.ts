// Migration 0007 (spec §7, §8.2 rev 36; plan decisions 79, 82 and 83; WP16a Task 16a.1): the firing a scheduled row
// stands for, the catch-up flag, the browser window's end, the skip code, the firing unique index, cell_outcomes rebuilt
// for the skip reason scheduled_only and its detail, operator_notifications rebuilt for the browser_window kind, and
// app_meta for the app-instance id. Synthetic rows only; the worked example, London → New York.
import { readFileSync, writeFileSync } from 'node:fs';
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

const DEFINITION = `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
    verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
   VALUES (@id, 'London to New York', '["LHR"]', '["JFK"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 10, 'economy', '{}',
    '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', '{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}',
    '{"discovery":["travelpayouts"],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 1, @at, @at)`;
const EXECUTION = `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at, finished_at)
   VALUES (@id, @definitionId, '{"budget":{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}}', @trigger, @status, @at, @at)`;
const CELL = `INSERT INTO search_cells (execution_id, origin, destination, departure_date, return_date) VALUES (@executionId, 'LHR', 'JFK', @dep, '2027-03-24')`;

const T1 = '2026-10-01T05:00:00.000Z';
const T2 = '2026-10-08T05:00:00.000Z';
const HASH = 'a'.repeat(64);

/**
 * A database at 0006 holding one row in every table that references search_executions or is rebuilt by 0007 (WP16a
 * review R25): six executions across two definitions (completed, paused_budget with resume_after and estimate,
 * interrupted child, skipped_missed, running, cancelled tool run), search cells with a best observation, an
 * itinerary, a fare offer and its observation, calendar prices (one reused), eight cell outcomes (one reused), ledger
 * rows (billable and not, pending) and operator notifications (with and without an execution).
 */
function populatedAt0006(): Db {
  const db = openTracked(tmpDbPath());
  applyMigrations(
    db,
    migrationsWithout(['0007_catch_up', '0008_wp18_error_kind', '0009_wp19_latest_price_idx']),
  );
  const run = (sql: string, p: Record<string, unknown> = {}) => db.raw.prepare(sql).run(p);
  const def = `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin,
      constraints_json, verification_policy_json, budget_json, providers_json, schedule_cron, schedule_tz, enabled, created_at, updated_at)
    VALUES (@id, 'London to New York', '["LHR","LGW"]', '["JFK","EWR"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}',
      10, 10, 'economy', '{}', '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}',
      '{"maxCalls":100,"maxFreeCalls":10,"maxCostMicroGbp":0}',
      '{"discovery":["travelpayouts","camoufox"],"verification":["searchapi"],"discoveryRefreshHours":{}}', '0 6 * * 1',
      'Europe/London', 1, @at, @at)`;
  run(def, { id: 'd1', at: T1 });
  run(def, { id: 'd2', at: T1 });
  const ex = `INSERT INTO search_executions (id, definition_id, is_child, child_origin, child_destination, child_departure_date,
      child_return_date, definition_snapshot_json, trigger, status, stage, estimate_json, cancel_requested, resume_after,
      auto_resume_count, created_at, started_at, finished_at, error_text)
    VALUES (@id, @def, @child, @o, @d, @dep, @ret, '{"budget":{"maxCalls":100}}', @trigger, @status, @stage, @est, @cancel, @ra,
      @arc, @created, @started, @finished, @err)`;
  const base = {
    child: 0,
    o: null,
    d: null,
    dep: null,
    ret: null,
    stage: null,
    est: null,
    cancel: 0,
    ra: null,
    arc: 0,
  };
  const none = { started: null, finished: null, err: null };
  run(ex, {
    ...base,
    ...none,
    id: 'e1',
    def: 'd1',
    trigger: 'schedule',
    status: 'completed',
    stage: 'verification',
    est: '{"seconds":3600,"perProvider":[]}',
    created: T1,
    started: T1,
    finished: T2,
  });
  run(ex, {
    ...base,
    ...none,
    id: 'e2',
    def: 'd1',
    trigger: 'schedule',
    status: 'paused_budget',
    stage: 'discovery',
    est: '{"seconds":1200,"perProvider":[]}',
    ra: '2026-11-01T00:00:00.000Z',
    arc: 2,
    created: T2,
    started: T2,
    err: 'cap',
  });
  run(ex, {
    ...base,
    ...none,
    id: 'e3',
    def: 'd1',
    child: 1,
    o: 'LHR',
    d: 'JFK',
    dep: '2027-03-14',
    ret: '2027-03-24',
    trigger: 'manual',
    status: 'interrupted',
    created: T2,
    started: T2,
  });
  run(ex, {
    ...base,
    ...none,
    id: 'e4',
    def: 'd1',
    trigger: 'schedule',
    status: 'skipped_missed',
    created: T2,
    finished: T2,
  });
  run(ex, {
    ...base,
    ...none,
    id: 'e5',
    def: 'd2',
    trigger: 'manual',
    status: 'running',
    stage: 'discovery',
    created: T2,
    started: T2,
  });
  run(ex, {
    ...base,
    ...none,
    id: 'e6',
    def: 'd2',
    trigger: 'tool',
    status: 'cancelled',
    cancel: 1,
    created: T1,
    started: T1,
    finished: T1,
    err: 'cancelled by operator',
  });
  const cell = `INSERT INTO search_cells (execution_id, origin, destination, departure_date, return_date, discovery_status,
      discovery_reason, discovery_min_pence, verification_selected, selection_reason, verification_status)
    VALUES (@e, 'LHR', 'JFK', @dep, '2027-03-24', @ds, @dr, @dm, @vs, @sr, @vst)`;
  const cb = { ds: null, dr: null, dm: null, vs: 0, sr: null, vst: null };
  for (const dep of ['2027-03-14', '2027-03-15']) {
    run(cell, { ...cb, e: 'e1', dep, ds: 'priced', dm: 45100, vs: 1, sr: 'top_n', vst: 'priced' });
    run(cell, { ...cb, e: 'e2', dep, ds: 'skipped', dr: 'budget' });
  }
  run(cell, { ...cb, e: 'e3', dep: '2027-03-14', ds: 'error' });
  run(
    `INSERT INTO itineraries (hash, origin, destination, departure_date, return_date, nights, stops_out, stops_in, carriers_json,
      layovers_json, first_seen_at) VALUES ('${HASH}', 'LHR', 'JFK', '2027-03-14', '2027-03-24', 10, 0, 0, '["VS"]', '[]', @at)`,
    { at: T1 },
  );
  run(
    `INSERT INTO fare_offers (itinerary_hash, provider_id, seller, cabin, first_seen_at, last_seen_at, first_price_pence,
      lowest_price_pence, highest_price_pence, latest_price_pence)
    VALUES ('${HASH}', 'searchapi', 'Example Air', 'economy', @at, @at, 46000, 46000, 46000, 46000)`,
    { at: T1 },
  );
  run(
    `INSERT INTO price_observations (offer_id, execution_id, source_kind, cabin, fetched_at, price_pence, price_native_minor,
      currency_native, fx_converted, point_of_sale, supplied_fields_json, partial_expansion)
    VALUES (1, 'e1', 'scraped-search', 'economy', @at, 46000, 46000, 'GBP', 0, 'GB', '["price"]', 0)`,
    { at: T1 },
  );
  run(
    `UPDATE search_cells SET best_observation_id = 1 WHERE execution_id = 'e1' AND departure_date = '2027-03-14'`,
  );
  const cp = `INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date,
      return_date, price_pence, price_native_minor, currency_native, fx_converted, point_of_sale, fetched_at, max_age_hours,
      reused_from_execution_id, return_date_source, vendor_price_mark)
    VALUES (@e, @p, @k, 'economy', 'LHR', 'JFK', @dep, '2027-03-24', 45100, 45100, 'GBP', 0, 'GB', @at, 48, @r, @src, @mark)`;
  run(cp, {
    e: 'e1',
    p: 'travelpayouts',
    k: 'authorised-cached',
    dep: '2027-03-14',
    at: T1,
    r: null,
    src: 'vendor',
    mark: null,
  });
  run(cp, {
    e: 'e1',
    p: 'camoufox',
    k: 'scraped-self',
    dep: '2027-03-15',
    at: T1,
    r: null,
    src: 'grid-cell',
    mark: 'low',
  });
  run(cp, {
    e: 'e2',
    p: 'camoufox',
    k: 'scraped-self',
    dep: '2027-03-15',
    at: T1,
    r: 'e1',
    src: 'grid-cell',
    mark: 'low',
  });
  const co = `INSERT INTO cell_outcomes (execution_id, origin, destination, departure_date, return_date, stage, provider_id, status,
      reason, attempts, last_error, fetched_at, min_pence, cabin, point_of_sale, source_kind, reused_from_execution_id)
    VALUES (@e, 'LHR', 'JFK', @dep, '2027-03-24', @st, @p, @s, @r, @a, @le, @f, @m, @c, @pos, @k, @ru)`;
  const ob = {
    st: 'discovery',
    r: null,
    a: 1,
    le: null,
    f: null,
    m: null,
    c: null,
    pos: null,
    k: null,
    ru: null,
  };
  const priced = { s: 'priced', f: T1, m: 45100, c: 'economy', pos: 'GB' };
  run(co, { ...ob, ...priced, e: 'e1', dep: '2027-03-14', p: 'travelpayouts', k: 'authorised-cached' });
  run(co, { ...ob, ...priced, e: 'e1', dep: '2027-03-15', p: 'camoufox', k: 'scraped-self' });
  run(co, {
    ...ob,
    ...priced,
    e: 'e1',
    dep: '2027-03-14',
    st: 'verification',
    p: 'searchapi',
    m: 46000,
    k: 'scraped-search',
  });
  run(co, {
    ...ob,
    e: 'e1',
    dep: '2027-03-15',
    st: 'verification',
    p: 'searchapi',
    s: 'no_data',
    r: 'cabin-not-offered',
  });
  run(co, { ...ob, ...priced, e: 'e2', dep: '2027-03-15', p: 'camoufox', k: 'scraped-self', ru: 'e1' });
  run(co, { ...ob, e: 'e2', dep: '2027-03-14', p: 'camoufox', s: 'skipped', r: 'budget', a: 0 });
  run(co, {
    ...ob,
    e: 'e2',
    dep: '2027-03-14',
    p: 'travelpayouts',
    s: 'skipped',
    r: 'provider_unavailable',
    a: 0,
    le: 'worker unreachable',
  });
  run(co, {
    ...ob,
    e: 'e3',
    dep: '2027-03-14',
    p: 'travelpayouts',
    s: 'error',
    r: 'timeout',
    a: 2,
    le: 'timed out',
  });
  run(
    `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms,
      http_status, outcome, billable, cost_micro_gbp, http_attempt, page_class, scroll_count)
    VALUES ('camoufox', 'e1', '/v1/page', 0, @at, @at, 5, 200, 'ok', 0, 0, 1, 'page', 7)`,
    { at: T1 },
  );
  run(
    `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms,
      http_status, outcome, billable, cost_micro_gbp, http_attempt)
    VALUES ('searchapi', 'e1', '/api/v1/search', 1, @at, @at, 9, 200, 'ok', 1, 3000, 1)`,
    { at: T1 },
  );
  run(
    `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, started_at, outcome, cost_micro_gbp, http_attempt)
    VALUES ('searchapi', NULL, '/api/v1/search', @at, 'pending', 0, 1)`,
    { at: T1 },
  );
  run(
    `INSERT INTO operator_notifications (kind, execution_id, definition_id, sent_at, status)
    VALUES ('skipped_missed', 'e4', 'd1', @at, 'sent')`,
    { at: T2 },
  );
  run(
    `INSERT INTO operator_notifications (kind, execution_id, definition_id, sent_at, status)
    VALUES ('crash_loop', NULL, 'd2', @at, 'failed')`,
    { at: T2 },
  );
  return db;
}

/** Every user table's rows in rowid order, with their rowid (sqlite_sequence included, the migrator's own table not). */
function everyRow(db: Db): Record<string, unknown[]> {
  const tables = db.raw
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('__drizzle_migrations', 'sqlite_sequence') ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  const out: Record<string, unknown[]> = {};
  for (const t of tables)
    out[t] = db.raw.prepare(`SELECT rowid AS _rowid, * FROM "${t}" ORDER BY rowid`).all();
  out.sqlite_sequence = db.raw.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
  return out;
}

/** The index definitions sqlite_master holds for `tables`. */
function indexesOf(db: Db, tables: readonly string[]): Array<{ name: string; sql: string | null }> {
  return db.raw
    .prepare<[], { name: string; sql: string | null; tbl_name: string }>(
      "SELECT name, sql, tbl_name FROM sqlite_master WHERE type = 'index' ORDER BY name",
    )
    .all()
    .filter((r) => tables.includes(r.tbl_name))
    .map(({ name, sql }) => ({ name, sql }));
}

describe('migration 0007 (spec §7 rev 36)', () => {
  it('keeps every row of every table of a populated 0006 database, rowids and sequences included: executions gain no firing, no catch-up flag, no window end and no skip code, and a paused or interrupted one its last activity as paused_at; outcomes no skip detail; app_meta starts empty', () => {
    const db = populatedAt0006();
    const before = everyRow(db);
    expect(before.search_executions).toHaveLength(6);
    expect(before.cell_outcomes).toHaveLength(8);
    expect(before.provider_requests).toHaveLength(3);
    expect(before.operator_notifications).toHaveLength(2);
    expect(
      applyMigrations(db, migrationsWithout(['0008_wp18_error_kind', '0009_wp19_latest_price_idx'])).applied,
    ).toEqual(['0007_catch_up']);
    const after = everyRow(db);
    expect(after).toEqual({
      ...before,
      search_executions: (before.search_executions ?? []).map((r) => {
        const e: {
          status: string;
          finished_at: string | null;
          started_at: string | null;
          created_at: string;
        } = Object(r);
        return {
          ...Object(r),
          scheduled_for: null,
          is_catch_up: 0,
          browser_window_end: null,
          skip_code: null,
          paused_at: ['paused_budget', 'paused_error', 'interrupted'].includes(e.status)
            ? (e.finished_at ?? e.started_at ?? e.created_at)
            : null,
        };
      }),
      cell_outcomes: (before.cell_outcomes ?? []).map((r) => ({ ...Object(r), skip_detail: null })),
      app_meta: [],
    });
    expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok');
    // a second apply is a no-op (for the migrations this test installed; 0008 is the next one)
    expect(
      applyMigrations(db, migrationsWithout(['0008_wp18_error_kind', '0009_wp19_latest_price_idx'])).applied,
    ).toEqual([]);
  });

  it('the rebuilt tables come back with the same indexes, plus only the firing unique index and the in-flight index', () => {
    const db = populatedAt0006();
    const rebuilt = ['search_executions', 'cell_outcomes', 'operator_notifications'] as const;
    const before = indexesOf(db, rebuilt);
    applyMigrations(db, MIGRATIONS_DIR);
    expect(indexesOf(db, rebuilt)).toEqual(
      [
        ...before,
        {
          name: 'search_executions_firing_uq',
          sql: 'CREATE UNIQUE INDEX `search_executions_firing_uq` ON `search_executions` (`definition_id`,`scheduled_for`) WHERE is_child = 0 AND scheduled_for IS NOT NULL',
        },
        {
          name: 'search_executions_in_flight_idx',
          sql: "CREATE INDEX `search_executions_in_flight_idx` ON `search_executions` (`created_at`) WHERE status IN ('pending', 'running')",
        },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  it('a 0007 that fails on its last statement rolls back whole: the 0006 schema and rows stand, seven migrations (0000–0006) recorded', () => {
    const db = populatedAt0006();
    const schema = () => db.raw.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
    const before = { schema: schema(), rows: everyRow(db) };
    const dir = migrationsWithout([]);
    const sqlPath = join(dir, '0007_catch_up.sql');
    writeFileSync(
      sqlPath,
      `${readFileSync(sqlPath, 'utf8')}--> statement-breakpoint\nSELECT no_such_column FROM app_meta;`,
    );
    expect(() => applyMigrations(db, dir)).toThrow(/migration failed/);
    expect({ schema: schema(), rows: everyRow(db) }).toEqual(before);
    expect(db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM __drizzle_migrations').get()?.n).toBe(
      7,
    );
  });

  it('operator_notifications takes the browser_window kind after 0007, and still refuses an unknown one', () => {
    const db = freshDb();
    db.raw.prepare(DEFINITION).run({ id: 'd1', at: T0 });
    const insert = (kind: string) => () =>
      db.raw
        .prepare(
          "INSERT INTO operator_notifications (kind, execution_id, definition_id, sent_at, status) VALUES (?, NULL, 'd1', ?, 'sent')",
        )
        .run(kind, T0);
    expect(sqliteCode(insert('browser_window'))).toBeNull();
    expect(sqliteCode(insert('browser-window'))).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('sqlite_master holds the firing unique index with its WHERE clause, and the drizzle snapshot states the same', () => {
    const db = freshDb();
    const row = db.raw
      .prepare<[], { sql: string }>(
        "SELECT sql FROM sqlite_master WHERE name = 'search_executions_firing_uq'",
      )
      .get();
    expect(row?.sql).toBe(
      'CREATE UNIQUE INDEX `search_executions_firing_uq` ON `search_executions` (`definition_id`,`scheduled_for`) WHERE is_child = 0 AND scheduled_for IS NOT NULL',
    );
    const snapshot = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '0007_snapshot.json'), 'utf8'));
    const executions = snapshot.tables.search_executions;
    expect(executions.indexes.search_executions_firing_uq).toEqual({
      name: 'search_executions_firing_uq',
      columns: ['definition_id', 'scheduled_for'],
      isUnique: true,
      where: 'is_child = 0 AND scheduled_for IS NOT NULL',
    });
    expect(Object.keys(executions.columns)).toEqual(
      expect.arrayContaining(['scheduled_for', 'is_catch_up', 'browser_window_end', 'skip_code']),
    );
    expect(executions.columns.is_catch_up).toMatchObject({ notNull: true, default: 0 });
    expect(Object.keys(snapshot.tables.cell_outcomes.columns)).toContain('skip_detail');
    // why: the snapshot drizzle-kit wrote names every CHECK the database carries, so a later generate diffs from here
    const checks = (t: string): string[] =>
      db.raw
        .prepare<[string], { sql: string }>('SELECT sql FROM sqlite_master WHERE name = ?')
        .get(t)
        ?.sql.match(/CONSTRAINT "([a-z_]+)"/g)
        ?.map((m) => m.slice(12, -1)) ?? [];
    expect(Object.keys(executions.checkConstraints).sort()).toEqual(checks('search_executions').sort());
    expect(Object.keys(snapshot.tables.cell_outcomes.checkConstraints).sort()).toEqual(
      checks('cell_outcomes').sort(),
    );
  });

  it('cell_outcomes accepts skipped:scheduled_only with each detail, and still refuses an unknown skip reason', () => {
    const db = freshDb();
    db.raw.prepare(DEFINITION).run({ id: 'd1', at: T0 });
    db.raw
      .prepare(EXECUTION)
      .run({ id: 'e1', definitionId: 'd1', trigger: 'manual', status: 'completed', at: T0 });
    const deps = [
      '2027-03-14',
      '2027-03-15',
      '2027-03-16',
      '2027-03-17',
      '2027-03-18',
      '2027-03-19',
      '2027-03-20',
    ];
    for (const dep of deps) db.raw.prepare(CELL).run({ executionId: 'e1', dep });
    const insert = (dep: string, status: string, reason: string | null, detail: string | null) => () =>
      db.raw
        .prepare(
          `INSERT INTO cell_outcomes (execution_id, origin, destination, departure_date, return_date, stage, provider_id, status, reason, attempts, skip_detail)
           VALUES ('e1', 'LHR', 'JFK', @dep, '2027-03-24', 'discovery', 'camoufox', @status, @reason, 0, @detail)`,
        )
        .run({ dep, status, reason, detail });
    expect(sqliteCode(insert('2027-03-14', 'skipped', 'scheduled_only', 'catch-up-no-browser'))).toBeNull();
    expect(
      sqliteCode(insert('2027-03-15', 'skipped', 'scheduled_only', 'outside-browser-window')),
    ).toBeNull();
    expect(sqliteCode(insert('2027-03-16', 'skipped', 'scheduled', null))).toBe('SQLITE_CONSTRAINT_CHECK');
    // the detail only with scheduled_only, and scheduled_only only with a known detail
    expect(sqliteCode(insert('2027-03-16', 'skipped', 'scheduled_only', null))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(insert('2027-03-16', 'skipped', 'scheduled_only', 'asleep'))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(insert('2027-03-16', 'skipped', 'budget', 'catch-up-no-browser'))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(insert('2027-03-16', 'not_run', null, 'outside-browser-window'))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(insert('2027-03-16', 'skipped', 'budget', null))).toBeNull();
  });

  it('skip_code takes its two codes, only on a skipped_missed row; a skipped_missed row may have none (rows before 0007)', () => {
    const db = freshDb();
    db.raw.prepare(DEFINITION).run({ id: 'd1', at: T0 });
    const insert = (id: string, status: string, code: string | null) => () =>
      db.raw
        .prepare(
          `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at, skip_code)
           VALUES (@id, 'd1', '{}', 'schedule', @status, @at, @code)`,
        )
        .run({ id, status, code, at: T0 });
    expect(sqliteCode(insert('a', 'skipped_missed', 'half-cadence'))).toBeNull();
    expect(sqliteCode(insert('b', 'skipped_missed', 'browser-only-definition'))).toBeNull();
    expect(sqliteCode(insert('c', 'skipped_missed', null))).toBeNull();
    expect(sqliteCode(insert('d', 'skipped_missed', 'asleep'))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(insert('e', 'skipped_budget', 'half-cadence'))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(insert('f', 'completed', 'browser-only-definition'))).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('scheduled_for and browser_window_end are millisecond UTC instants; a catch-up always names its firing; a child never carries one', () => {
    const db = freshDb();
    db.raw.prepare(DEFINITION).run({ id: 'd1', at: T0 });
    const insert =
      (id: string, p: { firing?: string | null; catchUp?: number; end?: string | null; child?: boolean }) =>
      () =>
        db.raw
          .prepare(
            `INSERT INTO search_executions (id, definition_id, is_child, child_origin, child_destination, child_departure_date, child_return_date,
             definition_snapshot_json, trigger, status, created_at, finished_at, scheduled_for, is_catch_up, browser_window_end)
           VALUES (@id, 'd1', @child, @o, @d, @dep, @ret, '{}', 'schedule', 'completed', @at, @at, @firing, @catchUp, @end)`,
          )
          .run({
            id,
            child: p.child === true ? 1 : 0,
            o: p.child === true ? 'LHR' : null,
            d: p.child === true ? 'JFK' : null,
            dep: p.child === true ? '2027-03-14' : null,
            ret: p.child === true ? '2027-03-24' : null,
            firing: p.firing ?? null,
            catchUp: p.catchUp ?? 0,
            end: p.end ?? null,
            at: T0,
          });
    expect(sqliteCode(insert('a', { firing: '2027-03-29T00:30:00.000Z', catchUp: 1 }))).toBeNull();
    expect(sqliteCode(insert('b', { end: '2027-03-29T02:00:00.000Z' }))).toBeNull();
    expect(sqliteCode(insert('c', { firing: '2027-03-29T00:30:00Z' }))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(insert('d', { end: '2027-03-29' }))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(insert('e', { catchUp: 1 }))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(insert('f', { catchUp: 2, firing: '2027-03-30T00:30:00.000Z' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(insert('g', { child: true, firing: '2027-03-31T00:30:00.000Z' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(insert('h', { child: true }))).toBeNull();
  });
});
