import { isValidTimeZone } from '@gmt/core';
import { Cron } from 'croner';

export type ParsedCron =
  | { ok: true; next: (from: Date) => Date | null; previous: (before: Date) => Date | null }
  | { ok: false; reason: string };

function validated(expr: string, tz: string): { ok: true; job: Cron } | { ok: false; reason: string } {
  if (!isValidTimeZone(tz)) return { ok: false, reason: `unknown time zone "${tz}"` };
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5)
    return { ok: false, reason: 'a schedule has five fields: minute hour day-of-month month day-of-week' };
  const minute = fields[0] ?? '';
  // why: spec §8.2 "sub-hourly rejected". With one fixed minute a pattern fires at most once an hour, whatever the
  // other fields say; every list, range or step in the minute field could fire more often.
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59)
    return {
      ok: false,
      reason: 'schedules may run at most once an hour: the minute field must be a single number 0–59',
    };
  try {
    // why: no callback, so croner schedules nothing; paused for clarity; mode '5-part' refuses seconds and years
    return { ok: true, job: new Cron(fields.join(' '), { timezone: tz, paused: true, mode: '5-part' }) };
  } catch (err) {
    return { ok: false, reason: `not a valid schedule: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * The single croner wrapper (spec §4, §8.2). `api` imports it to validate a definition's cron and tz; `core` has no
 * cron parser. `next(from)` is the first firing strictly after `from`; `previous(before)` the last strictly before the
 * whole second of `before` (croner floors it).
 */
export function parseCron(expr: string, tz: string): ParsedCron {
  const v = validated(expr, tz);
  if (!v.ok) return v;
  const job = v.job;
  return {
    ok: true,
    next: (from) => job.nextRun(from),
    previous: (before) => job.previousRuns(1, before)[0] ?? null,
  };
}

/** The last scheduled firing strictly before `before`, or null (spec §8.2 "the last scheduled firing was missed"). */
export function previousFiring(expr: string, tz: string, before: Date): Date | null {
  const p = parseCron(expr, tz);
  return p.ok ? p.previous(before) : null;
}

/** The firings in [from, to], in order (bounded by the caller's window). */
export function firingsBetween(expr: string, tz: string, from: Date, to: Date): Date[] {
  const p = parseCron(expr, tz);
  if (!p.ok) return [];
  const out: Date[] = [];
  let cursor = p.next(new Date(from.getTime() - 1));
  while (cursor !== null && cursor.getTime() <= to.getTime()) {
    out.push(cursor);
    cursor = p.next(new Date(cursor.getTime() + 1000)); // why: step past the firing so an inclusive nextRun cannot loop
  }
  return out;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Around an offset change the count steps through croner in the time zone itself (see countFirings). */
const TRANSITION_MARGIN_MS = 3 * 3_600_000;

const offsetFormats = new Map<string, Intl.DateTimeFormat>();
/** The zone's UTC offset in minutes at `ms` (Intl's longOffset, "GMT+05:45"; "GMT" is zero). */
function offsetMinutes(tz: string, ms: number): number {
  let f = offsetFormats.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
    offsetFormats.set(tz, f);
  }
  const name = f.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (m === null) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** The instants in [from, to] where the zone's offset changes, each to the minute (sampled daily, then bisected). */
function offsetChanges(tz: string, from: number, to: number): number[] {
  const out: number[] = [];
  let a = from;
  let oa = offsetMinutes(tz, a);
  while (a < to) {
    const b = Math.min(a + DAY_MS, to);
    const ob = offsetMinutes(tz, b);
    if (ob !== oa) {
      // why: real zones change their offset at most once a day, so one change lies in (a, b]
      let lo = a;
      let hi = b;
      while (hi - lo > MINUTE_MS) {
        const mid = lo + Math.max(MINUTE_MS, Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS);
        if (offsetMinutes(tz, mid) === oa) lo = mid;
        else hi = mid;
      }
      out.push(hi);
    }
    a = b;
    oa = ob;
  }
  return out;
}

/** Firings of `job` in [from, to], stepped one by one. */
/** Counts the croner steps a count takes (review T4: a test bounds the work, never the time). */
export interface StepMeter {
  steps: number;
}
const nextOf = (job: Cron, after: Date, meter: StepMeter): Date | null => {
  meter.steps += 1;
  return job.nextRun(after);
};

function stepCount(job: Cron, from: number, to: number, meter: StepMeter): number {
  let n = 0;
  let cursor = nextOf(job, new Date(from - 1), meter);
  while (cursor !== null && cursor.getTime() <= to) {
    n += 1;
    cursor = nextOf(job, new Date(cursor.getTime() + 1000), meter);
  }
  return n;
}

/**
 * Firings of `job` (fixed at `offset` minutes from UTC) in [from, to], a day at a time: with one offset throughout, a
 * five-field schedule fires the same times on every day it matches (its minute and hour fields do not depend on the
 * day), so a whole matching day counts as the first whole day's tally and only a part day is stepped.
 */
function dayCount(job: Cron, offset: number, from: number, to: number, meter: StepMeter): number {
  const local = offset * MINUTE_MS;
  let perDay: number | null = null;
  let n = 0;
  let cursor = nextOf(job, new Date(from - 1), meter);
  while (cursor !== null && cursor.getTime() <= to) {
    const dayStart = Math.floor((cursor.getTime() + local) / DAY_MS) * DAY_MS - local;
    const dayEnd = dayStart + DAY_MS - 1;
    const whole = dayStart >= from && dayEnd <= to;
    if (whole && perDay !== null) n += perDay;
    else {
      const c = stepCount(job, Math.max(from, dayStart), Math.min(to, dayEnd), meter);
      if (whole) perDay = c;
      n += c;
    }
    cursor = nextOf(job, new Date(dayEnd), meter);
  }
  return n;
}

/**
 * The number of firings in [from, to], equal to `firingsBetween(...).length` but without stepping croner's time-zone
 * conversion through every firing (about 0.13 ms each, so an hourly schedule's year took over a second on the event
 * loop; review S11). Between the zone's offset changes the schedule is counted at that fixed offset, a day at a time;
 * within TRANSITION_MARGIN_MS of a change it is stepped in the zone itself, so a skipped or repeated local hour counts
 * exactly as croner fires it. 0 for an invalid schedule.
 */
export function countFirings(
  expr: string,
  tz: string,
  from: Date,
  to: Date,
  meter: StepMeter = { steps: 0 },
): number {
  const p = parseCron(expr, tz);
  if (!p.ok) return 0;
  const f = from.getTime();
  const t = to.getTime();
  if (t < f) return 0;
  const zoned = new Cron(expr.trim().split(/\s+/).join(' '), { timezone: tz, paused: true, mode: '5-part' });
  const fixed = new Map<number, Cron>();
  const atOffset = (offset: number): Cron => {
    let job = fixed.get(offset);
    if (job === undefined) {
      job = new Cron(expr.trim().split(/\s+/).join(' '), { utcOffset: offset, paused: true, mode: '5-part' });
      fixed.set(offset, job);
    }
    return job;
  };
  let n = 0;
  let cursor = f;
  for (const change of offsetChanges(tz, f, t)) {
    const zoneFrom = Math.max(cursor, change - TRANSITION_MARGIN_MS);
    if (zoneFrom > cursor) {
      const offset = offsetMinutes(tz, cursor);
      n += dayCount(atOffset(offset), offset, cursor, zoneFrom - 1, meter);
    }
    const zoneTo = Math.min(t, change + TRANSITION_MARGIN_MS);
    if (zoneTo >= zoneFrom) n += stepCount(zoned, zoneFrom, zoneTo, meter);
    cursor = Math.max(cursor, zoneTo + 1);
  }
  if (cursor <= t) {
    const offset = offsetMinutes(tz, cursor);
    n += dayCount(atOffset(offset), offset, cursor, t, meter);
  }
  return n;
}

/**
 * Firings over the next 365 days divided by 12, unrounded (a weekly schedule is about 4.33), so the spec §8.2 cadence
 * table and budgetFit come from the same function (ruling 12); 0 with no or an invalid schedule.
 */
export function runsPerMonth(expr: string | null, tz: string, from: Date): number {
  if (expr === null) return 0;
  return countFirings(expr, tz, new Date(from.getTime() + 1), new Date(from.getTime() + 365 * DAY_MS)) / 12;
}
