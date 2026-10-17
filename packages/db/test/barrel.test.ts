import { readFileSync } from 'node:fs';
import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import * as db from '../src/index.js';
import { freshDb, sqliteCode, T0 } from './helpers/db.js';

/** Spec §7 tables, without `providers` (ruling 11: provider metadata comes from config). */
const SPEC_TABLES = [
  'airports',
  'search_definitions',
  'search_executions',
  'search_cells',
  'cell_outcomes',
  'calendar_prices',
  'itineraries',
  'segments',
  'fare_offers',
  'price_observations',
  'provider_requests',
  'provider_cache',
  'fx_rates',
  'alert_rules',
  'alert_events',
  'operator_notifications',
  'route_price_history',
  'app_lock',
];

describe('@gmt/db public surface (plan "Database" contract)', () => {
  it('exports every contract name, and keeps monthWindow, CLAIM_RESUME_SQL and the tables internal (arch-012, arch-r2-007)', () => {
    for (const name of [
      'openDatabase',
      'applyMigrations',
      'pendingMigrations',
      'createRepos',
      'AirportsRepo',
      'FxRepo',
      'DefinitionsRepo',
      'ExecutionsRepo',
      'CellsRepo',
      'CalendarPricesRepo',
      'ItinerariesRepo',
      'LedgerRepo',
      'AlertsRepo',
      'NotificationsRepo',
      'RoutePriceHistoryRepo',
      'budgetConfigFromConfig',
      'effectiveCallCap',
      'SqliteBudgetGuard',
      'SqliteResponseCache',
      'AppLock',
      'seedAirports',
      'sanityCheckAirports',
      'runMaintenance',
      'loadAirportsDataset',
      'backupDatabase',
      'checkBackup',
      'RowRejected',
      'RowCorrupt',
      'MIGRATIONS_DIR',
      'AIRPORTS_DATA_DIR',
      'AIRPORTS_MIN_ROWS',
      'HEARTBEAT_INTERVAL_MS',
      'LOCK_STALE_AFTER_MS',
      'readOnlyLockState',
    ]) {
      expect(db, name).toHaveProperty(name);
    }
    for (const internal of ['monthWindow', 'CLAIM_RESUME_SQL', 'schema'])
      expect(db).not.toHaveProperty(internal);
  });

  it('exports contract names only (arch-M9): exactly the contract values at runtime, and no internal type', () => {
    expect(Object.keys(db).sort()).toEqual(
      [
        'AIRPORTS_DATA_DIR',
        'AIRPORTS_MIN_ROWS',
        'AirportsRepo',
        'AlertsRepo',
        'AppLock',
        'CalendarPricesRepo',
        'CellsRepo',
        'DefinitionsRepo',
        'ExecutionsRepo',
        'FxRepo',
        'HEARTBEAT_INTERVAL_MS',
        'ItinerariesRepo',
        'LOCK_STALE_AFTER_MS',
        'LedgerRepo',
        'MIGRATIONS_DIR',
        'NotificationsRepo',
        'RoutePriceHistoryRepo',
        'RowCorrupt',
        'RowRejected',
        'SqliteBudgetGuard',
        'SqliteResponseCache',
        'WalUnavailableError', // dm-003: the boot maps it to exit 73
        'applyMigrations',
        'backupDatabase',
        'budgetConfigFromConfig',
        'checkBackup',
        'createRepos',
        'effectiveCallCap',
        'loadAirportsDataset',
        'openDatabase',
        'pendingMigrations',
        'readOnlyLockState',
        'retriedOnResume',
        'runMaintenance',
        'sanityCheckAirports',
        'seedAirports',
      ].sort(),
    );
    // why: ProviderBudget is the guard's internal entry type, not part of the contract; the barrel never names it.
    expect(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')).not.toMatch(
      /\bProviderBudget\b/,
    );
  });

  it('createRepos builds every repository', () => {
    const repos = db.createRepos(freshDb(), fixedClock(T0), { allowSynthetic: false });
    expect(Object.keys(repos).sort()).toEqual([
      'airports',
      'alerts',
      'calendarPrices',
      'cells',
      'definitions',
      'executions',
      'fx',
      'itineraries',
      'ledger',
      'notifications',
      'routeHistory',
    ]);
    expect(repos.cells).toBeInstanceOf(db.CellsRepo);
    expect(repos.routeHistory).toBeInstanceOf(db.RoutePriceHistoryRepo);
  });

  it('the migrations create exactly the spec §7 tables (0000, plus 0001 adding a column, decision 37, 0002 rebuilding alert_events, decision 56, 0003 rebuilding route_price_history, decision 67, and 0004 rebuilding it with point_of_sale, CodeRabbit batch 3)', () => {
    const d = freshDb();
    const tables = d.raw
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name`,
      )
      .all()
      .map((r) => r.name);
    expect(tables).toEqual([...SPEC_TABLES].sort());
    expect(d.raw.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 5 });
  });

  it('foreign keys are declared and enforced', () => {
    const d = freshDb();
    expect(
      sqliteCode(() =>
        d.raw
          .prepare(
            `INSERT INTO search_cells (execution_id, origin, destination, departure_date, return_date, verification_selected) VALUES ('nope', 'LHR', 'JFK', '2027-03-14', '2027-03-28', 0)`,
          )
          .run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
  });
});
