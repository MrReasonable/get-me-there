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
    // why: design 2026-11-08 §5.5: a confirm-mode step has no planned total, so a budget stop names no denominator
    confirm: e.flightLists?.confirm?.mode === 'confirm',
  });
}

/** How many runs' remaining estimates are kept (a page polls one run; a few tabs, a few runs). */
const FINISH_KEPT = 32;
/** How long a kept estimate stands with no new ledger row: progress that writes no row still shows within this. */
export const FINISH_KEPT_MS = 30_000;

/**
 * One app's kept remaining seconds per running execution (the final review's ruling): `estimateRemaining` walks the
 * run's plan, too much to redo on every 2 s poll of a page and a card. A figure is kept per execution id and the run's
 * ledger row count (a new call is new progress, so it re-estimates), for at most FINISH_KEPT_MS, the last FINISH_KEPT of
 * them, the oldest dropped first. Keyed weakly by the engine, so each app (and each test harness) has its own.
 */
const finishCaches = new WeakMap<object, Map<string, { seconds: number; atMs: number }>>();

/**
 * Spec revision 55 §10 `estimatedFinishAt`: now plus the run's own remaining seconds while it is pending or running (so
 * a resumed run never reads as finished in the past), null on every other status and for a run with no estimate. The
 * remaining seconds are kept until the run's ledger gains a row or FINISH_KEPT_MS pass (ruling: the time lags by at
 * most one ledger row).
 */
export function estimatedFinishOf(
  ports: Pick<Ports, 'clock' | 'repos'>,
  engine: Pick<Engine, 'estimateRemaining'>,
  e: Execution,
): IsoDateTime | null {
  if ((e.status !== 'pending' && e.status !== 'running') || e.estimate === null) return null;
  const nowMs = Date.parse(ports.clock.now());
  const cache = finishCaches.get(engine) ?? new Map<string, { seconds: number; atMs: number }>();
  finishCaches.set(engine, cache);
  const key = `${e.id}|${ports.repos.ledger.rowCount(e.id)}`;
  const kept = cache.get(key);
  // why: a hit is taken out and put back, so the map drops the run read longest ago first
  cache.delete(key);
  const entry =
    kept !== undefined && nowMs - kept.atMs <= FINISH_KEPT_MS
      ? kept
      : { seconds: engine.estimateRemaining(e.id).seconds, atMs: nowMs };
  cache.set(key, entry);
  const { seconds } = entry;
  for (const oldest of cache.keys()) {
    if (cache.size <= FINISH_KEPT) break;
    cache.delete(oldest);
  }
  return isoDateTimeOfEpochMs(nowMs + Math.round(seconds * 1000));
}

/**
 * Spec revision 55 §8.1 "What the run reports", §10 `flights`: from the stored flight-list plan, or null when the run
 * stored none (ruling A14: the page then says nothing about flights).
 */
export function flightsOf(ports: Pick<Ports, 'repos'>, e: Execution): ExecutionResponse['flights'] {
  const f = e.flightLists;
  if (f === null) return null;
  // why: `read` and `failed` from the newest row per planned cell of this execution (a resumed pass never writes a
  // pair twice, and a cell read twice counts once), so read + reused + failed never exceeds planned
  const { read, failed } = ports.repos.flightLists.forExecution(e.id, f.cells);
  return {
    planned: f.planned,
    read,
    reused: f.reused,
    failed,
    ended: f.ended,
    confirm: f.confirm,
    stopCause: flightsStopCauseOf(ports, e, f.ended),
  };
}

/**
 * Design 2026-11-08 §5.5: why the flight step stopped before its own rule ended it. An ending page or a cap
 * (`ended 'stopped'`) is told by the reason of the run's newest failed list (the ending page writes its own failed row);
 * otherwise the run's own stop cause, as a kind only (cancelled, budget, fatal, any other): no cause text travels.
 * Null while nothing stopped it.
 */
function flightsStopCauseOf(
  ports: Pick<Ports, 'repos'>,
  e: Execution,
  ended: NonNullable<Execution['flightLists']>['ended'],
): apiContract.FlightsStopCause | null {
  if (ended === 'stopped') {
    const detail = ports.repos.flightLists.lastFailureReason(e.id);
    if (detail !== null) return { kind: 'detail', detail };
  }
  const cause = e.stopCause;
  if (cause === null) return null;
  switch (cause.kind) {
    case 'cancelled':
    case 'budget':
    case 'fatal':
      return { kind: cause.kind };
    default:
      return { kind: 'other' };
  }
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
    flights: flightsOf(ports, e),
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
