import {
  type Cabin,
  type CellKey,
  FLIGHT_LIST_MAX_FLIGHTS,
  type Iata,
  type IsoDate,
  type ListedFlight,
  listedFlightSchema,
  type PointOfSale,
  pointOfSaleSchema,
} from '@gmt/core';
import type { Db } from '../client.js';
import { CABINS, LISTED, STOP_DETAILS } from '../internal/enums.js';
import { nullableOneOf, oneOf, parseWith, readDate, readIata, readJson, readTime } from '../internal/read.js';
import { assertInt, assertIsoDate, assertIsoDateTime, RowRejected } from '../internal/validate.js';
import type { FlightListInsert, StoredFlightList } from '../types.js';

const INSERT_LIST_SQL = `
INSERT INTO flight_lists (definition_id, execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date,
  fetched_at, point_of_sale, currency_native, status, reason, listed, min_minor, tab_minor, cheapest_view, options_unparsed, options_other_cell, results_stated)
VALUES (@definitionId, @executionId, @providerId, @sourceKind, @cabin, @origin, @destination, @departureDate, @returnDate,
  @fetchedAt, @pointOfSale, 'GBP', @status, @reason, @listed, @minMinor, @tabMinor, @cheapestView, @optionsUnparsed, @optionsOtherCell, @resultsStated)`;
const INSERT_FLIGHT_SQL = `
INSERT INTO flight_list_flights (list_id, position, departs_local, arrives_local, arrives_day_offset, duration_minutes, stops, carriers_json, operated_by, price_pence)
VALUES (@listId, @position, @departsLocal, @arrivesLocal, @arrivesDayOffset, @durationMinutes, @stops, @carriersJson, @operatedBy, @pricePence)`;

/**
 * The newest list is the greatest `fetched_at`, ties to the later row (`id`): the order `flight_lists_cell_idx` stores,
 * so each probe below is one ordered index read. A failed list competes like a read one: the page shows the newest.
 */
const NEWEST = 'ORDER BY n.fetched_at DESC, n.id DESC LIMIT 1';

// why: one statement per read, the list rows joined to their flights, so a page of ten date pairs is one round trip and
// the newest list per ask is chosen by the database (the WP19 grouped-read pattern); `ord` carries the request order
const PER_CELL_SQL = `
WITH asked AS (
  SELECT CAST(j.key AS INTEGER) AS ord, json_extract(j.value, '$.origin') AS origin, json_extract(j.value, '$.destination') AS destination,
    json_extract(j.value, '$.departureDate') AS departureDate, json_extract(j.value, '$.returnDate') AS returnDate
  FROM json_each(@cells) j)
SELECT a.ord AS ord, l.*, f.position, f.departs_local, f.arrives_local, f.arrives_day_offset, f.duration_minutes, f.stops, f.carriers_json, f.operated_by, f.price_pence
FROM asked a
JOIN flight_lists l ON l.id = (
  SELECT n.id FROM flight_lists n
  WHERE n.definition_id = @definitionId AND n.origin = a.origin AND n.destination = a.destination
    AND n.departure_date = a.departureDate AND n.return_date = a.returnDate AND n.cabin = @cabin AND n.point_of_sale = @pointOfSale
  ${NEWEST})
LEFT JOIN flight_list_flights f ON f.list_id = l.id
ORDER BY a.ord, f.position`;

// why: the origin/destination IN-lists probe the cell index once per airport pair and the newest is picked by sort;
// that is fine at the spaces this app plans (a handful of airports each side, at most 50 date pairs a read)
const PER_DATE_PAIR_SQL = `
WITH asked AS (
  SELECT CAST(j.key AS INTEGER) AS ord, json_extract(j.value, '$.departureDate') AS departureDate, json_extract(j.value, '$.returnDate') AS returnDate
  FROM json_each(@pairs) j)
SELECT a.ord AS ord, l.*, f.position, f.departs_local, f.arrives_local, f.arrives_day_offset, f.duration_minutes, f.stops, f.carriers_json, f.operated_by, f.price_pence
FROM asked a
JOIN flight_lists l ON l.id = (
  SELECT n.id FROM flight_lists n
  WHERE n.definition_id = @definitionId AND n.departure_date = a.departureDate AND n.return_date = a.returnDate
    AND n.origin IN (SELECT value FROM json_each(@origins)) AND n.destination IN (SELECT value FROM json_each(@destinations))
    AND n.cabin = @cabin AND n.point_of_sale = @pointOfSale
  ${NEWEST})
LEFT JOIN flight_list_flights f ON f.list_id = l.id
ORDER BY a.ord, f.position`;

const FOR_EXECUTION_SQL = `
WITH asked AS (
  SELECT DISTINCT json_extract(j.value, '$.origin') AS origin, json_extract(j.value, '$.destination') AS destination,
    json_extract(j.value, '$.departureDate') AS departureDate, json_extract(j.value, '$.returnDate') AS returnDate
  FROM json_each(@cells) j),
newest AS (
  SELECT (SELECT n.status FROM flight_lists n
    WHERE n.execution_id = @executionId AND n.origin = a.origin AND n.destination = a.destination
      AND n.departure_date = a.departureDate AND n.return_date = a.returnDate
    ${NEWEST}) AS status
  FROM asked a)
SELECT COALESCE(SUM(status = 'read'), 0) AS read, COALESCE(SUM(status = 'failed'), 0) AS failed FROM newest`;

/** A list row joined to one of its flights (`position` NULL when the list has none). */
interface JoinedRow {
  ord: number;
  id: number;
  definition_id: string;
  execution_id: string | null;
  provider_id: string;
  source_kind: string;
  cabin: string;
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  fetched_at: string;
  point_of_sale: string;
  status: string;
  reason: string | null;
  listed: string | null;
  min_minor: number | null;
  tab_minor: number | null;
  cheapest_view: string | null;
  options_unparsed: number;
  options_other_cell: number;
  results_stated: number | null;
  position: number | null;
  departs_local: string | null;
  arrives_local: string | null;
  arrives_day_offset: number | null;
  duration_minutes: number | null;
  stops: number | null;
  carriers_json: string | null;
  operated_by: string | null;
  price_pence: number | null;
}

const asCells = (cells: readonly CellKey[]) =>
  JSON.stringify(
    cells.map((c) => ({
      origin: c.origin,
      destination: c.destination,
      departureDate: c.departureDate,
      returnDate: c.returnDate,
    })),
  );

function readFlight(r: JoinedRow): ListedFlight | null {
  if (r.position === null) return null;
  const column = `flight_list_flights[${r.id}:${r.position}]`;
  return parseWith(column, listedFlightSchema, {
    departsLocal: r.departs_local,
    arrivesLocal: r.arrives_local,
    arrivesDayOffset: r.arrives_day_offset,
    durationMinutes: r.duration_minutes,
    stops: r.stops,
    carriers: readJson(`${column}.carriers_json`, r.carriers_json ?? 'null'),
    operatedBy: r.operated_by,
    amountMinor: r.price_pence,
  });
}

function readList(first: JoinedRow, flights: ListedFlight[]): StoredFlightList {
  const c = 'flight_lists';
  return {
    id: first.id,
    definitionId: first.definition_id,
    executionId: first.execution_id,
    // why: the table's CHECKs hold these two to one value each; a row that says otherwise is corrupt, not data
    providerId: oneOf(`${c}.provider_id`, ['camoufox'] as const, first.provider_id),
    sourceKind: oneOf(`${c}.source_kind`, ['scraped-self'] as const, first.source_kind),
    cabin: oneOf(`${c}.cabin`, CABINS, first.cabin),
    origin: readIata(`${c}.origin`, first.origin),
    destination: readIata(`${c}.destination`, first.destination),
    departureDate: readDate(`${c}.departure_date`, first.departure_date),
    returnDate: readDate(`${c}.return_date`, first.return_date),
    fetchedAt: readTime(`${c}.fetched_at`, first.fetched_at),
    pointOfSale: parseWith(`${c}.point_of_sale`, pointOfSaleSchema, first.point_of_sale),
    status: oneOf(`${c}.status`, ['read', 'failed'] as const, first.status),
    reason: nullableOneOf(`${c}.reason`, STOP_DETAILS, first.reason),
    listed: nullableOneOf(`${c}.listed`, LISTED, first.listed),
    minMinor: first.min_minor,
    tabMinor: first.tab_minor,
    cheapestView: nullableOneOf(
      `${c}.cheapest_view`,
      ['cheapest', 'best-fallback'] as const,
      first.cheapest_view,
    ),
    optionsUnparsed: first.options_unparsed,
    optionsOtherCell: first.options_other_cell,
    resultsStated: first.results_stated,
    flights,
  };
}

/** Folds the joined rows (ordered by ask, then flight position) into one list per ask, in ask order. */
function foldLists(rows: readonly JoinedRow[]): StoredFlightList[] {
  const out: StoredFlightList[] = [];
  let current: { ord: number; first: JoinedRow; flights: ListedFlight[] } | null = null;
  const flush = () => {
    if (current !== null) out.push(readList(current.first, current.flights));
  };
  for (const r of rows) {
    if (current === null || current.ord !== r.ord) {
      flush();
      current = { ord: r.ord, first: r, flights: [] };
    }
    const f = readFlight(r);
    if (f !== null) current.flights.push(f);
  }
  flush();
  return out;
}

/**
 * The flight lists the browser worker read (spec revision 55 §7 `flight_lists`, `flight_list_flights`; §8.1). Every
 * lookup is keyed on the airport pair, the dates, the cabin and the point of sale (data-001), never on the date pair
 * alone: an LHR to JFK list is not the answer for LGW to EWR on the same dates. A list belongs to a search definition and
 * optionally to the run that read it; an on-demand read has no run.
 */
export class FlightListsRepo {
  constructor(private readonly db: Db) {}

  /**
   * Stores one list and its flights, in page order, in one transaction: a flight the table refuses rolls the list back.
   * Only the browser worker's own page is stored (data-002, prov-r2-008): a fixture or synthetic list, or any provider
   * but `camoufox` with source kind `scraped-self`, is refused before any SQL (the table's CHECKs are the backstop).
   * Returns the list's id.
   */
  insert(l: FlightListInsert): number {
    if (l.providerId !== 'camoufox' || l.sourceKind !== 'scraped-self')
      throw new RowRejected(
        'provider-kind',
        `a flight list is the browser worker's own page (camoufox, scraped-self); got ${l.providerId} with source kind ${l.sourceKind}`,
      );
    assertIsoDateTime('fetchedAt', l.fetchedAt);
    assertIsoDate('departureDate', l.departureDate);
    assertIsoDate('returnDate', l.returnDate);
    // why: a failed page lists nothing (types.ts `FlightListInsert`): no flight, outcome word, figure or view read
    if (
      l.status === 'failed' &&
      (l.flights.length > 0 ||
        l.listed !== null ||
        l.minMinor !== null ||
        l.tabMinor !== null ||
        l.cheapestView !== null)
    )
      throw new RowRejected(
        'flight-list',
        'a failed list lists nothing: no flights, outcome, figure or view',
      );
    if ((l.status === 'failed') !== (l.reason !== null))
      throw new RowRejected('flight-list', 'a reason exactly when the list failed');
    if ((l.status === 'read') !== (l.listed !== null))
      throw new RowRejected('flight-list', 'a listed word exactly when the list was read');
    if (l.flights.length > FLIGHT_LIST_MAX_FLIGHTS)
      throw new RowRejected(
        'flight-list',
        `at most ${FLIGHT_LIST_MAX_FLIGHTS} flights a list, got ${l.flights.length}`,
      );
    // why: ruling A28: a flight's price is above 0, as the table's CHECK holds; the rest of a flight is the CHECKs' to judge
    for (const f of l.flights) assertInt('amountMinor', f.amountMinor, 1);
    return this.db.transaction(() => {
      const listId = Number(
        this.db.raw.prepare(INSERT_LIST_SQL).run({
          definitionId: l.definitionId,
          executionId: l.executionId,
          providerId: l.providerId,
          sourceKind: l.sourceKind,
          cabin: l.cabin,
          origin: l.origin,
          destination: l.destination,
          departureDate: l.departureDate,
          returnDate: l.returnDate,
          fetchedAt: l.fetchedAt,
          pointOfSale: l.pointOfSale,
          status: l.status,
          reason: l.reason,
          listed: l.listed,
          minMinor: l.minMinor,
          tabMinor: l.tabMinor,
          cheapestView: l.cheapestView,
          optionsUnparsed: l.optionsUnparsed,
          optionsOtherCell: l.optionsOtherCell,
          resultsStated: l.resultsStated,
        }).lastInsertRowid,
      );
      const insertFlight = this.db.raw.prepare(INSERT_FLIGHT_SQL);
      l.flights.forEach((f, position) => {
        insertFlight.run({
          listId,
          position,
          departsLocal: f.departsLocal,
          arrivesLocal: f.arrivesLocal,
          arrivesDayOffset: f.arrivesDayOffset,
          durationMinutes: f.durationMinutes,
          stops: f.stops,
          carriersJson: JSON.stringify(f.carriers),
          operatedBy: f.operatedBy,
          pricePence: f.amountMinor,
        });
      });
      return listId;
    });
  }

  /**
   * The newest list of this definition for each requested cell (airport pair and dates), for one cabin and point of
   * sale, in request order, in one statement. A cell never read has no entry (match the rest by their own fields).
   */
  newestPerCell(
    definitionId: string,
    cells: readonly CellKey[],
    cabin: Cabin,
    pointOfSale: PointOfSale,
  ): StoredFlightList[] {
    if (cells.length === 0) return [];
    const rows = this.db.raw
      .prepare<Record<string, unknown>, JoinedRow>(PER_CELL_SQL)
      .all({ definitionId, cells: asCells(cells), cabin, pointOfSale });
    return foldLists(rows);
  }

  /**
   * Per requested date pair, the newest list of any airport pair inside `space` (the search's current origins and
   * destinations), for one cabin and point of sale, in request order, in one statement. A date pair with none has no
   * entry. This is the list shown under another airport pair's label, never the one that feeds a figure.
   */
  newestPerDatePair(
    definitionId: string,
    pairs: ReadonlyArray<{ departureDate: IsoDate; returnDate: IsoDate }>,
    space: { origins: readonly Iata[]; destinations: readonly Iata[] },
    cabin: Cabin,
    pointOfSale: PointOfSale,
  ): StoredFlightList[] {
    if (pairs.length === 0) return [];
    const rows = this.db.raw.prepare<Record<string, unknown>, JoinedRow>(PER_DATE_PAIR_SQL).all({
      definitionId,
      pairs: JSON.stringify(pairs.map((p) => ({ departureDate: p.departureDate, returnDate: p.returnDate }))),
      origins: JSON.stringify(space.origins),
      destinations: JSON.stringify(space.destinations),
      cabin,
      pointOfSale,
    });
    return foldLists(rows);
  }

  /**
   * What an execution's flight-list step stored (spec rev 55 §8.1 "What the run reports"): over the planned cells, the
   * newest row per cell among this execution's own lists, counted `read` or `failed`. A cell read twice counts once; a
   * cell with no row of this execution counts in neither (it is still to read or was never reached).
   */
  forExecution(executionId: string, planned: readonly CellKey[]): { read: number; failed: number } {
    if (planned.length === 0) return { read: 0, failed: 0 };
    const row = this.db.raw
      .prepare<Record<string, unknown>, { read: number; failed: number }>(FOR_EXECUTION_SQL)
      .get({ executionId, cells: asCells(planned) });
    return { read: row?.read ?? 0, failed: row?.failed ?? 0 };
  }
}
