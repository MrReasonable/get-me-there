/**
 * Design 2026-11-08 §6.1 (plan Task 5): `GET /definitions/:id/trip`, the Trip page's one read. Its figure is the
 * board's, through the one composition the date pair detail reads too (`datePairFigureOf`), so the card and the search
 * page's row never disagree; the flight list is the figure's own cell's newest (Ruling 3: the read cell's when there is
 * no figure), its booking address the list's chosen pairing's (Ruling 5); the cells, the calendar and cached prices and
 * the log are read over the same filtered scope. Every price carries its provenance.
 *
 * why: the api process is the only writer and better-sqlite3 is synchronous, so no engine write lands between these
 * reads; an await here would break that snapshot.
 */
import {
  type apiContract,
  type CellKey,
  cheapestPairing,
  type DatePairFigure,
  datePairIndex,
  daysBetween,
  flightLimitsOf,
  type IsoDate,
  isoDateSchema,
  priceLabelKind,
  type SearchDefinition,
} from '@gmt/core';
import type { StoredFlightList } from '@gmt/db';
import { type Engine, FLIGHT_LIST_PROVIDER, flightReadUnavailable, refreshHoursOf } from '@gmt/engine';
import type { z } from 'zod';
import { ApiError, fieldsDetail } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { datePairFigureOf } from './datePairs.js';
import { readNow, toFlightList } from './flightLists.js';
import { safeSearchLink } from './links.js';
import { partiallyVerifiedCells } from './load.js';
import { pairingBookingUrl } from './pairings.js';
import { verificationConfigured } from './results.js';
import { priceOf, type ResultRow } from './rows.js';
import { classifyCells, parentFacts } from './scope.js';
import { currentSpace } from './space.js';
import { tripLog } from './tripLog.js';

export type TripQuery = z.infer<typeof apiContract.tripQuerySchema>;
export type TripResponse = z.infer<typeof apiContract.tripResponseSchema>;

/** A calendar date of the query, else the scope parser's own 422 (`invalid_date_pair`, on that field). */
function dateOf(raw: string, field: 'departureDate' | 'returnDate'): IsoDate {
  const d = isoDateSchema.safeParse(raw);
  if (d.success) return d.data;
  throw new ApiError(
    422,
    'invalid_date_pair',
    API_TEXT.invalidDatePair,
    fieldsDetail([{ field, message: API_TEXT.invalidDatePair }]),
  );
}

/**
 * The newest of `rows` by fetch time (ties: the first), as a price with whether a later search found it gone and the
 * airport pair it was read for.
 */
function newestOf(rows: readonly ResultRow[]): TripResponse['calendar'] {
  let best: ResultRow | null = null;
  for (const r of rows)
    if (best === null || Date.parse(r.provenance.fetchedAt) > Date.parse(best.provenance.fetchedAt)) best = r;
  // why: decision 54: a newer search found the cell empty, so the price is "not seen again"
  return best === null
    ? null
    : {
        ...priceOf(best),
        notSeenAgain: best.superseded,
        origin: best.cell.origin,
        destination: best.cell.destination,
      };
}

/**
 * The controller's ruling (prov-014, goal 4): the couldn't-read line only where the board shows a failed read: a figure
 * reading `list-failed` (its cause, at that failed list's read time), or no figure and the read cell's newest list failed.
 */
function listFailureOf(
  figure: Pick<DatePairFigure, 'pairingRead' | 'listReason'> | null,
  list: Pick<StoredFlightList, 'status' | 'reason' | 'fetchedAt'> | undefined,
): TripResponse['listFailure'] {
  if (list?.status !== 'failed') return null;
  if (figure === null) return list.reason === null ? null : { at: list.fetchedAt, cause: list.reason };
  return figure.pairingRead === 'list-failed' && figure.listReason !== null
    ? { at: list.fetchedAt, cause: figure.listReason }
    : null;
}

export function assembleTrip(
  def: SearchDefinition,
  q: TripQuery,
  ports: Ports,
  engine: Pick<Engine, 'flightReadInFlight' | 'flightPagesPlanned'>,
): TripResponse {
  const departureDate = dateOf(q.departureDate, 'departureDate');
  const returnDate = dateOf(q.returnDate, 'returnDate');
  if (returnDate < departureDate)
    throw new ApiError(
      422,
      'invalid_date_pair',
      API_TEXT.invalidDatePair,
      fieldsDetail([{ field: 'returnDate', message: API_TEXT.invalidDatePair }]),
    );
  const today = ports.clock.todayLondon();
  const space = currentSpace(def, today);
  const unavailable = flightReadUnavailable(
    { providers: new Map(ports.providers.map((p) => [p.id, p])) },
    def,
  );
  const refreshHours = refreshHoursOf(def, FLIGHT_LIST_PROVIDER);
  const limits = flightLimitsOf(def.constraints);
  const pagesPlanned = engine.flightPagesPlanned();
  const pair = { departureDate, returnDate };
  const always = {
    departureDate,
    returnDate,
    nights: daysBetween(departureDate, returnDate),
    verificationConfigured: verificationConfigured(def),
    refreshHours,
    limits,
    // why: fix round 1 (Ruling 2): the card's figure falls back to the board row's own search, in this market
    pointOfSale: ports.config.pointOfSale,
  };
  // why: Ruling 4: the board's window test (the current space always starts tomorrow, so a departed pair is outside
  // it), before the scope is parsed, so an old link to departed dates, or to dates the search no longer covers, is a 200
  const inWindow =
    space.departureFrom <= space.departureTo && datePairIndex(space, departureDate, returnDate) !== null;
  if (!inWindow)
    return {
      ...always,
      inWindow: false,
      figure: null,
      journeyLeftOut: 0,
      listFailure: null,
      cells: [],
      flightList: null,
      bookingUrl: null,
      searchLink: null,
      booking: null,
      calendar: null,
      cached: null,
      log: [],
      reading: false,
      read: {
        available: unavailable === null,
        unavailableReason: unavailable,
        wouldGo: false,
        pagesPlanned,
        origin: null,
        destination: null,
      },
    };

  const { figure, journeyLeftOut, scope, loaded, chosen, pairingCell } = datePairFigureOf(
    def,
    {
      departureDate: q.departureDate,
      returnDate: q.returnDate,
      origins: q.origins,
      destinations: q.destinations,
      maxJourneyMinutes: q.maxJourneyMinutes,
    },
    ports,
  );
  const inScope = (c: { origin: string; destination: string }) =>
    scope.space.origins.some((o) => o === c.origin) &&
    scope.space.destinations.some((d) => d === c.destination);
  // why: the controller's ruling (goal 4: the card agrees with the board): the cell whose flight read the board asked,
  // even when it found no list there (a stale verified figure's is its date pair's best calendar cell, maybe another
  // airport pair; a fresh verified figure asks none); else the figure's own
  // cell (Review Focus 3); with no figure, the read cell (Ruling 3), the one a read with no pair named takes (the
  // search's first origin and destination, in its own order), kept inside the filtered scope
  const readOrigin = space.origins.find((o) => scope.space.origins.includes(o));
  const readDestination = space.destinations.find((d) => scope.space.destinations.includes(d));
  const cell: CellKey | null =
    figure !== null && pairingCell !== null
      ? pairingCell
      : figure !== null
        ? { origin: figure.origin, destination: figure.destination, ...pair }
        : readOrigin === undefined || readDestination === undefined
          ? null
          : { origin: readOrigin, destination: readDestination, ...pair };
  const pointOfSale = ports.config.pointOfSale;
  const list =
    cell === null
      ? undefined
      : ports.repos.flightLists.newestPerCell(def.id, [cell], def.cabin, pointOfSale)[0];
  const chosenPairing = list?.returns == null ? null : cheapestPairing(list.returns, list.flights, limits);
  const classes = classifyCells(
    scope.space,
    parentFacts(ports, loaded.latestParent),
    ports.repos.cells.childVerificationRollUps(def.id),
    { partiallyVerified: partiallyVerifiedCells(loaded) },
  );
  // why: the core rule that names a calendar price's label (`cached` only for the Aviasales cache)
  const isCached = (r: ResultRow) =>
    priceLabelKind({ kind: 'calendar', providerId: r.provenance.providerId }, false) === 'cached';
  // why: final review I4: About's calendar and cached prices are the card's own cell's when its figure is
  // calendar-based (a calendar figure, or a pairing figure, whose grid price is its own cell's), else the cell whose
  // list the card reads, so they never name a newer read of another airport pair as the card's
  const aboutCell =
    figure !== null && figure.basis !== 'verified'
      ? { origin: figure.origin, destination: figure.destination }
      : cell;
  const aboutRows = loaded.calendar.filter(
    (r) =>
      aboutCell !== null &&
      r.cell.origin === aboutCell.origin &&
      r.cell.destination === aboutCell.destination,
  );
  const mark = engine.flightReadInFlight();
  // why: the wire's figure is the board's less its airport-pair index (`datePairFigureSchema`), as `/results` sends it
  let figureOut: TripResponse['figure'] = null;
  if (figure !== null) {
    const { airportPair: _airportPair, ...rest } = figure;
    figureOut = rest;
  }
  return {
    ...always,
    inWindow: true,
    figure: figureOut,
    journeyLeftOut,
    listFailure: listFailureOf(figure, list),
    cells: classes.map((c) => ({
      origin: c.cell.origin,
      destination: c.cell.destination,
      bucket: c.bucket,
      skipReason: c.skipReason,
    })),
    flightList: list === undefined ? null : toFlightList(list, loaded.rc.now, refreshHours),
    bookingUrl: list === undefined || chosenPairing === null ? null : pairingBookingUrl(list, chosenPairing),
    searchLink: cell === null ? null : safeSearchLink(FLIGHT_LIST_PROVIDER, cell, def, null, pointOfSale),
    // why: a verified figure's own booking, re-validated when its row was read (`verifiedRow` through `safeBooking`)
    booking: figure?.basis === 'verified' && chosen !== null ? chosen.booking : null,
    calendar: newestOf(aboutRows.filter((r) => !isCached(r))),
    cached: newestOf(aboutRows.filter(isCached)),
    log: tripLog({
      executions: loaded.all,
      searched: ports.repos.cells.searchedForDatePair(def.id, departureDate, returnDate).filter(inScope),
      prices: ports.repos.calendarPrices
        .perExecutionForDatePair(def.id, departureDate, returnDate)
        .filter((p) => p.price.cabin === def.cabin && inScope(p.price.cell)),
      lists: ports.repos.flightLists
        .forDatePair(def.id, departureDate, returnDate, def.cabin, pointOfSale)
        .filter(inScope),
      rc: loaded.rc,
      limits,
      refreshHours,
    }),
    reading:
      mark !== null &&
      mark.definitionId === def.id &&
      mark.departureDate === departureDate &&
      mark.returnDate === returnDate,
    read: {
      available: unavailable === null,
      unavailableReason: unavailable,
      wouldGo: readNow(unavailable, today, space, pair, list ?? null),
      pagesPlanned,
      origin: cell?.origin ?? null,
      destination: cell?.destination ?? null,
    },
  };
}
