import {
  type DefinitionInput,
  type Estimate,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  flightPagesPerPair,
  isScheduled,
  type ProviderId,
  type SearchDefinition,
} from '@gmt/core';
import { bootEngine } from './boot.js';
import { checkBudget, spendOf } from './budgetCheck.js';
import { budgetFitFor, type ScheduleLoads, withScheduleLoads } from './budgetFit.js';
import { childCapPreview } from './child.js';
import { runConsentNoticeSafely } from './consentNotice.js';
import { buildContext, type EngineContext } from './context.js';
import { coverageCheckFor } from './coverageCheck.js';
import {
  askedPairs,
  billedCallsOf,
  estimateRemainingFor,
  estimateStart,
  type PlanMemo,
  withBlocked,
} from './estimate.js';
import { createFlightReader, flightListFresh } from './flightRead.js';
import { lineKey } from './lines.js';
import { runSystemJob } from './maintenance.js';
import { SMTP_TIMEOUTS } from './notifiers/email.js';
import { createOrchestrator, type Orchestrator } from './orchestrator.js';
import { isStalePaused, supersede } from './resume.js';
import { autoResume, catchUpAll } from './scheduler/catchUp.js';
import { parseCron } from './scheduler/parseCron.js';
import { createScheduler, type Scheduler } from './scheduler/scheduler.js';
import { buildSnapshot } from './snapshot.js';
import { browserLeftFor } from './stages/browserGate.js';
import type { PlannedTile } from './stages/discovery.js';
import { FLIGHT_LIST_PROVIDER } from './stages/flightLists.js';
import type { Engine, EngineDeps, EngineOptions } from './types.js';
import { HOUR_MS } from './units.js';

/**
 * The longest the shutdown waits for scheduler callbacks already running (review S2): an operator notice being sent
 * needs at most the SMTP connection and greeting timeouts before its message is written, plus a margin; it stays under
 * the app's 25 s shutdown deadline. A callback still running past it writes nothing more (EngineContext.lifecycle).
 */
export const SHUTDOWN_DRAIN_MS = SMTP_TIMEOUTS.connectionTimeout + SMTP_TIMEOUTS.greetingTimeout + 2_000;

/** Spec §10 `/health` degraded: job count ≠ enabled scheduled definitions, or an execution running past STUCK_AFTER_HOURS. */
export function statusOf(
  ctx: EngineContext,
  orch: Orchestrator,
  sched: Scheduler,
): ReturnType<Engine['status']> {
  const now = Date.parse(ctx.clock.now());
  const defs = ctx.repos.definitions
    .list()
    .filter((d) => isScheduled(d) && parseCron(d.scheduleCron, d.scheduleTz).ok);
  const running = orch.running();
  const stuck = running.some((id) => {
    const e = ctx.repos.executions.get(id);
    return e !== null && now - Date.parse(e.startedAt ?? e.createdAt) > ctx.config.stuckAfterHours * HOUR_MS;
  });
  const nextRuns = sched
    .jobs()
    .flatMap((j) => (j.kind === 'definition' && j.nextRun !== null ? [j.nextRun] : []))
    .sort();
  const latest = ctx.repos.definitions
    .list({ includeDeleted: true })
    .flatMap((d) => {
      const at = ctx.repos.executions.listForDefinition(d.id, { limit: 1, includeChildren: true })[0]
        ?.startedAt;
      return at === undefined || at === null ? [] : [at];
    })
    .sort();
  return {
    running,
    degraded: sched.definitionJobCount() !== defs.length || stuck,
    nextRun: nextRuns[0] ?? null,
    lastExecutionAt: latest[latest.length - 1] ?? null,
  };
}

/**
 * The definition the engine works on, with its id when it is saved. An unsaved DefinitionInput (POST
 * /api/definitions/estimate) gets placeholder metadata only so a snapshot can be built; nothing keys off its id, the
 * callers pass `definitionId` null instead (arch-021).
 */
function asDefinition(
  ctx: EngineContext,
  def: DefinitionInput | SearchDefinition,
): { def: SearchDefinition; definitionId: string | null } {
  if ('id' in def) return { def, definitionId: def.id };
  const now = ctx.clock.now();
  return {
    def: {
      ...def,
      id: 'unsaved',
      confirmedCostPence: null,
      confirmedCalls: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    definitionId: null,
  };
}

/** The plan's "Engine" contract over the modules of this package. Spec §8. */
export function createEngine(deps: EngineDeps, options: EngineOptions = {}): Engine {
  const ctx = buildContext(deps, options);
  // why: the plan each estimate made, by the estimate object itself, for estimateAsk (collected with the estimate)
  const memo = new WeakMap<Estimate, PlanMemo>();
  // why: the other schedules' monthly loads an estimate read for its reservations, so its estimateAsk (the same route,
  // the same moment) sets the same reservations aside without planning every other schedule again
  const loadsOf = new WeakMap<Estimate, ScheduleLoads>();
  const orch = createOrchestrator(ctx);
  // why: revision 55 §8.1 — one on-demand flight read at a time, through the context's one browser lease
  const flights = createFlightReader(ctx);
  const sched = createScheduler(
    {
      onTick: (id) => orch.tick(id),
      onResumeDue: async (id) => {
        const e = ctx.repos.executions.get(id);
        // why: ssr-11, ssr2-06 — a one-shot that fires for a run gone stale cancels it instead of resuming an old
        // snapshot; it never starts a run off the cron (a scheduled definition's next firing starts the fresh one)
        if (e !== null && isStalePaused(e, ctx.clock.now())) {
          await supersede(ctx, orch, e);
          return;
        }
        // why: decision 79 — a paused catch-up's one-shot yields to a firing since it paused (review S1, T1)
        const r = e === null ? await orch.resume(id, { manual: false }) : await autoResume(ctx, orch, e);
        if (r === null) return;
        ctx.log.info({ executionId: id, result: r.ok ? 'resumed' : r.code }, 'one-shot resume');
      },
      // why: decision 79 — the minute job catches up missed firings through the orchestrator; the daily jobs need none
      onSystem: async (name) => {
        if (name !== 'catch-up') return runSystemJob(ctx, name);
        await catchUpAll(ctx, orch);
        // why: V2 — a Mac asleep at 03:30 still sends today's consent notice once it is awake (the minute job re-reads at most hourly)
        await runConsentNoticeSafely(ctx);
      },
    },
    ctx.log,
  );
  /** The engine hands the database back: nothing new starts, and a job still running writes nothing more. */
  const markClosed = (): void => {
    ctx.lifecycle.closing = true;
    ctx.lifecycle.closed = true;
    ctx.lifecycle.abort.abort();
  };
  ctx.hooks.scheduleResume = (id, definitionId, at) => sched.registerResume(id, definitionId, at);
  ctx.hooks.cancelResume = (id) => sched.cancelResume(id);
  ctx.hooks.unregisterSchedule = (id) => sched.unregister(id);
  return {
    boot: () => bootEngine(ctx, orch, sched),
    shutdown: async () => {
      // why: spec §8.1 "SIGTERM: stop scheduler, abort in-flight (cells → not_run), status interrupted without
      // incrementing the counter"; the WAL checkpoint and the lock release follow in WP8's shutdown (arch-020). Review
      // S2's order: (1) nothing new starts, starts, resumes and verifications refused and no timer fires again;
      // (2) every run stops taking new provider work at once (orch.shutdown stops each as SIGTERM, its calls in flight
      // ending as they do), so none starts a call during the wait; (3) the scheduler's callbacks already running (a
      // minute catch-up sending its notice) get a bounded wait while the runs settle; (4) the database is handed back,
      // and a callback still running writes nothing more
      ctx.lifecycle.closing = true;
      sched.stopAll();
      ctx.heartbeat.stop();
      const settled = orch.shutdown();
      // why: revision 55 §8.1 — a flight read in flight is aborted and waited for within the drain, and writes nothing
      // once the engine is closed
      await Promise.all([sched.drain(SHUTDOWN_DRAIN_MS), settled, flights.stop()]);
      // why: spec §2 "The keep-awake lease": the last run's end sent the release; it is waited for (http-kit's 10 s
      // status timeout bounds it), and a lease it could not release runs out on the worker by itself
      await ctx.awake.settled();
      markClosed();
      ctx.log.info({}, 'engine: shut down');
    },
    markClosed,
    start: (id, opts) => orch.start(id, opts),
    resume: (id, opts) => orch.resume(id, opts),
    cancel: (id, cause) => orch.cancel(id, cause),
    verifyCell: (id, cell, opts) => orch.verifyCell(id, cell, opts),
    childCapPreview: (id, cell) => childCapPreview(ctx, id, cell),
    browserLeftFor: (def) => browserLeftFor(ctx, def),
    estimate: (input, today) => {
      // why: ruling 9 — the save-time estimate is the worst case without reuse; confirmationOf(it), every line
      // included, is what setConfirmed records (cost M-2)
      const { def } = asDefinition(ctx, input);
      const loads: ScheduleLoads = new Map();
      return withScheduleLoads(ctx, loads, () => {
        const b = buildSnapshot(ctx, def, 'manual', today);
        const plans = new Map<ProviderId, readonly PlannedTile[]>();
        const est = estimateStart(ctx, b.snapshot, b.cells, null, plans);
        // why: cost-r1-014 — the form shows beforehand which provider the caps would leave out
        const check = checkBudget(
          ctx,
          spendOf(est),
          b.snapshot.budget,
          null,
          'id' in input ? input.id : null,
        );
        const out = withBlocked(est, check.blockedBy);
        // why: estimateAsk reads the date pairs from this snapshot and these tiles, so the route plans once
        memo.set(out, { snapshot: b.snapshot, cells: b.cells, plans });
        loadsOf.set(out, loads);
        return out;
      });
    },
    estimateAsk: (input, today, est) => {
      // why: a saved definition's reusable prices are not asked again (spec §8.1 rev 55); the estimate itself stays the
      // worst case without reuse (ruling 9), so this is the only place reuse shows
      const { def, definitionId } = asDefinition(ctx, input);
      // an estimate this engine did not make (a test double) has no memo: snapshot and plan are made here
      const m = memo.get(est) ?? { ...buildSnapshot(ctx, def, 'manual', today), plans: new Map() };
      const blocked = new Set(
        est.perProvider.filter((p) => p.blocked !== null).map((p) => lineKey(p.stage, p.providerId)),
      );
      return withScheduleLoads(ctx, loadsOf.get(est) ?? new Map(), () => ({
        ...askedPairs(ctx, m.snapshot, m.cells, definitionId, blocked, m.plans),
        billedCalls: billedCallsOf(ctx, est, definitionId),
      }));
    },
    readFlightList: (id, pair) => flights.read(id, pair),
    flightReadInFlight: () => flights.inFlight(),
    setWorkerFlags: (id, f) => ctx.workerFlags.set(id, f),
    // why: prov-008: with the flags unread the on-demand read's own preflight may set them and load 2 pages, so the
    // button states the bound; once read, the pages the flags plan
    flightPagesPlanned: () => {
      const flags = ctx.workerFlags.get(FLIGHT_LIST_PROVIDER);
      return flags === null ? FLIGHT_LIST_PAGES_PER_PAIR_MAX : flightPagesPerPair(flags);
    },
    flightListFresh: (def, newest) => flightListFresh(ctx, def, newest),
    estimateRemaining: (id) => {
      const e = ctx.repos.executions.get(id);
      if (e === null) throw new Error(`execution ${id} not found`);
      return estimateRemainingFor(ctx, e, true); // why: the contract takes no `manual`; the manual query is the upper bound
    },
    budgetFit: (input) => {
      const { def, definitionId } = asDefinition(ctx, input);
      return withScheduleLoads(ctx, new Map(), () => budgetFitFor(ctx, def, definitionId));
    },
    coverageCheck: (req) => coverageCheckFor(ctx, req),
    scheduler: {
      register: (def) => sched.register(def),
      unregister: (id) => sched.unregister(id),
      jobs: () => sched.jobs(),
      tick: (id) => orch.tick(id),
      blockedSince: () => orch.blockedSince(),
    },
    status: () => statusOf(ctx, orch, sched),
  };
}
