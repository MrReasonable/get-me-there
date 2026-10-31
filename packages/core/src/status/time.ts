import { type IsoDateTime, isoDateTimeOfEpochMs } from '../types/ids.js';

/** An instant as a readable local date and time in `tz`, e.g. "Mon, 19 Oct 2026, 05:00 (Europe/London)" (po-015). */
export function formatInstant(at: IsoDateTime, tz: string): string {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${f.format(new Date(at))} (${tz})`;
}

/** The short month names, fixed here so no host's locale data ("Sept" in newer CLDR) changes a sentence. */
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * An instant as the short local form of spec revision 55 §8.1 "Stop causes", "14 Mar 15:00": day, short month and
 * 24-hour time in `tz`, no year, no comma, no zone. Assembled from numeric `formatToParts` parts and core's own month
 * names, so ICU differences between hosts (month spellings, separators, `24:00` at midnight) cannot change a stop
 * sentence (WP20 §0, Windows CI).
 */
export function formatInstantShort(at: IsoDateTime, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(byType.get(type));
  const two = (n: number) => String(n).padStart(2, '0');
  // why: `% 24` keeps midnight at 00 on an engine that ignores hourCycle and prints 24 (an h24 host default).
  return `${part('day')} ${SHORT_MONTHS[part('month') - 1]} ${two(part('hour') % 24)}:${two(part('minute'))}`;
}

/**
 * The UTC instant `months` calendar months from `at`, clamped to the month's last day (2026-01-31 + 13 → 2027-02-28),
 * the one month rule of the consent record: the worker's start check and the Status report both read it (spec §2).
 */
export function addMonthsClamped(at: IsoDateTime, months: number): IsoDateTime {
  const d = new Date(at);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const out = new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(d.getUTCDate(), last),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
  return isoDateTimeOfEpochMs(out.getTime());
}
