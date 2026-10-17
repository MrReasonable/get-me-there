/**
 * The alerts step of the execution lifecycle (spec §8.1) and the engine side of spec §6.8: gather candidates per basis
 * from the current execution (pools.ts), evaluate rules (core), persist the firings as `queued` events, build one
 * structured digest per rule (core), render it (templates.ts), send it to every notifier, then mark the events
 * `notified` (decision 56). The engine calls it when a pass completes and when it pauses for a budget cap (decision
 * 25), before the status write.
 */
import { randomUUID } from 'node:crypto';
import {
  type AlertEvent,
  type AlertEventPayload,
  type AlertRule,
  buildDigest,
  cellKeyString,
  evaluateAlertRules,
  type Firing,
  hoursSince,
  type Notifier,
  type ResultBasis,
} from '@gmt/core';
import { LogNotifier } from '../notifiers/log.js';
import type { AlertsPass } from '../types.js';
import type { AlertRunContext, AlertRunnerDeps } from './context.js';
import { cellOf, type FiringMarks, marksFor, rowKeyOf } from './marks.js';
import { calendarPool, type Pool, rowRef } from './pools.js';
import { cellLine, renderBody, renderSubject } from './templates.js';

export type { AlertRunnerDeps } from './context.js';
/** Digests sent or attempted, and alert_events rows this run inserted or moved to a new status. */
export interface AlertRunResult {
  digests: number;
  events: number;
}

const NONE: AlertRunResult = { digests: 0, events: 0 };

/**
 * Runs every enabled rule of the execution's definition once. Never rejects (spec §8.1: alerts never block completion).
 * `pass` is how the pass ended (WP7's AlertsStepHook passes it); a direct call defaults to a completed pass.
 */
export async function runAlerts(
  deps: AlertRunnerDeps,
  executionId: string,
  pass: AlertsPass = { stop: 'completed' },
): Promise<AlertRunResult> {
  try {
    const execution = deps.repos.executions.get(executionId);
    if (execution === null) throw new Error(`execution ${executionId} not found`);
    const definition = deps.repos.definitions.get(execution.definitionId);
    if (definition === null || definition.deletedAt !== null) return NONE;
    const rules = deps.repos.alerts.rules(definition.id).filter((r) => r.enabled);
    if (rules.length === 0) return NONE;
    const ctx: AlertRunContext = {
      deps,
      log: deps.log.child({ executionId, definitionId: definition.id }),
      now: deps.clock.now(),
      executionId,
      definition,
      snapshot: execution.snapshot,
      pass,
    };
    const pools = new Map<ResultBasis, Pool>();
    const poolFor = (basis: ResultBasis): Pool => {
      const cached = pools.get(basis);
      if (cached !== undefined) return cached;
      // why: the itinerary-search pool is gathered from Task 11.3 on; until then a verified rule has no candidates.
      const pool: Pool =
        basis === 'calendar' ? calendarPool(ctx) : { candidates: [], previous: new Map(), unconfirmed: 0 };
      pools.set(basis, pool);
      return pool;
    };
    let digests = 0;
    let events = 0;
    for (const rule of rules) {
      try {
        const r = await runRule(ctx, rule, poolFor(rule.basis));
        digests += r.digests;
        events += r.events;
      } catch (err) {
        // why: one broken rule must not stop the others.
        ctx.log.error(
          { ruleId: rule.id, err: err instanceof Error ? err.message : String(err) },
          'alerts: rule failed; other rules continue',
        );
      }
    }
    return { digests, events };
  } catch (err) {
    deps.log.error(
      { executionId, err: err instanceof Error ? err.message : String(err) },
      'alerts: step failed; execution still completes',
    );
    return NONE;
  }
}

/** The event row (insert form) of one firing; the payload is core's alertEventPayloadSchema shape (decision 56). */
function eventRow(
  ctx: AlertRunContext,
  f: Firing,
  pool: Pool,
  marks: ReadonlyMap<string, FiringMarks>,
  status: 'queued' | 'suppressed',
  digestId: string | null,
): Omit<AlertEvent, 'id'> {
  const c = f.candidate;
  const m = marks.get(rowKeyOf(c));
  if (m === undefined) throw new Error(`alerts: no marks for ${rowKeyOf(c)}`);
  const provenance = c.basis === 'verified' ? c.observation.provenance : c.provenance;
  const payload: AlertEventPayload = {
    digestId,
    executionId: ctx.executionId,
    pricePence: c.basis === 'verified' ? c.observation.pricePence : c.pricePence,
    provenance,
    previous: pool.previous.get(rowRef(c)) ?? null,
    isNew: f.isNew,
    route: cellLine(cellOf(c)),
    verdictClass:
      c.basis === 'calendar'
        ? 'unchecked'
        : c.verdictClass === 'verified'
          ? 'verified'
          : 'partially-verified',
    unverified: c.basis === 'verified' ? c.unverified : [],
    reason: {
      kind: f.isNew ? 'new' : f.rule.type === 'absolute' ? 'threshold' : 'drop',
      gapHours: c.previous === null ? null : hoursSince(c.previous.fetchedAt, provenance.fetchedAt),
    },
    staleThresholdHours: m.staleThresholdHours,
    truncated: m.truncated,
    notSeenInLatest: m.notSeenInLatest,
  };
  return {
    ruleId: f.rule.id,
    identityKey: f.identityKey,
    observationId: c.basis === 'verified' ? c.observation.id : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
    dedupKey: f.dedupKey,
    firedAt: ctx.now,
    status,
    reason: status === 'suppressed' ? (f.suppressed?.reason ?? null) : f.reason,
    payload,
  };
}

async function runRule(ctx: AlertRunContext, rule: AlertRule, pool: Pool): Promise<AlertRunResult> {
  // why: no prior firings and no earlier pass until Task 11.5.
  const firings = evaluateAlertRules([rule], pool.candidates, [], {
    now: ctx.now,
    executionId: ctx.executionId,
    cabin: ctx.snapshot.cabin,
    discoveryRefreshHours: ctx.snapshot.providers.discoveryRefreshHours,
  });
  const marks = marksFor(ctx, firings, pool);
  const sendable = firings.filter((f) => f.suppressed === null);
  // why: plan decision 10 — "new" listings alone are not a digest.
  if (!sendable.some((f) => !f.isNew)) return NONE;
  return deliver(ctx, rule, { firings, sendable, pool, marks });
}

/** "itinerary-searched K of N cells, E outbounds each" for this execution; null without a verification provider. */
function coverageFor(
  ctx: AlertRunContext,
): { itinerarySearched: number; selected: number; expandTop: number } | null {
  if (ctx.snapshot.providers.verification.length === 0) return null;
  const selected = ctx.deps.repos.cells.selected(ctx.executionId).length;
  const searched = new Set(
    ctx.deps.repos.cells
      .outcomes(ctx.executionId, { stage: 'verification' })
      .filter((o) => o.status === 'priced' || o.status === 'empty')
      .map((o) => cellKeyString(o)),
  );
  return { itinerarySearched: searched.size, selected, expandTop: ctx.snapshot.verification.expandTop };
}

/**
 * Spec §8.1 order, decisions 56 and 59: persist the firings as `queued` events (one transaction), send the digest, then
 * move each event on:
 * - every notifier accepted and one of them is not the log → `notified`, with this send's reason, fire time and digest
 *   id (a retried row no longer reads as failed);
 * - only the log notifier exists (no SMTP configured) → `suppressed`, "email not configured", which the cooldown never
 *   counts;
 * - a notifier refused or threw (including the hourly ceiling) → still `queued`, the failure in its reason (Task 11.5
 *   adds the retry and says in the reason whether one will come).
 * Every emailed item has an event, "new" listings included (PA-5).
 */
async function deliver(
  ctx: AlertRunContext,
  rule: AlertRule,
  run: {
    firings: Firing[];
    sendable: Firing[];
    pool: Pool;
    marks: ReadonlyMap<string, FiringMarks>;
  },
): Promise<AlertRunResult> {
  const digest = buildDigest(rule, run.firings, {
    executionId: ctx.executionId,
    definitionId: ctx.definition.id,
    coverageCaveat: coverageFor(ctx),
  });
  const first = digest?.items[0];
  if (digest === null || first === undefined) return NONE;
  const digestId = randomUUID();
  const ids = ctx.deps.db.transaction(() =>
    run.sendable.map((f) =>
      ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, run.pool, run.marks, 'queued', digestId)),
    ),
  );
  const body = renderBody({
    digest,
    definitionName: ctx.definition.name,
    appBaseUrl: ctx.deps.config.appBaseUrl,
    now: ctx.now,
  });
  const outcome = await sendToAll(ctx.deps.notifiers, {
    kind: 'digest',
    digest,
    subject: renderSubject(first, ctx.now),
    body,
  });
  const emailed = ctx.deps.notifiers.some((n) => !(n instanceof LogNotifier));
  run.sendable.forEach((f, i) => {
    const id = ids[i];
    if (id === undefined) return;
    if (outcome.status === 'failed')
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'queued',
        reason: `${f.reason}; not delivered: ${outcome.detail}`,
      });
    else if (!emailed)
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'suppressed',
        reason: `${f.reason}; email not configured`,
      });
    else
      ctx.deps.repos.alerts.updateEvents([id], {
        status: 'notified',
        reason: f.reason,
        firedAt: ctx.now,
        digestId,
      });
  });
  return { digests: 1, events: ids.length };
}

/** Sends to every notifier; `sent` only when every notifier accepted the message. */
async function sendToAll(
  notifiers: readonly Notifier[],
  msg: Parameters<Notifier['send']>[0],
): Promise<{ status: 'sent' } | { status: 'failed'; detail: string }> {
  const failures: string[] = [];
  if (notifiers.length === 0) failures.push('no notifier configured');
  for (const n of notifiers) {
    try {
      const r = await n.send(msg);
      if (!r.ok) failures.push(`${n.id}: ${r.detail ?? 'not delivered'}`);
    } catch (err) {
      failures.push(`${n.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return failures.length === 0 ? { status: 'sent' } : { status: 'failed', detail: failures.join('; ') };
}
