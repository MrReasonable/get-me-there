// The seed-and-compare pattern of the rebuild migrations (migration0004.test.ts's, lifted here for 0005; arch-010): a
// database migrated to 0004 with one row in every table 0005 rebuilds, read back before and after.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../../src/client.js';
import { applyMigrations } from '../../src/migrate.js';
import { MIGRATIONS_DIR } from '../../src/paths.js';
import { openTracked, T0, tmpDbPath, tmpDir } from './db.js';

/** The tables migration 0005 rebuilds (TS2-01: one per CHECK it widens). */
export const REBUILT_0005 = [
  'calendar_prices',
  'cell_outcomes',
  'fare_offers',
  'price_observations',
  'provider_requests',
  'route_price_history',
] as const;

/** A copy of the migrations folder without `tags`, as an install made before them has it. */
export function migrationsWithout(tags: readonly string[]): string {
  const dir = join(tmpDir(), 'drizzle');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  for (const tag of tags) rmSync(join(dir, `${tag}.sql`));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => !tags.includes(e.tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

type Rows = Record<string, unknown[]>;

/** Every row of each rebuilt table, in rowid order, with only `columns[table]` when given (the 0004 column set). */
export function tableRows(db: Db, columns?: Record<string, string[]>): Rows {
  const out: Rows = {};
  for (const t of REBUILT_0005) {
    const cols = columns?.[t];
    const list = cols === undefined ? '*' : cols.map((c) => `"${c}"`).join(', ');
    out[t] = db.raw.prepare(`SELECT ${list} FROM ${t} ORDER BY rowid`).all();
  }
  return out;
}

function columnsOf(db: Db): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of REBUILT_0005)
    out[t] = db.raw
      .prepare<[], { name: string }>(`SELECT name FROM pragma_table_info('${t}')`)
      .all()
      .map((r) => r.name);
  return out;
}

/**
 * A file database at 0004 with one row in every table 0005 rebuilds (and the parents their keys need), the rows read
 * before, and `migrate()` applying the rest. Columns follow the 0004 schema; `id` is left to the autoincrement tables.
 */
export function seedEveryRebuiltTableAt0004(): {
  db: Db;
  before: Rows;
  migrate: () => void;
  after: () => Rows;
} {
  const db = openTracked(tmpDbPath());
  applyMigrations(
    db,
    migrationsWithout([
      '0005_camoufox_provider',
      '0006_grid_return_source',
      '0007_catch_up',
      '0008_wp18_error_kind',
      '0009_wp19_latest_price_idx',
    ]),
  );
  const run = (sql: string, p: Record<string, unknown> = {}): void => {
    db.raw.prepare(sql).run({ at: T0, ...p });
  };
  run(`INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
      verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
     VALUES ('d1', 'London to New York', '["LHR"]', '["JFK"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 10, 'economy', '{}',
      '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', '{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}',
      '{"discovery":["travelpayouts"],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 1, @at, @at)`);
  run(
    `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at) VALUES ('e1', 'd1', '{"budget":{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}}', 'manual', 'completed', @at)`,
  );
  run(
    `INSERT INTO search_cells (execution_id, origin, destination, departure_date, return_date) VALUES ('e1', 'LHR', 'JFK', '2027-03-14', '2027-03-24')`,
  );
  run(`INSERT INTO itineraries (hash, origin, destination, departure_date, return_date, nights, stops_out, stops_in, carriers_json, layovers_json, first_seen_at)
     VALUES ('${'a'.repeat(64)}', 'LHR', 'JFK', '2027-03-14', '2027-03-24', 10, 0, 0, '["BA"]', '[]', @at)`);
  run(`INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence,
      price_native_minor, currency_native, fx_converted, point_of_sale, fetched_at, max_age_hours)
     VALUES ('e1', 'travelpayouts', 'authorised-cached', 'economy', 'LHR', 'JFK', '2027-03-14', '2027-03-24', 45100, 45100, 'GBP', 0, 'unknown', @at, 48)`);
  run(`INSERT INTO cell_outcomes (execution_id, origin, destination, departure_date, return_date, stage, provider_id, status, reason, attempts, fetched_at,
      min_pence, cabin, point_of_sale, source_kind)
     VALUES ('e1', 'LHR', 'JFK', '2027-03-14', '2027-03-24', 'discovery', 'travelpayouts', 'priced', NULL, 1, @at, 45100, 'economy', 'unknown', 'authorised-cached')`);
  run(`INSERT INTO fare_offers (itinerary_hash, provider_id, seller, cabin, first_seen_at, last_seen_at, first_price_pence, lowest_price_pence,
      highest_price_pence, latest_price_pence)
     VALUES ('${'a'.repeat(64)}', 'searchapi', 'Example Air', 'economy', @at, @at, 46000, 46000, 46000, 46000)`);
  run(`INSERT INTO price_observations (offer_id, execution_id, source_kind, cabin, fetched_at, price_pence, price_native_minor, currency_native,
      fx_converted, point_of_sale, supplied_fields_json, partial_expansion)
     VALUES (1, 'e1', 'scraped-search', 'economy', @at, 46000, 46000, 'GBP', 0, 'GB', '["price"]', 0)`);
  run(`INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms, http_status, outcome,
      billable, cost_micro_gbp, http_attempt)
     VALUES ('travelpayouts', 'e1', '/aviasales/v3/prices_for_dates', 0, @at, @at, 5, 200, 'ok', 0, 0, 1)`);
  run(`INSERT INTO route_price_history (origin, destination, departure_date, return_date, cabin, provider_id, date, lowest_price_pence, fetched_at, point_of_sale)
     VALUES ('LHR', 'JFK', '2027-03-14', '2027-03-24', 'economy', 'searchapi', '2026-09-01', 46000, @at, 'GB')`);
  const columns = columnsOf(db);
  const before = tableRows(db, columns);
  return {
    db,
    before,
    migrate: () => {
      applyMigrations(db, MIGRATIONS_DIR);
    },
    after: () => tableRows(db, columns),
  };
}
