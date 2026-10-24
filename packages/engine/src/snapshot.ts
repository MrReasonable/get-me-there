import {
  type Cabin,
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  generateCells,
  type IsoDate,
  type ProviderId,
  resolveSpace,
  type SearchDefinition,
  type Stage,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import type { StartOptions } from './types.js';

/** A provider the definition names that the snapshot leaves out of a stage, and why (code-architect review 9). */
export interface ExcludedProvider {
  providerId: ProviderId;
  stage: Stage;
  why: 'not-configured' | 'schedule-excluded';
  note: string;
}
export interface BuiltSnapshot {
  snapshot: DefinitionSnapshot;
  cells: Cell[];
  notes: string[];
  excluded: ExcludedProvider[];
}
/**
 * Spec rev 10: whether a provider sells the snapshot's cabin. One that does not is never called: its cells are
 * no_data:cabin-not-offered, and it does not count as a discovery provider for selection (ruling 3, ssr I3).
 */
export function sellsCabin(ctx: EngineContext, providerId: ProviderId, cabin: Cabin): boolean {
  return (ctx.providers.get(providerId)?.cabins ?? []).includes(cabin);
}

/**
 * The snapshot a pass plans, prices and cap-checks with `out` left out of discovery: a catch-up's browser provider
 * (decision 79), or one a closed browser window leaves for the next scheduled run (decision 83). The stored snapshot keeps
 * them, for reuse and for the record.
 */
export function withoutDiscovery(s: DefinitionSnapshot, out: readonly ProviderId[]): DefinitionSnapshot {
  return {
    ...s,
    providers: { ...s.providers, discovery: s.providers.discovery.filter((id) => !out.includes(id)) },
  };
}

/**
 * The execution's budget: the definition's, plus each discovery provider's own per-execution cap from config
 * (`providerMaxCalls`, camoufox's page cap; decision 69, arch-007). Frozen at creation, and refreshed only where a
 * manual resume refreshes the rest of the budget; the guard reads it from the snapshot, never from config.
 */
export function snapshotBudget(
  ctx: EngineContext,
  budget: SearchDefinition['budget'],
  discovery: readonly ProviderId[],
): SearchDefinition['budget'] {
  const caps: Partial<Record<ProviderId, number>> = {};
  for (const id of discovery) {
    const cap = ctx.limitsOf(id).executionCallCap;
    if (cap !== null) caps[id] = cap;
  }
  const { providerMaxCalls: _ignored, ...rest } = budget;
  return Object.keys(caps).length === 0 ? rest : { ...rest, providerMaxCalls: caps };
}

/** Who started the run; the same union as `StartOptions['trigger']`, never restated (code-architect review 17). */
export type Trigger = StartOptions['trigger'];

/**
 * Resolves the window in Europe/London and freezes the definition into an execution snapshot (spec §6.1 "frozen into
 * the execution snapshot", §8.1 "start: snapshot"). The snapshot is read once; nothing a later PUT does reaches a
 * running pass (Review Focus 4).
 *
 * - providers: only those registered with the capability; a scheduled run also leaves out a provider marked
 *   excludedFromSchedule (spec §8.2 "scheduled runs exclude SearchApi on trial");
 * - alwaysInclude: members that slid out of a relative window are dropped with a note (spec §6.1).
 * `today` defaults to the clock's London date; `Engine.estimate` passes the form's date.
 */
export function buildSnapshot(
  ctx: EngineContext,
  def: SearchDefinition,
  trigger: Trigger = 'manual',
  today: IsoDate = ctx.clock.todayLondon(),
): BuiltSnapshot {
  const notes: string[] = [];
  const { space: resolved, clamped } = resolveSpace(def, today);
  if (clamped) notes.push('window clamped to start tomorrow');
  const cells = resolved.departureFrom > resolved.departureTo ? [] : generateCells(resolved);
  const inSpace = new Set(cells.map(cellKeyString));
  const kept = def.verification.alwaysInclude.filter((c) => inSpace.has(cellKeyString(c)));
  const dropped = def.verification.alwaysInclude.length - kept.length;
  if (dropped > 0)
    notes.push(
      `alwaysInclude: ${dropped} ${dropped === 1 ? 'cell left the window and was dropped' : 'cells left the window and were dropped'}`,
    );
  const providers = snapshotProviders(ctx, def, trigger);
  for (const x of providers.excluded) notes.push(x.note);
  const { discovery } = providers;
  const snapshot: DefinitionSnapshot = {
    ...def,
    budget: snapshotBudget(ctx, def.budget, discovery),
    verification: { ...def.verification, alwaysInclude: kept },
    providers: {
      ...def.providers,
      discovery,
      verification: providers.verification,
    },
    resolved,
    resolvedAt: ctx.clock.now(),
    windowClamped: clamped,
    droppedAlwaysInclude: def.verification.alwaysInclude.filter((c) => !inSpace.has(cellKeyString(c))),
  };
  return { snapshot, cells, notes, excluded: providers.excluded };
}

/**
 * The provider half of buildSnapshot (review T9): the definition's discovery and verification providers a run with
 * this trigger would take, those registered with the capability and, for a scheduled run, not excluded from schedules
 * on their plan, with each one left out and why. Builds no date grid, so a read that only asks which providers a run
 * would use (`browserLeftFor`, the catch-up's provider set) stays cheap.
 */
export function snapshotProviders(
  ctx: EngineContext,
  def: SearchDefinition,
  trigger: Trigger = 'manual',
): { discovery: ProviderId[]; verification: ProviderId[]; excluded: ExcludedProvider[] } {
  const excluded: ExcludedProvider[] = [];
  const exclude = (providerId: ProviderId, stage: Stage, why: ExcludedProvider['why'], note: string) => {
    excluded.push({ providerId, stage, why, note });
    return false;
  };
  const usable = (id: ProviderId, capability: Stage): boolean => {
    if (ctx.providers.get(id)?.[capability] === undefined)
      return exclude(id, capability, 'not-configured', `${id} is not configured; left out of ${capability}`);
    if (trigger === 'schedule' && ctx.limitsOf(id).excludedFromSchedule)
      return exclude(
        id,
        capability,
        'schedule-excluded',
        `${id} is excluded from scheduled runs on its plan`,
      );
    return true;
  };
  const discovery = def.providers.discovery.filter((id) => usable(id, 'discovery'));
  const verification = def.providers.verification.filter((id) => usable(id, 'verification'));
  return { discovery, verification, excluded };
}

/**
 * Spec §8.1 single-cell verification: a child skips discovery, `alwaysInclude = [cell]`, `maxCells = 1`, `topN = 1`
 * (decision 17), and its own call cap `maxCalls` (ruling 7: the per-cell estimate × ESTIMATE_RETRY_FACTOR, bounded by
 * the parent's headroom); the rest of the definition's budget is inherited (decision 14); provider and global caps are
 * shared.
 */
export function childSnapshot(
  parent: DefinitionSnapshot,
  cell: CellKey,
  maxCalls: number,
): DefinitionSnapshot {
  const key = {
    origin: cell.origin,
    destination: cell.destination,
    departureDate: cell.departureDate,
    returnDate: cell.returnDate,
  };
  return {
    ...parent,
    providers: { ...parent.providers, discovery: [] },
    verification: { ...parent.verification, alwaysInclude: [key], maxCells: 1, topN: 1 },
    budget: { ...parent.budget, maxCalls },
  };
}
