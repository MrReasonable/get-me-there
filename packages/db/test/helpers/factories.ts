import { randomUUID } from 'node:crypto';
import { asIata, asIsoDate, type CellKey, type ExecutionBudget, type ProviderLimits } from '@gmt/core';
import type { BudgetConfig } from '../../src/budgetConfig.js';
import type { Db } from '../../src/client.js';
import { T0 } from './db.js';

/** One provider's guard entry. Defaults: a 40usd-shaped subscription (rate 0, no fee). */
export function limits(
  over: Partial<ProviderLimits & { billable: boolean; trialUsed: number }> = {},
): ProviderLimits & { billable: boolean; trialUsed: number } {
  return {
    monthlyCallCap: 10_000,
    window: 'month',
    billingDay: 1,
    ratePerMinute: 10,
    ratePerHour: 2000,
    concurrency: 2,
    cacheTtlHours: 1,
    costPerCallMicroGbp: 0,
    planFixedMicroGbp: 0,
    excludedFromSchedule: false,
    billable: true,
    trialUsed: 0,
    ...over,
  };
}

/** A guard configuration; `spend` overrides the spec §12 defaults. */
export function budgetConfig(
  providers: BudgetConfig['providers'],
  spend: Partial<BudgetConfig['spend']> = {},
): BudgetConfig {
  return {
    providers,
    spend: {
      monthlyCapMicroGbp: 0,
      globalBillingDay: 1,
      softConfirmMicroGbp: 1_000_000,
      executionMaxCalls: 2000,
      executionMaxFreeCalls: 2000,
      executionMaxCostMicroGbp: 0,
      childMaxCalls: 6,
      ...spend,
    },
  };
}

// The worked example only (brief rules): London → New York.
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');

export function cell(
  origin = LHR,
  destination = JFK,
  departureDate = '2027-03-14',
  returnDate = '2027-03-28',
): CellKey {
  return { origin, destination, departureDate: asIsoDate(departureDate), returnDate: asIsoDate(returnDate) };
}

/**
 * A definition and an execution inserted with raw SQL; the snapshot holds only the budget the guard reads
 * (plan Budget port: per-execution caps come from the snapshot).
 */
export function rawExecution(
  db: Db,
  budget: ExecutionBudget,
  opts: { isChild?: boolean } = {},
): { definitionId: string; executionId: string } {
  const definitionId = randomUUID();
  const executionId = randomUUID();
  db.raw
    .prepare(
      `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
        verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
       VALUES (@id, 'London to New York', '["LHR","LGW"]', '["JFK","EWR"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 21, 'economy', '{}',
        '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', @budget, '{"discovery":[],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 1, @at, @at)`,
    )
    .run({ id: definitionId, budget: JSON.stringify(budget), at: T0 });
  const c = cell();
  const child = opts.isChild === true;
  db.raw
    .prepare(
      `INSERT INTO search_executions (id, definition_id, is_child, child_origin, child_destination, child_departure_date, child_return_date, definition_snapshot_json, trigger, status, created_at, started_at)
       VALUES (@id, @definitionId, @isChild, @o, @d, @dep, @ret, @snapshot, 'manual', 'running', @at, @at)`,
    )
    .run({
      id: executionId,
      definitionId,
      isChild: child ? 1 : 0,
      o: child ? c.origin : null,
      d: child ? c.destination : null,
      dep: child ? c.departureDate : null,
      ret: child ? c.returnDate : null,
      snapshot: JSON.stringify({ budget }),
      at: T0,
    });
  return { definitionId, executionId };
}
