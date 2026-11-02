import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { BOOKING_STATUS, LISTED, RETURN_STATUS, STOP_DETAILS } from '../internal/enums.js';
import {
  isBool,
  isInteger,
  isIsoTimestamp,
  isNullOrInteger,
  isOneOf,
  isPointOfSale,
  sqlList,
} from './checks.js';
import { searchDefinitions } from './searchDefinitions.js';
import { searchExecutions } from './searchExecutions.js';

// why: the same GLOBs the other tables write inline (airports' IATA, fx_rates' date): a code is three capitals, a date
// `YYYY-MM-DD`, a local time `HH:MM`
const IATA_GLOB = "'[A-Z][A-Z][A-Z]'";
const DATE_GLOB = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";
const HHMM_GLOB = "'[0-2][0-9]:[0-5][0-9]'";

/**
 * Spec revision 56 §7: a worker rule token (core's `workerRuleSchema`) in SQL: at most 80 characters of `[a-z0-9:-]`,
 * starting with a letter, so a stored rule can never carry page text, a name or a URL.
 */
function isRuleToken(col: string) {
  return sql.raw(
    `${col} IS NULL OR (length(${col}) <= 80 AND ${col} GLOB '[a-z]*' AND ${col} NOT GLOB '*[^a-z0-9:-]*')`,
  );
}
/** The return statuses that may carry a rule (core's `RETURN_RULED`, plus `read`: its second attempt's early end). */
const RETURN_RULED_SQL = sqlList(['read', 'skipped', 'select-failed', 'not-settled', 'unrecognised']);

/**
 * Spec revision 55 §7 `flight_lists` (migration 0011): one browser-worker flight-list page per row, read (`status
 * 'read'`, with what the page listed) or failed (`status 'failed'`, with its `STOP_DETAILS` reason word, never free
 * text). Keyed and shown by airport pair, dates, cabin and point of sale; `execution_id` is NULL for an on-demand read
 * (§8.1). The CHECKs hold what the contract holds: the browser worker only (`camoufox`, `scraped-self`), economy only,
 * prices in GBP (the list's `currency_native` is the stored fact behind `fx { converted: false }`), a reason exactly on
 * a failed row and a `listed` word exactly on a read one.
 */
export const flightLists = sqliteTable(
  'flight_lists',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    definitionId: text('definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    executionId: text('execution_id').references(() => searchExecutions.id),
    providerId: text('provider_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    cabin: text('cabin').notNull(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    departureDate: text('departure_date').notNull(),
    returnDate: text('return_date').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    pointOfSale: text('point_of_sale').notNull(),
    currencyNative: text('currency_native').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    listed: text('listed'),
    minMinor: integer('min_minor'),
    tabMinor: integer('tab_minor'),
    cheapestView: text('cheapest_view'),
    optionsUnparsed: integer('options_unparsed').notNull(),
    optionsOtherCell: integer('options_other_cell').notNull(),
    resultsStated: integer('results_stated'),
    // Migration 0012 (spec revision 56 §7): the return read (NULL on a list read without a return phase and on every
    // list stored before 0012) and the booking read of its shown pairing; the attempts, returns and offers are rows of
    // their own tables below.
    returnStatus: text('return_status'),
    returnRule: text('return_rule'),
    /** The limits the selection used (core's `flightLimitsSchema`), so reuse and the figure's lead can compare them. */
    returnLimitsJson: text('return_limits_json'),
    returnTriedAll: integer('return_tried_all'),
    bookingStatus: text('booking_status'),
    bookingRule: text('booking_rule'),
    bookingAttempt: integer('booking_attempt'),
    bookingReturnPosition: integer('booking_return_position'),
    bookingExpanded: integer('booking_expanded'),
    bookingMoreControl: integer('booking_more_control'),
    bookingGrouped: integer('booking_grouped'),
    bookingUnparsed: integer('booking_unparsed'),
    bookingNonGbp: integer('booking_non_gbp'),
    bookingOffersStated: integer('booking_offers_stated'),
  },
  (t) => [
    check('flight_lists_provider_ck', sql.raw("provider_id = 'camoufox'")),
    check('flight_lists_kind_ck', sql.raw("source_kind = 'scraped-self'")),
    check('flight_lists_cabin_ck', sql.raw("cabin = 'economy'")),
    check('flight_lists_origin_ck', sql.raw(`origin GLOB ${IATA_GLOB}`)),
    check('flight_lists_destination_ck', sql.raw(`destination GLOB ${IATA_GLOB}`)),
    check('flight_lists_departure_ck', sql.raw(`departure_date GLOB ${DATE_GLOB}`)),
    check('flight_lists_return_ck', sql.raw(`return_date GLOB ${DATE_GLOB}`)),
    check('flight_lists_fetched_ck', isIsoTimestamp('fetched_at')),
    check('flight_lists_pos_ck', isPointOfSale('point_of_sale')),
    check('flight_lists_currency_ck', sql.raw("currency_native = 'GBP'")),
    check('flight_lists_status_ck', isOneOf('status', ['read', 'failed'])),
    check('flight_lists_reason_ck', isOneOf('reason', STOP_DETAILS, true)),
    check('flight_lists_listed_ck', isOneOf('listed', LISTED, true)),
    check(
      'flight_lists_min_ck',
      sql.raw("min_minor IS NULL OR (typeof(min_minor) = 'integer' AND min_minor > 0)"),
    ),
    check(
      'flight_lists_tab_ck',
      sql.raw("tab_minor IS NULL OR (typeof(tab_minor) = 'integer' AND tab_minor > 0)"),
    ),
    check('flight_lists_view_ck', isOneOf('cheapest_view', ['cheapest', 'best-fallback'], true)),
    check('flight_lists_unparsed_ck', isInteger('options_unparsed')),
    check('flight_lists_other_cell_ck', isInteger('options_other_cell')),
    check('flight_lists_stated_ck', isNullOrInteger('results_stated')),
    // why: a failed page has a reason and lists nothing; a read one lists something and has no reason
    check('flight_lists_failed_reason_ck', sql.raw("(status = 'failed') = (reason IS NOT NULL)")),
    check('flight_lists_read_listed_ck', sql.raw("(status = 'read') = (listed IS NOT NULL)")),
    check('flight_lists_return_status_ck', isOneOf('return_status', RETURN_STATUS, true)),
    check('flight_lists_return_rule_ck', isRuleToken('return_rule')),
    check(
      'flight_lists_return_limits_ck',
      sql.raw(
        "return_limits_json IS NULL OR (json_valid(return_limits_json) AND json_type(return_limits_json) = 'object')",
      ),
    ),
    check('flight_lists_return_tried_all_ck', isBool('return_tried_all', true)),
    // why: D1: each pair compared on its own, since SQLite reads a chained `=` left to right ((a = b) = c)
    check(
      'flight_lists_return_coupled_ck',
      sql.raw(
        '(return_status IS NULL) = (return_limits_json IS NULL) AND (return_status IS NULL) = (return_tried_all IS NULL)',
      ),
    ),
    // why: `IS NOT NULL` first, so a rule with no return status is refused (a NULL `IN` would pass the CHECK)
    check(
      'flight_lists_return_rule_status_ck',
      sql.raw(
        `return_rule IS NULL OR (return_status IS NOT NULL AND return_status IN (${RETURN_RULED_SQL}))`,
      ),
    ),
    check('flight_lists_return_read_ck', sql.raw("return_status IS NULL OR status = 'read'")),
    check('flight_lists_booking_status_ck', isOneOf('booking_status', BOOKING_STATUS, true)),
    check('flight_lists_booking_rule_ck', isRuleToken('booking_rule')),
    check('flight_lists_booking_attempt_ck', isNullOrInteger('booking_attempt')),
    check('flight_lists_booking_return_position_ck', isNullOrInteger('booking_return_position')),
    check('flight_lists_booking_expanded_ck', isBool('booking_expanded', true)),
    check('flight_lists_booking_more_control_ck', isBool('booking_more_control', true)),
    check('flight_lists_booking_grouped_ck', isNullOrInteger('booking_grouped')),
    check('flight_lists_booking_unparsed_ck', isNullOrInteger('booking_unparsed')),
    check('flight_lists_booking_non_gbp_ck', isNullOrInteger('booking_non_gbp')),
    check('flight_lists_booking_offers_stated_ck', isNullOrInteger('booking_offers_stated')),
    check(
      'flight_lists_booking_coupled_ck',
      sql.raw('(booking_status IS NULL) = (booking_expanded IS NULL)'),
    ),
    check('flight_lists_booking_return_ck', sql.raw('booking_status IS NULL OR return_status IS NOT NULL')),
    // why: the newest list per cell (spec §8.1 reuse, the on-demand read's `fresh`) is one ordered probe of this index
    index('flight_lists_cell_idx').on(
      t.definitionId,
      t.origin,
      t.destination,
      t.departureDate,
      t.returnDate,
      t.cabin,
      t.pointOfSale,
      sql`${t.fetchedAt} DESC`,
      sql`${t.id} DESC`,
    ),
    index('flight_lists_execution_idx').on(t.executionId),
  ],
);

/**
 * Spec revision 55 §7 `flight_list_flights` (migration 0011): the flights one list read, in page order (`position`),
 * at most `FLIGHT_LIST_MAX_FLIGHTS` a list. A list's flights go with it (`ON DELETE CASCADE`). `price_pence` is the
 * lowest round-trip total listed with this outbound, above 0 (ruling A28); there is no native amount, the list's GBP
 * `currency_native` being the stored fact.
 */
export const flightListFlights = sqliteTable(
  'flight_list_flights',
  {
    listId: integer('list_id')
      .notNull()
      .references(() => flightLists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    departsLocal: text('departs_local').notNull(),
    arrivesLocal: text('arrives_local').notNull(),
    arrivesDayOffset: integer('arrives_day_offset').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    stops: integer('stops').notNull(),
    carriersJson: text('carriers_json').notNull(),
    operatedBy: text('operated_by'),
    pricePence: integer('price_pence').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.position] }),
    check('flight_list_flights_position_ck', isInteger('position')),
    check('flight_list_flights_departs_ck', sql.raw(`departs_local GLOB ${HHMM_GLOB}`)),
    check('flight_list_flights_arrives_ck', sql.raw(`arrives_local GLOB ${HHMM_GLOB}`)),
    check(
      'flight_list_flights_offset_ck',
      sql.raw("typeof(arrives_day_offset) = 'integer' AND arrives_day_offset BETWEEN 0 AND 3"),
    ),
    check(
      'flight_list_flights_duration_ck',
      sql.raw("typeof(duration_minutes) = 'integer' AND duration_minutes > 0"),
    ),
    check('flight_list_flights_stops_ck', isInteger('stops')),
    check(
      'flight_list_flights_carriers_ck',
      sql.raw("json_valid(carriers_json) AND json_type(carriers_json) = 'array'"),
    ),
    check('flight_list_flights_price_ck', sql.raw("typeof(price_pence) = 'integer' AND price_pence > 0")),
  ],
);

/**
 * Spec revision 56 §7 `flight_list_attempts` (migration 0012): one attempt of a list's return phase (at most two: the
 * second outbound, Ian's ruling of 2026-11-01), the outbound it selected (its position in `flight_list_flights`), what
 * its return view listed and whether it showed more than this app read. They go with their list.
 */
export const flightListAttempts = sqliteTable(
  'flight_list_attempts',
  {
    listId: integer('list_id')
      .notNull()
      .references(() => flightLists.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    outboundPosition: integer('outbound_position').notNull(),
    outboundFits: integer('outbound_fits').notNull(),
    listed: text('listed').notNull(),
    moreListed: integer('more_listed').notNull(),
    optionsUnparsed: integer('options_unparsed').notNull(),
    optionsOtherCell: integer('options_other_cell').notNull(),
    resultsStated: integer('results_stated'),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.attempt] }),
    check('flight_list_attempts_attempt_ck', isBool('attempt')),
    check('flight_list_attempts_outbound_position_ck', isInteger('outbound_position')),
    check('flight_list_attempts_outbound_fits_ck', isBool('outbound_fits')),
    check('flight_list_attempts_listed_ck', isOneOf('listed', ['returns', 'none-for-cell'])),
    check('flight_list_attempts_more_listed_ck', isBool('more_listed')),
    check('flight_list_attempts_options_unparsed_ck', isInteger('options_unparsed')),
    check('flight_list_attempts_options_other_cell_ck', isInteger('options_other_cell')),
    check('flight_list_attempts_results_stated_ck', isNullOrInteger('results_stated')),
  ],
);

/**
 * Spec revision 56 §7 `flight_list_returns` (migration 0012): the return flights one attempt's return view listed, in
 * the order the worker kept them (at most 30 an attempt), with the outbound table's checks on the shared columns. The
 * day offset is from the return date (−1 to 3); `from_pence` is the return's "From" price, the cheapest seller's for
 * that pairing, above 0. They go with their attempt.
 */
export const flightListReturns = sqliteTable(
  'flight_list_returns',
  {
    listId: integer('list_id').notNull(),
    attempt: integer('attempt').notNull(),
    position: integer('position').notNull(),
    departsLocal: text('departs_local').notNull(),
    arrivesLocal: text('arrives_local').notNull(),
    arrivesDayOffset: integer('arrives_day_offset').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    stops: integer('stops').notNull(),
    carriersJson: text('carriers_json').notNull(),
    operatedBy: text('operated_by'),
    fromPence: integer('from_pence').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.attempt, t.position] }),
    foreignKey({
      columns: [t.listId, t.attempt],
      foreignColumns: [flightListAttempts.listId, flightListAttempts.attempt],
    }).onDelete('cascade'),
    check('flight_list_returns_position_ck', isInteger('position')),
    check('flight_list_returns_departs_ck', sql.raw(`departs_local GLOB ${HHMM_GLOB}`)),
    check('flight_list_returns_arrives_ck', sql.raw(`arrives_local GLOB ${HHMM_GLOB}`)),
    check(
      'flight_list_returns_offset_ck',
      sql.raw("typeof(arrives_day_offset) = 'integer' AND arrives_day_offset BETWEEN -1 AND 3"),
    ),
    check(
      'flight_list_returns_duration_ck',
      sql.raw("typeof(duration_minutes) = 'integer' AND duration_minutes > 0"),
    ),
    check('flight_list_returns_stops_ck', isInteger('stops')),
    check(
      'flight_list_returns_carriers_ck',
      sql.raw("json_valid(carriers_json) AND json_type(carriers_json) = 'array'"),
    ),
    check('flight_list_returns_from_ck', sql.raw("typeof(from_pence) = 'integer' AND from_pence > 0")),
  ],
);

/**
 * Spec revision 56 §7 `flight_list_offers` (migration 0012): the sellers' offers the booking read of a list's shown
 * pairing read (at most 40, cheapest first): the seller's and fare's names as page text held to 80 characters, and the
 * seller's stated price in pence, above 0. They go with their list.
 */
export const flightListOffers = sqliteTable(
  'flight_list_offers',
  {
    listId: integer('list_id')
      .notNull()
      .references(() => flightLists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    seller: text('seller').notNull(),
    fare: text('fare'),
    pricePence: integer('price_pence').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.position] }),
    check('flight_list_offers_position_ck', isInteger('position')),
    check('flight_list_offers_seller_ck', sql.raw('length(seller) BETWEEN 1 AND 80')),
    check('flight_list_offers_fare_ck', sql.raw('fare IS NULL OR length(fare) BETWEEN 1 AND 80')),
    check('flight_list_offers_price_ck', sql.raw("typeof(price_pence) = 'integer' AND price_pence > 0")),
  ],
);
