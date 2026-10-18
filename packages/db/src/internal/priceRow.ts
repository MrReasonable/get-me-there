import type { FxInfo, Provenance } from '@gmt/core';
import type { Db } from '../client.js';
import type { CalendarPriceInsert, CalendarPriceRow } from '../types.js';
import { CABINS, PROVIDER_IDS, RETURN_DATE_SOURCES, SOURCE_KINDS, VENDOR_PRICE_MARKS } from './enums.js';
import { oneOf, RowCorrupt, readDate, readIata, readNullableTime, readTime } from './read.js';
import {
  assertIsoDate,
  assertIsoDateTime,
  assertNullableInt,
  assertPointOfSale,
  assertPriceMoney,
  assertProviderKind,
  RowRejected,
} from './validate.js';

export interface CalendarPriceDbRow {
  id: number;
  execution_id: string;
  provider_id: string;
  source_kind: string;
  cabin: string;
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  price_pence: number;
  price_native_minor: number;
  currency_native: string;
  fx_rate_nano: number | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  fx_converted: number;
  point_of_sale: string;
  fetched_at: string;
  provider_observed_at: string | null;
  max_age_hours: number | null;
  vendor_link: string | null;
  reused_from_execution_id: string | null;
  return_date_source: string;
  vendor_price_mark: string | null;
}

/** Every repository rule for a calendar price (spec §5.5, §6.3, §7). `fresh` refuses a reused marker (reuse goes through copyReused). */
export function validateCalendarPrice(
  row: CalendarPriceInsert,
  allowSynthetic: boolean,
  fresh: boolean,
): void {
  assertProviderKind(row.providerId, row.sourceKind, allowSynthetic);
  assertPriceMoney(row);
  assertIsoDateTime('fetched_at', row.fetchedAt);
  if (row.providerObservedAt !== null) assertIsoDateTime('provider_observed_at', row.providerObservedAt);
  assertNullableInt('max_age_hours', row.maxAgeHours);
  assertPointOfSale(row.pointOfSale);
  assertIsoDate('departure_date', row.cell.departureDate);
  assertIsoDate('return_date', row.cell.returnDate);
  // why: spec §7 rev 34: only the camoufox grid reads a return date from a grid cell (the CHECK's twin)
  if (row.returnDateSource === 'grid-cell' && row.providerId !== 'camoufox')
    throw new RowRejected(
      'return_date_source',
      'only the camoufox grid reads a return date from a grid cell',
    );
  if (fresh && row.reusedFromExecutionId !== null)
    throw new RowRejected(
      'reused',
      'a fetched price cannot carry reused_from_execution_id; reuse goes through CellsRepo.copyReused',
    );
}

const INSERT_SQL = `
INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence, price_native_minor,
  currency_native, fx_rate_nano, fx_rate_date, fx_source, fx_converted, point_of_sale, fetched_at, provider_observed_at, max_age_hours, vendor_link, reused_from_execution_id,
  return_date_source, vendor_price_mark)
VALUES (@executionId, @providerId, @sourceKind, @cabin, @origin, @destination, @departureDate, @returnDate, @pricePence, @priceNativeMinor,
  @currencyNative, @fxRateNano, @fxRateDate, @fxSource, @fxConverted, @pointOfSale, @fetchedAt, @providerObservedAt, @maxAgeHours, @vendorLink, @reusedFrom,
  @returnDateSource, @vendorPriceMark)`;

/** Inserts one validated row; the caller owns the transaction. `max_age_hours` NULL = unknown, written explicitly (spec §7). */
export function insertCalendarPrice(db: Db, executionId: string, row: CalendarPriceInsert): number {
  const fx = row.fx;
  return Number(
    db.raw.prepare(INSERT_SQL).run({
      executionId,
      providerId: row.providerId,
      sourceKind: row.sourceKind,
      cabin: row.cabin,
      origin: row.cell.origin,
      destination: row.cell.destination,
      departureDate: row.cell.departureDate,
      returnDate: row.cell.returnDate,
      pricePence: row.pricePence,
      priceNativeMinor: row.priceNativeMinor,
      currencyNative: row.currencyNative,
      fxRateNano: fx.converted ? fx.rateNano : null,
      fxRateDate: fx.converted ? fx.rateDate : null,
      fxSource: fx.converted ? fx.source : null,
      fxConverted: fx.converted ? 1 : 0,
      pointOfSale: row.pointOfSale,
      fetchedAt: row.fetchedAt,
      providerObservedAt: row.providerObservedAt,
      maxAgeHours: row.maxAgeHours,
      vendorLink: row.vendorLink,
      reusedFrom: row.reusedFromExecutionId,
      returnDateSource: row.returnDateSource,
      vendorPriceMark: row.vendorPriceMark,
    }).lastInsertRowid,
  );
}

/** FX info from the four stored columns; converted without rate data is corruption the CHECK should have prevented. */
export function fxOf(
  column: string,
  r: {
    fx_converted: number;
    fx_rate_nano: number | null;
    fx_rate_date: string | null;
    fx_source: string | null;
  },
): FxInfo {
  if (r.fx_converted !== 1) return { converted: false };
  if (r.fx_rate_nano === null || r.fx_rate_date === null || r.fx_source === null)
    throw new RowCorrupt(column, 'converted without rate data');
  return {
    converted: true,
    rateNano: r.fx_rate_nano,
    rateDate: readDate(column, r.fx_rate_date),
    source: r.fx_source,
  };
}

/** Rebuilds the row and its `Provenance` from the stored columns; nothing is defaulted (spec §3). */
export function toCalendarPriceRow(r: CalendarPriceDbRow): CalendarPriceRow {
  const c = 'calendar_prices';
  const fx = fxOf(c, r);
  const providerId = oneOf(`${c}.provider_id`, PROVIDER_IDS, r.provider_id);
  const sourceKind = oneOf(`${c}.source_kind`, SOURCE_KINDS, r.source_kind);
  const cabin = oneOf(`${c}.cabin`, CABINS, r.cabin);
  const fetchedAt = readTime(`${c}.fetched_at`, r.fetched_at);
  const providerObservedAt = readNullableTime(`${c}.provider_observed_at`, r.provider_observed_at);
  const returnDateSource = oneOf(`${c}.return_date_source`, RETURN_DATE_SOURCES, r.return_date_source);
  const vendorPriceMark =
    r.vendor_price_mark === null
      ? null
      : oneOf(`${c}.vendor_price_mark`, VENDOR_PRICE_MARKS, r.vendor_price_mark);
  const provenance: Provenance = {
    providerId,
    sourceKind,
    fetchedAt,
    ...(providerObservedAt === null ? {} : { providerObservedAt }),
    maxAgeHours: r.max_age_hours ?? 'unknown',
    fx,
    pointOfSale: r.point_of_sale,
    cabin,
    returnDateSource,
    ...(vendorPriceMark === null ? {} : { vendorPriceMark }),
  };
  return {
    id: r.id,
    executionId: r.execution_id,
    provenance,
    providerId,
    sourceKind,
    cabin,
    cell: {
      origin: readIata(`${c}.origin`, r.origin),
      destination: readIata(`${c}.destination`, r.destination),
      departureDate: readDate(`${c}.departure_date`, r.departure_date),
      returnDate: readDate(`${c}.return_date`, r.return_date),
    },
    pricePence: r.price_pence,
    priceNativeMinor: r.price_native_minor,
    currencyNative: r.currency_native,
    fx,
    pointOfSale: r.point_of_sale,
    fetchedAt,
    providerObservedAt,
    maxAgeHours: r.max_age_hours,
    vendorLink: r.vendor_link,
    reusedFromExecutionId: r.reused_from_execution_id,
    returnDateSource,
    vendorPriceMark,
  };
}
