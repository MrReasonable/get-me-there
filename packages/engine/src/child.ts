import {
  ACTIVE_STATUSES,
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  type SearchDefinition,
} from '@gmt/core';
import { breachMessage, checkBudget, spendOf } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { estimateStart, withBlocked } from './estimate.js';
import { execute } from './execute.js';
import { lineKey } from './lines.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { buildSnapshot, childSnapshot } from './snapshot.js';
import { isActiveClash, refused } from './start.js';
import type { StartResult } from './types.js';

/** Billed calls an execution may still make under its own snapshot cap. */
function callsLeft(ctx: EngineContext, e: Execution): number {
  return Math.max(
    0,
    e.snapshot.budget.maxCalls - ctx.budget.usage({ kind: 'execution-calls', executionId: e.id }).calls,
  );
}

/**
 * Spec rev 18 §6.7 and ruling 7: a child's call cap is its per-cell estimate (already × ESTIMATE_RETRY_FACTOR) for the
 * billed providers, bounded by the parent's headroom, never below CHILD_MAX_CALLS. The headroom is the active parent's
 * execution-calls left (else the definition's maxCalls) less what the definition's other active children may still
 * spend, so concurrent children do not each size themselves against the same calls (cost-r2-001). The floor can go
 * past that headroom by at most CHILD_MAX_CALLS a child; the provider-month and global caps still bound every call.
 */
export function childMaxCalls(
  ctx: EngineContext,
  definitionId: string,
  definitionMaxCalls: number,
  perCellBilledCalls: number,
): { maxCalls: number; headroom: number } {
  const parent = ctx.repos.executions.activeParent(definitionId);
  const parentLeft = parent === null ? definitionMaxCalls : callsLeft(ctx, parent);
  const held = ctx.repos.executions
    .listByStatus([...ACTIVE_STATUSES])
    .filter((e) => e.isChild && e.definitionId === definitionId)
    .reduce((a, e) => a + callsLeft(ctx, e), 0);
  const headroom = Math.max(0, parentLeft - held);
  return {
    maxCalls: Math.max(ctx.config.spend.childMaxCalls, Math.min(perCellBilledCalls, headroom)),
    headroom,
  };
}

/**
 * The child cap of one cell: its per-cell billed estimate (`need`, × ESTIMATE_RETRY_FACTOR) through childMaxCalls. The
 * one calculation verifyCell sizes a child with and childCapPreview shows beforehand (decisions 42, 45).
 */
export function sizeChild(
  ctx: EngineContext,
  def: SearchDefinition,
  snapshot: DefinitionSnapshot,
  cell: Cell,
): { maxCalls: number; headroom: number; need: number } {
  const sized = estimateStart(ctx, childSnapshot(snapshot, cell, def.budget.maxCalls), [cell], null);
  const need = sized.perProvider
    .filter((p) => ctx.limitsOf(p.providerId).billed)
    .reduce((a, p) => a + p.calls, 0);
  return { ...childMaxCalls(ctx, def.id, def.budget.maxCalls, need), need };
}

/**
 * Decision 45: the cap a child of `cell` would get now and the headroom it is drawn from, for the cell detail's verify
 * button (decisions 38, 42), by the same calculation verifyCell uses. Throws for a definition that does not exist or a
 * cell outside its current search space, which have no verify button.
 */
export function childCapPreview(
  ctx: EngineContext,
  definitionId: string,
  cell: CellKey,
): { maxCalls: number; headroomCalls: number } {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null) throw new Error(`definition ${definitionId} not found`);
  const built = buildSnapshot(ctx, def, 'manual');
  const match = built.cells.find((c) => cellKeyString(c) === cellKeyString(cell));
  if (match === undefined) throw new Error('the cell is not in the current search space');
  const { maxCalls, headroom } = sizeChild(ctx, def, built.snapshot, match);
  return { maxCalls, headroomCalls: headroom };
}

/**
 * Spec §8.1 `POST /cells/verify`: validates that the cell is in generateCells(current resolved space), has not departed
 * and its airports exist, then creates a child execution (is_child = 1, cell columns set), seeded and running in one
 * transaction. At most one active child per cell (the child partial unique index backs this up). A child never pauses
 * (ruling 7, run.ts applyBudgetBreach).
 */
export async function verifyCellExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  definitionId: string,
  cell: CellKey,
): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', `definition ${definitionId} not found`, { definitionId });
  const built = buildSnapshot(ctx, def, 'manual');
  if (built.snapshot.providers.verification.length === 0)
    return refused('window', 'this definition has no verification provider', { definitionId });
  const key = cellKeyString(cell);
  const match = built.cells.find((c) => cellKeyString(c) === key);
  if (
    match === undefined ||
    match.departureDate <= ctx.clock.todayLondon() ||
    !ctx.repos.airports.exists(cell.origin) ||
    !ctx.repos.airports.exists(cell.destination)
  )
    return refused('window', 'the cell is not in the current search space', { cell });
  if (ctx.repos.executions.activeChild(def.id, cell) !== null)
    return refused('active', 'this cell is already being verified', { cell });
  const { maxCalls, headroom, need } = sizeChild(ctx, def, built.snapshot, match);
  const snapshot = childSnapshot(built.snapshot, match, maxCalls);
  const planned = estimateStart(ctx, snapshot, [match], null);
  const check = checkBudget(ctx, spendOf(planned), snapshot.budget, null, def.id);
  const estimate = withBlocked(planned, check.blockedBy);
  if (snapshot.providers.verification.every((id) => check.blocked.has(lineKey('verification', id)))) {
    const room =
      headroom < need
        ? `; the budget left for verifying single cells has room for ${headroom} of the ${need} calls this cell needs`
        : '';
    return refused('cap', `budget cap: ${breachMessage(check.breaches)}${room}`, {
      breaches: check.breaches,
      headroom,
      need,
    });
  }
  let exec: Execution;
  try {
    exec = ctx.db.immediateTransaction(() => {
      const e = ctx.repos.executions.create({
        definitionId: def.id,
        isChild: true,
        cell,
        snapshot,
        estimate,
        trigger: 'manual',
        status: 'running',
      });
      ctx.repos.cells.seed(e.id, [match], []);
      return e;
    });
  } catch (err) {
    if (isActiveClash(err)) return refused('active', 'this cell is already being verified', { cell });
    throw err;
  }
  const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: check.blocked });
  run.log.info({ cell: key, maxCalls }, 'execution: child started');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
