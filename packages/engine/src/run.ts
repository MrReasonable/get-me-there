import {
  type BudgetExceeded,
  type BudgetScope,
  type CellKey,
  cellKeyString,
  cooldownNoticeKey,
  type DefinitionSnapshot,
  type Execution,
  type IsoDateTime,
  type Logger,
  type OperatorMessageKind,
  type ProviderId,
  type SkipDetail,
  type SkipReason,
  type Stage,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { classifyFailure } from './errors.js';
import { type LineKey, lineKey } from './lines.js';
import { breachText } from './text.js';

/** Why a pass stopped early. Each maps to one execution status in execute.ts `finalStatus` (spec §8.1 error table). */
export type StopReason =
  | { kind: 'sigterm' }
  | { kind: 'cancel' }
  | { kind: 'limiter-timeout'; resumeAfter: IsoDateTime | null }
  | { kind: 'budget'; error: BudgetExceeded; resumeAfter: IsoDateTime | null }
  | { kind: 'all-disabled'; stage: Stage }
  | { kind: 'child-cap'; error: BudgetExceeded }
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
  /**
   * Decision 79/83: the detail the provider's remaining cells were left with once the lane stopped loading browser pages
   * (`outside-browser-window` after a window check, `catch-up-no-browser` for a catch-up); null while it may load them.
   */
  windowOut: SkipDetail | null;
}

/** In-memory state of one pass over one execution. Nothing here survives a restart; the DB does. */
export interface RunState {
  readonly executionId: string;
  readonly definitionId: string;
  readonly isChild: boolean;
  /** Decision 79: a catch-up never loads a browser page, whatever its cells' state. */
  readonly isCatchUp: boolean;
  readonly cell: CellKey | null;
  /** Read once from the execution row; a later PUT to the definition never reaches a running pass (Review Focus 4). */
  readonly snapshot: DefinitionSnapshot;
  /** Manual resume semantics (spec §7 resume query). */
  readonly manual: boolean;
  /** True for the first pass started by start()/verifyCell(); parity is judged only on such passes. */
  readonly fresh: boolean;
  /** The (stage, provider) lines the pre-start or resume check blocked for budget (ruling 2). */
  readonly blocked: ReadonlySet<LineKey>;
  /** Aborts calls in flight (cancel, SIGTERM, fatal); every provider call of the pass gets its signal. */
  readonly controller: AbortController;
  /** Stops new work for the whole pass (every stop). */
  readonly intake: AbortController;
  stop: StopReason | null;
  readonly disabled: Set<ProviderId>;
  /**
   * The skip reason a disabled provider's remaining cells get: provider_disabled, or provider_unavailable when the
   * camoufox worker could not be reached (spec §3, §8.1 rev 32). Absent: provider_disabled.
   */
  readonly disabledReason: Map<ProviderId, SkipReason>;
  readonly parseStreak: Map<ProviderId, number>;
  readonly lanes: Map<string, Lane>;
  /** Discovery tiles planned in this pass, per provider (parity, spec §8.1). */
  readonly plannedTiles: Map<ProviderId, number>;
  /** `key` makes a notice once-only across runs (camoufox's once-per-cool-down notice, cost-015). */
  readonly notices: Array<{
    kind: OperatorMessageKind;
    detail: string;
    key?: string;
  }>;
  /**
   * Decision 83: the browser window is checked before the next browser page: set for a fresh pass's first page (check
   * a) and by a detected suspension (check c); a resume checks it before its claim instead (check b).
   */
  windowCheckDue: boolean;
  readonly log: Logger;
}

/**
 * Providers an earlier pass of the execution disabled (auth, quota, a parse streak): those with skipped:provider_disabled
 * outcomes. An automatic resume keeps them disabled, in its estimate and its pass alike; only a manual one re-admits them.
 */
export function disabledBefore(ctx: EngineContext, executionId: string): Set<ProviderId> {
  return new Set(
    ctx.repos.cells
      .outcomes(executionId)
      .filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')
      .map((o) => o.providerId),
  );
}

/**
 * Providers the execution holds a `blocked` outcome for (camoufox's stops, spec §8.1 rev 32): kept disabled by every
 * resume, a manual one included, because the worker's cool-down, not the operator's click, ends a block.
 */
export function blockedBefore(ctx: EngineContext, executionId: string): Set<ProviderId> {
  return new Set(
    ctx.repos.cells
      .outcomes(executionId)
      .filter((o) => o.status === 'error' && o.reason === 'blocked')
      .map((o) => o.providerId),
  );
}

/** The providers a resumed pass starts without: those blocked, and (automatic resumes) those disabled before. */
export function disabledFor(ctx: EngineContext, executionId: string, manual: boolean): Set<ProviderId> {
  const out = blockedBefore(ctx, executionId);
  if (!manual) for (const id of disabledBefore(ctx, executionId)) out.add(id);
  return out;
}

/** Fresh pass state for an execution row. */
export function newRun(
  ctx: EngineContext,
  exec: Execution,
  opts: { manual: boolean; fresh: boolean; blocked: ReadonlySet<LineKey> },
): RunState {
  return {
    executionId: exec.id,
    definitionId: exec.definitionId,
    isChild: exec.isChild,
    isCatchUp: exec.isCatchUp,
    cell: exec.cell,
    snapshot: exec.snapshot,
    manual: opts.manual,
    fresh: opts.fresh,
    blocked: opts.blocked,
    controller: new AbortController(),
    intake: new AbortController(),
    stop: null,
    // why: spec §8.1 an automatic resume does not re-enable a provider the previous pass disabled (ssr M1), and no
    // resume re-enables a blocked one (rev 32)
    disabled: disabledFor(ctx, exec.id, opts.manual),
    disabledReason: new Map(),
    parseStreak: new Map(),
    lanes: new Map(),
    plannedTiles: new Map(),
    notices: [],
    windowCheckDue: opts.fresh,
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
    windowOut: null,
  };
  run.lanes.set(key, lane);
  return lane;
}

/**
 * Marks every `not_run` outcome of (stage, provider), except `exclude`, as skipped with `reason` (and, for
 * `scheduled_only`, its `skipDetail`, spec §3 rev 36). Without exclusions this is one repository statement; with them,
 * one transaction of per-cell updates.
 */
export function markRemaining(
  ctx: EngineContext,
  run: Pick<RunState, 'executionId'>,
  stage: Stage,
  providerId: ProviderId,
  reason: SkipReason,
  exclude: ReadonlySet<string> = new Set(),
  skipDetail?: SkipDetail,
): number {
  const to = { status: 'skipped' as const, reason, ...(skipDetail === undefined ? {} : { skipDetail }) };
  if (exclude.size === 0)
    return ctx.repos.cells.setOutcomesForProvider(run.executionId, stage, providerId, ['not_run'], to);
  const rows = ctx.repos.cells
    .outcomes(run.executionId, { stage, providerId })
    .filter((o) => o.status === 'not_run' && !exclude.has(cellKeyString(o)));
  if (rows.length === 0) return 0;
  ctx.db.transaction(() => {
    for (const o of rows) ctx.repos.cells.setOutcome(run.executionId, o, stage, providerId, to);
  });
  return rows.length;
}

/**
 * The spec §7 resume query (which never returns `no-return-legs` or `no-priced-options` errors, decision 37) less any
 * cell whose departure date has arrived. A resume marks those skipped:departed in its claim (ruling 1); this read is
 * the one predicate both the cap check's `estimateRemainingFor` and the pass's `runnableCells` use, so the pass plans
 * exactly the calls the check counted (ssr I1).
 */
export function resumableCells(
  ctx: EngineContext,
  executionId: string,
  stage: Stage,
  providerId: ProviderId,
  manual: boolean,
): CellKey[] {
  const today = ctx.clock.todayLondon();
  return ctx.repos.cells
    .resumable(executionId, stage, providerId, manual)
    .filter((c) => c.departureDate > today);
}

/** Cells of (stage, provider) this pass should fetch: none for a provider disabled or blocked for budget in this pass. */
export function runnableCells(
  ctx: EngineContext,
  run: RunState,
  stage: Stage,
  providerId: ProviderId,
): CellKey[] {
  // why: a provider the pre-start or resume check blocked for budget makes no call in this pass (cost-r1-001)
  if (run.disabled.has(providerId) || run.blocked.has(lineKey(stage, providerId))) return [];
  return resumableCells(ctx, run.executionId, stage, providerId, run.manual);
}

/**
 * Applies the spec §8.1 error table to one failed tile (discovery) or cell (verification) call. The cells of the call
 * are `cells`; nothing has been written for them yet.
 */
export function onFailure(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  stage: Stage,
  cells: readonly CellKey[],
  err: unknown,
): void {
  const d = classifyFailure(err, run.controller.signal.aborted, ctx.clock.now());
  const log = run.log.child({ providerId });
  switch (d.kind) {
    case 'abort':
      return; // why: spec §3 "a cell interrupted mid-flight returns to not_run" — nothing was written, so it still is
    case 'cell-error': {
      if (stage === 'discovery')
        ctx.repos.cells.writeTileError(run.executionId, providerId, [...cells], d.reason, d.lastError);
      else {
        ctx.db.transaction(() => {
          for (const cell of cells)
            ctx.repos.cells.setOutcome(run.executionId, cell, stage, providerId, {
              status: 'error',
              reason: d.reason,
              lastError: d.lastError,
              incrementAttempts: true,
            });
        });
      }
      // why: spec §8.1 "2 consecutive [parse errors] for one provider (counted in ledger finalisation order)";
      // calls settle in finalisation order, and any other outcome breaks the streak
      const streak = d.parse ? (run.parseStreak.get(providerId) ?? 0) + 1 : 0;
      run.parseStreak.set(providerId, streak);
      log.warn({ stage, reason: d.reason, cells: cells.length, parseStreak: streak }, 'cells marked error');
      if (d.unavailable)
        disableProvider(
          run,
          providerId,
          'its worker refused the connection (browser worker not reachable)',
          'provider_unavailable',
        );
      else if (d.disableProvider) {
        const until = d.reason === 'blocked' ? d.cooldownUntil : null;
        // why: cost-015: a block is notified once per cool-down, keyed by its end (data on the error), never once per run
        disableProvider(
          run,
          providerId,
          `an ${d.reason} error`,
          'provider_disabled',
          until === null
            ? undefined
            : {
                detail: `${providerId} stopped: ${d.lastError}. Its remaining cells are skipped (provider disabled) and it is not called again until the cool-down ends.`,
                key: cooldownNoticeKey(providerId, until),
              },
        );
      } else if (streak >= 2) disableProvider(run, providerId, 'two consecutive parse errors');
      return;
    }
    case 'limiter-timeout':
      log.warn({ stage, resumeAfter: d.resumeAfter }, 'limiter deadline passed; pausing');
      stopRun(run, { kind: 'limiter-timeout', resumeAfter: d.resumeAfter });
      return;
    case 'budget':
      applyBudgetBreach(ctx, run, providerId, stage, d.error);
      return;
    case 'fatal':
      log.error({ stage, err: d.message }, 'unexpected failure; pausing');
      stopRun(run, { kind: 'fatal', message: d.message });
      return;
  }
}

function stageProviders(run: RunState, stage: Stage): readonly ProviderId[] {
  return stage === 'discovery' ? run.snapshot.providers.discovery : run.snapshot.providers.verification;
}

/**
 * Takes one provider out of a stage for budget: its lane stops taking cells and its idle `not_run` cells become
 * skipped:budget now; calls already in flight passed every cap when they reserved, so they finish and are written
 * (decision 25); settleLane marks what is still not_run once the pool drains.
 */
export function budgetOut(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId): void {
  const lane = laneFor(run, stage, providerId);
  if (lane.budgetOut) return;
  lane.budgetOut = true;
  lane.intake.abort();
  markRemaining(ctx, run, stage, providerId, 'budget', lane.inFlight);
}

/**
 * Spec §8.1 error table, BudgetExceeded rows, with decision 25 (a reservation that passed every cap is honoured; only
 * new reservations are refused; nothing in flight is aborted):
 * - execution-*: the pass takes no new work; cells not started stay not_run; paused_budget, no one-shot job.
 * - provider-month / provider-lifetime: that provider's remaining cells in the stage skipped:budget; others remain →
 *   continue and notify once; none remain → paused_budget, resume_after = the provider's next window start (a
 *   lifetime window has none, so no one-shot job).
 * - global-month: billed providers' remaining cells skipped:budget; a free provider remains → continue; else
 *   paused_budget at the global window start.
 * BudgetExceeded is never recorded as a cell error.
 */
export function applyBudgetBreach(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  stage: Stage,
  err: BudgetExceeded,
): void {
  run.log
    .child({ providerId })
    .warn(
      { stage, scope: err.scope, cap: err.cap, current: err.current, requested: err.requested },
      'budget cap reached',
    );
  if (run.isChild) {
    // why: ruling 7 — a child never pauses: its cell is skipped for budget, the child ends cancelled, the parent's cell
    // stays unverified and a new child can be started by hand
    for (const id of stageProviders(run, stage)) budgetOut(ctx, run, stage, id);
    stopRun(run, { kind: 'child-cap', error: err });
    return;
  }
  if (
    err.scope === 'execution-calls' ||
    err.scope === 'execution-free-calls' ||
    err.scope === 'execution-cost'
  ) {
    stopRun(run, { kind: 'budget', error: err, resumeAfter: null });
    return;
  }
  const ids = stageProviders(run, stage);
  const global = err.scope === 'global-month';
  const affected = global ? ids.filter((id) => ctx.limitsOf(id).billed) : [providerId];
  for (const id of affected) budgetOut(ctx, run, stage, id);
  // why: ssr2-02 — a provider the pre-start or resume check blocked for budget does not remain in the stage either
  const remaining = ids.filter(
    (id) =>
      !run.disabled.has(id) && !run.blocked.has(lineKey(stage, id)) && !laneFor(run, stage, id).budgetOut,
  );
  if (remaining.length === 0) {
    // why: a provider's own per-run cap (camoufox pages, spec §8.1 rev 32) has no window to wait for: manual resume only.
    if (err.scope === 'provider-execution') {
      stopRun(run, { kind: 'budget', error: err, resumeAfter: null });
      return;
    }
    const scope: BudgetScope = global ? { kind: 'global-month' } : { kind: err.scope, providerId };
    stopRun(run, { kind: 'budget', error: err, resumeAfter: ctx.budget.usage(scope).windowEnd });
    return;
  }
  run.notices.push({
    kind: 'provider_capped',
    detail: `${affected.join(', ')}: ${breachText(err.scope, providerId, err.cap, err.current, err.requested, 'the next call needed', err.unit ?? 'calls')}. Its remaining ${stage} cells are skipped (budget) in this run and the other providers continue.`,
  });
}

/**
 * Spec §8.1 "provider disabled for the run": its lanes stop taking cells; calls already in flight finish and are
 * written (decision 25); settleLane marks what is left skipped:provider_disabled once the pool drains.
 */
export function disableProvider(
  run: RunState,
  providerId: ProviderId,
  why: string,
  reason: SkipReason = 'provider_disabled',
  notice?: { detail: string; key: string },
): void {
  if (run.disabled.has(providerId)) return;
  run.disabled.add(providerId);
  run.disabledReason.set(providerId, reason);
  for (const [key, lane] of run.lanes) if (key.endsWith(`|${providerId}`)) lane.intake.abort();
  const skipped = reason === 'provider_unavailable' ? 'browser worker not reachable' : 'provider disabled';
  run.notices.push(
    notice === undefined
      ? {
          kind: 'provider_disabled',
          detail: `${providerId} was disabled for this run after ${why}; its remaining cells are skipped (${skipped}).`,
        }
      : { kind: 'provider_disabled', ...notice },
  );
  run.log.warn({ providerId, why }, 'provider disabled for the run');
}

/** After a lane's pool drains: budget and disable marking of whatever is still not_run (spec §8.1 "remaining cells …"). */
export function settleLane(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId): void {
  const lane = laneFor(run, stage, providerId);
  if (lane.budgetOut) markRemaining(ctx, run, stage, providerId, 'budget');
  // why: decision 83 — a page that was in flight when the window closed and came back not_run (aborted) is left for the
  // next scheduled run too, never fetched by a later resume
  if (lane.windowOut !== null)
    markRemaining(ctx, run, stage, providerId, 'scheduled_only', new Set(), lane.windowOut);
  if (run.disabled.has(providerId))
    markRemaining(ctx, run, stage, providerId, run.disabledReason.get(providerId) ?? 'provider_disabled');
}
