import type {
  BudgetFit,
  BudgetGuard,
  CellKey,
  Clock,
  Config,
  CoverageCheckRequest,
  CoverageCheckResponse,
  DefinitionInput,
  Estimate,
  FlightProvider,
  IsoDate,
  IsoDateTime,
  Logger,
  Notifier,
  ProviderId,
  ResponseCache,
  SchedulerJob,
  SearchDefinition,
} from '@gmt/core';
import type { Db, Repos } from '@gmt/db';
import type { HttpKit } from '@gmt/providers';

// why: core already exports these five as types (plan decisions 16 and 17); the engine re-exports core's, never its own copies
export type {
  BudgetFit,
  CoverageCheckRequest,
  CoverageCheckResponse,
  Estimate,
  SchedulerJob,
} from '@gmt/core';

/** Ports the engine is built on; constructed by the api bootstraps (WP4b/WP8) or the layer-A harness. Plan contract "Engine". */
export interface EngineDeps {
  config: Config;
  db: Db;
  repos: Repos;
  budget: BudgetGuard;
  cache: ResponseCache;
  http: HttpKit;
  providers: FlightProvider[];
  notifiers: Notifier[];
  clock: Clock;
  log: Logger;
}
/** The alerts step of spec §8.1 ("alerts: evaluateAlertRules → persist events → notify digests"); WP11 provides runAlerts. */
export type AlertsStepHook = (
  deps: EngineDeps,
  executionId: string,
) => Promise<{ digests: number; events: number }>;
/**
 * Engine options. Every cost and limit comes from `config` (ruling 3); `providerConcurrency` overrides the pool size per
 * provider and is passed only by tests.
 */
export interface EngineOptions {
  alerts?: AlertsStepHook;
  providerConcurrency?: Partial<Record<ProviderId, number>>;
}

/** Spec §8.1 pre-start outcomes; WP8 maps them to HTTP (409, 409 needsConfirmation, 422, 404, 409). */
/** The options of a start (spec §8.1): who started it and, for a manual start, the confirmation it carries. */
export interface StartOptions {
  trigger: 'manual' | 'schedule';
  confirmCostPence?: number;
}
export type StartResult =
  | { ok: true; executionId: string }
  | {
      ok: false;
      code: 'active' | 'cap' | 'confirm' | 'window' | 'not_found' | 'disabled';
      message: string;
      details: unknown;
    };

/** The plan's "Engine" contract. */
export interface Engine {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  start(definitionId: string, opts: StartOptions): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  cancel(executionId: string): Promise<boolean>;
  verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;
  estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate;
  estimateRemaining(executionId: string): Estimate;
  budgetFit(definition: DefinitionInput | SearchDefinition): BudgetFit;
  coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>;
  scheduler: {
    register(def: SearchDefinition): void;
    unregister(definitionId: string): void;
    jobs(): SchedulerJob[];
    tick(definitionId: string): Promise<void>;
    blockedSince(): IsoDateTime | null;
  };
  status(): {
    running: string[];
    degraded: boolean;
    nextRun: IsoDateTime | null;
    lastExecutionAt: IsoDateTime | null;
  };
}
