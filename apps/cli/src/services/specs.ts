import { dirname, join, sep } from 'node:path';
import type { Os, Paths, ServiceSpec } from '../platform/types.js';

/** What every service spec is built from: the recorded Node binary, the checkout, the home and the platform's paths. */
export interface SpecInput {
  execPath: string;
  checkout: string;
  home: string;
  paths: Paths;
}

/** The settings file every app-side service reads with `--env-file` (spec §12). */
export const appEnvPath = (paths: Paths): string => join(paths.config, 'app.env');
/** The native database (spec §12: `DATABASE_PATH`). */
export const databasePath = (paths: Paths): string => join(paths.data, 'get-me-there.db');
/** The daily job's own backups directory, so the app's pre-migration pruning never touches it (spec §13). */
export const dailyBackupsDir = (paths: Paths): string => join(paths.data, 'backups', 'daily');
export const DAILY_BACKUPS_KEPT = 14;

/**
 * A service's whole environment: `PATH` (the recorded Node's directory first, then the system directories) and `HOME`.
 * Nothing else is inherited, so no shell variable can override a line of `app.env` (spec §12).
 */
export function serviceEnvironment(execPath: string, home: string): { PATH: string; HOME: string } {
  const dirs = [dirname(execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return { PATH: [...new Set(dirs)].join(':'), HOME: home };
}

/** The app: `<node> --env-file=<app.env> <checkout>/apps/api/dist/bootstrap/start.js`, restarted on failure. */
export function appServiceSpec(i: SpecInput): ServiceSpec {
  return {
    name: 'app',
    argv: [
      i.execPath,
      `--env-file=${appEnvPath(i.paths)}`,
      join(i.checkout, 'apps', 'api', 'dist', 'bootstrap', 'start.js'),
    ],
    workingDirectory: i.checkout,
    environment: serviceEnvironment(i.execPath, i.home),
    restart: 'on-failure',
    preventRestartExitStatus: null,
    throttleSeconds: 60,
    calendar: null,
  };
}

/** The daily backup job: `scripts/backup.mjs --dir <data>/backups/daily --keep 14` at 03:30, never restarted. */
export function backupServiceSpec(i: SpecInput): ServiceSpec {
  return {
    name: 'backup',
    argv: [
      i.execPath,
      `--env-file=${appEnvPath(i.paths)}`,
      join(i.checkout, 'scripts', 'backup.mjs'),
      '--dir',
      dailyBackupsDir(i.paths),
      '--keep',
      String(DAILY_BACKUPS_KEPT),
    ],
    workingDirectory: i.checkout,
    environment: serviceEnvironment(i.execPath, i.home),
    restart: 'never',
    preventRestartExitStatus: null,
    throttleSeconds: 60,
    calendar: { hour: 3, minute: 30 },
  };
}

/** Version managers' shim directories, whose `node` is a launcher that can change or vanish under a service. */
const SHIM_DIRS = [
  `${sep}.volta${sep}bin${sep}`,
  `${sep}.asdf${sep}shims${sep}`,
  `${sep}fnm_multishells${sep}`,
];
const TEMP_DIRS = [
  '/tmp/',
  '/private/tmp/',
  '/var/tmp/',
  '/private/var/tmp/',
  '/var/folders/',
  '/private/var/folders/',
];

/** A stable Node for the OS, named in the refusal. */
const STABLE_NODE: Record<Os, string> = {
  darwin: '/opt/homebrew/opt/node@22/bin/node (brew install node@22)',
  linux: '/usr/bin/node (the distribution’s or NodeSource’s nodejs package)',
  win32: 'node.exe from the Node installer',
};

/**
 * Spec §13: every service runs the Node binary setup ran under, so it must stay where it is. A path inside a temporary
 * directory (or one of `tmpDirs`, the machine's own) or a version manager's shim directory is refused, naming a stable
 * one; null when the path is fine.
 */
export function execPathProblem(execPath: string, os: Os, tmpDirs: readonly string[]): string | null {
  const temps = [...TEMP_DIRS, ...tmpDirs.map((d) => (d.endsWith(sep) ? d : `${d}${sep}`))];
  const where = temps.some((d) => execPath.startsWith(d))
    ? 'a temporary directory'
    : SHIM_DIRS.some((d) => execPath.includes(d))
      ? 'a version manager’s shim directory'
      : null;
  if (where === null) return null;
  return `Node at ${execPath} is inside ${where}, which can change or vanish under a service; run setup with a stable Node such as ${STABLE_NODE[os]}`;
}
