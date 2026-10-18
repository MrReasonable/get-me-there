/** Plan presets from spec §12 and docs/api-limits.md. Money in micro-GBP; pence × 10 000. */
export type PlanId = 'trial' | '40usd';

export interface ProviderLimits {
  monthlyCallCap: number;
  window: 'month' | 'lifetime';
  billingDay: number;
  ratePerMinute: number;
  ratePerHour: number;
  concurrency: number;
  cacheTtlHours: number;
  costPerCallMicroGbp: number;
  planFixedMicroGbp: number;
  excludedFromSchedule: boolean;
  /**
   * A provider's own per-execution call cap (camoufox's CAMOUFOX_EXECUTION_PAGE_CAP, decision 69); the engine freezes it
   * into the execution's snapshot (`budget.providerMaxCalls`), and the guard reads it from there. Absent: none.
   */
  executionCallCap?: number;
  /** camoufox (fix round 1, arch M7): the least seconds between page starts; the engine's estimate reads it. */
  minSpacingSeconds?: number;
  /** Pages-only counting (camoufox): ledger rows of class `no-page` count toward neither page cap (spec §5.3 rev 32). */
  pagesOnly?: true;
}

export const PENCE_TO_MICRO = 10_000;

/** Micro-GBP to whole pence, rounded up: the one money rounding for estimates, caps and confirmations (decision 47). */
export function microGbpToPence(micro: number): number {
  return Math.ceil(micro / PENCE_TO_MICRO);
}

export type PlanPreset = ProviderLimits & {
  monthlySpendCapMicroGbp: number;
  executionMaxCalls: number;
  executionMaxCostMicroGbp: number;
};

export const PLAN_PRESETS: Record<PlanId, PlanPreset> = {
  // why: the free allowance is a one-off credit balance (spec §2 fact 7), so the window is lifetime
  // and scheduled runs exclude the provider; the spike and the smoke are the only users.
  trial: {
    monthlyCallCap: 100,
    window: 'lifetime',
    billingDay: 1,
    ratePerMinute: 2,
    ratePerHour: 20,
    concurrency: 1,
    cacheTtlHours: 1,
    costPerCallMicroGbp: 0,
    planFixedMicroGbp: 0,
    excludedFromSchedule: true,
    monthlySpendCapMicroGbp: 0,
    executionMaxCalls: 0,
    executionMaxCostMicroGbp: 0,
  },
  // why: subscription: marginal cost 0, the fixed fee (£32) counted once in the global cap, the call cap is the hard stop.
  '40usd': {
    monthlyCallCap: 10_000,
    window: 'month',
    billingDay: 1,
    ratePerMinute: 10,
    ratePerHour: 2000,
    concurrency: 2,
    cacheTtlHours: 1,
    costPerCallMicroGbp: 0,
    planFixedMicroGbp: 3200 * PENCE_TO_MICRO,
    excludedFromSchedule: false,
    monthlySpendCapMicroGbp: 3500 * PENCE_TO_MICRO,
    executionMaxCalls: 2000,
    executionMaxCostMicroGbp: 0,
  },
};

/** Spec §12: Travelpayouts is free; the caps are self-imposed politeness limits. */
export const TRAVELPAYOUTS_DEFAULTS: ProviderLimits = {
  monthlyCallCap: 50_000,
  window: 'month',
  billingDay: 1,
  ratePerMinute: 200,
  ratePerHour: 10_000,
  concurrency: 4,
  cacheTtlHours: 6,
  costPerCallMicroGbp: 0,
  planFixedMicroGbp: 0,
  excludedFromSchedule: false,
};
