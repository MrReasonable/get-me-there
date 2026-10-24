import { type IsoDateTime, isoDateTimeOfEpochMs, type Logger, type SearchDefinition } from '@gmt/core';
import { Cron } from 'croner';
import { errorText } from '../errors.js';
import type { SchedulerJob } from '../types.js';
import { parseCron } from './parseCron.js';

/** The system jobs: the daily FX refresh and maintenance, and the minute catch-up job (decision 79). */
export type SystemJob = 'fx-refresh' | 'maintenance' | 'catch-up';
export interface SchedulerHooks {
  onTick(definitionId: string): Promise<void>;
  onResumeDue(executionId: string): Promise<void>;
  onSystem(name: SystemJob): Promise<void>;
}
export interface Scheduler {
  /** (Re)registers a definition's cron job; removes it when disabled, deleted or unscheduled (spec §8.2). */
  register(def: SearchDefinition): void;
  unregister(definitionId: string): void;
  /** One-shot job at resume_after (spec §8.1); replaces any earlier one for the execution. */
  registerResume(executionId: string, definitionId: string, at: IsoDateTime): void;
  cancelResume(executionId: string): void;
  registerSystem(name: SystemJob, cron: string, tz: string): void;
  /** A one-shot system job (the FX refresh after boot); not listed by jobs(). */
  runSystemSoon(name: SystemJob, delayMs: number): void;
  jobs(): SchedulerJob[];
  definitionJobCount(): number;
  stopAll(): void;
  /**
   * Waits for the job callbacks already running (a tick, a one-shot resume, the minute catch-up) to finish, at most
   * `boundMs`; true when they all finished. The engine's shutdown calls it after stopAll and before it stops the runs.
   */
  drain(boundMs: number): Promise<boolean>;
}

const instant = (d: Date | null): IsoDateTime | null =>
  d === null ? null : isoDateTimeOfEpochMs(d.getTime());

/**
 * The croner scheduler (spec §8.2). Jobs call back into the engine through `hooks`; a rejected hook is logged and the
 * job keeps its schedule. `protect: true` stops a slow tick overlapping the next one. Time is croner's (the process
 * clock), which is what a schedule means; tests fake it (vi.useFakeTimers + setSystemTime).
 */
export function createScheduler(hooks: SchedulerHooks, log: Logger): Scheduler {
  const defs = new Map<string, { job: Cron; cron: string; tz: string }>();
  const resumes = new Map<
    string,
    { definitionId: string; at: IsoDateTime; job: Cron | null; timer: ReturnType<typeof setTimeout> | null }
  >();
  const systems = new Map<SystemJob, Cron>();
  const soon = new Set<ReturnType<typeof setTimeout>>();
  // why: croner's stop() ends future firings but not a callback already running, so each one is kept until it settles
  // and the shutdown can wait for it before the database closes
  const inFlight = new Set<Promise<void>>();
  const fire = (job: string, fn: () => Promise<void>): void => {
    const p = fn()
      .catch((err: unknown) => log.error({ job, err: errorText(err) }, 'scheduler: job failed'))
      .finally(() => inFlight.delete(p));
    inFlight.add(p);
  };
  const onCronError = (job: string) => (err: unknown) =>
    log.error({ job, err: errorText(err) }, 'scheduler: job failed');

  const unregister = (definitionId: string): void => {
    defs.get(definitionId)?.job.stop();
    defs.delete(definitionId);
  };
  const cancelResume = (executionId: string): void => {
    const r = resumes.get(executionId);
    if (r === undefined) return;
    r.job?.stop();
    if (r.timer !== null) clearTimeout(r.timer);
    resumes.delete(executionId);
  };

  return {
    register(def) {
      unregister(def.id);
      if (!def.enabled || def.deletedAt !== null || def.scheduleCron === null) return;
      const p = parseCron(def.scheduleCron, def.scheduleTz);
      if (!p.ok) {
        log.warn({ definitionId: def.id, reason: p.reason }, 'scheduler: invalid schedule not registered');
        return;
      }
      const name = `definition:${def.id}`;
      const job = new Cron(
        def.scheduleCron,
        { timezone: def.scheduleTz, mode: '5-part', protect: true, catch: onCronError(name) },
        () => fire(name, () => hooks.onTick(def.id)),
      );
      defs.set(def.id, { job, cron: def.scheduleCron, tz: def.scheduleTz });
      log.info({ definitionId: def.id, nextRun: instant(job.nextRun()) }, 'scheduler: registered');
    },
    unregister,
    registerResume(executionId, definitionId, at) {
      cancelResume(executionId);
      const name = `resume:${executionId}`;
      const due = () => {
        resumes.delete(executionId);
        fire(name, () => hooks.onResumeDue(executionId));
      };
      if (Date.parse(at) <= Date.now()) {
        // why: a resume_after already passed (e.g. found at boot) is due now; croner will not fire a past Date
        resumes.set(executionId, { definitionId, at, job: null, timer: setTimeout(due, 0) });
        return;
      }
      resumes.set(executionId, {
        definitionId,
        at,
        job: new Cron(new Date(at), { maxRuns: 1, catch: onCronError(name) }, due),
        timer: null,
      });
    },
    cancelResume,
    registerSystem(name, cron, tz) {
      systems.get(name)?.stop();
      systems.set(
        name,
        new Cron(
          cron,
          { timezone: tz, mode: '5-part', protect: true, catch: onCronError(`system:${name}`) },
          () => fire(`system:${name}`, () => hooks.onSystem(name)),
        ),
      );
    },
    runSystemSoon(name, delayMs) {
      const timer = setTimeout(() => {
        soon.delete(timer);
        fire(`system:${name}`, () => hooks.onSystem(name));
      }, delayMs);
      soon.add(timer);
    },
    jobs() {
      const out: SchedulerJob[] = [];
      for (const [id, d] of defs)
        out.push({
          id: `definition:${id}`,
          kind: 'definition',
          definitionId: id,
          executionId: null,
          cron: d.cron,
          tz: d.tz,
          nextRun: instant(d.job.nextRun()),
        });
      // why: a one-shot job fires at an instant, so its tz is UTC and it has no cron
      for (const [id, r] of resumes)
        out.push({
          id: `resume:${id}`,
          kind: 'resume',
          definitionId: r.definitionId,
          executionId: id,
          cron: null,
          tz: 'UTC',
          nextRun: r.at,
        });
      // why: SchedulerJob (api-contract) lists definition and resume jobs only; the daily system jobs are internal
      return out;
    },
    definitionJobCount: () => defs.size,
    stopAll() {
      for (const id of [...defs.keys()]) unregister(id);
      for (const id of [...resumes.keys()]) cancelResume(id);
      for (const job of systems.values()) job.stop();
      systems.clear();
      for (const t of soon) clearTimeout(t);
      soon.clear();
    },
    async drain(boundMs) {
      if (inFlight.size === 0) return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const bound = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), boundMs);
        timer.unref();
      });
      const done = Promise.allSettled([...inFlight]).then(() => true);
      const finished = await Promise.race([done, bound]);
      clearTimeout(timer);
      if (!finished) log.warn({ jobs: inFlight.size, boundMs }, 'scheduler: jobs still running at shutdown');
      return finished;
    },
  };
}
