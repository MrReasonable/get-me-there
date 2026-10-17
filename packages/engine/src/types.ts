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
/**
 * How the pass that runs the alerts step ended (decision 59): `completed`, or stopped by a budget cap (`budget`, the
 * paused_budget stop of decision 25). The alert runner says "a budget cap left … undone" only for the latter.
 */
export interface AlertsPass {
  stop: 'completed' | 'budget';
}
/** The alerts step of spec §8.1 ("alerts: evaluateAlertRules → persist events → notify digests"); WP11 provides runAlerts. */
export type AlertsStepHook = (
  deps: EngineDeps,
  executionId: string,
  pass: AlertsPass,
) => Promise<{ digests: number; events: number }>;
/**
 * Engine options. Every cost and limit comes from `config` (ruling 3); `providerConcurrency` overrides the pool size per
 * provider and is passed only by tests.
 */
export interface EngineOptions {
  alerts?: AlertsStepHook;
  providerConcurrency?: Partial<Record<ProviderId, number>>;
}

/**
 * The options of a start (spec §8.1): who started it and, for a manual start, the confirmation it carries, pence and
 * calls together (decision 37).
 */
export interface StartOptions {
  trigger: 'manual' | 'schedule';
  confirmCostPence?: number;
  confirmCalls?: number;
}
/** The confirmation a single-cell verification carries, as a manual start's (cost M-1). */
export type VerifyCellOptions = Omit<StartOptions, 'trigger'>;

/** Spec §8.1 pre-start outcomes; WP8 maps them to HTTP (409, 409 needsConfirmation, 422, 404, 409). */
export type StartResult =
  | { ok: true; executionId: string }
  | {
      ok: false;
      code: 'active' | 'cap' | 'confirm' | 'window' | 'not_found' | 'disabled';
      message: string;
      details: unknown;
    };

/**
 * Decision 42/45: the cap and headroom of the next child of a cell, or why it has no verify button, with StartResult's
 * codes (code-architect review 16).
 */
export type ChildCapPreview =
  /** needCalls (N2): the cap one search of this cell would take with headroom to spare, max(CHILD_MAX_CALLS, need). */
  | { ok: true; maxCalls: number; headroomCalls: number; needCalls: number }
  | { ok: false; code: 'not_found' | 'window'; message: string };

/** The plan's "Engine" contract. */
export interface Engine {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  start(definitionId: string, opts: StartOptions): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  cancel(executionId: string): Promise<boolean>;
  /** Spec §8.1 single-cell verification; above SOFT_CONFIRM it needs the confirmation a start would (cost M-1). */
  verifyCell(definitionId: string, cell: CellKey, opts?: VerifyCellOptions): Promise<StartResult>;
  /** Decision 45: the cap and headroom a child of `cell` would get now, by verifyCell's own calculation. */
  childCapPreview(definitionId: string, cell: CellKey): ChildCapPreview;
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
