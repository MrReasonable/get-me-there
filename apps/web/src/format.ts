import {
  addDays,
  formatPence,
  type IsoDate,
  type IsoMonth,
  isoDateSchema,
  isoDateTimeOfEpochMs,
  londonDateOf,
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

/**
 * Every spelling of a month the date fields take, lower case, to its number: the short form the app shows (`MONTHS`),
 * the full name, and "sept" (spec rev 55 §11: "10 Sept 2027").
 */
const MONTH_BY_NAME: ReadonlyMap<string, number> = new Map([
  ...MONTHS.map((m, i) => [m.toLowerCase(), i + 1] as const),
  ...[
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ].map((m, i) => [m, i + 1] as const),
  ['sept', 9],
]);

/** "10 Jan 2027", "10 january 2027" (day, month, optional four-digit year). */
const DAY_MONTH = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/;
/** "Jan 10", "Jan 10 2027", "Jan 10, 2027" (month, day, optional four-digit year). */
const MONTH_DAY = /^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/;
/** The wire form itself, "2027-01-10". */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/** How many years ahead a year-less date is looked for: a 29 February is at most eight years away (1896 → 1904). */
const YEARS_AHEAD = 8;

/** "YYYY-MM-DD" for the parts, branded only when it is a real calendar date (core's isoDateSchema judges). */
function realDate(year: number, month: number, day: number): IsoDate | null {
  const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = isoDateSchema.safeParse(text);
  return parsed.success ? parsed.data : null;
}

/**
 * Spec rev 55 §11 (WP20 Task 20.5): a date as the operator types it into the new-search form, beside `formatIsoDate`
 * and its month table. Taken: "10 Jan 2027" (the form the app shows), "10 january 2027", "10 Sept 2027", "Jan 10 2027"
 * and the wire form "2027-01-10", ignoring case and surrounding spaces. A day and month with no year ("10 Jan", "Jan 10")
 * is their next occurrence on or after `today` (a 29 February the next leap year's). Anything else is null: another
 * form ("10/01/2027", a two-digit year), a month it does not know, or a day that does not exist ("31 Feb 2027"); the
 * form then says "Enter the date as 10 Jan 2027" and asks no estimate for it. Calendar arithmetic on the strings only.
 */
export function parseDateText(s: string, today: IsoDate): IsoDate | null {
  const text = s.trim().toLowerCase().replace(/\s+/g, ' ');
  const iso = ISO.exec(text);
  if (iso !== null) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dm = DAY_MONTH.exec(text);
  const md = MONTH_DAY.exec(text);
  // why: the two orders differ only in where the day and the month name sit; the year is the third group in both. A
  // missing group reads as '' and an unknown month as 0, which no real date has, so either is refused below
  const parts =
    dm !== null
      ? { day: dm[1] ?? '', month: dm[2] ?? '', year: dm[3] }
      : md !== null
        ? { day: md[2] ?? '', month: md[1] ?? '', year: md[3] }
        : null;
  if (parts === null) return null;
  const month = MONTH_BY_NAME.get(parts.month) ?? 0;
  const day = Number(parts.day);
  if (parts.year !== undefined) return realDate(Number(parts.year), month, day);
  const first = Number(today.slice(0, 4));
  for (let year = first; year <= first + YEARS_AHEAD; year++) {
    const d = realDate(year, month, day);
    if (d !== null && d >= today) return d;
  }
  return null;
}

/** Short form without the year, "2027-03-14" → "14 Mar" (day cells, segment times); malformed input is returned as given. */
export function formatIsoDateShort(d: string): string {
  const [, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (day === undefined || month === undefined) return d;
  return `${Number(day)} ${month}`;
}

/** A trip's dates without the year (ruling 6): "5–15 Nov" in one month, "28 Nov–3 Dec" across two. */
export function formatTripShort(departure: string, back: string): string {
  const [from, to] = [formatIsoDateShort(departure), formatIsoDateShort(back)];
  const [dayFrom, monthFrom] = from.split(' ');
  return monthFrom !== undefined && to.endsWith(` ${monthFrom}`) ? `${dayFrom}–${to}` : `${from}–${to}`;
}

/** A date on the departure board's flaps, "2027-03-14" → "Sun 14 Mar 27" (the cells upper-case it); string slicing only. */
export function formatFlapDate(d: IsoDate): string {
  const [day = '', month = ''] = formatIsoDateShort(d).split(' ');
  return `${formatWeekday(d)} ${day.padStart(2, '0')} ${month} ${d.slice(2, 4)}`;
}

/** Weekday form, "2027-03-14" → "Sun", from core's epoch-day arithmetic (never a Date). */
export function formatWeekday(d: IsoDate): string {
  return WEEKDAYS[(((toEpochDay(d) + 4) % 7) + 7) % 7] ?? '';
}

const MONTH_WORDS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAY_WORDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * The date in words for assistive technology (WP19, revision 50: an arrival's day offset is spoken as its date),
 * "2027-03-15" → "Monday 15 March 2027", from the string and core's epoch day, never a Date.
 */
export function formatIsoDateWords(d: IsoDate): string {
  const [y, m, day] = d.split('-');
  return `${WEEKDAY_WORDS[(((toEpochDay(d) + 4) % 7) + 7) % 7] ?? ''} ${Number(day)} ${MONTH_WORDS[Number(m) - 1] ?? ''} ${y ?? ''}`;
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

/**
 * Epoch ms → its London calendar date (`YYYY-MM-DD`) and its 24-hour time (`HH:MM`): the one split a search's page
 * words an instant by ("Searched today 09:12–11:41", a flight read's "yesterday 11:44"; WP20 Task 20.6).
 */
export function londonParts(ms: number): { date: string; time: string } {
  // why: one formatToParts per instant (tables format a row per point), not one per field (review arch M6)
  const byType = new Map(LONDON_PARTS.formatToParts(ms).map((p) => [p.type, p.value]));
  const part = (type: Intl.DateTimeFormatPartTypes) => byType.get(type) ?? '';
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
  return formatIsoDate(londonDateOf(isoDateTimeOfEpochMs(ms)));
}

/**
 * A chart's price-axis tick, whole pounds without the sign ("1,200"; the axis title says GBP). A scale value, never a
 * fare: with no "£" it needs no exemption from the rendered sweep, and every fare in a chart goes through PriceCell
 * (plan decision 52).
 */
export function formatAxisPounds(pence: number): string {
  return formatPence(Math.round(pence / 100) * 100).replace('£', '');
}
