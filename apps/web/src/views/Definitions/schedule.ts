import { SETUP_COPY } from '../../copy/setup.js';

/**
 * The schedule picker's model. A definition stores a five-field cron (core's `cronSchema`: digits, `* / , -` and
 * spaces); the picker reads the common shapes back as a human schedule and writes them as cron, so the operator rarely
 * has to read cron at all. Anything else is kept as a custom cron, unchanged.
 *
 * Days are cron day-of-week numbers, 0 = Sunday (7, also Sunday in cron, is read as 0).
 */
export type Schedule =
  | { kind: 'none' }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: readonly number[]; time: string }
  | { kind: 'custom'; cron: string };

export type ScheduleKind = Schedule['kind'];
export const SCHEDULE_KINDS: readonly ScheduleKind[] = ['none', 'daily', 'weekly', 'custom'];
/** Monday first, as the picker lists the days. */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
/** The spec §11 default firing time, used when a mode is picked with no time to carry over. */
export const DEFAULT_TIME = '05:00';

const pad = (n: number) => String(n).padStart(2, '0');
const INT = /^\d{1,2}$/;

/** "0".."59" or "0".."23" as a number in range, else null. */
function field(text: string, max: number): number | null {
  if (!INT.test(text)) return null;
  const n = Number(text);
  return n <= max ? n : null;
}

/** A day-of-week field of single days and ranges ("1", "1,4", "1-5", "0,6"), sorted Monday first, or null. */
function parseDays(text: string): number[] | null {
  const days = new Set<number>();
  for (const part of text.split(',')) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > to || to > 7) return null;
      for (let d = from; d <= to; d++) days.add(d % 7);
    } else {
      const d = field(part, 7);
      if (d === null) return null;
      days.add(d % 7);
    }
  }
  return WEEK_ORDER.filter((d) => days.has(d));
}

/** Reads a stored cron as the picker's schedule: null → none; `M H * * *` → daily; `M H * * <days>` → weekly. */
export function parseSchedule(cron: string | null): Schedule {
  if (cron === null || cron.trim() === '') return { kind: 'none' };
  const parts = cron.trim().split(/\s+/);
  const [m, h, dom, month, dow] = parts;
  if (parts.length !== 5 || m === undefined || h === undefined || dow === undefined)
    return { kind: 'custom', cron };
  const minute = field(m, 59);
  const hour = field(h, 23);
  if (minute === null || hour === null || dom !== '*' || month !== '*') return { kind: 'custom', cron };
  const time = `${pad(hour)}:${pad(minute)}`;
  if (dow === '*') return { kind: 'daily', time };
  const days = parseDays(dow);
  return days === null ? { kind: 'custom', cron } : { kind: 'weekly', days, time };
}

/** "05:00" → [5, 0]; anything else → null. */
function timeParts(time: string): [number, number] | null {
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (t === null) return null;
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  return hour <= 23 && minute <= 59 ? [hour, minute] : null;
}

/**
 * The cron a schedule stores: none → null; daily and weekly → `M H * * …`. A weekly schedule with no day, or a time
 * that is not HH:MM, has no cron (`undefined`): the picker says what is missing instead of saving a guess.
 */
export function scheduleToCron(s: Schedule): string | null | undefined {
  if (s.kind === 'none') return null;
  if (s.kind === 'custom') return s.cron.trim() === '' ? null : s.cron;
  const t = timeParts(s.time);
  if (t === null) return undefined;
  const [hour, minute] = t;
  if (s.kind === 'daily') return `${minute} ${hour} * * *`;
  if (s.days.length === 0) return undefined;
  // why: cron lists days in number order (Sunday 0 first); the picker's Monday-first order is for reading only.
  return `${minute} ${hour} * * ${[...s.days].sort((a, b) => a - b).join(',')}`;
}

/** The plain reading of a stored cron, e.g. "Mondays at 05:00 (Europe/London)". */
export function describeSchedule(cron: string | null, tz: string): string {
  const C = SETUP_COPY.schedule;
  const s = parseSchedule(cron);
  switch (s.kind) {
    case 'none':
      return C.none;
    case 'daily':
      return C.daily(s.time, tz);
    case 'weekly':
      return C.weekly(s.days, s.time, tz);
    case 'custom':
      return C.custom(s.cron.trim(), tz);
  }
}

/** The schedule a mode switch starts from: the time (and days) carried over from the current one where it has them. */
export function switchSchedule(from: Schedule, to: ScheduleKind, cron: string | null): Schedule {
  const time = from.kind === 'daily' || from.kind === 'weekly' ? from.time : DEFAULT_TIME;
  switch (to) {
    case 'none':
      return { kind: 'none' };
    case 'daily':
      return { kind: 'daily', time };
    case 'weekly':
      return { kind: 'weekly', days: from.kind === 'weekly' ? from.days : [1], time };
    case 'custom':
      // why: switching to custom shows the cron the picker would store, so the operator edits from it, not from blank.
      return { kind: 'custom', cron: cron ?? '' };
  }
}
