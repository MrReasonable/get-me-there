import {
  type ExecutionStatus,
  formatInstant,
  type IsoDateTime,
  isScheduled,
  type OperatorMessageKind,
  type StopCause,
} from '@gmt/core';
import type { ExecutionPatch } from '@gmt/db';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { notifyOperator } from './notify.js';
import { type RunState, type StopReason, stopRun } from './run.js';
import { runDiscovery } from './stages/discovery.js';
import { runFlightLists } from './stages/flightLists.js';
import { runVerification } from './stages/verification.js';
import { stopCauseOf, stopPatch } from './stopCause.js';
import { budgetText } from './text.js';

/**
 * Runs one pass: discovery, the flight-list step, verification (spec §8.1 order, revision 55), the alerts step, then
 * finish. A stage error that escapes stops the pass as fatal.
 */
export async function execute(ctx: EngineContext, run: RunState): Promise<void> {
  try {
    await runDiscovery(ctx, run);
    // why: revision 55 §8.1 (ruling 20.0 concern 1) — the flight-list step runs after discovery and before
    // verification, and before finish, so a budget stop's cause carries its counts
    await runFlightLists(ctx, run);
    if (run.stop === null) await runVerification(ctx, run);
  } catch (err) {
    stopRun(run, { kind: 'fatal', message: errorText(err) });
  }
  const alertsRan = await alertsStep(ctx, run);
  await finish(ctx, run, alertsRan);
}

/**
 * Spec §8.1 "alerts: evaluateAlertRules → persist events → notify digests", through the AlertsStepHook (WP11's
 * runAlerts). Decision 25: it runs when the pass completed and when it paused for a cap window (paused_budget), over
 * what the execution has written; WP11 keeps one digest per rule per execution, so a later pass of the same execution
 * never repeats one. A failing hook is logged and never pauses a finished search. Returns whether the step ran.
 */
export async function alertsStep(ctx: EngineContext, run: RunState): Promise<boolean> {
  // why: revision 55 §8.1 — a cancel or SIGTERM during the flight-list step after a budget stop ends the run as that
  if (run.flightStop !== null) return false;
  if (run.stop !== null && run.stop.kind !== 'budget') return false;
  try {
    const r = await ctx.alertsStep(ctx.deps, run.executionId, {
      stop: run.stop === null ? 'completed' : 'budget',
    });
    run.log.info({ digests: r.digests, events: r.events }, 'alerts: step done');
    return true;
  } catch (err) {
    run.log.error({ err: errorText(err) }, 'alerts: step failed');
    return false;
  }
}

/**
 * Spec §6.8/§8.1 "When verification is budget-skipped the operator is told 'alerts running on calendar basis only'":
 * only from a pass whose alerts step actually ran (po-001), whose verification has skipped:budget cells, for a
 * definition with an alert rule.
 */
export function calendarOnlyNotice(ctx: EngineContext, run: RunState, alertsRan: boolean): Notice | null {
  if (!alertsRan) return null;
  if (!ctx.repos.alerts.rules(run.definitionId).some((r) => r.enabled)) return null;
  const skipped = ctx.repos.cells
    .outcomes(run.executionId, { stage: 'verification' })
    .filter((o) => o.status === 'skipped' && o.reason === 'budget').length;
  if (skipped === 0) return null;
  return {
    kind: 'alerts_calendar_only',
    detail: `${skipped} selected ${skipped === 1 ? 'cell was' : 'cells were'} skipped for budget, so the alert rules judged their calendar prices only.`,
  };
}

export interface Notice {
  kind: OperatorMessageKind;
  detail: string;
  /** A once-only key across runs (camoufox's cool-down notice, cost-015). */
  key?: string;
}

/** The run state `finalStatus` reads to build a stop's cause (revision 55 §8.1). */
export type CauseRun = Parameters<typeof stopCauseOf>[1];

/**
 * Maps a stop reason to the execution status, patch and operator notice of spec §8.1. Pure; `tz` renders instants.
 * Revision 55 §8.1: every non-null stop stores its cause (`stopCauseOf`) with its sentence as `error_text` (a fatal
 * stop's own message stays in the log), and its `resumeAfter` is the cause's: null when the search is not scheduled
 * (`scheduled`, `isScheduled` read live at finish; Ian's ruling 2) or the stop is the browser worker's per-run page
 * limit, so no one-shot job is registered for either.
 */
export function finalStatus(
  stop: StopReason | null,
  now: IsoDateTime,
  tz: string,
  run: CauseRun,
  scheduled: boolean,
): { status: ExecutionStatus; patch: ExecutionPatch; notice: Notice | null } {
  if (stop === null)
    return {
      status: 'completed',
      patch: { finishedAt: now, resumeAfter: null, errorText: null },
      notice: null,
    };
  const cause = stopCauseOf(stop, run, scheduled);
  const stored = stopPatch(cause, tz, scheduled);
  const resumeAfter = 'resumeAfter' in cause ? cause.resumeAfter : null;
  switch (stop.kind) {
    case 'sigterm':
      // why: spec §8.1 "SIGTERM: … status interrupted without incrementing the counter"
      return {
        status: 'interrupted',
        patch: { ...stored },
        notice: {
          kind: 'interrupted',
          detail: 'The app stopped during this run; cells that were in flight went back to not searched.',
        },
      };
    case 'cancel':
      return { status: 'cancelled', patch: { finishedAt: now, resumeAfter: null, ...stored }, notice: null };
    case 'limiter-timeout':
      return {
        status: 'paused_error',
        patch: { resumeAfter, ...stored },
        notice: {
          kind: 'paused_error',
          detail:
            resumeAfter === null
              ? stop.resumeAfter === null
                ? 'A provider rate window is full and its reopening time is not known; resume the run manually.'
                : 'A provider rate window is full; this search has no schedule, so resume the run when you are ready.'
              : `A provider rate window is full; the run resumes automatically on ${formatInstant(resumeAfter, tz)}.`,
        },
      };
    case 'budget':
      return {
        status: 'paused_budget',
        patch: { resumeAfter, ...stored },
        notice: {
          kind: 'paused_budget',
          detail: `The cap was reached: ${budgetText(stop.error, 'the next call needed')}. ${budgetNext(cause, tz, scheduled)}`,
        },
      };
    case 'child-cap':
      // why: ruling 7 — a child never pauses on a cap; it ends, with the scope in the log and its cause on the row
      return {
        status: 'cancelled',
        patch: { finishedAt: now, resumeAfter: null, ...stored },
        notice: null,
      };
    case 'all-disabled':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null, ...stored },
        notice: {
          kind: 'paused_error',
          // why: the page's fix for these sources is Search again (§8.1 "Stop causes"), so the notice never offers Resume
          detail: `Every ${stop.stage} provider was disabled after errors; once the cause is fixed, Search again.`,
        },
      };
    case 'fatal':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null, ...stored },
        notice: { kind: 'paused_error', detail: `The run stopped on an internal error: ${stop.message}` },
      };
  }
}

/**
 * What a paused_budget notice (email, Status) tells the operator to do next (spec revision 55 §8.1 "Stop causes", WP20
 * final review): the same offer, in the same order of cases, as the stop's fix on the search's page (`stopText`'s
 * budget head), so the notice never offers a Resume the page refuses or leaves out one it offers. A run's own cap is a
 * cap change in Edit, then Resume (no schedule resumes it); a browser page limit per run, and any other provider's own
 * per-run cap, is never resumed: Search again carries on; a plan with no calls left is Check Providers;
 * a scheduled run that stored a resume says when; anything else is Search again or Resume, and an unscheduled search is
 * told it has no schedule to carry it on.
 */
function budgetNext(cause: StopCause, tz: string, scheduled: boolean): string {
  // why: finish builds a budget stop's cause from that stop, so any other kind here is an internal slip; it gets the
  // plainest offer the page always makes
  if (cause.kind !== 'budget') return 'Search again when you are ready.';
  switch (cause.scope) {
    case 'execution-calls':
    case 'execution-free-calls':
    case 'execution-cost':
      return 'Raise the limit in Edit, then Resume.';
    case 'provider-execution':
      return CARRY_ON;
    case 'provider-lifetime':
      return 'Check Providers.';
    case 'provider-month':
    case 'global-month':
      break;
  }
  if (cause.resumeAfter !== null)
    return `It resumes automatically on ${formatInstant(cause.resumeAfter, tz)}, when the cap window reopens; if by then it is older than its discovery refresh allows, it is cancelled instead and the next run starts with fresh prices.`;
  return scheduled
    ? 'Search again, or Resume when you are ready.'
    : 'This search has no schedule; Search again, or Resume when you are ready.';
}

/** A never-resumed budget stop's next step (revision 55 §8.1): a fresh run, which reuses what this one found. */
const CARRY_ON = 'Search again carries on with the prices already found.';

/**
 * Writes the pass's final status after sending its notices. The status write is the last act, so anyone who observes a
 * final status also observes every write and notification of the pass.
 */
export async function finish(ctx: EngineContext, run: RunState, alertsRan: boolean): Promise<void> {
  // why: revision 55 §8.1 — a cancel or SIGTERM during the flight-list step after a budget stop wins over that stop
  const stop = run.flightStop ?? run.stop;
  const scheduled = scheduledNow(ctx, run.definitionId);
  const { status, patch, notice } = finalStatus(
    stop,
    ctx.clock.now(),
    run.snapshot.scheduleTz,
    run,
    scheduled,
  );
  const notices = notice === null ? [...run.notices] : [...run.notices, notice];
  const parity = parityNotice(ctx, run);
  if (parity !== null) notices.push(parity);
  const calendarOnly = calendarOnlyNotice(ctx, run, alertsRan);
  if (calendarOnly !== null) notices.push(calendarOnly);
  const name = ctx.repos.definitions.get(run.definitionId)?.name ?? run.snapshot.name;
  for (const n of notices) {
    // why: a keyed notice (camoufox's cool-down, cost-015) is sent once, whatever run meets it
    const key = n.key;
    if (key !== undefined && ctx.repos.notifications.noticeKeyClaimed(key)) continue;
    const sent = await notifyOperator(ctx, n.kind, {
      executionId: run.executionId,
      definitionId: run.definitionId,
      definitionName: name,
      detail: n.detail,
    });
    if (sent && key !== undefined) ctx.repos.notifications.claimNoticeKey(key);
  }
  ctx.repos.executions.setStatus(run.executionId, status, patch);
  if (patch.resumeAfter !== undefined && patch.resumeAfter !== null)
    ctx.hooks.scheduleResume(run.executionId, run.definitionId, patch.resumeAfter);
  run.log.info({ status, notices: notices.map((n) => n.kind) }, 'execution: pass finished');
}

/**
 * Spec §8.1 "Parity = distinct tile requests (first-attempt ledger rows + cache hits) for one uninterrupted pass = plan
 * length; a parity break raises an operator notification". Judged per discovery provider on the first pass only, from
 * the ledger's per-provider, per-stage counts (LedgerRepo.countsFor, distinct tile indexes).
 */
export function parityNotice(ctx: EngineContext, run: RunState): Notice | null {
  if (!run.fresh || run.stop !== null) return null;
  const counts = ctx.repos.ledger.countsFor(run.executionId).perProvider;
  const breaks: string[] = [];
  for (const [providerId, planned] of run.plannedTiles) {
    // why: a disabled, budget-capped or window-stopped provider (decision 83: its pages left for the next scheduled run)
    // stops requesting its planned tiles by design, which is not a parity break
    const lane = run.lanes.get(`discovery|${providerId}`);
    if (
      planned === 0 ||
      run.disabled.has(providerId) ||
      (lane !== undefined && lane.budgetOutScope !== null) ||
      (lane !== undefined && lane.windowOut !== null)
    )
      continue;
    const row = counts.find((c) => c.providerId === providerId && c.stage === 'discovery');
    const distinct = (row?.tiles ?? 0) + (row?.cacheHits ?? 0);
    if (distinct !== planned)
      breaks.push(
        `${providerId}: planned ${planned} tile requests; the ledger shows ${distinct} (first attempts plus cache hits)`,
      );
  }
  if (breaks.length === 0) return null;
  run.log.warn({ breaks }, 'parity break');
  return { kind: 'parity_break', detail: `${breaks.join('. ')}.` };
}

/**
 * Revision 55 §7, §8.1: whether the run's search is scheduled now (`isScheduled` over the live definition): the one
 * schedule predicate finish and `autoResume` read. A deleted or missing definition is not.
 */
export function scheduledNow(ctx: Pick<EngineContext, 'repos'>, definitionId: string): boolean {
  const def = ctx.repos.definitions.get(definitionId);
  return def !== null && isScheduled(def);
}
