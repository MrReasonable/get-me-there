/**
 * The record tool's execution bookkeeping (spec §7 production ledger, plan decisions 5, 20 and 23): the hidden
 * soft-deleted definition and its execution, the plan's stored estimate, the credits earlier tool runs ledgered, and
 * the provider windows' room for this run.
 */
import {
  addDays,
  type DefinitionInput,
  type DefinitionSnapshot,
  type Estimate,
  type ExecutionStatus,
} from '@gmt/core';
import type { Ports } from '../wiring.js';
import {
  CALENDAR_OUT_DAYS,
  firstDayOf,
  type PlannedCall,
  planTotals,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  type RecordArgs,
} from './recordPlan.js';
import { RECORD_TRAVEL_CLASS } from './recordRequests.js';

/** why: a Record over the union fails to compile when core adds a status, so the list below is always complete (arch-r2-002). */
const STATUS_FLAGS: Record<ExecutionStatus, true> = {
  pending: true,
  running: true,
  paused_budget: true,
  paused_error: true,
  interrupted: true,
  cancelled: true,
  completed: true,
  skipped_budget: true,
  skipped_confirm: true,
  skipped_window: true,
  skipped_missed: true,
};
function isExecutionStatus(s: string): s is ExecutionStatus {
  return Object.hasOwn(STATUS_FLAGS, s);
}
const ALL_STATUSES: ExecutionStatus[] = Object.keys(STATUS_FLAGS).filter(isExecutionStatus);

/** The SearchApi budget window the configured plan uses: lifetime on the trial, the billing month on 40usd. */
function searchApiWindow(ports: Ports) {
  return ports.budget.usage(
    ports.config.providers.searchapi?.limits.window === 'lifetime'
      ? { kind: 'provider-lifetime', providerId: 'searchapi' }
      : { kind: 'provider-month', providerId: 'searchapi' },
  );
}

/**
 * SearchApi credits already ledgered to earlier `trigger: 'tool'` executions inside the provider's current budget
 * window (the lifetime window on the trial plan, the billing month on 40usd); plan decision 20.
 */
export function priorToolCredits(ports: Ports): number {
  if (ports.config.providers.searchapi === null) return 0;
  const start = searchApiWindow(ports).windowStart;
  return ports.repos.executions
    .listByStatus(ALL_STATUSES)
    .filter((e) => e.trigger === 'tool' && (start === null || e.createdAt >= start))
    .reduce((n, e) => n + ports.budget.usage({ kind: 'execution-calls', executionId: e.id }).calls, 0);
}

/**
 * Where this run stands against every spend limit before a live call (plan decision 20, cost-wp4b-r2-001): the cross-run
 * sum against `--budget`, and each provider window's remaining room against the plan's worst case. `refusals` is empty
 * when a live run may start; `--confirm-rerun` lifts only the cross-run refusal, never a window that has no room.
 */
export function budgetPosition(
  ports: Ports,
  a: RecordArgs,
  plan: readonly PlannedCall[],
): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] } {
  const t = planTotals(plan);
  const prior = priorToolCredits(ports);
  const rerunNeedsConfirm = prior + t.worstCaseCredits > a.budget;
  const sa = searchApiWindow(ports);
  const tp = ports.budget.usage({ kind: 'provider-month', providerId: 'travelpayouts' });
  const windowRefusals: string[] = [];
  const room = (cap: number | null, used: number): number | null => (cap === null ? null : cap - used);
  const saRoom = room(sa.cap, sa.calls);
  const tpRoom = room(tp.cap, tp.calls);
  if (saRoom !== null && saRoom < t.worstCaseCredits)
    windowRefusals.push(
      `the SearchApi window has room for ${saRoom} credit(s) but this run may use ${t.worstCaseCredits}`,
    );
  if (tpRoom !== null && tpRoom < t.worstCaseFreeCalls)
    windowRefusals.push(
      `the Travelpayouts month has room for ${tpRoom} call(s) but this run may make ${t.worstCaseFreeCalls}`,
    );
  const lines = [
    `SearchApi credits already ledgered to tool runs in this budget window: ${prior}; this run ≤${t.worstCaseCredits}; --budget ${a.budget}${rerunNeedsConfirm ? ' (a live run needs --confirm-rerun)' : ''}`,
    `SearchApi window: ${sa.calls} of ${sa.cap ?? 'no cap'} used (compare with the dashboard); room ${saRoom ?? 'unlimited'}, this run ≤${t.worstCaseCredits}`,
    `Travelpayouts month: ${tp.calls} of ${tp.cap ?? 'no cap'} used; room ${tpRoom ?? 'unlimited'}, this run ≤${t.worstCaseFreeCalls}`,
    ...windowRefusals.map((r) => `a live run would be refused: ${r}`),
  ];
  return { lines, rerunNeedsConfirm, windowRefusals };
}

/** The plan's estimate, stored on the hidden execution so ledger-vs-estimate parity can be computed (cost-wp4b-010). */
function planEstimate(plan: readonly PlannedCall[], saCostMicroGbp: number): Estimate {
  const t = planTotals(plan);
  const saCost = t.worstCaseCredits * saCostMicroGbp;
  return {
    cells: 0,
    perProvider: [
      {
        providerId: 'travelpayouts',
        stage: 'discovery',
        calls: t.worstCaseFreeCalls,
        planCalls: t.freeCalls,
        costMicroGbp: 0,
        costPence: 0,
        seconds: 0,
        blocked: null,
      },
      {
        providerId: 'searchapi',
        stage: 'verification',
        calls: t.worstCaseCredits,
        planCalls: t.worstCaseCredits,
        costMicroGbp: saCost,
        costPence: Math.ceil(saCost / 10_000),
        seconds: 0,
        blocked: null,
      },
    ],
    totalCalls: t.worstCaseFreeCalls + t.worstCaseCredits,
    totalPlanCalls: t.worstCaseCredits,
    totalCostMicroGbp: saCost,
    totalCostPence: Math.ceil(saCost / 10_000),
    seconds: 0,
    assumptions: [
      'record:fixtures plan: SearchApi calls at worst-case credits; Travelpayouts calls at the page cap',
    ],
    windowClamped: false,
    retryFactor: 1,
  };
}

/**
 * The hidden execution that carries the run's caps in its snapshot budget (plan decision 5). The guard reads execution
 * caps from the snapshot, and the ledger's execution_id references search_executions, so recording needs a real
 * execution. Create and soft-delete are one transaction, and the snapshot is built from the deleted row
 * (prov-wp04b-009). The definition's space mirrors the calendar rectangle only to satisfy the definition schema:
 * nothing seeds cells for it, and spec §8.1 never resumes or schedules it.
 */
export function openRecordingExecution(ports: Ports, a: RecordArgs, plan: readonly PlannedCall[]): string {
  const sa = ports.config.providers.searchapi;
  if (sa === null) throw new Error('record:fixtures needs SEARCHAPI_KEY');
  const now = ports.clock.now();
  const from = firstDayOf(a.month);
  const to = addDays(from, CALENDAR_OUT_DAYS - 1);
  // why: the guard enforces exactly the figure the dry run printed, never more than --budget (cost-wp4b-011)
  const maxCalls = Math.min(a.budget, planTotals(plan).worstCaseCredits);
  const input: DefinitionInput = {
    name: `record:fixtures ${now} (hidden tool run)`,
    origins: a.origins,
    destinations: a.destinations,
    window: { kind: 'absolute', from, to },
    minNights: RECORD_MIN_NIGHTS,
    maxNights: RECORD_MAX_NIGHTS,
    cabin: RECORD_TRAVEL_CLASS,
    constraints: {},
    verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: {
      maxCalls,
      maxFreeCalls: ports.config.spend.executionMaxFreeCalls,
      maxCostMicroGbp: maxCalls * sa.limits.costPerCallMicroGbp,
    },
    providers: { discovery: [], verification: [], discoveryRefreshHours: {} },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: ports.config.schedulerTimezone,
    enabled: false,
  };
  const def = ports.db.immediateTransaction(() => {
    const created = ports.repos.definitions.create(input);
    ports.repos.definitions.softDelete(created.id);
    const deleted = ports.repos.definitions.get(created.id);
    if (deleted === null) throw new Error('hidden recording definition vanished');
    return deleted;
  });
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: {
      origins: a.origins,
      destinations: a.destinations,
      departureFrom: from,
      departureTo: to,
      minNights: RECORD_MIN_NIGHTS,
      maxNights: RECORD_MAX_NIGHTS,
    },
    resolvedAt: now,
    windowClamped: false,
    droppedAlwaysInclude: [],
  };
  return ports.repos.executions.create({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot,
    estimate: planEstimate(plan, sa.limits.costPerCallMicroGbp),
    trigger: 'tool',
    status: 'running',
  }).id;
}
