// WP15 Task 15.3: the grid planner (spec §2 rev 34; decision 70), pure: the 7 × 7 block lattice from the window and the
// stay range, the path, and the choice per move between a new page and the measured one-day scrolls within the page
// and scroll allowances. Synthetic queries; the worked example's figures.
import {
  addDays,
  asIata,
  asIsoDate,
  cellKeyString,
  type DiscoveryQuery,
  daysBetween,
  GRID_TIMES,
  type GridMove,
  gridRequestSchema,
  type IsoDate,
  type TilePlan,
} from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { gridBlocks, gridTileEstimate, planGridTiles } from '../../src/camoufox/grid.js';
import { cellsOfQuery } from '../../src/camoufox/tiles.js';

beforeEach(() => {
  expect.hasAssertions();
});

const WORKED: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2027-03-01'),
  departureTo: addDays(asIsoDate('2027-03-01'), 181),
  minNights: 10,
  maxNights: 21,
  cabin: 'economy',
  currency: 'GBP',
};
const TODAY = asIsoDate('2026-10-18');
const STEP = { departures: 1, returns: 1 };
const opts = (o: Partial<Parameters<typeof planGridTiles>[1]> = {}) => ({
  stepDays: STEP,
  scrollCap: 30,
  pageAllowance: 100,
  scrollAllowance: 600,
  today: TODAY,
  horizonDays: 400,
  times: GRID_TIMES,
  ...o,
});

describe('gridBlocks', () => {
  it('the worked example: 26 columns × 3 blocks, every one of the 2,184 cells in exactly one block', () => {
    const blocks = gridBlocks(WORKED, TODAY, 400);
    expect(blocks).toHaveLength(78);
    const keys = blocks.flatMap((b) => b.cells.map(cellKeyString));
    expect(keys).toHaveLength(2184);
    expect(new Set(keys)).toEqual(new Set(cellsOfQuery(WORKED).map(cellKeyString)));
    const [first] = blocks;
    expect(first && [first.depFrom, first.retFrom]).toEqual(['2027-03-01', '2027-03-11']);
    for (const b of blocks)
      for (const c of b.cells) {
        expect(c.departureDate >= b.depFrom && c.departureDate <= addDays(b.depFrom, 6)).toBe(true);
        expect(c.returnDate >= b.retFrom && c.returnDate <= addDays(b.retFrom, 6)).toBe(true);
      }
  });
  it('a single 7-night stay is one block a column; a 1–3-night band two', () => {
    expect(gridBlocks({ ...WORKED, minNights: 7, maxNights: 7 }, TODAY, 400)).toHaveLength(26);
    expect(gridBlocks({ ...WORKED, minNights: 1, maxNights: 3 }, TODAY, 400)).toHaveLength(52);
  });
  it('plans no block past the horizon (the sale window, 2026-10-18); one probe page covers the cells beyond it', () => {
    const blocks = gridBlocks(WORKED, TODAY, 300);
    const last = addDays(TODAY, 300);
    // why: fix round 1 (PA I1): the horizon bounds the returns as well as the departures
    expect(blocks.every((b) => b.cells.every((c) => c.departureDate <= last && c.returnDate <= last))).toBe(
      true,
    );
    const tiles = planGridTiles(WORKED, opts({ horizonDays: 300, pageAllowance: 400 }));
    const probe = tiles.at(-1);
    expect(probe?.coveredCells.every((c) => c.departureDate > last || c.returnDate > last)).toBe(true);
    expect(probe?.request).toMatchObject({ kind: 'grid-path', moves: [], reads: [true] });
    expect(tiles.flatMap((t) => t.coveredCells).length).toBe(2184);
    expect(tiles).toHaveLength(blocks.length + 1);
  });
  it('re-plans only the blocks holding the cells asked for', () => {
    const all = cellsOfQuery(WORKED);
    const subset = [all[0], all[1], all[2000]].filter((c) => c !== undefined);
    expect(gridBlocks({ ...WORKED, cells: subset }, TODAY, 400)).toHaveLength(2);
  });
});

describe('planGridTiles', () => {
  it('pages are quicker than seven scrolls, so with room every block is its own page (no scroll)', () => {
    const tiles = planGridTiles(WORKED, opts({ pageAllowance: 400 }));
    expect(tiles).toHaveLength(78);
    expect(tiles.every((t) => t.request.kind === 'grid-path' && t.request.moves.length === 0)).toBe(true);
    const [t0] = tiles;
    expect(t0?.request).toEqual({
      kind: 'grid-path',
      start: { departureDate: '2027-03-04', returnDate: '2027-03-14' },
      moves: [],
      reads: [true],
    });
  });
  it('under the page allowance the planner scrolls, seven a block, within the scroll and per-page caps', () => {
    const tiles = planGridTiles(WORKED, opts({ pageAllowance: 25, scrollAllowance: 150 }));
    const moves = tiles.flatMap((t) => (t.request.kind === 'grid-path' ? t.request.moves : []));
    expect(moves.length).toBeLessThanOrEqual(150);
    expect(moves.length % 7).toBe(0);
    for (const t of tiles)
      expect(t.request.kind === 'grid-path' && t.request.moves.length).toBeLessThanOrEqual(30);
    // why: 21 block moves fit in 150 scrolls, so 78 − 21 = 57 pages; the engine's page cap stops the rest
    expect(tiles).toHaveLength(57);
    const reads = tiles.flatMap((t) =>
      t.request.kind === 'grid-path' ? t.request.reads.filter((x) => x) : [],
    );
    expect(reads).toHaveLength(78);
  });
  it('a block move is scrolls on its axis: down the returns in a column, right the departures between columns', () => {
    const tiles = planGridTiles(WORKED, opts({ pageAllowance: 1, scrollAllowance: 600 }));
    const [t0] = tiles;
    if (t0?.request.kind !== 'grid-path') throw new Error('grid-path');
    expect(t0.request.moves.slice(0, 14)).toEqual(Array(14).fill('down'));
    expect(t0.request.reads.slice(0, 15)).toEqual([
      true,
      ...Array(6).fill(false),
      true,
      ...Array(6).fill(false),
      true,
    ]);
    expect(t0.request.moves.length).toBeLessThanOrEqual(30);
  });
  it('the tiles’ covered cells partition the cells, and a tile’s first view is its first block’s centre', () => {
    const tiles = planGridTiles(WORKED, opts({ pageAllowance: 25, scrollAllowance: 150 }));
    const keys = tiles.flatMap((t) => t.coveredCells.map(cellKeyString));
    expect(keys).toHaveLength(2184);
    expect(new Set(keys).size).toBe(2184);
    expect(tiles.map((t) => t.index)).toEqual(tiles.map((_t, i) => i));
  });
  it('a step other than one: a block move is ⌈7 / step⌉ scrolls', () => {
    const tiles = planGridTiles(WORKED, opts({ stepDays: { departures: 7, returns: 7 }, pageAllowance: 1 }));
    const [t0] = tiles;
    expect(t0?.request.kind === 'grid-path' && t0.request.moves.slice(0, 2)).toEqual(['down', 'down']);
  });
  it('is deterministic', () => {
    expect(planGridTiles(WORKED, opts({ pageAllowance: 30 }))).toEqual(
      planGridTiles(WORKED, opts({ pageAllowance: 30 })),
    );
  });
});

/** Every view a page shows along its moves: its first departure and first return. */
function viewsOf(t: TilePlan): Array<{ dep: IsoDate; ret: IsoDate }> {
  if (t.request.kind !== 'grid-path') return [];
  let at = { dep: addDays(t.request.start.departureDate, -3), ret: addDays(t.request.start.returnDate, -3) };
  const out = [at];
  const by: Record<GridMove, [number, number]> = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
  for (const m of t.request.moves) {
    const [dd, dr] = by[m];
    at = { dep: addDays(at.dep, dd), ret: addDays(at.ret, dr) };
    out.push(at);
  }
  return out;
}
const asRequest = (t: TilePlan) =>
  t.request.kind === 'grid-path'
    ? gridRequestSchema.safeParse({
        mode: 'grid',
        origin: 'LHR',
        destination: 'JFK',
        gl: 'GB',
        start: t.request.start,
        moves: t.request.moves,
        reads: t.request.reads,
        scrollAllowance: t.request.moves.length,
      }).success
    : false;

describe('planGridTiles: fix round 1', () => {
  it('the probe opens at the least departure and the least return past the horizon, so no flights there implies no flights for every cell it covers (PA I1, M4)', () => {
    const tiles = planGridTiles(WORKED, opts({ horizonDays: 300, pageAllowance: 400 }));
    const probe = tiles.at(-1);
    if (probe?.request.kind !== 'grid-path') throw new Error('probe');
    const deps = probe.coveredCells.map((c) => c.departureDate).sort();
    const rets = probe.coveredCells.map((c) => c.returnDate).sort();
    expect(probe.request.start).toEqual({ departureDate: deps[0], returnDate: rets[0] });
    expect(probe.request.start.returnDate > addDays(TODAY, 300)).toBe(true);
  });
  it('a stay of 0 nights: a block on the diagonal opens a day later and scrolls up once before it is read (PIE I1)', () => {
    const q = { ...WORKED, departureTo: addDays(WORKED.departureFrom, 13), minNights: 0, maxNights: 3 };
    const tiles = planGridTiles(q, opts({ pageAllowance: 400 }));
    expect(tiles.every(asRequest)).toBe(true);
    expect(tiles[0]?.request).toEqual({
      kind: 'grid-path',
      start: { departureDate: '2027-03-04', returnDate: '2027-03-05' },
      moves: ['up'],
      reads: [false, true],
    });
    const keys = tiles.flatMap((t) => t.coveredCells.map(cellKeyString));
    expect(new Set(keys)).toEqual(new Set(cellsOfQuery(q).map(cellKeyString)));
  });
  it('a stay of 0 nights under the page allowance keeps every page within the scroll cap and every view holding a pair (PIE I1, M1)', () => {
    const q = { ...WORKED, departureTo: addDays(WORKED.departureFrom, 27), minNights: 0, maxNights: 3 };
    const tiles = planGridTiles(q, opts({ pageAllowance: 1, scrollCap: 30 }));
    expect(tiles.every(asRequest)).toBe(true);
    for (const t of tiles) {
      expect(t.request.kind === 'grid-path' && t.request.moves.length).toBeLessThanOrEqual(30);
      // why: a view whose last return precedes its first departure holds no round trip at all
      for (const v of viewsOf(t)) expect(daysBetween(v.dep, addDays(v.ret, 6))).toBeGreaterThanOrEqual(0);
    }
    expect(
      tiles.flatMap((t) => (t.request.kind === 'grid-path' ? t.request.moves : [])).length,
    ).toBeGreaterThan(0);
  });
  it('with a per-page scroll cap of 0 a 0-night diagonal page opens a day later with no scroll (re-review N4)', () => {
    const q = { ...WORKED, departureTo: addDays(WORKED.departureFrom, 13), minNights: 0, maxNights: 3 };
    const tiles = planGridTiles(q, opts({ pageAllowance: 400, scrollCap: 0 }));
    expect(tiles.every(asRequest)).toBe(true);
    expect(tiles.every((t) => t.request.kind === 'grid-path' && t.request.moves.length === 0)).toBe(true);
    expect(tiles[0]?.request).toEqual({
      kind: 'grid-path',
      start: { departureDate: '2027-03-04', returnDate: '2027-03-05' },
      moves: [],
      reads: [true],
    });
  });
  it('between blocks the returns move first when they go later, and the departures first when they go earlier (PIE M1)', () => {
    // why: one stay, two columns: the move between them is 7 days later on both axes
    const q = { ...WORKED, departureTo: addDays(WORKED.departureFrom, 13), minNights: 10, maxNights: 10 };
    const [t0] = planGridTiles(q, opts({ pageAllowance: 1 }));
    if (t0?.request.kind !== 'grid-path') throw new Error('grid-path');
    // why: each block move is the moves up to the next read view; within one, no widening move follows a narrowing one
    const { moves, reads } = t0.request;
    const segments: GridMove[][] = [[]];
    for (const [i, m] of moves.entries()) {
      segments.at(-1)?.push(m);
      if (reads[i + 1] === true) segments.push([]);
    }
    expect(segments.filter((x) => x.includes('right') && x.includes('down')).length).toBeGreaterThan(0);
    for (const x of segments) {
      const firstNarrow = x.findIndex((m) => m === 'right' || m === 'up');
      expect(
        firstNarrow === -1 || x.slice(firstNarrow).every((m) => m === 'right' || m === 'up'),
        x.join(' '),
      ).toBe(true);
    }
  });
  it('a re-plan whose window starts before today anchors the lattice at today: no page opens on days already past (CA 3)', () => {
    const today = asIsoDate('2027-03-05');
    const cells = cellsOfQuery(WORKED).filter((c) => c.departureDate > today);
    const tiles = planGridTiles({ ...WORKED, cells }, opts({ today }));
    for (const t of tiles)
      expect(t.request.kind === 'grid-path' && t.request.start.departureDate >= addDays(today, 3)).toBe(true);
    expect(tiles[0]?.request.kind === 'grid-path' && tiles[0].request.start.departureDate).toBe('2027-03-08');
    const keys = tiles.flatMap((t) => t.coveredCells.map(cellKeyString));
    expect(new Set(keys)).toEqual(new Set(cells.map(cellKeyString)));
    expect(keys).toHaveLength(cells.length);
  });
});

describe('planGridTiles: joined pages first (fix round 2)', () => {
  it('a pair’s pages that join blocks by scrolls come first, single-block pages after, the probe last', () => {
    const tiles = planGridTiles(WORKED, opts({ pageAllowance: 25, scrollAllowance: 150, horizonDays: 300 }));
    const blocks = (t: TilePlan) =>
      t.request.kind === 'grid-path' ? t.request.reads.filter((x) => x).length : 0;
    const counts = tiles.slice(0, -1).map(blocks);
    // why: 21 joined moves; the pages that hold them are the pair's first pages, so its share of 25 pages reaches them
    const joined = counts.filter((n) => n > 1).length;
    expect(joined).toBeGreaterThan(0);
    expect(counts.slice(0, joined).every((n) => n > 1)).toBe(true);
    expect(counts.slice(joined).every((n) => n === 1)).toBe(true);
    const first25 = tiles
      .slice(0, 25)
      .flatMap((t) => (t.request.kind === 'grid-path' ? t.request.moves : []));
    expect(first25).toHaveLength(147);
    expect(tiles.map((t) => t.index)).toEqual(tiles.map((_t, i) => i));
    const probe = tiles.at(-1);
    expect(
      probe?.coveredCells.every(
        (c) => c.departureDate > addDays(TODAY, 300) || c.returnDate > addDays(TODAY, 300),
      ),
    ).toBe(true);
  });
});

describe('gridTileEstimate', () => {
  it('a page is the page time plus each scroll’s time', () => {
    const [t] = planGridTiles(WORKED, opts({ pageAllowance: 1 }));
    if (t === undefined) throw new Error('tile');
    const e = gridTileEstimate(t, GRID_TIMES);
    expect(e.scrolls).toBe(t.request.kind === 'grid-path' ? t.request.moves.length : -1);
    expect(e.seconds).toBeCloseTo(GRID_TIMES.pageSeconds + e.scrolls * GRID_TIMES.scrollSeconds, 6);
  });
});
