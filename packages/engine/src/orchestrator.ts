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
  /** Aborts every pass as SIGTERM (cells in flight → not_run, status interrupted) and waits for them. */
  shutdown(): Promise<void>;
  running(): string[];
}

export function createOrchestrator(ctx: EngineContext): Orchestrator {
  const reg = createRegistry(ctx.log);
  return {
    start: (id, opts) => startExecution(ctx, reg, id, opts),
    resume: (id, opts) => resumeExecution(ctx, reg, id, opts),
    shutdown: async () => {
      for (const run of reg.all()) stopRun(run, { kind: 'sigterm' });
      await reg.settleAll();
    },
    running: () => reg.all().map((r) => r.executionId),
  };
}
