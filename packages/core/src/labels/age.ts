import type { IsoDateTime } from '../types/ids.js';
import type { Provenance } from '../types/provenance.js';

/** Spec §3 "Effective age" and the two label formats, defined once here for web, api and email. */
export type EffectiveAge =
  | { kind: 'observed'; fetchedHours: number; observedHours: number }
  /** `assumed` (N4): the bound is the app's assumption, not the vendor's; every label then says so. */
  | { kind: 'bounded'; fetchedHours: number; maxAgeHours: number; assumed?: true }
  | { kind: 'unknown'; fetchedHours: number };

/**
 * Whole hours from `from` to `now`, never negative (a vendor clock ahead of ours reads as 0). The one whole-hour age
 * helper: provenance ages here, and the api's and the alerts' ages outside a provenance (plan decision 59).
 */
export function hoursSince(from: IsoDateTime, now: IsoDateTime): number {
  const ms = new Date(now).getTime() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / 3_600_000));
}

export function effectiveAge(
  p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours' | 'maxAgeAssumed'>,
  now: IsoDateTime,
): EffectiveAge {
  const fetchedHours = hoursSince(p.fetchedAt, now);
  if (p.providerObservedAt !== undefined) {
    // why: plan decision 58: a vendor cannot have observed a price after we fetched it, so an observed time later than
    // the fetch (a vendor clock or data error) never makes the price look younger than the fetch.
    const observedHours = Math.max(hoursSince(p.providerObservedAt, now), fetchedHours);
    return { kind: 'observed', fetchedHours, observedHours };
  }
  if (p.maxAgeHours === 'unknown') return { kind: 'unknown', fetchedHours };
  // why: the flag appears only when set, so a stated bound keeps its plain shape everywhere it is compared.
  return {
    kind: 'bounded',
    fetchedHours,
    maxAgeHours: p.maxAgeHours,
    ...(p.maxAgeAssumed === true ? { assumed: true } : {}),
  };
}

/**
 * The effective age of spec §3 (revision 23, plan decisions 44, 53, 58): the observed age (never younger than the fetch
 * age, `effectiveAge` clamps it) when the vendor dates the price,
 * else the fetch age plus the provider's bound, else (the vendor's age unknown) the fetch age alone. The labels say
 * "vendor's cache age unknown" for the last case; this number never pretends to know more.
 */
export function worstCaseAgeHours(a: EffectiveAge): number {
  switch (a.kind) {
    case 'observed':
      return a.observedHours;
    case 'bounded':
      return a.fetchedHours + a.maxAgeHours;
    case 'unknown':
      return a.fetchedHours;
  }
}

/**
 * The one staleness rule (spec §3, plan decisions 44, 54, 55): stale when the effective age exceeds the threshold. An
 * unknown vendor age counts the fetch age alone, so it is never stale on that account; every package that marks a price
 * stale (the api's rows and history points, WP11's alerts) calls this.
 */
export function isStale(
  p: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours'>,
  now: IsoDateTime,
  thresholdHours: number,
): boolean {
  return worstCaseAgeHours(effectiveAge(p, now)) > thresholdHours;
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

/**
 * Tooltip, header and email form, e.g. "fetched 2h ago · provider age unknown (≤7d before that)", or, when the vendor
 * gives no age at all, "fetched 2h ago · vendor's cache age unknown" (spec §3 rev 23, decision 55).
 */
export function formatAgeFull(a: EffectiveAge): string {
  const fetched = formatFetchedAgo(a);
  switch (a.kind) {
    case 'observed':
      return `${fetched} · observed ${formatAgo(a.observedHours)}`;
    case 'bounded':
      // why: maxAgeHours 0 is an interactive search at request time; there is no bound to show.
      if (a.maxAgeHours === 0) return fetched;
      return a.assumed === true
        ? `${fetched} · provider age assumed ≤${formatDuration(a.maxAgeHours)} (undocumented) before that`
        : `${fetched} · provider age unknown (≤${formatDuration(a.maxAgeHours)} before that)`;
    case 'unknown':
      return `${fetched} · vendor's cache age unknown`;
  }
}

/** Table-cell and calendar-day form, e.g. "2h ago · ≤7d". */
export function formatAgeCompact(a: EffectiveAge): string {
  const fetched = formatAgo(a.fetchedHours);
  switch (a.kind) {
    case 'observed':
      return `${fetched} · obs ${formatDuration(a.observedHours)}`;
    case 'bounded':
      if (a.maxAgeHours === 0) return fetched;
      return `${fetched} · ${a.assumed === true ? 'assumed ' : ''}≤${formatDuration(a.maxAgeHours)}`;
    case 'unknown':
      return `${fetched} · age unknown`;
  }
}

/**
 * The face form (ruling 3, decision 67): the one short line a calendar day and the phone face show without hover,
 * "5d old", "≤2d old" (fetch age plus the provider's bound, so never younger than the worst case) or "age unknown".
 * Each word stays within 7 characters so it fits a 45 px phone day column.
 */
export function formatAgeShort(a: EffectiveAge): string {
  const old = (hours: number) => (hours < 1 ? 'just now' : `${formatDuration(hours)} old`);
  switch (a.kind) {
    case 'observed':
      return old(a.observedHours);
    case 'bounded':
      // why: maxAgeHours 0 is an interactive search at request time, so the fetch age is the whole age.
      if (a.maxAgeHours === 0) return old(a.fetchedHours);
      // why: N4: an assumed bound never reads as the vendor's; "assumed ≤26h" keeps each word within 7 characters.
      return a.assumed === true
        ? `assumed ≤${formatDuration(worstCaseAgeHours(a))}`
        : `≤${old(worstCaseAgeHours(a))}`;
    case 'unknown':
      return 'age unknown';
  }
}

/** Sort comparator: fresher first; an unknown age loses to any known age; two unknowns tie. Spec §8.1. */
export function compareAges(a: EffectiveAge, b: EffectiveAge): number {
  // why: the ordering rule is about what is known, not about the number: an unknown vendor age loses to any known one
  // even when its fetch age is smaller (spec §8.1).
  if (a.kind === 'unknown' && b.kind === 'unknown') return 0;
  if (a.kind === 'unknown') return 1;
  if (b.kind === 'unknown') return -1;
  return worstCaseAgeHours(a) - worstCaseAgeHours(b);
}

/**
 * N4 (pie-007): marks a price's bound as the app's assumption when its provider's capability says the bound is assumed
 * (SearchApi's undocumented date-grid cache). Provenance is stored without the flag, so readers apply this from the
 * provider list; a bound of 0 or 'unknown' asserts nothing to qualify and is returned as is.
 */
export function withAssumedBound<P extends Pick<Provenance, 'maxAgeHours' | 'maxAgeAssumed'>>(
  p: P,
  info: { maxAgeAssumed?: boolean | undefined } | undefined,
): P {
  if (info?.maxAgeAssumed !== true || p.maxAgeHours === 'unknown' || p.maxAgeHours === 0) return p;
  return { ...p, maxAgeAssumed: true };
}
