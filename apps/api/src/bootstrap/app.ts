/**
 * The app bootstrap (spec §4, §5.5, §7, §12, §13): the process that serves the API and the SPA and runs the engine.
 * Order (plan "Wiring and bootstraps", decisions 53, 58): refuse NODE_ENV=test → refuse a database moved to a native
 * install (spec §13, the MOVED-TO-NATIVE marker) → re-assert the auth invariants → data
 * directory writable → `app_lock` read-only, waiting while it is fresh → backup preflight when migrations are pending
 * (WP4b's preflight.ts, decision 32) → buildPorts (migrations) → `AppLock('app')` and the 30 s heartbeat → seed +
 * airport sanity check under the lock (as the tool bootstrap seeds) → createEngine → engine.boot() → serve. Shutdown: stop accepting → engine.shutdown() →
 * wal_checkpoint(TRUNCATE) → lock release → close (spec §7 order). A boot that fails after taking the lock releases
 * it and stops the heartbeat before the database closes.
 */
import {
  AUTH_MISSING,
  type Clock,
  type Config,
  isLoopbackHost,
  type Logger,
  microGbpToPence,
  type Secret,
  systemClock,
} from '@gmt/core';
import { AppLock, HEARTBEAT_INTERVAL_MS, sanityCheckAirports, WalUnavailableError } from '@gmt/db';
import { buildNotifiers, EmailNotifier, type Engine } from '@gmt/engine';
import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import { planOf, providerBudget, zeroCapBlocks } from '../read/usage.js';
import type { AppEnv, HttpToolRunners } from '../routes/types.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import { inProcessTools } from '../tools/inProcess.js';
import { EXIT } from '../tools/types.js';
import { buildPorts, collectSecrets, InvalidConfigError, loadConfigFromEnv, type Ports } from '../wiring.js';
import { engineFor } from './engine.js';
import { BootError } from './errors.js';
import { waitForLockFree } from './lock.js';
import { type AssetPaths, assetPaths } from './paths.js';
import { backupBeforeMigrations, dataDirRefusal, movedDatabaseRefusal } from './preflight.js';
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
  config: Config;
  log: Logger;
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
}

export interface RunningApp {
  app: Hono<AppEnv>;
  ports: Ports;
  engine: Engine;
  port: number | null;
  close(): Promise<void>;
}

/**
 * Spec §4, review SEC-3: the invariants `loadConfigFromEnv` enforces, re-asserted on the injected config, so no caller
 * of `bootApp` can serve without auth on a public bind or with no allowed host. 78, as a config error.
 */
export function assertAuthInvariants(config: Config, log: Logger): void {
  if (config.allowedHosts.length === 0)
    throw new BootError('ALLOWED_HOSTS is empty; refusing to serve', EXIT.badConfig);
  if (config.auth !== null && config.auth.pass.reveal().length < 12)
    throw new BootError('APP_BASIC_AUTH_PASS must be at least 12 characters', EXIT.badConfig);
  if (config.auth === null && !isLoopbackHost(config.bindAddress)) {
    if (!config.allowUnauthenticated)
      // why: devops-final-001: the same words as config's refusal, so the fix named is the two auth lines.
      throw new BootError(
        `binding ${config.bindAddress} without auth: ${AUTH_MISSING}; ALLOW_UNAUTHENTICATED=true is only for a Tailscale-only host (spec §4)`,
        EXIT.badConfig,
      );
    log.warn(
      { bindAddress: config.bindAddress },
      'serving without auth on a non-loopback bind (ALLOW_UNAUTHENTICATED)',
    );
  }
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
  const blocked = ports.providers.filter((p) => zeroCapBlocks(config, p.id)).map((p) => p.id);
  if (blocked.length > 0) log.warn({ providers: blocked }, API_TEXT.zeroCapBootWarning);
  // why: cost-006: the same fee sum budgetFit and GET /budget use (the guard's own entries), against the global cap.
  const fees = ports.providers
    .map((p) => providerBudget(config, p.id))
    .reduce((a, b) => a + (b.billable ? b.planFixedMicroGbp : 0), 0);
  if (fees > 0 && config.spend.monthlyCapMicroGbp < fees)
    log.warn(
      { field: 'MONTHLY_SPEND_CAP_PENCE' },
      API_TEXT.spendCapBelowFees(microGbpToPence(config.spend.monthlyCapMicroGbp), microGbpToPence(fees)),
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
  const secrets: readonly Secret[] = collectSecrets(config);
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
  let ports: Ports;
  try {
    ports = buildPorts(config, { log, clock, migrationsDir: deps.assets.migrationsDir });
  } catch (e) {
    // why: dm-003: a data directory whose file system refuses WAL is a preflight refusal (73), named, not a crash.
    if (e instanceof WalUnavailableError) throw new BootError(e.message, EXIT.preflightImpossible);
    throw e;
  }
  const lock = new AppLock(ports.db, 'app', clock, log);
  let heartbeat: NodeJS.Timeout | null = null;
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
    seedIfNeeded(ports, deps.assets.airportsDataDir, (line) => log.info({}, line));
    // Spec §7: at least 5,000 airports with tz, and every airport an enabled definition references exists.
    const referenced = ports.repos.definitions
      .list()
      .filter((d) => d.enabled)
      .flatMap((d) => [...d.origins, ...d.destinations]);
    const sanity = sanityCheckAirports(ports.db, referenced);
    if (!sanity.ok) throw new BootError(`airport sanity check failed: ${sanity.reason}`, EXIT.failed);
    // why: spec §8.1, §8.3 — WP11's alert runner as the alerts step, the notifiers config asks for (engine.ts).
    const home = deps.home ?? null;
    const notifiers = buildNotifiers(ports.config, log, ports.clock);
    const engine = engineFor(ports, log, { notifiers, home });
    await engine.boot();
    logProvidersConfigured(ports, log);
    // why: spec §10 /alerts/test-email goes through the same email notifier (and its hourly ceiling) as every alert
    const email = notifiers.find((n) => n instanceof EmailNotifier);
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
    });
    const bound = deps.listen ? await listen(app, config) : null;
    const beat = heartbeat;
    let closed = false;
    return {
      app,
      ports,
      engine,
      port: bound?.port ?? null,
      close: async () => {
        if (closed) return;
        closed = true;
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
              await engine.shutdown();
              // why: spec §7 releases the lock after the checkpoint; db.close() checkpoints again, harmlessly.
              ports.db.checkpoint();
            })(),
            timedOut,
          ]);
        } finally {
          clearTimeout(deadline);
          // why: review T12 — past the deadline the engine's own wait may still be running; marked closed first, a job
          // that finishes after this writes nothing to the handle closed below
          engine.markClosed();
          lock.release();
          ports.db.close();
        }
        log.info({}, 'shutdown complete');
      },
    };
  } catch (err) {
    // why: review arch-008: a boot that failed after the lock was taken must not leave it fresh for 90 s or a heartbeat
    // firing against a closed database.
    if (heartbeat !== null) clearInterval(heartbeat);
    // why: WP3's release deletes only the row this AppLock acquired, so a refused acquire leaves the holder's lock alone.
    lock.release();
    ports.db.close();
    throw err;
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

/** The app entrypoint: env parsed once (spec §12), boot, signals. Throws on refusal; start.ts exits with its code. */
export async function main(env: NodeJS.ProcessEnv): Promise<void> {
  let config: Config;
  try {
    config = loadConfigFromEnv(env);
  } catch (err) {
    if (err instanceof InvalidConfigError) throw new BootError(err.message, EXIT.badConfig);
    throw err;
  }
  const secrets = collectSecrets(config);
  const log = createLogger(config, { secrets });
  let running: RunningApp;
  try {
    running = await bootApp({
      config,
      log,
      listen: true,
      assets: assetPaths(),
      home: env.HOME ?? null,
      version: readVersion(),
      tools: (p) => inProcessTools(p),
    });
  } catch (err) {
    const message = safeMessage(err, secrets);
    log.error({ err: { message } }, 'boot failed');
    // why: start.ts prints this error's message to stderr (the container log), so it is rethrown already scrubbed.
    throw new BootError(message, err instanceof BootError ? err.exitCode : EXIT.failed);
  }
  log.info({ port: running.port, bindAddress: config.bindAddress }, 'listening');
  const stop = shutdownHandler(running, log, secrets);
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}
