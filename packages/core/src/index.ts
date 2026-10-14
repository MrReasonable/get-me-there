// Barrel for @gmt/core. Every public export of the package is re-exported from here;
// consumers never deep-import. Extended by WP1 and WP2.

// Inferred contract types that other packages name in signatures (the schemas stay under `apiContract`).
export type {
  BudgetFit,
  CalendarDay,
  CoverageCheckRequest,
  CoverageCheckResponse,
  DefinitionResponse,
  HistoryPoint,
  ResultRow,
  RouteSeriesPoint,
  SchedulerJob,
} from './api-contract/index.js';
export * as apiContract from './api-contract/index.js';
export * from './config/presets.js';
export * from './config/schema.js';
export * from './config/secret.js';
export * from './config/synthetic.js';
export * from './errors.js';
export * from './labels/age.js';
export * from './ports/budget.js';
export * from './ports/cache.js';
export * from './ports/clock.js';
export * from './ports/logger.js';
export * from './ports/notifier.js';
export * from './ports/provider.js';
export * from './text/bannedWords.js';
export * from './types/alerts.js';
export * from './types/definition.js';
export * from './types/execution.js';
export * from './types/ids.js';
export * from './types/itinerary.js';
export * from './types/provenance.js';
