/**
 * The tool bootstrap (spec §7 SQLite settings, app_lock and Migrations; §5.5; §9 item 7): the second entrypoint in
 * apps/api. It reuses the config parse and port wiring, opens the operator's configured database (the production
 * ledger), never constructs or boots the engine (no sweep, no auto-resume, no cron), and holds app_lock as 'tool' for
 * its whole run. The one process.env read is here.
 */
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Clock, type Config, type Secret, syntheticAllowed, systemClock } from '@gmt/core';
import {
  AIRPORTS_DATA_DIR,
  AppLock,
  backupDatabase,
  HEARTBEAT_INTERVAL_MS,
  loadAirportsDataset,
  MIGRATIONS_DIR,
  openDatabase,
  pendingMigrations,
  readOnlyLockState,
  seedAirports,
} from '@gmt/db';
import { defaultRecordedRoot } from '@gmt/providers';
import { createLogger } from '../logger.js';
import { RECORDED_BY, recordPrecheck, runRecord, safeMessage } from '../tools/record.js';
import { parseRecordArgs, type RecordCli } from '../tools/recordPlan.js';
import { EXIT, type ToolContext, type ToolName } from '../tools/types.js';
import { isWorkedExampleRoute, WORKED_EXAMPLE_ROUTE_ARG } from '../tools/workedExample.js';
import { buildPorts, collectSecrets, InvalidConfigError, loadConfigFromEnv, type Ports } from '../wiring.js';

export { EXIT, type ToolName } from '../tools/types.js';

/** The tool runners runTool's switch dispatches to; tests replace them (ts-003). WP13 adds `smoke`. */
export interface ToolRunners {
  record(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number>;
}
const DEFAULT_RUNNERS: ToolRunners = { record: runRecord };

/** Where recordings go and the signature they carry; always given together (prov-wp04b-006, r2-ts-001). */
export interface RecordingTarget {
  root: string;
  recordedBy: string;
}

/** Test seams; production passes none of them (the entry point below calls runTool(name, argv)). */
export interface RunToolOptions {
  env?: NodeJS.ProcessEnv;
  runners?: Partial<ToolRunners>;
  out?: (line: string) => void;
  err?: (line: string) => void;
  logDestination?: NodeJS.WritableStream;
  clock?: Clock;
  migrationsDir?: string;
  /** Tests record into a temporary tree under a test signature; a real run never passes this. */
  recording?: RecordingTarget;
}

/** Spec §7 Migrations: keep the last 5 backups. */
const BACKUPS_KEPT = 5;

/** Spec §7: backups live beside the database (`/data/backups` in the container). */
export function backupsDirFor(databasePath: string): string {
  return join(dirname(databasePath), 'backups');
}

/**
 * Pending migrations on a database file that already exists (none for a new file or :memory:). why: this opens the file
 * read-write through openDatabase (journal-mode pragma, checkpoint on close) but changes no schema; only the app_lock
 * read before it is strictly read-only (arch-r2-003).
 */
export function pendingOnExistingDb(databasePath: string, migrationsDir: string): string[] {
  if (databasePath === ':memory:' || !existsSync(databasePath)) return [];
  const db = openDatabase(databasePath);
  try {
    return pendingMigrations(db, migrationsDir);
  } finally {
    db.close();
  }
}

/** The repository's root: the nearest ancestor of the committed recorded tree holding pnpm-workspace.yaml. */
export function repositoryRoot(): string {
  let dir = defaultRecordedRoot();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('repository root not found above the recorded tree');
    dir = up;
  }
  return realpathSync(dir);
}

/** The real path of `p`, or of its nearest existing ancestor with the rest appended (for a directory not made yet). */
function realOrAncestor(p: string): string {
  const abs = resolve(p);
  if (existsSync(abs)) return realpathSync(abs);
  const up = dirname(abs);
  return up === abs ? abs : join(realOrAncestor(up), abs.slice(up.length + 1));
}

/**
 * Where a record run writes, and under which signature (sec2-002, ruling 2026-10-15): the committed tree only for the
 * worked example's route; any other route needs `--out DIR` outside the repository, which writes DIR/fixtures/recorded.
 */
export function recordingTarget(
  cli: RecordCli,
  given: RecordingTarget | undefined,
): RecordingTarget | { refusal: string } {
  if (given !== undefined) return given;
  if (cli.out !== null) {
    const out = realOrAncestor(cli.out);
    const repo = repositoryRoot();
    if (out === repo || out.startsWith(`${repo}${sep}`))
      return {
        refusal: `--out ${cli.out} is inside the repository; recordings of other routes stay outside it`,
      };
    return { root: join(resolve(cli.out), 'fixtures', 'recorded'), recordedBy: RECORDED_BY };
  }
  if (!isWorkedExampleRoute(cli.args))
    return {
      refusal: `the committed recorded tree holds only the worked example (--route ${WORKED_EXAMPLE_ROUTE_ARG}); record any other route with --out DIR outside the repository`,
    };
  return { root: defaultRecordedRoot(), recordedBy: RECORDED_BY };
}

type Prepared =
  | {
      ok: true;
      precheck: string | null;
      target: RecordingTarget;
      run(ports: Ports, ctx: ToolContext): Promise<number>;
    }
  | { ok: false; code: number };

/** The per-tool part: argument parsing, where to record, and the configuration precheck. A switch, not a registry (arch-020). */
function prepare(
  name: ToolName,
  argv: readonly string[],
  config: Config,
  runners: ToolRunners,
  given: RecordingTarget | undefined,
  err: (l: string) => void,
): Prepared {
  switch (name) {
    case 'record': {
      const parsed = parseRecordArgs(argv);
      if (!parsed.ok) {
        err(parsed.message);
        return { ok: false, code: EXIT.usage };
      }
      const target = recordingTarget(parsed.value, given);
      if ('refusal' in target) {
        err(target.refusal);
        return { ok: false, code: EXIT.usage };
      }
      return {
        ok: true,
        precheck: recordPrecheck(config),
        target,
        run: (ports, ctx) => runners.record(ports, parsed.value, ctx),
      };
    }
    case 'smoke':
      err('smoke:live is not built yet; WP13 adds it');
      return { ok: false, code: EXIT.usage };
    default: {
      const unknown: never = name;
      err(`unknown tool ${String(unknown)}; expected record or smoke`);
      return { ok: false, code: EXIT.usage };
    }
  }
}

/**
 * Runs one tool and returns its exit code; every failure after the config parse maps to a code with a scrubbed
 * message, so nothing reaches the entry point's catch (sec2-001). Order (spec §5.5, §7, plan decision 20): config →
 * refuse NODE_ENV=test → refuse an open synthetic gate → arguments and recording target → precheck → data directory
 * writable → app_lock read-only → backup when migrations are pending → buildPorts (migrations) → app_lock('tool') →
 * seed airports → heartbeat → run → release on every path.
 */
export async function runTool(name: ToolName, argv: string[], opts: RunToolOptions = {}): Promise<number> {
  const err = opts.err ?? ((line: string) => void process.stderr.write(`${line}\n`));
  let secrets: readonly Secret[] = [];
  try {
    return await runToolSteps(name, argv, opts, err, (s) => {
      secrets = s;
    });
  } catch (e) {
    err(`tool failed: ${safeMessage(e, secrets)}`);
    return EXIT.failed;
  }
}

async function runToolSteps(
  name: ToolName,
  argv: string[],
  opts: RunToolOptions,
  err: (line: string) => void,
  knowSecrets: (s: readonly Secret[]) => void,
): Promise<number> {
  const out = opts.out ?? ((line: string) => void process.stdout.write(`${line}\n`));
  // why: the single process.env read (plan decision 9); NODE_ENV is read only through loadConfigFromEnv (sec-005)
  const env = opts.env ?? process.env;
  let config: Config;
  try {
    config = loadConfigFromEnv(env);
  } catch (e) {
    if (e instanceof InvalidConfigError) {
      err(e.message);
      return EXIT.badConfig;
    }
    throw e;
  }
  const secrets = collectSecrets(config);
  knowSecrets(secrets);
  if (config.nodeEnv === 'test') {
    err('tool bootstrap refuses NODE_ENV=test (spec §5.5)');
    return EXIT.refusedTestEnv;
  }
  if (syntheticAllowed(config)) {
    err(
      'tool bootstrap refuses while the synthetic gate is open (ALLOW_FIXTURE_PROVIDER with a .fixture.db path): recordings and the ledger never share a database with synthetic data (spec §5.5)',
    );
    // why: the plan's single exit-code table gives 70 to both refusals of synthetic data (NODE_ENV=test, open gate)
    return EXIT.refusedTestEnv;
  }
  const prepared = prepare(name, argv, config, { ...DEFAULT_RUNNERS, ...opts.runners }, opts.recording, err);
  if (!prepared.ok) return prepared.code;
  if (prepared.precheck !== null) {
    err(prepared.precheck);
    return EXIT.badConfig;
  }
  const clock = opts.clock ?? systemClock;
  const migrationsDir = opts.migrationsDir ?? MIGRATIONS_DIR;

  if (config.databasePath !== ':memory:') {
    try {
      accessSync(dirname(config.databasePath), constants.W_OK);
    } catch {
      err(`data directory ${dirname(config.databasePath)} is not writable; refusing (spec §7)`);
      return EXIT.preflightImpossible;
    }
  }
  let held: ReturnType<typeof readOnlyLockState>;
  try {
    // why: read-only, before any backup or migration, so a live app's schema is never touched (spec §7, decision 20)
    held = readOnlyLockState(config.databasePath, clock);
  } catch (e) {
    err(`cannot read app_lock in ${config.databasePath}: ${safeMessage(e, secrets)}; refusing (spec §7)`);
    return EXIT.preflightImpossible;
  }
  if (held.state === 'fresh') {
    err(
      `app_lock is held by ${held.holder} (heartbeat ${held.heartbeatAt}); stop it, or use POST /api/tools/${name} while the app runs (spec §7)`,
    );
    return EXIT.lockRefused;
  }
  let pending: string[];
  try {
    pending = pendingOnExistingDb(config.databasePath, migrationsDir);
  } catch (e) {
    err(`cannot read the migration state: ${safeMessage(e, secrets)}`);
    return EXIT.preflightImpossible;
  }
  if (pending.length > 0) {
    const backupsDir = backupsDirFor(config.databasePath);
    if (existsSync(backupsDir)) {
      try {
        if (!statSync(backupsDir).isDirectory()) throw new Error('not a directory');
        accessSync(backupsDir, constants.W_OK);
      } catch {
        err(
          `${pending.length} pending migration(s) but the backups directory ${backupsDir} is not a writable directory; refusing to migrate (spec §7)`,
        );
        return EXIT.preflightImpossible;
      }
    }
    try {
      // why: backupDatabase creates the directory itself, 0o700 (arch-015)
      const { file } = backupDatabase(config.databasePath, backupsDir, { keep: BACKUPS_KEPT, clock });
      out(`backup before ${pending.length} migration(s): ${file}`);
    } catch (e) {
      err(`backup failed, refusing to migrate (spec §7): ${safeMessage(e, secrets)}`);
      return EXIT.backupFailed;
    }
  }

  const log = createLogger(config, {
    fd: 2,
    secrets,
    ...(opts.logDestination === undefined ? {} : { destination: opts.logDestination }),
  }).child({ tool: name });
  out(`database: ${config.databasePath}`);
  let ports: Ports;
  try {
    ports = buildPorts(config, { log, clock, migrationsDir });
  } catch (e) {
    err(`tool failed while opening the database: ${safeMessage(e, secrets)}`);
    return EXIT.failed;
  }
  try {
    const lock = new AppLock(ports.db, 'tool', ports.clock, log);
    // why: waitMs 0 — a tool never queues behind the app; the operator uses POST /api/tools/* instead (spec §7). Only a
    // process that took the lock between the read-only check and here reaches the refusal (AppLock's own tests cover it).
    if (lock.acquire({ waitMs: 0 }) === 'refused') {
      const now = AppLock.inspect(ports.db);
      err(
        `app_lock is held by ${now?.holder ?? 'another process'} (heartbeat ${now?.heartbeatAt ?? 'unknown'}); stop it, or use POST /api/tools/${name} while the app runs (spec §7)`,
      );
      return EXIT.lockRefused;
    }
    out('tool lock acquired');
    const ac = new AbortController();
    let lockLost = false;
    const beat = setInterval(() => {
      try {
        lock.heartbeat();
      } catch (e) {
        // why: a throw inside a timer would kill the process with the execution left running (arch-014, cost-wp4b-007)
        lockLost = true;
        log.error({ error: safeMessage(e, secrets) }, 'app_lock heartbeat failed; aborting the tool');
        err(`app_lock lost (${safeMessage(e, secrets)}); aborting`);
        ac.abort();
      }
    }, HEARTBEAT_INTERVAL_MS);
    beat.unref();
    // why: `on`, not `once` — a second Ctrl-C must not kill the process with the lock held and the execution running
    // (r2-ts-005 e); the handler stays until the lock is released
    const onSignal = (): void => ac.abort();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    try {
      seedIfNeeded(ports, out);
      const code = await prepared.run(ports, {
        signal: ac.signal,
        out,
        err,
        recordedRoot: prepared.target.root,
        recordedBy: prepared.target.recordedBy,
      });
      return lockLost ? EXIT.lockRefused : code;
    } catch (e) {
      err(`tool failed: ${safeMessage(e, secrets)}`);
      return lockLost ? EXIT.lockRefused : EXIT.failed;
    } finally {
      clearInterval(beat);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      lock.release();
      out('tool lock released');
    }
  } finally {
    ports.db.close();
  }
}

/** Spec §7: seed after migration when `airports` is empty or the dataset version changed; local files, no network. */
function seedIfNeeded(ports: Ports, out: (line: string) => void): void {
  const dataset = loadAirportsDataset(AIRPORTS_DATA_DIR);
  if (ports.repos.airports.count() > 0 && ports.repos.airports.datasetVersion() === dataset.version) return;
  const r = seedAirports(ports.db, dataset);
  out(`airports seeded: ${r.inserted} rows, dataset ${r.datasetVersion}`);
}

/**
 * True when this module is the process entry. why: argv[1] may be a symlink (pnpm's bin links), so it is resolved; if
 * resolution fails the unresolved path is compared instead of silently skipping the run (arch-r2-006).
 */
export function isEntryPoint(
  script: string | undefined = process.argv[1],
  self: string = import.meta.url,
): boolean {
  if (script === undefined) return false;
  let resolved = script;
  try {
    resolved = realpathSync(script);
  } catch {
    // why: compare the path as given; a missing or unreadable argv[1] simply never equals this module's URL
  }
  return self === pathToFileURL(resolved).href;
}

// why: run only when executed directly, so tests import runTool without side effects.
if (isEntryPoint()) {
  const [name = '', ...rest] = process.argv.slice(2);
  if (name !== 'record' && name !== 'smoke') {
    process.stderr.write(`unknown tool "${name}"; expected record or smoke\n`);
    process.exitCode = EXIT.usage;
  } else {
    runTool(name, rest).then(
      (code) => {
        process.exitCode = code;
      },
      (e: unknown) => {
        // why: unreachable by design — runTool maps every failure to an exit code with secrets scrubbed; kept so an
        // unforeseen rejection still exits non-zero, URL-stripped
        process.stderr.write(`tool failed: ${safeMessage(e, [])}\n`);
        process.exitCode = EXIT.failed;
      },
    );
  }
}
