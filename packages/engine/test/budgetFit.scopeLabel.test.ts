// budgetFit names every scope through core's budgetScopeLabel (plan decision 57), so the api's schedule refusal and
// the web's usage rows match it by construction. core's label is wrapped here with a marker: any scope name budgetFit
// builds on its own lacks the marker and fails.
import type { BudgetScope } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';

describe('budgetFit scope names come from core budgetScopeLabel (plan decision 57)', () => {
  it('every perScope name is the shared label, for execution, provider and global scopes', async () => {
    // why: the suite's setup file has already loaded the engine, so the wrapper is installed on a fresh module graph.
    vi.resetModules();
    vi.doMock('@gmt/core', async (importOriginal) => {
      const real = await importOriginal<typeof import('@gmt/core')>();
      return { ...real, budgetScopeLabel: (s: BudgetScope): string => `label>${real.budgetScopeLabel(s)}` };
    });
    try {
      const { budgetFitFor } = await import('../src/budgetFit.js');
      const { buildContext } = await import('../src/context.js');
      const { createHarness } = await import('./support/harness.js');
      const h = createHarness();
      const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
      const fit = budgetFitFor(buildContext(h.deps, h.options), def, def.id);
      expect(fit.perScope.map((s) => s.scope)).toEqual(
        [
          'execution-calls',
          'execution-free-calls',
          'execution-cost',
          'provider-month:fixture',
          'global-month',
        ].map((s) => `label>${s}`),
      );
    } finally {
      vi.doUnmock('@gmt/core');
      vi.resetModules();
    }
  });
});
