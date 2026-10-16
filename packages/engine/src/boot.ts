import { type IsoDateTime, isoDateTimeOfEpochMs, type SearchDefinition } from '@gmt/core';
import type { EngineContext } from './context.js';
import { FX_REFRESH_CRON, MAINTENANCE_CRON } from './maintenance.js';
import { notifyOperator } from './notify.js';
import type { Orchestrator } from './orchestrator.js';
import { isStalePaused, olderThanRefresh, supersede } from './resume.js';
import { previousFiring } from './scheduler/parseCron.js';
import type { Scheduler } from './scheduler/scheduler.js';
import { buildSnapshot } from './snapshot.js';
import { recordSkipped } from './start.js';
import { formatInstant } from './text.js';

/** Spec §5.3 "boot sweep marks pending older than 10 minutes unknown (still counted)". */
export const PENDING_LEDGER_MAX_AGE_MS = 10 * 60_000;
/** po-011: when no rate is a day fresh, the FX refresh runs this long after boot (never inside boot). */
export const FX_AFTER_BOOT_MS = 60_000;

/**
 * Spec §8.2: "a boot that finds the last scheduled firing was missed records skipped_missed and notifies", once per
 * firing. A firing is not missed when the definition was last changed at or after it (the schedule may not have
 * existed then, ssr2-11), when a scheduled execution was created at or after it, or when an execution of the definition
 * was active at that instant: the tick ran and was blocked, which records nothing by design (ssr-16).
 */
async function detectMissed(ctx: EngineContext, def: SearchDefinition, bootAt: IsoDateTime): Promise<void> {
  if (def.scheduleCron === null) return;
  const prev = previousFiring(def.scheduleCron, def.scheduleTz, new Date(bootAt));
  if (prev === null) return;
  const prevAt = isoDateTimeOfEpochMs(prev.getTime());
  // why: ssr2-11 — the schedule as it is now may not have existed at that firing; updated_at bounds when it took effect
  if (prevAt <= def.updatedAt) return;
  const lastFiring = ctx.repos.executions.lastScheduledFiring(def.id);
  if (lastFiring !== null && lastFiring >= prevAt) return;
  const activeThen = ctx.repos.executions
    .listForDefinition(def.id, { limit: 50, includeChildren: false })
    .some((e) => (e.startedAt ?? e.createdAt) <= prevAt && (e.finishedAt === null || e.finishedAt >= prevAt));
  if (activeThen) return;
  const built = buildSnapshot(ctx, def, 'schedule');
  await recordSkipped(
    ctx,
    def,
    built.snapshot,
    null,
    'skipped_missed',
    `The run scheduled for ${formatInstant(prevAt, def.scheduleTz)} did not happen because the app was not running.`,
  );
}

/**
 * Spec §8.1 "Boot order": (1) sweep — pending ledger rows older than 10 minutes → unknown; pending executions older than
 * the boot and running executions → interrupted with auto_resume_count + 1; (2) if AUTO_RESUME, every interrupted
 * execution with count ≤ MAX_AUTO_RESUMES resumes (graceful SIGTERM rows were not incremented); above the cap, the
 * operator is told, and a run older than its discovery refresh allows is superseded instead of resumed from its old
 * snapshot (ssr2-09); (3) one-shot jobs for resume_after are re-registered, except for a stale paused run, which is
 * superseded (ssr-11, ssr2-06: whether or not the definition has a schedule, so none waits forever); (4) then cron
 * (after recording any missed firing) and the daily system jobs, plus an FX refresh a minute after boot when no rate
 * is a day fresh (po-011).
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
    if (exec.resumeAfter === null || !live(exec.definitionId)) continue;
    if (isStalePaused(exec, bootAt)) {
      if (await supersede(ctx, orch, exec)) stale += 1;
      continue;
    }
    sched.registerResume(exec.id, exec.definitionId, exec.resumeAfter);
    oneShots += 1;
  }
  log.info({ oneShots, superseded: stale }, 'boot: one-shot jobs');

  for (const def of ctx.repos.definitions.list()) {
    if (!def.enabled || def.deletedAt !== null || def.scheduleCron === null) continue;
    await detectMissed(ctx, def, bootAt);
    sched.register(def);
  }
  sched.registerSystem('fx-refresh', FX_REFRESH_CRON, ctx.config.schedulerTimezone);
  sched.registerSystem('maintenance', MAINTENANCE_CRON, ctx.config.schedulerTimezone);
  // why: spec §5.6 the refresh "runs after boot"; boot itself stays network-free, so it is a one-shot a minute later
  const fxStale = ctx.repos.fx.latest('EUR', 1, ctx.clock.todayLondon()) === null;
  if (fxStale) sched.runSystemSoon('fx-refresh', FX_AFTER_BOOT_MS);
  log.info({ definitionJobs: sched.definitionJobCount(), fxRefreshAfterBoot: fxStale }, 'boot: cron');
}
