import type { StopCause, StopDetail } from '../api-contract/stopCause.js';
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
/** Spec rev 55 §10: a run with a pass going or about to (pending or running); the cards poll and the bar cancels. */
export const IN_FLIGHT_STATUSES: readonly ExecutionStatus[] = ['pending', 'running'];
/**
 * Spec rev 55 §10: the statuses a run stops or is skipped in, the ones whose `stop` the api fills. A completed row (even
 * one that was once paused) has none.
 */
export const STOPPED_STATUSES: readonly ExecutionStatus[] = [
  'paused_budget',
  'paused_error',
  'interrupted',
  'cancelled',
  'skipped_budget',
  'skipped_confirm',
  'skipped_window',
  'skipped_missed',
];
export const RESUMABLE_STATUSES: readonly ExecutionStatus[] = [
  'interrupted',
  'paused_budget',
  'paused_error',
  'cancelled',
  'completed',
];
/**
 * The stopped statuses a run can be resumed from (WP20 Task 20.6 review, minor 11): the active ones `/resume` accepts,
 * a paused or interrupted run. The status bar and a search's page offer Resume only on one of these, and only when the
 * stop's fix names Resume.
 */
export const RESUMABLE_ACTIVE_STATUSES: readonly ExecutionStatus[] = ACTIVE_STATUSES.filter((s) =>
  RESUMABLE_STATUSES.includes(s),
);
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
  /**
   * Spec revision 55 §8.1 "Estimate" (ruling A5): with camoufox in discovery, the flight-list step's pages and seconds
   * (`pages` the least of 10 less the reusable date pairs and the run's free calls left; `seconds` pages × (spacing +
   * 40)). Its seconds count in `seconds`; its pages never in `totalCalls`.
   * Absent (no key) without camoufox. Revision 56 (R-estimate): `pages` and `seconds` are the typical figures; `pairs`
   * the date pairs read and `returns` whether at least one of them goes out and back (both required on the engine's
   * producer type since Task 21.7), and
   * `pagesMax`/`secondsMax` the bound, present whenever the plan reads the return leg where the pages allow (absent on
   * an outbound-only plan); `estimateSchema` keeps
   * every one of them optional for good, so an estimate stored before WP21 still parses (ruling A3).
   */
  flightLists?: {
    pages: number;
    seconds: number;
    pairs: number;
    returns: boolean;
    pagesMax?: number;
    secondsMax?: number;
  };
}

/**
 * Spec revision 55 §7 `search_executions.flight_lists_json`, §8.1 "The flight-list step": the run's flight-list plan,
 * written once when the step selects at least one date pair to read or to reuse. `cells` are the planned cells (one
 * airport pair per date pair, the figure's), `reused` how many of them a fresh enough list covered with no page, and
 * `ended` why the step ended early (null while it has not, or when it read every planned cell). A resume never changes
 * `planned` or `cells`. The `disabled` end the execution response can report is derived at read time, never stored.
 * Revision 56 §7, §8.1: `returns` and `booking`, whether the plan reads returns and the shown pairing's booking options
 * (from the worker's flags), and `returnsStopped` and `bookingStopped`, the rule that stopped the run's return phases or
 * booking reads; a plan stored before WP21 has none of the four, and the reader fills false, false, null, null.
 * Design 2026-11-08 §4.2, §7: in confirm mode the step reads an open-ended queue, so `cells` grows as each read starts
 * (carried across passes) and `planned` is always `cells.length + reused`; an outbound-only plan keeps the fixed cells.
 */
export interface FlightListsState {
  planned: number;
  cells: CellKey[];
  reused: number;
  /** `monthly-cap` only on a plan stored before spec rev 64 withdrew the browser's monthly caps; nothing writes it now. */
  ended: 'window' | 'monthly-cap' | 'stopped' | null;
  returns: boolean;
  booking: boolean;
  returnsStopped: string | null;
  bookingStopped: string | null;
  /** Design 2026-11-08 §7: how checking went (`ConfirmSummary`); null on a plan stored before that change. */
  confirm: ConfirmSummary | null;
  /**
   * Design 2026-11-08 §5.5: the stop detail of the ending page or cap that set `ended: 'stopped'` (the first one the step
   * met, never a later in-flight failure); null otherwise and on a plan stored before it.
   */
  endedReason: StopDetail | null;
}

/** Design 2026-11-08 §4.6, §7: whether the step reads until rule A stops it, or why it reads outbound only. */
export const CONFIRM_MODES = ['confirm', 'outbound-only', 'flags-unread'] as const;
/** Design 2026-11-08 §4.4, §4.6: the stops the step's own rule records (the run's other stops stay in `ended`). */
export const CONFIRM_STOPS = ['patience', 'queue-empty', 'returns-stopped'] as const;

/**
 * Design 2026-11-08 §7 (confirm the cheapest trips): the step's stored summary, one owner per count. The date pairs read
 * are `FlightListsState.cells` (this run's started pairs, carried across passes) and the pairs reused are
 * `FlightListsState.reused`, so "Checked N" is `cells.length + reused` (= `planned`). Here: `mode` (`confirm` while
 * returns are read; `outbound-only` when the worker's flags were read and lack RETURN_SELECT_VERIFIED; `flags-unread`
 * when no flags had been read when the step planned), `confirmed` the trips in the standings ("trips with flights read"
 * to the operator), `unread` the reads that learnt nothing about their flights (§4.3), `uncheckedCheaper` the queue's
 * pairs left unread whose calendar price is below the 5th confirmed price (every one with fewer than 5, §4.5), and
 * `stop` the rule-A stop that ended the step (null while it runs, or when another stop ended it: see `ended`).
 */
export interface ConfirmSummary {
  mode: (typeof CONFIRM_MODES)[number];
  confirmed: number;
  unread: number;
  uncheckedCheaper: number;
  stop: (typeof CONFIRM_STOPS)[number] | null;
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
  /**
   * Spec revision 55 §7 (migration 0011): why the run stopped or was skipped, stored by every status write that stops
   * or skips one and cleared by the write that makes it pending, running or completed (the resume claim included).
   * Null on a stopped row means it was written before 0011, and it reads `NO_STOP_CAUSE_TEXT`, never `errorText`.
   */
  stopCause: StopCause | null;
  /** Spec revision 55 §7 (migration 0011): the run's flight-list plan, or null when the step selected nothing. */
  flightLists: FlightListsState | null;
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
