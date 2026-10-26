import { dirname, join, sep } from 'node:path/posix';
import { PAGE_TIMEOUT_MAX_SECONDS } from '@gmt/core';
import type { Files } from '../exec/files.js';
import type { Paths, ServiceSpec } from '../platform/types.js';

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
    stopSeconds: 30,
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
    stopSeconds: 30,
    calendar: { hour: 3, minute: 30 },
  };
}

/** How long a stop waits for the worker: the longest page plus 30 s to close the browser (W7). */
export const WORKER_STOP_SECONDS = PAGE_TIMEOUT_MAX_SECONDS + 30;

/**
 * The bound on a wait after a stop (U5): the service's own stop timeout (the worker's 270 s, else 30 s) plus 15 s for the
 * service manager to let it go. launchd's label wait, systemd's inactive wait and the worker's lock wait all use it.
 */
export const stopWaitSeconds = (name: ServiceSpec['name']): number =>
  (name === 'camoufox-worker' ? WORKER_STOP_SECONDS : 30) + 15;

/**
 * The one argv that runs the worker's `run.ts <entry>` under tsx, and its directory (ca-b1-011): the service runs
 * `main`, `gmt start` and setup run `check --json`, `gmt browser counts` runs `counts`, so the pre-check judges the
 * worker exactly as the service starts it.
 */
export function workerRunArgv(
  i: Pick<SpecInput, 'execPath' | 'checkout'>,
  ...args: string[]
): { argv: string[]; cwd: string } {
  const pkg = join(i.checkout, 'apps', 'camoufox-worker');
  return {
    argv: [i.execPath, '--conditions=@gmt/source', '--import', 'tsx', join(pkg, 'src', 'run.ts'), ...args],
    cwd: pkg,
  };
}

/**
 * The browser worker (spec §13; brief WP17 Task 17.6): `<node> --conditions=@gmt/source --import tsx
 * <checkout>/apps/camoufox-worker/src/run.ts main` from that package's directory, with `PATH` and `HOME` only. A refused
 * start (exit 78) is never retried every minute: systemd's RestartPreventExitStatus=78, and on macOS, where launchd's
 * KeepAlive cannot exclude one code, a 600 s ThrottleInterval while start, status and update boot a refused agent out.
 */
export function workerServiceSpec(i: SpecInput): ServiceSpec {
  const run = workerRunArgv(i, 'main');
  return {
    name: 'camoufox-worker',
    argv: run.argv,
    workingDirectory: run.cwd,
    environment: serviceEnvironment(i.execPath, i.home),
    restart: 'on-failure',
    preventRestartExitStatus: 78,
    throttleSeconds: 600,
    // why: W7 (dev-b1-007): a page in flight finishes before the worker exits, so its stop waits out the longest page
    stopSeconds: WORKER_STOP_SECONDS,
    calendar: null,
  };
}

/**
 * The Node path to record in the services (U5, dev-b1-002, po-b1-004): `process.execPath` is resolved through every
 * symlink, which on Homebrew is a versioned Cellar path a `brew upgrade` deletes. So the first `node` on PATH that is
 * the same binary is recorded unresolved, else Homebrew's `opt/<formula>` link for that keg, else the path itself.
 */
export function stableNodePath(
  execPath: string,
  pathDirs: readonly string[],
  files: Pick<Files, 'realpath'>,
): string {
  // why: CodeRabbit (PR #11): a candidate that cannot be resolved (EACCES, ELOOP) is not the same binary; main.ts
  // calls this while it builds deps, so one unreadable PATH entry must not stop every command
  const resolve = (p: string): string | null => {
    try {
      return files.realpath(p);
    } catch {
      return null;
    }
  };
  const real = resolve(execPath) ?? execPath;
  const cellar = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/.exec(real);
  const candidates = [
    ...pathDirs.filter((d) => d !== '').map((d) => join(d, 'node')),
    ...(cellar === null ? [] : [join(cellar[1] ?? '', 'opt', cellar[2] ?? '', 'bin', 'node')]),
  ];
  return candidates.find((c) => c !== real && resolve(c) === real) ?? execPath;
}

/** The one loopback rule (setup's note and status's warning): any 127/8 address, `::1` and `localhost`. */
export const isLoopback = (address: string): boolean =>
  /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|localhost)$/.test(address);

// why: \p{Cc} is every C0 and C1 control character, newline and tab included
const CONTROL = /\p{Cc}/u;

/** U8 (sec-b1-006): the first of these values (named by key) holding a control character, as a sentence; or null. */
export function controlProblem(values: Readonly<Record<string, string>>): string | null {
  for (const [name, v] of Object.entries(values))
    if (CONTROL.test(v)) return `the ${name} path holds a control character (a newline or similar)`;
  return null;
}

/** Throws when a spec holds a control character, so no renderer writes a line its reader would split. */
export function assertPrintable(spec: ServiceSpec): void {
  const values = [...spec.argv, spec.workingDirectory, spec.environment.PATH, spec.environment.HOME];
  if (values.some((v) => CONTROL.test(v)))
    throw new Error(`the ${spec.name} service would hold a control character in a path; refused`);
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
const STABLE_NODE: Record<'darwin' | 'linux', string> = {
  darwin: '/opt/homebrew/opt/node@22/bin/node (brew install node@22)',
  linux: '/usr/bin/node (the distribution’s or NodeSource’s nodejs package)',
};

/**
 * Spec §13: every service runs the Node binary setup ran under, so it must stay where it is. A path inside a temporary
 * directory (or one of `tmpDirs`, the machine's own) or a version manager's shim directory is refused, naming a stable
 * one; null when the path is fine.
 */
export function execPathProblem(
  execPath: string,
  os: 'darwin' | 'linux',
  tmpDirs: readonly string[],
): string | null {
  const temps = [...TEMP_DIRS, ...tmpDirs.map((d) => (d.endsWith(sep) ? d : `${d}${sep}`))];
  const where = temps.some((d) => execPath.startsWith(d))
    ? 'a temporary directory'
    : SHIM_DIRS.some((d) => execPath.includes(d))
      ? 'a version manager’s shim directory'
      : null;
  if (where === null) return null;
  return `Node at ${execPath} is inside ${where}, which can change or vanish under a service; run setup with a stable Node such as ${STABLE_NODE[os]}`;
}
