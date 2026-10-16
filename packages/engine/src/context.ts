import {
  type BudgetGuard,
  type Clock,
  type Config,
  type FlightProvider,
  type IsoDateTime,
  type Logger,
  type Notifier,
  type PointOfSale,
  type ProviderId,
  syntheticAllowed,
} from '@gmt/core';
import { budgetConfigFromConfig, type Db, type Repos } from '@gmt/db';
import type { HttpKit } from '@gmt/providers';
import { noAlerts } from './alertsStep.js';
import type { AlertsStepHook, EngineDeps, EngineOptions } from './types.js';

/** Callbacks the scheduler installs once it exists (createEngine); no-ops until then. Spec §8.1 one-shot jobs. */
export interface EngineHooks {
  scheduleResume(executionId: string, definitionId: string, at: IsoDateTime): void;
  cancelResume(executionId: string): void;
}

/**
 * What the engine needs per provider, read from the same `budgetConfigFromConfig(config)` entry the guard enforces
 * (arch-014): pool size, per-call cost, rates, window, fixed fee, schedule exclusion, and whether its calls are billed.
 */
export interface ProviderRunLimits {
  concurrency: number;
  costPerCallMicroGbp: number;
  ratePerMinute: number;
  ratePerHour: number;
  window: 'month' | 'lifetime';
  planFixedMicroGbp: number;
  excludedFromSchedule: boolean;
  billed: boolean;
}

/** What every engine module receives. Built once per engine by buildContext. */
export interface EngineContext {
  readonly deps: EngineDeps;
  readonly config: Config;
  readonly db: Db;
  readonly repos: Repos;
  readonly budget: BudgetGuard;
  readonly http: HttpKit;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifiers: readonly Notifier[];
  readonly providers: ReadonlyMap<ProviderId, FlightProvider>;
  readonly alertsStep: AlertsStepHook;
  limitsOf(id: ProviderId): ProviderRunLimits;
  /** The point of sale a provider's rows will carry, known before any call (reuse matching); written rows use the result's own pointOfSale. */
  pointOfSaleOf(id: ProviderId): PointOfSale;
  readonly hooks: EngineHooks;
}

/**
 * Builds the engine context. Fails fast when a registered provider has no budget entry: the fixture provider without
 * the synthetic gate (budgetConfigFromConfig leaves it out, spec §5.5), or a real provider whose key is not configured.
 */
export function buildContext(deps: EngineDeps, options: EngineOptions = {}): EngineContext {
  const providers = new Map<ProviderId, FlightProvider>(deps.providers.map((p) => [p.id, p]));
  const config = deps.config;
  const budgets = budgetConfigFromConfig(config);
  const limitsOf = (id: ProviderId): ProviderRunLimits => {
    const b = budgets.providers[id];
    if (b === undefined) {
      throw new Error(
        id === 'fixture' && !syntheticAllowed(config)
          ? 'the fixture provider is registered but syntheticAllowed(config) is false (spec §5.5)'
          : `no limits configured for provider ${id}`,
      );
    }
    return {
      // why: plan EngineOptions — tests pin the pool size per provider; production reads config limits
      concurrency: options.providerConcurrency?.[id] ?? b.concurrency,
      costPerCallMicroGbp: b.costPerCallMicroGbp,
      ratePerMinute: b.ratePerMinute,
      ratePerHour: b.ratePerHour,
      window: b.window,
      planFixedMicroGbp: b.planFixedMicroGbp,
      excludedFromSchedule: b.excludedFromSchedule,
      billed: b.billable,
    };
  };
  for (const id of providers.keys()) limitsOf(id); // why: a missing limit is a wiring bug; fail at construction, not mid-run
  return {
    deps,
    config,
    db: deps.db,
    repos: deps.repos,
    budget: deps.budget,
    http: deps.http,
    clock: deps.clock,
    log: deps.log,
    notifiers: deps.notifiers,
    providers,
    limitsOf,
    alertsStep: options.alerts ?? noAlerts,
    // why: spec §2/§5.2 — SearchApi echoes gl = POINT_OF_SALE; Travelpayouts and the fixture state none. A deliberate
    // engine rule known before any call (reuse matching); reuse.test.ts pins it against the fixture's echo, and WP5's
    // adapter test pins SearchApi's echo (arch-r2-013)
    pointOfSaleOf: (id) => (id === 'searchapi' ? config.pointOfSale : 'unknown'),
    hooks: { scheduleResume: () => undefined, cancelResume: () => undefined },
  };
}
