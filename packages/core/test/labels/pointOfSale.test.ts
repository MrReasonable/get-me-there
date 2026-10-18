import { describe, expect, it } from 'vitest';
import { pointOfSaleLabel } from '../../src/labels/pointOfSale.js';

describe('pointOfSaleLabel: the one copy of the spec §11 point-of-sale wording', () => {
  it('words GB as the UK market', () => {
    expect(pointOfSaleLabel({ pointOfSale: 'GB' })).toBe('UK market');
  });

  it('says plainly when the vendor did not state a market', () => {
    expect(pointOfSaleLabel({ pointOfSale: 'unknown' })).toBe('market not stated');
  });

  it('names any other country by its ISO code', () => {
    expect(pointOfSaleLabel({ pointOfSale: 'US' })).toBe('US market');
    expect(pointOfSaleLabel({ pointOfSale: 'DE' })).toBe('DE market');
  });
});
