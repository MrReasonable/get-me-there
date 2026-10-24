import { basename } from 'node:path/posix';
import type { Flags } from '../args.js';
import { noAsk } from '../ask.js';
import { type Deps, EXIT } from '../deps.js';
import type { Files } from '../exec/files.js';
import { type Action, runAction } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describePlan, describeResult } from '../plan/describe.js';
import type { Platform } from '../platform/types.js';
import { factsOf, serviceSet } from '../services/set.js';
import { appServiceSpec, backupServiceSpec } from '../services/specs.js';
import { refuseOnWindows } from './lifecycle.js';
import { readSetupRecord } from './setup.js';

/** What uninstall removes and keeps (spec §13), exported for the e2e job's assertions. */
export function uninstallPaths(platform: Platform): { removed: string[]; kept: string[] } {
  const input = { execPath: '/node', checkout: '/', home: '/', paths: platform.paths };
  const units = [appServiceSpec(input), backupServiceSpec(input)].flatMap((s) =>
    platform.serviceManager.render(s, platform.paths).map((r) => r.path),
  );
  return {
    removed: [...units, ...(platform.paths.logs === null ? [] : [platform.paths.logs])],
    kept: [platform.paths.config, platform.paths.data, platform.paths.state],
  };
}

/** Why `--purge` must not delete a directory, or null: a symlink, the home, the root, or a name not get-me-there. */
export function purgeRefusal(path: string, home: string, files: Files): string | null {
  if (files.isSymlink(path)) return `${path} is a symbolic link`;
  if (path === home || `${path}/` === home) return `${path} is your home directory`;
  if (path === '/') return `${path} is the root directory`;
  if (basename(path) !== 'get-me-there') return `${path} is not named get-me-there`;
  return null;
}

/**
 * `gmt uninstall` (spec §13): stops and removes every service, timer and agent, removes the macOS log files, keeps and
 * prints the settings, data and state directories, and offers to turn off the linger setup turned on. `--purge` also
 * deletes those three, after the typed word `purge`, never non-interactively, and never a symlink, the home, the root
 * or a directory not named get-me-there.
 */
export async function uninstallCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const nonInteractive = flags['non-interactive'] === true;
  const ask = nonInteractive ? noAsk : deps.ask;
  const interactive = !nonInteractive && deps.io.stdinIsTTY;
  const p = deps.platform.paths;
  const purge = flags.purge === true;
  const purgeDirs = [p.config, p.data, p.state];
  if (purge) {
    if (!interactive) {
      deps.io.err('--purge never runs non-interactively: run pnpm gmt uninstall --purge in a terminal\n');
      return EXIT.refused;
    }
    const problems = purgeDirs
      .map((d) => purgeRefusal(d, deps.env.HOME ?? '', deps.files))
      .filter((x) => x !== null);
    if (problems.length > 0) {
      deps.io.err(`--purge refused, nothing was deleted: ${problems.join('; ')}\n`);
      return EXIT.refused;
    }
    deps.io.out(
      `--purge deletes these directories and everything in them:\n${purgeDirs.map((d) => `  ${d}`).join('\n')}\n`,
    );
    if (!(await ask.typed('Delete them?', 'purge'))) {
      deps.io.err('not purged; nothing was removed\n');
      return EXIT.refused;
    }
  }
  const entries = serviceSet(deps);
  const facts = await factsOf(deps, entries);
  const sm = deps.platform.serviceManager;
  const actions: Action[] = [
    ...entries.flatMap((e) => sm.remove(e.rendered, facts)),
    ...(p.logs !== null && deps.files.isDir(p.logs)
      ? [{ kind: 'remove' as const, path: p.logs, recursive: true }]
      : []),
    ...(purge
      ? purgeDirs
          .filter((d) => deps.files.isDir(d))
          .map((path): Action => ({ kind: 'remove', path, recursive: true }))
      : []),
  ];
  const plan = { command: 'uninstall', actions, notes: [] };
  if (flags['dry-run'] === true) {
    deps.io.out(describePlan(plan));
    return EXIT.ok;
  }
  const r = await apply(plan, deps.executor);
  if (r.failed !== null) {
    deps.io.err(describeResult('uninstall', r));
    return EXIT.failed;
  }
  if (deps.platform.os === 'linux' && readSetupRecord(deps).linger === 'enable' && interactive && !purge) {
    if (await ask.confirm(`Setup turned on linger for ${deps.username}; turn it off?`, false)) {
      const off = await apply(
        {
          command: 'linger',
          actions: [runAction(['loginctl', 'disable-linger', deps.username], '/')],
          notes: [],
        },
        deps.executor,
      );
      if (off.failed !== null)
        deps.io.out(`loginctl refused; run it yourself: sudo loginctl disable-linger ${deps.username}\n`);
    }
  }
  const paths = uninstallPaths(deps.platform);
  deps.io.out(
    `${[...paths.removed.map((x) => `removed: ${x}`), ...(purge ? purgeDirs.map((x) => `removed: ${x}`) : paths.kept.map((x) => `kept: ${x}`))].join('\n')}\n`,
  );
  return EXIT.ok;
}
