import {
  type BudgetExceeded,
  type BudgetScope,
  type BudgetScopeKind,
  type CellKey,
  cellKeyString,
  cooldownNoticeKey,
  type DefinitionSnapshot,
  type Execution,
  type IsoDateTime,
  type Logger,
  type OperatorMessageKind,
  ProviderError,
  type ProviderId,
  type SkipDetail,
  type SkipReason,
  type Stage,
  type StopCause,
  type StopDetail,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { classifyFailure } from './errors.js';
import { type LineKey, lineKey } from './lines.js';
import { disabledDetailBefore, searchedDatePairsOf, toStopDetail } from './stopCause.js';
import { budgetText } from './text.js';

/** A cancel's own cause (spec revision 55 §8.1): the operator's, or a supersede's (the schedule, Search again, Remove). */
export type CancelCause = Extract<StopCause, { kind: 'cancelled' | 'superseded' }>;

/**
 * Why a pass stopped early. Each maps to one execution status and one stored cause in execute.ts `finalStatus` (spec
 * §8.1 error table, revision 55 "Stop causes"); a cancel carries its cause, which is stored as it is.
 */
export type StopReason =
  | { kind: 'sigterm' }
  | { kind: 'cancel'; cause: CancelCause }
  | { kind: 'limiter-timeout'; providerId: ProviderId; resumeAfter: IsoDateTime | null }
  /** `resetsAt`: the cap window's end (revision 55 §8.1), kept on the cause even when no resume is scheduled. */
  | { kind: 'budget'; error: BudgetExceeded; resumeAfter: IsoDateTime | null; resetsAt: IsoDateTime | null }
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
  /**
   * The scope of the budget breach that took the provider out of the stage (provider-execution, provider-month,
   * provider-lifetime or global-month), or null while it may take cells. Revision 55 §8.1: the flight-list step reads
   * which cap stopped the browser lane.
   */
  budgetOutScope: BudgetScopeKind | null;
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
  /**
   * Revision 55 §8.1 "Stop causes": why each disabled provider was left out, as a `sources-unavailable` cause states it
   * (its skip, its `STOP_DETAILS` word, the instant a pause ends). Seeded for a resumed pass from the outcome rows of the
   * providers an earlier pass disabled, so a pass whose only provider stays disabled still names one source.
   */
  readonly disabledDetail: Map<ProviderId, DisabledDetail>;
  /** Revision 55 §6.6: the date pairs of the run's snapshot space `datePairSearched` accepts over its roll-ups. */
  searchedDatePairs(): number;
  /**
   * Revision 55 §8.1: the flight-list step's counts once it ran (Task 20.9 sets them), carried on the budget cause it
   * runs after; null when the step did not run.
   */
  flightLists: { read: number; planned: number } | null;
  /**
   * Revision 55 §8.1: a cancel, SIGTERM or fatal stop that arrives during the flight-list step after an earlier stop, or
   * a cancel or SIGTERM once the browser worker's per-run page cap stands and before the step starts (`stopRun`); finish
   * prefers it to `stop`.
   */
  flightStop: StopReason | null;
  /**
   * Revision 55 §8.1: true while the flight-list step runs (stages/flightLists.ts sets and clears it), so `stopRun` can
   * record a cancel, SIGTERM or fatal stop that arrives then, after an earlier stop, as `flightStop`.
   */
  flightStepActive: boolean;
  readonly parseStreak: Map<ProviderId, number>;
  /** How many of the parse streak's latest errors in a row are camoufox pages that did not settle (rev 49). */
  readonly notReadyStreak: Map<ProviderId, number>;
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

/** Revision 55 §8.1: one disabled provider as a `sources-unavailable` cause names it. */
export interface DisabledDetail {
  skip: 'provider_disabled' | 'provider_unavailable';
  detail: StopDetail;
  until: IsoDateTime | null;
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
    disabledDetail: disabledDetailBefore(ctx, exec.id),
    searchedDatePairs: () => searchedDatePairsOf(ctx, exec),
    flightLists: null,
    flightStop: null,
    flightStepActive: false,
    parseStreak: new Map(),
    notReadyStreak: new Map(),
    lanes: new Map(),
    plannedTiles: new Map(),
    notices: [],
    windowCheckDue: opts.fresh,
    log: ctx.log.child({ executionId: exec.id, definitionId: exec.definitionId }),
  };
}

/**
 * Records the first stop reason; stops new work, and aborts calls in flight only for cancel, SIGTERM and fatal.
 * Revision 55 §8.1 (ruling A16, the 20.9 review's ruling and the final review's): a later stop becomes `flightStop`,
 * which `finish` prefers, in two cases only. While the flight-list step runs after an earlier stop, a cancel, SIGTERM or
 * fatal stop (the step's own database failure, R-dberror) ends the run `cancelled`, `interrupted` or fatal. Once the
 * browser worker's per-run page cap stands and before the step starts, only a cancel or SIGTERM does
 * (`cancelOrSigtermBeforeFlightStep`); a fatal stop there is logged and the run keeps the budget stop's outcome.
 */
export function stopRun(run: RunState, reason: StopReason): void {
  if (run.stop === null) run.stop = reason;
  else if (
    run.flightStop === null &&
    ABORTING.has(reason.kind) &&
    (run.flightStepActive || cancelOrSigtermBeforeFlightStep(run.stop, reason))
  )
    run.flightStop = reason;
  else if (reason.kind === 'fatal')
    // why: a fatal stop that is not recorded must still be seen: its message is in the log, never lost silently
    run.log.error(
      { err: reason.message, kept: run.stop.kind },
      'execution: a later fatal stop was not recorded',
    );
  run.intake.abort();
  if (ABORTING.has(reason.kind)) run.controller.abort();
}

/**
 * Whether `reason` is a cancel or SIGTERM arriving after the one stop the flight-list step runs after (spec rev 55
 * §8.1: the browser worker's own per-run page cap) and before the step starts (the 20.9 review's ruling). Only those
 * two are recorded as `flightStop` there, so the run ends cancelled or interrupted rather than paused; a fatal stop
 * never is (the final review's ruling), so it cannot replace the page cap's paused_budget before the step has run.
 */
function cancelOrSigtermBeforeFlightStep(stop: StopReason, reason: StopReason): boolean {
  return (
    (reason.kind === 'cancel' || reason.kind === 'sigterm') &&
    stop.kind === 'budget' &&
    stop.error.scope === 'provider-execution' &&
    stop.error.providerId === 'camoufox'
  );
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
    budgetOutScope: null,
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
 * A call for `providerId` settled with an answer (spec §8.1: any other outcome breaks a parse streak): both streaks end.
 * A camoufox page that settled breaks a run of pages that did not, whether its views were read or refused.
 */
export function streakBroken(run: RunState, providerId: ProviderId): void {
  run.parseStreak.set(providerId, 0);
  run.notReadyStreak.set(providerId, 0);
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
  // why: WP18 V4 — http-kit finalised the call `ok` before the adapter read the body; an adapter that rejects it throws
  // `parse`, and the ledger row then stops reading as a success (a malformed body http-kit already marked is left as is)
  if (err instanceof ProviderError && err.kind === 'parse')
    ctx.repos.ledger.markRejected(providerId, run.executionId, 'parse');
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
      // why: Ian's ruling of 2026-10-26 (spec §8.1 rev 49): a streak made only of camoufox pages that did not settle
      // disables at three; one holding any other parse error keeps the rule of two
      const notReady = d.notReady ? (run.notReadyStreak.get(providerId) ?? 0) + 1 : 0;
      run.notReadyStreak.set(providerId, notReady);
      const limit = notReady === streak ? 3 : 2;
      log.warn({ stage, reason: d.reason, cells: cells.length, parseStreak: streak }, 'cells marked error');
      if (d.unavailable)
        disableProvider(
          run,
          providerId,
          'its worker refused the connection (browser worker not reachable)',
          'provider_unavailable',
          undefined,
          { detail: 'provider-unavailable', until: null },
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
          { detail: toStopDetail(d.reason, 'blocked'), until },
        );
      } else if (streak >= limit)
        disableProvider(
          run,
          providerId,
          limit === 3 ? 'three consecutive pages that did not settle' : 'two consecutive parse errors',
          'provider_disabled',
          undefined,
          { detail: 'parse', until: null },
        );
      return;
    }
    case 'limiter-timeout':
      log.warn({ stage, resumeAfter: d.resumeAfter }, 'limiter deadline passed; pausing');
      stopRun(run, { kind: 'limiter-timeout', providerId, resumeAfter: d.resumeAfter });
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
export function budgetOut(
  ctx: EngineContext,
  run: RunState,
  stage: Stage,
  providerId: ProviderId,
  scope: BudgetScopeKind,
): void {
  const lane = laneFor(run, stage, providerId);
  if (lane.budgetOutScope !== null) return;
  lane.budgetOutScope = scope;
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
    for (const id of stageProviders(run, stage)) budgetOut(ctx, run, stage, id, err.scope);
    stopRun(run, { kind: 'child-cap', error: err });
    return;
  }
  if (
    err.scope === 'execution-calls' ||
    err.scope === 'execution-free-calls' ||
    err.scope === 'execution-cost'
  ) {
    stopRun(run, { kind: 'budget', error: err, resumeAfter: null, resetsAt: null });
    return;
  }
  const ids = stageProviders(run, stage);
  const global = err.scope === 'global-month';
  const affected = global ? ids.filter((id) => ctx.limitsOf(id).billed) : [providerId];
  for (const id of affected) budgetOut(ctx, run, stage, id, err.scope);
  // why: ssr2-02 — a provider the pre-start or resume check blocked for budget does not remain in the stage either
  const remaining = ids.filter(
    (id) =>
      !run.disabled.has(id) &&
      !run.blocked.has(lineKey(stage, id)) &&
      laneFor(run, stage, id).budgetOutScope === null,
  );
  if (remaining.length === 0) {
    // why: a provider's own per-run cap (camoufox pages, spec §8.1 rev 32) has no window to wait for: manual resume only.
    if (err.scope === 'provider-execution') {
      stopRun(run, { kind: 'budget', error: err, resumeAfter: null, resetsAt: null });
      return;
    }
    const scope: BudgetScope = global ? { kind: 'global-month' } : { kind: err.scope, providerId };
    // why: W3: a counter that states its own window (the browser worker's) resumes the run when that window ends;
    // finish keeps that end as the cause's resetsAt and clears the resume where revision 55 §8.1 says none happens
    const windowEnd = err.windowEnd ?? ctx.budget.usage(scope).windowEnd;
    stopRun(run, { kind: 'budget', error: err, resumeAfter: windowEnd, resetsAt: windowEnd });
    return;
  }
  run.notices.push({
    kind: 'provider_capped',
    detail: `${affected.join(', ')}: ${budgetText(err, 'the next call needed')}. Its remaining ${stage} cells are skipped (budget) in this run and the other providers continue.`,
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
  /** The notice in the caller's own words; `key` makes it once-only across runs (a cool-down's). */
  notice?: { detail: string; key?: string },
  cause: { detail: StopDetail; until: IsoDateTime | null } = {
    detail: reason === 'provider_unavailable' ? 'provider-unavailable' : 'blocked',
    until: null,
  },
): void {
  if (run.disabled.has(providerId)) return;
  run.disabled.add(providerId);
  run.disabledReason.set(providerId, reason);
  // why: revision 55 §8.1 — the stop cause names the source with its class word only, never the vendor's sentence
  run.disabledDetail.set(providerId, {
    skip: reason === 'provider_unavailable' ? 'provider_unavailable' : 'provider_disabled',
    detail: cause.detail,
    until: cause.until,
  });
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
  if (lane.budgetOutScope !== null) markRemaining(ctx, run, stage, providerId, 'budget');
  // why: decision 83 — a page that was in flight when the window closed and came back not_run (aborted) is left for the
  // next scheduled run too, never fetched by a later resume
  if (lane.windowOut !== null)
    markRemaining(ctx, run, stage, providerId, 'scheduled_only', new Set(), lane.windowOut);
  if (run.disabled.has(providerId))
    markRemaining(ctx, run, stage, providerId, run.disabledReason.get(providerId) ?? 'provider_disabled');
}
