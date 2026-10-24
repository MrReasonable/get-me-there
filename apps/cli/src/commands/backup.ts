import { join } from 'node:path';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { apply } from '../plan/apply.js';
import { describePlan, describeResult } from '../plan/describe.js';
import { factOf } from '../services/set.js';
import { dailyBackupsDir } from '../services/specs.js';
import { installed, refuseOnWindows } from './lifecycle.js';

/** `gmt backup` (spec §13): the daily job run once by hand (`launchctl kickstart`, `systemctl --user start`). */
export async function backupCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const { entries, facts } = await installed(deps);
  const job = entries.find((e) => e.name === 'backup');
  if (job === undefined) {
    deps.io.err('the backup job is not installed: run pnpm gmt setup\n');
    return EXIT.refused;
  }
  const actions = deps.platform.serviceManager.start(job.unit, {
    ...factOf(facts, job.unit),
    state: 'stopped',
  });
  const plan = { command: 'backup', actions, notes: [] };
  if (flags['dry-run'] === true) {
    deps.io.out(describePlan(plan));
    return EXIT.ok;
  }
  const dir = dailyBackupsDir(deps.platform.paths);
  const before = new Set(deps.files.list(dir) ?? []);
  const r = await apply(plan, deps.executor);
  if (r.failed !== null) {
    deps.io.err(describeResult('backup', r));
    return EXIT.failed;
  }
  for (let i = 0; i < 90; i++) {
    const fresh = (deps.files.list(dir) ?? []).filter((n) => n.endsWith('.db') && !before.has(n));
    if (fresh.length > 0) {
      deps.io.out(`backup written: ${join(dir, fresh.sort().at(-1) ?? '')}\n`);
      return EXIT.ok;
    }
    await deps.sleep(2000);
  }
  deps.io.err('the backup job wrote no new file within 3 minutes; see pnpm gmt logs\n');
  return EXIT.failed;
}
