import type { Flags } from '../args.js';
import { refusalWords, workerCheck } from '../camoufox/browserSetup.js';
import { type Deps, EXIT } from '../deps.js';
import { describeChecks, settingsChecks, staleChecks } from '../services/checks.js';
import { bootOutRefused, readStartRefusal, refusalLine } from '../worker/refusal.js';
import { installed, lifecycleActions, onlyEntries, refuseOnWindows, runLifecycle } from './lifecycle.js';

/** `gmt start` (spec §12, §13): refuses over a settings file others can read or a unit whose Node or checkout is gone. */
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
  const fails = [...settingsChecks(deps), ...staleChecks(deps, entries, facts)].filter(
    (c) => c.level === 'fail',
  );
  if (fails.length > 0) {
    deps.io.err(`start refused:\n${describeChecks(fails)}`);
    return EXIT.badConfig;
  }
  // why: spec §13, decision 75: a refused worker agent is booted out (launchd cannot exclude exit 78), and the worker
  // is started only when its own start check passes; the app and the backup job start either way
  const refusal = readStartRefusal(deps.platform.paths, deps.files);
  if (refusal !== 'none' && refusal !== 'unreadable') deps.io.out(`worker: ${refusalLine(refusal)}\n`);
  const bootOut = bootOutRefused(deps.platform, facts, refusal);
  let startable = entries;
  if (entries.some((e) => e.name === 'camoufox-worker') && flags['dry-run'] !== true) {
    const check = await workerCheck(deps);
    if (check.kind !== 'ok') {
      deps.io.out(
        `worker: not started: ${check.kind === 'refused' ? refusalWords(check.refusal) : check.error}\n`,
      );
      startable = entries.filter((e) => e.name !== 'camoufox-worker');
    }
  }
  return runLifecycle(
    'start',
    [...bootOut, ...lifecycleActions(deps, 'start', startable, facts)],
    flags,
    deps,
  );
}
