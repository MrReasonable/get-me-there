import { formatPence, type IsoDate, microGbpToPence, toEpochDay } from '@gmt/core';

// why: core's formatPence (src/text/money.ts: en-GB grouping, throws on non-integer or negative) is the
// single money formatter for web and email; re-exported so components keep one import site.
export { formatPence };

/**
 * The one month and weekday table of the web app (plan decision 38: WP10 imports these formatters
 * rather than writing its own). Every date is formatted from its `YYYY-MM-DD` string, never through
 * a `Date`, so a browser outside Europe/London cannot shift a day (review focus 3).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Indexed by (epoch day + 4) mod 7: 1970-01-01, epoch day 0, was a Thursday. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Integer micro-GBP → pence through core's `microGbpToPence` (rounded up, so a cost is never understated; decision 49) → "£…". */
export function formatMicroGbp(micro: number): string {
  if (!Number.isInteger(micro) || micro < 0)
    throw new RangeError(`micro-GBP must be a non-negative integer, got ${micro}`);
  return formatPence(microGbpToPence(micro));
}

/** Date form, "2027-03-14" → "14 Mar 2027", by string slicing only; anything malformed is returned as given. */
export function formatIsoDate(d: string): string {
  const [y, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (y === undefined || day === undefined || month === undefined) return d;
  return `${Number(day)} ${month} ${y}`;
}

/** Short form without the year, "2027-03-14" → "14 Mar" (day cells, segment times); malformed input is returned as given. */
export function formatIsoDateShort(d: string): string {
  const [, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (day === undefined || month === undefined) return d;
  return `${Number(day)} ${month}`;
}

/** Weekday form, "2027-03-14" → "Sun", from core's epoch-day arithmetic (never a Date). */
export function formatWeekday(d: IsoDate): string {
  return WEEKDAYS[(((toEpochDay(d) + 4) % 7) + 7) % 7] ?? '';
}

/** Long form with the weekday, "2027-03-14" → "Sun 14 Mar 2027". */
export function formatIsoDateLong(d: IsoDate): string {
  return `${formatWeekday(d)} ${formatIsoDate(d)}`;
}

/** A run's UTC instant, "2026-10-14T12:00:00.000Z" → "14 Oct 2026 12:00 UTC" (labelled UTC, never shifted). */
export function formatInstantUtc(iso: string): string {
  return `${formatIsoDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`;
}

/** Segment local time "2027-03-14T10:25" → "14 Mar 10:25" (wall time at the airport, spec §6.4). */
export function formatLocalDateTime(local: string): string {
  const [date, time] = local.split('T');
  if (date === undefined || time === undefined) return local;
  return `${formatIsoDateShort(date)} ${time}`;
}

/** 905 → "15h 05m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Estimate seconds → "45s", "12m", "2h 05m". */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : formatMinutes(minutes);
}

/** Pence → "412" or "412.50" for an editable input: no float, no thousands separator. */
export function penceToPoundsInput(pence: number | undefined): string {
  if (pence === undefined) return '';
  const rest = pence % 100;
  return `${Math.floor(pence / 100)}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`;
}

/** "12" | "12.5" | "12.50" → pence, without floating point; blank or malformed → undefined. */
export function parsePoundsToPence(input: string): number | undefined {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m || m[1] === undefined) return undefined;
  const fraction = (m[2] ?? '').padEnd(2, '0');
  return Number(m[1]) * 100 + Number(fraction);
}

/** A typed pounds string in its canonical form ("450.5" → "450.50", junk → ""): what useSynced compares. */
export function poundsText(input: string): string {
  return penceToPoundsInput(parsePoundsToPence(input));
}
