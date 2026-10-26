/**
 * Journey time is stored in whole minutes (`maxJourneyMinutes`) and entered as hours and minutes. Blank in both boxes
 * means "not set"; one box blank counts as 0 (so "25" hours alone is 25h 00m). Minutes above 59 still mean minutes
 * (20 h 75 min is 21h 15m), and the field shows the total, so no typed number is silently dropped.
 */
export type JoinedMinutes = { kind: 'empty' } | { kind: 'value'; minutes: number } | { kind: 'invalid' };

const WHOLE = /^\d+$/;

/** 1500 → { hours: '25', minutes: '0' }; undefined → two blank boxes. */
export function splitMinutes(total: number | undefined): { hours: string; minutes: string } {
  if (total === undefined) return { hours: '', minutes: '' };
  return { hours: String(Math.floor(total / 60)), minutes: String(total % 60) };
}

/** The two boxes' text as minutes, "not set", or invalid (either box not a whole number). */
export function joinHoursMinutes(hours: string, minutes: string): JoinedMinutes {
  const h = hours.trim();
  const m = minutes.trim();
  if (h === '' && m === '') return { kind: 'empty' };
  if ((h !== '' && !WHOLE.test(h)) || (m !== '' && !WHOLE.test(m))) return { kind: 'invalid' };
  return { kind: 'value', minutes: (h === '' ? 0 : Number(h)) * 60 + (m === '' ? 0 : Number(m)) };
}
