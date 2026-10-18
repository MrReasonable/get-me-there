import { describe, expect, it } from 'vitest';
import { pointOfSaleOf } from '../src/pointOfSale.js';

describe('pointOfSaleOf (prov-004: the dated table, stored as stated)', () => {
  it.each([
    ['Location·United Kingdom', 'GB'],
    ['Location: United States', 'US'],
    ['Location·Narnia', 'unknown'],
    [null, 'unknown'],
  ])('%s → %s', (name, pos) => {
    expect(pointOfSaleOf(name)).toBe(pos);
  });
});
