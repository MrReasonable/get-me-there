// Barrel for @gmt/db. Every public export of the package is re-exported from here by name, so only the plan's
// "Database" contract and the brief's additive list leave the package (arch-M9); consumers never deep-import.

export {
  AppLock,
  HEARTBEAT_INTERVAL_MS,
  LOCK_STALE_AFTER_MS,
  type ReadOnlyLockState,
  readOnlyLockState,
} from './appLock.js';
export { backupDatabase } from './backup.js';
export { type BudgetConfig, budgetConfigFromConfig, effectiveCallCap } from './budgetConfig.js';
export { SqliteBudgetGuard } from './budgetGuard.js';
export { type Db, openDatabase } from './client.js';
export { RowCorrupt } from './internal/read.js';
export { RowRejected } from './internal/validate.js';
export { runMaintenance } from './maintenance.js';
export { applyMigrations, pendingMigrations } from './migrate.js';
export { AIRPORTS_DATA_DIR, MIGRATIONS_DIR } from './paths.js';
export { createRepos, type Repos } from './repos.js';
export { AirportsRepo } from './repositories/airports.js';
export { AlertsRepo } from './repositories/alerts.js';
export { CalendarPricesRepo } from './repositories/calendarPrices.js';
export { CellsRepo, retriedOnResume } from './repositories/cells.js';
export { DefinitionsRepo } from './repositories/definitions.js';
export { ExecutionsRepo } from './repositories/executions.js';
export { FxRepo } from './repositories/fx.js';
export { ItinerariesRepo } from './repositories/itineraries.js';
export { LedgerRepo } from './repositories/ledger.js';
export { NotificationsRepo } from './repositories/notifications.js';
export { RoutePriceHistoryRepo } from './repositories/routePriceHistory.js';
export { SqliteResponseCache } from './responseCache.js';
export {
  AIRPORTS_MIN_ROWS,
  loadAirportsDataset,
  sanityCheckAirports,
  seedAirports,
} from './seed/airports.js';
export type {
  Airport,
  AirportsDataset,
  CalendarPriceInsert,
  CalendarPriceRow,
  ExecutionCreateInput,
  ExecutionPatch,
  ObservationRow,
  OfferHistoryPoint,
  RepoOptions,
  ReuseCriteria,
  ReusedCopy,
  TileWrite,
  VerifiedCellWrite,
} from './types.js';
