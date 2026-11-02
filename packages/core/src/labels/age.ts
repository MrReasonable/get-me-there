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

/**
 * Spec revision 55 §8.1 "Staleness per price" (design §5.5): the calendar-basis threshold of one price, built from the
 * price's **own stored** age bound, never the currently registered provider's declared age. `override`
 * (`CALENDAR_STALE_AFTER_HOURS`) replaces it outright; otherwise it is the search's refresh for the price's provider plus
 * the stored `maxAgeHours` (0 when unknown). Because the effective age is the fetch age plus that same stored bound, a
 * bounded- or unknown-age price is stale exactly when its fetch age passes the refresh ("never stale within the
 * refresh", whichever run fetched it), while a vendor-dated price keeps its own age, so an old price the vendor dates is
 * never hidden.
 */
export function calendarStaleThreshold(
  p: Pick<Provenance, 'maxAgeHours'>,
  refreshHours: number,
  override: number | null,
): number {
  return override ?? refreshHours + (p.maxAgeHours === 'unknown' ? 0 : p.maxAgeHours);
}

/** The basis a price is judged on: an itinerary search (`verified`) or a date-grid or cache price (`calendar`). */
export type StaleBasis = 'verified' | 'calendar';

/**
 * The thresholds the stale rule reads: the search's refresh for the price's provider, the operator's
 * `CALENDAR_STALE_AFTER_HOURS` (null when unset) and `STALE_AFTER_HOURS` (the verified basis).
 */
export interface StaleThresholds {
  refreshHours: number;
  overrideHours: number | null;
  staleAfterHours: number;
}

/**
 * Spec revision 55 §3, §10 (ruling 20.6-2): the kind of threshold that judges a price: `refresh` for a calendar price
 * under the per-price rule (the search's refresh plus the price's own age bound), `setting` for one under
 * `CALENDAR_STALE_AFTER_HOURS` or on the verified basis (`STALE_AFTER_HOURS`).
 */
export const STALE_KINDS = ['refresh', 'setting'] as const;
export type StaleKind = (typeof STALE_KINDS)[number];
/** The stale mark as it travels: `false` when the price is not stale, else the kind of threshold it is older than. */
export type StaleMark = false | StaleKind;

/** The kind of threshold that judges a price on `basis` (spec rev 55 §3). */
export function staleKindOf(t: { basis: StaleBasis; override: boolean }): StaleKind {
  return t.basis === 'calendar' && !t.override ? 'refresh' : 'setting';
}

/** Spec rev 55 §3: the stale mark's words for its kind, shown only when the price is stale. */
export function staleWords(kind: StaleKind): string {
  return kind === 'refresh' ? "older than this search's refresh" : 'older than your stale setting';
}

/**
 * Spec revision 55 §8.1: the one per-price staleness rule, read by the board, the date pair detail, the search cards,
 * History, Status, the engine's alert marks and the alert email. `ageHours` is the effective age (`worstCaseAgeHours`);
 * `stale` is `isStale` against the basis's threshold (the calendar threshold above, or `staleAfterHours` alone on the
 * verified basis); `kind` is that threshold's kind and `mark` the stale mark the wire carries (`false`, or the kind);
 * `markText` is the stale mark's words (`staleMarkText`), which a caller shows only when `stale`.
 */
export function stalenessOf(
  row: {
    provenance: Pick<Provenance, 'fetchedAt' | 'providerObservedAt' | 'maxAgeHours' | 'maxAgeAssumed'>;
    basis: StaleBasis;
  },
  t: StaleThresholds,
  now: IsoDateTime,
): { ageHours: number; stale: boolean; kind: StaleKind; mark: StaleMark; markText: string } {
  const p = row.provenance;
  const calendar = row.basis === 'calendar';
  const threshold = calendar ? calendarStaleThreshold(p, t.refreshHours, t.overrideHours) : t.staleAfterHours;
  const stale = isStale(p, now, threshold);
  const kind = staleKindOf({ basis: row.basis, override: calendar && t.overrideHours !== null });
  return {
    ageHours: worstCaseAgeHours(effectiveAge(p, now)),
    stale,
    kind,
    mark: stale ? kind : false,
    markText: staleWords(kind),
  };
}

/**
 * Spec revision 55 §3: the stale mark's words. A calendar price under the per-price rule is "older than this search's
 * refresh"; under `CALENDAR_STALE_AFTER_HOURS`, or on the verified basis (`STALE_AFTER_HOURS`), "older than your stale
 * setting".
 */
export function staleMarkText(t: { basis: StaleBasis; override: boolean }): string {
  return staleWords(staleKindOf(t));
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
 * provider list; a bound of 0 or 'unknown' asserts nothing to qualify and is returned as is. A row read from a date grid
 * cell (camoufox grid mode) or a SearchApi calendar price is assumed from its own facts, whatever the provider runs as
 * now, or when it is off (fix round 1, PA I2; fix round 2).
 */
export function withAssumedBound<
  P extends Pick<Provenance, 'maxAgeHours' | 'maxAgeAssumed'> & {
    returnDateSource?: Provenance['returnDateSource'];
    providerId?: Provenance['providerId'];
    sourceKind?: Provenance['sourceKind'];
  },
>(p: P, info: { maxAgeAssumed?: boolean | undefined } | undefined): P {
  if (p.maxAgeHours === 'unknown' || p.maxAgeHours === 0) return p;
  if (!assumedByRow(p) && info?.maxAgeAssumed !== true) return p;
  return { ...p, maxAgeAssumed: true };
}

/**
 * The rows whose own facts say their bound is the app's assumption, whatever the provider list holds now: a date grid
 * cell (camoufox grid mode) and a SearchApi date-grid calendar price (fix round 2).
 */
function assumedByRow(p: {
  returnDateSource?: Provenance['returnDateSource'];
  providerId?: Provenance['providerId'];
  sourceKind?: Provenance['sourceKind'];
}): boolean {
  return (
    p.returnDateSource === 'grid-cell' ||
    (p.providerId === 'searchapi' && p.sourceKind === 'scraped-aggregate')
  );
}
