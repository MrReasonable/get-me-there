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
  /** Removes a definition's cron job; called when the engine itself disables a schedule (spec §6.1 zero-cell window). */
  unregisterSchedule(definitionId: string): void;
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
  /** The cap scope this provider's calls count against, derived from `window` once (code-architect review 8). */
  capKind: 'provider-month' | 'provider-lifetime';
  planFixedMicroGbp: number;
  excludedFromSchedule: boolean;
  billed: boolean;
  /**
   * The provider's own per-execution call cap (camoufox's CAMOUFOX_EXECUTION_PAGE_CAP, decision 69), frozen into each
   * new execution's snapshot as `budget.providerMaxCalls`; null when the provider has none.
   */
  executionCallCap: number | null;
  /** The provider's own fixed spacing between call starts in seconds (camoufox), or null. */
  minSpacingSeconds: number | null;
  /** The calls the provider may make in its cap window (CAMOUFOX_MONTHLY_PAGE_CAP for camoufox). */
  monthlyCallCap: number;
}

/**
 * The cap scope a provider's calls count against, from its plan window (spec §5.3): the one mapping the engine and the
 * api share (plan decision 58).
 */
export function capKindOf(window: 'month' | 'lifetime'): 'provider-month' | 'provider-lifetime' {
  return window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
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
      capKind: capKindOf(b.window),
      planFixedMicroGbp: b.planFixedMicroGbp,
      excludedFromSchedule: b.excludedFromSchedule,
      billed: b.billable,
      executionCallCap: b.executionCallCap ?? null,
      minSpacingSeconds: b.minSpacingSeconds ?? null,
      monthlyCallCap: b.monthlyCallCap,
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
    hooks: {
      scheduleResume: () => undefined,
      cancelResume: () => undefined,
      unregisterSchedule: () => undefined,
    },
  };
}
