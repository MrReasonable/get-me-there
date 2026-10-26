import { join } from 'node:path/posix';
import type { StartRefusal } from '@gmt/core';
import {
  START_REFUSAL_FILE,
  startRefusalSchema,
  WORKER_LOCK_FILE,
  WORKER_PORT,
  workerPortOf,
} from '@gmt/core';
import type { Deps } from '../deps.js';
import type { Action } from '../plan/action.js';
import type { Paths, ServiceFacts } from '../platform/types.js';
import { launchdLogPath } from '../services/launchd.js';
import { factOf, type ServiceEntry } from '../services/set.js';
import { serviceEnvironment, stopWaitSeconds, workerRunArgv } from '../services/specs.js';
import { refusalWithFix } from '../worker/refusal.js';
import { readWorkerEnv } from './workerEnv.js';

/**
 * The worker service's start rule (decision 75; spec §13 "The worker service starts only after worker start checks
 * pass"): every command that starts it (start, restart, update, setup, `browser install`) first runs the worker's own
 * check, `run.ts check --json`, exactly as the service would run it (PATH and HOME only), and starts it only on ok.
 */
export type WorkerCheck =
  | { kind: 'ok' }
  | { kind: 'refused'; refusal: StartRefusal }
  | { kind: 'failed'; error: string };

export async function workerCheck(deps: Deps): Promise<WorkerCheck> {
  const run = workerRunArgv(deps, 'check', '--json');
  const r = await deps.run(run.argv, {
    cwd: run.cwd,
    timeoutMs: 60_000,
    env: serviceEnvironment(deps.execPath, deps.home),
  });
  const line = r.stdout.trim().split('\n').at(-1) ?? '';
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    // why: dev-b1-003: a config error says why on stderr; its last line is the operator's next step
    const said = r.stderr.trim().split('\n').at(-1) ?? '';
    return {
      kind: 'failed',
      error: `the worker’s start check exited ${r.code}${said === '' ? ' and said nothing' : `: ${said}`}`,
    };
  }
  if (typeof json === 'object' && json !== null && 'ok' in json && json.ok === true) return { kind: 'ok' };
  const refusal = startRefusalSchema.safeParse(json);
  return refusal.success
    ? { kind: 'refused', refusal: refusal.data }
    : { kind: 'failed', error: 'the worker’s start check printed what this build cannot read' };
}

/** A failed or refused check's words: the refusal with its fix, or the check's own failure. */
export const checkWords = (c: Exclude<WorkerCheck, { kind: 'ok' }>): string =>
  c.kind === 'refused' ? refusalWithFix(c.refusal) : c.error;

/**
 * The worker's install or start once its check passes (the unit re-rendered when it changed, else started), or no
 * action and the words of why not.
 */
export async function workerStart(
  deps: Deps,
  worker: ServiceEntry,
  facts: ReadonlyMap<string, ServiceFacts>,
): Promise<{ actions: Action[]; notStarted: string | null }> {
  const check = await workerCheck(deps);
  if (check.kind !== 'ok') return { actions: [], notStarted: checkWords(check) };
  const sm = deps.platform.serviceManager;
  const install = sm.install(worker.rendered, facts);
  return {
    actions: workerStarted(
      deps,
      worker.unit,
      install.length === 0 ? sm.start(worker.unit, factOf(facts, worker.unit)) : install,
    ),
    notStarted: null,
  };
}

/**
 * How long a start of the worker waits for it to answer. Measured on the operator's Mac (2026-10-26): about 3 s from
 * launchd's start to listening (the browser's launch is most of it), 1.4 to 3.0 s for a start from a checkout; 60 s
 * leaves a slow first launch of a new browser build, or a loaded machine, a wide margin.
 */
export const WORKER_ANSWER_SECONDS = 60;

/**
 * The wait after the worker's service is started (spec §13): until the worker answers on its port (worker.env's
 * CAMOUFOX_WORKER_PORT, its default when unset or unreadable, as the worker's own check would have refused a bad one),
 * within WORKER_ANSWER_SECONDS. A worker that never answers fails it, naming its log (launchd's file, or the user
 * journal's unit) and its start refusal file.
 */
export function workerAnswerWait(deps: Pick<Deps, 'platform' | 'files'>, unit: string): Action {
  const paths = deps.platform.paths;
  let record: Readonly<Record<string, string>> | null = null;
  try {
    record = readWorkerEnv(deps.files, paths);
  } catch {
    // why: an unreadable worker.env is the start check's to refuse; the wait asks the default port
  }
  return {
    kind: 'waitWorkerAnswers',
    port: workerPortOf(record?.CAMOUFOX_WORKER_PORT) ?? WORKER_PORT.default,
    log: paths.logs === null ? `journalctl --user -u ${unit}` : launchdLogPath(paths.logs, 'camoufox-worker'),
    refusalFile: join(paths.workerData, START_REFUSAL_FILE),
    timeoutSeconds: WORKER_ANSWER_SECONDS,
  };
}

/**
 * A start of the worker's service (its start, restart or install) followed by the wait above, wherever the worker is
 * started (start, restart, update, setup, `browser install`, `browser counts`, `gmt consent`); nothing when nothing
 * starts it.
 */
export function workerStarted(
  deps: Pick<Deps, 'platform' | 'files'>,
  unit: string,
  start: readonly Action[],
): Action[] {
  return start.length === 0 ? [] : [...start, workerAnswerWait(deps, unit)];
}

/**
 * After the worker's service is stopped (WP16b ruling U5: nothing starts it again until the old process has exited):
 * a bounded wait until no live process holds `<workerData>/worker.lock`, so its start check never meets the lock of
 * the worker it replaces. The bound is the worker's stop timeout plus the margin.
 */
export const workerLockWait = (paths: Pick<Paths, 'workerData'>): Action => ({
  kind: 'waitUnlocked',
  path: join(paths.workerData, WORKER_LOCK_FILE),
  holder: 'the worker',
  timeoutSeconds: stopWaitSeconds(true),
});

/**
 * The worker's stop wherever it is stopped for something else to follow (restart, `stop`, update, `browser install`,
 * `browser counts`, `gmt consent`, setup's browser step): the service manager's stop and, when that stops anything, the
 * lock wait above, so whatever follows never meets the old worker's lock. Nothing when the worker is not running.
 */
export function workerStop(deps: Pick<Deps, 'platform'>, unit: string, f: ServiceFacts): Action[] {
  const stop = deps.platform.serviceManager.stop(unit, f);
  return stop.length === 0 ? [] : [...stop, workerLockWait(deps.platform.paths)];
}
