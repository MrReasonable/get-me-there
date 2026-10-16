import type { Execution } from '@gmt/core';
import type { EngineContext } from './context.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { buildSnapshot } from './snapshot.js';
import type { StartOptions, StartResult } from './types.js';

/** A refused StartResult. */
export function refused(
  code: Extract<StartResult, { ok: false }>['code'],
  message: string,
  details: unknown,
): StartResult {
  return { ok: false, code, message, details };
}

/** better-sqlite3 reports a partial-unique-index clash (spec §7 one active parent, one active child per cell) as SQLITE_CONSTRAINT_UNIQUE. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/** Spec §8.1 "start: snapshot; seed search_cells + cell_outcomes(not_run) …; status=running". */
export async function startExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  definitionId: string,
  opts: StartOptions,
): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', `definition ${definitionId} not found`, { definitionId });
  if (ctx.repos.executions.activeParent(def.id) !== null)
    return refused('active', 'another execution of this definition is active', { definitionId });
  const built = buildSnapshot(ctx, def);
  const discovery = built.snapshot.providers.discovery;
  let exec: Execution;
  try {
    // why: spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start" — the row is created running and
    // seeded in one BEGIN IMMEDIATE, so a crash can never leave an execution without its cells (ssr-07)
    exec = ctx.db.immediateTransaction(() => {
      const e = ctx.repos.executions.create({
        definitionId: def.id,
        isChild: false,
        cell: null,
        snapshot: built.snapshot,
        estimate: null,
        trigger: opts.trigger,
        status: 'running',
      });
      ctx.repos.cells.seed(e.id, built.cells, discovery);
      return e;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      return refused('active', 'another execution of this definition is active', { definitionId });
    throw err;
  }
  const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: new Set() });
  run.log.info({ trigger: opts.trigger, cells: built.cells.length }, 'execution: started');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
