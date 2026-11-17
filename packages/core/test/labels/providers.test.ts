import { describe, expect, it } from 'vitest';
import { START_REFUSAL_FILE } from '../../src/camoufox/start.js';
import { PROVIDER_NAMES } from '../../src/labels/providers.js';

describe('shared names', () => {
  it('every provider has one short name', () => {
    expect(PROVIDER_NAMES).toEqual({
      travelpayouts: 'Travelpayouts',
      searchapi: 'SearchApi',
      camoufox: 'Camoufox',
      fixture: 'Fixture',
    });
  });
  it('the refusal file name is one constant', () => {
    expect(START_REFUSAL_FILE).toBe('start-refusal.json');
  });
});
