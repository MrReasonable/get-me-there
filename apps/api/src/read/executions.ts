/** Spec §10 `GET /api/executions/:id` and the execution summaries every view lists. */
import {
  type apiContract,
  type Execution,
  hoursSince,
  type IsoDateTime,
  microGbpToPence,
  type ProviderId,
  type Stage,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { budgetScopes, usageOf } from './usage.js';

export type ExecutionResponse = z.infer<typeof apiContract.executionResponseSchema>;
export type ExecutionSummary = z.infer<typeof apiContract.executionSummarySchema>;
/** Spec §8.1: an overrun is more than 10% above the pre-factor plan. */
export const OVERRUN_TOLERANCE = 1.1;
const STATUSES_WITH_REASON = new Set([
  'paused_budget',
  'paused_error',
  'skipped_budget',
  'skipped_confirm',
  'skipped_window',
  'skipped_missed',
  'interrupted',
  'cancelled',
]);

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
 * for every scope, estimate vs ledger, overrun and parity flags, disabled providers. A stage with no provider has no
 * progress rows (spec §3 `not_applicable`).
 */
export function executionResponse(ports: Ports, e: Execution): ExecutionResponse {
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
    reason: STATUSES_WITH_REASON.has(e.status) ? e.errorText : null,
    resumeAfter: e.resumeAfter,
    trigger: e.trigger,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    errorText: e.errorText,
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
  };
}
