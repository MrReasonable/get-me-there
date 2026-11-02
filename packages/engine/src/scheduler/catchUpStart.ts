/**
 * The catch-up's start rules (spec §8.2 rev 36, decision 79): which paused catch-up a later firing's row replaces and
 * what that replacement logs, which snapshot a catch-up plans with, and how it seeds its browser provider's cells (reuse
 * only, never a page). start.ts applies them inside its own transactions.
 */
import { type DefinitionSnapshot, type Execution, PAUSED_STATUSES, type ProviderId } from '@gmt/core';
import type { EngineContext } from '../context.js';
import { markRemaining } from '../run.js';
import { withoutDiscovery } from '../snapshot.js';
import { applyReuse } from '../stages/reuse.js';
import { loadsBrowserPages } from './browserWindow.js';

/**
 * A paused catch-up: a catch-up whose pass is not running (paused for a cap or an error, or interrupted). It never
 * covers a later firing; that firing's row supersedes it in the same immediate transaction as its insert.
 */
export function isPausedCatchUp(e: Pick<Execution, 'isCatchUp' | 'status'>): boolean {
  return e.isCatchUp && PAUSED_STATUSES.includes(e.status);
}

/**
 * The definition's active parent run (`activeParent`), when it is a paused catch-up: the row a scheduled row for a later
 * firing replaces. Any other active run, paused or not, is returned as null and is never replaced.
 */
export function pausedCatchUp(active: Execution | null): Execution | null {
  return active !== null && isPausedCatchUp(active) ? active : null;
}

/** Thrown inside a firing row's transaction when the firing is taken, so everything it wrote rolls back. */
export class FiringTaken extends Error {}

/**
 * Thrown inside a firing row's transaction when the guarded cancel of the paused catch-up it replaces changed nothing
 * (a resume claimed the catch-up since it was read): everything the transaction wrote rolls back, so no supersede is
 * logged and no resume job cancelled for a catch-up that is running again (review S19).
 */
export class CatchUpResumed extends Error {}

/**
 * Inside a start's or a firing row's immediate transaction, before its insert: cancels `supersedes`, the stopped run the
 * row replaces (a paused catch-up or a stopped parent a firing replaces, cause `superseded 'schedule'`; a stopped run
 * Search again replaces, `superseded 'search-again'`, revision 55 §8.1, §8.2); when the guarded cancel finds it no longer
 * stopped (a resume claimed it), throws CatchUpResumed so the transaction writes nothing. A lost insert (FiringTaken)
 * rolls the cancel back with it.
 */
export function replacePausedCatchUp(
  ctx: EngineContext,
  supersedes: Execution | null,
  by: 'schedule' | 'search-again' = 'schedule',
): void {
  if (supersedes !== null && !ctx.repos.executions.cancelPaused(supersedes.id, { kind: 'superseded', by }))
    throw new CatchUpResumed();
}

/**
 * Spec revision 55 §8.2: the stopped parent a scheduled firing supersedes: a paused catch-up, or the definition's
 * `paused_*` or `interrupted` latest parent with no `resume_after` (a page-limit stop, a manual run stopped while the
 * search had no schedule, a stop every source's refusal caused). A paused run with a `resume_after` is left to its
 * resume: its one-shot job while it is in the future, the tick's resume once it is due (the tick's step before this
 * one), and any other active run is not replaced (null).
 */
export function supersededByFiring(active: Execution | null): Execution | null {
  if (active === null || !PAUSED_STATUSES.includes(active.status)) return null;
  if (active.isCatchUp) return active;
  return active.resumeAfter === null ? active : null;
}

/** Spec revision 55 §8.1 (Ian's ruling 1): the stopped latest parent a manual `replaceStopped` start cancels. */
export function stoppedParent(active: Execution | null): Execution | null {
  return active !== null && PAUSED_STATUSES.includes(active.status) ? active : null;
}

/** After the transaction that superseded it: the catch-up's one-shot job goes too, and the log says by what. */
export function supersededCatchUp(ctx: EngineContext, supersedes: Execution, by: Execution): void {
  ctx.hooks.cancelResume(supersedes.id); // why: spec §8.1 one-shot job "cancelled on cancel"
  ctx.log.info(
    { executionId: supersedes.id, definitionId: by.definitionId, by: by.id, scheduledFor: by.scheduledFor },
    by.isCatchUp || supersedes.isCatchUp
      ? 'execution: superseded a paused catch-up'
      : 'execution: superseded a stopped run',
  );
}

/**
 * The snapshot a start plans, prices and cap-checks: a catch-up's discovery without the browser provider, which it
 * keeps in its stored snapshot for reuse only (decision 79); any other start's snapshot as it is.
 */
export function plannedSnapshot(snapshot: DefinitionSnapshot, catchUp: boolean): DefinitionSnapshot {
  return catchUp
    ? withoutDiscovery(snapshot, snapshot.providers.discovery.filter(loadsBrowserPages))
    : snapshot;
}

/**
 * Decision 79: a catch-up copies the browser provider's still-fresh outcomes (no page load) and leaves the rest
 * `scheduled_only` (`catch-up-no-browser`), which no resume, manual, automatic or at boot, ever selects.
 */
export function seedCatchUpBrowser(
  ctx: EngineContext,
  scope: { executionId: string; definitionId: string; snapshot: DefinitionSnapshot; manual: boolean },
  providerId: ProviderId,
): void {
  const info = ctx.providers.get(providerId)?.discovery?.info;
  if (info !== undefined) applyReuse(ctx, { ...scope, isChild: false }, providerId, info);
  markRemaining(ctx, scope, 'discovery', providerId, 'scheduled_only', new Set(), 'catch-up-no-browser');
}
