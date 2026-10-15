import { type CellKey, type CellOutcome, cellKeyString, rollUp, type Stage } from '@gmt/core';
import type { Db } from '../client.js';
import {
  CELL_WHERE,
  type CellKeyDbRow,
  keyParams,
  type OutcomeDbRow,
  toCellKey,
  toOutcome,
} from './outcomeRow.js';

const UPDATE: Record<Stage, string> = {
  discovery: `UPDATE search_cells SET discovery_status = @status, discovery_reason = @reason, discovery_min_pence = @minPence WHERE ${CELL_WHERE}`,
  verification: `UPDATE search_cells SET verification_status = @status, verification_reason = @reason, verification_min_pence = @minPence WHERE ${CELL_WHERE}`,
};

/**
 * Stores spec §6.6 roll-ups computed by core's `rollUp` (ruling 2) for the given cells, or for every cell of the
 * execution. The caller holds the write transaction, so the outcomes read here are the ones just written.
 */
export function storeRollUps(db: Db, executionId: string, stage: Stage, cells?: readonly CellKey[]): void {
  const byCell = new Map<string, CellOutcome[]>();
  let keys: readonly CellKey[];
  if (cells === undefined) {
    keys = db.raw
      .prepare<[string], CellKeyDbRow>(
        'SELECT origin, destination, departure_date, return_date FROM search_cells WHERE execution_id = ?',
      )
      .all(executionId)
      .map(toCellKey);
    for (const r of db.raw
      .prepare<Record<string, unknown>, OutcomeDbRow>(
        'SELECT * FROM cell_outcomes WHERE execution_id = @executionId AND stage = @stage',
      )
      .all({ executionId, stage })) {
      const o = toOutcome(r);
      const list = byCell.get(cellKeyString(o)) ?? [];
      list.push(o);
      byCell.set(cellKeyString(o), list);
    }
  } else {
    keys = cells;
    const select = db.raw.prepare<Record<string, unknown>, OutcomeDbRow>(
      `SELECT * FROM cell_outcomes WHERE ${CELL_WHERE} AND stage = @stage`,
    );
    for (const c of cells)
      byCell.set(cellKeyString(c), select.all({ ...keyParams(executionId, c), stage }).map(toOutcome));
  }
  const update = db.raw.prepare(UPDATE[stage]);
  for (const c of keys) {
    const r = rollUp(byCell.get(cellKeyString(c)) ?? []);
    update.run({ ...keyParams(executionId, c), status: r.status, reason: r.reason, minPence: r.minPence });
  }
}
