/**
 * Travelpayouts response parsing and row attribution. Spec §2 (raw shapes, currency from the response), §5.2
 * ("Empty is per capability", "Cell keys from the response", rows filtered to the pair, vendor links), §8.1 (rows
 * dropped for a covered cell are reported per cell). Untrusted JSON is read through zod schemas (plan decision 15);
 * failures are `parseError` from the shared module (plan decision 24).
 */
import { MINOR_EXPONENT } from '@gmt/core';
import { z } from 'zod';
import { type ParseWhere, parseError, parseVendor } from '../shared/errors.js';
import { PRICES_FOR_DATES_PATH } from './params.js';

/** Where every Travelpayouts parse error comes from (message prefix). */
export const WHERE: ParseWhere = { providerId: 'travelpayouts', endpointPath: PRICES_FOR_DATES_PATH };

/**
 * The envelope (Library notes: `{ "currency": "rub", "data": [...], "success": true }`). Rows stay unknown here;
 * each is read by rowSchema. `success:false` carries an optional `error` string (an assumption: the docs show no
 * error body; any other shape falls to malformed-envelope).
 */
const envelopeSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: z.array(z.unknown()), currency: z.string().optional() }),
  z.object({ success: z.literal(false), error: z.unknown().optional() }),
]);

/**
 * A response currency: the ISO 4217 code and core's minor-unit exponent, or null when core does not know the
 * currency (plan decision 29: its rows are dropped per cell as `currency-unsupported`, never a tile-level error).
 */
export interface ResponseCurrency {
  code: string;
  exponent: number | null;
}

/** A checked success envelope: rows still unparsed, the currency read from the response (spec §2). */
export interface Envelope {
  rows: readonly unknown[];
  currency: ResponseCurrency;
}

/** The envelope's currency upper-cased to ISO 4217 with core's exponent (null when unknown), or why it is unreadable. */
export function currencyOf(
  raw: string | undefined,
):
  | ({ ok: true } & ResponseCurrency)
  | { ok: false; cause: 'currency-missing' | 'currency-malformed'; detail: string | null } {
  if (raw === undefined) return { ok: false, cause: 'currency-missing', detail: null };
  const code = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code))
    return { ok: false, cause: 'currency-malformed', detail: `currency ${raw.slice(0, 10)}` };
  return { ok: true, code, exponent: MINOR_EXPONENT[code] ?? null };
}

/**
 * Spec §5.2 "Empty is per capability" (authorised-cached) and §2 "a response that states no currency is a parse
 * error": a success envelope with a usable currency is returned (zero rows → the engine records every covered cell
 * no_data); `success:false` → `vendor-error` with the vendor's text as detail; anything else → `malformed-envelope`;
 * a missing or unreadable currency → `currency-missing` / `currency-malformed`. All are non-retryable `parse` errors.
 * A readable code core has no exponent for is returned with `exponent: null` (plan decision 29).
 */
export function readEnvelope(body: unknown): Envelope {
  const env = parseVendor(envelopeSchema, body, 'malformed-envelope', WHERE);
  if (!env.success)
    throw parseError(
      'vendor-error',
      typeof env.error === 'string' && env.error.length > 0 ? env.error : null,
      WHERE,
    );
  const cur = currencyOf(env.currency);
  if (!cur.ok) throw parseError(cur.cause, cur.detail, WHERE);
  return { rows: env.data, currency: { code: cur.code, exponent: cur.exponent } };
}

/**
 * The http-kit cache `accept` hook (plan decision 15): a body is cached only when readEnvelope would accept it, so a
 * `success:false`, malformed or currency-less body is never replayed from the cache inside the TTL. A currency core
 * does not know is cacheable: the body is the vendor's valid answer, and its rows are dropped per cell either way.
 */
export function cacheableBody(body: unknown): boolean {
  const env = envelopeSchema.safeParse(body);
  return env.success && env.data.success && currencyOf(env.data.currency).ok;
}
