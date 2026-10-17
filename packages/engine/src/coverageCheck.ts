import {
  type CellKey,
  cellKeyString,
  type DiscoveryCapability,
  generateCells,
  type IsoMonth,
  monthOf,
  monthsSpanned,
  type ProviderId,
  resolveWindow,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import type { CoverageCheckRequest, CoverageCheckResponse } from './types.js';

type MonthRow = CoverageCheckResponse['pairs'][number]['months'][number];

/**
 * Per departure month of the window (every month listed, zero months included): `cachedRows` = distinct in-band cells
 * with a cached price (duplicates and out-of-band rows never inflate it, po-007), or null when a tile covering the
 * month failed, so "not checked" never reads as "nothing cached" (decision 25); `cellsInBand` = the band's cells.
 */
export function countCachedCells(
  priced: readonly CellKey[],
  failed: readonly CellKey[],
  months: readonly IsoMonth[],
  cells: readonly CellKey[],
): MonthRow[] {
  const inBand = new Set(cells.map(cellKeyString));
  const cached = new Map<IsoMonth, Set<string>>(months.map((m) => [m, new Set()]));
  for (const p of priced) {
    const key = cellKeyString(p);
    if (inBand.has(key)) cached.get(monthOf(p.departureDate))?.add(key);
  }
  const unknown = new Set(failed.map((c) => monthOf(c.departureDate)));
  const band = new Map<IsoMonth, number>(months.map((m) => [m, 0]));
  for (const c of cells) band.set(monthOf(c.departureDate), (band.get(monthOf(c.departureDate)) ?? 0) + 1);
  return months.map((month) => ({
    month,
    cachedRows: unknown.has(month) ? null : (cached.get(month)?.size ?? 0),
    cellsInBand: band.get(month) ?? 0,
  }));
}

/**
 * One pass of a provider's own tiles per pair, outside any execution (ledgered with execution_id NULL). Not checked
 * (its month null, never a number below the real coverage): every covered cell of a failed tile, every cell a tile
 * named in `cellIssues` without a price (a page cap left it unread, or its rows were dropped), and every covered cell
 * without a price of a tile the page cap stopped (`truncated`; decisions 25, 30, 37). `calls` counts the tiles
 * requested: a cached tile costs no upstream call and a tile may page, so it is not the ledger's call count.
 */
export async function coverageCheckWith(
  ctx: EngineContext,
  providerId: ProviderId,
  cap: DiscoveryCapability,
  req: CoverageCheckRequest,
): Promise<CoverageCheckResponse> {
  const w = resolveWindow(req.window, ctx.clock.todayLondon());
  const months = monthsSpanned(w.departureFrom, w.departureTo);
  // why: the request carries no cabin, so the check counts economy prices and says so (prov-wp07-008)
  const notes: string[] = ['cached prices are counted for economy; the check does not look at other cabins'];
  const pairs: CoverageCheckResponse['pairs'] = [];
  let tiles = 0;
  const signal = new AbortController().signal;
  for (const origin of req.origins) {
    for (const destination of req.destinations) {
      const cells = generateCells({
        origins: [origin],
        destinations: [destination],
        departureFrom: w.departureFrom,
        departureTo: w.departureTo,
        minNights: req.minNights,
        maxNights: req.maxNights,
      });
      const q = {
        origin,
        destination,
        departureFrom: w.departureFrom,
        departureTo: w.departureTo,
        minNights: req.minNights,
        maxNights: req.maxNights,
        cabin: 'economy' as const,
        currency: 'GBP' as const,
        cells,
      };
      const priced: CellKey[] = [];
      const failed: CellKey[] = [];
      for (const tile of cap.plan(q)) {
        tiles += 1;
        try {
          const r = await cap.fetchTile(tile, q, { executionId: null, signal, recordFixtures: false });
          if (r.kind === 'tile') {
            priced.push(...r.prices);
            const read = new Set(r.prices.map(cellKeyString));
            const unread = [
              ...(r.cellIssues ?? []).map((i) => i.cell),
              ...(r.truncated === true ? tile.coveredCells : []),
            ].filter((cell) => !read.has(cellKeyString(cell)));
            failed.push(...unread);
            if (r.truncated === true)
              notes.push(
                `${origin}→${destination}: a ${providerId} tile stopped at its page cap; its months are not fully checked`,
              );
            else if (unread.length > 0)
              notes.push(
                `${origin}→${destination}: a ${providerId} tile could not read every row; its months are not fully checked`,
              );
          } else {
            failed.push(...tile.coveredCells);
            notes.push(
              `${origin}→${destination}: a ${providerId} tile failed (${r.error.kind}); its months are not checked`,
            );
          }
        } catch (err) {
          failed.push(...tile.coveredCells);
          notes.push(`${origin}→${destination}: ${errorText(err)}; its months are not checked`);
        }
      }
      pairs.push({ origin, destination, months: countCachedCells(priced, failed, months, cells) });
    }
  }
  if (w.clamped) notes.push('window clamped to start tomorrow');
  return { pairs, calls: tiles, notes };
}

/**
 * Spec §10 `POST /definitions/coverage-check` and §1 "the Definitions form's coverage check (free) reports cached rows
 * per pair before anything is saved". Uses only the Travelpayouts provider, so it can never call a billed provider;
 * its calls are ledgered (execution_id NULL) and capped by the provider's free-call limits through http-kit.
 */
export async function coverageCheckFor(
  ctx: EngineContext,
  req: CoverageCheckRequest,
): Promise<CoverageCheckResponse> {
  const cap = ctx.providers.get('travelpayouts')?.discovery;
  if (cap === undefined)
    return {
      pairs: [],
      calls: 0,
      notes: ['Travelpayouts is not configured; the coverage check reads its free cached data only.'],
    };
  return coverageCheckWith(ctx, 'travelpayouts', cap, req);
}
