import type { ProviderLimits } from '@gmt/core';
import type { BudgetConfig } from '../../src/budgetConfig.js';

/** One provider's guard entry. Defaults: a 40usd-shaped subscription (rate 0, no fee). */
export function limits(
  over: Partial<ProviderLimits & { billable: boolean; trialUsed: number }> = {},
): ProviderLimits & { billable: boolean; trialUsed: number } {
  return {
    monthlyCallCap: 10_000,
    window: 'month',
    billingDay: 1,
    ratePerMinute: 10,
    ratePerHour: 2000,
    concurrency: 2,
    cacheTtlHours: 1,
    costPerCallMicroGbp: 0,
    planFixedMicroGbp: 0,
    excludedFromSchedule: false,
    billable: true,
    trialUsed: 0,
    ...over,
  };
}

/** A guard configuration; `spend` overrides the spec §12 defaults. */
export function budgetConfig(
  providers: BudgetConfig['providers'],
  spend: Partial<BudgetConfig['spend']> = {},
): BudgetConfig {
  return {
    providers,
    spend: {
      monthlyCapMicroGbp: 0,
      globalBillingDay: 1,
      softConfirmMicroGbp: 1_000_000,
      executionMaxCalls: 2000,
      executionMaxFreeCalls: 2000,
      executionMaxCostMicroGbp: 0,
      childMaxCalls: 6,
      ...spend,
    },
  };
}
