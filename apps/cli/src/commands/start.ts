import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { describeChecks, settingsChecks, staleChecks } from '../services/checks.js';
import { installed, lifecycleActions, refuseOnWindows, runLifecycle } from './lifecycle.js';

/** `gmt start` (spec §12, §13): refuses over a settings file others can read or a unit whose Node or checkout is gone. */
export async function startCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const { entries, facts } = await installed(deps);
  if (entries.length === 0) {
    deps.io.err('nothing is installed: run pnpm gmt setup\n');
    return EXIT.refused;
  }
  const fails = [...settingsChecks(deps), ...staleChecks(deps, entries, facts)].filter(
    (c) => c.level === 'fail',
  );
  if (fails.length > 0) {
    deps.io.err(`start refused:\n${describeChecks(fails)}`);
    return EXIT.refused;
  }
  return runLifecycle('start', lifecycleActions(deps, 'start', entries, facts), flags, deps);
}
