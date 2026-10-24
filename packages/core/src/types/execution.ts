import type { NormalisationReason, ProviderErrorKind } from '../errors.js';
import type { CellKey, DefinitionSnapshot } from './definition.js';
import type { IsoDateTime } from './ids.js';
import type { Cabin, PointOfSale, ProviderId, SourceKind } from './provenance.js';

/** Spec §7 `search_executions.status`. */
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'paused_budget'
  | 'paused_error'
  | 'interrupted'
  | 'cancelled'
  | 'completed'
  | 'skipped_budget'
  | 'skipped_confirm'
  | 'skipped_window'
  | 'skipped_missed';
export const ACTIVE_STATUSES: readonly ExecutionStatus[] = [
  'pending',
  'running',
  'paused_budget',
  'paused_error',
  'interrupted',
];
/**
 * Active statuses with no pass running: a paused run, or one a stop left interrupted. A catch-up in one of them is a
 * "paused catch-up", which never covers a later firing and is superseded by it (spec §8.2 rev 36, decision 79).
 */
export const PAUSED_STATUSES: readonly ExecutionStatus[] = ['paused_budget', 'paused_error', 'interrupted'];
export const RESUMABLE_STATUSES: readonly ExecutionStatus[] = [
  'interrupted',
  'paused_budget',
  'paused_error',
  'cancelled',
  'completed',
];
export type Stage = 'discovery' | 'verification';
/** Spec §3 cell outcome statuses. */
export type CellOutcomeStatus = 'not_run' | 'priced' | 'empty' | 'no_data' | 'error' | 'skipped';
/**
 * `provider_unavailable`: the camoufox worker could not be reached (spec §3 rev 32). `scheduled_only`: a camoufox cell
 * left for the next scheduled run, with its detail in `CellOutcome.skipDetail` (spec §3, §8.2 rev 36); no resume,
 * manual, automatic or at boot, ever selects it.
 */
export type SkipReason =
  | 'not_selected'
  | 'budget'
  | 'provider_disabled'
  | 'provider_unavailable'
  | 'scheduled_only'
  | 'departed';
/**
 * Spec §3, §8.2 (migration 0007 `cell_outcomes.skip_detail`): why a cell is `skipped:scheduled_only`. A catch-up's cell
 * reuse did not fill, or a cell a run reached past its browser window. Set only with `scheduled_only`, always with it.
 */
export const SKIP_DETAILS = ['catch-up-no-browser', 'outside-browser-window'] as const;
export type SkipDetail = (typeof SKIP_DETAILS)[number];
/**
 * Spec §8.2 (migration 0007 `search_executions.skip_code`): why a missed firing was not caught up, stored on its
 * `skipped_missed` row so the reason shown is the one the firing had, never one re-derived from today's settings.
 */
export const SKIP_CODES = ['half-cadence', 'browser-only-definition'] as const;
export type SkipCode = (typeof SKIP_CODES)[number];
/** A provider whose `cabins` excludes the definition's cabin: every cell no_data, no call. Spec §3. */
export type NoDataReason = 'cabin-not-offered';
/**
 * Spec §5.4: step 1 returned options and none was priced. Its own reason (decision 37), so every reason-keyed reader sees
 * it; never retried by a resume, automatic or manual (only a single-cell verification searches the cell again).
 */
export type NoPricedOptionsReason = 'no-priced-options';
/** The vendor message goes to lastError, never to reason. Spec §3. */
export type ErrorReason = ProviderErrorKind | NormalisationReason | NoPricedOptionsReason;

/** Spec §7 `cell_outcomes`: per (execution, cell, stage, provider). */
export interface CellOutcome extends CellKey {
  executionId: string;
  stage: Stage;
  providerId: ProviderId;
  status: CellOutcomeStatus;
  reason: string | null;
  attempts: number;
  lastError: string | null;
  fetchedAt: IsoDateTime | null;
  minPence: number | null;
  cabin: Cabin | null;
  pointOfSale: PointOfSale | null;
  sourceKind: SourceKind | null;
  reusedFromExecutionId: string | null;
  /** Spec §3 rev 36: set exactly when the outcome is `skipped:scheduled_only`. */
  skipDetail: SkipDetail | null;
}

/** Spec §6.6 roll-up; a null status ↔ API 'not_applicable' (row 0). */
export interface RollUp {
  status: CellOutcomeStatus | null;
  reason: string | null;
  minPence: number | null;
}
export type SelectionReason = 'always_include' | 'top_n' | 'ceiling' | 'stride';

/** Spec §8.1 estimate: per-provider calls (pre-factor `planCalls` for the overrun check) and costs. */
export interface Estimate {
  cells: number;
  perProvider: Array<{
    providerId: ProviderId;
    stage: Stage;
    calls: number;
    planCalls: number;
    costMicroGbp: number;
    costPence: number;
    seconds: number;
    blocked: string | null;
    /** camoufox grid only (spec §2 rev 34, CB-3): the scroll clicks the plan makes beside its pages. */
    scrolls?: number;
  }>;
  totalCalls: number;
  totalPlanCalls: number;
  totalCostMicroGbp: number;
  totalCostPence: number;
  seconds: number;
  assumptions: string[];
  windowClamped: boolean;
  retryFactor: number;
}

/** Spec §7 `search_executions` as read back. */
export interface Execution {
  id: string;
  definitionId: string;
  isChild: boolean;
  cell: CellKey | null;
  snapshot: DefinitionSnapshot;
  status: ExecutionStatus;
  stage: Stage | null;
  estimate: Estimate | null;
  cancelRequested: boolean;
  resumeAfter: IsoDateTime | null;
  autoResumeCount: number;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
  errorText: string | null;
  createdAt: IsoDateTime;
  trigger: 'manual' | 'schedule' | 'tool';
  /**
   * Spec §7 rev 36: the firing a scheduled start or skip stands for, as croner gives it (UTC, milliseconds); null for a
   * manual run, a child, and every row written before migration 0007.
   */
  scheduledFor: IsoDateTime | null;
  /** Spec §8.2: a run started for a missed firing; it never loads browser pages. */
  isCatchUp: boolean;
  /** Spec §8.2 (decision 83): the end of the run's browser window, written at start and by a live-tick resume. */
  browserWindowEnd: IsoDateTime | null;
  /** Spec §8.2: why a `skipped_missed` firing was not caught up; null on every other row and on older rows. */
  skipCode: SkipCode | null;
  /**
   * Spec §7 rev 36 (decision 79): when the row last stopped running (it entered a paused or interrupted status), kept
   * through a cancel and cleared when a resume claims it; null while it runs, on a row that never paused, and on older
   * rows. The coverage read uses it to tell a catch-up paused at a firing from one in flight there.
   */
  pausedAt: IsoDateTime | null;
}

/** Spec §3: the six coverage buckets plus the reused count shown beside them. */
export interface Buckets {
  priced: number;
  empty: number;
  no_data: number;
  error: number;
  skipped: number;
  not_run: number;
  reused: number;
}
