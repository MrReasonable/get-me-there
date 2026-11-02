/**
 * What the runner reads about each firing that core's DigestItem does not carry (spec §3, §8.1; decisions 25, 30, 54,
 * 55, 56): the stale threshold and verdict, "cheapest of the rows read", "not seen in latest search", and the run's
 * budget-stop facts.
 */
import {
  type AlertCandidate,
  type Cell,
  calendarStaleThreshold,
  cellKeyString,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type Firing,
  isTruncated,
  type ProviderId,
  resultRowKey,
  type StaleThresholds,
  stalenessOf,
  type VerifiedCandidate,
} from '@gmt/core';
import type { AlertRunContext } from './context.js';
import { type Pool, rowRef } from './pools.js';
import type { ItemMarks } from './templates.js';

/** The marks of one firing plus the threshold its staleness was judged against (stored on the event, decision 56). */
export interface FiringMarks extends ItemMarks {
  staleThresholdHours: number;
}

/** The cell a candidate prices. */
export function cellOf(c: AlertCandidate): Cell {
  if (c.basis === 'calendar') return c.cell;
  const it = c.itinerary;
  return {
    origin: it.origin,
    destination: it.destination,
    departureDate: it.departureDate,
    returnDate: it.returnDate,
    nights: it.nights,
  };
}

/** The DigestItem rowKey core gives a candidate (resultRowKey): the itinerary hash, or `calendar:<id>`. */
export function rowKeyOf(c: AlertCandidate): string {
  return resultRowKey({
    itineraryHash: c.basis === 'verified' ? c.itinerary.hash : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
  });
}

/**
 * The thresholds the per-price stale rule reads for a candidate (spec revision 55 §8.1): the definition's refresh for the
 * price's provider, CALENDAR_STALE_AFTER_HOURS (null when unset) and STALE_AFTER_HOURS. Never the registered provider's
 * declared age: core's `stalenessOf` uses the price's own stored age.
 */
function thresholdsOf(ctx: AlertRunContext, c: AlertCandidate): StaleThresholds {
  const id: ProviderId =
    c.basis === 'verified' ? c.observation.provenance.providerId : c.provenance.providerId;
  return {
    refreshHours: ctx.snapshot.providers.discoveryRefreshHours[id] ?? DEFAULT_DISCOVERY_REFRESH_HOURS,
    overrideHours: ctx.deps.config.calendarStaleAfterHours,
    staleAfterHours: ctx.deps.config.staleAfterHours,
  };
}

/**
 * Spec §8.1 "not seen in latest search" (decision 54): the cell's newest priced|empty itinerary search is another
 * execution's (a child that verified the cell during this run) and that search has no observation of this offer.
 * `at` is that search's fetch instant, or null when the outcome records none (no age is invented, PA-6).
 * why: "superseded by a later search" cannot arise here — calendar candidates are this execution's own fetches, only
 * one parent runs per definition, children never discover, and the step runs before this execution's status is
 * written, so no newer discovery of the cell exists yet.
 */
function notSeenMark(
  ctx: AlertRunContext,
  c: VerifiedCandidate,
  offersOf: (executionId: string) => ReadonlySet<number>,
): ItemMarks['notSeenInLatest'] {
  const latest = ctx.deps.repos.itineraries.latestVerificationOutcomeForCell(
    ctx.definition.id,
    cellOf(c),
    ctx.snapshot.cabin,
  );
  if (latest === null || latest.executionId === ctx.executionId) return null;
  if (offersOf(latest.executionId).has(c.observation.offerId)) return null;
  return { at: latest.fetchedAt };
}

/** Marks for every firing, keyed by rowKeyOf: the digest renders them and every event row stores them. */
export function marksFor(
  ctx: AlertRunContext,
  firings: readonly Firing[],
  pool: Pool,
): Map<string, FiringMarks> {
  const truncated = new Set(
    ctx.deps.repos.cells
      .outcomes(ctx.executionId, { stage: 'discovery' })
      .filter((o) => isTruncated(o.lastError))
      .map((o) => `${o.providerId}|${cellKeyString(o)}`),
  );
  // why: one read of another execution's observations, however many firings share its cells (arch-wp11-013)
  const offers = new Map<string, ReadonlySet<number>>();
  const offersOf = (executionId: string): ReadonlySet<number> => {
    const known = offers.get(executionId);
    if (known !== undefined) return known;
    const ids = new Set(ctx.deps.repos.itineraries.writtenBy(executionId).map((o) => o.offerId));
    offers.set(executionId, ids);
    return ids;
  };
  const out = new Map<string, FiringMarks>();
  for (const { candidate: c } of firings) {
    const p = c.basis === 'verified' ? c.observation.provenance : c.provenance;
    const t = thresholdsOf(ctx, c);
    // why: the threshold stored on the event (decision 56) is the one core's rule judged against
    const threshold =
      c.basis === 'verified' ? t.staleAfterHours : calendarStaleThreshold(p, t.refreshHours, t.overrideHours);
    out.set(rowKeyOf(c), {
      staleThresholdHours: threshold,
      // why: revision 55 §8.1 — the one per-price rule, core's stalenessOf, as the board and History read it
      stale: stalenessOf({ provenance: p, basis: c.basis }, t, ctx.now).stale
        ? { thresholdHours: threshold }
        : null,
      truncated:
        c.basis === 'calendar' && truncated.has(`${c.provenance.providerId}|${cellKeyString(c.cell)}`),
      notSeenInLatest: c.basis === 'verified' ? notSeenMark(ctx, c, offersOf) : null,
      // why: decision 59 — DigestItem carries the previous price but not its provenance, so its '≈' travels here
      previousConverted: pool.previous.get(rowRef(c))?.provenance.fx.converted === true,
    });
  }
  return out;
}

/**
 * What the digest says about the pass (decision 59): whether the itinerary-search stage never ran although a
 * verification provider is configured (any cause: no outcome rows), and — only when the pass stopped on a budget cap
 * (decision 25) — how many cell searches the cap left undone (not_run or skipped:budget). When the stage never ran
 * the count is a lower bound: the unplanned stage's searches are not in it (review PA-2).
 */
export function passFacts(ctx: AlertRunContext): {
  budgetStop: { unsearched: number } | null;
  verificationNotRun: boolean;
} {
  const verificationNotRun =
    ctx.snapshot.providers.verification.length > 0 &&
    !ctx.deps.repos.cells.hasVerificationOutcomes(ctx.executionId);
  if (ctx.pass.stop !== 'budget') return { budgetStop: null, verificationNotRun };
  const unsearched = ctx.deps.repos.cells
    .outcomes(ctx.executionId)
    .filter((o) => o.status === 'not_run' || (o.status === 'skipped' && o.reason === 'budget')).length;
  return { budgetStop: { unsearched }, verificationNotRun };
}
