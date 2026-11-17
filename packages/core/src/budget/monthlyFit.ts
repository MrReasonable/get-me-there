import { budgetScopeLabel } from '../ports/budget.js';
import type { ProviderId } from '../types/provenance.js';

/** One scope of a budget fit, as the engine's `budgetFit` and the estimate's `budgetFit` carry it. */
interface FitScope {
  scope: string;
  fits: boolean;
}

/**
 * The provider-month caps a schedule would miss (decision 25, ruling 5; design 2026-11-08 Ruling 14): the scopes of the
 * budget fit, at the schedule's runs a month, that are a named provider's month and do not fit, matched by core's one
 * scope label (decision 54). The api refuses a schedule turned on or changed with any (`schedule_over_budget`), and the
 * new-search panel refuses a repeating search before sending it by the same rule, so the two cannot drift. Other scopes
 * (a run's own limits, the global month, a trial's lifetime) are not this refusal's.
 */
export function monthlyCapsMissed(perScope: readonly FitScope[], providers: readonly ProviderId[]): string[] {
  const months = new Set(
    providers.map((providerId) => budgetScopeLabel({ kind: 'provider-month', providerId })),
  );
  return perScope.filter((s) => months.has(s.scope) && !s.fits).map((s) => s.scope);
}
