import { type Cell, type CellKey, cellKeyString, type VerificationPolicy } from '../types/definition.js';
import type { RollUp, SelectionReason } from '../types/execution.js';

/** A non-negative integer. */
function isCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Choose the cells stage 2 itinerary-searches. Spec §6.7, steps in order:
 *  1. `alwaysInclude`, deduplicated, counted toward `maxCells` and `perDepartureDateBest`;
 *  2. rank cells whose discovery roll-up is `priced` by `minPence`, tie-break generation order;
 *  3. walk the ranking skipping `alwaysInclude`; add while under `maxCells` and under
 *     `perDepartureDateBest` for that date; stop after `topN` additions (`top_n`);
 *  4. if `priceCeilingPence` is set, keep walking, adding only cells ≤ the ceiling, same caps,
 *     until `maxCells` (`ceiling`); if unset, stop after step 3;
 *  5. with no discovery provider, replace 2–4 by an even stride over generation order (`stride`).
 *
 * `cells` is the resolved space in generation order (`generateCells`). `discovery` maps
 * `cellKeyString` (WP0, `types/definition.ts`) to the cell's discovery roll-up. Only `maxCells`,
 * `topN`, `priceCeilingPence`, `perDepartureDateBest` and `alwaysInclude` of the policy are read.
 * Pure and deterministic; the engine runs it once per execution and persists the result. Every
 * returned `cell` is a fresh `CellKey` (no `nights`, no aliasing of the policy's objects).
 *
 * Spend bound (spec §6.7 "the estimate uses maxCells as the upper bound"): throws `RangeError`
 * unless `maxCells`, `topN` and `perDepartureDateBest` (when set) are non-negative integers and
 * the distinct in-space `alwaysInclude` cells number at most `maxCells`, so the result never
 * exceeds `maxCells` even for a policy read back from storage without zod.
 *
 * Stride (step 5, "advancing past `alwaysInclude` members rather than losing a slot"): it walks
 * the cells not already chosen, `m = maxCells − |alwaysInclude|`, `k = max(1, floor(remaining / m))`,
 * taking remaining[0], remaining[k], … up to `m` cells, so it takes `min(m, remaining)` cells. It
 * ignores `perDepartureDateBest`, which belongs to steps 3–4.
 *
 * why: `alwaysInclude` members not in `cells` are left out. At execution start a relative window
 * may have slid past them (spec §6.1: "dropped with a note, not an error"); the engine records
 * them in `DefinitionSnapshot.droppedAlwaysInclude` by comparing the policy with the result.
 */
export function selectCandidates(
  policy: VerificationPolicy,
  cells: Cell[],
  discovery: Map<string, RollUp>,
  hasDiscoveryProvider: boolean,
): Array<{ cell: CellKey; reason: SelectionReason }> {
  const { maxCells, topN, perDepartureDateBest: pdb, priceCeilingPence: ceiling } = policy;
  if (!isCount(maxCells)) throw new RangeError(`maxCells must be a non-negative integer, got ${maxCells}`);
  if (!isCount(topN)) throw new RangeError(`topN must be a non-negative integer, got ${topN}`);
  if (pdb !== undefined && !isCount(pdb)) {
    throw new RangeError(`perDepartureDateBest must be a non-negative integer, got ${pdb}`);
  }
  const inSpace = new Set(cells.map(cellKeyString));
  const included = new Set(policy.alwaysInclude.map(cellKeyString).filter((k) => inSpace.has(k)));
  if (included.size > maxCells) {
    throw new RangeError(
      `alwaysInclude has ${included.size} distinct cells in the space; maxCells is ${maxCells}`,
    );
  }

  const out: Array<{ cell: CellKey; reason: SelectionReason }> = [];
  const chosen = new Set<string>();
  const perDate = new Map<string, number>();
  const take = (cell: CellKey, reason: SelectionReason) => {
    chosen.add(cellKeyString(cell));
    perDate.set(cell.departureDate, (perDate.get(cell.departureDate) ?? 0) + 1);
    const { origin, destination, departureDate, returnDate } = cell;
    out.push({ cell: { origin, destination, departureDate, returnDate }, reason });
  };

  for (const cell of policy.alwaysInclude) {
    const key = cellKeyString(cell);
    if (inSpace.has(key) && !chosen.has(key)) take(cell, 'always_include');
  }

  if (!hasDiscoveryProvider) {
    // why: m is never negative (alwaysInclude ≤ maxCells is enforced above). m = 0 needs no special
    // case: k becomes Infinity (or NaN) and `slice(0, 0)` adds nothing.
    const m = maxCells - out.length;
    const remaining = cells.filter((c) => !chosen.has(cellKeyString(c)));
    const k = Math.max(1, Math.floor(remaining.length / m));
    for (const cell of remaining.filter((_, j) => j % k === 0).slice(0, m)) take(cell, 'stride');
    return out;
  }

  const ranked = cells
    .flatMap((cell) => {
      const r = discovery.get(cellKeyString(cell));
      if (r?.status !== 'priced') return [];
      if (r.minPence === null) {
        throw new Error(`priced discovery roll-up without minPence for ${cellKeyString(cell)}`);
      }
      return [{ cell, minPence: r.minPence }];
    })
    // why: `sort` is stable (ES2019) and `flatMap` yields generation order, so equal prices keep it.
    .sort((a, b) => a.minPence - b.minPence);

  const fits = (cell: CellKey) =>
    out.length < maxCells && (pdb === undefined || (perDate.get(cell.departureDate) ?? 0) < pdb);

  let topAdded = 0;
  for (const { cell, minPence } of ranked) {
    const free = !chosen.has(cellKeyString(cell)) && fits(cell);
    if (topAdded < topN) {
      // step 3
      if (free) {
        take(cell, 'top_n');
        topAdded += 1;
      }
      continue;
    }
    // step 4: with no ceiling nothing qualifies, so the rest of the walk adds nothing
    if (free && minPence <= (ceiling ?? Number.NEGATIVE_INFINITY)) take(cell, 'ceiling');
  }
  return out;
}
