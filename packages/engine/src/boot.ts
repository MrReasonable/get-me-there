import { isoDateTimeOfEpochMs } from '@gmt/core';
import type { EngineContext } from './context.js';
import { FX_REFRESH_CRON, MAINTENANCE_CRON } from './maintenance.js';
import { notifyOperator } from './notify.js';
import type { Orchestrator } from './orchestrator.js';
import { isStalePaused, olderThanRefresh, supersede } from './resume.js';
import { autoResumeYields, CATCH_UP_CRON, catchUpIsolated } from './scheduler/catchUp.js';
import type { Scheduler } from './scheduler/scheduler.js';

/** Spec §5.3 "boot sweep marks pending older than 10 minutes unknown (still counted)". */
export const PENDING_LEDGER_MAX_AGE_MS = 10 * 60_000;
/** po-011: when no rate is a day fresh, the FX refresh runs this long after boot (never inside boot). */
export const FX_AFTER_BOOT_MS = 60_000;

/**
 * Spec §8.1 "Boot order": (1) sweep — pending ledger rows older than 10 minutes → unknown; pending executions older than
 * the boot and running executions → interrupted with auto_resume_count + 1; (2) if AUTO_RESUME, every interrupted
 * execution with count ≤ MAX_AUTO_RESUMES resumes (graceful SIGTERM rows were not incremented); above the cap, the
 * operator is told, a run older than its discovery refresh allows is superseded instead of resumed from its old
 * snapshot (ssr2-09), and a catch-up yields to a firing since it stopped running (`autoResumeYields`); (3) every stale paused run is superseded, with or without a resume_after or a schedule (ssr-11,
 * ssr2-06, ssr M3), and one-shot jobs are re-registered for the others' resume_after; an interrupted run left alone
 * here (AUTO_RESUME off, or capped) is superseded by the tick at the next firing once stale; (4) then cron, after
 * catching up each definition's missed firing once (`catchUpIsolated`, decision 79: a catch-up, a skipped_missed
 * row with its code, or nothing; a definition that throws is logged and the boot carries on), the daily system jobs and the minute catch-up job, plus an FX refresh a minute after
 * boot when no rate is a day fresh (po-011).
 * Boot makes no network call.
 */
export async function bootEngine(ctx: EngineContext, orch: Orchestrator, sched: Scheduler): Promise<void> {
  const bootAt = ctx.clock.now();
  const log = ctx.log.child({ phase: 'boot' });

  const pendingLedgerRows = ctx.repos.ledger.sweepPending(
    isoDateTimeOfEpochMs(Date.parse(bootAt) - PENDING_LEDGER_MAX_AGE_MS),
  );
  const { interrupted } = ctx.repos.executions.bootSweep(bootAt);
  const crashMarked = new Set(interrupted);
  log.info({ crashMarked: interrupted.length, pendingLedgerRows }, 'boot: sweep');

  const name = (definitionId: string) => ctx.repos.definitions.get(definitionId)?.name ?? definitionId;
  // why: plan decision 5 — executions of a soft-deleted definition are never resumed or scheduled
  const live = (definitionId: string): boolean => {
    const d = ctx.repos.definitions.get(definitionId);
    return d !== null && d.deletedAt === null;
  };
  let resumed = 0;
  let capped = 0;
  let superseded = 0;
  for (const exec of ctx.repos.executions.listByStatus(['interrupted'])) {
    if (!live(exec.definitionId)) continue;
    const p = {
      executionId: exec.id,
      definitionId: exec.definitionId,
      definitionName: name(exec.definitionId),
    };
    if (exec.autoResumeCount > ctx.config.maxAutoResumes) {
      capped += 1;
      log.warn(
        { executionId: exec.id, autoResumeCount: exec.autoResumeCount },
        'boot: auto-resume stopped by the crash-loop cap',
      );
      await notifyOperator(ctx, 'crash_loop', {
        ...p,
        detail: `Automatic resume stopped after ${exec.autoResumeCount} restarts without progress; resume it manually once the cause is fixed.`,
      });
      continue;
    }
    if (crashMarked.has(exec.id))
      await notifyOperator(ctx, 'interrupted', {
        ...p,
        detail: 'The app stopped without a clean shutdown during this run.',
      });
    if (!ctx.config.autoResume) continue;
    if (olderThanRefresh(exec, bootAt)) {
      if (await supersede(ctx, orch, exec)) superseded += 1;
      continue;
    }
    // why: decision 79 (review S1) — an interrupted catch-up yields to a firing since it stopped running
    if ((await autoResumeYields(ctx, orch, exec)) !== 'resume') continue;
    const r = await orch.resume(exec.id, { manual: false });
    if (r.ok) resumed += 1;
    log.info(
      { executionId: exec.id, autoResumeCount: exec.autoResumeCount, result: r.ok ? 'resumed' : r.code },
      'boot: auto-resume execution',
    );
  }
  log.info({ autoResume: ctx.config.autoResume, resumed, capped, superseded }, 'boot: auto-resume');

  let oneShots = 0;
  let stale = 0;
  for (const exec of ctx.repos.executions.listByStatus(['paused_error', 'paused_budget'])) {
    if (!live(exec.definitionId)) continue;
    // why: ssr M3 — a stale paused run is superseded whether or not it has a resume_after or a schedule, so no run
    // without either blocks manual starts forever
    if (isStalePaused(exec, bootAt)) {
      if (await supersede(ctx, orch, exec)) stale += 1;
      continue;
    }
    if (exec.resumeAfter === null) continue;
    sched.registerResume(exec.id, exec.definitionId, exec.resumeAfter);
    oneShots += 1;
  }
  log.info({ oneShots, superseded: stale }, 'boot: one-shot jobs');

  for (const def of ctx.repos.definitions.list()) {
    if (!def.enabled || def.deletedAt !== null || def.scheduleCron === null) continue;
    // why: one definition whose catch-up throws is logged and the boot carries on, so its own job is still registered
    // and the app still starts (the operator can then reach the UI to fix it)
    await catchUpIsolated(ctx, orch, def, bootAt);
    sched.register(def);
  }
  sched.registerSystem('fx-refresh', FX_REFRESH_CRON, ctx.config.schedulerTimezone);
  sched.registerSystem('maintenance', MAINTENANCE_CRON, ctx.config.schedulerTimezone);
  // why: decision 79 — a native install keeps running through sleep, so waking is the common case: every minute the
  // app is up, a firing missed while asleep is caught up (or recorded skipped) once
  sched.registerSystem('catch-up', CATCH_UP_CRON, ctx.config.schedulerTimezone);
  // why: decision 83 — beside the minute job, the heartbeat that detects a suspension (the machine slept)
  ctx.heartbeat.start();
  // why: spec §5.6 the refresh "runs after boot"; boot itself stays network-free, so it is a one-shot a minute later
  const fxStale = ctx.repos.fx.latest('EUR', 1, ctx.clock.todayLondon()) === null;
  if (fxStale) sched.runSystemSoon('fx-refresh', FX_AFTER_BOOT_MS);
  log.info({ definitionJobs: sched.definitionJobCount(), fxRefreshAfterBoot: fxStale }, 'boot: cron');
}
