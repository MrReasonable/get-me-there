import type { Flags } from '../args.js';
import { checkWords, workerCheck } from '../camoufox/workerService.js';
import { type Deps, EXIT } from '../deps.js';
import {
  installed,
  lifecycleActions,
  lifecycleGuard,
  onlyEntries,
  refuseOnWindows,
  runLifecycle,
} from './lifecycle.js';

/**
 * `gmt restart`: the app restarted; a job is only made sure to be scheduled. The worker restarts only once its own
 * check passes (decision 75; CodeRabbit, PR #15); otherwise it is stopped and stays stopped, with its refusal printed.
 */
export async function restartCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const all = await installed(deps);
  const only = onlyEntries(flags, all.entries);
  if (!only.ok) {
    deps.io.err(`${only.message}\n`);
    return EXIT.badConfig;
  }
  const { entries } = only;
  const { facts } = all;
  const refused = await lifecycleGuard(deps, flags, entries, all.entries, facts);
  if (refused !== null) return refused;
  const worker = entries.filter((e) => e.name === 'camoufox-worker');
  if (worker.length > 0 && flags['dry-run'] !== true) {
    const check = await workerCheck(deps);
    if (check.kind !== 'ok') {
      deps.io.out(`worker: not restarted: ${checkWords(check)}\n`);
      const rest = entries.filter((e) => e.name !== 'camoufox-worker');
      return runLifecycle(
        'restart',
        [...lifecycleActions(deps, 'stop', worker, facts), ...lifecycleActions(deps, 'restart', rest, facts)],
        flags,
        deps,
      );
    }
  }
  return runLifecycle('restart', lifecycleActions(deps, 'restart', entries, facts), flags, deps);
}
