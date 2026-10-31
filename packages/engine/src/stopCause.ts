/**
 * Spec revision 55 §8.1 "Stop causes": the engine's one mapping from a pass's stop to the cause every status write
 * stores (`stop_cause_json`, with its sentence in `error_text`). Pure apart from the two readers a new pass seeds itself
 * with (the providers an earlier pass disabled, and the date pairs searched), which read the repositories.
 */
import {
  apiContract,
  cellKeyString,
  type Execution,
  microGbpToPence,
  nonEmpty,
  type ProviderId,
  type StopCause,
  type StopDetail,
  searchedDatePairCount,
  stopText,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import type { DisabledDetail, RunState, StopReason } from './run.js';

/** A stored word as a `STOP_DETAILS` word, or `fallback` when it is not one (never free text, §8.1). */
export function toStopDetail(word: string | null, fallback: StopDetail): StopDetail {
  return apiContract.STOP_DETAILS.find((d) => d === word) ?? fallback;
}

/**
 * Revision 55 §8.1: whether a budget stop is never resumed by a timer, a tick or boot whatever the schedule: the browser
 * worker's monthly or per-run page limit (a resume past the run's browser window reads no browser pages; its stop
 * offers Search again).
 */
export function isBrowserPageLimit(
  c: Pick<Extract<StopCause, { kind: 'budget' }>, 'scope' | 'providerId'>,
): boolean {
  return c.providerId === 'camoufox' && (c.scope === 'provider-month' || c.scope === 'provider-execution');
}

/**
 * The cause a stop stores (spec revision 55 §8.1). `scheduled` is `isScheduled` over the live definition, read at finish:
 * an unscheduled search's pause stores no `resumeAfter` (Ian's ruling 2), and neither does the browser worker's monthly
 * or per-run page limit on any search; a budget cause keeps its window's end as `resetsAt` either way. A cancel's cause
 * is its own; `all-disabled` names every disabled source of its stage with its class word, at least one.
 */
export function stopCauseOf(
  stop: StopReason,
  run: Pick<
    RunState,
    'disabledDetail' | 'disabled' | 'disabledReason' | 'searchedDatePairs' | 'flightLists'
  > & {
    snapshot: Pick<RunState['snapshot'], 'providers'>;
  },
  scheduled: boolean,
): StopCause {
  switch (stop.kind) {
    case 'sigterm':
      return { kind: 'interrupted' };
    case 'cancel':
      return stop.cause;
    case 'limiter-timeout':
      return {
        kind: 'limiter-timeout',
        providerId: stop.providerId,
        resumeAfter: scheduled ? stop.resumeAfter : null,
      };
    case 'budget': {
      const e = stop.error;
      const providerId = e.providerId ?? null;
      const units = apiContract.budgetUnitsFor(e.scope, providerId);
      const unit = e.unit === 'scrolls' && units.includes('scrolls') ? 'scrolls' : units[0];
      const pageLimit = isBrowserPageLimit({ scope: e.scope, providerId });
      return {
        kind: 'budget',
        scope: e.scope,
        providerId,
        unit,
        // why: ruling A2 — a spending cap is stated in pence; the guard counts µGBP
        cap: unit === 'pence' ? microGbpToPence(e.cap) : e.cap,
        resumeAfter: scheduled && !pageLimit ? stop.resumeAfter : null,
        resetsAt: stop.resetsAt,
        // why: the flight-list step runs after the browser worker's per-run page cap only (Review Focus 3)
        flights: e.scope === 'provider-execution' && providerId === 'camoufox' ? run.flightLists : null,
      };
    }
    case 'all-disabled': {
      const stageIds =
        stop.stage === 'discovery' ? run.snapshot.providers.discovery : run.snapshot.providers.verification;
      // why: R4 — the stage's own sources only, so a verification stop never names a discovery-only source
      const ids = new Set<ProviderId>(
        stageIds.filter((id) => run.disabled.has(id) || run.disabledDetail.has(id)),
      );
      const sources = nonEmpty([...ids].map((providerId) => ({ providerId, ...detailOf(run, providerId) })));
      // why: an all-disabled stop always has a disabled provider of its stage; a pass that somehow had none is an
      // internal fault, worded as one rather than as a source that does not exist
      if (sources === null) return { kind: 'fatal' };
      return { kind: 'sources-unavailable', stage: stop.stage, searched: run.searchedDatePairs(), sources };
    }
    case 'child-cap':
      return { kind: 'child-cap' };
    case 'fatal':
      return { kind: 'fatal' };
  }
}

function detailOf(
  run: Pick<RunState, 'disabledDetail' | 'disabledReason'>,
  providerId: ProviderId,
): DisabledDetail {
  const known = run.disabledDetail.get(providerId);
  if (known !== undefined) return known;
  const unavailable = run.disabledReason.get(providerId) === 'provider_unavailable';
  return unavailable
    ? { skip: 'provider_unavailable', detail: 'provider-unavailable', until: null }
    : { skip: 'provider_disabled', detail: 'blocked', until: null };
}

/**
 * The patch a stopping status write carries (§8.1): the cause, and its sentence as `error_text`. The sentence reads the
 * zone and the schedule only (the run mode changes a fix's command, never a sentence), so it is worded as the container
 * words it; the api words the fix from the stored cause for the install it runs on.
 */
export function stopPatch(
  cause: StopCause,
  tz: string,
  scheduled: boolean,
): { stopCause: StopCause; errorText: string } {
  return { stopCause: cause, errorText: stopText(cause, { tz, mode: 'container', scheduled }).sentence };
}

/**
 * Revision 55 §8.1: the providers an earlier pass of the execution disabled, each as a stop cause names it, read from
 * its outcome rows: an `error:blocked` row, a `skipped:provider_unavailable` row (the worker not reachable), or a
 * `skipped:provider_disabled` row with the class word of the provider's error rows (auth, quota, parse), else `blocked`.
 * So a resumed pass whose only provider stays disabled still names one source (never a vendor sentence: `last_error`
 * is never read as the detail).
 */
export function disabledDetailBefore(
  ctx: Pick<EngineContext, 'repos'>,
  executionId: string,
): Map<ProviderId, DisabledDetail> {
  const out = new Map<ProviderId, DisabledDetail>();
  const outcomes = ctx.repos.cells.outcomes(executionId);
  const errorWord = (id: ProviderId): StopDetail => {
    const words = outcomes.filter((o) => o.providerId === id && o.status === 'error').map((o) => o.reason);
    const known = words.find((w) => w === 'auth' || w === 'quota' || w === 'blocked' || w === 'parse');
    return toStopDetail(known ?? null, 'blocked');
  };
  for (const o of outcomes) {
    if (out.has(o.providerId)) continue;
    if (o.status === 'error' && o.reason === 'blocked')
      out.set(o.providerId, { skip: 'provider_disabled', detail: 'blocked', until: null });
    else if (o.status === 'skipped' && o.reason === 'provider_unavailable')
      out.set(o.providerId, { skip: 'provider_unavailable', detail: 'provider-unavailable', until: null });
    else if (o.status === 'skipped' && o.reason === 'provider_disabled')
      out.set(o.providerId, { skip: 'provider_disabled', detail: errorWord(o.providerId), until: null });
  }
  return out;
}

/**
 * Revision 55 §6.6, §8.1: the date pairs of the run's snapshot space `datePairSearched` accepts over its discovery
 * roll-ups (the stop cause's `searched`), read when a cause is built.
 */
export function searchedDatePairsOf(
  ctx: Pick<EngineContext, 'repos'>,
  exec: Pick<Execution, 'id' | 'snapshot'>,
): number {
  const rollUps = ctx.repos.cells.rollUps(exec.id);
  return searchedDatePairCount(
    exec.snapshot.resolved,
    (cell) => rollUps.get(cellKeyString(cell))?.discovery.status ?? null,
  );
}
