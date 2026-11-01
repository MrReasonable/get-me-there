/**
 * Spec revision 55 §8.1 "The flight-list step" (WP20 Task 20.9): after discovery and before verification (ruling 20.0
 * concern 1; the execution's stage stays `discovery`), in `camoufox` only, the browser worker reads the flight list of
 * the 10 cheapest date pairs on the search's board, one page each, on an allowance of its own (the snapshot's
 * `flightListPages`, outside CAMOUFOX_EXECUTION_PAGE_CAP, inside the monthly page cap and EXECUTION_MAX_FREE_CALLS).
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
  BudgetExceeded,
  type BudgetScopeKind,
  type CellKey,
  cellKeyString,
  cooldownNoticeKey,
  FLIGHT_LIST_COUNT,
  type FlightListCapability,
  type FlightListResult,
  type FlightListsState,
  ProviderError,
  type ProviderId,
  type StopDetail,
} from '@gmt/core';
import type { EngineContext } from '../context.js';
import { errorText } from '../errors.js';
import { lineKey } from '../lines.js';
import { disableProvider, type RunState } from '../run.js';
import { toStopDetail } from '../stopCause.js';
import { airportNamesOf } from './discovery.js';
import { flightPageGate } from './flightLists/gate.js';
import { selectFlightPairs } from './flightLists/select.js';
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
    disableProvider(
      run,
      FLIGHT_LIST_PROVIDER,
      'a blocked flight-list page',
      'provider_disabled',
      until === null
        ? undefined
        : {
            detail: `${FLIGHT_LIST_PROVIDER} stopped on a flight-list page: ${errorText(e)}. It is not called again until the cool-down ends.`,
            key: cooldownNoticeKey(FLIGHT_LIST_PROVIDER, until),
          },
      { detail: 'blocked', until },
    );
  }
  return { kind: 'failed', reason, end: ENDING.has(e.kind), ended: null };
}

/**
 * Reads one page under the step's error table. The lease is awaited first (an on-demand read in flight), then the
 * step's own allowance is checked (so an eleventh page is refused at `provider-execution` before any call), then the
 * capability reads with the run's controller signal and the step's gate.
 */
async function readPage(
  ctx: EngineContext,
  run: RunState,
  cap: FlightListCapability,
  cell: CellKey,
  gate: () => void,
): Promise<PageOutcome> {
  const names = airportNamesOf(ctx);
  try {
    await ctx.lease.whenFree(run.controller.signal);
    const allowance = ctx.budget.usage({
      kind: 'provider-execution',
      executionId: run.executionId,
      providerId: FLIGHT_LIST_PROVIDER,
    }).flightLists;
    // why: fail closed: a guard that states no flight allowance gives none (the guard itself reads an absent one as 0)
    const pages = allowance?.cap ?? 0;
    const used = allowance?.calls ?? 0;
    if (used + 1 > pages)
      throw new BudgetExceeded({
        scope: 'provider-execution',
        providerId: FLIGHT_LIST_PROVIDER,
        cap: pages,
        current: used,
        requested: 1,
      });
    const r = await cap.read(
      { cell, airportNames: { origin: names(cell.origin), destination: names(cell.destination) } },
      {
        executionId: run.executionId,
        signal: run.controller.signal,
        recordFixtures: false,
        beforeSend: gate,
      },
    );
    return r.kind === 'list' ? { kind: 'read', list: r } : errorOutcome(run, r.error);
  } catch (err) {
    // why: a cancel, SIGTERM or fatal stop aborts the run's controller; whatever the page then threw, nothing is written
    if (run.controller.signal.aborted) return { kind: 'abort' };
    if (err instanceof AbortedError) return { kind: 'window' };
    if (err instanceof BudgetExceeded) return budgetOutcome(err.scope);
    if (err instanceof ProviderError) return errorOutcome(run, err);
    run.log
      .child({ providerId: FLIGHT_LIST_PROVIDER })
      .error({ err: errorText(err) }, 'flight list: page threw');
    return { kind: 'failed', reason: 'fatal', end: true, ended: 'stopped' };
  }
}

/** One flight-list row (spec §7 `flight_lists`): `read` with every field, or `failed` with its reason and nothing listed. */
function writeRow(
  ctx: EngineContext,
  run: RunState,
  cell: CellKey,
  o: Extract<PageOutcome, { kind: 'read' | 'failed' }>,
): void {
  const base = {
    definitionId: run.definitionId,
    executionId: run.executionId,
    providerId: FLIGHT_LIST_PROVIDER,
    sourceKind: 'scraped-self' as const,
    cabin: run.snapshot.cabin,
    origin: cell.origin,
    destination: cell.destination,
    departureDate: cell.departureDate,
    returnDate: cell.returnDate,
  };
  if (o.kind === 'read') {
    const l = o.list;
    ctx.repos.flightLists.insert({
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
    });
    return;
  }
  ctx.repos.flightLists.insert({
    ...base,
    fetchedAt: ctx.clock.now(),
    pointOfSale: ctx.pointOfSaleOf(FLIGHT_LIST_PROVIDER),
    status: 'failed',
    reason: o.reason,
    listed: null,
    minMinor: null,
    tabMinor: null,
    cheapestView: null,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: null,
    flights: [],
  });
}

const cellOf = (c: CellKey): CellKey => ({
  origin: c.origin,
  destination: c.destination,
  departureDate: c.departureDate,
  returnDate: c.returnDate,
});

/**
 * The plan this pass works from, and the cells it still reads. A resumed pass keeps the stored plan (`planned` and
 * `cells` fixed) and reads only planned cells with no row of this execution, skipping (no row) one that has departed;
 * a pass with no stored plan selects one from the board's ranking (`selectFlightPairs`) and writes it once, before
 * its first page, only when at least one date pair was selected to read or reuse.
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
  const newest = new Map(
    ctx.repos.flightLists
      .newestPerCell(
        run.definitionId,
        candidates.map(cellOf),
        run.snapshot.cabin,
        ctx.pointOfSaleOf(FLIGHT_LIST_PROVIDER),
      )
      .map((l) => [cellKeyString(l), { fetchedAt: l.fetchedAt, status: l.status, listed: l.listed }]),
  );
  const sel = selectFlightPairs(
    candidates,
    newest,
    now,
    refreshHoursOf(run.snapshot, FLIGHT_LIST_PROVIDER),
    today,
  );
  const planned = sel.read.length + sel.reused.length;
  if (planned === 0) return null;
  const plan: FlightListsState = {
    planned,
    cells: sel.read.map(cellOf),
    reused: sel.reused.length,
    ended: null,
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
 * Spec revision 55 §8.1 "The flight-list step": selects (or resumes) the plan, reads its date pairs one at a time
 * (concurrency 1) under the error table, and records its counts on the run (`run.flightLists`, which the budget cause
 * it runs after carries). A failure of the step's own bookkeeping is logged and ends the step; it never stops the run.
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
    const { plan, toRead } = p;
    // why: a resumed pass that reads again what an earlier pass left clears that pass's early end; it sets its own
    if (toRead.length > 0 && plan.ended !== null)
      ctx.repos.executions.patch(run.executionId, { flightLists: { ...plan, ended: null } });
    log.info({ planned: plan.planned, reused: plan.reused, toRead: toRead.length }, 'flight lists: planned');
    // why: the step's own intake (never run.intake or a lane's, both aborted by a budget stop): it stops taking pages
    const intake = new AbortController();
    const gate = flightPageGate(ctx, run);
    let ended: FlightListsState['ended'] = null;
    for (let i = 0; i < toRead.length && !intake.signal.aborted; i++) {
      const cell = toRead[i];
      if (cell === undefined) break;
      const o = await readPage(ctx, run, cap, cell, gate);
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
    log.error({ err: errorText(err) }, 'flight lists: step failed');
  } finally {
    run.flightStepActive = false;
  }
}
