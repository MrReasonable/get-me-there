/** Spec §10 cell route (the View B side panel). */
import { type apiContract, type CellKey, cellKeyString, type SearchDefinition } from '@gmt/core';
import type { Engine } from '@gmt/engine';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { loadRows } from './results.js';
import { type ResultRow, withNights } from './rows.js';

export type CellDetailResponse = z.infer<typeof apiContract.cellDetailResponseSchema>;

/**
 * Spec §10 cell route: outcomes per execution × stage × provider, prices with provenance, the observations as rows.
 * `verify` is what a per-cell verify would spend now, from `Engine.childCapPreview` (the same sizing the child gets,
 * decisions 42, 45, 48); null without a verification provider or when the preview refuses the cell (`not_found`, `window`). A priced
 * verification outcome with a null `minPence` is passed through as stored: its price was not confirmed (decision 48).
 */
export function assembleCellDetail(
  def: SearchDefinition,
  target: CellKey,
  ports: Ports,
  engine: Engine,
): CellDetailResponse {
  const key = cellKeyString(target);
  const loaded = loadRows(def, ports);
  const onCell = (r: ResultRow) => cellKeyString(r.cell) === key;
  // why: WP7's preview refuses a cell it would not verify (`not_found`, `window`); the button then has nothing to show.
  const preview = def.providers.verification.length > 0 ? engine.childCapPreview(def.id, target) : null;
  return {
    cell: withNights(target),
    outcomes: loaded.all.flatMap((e) => ports.repos.cells.outcomes(e.id, { cells: [target] })),
    browserLeftFor: engine.browserLeftFor(def),
    latestExecutionId: loaded.latestParent?.id ?? null,
    calendarPrices: loaded.calendar.filter(onCell).flatMap((r) =>
      r.calendarPriceId === null
        ? []
        : [
            {
              pricePence: r.pricePence,
              provenance: r.provenance,
              stale: r.stale,
              ageHours: r.ageHours,
              truncated: r.truncated,
              executionId: r.executionId,
              calendarPriceId: r.calendarPriceId,
              superseded: r.superseded,
            },
          ],
    ),
    observations: loaded.verified.filter(onCell),
    verify:
      preview?.ok === true
        ? { maxCalls: preview.maxCalls, headroomCalls: preview.headroomCalls, needCalls: preview.needCalls }
        : null,
  };
}
