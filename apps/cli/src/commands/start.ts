import type { Flags } from '../args.js';
import { checkWords, workerCheck } from '../camoufox/workerService.js';
import { type Deps, EXIT } from '../deps.js';
import type { Action } from '../plan/action.js';
import { describeChecks, settingsChecks, staleChecks } from '../services/checks.js';
import { bootOutRefused, readStartRefusal, refusalWithFix } from '../worker/refusal.js';
import { installed, lifecycleActions, onlyEntries, refuseOnWindows, runLifecycle } from './lifecycle.js';

/**
 * `gmt start` (spec §12, §13): refuses over a settings file others can read or a unit whose Node or checkout is gone.
 * The worker starts only when its own start check passes, and a refused worker's agent is booted out (launchd cannot
 * exclude exit 78); the worker's refusal is printed once, with its fix. W5: with `--only app` or `--only backup` the
 * worker is neither read nor touched, and a worker alone (the app in Docker) needs no app.env.
 */
export async function startCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const all = await installed(deps);
  if (all.entries.length === 0) {
    deps.io.err('nothing is installed: run pnpm gmt setup\n');
    return EXIT.badConfig;
  }
  const only = onlyEntries(flags, all.entries);
  if (!only.ok) {
    deps.io.err(`${only.message}\n`);
    return EXIT.badConfig;
  }
  const { entries } = only;
  const { facts } = all;
  const wantsWorker = entries.some((e) => e.name === 'camoufox-worker');
  const appSide = entries.some((e) => e.name !== 'camoufox-worker');
  const fails = [...settingsChecks(deps, appSide), ...staleChecks(deps, entries, facts)].filter(
    (c) => c.level === 'fail',
  );
  if (fails.length > 0) {
    deps.io.err(`start refused:\n${describeChecks(fails)}`);
    return EXIT.badConfig;
  }
  let startable = entries;
  let bootOut: Action[] = [];
  if (wantsWorker) {
    const refusal = readStartRefusal(deps.platform.paths, deps.files);
    if (flags['dry-run'] === true) {
      if (refusal !== 'none' && refusal !== 'unreadable') deps.io.out(`worker: ${refusalWithFix(refusal)}\n`);
      bootOut = bootOutRefused(deps.platform, facts, refusal);
    } else {
      const check = await workerCheck(deps);
      if (check.kind !== 'ok') {
        deps.io.out(`worker: not started: ${checkWords(check)}\n`);
        startable = entries.filter((e) => e.name !== 'camoufox-worker');
        bootOut = bootOutRefused(deps.platform, facts, check.kind === 'refused' ? check.refusal : refusal);
      }
    }
  }
  return runLifecycle(
    'start',
    [...bootOut, ...lifecycleActions(deps, 'start', startable, facts)],
    flags,
    deps,
  );
}
