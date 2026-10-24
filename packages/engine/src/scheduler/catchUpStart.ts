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

/** error_text of a paused catch-up superseded by a later firing's row (spec §8.2 rev 36). */
export const SUPERSEDED_BY_FIRING = 'superseded: a later scheduled firing replaced this catch-up';

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
 * Inside a firing row's immediate transaction, before its insert: cancels `supersedes`, the paused catch-up the row
 * replaces, as superseded by this firing; when the guarded cancel finds it no longer paused (a resume claimed it), throws
 * CatchUpResumed so the transaction writes nothing. A lost insert (FiringTaken) rolls the cancel back with it.
 */
export function replacePausedCatchUp(ctx: EngineContext, supersedes: Execution | null): void {
  if (supersedes !== null && !ctx.repos.executions.cancelPaused(supersedes.id, SUPERSEDED_BY_FIRING))
    throw new CatchUpResumed();
}

/** After the transaction that superseded it: the catch-up's one-shot job goes too, and the log says by what. */
export function supersededCatchUp(ctx: EngineContext, supersedes: Execution, by: Execution): void {
  ctx.hooks.cancelResume(supersedes.id); // why: spec §8.1 one-shot job "cancelled on cancel"
  ctx.log.info(
    { executionId: supersedes.id, definitionId: by.definitionId, by: by.id, scheduledFor: by.scheduledFor },
    'execution: superseded a paused catch-up',
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
