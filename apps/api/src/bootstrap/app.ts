/**
 * The app bootstrap (spec §4, §5.5, §7, §12, §13): the process that serves the API and the SPA and runs the engine.
 * Order (plan "Wiring and bootstraps", decisions 53, 58): refuse NODE_ENV=test → refuse a database moved to a native
 * install (spec §13, the MOVED-TO-NATIVE marker) → re-assert the auth invariants → data
 * directory writable → `app_lock` read-only, waiting while it is fresh → backup preflight when migrations are pending
 * (WP4b's preflight.ts, decision 32) → openDatabase (migrations) → `AppLock('app')` and the 30 s heartbeat → the stored
 * settings laid over the environment and imports written (settings plan ruling 3, loadConfig) → buildFromDb → seed +
 * airport sanity check under the lock (as the tool bootstrap seeds) → createEngine → engine.boot() → serve. Everything
 * before the lock runs on the boot config, the environment with the owned names left out. Shutdown: stop accepting → engine.shutdown() →
 * wal_checkpoint(TRUNCATE) → lock release → close (spec §7 order). A boot that fails after taking the lock releases
 * it and stops the heartbeat before the database closes.
 */
import { randomUUID } from 'node:crypto';
import {
  type Clock,
  type Config,
  type Logger,
  microGbpToPence,
  reachBeyondThisMachine,
  reachRefusal,
  runModeOf,
  type Secret,
  systemClock,
} from '@gmt/core';
import { AppLock, type Db, HEARTBEAT_INTERVAL_MS, sanityCheckAirports, WalUnavailableError } from '@gmt/db';
import { buildNotifiers, EmailNotifier, type Engine } from '@gmt/engine';
import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import { searchApiAccountFor } from '../read/searchApiAccount.js';
import { planOf, providerBudget, spendWarnings } from '../read/usage.js';
import type { AppEnv, HttpToolRunners } from '../routes/types.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import { inProcessTools } from '../tools/inProcess.js';
import { EXIT } from '../tools/types.js';
import {
  addSecrets,
  bootSecrets,
  buildFromDb,
  InvalidConfigError,
  type LoadedConfig,
  loadBootConfig,
  loadConfig,
  logSettingsLoaded,
  openDatabase,
  type Ports,
} from '../wiring.js';
import { engineFor } from './engine.js';
import { BootError } from './errors.js';
import { waitForLockFree } from './lock.js';
import { type AssetPaths, assetPaths } from './paths.js';
import { backupBeforeMigrations, dataDirRefusal, movedDatabaseRefusal } from './preflight.js';
import { createReloader } from './reload.js';
import { seedIfNeeded } from './seed.js';
import { readVersion } from './version.js';

/**
 * In-process shutdown deadline. why: it sits below compose's 30 s `stop_grace_period`, so a hung shutdown ends here
 * (lock released through release(), exit non-zero) instead of by SIGKILL, which leaves the lock for the next start to
 * wait out for 90 s.
 */
export const SHUTDOWN_DEADLINE_MS = 25_000;

/** close() ran past SHUTDOWN_DEADLINE_MS; already logged once where it was thrown. */
export class ShutdownTimeoutError extends Error {
  constructor() {
    super(`shutdown did not finish within ${SHUTDOWN_DEADLINE_MS} ms`);
    this.name = 'ShutdownTimeoutError';
  }
}

export interface BootDeps {
  /**
   * The boot config (settings plan ruling 3): the environment with the Settings page's names left out
   * (loadBootConfig). The refusals, the lock wait, the backup and the migrations read it; tests inject one.
   */
  config: Config;
  /** The environment the stored settings are laid over under the lock (loadConfig); the full config comes from both. */
  env: Record<string, string | undefined>;
  log: Logger;
  /**
   * The list `log` scrubs (createLogger's `secrets`), which the boot extends with every secret of the full config and
   * every stored secret, so a line logged after the lock never carries one. Absent in tests that log nowhere real.
   */
  logSecrets?: Secret[];
  clock?: Clock;
  /** false in tests that drive the app with `app.request()`. */
  listen: boolean;
  assets: AssetPaths;
  /** Builds the in-process tool runners once ports exist (`main` passes `inProcessTools`). */
  tools?: (ports: Ports) => HttpToolRunners;
  /** `HOME`, the one place the environment is read for it: the Status report finds the worker's refusal file under it. */
  home?: string | null;
  /** The build's short SHA (`dist/version.json`), shown by the Status report; "unknown" when absent. */
  version?: string;
  /** Injected by tests to advance a fixed clock instead of waiting for app_lock. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Settings plan ruling 6: false on a pass after a restart in place, whose own close released the lock: the lock is
   * then taken without the read-only wait for another holder (a holder found is refused, as always). Default true.
   */
  lockWait?: boolean;
}

export interface RunningApp {
  app: Hono<AppEnv>;
  ports: Ports;
  engine: Engine;
  port: number | null;
  /** Settings plan ruling 6: random per pass (`GET /api/health` `bootId`). */
  bootId: string;
  /**
   * Settings plan ruling 6: settles once the app has closed, `'reload'` when a save closed it for the next pass of
   * `main`, `'stopped'` when `close()` did (a signal); rejects with the close's own failure.
   */
  closed: Promise<'reload' | 'stopped'>;
  /** Closes the app for good (spec §7 shutdown order); a second call answers the close already in progress. */
  close(): Promise<void>;
}

/**
 * Spec §4, review SEC-3: the invariants `loadConfigFromEnv` enforces, re-asserted on the injected config, so no caller
 * of `bootApp` can serve without a password while something other than this machine can reach it (core's one rule), or
 * with no allowed host. 78, as a config error.
 */
export function assertAuthInvariants(config: Config, log: Logger): void {
  if (config.allowedHosts.length === 0)
    throw new BootError('ALLOWED_HOSTS is empty; refusing to serve', EXIT.badConfig);
  if (config.auth !== null && config.auth.pass.reveal().length < 12)
    throw new BootError('APP_BASIC_AUTH_PASS must be at least 12 characters', EXIT.badConfig);
  if (config.auth !== null) return;
  const reach = reachBeyondThisMachine(config);
  if (reach === null) return;
  if (!config.allowUnauthenticated) {
    // why: devops-final-001: the same words as config's refusal, so the fix named is the one that works in this mode
    const r = reachRefusal(reach, runModeOf(config));
    throw new BootError(`${r.field}: ${r.message}`, EXIT.badConfig);
  }
  log.warn(
    { bindAddress: config.bindAddress, reach },
    'serving without auth beyond this machine (ALLOW_UNAUTHENTICATED)',
  );
}

/**
 * Devops-final-002, spec §12: one info line naming each configured provider's plan, window and schedule exclusion and
 * the monthly spend cap, so `docker compose logs` says what the app will spend; and, by ruling 5, the warning only when
 * a provider's calls cost money under a zero spend cap. No secret is logged: ids, plan names and numbers only.
 */
export function logProvidersConfigured(ports: Pick<Ports, 'config' | 'providers'>, log: Logger): void {
  const { config } = ports;
  log.info(
    {
      providers: ports.providers.map((p) => {
        const b = providerBudget(config, p.id);
        return {
          id: p.id,
          plan: planOf(config, p.id),
          window: b.window,
          excludedFromSchedule: b.excludedFromSchedule,
        };
      }),
      monthlySpendCapPence: microGbpToPence(config.spend.monthlyCapMicroGbp),
    },
    'providers configured',
  );
  // why: cost-006: the same fee sum budgetFit and GET /budget use (the guard's own entries), against the global cap.
  const warn = spendWarnings(
    config,
    ports.providers.map((p) => p.id),
  );
  if (warn.zeroCapBlocked.length > 0)
    log.warn({ providers: warn.zeroCapBlocked }, API_TEXT.zeroCapBootWarning);
  if (warn.belowFees !== null)
    log.warn(
      { field: 'MONTHLY_SPEND_CAP_PENCE' },
      API_TEXT.spendCapBelowFees(warn.belowFees.capPence, warn.belowFees.feesPence),
    );
}

function listen(app: Hono<AppEnv>, config: Config): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bindAddress }, (info) =>
      resolve({ server, port: info.port }),
    );
    server.once('error', reject);
  });
}

function closeServer(server: ServerType | null): Promise<void> {
  return new Promise((resolve) => (server === null ? resolve() : server.close(() => resolve())));
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Everything the app process does at start, with config injected (spec §5.5 boot matrix), in the order above. Every
 * refusal carries the plan's exit code: 70 NODE_ENV=test, 78 a broken auth invariant, 73 an unwritable data or
 * backups directory or an unreadable lock, 75 app_lock held by a live process, 74 a failed backup, 1 anything else.
 */
export async function bootApp(deps: BootDeps): Promise<RunningApp> {
  const { config, log } = deps;
  const clock = deps.clock ?? systemClock;
  // why: one list for every scrub this boot does; the full config's and the stored secrets join it under the lock
  const secrets: Secret[] = deps.logSecrets ?? [];
  addSecrets(secrets, bootSecrets(config, deps.env));
  // why: spec §5.5: both bootstraps refuse NODE_ENV=test, so a test config can never serve traffic.
  if (config.nodeEnv === 'test')
    throw new BootError('the app bootstrap refuses NODE_ENV=test (spec §5.5)', EXIT.refusedTestEnv);
  // why: spec §13 — a database moved to a native install is never opened here again: refused before migrations, the
  // boot sweep, auto-resume and cron, as a configuration fault (78)
  const moved = movedDatabaseRefusal(config.databasePath, config.inContainer);
  if (moved !== null) throw new BootError(moved, EXIT.badConfig);
  assertAuthInvariants(config, log);
  const dataDir = dataDirRefusal(config.databasePath);
  if (dataDir !== null) throw new BootError(dataDir, EXIT.preflightImpossible);
  if (deps.lockWait !== false)
    await waitForLockFree({
      databasePath: config.databasePath,
      clock,
      sleep: deps.sleep ?? realSleep,
      log,
      secrets,
    });
  const backup = backupBeforeMigrations(config.databasePath, deps.assets.migrationsDir, clock, secrets);
  if (!backup.ok) throw new BootError(backup.message, backup.code);
  if (backup.line !== null) log.info({}, backup.line);
  let db: Db;
  try {
    db = openDatabase(config.databasePath, deps.assets.migrationsDir);
  } catch (e) {
    // why: dm-003: a data directory whose file system refuses WAL is a preflight refusal (73), named, not a crash.
    if (e instanceof WalUnavailableError) throw new BootError(e.message, EXIT.preflightImpossible);
    throw e;
  }
  const lock = new AppLock(db, 'app', clock, log);
  let heartbeat: NodeJS.Timeout | null = null;
  let booted: Engine | null = null;
  try {
    // why: plan decision 58: the lock is taken right after the migrations, as the tool bootstrap takes it, so airports are
    // seeded under it. The read-only wait found it free; a process that took it since is caught here, without a wait.
    if (lock.acquire({ waitMs: 0 }) === 'refused')
      throw new BootError(
        'app_lock was taken by another process during boot; refusing to start',
        EXIT.lockRefused,
      );
    heartbeat = setInterval(() => {
      try {
        lock.heartbeat();
      } catch (e) {
        // why: a throw inside a timer would kill the process with executions running; log it and keep serving reads.
        log.error({ err: { message: safeMessage(e, secrets) } }, 'app_lock heartbeat failed');
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    // why: settings plan ruling 3: the stored settings are read, laid over the environment and imported under the lock,
    // so the guard, providers and notifier below are built from the full config; a refusal of a name Settings does not
    // own is a configuration fault (78), as the first parse's is
    let loaded: LoadedConfig;
    try {
      loaded = loadConfig(deps.env, db, { clock, writeImports: true });
    } catch (e) {
      if (e instanceof InvalidConfigError) throw new BootError(e.message, EXIT.badConfig);
      throw e;
    }
    // why: before anything else is built, so a failure from here on that quotes a stored key is scrubbed of it
    addSecrets(secrets, loaded.secrets);
    const ports = buildFromDb(loaded.config, db, {
      log,
      clock,
      settingsReport: {
        imported: loaded.imported,
        envIgnored: loaded.envIgnored,
        setAside: loaded.setAside,
      },
    });
    logSettingsLoaded(loaded, log);
    seedIfNeeded(ports, deps.assets.airportsDataDir, (line) => log.info({}, line));
    // Spec §7 (revision 55): at least 5,000 airports with tz, and every airport a live (not soft-deleted) definition
    // references exists, scheduled or not: a manual run of an unscheduled search reads its airports too.
    const referenced = ports.repos.definitions.list().flatMap((d) => [...d.origins, ...d.destinations]);
    const sanity = sanityCheckAirports(ports.db, referenced);
    if (!sanity.ok) throw new BootError(`airport sanity check failed: ${sanity.reason}`, EXIT.failed);
    // why: spec §8.1, §8.3 — WP11's alert runner as the alerts step, the notifiers config asks for (engine.ts).
    const home = deps.home ?? null;
    const notifiers = buildNotifiers(ports.config, log, ports.clock);
    // why: settings plan ruling 6 — a save restarts the app in place once nothing is in flight; the engine tells the
    // reloader of each run's and each flight read's end. Both refer to each other, so the engine is bound once built.
    let engineRef: Engine | null = null;
    let close: (why: 'reload' | 'stopped') => Promise<void> = () => Promise.resolve();
    const reloader = createReloader({
      idle: () =>
        ports.repos.executions.oldestInFlight() === null &&
        (engineRef?.flightReadInFlight() ?? null) === null,
      hold: () => engineRef?.holdForReload(),
      reload: () => {
        // why: the close's own failure is answered through `closed`, which main awaits
        close('reload').catch(() => undefined);
      },
      log,
      secrets,
    });
    // why: settings plan ruling 10 — SearchApi's balance is read again after a run that called SearchApi, so the cache is
    // told of each run's end beside the reloader
    const searchApiAccount = searchApiAccountFor(ports);
    const engine = engineFor(ports, log, {
      notifiers,
      home,
      runWatch: {
        started: () => reloader.watch.started(),
        // why: the restart check first, so a failure of the balance cache can never delay or lose it; the cache's own
        // failure is logged and never thrown into the run registry's settle
        ended: () => {
          reloader.watch.ended();
          try {
            searchApiAccount.runEnded();
          } catch (e) {
            log.error(
              { err: { message: safeMessage(e, secrets) } },
              'the SearchApi balance cache check failed',
            );
          }
        },
      },
    });
    engineRef = engine;
    booted = engine;
    await engine.boot();
    logProvidersConfigured(ports, log);
    // why: spec §10 /alerts/test-email goes through the same email notifier (and its hourly ceiling) as every alert
    const email = notifiers.find((n) => n instanceof EmailNotifier);
    const bootId = randomUUID();
    const app = createApp(ports, engine, {
      webRoot: deps.assets.webRoot,
      tools: deps.tools?.(ports) ?? {},
      status: {
        home,
        version: deps.version ?? 'unknown',
        startedAt: clock.now(),
        migrationsDir: deps.assets.migrationsDir,
      },
      ...(email === undefined ? {} : { email }),
      bootId,
      reload: reloader,
      searchApiAccount,
      settingsEnv: deps.env,
      // why: a request's secret joins the log's list (this boot's) and the ports' (http-kit, the error handler)
      scrub: (more) => {
        addSecrets(secrets, more);
        addSecrets(ports.secrets, more);
      },
    });
    const bound = deps.listen ? await listen(app, ports.config) : null;
    const beat = heartbeat;
    let closing: Promise<void> | null = null;
    let reason: 'reload' | 'stopped' = 'stopped';
    let settle: { resolve: (why: 'reload' | 'stopped') => void; reject: (e: unknown) => void } = {
      resolve: () => undefined,
      reject: () => undefined,
    };
    const closed = new Promise<'reload' | 'stopped'>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // why: a caller that only calls close() (tests, the tool paths) never awaits `closed`; its failure is close()'s own
    closed.catch(() => undefined);
    close = (why) => {
      if (closing !== null) return closing;
      reason = why;
      // why: a signal's close stops any restart a save was waiting for; a restart's own close is the one in progress
      reloader.stop();
      closing = closeApp().then(
        () => settle.resolve(reason),
        (e: unknown) => {
          settle.reject(e);
          throw e;
        },
      );
      return closing;
    };
    const closeApp = async (): Promise<void> => {
      clearInterval(beat);
      // why: review arch Minor: a shutdown or checkpoint that throws must still release the lock and close the
      // handle, or the next start waits out APP_LOCK_WAIT_MS on a lock nobody holds.
      // why: review devops M4 — a hang in server.close or engine.shutdown would otherwise run into compose's SIGKILL
      // at 30 s and cost the next start a 90 s stale-lock wait; past the deadline we give up, release the lock
      // ourselves and let the caller exit non-zero. unref: the timer alone never keeps the process alive.
      let deadline: NodeJS.Timeout | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          log.error(
            { deadlineMs: SHUTDOWN_DEADLINE_MS },
            'shutdown timed out; releasing the app_lock and exiting',
          );
          reject(new ShutdownTimeoutError());
        }, SHUTDOWN_DEADLINE_MS);
        deadline.unref();
      });
      try {
        await Promise.race([
          (async () => {
            await closeServer(bound?.server ?? null); // stop accepting
            searchApiAccount.close();
            await engine.shutdown();
            // why: spec §7 releases the lock after the checkpoint; db.close() checkpoints again, harmlessly.
            db.checkpoint();
          })(),
          timedOut,
        ]);
      } finally {
        clearTimeout(deadline);
        // why: review T12 — past the deadline the engine's own wait may still be running; marked closed first, a job
        // that finishes after this writes nothing to the handle closed below
        engine.markClosed();
        lock.release();
        db.close();
      }
      log.info(
        {},
        reason === 'reload' ? 'closed for a restart with the saved settings' : 'shutdown complete',
      );
    };
    return {
      app,
      ports,
      engine,
      port: bound?.port ?? null,
      bootId,
      closed,
      close: () => close('stopped'),
    };
  } catch (err) {
    // why: review arch-008: a boot that failed after the lock was taken must not leave it fresh for 90 s or a heartbeat
    // firing against a closed database.
    if (heartbeat !== null) clearInterval(heartbeat);
    // why: a boot that failed after the engine booted (a listen refused) stops its scheduler too, so no cron job or the
    // FX refresh a minute after boot fires against the database closed below; its own failure is logged, never thrown
    // over the boot's
    if (booted !== null) await shutdownAfterFailedBoot(booted, log, secrets);
    // why: WP3's release deletes only the row this AppLock acquired, so a refused acquire leaves the holder's lock alone.
    lock.release();
    db.close();
    throw err;
  }
}

/**
 * A failed boot's engine shutdown, bounded as close() bounds its own (review devops M4; CodeRabbit, PR #20): the boot
 * may have resumed a run whose wait does not end, and the lock and the database must still be handed back. A failure
 * or the deadline is logged, never thrown over the boot's own error, and the engine is marked closed either way (T12).
 */
async function shutdownAfterFailedBoot(
  engine: Engine,
  log: Logger,
  secrets: readonly Secret[],
): Promise<void> {
  let deadline: NodeJS.Timeout | undefined;
  const timedOut = new Promise<void>((resolve) => {
    deadline = setTimeout(() => {
      log.error({ deadlineMs: SHUTDOWN_DEADLINE_MS }, 'engine shutdown after a failed boot timed out');
      resolve();
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
  });
  try {
    await Promise.race([
      // why: a shutdown that throws before it returns a promise is a rejection here too, never an escape
      Promise.resolve()
        .then(() => engine.shutdown())
        .catch((e: unknown) => {
          log.error(
            { err: { message: safeMessage(e, secrets) } },
            'engine shutdown after a failed boot failed',
          );
        }),
      timedOut,
    ]);
  } finally {
    clearTimeout(deadline);
    engine.markClosed();
  }
}

/**
 * The signal handler main() registers: runs `running.close()`, exits 0 when it finishes, EXIT.failed when it throws or
 * runs past the deadline. `exit` is injected for the test.
 */
export function shutdownHandler(
  running: RunningApp,
  log: Logger,
  secrets: readonly Secret[],
  exit: (code: number) => void = (code) => process.exit(code),
): (signal: string) => void {
  return (signal) => {
    log.info({ signal }, 'shutting down');
    running.close().then(
      () => exit(EXIT.ok),
      (err: unknown) => {
        // why: a timeout was already logged once by close(); a second 'shutdown failed' line would repeat it.
        if (!(err instanceof ShutdownTimeoutError))
          log.error({ err: { message: safeMessage(err, secrets) } }, 'shutdown failed');
        exit(EXIT.failed);
      },
    );
  };
}

/** What `main` takes besides the environment: seams for the tests that drive several passes in one process. */
export interface MainOptions {
  /** Ends the process (process.exit). */
  exit?: (code: number) => void;
  /** Where SIGTERM and SIGINT are listened for (the process). */
  signals?: Pick<NodeJS.EventEmitter, 'once' | 'removeListener'>;
  /** Overrides of each pass's boot: no listening, a fixed clock, the assets. */
  boot?: Partial<Pick<BootDeps, 'listen' | 'clock' | 'assets'>>;
  /** The log's destination (stdout). */
  logDestination?: NodeJS.WritableStream;
  /** Each pass's boot (bootApp); a test wraps it to act between passes. */
  bootApp?: (deps: BootDeps) => Promise<RunningApp>;
  /** Told of each pass once it serves. */
  onPass?: (running: RunningApp) => void;
}

/**
 * The app entrypoint: the environment parsed without the Settings page's names (settings plan ruling 3), then passes of
 * boot and serve (ruling 6): SIGTERM and SIGINT are listened for once; each pass boots (laying the stored settings over
 * the environment under the lock) and serves until it closes. A pass a save closed (`closed` = 'reload') is followed by
 * the next, which takes the lock without the other-holder wait; a signal at any point (during a pass's boot, its
 * serving or its close) ends the loop through `shutdownHandler`, which exits 0 once the close is done. A boot that
 * throws ends the loop with today's boot-failure log and code (main rethrows it; start.ts exits with its code); a
 * restart's close that fails exits EXIT.failed.
 */
export async function main(env: NodeJS.ProcessEnv, opts: MainOptions = {}): Promise<void> {
  let config: Config;
  try {
    config = loadBootConfig(env);
  } catch (err) {
    if (err instanceof InvalidConfigError) throw new BootError(err.message, EXIT.badConfig);
    throw err;
  }
  // why: one list the logger and every scrub below read; each boot adds the stored secrets to it once it has read them
  const secrets = bootSecrets(config, env);
  const log = createLogger(config, {
    secrets,
    ...(opts.logDestination === undefined ? {} : { destination: opts.logDestination }),
  });
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const signals = opts.signals ?? process;
  const boot = opts.bootApp ?? bootApp;
  let current: RunningApp | null = null;
  let stopping: string | null = null;
  const onSignal = (signal: string): void => {
    if (stopping !== null) return;
    stopping = signal;
    // why: a pass still booting is stopped as soon as it serves (below); a pass serving or closing is stopped now
    if (current !== null) shutdownHandler(current, log, secrets, exit)(signal);
  };
  const onTerm = (): void => onSignal('SIGTERM');
  const onInt = (): void => onSignal('SIGINT');
  signals.once('SIGTERM', onTerm);
  signals.once('SIGINT', onInt);
  try {
    for (let pass = 1; ; pass += 1) {
      let running: RunningApp;
      try {
        running = await boot({
          config,
          env,
          log,
          logSecrets: secrets,
          listen: true,
          assets: assetPaths(),
          home: env.HOME ?? null,
          version: readVersion(),
          tools: (p) => inProcessTools(p),
          lockWait: pass === 1,
          ...opts.boot,
        });
      } catch (err) {
        const message = safeMessage(err, secrets);
        log.error({ err: { message } }, 'boot failed');
        // why: start.ts prints this error's message to stderr (the container log), so it is rethrown already scrubbed.
        throw new BootError(message, err instanceof BootError ? err.exitCode : EXIT.failed);
      }
      current = running;
      log.info({ port: running.port, bindAddress: running.ports.config.bindAddress }, 'listening');
      opts.onPass?.(running);
      if (stopping !== null) shutdownHandler(running, log, secrets, exit)(stopping);
      let why: 'reload' | 'stopped';
      try {
        why = await running.closed;
      } catch (err) {
        // why: a signal's close reports its own failure through shutdownHandler; this is a restart's close that failed
        if (stopping === null) {
          if (!(err instanceof ShutdownTimeoutError))
            log.error({ err: { message: safeMessage(err, secrets) } }, 'shutdown failed');
          exit(EXIT.failed);
        }
        return;
      }
      current = null;
      // why: a signal's close (or one that arrived during a restart's close) exits through shutdownHandler
      if (why === 'stopped' || stopping !== null) return;
      log.info({ pass: pass + 1 }, 'restarting with the saved settings');
    }
  } finally {
    signals.removeListener('SIGTERM', onTerm);
    signals.removeListener('SIGINT', onInt);
  }
}
