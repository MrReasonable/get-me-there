/**
 * Spec revision 55 §8.1 "Reading one date pair's flights" (WP20 Task 20.9; `POST /definitions/:id/flight-lists`, §10):
 * the figure's airport pair of one date pair of the current space, read on demand by the browser worker, against the
 * monthly page cap only (no execution), one row with `execution_id` NULL.
 *
 * Every refusal comes before any worker call or ledger row. The busy query and the taking of the browser lease run in
 * one synchronous turn (nothing before `lease.hold` is awaited), so a start admitted in that same turn sees the lease
 * held and its first browser page waits for the read (`BrowserLease.whenFree`). The read runs camoufox's discovery
 * preflight first (a refusal records `failed` with its class word), ignores CAMOUFOX_BROWSER_WINDOW (it is its own
 * anchor, like a manual start: no gate is passed), and a throw inside it records `failed` reason `fatal`. Shutdown
 * aborts a read in flight and waits for it within the drain; nothing is written once the engine is closed.
 */
import {
  AbortedError,
  BudgetExceeded,
  type CellKey,
  cellKeyString,
  datePairIndex,
  type IsoDate,
  ProviderError,
  resolveSpace,
  type SearchDefinition,
  type StopDetail,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { loadsBrowserPages } from './scheduler/browserWindow.js';
import { airportNamesOf } from './stages/discovery.js';
import { selectFlightPairs } from './stages/flightLists/select.js';
import { FLIGHT_LIST_PROVIDER } from './stages/flightLists.js';
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

/** The read's own failure row: nothing listed, the reason one STOP_DETAILS word. */
function failedRow(ctx: EngineContext, def: SearchDefinition, cell: CellKey, reason: StopDetail) {
  return {
    definitionId: def.id,
    executionId: null,
    providerId: FLIGHT_LIST_PROVIDER,
    sourceKind: 'scraped-self' as const,
    cabin: def.cabin,
    ...cell,
    fetchedAt: ctx.clock.now(),
    pointOfSale: ctx.pointOfSaleOf(FLIGHT_LIST_PROVIDER),
    status: 'failed' as const,
    reason,
    listed: null,
    minMinor: null,
    tabMinor: null,
    cheapestView: null,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: null,
    flights: [],
  };
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
    if (cap === undefined) return;
    try {
      const pre = await provider?.discovery?.preflight?.({
        executionId: null,
        signal,
        recordFixtures: false,
      });
      if (pre !== undefined && !pre.ok) {
        const word = pre.reason ?? (pre.skip === 'provider_unavailable' ? 'provider-unavailable' : 'blocked');
        log.warn({ skip: pre.skip, detail: pre.detail }, 'flight read: preflight refused');
        write(failedRow(ctx, def, cell, word));
        return;
      }
      const names = airportNamesOf(ctx);
      const r = await cap.read(
        { cell, airportNames: { origin: names(cell.origin), destination: names(cell.destination) } },
        { executionId: null, signal, recordFixtures: false },
      );
      if (r.kind === 'list-error') {
        write(failedRow(ctx, def, cell, toStopDetail(r.error.reason ?? null, r.error.kind)));
        return;
      }
      write({
        ...failedRow(ctx, def, cell, 'fatal'),
        fetchedAt: r.fetchedAt,
        pointOfSale: r.pointOfSale,
        status: 'read',
        reason: null,
        listed: r.listed,
        minMinor: r.minMinor,
        tabMinor: r.tabMinor,
        cheapestView: r.cheapestView,
        optionsUnparsed: r.optionsUnparsed,
        optionsOtherCell: r.optionsOtherCell,
        resultsStated: r.resultsStated,
        flights: r.flights,
      });
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
        write(failedRow(ctx, def, cell, word));
      } catch (first) {
        log.error({ err: errorText(first), reason: word }, 'flight read: its failure could not be recorded');
        try {
          if (word !== 'fatal') write(failedRow(ctx, def, cell, 'fatal'));
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
      const fresh =
        newest !== undefined &&
        selectFlightPairs(
          [figure],
          new Map([
            [
              cellKeyString(newest),
              { fetchedAt: newest.fetchedAt, status: newest.status, listed: newest.listed },
            ],
          ]),
          ctx.clock.now(),
          refreshHoursOf(def, FLIGHT_LIST_PROVIDER),
          today,
        ).reused.length === 1;
      if (fresh) return { ok: false, code: 'fresh' };
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
