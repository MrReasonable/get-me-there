import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Spec §7 `fx_rates`: GBP per 1 native unit × 1e9 (spec §6.3), with the source stamped on converted prices. */
export const fxRates = sqliteTable(
  'fx_rates',
  {
    date: text('date').notNull(),
    currency: text('currency').notNull(),
    rateNano: integer('rate_nano').notNull(),
    source: text('source').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.currency] }),
    check('fx_rates_rate_ck', sql.raw("typeof(rate_nano) = 'integer' AND rate_nano > 0")),
    check('fx_rates_currency_ck', sql.raw("currency GLOB '[A-Z][A-Z][A-Z]' AND currency <> 'GBP'")),
    check('fx_rates_date_ck', sql.raw("date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'")),
    check('fx_rates_source_ck', sql.raw('length(source) > 0')),
  ],
);
