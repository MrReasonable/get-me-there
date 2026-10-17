import { describe, expect, it } from 'vitest';
import { microGbpToPence, PENCE_TO_MICRO } from '../../src/config/presets.js';
import * as core from '../../src/index.js';

describe('microGbpToPence (decision 47)', () => {
  it('rounds up to the whole penny, so a cost is never shown below what it is', () => {
    expect(microGbpToPence(0)).toBe(0);
    expect(microGbpToPence(1)).toBe(1);
    expect(microGbpToPence(PENCE_TO_MICRO)).toBe(1);
    expect(microGbpToPence(PENCE_TO_MICRO + 1)).toBe(2);
    expect(microGbpToPence(7680)).toBe(1);
    expect(core.microGbpToPence).toBe(microGbpToPence);
  });
});
