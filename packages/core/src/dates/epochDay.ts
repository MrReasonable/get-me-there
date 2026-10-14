import { type IsoDate, isoDateSchema, isRealDate } from '../types/ids.js';

/**
 * Calendar-date arithmetic on epoch-day integers (days since 1970-01-01). Spec §6.1:
 * "Dates are calendar dates independent of process timezone: epoch-day integers and `Intl`
 * only, never `Date`-local arithmetic."
 *
 * why: no `Date` object appears in this file. The conversions are Howard Hinnant's
 * `days_from_civil` / `civil_from_days` algorithms on the proleptic Gregorian calendar, which
 * are exact integer arithmetic and cannot be shifted by the process timezone or a DST change.
 * Branded values are minted only by WP0's zod schemas (`isoDateSchema.parse`,
 * `isoMonthSchema.parse`), never by an `as` cast.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Epoch day of 0001-01-01 and 9999-12-31: the range a four-digit `IsoDate` can express. */
const MIN_EPOCH_DAY = -719_162;
const MAX_EPOCH_DAY = 2_932_896;

/** Zero-padded decimal, e.g. pad(7, 2) = '07'. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Gregorian leap year: divisible by 4, except centuries not divisible by 400. */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days since 1970-01-01 for a real `YYYY-MM-DD`. Throws `RangeError` on anything else. Spec §6.1. */
export function toEpochDay(date: IsoDate): number {
  const m = DATE_RE.exec(date);
  const y = Number(m?.[1]);
  const mo = Number(m?.[2]);
  const d = Number(m?.[3]);
  // why: the brand says the string was validated, but rows read back from SQLite JSON are not
  // re-parsed by zod, so a malformed value must fail loudly here rather than produce a wrong day.
  if (m === null || y < 1 || !isRealDate(y, mo, d)) throw new RangeError(`not a calendar date: ${date}`);
  const yy = mo <= 2 ? y - 1 : y; // the civil year starts in March so the leap day is last
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400; // [0, 399]
  const mp = (mo + 9) % 12; // March = 0 … February = 11
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146_097 + doe - 719_468;
}

/** The `YYYY-MM-DD` for an epoch day. Throws `RangeError` outside years 0001–9999 or on a non-integer. Spec §6.1. */
export function fromEpochDay(day: number): IsoDate {
  if (!Number.isInteger(day) || day < MIN_EPOCH_DAY || day > MAX_EPOCH_DAY) {
    throw new RangeError(`epoch day out of range: ${day}`);
  }
  const z = day + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (mo <= 2 ? 1 : 0);
  return isoDateSchema.parse(`${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`);
}

/** `date` plus `n` calendar days (n may be negative). Spec §6.1: `returnDate = departureDate + nights`. */
export function addDays(date: IsoDate, n: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + n);
}

/** Calendar days from `a` to `b` (negative when `b` is earlier). `daysBetween(d, d) === 0`. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toEpochDay(b) - toEpochDay(a);
}
