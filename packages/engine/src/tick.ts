import { type IsoDateTime, isoDateTimeOfEpochMs } from '@gmt/core';
import type { EngineContext } from './context.js';
import type { Orchestrator } from './orchestrator.js';
import { isStalePaused, supersede } from './resume.js';
import { catchUpDefinition, pastGrace } from './scheduler/catchUp.js';
import { isPausedCatchUp } from './scheduler/catchUpStart.js';
import { previousFiring } from './scheduler/parseCron.js';

/**
 * Spec §8.2 rev 36: croner 10.0.1 re-arms its timer at most 30 s ahead and, on waking from sleep, fires an overdue
 * firing once; its previous-run answer is strictly before the whole second it is given, so the tick's firing is the
 * latest one before `now + 2 s`: a tick at the firing's instant, or a timer that fires within the second before it,
 * counts as that firing (schedules fire at most hourly, so the slack can never reach the next one).
 */
export const TICK_FIRING_SLACK_MS = 2000;

/**
 * A definition's "schedule blocked since" (ssr-19): the run blocking it and the first instant a firing found that run
 * blocking it (a different blocking run starts a new date). The orchestrator clears it when a run of the definition starts, or once the blocking run is no longer active.
 */
export interface Blocked {
  since: IsoDateTime;
  executionId: string;
}

/**
 * Spec §8.2 tick (the definition's own croner job, the live tick). It first finds its firing, `previousFiring(expr, tz,
 * now + 2 s)`; the tick is late when that firing is past the catch-up grace (the machine slept through it). Every tick,
 * punctual or late, then runs the same order: (1) cancel and supersede a stale paused run (isStalePaused), and treat a
 * paused catch-up as superseded by this firing's row; (2) resume a paused_error or paused_budget whose resume_after has
 * passed, through the compare-and-set and its cap check (an execution-* budget pause has no resume_after and waits for a
 * manual /resume, ruling 4); a punctual tick re-anchors the run's browser window to its firing (decision 83), a late one
 * does not, since its firing's time has passed; (3) any other active execution, or a resume that was refused, blocks the
 * schedule — recorded in `blocked` as "schedule blocked since <date>" (ssr-19); (4) otherwise a punctual tick runs the
 * pre-start checks and starts, and a late tick hands its firing to `catchUpDefinition` in place of the start, so a late
 * tick is a catch-up under the same rules (decision 79), with the run it superseded in step 1 not covering the firing.
 * A tick that resumes clears the definition's entry; any start of the definition (the orchestrator's, the tick's own
 * included) and the blocking run's end clear it too (Orchestrator.blockedSince). A deleted or disabled definition is never scheduled
 * (decision 5), and a definition without a schedule is never ticked: a stale run's one-shot job supersedes it without a
 * tick (ssr2-06, createEngine).
 */
export async function tickDefinition(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'start' | 'resume' | 'cancel'>,
  definitionId: string,
  blocked: Map<string, Blocked>,
): Promise<void> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null || !def.enabled || def.scheduleCron === null) {
    blocked.delete(definitionId);
    return;
  }
  const log = ctx.log.child({ definitionId });
  const now = ctx.clock.now();
  const prev = previousFiring(
    def.scheduleCron,
    def.scheduleTz,
    new Date(Date.parse(now) + TICK_FIRING_SLACK_MS),
  );
  const firing = prev === null ? null : isoDateTimeOfEpochMs(prev.getTime());
  const late = prev === null || pastGrace(prev.getTime(), Date.parse(now));
  const block = (executionId: string, status: string, since: IsoDateTime): void => {
    // why: review T11 — the first date stands only while the same run blocks; another run's block starts its own
    const prev = blocked.get(def.id);
    const first = prev !== undefined && prev.executionId === executionId ? prev.since : since;
    blocked.set(def.id, { since: first, executionId });
    log.info({ executionId, status, since: first, late }, 'tick: schedule blocked by an active execution');
  };
  let replaced: string | null = null;
  const active = ctx.repos.executions.activeParent(def.id);
  if (active !== null) {
    if (isStalePaused(active, now)) {
      if (await supersede(ctx, orch, active)) replaced = active.id;
    } else if (isPausedCatchUp(active)) {
      // why: decision 79 — a paused catch-up never blocks the firing after it: this firing's row (its start, its
      // catch-up or its skip) supersedes it in the same immediate transaction as its own insert
    } else if (
      (active.status === 'paused_error' || active.status === 'paused_budget') &&
      active.resumeAfter !== null &&
      active.resumeAfter <= now
    ) {
      // why: ruling 4 — only a pause with a window to reopen (a provider or global cap, resume_after set) resumes
      // automatically; an execution-* paused_budget has none and needs a manual /resume (spec §8.1, cost I-1)
      // why: decision 83 — the definition's own punctual live tick re-anchors the run's browser window to its firing
      const anchor = late || firing === null ? {} : { liveTickFiring: firing };
      const r = await orch.resume(active.id, { manual: false, ...anchor });
      log.info(
        { executionId: active.id, status: active.status, late, result: r.ok ? 'resumed' : r.code },
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
  if (late || firing === null) {
    log.info({ firing, replaced }, 'tick: late, handed to the catch-up');
    await catchUpDefinition(ctx, orch, def, now, replaced);
    return;
  }
  // why: a start that goes ahead clears the definition's blocked entry in the orchestrator, as every start does
  const r = await orch.start(def.id, { trigger: 'schedule', scheduledFor: firing });
  log.info(
    { firing, result: r.ok ? 'started' : r.code, executionId: r.ok ? r.executionId : null },
    'tick: start',
  );
}
