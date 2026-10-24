import type { ExecutionStatus, IsoDateTime, OperatorMessageKind } from '@gmt/core';
import type { ExecutionPatch } from '@gmt/db';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { notifyOperator } from './notify.js';
import { type RunState, type StopReason, stopRun } from './run.js';
import { runDiscovery } from './stages/discovery.js';
import { runVerification } from './stages/verification.js';
import { breachText, formatInstant } from './text.js';

/**
 * Runs one pass: discovery, verification (spec §8.1 order), the alerts step, then finish. A stage error that escapes
 * stops the pass as fatal.
 */
export async function execute(ctx: EngineContext, run: RunState): Promise<void> {
  try {
    await runDiscovery(ctx, run);
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

/** Maps a stop reason to the execution status, patch and operator notice of spec §8.1. Pure; `tz` renders instants. */
export function finalStatus(
  stop: StopReason | null,
  now: IsoDateTime,
  tz: string,
): { status: ExecutionStatus; patch: ExecutionPatch; notice: Notice | null } {
  if (stop === null)
    return {
      status: 'completed',
      patch: { finishedAt: now, resumeAfter: null, errorText: null },
      notice: null,
    };
  switch (stop.kind) {
    case 'sigterm':
      // why: spec §8.1 "SIGTERM: … status interrupted without incrementing the counter"
      return {
        status: 'interrupted',
        patch: {},
        notice: {
          kind: 'interrupted',
          detail: 'The app stopped during this run; cells that were in flight went back to not searched.',
        },
      };
    case 'cancel':
      return { status: 'cancelled', patch: { finishedAt: now, resumeAfter: null }, notice: null };
    case 'limiter-timeout':
      return {
        status: 'paused_error',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_error',
          detail:
            stop.resumeAfter === null
              ? 'A provider rate window is full and its reopening time is not known; resume the run manually.'
              : `A provider rate window is full; the run resumes automatically on ${formatInstant(stop.resumeAfter, tz)}.`,
        },
      };
    case 'budget': {
      const e = stop.error;
      const when =
        stop.resumeAfter === null
          ? 'It needs a cap change, or a manual resume after editing the definition.'
          : `It resumes automatically on ${formatInstant(stop.resumeAfter, tz)}, when the cap window reopens; if by then it is older than its discovery refresh allows, it is cancelled instead and the next run starts with fresh prices.`;
      return {
        status: 'paused_budget',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_budget',
          detail: `The cap was reached: ${breachText(e.scope, e.providerId ?? null, e.cap, e.current, e.requested, 'the next call needed', e.unit ?? 'calls')}. ${when}`,
        },
      };
    }
    case 'child-cap':
      // why: ruling 7 — a child never pauses on a cap; it ends, with the scope in the log and this text on the row
      return {
        status: 'cancelled',
        patch: { finishedAt: now, resumeAfter: null, errorText: CHILD_CAP_REACHED },
        notice: null,
      };
    case 'all-disabled':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null },
        notice: {
          kind: 'paused_error',
          detail: `Every ${stop.stage} provider was disabled after errors; resume manually once the cause is fixed.`,
        },
      };
    case 'fatal':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null, errorText: stop.message },
        notice: { kind: 'paused_error', detail: `The run stopped on an internal error: ${stop.message}` },
      };
  }
}

/**
 * Writes the pass's final status after sending its notices. The status write is the last act, so anyone who observes a
 * final status also observes every write and notification of the pass.
 */
export async function finish(ctx: EngineContext, run: RunState, alertsRan: boolean): Promise<void> {
  const { status, patch, notice } = finalStatus(run.stop, ctx.clock.now(), run.snapshot.scheduleTz);
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
      lane?.budgetOut === true ||
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

/** The error_text of a child execution that reached a cap (ruling 7). */
export const CHILD_CAP_REACHED = 'child cap reached';
