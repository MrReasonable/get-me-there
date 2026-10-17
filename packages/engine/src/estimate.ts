import {
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  microGbpToPence,
  type ProviderId,
  type SourceKind,
  type Stage,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { type LineKey, lineKey } from './lines.js';
import { disabledBefore, resumableCells } from './run.js';
import { planTiles } from './stages/discovery.js';
import { reusableFor, reuseCriteriaFor } from './stages/reuse.js';
import { itineraryQuery } from './stages/verification.js';
import type { Estimate } from './types.js';

/** Typical wall time per call by source kind (spec §2: SearchApi calendar 9–29 s; Travelpayouts about 1 s; the fixture is local). */
export const SECONDS_PER_CALL: Readonly<Record<SourceKind, number>> = {
  'authorised-cached': 1,
  'scraped-aggregate': 20,
  'scraped-search': 15,
  synthetic: 0,
};

/** The totals of an estimate over the lines given (one sum, shared by assemble, addPass and withBlocked). */
function totalsOf(
  lines: Estimate['perProvider'],
): Pick<Estimate, 'totalCalls' | 'totalPlanCalls' | 'totalCostMicroGbp' | 'totalCostPence' | 'seconds'> {
  const totalCostMicroGbp = lines.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    totalCalls: lines.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: lines.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: microGbpToPence(totalCostMicroGbp),
    seconds: lines.reduce((a, p) => a + p.seconds, 0),
  };
}

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
  return {
    cells,
    perProvider,
    ...totalsOf(perProvider),
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
 * resumed pass will fetch, read through `resumableCells`, the pass's own predicate: departed cells are left out
 * (po-016) and marked skipped:departed only in the claim, so this read needs no write first (arch-r2-006).
 */
export function estimateRemainingFor(ctx: EngineContext, exec: Execution, manual: boolean): Estimate {
  const snapshot = exec.snapshot;
  const disabled = manual ? new Set<ProviderId>() : disabledBefore(ctx, exec.id);
  const remaining = (stage: Stage, id: ProviderId) =>
    disabled.has(id) ? [] : resumableCells(ctx, exec.id, stage, id, manual);
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    // why: ssr M2 — the same reuse query the pass applies, so a cell another run has priced since is not counted
    const l = discoveryLine(ctx, snapshot, id, remaining('discovery', id), exec.definitionId, notes);
    if (l !== null) lines.push(l);
  }
  const seeded = ctx.repos.cells.hasVerificationOutcomes(exec.id);
  const total = ctx.repos.cells.rollUps(exec.id).size;
  for (const id of snapshot.providers.verification) {
    const cells = seeded ? remaining('verification', id) : [];
    // why: re-review N2 — a provider an automatic resume keeps disabled makes no verification call, seeded or not
    const count = seeded
      ? cells.length
      : disabled.has(id)
        ? 0
        : Math.min(snapshot.verification.maxCells, total);
    const sample =
      cells[0] ?? exec.cell ?? snapshot.verification.alwaysInclude[0] ?? firstCellOf(ctx, exec.id);
    const l = verificationLine(ctx, snapshot, id, count, sample, notes);
    if (l !== null) lines.push(l);
  }
  return assemble(ctx, lines, total, snapshot.windowClamped, notes);
}

/**
 * The stored estimate after a resumed pass: its plan added line by line (cost-r1-009), so View D's overrun rule
 * (ledger calls > pre-factor plan + 10%) judges every pass the execution made, retries included.
 */
export function addPass(stored: Estimate | null, pass: Estimate): Estimate {
  if (stored === null) return pass;
  const lines = stored.perProvider.map((l) => ({ ...l }));
  for (const p of pass.perProvider) {
    const l = lines.find((x) => x.providerId === p.providerId && x.stage === p.stage);
    if (l === undefined) lines.push({ ...p });
    else {
      l.calls += p.calls;
      l.planCalls += p.planCalls;
      l.costMicroGbp += p.costMicroGbp;
      l.costPence = microGbpToPence(l.costMicroGbp);
      l.seconds += p.seconds;
    }
  }
  return {
    ...stored,
    perProvider: lines,
    ...totalsOf(lines),
    assumptions: [...stored.assumptions, `a resumed pass planned ${pass.totalPlanCalls} more calls`],
  };
}
/**
 * The estimate with each line's `blocked` scope set from a budget check, and the totals summed over the lines that will
 * run, so the figure shown, stored and confirmed is the runnable one and a blocked provider's plan never inflates the
 * overrun baseline (cost-r1-014). Blocked lines keep their figures, so the form still shows what they would need.
 */
export function withBlocked(e: Estimate, blockedBy: ReadonlyMap<LineKey, string>): Estimate {
  const perProvider = e.perProvider.map((p) => ({
    ...p,
    blocked: blockedBy.get(lineKey(p.stage, p.providerId)) ?? null,
  }));
  const runs = perProvider.filter((p) => p.blocked === null);
  return {
    ...e,
    perProvider,
    ...totalsOf(runs),
    assumptions:
      runs.length === perProvider.length
        ? e.assumptions
        : [...e.assumptions, 'totals leave out the provider lines a budget cap blocks'],
  };
}

/**
 * What a definition's stored confirmation (`DefinitionsRepo.setConfirmed`) records for an estimate: the worst case over
 * every line, blocked ones included (ruling 9, cost M-2). The shown totals leave out the lines a cap blocks today, and
 * a confirmation of those alone would no longer cover next month's scheduled run with the provider back, which would
 * then be skipped_confirm for no reason. WP8 stores this, never the shown totals.
 */
export function confirmationOf(e: Pick<Estimate, 'perProvider'>): { pence: number; calls: number } {
  const all = totalsOf(e.perProvider);
  return { pence: all.totalCostPence, calls: all.totalCalls };
}
