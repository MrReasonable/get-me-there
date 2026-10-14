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
export type SkipReason = 'not_selected' | 'budget' | 'provider_disabled' | 'departed';
/** A provider whose `cabins` excludes the definition's cabin: every cell no_data, no call. Spec §3. */
export type NoDataReason = 'cabin-not-offered';
/** The vendor message goes to lastError, never to reason. Spec §3. */
export type ErrorReason = ProviderErrorKind | NormalisationReason;

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
