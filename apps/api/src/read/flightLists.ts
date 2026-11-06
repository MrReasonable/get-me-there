/**
 * Spec revision 55 §10 `GET /definitions/:id/flight-lists?pairs=` (WP20 Task 20.9): the flights on a search's page. Per
 * asked date pair, in the order asked: the figure's airport pair (the board's ranking, so the page and the step name the
 * same cell), its search link through the allowlist (null for a synthetic figure), the newest list for the figure's
 * cell, cabin and point of sale (`list`, the only list that feeds the outcome beside the price) and else the newest list
 * for another airport pair of the current space (`listOtherPair`, shown only inside the flights block). A list never
 * changes a price, a rank or a coverage count (§6.9); it is read here, never written.
 */
import {
  type apiContract,
  type CellKey,
  cellKeyString,
  hoursSince,
  type IsoDate,
  type IsoDateTime,
  isoDateSchema,
  listFresh,
  MAX_FLIGHT_LIST_PAIRS,
  type SearchDefinition,
} from '@gmt/core';
import type { StoredFlightList } from '@gmt/db';
import { type Engine, FLIGHT_LIST_PROVIDER, flightReadUnavailable, refreshHoursOf } from '@gmt/engine';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { safeSearchLink } from './links.js';
import { flightListProvenance } from './pairings.js';
import { rankedFigures } from './ranked.js';
import { currentSpace } from './space.js';

type FlightList = z.infer<typeof apiContract.flightListSchema>;
type FlightListsResponse = z.infer<typeof apiContract.flightListsResponseSchema>;
type DatePairAsk = { departureDate: IsoDate; returnDate: IsoDate };

const PAIR = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;

/**
 * `pairs` as `<departure>_<return>` comma separated, 1 to MAX_FLIGHT_LIST_PAIRS (50) of them, each a calendar date
 * pair; anything else is 422 `invalid_pairs` (spec §10).
 */
export function parsePairs(raw: string): DatePairAsk[] {
  const parts = raw === '' ? [] : raw.split(',');
  if (parts.length < 1 || parts.length > MAX_FLIGHT_LIST_PAIRS)
    throw new ApiError(422, 'invalid_pairs', API_TEXT.invalidPairs(MAX_FLIGHT_LIST_PAIRS));
  return parts.map((p) => {
    const m = PAIR.exec(p);
    const dep = isoDateSchema.safeParse(m?.[1]);
    const ret = isoDateSchema.safeParse(m?.[2]);
    if (!dep.success || !ret.success)
      throw new ApiError(422, 'invalid_pairs', API_TEXT.invalidPairs(MAX_FLIGHT_LIST_PAIRS));
    return { departureDate: dep.data, returnDate: ret.data };
  });
}

/**
 * One stored list on the wire (spec §10 `flightListSchema`): its age in whole hours, `stale` `'refresh'` once older
 * than the search's camoufox refresh, the provenance the database holds it to (the browser worker's own page,
 * economy, GBP, `maxAgeHours` 0, the point of sale the page stated), and (spec rev 56) its return read, with the
 * booking read and its offers, or null for a list read without one. Its pages travel only to the ledger (A5).
 */
export function toFlightList(l: StoredFlightList, now: IsoDateTime, refreshHours: number): FlightList {
  const ageHours = hoursSince(l.fetchedAt, now);
  return {
    id: l.id,
    executionId: l.executionId,
    origin: l.origin,
    destination: l.destination,
    departureDate: l.departureDate,
    returnDate: l.returnDate,
    fetchedAt: l.fetchedAt,
    ageHours,
    // why: spec rev 55 §10 — the stale mark, never a bare true; a list is judged against the camoufox refresh only, on
    // the elapsed milliseconds (final review B-M1: `listFresh`, the pairing's own rule, never the whole hours shown)
    stale: listFresh(l.fetchedAt, now, refreshHours) ? false : 'refresh',
    provenance: flightListProvenance(l),
    status: l.status,
    reason: l.reason,
    listed: l.listed,
    minMinor: l.minMinor,
    tabMinor: l.tabMinor,
    cheapestView: l.cheapestView,
    flights: l.flights,
    optionsUnparsed: l.optionsUnparsed,
    optionsOtherCell: l.optionsOtherCell,
    resultsStated: l.resultsStated,
    returns: l.returns,
  };
}

const pairKey = (p: DatePairAsk): string => `${p.departureDate}|${p.returnDate}`;

/** The contract's link (spec §10): the worker's own page on Google's one host, else none. */
function googleLink(
  l: { url: string; host: string; label: string } | null,
): FlightListsResponse['pairs'][number]['link'] {
  return l !== null && l.host === 'www.google.com'
    ? { url: l.url, host: 'www.google.com', label: l.label }
    : null;
}

/**
 * The failed-list reasons that offer no read again (ruling R-failed-read): a per-run limit stopped it, and the block's
 * note says the limit instead. why: spec rev 64: a list a withdrawn monthly cap stopped (`monthly-cap`, in a row stored
 * before then) may be read again, since no such cap remains.
 */
const NO_READ_AGAIN: ReadonlySet<string> = new Set(['execution-cap']);

/** Spec revision 55 §10: the GET's answer over `def` for the asked `pairs`, in the order asked. */
export function assembleFlightLists(
  def: SearchDefinition,
  pairs: readonly DatePairAsk[],
  ports: Ports,
  engine: Pick<Engine, 'flightReadInFlight' | 'flightPagesPlanned' | 'flightListFresh'>,
): FlightListsResponse {
  const now = ports.clock.now();
  const today = ports.clock.todayLondon();
  const space = currentSpace(def, ports.clock.todayLondon());
  const refreshHours = refreshHoursOf(def, FLIGHT_LIST_PROVIDER);
  const unavailable = flightReadUnavailable(
    { providers: new Map(ports.providers.map((p) => [p.id, p])) },
    def,
  );
  const pointOfSale = ports.config.pointOfSale;
  const figures = new Map(
    rankedFigures(ports, def, {
      space,
      maxJourneyMinutes: def.constraints.maxJourneyMinutes ?? null,
      now,
    }).map((f) => [pairKey(f), f.figure]),
  );
  const cellOf = (p: DatePairAsk): CellKey | null => {
    const f = figures.get(pairKey(p));
    return f === undefined
      ? null
      : {
          origin: f.origin,
          destination: f.destination,
          departureDate: p.departureDate,
          returnDate: p.returnDate,
        };
  };
  const cells = pairs.flatMap((p) => {
    const c = cellOf(p);
    return c === null ? [] : [c];
  });
  // why: two statements for the whole page (the WP19 grouped-read pattern), never one per pair
  const own = new Map(
    ports.repos.flightLists
      .newestPerCell(def.id, cells, def.cabin, pointOfSale)
      .map((l) => [cellKeyString(l), l]),
  );
  const missing = pairs.filter((p) => {
    const c = cellOf(p);
    return c === null || !own.has(cellKeyString(c));
  });
  const other = new Map(
    ports.repos.flightLists
      .newestPerDatePair(def.id, missing, space, def.cabin, pointOfSale)
      .map((l) => [pairKey(l), l]),
  );
  const mark = engine.flightReadInFlight();
  return {
    available: unavailable === null,
    unavailableReason: unavailable,
    refreshHours,
    // why: ruling D3: the pages one read plans (2 with the worker's RETURN_SELECT_VERIFIED, else 1; 2 while none is
    // read yet, prov-008); the read button and its refusal use it, never a hard number
    pagesPlanned: engine.flightPagesPlanned(),
    reading:
      mark === null || mark.definitionId !== def.id
        ? null
        : { departureDate: mark.departureDate, returnDate: mark.returnDate },
    pairs: pairs.map((p) => {
      const figure = figures.get(pairKey(p));
      const c = cellOf(p);
      const list = c === null ? undefined : own.get(cellKeyString(c));
      const elsewhere = list === undefined ? other.get(pairKey(p)) : undefined;
      // why: spec §6.9 — a synthetic figure has no vendor page to search; a real one links to the worker's own page
      const link =
        c === null || figure === undefined || figure.price.provenance.sourceKind === 'synthetic'
          ? null
          : googleLink(safeSearchLink(FLIGHT_LIST_PROVIDER, c, def, null, pointOfSale));
      return {
        departureDate: p.departureDate,
        returnDate: p.returnDate,
        origin: c?.origin ?? null,
        destination: c?.destination ?? null,
        link,
        list: list === undefined ? null : toFlightList(list, now, refreshHours),
        listOtherPair: elsewhere === undefined ? null : toFlightList(elsewhere, now, refreshHours),
        // why: final review B-I3: the read button and the status notes' "what happens next" follow the on-demand read's
        // own rule (`flightListFresh`: the step's reuse rule under the phase the read would send), never a second one
        readNow:
          unavailable === null &&
          c !== null &&
          c.departureDate > today &&
          (list === undefined
            ? true
            : list.status === 'failed'
              ? !NO_READ_AGAIN.has(list.reason ?? '')
              : !engine.flightListFresh(def, list)),
      };
    }),
  };
}
