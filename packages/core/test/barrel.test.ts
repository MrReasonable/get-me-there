import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('@gmt/core barrel', () => {
  it('re-exports the WP0 contract surface', () => {
    for (const name of [
      'iataSchema',
      'asIsoDate',
      'provenanceSchema',
      'cellKeyString',
      'ACTIVE_STATUSES',
      'ProviderError',
      'BudgetExceeded',
      'AbortedError',
      'NormalisationError',
      'Secret',
      'PLAN_PRESETS',
      'parseConfig',
      'syntheticAllowed',
      'findBannedWords',
      'effectiveAge',
      'fixedClock',
      'systemClock',
    ]) {
      expect(core, name).toHaveProperty(name);
    }
    expect(core.apiContract.ROUTES.length).toBeGreaterThan(30);
  });
});
