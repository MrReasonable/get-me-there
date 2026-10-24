import { resolve } from 'node:path/posix';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { apply } from '../plan/apply.js';
import { describePlan, describeResult } from '../plan/describe.js';
import { factOf } from '../services/set.js';
import { appEnvPath, databasePath } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';
import {
  checkedSummary,
  dashboardText,
  importingPath,
  placeActions,
  stampOf,
  startNote,
} from '../setup/importDb.js';
import { installed, refuseOnWindows } from './lifecycle.js';

export const DETACHED_TEXT =
  'This checkout is on a detached commit: run git switch main before the next pnpm gmt update.';

/** Whether the checkout is on a detached commit (`git symbolic-ref -q HEAD` fails then). */
export async function detached(deps: Deps): Promise<boolean> {
  return (
    (await deps.run(['git', 'symbolic-ref', '-q', 'HEAD'], { cwd: deps.checkout, timeoutMs: 15_000 }))
      .code !== 0
  );
}

/**
 * `gmt restore <file>` (spec §13 Restore (native)): the app stopped; then importDb's one placement (U8, ca-b1-010): the
 * backup copied to a 0600 temporary file and that copy checked with `PRAGMA integrity_check` before anything moves; the
 * current database kept whole, its `-wal` and `-shm` with it, as `<name>.before-restore-<time>` (never over an earlier
 * one); the copy renamed into place. It then says what the first start will resume or catch up, and what to correct.
 */
export async function restoreCommand(flags: Flags, positional: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const source = resolve(deps.invocationCwd, positional ?? '');
  const db = databasePath(deps.platform.paths);
  const { entries, facts } = await installed(deps);
  const app = entries.find((e) => e.name === 'app');
  if (app !== undefined && ['running', 'failed'].includes(factOf(facts, app.unit).state)) {
    deps.io.err('the app is running: stop it first with pnpm gmt stop, then restore\n');
    return EXIT.badConfig;
  }
  if (deps.files.size(source) === null) {
    deps.io.err(`there is no backup file at ${source}\n`);
    return EXIT.badConfig;
  }
  const kept = `${db}.before-restore-${stampOf(deps.now())}`;
  const actions = placeActions(deps, source, { keepAs: kept });
  const plan = { command: 'restore', actions, notes: [] };
  if (flags['dry-run'] === true) {
    deps.io.out(describePlan(plan));
    return EXIT.ok;
  }
  const r = await apply(plan, deps.executor);
  if (r.failed !== null) {
    if (r.failed.action.kind === 'run') {
      // why: the check failed on the copy; nothing else has moved, so the copy goes and the message says so
      await apply(
        {
          command: 'restore',
          actions: [{ kind: 'remove', path: importingPath(db), recursive: false }],
          notes: [],
        },
        deps.executor,
      );
      deps.io.err(`${source} fails PRAGMA integrity_check; nothing was changed\n`);
      return EXIT.badConfig;
    }
    deps.io.err(describeResult('restore', r));
    return EXIT.failed;
  }
  const checkAt = r.done.findIndex((a) => a.kind === 'run');
  const summary = checkedSummary(r.outputs[checkAt] ?? '');
  const env = deps.files.read(appEnvPath(deps.platform.paths));
  const plan_ = env === null ? undefined : readEnvText(env).SEARCHAPI_PLAN;
  const previous = deps.files.size(kept) === null ? '' : ` (the previous file is ${kept})`;
  deps.io.out(`Restored ${source} as ${db}${previous}. ${dashboardText(plan_)}\n`);
  deps.io.out(startNote(summary));
  deps.io.out('Start the app with pnpm gmt start.\n');
  if (await detached(deps)) deps.io.out(`${DETACHED_TEXT}\n`);
  return EXIT.ok;
}
