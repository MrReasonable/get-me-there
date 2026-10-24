import { ACTIVE_STATUSES, type CellKey, type IsoDateTime } from '@gmt/core';
import { verifyCellExecution } from './child.js';
import type { EngineContext } from './context.js';
import { createRegistry } from './registry.js';
import { type ResumeOptions, resumeExecution } from './resume.js';
import { stopRun } from './run.js';
import { refused, startExecution } from './start.js';
import { type Blocked, tickDefinition } from './tick.js';
import type { StartOptions, StartResult, VerifyCellOptions } from './types.js';

/** The execution half of the Engine; createEngine (Task 7.19) adds estimates, scheduler, boot and status. */
export interface Orchestrator {
  start(definitionId: string, opts: StartOptions): Promise<StartResult>;
  /**
   * `liveTickFiring`: the resume is the definition's own live tick at that firing, which re-anchors the run's browser
   * window to it (decision 83).
   */
  resume(executionId: string, opts: ResumeOptions): Promise<StartResult>;
  /** Spec §8.1 single-cell verification (POST /cells/verify): a child execution for one cell. */
  verifyCell(definitionId: string, cell: CellKey, opts?: VerifyCellOptions): Promise<StartResult>;
  /** Spec §8.1 AbortedError row: cells in flight → not_run, status cancelled. False when there is nothing to cancel. */
  cancel(executionId: string): Promise<boolean>;
  /** Spec §8.2 tick for one definition. */
  tick(definitionId: string): Promise<void>;
  /**
   * The oldest "schedule blocked since" among blocked definitions, or null. An entry is cleared by a tick that resumes,
   * by any start of its definition (the live tick's, a catch-up's, a manual one), and once the run that blocked it is
   * no longer the definition's active run (review S1).
   */
  blockedSince(): IsoDateTime | null;
  /**
   * Aborts every pass as SIGTERM (cells in flight → not_run, status interrupted) and waits for them; from then on (or
   * from `ctx.lifecycle.closing`, which the engine's shutdown sets first) start, resume and verifyCell are refused.
   */
  shutdown(): Promise<void>;
  running(): string[];
}

export function createOrchestrator(ctx: EngineContext): Orchestrator {
  const reg = createRegistry(ctx.log);
  const blocked = new Map<string, Blocked>();
  // why: decision 83 — after a detected suspension every run in flight checks its browser window before its next page
  ctx.heartbeat.onSuspension(() => {
    for (const run of reg.all()) run.windowCheckDue = true;
  });
  // why: once shutdown begins nothing new launches, so a job still in flight (the minute catch-up, a tick, a one-shot
  // resume) cannot start a run the shutdown would never stop or wait for
  const closing = async (): Promise<StartResult> =>
    refused('shutting-down', 'the app is shutting down; nothing new starts', {});
  const self: Orchestrator = {
    start: async (id, opts) => {
      if (ctx.lifecycle.closing) return closing();
      const r = await startExecution(ctx, reg, id, opts);
      if (r.ok) blocked.delete(id); // why: review S1 — the run that starts is the one the schedule was waiting for
      return r;
    },
    resume: (id, opts) => (ctx.lifecycle.closing ? closing() : resumeExecution(ctx, reg, id, opts)),
    verifyCell: (id, cell, opts) =>
      ctx.lifecycle.closing ? closing() : verifyCellExecution(ctx, reg, id, cell, opts),
    cancel: async (id) => {
      const live = reg.get(id);
      if (live !== undefined) {
        stopRun(live, { kind: 'cancel' });
        await reg.done(id);
        return true;
      }
      const exec = ctx.repos.executions.get(id);
      if (exec === null || !ACTIVE_STATUSES.includes(exec.status)) return false;
      ctx.hooks.cancelResume(id); // why: spec §8.1 one-shot job "cancelled on cancel"
      ctx.repos.executions.setStatus(id, 'cancelled', { finishedAt: ctx.clock.now(), resumeAfter: null });
      return true;
    },
    tick: (id) => tickDefinition(ctx, self, id, blocked),
    blockedSince: () => {
      for (const [definitionId, b] of blocked)
        if (ctx.repos.executions.activeParent(definitionId)?.id !== b.executionId)
          blocked.delete(definitionId);
      return [...blocked.values()].map((b) => b.since).sort()[0] ?? null;
    },
    shutdown: async () => {
      ctx.lifecycle.closing = true;
      for (const run of reg.all()) stopRun(run, { kind: 'sigterm' });
      await reg.settleAll();
    },
    running: () => reg.all().map((r) => r.executionId),
  };
  return self;
}
