import type {
  AlertEvent,
  AlertRuleType,
  Cabin,
  CellOutcomeStatus,
  ErrorReason,
  ExecutionStatus,
  NoDataReason,
  OperatorMessageKind,
  ProviderId,
  ResultBasis,
  ReturnDateSource,
  SelectionReason,
  SkipCode,
  SkipDetail,
  SkipReason,
  SourceKind,
  Stage,
  SuppliedField,
  VendorPriceMark,
} from '@gmt/core';

// Typed constant lists: the only way the package enumerates a union (ruling 15: no `Object.keys(...) as`).
// arch-M2: every list goes through `exhaustive`, which refuses at compile time a list that misses a member of its
// union (`satisfies` alone proves only a subset); test/enums.test.ts also pins the lists core has as z.enum to their
// `.options`. why: the lists stay literal because drizzle-kit loads the schema (which uses them) without workspace
// source resolution, so a runtime import of @gmt/core here would break `db:generate`.

/** `exhaustive<U>()(list)` compiles only when `list` names every member of `U` and nothing else. */
export const exhaustive =
  <U extends string>() =>
  <const L extends readonly U[]>(list: L & ([Exclude<U, L[number]>] extends [never] ? unknown : never)): L =>
    list;
export const PROVIDER_IDS = exhaustive<ProviderId>()([
  'travelpayouts',
  'searchapi',
  'camoufox',
  'fixture',
] as const);
export const SOURCE_KINDS = exhaustive<SourceKind>()([
  'authorised-cached',
  'scraped-aggregate',
  'scraped-search',
  'scraped-self',
  'synthetic',
] as const);
export const RETURN_DATE_SOURCES = exhaustive<ReturnDateSource>()(['vendor', 'asked', 'grid-cell'] as const);
export const VENDOR_PRICE_MARKS = exhaustive<VendorPriceMark>()(['cheapest', 'low', 'none'] as const);
export const CABINS = exhaustive<Cabin>()(['economy', 'premium_economy', 'business', 'first'] as const);
export const STAGES = exhaustive<Stage>()(['discovery', 'verification'] as const);
export const OUTCOME_STATUSES = exhaustive<CellOutcomeStatus>()([
  'not_run',
  'priced',
  'empty',
  'no_data',
  'error',
  'skipped',
] as const);
export const SKIP_REASONS = exhaustive<SkipReason>()([
  'not_selected',
  'budget',
  'provider_disabled',
  'provider_unavailable',
  'scheduled_only',
  'departed',
] as const);
/** Spec §3 rev 36 (migration 0007): the detail of a `skipped:scheduled_only` outcome. */
export const SKIP_DETAILS = exhaustive<SkipDetail>()([
  'catch-up-no-browser',
  'outside-browser-window',
] as const);
/** Spec §8.2 rev 36 (migration 0007): why a `skipped_missed` firing was not caught up. */
export const SKIP_CODES = exhaustive<SkipCode>()(['half-cadence', 'browser-only-definition'] as const);
export const SELECTION_REASONS = exhaustive<SelectionReason>()([
  'always_include',
  'top_n',
  'ceiling',
  'stride',
] as const);
export const SUPPLIED_FIELDS = exhaustive<SuppliedField>()([
  'segments',
  'segmentTimes',
  'segmentCabins',
  'selfTransfer',
  'baggage',
  'fareConditions',
  'seller',
  'price',
] as const);
export const EXECUTION_STATUSES = exhaustive<ExecutionStatus>()([
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
] as const);
/** Spec §3: an error outcome's reason is a `ProviderError.kind` or a normalisation reason, never a vendor message (prov-009). */
export const ERROR_REASONS = exhaustive<ErrorReason>()([
  'auth',
  'rate-limit',
  'quota',
  'upstream',
  'parse',
  'network',
  'limiter-timeout',
  'blocked',
  'provider-unavailable',
  'fx-unavailable',
  'currency-unsupported',
  'unknown-airport-tz',
  'no-return-legs',
  'unmappable-carrier',
  'bad-local-time',
  'cell-mismatch',
  'no-priced-options',
] as const);
/** Spec §3: the reasons a no_data outcome written without a fetch may carry (markNoData). */
export const NO_DATA_REASONS = exhaustive<NoDataReason>()(['cabin-not-offered'] as const);
/** The outcome statuses only a write that carries data may set (ruling 4). */
// why: a deliberate subset of CellOutcomeStatus, so `satisfies` (not exhaustive) is the right check here.
export const TERMINAL_STATUSES = [
  'priced',
  'empty',
  'no_data',
] as const satisfies readonly CellOutcomeStatus[];

export const ALERT_RULE_TYPES = exhaustive<AlertRuleType>()(['absolute', 'dropPct', 'dropAbs'] as const);
export const RESULT_BASES = exhaustive<ResultBasis>()(['verified', 'calendar'] as const);
export const ALERT_EVENT_STATUSES = exhaustive<AlertEvent['status']>()([
  'queued',
  'notified',
  'suppressed',
] as const);
export const OPERATOR_MESSAGE_KINDS = exhaustive<OperatorMessageKind>()([
  'paused_budget',
  'paused_error',
  'skipped_budget',
  'skipped_confirm',
  'skipped_window',
  'skipped_missed',
  'interrupted',
  'provider_disabled',
  'provider_capped',
  'browser_window',
  'parity_break',
  'alerts_calendar_only',
  'crash_loop',
] as const);

/**
 * Spec §7 "Resume": reasons never retried automatically; a manual resume re-admits auth, quota, parse. `no-priced-options`
 * (spec §5.4, decision 37) is never retried by either.
 */
export const NON_RETRYABLE = [
  // why: spec §8.1 rev 32: a camoufox block is never retried by any resume; the cool-down is the worker's to end.
  'blocked',
  'auth',
  'quota',
  'parse',
  'no-return-legs',
  'no-priced-options',
  'fx-unavailable',
  'currency-unsupported',
  'unknown-airport-tz',
] as const;
export const MANUAL_RETRYABLE = ['auth', 'quota', 'parse'] as const;
