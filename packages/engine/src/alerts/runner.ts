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
  type IsoDateTime,
  identityKey,
  isoDateTimeOfEpochMs,
  type Notifier,
  type ResultBasis,
} from '@gmt/core';
import { LogNotifier } from '../notifiers/log.js';
import type { AlertsPass } from '../types.js';
import type { AlertRunContext, AlertRunnerDeps } from './context.js';
import { cellOf, type FiringMarks, marksFor, passFacts, rowKeyOf } from './marks.js';
import { calendarPool, type Pool, rowRef, rowRefOf, verifiedPool } from './pools.js';
import { cellLine, renderBody, renderSubject } from './templates.js';

export type { AlertRunnerDeps } from './context.js';
/** Digests sent or attempted, and alert_events rows this run inserted or moved to a new status. */
export interface AlertRunResult {
  digests: number;
  events: number;
}

const NONE: AlertRunResult = { digests: 0, events: 0 };
const HOUR_MS = 3_600_000;

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
      const pool = basis === 'calendar' ? calendarPool(ctx) : verifiedPool(ctx);
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

/** An instant `hours` before `at`. */
function hoursBefore(at: IsoDateTime, hours: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(at) - hours * HOUR_MS);
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
  // why: decisions 25, 56 — a row an earlier pass of this execution notified or suppressed is never judged again; one it
  // left queued (its send failed) is judged again and sent with this digest, reusing its event row.
  const earlier = ctx.deps.repos.alerts.eventsForExecution(rule.id, ctx.executionId);
  const done = new Set<string>();
  const queued = new Map<string, number>();
  for (const e of earlier) {
    if (e.status === 'queued') queued.set(rowRefOf(e), e.id);
    else done.add(rowRefOf(e));
  }
  const candidates = pool.candidates.filter((c) => !done.has(rowRef(c)));
  if (candidates.length === 0) return NONE;
  // why: spec §6.8 suppression looks back cooldownHours over this rule's notified firings for these identities.
  const prior = ctx.deps.repos.alerts.priorFirings(
    rule.id,
    [...new Set(candidates.map((c) => identityKey(rule, c)))],
    hoursBefore(ctx.now, rule.cooldownHours),
  );
  const firings = evaluateAlertRules([rule], candidates, prior, {
    now: ctx.now,
    executionId: ctx.executionId,
    cabin: ctx.snapshot.cabin,
    discoveryRefreshHours: ctx.snapshot.providers.discoveryRefreshHours,
  });
  const marks = marksFor(ctx, firings, pool);
  // why: plan pin — evaluateAlertRules returns suppressed firings too; the runner records them and the digest omits them.
  const suppressed = firings.filter((f) => f.suppressed !== null);
  const sendable = firings.filter((f) => f.suppressed === null);
  ctx.deps.db.transaction(() => {
    for (const f of suppressed) {
      const id = queued.get(rowRef(f.candidate));
      if (id === undefined)
        ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, pool, marks, 'suppressed', null));
      else
        ctx.deps.repos.alerts.updateEvents([id], {
          status: 'suppressed',
          reason: f.suppressed?.reason ?? null,
        });
    }
  });
  // why: plan decision 10 — "new" listings alone are not a digest.
  if (!sendable.some((f) => !f.isNew)) return { digests: 0, events: suppressed.length };
  const delivered = await deliver(ctx, rule, { firings, sendable, pool, marks, queued });
  return { digests: delivered.digests, events: delivered.events + suppressed.length };
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

/** Decision 59: why an event stays queued, and whether a later pass of this execution will send it. */
function retryText(ctx: AlertRunContext): string {
  return ctx.pass.stop === 'budget'
    ? 'sent again when this run resumes'
    : 'not retried unless this run is resumed';
}

/**
 * Spec §8.1 order, decisions 56 and 59: persist the firings as `queued` events (one transaction), send the digest, then
 * move each event on:
 * - every notifier accepted and one of them is not the log → `notified`, with this send's reason, fire time and digest
 *   id (a retried row no longer reads as failed);
 * - only the log notifier exists (no SMTP configured) → `suppressed`, "email not configured", which the cooldown never
 *   counts;
 * - a notifier refused or threw (including the hourly ceiling) → still `queued`, the failure and the retry outlook in
 *   its reason.
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
    queued: ReadonlyMap<string, number>;
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
    run.sendable.map(
      (f) =>
        run.queued.get(rowRef(f.candidate)) ??
        ctx.deps.repos.alerts.insertEvent(eventRow(ctx, f, run.pool, run.marks, 'queued', digestId)),
    ),
  );
  const facts = passFacts(ctx);
  const body = renderBody({
    digest,
    definitionName: ctx.definition.name,
    appBaseUrl: ctx.deps.config.appBaseUrl,
    now: ctx.now,
    marks: run.marks,
    budgetStop: facts.budgetStop,
    verificationNotRun: facts.verificationNotRun,
    unconfirmed: run.pool.unconfirmed,
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
        reason: `${f.reason}; not delivered: ${outcome.detail}; ${retryText(ctx)}`,
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
