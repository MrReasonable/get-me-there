import { join } from 'node:path/posix';
import { z } from 'zod';
import { appUrl } from '../appClient.js';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { type Action, commandLine, type Plan, runAction } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describePlan, describeResult } from '../plan/describe.js';
import { factOf, factsOf, serviceSet } from '../services/set.js';
import { appEnvPath, databasePath } from '../services/specs.js';
import { readSettings } from '../setup/appEnv.js';
import { backupAction, printedBackup } from '../setup/importDb.js';
import { guardActiveRun } from './guard.js';
import { refuseOnWindows } from './lifecycle.js';
import { nativeTarget } from './setup.js';
import { statusCommand } from './status.js';

export { forceStatement } from './guard.js';

/** What to do when a step after the stop failed (spec §13): nothing is rolled back; both ways back are printed, quoted. */
export function failureReport(step: string, commit: string, backup: string): string {
  return [
    `update stopped at ${step}; nothing was rolled back.`,
    `The checkout was at ${commit}; the backup taken before the change is ${backup}.`,
    'To finish the update, fix what failed and run pnpm gmt update again: it carries on from the failed step.',
    'If the database was not migrated (the app never started on the new code), go back to the old code:',
    `  ${commandLine(['git', 'checkout', commit])} && pnpm install --frozen-lockfile && pnpm build && pnpm gmt start`,
    'Otherwise restore the backup (docs/setup.md section 0, "Restore (native)"):',
    '  pnpm gmt stop',
    `  ${commandLine(['git', 'checkout', commit])}`,
    '  pnpm install --frozen-lockfile',
    '  pnpm build',
    `  ${commandLine(['pnpm', 'gmt', 'restore', backup])}`,
    '  pnpm gmt start',
    'The checkout is then on a detached commit: run git switch main before the next update.',
    '',
  ].join('\n');
}

/**
 * Where an update stands (U4, ca-b1-002): written as each step after the stop completes, so a re-run after a failed
 * install, build, start or health wait finishes the job; removed once the app is healthy on the new commit.
 */
const STEPS = ['stopped', 'backed-up', 'merged', 'installed', 'built'] as const;
const stateSchema = z.object({
  from: z.string(),
  to: z.string(),
  backup: z.string().nullable(),
  step: z.enum(STEPS),
});
type UpdateState = z.infer<typeof stateSchema>;
export const updateStatePath = (deps: Deps): string => join(deps.platform.paths.state, 'update.json');
function readState(deps: Deps): UpdateState | null {
  const text = deps.files.read(updateStatePath(deps));
  if (text === null) return null;
  try {
    const r = stateSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    // why: a state file that is not JSON was not written by update; it is read as no update in progress
    return null;
  }
}
const stateAction = (deps: Deps, s: UpdateState): Action => ({
  kind: 'writeFile',
  path: updateStatePath(deps),
  contents: `${JSON.stringify(s)}\n`,
  mode: 0o644,
  secret: false,
});
const after = (s: UpdateState | null, step: (typeof STEPS)[number]): boolean =>
  s !== null && STEPS.indexOf(s.step) >= STEPS.indexOf(step);

const refuse = (deps: Deps, m: string, code: number = EXIT.badConfig): number => {
  deps.io.err(`${m}\n`);
  return code;
};

/**
 * `gmt update` (spec §13; decision 80; U4): the network work first while the app runs (fetch and the fast-forward
 * check), the active-run guard right before the stop (`--wait`, `--force`), then record, stop, back up into
 * backups/update (keep 5), merge, install, build, re-render the units, start, wait for health, and status. Each step's
 * completion is recorded, so a re-run carries on; `--dry-run` prints the plan and changes nothing.
 */
export async function updateCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const dryRun = flags['dry-run'] === true;
  const git = (...args: string[]) =>
    deps.run(['git', ...args], { cwd: deps.checkout, timeoutMs: 120_000, env: deps.childEnv });
  if ((await git('status', '--porcelain')).stdout.trim() !== '')
    return refuse(deps, 'this checkout has local changes: commit or remove them, then update');
  const branch = await git('symbolic-ref', '-q', '--short', 'HEAD');
  if (branch.code !== 0 || branch.stdout.trim() !== 'main')
    return refuse(
      deps,
      'this checkout is not on main (after a restore it is on a detached commit): run git switch main, then update',
    );
  if (!dryRun && (await git('fetch', 'origin')).code !== 0)
    return refuse(deps, 'git fetch failed; nothing was stopped and the app keeps running');
  const commit = (await git('rev-parse', 'HEAD')).stdout.trim();
  const target = (await git('rev-parse', 'origin/main')).stdout.trim();

  const envText = deps.files.read(appEnvPath(deps.platform.paths));
  const settings = envText === null ? null : readSettings(envText);
  if (settings === null || !settings.ok)
    return refuse(
      deps,
      `${appEnvPath(deps.platform.paths)} is missing or would not pass the app’s settings check: run pnpm gmt setup first`,
    );
  const entries = serviceSet(deps);
  const app = entries.find((e) => e.name === 'app');
  const facts = await factsOf(deps, entries);
  const appFacts = factOf(facts, app?.unit ?? '');
  const port = settings.config.port;
  const state = readState(deps);
  const resuming = state !== null && state.to === commit && after(state, 'merged');

  if (!resuming && commit === target) {
    const health = await deps.http({
      method: 'GET',
      url: appUrl(port, '/api/health'),
      headers: {},
      timeoutMs: 10_000,
    });
    if (appFacts.state === 'running' && !('error' in health) && health.status === 200) {
      deps.io.out(`already up to date at ${commit}; nothing was stopped\n`);
      return EXIT.ok;
    }
  } else if (!resuming && (await git('merge-base', '--is-ancestor', 'HEAD', 'origin/main')).code !== 0)
    return refuse(deps, 'cannot fast-forward this checkout to origin/main; nothing was stopped');

  const sm = deps.platform.serviceManager;
  const dir = join(deps.platform.paths.data, 'backups', 'update');
  const from = resuming ? state.from : commit;
  const begin: UpdateState = { from, to: target, backup: null, step: 'stopped' };
  const stop: Action[] = app === undefined ? [] : sm.stop(app.unit, appFacts);
  const changeCode = !resuming && commit !== target;
  // why: decision 80: nothing is backed up before the app has stopped, and nothing changes the code before the backup
  const stopPlan: Plan = {
    command: 'update: stop',
    actions: changeCode ? [stateAction(deps, begin), ...stop] : stop,
    notes: [],
  };
  const backupPlan: Plan = {
    command: 'update: back up',
    actions: changeCode ? [backupAction(deps, databasePath(deps.platform.paths), dir, ['--keep', '5'])] : [],
    notes: [],
  };
  const codePlan = (backup: string | null): Array<[string, Action[]]> => {
    const s = (step: (typeof STEPS)[number]) => stateAction(deps, { from, to: target, backup, step });
    const env = { env: deps.childEnv };
    return [
      [
        'the merge',
        changeCode
          ? [runAction(['git', 'merge', '--ff-only', 'origin/main'], deps.checkout, env), s('merged')]
          : [],
      ],
      [
        'the install',
        resuming && after(state, 'installed')
          ? []
          : [runAction(['pnpm', 'install', '--frozen-lockfile'], deps.checkout, env), s('installed')],
      ],
      [
        'the build',
        resuming && after(state, 'built')
          ? []
          : [runAction(['pnpm', 'build'], deps.checkout, env), s('built')],
      ],
    ];
  };
  const startPlan = async (): Promise<Action[]> => {
    const now = await factsOf(deps, entries);
    return entries.flatMap((e) => {
      const install = sm.install(e.rendered, now);
      return e.name === 'app' && install.length === 0 ? sm.start(e.unit, factOf(now, e.unit)) : install;
    });
  };
  const healthPlan: Action[] = [
    { kind: 'waitHealthy', url: appUrl(port, '/api/health'), timeoutSeconds: 240 },
    { kind: 'remove', path: updateStatePath(deps), recursive: false },
  ];

  if (dryRun) {
    deps.io.out(
      `update --dry-run, without fetching: compares this checkout with the last fetched origin/main (${target})\n`,
    );
    for (const p of [stopPlan, backupPlan]) if (p.actions.length > 0) deps.io.out(describePlan(p));
    for (const [step, actions] of codePlan('<the backup’s file>'))
      if (actions.length > 0) deps.io.out(describePlan({ command: `update: ${step}`, actions, notes: [] }));
    deps.io.out(
      describePlan({
        command: 'update: start and wait',
        actions: [...(await startPlan()), ...healthPlan],
        notes: [],
      }),
    );
    return EXIT.ok;
  }

  const g = await guardActiveRun(deps, nativeTarget(settings, appFacts), {
    wait: flags.wait === true,
    force: flags.force === true,
  });
  if (!g.ok) return refuse(deps, g.message, EXIT.lockRefused);
  if (resuming) deps.io.out(`finishing the update to ${target}, from the step after ${state.step}\n`);
  const stopped = await apply(stopPlan, deps.executor);
  if (stopped.failed !== null) return refuse(deps, describeResult(stopPlan.command, stopped), EXIT.failed);
  let backup = resuming ? (state.backup ?? '(none recorded)') : '(no change of code, so none)';
  if (changeCode) {
    const b = await apply(backupPlan, deps.executor);
    const printed = b.failed === null ? printedBackup(b.outputs.at(-1) ?? '', dir) : null;
    if (b.failed !== null || printed === null || !printed.ok) {
      deps.io.err(
        `${b.failed === null ? '' : describeResult(backupPlan.command, b)}the backup before the update failed; the code is unchanged and the app is stopped: pnpm gmt start\n`,
      );
      return EXIT.failed;
    }
    backup = printed.file;
    // why: U6 (pf-b1-009): the commit the backup goes with, beside it, so a restore can pick the matching code
    const sidecar = await apply(
      {
        command: 'update: record the backup’s commit',
        actions: [
          {
            kind: 'writeFile',
            path: `${backup}.commit`,
            contents: `${commit}\n`,
            mode: 0o600,
            secret: false,
          },
        ],
        notes: [],
      },
      deps.executor,
    );
    if (sidecar.failed !== null) deps.io.err(describeResult('update: record the backup’s commit', sidecar));
    deps.io.out(`backup before the update: ${backup} (taken at ${commit}; ${backup}.commit says so)\n`);
  }
  for (const [step, actions] of codePlan(changeCode ? backup : (state?.backup ?? null))) {
    const r = await apply({ command: `update: ${step}`, actions, notes: [] }, deps.executor);
    if (r.failed !== null) {
      deps.io.err(`${describeResult(`update: ${step}`, r)}${failureReport(step, from, backup)}`);
      return EXIT.failed;
    }
  }
  for (const [step, actions] of [
    ['the start', await startPlan()],
    ['the health wait', healthPlan],
  ] as const) {
    const r = await apply({ command: `update: ${step}`, actions, notes: [] }, deps.executor);
    if (r.failed !== null) {
      deps.io.err(`${describeResult(`update: ${step}`, r)}${failureReport(step, from, backup)}`);
      return EXIT.failed;
    }
  }
  deps.io.out(
    commit === target && !resuming
      ? `the app is running again at ${target}\n`
      : `updated ${from} to ${target}\n`,
  );
  return statusCommand({}, null, deps);
}
