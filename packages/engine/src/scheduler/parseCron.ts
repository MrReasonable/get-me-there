import { Cron } from 'croner';

/** True when `tz` is an IANA zone this runtime knows (spec §8.2 "tz validated"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type ParsedCron = { ok: true; next: (from: Date) => Date | null } | { ok: false; reason: string };

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
 * cron parser. `next(from)` is the first firing strictly after `from`.
 */
export function parseCron(expr: string, tz: string): ParsedCron {
  const v = validated(expr, tz);
  if (!v.ok) return v;
  const job = v.job;
  return { ok: true, next: (from) => job.nextRun(from) };
}

/** The last scheduled firing strictly before `before`, or null (spec §8.2 "the last scheduled firing was missed"). */
export function previousFiring(expr: string, tz: string, before: Date): Date | null {
  const v = validated(expr, tz);
  if (!v.ok) return null;
  return v.job.previousRuns(1, before)[0] ?? null;
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

/**
 * Firings over the next 365 days divided by 12, unrounded (a weekly schedule is about 4.33), so the spec §8.2 cadence
 * table and budgetFit come from the same function (ruling 12); 0 with no or an invalid schedule.
 */
export function runsPerMonth(expr: string | null, tz: string, from: Date): number {
  if (expr === null) return 0;
  return (
    firingsBetween(expr, tz, new Date(from.getTime() + 1), new Date(from.getTime() + 365 * 86_400_000))
      .length / 12
  );
}
