/** Budget usage in the api-contract shape (spec §7 budget windows, §10). */
import {
  type apiContract,
  type BudgetScope,
  budgetScopeLabel,
  type Config,
  microGbpToPence,
  type ProviderId,
} from '@gmt/core';
import { type BudgetConfig, budgetConfigFromConfig } from '@gmt/db';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';

export type ApiUsage = z.infer<typeof apiContract.usageSchema>;

/**
 * The guard's own entry for a provider: db's `budgetConfigFromConfig`, the one derivation the guard enforces and the
 * engine's `limitsOf` reads (review arch Important), so the form's confirmation, the providers view and the budget view
 * can never diverge from a start. A registered provider without an entry is a wiring bug: the engine refuses to build.
 * why: the entry type is reached through `BudgetConfig`, since db keeps `ProviderBudget` itself out of its barrel.
 */
export function providerBudget(
  config: Config,
  id: ProviderId,
): NonNullable<BudgetConfig['providers'][ProviderId]> {
  const b = budgetConfigFromConfig(config).providers[id];
  if (b === undefined) throw new Error(`no budget entry for provider ${id}`);
  return b;
}

/**
 * The one provider window the plan uses (ruling 2, decision 67): the month on a monthly plan, the lifetime on the
 * trial. The unused window is omitted rather than sent with `cap: null`, so a null cap on the wire only ever means
 * "no cap configured" and no view can print "no cap" for a window the plan never had.
 */
export function providerScopes(config: Config, providerId: ProviderId): BudgetScope[] {
  const kind =
    providerBudget(config, providerId).window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
  return [{ kind, providerId }];
}

/**
 * Ruling 5 (decision 67): a zero spend cap stops a provider only when its calls cost money. The guard passes zero-cost
 * calls under any spend cap (spec §5.3), so on the trial and the $40 plan verification does run, bounded by the call cap.
 */
export function zeroCapBlocks(config: Config, id: ProviderId): boolean {
  const b = providerBudget(config, id);
  return b.billable && b.costPerCallMicroGbp > 0 && config.spend.monthlyCapMicroGbp === 0;
}

export type PlanName = 'trial' | '40usd' | 'free' | 'synthetic';

/** The plan a provider runs under, in the providers contract's words (spec §10, §12). */
export function planOf(config: Config, id: ProviderId): PlanName {
  if (id === 'searchapi') return config.providers.searchapi?.plan ?? 'trial';
  return id === 'fixture' ? 'synthetic' : 'free';
}

/** Every scope of the spec §8.1 pre-start check: execution scopes (when given), each provider, global. */
export function budgetScopes(
  ports: Pick<Ports, 'providers' | 'config'>,
  executionId: string | null,
): BudgetScope[] {
  const execution: BudgetScope[] =
    executionId === null
      ? []
      : [
          { kind: 'execution-calls', executionId },
          { kind: 'execution-free-calls', executionId },
          { kind: 'execution-cost', executionId },
          // WP14: a provider's own page cap for this execution (camoufox), read from the snapshot by the guard.
          ...ports.providers
            .filter((p) => providerBudget(ports.config, p.id).executionCallCap !== undefined)
            .map((p): BudgetScope => ({ kind: 'provider-execution', executionId, providerId: p.id })),
        ];
  return [
    ...execution,
    ...ports.providers.flatMap((p) => providerScopes(ports.config, p.id)),
    { kind: 'global-month' },
  ];
}

/** The api-contract `Usage`: the guard's usage plus its scope label and pence (core's rounding: spend is never understated). */
export function usageOf(ports: Ports, scope: BudgetScope): ApiUsage {
  const u = ports.budget.usage(scope);
  return {
    scope: budgetScopeLabel(scope),
    calls: u.calls,
    costMicroGbp: u.costMicroGbp,
    costPence: microGbpToPence(u.costMicroGbp),
    cap: u.cap,
    windowStart: u.windowStart,
    windowEnd: u.windowEnd,
  };
}
