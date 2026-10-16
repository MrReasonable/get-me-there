import {
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  generateCells,
  type IsoDate,
  type ProviderId,
  type ResolvedSpace,
  resolveWindow,
  type SearchDefinition,
} from '@gmt/core';
import type { EngineContext } from './context.js';

export interface BuiltSnapshot {
  snapshot: DefinitionSnapshot;
  cells: Cell[];
  notes: string[];
}
export type Trigger = 'manual' | 'schedule';

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
  const w = resolveWindow(def.window, today);
  if (w.clamped) notes.push('window clamped to start tomorrow');
  const resolved: ResolvedSpace = {
    origins: def.origins,
    destinations: def.destinations,
    departureFrom: w.departureFrom,
    departureTo: w.departureTo,
    minNights: def.minNights,
    maxNights: def.maxNights,
  };
  const cells = w.departureFrom > w.departureTo ? [] : generateCells(resolved);
  const inSpace = new Set(cells.map(cellKeyString));
  const kept = def.verification.alwaysInclude.filter((c) => inSpace.has(cellKeyString(c)));
  const dropped = def.verification.alwaysInclude.length - kept.length;
  if (dropped > 0)
    notes.push(
      `alwaysInclude: ${dropped} ${dropped === 1 ? 'cell left the window and was dropped' : 'cells left the window and were dropped'}`,
    );
  const usable = (id: ProviderId, capability: 'discovery' | 'verification'): boolean => {
    if (ctx.providers.get(id)?.[capability] === undefined) {
      notes.push(`${id} is not configured; left out of ${capability}`);
      return false;
    }
    if (trigger === 'schedule' && ctx.limitsOf(id).excludedFromSchedule) {
      notes.push(`${id} is excluded from scheduled runs on its plan`);
      return false;
    }
    return true;
  };
  const snapshot: DefinitionSnapshot = {
    ...def,
    verification: { ...def.verification, alwaysInclude: kept },
    providers: {
      ...def.providers,
      discovery: def.providers.discovery.filter((id) => usable(id, 'discovery')),
      verification: def.providers.verification.filter((id) => usable(id, 'verification')),
    },
    resolved,
    resolvedAt: ctx.clock.now(),
    windowClamped: w.clamped,
    droppedAlwaysInclude: def.verification.alwaysInclude.filter((c) => !inSpace.has(cellKeyString(c))),
  };
  return { snapshot, cells, notes };
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
