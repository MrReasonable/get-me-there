import type { Flags } from '../args.js';
import { countsCommand } from '../camoufox/counts.js';
import { installCamoufox, oldBundleRemovals } from '../camoufox/installer.js';
import { retiredWorkerLines, workerEnvPath } from '../camoufox/workerEnv.js';
import { workerStart } from '../camoufox/workerService.js';
import { type Deps, EXIT } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import { factOf, factsOf, serviceSet, workerEntry } from '../services/set.js';
import { appEnvPath } from '../services/specs.js';
import { readSettings } from '../setup/appEnv.js';
import { guardActiveRun } from './guard.js';
import { refuseOnWindows } from './lifecycle.js';
import { nativeTarget } from './setup.js';

/**
 * `gmt browser install` (W1: the browser provider in any app mode; decision 73): installs or reinstalls this code's
 * pinned Camoufox and its layout, needing no app.env, so an app run natively, in Docker or not at all gets the same
 * install. A native app is asked first whether a run is active (decision 80's guard; `--wait`, `--force`); with no
 * native app nothing is asked. Where the worker is set up here (its worker.env exists), the service is stopped, its
 * settings lose the two names the install now owns (CAMOUFOX_BINARY_BUILD, CAMOUFOX_INSTALL_DIR), and its gmt unit is
 * installed or re-rendered (a hand-written agent with the same label is replaced) and started once its own check
 * passes. Older bundles are then removed.
 */
async function installAction(flags: Flags, deps: Deps): Promise<number> {
  const paths = deps.platform.paths;
  const read = (path: string): string | null => {
    try {
      return deps.files.read(path);
    } catch {
      return null;
    }
  };
  const appText = read(appEnvPath(paths));
  const workerText = read(workerEnvPath(paths));
  // why: with neither file (a fresh machine, CI) no service is asked about: the install alone runs
  const entries = appText === null && workerText === null ? [] : serviceSet(deps);
  const app = entries.find((e) => e.name === 'app');
  // why: W1: worker.env here means the worker is set up on this machine, whatever runs the app (in Docker, no app.env
  // names it), so its gmt service is installed or kept in step with this checkout
  const worker = workerText === null ? undefined : workerEntry(deps);
  const facts =
    entries.length === 0
      ? new Map()
      : await factsOf(deps, worker === undefined ? entries : [...entries, worker]);
  if (appText !== null) {
    const g = await guardActiveRun(
      deps,
      nativeTarget(readSettings(appText), factOf(facts, app?.unit ?? '')),
      {
        wait: flags.wait === true,
        force: flags.force === true,
      },
    );
    if (!g.ok) {
      deps.io.err(`${g.message}\n`);
      return EXIT.lockRefused;
    }
  }
  const keepArchive = flags['keep-archive'] === true;
  // why: the download and the unpack touch nothing the running worker reads; only the layout switch below does
  const staged = await installCamoufox(deps, { command: 'browser install', keepArchive, layout: false });
  if (staged.kind !== 'ok') {
    deps.io.err(`${staged.message}\n`);
    return staged.kind === 'failed' ? EXIT.failed : EXIT.badConfig;
  }
  const sm = deps.platform.serviceManager;
  const stopped: Action[] = [];
  if (worker !== undefined && workerText !== null) {
    stopped.push(...sm.stop(worker.unit, factOf(facts, worker.unit)));
    const kept = retiredWorkerLines(workerText);
    if (kept.removed.length > 0) {
      deps.io.out(`worker.env: removing ${kept.removed.join(', ')} (the install owns these now)\n`);
      stopped.push(deps.platform.writeSecretFile(workerEnvPath(paths), kept.text));
    }
  }
  const stop = await apply(
    { command: 'browser install: the worker', actions: stopped, notes: [] },
    deps.executor,
  );
  if (stop.failed !== null) {
    deps.io.err(describeResult('browser install: the worker', stop));
    return EXIT.failed;
  }
  const laid = await installCamoufox(deps, { command: 'browser install', keepArchive });
  if (laid.kind === 'refused' || laid.kind === 'failed') {
    deps.io.err(`${laid.message}\n`);
    return laid.kind === 'failed' ? EXIT.failed : EXIT.badConfig;
  }
  const after: Action[] = [];
  if (worker !== undefined && laid.kind === 'ok') {
    const start = await workerStart(deps, worker, await factsOf(deps, [worker]));
    if (start.notStarted !== null) deps.io.out(`worker: not started: ${start.notStarted}\n`);
    after.push(...start.actions);
  }
  after.push(...oldBundleRemovals(deps, laid.bundle));
  const r = await apply({ command: 'browser install', actions: after, notes: [] }, deps.executor);
  if (r.failed !== null) {
    deps.io.err(describeResult('browser install', r));
    return EXIT.failed;
  }
  if (laid.kind === 'libraries') {
    deps.io.err(`${laid.message}\n`);
    return EXIT.badConfig;
  }
  deps.io.out(`Camoufox ${laid.entry.build} is in place for ${laid.osArch}: ${laid.bundle}\n`);
  return EXIT.ok;
}

/** `gmt browser <install|counts>`. */
export async function browserCommand(flags: Flags, positional: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  return positional === 'counts' ? countsCommand(flags, deps) : installAction(flags, deps);
}
