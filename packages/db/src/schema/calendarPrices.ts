import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { PROVIDER_IDS, RETURN_DATE_SOURCES, VENDOR_PRICE_MARKS } from '../internal/enums.js';
import { isOneOf, isProviderKind, priceTableChecks } from './checks.js';
import { searchExecutions } from './searchExecutions.js';

/** Spec §7 `calendar_prices`: insert-only, one row per (execution, provider, cell); history reads only rows not reused. */
export const calendarPrices = sqliteTable(
  'calendar_prices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    executionId: text('execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    providerId: text('provider_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    cabin: text('cabin').notNull(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    departureDate: text('departure_date').notNull(),
    returnDate: text('return_date').notNull(),
    pricePence: integer('price_pence').notNull(),
    priceNativeMinor: integer('price_native_minor').notNull(),
    currencyNative: text('currency_native').notNull(),
    fxRateNano: integer('fx_rate_nano'),
    fxRateDate: text('fx_rate_date'),
    fxSource: text('fx_source'),
    fxConverted: integer('fx_converted').notNull(),
    pointOfSale: text('point_of_sale').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    providerObservedAt: text('provider_observed_at'),
    maxAgeHours: integer('max_age_hours'),
    vendorLink: text('vendor_link'),
    reusedFromExecutionId: text('reused_from_execution_id').references(() => searchExecutions.id),
    /**
     * Spec §7 rev 34 (migration 0006): where the return date came from; no default, so every insert states it, and a
     * reused row keeps its source.
     */
    returnDateSource: text('return_date_source').notNull(),
    /** The vendor's own price mark (cheapest, low, none), NULL where the vendor states no marks. */
    vendorPriceMark: text('vendor_price_mark'),
  },
  (t) => [
    uniqueIndex('calendar_prices_execution_provider_cell_uq').on(
      t.executionId,
      t.providerId,
      t.origin,
      t.destination,
      t.departureDate,
      t.returnDate,
    ),
    index('calendar_prices_cell_fetched_idx').on(
      t.origin,
      t.destination,
      t.departureDate,
      t.returnDate,
      t.fetchedAt,
    ),
    index('calendar_prices_route_fetched_idx').on(t.origin, t.destination, t.fetchedAt),
    index('calendar_prices_execution_idx').on(t.executionId),
    ...priceTableChecks('calendar_prices'),
    check('calendar_prices_provider_ck', isOneOf('provider_id', PROVIDER_IDS)),
    check('calendar_prices_provider_kind_ck', isProviderKind()),
    check('calendar_prices_return_source_ck', isOneOf('return_date_source', RETURN_DATE_SOURCES)),
    // why: spec §7 rev 34: only the camoufox grid reads a return date from a grid cell
    check(
      'calendar_prices_grid_cell_ck',
      sql.raw("return_date_source <> 'grid-cell' OR provider_id = 'camoufox'"),
    ),
    check('calendar_prices_mark_ck', isOneOf('vendor_price_mark', VENDOR_PRICE_MARKS, true)),
  ],
);
