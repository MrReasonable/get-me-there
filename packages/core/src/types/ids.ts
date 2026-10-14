import { z } from 'zod';

/** Upper-case IATA airport code. Spec §6.1: format `^[A-Z]{3}$`; existence is checked separately. */
export type Iata = string & { readonly __brand: 'Iata' };
/** Calendar date `YYYY-MM-DD`, independent of any timezone. Spec §6.1. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };
/** Calendar month `YYYY-MM`. Used by Travelpayouts month tiles. */
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };
/** Instant in `Date#toISOString()` form only. Spec §6.3. */
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True when y-m-d is a real Gregorian calendar date (rejects 2027-02-29, 2026-04-31). Pure arithmetic, no Date. */
export function isRealDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
  return d <= days;
}

// why: operators type 'lhr'; the API accepts it and stores 'LHR'. Metropolitan codes (LON) pass this
// format check and are rejected later by validateSearchSpace against the airports table.
export const iataSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'IATA code must be three letters')
  .transform((s) => s as Iata);

export const isoDateSchema = z
  .string()
  .refine((s) => {
    const m = DATE_RE.exec(s);
    return m !== null && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }, 'date must be a real YYYY-MM-DD')
  .transform((s) => s as IsoDate);

export const isoMonthSchema = z
  .string()
  .refine((s) => {
    const m = MONTH_RE.exec(s);
    return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
  }, 'month must be YYYY-MM')
  .transform((s) => s as IsoMonth);

export const isoDateTimeSchema = z
  .string()
  .refine(
    (s) => DATETIME_RE.test(s) && new Date(s).toISOString() === s,
    'timestamp must be Date#toISOString() form',
  )
  .transform((s) => s as IsoDateTime);

function must<T>(schema: z.ZodType<T, string>, value: string, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`${what}: ${value}`);
  return r.data;
}

/**
 * The only brand mint sites besides the zod transforms above. Usable in production for
 * constructed values; raw user input goes through the schemas instead. Each throws on a
 * value the schema rejects, so a brand never holds an invalid string.
 */
export const asIata = (s: string): Iata => must(iataSchema, s, 'not an IATA code');
export const asIsoDate = (s: string): IsoDate => must(isoDateSchema, s, 'not an ISO date');
export const asIsoMonth = (s: string): IsoMonth => must(isoMonthSchema, s, 'not an ISO month');
export const asIsoDateTime = (s: string): IsoDateTime => must(isoDateTimeSchema, s, 'not an ISO timestamp');
/** Mint an instant from epoch milliseconds (the clock's own output, so always valid). */
export const isoDateTimeOfEpochMs = (ms: number): IsoDateTime => asIsoDateTime(new Date(ms).toISOString());
