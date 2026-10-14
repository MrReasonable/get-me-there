import { describe, expect, it } from 'vitest';
import { countCells, generateCells } from '../../src/space/generate.js';
import { space, spaceCell } from '../helpers/space.js';

describe('countCells / generateCells (spec §6.1)', () => {
  it('counts the default space by hand: 2 origins × 3 destinations × 182 days × 12 nights = 13,104', () => {
    // 2026-10-21 + 181 days = 2027-04-20 (182 departure days inclusive); nights 10..21 = 12 values.
    const s = space({
      o: ['LHR', 'LGW'],
      d: ['JFK', 'EWR', 'AAA'],
      from: '2026-10-21',
      to: '2027-04-20',
      min: 10,
      max: 21,
    });
    expect(countCells(s)).toBe(13_104);
  });

  it('enumerates the tiny space literally: 1 × 1 × 3 days × 2 nights = 6 cells, in order', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 7, max: 8 });
    expect(countCells(s)).toBe(6);
    expect(generateCells(s)).toEqual([
      spaceCell('LHR', 'JFK', '2027-03-01', '2027-03-08', 7),
      spaceCell('LHR', 'JFK', '2027-03-01', '2027-03-09', 8),
      spaceCell('LHR', 'JFK', '2027-03-02', '2027-03-09', 7),
      spaceCell('LHR', 'JFK', '2027-03-02', '2027-03-10', 8),
      spaceCell('LHR', 'JFK', '2027-03-03', '2027-03-10', 7),
      spaceCell('LHR', 'JFK', '2027-03-03', '2027-03-11', 8),
    ]);
  });

  it('secondary property: countCells equals the generated length on the default space', () => {
    const s = space({
      o: ['LHR', 'LGW'],
      d: ['JFK', 'EWR', 'AAA'],
      from: '2026-10-21',
      to: '2027-04-20',
      min: 10,
      max: 21,
    });
    expect(generateCells(s)).toHaveLength(countCells(s));
  });

  it('is zero for an empty window (departureTo before departureFrom) and generates nothing', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-05', to: '2027-03-04', min: 7, max: 8 });
    expect(countCells(s)).toBe(0);
    expect(generateCells(s)).toEqual([]);
  });

  it('is zero for an inverted nights range', () => {
    expect(
      countCells(space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 9, max: 8 })),
    ).toBe(0);
  });
});
