/**
 * The camoufox grid answer as a discovery tile (spec §2, §5.2, §7 rev 34; plan decision 70; WP15 Task 15.7). Every
 * covered cell ends one of three ways, and never as `empty`:
 * - priced: a parsed cell of a read view, with `returnDateSource: 'grid-cell'` and Google's mark kept as the vendor's;
 * - no data: Google's no-flights page (past the sale window), so no price and no issue;
 * - an issue (`error`, reason `parse`, resumable) naming why: `cell-unparsed` (its view was read but the cell was not
 *   parsed), `view-unparsed` (its view failed the structural check), or, for a view the page did not reach,
 *   `page-not-ready`, `off-plan-view` or `scroll-allowance` by how the page ended.
 * Cells of a read view outside the tile (another stay, or outside the window) are dropped and counted in the notes, as
 * each view's unparsed count is (`unparsed:<n>@<view>`).
 */
import {
  type CellIssue,
  type CellKey,
  cellKeyString,
  type DiscoveryTileResult,
  type RawCalendarPrice,
  type TilePlan,
  type WorkerAnswer,
} from '@gmt/core';

type GridAnswer = Extract<WorkerAnswer, { kind: 'grid' }>;

const UNREACHED: Readonly<Record<GridAnswer['ended'], string>> = {
  complete: 'not-in-view',
  'no-flights': 'not-in-view',
  'scroll-not-settled': 'page-not-ready',
  'off-plan': 'off-plan-view',
  allowance: 'scroll-allowance',
};
const WORDS: Readonly<Record<string, string>> = {
  'cell-unparsed': 'the date grid showed this day pair, but its cell could not be read',
  'not-in-view': 'no view the page read showed this day pair',
  'view-unparsed': 'the date grid view holding this day pair failed its check, so none of it was kept',
  'page-not-ready': 'a scroll did not settle before the grid reached this day pair',
  'off-plan-view': 'the grid showed other dates than planned at the edge of the sale window',
  'scroll-allowance': 'the run’s scroll allowance ended before the grid reached this day pair',
};

export function gridTile(plan: TilePlan, answer: GridAnswer): DiscoveryTileResult {
  const base = {
    kind: 'tile' as const,
    index: plan.index,
    coveredCells: plan.coveredCells,
    fetchedAt: answer.fetchedAt,
    pointOfSale: answer.pointOfSale,
  };
  if (answer.ended === 'no-flights') return { ...base, prices: [], noFares: [], notes: [...answer.notes] };
  const covered = new Map<string, CellKey>(plan.coveredCells.map((c) => [cellKeyString(c), c]));
  const prices: RawCalendarPrice[] = [];
  const priced = new Set<string>();
  const notes = [...answer.notes];
  let outside = 0;
  /** For each covered cell a read view showed: whether the view was structurally unparsed. */
  const shown = new Map<string, 'ok' | 'unparsed'>();
  const [first] = plan.coveredCells;
  for (const v of answer.views) {
    if (v.unparsed > 0) notes.push(`unparsed:${v.unparsed}@${v.index}`);
    if (v.offPlan !== null) notes.push(`off-plan:${v.offPlan}@${v.index}`);
    const deps = new Set<string>(v.departures);
    const rets = new Set<string>(v.returns);
    for (const [key, c] of covered)
      if (deps.has(c.departureDate) && rets.has(c.returnDate) && shown.get(key) !== 'ok')
        shown.set(key, v.structural);
    for (const g of v.cells) {
      if (first === undefined) break;
      const cell = {
        origin: first.origin,
        destination: first.destination,
        departureDate: g.departureDate,
        returnDate: g.returnDate,
      };
      const key = cellKeyString(cell);
      if (!covered.has(key)) {
        outside++;
        continue;
      }
      // why: each cell is read in exactly one view (the plan's `reads`); a second reading is a broken plan
      if (priced.has(key)) throw new Error(`camoufox grid: ${key} was read twice in one tile`);
      priced.add(key);
      prices.push({
        ...cell,
        amountMinor: g.amountMinor,
        currency: answer.currency,
        returnDateSource: 'grid-cell',
        vendorPriceMark: g.mark,
      });
    }
  }
  if (outside > 0) notes.push(`dropped-outside-tile:${outside}`);
  const issues: CellIssue[] = [];
  for (const [key, c] of covered) {
    if (priced.has(key)) continue;
    const state = shown.get(key);
    const code =
      state === 'unparsed' ? 'view-unparsed' : state === 'ok' ? 'cell-unparsed' : UNREACHED[answer.ended];
    issues.push({
      cell: c,
      reason: 'parse',
      offersDropped: 0,
      detail: `${code} ${WORDS[code] ?? ''}`.trim(),
    });
  }
  return { ...base, prices, noFares: [], notes, ...(issues.length === 0 ? {} : { cellIssues: issues }) };
}
