import {
  BOOKING_REREAD,
  type Cabin,
  type CellKey,
  FLIGHT_LIST_MAX_FLIGHTS,
  type Iata,
  type IsoDate,
  type ListedFlight,
  listedFlightSchema,
  type PointOfSale,
  pointOfSaleSchema,
  RETURN_TRANSIENT,
  type ReturnRead,
  returnReadSchema,
  returnsOutboundIssue,
  type StopDetail,
} from '@gmt/core';
import type { Db } from '../client.js';
import { CABINS, LISTED, STOP_DETAILS } from '../internal/enums.js';
import {
  nullableOneOf,
  oneOf,
  parseWith,
  RowCorrupt,
  readDate,
  readIata,
  readJson,
  readTime,
} from '../internal/read.js';
import { assertInt, assertIsoDate, assertIsoDateTime, RowRejected } from '../internal/validate.js';
import { sqlList } from '../schema/checks.js';
import type { FlightListInsert, NewestFlightList, StoredFlightList, TransientStreak } from '../types.js';

const INSERT_LIST_SQL = `
INSERT INTO flight_lists (definition_id, execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date,
  fetched_at, point_of_sale, currency_native, status, reason, listed, min_minor, tab_minor, cheapest_view, options_unparsed, options_other_cell, results_stated,
  return_status, return_rule, return_limits_json, return_tried_all, booking_status, booking_rule, booking_attempt, booking_return_position,
  booking_expanded, booking_more_control, booking_grouped, booking_unparsed, booking_non_gbp, booking_offers_stated)
VALUES (@definitionId, @executionId, @providerId, @sourceKind, @cabin, @origin, @destination, @departureDate, @returnDate,
  @fetchedAt, @pointOfSale, 'GBP', @status, @reason, @listed, @minMinor, @tabMinor, @cheapestView, @optionsUnparsed, @optionsOtherCell, @resultsStated,
  @returnStatus, @returnRule, @returnLimitsJson, @returnTriedAll, @bookingStatus, @bookingRule, @bookingAttempt, @bookingReturnPosition,
  @bookingExpanded, @bookingMoreControl, @bookingGrouped, @bookingUnparsed, @bookingNonGbp, @bookingOffersStated)`;
const INSERT_FLIGHT_SQL = `
INSERT INTO flight_list_flights (list_id, position, departs_local, arrives_local, arrives_day_offset, duration_minutes, stops, carriers_json, operated_by, price_pence)
VALUES (@listId, @position, @departsLocal, @arrivesLocal, @arrivesDayOffset, @durationMinutes, @stops, @carriersJson, @operatedBy, @pricePence)`;
const INSERT_ATTEMPT_SQL = `
INSERT INTO flight_list_attempts (list_id, attempt, outbound_position, outbound_fits, listed, more_listed, options_unparsed, options_other_cell, results_stated)
VALUES (@listId, @attempt, @outboundPosition, @outboundFits, @listed, @moreListed, @optionsUnparsed, @optionsOtherCell, @resultsStated)`;
const INSERT_RETURN_SQL = `
INSERT INTO flight_list_returns (list_id, attempt, position, departs_local, arrives_local, arrives_day_offset, duration_minutes, stops, carriers_json, operated_by, from_pence)
VALUES (@listId, @attempt, @position, @departsLocal, @arrivesLocal, @arrivesDayOffset, @durationMinutes, @stops, @carriersJson, @operatedBy, @fromPence)`;
const INSERT_OFFER_SQL = `
INSERT INTO flight_list_offers (list_id, position, seller, fare, price_pence) VALUES (@listId, @position, @seller, @fare, @pricePence)`;

/**
 * The newest list is the greatest `fetched_at`, ties to the later row (`id`): the order `flight_lists_cell_idx` stores,
 * so each probe below is one ordered index read. A failed list competes like a read one: the page shows the newest.
 */
const NEWEST = 'ORDER BY n.fetched_at DESC, n.id DESC LIMIT 1';

/**
 * Spec rev 56 §7, §8.1 (R-retry): whether list `t` ended with a return or booking status that is read again (core's
 * `RETURN_TRANSIENT` and `BOOKING_REREAD`: the transient ends, and a `skipped` booking read whatever its rule, ruling
 * 21.6 I1; a list with neither, an outbound-only read or a `failed` one, did not). `IN` on a NULL status is NULL, hence
 * the COALESCEs.
 */
const transientOf = (t: string) =>
  `(COALESCE(${t}.return_status IN (${sqlList([...RETURN_TRANSIENT])}), 0) OR COALESCE(${t}.booking_status IN (${sqlList([...BOOKING_REREAD])}), 0))`;
/**
 * The chosen list `l`'s `transientStreak`: 0 when it did not end transient, else 1 plus whether the list before it in
 * its own cell (the second newest, by the order `NEWEST` reads) did too. One more probe of the cell index per list.
 */
const STREAK = `CASE WHEN ${transientOf('l')} THEN 1 + COALESCE((
    SELECT ${transientOf('p')} FROM flight_lists p
    WHERE p.definition_id = l.definition_id AND p.origin = l.origin AND p.destination = l.destination
      AND p.departure_date = l.departure_date AND p.return_date = l.return_date AND p.cabin = l.cabin AND p.point_of_sale = l.point_of_sale
    ORDER BY p.fetched_at DESC, p.id DESC LIMIT 1 OFFSET 1), 0) ELSE 0 END AS transient_streak`;
/** The flight columns every lists statement joins. */
const FLIGHT_COLUMNS =
  'f.position, f.departs_local, f.arrives_local, f.arrives_day_offset, f.duration_minutes, f.stops, f.carriers_json, f.operated_by, f.price_pence';

// why: one lists statement per read, the list rows joined to their flights, so a page of ten date pairs is one round
// trip and the newest list per ask is chosen by the database (the WP19 grouped-read pattern); `ord` carries the request
// order. The attempts with their returns, and the offers, are one statement each over the lists it chose (spec rev 56 §7).
const PER_CELL_SQL = `
WITH asked AS (
  SELECT CAST(j.key AS INTEGER) AS ord, json_extract(j.value, '$.origin') AS origin, json_extract(j.value, '$.destination') AS destination,
    json_extract(j.value, '$.departureDate') AS departureDate, json_extract(j.value, '$.returnDate') AS returnDate
  FROM json_each(@cells) j)
SELECT a.ord AS ord, l.*, ${STREAK}, ${FLIGHT_COLUMNS}
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
SELECT a.ord AS ord, l.*, ${STREAK}, ${FLIGHT_COLUMNS}
FROM asked a
JOIN flight_lists l ON l.id = (
  SELECT n.id FROM flight_lists n
  WHERE n.definition_id = @definitionId AND n.departure_date = a.departureDate AND n.return_date = a.returnDate
    AND n.origin IN (SELECT value FROM json_each(@origins)) AND n.destination IN (SELECT value FROM json_each(@destinations))
    AND n.cabin = @cabin AND n.point_of_sale = @pointOfSale
  ${NEWEST})
LEFT JOIN flight_list_flights f ON f.list_id = l.id
ORDER BY a.ord, f.position`;

// why: spec rev 56 §6.9, §7 (21.6 review M6, prov-002): the newest list of each asked cell, whatever its status, scoped
// to the asked executions when given (the newest among those executions' lists, so a newer list outside the scope never
// hides the scope's own); only the asked cells are probed, never every list the search has had. One ordered index read
// per cell, as PER_CELL_SQL. No streak: that is the step's reuse rule (`newestPerCell`), not this read's (21.5 review M1).
const OF_CELLS_SQL = `
WITH asked AS (
  SELECT CAST(j.key AS INTEGER) AS ord, json_extract(j.value, '$.origin') AS origin, json_extract(j.value, '$.destination') AS destination,
    json_extract(j.value, '$.departureDate') AS departureDate, json_extract(j.value, '$.returnDate') AS returnDate
  FROM json_each(@cells) j)
SELECT a.ord AS ord, l.*, ${FLIGHT_COLUMNS}
FROM asked a
JOIN flight_lists l ON l.id = (
  SELECT n.id FROM flight_lists n
  WHERE n.definition_id = @definitionId AND n.origin = a.origin AND n.destination = a.destination
    AND n.departure_date = a.departureDate AND n.return_date = a.returnDate AND n.cabin = @cabin AND n.point_of_sale = @pointOfSale
    AND (@executionIds IS NULL OR n.execution_id IN (SELECT value FROM json_each(@executionIds)))
  ${NEWEST})
LEFT JOIN flight_list_flights f ON f.list_id = l.id
ORDER BY a.ord, f.position`;

// why: spec rev 56 §7: one probe of each primary key for the lists a lookup chose (no new index), ordered so each list's
// attempts, and each attempt's returns, arrive in order; an attempt with no return (listed none-for-cell) has one row
const ATTEMPTS_SQL = `
SELECT a.list_id, a.attempt, a.outbound_position, a.outbound_fits, a.listed, a.more_listed, a.options_unparsed, a.options_other_cell,
  a.results_stated, r.position, r.departs_local, r.arrives_local, r.arrives_day_offset, r.duration_minutes, r.stops, r.carriers_json,
  r.operated_by, r.from_pence
FROM flight_list_attempts a
LEFT JOIN flight_list_returns r ON r.list_id = a.list_id AND r.attempt = a.attempt
WHERE a.list_id IN (SELECT value FROM json_each(?))
ORDER BY a.list_id, a.attempt, r.position`;
const OFFERS_SQL = `
SELECT list_id, position, seller, fare, price_pence FROM flight_list_offers
WHERE list_id IN (SELECT value FROM json_each(?)) ORDER BY list_id, position`;

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

const LAST_FAILURE_SQL = `
SELECT reason FROM flight_lists WHERE execution_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1`;

const CELLS_OF_EXECUTION_SQL = `
SELECT DISTINCT origin, destination, departure_date AS departureDate, return_date AS returnDate
FROM flight_lists WHERE execution_id = ? ORDER BY departure_date, return_date, origin, destination`;

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
  return_status: string | null;
  return_rule: string | null;
  return_limits_json: string | null;
  return_tried_all: number | null;
  booking_status: string | null;
  booking_rule: string | null;
  booking_attempt: number | null;
  booking_return_position: number | null;
  booking_expanded: number | null;
  booking_more_control: number | null;
  booking_grouped: number | null;
  booking_unparsed: number | null;
  booking_non_gbp: number | null;
  booking_offers_stated: number | null;
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

/** A joined row of the per-cell and per-date-pair statements, which add the chosen list's streak. */
interface StreakRow extends JoinedRow {
  transient_streak: number;
}

/** An attempt row joined to one of its returns (`position` NULL when the attempt listed none). */
interface AttemptRow {
  list_id: number;
  attempt: number;
  outbound_position: number;
  outbound_fits: number;
  listed: string;
  more_listed: number;
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
  from_pence: number | null;
}
interface OfferRow {
  list_id: number;
  position: number;
  seller: string;
  fare: string | null;
  price_pence: number;
}
/** One list's attempt as stored (its number, the row's key), with its returns, before the schema judges it. */
interface RawAttempt {
  attempt: number;
  read: Record<string, unknown> & { returns: unknown[] };
}

/** A stored 0/1 as the boolean it stands for; NULL stays NULL, for the schema to refuse by name. */
const boolOf = (v: number | null): boolean | null => (v === null ? null : v === 1);

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

/** Groups the attempts statement's rows by list, each attempt with its returns in order (spec rev 56 §7). */
function attemptsByList(rows: readonly AttemptRow[]): Map<number, RawAttempt[]> {
  const out = new Map<number, RawAttempt[]>();
  for (const r of rows) {
    const attempts = out.get(r.list_id) ?? [];
    out.set(r.list_id, attempts);
    let a = attempts.at(-1);
    if (a === undefined || a.attempt !== r.attempt) {
      a = {
        attempt: r.attempt,
        read: {
          outboundIndex: r.outbound_position,
          outboundFits: boolOf(r.outbound_fits),
          listed: r.listed,
          moreListed: boolOf(r.more_listed),
          returns: [],
          optionsUnparsed: r.options_unparsed,
          optionsOtherCell: r.options_other_cell,
          resultsStated: r.results_stated,
        },
      };
      attempts.push(a);
    }
    if (r.position !== null)
      a.read.returns.push({
        departsLocal: r.departs_local,
        arrivesLocal: r.arrives_local,
        arrivesDayOffset: r.arrives_day_offset,
        durationMinutes: r.duration_minutes,
        stops: r.stops,
        carriers: readJson(
          `flight_list_returns[${r.list_id}:${r.attempt}:${r.position}].carriers_json`,
          r.carriers_json ?? 'null',
        ),
        operatedBy: r.operated_by,
        fromMinor: r.from_pence,
      });
  }
  return out;
}

/** Groups the offers statement's rows by list, in position order (cheapest first, as written). */
function offersByList(rows: readonly OfferRow[]): Map<number, unknown[]> {
  const out = new Map<number, unknown[]>();
  for (const r of rows) {
    const offers = out.get(r.list_id) ?? [];
    out.set(r.list_id, offers);
    offers.push({ seller: r.seller, fare: r.fare, priceMinor: r.price_pence });
  }
  return out;
}

/**
 * Spec rev 56 §7: a list's return read assembled from its columns, attempts, returns and offers, judged by core's
 * `returnReadSchema` (every refinement) so a corrupt row names its column; null for a list read without one. An attempt
 * whose outbound is past the list's flights is corrupt too (the contract refuses it on the way in).
 */
function readReturns(
  first: JoinedRow,
  flights: readonly ListedFlight[],
  attempts: readonly RawAttempt[],
  offers: readonly unknown[],
): ReturnRead | null {
  if (first.return_status === null) return null;
  const booking =
    first.booking_status === null
      ? null
      : {
          status: first.booking_status,
          rule: first.booking_rule,
          attempt: first.booking_attempt,
          returnIndex: first.booking_return_position,
          expanded: boolOf(first.booking_expanded),
          moreControl: boolOf(first.booking_more_control),
          grouped: first.booking_grouped,
          offers,
          unparsed: first.booking_unparsed,
          nonGbp: first.booking_non_gbp,
          offersStated: first.booking_offers_stated,
        };
  const returns = parseWith('flight_lists.return_*', returnReadSchema, {
    limits: readJson('flight_lists.return_limits_json', first.return_limits_json ?? 'null'),
    status: first.return_status,
    rule: first.return_rule,
    // why: the attempt number is the row's key, not a field of the read: the schema's order is the stored order
    attempts: attempts.map((a) => a.read),
    triedAll: boolOf(first.return_tried_all),
    booking,
  });
  const past = returnsOutboundIssue(returns, flights.length);
  if (past !== null)
    throw new RowCorrupt(
      'flight_list_attempts.outbound_position',
      `list ${first.id} attempt ${past} names an outbound past its ${flights.length} flights`,
    );
  return returns;
}

/** The streak the lists statement computed, narrowed to what it can be (a CASE of 0, 1 or 2). */
function streakOf(v: number): TransientStreak {
  if (v === 0 || v === 1 || v === 2) return v;
  throw new RowCorrupt('flight_lists.transient_streak', `unexpected value ${v}`);
}

function readList(
  first: JoinedRow,
  flights: ListedFlight[],
  attempts: readonly RawAttempt[],
  offers: readonly unknown[],
): StoredFlightList {
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
    returns: readReturns(first, flights, attempts, offers),
  };
}

/** A list with the streak its statement computed (the per-cell and per-date-pair reads). */
const withStreak = ({ first, list }: { first: StreakRow; list: StoredFlightList }): NewestFlightList => ({
  ...list,
  transientStreak: streakOf(first.transient_streak),
});

/** Folds the joined rows (ordered by ask, then flight position) into one list per ask, in ask order. */
function foldLists<R extends JoinedRow>(rows: readonly R[]): Array<{ first: R; flights: ListedFlight[] }> {
  const out: Array<{ first: R; flights: ListedFlight[] }> = [];
  let current: { ord: number; first: R; flights: ListedFlight[] } | null = null;
  for (const r of rows) {
    if (current === null || current.ord !== r.ord) {
      current = { ord: r.ord, first: r, flights: [] };
      out.push(current);
    }
    const f = readFlight(r);
    if (f !== null) current.flights.push(f);
  }
  return out;
}

/** A boolean as the 0/1 the tables store. */
const bit = (v: boolean): 0 | 1 => (v ? 1 : 0);

/**
 * Spec rev 56 §7: the return read to write with a list, judged before any SQL: none for a list read without a return
 * phase; refused on a `failed` list, when core's `returnReadSchema` refuses it (every refinement: a 0-pence offer or
 * "from" price included) and when an attempt names an outbound past the list's flights.
 */
function returnsToWrite(l: FlightListInsert): ReturnRead | null {
  if (l.returns === undefined || l.returns === null) return null;
  if (l.status === 'failed') throw new RowRejected('return-read', 'a failed list carries no return read');
  const parsed = returnReadSchema.safeParse(l.returns);
  if (!parsed.success) throw new RowRejected('return-read', parsed.error.message);
  const past = returnsOutboundIssue(parsed.data, l.flights.length);
  if (past !== null)
    throw new RowRejected(
      'return-read',
      `attempt ${past}'s outbound ${String(parsed.data.attempts[past]?.outboundIndex)} is not one of the list's ${l.flights.length} flights`,
    );
  return parsed.data;
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
   * Stores one list and its flights, in page order, and its return read (spec rev 56 §7: the columns, the attempts,
   * their returns and the booking's offers) in one transaction: a row a table refuses rolls the list back.
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
    const returns = returnsToWrite(l);
    const booking = returns?.booking ?? null;
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
          returnStatus: returns?.status ?? null,
          returnRule: returns?.rule ?? null,
          returnLimitsJson: returns === null ? null : JSON.stringify(returns.limits),
          returnTriedAll: returns === null ? null : bit(returns.triedAll),
          bookingStatus: booking?.status ?? null,
          bookingRule: booking?.rule ?? null,
          bookingAttempt: booking?.attempt ?? null,
          bookingReturnPosition: booking?.returnIndex ?? null,
          bookingExpanded: booking === null ? null : bit(booking.expanded),
          bookingMoreControl: booking === null ? null : bit(booking.moreControl),
          bookingGrouped: booking?.grouped ?? null,
          bookingUnparsed: booking?.unparsed ?? null,
          bookingNonGbp: booking?.nonGbp ?? null,
          bookingOffersStated: booking?.offersStated ?? null,
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
      if (returns !== null) this.writeReturns(listId, returns);
      return listId;
    });
  }

  /**
   * Spec rev 56 §7: a return read's attempts (numbered in the order made), each attempt's returns and the booking's
   * offers, in order (`position`), inside the caller's transaction: a row a table refuses rolls the whole list back.
   */
  private writeReturns(listId: number, r: ReturnRead): void {
    const insertAttempt = this.db.raw.prepare(INSERT_ATTEMPT_SQL);
    const insertReturn = this.db.raw.prepare(INSERT_RETURN_SQL);
    r.attempts.forEach((a, attempt) => {
      insertAttempt.run({
        listId,
        attempt,
        outboundPosition: a.outboundIndex,
        outboundFits: bit(a.outboundFits),
        listed: a.listed,
        moreListed: bit(a.moreListed),
        optionsUnparsed: a.optionsUnparsed,
        optionsOtherCell: a.optionsOtherCell,
        resultsStated: a.resultsStated,
      });
      a.returns.forEach((b, position) => {
        insertReturn.run({
          listId,
          attempt,
          position,
          departsLocal: b.departsLocal,
          arrivesLocal: b.arrivesLocal,
          arrivesDayOffset: b.arrivesDayOffset,
          durationMinutes: b.durationMinutes,
          stops: b.stops,
          carriersJson: JSON.stringify(b.carriers),
          operatedBy: b.operatedBy,
          fromPence: b.fromMinor,
        });
      });
    });
    const offers = r.booking?.offers ?? [];
    if (offers.length === 0) return;
    const insertOffer = this.db.raw.prepare(INSERT_OFFER_SQL);
    offers.forEach((o, position) => {
      insertOffer.run({ listId, position, seller: o.seller, fare: o.fare, pricePence: o.priceMinor });
    });
  }

  /**
   * The newest list of this definition for each requested cell (airport pair and dates), for one cabin and point of
   * sale, in request order, with its return read and its `transientStreak` (spec rev 56 §7): three statements in one
   * read transaction. A cell never read has no entry (match the rest by their own fields).
   */
  newestPerCell(
    definitionId: string,
    cells: readonly CellKey[],
    cabin: Cabin,
    pointOfSale: PointOfSale,
  ): NewestFlightList[] {
    if (cells.length === 0) return [];
    return this.lookup<StreakRow>(PER_CELL_SQL, {
      definitionId,
      cells: asCells(cells),
      cabin,
      pointOfSale,
    }).map(withStreak);
  }

  /**
   * Per requested date pair, the newest list of any airport pair inside `space` (the search's current origins and
   * destinations), for one cabin and point of sale, in request order, with its return read and its `transientStreak`,
   * in three statements. A date pair with none has no entry. This is the list shown under another airport pair's
   * label, never the one that feeds a figure.
   */
  newestPerDatePair(
    definitionId: string,
    pairs: ReadonlyArray<{ departureDate: IsoDate; returnDate: IsoDate }>,
    space: { origins: readonly Iata[]; destinations: readonly Iata[] },
    cabin: Cabin,
    pointOfSale: PointOfSale,
  ): NewestFlightList[] {
    if (pairs.length === 0) return [];
    return this.lookup<StreakRow>(PER_DATE_PAIR_SQL, {
      definitionId,
      pairs: JSON.stringify(pairs.map((p) => ({ departureDate: p.departureDate, returnDate: p.returnDate }))),
      origins: JSON.stringify(space.origins),
      destinations: JSON.stringify(space.destinations),
      cabin,
      pointOfSale,
    }).map(withStreak);
  }

  /**
   * Spec rev 56 §6.9, §7 (21.6 review M6, prov-002): the newest list of each requested cell, of any status, for one cabin
   * and point of sale, in request order, with its returns and offers; the api tells a failed list, an outbound-only one
   * and a finished return phase apart. Under an `executionIds` scope the list is the newest among those executions'
   * lists for the cell (an on-demand list, of no execution, is in no scope), so a newer list outside the scope never hides
   * it. A stored list, without a `transientStreak` (the step's reuse rule, read by `newestPerCell`). Three statements in
   * one transaction (none with no cell asked); a cell with no list in scope has no entry.
   */
  newestOfCells(
    definitionId: string,
    cells: readonly CellKey[],
    cabin: Cabin,
    pointOfSale: PointOfSale,
    scope: { executionIds: readonly string[] } | null,
  ): StoredFlightList[] {
    if (cells.length === 0) return [];
    return this.lookup<JoinedRow>(OF_CELLS_SQL, {
      definitionId,
      cells: asCells(cells),
      cabin,
      pointOfSale,
      executionIds: scope === null ? null : JSON.stringify(scope.executionIds),
    }).map((l) => l.list);
  }

  /**
   * One lookup (spec rev 56 §7): the lists statement, then the attempts with their returns and the offers of the lists
   * it chose, one statement each, inside one read transaction so the three see the same lists.
   */
  private lookup<R extends JoinedRow>(
    listsSql: string,
    params: Record<string, unknown>,
  ): Array<{ first: R; list: StoredFlightList }> {
    return this.db.transaction(() => {
      const lists = foldLists(this.db.raw.prepare<Record<string, unknown>, R>(listsSql).all(params));
      if (lists.length === 0) return [];
      const ids = JSON.stringify(lists.map((l) => l.first.id));
      const attempts = attemptsByList(this.db.raw.prepare<[string], AttemptRow>(ATTEMPTS_SQL).all(ids));
      const offers = offersByList(this.db.raw.prepare<[string], OfferRow>(OFFERS_SQL).all(ids));
      return lists.map((l) => ({
        first: l.first,
        list: readList(l.first, l.flights, attempts.get(l.first.id) ?? [], offers.get(l.first.id) ?? []),
      }));
    });
  }

  /**
   * The cells an execution's flight-list step has a row for, read or failed (spec rev 55 §8.1: a resumed pass reads
   * only planned cells with no row of this execution, so it never writes a pair twice).
   */
  cellsOfExecution(executionId: string): CellKey[] {
    return this.db.raw
      .prepare<[string], { origin: string; destination: string; departureDate: string; returnDate: string }>(
        CELLS_OF_EXECUTION_SQL,
      )
      .all(executionId)
      .map((r) => ({
        origin: readIata('flight_lists.origin', r.origin),
        destination: readIata('flight_lists.destination', r.destination),
        departureDate: readDate('flight_lists.departure_date', r.departureDate),
        returnDate: readDate('flight_lists.return_date', r.returnDate),
      }));
  }

  /**
   * Design 2026-11-08 §5.5: the reason of this execution's newest failed list (the stop detail the step ended with when
   * an ending page or a cap stopped it: the ending page writes its own failed row), or null when it has none.
   */
  lastFailureReason(executionId: string): StopDetail | null {
    const row = this.db.raw.prepare<[string], { reason: string | null }>(LAST_FAILURE_SQL).get(executionId);
    return nullableOneOf('flight_lists.reason', STOP_DETAILS, row?.reason ?? null);
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
