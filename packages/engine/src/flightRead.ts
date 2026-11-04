/**
 * Spec revision 56 §8.1 "Reading one date pair's flights" (WP20 Task 20.9, WP21 Task 21.6; `POST /definitions/:id/flight-lists`, §10):
 * the figure's airport pair of one date pair of the current space, read on demand by the browser worker, against the
 * monthly page cap only (no execution), one row with `execution_id` NULL.
 *
 * Every refusal comes before any worker call or ledger row. The busy query and the taking of the browser lease run in
 * one synchronous turn (nothing before `lease.hold` is awaited), so a start admitted in that same turn sees the lease
 * held and its first browser page waits for the read (`BrowserLease.whenFree`). The read runs camoufox's discovery
 * preflight first (a refusal records `failed` with its class word; its result sets the worker's flags), sends the
 * definition's own limits (`returnLimits`) and `booking` when those flags say so and the month's headroom holds 2 pages
 * (else an outbound-only read of one page, never a refusal: R-low-pages), ignores CAMOUFOX_BROWSER_WINDOW (it is its
 * own anchor, like a manual start: no gate is passed), stores the return read on its row (one read-row builder shared
 * with the step), and a throw inside it records `failed` reason `fatal`. Shutdown aborts a read in flight and waits for
 * it within the drain; nothing is written once the engine is closed.
 */
import {
  AbortedError,
  BudgetExceeded,
  type CellKey,
  datePairIndex,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  type FlightListQuery,
  flightLimitsOf,
  flightPagesPerPair,
  type IsoDate,
  ProviderError,
  resolveSpace,
  type SearchDefinition,
  type StopDetail,
} from '@gmt/core';
import type { NewestFlightList } from '@gmt/db';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { loadsBrowserPages } from './scheduler/browserWindow.js';
import { airportNamesOf, cellAirportNames } from './stages/discovery.js';
import { listReusable, newestListOf } from './stages/flightLists/select.js';
import {
  FLIGHT_LIST_PROVIDER,
  type FlightRowBase,
  failedRowOf,
  monthHeadroom,
  readRowOf,
} from './stages/flightLists.js';
import { refreshHoursOf } from './stages/reuse.js';
import { toStopDetail } from './stopCause.js';

/** One date pair (spec §10: the body of the POST). */
export interface DatePairAsk {
  departureDate: IsoDate;
  returnDate: IsoDate;
}

/** Why flight lists cannot be read for a search (spec §10 `unavailableReason`, ruling A33). */
export type FlightReadUnavailable = 'not-named' | 'not-configured' | 'cabin';

/**
 * A read's start (spec rev 55 §5 `FlightReadStart`): started, with `done` settling once its row is written (it never
 * rejects), or refused with its code; `not_available` carries its reason (ruling A33).
 */
export type FlightReadStart =
  | { ok: true; done: Promise<void> }
  | { ok: false; code: 'not_available'; reason: FlightReadUnavailable }
  | { ok: false; code: 'busy' | 'fresh' | 'not_found' | 'outside_space' | 'no_price' | 'shutting-down' };

/** The read in flight, as `GET /definitions/:id/flight-lists` reports it (`reading`). */
export interface FlightReadMark {
  definitionId: string;
  departureDate: IsoDate;
  returnDate: IsoDate;
}

export interface FlightReader {
  read(definitionId: string, pair: DatePairAsk): Promise<FlightReadStart>;
  inFlight(): FlightReadMark | null;
  /** Shutdown: aborts the read in flight (if any) and resolves once it has settled. */
  stop(): Promise<void>;
}

/**
 * Spec §10 `unavailableReason`: the search does not name camoufox, the install has not configured it (no flight-list
 * capability), or the cabin is one it does not read (economy only); null when flight lists can be read.
 */
export function flightReadUnavailable(
  ctx: Pick<EngineContext, 'providers'>,
  def: Pick<SearchDefinition, 'providers' | 'cabin'>,
): FlightReadUnavailable | null {
  if (!def.providers.discovery.includes(FLIGHT_LIST_PROVIDER)) return 'not-named';
  const cap = ctx.providers.get(FLIGHT_LIST_PROVIDER)?.flightLists;
  if (cap === undefined) return 'not-configured';
  return cap.cabins.includes(def.cabin) ? null : 'cabin';
}

/**
 * Review Focus 2: whether any parent run whose snapshot names the browser provider is pending or running (a
 * Travelpayouts-only run does not count). One synchronous read of the executions table.
 */
function browserRunActive(ctx: EngineContext): boolean {
  return ctx.repos.executions
    .listByStatus(['pending', 'running'])
    .some((e) => !e.isChild && e.snapshot.providers.discovery.some(loadsBrowserPages));
}

/** What every row of an on-demand read carries (spec rev 55 §8.1: `execution_id` NULL). */
function baseOf(def: SearchDefinition, cell: CellKey): FlightRowBase {
  return {
    definitionId: def.id,
    executionId: null,
    providerId: FLIGHT_LIST_PROVIDER,
    sourceKind: 'scraped-self',
    cabin: def.cabin,
    origin: cell.origin,
    destination: cell.destination,
    departureDate: cell.departureDate,
    returnDate: cell.returnDate,
  };
}

/**
 * Spec rev 56 §8.1 "Reading one date pair's flights": the return phase the read plans from the worker's flags (just
 * read by its preflight) and the definition's own limits: with `RETURN_SELECT_VERIFIED`, the limits and `booking` per
 * `BOOKING_SELECT_VERIFIED`, unless the month's headroom is below the 2 pages a return phase may load (R-low-pages: an
 * outbound-only read of one page then, never a refusal).
 */
function phaseOf(
  ctx: EngineContext,
  def: SearchDefinition,
): Pick<FlightListQuery, 'returnLimits' | 'booking'> {
  const flags = ctx.workerFlags.get(FLIGHT_LIST_PROVIDER);
  if (flightPagesPerPair(flags) !== FLIGHT_LIST_PAGES_PER_PAIR_MAX) return {};
  if (monthHeadroom(ctx) < FLIGHT_LIST_PAGES_PER_PAIR_MAX) return {};
  return { returnLimits: flightLimitsOf(def.constraints), booking: flags?.BOOKING_SELECT_VERIFIED === true };
}

/**
 * The return phase the on-demand `fresh` check judges a list by (21.6 re-review N2). With the worker's flags unread (no
 * preflight since the app started) the read's own preflight may report the return flags, so the read is judged as
 * planning the whole return phase, as the read button states 2 pages then (prov-008): a young outbound-only list is
 * read again rather than refused as fresh. With the flags read, the phase the read would send (`phaseOf`).
 */
function freshPhaseOf(
  ctx: EngineContext,
  def: SearchDefinition,
): Pick<FlightListQuery, 'returnLimits' | 'booking'> {
  if (ctx.workerFlags.get(FLIGHT_LIST_PROVIDER) !== null) return phaseOf(ctx, def);
  if (monthHeadroom(ctx) < FLIGHT_LIST_PAGES_PER_PAIR_MAX) return {};
  return { returnLimits: flightLimitsOf(def.constraints), booking: true };
}

/**
 * Spec rev 56 §8.1 (final review B-I3): whether an on-demand read would refuse `newest` as `fresh` now: the step's
 * reuse rule (`listReusable`) under the return phase this read would send (`freshPhaseOf`). The read's own refusal and
 * the api's `readNow` (whether the read button is offered) read this one rule.
 */
export function flightListFresh(
  ctx: EngineContext,
  def: SearchDefinition,
  newest: NewestFlightList,
): boolean {
  const phase = freshPhaseOf(ctx, def);
  return listReusable(newestListOf(newest), ctx.clock.now(), refreshHoursOf(def, FLIGHT_LIST_PROVIDER), {
    returns: phase.returnLimits !== undefined,
    booking: phase.booking === true,
    current: flightLimitsOf(def.constraints),
  });
}

/** The reader the engine owns (one per engine): one read at a time, through the engine's one browser lease. */
export function createFlightReader(ctx: EngineContext): FlightReader {
  let current: { mark: FlightReadMark; done: Promise<void>; abort: AbortController } | null = null;

  /** The read itself, once every refusal is behind it. Never rejects. */
  async function run(def: SearchDefinition, cell: CellKey, signal: AbortSignal): Promise<void> {
    const log = ctx.log.child({
      definitionId: def.id,
      providerId: FLIGHT_LIST_PROVIDER,
      step: 'flight-read',
    });
    const provider = ctx.providers.get(FLIGHT_LIST_PROVIDER);
    const cap = provider?.flightLists;
    // why: a write after the engine handed the database back would hit a closed handle (review S2)
    const write = (row: Parameters<typeof ctx.repos.flightLists.insert>[0]): void => {
      if (!ctx.lifecycle.closed && !signal.aborted) ctx.repos.flightLists.insert(row);
    };
    const base = baseOf(def, cell);
    if (cap === undefined) return;
    try {
      const pre = await provider?.discovery?.preflight?.({
        executionId: null,
        signal,
        recordFixtures: false,
      });
      // why: spec rev 56 §8.1: the read's preflight result sets the worker's flags, refused or not
      if (pre?.flags !== undefined) ctx.workerFlags.set(FLIGHT_LIST_PROVIDER, pre.flags);
      if (pre !== undefined && !pre.ok) {
        const word = pre.reason ?? (pre.skip === 'provider_unavailable' ? 'provider-unavailable' : 'blocked');
        log.warn({ skip: pre.skip, detail: pre.detail }, 'flight read: preflight refused');
        write(failedRowOf(ctx, base, word));
        return;
      }
      const names = airportNamesOf(ctx);
      const r = await cap.read(
        {
          cell,
          airportNames: cellAirportNames(names, def, cell.origin, cell.destination),
          ...phaseOf(ctx, def),
        },
        { executionId: null, signal, recordFixtures: false },
      );
      if (r.kind === 'list-error') {
        write(failedRowOf(ctx, base, toStopDetail(r.error.reason ?? null, r.error.kind)));
        return;
      }
      write(readRowOf(base, r));
    } catch (err) {
      // why: shutdown aborts the read; an aborted read writes nothing, as an aborted tile writes no outcome
      if (signal.aborted || err instanceof AbortedError) return;
      const word: StopDetail =
        err instanceof BudgetExceeded
          ? 'monthly-cap'
          : err instanceof ProviderError
            ? toStopDetail(err.reason ?? null, err.kind)
            : 'fatal';
      if (word === 'fatal') log.error({ err: errorText(err) }, 'flight read: failed');
      // why: every write here is guarded (20.9 review finding 4), so `done` never rejects: a failure row that cannot be
      // written is logged and recorded as `fatal` instead, and when even that fails it is logged only
      try {
        write(failedRowOf(ctx, base, word));
      } catch (first) {
        log.error({ err: errorText(first), reason: word }, 'flight read: its failure could not be recorded');
        try {
          if (word !== 'fatal') write(failedRowOf(ctx, base, 'fatal'));
        } catch (second) {
          log.error({ err: errorText(second) }, 'flight read: no failure row could be written');
        }
      }
    }
  }

  return {
    read: async (definitionId, pair) => {
      // why: nothing in this function is awaited before `lease.hold`, so the checks and the lease are one turn
      if (ctx.lifecycle.closing) return { ok: false, code: 'shutting-down' };
      const def = ctx.repos.definitions.get(definitionId);
      if (def === null || def.deletedAt !== null) return { ok: false, code: 'not_found' };
      const unavailable = flightReadUnavailable(ctx, def);
      if (unavailable !== null) return { ok: false, code: 'not_available', reason: unavailable };
      const today = ctx.clock.todayLondon();
      const { space } = resolveSpace(def, today);
      // why: a departed date pair is no pick, and one outside the current space is not this search's
      const inSpace =
        pair.departureDate > today &&
        space.departureFrom <= space.departureTo &&
        datePairIndex(space, pair.departureDate, pair.returnDate) !== null;
      if (!inSpace) return { ok: false, code: 'outside_space' };
      const figure = ctx
        .rankedDatePairs?.({
          definitionId,
          space,
          cabin: def.cabin,
          maxJourneyMinutes: def.constraints.maxJourneyMinutes ?? null,
          now: ctx.clock.now(),
        })
        .find((p) => p.departureDate === pair.departureDate && p.returnDate === pair.returnDate);
      if (figure === undefined) return { ok: false, code: 'no_price' };
      const cell: CellKey = {
        origin: figure.origin,
        destination: figure.destination,
        departureDate: figure.departureDate,
        returnDate: figure.returnDate,
      };
      const [newest] = ctx.repos.flightLists.newestPerCell(
        definitionId,
        [cell],
        def.cabin,
        ctx.pointOfSaleOf(FLIGHT_LIST_PROVIDER),
      );
      // why: spec rev 56 §8.1: the step's reuse rule, under the return phase this read would send (`freshPhaseOf`: the
      // worker's last reported flags, the whole phase while they are unread, outbound-only below 2 pages of the month,
      // 21.6 review M8), so a young transient, not-verified, other-limit or phase-less list is read; the date pair
      // departs after today here
      if (newest !== undefined && flightListFresh(ctx, def, newest)) return { ok: false, code: 'fresh' };
      // Review Focus 2: the busy query and the lease in one synchronous turn
      if (current !== null || browserRunActive(ctx)) return { ok: false, code: 'busy' };
      const abort = new AbortController();
      const signal = AbortSignal.any([abort.signal, ctx.lifecycle.abort.signal]);
      let free: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        free = resolve;
      });
      if (!ctx.lease.hold(held)) return { ok: false, code: 'busy' };
      const mark: FlightReadMark = {
        definitionId,
        departureDate: pair.departureDate,
        returnDate: pair.returnDate,
      };
      const done = run(def, cell, signal).finally(() => {
        current = null;
        free();
      });
      current = { mark, done, abort };
      return { ok: true, done };
    },
    inFlight: () => (current === null ? null : { ...current.mark }),
    stop: async () => {
      const c = current;
      if (c === null) return;
      c.abort.abort();
      await c.done;
    },
  };
}
