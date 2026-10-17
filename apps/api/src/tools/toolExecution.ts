/**
 * Tool-run bookkeeping shared by `record:fixtures` and `smoke:live` (spec §7 production ledger; plan decisions 5, 20,
 * 23, 65, 66): the hidden soft-deleted definition and its execution with the run's frozen caps and stored estimate, the
 * credits earlier tool runs ledgered, and the provider windows' room for this run. One copy of each rule, so the two
 * tools cannot drift; the record tool's plan-specific wrappers (`budgetPosition`, `openRecordingExecution`) sit at the end.
 */
import {
  addDays,
  type Cabin,
  type DefinitionInput,
  type DefinitionSnapshot,
  type Estimate,
  type ExecutionStatus,
  type Iata,
  type IsoDate,
  microGbpToPence,
  type ProviderId,
  type Stage,
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
 * window (the lifetime window on the trial plan, the billing month on 40usd); plan decision 20. It scans every
 * execution and asks the guard per tool run: acceptable for a rarely run tool. Follow-up for WP3's owner (arch M-8): a
 * repository query for credits ledgered to `trigger = 'tool'` executions since an instant, which retires STATUS_FLAGS.
 */
export function priorToolCredits(ports: Ports): number {
  if (ports.config.providers.searchapi === null) return 0;
  const start = searchApiWindow(ports).windowStart;
  return ports.repos.executions
    .listByStatus(ALL_STATUSES)
    .filter((e) => e.trigger === 'tool' && (start === null || e.createdAt >= start))
    .reduce((n, e) => n + ports.budget.usage({ kind: 'execution-calls', executionId: e.id }).calls, 0);
}

/** A tool run's stated worst case: SearchApi credits and free Travelpayouts calls. */
export interface WorstCase {
  credits: number;
  freeCalls: number;
}

/**
 * Where a tool run stands against every spend limit before a call to a vendor (plan decision 20, cost-wp4b-r2-001): the
 * cross-run sum against `budget`, and each configured provider window's remaining room against the run's worst case.
 * `windowRefusals` is empty when the run may start; `--confirm-rerun` lifts only the cross-run refusal, never a window
 * that has no room. The trial plan's window line names `SEARCHAPI_TRIAL_USED`, so a dry run shows the figure the cap
 * subtracts (plan decision 66).
 */
export function spendPosition(
  ports: Ports,
  worst: WorstCase,
  budget: number,
): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] } {
  const prior = priorToolCredits(ports);
  const rerunNeedsConfirm = prior + worst.credits > budget;
  const windowRefusals: string[] = [];
  const room = (cap: number | null, used: number): number | null => (cap === null ? null : cap - used);
  // why: these lines reach the tools' API bodies, where spec §11 bans "live" (decision 65)
  const lines = [
    `SearchApi credits already ledgered to tool runs in this budget window: ${prior}; this run ≤${worst.credits}; --budget ${budget}${rerunNeedsConfirm ? ' (a run that calls the vendors needs --confirm-rerun)' : ''}`,
  ];
  const sa = ports.config.providers.searchapi;
  // why: a provider that is not configured has no budget lines (the smoke runs on either one alone)
  if (sa === null) lines.push('SearchApi: not configured');
  else {
    const w = searchApiWindow(ports);
    const saRoom = room(w.cap, w.calls);
    if (saRoom !== null && saRoom < worst.credits)
      windowRefusals.push(
        `the SearchApi window has room for ${saRoom} credit(s) but this run may use ${worst.credits}`,
      );
    const trial = sa.limits.window === 'lifetime' ? `; SEARCHAPI_TRIAL_USED ${sa.trialUsed}` : '';
    lines.push(
      `SearchApi window (${sa.plan}${trial}): ${w.calls} of ${w.cap ?? 'no cap'} used (compare with the dashboard); room ${saRoom ?? 'unlimited'}, this run ≤${worst.credits}`,
    );
  }
  if (ports.config.providers.travelpayouts === null) lines.push('Travelpayouts: not configured');
  else {
    const tp = ports.budget.usage({ kind: 'provider-month', providerId: 'travelpayouts' });
    const tpRoom = room(tp.cap, tp.calls);
    if (tpRoom !== null && tpRoom < worst.freeCalls)
      windowRefusals.push(
        `the Travelpayouts month has room for ${tpRoom} call(s) but this run may make ${worst.freeCalls}`,
      );
    lines.push(
      `Travelpayouts month: ${tp.calls} of ${tp.cap ?? 'no cap'} used; room ${tpRoom ?? 'unlimited'}, this run ≤${worst.freeCalls}`,
    );
  }
  lines.push(...windowRefusals.map((r) => `a run that calls the vendors would be refused: ${r}`));
  return { lines, rerunNeedsConfirm, windowRefusals };
}

/** One line of a tool run's stored estimate: what one provider may call in one stage. */
export interface EstimateLine {
  providerId: ProviderId;
  stage: Stage;
  /** The worst case, retries and pages included. */
  calls: number;
  /** First attempts the run plans, for parity with the ledger (cost M-1). */
  planCalls: number;
}

/**
 * A tool run's estimate, stored on its hidden execution so ledger-vs-estimate parity can be computed (cost-wp4b-010).
 * SearchApi lines are priced at the configured per-call rate; Travelpayouts is free.
 */
export function toolEstimate(ports: Ports, lines: readonly EstimateLine[], assumption: string): Estimate {
  const rate = ports.config.providers.searchapi?.limits.costPerCallMicroGbp ?? 0;
  const perProvider = lines.map((l) => {
    const costMicroGbp = l.providerId === 'searchapi' ? l.calls * rate : 0;
    return { ...l, costMicroGbp, costPence: microGbpToPence(costMicroGbp), seconds: 0, blocked: null };
  });
  const totalCostMicroGbp = perProvider.reduce((n, l) => n + l.costMicroGbp, 0);
  return {
    cells: 0,
    perProvider,
    totalCalls: lines.reduce((n, l) => n + l.calls, 0),
    totalPlanCalls: lines.reduce((n, l) => n + l.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: microGbpToPence(totalCostMicroGbp),
    seconds: 0,
    assumptions: [assumption],
    windowClamped: false,
    retryFactor: 1,
  };
}

/** What varies between the two tools' hidden executions; everything else of the definition is fixed here. */
export interface HiddenRun {
  tool: 'record:fixtures' | 'smoke:live';
  origins: Iata[];
  destinations: Iata[];
  from: IsoDate;
  to: IsoDate;
  minNights: number;
  maxNights: number;
  cabin: Cabin;
  expandTop: number;
  /** The operator's `--budget`; the run's SearchApi cap is min(budget, worst.credits) (cost-wp4b-011, decision 66). */
  budget: number;
  worst: WorstCase;
  /** The free-call cap the guard enforces for this run. */
  maxFreeCalls: number;
  estimate: Estimate;
}

/**
 * A tool run's hidden execution (plan decision 5): the guard reads execution caps from the snapshot, and the ledger's
 * execution_id references search_executions, so a tool run needs a real execution. The definition is created and
 * soft-deleted in one transaction, the snapshot is built from the deleted row (prov-wp04b-009) at the instant that
 * named it, and the snapshot budget freezes the run's caps: SearchApi calls min(--budget, worst case), so the guard
 * enforces exactly the figure the dry run printed and never more than --budget, for both tools (cost-wp4b-011, decision
 * 66). Its space mirrors the run's only to satisfy the definition schema; nothing seeds cells for it, and spec §8.1
 * never resumes or schedules a deleted definition.
 */
export function openHiddenExecution(ports: Ports, run: HiddenRun): string {
  const now = ports.clock.now();
  const rate = ports.config.providers.searchapi?.limits.costPerCallMicroGbp ?? 0;
  const maxCalls = Math.min(run.budget, run.worst.credits);
  const input: DefinitionInput = {
    name: `${run.tool} ${now} (hidden tool run)`,
    origins: run.origins,
    destinations: run.destinations,
    window: { kind: 'absolute', from: run.from, to: run.to },
    minNights: run.minNights,
    maxNights: run.maxNights,
    cabin: run.cabin,
    constraints: {},
    verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: run.expandTop, bookingLinks: true },
    budget: { maxCalls, maxFreeCalls: run.maxFreeCalls, maxCostMicroGbp: maxCalls * rate },
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
    if (deleted === null) throw new Error('hidden tool definition vanished');
    return deleted;
  });
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: {
      origins: run.origins,
      destinations: run.destinations,
      departureFrom: run.from,
      departureTo: run.to,
      minNights: run.minNights,
      maxNights: run.maxNights,
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
    estimate: run.estimate,
    trigger: 'tool',
    status: 'running',
  }).id;
}

/** The record tool's position: its plan's worst case against `--budget` (plan decision 20). */
export function budgetPosition(
  ports: Ports,
  a: RecordArgs,
  plan: readonly PlannedCall[],
): { lines: string[]; rerunNeedsConfirm: boolean; windowRefusals: string[] } {
  const t = planTotals(plan);
  return spendPosition(ports, { credits: t.worstCaseCredits, freeCalls: t.worstCaseFreeCalls }, a.budget);
}

/** The record tool's hidden execution over the calendar rectangle's space (plan decision 5). */
export function openRecordingExecution(ports: Ports, a: RecordArgs, plan: readonly PlannedCall[]): string {
  const t = planTotals(plan);
  const from = firstDayOf(a.month);
  return openHiddenExecution(ports, {
    tool: 'record:fixtures',
    origins: a.origins,
    destinations: a.destinations,
    from,
    to: addDays(from, CALENDAR_OUT_DAYS - 1),
    minNights: RECORD_MIN_NIGHTS,
    maxNights: RECORD_MAX_NIGHTS,
    cabin: RECORD_TRAVEL_CLASS,
    expandTop: 1,
    budget: a.budget,
    worst: { credits: t.worstCaseCredits, freeCalls: t.worstCaseFreeCalls },
    maxFreeCalls: ports.config.spend.executionMaxFreeCalls,
    estimate: toolEstimate(
      ports,
      [
        {
          providerId: 'travelpayouts',
          stage: 'discovery',
          calls: t.worstCaseFreeCalls,
          planCalls: t.freeCalls,
        },
        // why: every planned first attempt, the unbilled 401 probe included, so parity with the ledger's rows holds (cost M-1)
        { providerId: 'searchapi', stage: 'verification', calls: t.worstCaseCredits, planCalls: t.saCalls },
      ],
      'record:fixtures plan: SearchApi calls at worst-case credits; Travelpayouts calls at the page cap',
    ),
  });
}
