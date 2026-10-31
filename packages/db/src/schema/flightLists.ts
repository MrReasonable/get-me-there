import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { LISTED, STOP_DETAILS } from '../internal/enums.js';
import { isInteger, isIsoTimestamp, isNullOrInteger, isOneOf, isPointOfSale } from './checks.js';
import { searchDefinitions } from './searchDefinitions.js';
import { searchExecutions } from './searchExecutions.js';

// why: the same GLOBs the other tables write inline (airports' IATA, fx_rates' date): a code is three capitals, a date
// `YYYY-MM-DD`, a local time `HH:MM`
const IATA_GLOB = "'[A-Z][A-Z][A-Z]'";
const DATE_GLOB = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";
const HHMM_GLOB = "'[0-2][0-9]:[0-5][0-9]'";

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
