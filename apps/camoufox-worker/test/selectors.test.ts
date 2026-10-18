import { describe, expect, it } from 'vitest';
import { FLAG_NAMES, flagsOf, PROOFS, SELECTORS, SELECTORS_VERSION } from '../src/selectors.js';

describe('the dated selectors module (spec §2; brief §9)', () => {
  it('is dated', () => {
    expect(SELECTORS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    expect(SELECTORS.version).toBe(SELECTORS_VERSION);
  });
  it('reports every flag; only RESULTS_VERIFIED is true before the recordings, and grid stays off in WP14', () => {
    expect(flagsOf()).toEqual({
      RESULTS_VERIFIED: true,
      FORM_VERIFIED: false,
      CHEAPEST_FLOW_VERIFIED: false,
      VIEW_MORE_ADDS_CHEAPER: false,
      NO_FLIGHTS_VERIFIED: false,
      SOCS_STABLE: false,
      GRID_VERIFIED: false,
    });
    expect(Object.keys(flagsOf())).toEqual([...FLAG_NAMES]);
  });
  it('each true flag names its proving recording’s date (TS-13)', () => {
    for (const f of FLAG_NAMES) {
      if (!flagsOf()[f]) continue;
      expect(PROOFS[f], f).toMatch(/^\d{4}-\d{2}-\d{2} /);
    }
  });
});
