import {
  BudgetExceeded,
  type BudgetGuard,
  type BudgetScope,
  type Clock,
  type ExecutionBudget,
  type IsoDateTime,
  type ProviderId,
  type Reservation,
  type Usage,
} from '@gmt/core';
import type Database from 'better-sqlite3';
import { monthWindow } from './budget/window.js';
import { type BudgetConfig, effectiveCallCap, type ProviderBudget } from './budgetConfig.js';
import type { Db } from './client.js';
import { PROVIDER_IDS } from './internal/enums.js';
import { assertEndpointPath, assertInt, assertIsoDateTime, RowRejected } from './internal/validate.js';

type ReserveParams = Parameters<BudgetGuard['reserve']>[0];
type CacheHitParams = Parameters<BudgetGuard['recordCacheHit']>[0];
interface CallsAndCost {
  calls: number;
  cost: number;
}
interface Window {
  windowStart: IsoDateTime | null;
  windowEnd: IsoDateTime | null;
}

/**
 * Spec §5.3 cap predicate for one provider: billed vendors count pending/unknown or billable rows; free vendors every
 * non-cache row; a pages-only provider (camoufox) never counts a `no-page` row (pending rows, still NULL, count).
 */
export const PROVIDER_USAGE_SQL = `
SELECT COUNT(*) AS calls, COALESCE(SUM(cost_micro_gbp), 0) AS cost
FROM provider_requests
WHERE provider_id = @providerId AND outcome <> 'cache_hit'
  AND (@billed = 0 OR outcome IN ('pending', 'unknown') OR billable = 1)
  AND (@pagesOnly = 0 OR page_class IS NOT 'no-page')
  AND (@windowStart IS NULL OR (started_at >= @windowStart AND started_at < @windowEnd))`;

/** Spec §5.3 global-month: Σ cost over billed rows of billed providers in the global window (fixed fees added in TS). */
export const GLOBAL_USAGE_SQL = `
SELECT COUNT(*) AS calls, COALESCE(SUM(cost_micro_gbp), 0) AS cost
FROM provider_requests
WHERE provider_id IN (SELECT value FROM json_each(@billedProviders)) AND outcome <> 'cache_hit'
  AND (outcome IN ('pending', 'unknown') OR billable = 1)
  AND started_at >= @windowStart AND started_at < @windowEnd`;

const INSERT_PENDING_SQL = `
INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, outcome, billable, cost_micro_gbp, http_attempt, scroll_count)
VALUES (@providerId, @executionId, @endpointPath, @tileIndex, @startedAt, 'pending', NULL, @cost, @httpAttempt, @scrolls)`;
// why: spec §7 rev 34 (CB-4): a finalised row holds the scrolls the answer stated, or NULL when no answer came
const FINALISE_SQL = `
UPDATE provider_requests SET outcome = @outcome, http_status = @httpStatus, duration_ms = @durationMs, finished_at = @finishedAt, billable = @billable, page_class = @pageClass,
  scroll_count = @scrollCount,
  cost_micro_gbp = CASE WHEN @zeroCost = 1 THEN 0 ELSE cost_micro_gbp END
WHERE id = @id AND outcome = 'pending'`;
const INSERT_CACHE_HIT_SQL = `
INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms, http_status, outcome, billable, cost_micro_gbp, http_attempt)
VALUES (@providerId, @executionId, @endpointPath, @tileIndex, @at, @at, 0, NULL, 'cache_hit', 0, 0, 0)`;
const RECENT_CALLS_SQL = `SELECT COUNT(*) AS n FROM provider_requests WHERE provider_id = ? AND outcome <> 'cache_hit' AND started_at >= ?`;
/** Spec §5.3 execution scopes: rows of this execution for the given providers, billed or free rule. */
export const EXECUTION_USAGE_SQL = `
SELECT COUNT(*) AS calls, COALESCE(SUM(cost_micro_gbp), 0) AS cost
FROM provider_requests
WHERE execution_id = @executionId AND provider_id IN (SELECT value FROM json_each(@providers)) AND outcome <> 'cache_hit'
  AND (@billed = 0 OR outcome IN ('pending', 'unknown') OR billable = 1)`;

/**
 * Spec §2, §5.3 rev 32 `provider-execution`: one provider's page rows in one execution (never cache hits or `no-page`
 * rows), and its cap read from the execution's snapshot (`$.budget.providerMaxCalls.<provider>`), never from config.
 */
export const PROVIDER_EXECUTION_USAGE_SQL = `
SELECT COUNT(*) AS calls, COALESCE(SUM(cost_micro_gbp), 0) AS cost
FROM provider_requests
WHERE execution_id = @executionId AND provider_id = @providerId AND outcome <> 'cache_hit'
  AND (@pagesOnly = 0 OR page_class IS NOT 'no-page')`;
/** Spec §2 rev 34: a provider's scroll clicks in one execution, and in a window (pending rows count their plan). */
const SCROLLS_EXECUTION_SQL = `
SELECT COALESCE(SUM(scroll_count), 0) AS n FROM provider_requests WHERE provider_id = @providerId AND execution_id = @executionId`;
const SCROLLS_WINDOW_SQL = `
SELECT COALESCE(SUM(scroll_count), 0) AS n FROM provider_requests
WHERE provider_id = @providerId AND started_at >= @windowStart AND started_at < @windowEnd`;
const PROVIDER_EXECUTION_CAP_SQL = `
SELECT json_extract(definition_snapshot_json, '$.budget.providerMaxCalls.' || @providerId) AS cap
FROM search_executions WHERE id = @executionId`;

/** Plan Budget port: per-execution caps come from the snapshot budget, never from config at reserve time. */
const EXECUTION_CAPS_SQL = `
SELECT json_extract(definition_snapshot_json, '$.budget.maxCalls') AS maxCalls,
       json_extract(definition_snapshot_json, '$.budget.maxFreeCalls') AS maxFreeCalls,
       json_extract(definition_snapshot_json, '$.budget.maxCostMicroGbp') AS maxCostMicroGbp
FROM search_executions WHERE id = ?`;

/**
 * Every statement the guard runs, prepared once per guard (arch-r3-005): `reserve` sits on every upstream call's path,
 * and re-preparing four statements per call made the 937-call test brush Vitest's timeout. Task 3.2's execution
 * scopes use the last two.
 */
interface GuardStatements {
  insertPending: Database.Statement<Record<string, unknown>>;
  finalise: Database.Statement<Record<string, unknown>>;
  insertCacheHit: Database.Statement<Record<string, unknown>>;
  recentCalls: Database.Statement<[string, string], { n: number }>;
  providerUsage: Database.Statement<Record<string, unknown>, CallsAndCost>;
  globalUsage: Database.Statement<Record<string, unknown>, CallsAndCost>;
  executionUsage: Database.Statement<Record<string, unknown>, CallsAndCost>;
  executionCaps: Database.Statement<
    [string],
    { maxCalls: unknown; maxFreeCalls: unknown; maxCostMicroGbp: unknown }
  >;
  providerExecutionUsage: Database.Statement<Record<string, unknown>, CallsAndCost>;
  providerExecutionCap: Database.Statement<Record<string, unknown>, { cap: unknown }>;
  scrollsExecution: Database.Statement<Record<string, unknown>, { n: number }>;
  scrollsWindow: Database.Statement<Record<string, unknown>, { n: number }>;
}
function prepareStatements(db: Db): GuardStatements {
  return {
    insertPending: db.raw.prepare<Record<string, unknown>>(INSERT_PENDING_SQL),
    finalise: db.raw.prepare<Record<string, unknown>>(FINALISE_SQL),
    insertCacheHit: db.raw.prepare<Record<string, unknown>>(INSERT_CACHE_HIT_SQL),
    recentCalls: db.raw.prepare<[string, string], { n: number }>(RECENT_CALLS_SQL),
    providerUsage: db.raw.prepare<Record<string, unknown>, CallsAndCost>(PROVIDER_USAGE_SQL),
    globalUsage: db.raw.prepare<Record<string, unknown>, CallsAndCost>(GLOBAL_USAGE_SQL),
    executionUsage: db.raw.prepare<Record<string, unknown>, CallsAndCost>(EXECUTION_USAGE_SQL),
    executionCaps: db.raw.prepare<
      [string],
      { maxCalls: unknown; maxFreeCalls: unknown; maxCostMicroGbp: unknown }
    >(EXECUTION_CAPS_SQL),
    providerExecutionUsage: db.raw.prepare<Record<string, unknown>, CallsAndCost>(
      PROVIDER_EXECUTION_USAGE_SQL,
    ),
    providerExecutionCap: db.raw.prepare<Record<string, unknown>, { cap: unknown }>(
      PROVIDER_EXECUTION_CAP_SQL,
    ),
    scrollsExecution: db.raw.prepare<Record<string, unknown>, { n: number }>(SCROLLS_EXECUTION_SQL),
    scrollsWindow: db.raw.prepare<Record<string, unknown>, { n: number }>(SCROLLS_WINDOW_SQL),
  };
}

/**
 * The budget guard, enforced in SQL (spec §5.3). `reserve` runs every cap predicate and inserts the `pending`
 * ledger row inside one `BEGIN IMMEDIATE` transaction (`Db.immediateTransaction`), so two writers can never
 * both pass the same headroom. The billable decision happens at `finalise`.
 */
export class SqliteBudgetGuard implements BudgetGuard {
  protected readonly sql: GuardStatements;

  constructor(
    private readonly db: Db,
    private readonly config: BudgetConfig,
    private readonly clock: Clock,
  ) {
    this.sql = prepareStatements(db);
  }

  reserve(p: ReserveParams): Reservation {
    const budget = this.budgetFor(p.providerId);
    assertInt('httpAttempt', p.httpAttempt, 1);
    if (p.tileIndex !== null) assertInt('tileIndex', p.tileIndex);
    assertEndpointPath(p.endpointPath);
    // why: ruling 6 (cost-002). The configured rate is the only cost the ledger can hold, so a stale or mis-wired
    // caller cannot record 0 for a per-call plan and slip past global-month and execution-cost.
    if (p.costMicroGbp !== budget.costPerCallMicroGbp)
      throw new RowRejected(
        'cost',
        `${p.providerId} costs ${budget.costPerCallMicroGbp} µGBP per call; got ${String(p.costMicroGbp)}`,
      );
    const now = this.clock.now();
    const id = this.db.immediateTransaction(() => {
      this.checkCaps(p, budget, now);
      return Number(
        this.sql.insertPending.run({
          providerId: p.providerId,
          executionId: p.executionId,
          endpointPath: p.endpointPath,
          tileIndex: p.tileIndex,
          startedAt: now,
          cost: p.costMicroGbp,
          httpAttempt: p.httpAttempt,
          scrolls: p.scrolls ?? null,
        }).lastInsertRowid,
      );
    });
    return this.reservation(id, budget);
  }

  recordCacheHit(p: CacheHitParams): void {
    this.budgetFor(p.providerId);
    if (p.tileIndex !== null) assertInt('tileIndex', p.tileIndex);
    assertEndpointPath(p.endpointPath);
    this.sql.insertCacheHit.run({
      providerId: p.providerId,
      executionId: p.executionId,
      endpointPath: p.endpointPath,
      tileIndex: p.tileIndex,
      at: this.clock.now(),
    });
  }

  usage(scope: BudgetScope): Usage {
    const now = this.clock.now();
    if (scope.kind === 'global-month') {
      const g = this.globalUsage(now);
      return {
        calls: g.calls,
        costMicroGbp: g.cost,
        cap: this.config.spend.monthlyCapMicroGbp,
        windowUsed: true,
        windowStart: g.windowStart,
        windowEnd: g.windowEnd,
      };
    }
    if (scope.kind === 'provider-execution') {
      const budget = this.budgetFor(scope.providerId);
      const u = this.providerExecutionRows(scope.executionId, scope.providerId, budget);
      return {
        calls: u.calls,
        costMicroGbp: u.cost,
        cap: this.providerExecutionCap(scope.executionId, scope.providerId),
        windowUsed: true,
        windowStart: null,
        windowEnd: null,
      };
    }
    // why: structural narrowing (arch-r3-002); a union-typed `kind` member is not removed by `kind ===` checks.
    if ('providerId' in scope) {
      const budget = this.budgetFor(scope.providerId);
      const asked = scope.kind === 'provider-lifetime' ? 'lifetime' : 'month';
      const u = this.providerUsage(scope.providerId, budget, now, asked);
      // why: Budget port (ruling 2): an unused window is marked, so its null cap is never read as "no cap".
      const windowUsed = asked === budget.window;
      return {
        calls: u.calls,
        costMicroGbp: u.cost,
        cap: windowUsed ? effectiveCallCap(budget) : null,
        windowUsed,
        windowStart: u.windowStart,
        windowEnd: u.windowEnd,
      };
    }
    return this.executionUsage(scope.kind, scope.executionId);
  }

  /**
   * Core port (cost-r2-001): upstream attempts for one provider since `since` (inclusive), whatever their outcome or
   * billable flag, because vendor rate limits meter requests, not billed calls. Cache hits are not requests.
   */
  recentCalls(providerId: ProviderId, since: IsoDateTime): number {
    assertIsoDateTime('since', since);
    this.budgetFor(providerId); // fail closed on an unconfigured provider
    return this.sql.recentCalls.get(providerId, since)?.n ?? 0;
  }

  // why: check order is provider (the vendor's hard stop), then the provider's own per-execution cap (camoufox pages,
  // cost-010), then global (total spend), then the execution's own caps; one breach is reported and the engine's error
  // table (spec §8.1) acts on its scope.
  protected checkCaps(p: ReserveParams, budget: ProviderBudget, now: IsoDateTime): void {
    const prov = this.providerUsage(p.providerId, budget, now, budget.window);
    const callCap = effectiveCallCap(budget);
    if (prov.calls + 1 > callCap)
      throw this.exceeded(
        budget.window === 'lifetime' ? 'provider-lifetime' : 'provider-month',
        callCap,
        prov.calls,
        1,
        p.providerId,
      );
    if (p.executionId !== null) {
      const cap = this.providerExecutionCap(p.executionId, p.providerId);
      if (cap !== null) {
        const u = this.providerExecutionRows(p.executionId, p.providerId, budget);
        if (u.calls + 1 > cap) throw this.exceeded('provider-execution', cap, u.calls, 1, p.providerId);
      }
    }
    if (p.scrolls !== undefined && p.scrolls > 0) this.checkScrolls(p, p.scrolls, budget, now);
    if (budget.billable) {
      const g = this.globalUsage(now);
      const cap = this.config.spend.monthlyCapMicroGbp;
      if (p.costMicroGbp > 0 && g.cost + p.costMicroGbp > cap)
        throw this.exceeded('global-month', cap, g.cost, p.costMicroGbp, p.providerId);
    }
    if (p.executionId === null) return;
    const caps = this.executionCaps(p.executionId);
    if (budget.billable) {
      const u = this.executionRows(p.executionId, this.providersWhere(true), true);
      if (u.calls + 1 > caps.maxCalls)
        throw this.exceeded('execution-calls', caps.maxCalls, u.calls, 1, p.providerId);
      if (p.costMicroGbp > 0 && u.cost + p.costMicroGbp > caps.maxCostMicroGbp)
        throw this.exceeded('execution-cost', caps.maxCostMicroGbp, u.cost, p.costMicroGbp, p.providerId);
    } else {
      const u = this.executionRows(p.executionId, this.providersWhere(false), false);
      if (u.calls + 1 > caps.maxFreeCalls)
        throw this.exceeded('execution-free-calls', caps.maxFreeCalls, u.calls, 1, p.providerId);
    }
  }

  /**
   * Spec §2 rev 34 (ruling 12): a grid page's planned scrolls must fit what the run's and the month's scroll caps
   * leave; a breach names the provider's own scope, with the scroll cap in its message.
   */
  private checkScrolls(p: ReserveParams, planned: number, budget: ProviderBudget, now: IsoDateTime): void {
    const used = this.scrollUsage(p.providerId, p.executionId, now);
    const run = budget.executionScrollCap;
    if (p.executionId !== null && run !== undefined && used.execution + planned > run)
      throw new BudgetExceeded({
        scope: 'provider-execution',
        cap: run,
        current: used.execution,
        requested: planned,
        providerId: p.providerId,
        unit: 'scrolls',
      });
    const month = budget.monthlyScrollCap;
    if (month !== undefined && used.month + planned > month)
      throw new BudgetExceeded({
        scope: 'provider-month',
        cap: month,
        current: used.month,
        requested: planned,
        providerId: p.providerId,
        unit: 'scrolls',
      });
  }

  /** The provider's scroll clicks in the execution and in its current month window (spec §2 rev 34). */
  scrollUsage(
    providerId: ProviderId,
    executionId: string | null,
    now: IsoDateTime = this.clock.now(),
  ): { execution: number; month: number } {
    const budget = this.budgetFor(providerId);
    const w = monthWindow(this.db, now, budget.billingDay);
    return {
      execution:
        executionId === null ? 0 : (this.sql.scrollsExecution.get({ providerId, executionId })?.n ?? 0),
      month: this.sql.scrollsWindow.get({ providerId, ...w })?.n ?? 0,
    };
  }

  protected executionUsage(
    kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost',
    executionId: string,
  ): Usage {
    const caps = this.executionCaps(executionId);
    const billed = kind !== 'execution-free-calls';
    const u = this.executionRows(executionId, this.providersWhere(billed), billed);
    const cap =
      kind === 'execution-calls'
        ? caps.maxCalls
        : kind === 'execution-free-calls'
          ? caps.maxFreeCalls
          : caps.maxCostMicroGbp;
    return {
      calls: u.calls,
      costMicroGbp: u.cost,
      cap,
      windowUsed: true,
      windowStart: null,
      windowEnd: null,
    };
  }

  private executionRows(executionId: string, providers: ProviderId[], billed: boolean): CallsAndCost {
    const row = this.sql.executionUsage.get({
      executionId,
      providers: JSON.stringify(providers),
      billed: billed ? 1 : 0,
    });
    return { calls: row?.calls ?? 0, cost: row?.cost ?? 0 };
  }

  private providerExecutionRows(
    executionId: string,
    providerId: ProviderId,
    budget: ProviderBudget,
  ): CallsAndCost {
    const row = this.sql.providerExecutionUsage.get({
      executionId,
      providerId,
      pagesOnly: budget.pagesOnly === true ? 1 : 0,
    });
    return { calls: row?.calls ?? 0, cost: row?.cost ?? 0 };
  }

  /** The snapshot's own cap for this provider (decision 69, arch-007), or null when the snapshot sets none. */
  private providerExecutionCap(executionId: string, providerId: ProviderId): number | null {
    const row = this.sql.providerExecutionCap.get({ executionId, providerId });
    if (row === undefined) throw new Error(`execution ${executionId} does not exist; refusing to reserve`);
    return typeof row.cap === 'number' && Number.isInteger(row.cap) && row.cap >= 0 ? row.cap : null;
  }

  private executionCaps(executionId: string): ExecutionBudget {
    const row = this.sql.executionCaps.get(executionId);
    if (row === undefined) throw new Error(`execution ${executionId} does not exist; refusing to reserve`);
    const { maxCalls, maxFreeCalls, maxCostMicroGbp } = row;
    if (
      typeof maxCalls !== 'number' ||
      typeof maxFreeCalls !== 'number' ||
      typeof maxCostMicroGbp !== 'number'
    )
      throw new Error(`execution ${executionId} snapshot has no budget; refusing to reserve`);
    return { maxCalls, maxFreeCalls, maxCostMicroGbp };
  }

  protected providerUsage(
    providerId: ProviderId,
    budget: ProviderBudget,
    now: IsoDateTime,
    window: 'month' | 'lifetime',
  ): CallsAndCost & Window {
    const w: Window =
      window === 'lifetime'
        ? { windowStart: null, windowEnd: null }
        : monthWindow(this.db, now, budget.billingDay);
    const row = this.sql.providerUsage.get({
      providerId,
      billed: budget.billable ? 1 : 0,
      pagesOnly: budget.pagesOnly === true ? 1 : 0,
      ...w,
    });
    return { calls: row?.calls ?? 0, cost: row?.cost ?? 0, ...w };
  }

  protected globalUsage(
    now: IsoDateTime,
  ): CallsAndCost & { windowStart: IsoDateTime; windowEnd: IsoDateTime } {
    const w = monthWindow(this.db, now, this.config.spend.globalBillingDay);
    const billed = this.providersWhere(true);
    const row = this.sql.globalUsage.get({ billedProviders: JSON.stringify(billed), ...w });
    // why: spec §5.3 the subscription fee counts once per enabled subscription provider, not per row.
    const fixed = billed.reduce((sum, id) => sum + (this.config.providers[id]?.planFixedMicroGbp ?? 0), 0);
    return { calls: row?.calls ?? 0, cost: (row?.cost ?? 0) + fixed, ...w };
  }

  protected providersWhere(billable: boolean): ProviderId[] {
    return PROVIDER_IDS.filter((id) => this.config.providers[id]?.billable === billable);
  }

  protected budgetFor(providerId: ProviderId): ProviderBudget {
    const b = this.config.providers[providerId];
    if (b === undefined) throw new Error(`provider ${providerId} has no budget configuration`); // fail closed
    return b;
  }

  protected exceeded(
    scope: BudgetExceeded['scope'],
    cap: number,
    current: number,
    requested: number,
    providerId: ProviderId,
  ): BudgetExceeded {
    return new BudgetExceeded({ scope, cap, current, requested, providerId });
  }

  private reservation(id: number, budget: ProviderBudget): Reservation {
    let done = false;
    return {
      id: String(id),
      finalise: (r) => {
        if (done) throw new Error(`reservation ${id} already finalised`);
        assertInt('durationMs', r.durationMs);
        // spec §5.3 Billable rule: billable providers iff upstream HTTP 200; free providers never.
        const billable = budget.billable && r.outcome === 'ok' && r.httpStatus === 200;
        // why: an `unknown` attempt may have been billed by the vendor, so it keeps its cost and stays counted.
        const zeroCost = !billable && r.outcome !== 'unknown';
        const changes = this.sql.finalise.run({
          id,
          outcome: r.outcome,
          httpStatus: r.httpStatus ?? null,
          durationMs: r.durationMs,
          finishedAt: this.clock.now(),
          billable: billable ? 1 : 0,
          zeroCost: zeroCost ? 1 : 0,
          pageClass: r.pageClass ?? null,
          scrollCount: r.scrollCount ?? null,
        }).changes;
        if (changes !== 1) throw new Error(`reservation ${id} is no longer pending`);
        done = true;
      },
    };
  }
}
