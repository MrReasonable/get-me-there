import { NormalisationError } from '../errors.js';

// why: IATA designators are two alphanumeric characters (spec §6.4, e.g. `4U`). Three-letter
// ICAO codes or airline names are not mapped: an unmappable carrier is an error, never a guess.
const CARRIER_RE = /^[A-Z0-9]{2}$/;

// why: a designator prefix inside a flight-number string must contain at least one letter,
// otherwise "0938" would read as carrier "09" + flight 38.
const FLIGHT_RE = /^(?:([A-Z][A-Z0-9]|[0-9][A-Z])\s*)?(\d{1,4})$/;

/**
 * Canonical marketing or operating carrier: trimmed, upper-case, exactly `^[A-Z0-9]{2}$`.
 * Spec §6.4. Throws `NormalisationError('unmappable-carrier')` for anything else.
 */
export function canonicalCarrier(s: string): string {
  const c = s.trim().toUpperCase();
  if (!CARRIER_RE.test(c)) throw new NormalisationError('unmappable-carrier', `carrier ${JSON.stringify(s)}`);
  return c;
}

/**
 * Canonical flight number: an integer 1–9999 without leading zeros. Spec §6.4.
 * Accepts `938`, `0938`, `VS938`, `VS 938`, or a number; when `carrier` is given, a designator prefix in
 * the string must equal it (a vendor string naming another airline is not silently re-labelled).
 * Throws `NormalisationError('unmappable-carrier')` for anything else (suffix letters, 0, >4 digits).
 */
export function canonicalFlightNumber(s: string | number, carrier?: string): number {
  // why: some vendors send the number as JSON number; it gets the same range check as a string.
  const text = typeof s === 'number' ? (Number.isInteger(s) && s >= 0 ? String(s) : 'x') : s;
  const m = FLIGHT_RE.exec(text.trim().toUpperCase());
  const prefix = m?.[1];
  const digits = m?.[2];
  if (digits === undefined)
    throw new NormalisationError('unmappable-carrier', `flight number ${JSON.stringify(s)}`);
  if (prefix !== undefined && carrier !== undefined && prefix !== carrier) {
    throw new NormalisationError(
      'unmappable-carrier',
      `flight number ${JSON.stringify(s)} does not belong to ${carrier}`,
    );
  }
  const n = Number(digits);
  if (n === 0) throw new NormalisationError('unmappable-carrier', `flight number ${JSON.stringify(s)}`);
  return n;
}
