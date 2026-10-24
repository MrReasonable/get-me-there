import { type SQL, sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/sqlite-core';
import { CABINS, SOURCE_KINDS } from '../internal/enums.js';

// why: CHECK and partial-index bodies use unqualified column names via sql.raw, emitted verbatim (section 6, scratch run).
// Values are schema constants, never input.
export function isInteger(col: string): SQL {
  return sql.raw(`typeof(${col}) = 'integer' AND ${col} >= 0`);
}
export function isNullOrInteger(col: string): SQL {
  return sql.raw(`${col} IS NULL OR (typeof(${col}) = 'integer' AND ${col} >= 0)`);
}
const ISO_GLOB =
  "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'";
/** `toISOString()` form in SQL behind the repositories (spec §6.3). */
export function isIsoTimestamp(col: string, nullable = false): SQL {
  return sql.raw(nullable ? `${col} IS NULL OR ${col} GLOB ${ISO_GLOB}` : `${col} GLOB ${ISO_GLOB}`);
}
/** A quoted SQL list of schema constants, for a CHECK that combines a membership test with other conditions. */
export function sqlList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}
export function isOneOf(col: string, values: readonly string[], nullable = false): SQL {
  const list = sqlList(values);
  return sql.raw(nullable ? `${col} IS NULL OR ${col} IN (${list})` : `${col} IN (${list})`);
}
export function isBool(col: string, nullable = false): SQL {
  return sql.raw(nullable ? `${col} IS NULL OR ${col} IN (0, 1)` : `${col} IN (0, 1)`);
}
export function isPointOfSale(col: string, nullable = false): SQL {
  return sql.raw(`${nullable ? `${col} IS NULL OR ` : ''}${col} = 'unknown' OR ${col} GLOB '[A-Z][A-Z]'`);
}
/** Spec §5.5 in SQL: `provider_id = 'fixture'` ⇔ `source_kind = 'synthetic'` wherever a row holds both. */
export function isProviderKind(nullableKind = false): SQL {
  return sql.raw(
    `${nullableKind ? 'source_kind IS NULL OR ' : ''}(provider_id = 'fixture') = (source_kind = 'synthetic')`,
  );
}

export const ACTIVE_STATUS_SQL = "'pending', 'running', 'paused_budget', 'paused_error', 'interrupted'";

/** The CHECKs both price tables carry (spec §7). */
export function priceTableChecks(table: string) {
  return [
    check(`${table}_price_ck`, isInteger('price_pence')),
    check(`${table}_native_ck`, isInteger('price_native_minor')),
    check(`${table}_fx_converted_ck`, sql.raw("(fx_converted = 1) = (currency_native <> 'GBP')")),
    check(
      `${table}_fx_complete_ck`,
      sql.raw(
        'fx_converted = 0 OR (fx_rate_nano IS NOT NULL AND fx_rate_date IS NOT NULL AND fx_source IS NOT NULL)',
      ),
    ),
    check(`${table}_fx_rate_ck`, isNullOrInteger('fx_rate_nano')),
    check(`${table}_fx_bool_ck`, isBool('fx_converted')),
    check(`${table}_currency_ck`, sql.raw("currency_native GLOB '[A-Z][A-Z][A-Z]'")),
    check(`${table}_fetched_ck`, isIsoTimestamp('fetched_at')),
    check(`${table}_observed_ck`, isIsoTimestamp('provider_observed_at', true)),
    check(`${table}_max_age_ck`, isNullOrInteger('max_age_hours')),
    check(`${table}_cabin_ck`, isOneOf('cabin', CABINS)),
    check(`${table}_pos_ck`, isPointOfSale('point_of_sale')),
    check(`${table}_kind_ck`, isOneOf('source_kind', SOURCE_KINDS)),
  ];
}
