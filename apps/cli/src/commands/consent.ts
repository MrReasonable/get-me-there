import { join } from 'node:path/posix';
import type { Flags } from '../args.js';
import { workerEnvPath } from '../camoufox/workerEnv.js';
import { workerStart } from '../camoufox/workerService.js';
import { type Deps, EXIT } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import { factOf, factsOf, workerEntry } from '../services/set.js';
import { serviceEnvironment, workerRunArgv } from '../services/specs.js';
import { REFUSAL_FILE, readStartRefusal } from '../worker/refusal.js';
import { installed, lifecycleGuard, refuseOnWindows } from './lifecycle.js';

/**
 * `gmt consent [export|import|check]` (spec §2 "Consent", §13; decision 74; brief WP17 Task 17.5): the front end of the
 * worker's `consent` command, which it only spawns (`run.ts consent …` with the terminal attached), importing no worker
 * code. The child's environment is PATH and HOME, as the worker service has, plus this session's display variables
 * in decision 74's two groups.
 *
 * - With no action (the capture), `export` and `import`, the worker service alone is stopped first, after the one
 *   active-run guard (`--wait`, `--force`), since the command takes the worker's lock. After a capture or import that
 *   succeeded, a `consent-*` refusal file is cleared and the worker is started once its own start check passes;
 *   after anything else (a refusal, a failure, or an export, which writes nothing here) the worker is put back as it
 *   was: started again only if it was running.
 * - `check` reads the stored record only: nothing is stopped.
 */
export async function consentCommand(flags: Flags, positional: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const paths = deps.platform.paths;
  let workerEnv: string | null;
  try {
    workerEnv = deps.files.read(workerEnvPath(paths));
  } catch {
    workerEnv = null;
  }
  if (workerEnv === null) {
    deps.io.err(
      'the browser worker is not set up on this machine (no worker.env): run pnpm gmt setup and turn on the browser provider, or pnpm gmt setup --reconfigure browser\n',
    );
    return EXIT.badConfig;
  }
  const run = workerRunArgv(deps, 'consent', ...(positional === null ? [] : [positional]));
  const env = { ...serviceEnvironment(deps.execPath, deps.home), ...deps.platform.displayEnv };
  if (positional === 'check') return deps.attach(run.argv, run.cwd, env);
  // why: CodeRabbit (PR #18): import reads its line from a pipe or a file; from a terminal it would wait for the end of
  // input with no prompt while the worker stays stopped, so it is refused before anything stops
  if (positional === 'import' && deps.io.stdinIsTTY) {
    deps.io.err(
      'consent import reads the line from a pipe or a file, not the terminal: pnpm gmt consent import < consent.line\n',
    );
    return EXIT.badConfig;
  }

  const worker = workerEntry(deps);
  const before = factOf(await factsOf(deps, [worker]), worker.unit);
  const wasRunning = before.state === 'running';
  const isInstalled = before.onDisk !== null;
  if (wasRunning) {
    const all = await installed(deps);
    const refused = await lifecycleGuard(deps, flags, [worker], all.entries, all.facts);
    if (refused !== null) return refused;
    const stop = await apply(
      {
        command: 'consent: stop the worker',
        actions: deps.platform.serviceManager.stop(worker.unit, before),
        notes: [],
      },
      deps.executor,
    );
    if (stop.failed !== null) {
      deps.io.err(describeResult('consent: stop the worker', stop));
      return EXIT.failed;
    }
  }
  let code: number = EXIT.failed;
  try {
    code = await deps.attach(run.argv, run.cwd, env);
  } finally {
    const stored = code === 0 && positional !== 'export';
    // why: CodeRabbit (PR #18): export's standard output is its one line, so what follows it goes to standard error
    const say = positional === 'export' ? deps.io.err : deps.io.out;
    const after = await restoreWorker(deps, { stored, wasRunning, isInstalled, say });
    if (after !== EXIT.ok && code === 0) code = after;
  }
  return code;
}

/** After the worker's command: the consent refusal cleared and the worker started, or the worker put back as it was. */
async function restoreWorker(
  deps: Deps,
  o: { stored: boolean; wasRunning: boolean; isInstalled: boolean; say: (text: string) => void },
): Promise<number> {
  const paths = deps.platform.paths;
  const actions: Action[] = [];
  if (o.stored) {
    const refusal = readStartRefusal(paths, deps.files);
    // why: a consent refusal named the record now replaced; any other refusal stands until its own fix
    if (typeof refusal === 'object' && refusal.reason.startsWith('consent-'))
      actions.push({ kind: 'remove', path: join(paths.workerData, REFUSAL_FILE), recursive: false });
  }
  if (o.isInstalled && (o.stored || o.wasRunning)) {
    const worker = workerEntry(deps);
    const start = await workerStart(deps, worker, await factsOf(deps, [worker]));
    if (start.notStarted !== null) o.say(`worker: not started: ${start.notStarted}\n`);
    actions.push(...start.actions);
  } else if (o.stored)
    o.say(
      'The worker service is not installed yet: pnpm gmt setup --reconfigure browser turns the browser provider on.\n',
    );
  if (actions.length === 0) return EXIT.ok;
  const r = await apply({ command: 'consent: the worker', actions, notes: [] }, deps.executor);
  if (r.failed !== null) {
    deps.io.err(describeResult('consent: the worker', r));
    return EXIT.failed;
  }
  o.say(describeResult('consent: the worker', r));
  return EXIT.ok;
}
