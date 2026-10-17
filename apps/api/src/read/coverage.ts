/** The coverage summary every view header shows (spec §3, §11). */
import {
  type apiContract,
  type Buckets,
  type CellOutcomeStatus,
  cellKeyString,
  type Execution,
  type ResolvedSpace,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { cellInSpace } from './space.js';

export type CoverageSummary = z.infer<typeof apiContract.coverageSummarySchema>;
/**
 * Statuses that mean "searched" (spec §3). A priced verification roll-up with a null price (`price-unconfirmed`,
 * decisions 45 and 48) is searched: it counts as itinerary-searched but contributes no itinerary-search price.
 */
export const SEARCHED: ReadonlySet<CellOutcomeStatus> = new Set(['priced', 'empty', 'no_data']);

export function zeroBuckets(): Buckets {
  return { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
}

/**
 * Spec §8.1 "+C on demand" (ssr-002): the completed children that searched their cell, by the same SEARCHED predicate
 * the parent's K uses (the child's verification roll-up for its cell is priced, empty or no_data), and whose cell lies
 * inside the current resolved space. A child that ended with its cell in error, or whose cell has slid out of a
 * relative window, searched nothing the views show. Results, Calendar and Coverage count with this one predicate.
 */
export function onDemandSearched(
  executions: readonly Execution[],
  ports: Ports,
  space: ResolvedSpace,
): Execution[] {
  return executions.filter((e) => {
    if (!e.isChild || e.status !== 'completed' || e.cell === null || !cellInSpace(space, e.cell))
      return false;
    const status = ports.repos.cells.rollUps(e.id).get(cellKeyString(e.cell))?.verification.status ?? null;
    return status !== null && SEARCHED.has(status);
  });
}

/**
 * Spec §3/§11 header line: six discovery buckets over the latest parent execution's cell roll-ups (they sum to the
 * cell count), "(R reused)", "itinerary-searched K of N selected", "+C on demand" from `onDemandSearched`.
 */
export function coverageSummaryFor(
  latestParent: Execution | null,
  executions: readonly Execution[],
  ports: Ports,
  space: ResolvedSpace,
): CoverageSummary {
  const onDemand = onDemandSearched(executions, ports, space).length;
  if (latestParent === null)
    return { buckets: zeroBuckets(), total: 0, selected: 0, itinerarySearched: 0, onDemand, reused: 0 };
  const rollUps = ports.repos.cells.rollUps(latestParent.id);
  const buckets = zeroBuckets();
  for (const r of rollUps.values()) if (r.discovery.status !== null) buckets[r.discovery.status] += 1;
  const reused = new Set(
    ports.repos.cells
      .outcomes(latestParent.id, { stage: 'discovery' })
      .filter((o) => o.reusedFromExecutionId !== null)
      .map(cellKeyString),
  ).size;
  buckets.reused = reused;
  const selected = ports.repos.cells.selected(latestParent.id);
  const itinerarySearched = selected.filter(({ cell }) => {
    const status = rollUps.get(cellKeyString(cell))?.verification.status ?? null;
    return status !== null && SEARCHED.has(status);
  }).length;
  return { buckets, total: rollUps.size, selected: selected.length, itinerarySearched, onDemand, reused };
}
