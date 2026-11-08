/**
 * Spec revision 56 §8.1 "The flight-list step" (WP20 Task 20.9; WP21 Task 21.6): after discovery and before
 * verification (ruling 20.0 concern 1; the execution's stage stays `discovery`), in `camoufox` only, the browser worker
 * reads flight lists of the search's cheapest date pairs, one request each, CAMOUFOX_PAGES_AT_ONCE at a time (a browser
 * page counts against no free-call cap, and since design 2026-11-08 §4.8 against no per-run flight allowance either).
 *
 * Design 2026-11-08 (confirm the cheapest trips) §4.2–§4.7: when the worker last reported `RETURN_SELECT_VERIFIED` (and
 * `BOOKING_SELECT_VERIFIED`) the step is in confirm mode: it reads each pair's return leg (and the shown pairing's
 * booking options), the search's limits sent with it, up to 2 pages a request, through an open-ended queue of the
 * calendar's cheapest pairs (`confirmQueue`) until core's rule A stops it (`patienceSpent`), the queue is empty, returns
 * stop part-way, or one of the run's own stops ends it. Reused lists and fresh verified figures fill the standings first
 * and spend no patience. With the flag off, or not yet read, the step reads as it did: the first `FLIGHT_LIST_COUNT`
 * pairs, outbound only. Either way it stores a summary (`FlightListsState.confirm`).
 *
 * The step has its own error table (below), its own gate (`flightPageGate`) and its own intake; it never routes a page
 * through discovery's `onFailure`, `pageGate`'s `leaveLane` or the shared budget handler, so no flight page changes a
 * cell outcome, the run's status, its stop or a notice, except the once-per-cool-down notice a blocked answer sends. Its
 * pages carry `run.controller.signal` only (cancel, SIGTERM, fatal), never `run.intake` or a lane's intake signal.
 */
import {
  AbortedError,
  applyCheck,
  BOOKING_TRANSIENT,
  BudgetExceeded,
  type CellKey,
  type Check,
  type ConfirmSummary,
  cellKeyString,
  checkOfRead,
  cooldownNoticeKey,
  EMPTY_STANDINGS,
  FLIGHT_LIST_COUNT,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  type FlightLimits,
  type FlightListCapability,
  type FlightListQuery,
  type FlightListResult,
  type FlightListsState,
  flightLimitsOf,
  flightPagesPerPair,
  listFresh,
  ProviderError,
  type ProviderId,
  patienceSpent,
  type ReturnRead,
  type Standings,
  type StopDetail,
  uncheckedCheaper,
} from '@gmt/core';
import type { FlightListInsert, NewestFlightList } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { errorText } from '../errors.js';
import { lineKey } from '../lines.js';
import { runPool } from '../pool.js';
import { disableProvider, type RunState, stopRun } from '../run.js';
import { toStopDetail } from '../stopCause.js';
import { airportNamesOf, cellAirportNames } from './discovery.js';
import { flightPageGate, windowSecondsLeft } from './flightLists/gate.js';
import { confirmQueue, newestListOf, type ReusePlan, selectFlightPairs } from './flightLists/select.js';
import { refreshHoursOf } from './reuse.js';

/** The one provider whose flight lists the step reads (spec §2: the browser worker's own pages). */
export const FLIGHT_LIST_PROVIDER: Extract<ProviderId, 'camoufox'> = 'camoufox';

/** The capability the step reads with, when the run's provider has one. */
function capabilityOf(ctx: EngineContext): FlightListCapability | undefined {
  return ctx.providers.get(FLIGHT_LIST_PROVIDER)?.flightLists;
}

/**
 * Spec revision 55 §8.1 "Entry": whether the step runs for this pass. It runs when the run has not stopped; never on a
 * catch-up or a child; never when camoufox's discovery lane left past
 * its browser window (a pass's gate, or a resume's check b, sets `windowOut`) or stopped at a monthly, lifetime or
 * global cap; never when camoufox is disabled for the run or its discovery line was blocked for budget before the pass;
 * never on a snapshot without `flightListPages` (the step's on-switch, design 2026-11-08 §4.8: no longer an allowance),
 * a cabin the capability does not read (economy only), without a
 * flight-list capability, or without the board's ranking (EngineOptions.rankedDatePairs).
 */
export function flightStepEntry(ctx: EngineContext, run: RunState): boolean {
  if (run.isChild || run.isCatchUp) return false;
  if (run.stop !== null || run.controller.signal.aborted) return false;
  if (!run.snapshot.providers.discovery.includes(FLIGHT_LIST_PROVIDER)) return false;
  const cap = capabilityOf(ctx);
  if (cap === undefined || ctx.rankedDatePairs === undefined) return false;
  if (!cap.cabins.includes(run.snapshot.cabin)) return false;
  if ((run.snapshot.budget.flightListPages ?? 0) < 1) return false;
  if (run.disabled.has(FLIGHT_LIST_PROVIDER)) return false;
  // why: a line the pre-start or resume check blocked made no page this pass; its cap would refuse the flight pages too
  if (run.blocked.has(lineKey('discovery', FLIGHT_LIST_PROVIDER))) return false;
  const lane = run.lanes.get(`discovery|${FLIGHT_LIST_PROVIDER}`);
  if (lane === undefined) return true;
  // why: the browser lane has no page cap and no cap on a window (spec §2); only its browser window ends it early
  return lane.windowOut === null;
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

/**
 * Spec rev 55 §8.1 error table, BudgetExceeded row: the reason word and the `ended` word of a cap. Design 2026-11-08
 * §4.8 withdrew the run's flight allowance, the one cap that gave `execution-cap` (`provider-execution`), so every scope
 * a flight page can still meet gives `free-call-cap`.
 */
function budgetOutcome(): PageOutcome {
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
 * request is shaped (`requestOf`: the window as it is after that wait, 21.6 review M1; in confirm mode a window that
 * cannot hold a return-phase read ends the step `window` here, before any call), then the capability reads with the
 * run's controller signal and the step's gate held to the request's own seconds. No allowance is checked: design
 * 2026-11-08 §4.8 withdrew it (rule A bounds the step).
 */
async function readPage(
  ctx: EngineContext,
  run: RunState,
  cap: FlightListCapability,
  cell: CellKey,
  planNow: () => FlightListsState,
  gate: (requestSeconds: number) => () => void,
): Promise<PageOutcome> {
  const names = airportNamesOf(ctx);
  try {
    await ctx.lease.whenFree(run.controller.signal);
    const req = requestOf(ctx, run, planNow());
    // why: design 2026-11-08 §4.6: an outbound-only read cannot confirm a trip, so confirm mode never sends one for want
    // of window; the step ends as the gate would end it
    if (req === null) return { kind: 'window' };
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
    if (err instanceof BudgetExceeded) return budgetOutcome();
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
 * outbound-only); the booking read only with returns. Design 2026-11-08 §4.8: the snapshot's `flightListPages` is no
 * longer an allowance the phase must fit (it is only the step's on-switch, read by `flightStepEntry`), so a run whose
 * stored snapshot still carries the old 20 (or 10) plans returns all the same.
 */
export function returnPhaseOf(
  ctx: Pick<EngineContext, 'workerFlags'>,
  _snapshot: RunState['snapshot'],
): { returns: boolean; booking: boolean } {
  const flags = ctx.workerFlags.get(FLIGHT_LIST_PROVIDER);
  const returns = flightPagesPerPair(flags) === FLIGHT_LIST_PAGES_PER_PAIR_MAX;
  return { returns, booking: returns && flags?.BOOKING_SELECT_VERIFIED === true };
}

/** Design 2026-11-08 §4.3: a check that learnt nothing about the pair's flights. */
const UNREAD: Check = { kind: 'unread' };

/**
 * What a confirm-mode pass carries beside its plan (design 2026-11-08 §4.3–§4.5): the standings so far (patience at 0:
 * a resumed pass starts it again), this run's unread reads so far, and for each pair still to read its calendar price
 * (for the unchecked count) and its newest stored list as it stood at planning (the end of the step counts a pair read
 * recently enough to lead as checked), under the limits and the refresh the run reads with.
 */
interface ConfirmPass {
  standings: Standings;
  unread: number;
  prices: ReadonlyMap<string, number>;
  newest: ReadonlyMap<string, NewestFlightList>;
  limits: FlightLimits;
  refreshHours: number;
}

/** The plan a pass works from, the cells it reads, and (in confirm mode) what rule A works from. */
interface PassPlan {
  plan: FlightListsState;
  toRead: CellKey[];
  confirm: ConfirmPass | null;
}

/**
 * Design 2026-11-08 §4.7: a confirm-mode step that finished (a stop of rule A, returns lost part-way, or an ending
 * error) reads nothing on a later pass of the same run, such as a resume after a verification pause; one interrupted
 * (the run's window, a cool-down, a crash) resumes.
 */
export function confirmFinished(p: FlightListsState): boolean {
  return (
    (p.confirm?.stop ?? null) !== null ||
    p.returnsStopped !== null ||
    (p.ended !== null && p.ended !== 'window')
  );
}

/**
 * The plan this pass works from, and the cells it still reads. Design 2026-11-08: a plan that reads returns is in
 * confirm mode (`confirmPlanOf`, fresh or resumed), whatever its stored summary says (a plan stored before the change
 * has none); a fresh plan without returns, and a resumed one, read as `outboundPlanOf` says.
 */
function planOf(ctx: EngineContext, run: RunState): PassPlan | null {
  const stored = ctx.repos.executions.get(run.executionId)?.flightLists ?? null;
  if (stored !== null) {
    if (!stored.returns) return outboundPlanOf(ctx, run, stored);
    return confirmFinished(stored) ? null : confirmPlanOf(ctx, run, stored);
  }
  const phase = returnPhaseOf(ctx, run.snapshot);
  if (phase.returns) return confirmPlanOf(ctx, run, null);
  // why: design 2026-11-08 §4.6, §7: `flags-unread` when no flags had been read as the step planned, so the page can
  // say the browser had not yet said what it can read; `outbound-only` when they were read and lack returns
  const mode = ctx.workerFlags.get(FLIGHT_LIST_PROVIDER) === null ? 'flags-unread' : 'outbound-only';
  return outboundPlanOf(ctx, run, null, mode);
}

/**
 * Spec rev 56 §8.1 "The plan", outbound only (design 2026-11-08 §4.6: the fallback when returns are off or unread). A
 * resumed pass keeps the stored plan (`planned`, `cells`, `returns` and `booking` fixed) and reads only planned cells
 * with no row of this execution, skipping (no row) one that has departed; a pass with no stored plan selects the first
 * `FLIGHT_LIST_COUNT` of the board's ranking (`selectFlightPairs`, reuse judged with no return phase) and writes it
 * once, before its first page, only when at least one date pair was selected to read or reuse, with a summary that
 * names the mode and counts nothing (rule A does not apply).
 */
function outboundPlanOf(
  ctx: EngineContext,
  run: RunState,
  stored: FlightListsState | null,
  mode: ConfirmSummary['mode'] = 'outbound-only',
): PassPlan | null {
  const today = ctx.clock.todayLondon();
  if (stored !== null) {
    const done = new Set(ctx.repos.flightLists.cellsOfExecution(run.executionId).map(cellKeyString));
    const toRead = stored.cells.filter((c) => !done.has(cellKeyString(c)) && c.departureDate > today);
    return { plan: stored, toRead, confirm: null };
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
  const phase = { returns: false, booking: false };
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
    confirm: { mode, confirmed: 0, unread: 0, uncheckedCheaper: 0, stop: null },
    endedReason: null,
  };
  ctx.repos.executions.patch(run.executionId, { flightLists: plan });
  return { plan, toRead: plan.cells, confirm: null };
}

/**
 * Design 2026-11-08 §4.2, §4.3, §4.7: a confirm-mode pass, fresh (`stored` null) or resumed. The queue is rebuilt from
 * the calendar as it stands (`confirmQueue`, departed pairs out). Fresh, current verified figures enter the standings by
 * reuse; every cell with a row of this execution, whatever its status, is a read already made: it is left out of the
 * read split, its check fills the standings' prices (never patience, never `reused`) and an unread one counts in
 * `unread` again (so the count equals what was stored, a crash between a row and its count included). The rest is split
 * by `selectFlightPairs` with no count; each reused pair's stored list is checked by reuse. So `reused` is rebuilt on a
 * resume from the same lists the first pass reused (never added to what it stored, which already held them and the
 * recently read pairs its own end counted); a resume keeps the stored `returns`, `booking`, `returnsStopped`,
 * `bookingStopped` and the started `cells` (those with a row), never recomputed from the flags. The plan is written
 * before the first read, with the counts as they stand and no stop; a fresh pass with nothing to read or reuse writes
 * none.
 */
function confirmPlanOf(ctx: EngineContext, run: RunState, stored: FlightListsState | null): PassPlan | null {
  const reader = ctx.rankedDatePairs;
  if (reader === undefined) return null;
  const today = ctx.clock.todayLondon();
  const now = ctx.clock.now();
  const limits = flightLimitsOf(run.snapshot.constraints);
  const refreshHours = refreshHoursOf(run.snapshot, FLIGHT_LIST_PROVIDER);
  const pointOfSale = ctx.pointOfSaleOf(FLIGHT_LIST_PROVIDER);
  const phase =
    stored === null ? returnPhaseOf(ctx, run.snapshot) : { returns: stored.returns, booking: stored.booking };
  const live = reader({
    definitionId: run.definitionId,
    space: run.snapshot.resolved,
    cabin: run.snapshot.cabin,
    maxJourneyMinutes: run.snapshot.constraints.maxJourneyMinutes ?? null,
    now,
  }).filter((p) => p.departureDate > today);
  let standings = EMPTY_STANDINGS;
  let reused = 0;
  const own = ctx.repos.flightLists.cellsOfExecution(run.executionId);
  const ownKeys = new Set(own.map(cellKeyString));
  // why: §4.3: an itinerary price the latest search saw, within its age, is a confirmed trip already: no page. A pair
  // this run already read is counted once, as that read (§4.7): verification may price it after a step that ended
  // `window`, and counting it again would inflate "Checked N", the trips and the 5th price
  for (const p of live)
    if (p.current && p.basis === 'verified' && !p.stale && !ownKeys.has(cellKeyString(p))) {
      standings = applyCheck(standings, { kind: 'confirmed', pricePence: p.pricePence }, 'reuse');
      reused += 1;
    }
  let unread = 0;
  // why: §4.7: this run's own lists count as reads already made, not as reuse; their patience is not carried over
  const ownLists =
    own.length === 0
      ? []
      : ctx.repos.flightLists.newestOfCells(run.definitionId, own, run.snapshot.cabin, pointOfSale, {
          executionIds: [run.executionId],
        });
  for (const l of ownLists) {
    const c = l.status === 'read' ? checkOfRead(l.returns, l.flights, limits) : UNREAD;
    if (c.kind === 'unread') unread += 1;
    standings = applyCheck(standings, c, 'reuse');
  }
  const rest = confirmQueue(live).filter((p) => !ownKeys.has(cellKeyString(p)));
  const lists = new Map(
    ctx.repos.flightLists
      .newestPerCell(run.definitionId, rest.map(cellOf), run.snapshot.cabin, pointOfSale)
      .map((l) => [cellKeyString(l), l]),
  );
  const sel = selectFlightPairs(
    rest,
    new Map([...lists].map(([k, l]) => [k, newestListOf(l)])),
    now,
    refreshHours,
    today,
    { ...phase, current: limits },
    Number.POSITIVE_INFINITY,
  );
  // why: §4.2, §4.4: a reusable list is checked at once, filling the standings with no page and no patience spent
  for (const p of sel.reused) {
    const l = lists.get(cellKeyString(p));
    const check = l === undefined ? UNREAD : checkOfRead(l.returns, l.flights, limits);
    standings = applyCheck(standings, check, 'reuse');
    reused += 1;
    // why: final whole-branch review I3: a pair reused as finished after two transient reads (R-retry,
    // `transientStreak` 2), or one read under other limits, learnt nothing for today's limits, so it is unread as
    // well as reused; rebuilt on a resume from the same lists, so the stored count is never added to twice
    if (check.kind === 'unread') unread += 1;
  }
  if (stored === null && sel.read.length === 0 && reused === 0) return null;
  const cells = (stored?.cells ?? []).filter((c) => ownKeys.has(cellKeyString(c)));
  const plan: FlightListsState = {
    planned: cells.length + reused,
    cells,
    reused,
    ended: stored?.ended ?? null,
    ...phase,
    returnsStopped: stored?.returnsStopped ?? null,
    bookingStopped: stored?.bookingStopped ?? null,
    endedReason: stored?.endedReason ?? null,
    confirm: {
      mode: 'confirm',
      confirmed: standings.prices.length,
      unread,
      uncheckedCheaper: 0,
      stop: null,
    },
  };
  ctx.repos.executions.patch(run.executionId, { flightLists: plan });
  return {
    plan,
    toRead: sel.read.map(cellOf),
    confirm: {
      standings,
      unread,
      prices: new Map(sel.read.map((p) => [cellKeyString(p), p.pricePence])),
      newest: lists,
      limits,
      refreshHours,
    },
  };
}

/**
 * A pass that may not run the step because its browser lane left past the window (a resume past the run's window, or
 * the lane's own gate) leaves the stored plan's unread cells unread: the plan says so (`ended 'window'`), so the page
 * words the early end from what was stored (ruling A14). Design 2026-11-08 §4.7: a confirm-mode step that has not
 * finished (no stop of its own, no end) always has dates left to check, so it is marked whatever its rows; other plans
 * keep the rule of an unread planned cell.
 */
function markLeftByWindow(ctx: EngineContext, run: RunState): void {
  const lane = run.lanes.get(`discovery|${FLIGHT_LIST_PROVIDER}`);
  if (lane === undefined || lane.windowOut === null || run.isCatchUp || run.isChild) return;
  const stored = ctx.repos.executions.get(run.executionId)?.flightLists ?? null;
  if (stored === null || stored.ended !== null) return;
  const mark = () =>
    ctx.repos.executions.patch(run.executionId, { flightLists: { ...stored, ended: 'window' } });
  if (stored.confirm?.mode === 'confirm') {
    if (stored.confirm.stop === null) mark();
    return;
  }
  const done = new Set(ctx.repos.flightLists.cellsOfExecution(run.executionId).map(cellKeyString));
  if (stored.cells.some((c) => !done.has(cellKeyString(c)))) mark();
}

/**
 * Spec rev 56 §8.1 "Each request": the next request's shape. The plan's return phase is sent (the current limits, and
 * `booking` until `bookingStopped`) while the plan reads returns and `returnsStopped` is null, unless the run's window
 * no longer holds a return-phase request's seconds (R-window, cost-r3-007). Design 2026-11-08 §4.6: a plan reading
 * returns is in confirm mode, where an outbound-only read confirms nothing, so that shortfall gives null (the step ends
 * `window`, sending nothing); outbound-only plans send 1 page, and a request shaped after returns stopped (one that had
 * started waiting on the lease) reads outbound-only.
 */
function requestOf(ctx: EngineContext, run: RunState, plan: FlightListsState): RequestPlan | null {
  const seconds = ctx.limitsOf(FLIGHT_LIST_PROVIDER).flightRequestSeconds;
  const outboundOnly: RequestPlan = {
    returnLimits: null,
    booking: false,
    pages: 1,
    seconds: seconds?.outboundOnly ?? 0,
  };
  if (!plan.returns || plan.returnsStopped !== null) return outboundOnly;
  const booking = plan.booking && plan.bookingStopped === null;
  const phaseSeconds = (booking ? seconds?.booking : seconds?.returnsOnly) ?? 0;
  if (windowSecondsLeft(ctx, run) < phaseSeconds) return null;
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
 * transiently (a rule other than the spacing's); null when nothing stops it (`skipped`, `no-outbound`,
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
      // why: the spacing wait is not a wrong view; the next request may well have it
      return r.rule === null || r.rule === 'spacing' ? null : r.rule;
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
 * Spec revision 56 §8.1 "The flight-list step": selects (or resumes) the plan, reads its date pairs as many at a time as
 * the browser loads pages at once (CAMOUFOX_PAGES_AT_ONCE) under the error table, each request shaped by `requestOf`,
 * stops the pass's return phases (or booking reads) after a transient end. A failure outside the error table (the
 * database itself) stops the run fatal (R-dberror).
 *
 * Design 2026-11-08 §4.3–§4.5, §7, in confirm mode: each read that finishes is checked (`checkOfRead`; a failed read
 * that does not end the step is unread) and applied to the standings in the order reads finish; the step starts no
 * new read once `patienceSpent` (stop `patience`) or once returns stopped (`returns-stopped`), reads in flight finishing
 * and kept. `cells` grows as each read starts and the counts are stored as each finishes, so the page's running line
 * and a crash both see them; a pair whose read sent no page (the window, an abort) leaves `cells` again. An ending error
 * writes no row for the pairs not started (their last real trip keeps leading). After the pool: `queue-empty` when
 * every queued pair was read and nothing stopped the step; then each pair not started whose newest list is within the
 * refresh and holds a trip counts as checked (reused, §4.3), and the rest below the 5th confirmed price as unchecked
 * (`uncheckedCheaper`, §4.5).
 */
export async function runFlightLists(ctx: EngineContext, run: RunState): Promise<void> {
  if (!flightStepEntry(ctx, run)) {
    markLeftByWindow(ctx, run);
    return;
  }
  const cap = capabilityOf(ctx);
  if (cap === undefined) return;
  const log = run.log.child({ providerId: FLIGHT_LIST_PROVIDER, step: 'flight-lists' });
  try {
    const p = planOf(ctx, run);
    if (p === null) return;
    const { toRead, confirm } = p;
    let plan = p.plan;
    const store = (next: FlightListsState): void => {
      plan = next;
      ctx.repos.executions.patch(run.executionId, { flightLists: plan });
    };
    // why: a resumed pass that reads again what an earlier pass left clears that pass's early end; it sets its own. A
    // confirm-mode pass always does: it reads on from a rebuilt queue, and an empty one is the queue's own end
    if ((toRead.length > 0 || confirm !== null) && plan.ended !== null) store({ ...plan, ended: null });
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
    // why: the first stop the step meets (an abort, the window, an ending error, or in confirm mode rule A or returns
    // lost) decides how the step ends, as it did one page at a time; a page already in flight then writes its own row
    // and stops nothing more
    let stopped = false;
    // why: an ending error met first; in outbound-only mode the pairs no lane had started yet fail with its reason
    let ending: Extract<PageOutcome, { kind: 'failed' }> | null = null;
    let endedReason: StopDetail | null = null;
    const started = new Set<number>();
    // why: the pairs that wrote a row this pass (read, or failed); the rest were never read (design §4.5)
    const written = new Set<number>();
    let standings = confirm?.standings ?? EMPTY_STANDINGS;
    let unread = confirm?.unread ?? 0;
    let stop: ConfirmSummary['stop'] = null;
    const summary = (): ConfirmSummary | null =>
      confirm === null || plan.confirm === null
        ? plan.confirm
        : { ...plan.confirm, confirmed: standings.prices.length, unread, stop };
    const withCells = (cells: CellKey[]): FlightListsState => ({
      ...plan,
      cells,
      planned: cells.length + plan.reused,
    });
    // why: as many pages at once as the worker loads (CAMOUFOX_PAGES_AT_ONCE)
    await runPool(toRead, ctx.limitsOf(FLIGHT_LIST_PROVIDER).concurrency, intake.signal, async (cell, i) => {
      started.add(i);
      const key = cellKeyString(cell);
      // why: design §7: `cells` is the pairs this run started reading, so the running line counts a read as it starts
      if (confirm !== null && !plan.cells.some((c) => cellKeyString(c) === key))
        store(withCells([...plan.cells, cellOf(cell)]));
      const o = await readPage(ctx, run, cap, cell, () => plan, gate);
      if (o.kind === 'abort' || o.kind === 'window') {
        // why: no page was answered and no row written: the pair was not read, so it is not counted as one
        if (confirm !== null) store(withCells(plan.cells.filter((c) => cellKeyString(c) !== key)));
        if (o.kind === 'window' && !stopped) ended = 'window';
        stopped = true;
        intake.abort();
        return;
      }
      writeRow(ctx, run, cell, o);
      written.add(i);
      if (o.kind === 'read') {
        // why: Review Focus 2 — a wrong return or booking view is not repeated: no further request carries one (a
        // request already in flight was shaped before it, and reads as it was sent)
        const returnsStopped = plan.returnsStopped ?? returnsStopOf(o.list.returns);
        const bookingStopped = plan.bookingStopped ?? bookingStopOf(o.list.returns);
        if (returnsStopped !== plan.returnsStopped || bookingStopped !== plan.bookingStopped) {
          store({ ...plan, returnsStopped, bookingStopped });
          log.info(
            { returnsStopped, bookingStopped },
            'flight lists: a transient end stops the rest of the pass',
          );
        }
      }
      if (confirm !== null) {
        // why: §4.3: a failed read that does not end the step learnt nothing (unread); an ending one is no check at all
        const check =
          o.kind === 'read'
            ? checkOfRead(o.list.returns, o.list.flights, confirm.limits)
            : o.end
              ? null
              : UNREAD;
        if (check !== null) {
          standings = applyCheck(standings, check, 'read');
          if (check.kind === 'unread') unread += 1;
        }
        // why: §4.6: returns lost part-way starts no new read (no read after it could confirm a trip); §4.4: nor does
        // a 12th finished read in a row that did not improve the standings. Reads in flight finish and are kept
        const now: ConfirmSummary['stop'] =
          plan.returnsStopped !== null ? 'returns-stopped' : patienceSpent(standings) ? 'patience' : null;
        if (now !== null && !stopped) {
          stop = now;
          stopped = true;
          intake.abort();
          log.info({ stop, confirmed: standings.prices.length }, 'flight lists: no more reads');
        }
      }
      if (o.kind === 'failed' && o.end) {
        if (!stopped) {
          ending = o;
          // why: design §4.5, §4.7: in confirm mode the pairs not started get no row, so the plan itself must say an
          // ending error stopped the step (`stopped`, as a cap does), or a later pass would read on; outbound-only mode
          // keeps today's end (its failed rows say why)
          ended = o.ended ?? (confirm === null ? null : 'stopped');
          // why: design §5.5 — the ending page's own detail is the stop's reason; a read in flight that fails later (a
          // parse, the network) never replaces it, because only the first stop the step meets is recorded here
          if (ended === 'stopped') endedReason = o.reason;
        }
        stopped = true;
        intake.abort();
      }
      if (confirm !== null) store({ ...plan, confirm: summary() });
    });
    if (ending !== null && confirm === null) {
      const o = ending;
      // why: the rest fail with the same reason and no request is sent (the error table's "the rest" column); a page
      // already in flight wrote its own row. Design §4.5: in confirm mode the pairs not started keep what they had
      toRead.forEach((rest, i) => {
        if (!started.has(i)) writeRow(ctx, run, rest, o);
      });
    }
    if (confirm !== null) {
      const unstarted = toRead.filter((_, i) => !written.has(i));
      if (!stopped && unstarted.length === 0) stop = 'queue-empty';
      // why: §4.3: a pair not reached whose newest list is within the refresh and holds a trip still leads its date:
      // it is checked (counted reused, its trip in the standings), never unchecked
      const now = ctx.clock.now();
      const remaining: number[] = [];
      let reused = plan.reused;
      for (const c of unstarted) {
        const k = cellKeyString(c);
        const l = confirm.newest.get(k);
        const check =
          l !== undefined && l.status === 'read' && listFresh(l.fetchedAt, now, confirm.refreshHours)
            ? checkOfRead(l.returns, l.flights, confirm.limits)
            : UNREAD;
        if (check.kind === 'confirmed') {
          standings = applyCheck(standings, check, 'reuse');
          reused += 1;
        } else remaining.push(confirm.prices.get(k) ?? 0);
      }
      const last = summary();
      store({
        ...plan,
        reused,
        planned: plan.cells.length + reused,
        ended: ended ?? plan.ended,
        endedReason: endedReason ?? plan.endedReason,
        confirm: last === null ? null : { ...last, uncheckedCheaper: uncheckedCheaper(remaining, standings) },
      });
    } else if (ended !== null) store({ ...plan, ended, endedReason: endedReason ?? plan.endedReason });
    const counts = ctx.repos.flightLists.forExecution(run.executionId, plan.cells);
    log.info({ ...counts, reused: plan.reused, ended, confirm: plan.confirm }, 'flight lists: step done');
  } catch (err) {
    // why: ruling R-dberror (20.9 review) — a failure of the step's own writes is the run's fatal stop, with its cause,
    // as a failure anywhere else in the pass is; it is never logged and completed
    log.error({ err: errorText(err) }, 'flight lists: step failed; the run stops');
    stopRun(run, { kind: 'fatal', message: errorText(err) });
  }
}
