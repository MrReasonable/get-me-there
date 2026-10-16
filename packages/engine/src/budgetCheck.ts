import type { BudgetScopeKind, ExecutionBudget, ProviderId, Stage } from '@gmt/core';
import type { EngineContext } from './context.js';
import { monthlyLoad, otherSchedules, scheduleLoad } from './estimate.js';
import { type LineKey, lineKey } from './lines.js';
import { firingsBetween } from './scheduler/parseCron.js';
import { breachText } from './text.js';
import type { Estimate } from './types.js';

export interface PlannedSpend {
  providerId: ProviderId;
  stage: Stage;
  calls: number;
  costMicroGbp: number;
}
/** One scope a planned run would breach; `reserved` is what other scheduled runs hold in this window (ruling 5). */
export interface Breach {
  scope: BudgetScopeKind;
  providerId: ProviderId | null;
  cap: number;
  current: number;
  reserved: number;
  estimated: number;
}
/**
 * The (stage, provider) lines a run may not call (ruling 2); `blockedBy` names the first scope that blocked each line
 * (Estimate.perProvider[].blocked).
 */
export interface BudgetCheck {
  blocked: Set<LineKey>;
  blockedBy: Map<LineKey, string>;
  breaches: Breach[];
}

export function spendOf(e: Pick<Estimate, 'perProvider'>): PlannedSpend[] {
  return e.perProvider.map((p) => ({
    providerId: p.providerId,
    stage: p.stage,
    calls: p.calls,
    costMicroGbp: p.costMicroGbp,
  }));
}

/**
 * Ruling 5: the calls the other enabled scheduled definitions will need from `providerId` before the cap window
 * closes, so one run cannot take the headroom the schedules were sized against. Each schedule's need is budgetFit's
 * model over the rest of the window (scheduleLoad, cost-r2-002): verification on each firing until `windowEnd`,
 * discovery at most once per reuse window; rounded up to whole calls.
 */
export function reservedForSchedules(
  ctx: EngineContext,
  providerId: ProviderId,
  definitionId: string | null,
  windowEnd: string | null,
): number {
  if (windowEnd === null) return 0;
  const now = ctx.clock.now();
  const hours = (Date.parse(windowEnd) - Date.parse(now)) / 3_600_000;
  let reserved = 0;
  for (const d of otherSchedules(ctx, definitionId)) {
    if (d.scheduleCron === null) continue;
    const firings = firingsBetween(
      d.scheduleCron,
      d.scheduleTz,
      new Date(now),
      new Date(Date.parse(windowEnd) - 1),
    ).length;
    if (firings === 0) continue;
    const m = monthlyLoad(ctx, d);
    reserved += scheduleLoad(ctx, m.perRun, m.snapshot, firings, hours).get(providerId)?.calls ?? 0;
  }
  return Math.ceil(reserved);
}

/**
 * Spec §8.1 pre-start: for every scope, usage(scope) + estimate(scope) ≤ cap. Blocking is per (stage, provider) line,
 * and a line that needs no call (every cell reused, or a cabin the provider does not sell) is never blocked (ruling 2):
 * a breach on a billed scope (execution-calls, execution-cost, global-month) blocks every billed line that needs calls;
 * a breach on execution-free-calls the free ones; a provider-month/lifetime breach that provider's lines. A cap of 0 refuses any non-zero
 * need; zero-cost needs pass (spec §5.3). With `executionId` the execution scopes include what this execution already
 * spent (resume). Provider-month scopes count the headroom other scheduled runs hold in this window (ruling 5).
 */
export function checkBudget(
  ctx: EngineContext,
  spend: readonly PlannedSpend[],
  budget: ExecutionBudget,
  executionId: string | null,
  definitionId: string | null,
): BudgetCheck {
  const blocked = new Set<LineKey>();
  const blockedBy = new Map<LineKey, string>();
  const breaches: Breach[] = [];
  const billed = spend.filter((s) => ctx.limitsOf(s.providerId).billed);
  const free = spend.filter((s) => !ctx.limitsOf(s.providerId).billed);
  const ids = (xs: readonly PlannedSpend[]) => [...new Set(xs.map((s) => s.providerId))];
  const total = (xs: readonly PlannedSpend[], f: (s: PlannedSpend) => number) =>
    xs.reduce((a, s) => a + f(s), 0);
  const check = (
    scope: BudgetScopeKind,
    providerId: ProviderId | null,
    cap: number | null,
    current: number,
    reserved: number,
    estimated: number,
    affected: readonly PlannedSpend[],
  ) => {
    if (cap === null || estimated === 0) return;
    if (current + reserved + estimated <= cap) return;
    breaches.push({ scope, providerId, cap, current, reserved, estimated });
    for (const s of affected) {
      if (s.calls === 0) continue; // why: ruling 2 — a line that makes no call never spends, so it is never blocked
      const key = lineKey(s.stage, s.providerId);
      blocked.add(key);
      if (!blockedBy.has(key)) blockedBy.set(key, scope);
    }
  };
  const execUsage = (kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost') =>
    executionId === null ? { calls: 0, costMicroGbp: 0 } : ctx.budget.usage({ kind, executionId });
  check(
    'execution-calls',
    null,
    budget.maxCalls,
    execUsage('execution-calls').calls,
    0,
    total(billed, (s) => s.calls),
    billed,
  );
  check(
    'execution-free-calls',
    null,
    budget.maxFreeCalls,
    execUsage('execution-free-calls').calls,
    0,
    total(free, (s) => s.calls),
    free,
  );
  check(
    'execution-cost',
    null,
    budget.maxCostMicroGbp,
    execUsage('execution-cost').costMicroGbp,
    0,
    total(billed, (s) => s.costMicroGbp),
    billed,
  );
  for (const id of ids(spend)) {
    const kind = ctx.limitsOf(id).window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
    const u = ctx.budget.usage({ kind, providerId: id });
    const reserved = kind === 'provider-month' ? reservedForSchedules(ctx, id, definitionId, u.windowEnd) : 0;
    const lines = spend.filter((s) => s.providerId === id);
    check(
      kind,
      id,
      u.cap,
      u.calls,
      reserved,
      total(lines, (s) => s.calls),
      lines,
    );
  }
  const g = ctx.budget.usage({ kind: 'global-month' });
  check(
    'global-month',
    null,
    g.cap,
    g.costMicroGbp,
    0,
    total(billed, (s) => s.costMicroGbp),
    billed,
  );
  return { blocked, blockedBy, breaches };
}

/** The 409 message: every breached cap in plain English with its figures and units (spec §8.1, arch-018). */
export function breachMessage(breaches: readonly Breach[]): string {
  return breaches
    .map((b) => {
      const reserved =
        b.reserved > 0 ? ` (${b.reserved} more reserved for other scheduled runs this window)` : '';
      return `${breachText(b.scope, b.providerId, b.cap, b.current, b.estimated, 'this run needs')}${reserved}`;
    })
    .join('; ');
}
