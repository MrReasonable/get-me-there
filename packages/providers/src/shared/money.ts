/**
 * Vendor money to integer minor units, shared by every adapter (plan decision 24; spec §6.3: "No float ever holds
 * money"). WP5 (SearchApi) and WP6 (Travelpayouts) both convert through this one function.
 */
import { MINOR_EXPONENT } from '@gmt/core';

/** A plain decimal literal: digits, optionally a point and more digits. No sign, no exponent. */
const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * A vendor's major-unit amount (`412.5` GBP) as integer minor units (`41250`) with core's ISO 4217 exponent.
 * Returns null when the amount is not a finite positive number, carries more decimals than the currency has
 * (`412.555` GBP), is beyond `Number.MAX_SAFE_INTEGER` minor units, or the currency has no known exponent (an
 * unknown currency returns null; callers drop the row and report the cell as `currency-unsupported`, plan decision
 * 29). Never rounds. Callers drop every null row and count it `offers-dropped:n` (spec §8.1).
 * why: exact decimal-string arithmetic. `String(n)` is the shortest decimal that reads back as the same double, which
 * for any amount a vendor writes in JSON is the literal it wrote; multiplying by 100 instead gives 0.29 × 100 =
 * 28.999…, and Math.round would hide a third decimal the vendor really sent.
 */
export function majorToMinor(major: number, currency: string): number | null {
  const exponent = MINOR_EXPONENT[currency];
  if (exponent === undefined || !Number.isFinite(major) || major <= 0) return null;
  // why: String() switches to exponent form below 1e-6 and from 1e21; neither is a price, so both are refused here.
  const m = PLAIN_DECIMAL.exec(String(major));
  if (m === null) return null;
  const whole = m[1] ?? '';
  const fraction = m[2] ?? '';
  if (fraction.length > exponent) return null;
  const minor = BigInt(`${whole}${fraction.padEnd(exponent, '0')}`);
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minor);
}
