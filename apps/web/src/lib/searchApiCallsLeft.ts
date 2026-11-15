import { budgetScopeLabel } from '@gmt/core';
import type { BudgetResponse, ProvidersResponse } from '../api/types.js';

/**
 * SearchApi's calls left (design 2026-11-08 Ruling 10): `left` of `cap` in the window the install's plan uses, a month
 * on the $40 plan and the one-off allowance on the trial. The top bar words it, and the new-search panel's
 * "up to N calls a run, M left" reads the same figure, so the two never disagree. Stage 3 replaces it with the vendor's
 * own balance.
 *
 * Null when there is nothing honest to say: SearchApi is absent or not enabled, its window's usage is not in the
 * budget read, or the window has no cap (a null cap means none is configured, never "unlimited calls left").
 */
export interface CallsLeft {
  left: number;
  cap: number;
  window: 'month' | 'trial';
}

export function searchApiCallsLeft(
  budget: Pick<BudgetResponse, 'scopes'>,
  providers: Pick<ProvidersResponse, 'providers'>,
): CallsLeft | null {
  const provider = providers.providers.find((p) => p.providerId === 'searchapi');
  if (provider === undefined || !provider.enabled) return null;
  // why: only the trial's allowance is a lifetime window; every other plan counts calls in the month (the api sends
  // only the window in use, but the plan, not the scopes present, says which one that is)
  const window = provider.plan === 'trial' ? 'trial' : 'month';
  const label = budgetScopeLabel({
    kind: window === 'trial' ? 'provider-lifetime' : 'provider-month',
    providerId: 'searchapi',
  });
  const usage = budget.scopes.find((u) => u.scope === label);
  if (usage === undefined || usage.cap === null) return null;
  return { left: Math.max(0, usage.cap - usage.calls), cap: usage.cap, window };
}
