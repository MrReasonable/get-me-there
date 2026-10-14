import type { Config, ProviderId, ProviderLimits } from '@gmt/core';

/**
 * The guard's view of the config (plan "Database" contract, ruling 6). One entry per configured provider:
 * its limits (including `costPerCallMicroGbp`, the only cost `reserve` accepts), `trialUsed` (decision 14)
 * and whether it is billable. A provider with no entry cannot be reserved for (fail closed).
 */
export interface BudgetConfig {
  providers: Partial<Record<ProviderId, ProviderBudget>>;
  spend: Config['spend'];
}
/** One provider's entry in `BudgetConfig`. */
export type ProviderBudget = ProviderLimits & { billable: boolean; trialUsed: number };

/** Spec §12 `SEARCHAPI_TRIAL_USED` (decision 14): credits spent before this install count against a lifetime window; monthly windows ignore it. */
export function effectiveCallCap(b: ProviderLimits & { trialUsed: number }): number {
  return b.window === 'lifetime' ? Math.max(0, b.monthlyCallCap - b.trialUsed) : b.monthlyCallCap;
}
