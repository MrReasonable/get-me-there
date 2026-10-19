/**
 * camoufox grid tiling (spec §2, §5.2 rev 34; plan decision 70; WP15 Task 15.3). Pure and deterministic.
 *
 * - **Blocks.** 7 × 7 views on a lattice anchored at A, the later of the window's first departure and today (a re-plan
 *   of a window that has started never opens a view on days already past), and A + minNights: column c holds
 *   departures A + 7c … A + 7c + 6; its blocks start at returns A + minNights + 7c + 7k. Each wanted cell lies in exactly
 *   one block; a block is planned only when it holds one (a re-plan visits only the blocks of its cells). No cell whose
 *   departure or return passes today + the horizon is planned in a block (Google shows its no-flights page beyond the
 *   sale window); one probe page covers them, opened at their least departure and least return.
 * - **A stay of 0 nights.** A block on the diagonal would open on a same-day pair, which no page query is; its page
 *   opens a day later on the returns and scrolls up once before the block is read.
 * - **Path.** Columns in order; each column swept top to bottom or bottom to top, whichever starts nearer the block
 *   before. A move between blocks is scrolls on each axis: ⌈|Δ| / step⌉ of them (the measured step is one day, so a
 *   block-to-block move is 7 scrolls), its intermediate views passed unread; the returns move first when they go later
 *   and the departures first when they go earlier, so every view on the way holds round trips.
 * - **Pages or scrolls.** Every block starts as its own page (about the 30 s page spacing, against about 9.3 s a scroll,
 *   so a page is the quicker way to a new block). A move is made by scrolling instead when that is quicker, or when the
 *   page allowance would otherwise be passed, cheapest moves first, within the scroll allowance and the per-page cap.
 *   Pages past the allowance stay in the plan: the engine's page cap stops them (`skipped:budget`).
 */
import {
  addDays,
  type CellKey,
  type DiscoveryQuery,
  daysBetween,
  GRID_SIDE,
  type GridMove,
  type IsoDate,
  type TilePlan,
} from '@gmt/core';
import { cellsOfQuery } from './tiles.js';

export interface Block {
  depFrom: IsoDate;
  retFrom: IsoDate;
  cells: CellKey[];
}

export interface GridPlanOptions {
  stepDays: { departures: number; returns: number };
  /** The scrolls one page may make (CAMOUFOX_GRID_SCROLL_CAP). */
  scrollCap: number;
  /** This pair's share of the run's pages and scrolls. */
  pageAllowance: number;
  scrollAllowance: number;
  today: IsoDate;
  horizonDays: number;
  times: { pageSeconds: number; scrollSeconds: number };
}

/** The lattice's first departure: the window's, or today once the window has started (CA 3). */
const anchorOf = (q: DiscoveryQuery, today: IsoDate): IsoDate =>
  q.departureFrom < today ? today : q.departureFrom;

/** The lattice block a cell belongs to. */
function blockOf(q: DiscoveryQuery, anchor: IsoDate, c: CellKey): { depFrom: IsoDate; retFrom: IsoDate } {
  const col = Math.floor(daysBetween(anchor, c.departureDate) / GRID_SIDE);
  const depFrom = addDays(anchor, GRID_SIDE * col);
  const base = addDays(depFrom, q.minNights);
  return {
    depFrom,
    retFrom: addDays(base, GRID_SIDE * Math.floor(daysBetween(base, c.returnDate) / GRID_SIDE)),
  };
}

/** True when a cell's departure or return passes the planning horizon. */
const past = (c: CellKey, last: IsoDate): boolean => c.departureDate > last || c.returnDate > last;

/** The query's cells past the planning horizon (no grid is planned for them; one probe page covers them). */
export function beyondHorizon(q: DiscoveryQuery, today: IsoDate, horizonDays: number): CellKey[] {
  const last = addDays(today, horizonDays);
  return cellsOfQuery(q).filter((c) => past(c, last));
}

/** The lattice blocks holding the query's cells (its `cells` when set), in column then return order. */
export function gridBlocks(q: DiscoveryQuery, today: IsoDate, horizonDays: number): Block[] {
  const last = addDays(today, horizonDays);
  const anchor = anchorOf(q, today);
  const byKey = new Map<string, Block>();
  for (const c of cellsOfQuery(q)) {
    if (past(c, last)) continue;
    const { depFrom, retFrom } = blockOf(q, anchor, c);
    const key = `${depFrom}/${retFrom}`;
    const b = byKey.get(key) ?? { depFrom, retFrom, cells: [] };
    b.cells.push(c);
    byKey.set(key, b);
  }
  return [...byKey.values()].sort((a, b) =>
    a.depFrom === b.depFrom ? (a.retFrom < b.retFrom ? -1 : 1) : a.depFrom < b.depFrom ? -1 : 1,
  );
}

/**
 * The scrolls from one block to the next (PIE M1): those that keep the returns on or after the departures first (later
 * returns, earlier departures), then the others, so no view on the way is one without a round trip.
 */
function movesBetween(a: Block, b: Block, step: GridPlanOptions['stepDays']): GridMove[] {
  const dDep = daysBetween(a.depFrom, b.depFrom);
  const dRet = daysBetween(a.retFrom, b.retFrom);
  const deps = Array<GridMove>(Math.ceil(Math.abs(dDep) / step.departures)).fill(dDep > 0 ? 'right' : 'left');
  const rets = Array<GridMove>(Math.ceil(Math.abs(dRet) / step.returns)).fill(dRet > 0 ? 'down' : 'up');
  const widening = [...(dRet > 0 ? rets : []), ...(dDep < 0 ? deps : [])];
  const narrowing = [...(dDep > 0 ? deps : []), ...(dRet < 0 ? rets : [])];
  return [...widening, ...narrowing];
}

/**
 * A block on the diagonal of a 0-night stay would open on a same-day pair: its page opens a day later on the returns
 * and scrolls up once before the block is read (PIE I1). The scroll this costs, when the block starts a page.
 */
const leadOf = (b: Block): number => (b.retFrom <= b.depFrom ? 1 : 0);

/** Columns in order, each swept from whichever end is nearer the block before. */
function pathOf(blocks: Block[], step: GridPlanOptions['stepDays']): Block[] {
  const columns = new Map<string, Block[]>();
  for (const b of blocks) columns.set(b.depFrom, [...(columns.get(b.depFrom) ?? []), b]);
  const path: Block[] = [];
  for (const column of columns.values()) {
    const prev = path.at(-1);
    const down = column;
    const up = [...column].reverse();
    const cost = (c: Block[]): number => {
      const first = c[0];
      return prev === undefined || first === undefined ? 0 : movesBetween(prev, first, step).length;
    };
    path.push(...(cost(up) < cost(down) ? up : down));
  }
  return path;
}

/** The pages of one pair's grid plan (see the module comment). */
export function planGridTiles(q: DiscoveryQuery, o: GridPlanOptions): TilePlan[] {
  const today = o.today;
  const path = pathOf(gridBlocks(q, o.today, o.horizonDays), o.stepDays);
  const beyond = beyondHorizon(q, o.today, o.horizonDays);
  const moves = path.slice(1).map((b, i) => {
    const a = path[i];
    return a === undefined ? [] : movesBetween(a, b, o.stepDays);
  });
  // why: joined[i] says whether block i + 1 is reached from block i by scrolling; a page's first block may cost a lead
  // scroll (leadOf), which joining the block onto the page before saves
  const joined = moves.map(() => false);
  const lead = path.map(leadOf);
  let pages = path.length;
  let scrolls = lead.reduce((a, b) => a + b, 0);
  const pageScrolls = (i: number): number => {
    // the scrolls of the page that would hold the move from block i to i + 1, were it joined
    let total = moves[i]?.length ?? 0;
    let first = i;
    for (let j = i - 1; j >= 0 && joined[j] === true; j--) {
      total += moves[j]?.length ?? 0;
      first = j;
    }
    for (let j = i + 1; j < joined.length && joined[j] === true; j++) total += moves[j]?.length ?? 0;
    return total + (lead[first] ?? 0);
  };
  const order = moves
    .map((m, i) => ({ i, n: m.length }))
    .sort((a, b) => (a.n === b.n ? a.i - b.i : a.n - b.n));
  for (const { i, n } of order) {
    const quicker = n * o.times.scrollSeconds < o.times.pageSeconds;
    if (!quicker && pages <= o.pageAllowance) break;
    const added = n - (lead[i + 1] ?? 0);
    if (scrolls + added > o.scrollAllowance || pageScrolls(i) > o.scrollCap) continue;
    joined[i] = true;
    pages--;
    scrolls += added;
  }
  const tiles: TilePlan[] = [];
  let current: { blocks: Block[]; moves: GridMove[]; reads: boolean[] } | null = null;
  const close = (): void => {
    const first = current?.blocks[0];
    if (current === null || first === undefined) return;
    const up = leadOf(first) === 1;
    tiles.push({
      index: tiles.length,
      coveredCells: current.blocks.flatMap((b) => b.cells),
      request: {
        kind: 'grid-path',
        start: {
          departureDate: addDays(first.depFrom, 3),
          returnDate: addDays(first.retFrom, up ? 4 : 3),
        },
        moves: up ? ['up', ...current.moves] : current.moves,
        reads: up ? [false, ...current.reads] : current.reads,
      },
    });
  };
  for (const [i, b] of path.entries()) {
    if (i > 0 && joined[i - 1] === true && current !== null) {
      const m = moves[i - 1] ?? [];
      current.blocks.push(b);
      current.moves.push(...m);
      current.reads.push(...m.map((_x, j) => j === m.length - 1));
    } else {
      close();
      current = { blocks: [b], moves: [], reads: [true] };
    }
  }
  close();
  // why: fix round 2 (ruling 1): the pages that join blocks by scrolls come first, so a pair's share of the run's pages
  // reaches its scrolls before the page cap binds; the order is otherwise the path's (a stable sort)
  const blocksOf = (t: TilePlan): number =>
    t.request.kind === 'grid-path' ? t.request.reads.filter((x) => x).length : 0;
  const ordered = tiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (blocksOf(a.t) > 1 === blocksOf(b.t) > 1 ? a.i - b.i : blocksOf(a.t) > 1 ? -1 : 1))
    .map(({ t }, index) => ({ ...t, index }));
  tiles.splice(0, tiles.length, ...ordered);
  // why: the engine's tiles partition a pair's cells; the cells past the horizon go to one probe page, opened at their
  // least departure and least return (PA I1, M4): Google's no-flights page there is evidence of no data only for the
  // cells on or after it on both axes (gridTile), and a page that shows prices leaves the cells it did not show as
  // issues, never guessed
  if (beyond.length > 0) {
    const dep = beyond.reduce(
      (m, c) => (c.departureDate < m ? c.departureDate : m),
      beyond[0]?.departureDate ?? today,
    );
    const ret = beyond.reduce(
      (m, c) => (c.returnDate < m ? c.returnDate : m),
      beyond[0]?.returnDate ?? today,
    );
    tiles.push({
      index: tiles.length,
      coveredCells: beyond,
      request: {
        kind: 'grid-path',
        // why: a page query is a round trip; a same-day least pair opens a day later on the returns
        start: { departureDate: dep, returnDate: ret > dep ? ret : addDays(dep, 1) },
        moves: [],
        reads: [true],
      },
    });
  }
  return tiles;
}

/** One page's scrolls and seconds at the measured times (CB-3). */
export function gridTileEstimate(
  t: TilePlan,
  times: GridPlanOptions['times'],
): { scrolls: number; seconds: number } {
  const scrolls = t.request.kind === 'grid-path' ? t.request.moves.length : 0;
  return { scrolls, seconds: times.pageSeconds + scrolls * times.scrollSeconds };
}
