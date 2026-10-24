import {
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type Execution,
  type ExecutionStatus,
  type IsoDateTime,
  RESUMABLE_STATUSES,
} from '@gmt/core';
import { breachMessage, checkBudget, spendOf } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { addPass, estimateRemainingFor, withBlocked } from './estimate.js';
import { execute } from './execute.js';
import { lineKey } from './lines.js';
import type { Orchestrator } from './orchestrator.js';
import type { RunRegistry } from './registry.js';
import { disabledFor, markRemaining, newRun, resumableCells } from './run.js';
import { browserWindowEndFrom, windowAnchor } from './scheduler/browserWindow.js';
import { sellsCabin, snapshotBudget, withoutDiscovery } from './snapshot.js';
import { browserLeftAtResume, browserWindowNotice, leaveAtResume } from './stages/browserGate.js';
import {
  REUSE_TOLERANCE,
  refreshHoursOf,
  reusableFor,
  reuseCriteriaFor,
  skipBlockedDiscovery,
} from './stages/reuse.js';
import { confirmationNeeded, nothingToSearch, refused } from './start.js';
import type { StartResult } from './types.js';
import { HOUR_MS } from './units.js';

export interface ResumeOptions {
  manual: boolean;
  /**
   * Decision 83: the resume is the definition's own punctual live tick at this firing. It re-anchors the run before the
   * window check: `scheduled_for` becomes the firing (unless another row holds it) and the window's end is worked out
   * again from the estimate of the cells still resumable, so the firing the operator chose loads browser pages; both are
   * written inside the claim, so a refused resume moves neither.
   */
  liveTickFiring?: IsoDateTime;
}

/**
 * Spec §8.1 "Resume": allowed on interrupted | paused_* | cancelled, and on completed when retryable errors remain
 * (retry-errors). It is a compare-and-set — the tick, the one-shot job, boot auto-resume and /resume all go through it,
 * so losers get code `active` (409). /resume is also refused while another execution of the definition is active, and
 * an execution whose definition was soft-deleted is never resumed (plan decision 5).
 *
 * Order: the per-scope cap check uses estimateRemaining, which leaves out the cells whose departure date has arrived
 * (po-016); a manual resume of a paused_budget parent checks against the definition's current `budget` (and nothing
 * else), which needs the stored confirmation, pence and calls, when it raises the spend (cost-r1-005, decision 37); a
 * resume whose remaining discovery is all blocked, before any selection and with no price yet, is refused like a
 * start (ssr2-03). Nothing is written to the execution until the claim succeeds (ssr-09, arch-r2-006): marking the
 * departed cells skipped:departed, the refreshed budget, the blocked lines' cells (reuse first, then skipped:budget;
 * cost-r1-001, ruling 2) and
 * the pass's runnable plan added to the stored estimate (cost-r1-009, cost-r1-014) all go into the same transaction as
 * the compare-and-set. An automatic resume of a paused_error with nothing resumable leaves it as it is, unclaimed
 * (ruling 10); a manual resume re-admits the providers disabled in the previous pass. Decision 83: before anything is
 * priced, a live-tick resume re-anchors the run to its firing (worked out in memory, written by one guarded statement
 * inside the claim), and a browser provider outside the run's window (or any browser provider of a catch-up) is left out
 * of the estimate and the cap check; its cells the pass would fetch become skipped:scheduled_only inside the claim
 * (outside-browser-window, with one notice per run; catch-up-no-browser for a catch-up).
 */
export async function resumeExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  executionId: string,
  opts: ResumeOptions,
): Promise<StartResult> {
  const exec = ctx.repos.executions.get(executionId);
  if (exec === null) return refused('not_found', `execution ${executionId} not found`, { executionId });
  const def = ctx.repos.definitions.get(exec.definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', 'the definition of this execution was deleted', {
      executionId,
      definitionId: exec.definitionId,
    });
  if (reg.get(executionId) !== undefined || !RESUMABLE_STATUSES.includes(exec.status))
    return refused('active', `execution is ${exec.status} and cannot be resumed`, { status: exec.status });
  const other =
    exec.isChild && exec.cell !== null
      ? ctx.repos.executions.activeChild(exec.definitionId, exec.cell)
      : ctx.repos.executions.activeParent(exec.definitionId);
  if (other !== null && other.id !== exec.id)
    return refused('active', 'another execution of this definition is active', {
      activeExecutionId: other.id,
    });

  // why: ssr-07 — a row left by a version that created it before seeding has no cells; resuming it would end
  // completed with nothing searched, so it is cancelled instead
  if (!exec.isChild && ctx.repos.cells.rollUps(executionId).size === 0) {
    ctx.repos.executions.setStatus(executionId, 'cancelled', {
      finishedAt: ctx.clock.now(),
      resumeAfter: null,
      errorText: NEVER_STARTED,
    });
    return refused('not_found', `this execution ${NEVER_STARTED}; start a new run`, { executionId });
  }
  const refresh = opts.manual && exec.status === 'paused_budget' && !exec.isChild;
  const refreshed = refresh
    ? {
        ...exec,
        snapshot: {
          ...exec.snapshot,
          budget: snapshotBudget(ctx, def.budget, exec.snapshot.providers.discovery),
        },
      }
    : exec;
  const anchored = reanchor(ctx, refreshed, opts);
  // why: decision 83 check (b) — before anything is priced or cap-checked, a browser provider outside the window is
  // left out of the pass, its estimate and its cap check, so its monthly cap cannot refuse a resume the others can run
  const leaving = browserLeftAtResume(ctx, anchored);
  const outside = leaving.providers;
  const current =
    outside.length === 0 ? anchored : { ...anchored, snapshot: withoutDiscovery(anchored.snapshot, outside) };
  const remaining = estimateRemainingFor(ctx, current, opts.manual);
  const needed = remaining.perProvider.filter((p) => p.calls > 0);
  // why: ssr M2 — cells another run has priced since need no call but are still work: the pass copies them; and
  // decision 83 — cells a closed window leaves for the next scheduled run are work too, so View D stops offering them
  const copyable =
    needed.length === 0 &&
    (hasReusableWork(ctx, current, opts.manual) ||
      outside.some((id) => resumableCells(ctx, executionId, 'discovery', id, opts.manual).length > 0));
  if (needed.length === 0 && !copyable && current.status === 'completed')
    return refused('active', 'nothing left to retry on this execution', { executionId });
  if (needed.length === 0 && !copyable && !opts.manual && current.status === 'paused_error')
    return refused(
      'active',
      'nothing can resume automatically; a manual resume retries the providers that were disabled',
      { executionId },
    );
  const check = checkBudget(
    ctx,
    spendOf(remaining),
    current.snapshot.budget,
    current.id,
    current.definitionId,
  );
  const pass = withBlocked(remaining, check.blockedBy);
  const starved =
    !ctx.repos.cells.hasVerificationOutcomes(executionId) &&
    !ctx.repos.cells.outcomes(executionId, { stage: 'discovery' }).some((o) => o.status === 'priced') &&
    nothingToSearch(current.snapshot, { perProvider: needed }, check.blocked, (id) =>
      sellsCabin(ctx, id, current.snapshot.cabin),
    );
  const isBlocked = (p: (typeof needed)[number]) => check.blocked.has(lineKey(p.stage, p.providerId));
  if ((needed.length > 0 && needed.every(isBlocked)) || starved)
    return refused('cap', `budget cap: ${breachMessage(check.breaches)}`, { breaches: check.breaches });
  // why: field by field, so key order never matters and a lowered or unchanged cap is not a raise (code-architect
  // review 10); any cap that rose needs the stored confirmation
  const was = exec.snapshot.budget;
  const raised =
    refresh &&
    (def.budget.maxCalls > was.maxCalls ||
      def.budget.maxFreeCalls > was.maxFreeCalls ||
      def.budget.maxCostMicroGbp > was.maxCostMicroGbp);
  if (raised) {
    const confirm = confirmationNeeded(ctx, pass, check.blocked, {
      pence: def.confirmedCostPence,
      calls: def.confirmedCalls,
    });
    if (confirm !== null)
      return refused(
        'confirm',
        `${confirm.reason} under the raised budget and the definition's confirmation does not cover it`,
        {
          estimateMicroGbp: confirm.estimateMicroGbp,
          estimatePence: confirm.estimatePence,
          calls: confirm.calls,
          totalCalls: confirm.totalCalls,
        },
      );
  }
  let departed = 0;
  let leftOutside = 0;
  // why: decision 83 — the re-anchor is written only by a resume that is performed: inside the claim, in one guarded
  // statement with the window's end; when another row took the firing meanwhile the pass carries on under the old window
  let launched = anchored;
  let left = leaving;
  const claimed = ctx.db.immediateTransaction(() => {
    if (!ctx.repos.executions.claimResume(executionId)) return false;
    if (
      anchored !== refreshed &&
      anchored.scheduledFor !== null &&
      anchored.browserWindowEnd !== null &&
      !ctx.repos.executions.reanchorFiring(executionId, anchored.scheduledFor, anchored.browserWindowEnd)
    ) {
      ctx.log.info(
        { executionId, firing: anchored.scheduledFor },
        'resume: firing taken before the claim; old browser window kept',
      );
      launched = refreshed;
      left = browserLeftAtResume(ctx, refreshed);
    }
    departed = ctx.repos.cells.markDeparted(executionId, ctx.clock.todayLondon());
    for (const id of left.providers)
      leftOutside += leaveAtResume(ctx, executionId, id, opts.manual, left.detail);
    ctx.repos.executions.patch(executionId, {
      estimate: addPass(current.estimate, pass),
      ...(refresh ? { snapshot: refreshed.snapshot } : {}),
    });
    // why: ruling 2 — a blocked discovery line copies its reusable cells before the rest become skipped:budget
    for (const id of current.snapshot.providers.discovery)
      if (check.blocked.has(lineKey('discovery', id)))
        skipBlockedDiscovery(
          ctx,
          {
            executionId,
            definitionId: current.definitionId,
            snapshot: current.snapshot,
            manual: opts.manual,
          },
          id,
        );
    if (ctx.repos.cells.hasVerificationOutcomes(executionId))
      for (const id of current.snapshot.providers.verification)
        if (check.blocked.has(lineKey('verification', id)))
          markRemaining(ctx, { executionId }, 'verification', id, 'budget');
    return true;
  });
  if (!claimed) return refused('active', 'another resume claimed this execution first', { executionId });
  ctx.hooks.cancelResume(executionId); // why: spec §8.1 "cancelling the one-shot job in the same step"
  // why: the pass runs over the stored snapshot (the browser provider kept), whose cells left outside the window are
  // now scheduled_only, so it fetches none of them
  const run = newRun(
    ctx,
    { ...launched, status: 'running' },
    { manual: opts.manual, fresh: false, blocked: check.blocked },
  );
  // why: a catch-up leaves its browser cells by design (decision 79); only a closed window is news to the operator
  if (left.providers.length > 0 && left.detail === 'outside-browser-window')
    run.notices.push(browserWindowNotice(ctx, run));
  run.log.info(
    {
      manual: opts.manual,
      autoResumeCount: current.autoResumeCount,
      departed,
      blocked: [...check.blocked],
      leftOutsideWindow: leftOutside,
      browserWindowEnd: launched.browserWindowEnd,
    },
    'execution: resumed',
  );
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId };
}

/**
 * Decision 83: a live-tick resume makes its firing the run's anchor before the window check. This works the anchored
 * row out in memory and writes nothing: `scheduled_for` the firing and the end the anchor (the later of the firing and
 * now) plus 1.5 × the estimate of the cells still resumable. When another parent row already holds the firing the run
 * keeps its old window. A child or a catch-up is never re-anchored (a paused catch-up is superseded by the firing
 * instead). The claim writes the result (ExecutionsRepo.reanchorFiring), so a refused resume moves nothing.
 */
function reanchor(ctx: EngineContext, exec: Execution, opts: ResumeOptions): Execution {
  const firing = opts.liveTickFiring;
  if (firing === undefined || exec.isChild || exec.isCatchUp) return exec;
  if (exec.scheduledFor !== firing && ctx.repos.executions.firingTaken(exec.definitionId, firing)) {
    ctx.log.info(
      { executionId: exec.id, firing },
      'resume: firing held by another row; old browser window kept',
    );
    return exec;
  }
  const end = browserWindowEndFrom(
    windowAnchor(firing, ctx.clock.now()),
    estimateRemainingFor(ctx, exec, opts.manual).seconds,
  );
  return { ...exec, scheduledFor: firing, browserWindowEnd: end };
}

/**
 * Whether a resumed pass would copy any discovery cell from a newer run (ssr M2): the cells it would fetch, less the
 * providers an automatic resume keeps disabled, that have a reusable copy.
 */
function hasReusableWork(ctx: EngineContext, exec: Execution, manual: boolean): boolean {
  if (exec.isChild) return false;
  const disabled = disabledFor(ctx, exec.id, manual);
  return exec.snapshot.providers.discovery.some((id) => {
    const info = ctx.providers.get(id)?.discovery?.info;
    if (info === undefined || disabled.has(id) || !sellsCabin(ctx, id, exec.snapshot.cabin)) return false;
    const cells = resumableCells(ctx, exec.id, 'discovery', id, manual);
    const criteria = reuseCriteriaFor(ctx, exec.snapshot, id, info);
    return reusableFor(ctx, exec.definitionId, exec.snapshot, id, criteria, cells).length > 0;
  });
}

/** error_text of an execution cancelled because it was never seeded (ssr-07). */
export const NEVER_STARTED = 'never finished starting and was cancelled';

// why: ssr M3 — an interrupted run that no automatic resume picked up (AUTO_RESUME off, or above the crash-loop cap)
// is as dead as a paused one, so it goes stale the same way and never blocks the schedule for good
const STALEABLE: readonly ExecutionStatus[] = ['paused_budget', 'paused_error', 'interrupted'];

/**
 * Ruling 10: older than 0.9 × the shortest discoveryRefreshHours of the snapshot's discovery providers (168 h by
 * default), so the weekly tick supersedes a run that paused seconds after the previous firing, DST-shortened weeks
 * included. Age is elapsed time from started_at.
 */
export function olderThanRefresh(
  exec: Pick<Execution, 'startedAt' | 'createdAt' | 'snapshot'>,
  now: IsoDateTime,
): boolean {
  const ids = exec.snapshot.providers.discovery;
  const hours =
    ids.length === 0
      ? DEFAULT_DISCOVERY_REFRESH_HOURS
      : Math.min(...ids.map((id) => refreshHoursOf(exec.snapshot, id)));
  return Date.parse(now) - Date.parse(exec.startedAt ?? exec.createdAt) > REUSE_TOLERANCE * hours * HOUR_MS;
}

/**
 * Spec §8.1/§8.2: "any paused run older than discoveryRefreshHours whose resume_after is not in the future is cancelled
 * and a fresh run started" (olderThanRefresh, ruling 10); an interrupted run counts as paused here (ssr M3).
 */
export function isStalePaused(
  exec: Pick<Execution, 'status' | 'resumeAfter' | 'startedAt' | 'createdAt' | 'snapshot'>,
  now: IsoDateTime,
): boolean {
  if (!STALEABLE.includes(exec.status)) return false;
  if (exec.resumeAfter !== null && exec.resumeAfter > now) return false;
  return olderThanRefresh(exec, now);
}

/** error_text of a run cancelled because it went stale (spec §8.2 supersede; ssr2-06, ssr2-09). */
export const SUPERSEDED =
  'superseded: older than its discovery refresh allows; the next run starts with fresh prices';

/**
 * Cancels a stale run (its one-shot job with it) and records why. It never starts a run: the tick starts the fresh one
 * at a scheduled firing, and for a definition without a schedule the next run is the operator's (ssr2-06). False when
 * the run was no longer active.
 */
export async function supersede(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'cancel'>,
  exec: Pick<Execution, 'id' | 'definitionId' | 'startedAt'>,
): Promise<boolean> {
  if (!(await orch.cancel(exec.id))) return false;
  ctx.repos.executions.patch(exec.id, { errorText: SUPERSEDED });
  ctx.log.info(
    { executionId: exec.id, definitionId: exec.definitionId, startedAt: exec.startedAt },
    'execution: superseded a stale run',
  );
  return true;
}
