import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { CABINS, PROVIDER_IDS } from '../internal/enums.js';
import { isIsoTimestamp, isNullOrInteger, isOneOf } from './checks.js';
import { itineraries } from './itineraries.js';

/** Spec §7 `fare_offers`: (itinerary, provider, seller, cabin). Price aggregates are recomputed from observations. */
export const fareOffers = sqliteTable(
  'fare_offers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itineraryHash: text('itinerary_hash')
      .notNull()
      .references(() => itineraries.hash),
    providerId: text('provider_id').notNull(),
    seller: text('seller').notNull(),
    cabin: text('cabin').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    firstPricePence: integer('first_price_pence'),
    lowestPricePence: integer('lowest_price_pence'),
    highestPricePence: integer('highest_price_pence'),
    latestPricePence: integer('latest_price_pence'),
  },
  (t) => [
    uniqueIndex('fare_offers_identity_uq').on(t.itineraryHash, t.providerId, t.seller, t.cabin),
    index('fare_offers_itinerary_idx').on(t.itineraryHash),
    check('fare_offers_provider_ck', isOneOf('provider_id', PROVIDER_IDS)),
    check('fare_offers_cabin_ck', isOneOf('cabin', CABINS)),
    check('fare_offers_first_seen_ck', isIsoTimestamp('first_seen_at')),
    check('fare_offers_last_seen_ck', isIsoTimestamp('last_seen_at')),
    check('fare_offers_first_ck', isNullOrInteger('first_price_pence')),
    check('fare_offers_lowest_ck', isNullOrInteger('lowest_price_pence')),
    check('fare_offers_highest_ck', isNullOrInteger('highest_price_pence')),
    check('fare_offers_latest_ck', isNullOrInteger('latest_price_pence')),
  ],
);
