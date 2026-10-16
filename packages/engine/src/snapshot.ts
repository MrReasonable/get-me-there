import {
  type Cell,
  type DefinitionSnapshot,
  generateCells,
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

/** Resolves the window in Europe/London and freezes the definition into an execution snapshot. Spec §6.1, §8.1 "start: snapshot". */
export function buildSnapshot(ctx: EngineContext, def: SearchDefinition): BuiltSnapshot {
  const w = resolveWindow(def.window, ctx.clock.todayLondon());
  const resolved: ResolvedSpace = {
    origins: def.origins,
    destinations: def.destinations,
    departureFrom: w.departureFrom,
    departureTo: w.departureTo,
    minNights: def.minNights,
    maxNights: def.maxNights,
  };
  const cells = w.departureFrom > w.departureTo ? [] : generateCells(resolved);
  const usable = (id: ProviderId, capability: 'discovery' | 'verification'): boolean =>
    ctx.providers.get(id)?.[capability] !== undefined;
  const snapshot: DefinitionSnapshot = {
    ...def,
    providers: {
      ...def.providers,
      discovery: def.providers.discovery.filter((id) => usable(id, 'discovery')),
      verification: def.providers.verification.filter((id) => usable(id, 'verification')),
    },
    resolved,
    resolvedAt: ctx.clock.now(),
    windowClamped: w.clamped,
    droppedAlwaysInclude: [],
  };
  return { snapshot, cells, notes: [] };
}
