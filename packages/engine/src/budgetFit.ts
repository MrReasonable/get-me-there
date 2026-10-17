import type { DefinitionSnapshot, ProviderId, SearchDefinition } from '@gmt/core';
import type { EngineContext } from './context.js';
import { estimateStart } from './estimate.js';
import { runsPerMonth } from './scheduler/parseCron.js';
import { buildSnapshot } from './snapshot.js';
import { REUSE_TOLERANCE, refreshHoursOf } from './stages/reuse.js';
import type { BudgetFit, Estimate } from './types.js';

// Spec §8.2 schedule load and budgetFit: what scheduled runs need of the shared caps over a month or the rest of a cap
// window, worst case without reuse. Split from estimate.ts (code-architect review 7); budgetCheck reserves with it.

/** Hours in an average month (365 × 24 / 12), for discovery refreshes per month. */
const HOURS_PER_MONTH = 730;

/** One scheduled definition's monthly load per provider: calls and billed cost. */
export interface MonthlyLoad {
  runsPerMonth: number;
  perRun: Estimate;
  /** The schedule's snapshot, as a scheduled run would freeze it now (its providers and refresh hours). */
  snapshot: DefinitionSnapshot;
  perProvider: Map<ProviderId, { calls: number; costMicroGbp: number }>;
}

/**
 * Spec §8.2 load of `firings` scheduled runs spread over `hours`, without reuse (po-004): verification runs on every
 * firing; discovery at most once per refresh (reuse iff age < 0.9 × refresh), so a daily cron with a weekly refresh
 * pays weekly discovery (cost-r1-003): discovery runs = min(firings, hours / (0.9 × refresh hours)). The one model
 * budgetFit (a month) and the pre-start reservation (the rest of a cap window) share (cost-r2-002).
 */
export function scheduleLoad(
  ctx: EngineContext,
  perRun: Estimate,
  snapshot: DefinitionSnapshot,
  firings: number,
  hours: number,
): Map<ProviderId, { calls: number; costMicroGbp: number }> {
  const load = new Map<ProviderId, { calls: number; costMicroGbp: number }>();
  for (const p of perRun.perProvider) {
    const factor =
      p.stage === 'discovery'
        ? Math.min(firings, hours / (REUSE_TOLERANCE * refreshHoursOf(snapshot, p.providerId)))
        : firings;
    const acc = load.get(p.providerId) ?? { calls: 0, costMicroGbp: 0 };
    load.set(p.providerId, {
      calls: acc.calls + p.calls * factor,
      costMicroGbp: acc.costMicroGbp + (ctx.limitsOf(p.providerId).billed ? p.costMicroGbp * factor : 0),
    });
  }
  return load;
}

/** Spec §8.2 monthly load of a schedule: scheduleLoad over runsPerMonth firings in an average month (730 h). */
export function monthlyLoad(ctx: EngineContext, def: SearchDefinition): MonthlyLoad {
  const built = buildSnapshot(ctx, def, 'schedule');
  const perRun = estimateStart(ctx, built.snapshot, built.cells, null);
  const runs = runsPerMonth(def.scheduleCron, def.scheduleTz, new Date(ctx.clock.now()));
  return {
    runsPerMonth: runs,
    perRun,
    snapshot: built.snapshot,
    perProvider: scheduleLoad(ctx, perRun, built.snapshot, runs, HOURS_PER_MONTH),
  };
}

/** The other enabled, scheduled, live definitions (ruling 5: they share the provider-month and global caps). */
export function otherSchedules(ctx: EngineContext, definitionId: string | null): SearchDefinition[] {
  return ctx.repos.definitions
    .list()
    .filter((d) => d.id !== definitionId && d.enabled && d.deletedAt === null && d.scheduleCron !== null);
}

/**
 * Spec §8.2 "budgetFit at save time compares runsPerMonth × estimate with every cap and warns", worst case without
 * reuse (po-004). Execution scopes compare one run with the definition's budget. Monthly scopes add the monthly load
 * of every other enabled scheduled definition, because they share the caps (ruling 5: the API refuses enabling or
 * changing a schedule whose provider-month scope does not fit); global adds each billed provider's fixed fee once
 * (spec §5.3). `definitionId` is null for an unsaved definition.
 */
export function budgetFitFor(
  ctx: EngineContext,
  def: SearchDefinition,
  definitionId: string | null,
): BudgetFit {
  const own = monthlyLoad(ctx, def);
  const others = otherSchedules(ctx, definitionId).map((d) => monthlyLoad(ctx, d));
  const billed = own.perRun.perProvider.filter((p) => ctx.limitsOf(p.providerId).billed);
  const free = own.perRun.perProvider.filter((p) => !ctx.limitsOf(p.providerId).billed);
  const sum = (xs: Estimate['perProvider'], f: (p: Estimate['perProvider'][number]) => number) =>
    xs.reduce((a, p) => a + f(p), 0);
  const perScope: BudgetFit['perScope'] = [];
  const scope = (name: string, estimated: number, cap: number | null) => {
    const e = Math.ceil(estimated);
    perScope.push({ scope: name, estimated: e, cap, fits: cap === null || e <= cap });
  };
  scope(
    'execution-calls',
    sum(billed, (p) => p.calls),
    def.budget.maxCalls,
  );
  scope(
    'execution-free-calls',
    sum(free, (p) => p.calls),
    def.budget.maxFreeCalls,
  );
  scope(
    'execution-cost',
    sum(billed, (p) => p.costMicroGbp),
    def.budget.maxCostMicroGbp,
  );
  const ids = new Set([...own.perProvider.keys(), ...others.flatMap((o) => [...o.perProvider.keys()])]);
  for (const id of ids) {
    const kind = ctx.limitsOf(id).capKind;
    const calls = [own, ...others].reduce((a, l) => a + (l.perProvider.get(id)?.calls ?? 0), 0);
    scope(`${kind}:${id}`, calls, ctx.budget.usage({ kind, providerId: id }).cap);
  }
  const fixed = [...ctx.providers.keys()]
    .filter((id) => ctx.limitsOf(id).billed)
    .reduce((a, id) => a + ctx.limitsOf(id).planFixedMicroGbp, 0);
  const cost = [own, ...others].reduce(
    (a, l) => a + [...l.perProvider.values()].reduce((b, v) => b + v.costMicroGbp, 0),
    0,
  );
  scope('global-month', fixed + cost, ctx.config.spend.monthlyCapMicroGbp);
  return { fits: perScope.every((x) => x.fits), runsPerMonth: own.runsPerMonth, perScope };
}
