import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import {
  installed,
  lifecycleActions,
  lifecycleGuard,
  onlyEntries,
  refuseOnWindows,
  runLifecycle,
} from './lifecycle.js';

/** `gmt restart`: the app restarted; a job is only made sure to be scheduled. */
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
  const refused = await lifecycleGuard(deps, flags, entries, facts);
  if (refused !== null) return refused;
  return runLifecycle('restart', lifecycleActions(deps, 'restart', entries, facts), flags, deps);
}
