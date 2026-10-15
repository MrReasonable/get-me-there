import { formatPence } from '../text/money.js';
import type { AlertCandidate, AlertRule, Firing, PriorFiring } from '../types/alerts.js';
import type { IsoDateTime } from '../types/ids.js';
import type { Cabin, ProviderId } from '../types/provenance.js';
import { dedupKey, hoursSince, identityKey, isSuppressed, priceOf, type Suppression, span } from './dedup.js';

/**
 * Spec §7: `discoveryRefreshHours` defaults to 168 per provider when the definition omits it. The one
 * owner of the default: the engine imports it from `@gmt/core` for its reuse cutoff.
 */
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;

/** Per-run context for `evaluateAlertRules` (the plan's inline ctx type, named). */
export interface AlertEvalContext {
  now: IsoDateTime;
  executionId: string;
  cabin: Cabin;
  discoveryRefreshHours: Partial<Record<ProviderId, number>>;
}

/** A rule field zod guarantees for this rule type; a missing one is a caller bug, never "0". */
export function need(n: number | null, field: string, rule: AlertRule): number {
  if (n === null) throw new RangeError(`alert rule ${rule.id} (${rule.type}) has no ${field}`);
  return n;
}

function eligible(rule: AlertRule, c: AlertCandidate, ctx: AlertEvalContext): boolean {
  const { provenance } = priceOf(c);
  // why: synthetic rows are refused by alerts outright (spec §5.5, §6.8).
  if (provenance.sourceKind === 'synthetic') return false;
  if (c.basis !== rule.basis || provenance.cabin !== ctx.cabin) return false;
  // why: spec §6.8 alerts only on prices fetched by this execution. A reused calendar row carries
  // the id of the execution that fetched it, so it is refused here too (review prov-005).
  if (c.basis === 'calendar') return c.fetchedByExecutionId === ctx.executionId;
  if (c.observation.executionId !== ctx.executionId) return false;
  return (
    c.verdictClass === 'verified' ||
    (c.verdictClass === 'partially-verified' && rule.requireAllVerified === false)
  );
}

type Judged = { reason: string; isNew: boolean } | null;

function judge(rule: AlertRule, c: AlertCandidate, ctx: AlertEvalContext): Judged {
  const { pricePence, provenance } = priceOf(c);
  if (rule.type === 'absolute') {
    const threshold = need(rule.thresholdPence, 'thresholdPence', rule);
    if (pricePence > threshold) return null;
    return {
      reason: `${formatPence(pricePence)} is at or below the ${formatPence(threshold)} threshold`,
      isNew: false,
    };
  }
  const prev = c.previous;
  if (prev === null) {
    // why: only calendar cells have a "new" section (spec §6.8); a verified offer without a
    // previous observation simply cannot drop.
    return c.basis === 'calendar' ? { reason: 'first price seen for this cell', isNew: true } : null;
  }
  const gap = hoursSince(prev.fetchedAt, provenance.fetchedAt);
  if (c.basis === 'calendar') {
    // why (sparse-cache rule, spec §6.8): a calendar price compares only with a previous price for
    // the same provider, cabin and cell fetched within 2 × discoveryRefreshHours of this one
    // (inclusive, whole minutes). Verified drops have no window (spec), but every drop reason
    // states the previous price's age, so an old comparison reads as old (review pft-003).
    const window = 2 * (ctx.discoveryRefreshHours[provenance.providerId] ?? DEFAULT_DISCOVERY_REFRESH_HOURS);
    // why: the comparison is in whole minutes, not the rounded-down hours of the reason text, so a
    // price 336 h 30 min older is outside a 336 h window (spec §6.8: "within 2 × refresh").
    const gapMinutes = Math.floor((Date.parse(provenance.fetchedAt) - Date.parse(prev.fetchedAt)) / 60_000);
    if (gapMinutes > window * 60) {
      return {
        reason: `last price ${formatPence(prev.pricePence)} was fetched ${span(gap)} earlier, outside the ${span(window)} comparison window; not compared`,
        isNew: true,
      };
    }
  }
  const drop = prev.pricePence - pricePence;
  if (drop <= 0) return null;
  const fires =
    rule.type === 'dropAbs'
      ? drop >= need(rule.thresholdPence, 'thresholdPence', rule)
      : drop * 100 >= need(rule.pct, 'pct', rule) * prev.pricePence;
  if (!fires) return null;
  const pct = Math.floor((drop * 100) / prev.pricePence);
  return {
    reason: `down ${formatPence(drop)} (${pct}%) from ${formatPence(prev.pricePence)} fetched ${span(gap)} earlier`,
    isNew: false,
  };
}

/**
 * Spec §6.8: evaluate every enabled rule against the current execution's candidates. Each
 * identity is settled on its cheapest eligible candidate *before* judging, so a dearer offer of
 * the same itinerary never fires while a cheaper one exists (review prov-006). Each firing
 * carries `suppressed`: the cooldown verdict against `prior` (this rule set's sent firings), or
 * null. Suppressed firings are returned so the runner can record them; `buildDigest` leaves them
 * out. "New" calendar cells (`isNew`) are never suppressed. Output: rule order, then price.
 */
export function evaluateAlertRules(
  rules: AlertRule[],
  candidates: AlertCandidate[],
  prior: PriorFiring[],
  ctx: AlertEvalContext,
): Firing[] {
  const out: Firing[] = [];
  const byPrice = [...candidates].sort((a, b) => priceOf(a).pricePence - priceOf(b).pricePence);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const seen = new Set<string>();
    for (const c of byPrice) {
      if (!eligible(rule, c, ctx)) continue;
      const id = identityKey(rule, c);
      if (seen.has(id)) continue;
      seen.add(id);
      const j = judge(rule, c, ctx);
      if (j === null) continue;
      const key = dedupKey(id, priceOf(c).pricePence);
      const verdict: Suppression = j.isNew
        ? { suppressed: false, reason: null }
        : isSuppressed({ identityKey: id, dedupKey: key, candidate: c }, prior, rule.cooldownHours, ctx.now);
      out.push({
        rule,
        candidate: c,
        identityKey: id,
        dedupKey: key,
        ...j,
        suppressed: verdict.suppressed ? { reason: verdict.reason } : null,
      });
    }
  }
  return out;
}
