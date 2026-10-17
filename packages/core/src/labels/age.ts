import type { IsoDateTime } from '../types/ids.js';
import type { Provenance } from '../types/provenance.js';

/** Spec §3 "Effective age" and the two label formats, defined once here for web, api and email. */
export type EffectiveAge =
  | { kind: 'observed'; fetchedHours: number; observedHours: number }
  | { kind: 'bounded'; fetchedHours: number; maxAgeHours: number }
  | { kind: 'unknown'; fetchedHours: number };

/** Whole hours between two instants, never negative (a vendor clock ahead of ours reads as 0). */
function hoursBetween(earlier: IsoDateTime, later: IsoDateTime): number {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  return Math.max(0, Math.floor(ms / 3_600_000));
}

export function effectiveAge(
  p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>,
  now: IsoDateTime,
): EffectiveAge {
  const fetchedHours = hoursBetween(p.fetchedAt, now);
  if (p.providerObservedAt !== undefined) {
    return { kind: 'observed', fetchedHours, observedHours: hoursBetween(p.providerObservedAt, now) };
  }
  if (p.maxAgeHours === 'unknown') return { kind: 'unknown', fetchedHours };
  return { kind: 'bounded', fetchedHours, maxAgeHours: p.maxAgeHours };
}

/** The age a careful reader should assume: observed age, or fetched age plus the provider's bound. */
export function worstCaseAgeHours(a: EffectiveAge): number | 'unknown' {
  switch (a.kind) {
    case 'observed':
      return a.observedHours;
    case 'bounded':
      return a.fetchedHours + a.maxAgeHours;
    case 'unknown':
      return 'unknown';
  }
}

/** "just now" under an hour; hours to 47h; days to 13d; weeks after. */
export function formatDuration(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** "just now", "5h ago", "3d ago": the one relative-age phrase (web columns, headers, email). Spec §3. */
export function formatAgo(hours: number): string {
  return hours < 1 ? 'just now' : `${formatDuration(hours)} ago`;
}

/** The fetch age alone, "fetched 2h ago": the Results table's Fetched column (spec §11). */
export function formatFetchedAgo(a: EffectiveAge): string {
  return `fetched ${formatAgo(a.fetchedHours)}`;
}

/** Tooltip, header and email form, e.g. "fetched 2h ago · provider age unknown (≤7d before that)". */
export function formatAgeFull(a: EffectiveAge): string {
  const fetched = formatFetchedAgo(a);
  switch (a.kind) {
    case 'observed':
      return `${fetched} · observed ${formatAgo(a.observedHours)}`;
    case 'bounded':
      // why: maxAgeHours 0 is an interactive search at request time; there is no bound to show.
      return a.maxAgeHours === 0
        ? fetched
        : `${fetched} · provider age unknown (≤${formatDuration(a.maxAgeHours)} before that)`;
    case 'unknown':
      return `${fetched} · provider age unknown`;
  }
}

/** Table-cell and calendar-day form, e.g. "2h ago · ≤7d". */
export function formatAgeCompact(a: EffectiveAge): string {
  const fetched = formatAgo(a.fetchedHours);
  switch (a.kind) {
    case 'observed':
      return `${fetched} · obs ${formatDuration(a.observedHours)}`;
    case 'bounded':
      return a.maxAgeHours === 0 ? fetched : `${fetched} · ≤${formatDuration(a.maxAgeHours)}`;
    case 'unknown':
      return `${fetched} · age unknown`;
  }
}

/** Sort comparator: fresher first; an unknown age loses to any known age; two unknowns tie. Spec §8.1. */
export function compareAges(a: EffectiveAge, b: EffectiveAge): number {
  const wa = worstCaseAgeHours(a);
  const wb = worstCaseAgeHours(b);
  if (wa === 'unknown' && wb === 'unknown') return 0;
  if (wa === 'unknown') return 1;
  if (wb === 'unknown') return -1;
  return wa - wb;
}
