import {
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type DiscoveryCapability,
  type Execution,
  microGbpToPence,
  type ProviderId,
  type SourceKind,
  type Stage,
} from '@gmt/core';
import { callsLeftIn, providerWindow } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { type LineKey, lineKey } from './lines.js';
import { disabledFor, resumableCells } from './run.js';
import { type PlannedTile, planTiles } from './stages/discovery.js';
import { reusableFor, reuseCriteriaFor } from './stages/reuse.js';
import { itineraryQuery } from './stages/verification.js';
import type { Estimate } from './types.js';

/** Typical wall time per call by source kind (spec §2: SearchApi calendar 9–29 s; Travelpayouts about 1 s; the fixture is local). */
export const SECONDS_PER_CALL: Readonly<Record<SourceKind, number>> = {
  'authorised-cached': 1,
  'scraped-aggregate': 20,
  'scraped-search': 15,
  // why: camoufox's seconds are pages × (spacing + 40) on its own line (brief WP14 Task 14.9), not a per-call figure.
  'scraped-self': 0,
  synthetic: 0,
};

/** The totals of an estimate over the lines given (one sum, shared by assemble, addPass and withBlocked). */
function totalsOf(
  lines: Estimate['perProvider'],
): Pick<Estimate, 'totalCalls' | 'totalPlanCalls' | 'totalCostMicroGbp' | 'totalCostPence' | 'seconds'> {
  const totalCostMicroGbp = lines.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    totalCalls: lines.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: lines.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: microGbpToPence(totalCostMicroGbp),
    seconds: lines.reduce((a, p) => a + p.seconds, 0),
  };
}

interface Line {
  providerId: ProviderId;
  stage: Stage;
  rawCalls: number;
  rawCostMicroGbp: number;
  rawSeconds: number;
  /** A provider's own per-execution cap (camoufox pages): calls and seconds are clamped to it after the factor. */
  cap?: { calls: number; seconds: number };
  /** camoufox grid: the scrolls beside the pages (spec §2 rev 34). */
  scrolls?: number;
  /** Ruling 13: a provider that never retries (camoufox) carries no retry factor. */
  noRetry?: true;
}

function assemble(
  ctx: EngineContext,
  lines: readonly Line[],
  cells: number,
  windowClamped: boolean,
  assumptions: readonly string[],
): Estimate {
  const factor = ctx.config.estimateRetryFactor;
  const perProvider = lines.map((l) => {
    const f = l.noRetry === true ? 1 : factor;
    const costMicroGbp = Math.ceil(l.rawCostMicroGbp * f);
    // why: cost-004: the guard refuses a page past the snapshot cap, so the factor can never ask for more than it
    const clamp = (n: number, cap: number | undefined): number => (cap === undefined ? n : Math.min(n, cap));
    return {
      providerId: l.providerId,
      stage: l.stage,
      calls: clamp(Math.ceil(l.rawCalls * f), l.cap?.calls),
      planCalls: l.rawCalls,
      costMicroGbp,
      costPence: microGbpToPence(costMicroGbp),
      seconds: clamp(Math.ceil(l.rawSeconds * f), l.cap?.seconds),
      blocked: null,
      ...(l.scrolls === undefined ? {} : { scrolls: l.scrolls }),
    };
  });
  return {
    cells,
    perProvider,
    ...totalsOf(perProvider),
    assumptions: [
      `every call count includes the retry factor ${factor}`,
      ...(lines.some((l) => l.noRetry === true)
        ? ['camoufox never retries: its pages, scrolls and seconds carry no retry factor']
        : []),
      ...assumptions,
    ],
    windowClamped,
    retryFactor: factor,
  };
}

/**
 * Spec §8.1 "seconds including limiter waits": the slowest of the minute window, the hour window and the pool
 * (cost-r1-011); the hour window is named in the assumptions when it binds.
 */
function waitSeconds(
  ctx: EngineContext,
  providerId: ProviderId,
  calls: number,
  secondsPerCall: number,
  notes: string[],
): number {
  const l = ctx.limitsOf(providerId);
  const minute = Math.ceil((calls * 60) / l.ratePerMinute);
  const hour = calls > l.ratePerHour ? Math.floor((calls - 1) / l.ratePerHour) * 3600 : 0;
  const pool = Math.ceil((calls * secondsPerCall) / l.concurrency);
  if (hour > Math.max(minute, pool))
    notes.push(
      `${providerId}: ${calls} calls exceed its ${l.ratePerHour} an hour, so the hourly window sets the time`,
    );
  return Math.max(minute, hour, pool);
}

/**
 * One discovery provider's plan over the cells: the cells it can reuse, the rest (`fresh`) and the tiles planned for
 * those. The one place the estimate's calls (discoveryLine) and the date pairs it asks about (`askedPairs`) read the
 * plan from, so the two can never disagree about which cells a provider would fetch.
 */
function planDiscovery(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cap: DiscoveryCapability,
  cells: readonly CellKey[],
  definitionId: string | null,
  /** The tiles already planned over every cell (no reuse): used as they are when no cell here is reusable. */
  known?: readonly PlannedTile[],
  /** Where a plan over every cell (no reuse) is left for a later reader (`PlanMemo`). */
  keep?: Map<ProviderId, readonly PlannedTile[]>,
): { reused: CellKey[]; fresh: CellKey[]; planned: readonly PlannedTile[] } {
  const reusedCopies =
    definitionId === null
      ? []
      : reusableFor(
          ctx,
          definitionId,
          snapshot,
          providerId,
          reuseCriteriaFor(ctx, snapshot, providerId, cap.info),
          cells,
        );
  const reusedKeys = new Set(reusedCopies.map((r) => cellKeyString(r.cell)));
  const fresh = cells.filter((c) => !reusedKeys.has(cellKeyString(c)));
  // why: a plan over every cell is the same plan whoever asks (the estimate or the date pairs it asks about), so it is
  // made once; a provider with reusable cells plans the rest again, since a tile may hold cells that are no longer asked
  const planned =
    fresh.length === 0
      ? []
      : known !== undefined && reusedCopies.length === 0
        ? known
        : planTiles(providerId, cap, snapshot, fresh);
  if (reusedCopies.length === 0) keep?.set(providerId, planned);
  return { reused: reusedCopies.map((r) => r.cell), fresh, planned };
}

/**
 * The tiles an estimate planned over every cell, provider by provider, kept so the date pairs it asks about are read
 * from the same plan (one snapshot, one plan; Task 20.4 fix round 1).
 */
export interface PlanMemo {
  snapshot: DefinitionSnapshot;
  cells: readonly CellKey[];
  plans: ReadonlyMap<ProviderId, readonly PlannedTile[]>;
}

function discoveryLine(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cells: readonly CellKey[],
  definitionId: string | null,
  notes: string[],
  /** The execution a resume continues (its pages already loaded count against the cap); null for a start. */
  executionId: string | null = null,
  /** Where this line leaves its plan over every cell, for `askedPairs` (a start's save-time estimate only). */
  keep?: Map<ProviderId, readonly PlannedTile[]>,
): Line | null {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.discovery;
  if (provider === undefined || cap === undefined) return null;
  if (!provider.cabins.includes(snapshot.cabin)) {
    notes.push(`${providerId}: does not offer ${snapshot.cabin}; no calls (cabin-not-offered)`);
    return { providerId, stage: 'discovery', rawCalls: 0, rawCostMicroGbp: 0, rawSeconds: 0 };
  }
  const { reused, fresh, planned } = planDiscovery(
    ctx,
    snapshot,
    providerId,
    cap,
    cells,
    definitionId,
    undefined,
    keep,
  );
  if (reused.length > 0)
    notes.push(`${providerId}: ${reused.length} cells reuse earlier prices and are not planned`);
  const tiles = planned.length;
  // why: cost-r1-007 — planCalls counts tiles; a tile that pages spends a call a page, so discovery overrun is judged on
  // distinct tiles (LedgerRepo.countsFor tiles), never on calls
  if (tiles > 0)
    notes.push(`${providerId}: ${tiles} discovery tiles planned; a tile that pages spends one call a page`);
  const l = ctx.limitsOf(providerId);
  const pageCap = snapshot.budget.providerMaxCalls?.[providerId];
  if (pageCap !== undefined && l.minSpacingSeconds !== null) {
    // why: spec §2 rev 32, cost-004/009/011, prov-013: one page per cell, at most the snapshot's page cap a run; a page
    // takes about 20–60 s plus the start-to-start spacing, estimated as spacing + 40 s
    const perPage = l.minSpacingSeconds + 40;
    // why: fix round 1 (CodeRabbit): a resume has the cap less the pages this execution already loaded; with none left
    // the line still asks one page, so checkBudget's provider-execution check refuses the resume instead of the guard
    const used =
      executionId === null
        ? 0
        : ctx.budget.usage({ kind: 'provider-execution', executionId, providerId }).calls;
    const left = Math.max(0, pageCap - used);
    const pages = tiles === 0 ? 0 : left === 0 ? 1 : Math.min(tiles, left);
    const perTile = cap.estimateTile;
    if (perTile !== undefined) {
      // why: spec §2 rev 34 (CB-3): the run's pages are the first `pages` of the plan; each states its own scrolls and
      // seconds (the provider's estimateTile: the page time and the measured scroll time)
      const run = planned.slice(0, pages).map((t) => perTile(t.plan));
      const scrolls = run.reduce((n, t) => n + t.scrolls, 0);
      const seconds = run.reduce((n, t) => n + t.seconds, 0);
      const read = planned.slice(0, pages).reduce((n, t) => n + t.plan.coveredCells.length, 0);
      notes.push(
        `${providerId} grid mode reads ${read} of ${fresh.length} cells this run in ${pages} pages and ${scrolls} scrolls; a full pass takes ${Math.max(1, Math.ceil(tiles / pageCap))} run${Math.ceil(tiles / pageCap) > 1 ? 's' : ''}`,
      );
      // why: CB-7: at the maximum spacing and per-page scrolls a run can outlast the stuck-run threshold; say so
      const stuck = ctx.config.stuckAfterHours;
      if (seconds > stuck * 3600)
        notes.push(
          `${providerId}: this run takes about ${(seconds / 3600).toFixed(1)} h, past STUCK_AFTER_HOURS (${stuck} h), so /health reports it stuck while it runs`,
        );
      return {
        providerId,
        stage: 'discovery',
        rawCalls: pages,
        rawCostMicroGbp: 0,
        rawSeconds: seconds,
        cap: { calls: Math.max(left, 1), seconds: Math.ceil(seconds) },
        scrolls,
        noRetry: true,
      };
    }
    if (fresh.length > 0)
      notes.push(
        `${providerId} list mode prices ${pages} of ${fresh.length} cells this run; a full pass takes ${Math.ceil(fresh.length / pageCap)} runs; the month cap allows about ${l.monthlyCallCap} cells`,
      );
    return {
      providerId,
      stage: 'discovery',
      rawCalls: pages,
      rawCostMicroGbp: 0,
      rawSeconds: pages * perPage,
      // why: fix round 2 (CodeRabbit): the retry factor is clamped to the pages this execution has left (one when none
      // are, which checkBudget refuses), never to the whole cap
      cap: { calls: Math.max(left, 1), seconds: Math.max(left, 1) * perPage },
      // why: ruling 13: camoufox never retries, so its estimate is the plan's own
      noRetry: true,
    };
  }
  return {
    providerId,
    stage: 'discovery',
    rawCalls: tiles,
    rawCostMicroGbp: tiles * l.costPerCallMicroGbp,
    rawSeconds: waitSeconds(ctx, providerId, tiles, SECONDS_PER_CALL[cap.info.sourceKind], notes),
  };
}

function verificationLine(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cellCount: number,
  sample: CellKey | undefined,
  notes: string[],
): Line | null {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined || sample === undefined || cellCount === 0) return null;
  if (!provider.cabins.includes(snapshot.cabin))
    return { providerId, stage: 'verification', rawCalls: 0, rawCostMicroGbp: 0, rawSeconds: 0 };
  const per = cap.estimate(itineraryQuery(snapshot, sample));
  notes.push(
    `${providerId}: verification of up to ${cellCount} cells at ${per.calls} calls each${per.notes.length > 0 ? ` (${per.notes.join('; ')})` : ''}`,
  );
  const calls = cellCount * per.calls;
  return {
    providerId,
    stage: 'verification',
    rawCalls: calls,
    rawCostMicroGbp: cellCount * per.costMicroGbp,
    rawSeconds: Math.max(
      waitSeconds(ctx, providerId, calls, 0, notes),
      Math.ceil((cellCount * per.seconds) / ctx.limitsOf(providerId).concurrency),
    ),
  };
}

/**
 * Spec §8.1 "Estimate = Σ discovery plan(q with cells = non-reused cells).length per pair, using the same reuse query
 * as the run, + maxCells × verification.estimate, all × ESTIMATE_RETRY_FACTOR". `planCalls` keep the pre-factor plan
 * (the overrun baseline). `definitionId` null plans every cell: the save-time worst case without reuse (ruling 9),
 * which is what `confirmed_cost_pence` records; a start passes its definition so the run-time estimate applies reuse.
 */
export function estimateStart(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  cells: readonly Cell[],
  definitionId: string | null,
  /** Receives each discovery provider's plan over every cell, when the estimate assumes no reuse (`definitionId` null). */
  keep?: Map<ProviderId, readonly PlannedTile[]>,
): Estimate {
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    const l = discoveryLine(ctx, snapshot, id, cells, definitionId, notes, null, keep);
    if (l !== null) lines.push(l);
  }
  const verifyCount = Math.min(snapshot.verification.maxCells, cells.length);
  for (const id of snapshot.providers.verification) {
    const l = verificationLine(ctx, snapshot, id, verifyCount, cells[0], notes);
    if (l !== null) lines.push(l);
  }
  if (definitionId === null) notes.push('every cell is planned: no reuse of earlier prices is assumed');
  if (snapshot.windowClamped) notes.push('window clamped to start tomorrow');
  return assemble(ctx, lines, cells.length, snapshot.windowClamped, notes);
}

function firstCellOf(ctx: EngineContext, executionId: string): CellKey | undefined {
  const first = ctx.repos.cells.outcomes(executionId)[0];
  return first === undefined
    ? undefined
    : {
        origin: first.origin,
        destination: first.destination,
        departureDate: first.departureDate,
        returnDate: first.returnDate,
      };
}

/**
 * Spec §8.1 "estimateRemaining (resumable tiles + remaining selected cells × estimate × factor)", over the cells the
 * resumed pass will fetch, read through `resumableCells`, the pass's own predicate: departed cells are left out
 * (po-016) and marked skipped:departed only in the claim, so this read needs no write first (arch-r2-006).
 */
export function estimateRemainingFor(ctx: EngineContext, exec: Execution, manual: boolean): Estimate {
  const snapshot = exec.snapshot;
  const disabled = disabledFor(ctx, exec.id, manual);
  const remaining = (stage: Stage, id: ProviderId) =>
    disabled.has(id) ? [] : resumableCells(ctx, exec.id, stage, id, manual);
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    // why: ssr M2 — the same reuse query the pass applies, so a cell another run has priced since is not counted
    const l = discoveryLine(ctx, snapshot, id, remaining('discovery', id), exec.definitionId, notes, exec.id);
    if (l !== null) lines.push(l);
  }
  const seeded = ctx.repos.cells.hasVerificationOutcomes(exec.id);
  const total = ctx.repos.cells.rollUps(exec.id).size;
  for (const id of snapshot.providers.verification) {
    const cells = seeded ? remaining('verification', id) : [];
    // why: re-review N2 — a provider an automatic resume keeps disabled makes no verification call, seeded or not
    const count = seeded
      ? cells.length
      : disabled.has(id)
        ? 0
        : Math.min(snapshot.verification.maxCells, total);
    const sample =
      cells[0] ?? exec.cell ?? snapshot.verification.alwaysInclude[0] ?? firstCellOf(ctx, exec.id);
    const l = verificationLine(ctx, snapshot, id, count, sample, notes);
    if (l !== null) lines.push(l);
  }
  return assemble(ctx, lines, total, snapshot.windowClamped, notes);
}

/**
 * The stored estimate after a resumed pass: its plan added line by line (cost-r1-009), so View D's overrun rule
 * (ledger calls > pre-factor plan + 10%) judges every pass the execution made, retries included.
 */
export function addPass(stored: Estimate | null, pass: Estimate): Estimate {
  if (stored === null) return pass;
  const lines = stored.perProvider.map((l) => ({ ...l }));
  for (const p of pass.perProvider) {
    const l = lines.find((x) => x.providerId === p.providerId && x.stage === p.stage);
    if (l === undefined) lines.push({ ...p });
    else {
      l.calls += p.calls;
      l.planCalls += p.planCalls;
      l.costMicroGbp += p.costMicroGbp;
      l.costPence = microGbpToPence(l.costMicroGbp);
      l.seconds += p.seconds;
    }
  }
  return {
    ...stored,
    perProvider: lines,
    ...totalsOf(lines),
    assumptions: [...stored.assumptions, `a resumed pass planned ${pass.totalPlanCalls} more calls`],
  };
}
/**
 * The estimate with each line's `blocked` scope set from a budget check, and the totals summed over the lines that will
 * run, so the figure shown, stored and confirmed is the runnable one and a blocked provider's plan never inflates the
 * overrun baseline (cost-r1-014). Blocked lines keep their figures, so the form still shows what they would need.
 */
export function withBlocked(e: Estimate, blockedBy: ReadonlyMap<LineKey, string>): Estimate {
  const perProvider = e.perProvider.map((p) => ({
    ...p,
    blocked: blockedBy.get(lineKey(p.stage, p.providerId)) ?? null,
  }));
  const runs = perProvider.filter((p) => p.blocked === null);
  return {
    ...e,
    perProvider,
    ...totalsOf(runs),
    assumptions:
      runs.length === perProvider.length
        ? e.assumptions
        : [...e.assumptions, 'totals leave out the provider lines a budget cap blocks'],
  };
}

/**
 * What a definition's stored confirmation (`DefinitionsRepo.setConfirmed`) records for an estimate: the worst case over
 * every line, blocked ones included (ruling 9, cost M-2). The shown totals leave out the lines a cap blocks today, and
 * a confirmation of those alone would no longer cover next month's scheduled run with the provider back, which would
 * then be skipped_confirm for no reason. WP8's PUT path keeps storing this worst case; Search now's create-and-start
 * and Repeat weekly's Save store the shown runnable totals instead (the api's `runnableTotalsOf`, spec revision 55 §7).
 */
export function confirmationOf(e: Pick<Estimate, 'perProvider'>): { pence: number; calls: number } {
  const all = totalsOf(e.perProvider);
  return { pence: all.totalCostPence, calls: all.totalCalls };
}

/**
 * What an estimate asks of the date pairs (spec §8.1 rev 55; the date-pairs words of §10): counts over the distinct
 * (departure, return) pairs of the search space. A date pair is **covered** when every one of its airport pairs is
 * planned, **partly** covered when some but not all are, and **reused** when none is planned and every airport pair is
 * reused from an earlier run. Coverage counts planned cells only; a reused cell is never counted as asked.
 *
 * The three need not add up to `datePairs`: a date pair with no planned airport pair and only some of them reused (a
 * search widened to a new airport, or a line a cap blocks) is in none of them. The web words the remainder as the date
 * pairs not asked this run, never as reused.
 */
export interface AskedPairs {
  datePairs: number;
  datePairsCovered: number;
  datePairsPartly: number;
  datePairsReused: number;
}

/**
 * The cells the runnable discovery lines would plan, and the cells they would reuse (spec §8.1 rev 55). Each
 * provider's plan is cut at the lesser of its per-run page cap (a provider with page spacing, camoufox) and what its
 * monthly or lifetime window has left; a blocked line (`blocked` set by a budget check) plans nothing, but its reused
 * cells still stand, since reuse makes no call. Two providers planning the same cell count it once.
 *
 * `known` is the plan the estimate made over every cell (see `PlanMemo`); it is used as it stands for a provider with
 * nothing reusable, so the estimate and its date pairs are read from one plan.
 */
export function askedPairs(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  cells: readonly CellKey[],
  definitionId: string | null,
  blocked: ReadonlySet<LineKey>,
  known: ReadonlyMap<ProviderId, readonly PlannedTile[]> = new Map(),
): AskedPairs {
  const planned = new Set<string>();
  const reused = new Set<string>();
  for (const id of snapshot.providers.discovery) {
    const provider = ctx.providers.get(id);
    const cap = provider?.discovery;
    if (provider === undefined || cap === undefined || !provider.cabins.includes(snapshot.cabin)) continue;
    const plan = planDiscovery(ctx, snapshot, id, cap, cells, definitionId, known.get(id));
    for (const c of plan.reused) reused.add(cellKeyString(c));
    if (blocked.has(lineKey('discovery', id))) continue;
    const pageCap = snapshot.budget.providerMaxCalls?.[id];
    const perRun = pageCap !== undefined && ctx.limitsOf(id).minSpacingSeconds !== null ? pageCap : Infinity;
    // why: belt and braces. A line the budget guard would stop is already `blocked`, and a run of a line that fits its
    // window plans no more than the window leaves; the real flow reaches this cut only when `checkBudget` has not
    // blocked the line (a run it lets start and the guard then stops part way). It uses `callsLeftIn`, the same
    // reading `checkBudget` takes, other schedules' reservations included.
    // Known limit: a tile that pages spends one call a page, but is cut here by tile count, not calls, so a paging
    // provider's coverage may be overstated when its window is nearly spent.
    const allowed = Math.min(plan.planned.length, perRun, callsLeftIn(ctx, id, definitionId) ?? Infinity);
    for (const tile of plan.planned.slice(0, allowed))
      for (const c of tile.plan.coveredCells) planned.add(cellKeyString(c));
  }
  const byPair = new Map<string, CellKey[]>();
  for (const c of cells) {
    const key = `${c.departureDate}|${c.returnDate}`;
    const list = byPair.get(key);
    if (list === undefined) byPair.set(key, [c]);
    else list.push(c);
  }
  let covered = 0;
  let partly = 0;
  let reusedPairs = 0;
  for (const pair of byPair.values()) {
    const asked = pair.filter((c) => planned.has(cellKeyString(c))).length;
    if (asked === pair.length) covered++;
    else if (asked > 0) partly++;
    else if (pair.every((c) => reused.has(cellKeyString(c)))) reusedPairs++;
  }
  return {
    datePairs: byPair.size,
    datePairsCovered: covered,
    datePairsPartly: partly,
    datePairsReused: reusedPairs,
  };
}

/** One billable-plan provider's runnable calls and what its window has left (spec §10 estimate `billedCalls`). */
export interface BilledCalls {
  providerId: ProviderId;
  calls: number;
  /** The calls left in the provider's window; null without a cap. */
  left: number | null;
  /** Which window `left` is: the month, or the lifetime of a trial. */
  window: 'month' | 'lifetime';
}

/** The browser worker's month as the estimate sees it: this run's pages and the pages the month has left. */
export interface MonthlyPages {
  planned: number;
  left: number;
}

/**
 * The runnable (unblocked) lines of billable-plan providers, one entry a provider with its calls summed over stages
 * and the calls its window has left (cost-003): what the form words as "uses about 120 of the 9,880 searches left".
 */
export function billedCallsOf(
  ctx: EngineContext,
  estimate: Pick<Estimate, 'perProvider'>,
  definitionId: string | null,
): BilledCalls[] {
  const byProvider = new Map<ProviderId, number>();
  for (const p of estimate.perProvider) {
    if (p.blocked !== null || !ctx.limitsOf(p.providerId).billed) continue;
    byProvider.set(p.providerId, (byProvider.get(p.providerId) ?? 0) + p.calls);
  }
  return [...byProvider].map(([providerId, calls]) => ({
    providerId,
    calls,
    left: callsLeftIn(ctx, providerId, definitionId),
    window: ctx.limitsOf(providerId).capKind === 'provider-lifetime' ? 'lifetime' : 'month',
  }));
}

/**
 * The browser worker's pages this run asks for and the pages its month has left, when camoufox is a runnable line;
 * else null (cost-018, persona-005, ruling A31). Flight-list pages join `planned` in Task 20.9 (ruling A23).
 */
export function monthlyPagesOf(
  ctx: EngineContext,
  estimate: Pick<Estimate, 'perProvider'>,
  definitionId: string | null,
): MonthlyPages | null {
  const lines = estimate.perProvider.filter((p) => p.providerId === 'camoufox' && p.blocked === null);
  if (lines.length === 0) return null;
  // why: the month's pages less what other schedules reserve, exactly as checkBudget reads it (providerWindow); a guard
  // without a cap falls back to the configured monthly page cap
  const { usage, reserved } = providerWindow(ctx, 'camoufox', definitionId);
  const cap = usage.cap ?? ctx.limitsOf('camoufox').monthlyCallCap;
  return {
    planned: lines.reduce((a, p) => a + p.calls, 0),
    left: Math.max(0, cap - usage.calls - reserved),
  };
}
