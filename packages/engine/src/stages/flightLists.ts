/**
 * Spec revision 56 §8.1 "The flight-list step" (WP20 Task 20.9; WP21 Task 21.6): after discovery and before
 * verification (ruling 20.0 concern 1; the execution's stage stays `discovery`), in `camoufox` only, the browser worker
 * reads the flight list of the 10 cheapest date pairs on the search's board, one request each, on an allowance of its
 * own (the snapshot's `flightListPages`, 20 pages, outside CAMOUFOX_EXECUTION_PAGE_CAP, inside the monthly page cap and
 * EXECUTION_MAX_FREE_CALLS). When the worker last reported `RETURN_SELECT_VERIFIED` (and `BOOKING_SELECT_VERIFIED`) the
 * plan reads each pair's return leg (and the shown pairing's booking options) too: up to 2 pages a request, the search's
 * limits sent with it, an outbound-only request instead when the month or the window cannot hold that, and no further
 * return phase (or booking read) after one ends transient.
 *
 * The step has its own error table (below), its own gate (`flightPageGate`) and its own intake; it never routes a page
 * through discovery's `onFailure`, `pageGate`'s `leaveLane` or the shared budget handler, so no flight page changes a
 * cell outcome, the run's status, its stop or a notice, except the once-per-cool-down notice a blocked answer sends. Its
 * pages carry `run.controller.signal` only (cancel, SIGTERM, fatal), never `run.intake` or a lane's intake signal, which
 * a budget stop has already aborted. A cancel or SIGTERM that arrives during the step after a budget stop is recorded in
 * `run.flightStop` (run.ts `stopRun`), which `finish` prefers.
 */
import {
  AbortedError,
  BOOKING_TRANSIENT,
  BudgetExceeded,
  type BudgetScopeKind,
  type CellKey,
  cellKeyString,
  cooldownNoticeKey,
  FLIGHT_LIST_COUNT,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  type FlightLimits,
  type FlightListCapability,
  type FlightListQuery,
  type FlightListResult,
  type FlightListsState,
  flightLimitsOf,
  flightPagesPerPair,
  ProviderError,
  type ProviderId,
  type ReturnRead,
  type StopDetail,
} from '@gmt/core';
import type { FlightListInsert } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { errorText } from '../errors.js';
import { lineKey } from '../lines.js';
import { disableProvider, type RunState, stopRun } from '../run.js';
import { toStopDetail } from '../stopCause.js';
import { airportNamesOf, cellAirportNames } from './discovery.js';
import { flightPageGate, windowSecondsLeft } from './flightLists/gate.js';
import { newestListOf, type ReusePlan, selectFlightPairs } from './flightLists/select.js';
import { refreshHoursOf } from './reuse.js';

/** The one provider whose flight lists the step reads (spec §2: the browser worker's own pages). */
export const FLIGHT_LIST_PROVIDER: Extract<ProviderId, 'camoufox'> = 'camoufox';

/** The monthly, lifetime and global caps: a browser lane stopped at one of them sends no flight page (spec §8.1). */
const WINDOW_CAPS: ReadonlySet<BudgetScopeKind> = new Set([
  'provider-month',
  'provider-lifetime',
  'global-month',
]);

/** The capability the step reads with, when the run's provider has one. */
function capabilityOf(ctx: EngineContext): FlightListCapability | undefined {
  return ctx.providers.get(FLIGHT_LIST_PROVIDER)?.flightLists;
}

/**
 * Spec revision 55 §8.1 "Entry": whether the step runs for this pass. It runs when the run has not stopped, or when
 * its only stop is camoufox's own `provider-execution` budget stop (the per-run page cap: the run then stays stopped and
 * its cause carries the flights read); never on a catch-up or a child; never when camoufox's discovery lane left past
 * its browser window (a pass's gate, or a resume's check b, sets `windowOut`) or stopped at a monthly, lifetime or
 * global cap; never when camoufox is disabled for the run or its discovery line was blocked for budget before the pass;
 * never on a snapshot without `flightListPages`, a cabin the capability does not read (economy only), without a
 * flight-list capability, or without the board's ranking (EngineOptions.rankedDatePairs).
 */
export function flightStepEntry(ctx: EngineContext, run: RunState): boolean {
  if (run.isChild || run.isCatchUp) return false;
  // why: the 20.9 review's ruling — a cancel or SIGTERM that arrived after the budget stop, before the step, ends the
  // run as that (`flightStop`), so the step writes no plan
  if (run.flightStop !== null || run.controller.signal.aborted) return false;
  if (!run.snapshot.providers.discovery.includes(FLIGHT_LIST_PROVIDER)) return false;
  const cap = capabilityOf(ctx);
  if (cap === undefined || ctx.rankedDatePairs === undefined) return false;
  if (!cap.cabins.includes(run.snapshot.cabin)) return false;
  if ((run.snapshot.budget.flightListPages ?? 0) < 1) return false;
  if (run.disabled.has(FLIGHT_LIST_PROVIDER)) return false;
  // why: a line the pre-start or resume check blocked made no page this pass; its cap would refuse the flight pages too
  if (run.blocked.has(lineKey('discovery', FLIGHT_LIST_PROVIDER))) return false;
  const stop = run.stop;
  if (
    stop !== null &&
    !(
      stop.kind === 'budget' &&
      stop.error.scope === 'provider-execution' &&
      stop.error.providerId === FLIGHT_LIST_PROVIDER
    )
  )
    return false;
  const lane = run.lanes.get(`discovery|${FLIGHT_LIST_PROVIDER}`);
  if (lane === undefined) return true;
  if (lane.windowOut !== null) return false;
  return lane.budgetOutScope === null || !WINDOW_CAPS.has(lane.budgetOutScope);
}

/** What one page came to, under the step's error table. */
type PageOutcome =
  | { kind: 'read'; list: Extract<FlightListResult, { kind: 'list' }> }
  /** `failed` for this pair; `end` also fails the rest with the same reason (no request) and ends the step. */
  | { kind: 'failed'; reason: StopDetail; end: boolean; ended: FlightListsState['ended'] }
  /** The step's gate refused the page (window closed or a suspension found it closed): no row, `ended 'window'`. */
  | { kind: 'window' }
  /** Cancel, SIGTERM or a fatal stop aborted the run's controller: no row; the stop propagates. */
  | { kind: 'abort' };

/** Spec rev 55 §8.1 error table, BudgetExceeded row: the reason word and the `ended` word of a cap. */
function budgetOutcome(scope: BudgetScopeKind): PageOutcome {
  if (WINDOW_CAPS.has(scope))
    return { kind: 'failed', reason: 'monthly-cap', end: true, ended: 'monthly-cap' };
  if (scope === 'provider-execution')
    return { kind: 'failed', reason: 'execution-cap', end: true, ended: 'stopped' };
  return { kind: 'failed', reason: 'free-call-cap', end: true, ended: 'stopped' };
}

/** The kinds after which the step reads no more pages (their rest `failed` with the same reason, no request). */
const ENDING: ReadonlySet<ProviderError['kind']> = new Set([
  'blocked',
  'provider-unavailable',
  'auth',
  'quota',
  'limiter-timeout',
]);

/**
 * Spec rev 55 §8.1 error table, `list-error` rows: the reason is the error's STOP_DETAILS word when it has one (such as
 * `no-airport-names`), else its kind. A blocked answer also disables camoufox for the run and queues the
 * once-per-cool-down notice keyed by the cool-down's end, as discovery does; nothing else is notified.
 */
function errorOutcome(run: RunState, e: ProviderError): PageOutcome {
  const reason = toStopDetail(e.reason ?? null, e.kind);
  if (e.kind === 'blocked') {
    const until = e.cooldownUntil ?? null;
    // why: the step skips no cell, so the notice says what stopped and what is left unread in its own words; a block
    // with a cool-down is sent once per cool-down (keyed by its end), as discovery's is
    const words = `${FLIGHT_LIST_PROVIDER} stopped on a flight-list page: ${errorText(e)}. The rest of this run's flight lists are not read`;
    disableProvider(
      run,
      FLIGHT_LIST_PROVIDER,
      'a blocked flight-list page',
      'provider_disabled',
      until === null
        ? { detail: `${words}.` }
        : {
            detail: `${words}, and it is not called again until the cool-down ends.`,
            key: cooldownNoticeKey(FLIGHT_LIST_PROVIDER, until),
          },
      { detail: 'blocked', until },
    );
  }
  return { kind: 'failed', reason, end: ENDING.has(e.kind), ended: null };
}

/**
 * One request's shape (spec rev 56 §8.1 "Each request"): with a return phase, the search's limits and whether to read
 * the booking options, the 2 pages it may load and the seconds it may take (`flightRequestSeconds`); without one, 1 page
 * and the list page's request timeout.
 */
interface RequestPlan {
  returnLimits: FlightLimits | null;
  booking: boolean;
  pages: number;
  seconds: number;
}

/**
 * Reads one page under the step's error table. The lease is awaited first (an on-demand read in flight), then the
 * request is shaped (`requestOf`: the window and the month's pages as they are after that wait, 21.6 review M1), then
 * the step's own allowance is checked against the request's pages (`used + pages > flightListPages`, so a request it
 * cannot hold is refused at `provider-execution` before any call), then the capability reads with the run's controller
 * signal and the step's gate held to the request's own seconds.
 */
async function readPage(
  ctx: EngineContext,
  run: RunState,
  cap: FlightListCapability,
  cell: CellKey,
  plan: FlightListsState,
  gate: (requestSeconds: number) => () => void,
): Promise<PageOutcome> {
  const names = airportNamesOf(ctx);
  try {
    await ctx.lease.whenFree(run.controller.signal);
    const req = requestOf(ctx, run, plan);
    const allowance = ctx.budget.usage({
      kind: 'provider-execution',
      executionId: run.executionId,
      providerId: FLIGHT_LIST_PROVIDER,
    }).flightLists;
    // why: fail closed: a guard that states no flight allowance gives none (the guard itself reads an absent one as 0)
    const pages = allowance?.cap ?? 0;
    const used = allowance?.calls ?? 0;
    if (used + req.pages > pages)
      throw new BudgetExceeded({
        scope: 'provider-execution',
        providerId: FLIGHT_LIST_PROVIDER,
        cap: pages,
        current: used,
        requested: req.pages,
      });
    const query: FlightListQuery = {
      cell,
      airportNames: cellAirportNames(names, run.snapshot.resolved, cell.origin, cell.destination),
      ...(req.returnLimits === null ? {} : { returnLimits: req.returnLimits, booking: req.booking }),
    };
    const r = await cap.read(query, {
      executionId: run.executionId,
      signal: run.controller.signal,
      recordFixtures: false,
      beforeSend: gate(req.seconds),
    });
    return r.kind === 'list' ? { kind: 'read', list: r } : errorOutcome(run, r.error);
  } catch (err) {
    // why: a cancel, SIGTERM or fatal stop aborts the run's controller; whatever the page then threw, nothing is written
    if (run.controller.signal.aborted) return { kind: 'abort' };
    if (err instanceof AbortedError) return { kind: 'window' };
    if (err instanceof BudgetExceeded) return budgetOutcome(err.scope);
    if (err instanceof ProviderError) return errorOutcome(run, err);
    // why: ruling R-dberror — anything else (the database itself failing) is fatal, as everywhere else in a pass
    throw err;
  }
}

/** What every flight-list row of a cell carries, read or failed (spec §7 `flight_lists`). */
export type FlightRowBase = Pick<
  FlightListInsert,
  | 'definitionId'
  | 'executionId'
  | 'providerId'
  | 'sourceKind'
  | 'cabin'
  | 'origin'
  | 'destination'
  | 'departureDate'
  | 'returnDate'
>;

/**
 * The one read-row builder (spec rev 56 §8.1: shared by the step and the on-demand read): a `read` row with every field
 * of the list, its return read (with the booking read and its offers) included.
 */
export function readRowOf(
  base: FlightRowBase,
  l: Extract<FlightListResult, { kind: 'list' }>,
): FlightListInsert {
  return {
    ...base,
    fetchedAt: l.fetchedAt,
    pointOfSale: l.pointOfSale,
    status: 'read',
    reason: null,
    listed: l.listed,
    minMinor: l.minMinor,
    tabMinor: l.tabMinor,
    cheapestView: l.cheapestView,
    optionsUnparsed: l.optionsUnparsed,
    optionsOtherCell: l.optionsOtherCell,
    resultsStated: l.resultsStated,
    flights: l.flights,
    returns: l.returns,
  };
}

/** The one failed-row builder: nothing listed, the reason one STOP_DETAILS word, no return read (data-005). */
export function failedRowOf(ctx: EngineContext, base: FlightRowBase, reason: StopDetail): FlightListInsert {
  return {
    ...base,
    fetchedAt: ctx.clock.now(),
    pointOfSale: ctx.pointOfSaleOf(FLIGHT_LIST_PROVIDER),
    status: 'failed',
    reason,
    listed: null,
    minMinor: null,
    tabMinor: null,
    cheapestView: null,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: null,
    flights: [],
    returns: null,
  };
}

/** One flight-list row (spec §7 `flight_lists`): `read` with every field, or `failed` with its reason and nothing listed. */
function writeRow(
  ctx: EngineContext,
  run: RunState,
  cell: CellKey,
  o: Extract<PageOutcome, { kind: 'read' | 'failed' }>,
): void {
  const base: FlightRowBase = {
    definitionId: run.definitionId,
    executionId: run.executionId,
    providerId: FLIGHT_LIST_PROVIDER,
    sourceKind: 'scraped-self',
    cabin: run.snapshot.cabin,
    origin: cell.origin,
    destination: cell.destination,
    departureDate: cell.departureDate,
    returnDate: cell.returnDate,
  };
  ctx.repos.flightLists.insert(
    o.kind === 'read' ? readRowOf(base, o.list) : failedRowOf(ctx, base, o.reason),
  );
}

const cellOf = (c: CellKey): CellKey => ({
  origin: c.origin,
  destination: c.destination,
  departureDate: c.departureDate,
  returnDate: c.returnDate,
});

/**
 * Spec rev 56 §8.1 "The plan": the return phase a fresh plan reads, from the worker's last reported flags (none read:
 * outbound-only) and the snapshot's allowance, which must hold `FLIGHT_LIST_PAGES_PER_PAIR_MAX` pages for every pair
 * that could be planned (an older snapshot, with 10, plans outbound-only); the booking read only with returns.
 */
export function returnPhaseOf(
  ctx: Pick<EngineContext, 'workerFlags'>,
  snapshot: RunState['snapshot'],
  pairs: number,
): { returns: boolean; booking: boolean } {
  const flags = ctx.workerFlags.get(FLIGHT_LIST_PROVIDER);
  const returns =
    flightPagesPerPair(flags) === FLIGHT_LIST_PAGES_PER_PAIR_MAX &&
    (snapshot.budget.flightListPages ?? 0) >= pairs * FLIGHT_LIST_PAGES_PER_PAIR_MAX;
  return { returns, booking: returns && flags?.BOOKING_SELECT_VERIFIED === true };
}

/**
 * The plan this pass works from, and the cells it still reads. A resumed pass keeps the stored plan (`planned`,
 * `cells`, `returns` and `booking` fixed) and reads only planned cells with no row of this execution, skipping (no row)
 * one that has departed; a pass with no stored plan selects one from the board's ranking (`selectFlightPairs`, reuse
 * judged under the return phase it plans) and writes it once, before its first page, only when at least one date pair
 * was selected to read or reuse.
 */
function planOf(ctx: EngineContext, run: RunState): { plan: FlightListsState; toRead: CellKey[] } | null {
  const today = ctx.clock.todayLondon();
  const stored = ctx.repos.executions.get(run.executionId)?.flightLists ?? null;
  if (stored !== null) {
    const done = new Set(ctx.repos.flightLists.cellsOfExecution(run.executionId).map(cellKeyString));
    const toRead = stored.cells.filter((c) => !done.has(cellKeyString(c)) && c.departureDate > today);
    return { plan: stored, toRead };
  }
  const reader = ctx.rankedDatePairs;
  if (reader === undefined) return null;
  const now = ctx.clock.now();
  const ranked = reader({
    definitionId: run.definitionId,
    space: run.snapshot.resolved,
    cabin: run.snapshot.cabin,
    maxJourneyMinutes: run.snapshot.constraints.maxJourneyMinutes ?? null,
    now,
  });
  // why: only the first 10 not departed can be chosen, so only their newest lists are read (one statement)
  const candidates = ranked.filter((p) => p.departureDate > today).slice(0, FLIGHT_LIST_COUNT);
  const phase = returnPhaseOf(ctx, run.snapshot, candidates.length);
  const reuse: ReusePlan = { ...phase, current: flightLimitsOf(run.snapshot.constraints) };
  const newest = new Map(
    ctx.repos.flightLists
      .newestPerCell(
        run.definitionId,
        candidates.map(cellOf),
        run.snapshot.cabin,
        ctx.pointOfSaleOf(FLIGHT_LIST_PROVIDER),
      )
      .map((l) => [cellKeyString(l), newestListOf(l)]),
  );
  const sel = selectFlightPairs(
    candidates,
    newest,
    now,
    refreshHoursOf(run.snapshot, FLIGHT_LIST_PROVIDER),
    today,
    reuse,
  );
  const planned = sel.read.length + sel.reused.length;
  if (planned === 0) return null;
  const plan: FlightListsState = {
    planned,
    cells: sel.read.map(cellOf),
    reused: sel.reused.length,
    ended: null,
    ...phase,
    returnsStopped: null,
    bookingStopped: null,
  };
  ctx.repos.executions.patch(run.executionId, { flightLists: plan });
  return { plan, toRead: plan.cells };
}

/**
 * A pass that may not run the step because its browser lane left past the window (a resume past the run's window, or
 * the lane's own gate) leaves the stored plan's unread cells unread: the plan says so (`ended 'window'`), so the page
 * words the early end from what was stored (ruling A14).
 */
function markLeftByWindow(ctx: EngineContext, run: RunState): void {
  const lane = run.lanes.get(`discovery|${FLIGHT_LIST_PROVIDER}`);
  if (lane === undefined || lane.windowOut === null || run.isCatchUp || run.isChild) return;
  const stored = ctx.repos.executions.get(run.executionId)?.flightLists ?? null;
  if (stored === null || stored.ended !== null) return;
  const done = new Set(ctx.repos.flightLists.cellsOfExecution(run.executionId).map(cellKeyString));
  if (stored.cells.some((c) => !done.has(cellKeyString(c))))
    ctx.repos.executions.patch(run.executionId, { flightLists: { ...stored, ended: 'window' } });
}

/**
 * The month's pages left for camoufox (spec rev 56 §8.1 R-low-pages: the monthly cap less the pages used, from the
 * guard); Infinity without a cap.
 */
export function monthHeadroom(ctx: EngineContext): number {
  const u = ctx.budget.usage({
    kind: ctx.limitsOf(FLIGHT_LIST_PROVIDER).capKind,
    providerId: FLIGHT_LIST_PROVIDER,
  });
  return u.cap === null ? Number.POSITIVE_INFINITY : u.cap - u.calls;
}

/**
 * Spec rev 56 §8.1 "Each request": the next request's shape. The plan's return phase is sent (the current limits, and
 * `booking` until `bookingStopped`) while the plan reads returns and `returnsStopped` is null, unless the month's page
 * headroom is below `FLIGHT_LIST_PAGES_PER_PAIR_MAX` (R-low-pages) or the run's window no longer holds a return-phase
 * request's seconds (R-window, cost-r3-007): then an outbound-only request of 1 page, `returnsStopped` left null.
 */
function requestOf(ctx: EngineContext, run: RunState, plan: FlightListsState): RequestPlan {
  const seconds = ctx.limitsOf(FLIGHT_LIST_PROVIDER).flightRequestSeconds;
  const outboundOnly: RequestPlan = {
    returnLimits: null,
    booking: false,
    pages: 1,
    seconds: seconds?.outboundOnly ?? 0,
  };
  if (!plan.returns || plan.returnsStopped !== null) return outboundOnly;
  if (monthHeadroom(ctx) < FLIGHT_LIST_PAGES_PER_PAIR_MAX) return outboundOnly;
  const booking = plan.booking && plan.bookingStopped === null;
  const phaseSeconds = (booking ? seconds?.booking : seconds?.returnsOnly) ?? 0;
  // why: a window that cannot hold the return phase may still hold an outbound-only read (one that holds neither is
  // refused by the gate, ending the step `window`)
  if (windowSecondsLeft(ctx, run) < phaseSeconds) return outboundOnly;
  return {
    returnLimits: flightLimitsOf(run.snapshot.constraints),
    booking,
    pages: FLIGHT_LIST_PAGES_PER_PAIR_MAX,
    seconds: phaseSeconds,
  };
}

/**
 * Spec rev 56 §8.1 (Review Focus 2; ruling P23/A12): the rule after which the pass sends no further return phase: a
 * return read that ended `select-failed`, `not-settled` or `unrecognised`, or `read` with its second attempt ended
 * transiently (a rule other than the month's or the spacing's); null when nothing stops it (`skipped`, `no-outbound`,
 * a clean `read`).
 */
export function returnsStopOf(r: ReturnRead | null): string | null {
  if (r === null) return null;
  switch (r.status) {
    case 'select-failed':
    case 'not-settled':
    case 'unrecognised':
      return r.rule ?? r.status;
    case 'read':
      // why: the month's pages and the spacing wait are not a wrong view; the next request may well have them
      return r.rule === null || r.rule === 'spacing' || r.rule === 'monthly-headroom' ? null : r.rule;
    default:
      return null;
  }
}

/** Spec rev 56 §8.1: the rule after which the pass reads no further booking options: a transient booking status. */
export function bookingStopOf(r: ReturnRead | null): string | null {
  const b = r?.booking ?? null;
  return b !== null && BOOKING_TRANSIENT.has(b.status) ? (b.rule ?? b.status) : null;
}

/**
 * Spec revision 56 §8.1 "The flight-list step": selects (or resumes) the plan, reads its date pairs one at a time
 * (concurrency 1) under the error table, each request shaped by `requestOf`, stops the pass's return phases (or booking
 * reads) after a transient end, and records its counts on the run (`run.flightLists`, which the budget cause it runs
 * after carries). A failure outside the error table (the database itself) stops the run fatal (R-dberror).
 */
export async function runFlightLists(ctx: EngineContext, run: RunState): Promise<void> {
  if (!flightStepEntry(ctx, run)) {
    markLeftByWindow(ctx, run);
    return;
  }
  const cap = capabilityOf(ctx);
  if (cap === undefined) return;
  const log = run.log.child({ providerId: FLIGHT_LIST_PROVIDER, step: 'flight-lists' });
  run.flightStepActive = true;
  try {
    const p = planOf(ctx, run);
    if (p === null) return;
    const { toRead } = p;
    let plan = p.plan;
    // why: a resumed pass that reads again what an earlier pass left clears that pass's early end; it sets its own
    if (toRead.length > 0 && plan.ended !== null) {
      plan = { ...plan, ended: null };
      ctx.repos.executions.patch(run.executionId, { flightLists: plan });
    }
    log.info(
      {
        planned: plan.planned,
        reused: plan.reused,
        toRead: toRead.length,
        returns: plan.returns,
        booking: plan.booking,
      },
      'flight lists: planned',
    );
    // why: the step's own intake (never run.intake or a lane's, both aborted by a budget stop): it stops taking pages
    const intake = new AbortController();
    const gate = flightPageGate(ctx, run);
    let ended: FlightListsState['ended'] = null;
    for (let i = 0; i < toRead.length && !intake.signal.aborted; i++) {
      const cell = toRead[i];
      if (cell === undefined) break;
      const o = await readPage(ctx, run, cap, cell, plan, gate);
      if (o.kind === 'abort') {
        intake.abort();
        break;
      }
      if (o.kind === 'window') {
        ended = 'window';
        intake.abort();
        break;
      }
      writeRow(ctx, run, cell, o);
      if (o.kind === 'read') {
        // why: Review Focus 2 — a wrong return or booking view is not repeated: the pass sends no further one
        const returnsStopped = plan.returnsStopped ?? returnsStopOf(o.list.returns);
        const bookingStopped = plan.bookingStopped ?? bookingStopOf(o.list.returns);
        if (returnsStopped !== plan.returnsStopped || bookingStopped !== plan.bookingStopped) {
          plan = { ...plan, returnsStopped, bookingStopped };
          ctx.repos.executions.patch(run.executionId, { flightLists: plan });
          log.info(
            { returnsStopped, bookingStopped },
            'flight lists: a transient end stops the rest of the pass',
          );
        }
      }
      if (o.kind === 'failed' && o.end) {
        // why: the rest fail with the same reason and no request is sent (the error table's "the rest" column)
        for (const rest of toRead.slice(i + 1)) writeRow(ctx, run, rest, o);
        ended = o.ended;
        intake.abort();
      }
    }
    if (ended !== null) ctx.repos.executions.patch(run.executionId, { flightLists: { ...plan, ended } });
    const counts = ctx.repos.flightLists.forExecution(run.executionId, plan.cells);
    run.flightLists = { read: counts.read + plan.reused, planned: plan.planned };
    log.info({ ...counts, reused: plan.reused, ended }, 'flight lists: step done');
  } catch (err) {
    // why: ruling R-dberror (20.9 review) — a failure of the step's own writes is the run's fatal stop, with its cause,
    // as a failure anywhere else in the pass is; it is never logged and completed
    log.error({ err: errorText(err) }, 'flight lists: step failed; the run stops');
    stopRun(run, { kind: 'fatal', message: errorText(err) });
  } finally {
    run.flightStepActive = false;
  }
}
