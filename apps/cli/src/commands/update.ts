import { join } from 'node:path/posix';
import { z } from 'zod';
import { appUrl } from '../appClient.js';
import type { Flags } from '../args.js';
import {
  browserFailureLine,
  camoufoxPrefetch,
  camoufoxUpdateStep,
  DRY_RUN_LINE,
  PIN_FILE,
} from '../camoufox/updateStep.js';
import { workerStart } from '../camoufox/workerService.js';
import { type Deps, EXIT } from '../deps.js';
import { type Action, commandLine, type Plan, runAction } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describePlan, describeResult } from '../plan/describe.js';
import { factOf, factsOf, serviceSet } from '../services/set.js';
import { appEnvPath, databasePath } from '../services/specs.js';
import { readSettings } from '../setup/appEnv.js';
import { backupAction, printedBackup } from '../setup/importDb.js';
import { bootOutRefused, readStartRefusal, refusalWithFix } from '../worker/refusal.js';
import { guardActiveRun } from './guard.js';
import { refuseOnWindows } from './lifecycle.js';
import { nativeTarget } from './setup.js';
import { statusCommand } from './status.js';

export { forceStatement } from './guard.js';

/**
 * What to do when a step after the stop failed (spec §13): nothing is rolled back; the way back to the old code, and the
 * restore of the backup when this update took one, both printed and quoted. Without a backup it says why and gives no
 * restore steps, since there is nothing to restore.
 */
export function failureReport(step: string, commit: string, backup: string | { none: string }): string {
  const file = typeof backup === 'string' ? backup : null;
  return [
    `update stopped at ${step}; nothing was rolled back.`,
    typeof backup === 'string'
      ? `The checkout was at ${commit}; the backup taken before the change is ${backup}.`
      : `The checkout was at ${commit}; there is no backup from this update (${backup.none}).`,
    'To finish the update, fix what failed and run pnpm gmt update again: it carries on from the failed step.',
    'If the database was not migrated (the app never started on the new code), go back to the old code:',
    `  ${commandLine(['git', 'checkout', commit])} && pnpm install --frozen-lockfile && pnpm build && pnpm gmt start`,
    ...(file === null
      ? []
      : [
          'Otherwise restore the backup (docs/setup.md section 0, "Restore (native)"):',
          '  pnpm gmt stop',
          `  ${commandLine(['git', 'checkout', commit])}`,
          '  pnpm install --frozen-lockfile',
          '  pnpm build',
          `  ${commandLine(['pnpm', 'gmt', 'restore', file])}`,
          '  pnpm gmt start',
        ]),
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
  // why: spec §13: the plan stops the app and the browser worker (a refused agent is booted out the same way)
  const worker = entries.find((e) => e.name === 'camoufox-worker');
  const stop: Action[] = [
    ...(app === undefined ? [] : sm.stop(app.unit, appFacts)),
    ...(worker === undefined ? [] : sm.stop(worker.unit, factOf(facts, worker.unit))),
  ];
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
  const startPlan = async (o: { dryRun: boolean; withWorker: boolean }): Promise<Action[]> => {
    const now = await factsOf(deps, entries);
    const out: Action[] = [];
    for (const e of entries) {
      if (e.name === 'camoufox-worker') {
        if (!o.withWorker) continue;
        if (o.dryRun) {
          // why: ca-b1-018: the dry run names a standing refusal, since the real start runs the worker's check first
          const refusal = readStartRefusal(deps.platform.paths, deps.files);
          if (refusal !== 'none' && refusal !== 'unreadable')
            deps.io.out(
              `worker: ${refusalWithFix(refusal)} (the update starts it only once its check passes)\n`,
            );
        } else {
          // why: decision 75: the worker is re-rendered and started only while its own start check passes
          const start = await workerStart(deps, e, now);
          if (start.notStarted !== null) {
            deps.io.out(`worker: not started: ${start.notStarted}\n`);
            out.push(
              ...bootOutRefused(deps.platform, now, readStartRefusal(deps.platform.paths, deps.files)),
            );
          }
          out.push(...start.actions);
          continue;
        }
      }
      const install = sm.install(e.rendered, now);
      out.push(
        ...(e.name !== 'backup' && install.length === 0 ? sm.start(e.unit, factOf(now, e.unit)) : install),
      );
    }
    return out;
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
    if ((deps.files.list(join(deps.platform.paths.camoufoxRoot, 'browsers', 'official')) ?? []).length > 0)
      deps.io.out(DRY_RUN_LINE);
    deps.io.out(
      describePlan({
        command: 'update: start and wait',
        actions: [...(await startPlan({ dryRun: true, withWorker: true })), ...healthPlan],
        notes: [],
      }),
    );
    return EXIT.ok;
  }

  // why: W6 (dev-b1-006): the next bundle's download is network work too, done while the app still runs
  if (changeCode) {
    const pin = await git('show', `origin/main:${PIN_FILE}`);
    await camoufoxPrefetch(deps, pin.code === 0 ? pin.stdout : null);
  }
  const g = await guardActiveRun(deps, nativeTarget(settings, appFacts), {
    wait: flags.wait === true,
    force: flags.force === true,
  });
  if (!g.ok) return refuse(deps, g.message, EXIT.lockRefused);
  if (resuming) deps.io.out(`finishing the update to ${target}, from the step after ${state.step}\n`);
  const stopped = await apply(stopPlan, deps.executor);
  if (stopped.failed !== null) return refuse(deps, describeResult(stopPlan.command, stopped), EXIT.failed);
  let backup: string | { none: string } = resuming
    ? (state.backup ?? { none: 'none was recorded' })
    : { none: 'no code changed, so none was taken' };
  if (changeCode) {
    const b = await apply(backupPlan, deps.executor);
    const printed = b.failed === null ? printedBackup(b.outputs.at(-1) ?? '', dir) : null;
    if (b.failed !== null || printed === null || !printed.ok) {
      deps.io.err(
        `${b.failed === null ? '' : describeResult(backupPlan.command, b)}the backup before the update failed; the code is unchanged and the app is stopped: pnpm gmt start\n`,
      );
      return EXIT.failed;
    }
    const file = printed.file;
    backup = file;
    // why: U6 (pf-b1-009): the commit the backup goes with, beside it, so a restore can pick the matching code
    const sidecar = await apply(
      {
        command: 'update: record the backup’s commit',
        actions: [
          {
            kind: 'writeFile',
            path: `${file}.commit`,
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
    deps.io.out(`backup before the update: ${file} (taken at ${commit}; ${file}.commit says so)\n`);
  }
  for (const [step, actions] of codePlan(typeof backup === 'string' ? backup : null)) {
    const r = await apply({ command: `update: ${step}`, actions, notes: [] }, deps.executor);
    if (r.failed !== null) {
      deps.io.err(`${describeResult(`update: ${step}`, r)}${failureReport(step, from, backup)}`);
      return EXIT.failed;
    }
  }
  // why: spec §13: after the build and before the restart; the previous bundle goes only once the app is healthy. A
  // failed browser step never keeps the app down (CodeRabbit, PR #15): the app starts without the worker, and the
  // update reports the failure once the app is healthy
  const browser = await camoufoxUpdateStep(deps);
  if (!browser.ok) deps.io.err(browserFailureLine(browser.message));
  for (const [step, actions] of [
    ['the start', await startPlan({ dryRun: false, withWorker: browser.ok })],
    [
      'the health wait',
      [healthPlan[0], ...(browser.ok ? browser.after : []), ...healthPlan.slice(1)].filter(
        (a) => a !== undefined,
      ),
    ],
  ] as const) {
    const r = await apply({ command: `update: ${step}`, actions, notes: [] }, deps.executor);
    if (r.failed !== null) {
      deps.io.err(`${describeResult(`update: ${step}`, r)}${failureReport(step, from, backup)}`);
      return EXIT.failed;
    }
  }
  if (!browser.ok) {
    deps.io.err(`updated ${from} to ${target}, but not the browser install: run pnpm gmt browser install\n`);
    await statusCommand({}, null, deps);
    return EXIT.failed;
  }
  deps.io.out(
    commit === target && !resuming
      ? `the app is running again at ${target}\n`
      : `updated ${from} to ${target}\n`,
  );
  return statusCommand({}, null, deps);
}
