import type { Flags } from '../args.js';
import { checkWords, workerCheck, workerStarted } from '../camoufox/workerService.js';
import { type Deps, EXIT } from '../deps.js';
import { apply } from '../plan/apply.js';
import { describePlan, describeResult } from '../plan/describe.js';
import { assumedStopped, factOf } from '../services/set.js';
import {
  installed,
  lifecycleActions,
  lifecycleGuard,
  onlyEntries,
  refuseOnWindows,
  runLifecycle,
} from './lifecycle.js';

/**
 * `gmt restart`: the app restarted; a job is only made sure to be scheduled. The worker is stopped first and started
 * again only once its old process has let go (WP16b ruling U5: launchd's label gone or systemd's unit inactive, then
 * its lock free of any live pid, each wait bounded by its stop timeout plus a margin) and its own check then passes
 * (decision 75; CodeRabbit, PR #15). A check that refuses leaves it stopped, says so with the refusal's fix, and the
 * command exits non-zero rather than reporting done. A started worker is done only once it answers on its port (spec
 * §13), within a bound; one that never does fails the restart, naming its port, its log and any start refusal file.
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
  const worker = entries.find((e) => e.name === 'camoufox-worker');
  if (worker === undefined)
    return runLifecycle('restart', lifecycleActions(deps, 'restart', entries, facts), flags, deps);

  const rest = entries.filter((e) => e !== worker);
  const stop = [
    ...lifecycleActions(deps, 'stop', [worker], facts),
    ...lifecycleActions(deps, 'restart', rest, facts),
  ];
  // why: once stopped, the worker's start is its service manager's start from a stopped service, then the wait until
  // the new worker answers (spec §13), so "done" means it serves
  const start = workerStarted(
    deps,
    worker.unit,
    deps.platform.serviceManager.start(worker.unit, assumedStopped(factOf(facts, worker.unit))),
  );
  if (flags['dry-run'] === true) {
    deps.io.out(
      describePlan({
        command: 'restart',
        actions: [...stop, ...start],
        notes: [
          'the worker starts again only once its check passes, after its old process has let go, and the restart is done once it answers',
        ],
      }),
    );
    return EXIT.ok;
  }
  const stopped = await apply({ command: 'restart', actions: stop, notes: [] }, deps.executor);
  if (stopped.failed !== null) {
    deps.io.err(describeResult('restart', stopped));
    return EXIT.failed;
  }
  const check = await workerCheck(deps);
  if (check.kind !== 'ok') {
    const left = deps.platform.os === 'darwin' ? 'its launchd agent booted out' : 'its unit stopped';
    deps.io.err(
      `worker: not restarted: ${checkWords(check)}\n` +
        `restart: not done: the worker is stopped (${left}) and was not started again\n`,
    );
    return check.kind === 'refused' ? EXIT.badConfig : EXIT.failed;
  }
  const started = await apply({ command: 'restart', actions: start, notes: [] }, deps.executor);
  const whole = {
    ...started,
    done: [...stopped.done, ...started.done],
    outputs: [...stopped.outputs, ...started.outputs],
  };
  if (started.failed !== null) {
    deps.io.err(describeResult('restart', whole));
    return EXIT.failed;
  }
  deps.io.out(describeResult('restart', whole));
  return EXIT.ok;
}
