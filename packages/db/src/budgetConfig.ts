import { type Config, type ProviderId, type ProviderLimits, syntheticAllowed } from '@gmt/core';

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

/**
 * The fixture provider's guard entry, fixture-only: billable at the configured test rate, a finite test cap (no
 * config field exists for it). why: the guard reads only monthlyCallCap, window, billingDay, costPerCallMicroGbp and
 * planFixedMicroGbp; the rate, concurrency, TTL and schedule values exist only to satisfy ProviderLimits, describe no
 * real vendor, and never reach the ledger (the fixture's ledger cost is `FIXTURE_COST_MICRO_GBP`, set below; arch-M5).
 */
const FIXTURE_LIMITS: ProviderLimits = {
  monthlyCallCap: 100_000,
  window: 'month',
  billingDay: 1,
  ratePerMinute: 6000,
  ratePerHour: 100_000,
  concurrency: 4,
  cacheTtlHours: 1,
  costPerCallMicroGbp: 0,
  planFixedMicroGbp: 0,
  excludedFromSchedule: false,
};

/**
 * Builds the guard's configuration from the parsed config (spec §12). Only configured providers appear.
 * `trialUsed` carries `SEARCHAPI_TRIAL_USED` for a lifetime plan (decision 14). The fixture's rate is
 * `FIXTURE_COST_MICRO_GBP`, read only from `providers.fixture.costPerCallMicroGbp` (ruling 6).
 */
export function budgetConfigFromConfig(c: Config): BudgetConfig {
  const providers: BudgetConfig['providers'] = {};
  const tp = c.providers.travelpayouts;
  if (tp !== null) providers.travelpayouts = { ...tp.limits, billable: false, trialUsed: 0 };
  const sa = c.providers.searchapi;
  if (sa !== null)
    providers.searchapi = {
      ...sa.limits,
      billable: true,
      trialUsed: sa.limits.window === 'lifetime' ? sa.trialUsed : 0,
    };
  // why: cost-005: camoufox is free and never billable; its page caps come from its own limits and the snapshot.
  const cf = c.providers.camoufox;
  if (cf !== null) providers.camoufox = { ...cf.limits, billable: false, trialUsed: 0 };
  const fixture = c.providers.fixture;
  if (fixture !== null && syntheticAllowed(c))
    providers.fixture = {
      ...FIXTURE_LIMITS,
      costPerCallMicroGbp: fixture.costMicroGbp,
      billable: true,
      trialUsed: 0,
    };
  return { providers, spend: c.spend };
}
