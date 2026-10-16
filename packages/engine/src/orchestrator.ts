import { ACTIVE_STATUSES, type CellKey } from '@gmt/core';
import { verifyCellExecution } from './child.js';
import type { EngineContext } from './context.js';
import { createRegistry } from './registry.js';
import { resumeExecution } from './resume.js';
import { stopRun } from './run.js';
import { startExecution } from './start.js';
import type { StartOptions, StartResult } from './types.js';

/** The execution half of the Engine; createEngine (Task 7.19) adds estimates, scheduler, boot and status. */
export interface Orchestrator {
  start(definitionId: string, opts: StartOptions): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  /** Spec §8.1 single-cell verification (POST /cells/verify): a child execution for one cell. */
  verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;
  /** Spec §8.1 AbortedError row: cells in flight → not_run, status cancelled. False when there is nothing to cancel. */
  cancel(executionId: string): Promise<boolean>;
  /** Aborts every pass as SIGTERM (cells in flight → not_run, status interrupted) and waits for them. */
  shutdown(): Promise<void>;
  running(): string[];
}

export function createOrchestrator(ctx: EngineContext): Orchestrator {
  const reg = createRegistry(ctx.log);
  return {
    start: (id, opts) => startExecution(ctx, reg, id, opts),
    resume: (id, opts) => resumeExecution(ctx, reg, id, opts),
    verifyCell: (id, cell) => verifyCellExecution(ctx, reg, id, cell),
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
    shutdown: async () => {
      for (const run of reg.all()) stopRun(run, { kind: 'sigterm' });
      await reg.settleAll();
    },
    running: () => reg.all().map((r) => r.executionId),
  };
}
