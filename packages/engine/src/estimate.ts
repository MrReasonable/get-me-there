import {
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  microGbpToPence,
  type ProviderId,
  type SearchDefinition,
  type SourceKind,
  type Stage,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { runsPerMonth } from './scheduler/parseCron.js';
import { buildSnapshot } from './snapshot.js';
import { planTiles } from './stages/discovery.js';
import { REUSE_TOLERANCE, refreshHoursOf, reusableFor, reuseCriteriaFor } from './stages/reuse.js';
import { itineraryQuery } from './stages/verification.js';
import type { BudgetFit, Estimate } from './types.js';

/** Typical wall time per call by source kind (spec §2: SearchApi calendar 9–29 s; Travelpayouts about 1 s; the fixture is local). */
export const SECONDS_PER_CALL: Readonly<Record<SourceKind, number>> = {
  'authorised-cached': 1,
  'scraped-aggregate': 20,
  'scraped-search': 15,
  synthetic: 0,
};
/** Hours in an average month (365 × 24 / 12), for discovery refreshes per month. */
const HOURS_PER_MONTH = 730;

interface Line {
  providerId: ProviderId;
  stage: Stage;
  rawCalls: number;
  rawCostMicroGbp: number;
  rawSeconds: number;
}

function assemble(
  ctx: EngineContext,
  lines: readonly Line[],
  cells: number,
  windowClamped: boolean,
  assumptions: readonly string[],
): Estimate {
  const f = ctx.config.estimateRetryFactor;
  const perProvider = lines.map((l) => {
    const costMicroGbp = Math.ceil(l.rawCostMicroGbp * f);
    return {
      providerId: l.providerId,
      stage: l.stage,
      calls: Math.ceil(l.rawCalls * f),
      planCalls: l.rawCalls,
      costMicroGbp,
      costPence: microGbpToPence(costMicroGbp),
      seconds: Math.ceil(l.rawSeconds * f),
      blocked: null,
    };
  });
  const totalCostMicroGbp = perProvider.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    cells,
    perProvider,
    totalCalls: perProvider.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: perProvider.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: microGbpToPence(totalCostMicroGbp),
    seconds: perProvider.reduce((a, p) => a + p.seconds, 0),
    assumptions: [`every call count includes the retry factor ${f}`, ...assumptions],
    windowClamped,
    retryFactor: f,
  };
}

/**
 * Spec §8.1 "seconds including limiter waits": the slowest of the minute window, the hour window and the pool
 * (cost-r1-011); the hour window is named in the assumptions when it binds.
 */
function waitSeconds(
  ctx: EngineContext,
  providerId: ProviderId,
  calls: number,
  secondsPerCall: number,
  notes: string[],
): number {
  const l = ctx.limitsOf(providerId);
  const minute = Math.ceil((calls * 60) / l.ratePerMinute);
  const hour = calls > l.ratePerHour ? Math.floor((calls - 1) / l.ratePerHour) * 3600 : 0;
  const pool = Math.ceil((calls * secondsPerCall) / l.concurrency);
  if (hour > Math.max(minute, pool))
    notes.push(
      `${providerId}: ${calls} calls exceed its ${l.ratePerHour} an hour, so the hourly window sets the time`,
    );
  return Math.max(minute, hour, pool);
}

function discoveryLine(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cells: readonly CellKey[],
  definitionId: string | null,
  notes: string[],
): Line | null {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.discovery;
  if (provider === undefined || cap === undefined) return null;
  if (!provider.cabins.includes(snapshot.cabin)) {
    notes.push(`${providerId}: does not offer ${snapshot.cabin}; no calls (cabin-not-offered)`);
    return { providerId, stage: 'discovery', rawCalls: 0, rawCostMicroGbp: 0, rawSeconds: 0 };
  }
  const reused =
    definitionId === null
      ? []
      : reusableFor(
          ctx,
          definitionId,
          snapshot,
          providerId,
          reuseCriteriaFor(ctx, snapshot, providerId, cap.info),
          cells,
        );
  if (reused.length > 0)
    notes.push(`${providerId}: ${reused.length} cells reuse earlier prices and are not planned`);
  const reusedKeys = new Set(reused.map((r) => cellKeyString(r.cell)));
  const fresh = cells.filter((c) => !reusedKeys.has(cellKeyString(c)));
  const tiles = fresh.length === 0 ? 0 : planTiles(providerId, cap, snapshot, fresh).length;
  // why: cost-r1-007 — planCalls counts tiles; a tile that pages spends a call a page, so discovery overrun is judged on
  // distinct tiles (LedgerRepo.countsFor tiles), never on calls
  if (tiles > 0)
    notes.push(`${providerId}: ${tiles} discovery tiles planned; a tile that pages spends one call a page`);
  const l = ctx.limitsOf(providerId);
  return {
    providerId,
    stage: 'discovery',
    rawCalls: tiles,
    rawCostMicroGbp: tiles * l.costPerCallMicroGbp,
    rawSeconds: waitSeconds(ctx, providerId, tiles, SECONDS_PER_CALL[cap.info.sourceKind], notes),
  };
}

function verificationLine(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cellCount: number,
  sample: CellKey | undefined,
  notes: string[],
): Line | null {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined || sample === undefined || cellCount === 0) return null;
  if (!provider.cabins.includes(snapshot.cabin))
    return { providerId, stage: 'verification', rawCalls: 0, rawCostMicroGbp: 0, rawSeconds: 0 };
  const per = cap.estimate(itineraryQuery(snapshot, sample));
  notes.push(
    `${providerId}: verification of up to ${cellCount} cells at ${per.calls} calls each${per.notes.length > 0 ? ` (${per.notes.join('; ')})` : ''}`,
  );
  const calls = cellCount * per.calls;
  return {
    providerId,
    stage: 'verification',
    rawCalls: calls,
    rawCostMicroGbp: cellCount * per.costMicroGbp,
    rawSeconds: Math.max(
      waitSeconds(ctx, providerId, calls, 0, notes),
      Math.ceil((cellCount * per.seconds) / ctx.limitsOf(providerId).concurrency),
    ),
  };
}

/**
 * Spec §8.1 "Estimate = Σ discovery plan(q with cells = non-reused cells).length per pair, using the same reuse query
 * as the run, + maxCells × verification.estimate, all × ESTIMATE_RETRY_FACTOR". `planCalls` keep the pre-factor plan
 * (the overrun baseline). `definitionId` null plans every cell: the save-time worst case without reuse (ruling 9),
 * which is what `confirmed_cost_pence` records; a start passes its definition so the run-time estimate applies reuse.
 */
export function estimateStart(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  cells: readonly Cell[],
  definitionId: string | null,
): Estimate {
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    const l = discoveryLine(ctx, snapshot, id, cells, definitionId, notes);
    if (l !== null) lines.push(l);
  }
  const verifyCount = Math.min(snapshot.verification.maxCells, cells.length);
  for (const id of snapshot.providers.verification) {
    const l = verificationLine(ctx, snapshot, id, verifyCount, cells[0], notes);
    if (l !== null) lines.push(l);
  }
  if (definitionId === null) notes.push('every cell is planned: no reuse of earlier prices is assumed');
  if (snapshot.windowClamped) notes.push('window clamped to start tomorrow');
  return assemble(ctx, lines, cells.length, snapshot.windowClamped, notes);
}

function firstCellOf(ctx: EngineContext, executionId: string): CellKey | undefined {
  const first = ctx.repos.cells.outcomes(executionId)[0];
  return first === undefined
    ? undefined
    : {
        origin: first.origin,
        destination: first.destination,
        departureDate: first.departureDate,
        returnDate: first.returnDate,
      };
}

/**
 * Spec §8.1 "estimateRemaining (resumable tiles + remaining selected cells × estimate × factor)", over the cells the
 * resumed pass will fetch: the spec §7 resume query (which never returns `no-return-legs` or `no-priced-options` errors,
 * decision 37) less the cells whose departure date has arrived, which a resume marks skipped:departed before its pass
 * (po-016), so this read needs no write first (arch-r2-006).
 */
export function estimateRemainingFor(ctx: EngineContext, exec: Execution, manual: boolean): Estimate {
  const snapshot = exec.snapshot;
  const today = ctx.clock.todayLondon();
  const remaining = (stage: Stage, id: ProviderId) =>
    ctx.repos.cells.resumable(exec.id, stage, id, manual).filter((c) => c.departureDate > today);
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    const l = discoveryLine(ctx, snapshot, id, remaining('discovery', id), null, notes);
    if (l !== null) lines.push(l);
  }
  const seeded = ctx.repos.cells.hasVerificationOutcomes(exec.id);
  const total = ctx.repos.cells.rollUps(exec.id).size;
  for (const id of snapshot.providers.verification) {
    const cells = seeded ? remaining('verification', id) : [];
    const count = seeded ? cells.length : Math.min(snapshot.verification.maxCells, total);
    const sample =
      cells[0] ?? exec.cell ?? snapshot.verification.alwaysInclude[0] ?? firstCellOf(ctx, exec.id);
    const l = verificationLine(ctx, snapshot, id, count, sample, notes);
    if (l !== null) lines.push(l);
  }
  return assemble(ctx, lines, total, snapshot.windowClamped, notes);
}

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
    const kind = ctx.limitsOf(id).window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
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
