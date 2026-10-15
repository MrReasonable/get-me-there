import { effectiveAge } from '../labels/age.js';
import { formatPence } from '../text/money.js';
import type { AlertCandidate, AlertRule, Firing, PriorFiring } from '../types/alerts.js';
import { cellKeyString } from '../types/definition.js';
import type { IsoDateTime } from '../types/ids.js';
import type { Provenance } from '../types/provenance.js';

/** Spec §6.8 (rev 11 rule): inside the cooldown a repeat needs a fall of at least £10 … */
export const MIN_REPEAT_DROP_PENCE = 1_000;
/** … and at least 5% of the last fired price, whichever is larger. */
export const MIN_REPEAT_DROP_PERCENT = 5;

/** Whole hours from `at` to `now`, clamped at 0 through core's `effectiveAge` (plan review focus 2). */
export function hoursSince(at: IsoDateTime, now: IsoDateTime): number {
  return effectiveAge({ fetchedAt: at, maxAgeHours: 'unknown' }, now).fetchedHours;
}

/** The candidate's price and provenance, whichever basis it is on. */
export function priceOf(c: AlertCandidate): { pricePence: number; provenance: Provenance } {
  return c.basis === 'verified'
    ? { pricePence: c.observation.pricePence, provenance: c.observation.provenance }
    : { pricePence: c.pricePence, provenance: c.provenance };
}

/**
 * Spec §6.8 identity, in the plan's pinned formats: verified `${ruleId}|${itineraryHash}`;
 * calendar `${ruleId}|${providerId}|${cabin}|${cellKeyString(cell)}`.
 */
export function identityKey(rule: AlertRule, c: AlertCandidate): string {
  if (c.basis === 'verified') return `${rule.id}|${c.itinerary.hash}`;
  return `${rule.id}|${c.provenance.providerId}|${c.provenance.cabin}|${cellKeyString(c.cell)}`;
}

/** Spec §6.8: `dedupKey = identity + floor(pricePence / 100)` (whole pounds). */
export function dedupKey(identityKey: string, pricePence: number): string {
  return `${identityKey}|${Math.floor(pricePence / 100)}`;
}

/** The cooldown verdict: the reason is present exactly when the firing is suppressed. */
export type Suppression = { suppressed: false; reason: null } | { suppressed: true; reason: string };

/**
 * Spec §6.8 cooldown. `prior` is this rule's *sent* firings (the engine's query excludes failed
 * and suppressed events, so a failed send is retried next run). Within `cooldownHours` before
 * `now` a firing is suppressed when a prior firing had the same dedup key, or when the same
 * identity last fired at a price this one does not undercut by at least
 * max(£10, 5% of that price). A bucket change alone no longer fires, so a fare drifting down £1
 * a day sends one alert per cooldown (review pft-004). A prior firing stamped in the future
 * reads as 0 h old.
 */
export function isSuppressed(
  f: Pick<Firing, 'identityKey' | 'dedupKey' | 'candidate'>,
  prior: PriorFiring[],
  cooldownHours: number,
  now: IsoDateTime,
): Suppression {
  const recent = prior.filter((p) => hoursSince(p.firedAt, now) < cooldownHours);
  const same = recent.find((p) => p.dedupKey === f.dedupKey);
  if (same !== undefined) {
    const age = hoursSince(same.firedAt, now);
    return { suppressed: true, reason: `same price band alerted ${age}h ago (cooldown ${cooldownHours}h)` };
  }
  const last = recent
    .filter((p) => p.identityKey === f.identityKey)
    .reduce<PriorFiring | null>(
      (latest, p) => (latest === null || p.firedAt > latest.firedAt ? p : latest),
      null,
    );
  if (last === null) return { suppressed: false, reason: null };
  const step = Math.max(MIN_REPEAT_DROP_PENCE, Math.ceil((last.pricePence * MIN_REPEAT_DROP_PERCENT) / 100));
  const price = priceOf(f.candidate).pricePence;
  if (last.pricePence - price >= step) return { suppressed: false, reason: null };
  const floor = Math.max(0, last.pricePence - step);
  return {
    suppressed: true,
    reason: `alerted at ${formatPence(last.pricePence)} ${hoursSince(last.firedAt, now)}h ago; within the ${cooldownHours}h cooldown a new alert needs ${formatPence(floor)} or less`,
  };
}
