/** Spec §10 `/coverage` (View D). Separate from `coverage.ts` so `results.ts` → `coverage.ts` stays acyclic. */
import { type apiContract, type CellOutcome, type SearchDefinition, selectedNotReached } from '@gmt/core';
import { retriedOnResume } from '@gmt/db';
import { type Engine, loadsBrowserPages, resumeLeavesBrowserCells, windowSetting } from '@gmt/engine';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor } from './coverage.js';
import { executionResponse, overrunOf, planCallsOf } from './executions.js';
import { withNights } from './rows.js';
import { currentSpace } from './space.js';

export type CoverageResponse = z.infer<typeof apiContract.coverageResponseSchema>;

/**
 * Spec §3, §8.2 rev 36: the run's `skipped:scheduled_only` cells counted per stage × provider and detail, in that order,
 * so View D says why each group was left and, with `browserLeftFor`, for which run (core's scheduledOnlyText).
 */
export function scheduledOnlyOf(outcomes: readonly CellOutcome[]): CoverageResponse['scheduledOnly'] {
  const groups = new Map<string, CoverageResponse['scheduledOnly'][number]>();
  for (const o of outcomes) {
    if (o.status !== 'skipped' || o.reason !== 'scheduled_only' || o.skipDetail === null) continue;
    const key = `${o.stage}|${o.providerId}|${o.skipDetail}`;
    const g = groups.get(key) ?? { stage: o.stage, providerId: o.providerId, detail: o.skipDetail, cells: 0 };
    g.cells += 1;
    groups.set(key, g);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, g]) => g);
}
/**
 * Spec §10 `GET /coverage` (View D) for the latest parent execution: six buckets per stage × provider with request
 * counts, the overrun flag (decision 43: discovery on tiles) and the parity flag, selected-but-not-reached cells,
 * errors with retry. 404 `no_execution` before the first run (the contract names one execution).
 */
export function assembleCoverage(def: SearchDefinition, ports: Ports, engine: Engine): CoverageResponse {
  // why: every execution, never the newest N, so no run is silently dropped (CodeRabbit batch 3)
  const all = ports.repos.executions.listForDefinition(def.id, { limit: 'all', includeChildren: true });
  const parent = all.find((e) => !e.isChild) ?? null;
  if (parent === null) throw new ApiError(404, 'no_execution', API_TEXT.noExecution);
  const summary = coverageSummaryFor(parent, all, ports, currentSpace(def, ports.clock.todayLondon()));
  const counts = ports.repos.ledger.countsFor(parent.id);
  const parityBreak = ports.repos.notifications.wasSent('parity_break', parent.id, def.id);
  const perStage = executionResponse(ports, parent).progress.map((p) => {
    const line = counts.perProvider.find((c) => c.providerId === p.providerId && c.stage === p.stage);
    const planCalls = planCallsOf(parent, p.stage, p.providerId);
    return {
      ...p,
      requests: {
        calls: line?.calls ?? 0,
        tiles: line?.tiles ?? 0,
        cacheHits: line?.cacheHits ?? 0,
        costMicroGbp: line?.costMicroGbp ?? 0,
        planCalls,
        ...(line !== undefined && line.scrolls > 0 ? { scrolls: line.scrolls } : {}),
      },
      overrun: overrunOf(p.stage, line, planCalls),
      parityBreak,
    };
  });
  const outcomes = ports.repos.cells.outcomes(parent.id);
  const today = ports.clock.todayLondon();
  // why: review R12 — a browser cell that a resume now would only leave for a later run (a catch-up's, or one past its
  // window under CAMOUFOX_BROWSER_WINDOW=scheduled) is offered no Retry: the resume reads this same rule
  const browserLeft = resumeLeavesBrowserCells(parent, windowSetting(ports), ports.clock.now());
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
        // from (review arch-005), and, as resumableCells does, only a cell that has not departed (ssr-004), so View D's
        // "retry" and the resume never disagree and no dead Retry button shows.
        retryable:
          retriedOnResume(o, true) &&
          o.departureDate > today &&
          !(browserLeft && o.stage === 'discovery' && loadsBrowserPages(o.providerId)),
      })),
    scheduledOnly: scheduledOnlyOf(outcomes),
    browserLeftFor: engine.browserLeftFor(def),
    scheduleBlockedSince: engine.scheduler.blockedSince(),
    // why: ruling 15 (UI-004): every on-demand child, newest first, with its own buckets and ledger calls.
    onDemand: all
      .flatMap((e) => (e.isChild && e.cell !== null ? [{ e, cell: e.cell }] : []))
      .map(({ e, cell }) => {
        const ledger = ports.repos.ledger.countsFor(e.id);
        return {
          executionId: e.id,
          status: e.status,
          startedAt: e.startedAt,
          cell: withNights(cell),
          // why: a child searches one cell at the itinerary stage; a stage line with no cells says nothing.
          perStage: executionResponse(ports, e)
            .progress.filter((p) => p.total > 0)
            .map((p) => {
              const line = ledger.perProvider.find(
                (c) => c.providerId === p.providerId && c.stage === p.stage,
              );
              return {
                ...p,
                requests: {
                  calls: line?.calls ?? 0,
                  cacheHits: line?.cacheHits ?? 0,
                  costMicroGbp: line?.costMicroGbp ?? 0,
                },
              };
            }),
        };
      }),
  };
}
