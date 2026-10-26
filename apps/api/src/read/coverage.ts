/** The coverage summary's parts every view header shows (spec §3, §11); `scope.ts` builds the summary itself. */
import type { apiContract, Buckets, CellOutcomeStatus, Execution, ResolvedSpace } from '@gmt/core';
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
 * relative window, searched nothing the views show. why: WP19: every child's roll-up comes from one grouped read
 * (`childVerificationRollUps`), never a read per child.
 */
export function onDemandSearched(
  executions: readonly Execution[],
  ports: Ports,
  space: ResolvedSpace,
): Execution[] {
  const children = executions.filter(
    (e) => e.isChild && e.status === 'completed' && e.cell !== null && cellInSpace(space, e.cell),
  );
  const first = children[0];
  if (first === undefined) return [];
  const status = new Map(
    ports.repos.cells.childVerificationRollUps(first.definitionId).map((r) => [r.executionId, r.status]),
  );
  return children.filter((e) => {
    const s = status.get(e.id) ?? null;
    return s !== null && SEARCHED.has(s);
  });
}
