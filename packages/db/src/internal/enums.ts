import type {
  Cabin,
  CellOutcomeStatus,
  ErrorReason,
  ExecutionStatus,
  ProviderId,
  SelectionReason,
  SkipReason,
  SourceKind,
  Stage,
  SuppliedField,
} from '@gmt/core';

// Typed constant lists: the only way the package enumerates a union (ruling 15: no `Object.keys(...) as`).
// `satisfies` proves every member belongs to the core union.
export const PROVIDER_IDS = [
  'travelpayouts',
  'searchapi',
  'fixture',
] as const satisfies readonly ProviderId[];
export const SOURCE_KINDS = [
  'authorised-cached',
  'scraped-aggregate',
  'scraped-search',
  'synthetic',
] as const satisfies readonly SourceKind[];
export const CABINS = ['economy', 'premium_economy', 'business', 'first'] as const satisfies readonly Cabin[];
export const STAGES = ['discovery', 'verification'] as const satisfies readonly Stage[];
export const OUTCOME_STATUSES = [
  'not_run',
  'priced',
  'empty',
  'no_data',
  'error',
  'skipped',
] as const satisfies readonly CellOutcomeStatus[];
export const SKIP_REASONS = [
  'not_selected',
  'budget',
  'provider_disabled',
  'departed',
] as const satisfies readonly SkipReason[];
export const SELECTION_REASONS = [
  'always_include',
  'top_n',
  'ceiling',
  'stride',
] as const satisfies readonly SelectionReason[];
export const SUPPLIED_FIELDS = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'selfTransfer',
  'baggage',
  'fareConditions',
  'seller',
  'price',
] as const satisfies readonly SuppliedField[];
export const EXECUTION_STATUSES = [
  'pending',
  'running',
  'paused_budget',
  'paused_error',
  'interrupted',
  'cancelled',
  'completed',
  'skipped_budget',
  'skipped_confirm',
  'skipped_window',
  'skipped_missed',
] as const satisfies readonly ExecutionStatus[];
/** Spec §3: an error outcome's reason is a `ProviderError.kind` or a normalisation reason, never a vendor message (prov-009). */
export const ERROR_REASONS = [
  'auth',
  'rate-limit',
  'quota',
  'upstream',
  'parse',
  'network',
  'limiter-timeout',
  'fx-unavailable',
  'currency-unsupported',
  'unknown-airport-tz',
  'no-return-legs',
  'unmappable-carrier',
  'bad-local-time',
] as const satisfies readonly ErrorReason[];
/** The outcome statuses only a write that carries data may set (ruling 4). */
export const TERMINAL_STATUSES = [
  'priced',
  'empty',
  'no_data',
] as const satisfies readonly CellOutcomeStatus[];
