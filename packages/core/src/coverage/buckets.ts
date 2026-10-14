import { type CellKey, cellKeyString } from '../types/definition.js';
import type { Buckets, CellOutcome } from '../types/execution.js';
import { rollUp } from './rollUp.js';

/**
 * Count one execution's outcomes for one stage × provider into the six coverage buckets of spec
 * §3: priced, no fares (`empty`), no cached data (`no_data`), error, skipped, not searched
 * (`not_run`). `reused` is not a seventh bucket: it counts outcomes copied from an earlier
 * execution, which also sit in their own bucket ("(R reused from earlier runs)").
 *
 * The six buckets sum to the number of outcomes given; that equals the cell count only when the
 * stage was seeded for every cell of the resolved space (precondition: exactly one row per cell).
 * An empty input returns all zeros, which is spec §6.6 row 0 (`not_applicable`: the stage has no
 * provider or is not yet seeded) and must not be rendered as coverage.
 *
 * Role: the reference oracle for WP3's SQL bucket counts (`CellsRepo.buckets`, `bucketsPerDay`);
 * WP3 asserts parity against it on the same outcomes, and WP3/WP7 assert the sum equals
 * `countCells(snapshot.resolved)` for every seeded stage × provider.
 *
 * Throws when the outcomes mix executions, stages or providers, or repeat a cell.
 */
export function sixBuckets(outcomes: CellOutcome[]): Buckets {
  const b: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
  const seen = new Set<string>();
  const first = outcomes[0];
  for (const o of outcomes) {
    if (
      o.executionId !== first?.executionId ||
      o.stage !== first.stage ||
      o.providerId !== first.providerId
    ) {
      throw new Error('sixBuckets takes the outcomes of one execution, one stage and one provider');
    }
    const key = cellKeyString(o);
    if (seen.has(key)) throw new Error(`sixBuckets: cell ${key} appears twice`);
    seen.add(key);
    b[o.status] += 1;
    if (o.reusedFromExecutionId !== null) b.reused += 1;
  }
  return b;
}

/**
 * Spec §6.6: "Selected but not reached" = `selected ∧ (not_run ∨ skipped:budget)`, judged on the
 * cell's verification roll-up across verification providers (so a cell any provider priced was
 * reached, and `no_data:cabin-not-offered` rows never hide a budget skip). `reason` uses the
 * spec's notation, `'not_run'` or `'skipped:budget'`, which WP9 maps to operator copy.
 * `outcomes` are the execution's outcomes; discovery rows are ignored. Returned in the order of
 * `selected`.
 *
 * Throws when a selected cell has no verification outcome rows: selection and verification
 * seeding happen in one transaction (spec §7), so a gap is a broken invariant, and treating the
 * cell as reached would overstate coverage.
 */
export function selectedNotReached(
  selected: CellKey[],
  outcomes: CellOutcome[],
): Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }> {
  const byCell = new Map<string, CellOutcome[]>();
  for (const o of outcomes) {
    if (o.stage !== 'verification') continue;
    const key = cellKeyString(o);
    const list = byCell.get(key) ?? [];
    list.push(o);
    byCell.set(key, list);
  }
  const out: Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }> = [];
  for (const cell of selected) {
    const rows = byCell.get(cellKeyString(cell));
    if (rows === undefined) {
      throw new Error(`selected cell ${cellKeyString(cell)} has no verification outcome rows`);
    }
    const r = rollUp(rows);
    if (r.status === 'not_run') out.push({ cell, reason: 'not_run' });
    else if (r.status === 'skipped' && r.reason === 'budget') out.push({ cell, reason: 'skipped:budget' });
  }
  return out;
}
