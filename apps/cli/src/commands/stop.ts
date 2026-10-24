import type { Flags } from '../args.js';
import type { Deps } from '../deps.js';
import { installed, lifecycleActions, refuseOnWindows, runLifecycle } from './lifecycle.js';

/** `gmt stop`: the app gets SIGTERM and 30 s to checkpoint; the job's schedule is unloaded. */
export async function stopCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const { entries, facts } = await installed(deps);
  return runLifecycle('stop', lifecycleActions(deps, 'stop', entries, facts), flags, deps);
}
