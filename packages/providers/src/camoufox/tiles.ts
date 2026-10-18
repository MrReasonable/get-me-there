/**
 * camoufox list-mode tiling (spec §2, §5.2 rev 32): one page prices one day pair, so each cell is its own 1 × 1
 * `rectangle` tile, in `generateCells` (or `q.cells`) order. Pure and deterministic; tiles partition the cells.
 */
import { type CellKey, type DiscoveryQuery, generateCells, type TilePlan } from '@gmt/core';

/** The cells to tile: `q.cells` when set (a re-plan subset), else the pair's full space; every cell is the pair's. */
export function cellsOfQuery(q: DiscoveryQuery): CellKey[] {
  if (q.cells !== undefined) {
    if (q.cells.some((c) => c.origin !== q.origin || c.destination !== q.destination))
      throw new Error('a camoufox query is per (origin, destination) pair; every cell must belong to it');
    return q.cells;
  }
  return generateCells({
    origins: [q.origin],
    destinations: [q.destination],
    departureFrom: q.departureFrom,
    departureTo: q.departureTo,
    minNights: q.minNights,
    maxNights: q.maxNights,
  }).map(({ origin, destination, departureDate, returnDate }) => ({
    origin,
    destination,
    departureDate,
    returnDate,
  }));
}

export function planSingleCells(q: DiscoveryQuery): TilePlan[] {
  return cellsOfQuery(q).map((cell, index) => ({
    index,
    coveredCells: [cell],
    request: {
      kind: 'rectangle',
      departFrom: cell.departureDate,
      departTo: cell.departureDate,
      returnFrom: cell.returnDate,
      returnTo: cell.returnDate,
    },
  }));
}
