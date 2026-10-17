import { describe, expect, it } from 'vitest';
import { SOURCE_LABELS, sourceLabel } from '../../src/labels/source.js';

describe('sourceLabel: the one copy of the spec §11 source wording (decision 56)', () => {
  it('names every source kind', () => {
    expect(sourceLabel({ sourceKind: 'scraped-search' })).toBe('Google Flights via SearchApi');
    expect(sourceLabel({ sourceKind: 'scraped-aggregate' })).toBe('Google date grid via SearchApi');
    expect(sourceLabel({ sourceKind: 'authorised-cached' })).toBe('Aviasales cache');
    expect(sourceLabel({ sourceKind: 'synthetic' })).toBe('synthetic fixture data');
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([
      'authorised-cached',
      'scraped-aggregate',
      'scraped-search',
      'synthetic',
    ]);
  });
});
