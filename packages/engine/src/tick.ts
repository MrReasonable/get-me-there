import type { IsoDateTime } from '@gmt/core';
import type { EngineContext } from './context.js';
import type { Orchestrator } from './orchestrator.js';
import { isStalePaused, supersede } from './resume.js';

/**
 * Spec §8.2 tick, in order: (1) cancel and supersede a stale paused run (isStalePaused); (2) resume a paused_error or
 * paused_budget whose resume_after has passed, through the compare-and-set and its cap check (an execution-* budget
 * pause has no resume_after and waits for a manual /resume, ruling 4); (3) any other active execution, or a resume that was refused, blocks the schedule — recorded
 * in `blocked` as "schedule blocked since <date>" (ssr-19); (4) otherwise pre-start checks and start. A tick that
 * starts or resumes clears the definition's entry. A deleted or disabled definition is never scheduled (decision 5),
 * and a definition without a schedule is never ticked: a stale run's one-shot job supersedes it without a tick
 * (ssr2-06, createEngine).
 */
export async function tickDefinition(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'start' | 'resume' | 'cancel'>,
  definitionId: string,
  blocked: Map<string, IsoDateTime>,
): Promise<void> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null || !def.enabled || def.scheduleCron === null) {
    blocked.delete(definitionId);
    return;
  }
  const log = ctx.log.child({ definitionId });
  const now = ctx.clock.now();
  const block = (executionId: string, status: string, since: IsoDateTime): void => {
    const first = blocked.get(def.id) ?? since;
    blocked.set(def.id, first);
    log.info({ executionId, status, since: first }, 'tick: schedule blocked by an active execution');
  };
  const active = ctx.repos.executions.activeParent(def.id);
  if (active !== null) {
    if (isStalePaused(active, now)) {
      await supersede(ctx, orch, active);
    } else if (
      (active.status === 'paused_error' || active.status === 'paused_budget') &&
      active.resumeAfter !== null &&
      active.resumeAfter <= now
    ) {
      // why: ruling 4 — only a pause with a window to reopen (a provider or global cap, resume_after set) resumes
      // automatically; an execution-* paused_budget has none and needs a manual /resume (spec §8.1, cost I-1)
      const r = await orch.resume(active.id, { manual: false });
      log.info(
        { executionId: active.id, status: active.status, result: r.ok ? 'resumed' : r.code },
        'tick: resume attempted',
      );
      if (r.ok) blocked.delete(def.id);
      else block(active.id, active.status, now);
      return;
    } else {
      block(active.id, active.status, now);
      return;
    }
  }
  const r = await orch.start(def.id, { trigger: 'schedule' });
  if (r.ok) blocked.delete(def.id);
  log.info({ result: r.ok ? 'started' : r.code, executionId: r.ok ? r.executionId : null }, 'tick: start');
}
