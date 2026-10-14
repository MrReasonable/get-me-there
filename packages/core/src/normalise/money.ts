import { NormalisationError } from '../errors.js';

/**
 * The currencies frankfurter (ECB reference rates) publishes, read from
 * https://api.frankfurter.dev/v1/currencies on 2026-10-14. Spec §5.6: "ECB-covered currencies
 * only". A currency outside this list is `currency-unsupported`, never converted by a guess.
 */
export const ECB_CURRENCIES: readonly string[] = [
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
];

/**
 * ISO 4217 minor-unit exponent for every ECB currency (spec §6.3: "Native amounts are integer
 * minor units with the ISO 4217 exponent"). ISK, JPY and KRW have no minor unit.
 */
export const MINOR_EXPONENT: Record<string, number> = Object.fromEntries(
  ECB_CURRENCIES.map((c) => [c, c === 'ISK' || c === 'JPY' || c === 'KRW' ? 0 : 2]),
);

const NANO = 1_000_000_000n;

/**
 * Native minor units → integer pence. Spec §6.3.
 * `rateNano` is GBP per **one native unit** × 1e9 (the direction is fixed: a rate of
 * 104_300_000 means 1 CNY = £0.1043). Exact integer arithmetic in BigInt, rounded half-up to
 * the penny; no float ever holds the amount.
 * `GBP` is the identity and ignores `rateNano`.
 * Throws `RangeError` on a non-integer or negative amount, a non-integer or non-positive rate, or
 * a result beyond `Number.MAX_SAFE_INTEGER`; `NormalisationError('currency-unsupported')` on a
 * currency without a known exponent.
 */
export function toGbp(amountMinor: number, currency: string, rateNano: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new RangeError(`amountMinor must be a non-negative integer: ${amountMinor}`);
  if (currency === 'GBP') return amountMinor;
  const exponent = MINOR_EXPONENT[currency];
  if (exponent === undefined) throw new NormalisationError('currency-unsupported', currency);
  if (!Number.isSafeInteger(rateNano) || rateNano <= 0)
    throw new RangeError(`rateNano must be a positive integer: ${rateNano}`);
  // pence = amountMinor / 10^exp × rateNano / 1e9 × 100
  const numerator = BigInt(amountMinor) * BigInt(rateNano) * 100n;
  const denominator = NANO * 10n ** BigInt(exponent);
  // why: half-up for non-negative values is floor((2n + d) / 2d).
  const pence = (2n * numerator + denominator) / (2n * denominator);
  if (pence > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`converted amount too large: ${pence}`);
  return Number(pence);
}
