import {
  type BudgetGuard,
  type Clock,
  type Config,
  type FlightProvider,
  flightRequestSeconds,
  type IsoDateTime,
  type Logger,
  listRequestSeconds,
  type Notifier,
  type PointOfSale,
  type ProviderId,
  syntheticAllowed,
} from '@gmt/core';
import { budgetConfigFromConfig, type Db, type Repos } from '@gmt/db';
import type { HttpKit } from '@gmt/providers';
import { noAlerts } from './alertsStep.js';
import { type BrowserLease, createBrowserLease } from './browserLease.js';
import { createHeartbeat, type Heartbeat } from './scheduler/heartbeat.js';
import type {
  AlertsStepHook,
  ConsentCheck,
  EngineDeps,
  EngineOptions,
  RankedDatePairsReader,
} from './types.js';

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
  /** Spec §2 rev 34: camoufox grid's scroll caps (a run's and its month's), or null for a provider without them. */
  executionScrollCap: number | null;
  monthlyScrollCap: number | null;
  /**
   * Spec rev 56 §8.1, §8.2 (arch-r3-006; ruling P19): camoufox's flights request seconds, core's `flightRequestSeconds`
   * over the shared page timeout and spacing: with a return phase and the booking read (780 s at the defaults), with a
   * return phase only (600 s), and an outbound-only request's, core's `listRequestSeconds` (two page timeouts + 30 s,
   * 210 s; final review A-I1). The step's gate holds a request to its own; null for every other provider.
   */
  flightRequestSeconds: { booking: number; returnsOnly: number; outboundOnly: number } | null;
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
  /** Spec §8.3 consent expiry: the app's consent check, or undefined when the app passes none. */
  readonly consentCheck: ConsentCheck | undefined;
  limitsOf(id: ProviderId): ProviderRunLimits;
  /** The point of sale a provider's rows will carry, known before any call (reuse matching); written rows use the result's own pointOfSale. */
  pointOfSaleOf(id: ProviderId): PointOfSale;
  readonly hooks: EngineHooks;
  /**
   * Decision 83: the engine's one heartbeat (scheduler module), started by the boot beside the minute job. Discovery asks
   * it before each browser page; the orchestrator marks its runs when it detects a suspension.
   */
  readonly heartbeat: Heartbeat;
  /**
   * Shared by every copy of the context (a spread keeps the same object). `closing` is set once shutdown begins, so a
   * start, resume or verification asked for after it is refused and the minute job takes no further definition;
   * `closed` once the engine has handed the database back (review S2): a scheduler job still running past the
   * shutdown's bound then writes nothing more (notifyOperator logs the notice it sent and skips its row), and `abort`
   * (aborted at the same moment) ends a system job's network call.
   */
  readonly lifecycle: { closing: boolean; closed: boolean; readonly abort: AbortController };
  /**
   * Spec revision 55 §8.1: the browser worker's one in-flight slot, held by the on-demand flight read; every browser
   * page of a pass awaits it. Shared by every copy of the context (one per engine).
   */
  readonly lease: BrowserLease;
  /** Spec revision 55 §8.1: the board's ranking (EngineOptions.rankedDatePairs), or undefined when the app passes none. */
  readonly rankedDatePairs: RankedDatePairsReader | undefined;
  /**
   * Spec rev 56 §8.1 "The plan": each provider's last reported verification flags, in memory, set by the discovery
   * preflight, the on-demand read's preflight and the api's Status read (there is no boot read, so before the first of
   * them `get` is null and every plan is outbound-only). Shared by every copy of the context (one per engine).
   */
  readonly workerFlags: WorkerFlags;
}

/** The workers' reported flags (spec rev 56 §8.1), one entry per provider, the last read kept. */
export interface WorkerFlags {
  get(providerId: ProviderId): Readonly<Record<string, boolean>> | null;
  set(providerId: ProviderId, flags: Readonly<Record<string, boolean>>): void;
}

/** The engine's one store of the workers' flags (spec rev 56 §8.1): a copy of each set is kept, so a caller's later edit is not. */
export function createWorkerFlags(): WorkerFlags {
  const flags = new Map<ProviderId, Readonly<Record<string, boolean>>>();
  return {
    get: (id) => flags.get(id) ?? null,
    set: (id, f) => {
      flags.set(id, Object.freeze({ ...f }));
    },
  };
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
      executionScrollCap: b.executionScrollCap ?? null,
      monthlyScrollCap: b.monthlyScrollCap ?? null,
      flightRequestSeconds: id === 'camoufox' ? camoufoxRequestSeconds(config) : null,
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
    consentCheck: options.consentCheck,
    // why: spec §2/§5.2 — SearchApi echoes gl = POINT_OF_SALE, and the camoufox worker loads its pages with the same
    // gl (POINT_OF_SALE is a shared worker setting the preflight compares) and states it on every answer; Travelpayouts
    // and the fixture state none. A deliberate engine rule known before any call (reuse matching; WP16a: a catch-up
    // copies camoufox's fresh outcomes, decision 79); reuse.test.ts pins it against the fixture's echo, and WP5's
    // adapter test pins SearchApi's echo (arch-r2-013)
    pointOfSaleOf: (id) => (id === 'searchapi' || id === 'camoufox' ? config.pointOfSale : 'unknown'),
    hooks: {
      scheduleResume: () => undefined,
      cancelResume: () => undefined,
      unregisterSchedule: () => undefined,
    },
    // why: the heartbeat reads the Clock port, as the window check it feeds does, so one decision never mixes clocks
    heartbeat: createHeartbeat(deps.log, () => Date.parse(deps.clock.now())),
    lifecycle: { closing: false, closed: false, abort: new AbortController() },
    lease: createBrowserLease(),
    rankedDatePairs: options.rankedDatePairs,
    workerFlags: createWorkerFlags(),
  };
}

/** The list page's request timeout over its page timeout (spec §12: the read-back and close bounds). */
/**
 * Spec rev 56 §8.1, §12: camoufox's flights request seconds from the shared settings, core's one computation (the
 * provider's own copy is the wiring's, from the same function and the same settings: A24); null when it is not
 * configured.
 */
function camoufoxRequestSeconds(config: Config): ProviderRunLimits['flightRequestSeconds'] {
  const cf = config.providers.camoufox;
  if (cf === null) return null;
  return {
    booking: flightRequestSeconds(cf.pageTimeoutSeconds, cf.minSpacingSeconds, true),
    returnsOnly: flightRequestSeconds(cf.pageTimeoutSeconds, cf.minSpacingSeconds, false),
    outboundOnly: listRequestSeconds(cf.pageTimeoutSeconds),
  };
}
