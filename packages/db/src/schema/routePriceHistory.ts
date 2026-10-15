import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { CABINS, PROVIDER_IDS } from '../internal/enums.js';
import { isInteger, isIsoTimestamp, isOneOf } from './checks.js';

/** Spec §7 `route_price_history`: Google's 60-day route lowest-price series; `cabin` may be 'unknown'. */
export const routePriceHistory = sqliteTable(
  'route_price_history',
  {
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    cabin: text('cabin').notNull(),
    providerId: text('provider_id').notNull(),
    date: text('date').notNull(),
    lowestPricePence: integer('lowest_price_pence').notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.origin, t.destination, t.cabin, t.providerId, t.date] }),
    check('route_price_history_price_ck', isInteger('lowest_price_pence')),
    check('route_price_history_cabin_ck', isOneOf('cabin', [...CABINS, 'unknown'])),
    check('route_price_history_provider_ck', isOneOf('provider_id', PROVIDER_IDS)),
    check('route_price_history_fetched_ck', isIsoTimestamp('fetched_at')),
  ],
);
