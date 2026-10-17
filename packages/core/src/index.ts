// Barrel for @gmt/core. Every public export of the package is re-exported from here;
// consumers never deep-import. Extended by WP1 and WP2.

export { dedupKey, identityKey, isSuppressed } from './alerts/dedup.js';
export { buildDigest } from './alerts/digest.js';
export { DEFAULT_DISCOVERY_REFRESH_HOURS, evaluateAlertRules } from './alerts/evaluate.js';
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
export { evaluateConstraints } from './constraints/evaluate.js';
export { CONSTRAINT_LABELS, CONSTRAINT_NAMES } from './constraints/labels.js';
export { unverifiedNames, verdictClass } from './constraints/verdictClass.js';
export * from './coverage/buckets.js';
export * from './coverage/rollUp.js';
export * from './dates/epochDay.js';
export * from './errors.js';
export * from './labels/age.js';
export { isTruncated, TRUNCATED_NOTE } from './labels/truncated.js';
export { canonicalCarrier, canonicalFlightNumber } from './normalise/carrier.js';
export { itineraryHash } from './normalise/hashing.js';
export { type NormaliseDeps, normaliseOffer } from './normalise/itinerary.js';
export { departLocal } from './normalise/localTime.js';
export { ECB_CURRENCIES, MINOR_EXPONENT, priceInGbp, type RateLookup, toGbp } from './normalise/money.js';
export { toIsoDateTime } from './normalise/timestamps.js';
export { LINK_ALLOWLIST, validateVendorUrl } from './normalise/vendorUrl.js';
export * from './ports/budget.js';
export * from './ports/cache.js';
export * from './ports/clock.js';
export * from './ports/logger.js';
export * from './ports/notifier.js';
export * from './ports/provider.js';
export { bandCheapest } from './results/band.js';
export { dedupByItinerary } from './results/dedup.js';
export { filterRows } from './results/filter.js';
export { rankRows, sortRows } from './results/rank.js';
export { resultRowKey } from './results/rowKey.js';
export { SEARCH_LINK_LABEL, searchLinkFor } from './results/searchLink.js';
export type { ResultFilters, SortKey } from './results/types.js';
export * from './selection/select.js';
export * from './space/generate.js';
export * from './space/validate.js';
export * from './space/window.js';
export * from './text/bannedWords.js';
export { hasControlChars, stripControlChars } from './text/control.js';
export { formatPence } from './text/money.js';
export * from './types/alerts.js';
export * from './types/definition.js';
export * from './types/definitionDefaults.js';
export * from './types/execution.js';
export * from './types/ids.js';
export * from './types/itinerary.js';
export * from './types/provenance.js';
