/** Spec §10 `GET /api/executions/:id` and the execution summaries every view lists. */
import {
  type apiContract,
  type Execution,
  hoursSince,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  isScheduled,
  microGbpToPence,
  NO_STOP_CAUSE_TEXT,
  type ProviderId,
  runModeOf,
  type SearchDefinition,
  STOPPED_STATUSES,
  type Stage,
  type StopText,
  stopText,
} from '@gmt/core';
import type { Engine } from '@gmt/engine';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { budgetScopes, usageOf } from './usage.js';

export type ExecutionResponse = z.infer<typeof apiContract.executionResponseSchema>;
export type ExecutionSummary = z.infer<typeof apiContract.executionSummarySchema>;
/** Spec §8.1: an overrun is more than 10% above the pre-factor plan. */
export const OVERRUN_TOLERANCE = 1.1;

const STOPPED: ReadonlySet<Execution['status']> = new Set(STOPPED_STATUSES);

/**
 * Spec revision 55 §8.1, §10 `stop`: the stored cause's words (`stopText`, worded for this install's run mode, the run's
 * zone and whether its search is scheduled now); `NO_STOP_CAUSE_TEXT` for a stopped row with no cause (written before
 * migration 0011), whatever its `error_text` holds (Review Focus 4: that text is never sent here); null otherwise.
 */
export function stopOf(
  ports: Pick<Ports, 'config'>,
  e: Execution,
  def: SearchDefinition | null,
): StopText | null {
  if (!STOPPED.has(e.status)) return null;
  if (e.stopCause === null) return NO_STOP_CAUSE_TEXT;
  return stopText(e.stopCause, {
    tz: e.snapshot.scheduleTz,
    mode: runModeOf(ports.config),
    scheduled: def !== null && isScheduled(def),
  });
}

/**
 * Spec revision 55 §10 `estimatedFinishAt`: now plus the run's own remaining seconds while it is pending or running (so
 * a resumed run never reads as finished in the past), null on every other status and for a run with no estimate.
 */
export function estimatedFinishOf(
  ports: Pick<Ports, 'clock'>,
  engine: Pick<Engine, 'estimateRemaining'>,
  e: Execution,
): IsoDateTime | null {
  if ((e.status !== 'pending' && e.status !== 'running') || e.estimate === null) return null;
  const seconds = engine.estimateRemaining(e.id).seconds;
  return isoDateTimeOfEpochMs(Date.parse(ports.clock.now()) + Math.round(seconds * 1000));
}

/**
 * Spec revision 55 §8.1 "What the run reports", §10 `flights`: from the stored flight-list plan, or null when the run
 * stored none (ruling A14: the page then says nothing about flights).
 */
export function flightsOf(e: Execution): ExecutionResponse['flights'] {
  const f = e.flightLists;
  if (f === null) return null;
  // why: the plan is written by the flight-list step (Task 20.9) and the rows it counts read and failed from by
  // FlightListsRepo.forExecution (Task 20.8); until then no run stores a plan, so this branch is not reached
  return { planned: f.planned, read: 0, reused: f.reused, failed: 0, ended: f.ended };
}

/**
 * The api-contract `ExecutionSummary` used by every view's `executions` list (newest first). `expandTop` is the run's
 * own, from its snapshot, so "(E outbounds each)" describes the run shown, not today's definition (decision 42).
 */
export function executionSummary(e: Execution, now: IsoDateTime): ExecutionSummary {
  return {
    id: e.id,
    status: e.status,
    isChild: e.isChild,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    ageHours: hoursSince(e.startedAt ?? e.createdAt, now),
    expandTop: e.snapshot.verification.expandTop,
    // why: spec §8.2 rev 36 — the firing a scheduled row stands for and why a missed one was not caught up, so the
    // views can name both (review R17)
    scheduledFor: e.scheduledFor,
    isCatchUp: e.isCatchUp,
    skipCode: e.skipCode,
  };
}

/** One (stage, provider) line of the ledger, as the coverage view and the overrun flag read it. */
export interface LedgerLine {
  calls: number;
  costMicroGbp: number;
  tiles: number;
  cacheHits: number;
}

/**
 * Spec §8.1 overrun against the stored estimate's pre-factor `planCalls`. Discovery is judged on distinct tiles, because
 * `planCalls` counts tiles and a paged tile spends a call a page (decision 43); verification on calls.
 */
export function overrunOf(stage: Stage, line: LedgerLine | undefined, planCalls: number | null): boolean {
  if (planCalls === null || planCalls <= 0) return false;
  const spent = stage === 'discovery' ? (line?.tiles ?? 0) : (line?.calls ?? 0);
  return spent > planCalls * OVERRUN_TOLERANCE;
}

/** The stored estimate's pre-factor calls for one (stage, provider), or null without an estimate line. */
export function planCallsOf(e: Execution, stage: Stage, providerId: ProviderId): number | null {
  return (
    e.estimate?.perProvider.find((p) => p.providerId === providerId && p.stage === stage)?.planCalls ?? null
  );
}

/**
 * Spec §10 `GET /api/executions/:id`: status, stage, reason, resumeAfter, progress per stage × provider, budget usage
 * for every scope, estimate vs ledger, overrun and parity flags, disabled providers, and (revision 55) the stop's words,
 * the estimated finish and the flight-list counts. A stage with no provider has no progress rows (spec §3
 * `not_applicable`).
 */
export function executionResponse(
  ports: Ports,
  e: Execution,
  engine: Pick<Engine, 'estimateRemaining'> | null,
): ExecutionResponse {
  const counts = ports.repos.ledger.countsFor(e.id);
  const progress = (['discovery', 'verification'] as const).flatMap((stage) =>
    e.snapshot.providers[stage].map((providerId) => {
      const b = ports.repos.cells.buckets(e.id, stage, providerId);
      return {
        stage,
        providerId,
        buckets: b,
        total: b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run,
      };
    }),
  );
  const disabled = new Set<ProviderId>(
    ports.repos.cells
      .outcomes(e.id)
      .filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')
      .map((o) => o.providerId),
  );
  const def = ports.repos.definitions.get(e.definitionId);
  const stop = stopOf(ports, e, def);
  const overrun = progress.some((p) =>
    overrunOf(
      p.stage,
      counts.perProvider.find((l) => l.providerId === p.providerId && l.stage === p.stage),
      planCallsOf(e, p.stage, p.providerId),
    ),
  );
  return {
    id: e.id,
    definitionId: e.definitionId,
    isChild: e.isChild,
    cell: e.cell,
    status: e.status,
    stage: e.stage,
    resumeAfter: e.resumeAfter,
    trigger: e.trigger,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    scheduledFor: e.scheduledFor,
    isCatchUp: e.isCatchUp,
    skipCode: e.skipCode,
    progress,
    budget: budgetScopes(ports, e.id).map((s) => usageOf(ports, s)),
    estimate: e.estimate,
    // why: "ledger cost, from configured rates" (spec §8.1); core's microGbpToPence never understates spend.
    ledger: {
      calls: counts.calls,
      costMicroGbp: counts.costMicroGbp,
      costPence: microGbpToPence(counts.costMicroGbp),
      tiles: counts.tiles,
      cacheHits: counts.cacheHits,
      perProvider: counts.perProvider.map((p) => ({
        providerId: p.providerId,
        stage: p.stage,
        calls: p.calls,
        costMicroGbp: p.costMicroGbp,
      })),
    },
    parityBreak: ports.repos.notifications.wasSent('parity_break', e.id, e.definitionId),
    overrun,
    disabledProviders: [...disabled].sort(),
    stop,
    // why: the coverage view reads only the progress, so it passes null for the engine and gets no finish estimate
    estimatedFinishAt: engine === null ? null : estimatedFinishOf(ports, engine, e),
    flights: flightsOf(e),
  };
}

export type ActiveExecutionResponse = z.infer<typeof apiContract.activeExecutionResponseSchema>;

/**
 * Spec §10 `GET /api/executions/active` (decision 80: `gmt update` reads it before it stops the app; review R15, R16):
 * the oldest execution with a pass in flight (pending or running), a parent run or a single-cell verification (a child
 * spends credits too, so `gmt update` must not cut it short either), read as one lean row. Its estimated finish is now
 * plus the seconds the engine estimates its remaining cells take (the current pass's own remaining estimate; a resumed
 * run never reads as finished in the past), or null when the run has no estimate. A paused or interrupted run has no
 * pass in flight, so a restart cuts nothing short and it is not reported.
 */
export function activeExecution(
  ports: Ports,
  engine: Pick<Engine, 'estimateRemaining'>,
): ActiveExecutionResponse {
  const e = ports.repos.executions.oldestInFlight();
  if (e === null) return { execution: null };
  const full = ports.repos.executions.get(e.id);
  const remaining = full === null || full.estimate === null ? null : engine.estimateRemaining(e.id).seconds;
  return {
    execution: {
      id: e.id,
      definitionId: e.definitionId,
      definitionName:
        ports.repos.definitions.get(e.definitionId)?.name ?? full?.snapshot.name ?? e.definitionId,
      kind: e.isChild ? 'cell-verification' : 'run',
      startedAt: e.startedAt ?? e.createdAt,
      estimatedFinishAt:
        remaining === null
          ? null
          : isoDateTimeOfEpochMs(Date.parse(ports.clock.now()) + Math.round(remaining * 1000)),
    },
  };
}
