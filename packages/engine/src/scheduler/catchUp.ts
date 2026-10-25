import {
  type Execution,
  formatInstant,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  PAUSED_STATUSES,
  type ProviderId,
  type SearchDefinition,
  SKIP_CODE_TEXT,
  type SkipCode,
} from '@gmt/core';
import type { EngineContext } from '../context.js';
import { errorText } from '../errors.js';
import type { Orchestrator } from '../orchestrator.js';
import { buildSnapshot, sellsCabin, snapshotProviders } from '../snapshot.js';
import { recordSkipped } from '../start.js';
import type { StartResult } from '../types.js';
import { loadsBrowserPages } from './browserWindow.js';
import { parseCron } from './parseCron.js';

/**
 * Spec §8.2 rev 36: a firing is missed only once it is more than 2 minutes old, so a punctual live tick inserts its own
 * row first; the live tick hands a firing older than this to the catch-up decision instead of starting it.
 */
export const CATCH_UP_GRACE_MS = 2 * 60_000;

/**
 * Whether a firing is past the grace at `now` (epoch milliseconds): more than CATCH_UP_GRACE_MS old. The live tick hands
 * such a firing to the catch-up and the catch-up only takes such a firing, so the one predicate keeps the two sides of
 * the boundary from drifting: a firing exactly 2:00.000 old still belongs to the live tick.
 */
export function pastGrace(firingMs: number, nowMs: number): boolean {
  return nowMs - firingMs > CATCH_UP_GRACE_MS;
}

/** The system job that looks for a missed firing every minute while the app is up (decision 79). */
export const CATCH_UP_CRON = '* * * * *';

/**
 * What `findMissedFiring` decided for a definition's latest firing more than CATCH_UP_GRACE_MS old (decision 79):
 * nothing to do, one catch-up run, or a `skipped_missed` row with the reason it was not caught up.
 */
export type MissedFiring =
  | { kind: 'none' }
  | { kind: 'catch-up'; firing: IsoDateTime }
  | { kind: 'skip'; firing: IsoDateTime; reason: 'half-cadence' | 'scheduled-only' };

/** The stored `skip_code` of each skip reason (spec §8.2: the code is written with the row). */
export const SKIP_CODE_OF: Readonly<Record<Extract<MissedFiring, { kind: 'skip' }>['reason'], SkipCode>> = {
  'half-cadence': 'half-cadence',
  'scheduled-only': 'browser-only-definition',
};

/** The snapshot a scheduled run would store, written with a skip row (spec §8.2: some providers are left out of it). */
const scheduledSnapshot = (ctx: EngineContext, def: SearchDefinition) =>
  buildSnapshot(ctx, def, 'schedule').snapshot;

/**
 * Spec §8.2 cadence rule: an uncovered firing is not caught up when the next firing is nearer than half its own gap,
 * `(next − now) < (next − firing) / 2`, where the gap is the next expected firing minus the missed one (both croner's),
 * so irregular schedules use their own gap. Instants in epoch milliseconds; exactly half catches up.
 */
export function halfCadenceSkip(firing: number, next: number, now: number): boolean {
  return 2 * (next - now) < next - firing;
}

/**
 * Spec §8.2 rev 36 (decision 79), shared by the boot, the minute job, a late live tick and an automatic resume of a
 * paused catch-up (`autoResumeYields`). For a scheduled definition it takes the latest expected firing more than
 * CATCH_UP_GRACE_MS old, however old, and returns `none` when it is covered: the definition changed at or after it (the
 * schedule may not have existed then), a parent row already carries it, any parent execution (manual and catch-up
 * included) was active at that instant or was created after it, except a catch-up that was paused at it
 * (ExecutionsRepo.coversFiring: a catch-up still in flight at a later firing covers it, so an overrunning catch-up never
 * leads to a second one), or no configured provider that sells the definition's cabin could run it on a schedule (then
 * nothing is written or sent). `replaced` is a run the caller (a late live tick) has just
 * superseded for this firing: it was replaced, so it does not cover the firing. Otherwise the firing is judged against
 * the catch-up's own provider set, which loads no browser page: discovery by the browser provider alone (among the
 * providers that sell the cabin) is a `scheduled-only` skip; a next firing nearer than half the gap is a
 * `half-cadence` skip; else one catch-up. Reads only; makes no network call.
 */
export function findMissedFiring(
  ctx: EngineContext,
  def: SearchDefinition,
  now: IsoDateTime,
  replaced: string | null = null,
): MissedFiring {
  if (def.scheduleCron === null || !def.enabled || def.deletedAt !== null) return { kind: 'none' };
  const parsed = parseCron(def.scheduleCron, def.scheduleTz);
  if (!parsed.ok) return { kind: 'none' };
  const nowMs = Date.parse(now);
  // why: the latest firing strictly before now's second, and when it is inside the grace (it belongs to the live tick)
  // the one before it; a firing in now's own second is inside the grace too, and schedules fire at most hourly (spec
  // §8.2 "sub-hourly rejected"), so one step back always leaves the grace
  let prev = parsed.previous(new Date(nowMs));
  if (prev !== null && !pastGrace(prev.getTime(), nowMs)) prev = parsed.previous(prev);
  if (prev === null) return { kind: 'none' };
  const firing = isoDateTimeOfEpochMs(prev.getTime());
  if (def.updatedAt >= firing) return { kind: 'none' };
  if (ctx.repos.executions.coversFiring(def.id, firing, replaced)) return { kind: 'none' };
  // why: a provider that does not sell the cabin cannot run the definition (spec §8.2 "could run the definition on a
  // schedule"; seeding marks its cells no_data:cabin-not-offered), so it neither makes a catch-up worth starting nor
  // stops a browser-only definition being recorded as one
  const sells = (id: ProviderId) => sellsCabin(ctx, id, def.cabin);
  const providers = snapshotProviders(ctx, def, 'schedule');
  const discovery = providers.discovery.filter(sells);
  const verification = providers.verification.filter(sells);
  if (discovery.length + verification.length === 0) return { kind: 'none' };
  // why: a catch-up loads no browser page, so with only the browser provider to discover it would search nothing (or
  // run verification over cells no discovery priced); it is recorded once instead, never retried each minute
  if (discovery.length > 0 && discovery.every(loadsBrowserPages))
    return { kind: 'skip', firing, reason: 'scheduled-only' };
  const next = parsed.next(prev);
  if (next !== null && halfCadenceSkip(prev.getTime(), next.getTime(), nowMs))
    return { kind: 'skip', firing, reason: 'half-cadence' };
  return { kind: 'catch-up', firing };
}

/**
 * Acts on `findMissedFiring`: records the skip (through the firing index, so it is written and notified once) or
 * starts the one catch-up through the normal pre-start checks and caps, with `scheduled_for` the missed firing and
 * `is_catch_up` set. A refusal the start meets (a cap, a confirmation, the window) is that firing's `skipped_*` row,
 * written by the start itself; a loser of a race gets `firing-taken` and records nothing.
 */
export async function catchUpDefinition(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'start'>,
  def: SearchDefinition,
  now: IsoDateTime,
  replaced: string | null = null,
): Promise<MissedFiring> {
  const found = findMissedFiring(ctx, def, now, replaced);
  const log = ctx.log.child({ definitionId: def.id });
  if (found.kind === 'skip') {
    const code = SKIP_CODE_OF[found.reason];
    const r = await recordSkipped(
      ctx,
      def,
      scheduledSnapshot(ctx, def),
      null,
      'skipped_missed',
      `The run scheduled for ${formatInstant(found.firing, def.scheduleTz)} was not caught up: ${SKIP_CODE_TEXT[code]}.`,
      { scheduledFor: found.firing, skipCode: code },
    );
    log.info({ firing: found.firing, skipCode: code, recorded: r.recorded }, 'catch-up: firing skipped');
  } else if (found.kind === 'catch-up') {
    const r = await orch.start(def.id, { trigger: 'schedule', scheduledFor: found.firing, isCatchUp: true });
    log.info(
      { firing: found.firing, result: r.ok ? 'started' : r.code, executionId: r.ok ? r.executionId : null },
      'catch-up: missed firing',
    );
  }
  return found;
}

/**
 * Spec §8.2 rev 36 (decision 79, review S1): before an automatic resume (the one-shot at resume_after, the boot's
 * auto-resume) of a paused catch-up, a firing of its definition since the catch-up stopped running (`pausedAt` at or
 * before it) is that firing's to decide, so a catch-up paused at a firing is never resumed into covering it:
 * - past the grace: the firing's rule runs first (`catchUpDefinition`, whose start or skip supersedes the catch-up), and
 *   the resume goes ahead only if the catch-up is still paused afterwards (`resume`), else `yielded`;
 * - inside the grace (the live tick's): the resume waits, re-registered just past the grace (`deferred`), where the
 *   first case applies. So the outcome is the same whichever timer fires first after a wake.
 * Any other run, a catch-up with no later firing, or one whose firing the catch-up rule leaves alone (the definition
 * disabled, deleted or changed since), resumes as it would (`resume`). A manual resume never asks.
 */
export async function autoResumeYields(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'start'>,
  exec: Execution,
): Promise<'resume' | 'yielded' | 'deferred'> {
  if (!exec.isCatchUp || exec.pausedAt === null) return 'resume';
  const def = ctx.repos.definitions.get(exec.definitionId);
  // why: a disabled or deleted definition goes on to findMissedFiring, which answers `none` for it, so it resumes too
  if (def === null || def.scheduleCron === null) return 'resume';
  const parsed = parseCron(def.scheduleCron, def.scheduleTz);
  if (!parsed.ok) return 'resume';
  const now = ctx.clock.now();
  const nowMs = Date.parse(now);
  const latest = parsed.previous(new Date(nowMs));
  if (latest === null || latest.getTime() < Date.parse(exec.pausedAt)) return 'resume';
  const log = ctx.log.child({ definitionId: def.id, executionId: exec.id });
  const firing = isoDateTimeOfEpochMs(latest.getTime());
  if (!pastGrace(latest.getTime(), nowMs)) {
    const at = isoDateTimeOfEpochMs(latest.getTime() + CATCH_UP_GRACE_MS + 1_000);
    ctx.hooks.scheduleResume(exec.id, def.id, at);
    log.info({ firing, at }, 'catch-up: resume waits for the firing after it');
    return 'deferred';
  }
  // why: review T5 — a throw in the firing's rule is logged and leaves the catch-up as it was, so it resumes
  await catchUpIsolated(ctx, orch, def, now);
  // why: review T12 — the rule may have awaited a notice past the shutdown's wait; the database is then not read again
  if (ctx.lifecycle.closed) return 'yielded';
  const after = ctx.repos.executions.get(exec.id);
  const still = after !== null && PAUSED_STATUSES.includes(after.status);
  log.info({ firing, resumes: still }, 'catch-up: a later firing decided first');
  return still ? 'resume' : 'yielded';
}

/**
 * The automatic resume of a paused or interrupted run, as the resume_after one-shot and the boot's auto-resume make it
 * (spec §8.1, §8.2 rev 36; review T1): a paused catch-up first yields to a firing since it paused (`autoResumeYields`),
 * then the run resumes through the compare-and-set. A throw while deciding is logged with the run and the resume goes
 * ahead as it would have (review T5). Once the engine is closing nothing is read or started (review T12). Null when it
 * did not resume (yielded, deferred, or closing); else the resume's result.
 */
export async function autoResume(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'start' | 'resume'>,
  exec: Execution,
): Promise<StartResult | null> {
  if (ctx.lifecycle.closing) return null;
  let decision: Awaited<ReturnType<typeof autoResumeYields>>;
  try {
    decision = await autoResumeYields(ctx, orch, exec);
  } catch (err) {
    ctx.log
      .child({ executionId: exec.id, definitionId: exec.definitionId })
      .error({ err: errorText(err) }, 'catch-up: resume check failed; resuming');
    decision = 'resume';
  }
  if (decision !== 'resume' || ctx.lifecycle.closing) return null;
  return orch.resume(exec.id, { manual: false });
}

/**
 * One definition's catch-up, isolated: a throw is logged with the definition and swallowed, so one definition whose start
 * fails can never stop the others' catch-up, every minute, or the boot.
 */
export async function catchUpIsolated(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'start'>,
  def: SearchDefinition,
  now: IsoDateTime,
): Promise<void> {
  try {
    await catchUpDefinition(ctx, orch, def, now);
  } catch (err) {
    ctx.log.error({ definitionId: def.id, err: errorText(err) }, 'catch-up: definition failed');
  }
}

/**
 * The minute job (decision 79): every scheduled definition's missed firing, if any (`findMissedFiring` answers `none`
 * for an unscheduled, disabled or deleted one), each isolated from the others. Once the engine is shutting down it
 * takes no further definition. Makes no network call itself.
 */
export async function catchUpAll(ctx: EngineContext, orch: Pick<Orchestrator, 'start'>): Promise<void> {
  const now = ctx.clock.now();
  for (const def of ctx.repos.definitions.list()) {
    if (ctx.lifecycle.closing) return;
    await catchUpIsolated(ctx, orch, def, now);
  }
}
