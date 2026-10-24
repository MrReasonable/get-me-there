import {
  type DefinitionSnapshot,
  type Execution,
  formatPence,
  type IsoDateTime,
  microGbpToPence,
  PENCE_TO_MICRO,
  type ProviderId,
  type SearchDefinition,
  type SkipCode,
} from '@gmt/core';
import { RowRejected } from '@gmt/db';
import { breachMessage, checkBudget, spendOf } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { estimateStart, withBlocked } from './estimate.js';
import { execute } from './execute.js';
import { type LineKey, lineKey } from './lines.js';
import { notifyOperator } from './notify.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { browserWindowEndFrom, loadsBrowserPages, windowAnchor } from './scheduler/browserWindow.js';
import {
  CatchUpResumed,
  FiringTaken,
  pausedCatchUp,
  plannedSnapshot,
  replacePausedCatchUp,
  seedCatchUpBrowser,
  supersededCatchUp,
} from './scheduler/catchUpStart.js';
import { buildSnapshot, sellsCabin } from './snapshot.js';
import { skipBlockedDiscovery } from './stages/reuse.js';
import type { Estimate, StartOptions, StartResult } from './types.js';

/** A refused StartResult. */
export function refused(
  code: Extract<StartResult, { ok: false }>['code'],
  message: string,
  details: unknown,
): StartResult {
  return { ok: false, code, message, details };
}

/**
 * A start or child that lost the race to spec §7's partial unique indexes (one active parent, one active child per
 * cell): `ExecutionsRepo.create` reports it as `RowRejected` rule `active`, so the engine never reads a driver code.
 */
export function isActiveClash(err: unknown): boolean {
  return err instanceof RowRejected && err.rule === 'active';
}

/**
 * Spec §8.1 SOFT_CONFIRM, calls as well as pence (ruling 6): runnable calls of a provider above this share of its call
 * cap (monthly, or lifetime for a lifetime plan) need confirming.
 */
export const SOFT_CONFIRM_CALL_SHARE = 0.2;

/** What the operator confirmed: the pence and the calls of the estimate they saw (decision 37, cost-r1-005). */
export interface Confirmation {
  pence: number | null;
  calls: number | null;
}

/** The refusal of a start or skip whose firing another row already holds (spec §7 rev 36 firing unique index). */
export const FIRING_TAKEN = 'this scheduled firing already has its run or its skip recorded';

/** The firing a scheduled row stands for and, on a `skipped_missed` row, why it was not caught up (spec §7 rev 36). */
export interface FiringRow {
  scheduledFor: IsoDateTime;
  skipCode?: SkipCode;
}

/** What recordSkipped did: the row it wrote, or why it wrote nothing (the firing was taken; the catch-up resumed). */
export type SkipRecord =
  | { recorded: true; executionId: string }
  | { recorded: false; why: 'firing-taken' | 'active' };

/**
 * Records a scheduled run that did not start (spec §7 statuses skipped_*), then notifies (spec §8.1). With a firing the
 * row inserts through the firing unique index: when another row already holds that firing nothing is written or sent
 * (`firing-taken`, spec §7 rev 36 "the loser of a race no-ops"). A paused catch-up of the definition is superseded in
 * the same immediate transaction as the skip's insert (decision 79: the firing's row replaces it, whatever that row
 * is); a lost insert rolls the supersede back with it, and a catch-up a resume claimed meanwhile rolls the skip back
 * (`active`: it is running again, and the firing is judged again on the next pass).
 */
export async function recordSkipped(
  ctx: EngineContext,
  def: SearchDefinition,
  snapshot: DefinitionSnapshot,
  estimate: Estimate | null,
  status: 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed',
  detail: string,
  firing: FiringRow | null = null,
): Promise<SkipRecord> {
  const input = {
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot,
    estimate,
    trigger: 'schedule' as const,
    status,
  };
  const supersedes = firing === null ? null : pausedCatchUp(ctx.repos.executions.activeParent(def.id));
  let exec: Execution | null;
  try {
    exec = ctx.db.immediateTransaction(() => {
      if (firing === null) return ctx.repos.executions.create(input);
      replacePausedCatchUp(ctx, supersedes);
      const e = ctx.repos.executions.createForFiring({
        ...input,
        scheduledFor: firing.scheduledFor,
        ...(firing.skipCode === undefined ? {} : { skipCode: firing.skipCode }),
      });
      if (e === null) throw new FiringTaken();
      return e;
    });
  } catch (err) {
    if (err instanceof CatchUpResumed) {
      ctx.log.info(
        { definitionId: def.id, status, scheduledFor: firing?.scheduledFor ?? null },
        'execution: the paused catch-up resumed first; nothing recorded',
      );
      return { recorded: false, why: 'active' };
    }
    if (!(err instanceof FiringTaken)) throw err;
    exec = null;
  }
  if (exec === null) {
    ctx.log.info(
      { definitionId: def.id, status, scheduledFor: firing?.scheduledFor ?? null },
      'execution: firing already recorded',
    );
    return { recorded: false, why: 'firing-taken' };
  }
  if (supersedes !== null) supersededCatchUp(ctx, supersedes, exec);
  await notifyOperator(ctx, status, {
    executionId: exec.id,
    definitionId: def.id,
    definitionName: def.name,
    detail,
  });
  ctx.log.info(
    { executionId: exec.id, definitionId: def.id, status, scheduledFor: exec.scheduledFor },
    'execution: scheduled run not started',
  );
  return { recorded: true, executionId: exec.id };
}

/**
 * What `confirmationNeeded` reads: the soft-confirm threshold, the budget guard's caps and each provider's cap scope.
 * Narrow so the api can call the same rule over its own ports (plan decision 58).
 */
export interface ConfirmationContext {
  readonly config: Pick<EngineContext['config'], 'spend'>;
  readonly budget: Pick<EngineContext['budget'], 'usage'>;
  limitsOf(id: ProviderId): Pick<ReturnType<EngineContext['limitsOf']>, 'capKind'>;
}

/**
 * Spec §8.1 SOFT_CONFIRM: the runnable (not blocked) part of the estimate needs confirming when its cost is above the
 * pence threshold, or when a provider's runnable calls exceed SOFT_CONFIRM_CALL_SHARE of its call cap — the monthly
 * cap, or the lifetime cap of a lifetime plan such as the SearchApi trial (ruling 6, cost-r2-004) — so a plan whose
 * calls cost 0 still asks before a large run. A confirmation covers the run only when it names at least the runnable
 * cost (pence × PENCE_TO_MICRO ≥ cost) and at least the runnable calls in total (decision 37): a confirmation of 0p
 * alone never covers a run of any size. Null when no confirmation is needed, else the refusal details, whose
 * `totalCalls` and `estimatePence` are what a client confirms.
 */
export function confirmationNeeded(
  ctx: ConfirmationContext,
  estimate: Estimate,
  blocked: ReadonlySet<LineKey>,
  confirmed: Confirmation,
): {
  estimateMicroGbp: number;
  estimatePence: number;
  calls: Partial<Record<ProviderId, number>>;
  totalCalls: number;
  reason: string;
} | null {
  const runnable = estimate.perProvider.filter((p) => !blocked.has(lineKey(p.stage, p.providerId)));
  const cost = runnable.reduce((a, p) => a + p.costMicroGbp, 0);
  const totalCalls = runnable.reduce((a, p) => a + p.calls, 0);
  const calls = new Map<ProviderId, number>();
  for (const p of runnable) calls.set(p.providerId, (calls.get(p.providerId) ?? 0) + p.calls);
  const heavy = [...calls].flatMap(([id, n]) => {
    const kind = ctx.limitsOf(id).capKind;
    const cap = ctx.budget.usage({ kind, providerId: id }).cap;
    return cap !== null && n > SOFT_CONFIRM_CALL_SHARE * cap
      ? [
          `${n} ${id} calls, more than ${SOFT_CONFIRM_CALL_SHARE * 100}% of its ${kind === 'provider-lifetime' ? 'lifetime' : 'monthly'} call cap`,
        ]
      : [];
  });
  const overPence = cost > ctx.config.spend.softConfirmMicroGbp;
  if (!overPence && heavy.length === 0) return null;
  if (
    confirmed.pence !== null &&
    confirmed.calls !== null &&
    confirmed.pence * PENCE_TO_MICRO >= cost &&
    confirmed.calls >= totalCalls
  )
    return null;
  const estimatePence = microGbpToPence(cost);
  const reason = overPence
    ? `the estimate of ${formatPence(estimatePence)} is above the confirmation threshold`
    : `this run needs ${heavy.join(' and ')}`;
  return { estimateMicroGbp: cost, estimatePence, calls: Object.fromEntries(calls), totalCalls, reason };
}

/**
 * ssr2-03: a run whose every discovery line is blocked for budget would select only `alwaysInclude` cells, so with
 * none it would search nothing and end `completed`. A line that needs no call (every cell reused, or a cabin the
 * provider does not sell) is never blocked (checkBudget, ruling 2), so reused prices still feed selection. A line whose
 * provider does not sell the cabin (`sells`, the start passes `sellsCabin`) feeds nothing, so it is left out before
 * either test and never keeps a run that can make no call going (re-review N1).
 */
export function nothingToSearch(
  snapshot: Pick<DefinitionSnapshot, 'verification'>,
  estimate: Pick<Estimate, 'perProvider'>,
  blocked: ReadonlySet<LineKey>,
  sells: (providerId: ProviderId) => boolean,
): boolean {
  const all = estimate.perProvider.filter((p) => sells(p.providerId));
  const isBlocked = (p: (typeof all)[number]) => blocked.has(lineKey(p.stage, p.providerId));
  if (all.length > 0 && all.every(isBlocked)) return true;
  const discovery = all.filter((p) => p.stage === 'discovery');
  return (
    snapshot.verification.alwaysInclude.length === 0 && discovery.length > 0 && discovery.every(isBlocked)
  );
}

/**
 * Spec §8.1 pre-start (scheduler tick and POST) then start. Order: not found → disabled → active → window → no
 * runnable provider → per-scope budget (a provider-specific or billed breach seeds that provider skipped:budget; the
 * start is refused when nothing can run, or when every discovery provider is blocked and no cell is always included)
 * → SOFT_CONFIRM against what will run, in pence and calls → snapshot, seed, run. The stored estimate's totals are the
 * runnable ones (withBlocked).
 */
export async function startExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  definitionId: string,
  opts: StartOptions,
): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', `definition ${definitionId} not found`, { definitionId });
  // why: a disabled definition is neither scheduled nor started by hand until it is enabled again
  if (!def.enabled) return refused('disabled', 'this definition is disabled', { definitionId });
  const clash = () => refused('active', 'another execution of this definition is active', { definitionId });
  const active = ctx.repos.executions.activeParent(def.id);
  // why: spec §8.2 rev 36 — a paused catch-up never blocks a later firing; that firing's start supersedes it inside
  // its own immediate transaction below (a refusal's skipped_* row does the same in recordSkipped), so the two rows can
  // never both be active
  const supersedes = opts.scheduledFor === undefined ? null : pausedCatchUp(active);
  if (active !== null && supersedes === null) return clash();
  const scheduled = opts.trigger === 'schedule';
  const catchUp = opts.isCatchUp === true;
  const built = buildSnapshot(ctx, def, opts.trigger);
  const { snapshot, cells } = built;
  const firing: FiringRow | null =
    opts.scheduledFor === undefined ? null : { scheduledFor: opts.scheduledFor };
  const taken = () =>
    refused('firing-taken', FIRING_TAKEN, { definitionId, scheduledFor: opts.scheduledFor });
  /**
   * A scheduled refusal's skipped_* row, through the firing index: null when it was written, else the refusal standing
   * for what happened instead (the firing taken, or the paused catch-up resumed meanwhile).
   */
  const skip = async (
    status: Parameters<typeof recordSkipped>[4],
    estimate: Estimate | null,
    detail: string,
  ): Promise<StartResult | null> => {
    const r = await recordSkipped(ctx, def, snapshot, estimate, status, detail, firing);
    if (r.recorded) return null;
    return r.why === 'firing-taken' ? taken() : clash();
  };

  if (cells.length === 0) {
    const message = `the window resolves to no departure dates (${snapshot.resolved.departureFrom} to ${snapshot.resolved.departureTo})`;
    if (scheduled) {
      const lost = await skip('skipped_window', null, `The ${message}; the schedule is disabled.`);
      if (lost !== null) return lost;
      // why: review T6 — a notice that returned after the engine handed the database back leaves it alone; the next
      // firing meets the same empty window and disables the schedule then
      if (!ctx.lifecycle.closed) {
        ctx.repos.definitions.update(def.id, { enabled: false }); // why: spec §6.1 "record skipped_window … and disable the schedule"
        ctx.hooks.unregisterSchedule(def.id);
      }
    }
    return refused('window', message, {
      departureFrom: snapshot.resolved.departureFrom,
      departureTo: snapshot.resolved.departureTo,
    });
  }

  const all = [...new Set([...snapshot.providers.discovery, ...snapshot.providers.verification])];
  if (all.length === 0) {
    // why: a configuration problem, not a spend one (po-003): no skipped_budget row, its own wording, named providers
    const why = built.excluded.map((x) => x.note).join('; ') || 'the definition names no provider';
    const message = `no configured provider can run this definition${scheduled ? ' on a schedule' : ''}: ${why}`;
    if (scheduled)
      await notifyOperator(ctx, 'skipped_budget', {
        executionId: null,
        definitionId: def.id,
        definitionName: def.name,
        detail: message,
        variant: 'no-runnable-provider',
      });
    return refused('disabled', message, { definitionId, notes: built.notes });
  }

  // why: decision 79 — a catch-up keeps the browser provider in its snapshot for reuse only, so its pages are never
  // planned, priced or cap-checked
  const planned = estimateStart(ctx, plannedSnapshot(snapshot, catchUp), cells, def.id);
  const check = checkBudget(ctx, spendOf(planned), snapshot.budget, null, def.id);
  const estimate = withBlocked(planned, check.blockedBy);
  if (nothingToSearch(snapshot, planned, check.blocked, (id) => sellsCabin(ctx, id, snapshot.cabin))) {
    const starved = planned.perProvider.some((p) => !check.blocked.has(lineKey(p.stage, p.providerId)));
    const message = `budget cap: ${breachMessage(check.breaches)}${starved ? '; every discovery provider is blocked, so nothing would be searched' : ''}`;
    const lost = scheduled ? await skip('skipped_budget', estimate, `The ${message}.`) : null;
    if (lost !== null) return lost;
    return refused('cap', message, { breaches: check.breaches });
  }

  const confirmed: Confirmation = scheduled
    ? { pence: def.confirmedCostPence, calls: def.confirmedCalls }
    : { pence: opts.confirmCostPence ?? null, calls: opts.confirmCalls ?? null };
  const confirm = confirmationNeeded(ctx, estimate, check.blocked, confirmed);
  if (confirm !== null) {
    const message = `${confirm.reason} and has not been confirmed`;
    const lost = scheduled ? await skip('skipped_confirm', estimate, `This run ${message}.`) : null;
    if (lost !== null) return lost;
    return refused('confirm', message, {
      estimateMicroGbp: confirm.estimateMicroGbp,
      estimatePence: confirm.estimatePence,
      calls: confirm.calls,
      totalCalls: confirm.totalCalls,
    });
  }

  const discovery = snapshot.providers.discovery;
  let exec: Execution;
  try {
    // why: spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start" — the row is created running and
    // seeded in one BEGIN IMMEDIATE, so a crash can never leave an execution without its cells (ssr-07); blocked
    // providers are seeded skipped:budget in it
    exec = ctx.db.immediateTransaction(() => {
      const input = {
        definitionId: def.id,
        isChild: false,
        cell: null,
        snapshot,
        estimate,
        trigger: opts.trigger,
        status: 'running' as const,
      };
      // why: a catch-up that a resume claimed since the read above is running again: its guarded cancel changes nothing,
      // CatchUpResumed rolls this transaction back, and the firing waits like any other blocked one
      replacePausedCatchUp(ctx, supersedes);
      // why: spec §7 rev 36 — a scheduled start inserts through the firing unique index inside this immediate
      // transaction; a loser seeds no cells, launches nothing, sends no notice and (thrown, so rolled back) supersedes
      // nothing
      const e =
        opts.scheduledFor === undefined
          ? ctx.repos.executions.create(input)
          : ctx.repos.executions.createForFiring({
              ...input,
              scheduledFor: opts.scheduledFor,
              isCatchUp: catchUp,
            });
      if (e === null) throw new FiringTaken();
      // why: decision 83 — the run's browser window: its anchor (the firing, or a manual run's own start) plus 1.5 ×
      // the start estimate's seconds, written once here and moved only by a live-tick resume
      ctx.repos.executions.patch(e.id, {
        browserWindowEnd: browserWindowEndFrom(
          windowAnchor(e.scheduledFor, e.startedAt ?? e.createdAt),
          estimate.seconds,
        ),
      });
      ctx.repos.cells.seed(e.id, cells, discovery);
      const scope = { executionId: e.id, definitionId: def.id, snapshot, manual: false };
      for (const id of discovery) {
        // why: spec rev 10 — a provider that does not sell the snapshot's cabin is never called; its cells are no_data
        if (!sellsCabin(ctx, id, snapshot.cabin))
          ctx.repos.cells.markNoData(e.id, 'discovery', id, 'cabin-not-offered');
        else if (catchUp && loadsBrowserPages(id)) seedCatchUpBrowser(ctx, scope, id);
        else if (check.blocked.has(lineKey('discovery', id))) skipBlockedDiscovery(ctx, scope, id);
      }
      return e;
    });
  } catch (err) {
    if (err instanceof FiringTaken) return taken();
    if (err instanceof CatchUpResumed || isActiveClash(err)) return clash();
    throw err;
  }
  if (supersedes !== null) supersededCatchUp(ctx, supersedes, exec);
  const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: check.blocked });
  run.log.info(
    { trigger: opts.trigger, cells: cells.length, notes: built.notes, blocked: [...check.blocked] },
    'execution: started',
  );
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
