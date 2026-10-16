import { RESUMABLE_STATUSES } from '@gmt/core';
import type { EngineContext } from './context.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { refused } from './start.js';
import type { StartResult } from './types.js';

/**
 * Spec §8.1 "Resume is a compare-and-set": only one claimer of an execution proceeds; the one-shot job is cancelled in
 * the same step; the new pass re-plans over the resume query only (spec §7).
 */
export async function resumeExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  executionId: string,
  opts: { manual: boolean },
): Promise<StartResult> {
  const exec = ctx.repos.executions.get(executionId);
  if (exec === null) return refused('not_found', `execution ${executionId} not found`, { executionId });
  if (reg.get(executionId) !== undefined || !RESUMABLE_STATUSES.includes(exec.status))
    return refused('active', `execution is ${exec.status} and cannot be resumed`, { status: exec.status });
  if (!ctx.repos.executions.claimResume(executionId))
    return refused('active', 'another resume claimed this execution first', { executionId });
  ctx.hooks.cancelResume(executionId);
  const run = newRun(
    ctx,
    { ...exec, status: 'running' },
    { manual: opts.manual, fresh: false, blocked: new Set() },
  );
  run.log.info({ manual: opts.manual, autoResumeCount: exec.autoResumeCount }, 'execution: resumed');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId };
}
