import {
  type FxInfo,
  isoDateSchema,
  isoDateTimeSchema,
  type ProviderId,
  type SourceKind,
  stripUrlsInText,
} from '@gmt/core';
import { ERROR_REASONS } from './enums.js';

/** A row a repository refuses to write (spec §5.5, §6.3, §7). Always an error, never a silent fix. */
export class RowRejected extends Error {
  readonly rule: string;
  constructor(rule: string, message: string) {
    // why: messages can quote values; spec §5.3 forbids any sink holding a URL query.
    super(stripUrlsInText(`${rule}: ${message}`));
    this.name = 'RowRejected';
    this.rule = rule;
  }
}

/** Integers only for money, counts and rates (spec §6.3). */
export function assertInt(field: string, v: number, min = 0): void {
  if (!Number.isSafeInteger(v) || v < min)
    throw new RowRejected('integer', `${field} must be an integer ≥ ${min}, got ${String(v)}`);
}
export function assertNullableInt(field: string, v: number | null, min = 0): void {
  if (v !== null) assertInt(field, v, min);
}
/** `Date.prototype.toISOString()` form only (spec §6.3). */
export function assertIsoDateTime(field: string, v: string): void {
  if (!isoDateTimeSchema.safeParse(v).success)
    throw new RowRejected('timestamp', `${field} must be in toISOString() form, got ${v}`);
}
export function assertNullableIsoDateTime(field: string, v: string | null): void {
  if (v !== null) assertIsoDateTime(field, v);
}
export function assertIsoDate(field: string, v: string): void {
  if (!isoDateSchema.safeParse(v).success)
    throw new RowRejected('date', `${field} must be YYYY-MM-DD, got ${v}`);
}

/** Spec §5.5 synthetic gate on a provider alone (rows that carry a provider but no source kind yet). */
export function assertProviderAllowed(providerId: ProviderId, allowSynthetic: boolean): void {
  if (providerId === 'fixture' && !allowSynthetic)
    throw new RowRejected('synthetic-gate', 'fixture rows are refused outside syntheticAllowed');
}

/** Spec §5.5: `provider_id = 'fixture'` ⇔ `source_kind = 'synthetic'`, and the synthetic gate. */
export function assertProviderKind(
  providerId: ProviderId,
  sourceKind: SourceKind,
  allowSynthetic: boolean,
): void {
  if ((providerId === 'fixture') !== (sourceKind === 'synthetic')) {
    throw new RowRejected(
      'provider-kind',
      `provider ${providerId} with source kind ${sourceKind}: fixture ⇔ synthetic must hold`,
    );
  }
  assertProviderAllowed(providerId, allowSynthetic);
}

/** Spec §7 price-table money rules: integers; ISO 4217; converted ⇔ currency ≠ GBP; converted rows carry rate, date, source; unconverted pence = native minor. */
export function assertPriceMoney(p: {
  pricePence: number;
  priceNativeMinor: number;
  currencyNative: string;
  fx: FxInfo;
}): void {
  assertInt('price_pence', p.pricePence);
  assertInt('price_native_minor', p.priceNativeMinor);
  if (!/^[A-Z]{3}$/.test(p.currencyNative))
    throw new RowRejected('currency', `currency_native must be ISO 4217, got ${p.currencyNative}`);
  if (!p.fx.converted) {
    if (p.currencyNative !== 'GBP') throw new RowRejected('fx', `unconverted price in ${p.currencyNative}`);
    if (p.pricePence !== p.priceNativeMinor)
      throw new RowRejected(
        'fx',
        `price_pence ${p.pricePence} must equal price_native_minor ${p.priceNativeMinor} when unconverted`,
      );
    return;
  }
  if (p.currencyNative === 'GBP') throw new RowRejected('fx', 'a GBP price cannot be FX-converted');
  assertInt('fx_rate_nano', p.fx.rateNano, 1);
  assertIsoDate('fx_rate_date', p.fx.rateDate);
  if (p.fx.source.length === 0) throw new RowRejected('fx', 'fx_source must be named');
}

/** ISO alpha-2 or 'unknown' (spec §3). */
export function assertPointOfSale(v: string): void {
  if (v !== 'unknown' && !/^[A-Z]{2}$/.test(v))
    throw new RowRejected('point-of-sale', `point_of_sale must be ISO 3166-1 alpha-2 or 'unknown', got ${v}`);
}

/** Spec §3: error reasons come from the closed list; the vendor message belongs in last_error (prov-009). */
export function assertErrorReason(reason: string | null): void {
  if (reason === null || !ERROR_REASONS.some((r) => r === reason))
    throw new RowRejected(
      'error-reason',
      `error reason must be a ProviderError kind or normalisation reason, got ${String(reason)}`,
    );
}

/**
 * Spec §5.3 "endpoint_path is the path only": a leading single '/', then only unreserved path characters,
 * at most 200 long (sec-002). No query, fragment, userinfo, scheme or whitespace can pass.
 */
export function assertEndpointPath(path: string): void {
  if (!/^\/(?!\/)[A-Za-z0-9._~/-]{0,199}$/.test(path))
    throw new RowRejected(
      'endpoint-path',
      'endpoint_path is a path only: /segment/segment, unreserved characters, ≤ 200',
    );
}
