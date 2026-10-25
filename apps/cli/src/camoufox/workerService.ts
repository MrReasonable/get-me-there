import type { StartRefusal } from '@gmt/core';
import { startRefusalSchema } from '@gmt/core';
import type { Deps } from '../deps.js';
import type { Action } from '../plan/action.js';
import type { ServiceFacts } from '../platform/types.js';
import { factOf, type ServiceEntry } from '../services/set.js';
import { serviceEnvironment, workerRunArgv } from '../services/specs.js';
import { refusalWithFix } from '../worker/refusal.js';

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
    actions: install.length === 0 ? sm.start(worker.unit, factOf(facts, worker.unit)) : install,
    notStarted: null,
  };
}
