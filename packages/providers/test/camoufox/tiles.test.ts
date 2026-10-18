import { asIata, asIsoDate, cellKeyString } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { planSingleCells } from '../../src/camoufox/index.js';

const Q = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2027-03-11'),
  departureTo: asIsoDate('2027-03-13'),
  minNights: 10,
  maxNights: 11,
  cabin: 'economy' as const,
  currency: 'GBP' as const,
};

describe('planSingleCells (spec §5.2: one 1 × 1 rectangle per cell)', () => {
  it('one tile per cell, in generation order, partitioning the cells', () => {
    const tiles = planSingleCells(Q);
    expect(tiles).toHaveLength(6);
    expect(tiles.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const t of tiles) {
      expect(t.coveredCells).toHaveLength(1);
      const [c] = t.coveredCells;
      expect(t.request).toEqual({
        kind: 'rectangle',
        departFrom: c?.departureDate,
        departTo: c?.departureDate,
        returnFrom: c?.returnDate,
        returnTo: c?.returnDate,
      });
    }
    const keys = tiles.flatMap((t) => t.coveredCells.map(cellKeyString));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('re-plans a subset, in the subset’s order, deterministically', () => {
    const all = planSingleCells(Q).flatMap((t) => t.coveredCells);
    const subset = [all[4], all[1]].filter((c) => c !== undefined);
    expect(planSingleCells({ ...Q, cells: subset }).map((t) => t.coveredCells)).toEqual([[all[4]], [all[1]]]);
    expect(planSingleCells({ ...Q, cells: subset })).toEqual(planSingleCells({ ...Q, cells: subset }));
  });
  it('refuses a cell of another pair', () => {
    const [c] = planSingleCells(Q).flatMap((t) => t.coveredCells);
    if (c === undefined) throw new Error('no cell');
    expect(() => planSingleCells({ ...Q, cells: [{ ...c, destination: asIata('EWR') }] })).toThrow(
      /per \(origin, destination\) pair/,
    );
  });
});
