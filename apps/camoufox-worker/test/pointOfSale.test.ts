import { describe, expect, it } from 'vitest';
import { POINT_OF_SALE_DATED, pointOfSaleOf } from '../src/pointOfSale.js';

describe('pointOfSaleOf (prov-004: the dated table, stored as stated)', () => {
  it.each([
    ['Location·United Kingdom', 'GB'],
    ['Location: United States', 'US'],
    ['Location·Narnia', 'unknown'],
    // why: observed 2026-11-03 on a live flights page: a zero-width space as the separator
    ['Location\u200bUnited Kingdom', 'GB'],
    ['Location\u2060·\u200bUnited States', 'US'],
    ['Location\u200bNarnia', 'unknown'],
    [null, 'unknown'],
  ])('%s → %s', (name, pos) => {
    expect(pointOfSaleOf(name)).toBe(pos);
  });
});

describe('the table is dated', () => {
  it('re-dated 2026-11-03 for the zero-width separator', () => {
    expect(POINT_OF_SALE_DATED).toBe('2026-11-03');
  });
});
