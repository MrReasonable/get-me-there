import {
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type DiscoveryCapability,
  datePairCount,
  type Execution,
  FLIGHT_LIST_COUNT,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  type FlightListsState,
  flightLimitsOf,
  microGbpToPence,
  type ProviderId,
  RETURN_PHASE_SECONDS_MAX,
  RETURN_SECOND_OUTBOUND_RATE,
  RETURN_SPACED_LOADS,
  RETURN_STEP_SECONDS,
  type SourceKind,
  type Stage,
} from '@gmt/core';
import { callsLeftIn } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { type LineKey, lineKey } from './lines.js';
import { disabledFor, resumableCells } from './run.js';
import { type PlannedTile, planTiles } from './stages/discovery.js';
import { newestListOf, selectFlightPairs } from './stages/flightLists/select.js';
import { FLIGHT_LIST_PROVIDER, returnPhaseOf } from './stages/flightLists.js';
import { refreshHoursOf, reusableFor, reuseCriteriaFor } from './stages/reuse.js';
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

/**
 * The totals of an estimate over the lines given (one sum, shared by assemble, addPass and withBlocked). Spec rev 55
 * §8.1: the flight-list step's seconds count in `seconds` (and so in the browser window's end); its pages never in
 * `totalCalls`.
 */
function totalsOf(
  lines: Estimate['perProvider'],
  flights?: Estimate['flightLists'],
): Pick<Estimate, 'totalCalls' | 'totalPlanCalls' | 'totalCostMicroGbp' | 'totalCostPence' | 'seconds'> {
  const totalCostMicroGbp = lines.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    totalCalls: lines.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: lines.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: microGbpToPence(totalCostMicroGbp),
    seconds: lines.reduce((a, p) => a + p.seconds, 0) + (flights?.seconds ?? 0),
  };
}

/**
 * The flight line's assumption (spec rev 56 §8.1): "+ flights, out and back, for up to N date pairs: …" with the return
 * leg, "+ flights for up to N date pairs, about M minutes" without.
 */
const FLIGHT_NOTE = '+ flights';
/**
 * Whether an assumption is one of the flight line's: its clause, or the cap that cut it ("flights for N date pairs: …",
 * "flights for 1 date pair out and back: …"; preflight A21: the singular and the out-and-back forms too).
 */
const isFlightNote = (a: string): boolean =>
  a.startsWith(FLIGHT_NOTE) || /^flights for \d+ date pairs?\b/.test(a);

/** "1 date pair", "4 date pairs". */
const datePairs = (n: number): string => `${n} date pair${n === 1 ? '' : 's'}`;
/** Whole minutes of `seconds`, rounded, with their noun ("41 minutes", "1 minute"). */
const minutes = (seconds: number): string => {
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
};

/**
 * Spec revision 55 §8.1: whether a pass over `snapshot` runs the flight-list step at all, as far as an estimate can
 * tell before the run: camoufox in discovery (a catch-up's planned snapshot has left it out), its flight-list capability
 * reading the snapshot's cabin, and the snapshot's own allowance.
 */
function flightsApply(ctx: EngineContext, snapshot: DefinitionSnapshot): boolean {
  if (!snapshot.providers.discovery.includes(FLIGHT_LIST_PROVIDER)) return false;
  const cap = ctx.providers.get(FLIGHT_LIST_PROVIDER)?.flightLists;
  return cap?.cabins.includes(snapshot.cabin) === true && (snapshot.budget.flightListPages ?? 0) > 0;
}

/**
 * The date pairs a fresh step would read for a saved search (`wanted`): the first 10 of the space less those whose
 * newest list is reusable (the step's own selection over the board's ranking, under the return phase it would plan);
 * an unsaved search, or an engine without the ranking, reuses none. `candidates` is the count the step's plan judges
 * the return phase over (`planOf`: the not-departed first 10 of the ranking, reused ones included; 21.6 review M5).
 */
function flightPairsWanted(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  definitionId: string | null,
): { wanted: number; candidates: number } {
  const most = Math.min(FLIGHT_LIST_COUNT, datePairCount(snapshot.resolved));
  const reader = ctx.rankedDatePairs;
  if (definitionId === null || reader === undefined) return { wanted: most, candidates: most };
  const now = ctx.clock.now();
  const today = ctx.clock.todayLondon();
  const ranked = reader({
    definitionId,
    space: snapshot.resolved,
    cabin: snapshot.cabin,
    maxJourneyMinutes: snapshot.constraints.maxJourneyMinutes ?? null,
    now,
  })
    .filter((p) => p.departureDate > today)
    .slice(0, FLIGHT_LIST_COUNT);
  const newest = new Map(
    ctx.repos.flightLists
      .newestPerCell(definitionId, ranked, snapshot.cabin, ctx.pointOfSaleOf(FLIGHT_LIST_PROVIDER))
      .map((l) => [cellKeyString(l), newestListOf(l)]),
  );
  const reused = selectFlightPairs(
    ranked,
    newest,
    now,
    refreshHoursOf(snapshot, FLIGHT_LIST_PROVIDER),
    today,
    {
      ...estimatePhaseOf(ctx, snapshot, ranked.length),
      current: flightLimitsOf(snapshot.constraints),
    },
  ).reused;
  return { wanted: Math.max(0, most - reused.length), candidates: ranked.length };
}

/** The return phase a flight line plans (spec rev 56 §8.1): from the worker's flags, or a stored plan's. */
interface FlightPhase {
  returns: boolean;
  booking: boolean;
}

/**
 * The return phase an estimate counts (final review B-M3; prov-008, 21.6 N2: an estimate never understates): the
 * step's own (`returnPhaseOf`) once the worker's flags are read; while they are unread (no preflight since the app
 * started) the bound, the return phase with the booking read, since the run's own discovery preflight may set them
 * and the step then plans 2 pages a pair, within the run's allowance as ever.
 */
function estimatePhaseOf(ctx: EngineContext, snapshot: DefinitionSnapshot, pairs: number): FlightPhase {
  if (ctx.workerFlags.get(FLIGHT_LIST_PROVIDER) !== null) return returnPhaseOf(ctx, snapshot, pairs);
  const returns = (snapshot.budget.flightListPages ?? 0) >= pairs * FLIGHT_LIST_PAGES_PER_PAIR_MAX;
  return { returns, booking: returns };
}

/**
 * A flight list's first view and its Cheapest flow, after the spacing: measured 2026-11-07 over ten outbound-only reads
 * at spacing 0, 19–28.5 s (23.5 s on average).
 */
const FLIGHT_VIEW_SECONDS = 25;

/**
 * Spec rev 56 §8.1 "Estimate" (R-estimate): one pair's seconds and pages, typical and at most. Out and back: the first
 * view (spacing + `FLIGHT_VIEW_SECONDS`), the return steps (`RETURN_STEP_SECONDS` × 3 with the booking read, × 1
 * without) and, for the share of pairs needing the second outbound, its spaced reload and two steps; at most the phase's
 * own bound and the one spaced reload. Outbound-only: the first view, 1 page.
 */
function perPair(spacing: number, booking: boolean) {
  const view = spacing + FLIGHT_VIEW_SECONDS;
  return {
    outbound: view,
    typical:
      view +
      RETURN_STEP_SECONDS * (booking ? 3 : 1) +
      RETURN_SECOND_OUTBOUND_RATE * (spacing + 2 * RETURN_STEP_SECONDS),
    bound:
      view + RETURN_PHASE_SECONDS_MAX[booking ? 'booking' : 'returnsOnly'] + RETURN_SPACED_LOADS * spacing,
  };
}

/**
 * CAMOUFOX_PAGES_AT_ONCE: `pairs` requests of `each` seconds read that many at a time, so in waves of that many, each
 * wave as long as one request, but never quicker than their `pages` starts spaced apart (the spacing runs start to start
 * across every page in flight). At one at a time it is `pairs × each`.
 */
function inWaves(
  pairs: number,
  each: number,
  pages: number,
  l: { concurrency: number; minSpacingSeconds: number | null },
): number {
  if (pairs === 0 || l.concurrency <= 1) return pairs * each;
  return Math.max(Math.ceil(pairs / l.concurrency) * each, pages * (l.minSpacingSeconds ?? 0));
}

/**
 * Spec revision 56 §8.1 "Estimate": adds the flight-list step's line to an assembled estimate. `pairs` is the date
 * pairs the step would read (its pages count against no free-call cap, spec rev 65; the step's own allowance holds
 * them). With the return leg every pair goes out and back; without it, outbound-only. `pages` and `seconds` are the
 * typical figures (1.5 pages and 230 s a pair out and back at the defaults; 1 page and spacing + 25 s outbound-only),
 * `pagesMax` and `secondsMax` the bound (2 pages and 285 s), the pairs read CAMOUFOX_PAGES_AT_ONCE at a time
 * (`inWaves`). The assumptions say so.
 */
function withFlights(ctx: EngineContext, est: Estimate, wanted: number, phase: FlightPhase): Estimate {
  const pairs = Math.max(0, wanted);
  const l = ctx.limitsOf(FLIGHT_LIST_PROVIDER);
  const per = perPair(l.minSpacingSeconds ?? 0, phase.booking);
  const outAndBack = phase.returns ? pairs : 0;
  const outbound = phase.returns ? 0 : pairs;
  const pagesMax = outAndBack * FLIGHT_LIST_PAGES_PER_PAIR_MAX + outbound;
  const pages = Math.min(Math.ceil(outAndBack * (1 + RETURN_SECOND_OUTBOUND_RATE)) + outbound, pagesMax);
  // why: a plan is all out and back or all outbound-only, so one of the two terms is always 0 (no pairs, no seconds)
  const seconds = Math.ceil(
    inWaves(outAndBack, per.typical, pages, l) + inWaves(outbound, per.outbound, outbound, l),
  );
  const secondsMax = Math.ceil(
    inWaves(outAndBack, per.bound, pagesMax, l) + inWaves(outbound, per.outbound, outbound, l),
  );
  // why: no "+ flights" clause when no date pair is read (20.9 review finding 6)
  const notes =
    pairs === 0
      ? []
      : outAndBack > 0
        ? [
            `${FLIGHT_NOTE}, out and back, for up to ${datePairs(pairs)}: usually about ${pages} pages and ${minutes(seconds)}, at most ${pagesMax} pages and ${minutes(secondsMax)}`,
          ]
        : [`${FLIGHT_NOTE} for up to ${datePairs(pairs)}, about ${minutes(seconds)}`];
  // why: 21.7 code I1: `returns` says a pair goes out and back (at least one candidate gets a return phase); the bound
  // stays whenever the plan reads the return leg
  const flightLists = phase.returns
    ? { pairs, pages, seconds, pagesMax, secondsMax, returns: outAndBack > 0 }
    : { pairs, pages, seconds, returns: false };
  return {
    ...est,
    seconds: est.seconds + seconds,
    flightLists,
    assumptions: [...est.assumptions, ...notes],
  };
}

/**
 * Spec rev 56 §8.2 (ruling D5): the margin the browser window carries beyond 1.5 × the estimate's seconds when its
 * flight line plans the return leg: one return-phase request's `flightRequestSeconds` (780 s with the booking read,
 * 600 s without, at the defaults), so the last pairs of a typical run are not refused at the gate; 0 otherwise. The
 * booking read is the one the line was estimated with (21.6 review M2): a stored plan's (less what a transient end
 * stopped), as a resume's remaining estimate reads it, else the worker's flags, as a fresh estimate reads them (the
 * booking read while they are unread: final review B-M3).
 */
export function flightWindowMarginSeconds(
  ctx: EngineContext,
  est: Pick<Estimate, 'flightLists'>,
  plan: FlightListsState | null,
): number {
  const f = est.flightLists;
  if (f?.returns !== true || (f.pairs ?? f.pages) === 0) return 0;
  const seconds = ctx.limitsOf(FLIGHT_LIST_PROVIDER).flightRequestSeconds;
  if (seconds === null) return 0;
  // why: final review B-M3: flags not yet read count as the bound (the booking read), as the estimate's own line does
  const flags = ctx.workerFlags.get(FLIGHT_LIST_PROVIDER);
  const booking =
    plan === null
      ? flags === null || flags.BOOKING_SELECT_VERIFIED === true
      : plan.booking && plan.bookingStopped === null;
  return booking ? seconds.booking : seconds.returnsOnly;
}

interface Line {
  providerId: ProviderId;
  stage: Stage;
  rawCalls: number;
  rawCostMicroGbp: number;
  rawSeconds: number;
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
    return {
      providerId: l.providerId,
      stage: l.stage,
      calls: Math.ceil(l.rawCalls * f),
      planCalls: l.rawCalls,
      costMicroGbp,
      costPence: microGbpToPence(costMicroGbp),
      seconds: Math.ceil(l.rawSeconds * f),
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
 * CAMOUFOX_PAGES_AT_ONCE: `seconds` of pages one after another, run `concurrency` at a time, but never quicker than their
 * starts allow (the page spacing runs start to start across every page in flight). At one at a time it is `seconds`.
 */
function atOnce(
  seconds: number,
  pages: number,
  l: { concurrency: number; minSpacingSeconds: number | null },
): number {
  if (l.concurrency <= 1) return seconds;
  return Math.max(Math.ceil(seconds / l.concurrency), pages * (l.minSpacingSeconds ?? 0));
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
  if (l.minSpacingSeconds !== null) {
    // why: spec §2 rev 32, cost-004/009/011, prov-013: one page per tile and no page cap a run (spec rev 65); a list
    // page takes about 20–60 s plus the start-to-start spacing, estimated as spacing + 40 s
    const perPage = l.minSpacingSeconds + 40;
    const perTile = cap.estimateTile;
    if (perTile !== undefined) {
      // why: spec §2 rev 34 (CB-3): each page states its own scrolls and seconds (the provider's estimateTile: the page
      // time and the measured scroll time)
      const run = planned.map((t) => perTile(t.plan));
      const scrolls = run.reduce((n, t) => n + t.scrolls, 0);
      const seconds = atOnce(
        run.reduce((n, t) => n + t.seconds, 0),
        tiles,
        l,
      );
      if (fresh.length > 0)
        notes.push(
          `${providerId} grid mode reads ${fresh.length} cells in ${tiles} pages and ${scrolls} scrolls`,
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
        rawCalls: tiles,
        rawCostMicroGbp: 0,
        rawSeconds: seconds,
        scrolls,
        noRetry: true,
      };
    }
    return {
      providerId,
      stage: 'discovery',
      rawCalls: tiles,
      rawCostMicroGbp: 0,
      rawSeconds: atOnce(tiles * perPage, tiles, l),
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
    const l = discoveryLine(ctx, snapshot, id, cells, definitionId, notes, keep);
    if (l !== null) lines.push(l);
  }
  const verifyCount = Math.min(snapshot.verification.maxCells, cells.length);
  for (const id of snapshot.providers.verification) {
    const l = verificationLine(ctx, snapshot, id, verifyCount, cells[0], notes);
    if (l !== null) lines.push(l);
  }
  if (definitionId === null) notes.push('every cell is planned: no reuse of earlier prices is assumed');
  if (snapshot.windowClamped) notes.push('window clamped to start tomorrow');
  const est = assemble(ctx, lines, cells.length, snapshot.windowClamped, notes);
  if (!flightsApply(ctx, snapshot)) return est;
  const { wanted, candidates } = flightPairsWanted(ctx, snapshot, definitionId);
  return withFlights(ctx, est, wanted, estimatePhaseOf(ctx, snapshot, candidates));
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
    const l = discoveryLine(ctx, snapshot, id, remaining('discovery', id), exec.definitionId, notes);
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
  const est = assemble(ctx, lines, total, snapshot.windowClamped, notes);
  if (exec.isChild || exec.isCatchUp || !flightsApply(ctx, snapshot)) return est;
  // why: spec rev 55 §8.1 — a stored plan is kept by a resumed pass, which reads only its planned cells with no row of
  // this execution that have not departed; with none stored, the pass would select afresh
  const plan = exec.flightLists;
  const today = ctx.clock.todayLondon();
  const done = new Set(ctx.repos.flightLists.cellsOfExecution(exec.id).map(cellKeyString));
  if (plan === null) {
    const { wanted, candidates } = flightPairsWanted(ctx, snapshot, exec.definitionId);
    const phase = estimatePhaseOf(ctx, snapshot, candidates);
    return withFlights(ctx, est, wanted, phase);
  }
  const wanted = plan.cells.filter((c) => !done.has(cellKeyString(c)) && c.departureDate > today).length;
  // why: a resumed pass keeps the stored plan's return phase, less what a transient end has stopped
  const phase = {
    returns: plan.returns && plan.returnsStopped === null,
    booking: plan.booking && plan.returnsStopped === null && plan.bookingStopped === null,
  };
  return withFlights(ctx, est, wanted, phase);
}

type FlightLine = NonNullable<Estimate['flightLists']>;

/**
 * Two flight lines summed (spec rev 56 §8.1): the bound kept when either carries one (or plans a pair out and back),
 * `returns` when either sends a pair out and back.
 */
function sumFlights(a: FlightLine | undefined, b: FlightLine | undefined): FlightLine {
  const sum = (f: (x: FlightLine) => number) => (a === undefined ? 0 : f(a)) + (b === undefined ? 0 : f(b));
  const returns = a?.returns === true || b?.returns === true;
  const bound = returns || a?.pagesMax !== undefined || b?.pagesMax !== undefined;
  const base = {
    pairs: sum((x) => x.pairs ?? x.pages),
    pages: sum((x) => x.pages),
    seconds: sum((x) => x.seconds),
  };
  return bound
    ? {
        ...base,
        pagesMax: sum((x) => x.pagesMax ?? x.pages),
        secondsMax: sum((x) => x.secondsMax ?? x.seconds),
        returns,
      }
    : { ...base, returns };
}

/**
 * A flight line with every figure zeroed (a blocked browser line runs no flight step): its bound kept when it had one
 * (the plan's), and no pair out and back (21.7 code I1: `returns` only when a pair gets a return phase).
 */
function zeroFlights(f: FlightLine): FlightLine {
  return f.returns === true || f.pagesMax !== undefined
    ? { pairs: 0, pages: 0, seconds: 0, pagesMax: 0, secondsMax: 0, returns: false }
    : { pairs: 0, pages: 0, seconds: 0, returns: false };
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
  // why: spec rev 56 §8.1 — the flight figures of every pass, as the lines are summed (an older stored line, with only
  // pages and seconds, reads pairs = pages and its bound = its typical figures)
  const flights =
    stored.flightLists === undefined && pass.flightLists === undefined
      ? undefined
      : sumFlights(stored.flightLists, pass.flightLists);
  return {
    ...stored,
    perProvider: lines,
    ...totalsOf(lines, flights),
    ...(flights === undefined ? {} : { flightLists: flights }),
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
  // why: spec rev 55 §8.1 — a pass whose browser discovery line is blocked runs no flight-list step (its entry rule)
  const noFlights = e.flightLists !== undefined && blockedBy.has(lineKey('discovery', FLIGHT_LIST_PROVIDER));
  const flights = noFlights && e.flightLists !== undefined ? zeroFlights(e.flightLists) : e.flightLists;
  // why: 20.9 review finding 6 — a zeroed flight line keeps none of its words ("+ flights for up to 10 …" would be untrue)
  const kept = noFlights ? e.assumptions.filter((a) => !isFlightNote(a)) : e.assumptions;
  return {
    ...e,
    perProvider,
    ...totalsOf(runs, flights),
    ...(flights === undefined ? {} : { flightLists: flights }),
    assumptions:
      runs.length === perProvider.length
        ? kept
        : [...kept, 'totals leave out the provider lines a budget cap blocks'],
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
 * provider's plan is cut at what its monthly or lifetime window has left (camoufox has no cap); a blocked line (`blocked` set by a budget check) plans nothing, but its reused
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
    // why: belt and braces. A line the budget guard would stop is already `blocked`, and a run of a line that fits its
    // window plans no more than the window leaves; the real flow reaches this cut only when `checkBudget` has not
    // blocked the line (a run it lets start and the guard then stops part way). It uses `callsLeftIn`, the same
    // reading `checkBudget` takes, other schedules' reservations included.
    // Known limit: a tile that pages spends one call a page, but is cut here by tile count, not calls, so a paging
    // provider's coverage may be overstated when its window is nearly spent.
    const allowed = Math.min(plan.planned.length, callsLeftIn(ctx, id, definitionId) ?? Infinity);
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
