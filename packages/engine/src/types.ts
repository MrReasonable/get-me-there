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
  LeftFor,
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
 * What the consent notice needs of the Status view's consent check: its state, why (the cause decides the subject; a
 * check that cannot be made sends nothing), its fixed summary and its fix words.
 */
export type ConsentCause = 'expiring' | 'expired' | 'missing' | 'voided' | 'cannot-check' | 'none';
export type ConsentCheck = () => Promise<{
  state: 'ok' | 'warn' | 'fail' | 'off';
  cause: ConsentCause;
  summary: string;
  fix: string | null;
}>;
/**
 * Engine options. Every cost and limit comes from `config` (ruling 3); `providerConcurrency` overrides the pool size per
 * provider and is passed only by tests.
 */
export interface EngineOptions {
  alerts?: AlertsStepHook;
  /**
   * Spec §8.3 "Consent expiry": the Status view's consent check, evaluated on the daily maintenance tick. The engine
   * knows nothing of the worker; the app passes this in. Absent means no consent notice is ever sent.
   */
  consentCheck?: ConsentCheck;
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
  /**
   * Spec §7, §8.2 rev 36: the firing a scheduled start stands for (croner's instant). The start, or the skipped_* row a
   * refusal writes, inserts through the firing unique index, so a second one for the same firing is `firing-taken`.
   */
  scheduledFor?: IsoDateTime;
  /** Spec §8.2: a run started for a missed firing (decision 79); its camoufox cells are reuse only. */
  isCatchUp?: boolean;
}
/** The confirmation a single-cell verification carries, as a manual start's (cost M-1). */
export type VerifyCellOptions = Omit<StartOptions, 'trigger'>;

/**
 * Spec §8.1 pre-start outcomes; WP8 maps them to HTTP (409, 409 needsConfirmation, 422, 404, 409). `firing-taken`
 * (spec §7 rev 36): another row already holds the scheduled firing, so this start or skip wrote nothing.
 */
export type StartResult =
  | { ok: true; executionId: string }
  | {
      ok: false;
      code:
        | 'active'
        | 'cap'
        | 'confirm'
        | 'window'
        | 'not_found'
        | 'disabled'
        | 'firing-taken'
        | 'shutting-down';
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
  /**
   * Review T12: marks the engine closed at once (nothing new starts; a job still running writes nothing more and its
   * network call is aborted), as `shutdown` does once its wait ends. The app calls it before closing the database
   * whatever happened, so a shutdown cut off by the app's deadline never leaves a job writing to a closed handle.
   */
  markClosed(): void;
  start(definitionId: string, opts: StartOptions): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  cancel(executionId: string): Promise<boolean>;
  /** Spec §8.1 single-cell verification; above SOFT_CONFIRM it needs the confirmation a start would (cost M-1). */
  verifyCell(definitionId: string, cell: CellKey, opts?: VerifyCellOptions): Promise<StartResult>;
  /** Decision 45: the cap and headroom a child of `cell` would get now, by verifyCell's own calculation. */
  childCapPreview(definitionId: string, cell: CellKey): ChildCapPreview;
  /** Review S6: who fetches the definition's left browser cells now (its scheduled and manual runs' providers). */
  browserLeftFor(definition: SearchDefinition): LeftFor;
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
