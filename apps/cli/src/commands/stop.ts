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

/** `gmt stop`: the app gets SIGTERM and 30 s to checkpoint; the job's schedule is unloaded. */
export async function stopCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
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
  return runLifecycle('stop', lifecycleActions(deps, 'stop', entries, facts), flags, deps);
}
