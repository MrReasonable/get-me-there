import {
  addDays,
  formatPence,
  type IsoDate,
  type IsoMonth,
  isoDateSchema,
  microGbpToPence,
  monthOf,
  toEpochDay,
} from '@gmt/core';

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

/**
 * A run's instant in SCHEDULER_TIMEZONE, labelled (plan decision 52: every run time the web shows is Europe/London,
 * the zone runs are scheduled in): "2026-10-14T12:00:00.000Z" → "14 Oct 2026 13:00 Europe/London".
 */
export function formatRunInstant(iso: string): string {
  return `${formatInstantLondon(Date.parse(iso))} Europe/London`;
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

// --- WP10: calendar-grid and instant forms (decisions 38, 46: this module, its one month and weekday table) ---

/** Weekday with Monday = 0, the calendar grid's column, from core's epoch day (1970-01-01 was a Thursday, index 3). */
export function weekdayIndex(d: IsoDate): number {
  return (((toEpochDay(d) + 3) % 7) + 7) % 7;
}

/** The grid's Monday-first column headers, read from the one weekday table. */
export const WEEK_HEADERS: readonly string[] = [1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAYS[i] ?? '');

/** "2027-03-14" → "14", the grid's day number. */
export function formatDayOfMonth(d: IsoDate): string {
  return String(Number(d.slice(8, 10)));
}

/** "2027-03-14" → "Sun 14 Mar" (day cells, the panel's cell picker, chart tooltips). */
export function formatDayShort(d: IsoDate): string {
  return `${formatWeekday(d)} ${formatIsoDateShort(d)}`;
}

/** "2027-03" → "Mar 2027" (month grids); malformed input is returned as given. */
export function formatIsoMonth(m: IsoMonth): string {
  const month = MONTHS[Number(m.slice(5, 7)) - 1];
  return month === undefined ? m : `${month} ${m.slice(0, 4)}`;
}

/** Every date of a month, in order, by epoch-day steps; isoDateSchema validates and brands the first day. */
export function monthDays(m: IsoMonth): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = isoDateSchema.parse(`${m}-01`); monthOf(d) === m; d = addDays(d, 1)) out.push(d);
  return out;
}

// why: numeric parts only, so the month name comes from the one table above, never from Intl; Intl takes epoch ms,
// so nothing here builds a Date. Europe/London is the app's reference zone (spec §6.1).
const LONDON_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function londonParts(ms: number): { date: string; time: string } {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    LONDON_PARTS.formatToParts(ms).find((p) => p.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

/** Epoch ms → "14 Mar 2027 15:00" in Europe/London (history tables, the panel's fetched column). */
export function formatInstantLondon(ms: number): string {
  const { date, time } = londonParts(ms);
  return `${formatIsoDate(date)} ${time}`;
}

/** Epoch ms → "14 Mar 2027" in Europe/London (the History fetch axis, run dates). */
export function formatInstantDateLondon(ms: number): string {
  return formatIsoDate(londonParts(ms).date);
}

/**
 * A chart's price-axis tick, whole pounds without the sign ("1,200"; the axis title says GBP). A scale value, never a
 * fare: with no "£" it needs no exemption from the rendered sweep, and every fare in a chart goes through PriceCell
 * (plan decision 52).
 */
export function formatAxisPounds(pence: number): string {
  return formatPence(Math.round(pence / 100) * 100).replace('£', '');
}
