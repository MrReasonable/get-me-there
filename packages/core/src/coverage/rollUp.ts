import { cellKeyString } from '../types/definition.js';
import type { CellOutcome, CellOutcomeStatus, NoDataReason, RollUp, SkipReason } from '../types/execution.js';

/** Spec §6.6 row 6: skip-reason priority, lower rank wins. */
const SKIP_RANK: Record<SkipReason, number> = {
  budget: 0,
  provider_disabled: 1,
  departed: 2,
  not_selected: 3,
};
const CABIN_NOT_OFFERED: NoDataReason = 'cabin-not-offered';
/**
 * Roll-up and priced-outcome reason meaning "some price came from a truncated expansion". WP7 writes it
 * on priced outcomes and `rollUp` carries it up; exported so no writer spells it differently
 * (skip reasons are snake_case, this one is hyphenated). Priced reasons are read with `isPartialExpansion`.
 */
export const PARTIAL_EXPANSION = 'partial-expansion';
/**
 * True when a priced reason marks a truncated expansion. A priced reason is `;`-joined parts: null,
 * `partial-expansion`, `offers-dropped:n` or `partial-expansion;offers-dropped:n` (ruling 2026-10-15).
 */
export function isPartialExpansion(reason: string | null): boolean {
  return (reason ?? '').split(';').includes(PARTIAL_EXPANSION);
}

/** `reason` with `partial-expansion` added as its first part (the combined form keeps offers-dropped). */
function withPartialExpansion(reason: string | null): string {
  if (reason === null) return PARTIAL_EXPANSION;
  return isPartialExpansion(reason) ? reason : `${PARTIAL_EXPANSION};${reason}`;
}

/** Roll-up reason for an `error` cell whose error outcomes disagree on their reason (spec §6.6). */
export const MIXED_ERROR_REASON = 'mixed';

function isSkipReason(r: string | null): r is SkipReason {
  return r !== null && Object.hasOwn(SKIP_RANK, r);
}

/**
 * Roll the outcomes of one cell in one stage (one row per provider) into the cell's stage status.
 * Spec §6.6 precedence, first matching row wins:
 *
 * | 0 | no outcome rows                                      | `null` (`not_applicable` in the API) |
 * | 1 | any `priced`                                         | `priced`  |
 * | 2 | any `not_run`                                        | `not_run` |
 * | 3 | any `error`                                          | `error`   |
 * | 4 | any `empty`, every other ∈ {empty, no_data, skipped} | `empty`   |
 * | 5 | any `no_data`                                        | `no_data` |
 * | 6 | all `skipped`                                        | `skipped`, reason budget > provider_disabled > departed > not_selected |
 *
 * Before the table: `no_data` outcomes with reason `cabin-not-offered` (written at seeding, no
 * call made) are ignored whenever any other outcome exists for the cell; when every outcome is
 * one, the roll-up is `no_data` with reason `cabin-not-offered` (ruling 2026-10-14, spec §6.6).
 * why: a provider that was never asked must not make an unsearched cell look searched.
 *
 * Roll-up `reason` (ruling 2026-10-14): `priced` carries `partial-expansion` when any priced
 * input is partial (`isPartialExpansion`), else null (offers-dropped stays per outcome); `error` carries the reason when every error input agrees, else
 * `mixed`; `no_data` carries `cabin-not-offered` only in the all-not-offered case, else null;
 * `skipped` carries the highest-priority skip reason; `not_run` and `empty` carry null.
 * `minPence` is the minimum over `priced` outcomes ("the minimum over rows actually written",
 * spec §5.6), else `null`.
 *
 * Throws on a `skipped` outcome whose reason is not a `SkipReason` and on a `priced` outcome with
 * no `minPence`: both are broken invariants (spec §3) that must not be rolled up silently.
 */
export function rollUp(outcomes: CellOutcome[]): RollUp {
  if (outcomes.length === 0) return { status: null, reason: null, minPence: null };
  const asked = outcomes.filter((o) => !(o.status === 'no_data' && o.reason === CABIN_NOT_OFFERED));
  if (asked.length === 0) return { status: 'no_data', reason: CABIN_NOT_OFFERED, minPence: null };
  const of = (s: CellOutcomeStatus) => asked.filter((o) => o.status === s);

  const priced = of('priced');
  if (priced.length > 0) {
    let min = Number.POSITIVE_INFINITY;
    for (const o of priced) {
      if (o.minPence === null) {
        throw new Error('a priced outcome has no minPence (spec §3: priced means a price was written)');
      }
      min = Math.min(min, o.minPence);
    }
    const partial = priced.some((o) => isPartialExpansion(o.reason));
    return { status: 'priced', reason: partial ? PARTIAL_EXPANSION : null, minPence: min };
  }
  if (of('not_run').length > 0) return { status: 'not_run', reason: null, minPence: null };
  const errors = of('error');
  if (errors.length > 0) {
    const reasons = new Set(errors.map((o) => o.reason));
    const [only] = reasons;
    return {
      status: 'error',
      reason: reasons.size === 1 && only !== undefined ? only : MIXED_ERROR_REASON,
      minPence: null,
    };
  }
  // why: rows 1–3 have removed priced, not_run and error, so every remaining outcome is empty,
  // no_data or skipped; row 4's "every other ∈ {empty, no_data, skipped}" is therefore implied.
  if (of('empty').length > 0) return { status: 'empty', reason: null, minPence: null };
  if (of('no_data').length > 0) return { status: 'no_data', reason: null, minPence: null };
  const skipReasons: SkipReason[] = [];
  for (const o of asked) {
    if (!isSkipReason(o.reason)) throw new Error(`skipped outcome with unknown reason: ${String(o.reason)}`);
    skipReasons.push(o.reason);
  }
  const reason = skipReasons.reduce((best, r) => (SKIP_RANK[r] < SKIP_RANK[best] ? r : best));
  return { status: 'skipped', reason, minPence: null };
}

/** Spec §6.6 merge order; only statuses a fetch produces take part. */
function mergeRank(s: CellOutcomeStatus): number | null {
  switch (s) {
    case 'priced':
      return 3;
    case 'empty':
      return 2;
    case 'no_data':
      return 1;
    case 'error':
      return 0;
    default:
      return null;
  }
}

/**
 * Merge two outcomes for the same cell, stage, provider and execution. Spec §6.6: "Within one
 * provider, monotone merge `priced > empty > no_data > error`, `min_pence = min`". WP3's
 * `writeTile` calls it when a cell already has a fetched outcome (a safety net: tiles partition
 * cells). Callers pass (existing, incoming); `attempts` bookkeeping stays with the caller.
 *
 * - Fresh beats reused (spec §6.6, rev 11): when exactly one input has `reusedFromExecutionId`
 *   null, a fresh `priced`, `empty` or `no_data` input is returned whole, whatever its price.
 *   why: WP3's `writeTile` deletes the superseded reused price row in the same transaction, so
 *   keeping the reused outcome would leave a `min_pence` and `reused_from` that no stored row
 *   backs. A fresh `error` never displaces a stronger result: the reused outcome is kept whole
 *   (status, price, provenance) and the caller only counts the attempt; it replaces a reused `error`.
 * - Otherwise (both fresh or both reused), different statuses: the higher-ranked outcome wins whole.
 * - Both `priced`: the result is the input that supplies the minimum price (ties to `a`), so
 *   `minPence` and its provenance (`fetchedAt`, `sourceKind`, `pointOfSale`, `cabin`,
 *   `reusedFromExecutionId`) travel together (spec §3: `reused_from_execution_id` is always the
 *   execution that fetched the price); it keeps its own reason, with `partial-expansion` added
 *   when either input has it (`partial-expansion;offers-dropped:n` when it carries offers-dropped).
 * - Both the same non-priced status: `a` wins; the reason is the lexicographically smaller
 *   non-null reason, so the merged reason does not depend on argument order.
 *
 * Throws when the outcomes are for different cells, stages, providers or executions, when either
 * status is `not_run` or `skipped` (seeding and skipping replace outcomes; they never merge), or
 * when a `priced` outcome has no `minPence`.
 */
export function mergeWithinProvider(a: CellOutcome, b: CellOutcome): CellOutcome {
  if (
    cellKeyString(a) !== cellKeyString(b) ||
    a.stage !== b.stage ||
    a.providerId !== b.providerId ||
    a.executionId !== b.executionId
  ) {
    throw new Error('mergeWithinProvider merges outcomes of one cell, stage, provider and execution');
  }
  const ra = mergeRank(a.status);
  const rb = mergeRank(b.status);
  if (ra === null || rb === null) {
    throw new Error(`mergeWithinProvider: cannot merge ${a.status} with ${b.status}`);
  }
  for (const o of [a, b]) {
    if (o.status === 'priced' && o.minPence === null) {
      throw new Error('a priced outcome has no minPence (spec §3: priced means a price was written)');
    }
  }
  const aFresh = a.reusedFromExecutionId === null;
  if (aFresh !== (b.reusedFromExecutionId === null)) {
    const [fresh, reused] = aFresh ? [a, b] : [b, a];
    // why: a failed fetch is not evidence against a price or a "no fares" answer; it only counts an attempt.
    return fresh.status === 'error' && reused.status !== 'error' ? reused : fresh;
  }
  if (ra !== rb) return ra > rb ? a : b;
  if (a.status === 'priced') {
    const source = b.minPence !== null && a.minPence !== null && b.minPence < a.minPence ? b : a;
    // why: offers-dropped:n describes the source's own fetch and stays with it; partial-expansion is a
    // property of the cell's data and survives the merge whichever input carried it (ruling 2026-10-15).
    const partial = isPartialExpansion(a.reason) || isPartialExpansion(b.reason);
    return partial ? { ...source, reason: withPartialExpansion(source.reason) } : source;
  }
  // why: return the input that supplies the chosen reason whole, so `reason`, `lastError`, `fetchedAt`
  // and `attempts` always describe the same attempt (the sort is stable, so a tie keeps `a`).
  const named = [a, b].flatMap((o) => (o.reason === null ? [] : [{ o, r: o.reason }]));
  named.sort((x, y) => (x.r < y.r ? -1 : x.r > y.r ? 1 : 0));
  return named[0]?.o ?? a;
}
