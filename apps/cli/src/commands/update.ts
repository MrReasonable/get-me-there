import { join } from 'node:path';
import { activeLine, credsFrom, readActive } from '../appClient.js';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { type Action, runAction } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import { factOf, factsOf, serviceSet } from '../services/set.js';
import { appEnvPath } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';
import { capturedBackup } from '../setup/importDb.js';
import { refuseOnWindows } from './lifecycle.js';
import { statusCommand } from './status.js';

/** Decision 80's `--force` statement, printed before the first action; the last sentence follows AUTO_RESUME. */
export function forceStatement(autoResume: boolean): string {
  return [
    'Updating anyway (--force): the app stops within 30 s on SIGTERM; a page or call in flight is abandoned, stays on the ledger and has its cells requested again; the run is marked interrupted at its last checkpoint without counting an automatic resume, and',
    autoResume
      ? 'after the restart the app resumes it from its last checkpoint (AUTO_RESUME is on).'
      : 'it waits for you to resume it (AUTO_RESUME is off).',
  ].join(' ');
}

/** What to do when a step after the stop failed (spec §13): nothing is rolled back; both ways back are printed. */
export function failureReport(step: string, commit: string, backup: string): string {
  return [
    `update stopped at ${step}; nothing was rolled back.`,
    `The checkout was at ${commit}; the backup taken before the change is ${backup}.`,
    'If the database was not migrated (the app never started on the new code), go back to the old code:',
    `  git checkout ${commit} && pnpm install --frozen-lockfile && pnpm build && pnpm gmt start`,
    'Otherwise restore the backup (docs/setup.md section 0, "Restore (native)"):',
    '  pnpm gmt stop',
    `  git checkout ${commit}`,
    '  pnpm install --frozen-lockfile',
    '  pnpm build',
    `  pnpm gmt restore ${backup}`,
    '  pnpm gmt start',
    'The checkout is then on a detached commit: run git switch main before the next update.',
    '',
  ].join('\n');
}

const refuse = (deps: Deps, m: string): number => {
  deps.io.err(`${m}\n`);
  return EXIT.refused;
};

/**
 * `gmt update` (spec §13; decision 80): the network work first while the app runs (fetch and the fast-forward check),
 * the active-run refusal (`--wait`, `--force`), then record the commit, stop, back up into backups/update (keep 5),
 * merge, install, build, re-render the units, start, wait for health, and status.
 */
export async function updateCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const git = (...args: string[]) => deps.run(['git', ...args], { cwd: deps.checkout, timeoutMs: 120_000 });
  if ((await git('status', '--porcelain')).stdout.trim() !== '')
    return refuse(deps, 'this checkout has local changes: commit or remove them, then update');
  const branch = await git('symbolic-ref', '-q', '--short', 'HEAD');
  if (branch.code !== 0 || branch.stdout.trim() !== 'main')
    return refuse(
      deps,
      'this checkout is not on main (after a restore it is on a detached commit): run git switch main, then update',
    );
  if ((await git('fetch', 'origin')).code !== 0)
    return refuse(deps, 'git fetch failed; nothing was stopped and the app keeps running');
  const commit = (await git('rev-parse', 'HEAD')).stdout.trim();
  const target = (await git('rev-parse', 'origin/main')).stdout.trim();
  if (commit === target) {
    deps.io.out(`already up to date at ${commit}; nothing was stopped\n`);
    return EXIT.ok;
  }
  if ((await git('merge-base', '--is-ancestor', 'HEAD', 'origin/main')).code !== 0)
    return refuse(deps, 'cannot fast-forward this checkout to origin/main; nothing was stopped');

  const envText = deps.files.read(appEnvPath(deps.platform.paths));
  const record = envText === null ? {} : readEnvText(envText);
  const entries = serviceSet(deps);
  const app = entries.find((e) => e.name === 'app');
  const facts = await factsOf(deps, entries);
  const appActive = app !== undefined && ['running', 'failed'].includes(factOf(facts, app.unit).state);
  const force = flags.force === true;
  if (appActive) {
    const creds = credsFrom(record);
    for (;;) {
      const r =
        creds === null
          ? { kind: 'failed' as const, reason: 'no auth lines in app.env' }
          : await readActive(deps, creds);
      if (r.kind === 'none') break;
      if (r.kind === 'active' && flags.wait === true && !force) {
        deps.io.out(`${activeLine(r.execution)}; waiting (checking every 60 s)\n`);
        await deps.sleep(60_000);
        continue;
      }
      if (!force)
        return refuse(
          deps,
          r.kind === 'active'
            ? `${activeLine(r.execution)}; update again when it ends, or with --wait or --force`
            : `cannot tell whether a search is running (${r.reason}); update again when the app answers, or with --force`,
        );
      deps.io.out(`${forceStatement((record.AUTO_RESUME ?? 'true') !== 'false')}\n`);
      break;
    }
  }

  // why: decision 80: nothing is backed up before the app has stopped, and nothing changes the code before the backup
  const sm = deps.platform.serviceManager;
  const stops: Action[] = app === undefined ? [] : sm.stop(app.unit, factOf(facts, app.unit));
  const stopped = await apply({ command: 'update: stop', actions: stops, notes: [] }, deps.executor);
  if (stopped.failed !== null) {
    deps.io.err(describeResult('update: stop', stopped));
    return EXIT.failed;
  }
  const dir = join(deps.platform.paths.data, 'backups', 'update');
  const backup = await capturedBackup(
    deps,
    [
      deps.execPath,
      `--env-file=${appEnvPath(deps.platform.paths)}`,
      join(deps.checkout, 'scripts', 'backup.mjs'),
      '--dir',
      dir,
      '--keep',
      '5',
    ],
    dir,
  );
  if (!backup.ok) {
    deps.io.err(
      `the backup before the update failed (${backup.error}); the code is unchanged and the app is stopped: pnpm gmt start\n`,
    );
    return EXIT.failed;
  }
  deps.io.out(`backup before the update: ${backup.file}\n`);
  const steps: Array<[string, Action[]]> = [
    ['the merge', [runAction(['git', 'merge', '--ff-only', 'origin/main'], deps.checkout)]],
    ['the install', [runAction(['pnpm', 'install', '--frozen-lockfile'], deps.checkout)]],
    ['the build', [runAction(['pnpm', 'build'], deps.checkout)]],
  ];
  for (const [step, actions] of steps) {
    const r = await apply({ command: `update: ${step}`, actions, notes: [] }, deps.executor);
    if (r.failed !== null) {
      deps.io.err(`${describeResult(`update: ${step}`, r)}${failureReport(step, commit, backup.file)}`);
      return EXIT.failed;
    }
  }
  const now = await factsOf(deps, entries);
  const restart: Action[] = entries.flatMap((e) => {
    const install = sm.install(e.rendered, now);
    return e.name === 'app' && install.length === 0 ? sm.start(e.unit, factOf(now, e.unit)) : install;
  });
  const port = credsFrom(record)?.port ?? 3000;
  const tail: Array<[string, Action[]]> = [
    ['the start', restart],
    [
      'the health wait',
      [{ kind: 'waitHealthy', url: `http://127.0.0.1:${port}/api/health`, timeoutSeconds: 240 }],
    ],
  ];
  for (const [step, actions] of tail) {
    const r = await apply({ command: `update: ${step}`, actions, notes: [] }, deps.executor);
    if (r.failed !== null) {
      deps.io.err(`${describeResult(`update: ${step}`, r)}${failureReport(step, commit, backup.file)}`);
      return EXIT.failed;
    }
  }
  deps.io.out(`updated ${commit} to ${target}\n`);
  return statusCommand({}, null, deps);
}
