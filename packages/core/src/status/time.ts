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
