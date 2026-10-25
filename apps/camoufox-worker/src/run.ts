import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { isoDateTimeOfEpochMs } from '@gmt/core';
import { defaultDataDir, installDirFor, workerEnvFile } from './paths.js';
import { osArchOf } from './platform.js';
import { writeStartRefusal } from './refusalFile.js';

/**
 * The one launcher every worker script goes through (brief Task 14.1; decision 69 round 2, item 11; SEC-R2-006). It
 * resolves the data directory and `<data>/worker.env`, refuses (exit 78) when the directory is not 0700 or the file is
 * not 0600 and the user's own, parses that same file, and dispatches to the named entry. It is the worker's only
 * `process.env` reader: entries receive the environment as a value, built from the file's values plus PASS_THROUGH
 * only (fix round 1, sec I1: the inherited environment never overrides the file; an inherited CAMOUFOX_* or
 * POINT_OF_SALE that differs from the file, or a debug switch, refuses with 78). `process.env` is written exactly once,
 * by main(): CAMOUFOX_INSTALL_DIR, for camoufox-js (decision 73), after an inherited one is refused.
 */
export const EX_CONFIG = 78;
export const EX_SOFTWARE = 70;
export const EX_UNAVAILABLE = 69;

export type Env = Readonly<Record<string, string | undefined>>;

/** What an entry function receives. */
export interface EntryContext {
  env: Env;
  dataDir: string;
  args: string[];
  out: (line: string) => void;
  err: (line: string) => void;
}
export type Entry = (ctx: EntryContext) => Promise<number>;

export class EnvFileRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvFileRefused';
  }
}

interface ModeFacts {
  mode: number;
  uid: number;
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * Checks the data directory (0700, the user's own) and, when present, `worker.env` (0600, the user's own). Returns
 * whether the file exists. The mode check is on the file `run` then loads, so there is one path (SEC-R2-006).
 */
export function checkEnvFiles(
  dataDir: string,
  uid: number,
  stat: (p: string) => ModeFacts = statSync,
): { envFile: string; present: boolean } {
  let dir: ModeFacts;
  try {
    dir = stat(dataDir);
  } catch {
    throw new EnvFileRefused(
      `${dataDir} does not exist: create it with mkdir -p -m 700 (docs/setup.md section 14)`,
    );
  }
  if (!dir.isDirectory()) throw new EnvFileRefused(`${dataDir} is not a directory`);
  if ((dir.mode & 0o777) !== 0o700) throw new EnvFileRefused(`${dataDir} must be mode 0700 (chmod 700)`);
  if (dir.uid !== uid) throw new EnvFileRefused(`${dataDir} is not owned by this user`);
  const envFile = workerEnvFile(dataDir);
  let file: ModeFacts;
  try {
    file = stat(envFile);
  } catch {
    return { envFile, present: false };
  }
  if (!file.isFile()) throw new EnvFileRefused(`${envFile} is not a file`);
  if ((file.mode & 0o777) !== 0o600) throw new EnvFileRefused(`${envFile} must be mode 0600 (chmod 600)`);
  if (file.uid !== uid) throw new EnvFileRefused(`${envFile} is not owned by this user`);
  return { envFile, present: true };
}

/** What an entry may take from the inherited environment; everything else comes from worker.env. */
export const PASS_THROUGH: readonly string[] = ['HOME', 'PATH', 'TMPDIR', 'CAMOUFOX_DATA_DIR'];
/** Switches that make playwright-core write protocol traffic (the SOCS value among it) to the log. */
const DEBUG_SWITCHES: readonly string[] = ['DEBUG', 'PWDEBUG', 'DEBUG_FILE'];

/**
 * The entry's environment: PASS_THROUGH from `inherited`, then the file's values. Refuses a debug switch, and any
 * inherited CAMOUFOX_* (but CAMOUFOX_DATA_DIR) or POINT_OF_SALE whose value is not the file's, naming the variable
 * and never a value: camoufox-js and Playwright read `process.env` themselves, so it must agree with the file.
 */
export function entryEnv(inherited: Env, file: Env, envFile: string): Env {
  for (const name of DEBUG_SWITCHES)
    if (inherited[name] !== undefined && inherited[name] !== '')
      throw new EnvFileRefused(
        `${name} is set in the environment; unset it (it would log the browser's traffic)`,
      );
  for (const [name, value] of Object.entries(inherited)) {
    const ours = (name.startsWith('CAMOUFOX_') && name !== 'CAMOUFOX_DATA_DIR') || name === 'POINT_OF_SALE';
    if (ours && value !== undefined && value !== file[name])
      throw new EnvFileRefused(
        `${name} is set in the environment and differs from ${envFile}; unset it, or start the worker from a clean shell`,
      );
  }
  const env: Record<string, string | undefined> = {};
  for (const name of PASS_THROUGH) if (inherited[name] !== undefined) env[name] = inherited[name];
  return { ...env, ...file };
}

/** The data directory: CAMOUFOX_DATA_DIR when set (absolute; development), else ~/.local/state/get-me-there/camoufox. */
export function resolveDataDir(env: Env): string {
  const override = env.CAMOUFOX_DATA_DIR;
  if (override !== undefined && override !== '') {
    if (!isAbsolute(override)) throw new EnvFileRefused('CAMOUFOX_DATA_DIR must be an absolute path');
    return override;
  }
  const home = env.HOME;
  if (home === undefined || home === '') throw new EnvFileRefused('HOME is not set');
  return defaultDataDir(home);
}

export interface RunDeps {
  /** The inherited environment; read, never written. */
  env: Env;
  /**
   * The install directory main() set as CAMOUFOX_INSTALL_DIR for camoufox-js (decision 73), or null where no build is
   * pinned; the entry's environment carries it, so the launch can assert it before importing camoufox-js.
   */
  installDir?: string | null;
  uid: number;
  /** Reads worker.env's text (readFileSync by default). */
  readEnvFile?: (path: string) => string;
  entries: Readonly<Record<string, () => Promise<Entry>>>;
  /** Commands that may run before worker.env exists (capture-socs). */
  withoutEnvFile: ReadonlySet<string>;
  out: (line: string) => void;
  err: (line: string) => void;
  stat?: (p: string) => ModeFacts;
}

/** Runs one command; resolves to the process exit code. */
export async function run(argv: readonly string[], deps: RunDeps): Promise<number> {
  const [command = '', ...args] = argv;
  const load = deps.entries[command];
  if (load === undefined) {
    deps.err(`unknown command ${JSON.stringify(command)}; one of: ${Object.keys(deps.entries).join(', ')}`);
    return EX_CONFIG;
  }
  let dataDir: string | null = null;
  let env: Env;
  try {
    // why: CodeRabbit (PR #15): the data directory first, so this refusal too leaves its refusal file
    dataDir = resolveDataDir(deps.env);
    refuseInstallDir(deps.env);
    const { envFile, present } = checkEnvFiles(dataDir, deps.uid, deps.stat);
    if (!present && !deps.withoutEnvFile.has(command))
      throw new EnvFileRefused(`${envFile} is missing (docs/setup.md section 14)`);
    const file = present ? parseEnv((deps.readEnvFile ?? ((p) => readFileSync(p, 'utf8')))(envFile)) : {};
    if (file.CAMOUFOX_INSTALL_DIR !== undefined)
      throw new EnvFileRefused(
        `remove CAMOUFOX_INSTALL_DIR from ${envFile} (pnpm gmt browser install removes it): the worker sets it itself`,
      );
    const installDir = deps.installDir ?? null;
    env = {
      ...entryEnv(deps.env, file, envFile),
      ...(installDir === null ? {} : { CAMOUFOX_INSTALL_DIR: installDir }),
      ...(opensWindow(command, args) ? displayOf(deps.env) : {}),
    };
  } catch (e) {
    deps.err(e instanceof Error ? e.message : String(e));
    configRefusal(command, dataDir, deps);
    return EX_CONFIG;
  }
  const entry = await load();
  return entry({ env, dataDir, args, out: deps.out, err: deps.err });
}

/**
 * W1 (dev-b1-003): a refusal of the settings before any entry runs still explains itself: `main` leaves a `config`
 * refusal file in its data directory (when that is a directory of this user's), so status and start name it and a
 * refused agent is booted out; `check` prints the same `config` result for the CLI. The words stay on stderr.
 */
function configRefusal(command: string, dataDir: string | null, deps: RunDeps): void {
  const at = isoDateTimeOfEpochMs(Date.now());
  if (command === 'check') {
    deps.out(JSON.stringify({ reason: 'config', at }));
    return;
  }
  if (command !== 'main' || dataDir === null) return;
  try {
    const dir = (deps.stat ?? statSync)(dataDir);
    if (!dir.isDirectory() || dir.uid !== deps.uid) return;
    writeStartRefusal(dataDir, 'config', at);
  } catch (e) {
    deps.err(`the refusal file could not be written: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Decision 74: only the entries that open a window a person uses receive the display variables (`consent`, and
 * `record --consent-research`: sec-b1-006), in their two groups: DISPLAY with XAUTHORITY when DISPLAY is set,
 * WAYLAND_DISPLAY with XDG_RUNTIME_DIR when WAYLAND_DISPLAY is set; never DBUS_SESSION_BUS_ADDRESS.
 */
export const DISPLAY_GROUPS = [
  ['DISPLAY', 'XAUTHORITY'],
  ['WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR'],
] as const;
export const DISPLAY_NAMES: readonly string[] = DISPLAY_GROUPS.flat();
const opensWindow = (command: string, args: readonly string[]): boolean =>
  command === 'consent' || (command === 'record' && args.includes('--consent-research'));
function displayOf(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [main, extra] of DISPLAY_GROUPS) {
    const m = env[main];
    if (m === undefined || m === '') continue;
    out[main] = m;
    const x = env[extra];
    if (x !== undefined && x !== '') out[extra] = x;
  }
  return out;
}

/** An inherited CAMOUFOX_INSTALL_DIR is refused: the worker sets camoufox-js's install directory itself. */
export const INSTALL_DIR_INHERITED =
  'CAMOUFOX_INSTALL_DIR is set; the worker launches only from the install directory gmt setup made, which it sets itself';
function refuseInstallDir(env: Env): void {
  if (env.CAMOUFOX_INSTALL_DIR !== undefined) throw new EnvFileRefused(INSTALL_DIR_INHERITED);
}

/**
 * The install directory for this process (decision 73): `installDirFor` of the platform's entry under HOME, or null
 * where no build is pinned or HOME is unset (the commands that need it refuse later). Refuses an inherited value.
 */
export function installDirSetting(env: Env, platform: string, arch: string): string | null {
  refuseInstallDir(env);
  const osArch = osArchOf(platform, arch);
  const home = env.HOME;
  return osArch === null || home === undefined || !isAbsolute(home) ? null : installDirFor(osArch, home);
}

/** The entry functions, loaded lazily so a command loads only its own modules. */
export const ENTRIES: Readonly<Record<string, () => Promise<Entry>>> = {
  main: async () => (await import('./main.js')).entry,
  record: async () => (await import('./record.js')).entry,
  status: async () => (await import('./status.js')).entry,
  'clear-signed-in': async () => (await import('./clearSignedIn.js')).entry,
  'capture-socs': async () => (await import('./captureSocs.js')).entry,
  check: async () => (await import('./startRefusal.js')).entry,
  counts: async () => (await import('./counts.js')).entry,
  consent: async () => (await import('./consent.js')).entry,
};

/** The process entry: the live environment, this user's uid and the real stdout and stderr. */
export async function main(argv: readonly string[], entries = ENTRIES): Promise<number> {
  try {
    // why: the inherited environment as it was, before the one write below
    const inherited: Env = { ...process.env };
    let installDir: string | null;
    try {
      installDir = installDirSetting(inherited, process.platform, process.arch);
    } catch {
      // why: CodeRabbit (PR #15): run() refuses the inherited setting itself, writing the refusal file and check's line
      installDir = null;
    }
    // why: decision 73: the worker's one write to process.env (scripts/check-boundaries.mjs allows exactly this one):
    // camoufox-js reads CAMOUFOX_INSTALL_DIR once, when its module is evaluated, so it is set before any entry can
    // import it; launch.ts asserts the entry's copy before importing
    if (installDir !== null) process.env.CAMOUFOX_INSTALL_DIR = installDir;
    return await run(argv, {
      env: inherited,
      installDir,
      uid: process.getuid?.() ?? -1,
      entries,
      withoutEnvFile: new Set(['capture-socs']),
      out: (l) => process.stdout.write(`${l}\n`),
      err: (l) => process.stderr.write(`${l}\n`),
    });
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return EX_SOFTWARE;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
