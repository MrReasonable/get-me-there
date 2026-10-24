import { resolve } from 'node:path';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describePlan, describeResult } from '../plan/describe.js';
import { factOf } from '../services/set.js';
import { databasePath } from '../services/specs.js';
import { importingPath } from '../setup/importDb.js';
import { installed, refuseOnWindows } from './lifecycle.js';

export const DASHBOARD_TEXT =
  'A restored ledger lacks any call made after its backup, so check each vendor’s dashboard and lower the caps if needed.';
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
 * `gmt restore <file>` (spec §13 Restore (native)): the app stopped; the source checked with `PRAGMA integrity_check`
 * before anything moves; the backup copied to a 0600 temporary file, the current database kept as
 * `<name>.before-restore`, its `-wal` and `-shm` removed, the copy renamed into place.
 */
export async function restoreCommand(flags: Flags, positional: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const source = resolve(deps.env.INIT_CWD ?? deps.checkout, positional ?? '');
  const db = databasePath(deps.platform.paths);
  const { entries, facts } = await installed(deps);
  const app = entries.find((e) => e.name === 'app');
  if (app !== undefined && ['running', 'failed'].includes(factOf(facts, app.unit).state)) {
    deps.io.err('the app is running: stop it first with pnpm gmt stop, then restore\n');
    return EXIT.refused;
  }
  if (deps.files.size(source) === null) {
    deps.io.err(`there is no backup file at ${source}\n`);
    return EXIT.refused;
  }
  const check = await deps.run([deps.execPath, `${deps.checkout}/scripts/check-backup.mjs`, source], {
    cwd: deps.checkout,
    timeoutMs: 600_000,
  });
  if (check.code !== 0) {
    deps.io.err(`${source} fails PRAGMA integrity_check; nothing was changed\n`);
    return EXIT.refused;
  }
  const tmp = importingPath(db);
  const actions: Action[] = [
    { kind: 'copy', from: source, to: tmp, mode: 0o600 },
    ...(deps.files.size(db) !== null
      ? [{ kind: 'rename' as const, from: db, to: `${db}.before-restore` }]
      : []),
    ...[`${db}-wal`, `${db}-shm`]
      .filter((p) => deps.files.size(p) !== null)
      .map((path): Action => ({ kind: 'remove', path, recursive: false })),
    { kind: 'rename', from: tmp, to: db },
  ];
  const plan = { command: 'restore', actions, notes: [] };
  if (flags['dry-run'] === true) {
    deps.io.out(describePlan(plan));
    return EXIT.ok;
  }
  const r = await apply(plan, deps.executor);
  if (r.failed !== null) {
    deps.io.err(describeResult('restore', r));
    return EXIT.failed;
  }
  deps.io.out(
    `Restored ${source} as ${db} (the previous file is ${db}.before-restore). ${DASHBOARD_TEXT} Start the app with pnpm gmt start.\n`,
  );
  if (await detached(deps)) deps.io.out(`${DETACHED_TEXT}\n`);
  return EXIT.ok;
}
