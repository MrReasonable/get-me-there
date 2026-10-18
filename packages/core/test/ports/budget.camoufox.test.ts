import { describe, expect, it } from 'vitest';
import { budgetScopeLabel } from '../../src/ports/budget.js';

describe('provider-execution scope (spec §5.1)', () => {
  it('carries the execution and the provider, and labels by provider', () => {
    expect(budgetScopeLabel({ kind: 'provider-execution', executionId: 'e1', providerId: 'camoufox' })).toBe(
      'provider-execution:camoufox',
    );
  });
});
