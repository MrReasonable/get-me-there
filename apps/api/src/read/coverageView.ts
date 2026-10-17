/** Spec §10 `/coverage` (View D). Separate from `coverage.ts` so `results.ts` → `coverage.ts` stays acyclic. */
import { type apiContract, type SearchDefinition, selectedNotReached } from '@gmt/core';
import { retriedOnResume } from '@gmt/db';
import type { Engine } from '@gmt/engine';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor } from './coverage.js';
import { executionResponse, overrunOf, planCallsOf } from './executions.js';
import { EXECUTIONS_LIMIT } from './results.js';
import { withNights } from './rows.js';

export type CoverageResponse = z.infer<typeof apiContract.coverageResponseSchema>;
/**
 * Spec §10 `GET /coverage` (View D) for the latest parent execution: six buckets per stage × provider with request
 * counts, the overrun flag (decision 43: discovery on tiles) and the parity flag, selected-but-not-reached cells,
 * errors with retry. 404 `no_execution` before the first run (the contract names one execution).
 */
export function assembleCoverage(def: SearchDefinition, ports: Ports, engine: Engine): CoverageResponse {
  const all = ports.repos.executions.listForDefinition(def.id, {
    limit: EXECUTIONS_LIMIT,
    includeChildren: true,
  });
  const parent = all.find((e) => !e.isChild) ?? null;
  if (parent === null) throw new ApiError(404, 'no_execution', API_TEXT.noExecution);
  const summary = coverageSummaryFor(parent, all, ports);
  const counts = ports.repos.ledger.countsFor(parent.id);
  const parityBreak = ports.repos.notifications.wasSent('parity_break', parent.id, def.id);
  const perStage = executionResponse(ports, parent).progress.map((p) => {
    const line = counts.perProvider.find((c) => c.providerId === p.providerId && c.stage === p.stage);
    const planCalls = planCallsOf(parent, p.stage, p.providerId);
    return {
      ...p,
      requests: {
        calls: line?.calls ?? 0,
        cacheHits: line?.cacheHits ?? 0,
        costMicroGbp: line?.costMicroGbp ?? 0,
        planCalls,
      },
      overrun: overrunOf(p.stage, line, planCalls),
      parityBreak,
    };
  });
  const outcomes = ports.repos.cells.outcomes(parent.id);
  const notReached = selectedNotReached(
    ports.repos.cells.selected(parent.id).map((s) => s.cell),
    outcomes.filter((o) => o.stage === 'verification'),
  );
  return {
    executionId: parent.id,
    summary,
    perStage,
    selectedNotReached: notReached.map((s) => ({ cell: withNights(s.cell), reason: s.reason })),
    errors: outcomes
      .filter((o) => o.status === 'error')
      .map((o) => ({
        cell: withNights(o),
        stage: o.stage,
        providerId: o.providerId,
        reason: o.reason,
        lastError: o.lastError,
        attempts: o.attempts,
        // why: what a manual resume would pick up again: WP3's retriedOnResume, the predicate the resume query is built
        // from (review arch-005), so View D's "retry" and the resume never disagree.
        retryable: retriedOnResume(o, true),
      })),
    scheduleBlockedSince: engine.scheduler.blockedSince(),
  };
}
