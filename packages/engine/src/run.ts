import {
  AbortedError,
  type BudgetExceeded,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  type IsoDateTime,
  type Logger,
  type OperatorMessageKind,
  type ProviderId,
  type SkipReason,
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { EngineContext } from './context.js';

/** Why a pass stopped early. Each maps to one execution status in execute.ts `finalStatus` (spec §8.1 error table). */
export type StopReason =
  | { kind: 'sigterm' }
  | { kind: 'cancel' }
  | { kind: 'limiter-timeout'; resumeAfter: IsoDateTime | null }
  | { kind: 'budget'; error: BudgetExceeded; resumeAfter: IsoDateTime | null }
  | { kind: 'all-disabled'; stage: Stage }
  | { kind: 'fatal'; message: string };

/**
 * Stops that abort calls already in flight. Every other stop only refuses new work: a call whose reservation passed
 * every cap finishes and its result is written (decision 25). SIGTERM and cancel abort (spec §8.1 AbortedError row);
 * a fatal stop means the database itself failed, so nothing more can be written (Review Focus 5).
 */
const ABORTING: ReadonlySet<StopReason['kind']> = new Set(['sigterm', 'cancel', 'fatal']);

/** One (stage, provider) lane: its own intake switch, joined with the pass's (spec §8.1 per-provider rows). */
export interface Lane {
  readonly intake: AbortController;
  /** AbortSignal.any([pass intake, lane intake]); the lane's pool stops taking cells once it aborts. */
  readonly intakeSignal: AbortSignal;
  /** Cell keys whose call is in flight, so a budget breach marks only the idle ones skipped at once. */
  readonly inFlight: Set<string>;
  /** Set once a provider-month, provider-lifetime or global-month breach took the provider out of the stage. */
  budgetOut: boolean;
}

/** In-memory state of one pass over one execution. Nothing here survives a restart; the DB does. */
export interface RunState {
  readonly executionId: string;
  readonly definitionId: string;
  readonly isChild: boolean;
  readonly cell: CellKey | null;
  /** Read once from the execution row; a later PUT to the definition never reaches a running pass (Review Focus 4). */
  readonly snapshot: DefinitionSnapshot;
  /** Manual resume semantics (spec §7 resume query). */
  readonly manual: boolean;
  /** True for the first pass started by start()/verifyCell(); parity is judged only on such passes. */
  readonly fresh: boolean;
  /** Providers the pre-start (or resume) budget check excluded from this pass. */
  readonly blocked: ReadonlySet<ProviderId>;
  /** Aborts calls in flight (cancel, SIGTERM, fatal); every provider call of the pass gets its signal. */
  readonly controller: AbortController;
  /** Stops new work for the whole pass (every stop). */
  readonly intake: AbortController;
  stop: StopReason | null;
  readonly disabled: Set<ProviderId>;
  readonly parseStreak: Map<ProviderId, number>;
  readonly lanes: Map<string, Lane>;
  /** Discovery tiles planned in this pass, per provider (parity, spec §8.1). */
  readonly plannedTiles: Map<ProviderId, number>;
  readonly notices: Array<{ kind: OperatorMessageKind; detail: string }>;
  readonly log: Logger;
}

/** Fresh pass state for an execution row. */
export function newRun(
  ctx: EngineContext,
  exec: Execution,
  opts: { manual: boolean; fresh: boolean; blocked: ReadonlySet<ProviderId> },
): RunState {
  return {
    executionId: exec.id,
    definitionId: exec.definitionId,
    isChild: exec.isChild,
    cell: exec.cell,
    snapshot: exec.snapshot,
    manual: opts.manual,
    fresh: opts.fresh,
    blocked: opts.blocked,
    controller: new AbortController(),
    intake: new AbortController(),
    stop: null,
    disabled: new Set(),
    parseStreak: new Map(),
    lanes: new Map(),
    plannedTiles: new Map(),
    notices: [],
    log: ctx.log.child({ executionId: exec.id, definitionId: exec.definitionId }),
  };
}

/** Records the first stop reason; stops new work, and aborts calls in flight only for cancel, SIGTERM and fatal. */
export function stopRun(run: RunState, reason: StopReason): void {
  if (run.stop === null) run.stop = reason;
  run.intake.abort();
  if (ABORTING.has(reason.kind)) run.controller.abort();
}

/** The lane for (stage, provider), created on first use. */
export function laneFor(run: RunState, stage: Stage, providerId: ProviderId): Lane {
  const key = `${stage}|${providerId}`;
  const existing = run.lanes.get(key);
  if (existing !== undefined) return existing;
  const intake = new AbortController();
  const lane: Lane = {
    intake,
    intakeSignal: AbortSignal.any([run.intake.signal, intake.signal]),
    inFlight: new Set(),
    budgetOut: false,
  };
  run.lanes.set(key, lane);
  return lane;
}

/**
 * Marks every `not_run` outcome of (stage, provider), except `exclude`, as skipped with `reason`.
 * Without exclusions this is one repository statement; with them, one transaction of per-cell updates.
 */
export function markRemaining(
  ctx: EngineContext,
  run: Pick<RunState, 'executionId'>,
  stage: Stage,
  providerId: ProviderId,
  reason: SkipReason,
  exclude: ReadonlySet<string> = new Set(),
): number {
  if (exclude.size === 0)
    return ctx.repos.cells.setOutcomesForProvider(run.executionId, stage, providerId, ['not_run'], {
      status: 'skipped',
      reason,
    });
  const rows = ctx.repos.cells
    .outcomes(run.executionId, { stage, providerId })
    .filter((o) => o.status === 'not_run' && !exclude.has(cellKeyString(o)));
  if (rows.length === 0) return 0;
  ctx.db.transaction(() => {
    for (const o of rows)
      ctx.repos.cells.setOutcome(run.executionId, o, stage, providerId, { status: 'skipped', reason });
  });
  return rows.length;
}

/** Cells of (stage, provider) this pass should fetch: the spec §7 resume query. */
export function runnableCells(
  ctx: EngineContext,
  run: RunState,
  stage: Stage,
  providerId: ProviderId,
): CellKey[] {
  if (run.disabled.has(providerId)) return [];
  return ctx.repos.cells.resumable(run.executionId, stage, providerId, run.manual);
}

/** Message text for any thrown value, URL-free (spec §5.3 secret scrubbing). */
export function errorText(err: unknown): string {
  return stripUrlsInText(err instanceof Error ? err.message : String(err));
}

/**
 * Handles a failed tile or cell call. Task 7.1: an abort leaves the cells `not_run` (nothing was written); anything
 * else stops the pass as fatal. Task 7.4 replaces this with the full error table.
 */
export function onFailure(
  _ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  stage: Stage,
  cells: readonly CellKey[],
  err: unknown,
): void {
  if (err instanceof AbortedError || run.controller.signal.aborted) return;
  run.log.warn(
    { providerId, stage, cells: cells.length, err: errorText(err) },
    'call failed; stopping the pass',
  );
  stopRun(run, { kind: 'fatal', message: errorText(err) });
}
