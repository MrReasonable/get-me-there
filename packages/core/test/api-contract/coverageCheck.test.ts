import { describe, expect, it } from 'vitest';
import { coverageCheckResponseSchema } from '../../src/api-contract/definitions.js';

const month = (cachedRows: number | null) => ({
  pairs: [{ origin: 'LHR', destination: 'JFK', months: [{ month: '2026-11', cachedRows, cellsInBand: 16 }] }],
  calls: 2,
  notes: [],
});

describe('coverageCheckResponseSchema (decisions 25, 37)', () => {
  it('a month not fully checked is null, never a number; counts are non-negative integers', () => {
    expect(coverageCheckResponseSchema.safeParse(month(null)).success).toBe(true);
    expect(coverageCheckResponseSchema.safeParse(month(0)).success).toBe(true);
    expect(coverageCheckResponseSchema.safeParse(month(-1)).success).toBe(false);
    expect(coverageCheckResponseSchema.safeParse(month(1.5)).success).toBe(false);
    expect(coverageCheckResponseSchema.safeParse({ ...month(3), calls: -1 }).success).toBe(false);
  });
});
