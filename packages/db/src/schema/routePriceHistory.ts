import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { CABINS, PROVIDER_IDS } from '../internal/enums.js';
import { isInteger, isIsoTimestamp, isOneOf } from './checks.js';

const ISO_DATE_GLOB = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";

/**
 * Spec §7 `route_price_history` (rev 28, ruling 6 of decision 67): SearchApi's `price_insights.price_history` belongs to
 * the searched trip, not the route, so a point is keyed by origin, destination, the trip's departure and return dates,
 * the request cabin, provider and point date. Rows written before migration 0003 have no known trip: their trip dates
 * are NULL (both or neither, by CHECK) and their cabin stays 'unknown'; the views label them "trip unknown". A UNIQUE
 * index, not a primary key, carries the key, because those NULL trip dates must stay distinct legacy rows.
 */
export const routePriceHistory = sqliteTable(
  'route_price_history',
  {
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    departureDate: text('departure_date'),
    returnDate: text('return_date'),
    cabin: text('cabin').notNull(),
    providerId: text('provider_id').notNull(),
    date: text('date').notNull(),
    lowestPricePence: integer('lowest_price_pence').notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [
    uniqueIndex('route_price_history_trip_uq').on(
      t.origin,
      t.destination,
      t.departureDate,
      t.returnDate,
      t.cabin,
      t.providerId,
      t.date,
    ),
    check('route_price_history_price_ck', isInteger('lowest_price_pence')),
    check('route_price_history_cabin_ck', isOneOf('cabin', [...CABINS, 'unknown'])),
    check('route_price_history_provider_ck', isOneOf('provider_id', PROVIDER_IDS)),
    check('route_price_history_fetched_ck', isIsoTimestamp('fetched_at')),
    check(
      'route_price_history_trip_ck',
      sql.raw(
        // why: IS NOT NULL on both, since `x GLOB NULL` is NULL and a NULL CHECK passes: half a trip must be refused.
        `(departure_date IS NULL AND return_date IS NULL) OR (departure_date IS NOT NULL AND return_date IS NOT NULL AND departure_date GLOB ${ISO_DATE_GLOB} AND return_date GLOB ${ISO_DATE_GLOB})`,
      ),
    ),
  ],
);
