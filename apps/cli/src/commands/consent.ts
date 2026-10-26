import { join } from 'node:path/posix';
import type { Flags } from '../args.js';
import { workerEnvPath } from '../camoufox/workerEnv.js';
import { workerStart, workerStop } from '../camoufox/workerService.js';
import { type Deps, EXIT } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import type { ServiceFacts } from '../platform/types.js';
import { factOf, factsOf, workerEntry } from '../services/set.js';
import { appEnvPath, serviceEnvironment, workerRunArgv } from '../services/specs.js';
import { REFUSAL_FILE, readStartRefusal } from '../worker/refusal.js';
import { appGuardTarget, guardActiveRun } from './guard.js';
import { refuseOnWindows } from './lifecycle.js';

/**
 * `gmt consent [export|import|check]` (spec §2 "Consent", §13; decision 74; brief WP17 Task 17.5): the front end of the
 * worker's `consent` command, which it only spawns (`run.ts consent …` with the terminal attached), importing no worker
 * code. The child's environment is PATH and HOME, as the worker service has, plus this session's display variables
 * in decision 74's two groups.
 *
 * - With no action (the capture), `export` and `import`, a running worker service alone is stopped first, after the
 *   one active-run guard (`--wait`, `--force`), which asks this machine's app, native or in Docker (appEndpoint). After
 *   a capture or import that succeeded, a `consent-*` refusal file is cleared and the worker is started once its own
 *   start check passes; after anything else (a refusal, a failure, an interruption, or an export, which writes nothing
 *   here) the worker is put back as it was: started again only if it was running (review X3).
 * - `export` needs only the pinned Camoufox (`pnpm gmt browser install`), no worker.env; its standard output is the
 *   worker's one line, so everything this command says goes to standard error.
 * - `check` reads the stored record only: nothing is stopped.
 */
export async function consentCommand(flags: Flags, positional: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const paths = deps.platform.paths;
  const exporting = positional === 'export';
  // why: po-b1-007: export's standard output is the line; the guard's and the restart's words go to standard error
  const io = exporting ? { ...deps.io, out: deps.io.err } : deps.io;
  const said: Deps = { ...deps, io };
  const read = (path: string): string | null => {
    try {
      return deps.files.read(path);
    } catch {
      return null;
    }
  };
  const nativeApp = read(appEnvPath(paths)) !== null;
  // why: po-b1-001, review X4: with the app in Docker (no native install) the worker is set up by hand and installed by
  // gmt browser install; gmt setup is named only where the app runs natively
  const setUp = nativeApp
    ? 'pnpm gmt setup --reconfigure browser'
    : 'write worker.env as docs/setup.md#the-app-in-docker-the-worker-on-this-machine says, then pnpm gmt browser install';
  const turnOn = nativeApp
    ? 'pnpm gmt setup --reconfigure browser turns the browser provider on'
    : 'pnpm gmt browser install installs the worker service and starts it';
  const { argv, cwd, env } = consentChild(deps, positional);
  const run = { argv, cwd };
  const first: Action[] = [];
  if (read(workerEnvPath(paths)) === null) {
    if (!exporting) {
      deps.io.err(`the browser worker is not set up on this machine (no worker.env): ${setUp}\n`);
      return EXIT.badConfig;
    }
    // why: review X4: export needs only the pinned Camoufox; the worker's data directory holds its lock and spacing
    if (!deps.files.isDir(paths.workerData))
      first.push({ kind: 'mkdir', path: paths.workerData, mode: 0o700 });
  }
  if (positional === 'check') return deps.attach(run.argv, run.cwd, env);
  // why: CodeRabbit (PR #18): import reads its line from a pipe or a file; from a terminal it would wait for the end of
  // input with no prompt while the worker stays stopped, so it is refused before anything stops
  if (positional === 'import' && deps.io.stdinIsTTY) {
    deps.io.err(
      'consent import reads the line from a pipe or a file, not the terminal: pnpm gmt consent export | ssh <this machine> "cd <checkout> && pnpm gmt consent import"\n',
    );
    return EXIT.badConfig;
  }

  const worker = workerEntry(deps);
  const before = factOf(await factsOf(deps, [worker]), worker.unit);
  const wasRunning = before.state === 'running';
  const isInstalled = before.onDisk !== null;
  if (wasRunning) {
    const g = await guardActiveRun(said, await appGuardTarget(deps), {
      wait: flags.wait === true,
      force: flags.force === true,
    });
    if (!g.ok) {
      deps.io.err(`${g.message}\n`);
      return EXIT.lockRefused;
    }
    first.push(...workerStop(deps, worker.unit, before));
  }
  const interrupt = new AbortController();
  // why: sec-b1-001, review X3, CodeRabbit (PR #18): from before the worker stops, SIGINT or SIGTERM is handled here
  // instead of ending this process: it reaches the child, which closes its window and deletes its profile, and the
  // worker is put back before the command ends
  const off = deps.onInterrupt(() => interrupt.abort());
  // why: null until the child ran (an interruption before it leaves it null)
  let code: number | null = null;
  try {
    if (first.length > 0) {
      const stop = await apply(
        { command: 'consent: stop the worker', actions: first, notes: [] },
        deps.executor,
      );
      if (stop.failed !== null) {
        deps.io.err(describeResult('consent: stop the worker', stop));
        // why: ts-b1-002, review X3: a stop that failed part way leaves the worker as it was, started again if need be
        await restoreWorker(said, { stored: false, wasRunning, isInstalled, turnOn });
        return EXIT.failed;
      }
    }
    try {
      if (!interrupt.signal.aborted) code = await deps.attach(run.argv, run.cwd, env, interrupt.signal);
    } finally {
      const stored = code === 0 && !exporting && !interrupt.signal.aborted;
      const after = await restoreWorker(said, { stored, wasRunning, isInstalled, turnOn });
      if (after !== EXIT.ok && code === 0) code = after;
    }
  } finally {
    off();
  }
  if (interrupt.signal.aborted) return code === null || code === 0 ? INTERRUPTED : code;
  return code ?? EXIT.failed;
}

/**
 * The worker's consent entry as a child (setup's capture step runs it too): `run.ts consent [action]`, its directory,
 * and an environment of PATH and HOME, as the service has, plus the display groups.
 */
export function consentChild(
  deps: Deps,
  action: string | null,
): { argv: string[]; cwd: string; env: Record<string, string> } {
  const run = workerRunArgv(deps, 'consent', ...(action === null ? [] : [action]));
  return { ...run, env: { ...serviceEnvironment(deps.execPath, deps.home), ...deps.platform.displayEnv } };
}

/** The exit code after SIGINT or SIGTERM (the shell's 128 + 2) when the child itself did not say otherwise. */
const INTERRUPTED = 130;

/** After the worker's command: the consent refusal cleared and the worker started, or the worker put back as it was. */
async function restoreWorker(
  deps: Deps,
  o: { stored: boolean; wasRunning: boolean; isInstalled: boolean; turnOn: string },
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
    const facts: ReadonlyMap<string, ServiceFacts> = await factsOf(deps, [worker]);
    const start = await workerStart(deps, worker, facts);
    if (start.notStarted !== null) deps.io.out(`worker: not started: ${start.notStarted}\n`);
    actions.push(...start.actions);
  } else if (o.stored) deps.io.out(`The worker service is not installed yet: ${o.turnOn}.\n`);
  if (actions.length === 0) return EXIT.ok;
  const r = await apply({ command: 'consent: the worker', actions, notes: [] }, deps.executor);
  if (r.failed !== null) {
    deps.io.err(describeResult('consent: the worker', r));
    return EXIT.failed;
  }
  deps.io.out(describeResult('consent: the worker', r));
  return EXIT.ok;
}
