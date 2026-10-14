import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isBool, isIsoTimestamp, priceTableChecks } from './checks.js';
import { fareOffers } from './fareOffers.js';
import { searchExecutions } from './searchExecutions.js';

/**
 * Spec §7 `price_observations`: append-only; verdicts are recomputed at read time. Provider ⇔ kind is a repository
 * rule here (the provider lives on `fare_offers`, which a CHECK cannot read).
 */
export const priceObservations = sqliteTable(
  'price_observations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    offerId: integer('offer_id')
      .notNull()
      .references(() => fareOffers.id),
    executionId: text('execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    sourceKind: text('source_kind').notNull(),
    cabin: text('cabin').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    providerObservedAt: text('provider_observed_at'),
    pricePence: integer('price_pence').notNull(),
    priceNativeMinor: integer('price_native_minor').notNull(),
    currencyNative: text('currency_native').notNull(),
    fxRateNano: integer('fx_rate_nano'),
    fxRateDate: text('fx_rate_date'),
    fxSource: text('fx_source'),
    fxConverted: integer('fx_converted').notNull(),
    pointOfSale: text('point_of_sale').notNull(),
    maxAgeHours: integer('max_age_hours'),
    taxesIncluded: integer('taxes_included'),
    selfTransfer: integer('self_transfer'),
    segmentCabinsJson: text('segment_cabins_json'),
    baggageJson: text('baggage_json'),
    fareConditionsJson: text('fare_conditions_json'),
    bookingJson: text('booking_json'),
    bookingExpiresAt: text('booking_expires_at'),
    suppliedFieldsJson: text('supplied_fields_json').notNull(),
    partialExpansion: integer('partial_expansion').notNull(),
  },
  (t) => [
    index('price_observations_execution_price_idx').on(t.executionId, t.pricePence),
    index('price_observations_offer_fetched_idx').on(t.offerId, t.fetchedAt),
    ...priceTableChecks('price_observations'),
    check('price_observations_taxes_ck', isBool('taxes_included', true)),
    check('price_observations_self_transfer_ck', isBool('self_transfer', true)),
    check('price_observations_partial_ck', isBool('partial_expansion')),
    check('price_observations_expires_ck', isIsoTimestamp('booking_expires_at', true)),
  ],
);
