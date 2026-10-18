import type { PageRequest } from '@gmt/core';
import type { FormFacts } from './driver.js';
import { MONTHS } from './names.js';

/**
 * The search-form check (spec §2 "Before reading, the worker checks the page's own search form (round trip, one adult,
 * departure and return dates) against the query"; decision 69; prov-011, PIE-15). `mismatch` and `absent` both stop
 * the page as `unrecognised`. The field names are the brief's hypothesis until Task 14.2's recording pins them, which is
 * why FORM_VERIFIED is false and the server refuses to start.
 */
export type FormCheck = 'ok' | 'mismatch' | 'absent';

const WEEKDAYS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

interface ShownDate {
  weekday: number | null;
  day: number;
  month: number;
  year: number | null;
}
/** "Thu, 5 Nov", "5 Nov 2026", "Thursday, 5 November" → its parts; null when unreadable. */
export function readShownDate(s: string): ShownDate | null {
  const m =
    /^(?:(?<wd>[A-Z][a-z]{2})[a-z]*,? )?(?<day>[0-9]{1,2}) (?<mon>[A-Z][a-z]{2})[a-z]*(?: (?<year>[0-9]{4}))?$/.exec(
      s.trim(),
    );
  const g = m?.groups;
  if (g === undefined) return null;
  const month = SHORT.indexOf(g.mon ?? '') + 1;
  const weekday = g.wd === undefined ? null : WEEKDAYS.indexOf(g.wd);
  if (month === 0 || weekday === -1) return null;
  return { weekday, day: Number(g.day), month, year: g.year === undefined ? null : Number(g.year) };
}

function sameDate(shown: ShownDate | null, iso: string): boolean {
  if (shown === null) return false;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return (
    shown.day === d.getUTCDate() &&
    shown.month === d.getUTCMonth() + 1 &&
    (shown.weekday === null || shown.weekday === d.getUTCDay()) &&
    (shown.year === null || shown.year === d.getUTCFullYear())
  );
}

export function checkForm(
  form: FormFacts,
  req: Pick<PageRequest, 'departureDate' | 'returnDate'>,
): FormCheck {
  if (form === null) return 'absent';
  if (!/\bRound trip$/.test(form.tripType)) return 'mismatch';
  if (!/^1 passenger\b(?!s)/.test(form.passengers)) return 'mismatch';
  const dep = readShownDate(form.departure);
  const ret = readShownDate(form.return);
  if (!sameDate(dep, req.departureDate) || !sameDate(ret, req.returnDate)) return 'mismatch';
  // why: with neither a weekday nor a year, a stay of a whole year shows the same day and month twice: ambiguous.
  const bare = (s: ShownDate | null): boolean => s !== null && s.weekday === null && s.year === null;
  if (bare(dep) && bare(ret) && req.departureDate.slice(5) === req.returnDate.slice(5)) return 'mismatch';
  return 'ok';
}
