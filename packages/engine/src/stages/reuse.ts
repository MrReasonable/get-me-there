import {
  type CapabilityInfo,
  type CellKey,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type DefinitionSnapshot,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  isTruncated,
  type ProviderId,
} from '@gmt/core';
import type { ReuseCriteria, ReusedCopy } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { markRemaining, type RunState, resumableCells } from '../run.js';
import { HOUR_MS } from '../units.js';

/** Spec §8.2: "reuse iff age < 0.9 × refresh, so a weekly cron refreshes weekly" (tested at 151 h, 152 h and a DST interval). */
export const REUSE_TOLERANCE = 0.9;

/** The definition's discoveryRefreshHours for a provider; core's DEFAULT_DISCOVERY_REFRESH_HOURS (168) otherwise (decision 21). */
export function refreshHoursOf(
  snapshot: Pick<DefinitionSnapshot, 'providers'>,
  providerId: ProviderId,
): number {
  return snapshot.providers.discoveryRefreshHours[providerId] ?? DEFAULT_DISCOVERY_REFRESH_HOURS;
}

/** The oldest original fetched_at still reusable: now − 0.9 × refresh hours, in elapsed milliseconds (never wall-clock days). */
export function reuseCutoff(now: IsoDateTime, refreshHours: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(now) - Math.round(refreshHours * REUSE_TOLERANCE * HOUR_MS));
}

/**
 * The spec §8.1 reuse predicate as data (decision 22): the point of sale and source kind the provider's rows will
 * carry, and the cutoff. The query and the repository's re-check use the same object (arch-024).
 */
export function reuseCriteriaFor(
  ctx: EngineContext,
  snapshot: Pick<DefinitionSnapshot, 'providers'>,
  providerId: ProviderId,
  info: CapabilityInfo,
): ReuseCriteria {
  return {
    pointOfSale: ctx.pointOfSaleOf(providerId),
    sourceKind: info.sourceKind,
    newerThan: reuseCutoff(ctx.clock.now(), refreshHoursOf(snapshot, providerId)),
  };
}

/**
 * Spec §8.1 reuse, per cell: the newest priced | empty | no_data outcome for the same cell, provider, definition,
 * cabin, point of sale and source kind, from a non-child execution, whose original fetched_at is newer than the
 * cutoff. The same query feeds the run-time estimate. Only priced | empty | no_data copies are returned, whatever the
 * repository hands back.
 */
export function reusableFor(
  ctx: EngineContext,
  definitionId: string,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  criteria: ReuseCriteria,
  cells: readonly CellKey[],
): ReusedCopy[] {
  if (cells.length === 0) return [];
  const candidates = ctx.repos.calendarPrices.reuseCandidates(
    definitionId,
    providerId,
    snapshot.cabin,
    criteria.pointOfSale,
    criteria.sourceKind,
    [...cells],
    criteria.newerThan,
  );
  // why: belt and braces on the repository's predicate — error and not_run are never copied (spec §9 item 4); and a
  // price from a truncated tile is the cheapest of the rows read, which a copy would no longer say, so its cell is
  // fetched again (decision 45)
  return candidates.filter(
    (c) =>
      (c.outcome.status === 'priced' || c.outcome.status === 'empty' || c.outcome.status === 'no_data') &&
      !isTruncated(c.outcome.lastError),
  );
}

/** What reuse needs of a pass or of a start's seeding transaction (a fresh start or a resume claim, ruling 2). */
export type ReuseScope = Pick<RunState, 'executionId' | 'definitionId' | 'snapshot' | 'isChild' | 'manual'>;

/**
 * Copies every reusable outcome (and its price row) into this execution for the provider's discovery cells the pass
 * would fetch (`resumableCells`: not_run, retryable errors, skipped:budget, and on a manual resume the disabled
 * provider's cells; ssr M2), so a cell another run has priced since is copied, never fetched again.
 * The repository re-checks each copy against the same criteria, keeps the original fetched_at and provenance and names
 * the execution that fetched the price, never an intermediate copier (spec §3, decision 22). Returns the cells reused.
 */
export function applyReuse(
  ctx: EngineContext,
  run: ReuseScope,
  providerId: ProviderId,
  info: CapabilityInfo,
): number {
  if (run.isChild) return 0; // why: spec §6.7 child executions have no discovery
  const wanted = resumableCells(ctx, run.executionId, 'discovery', providerId, run.manual);
  const criteria = reuseCriteriaFor(ctx, run.snapshot, providerId, info);
  const copies = reusableFor(ctx, run.definitionId, run.snapshot, providerId, criteria, wanted);
  if (copies.length > 0) ctx.repos.cells.copyReused(run.executionId, providerId, copies, criteria);
  return copies.length;
}

/**
 * A discovery line the budget check blocked (ruling 2, ssr I2): its reusable cells are copied first, and only the
 * cells still `not_run` become skipped:budget, so a blocked provider never discards a free, still-fresh price. Runs
 * inside the start's seeding transaction and the resume's claim. Returns the cells reused.
 */
export function skipBlockedDiscovery(
  ctx: EngineContext,
  scope: Omit<ReuseScope, 'isChild'>,
  providerId: ProviderId,
): number {
  const info = ctx.providers.get(providerId)?.discovery?.info;
  const reused = info === undefined ? 0 : applyReuse(ctx, { ...scope, isChild: false }, providerId, info);
  markRemaining(ctx, scope, 'discovery', providerId, 'budget');
  return reused;
}
