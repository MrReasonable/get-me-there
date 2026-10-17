/**
 * The app bootstrap (spec §4, §5.5, §7, §12, §13): the process that serves the API and the SPA and runs the engine.
 * Order (plan "Wiring and bootstraps", decisions 53, 58): refuse NODE_ENV=test → re-assert the auth invariants → data
 * directory writable → `app_lock` read-only, waiting while it is fresh → backup preflight when migrations are pending
 * (WP4b's preflight.ts, decision 32) → buildPorts (migrations) → `AppLock('app')` and the 30 s heartbeat → seed +
 * airport sanity check under the lock (as the tool bootstrap seeds) → createEngine → engine.boot() → serve. Shutdown: stop accepting → engine.shutdown() →
 * wal_checkpoint(TRUNCATE) → lock release → close (spec §7 order). A boot that fails after taking the lock releases
 * it and stops the heartbeat before the database closes.
 */
import { type Clock, type Config, type Logger, type Secret, systemClock } from '@gmt/core';
import { AppLock, HEARTBEAT_INTERVAL_MS, sanityCheckAirports } from '@gmt/db';
import type { Engine } from '@gmt/engine';
import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import type { AppEnv, HttpToolRunners } from '../routes/types.js';
import { safeMessage } from '../safeMessage.js';
import { inProcessTools } from '../tools/inProcess.js';
import { EXIT } from '../tools/types.js';
import { buildPorts, collectSecrets, InvalidConfigError, loadConfigFromEnv, type Ports } from '../wiring.js';
import { engineFor } from './engine.js';
import { BootError } from './errors.js';
import { waitForLockFree } from './lock.js';
import { type AssetPaths, assetPaths } from './paths.js';
import { backupBeforeMigrations, dataDirRefusal } from './preflight.js';
import { seedIfNeeded } from './seed.js';

export interface BootDeps {
  config: Config;
  log: Logger;
  clock?: Clock;
  /** false in tests that drive the app with `app.request()`. */
  listen: boolean;
  assets: AssetPaths;
  /** Builds the in-process tool runners once ports exist (`main` passes `inProcessTools`). */
  tools?: (ports: Ports) => HttpToolRunners;
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

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;

/**
 * Spec §4, review SEC-3: the invariants `loadConfigFromEnv` enforces, re-asserted on the injected config, so no caller
 * of `bootApp` can serve without auth on a public bind or with no allowed host. 78, as a config error.
 */
export function assertAuthInvariants(config: Config, log: Logger): void {
  if (config.allowedHosts.length === 0)
    throw new BootError('ALLOWED_HOSTS is empty; refusing to serve', EXIT.badConfig);
  if (config.auth !== null && config.auth.pass.reveal().length < 12)
    throw new BootError('APP_BASIC_AUTH_PASS must be at least 12 characters', EXIT.badConfig);
  if (config.auth === null && !LOOPBACK.test(config.bindAddress)) {
    if (!config.allowUnauthenticated)
      throw new BootError(
        `binding ${config.bindAddress} without auth needs ALLOW_UNAUTHENTICATED=true (spec §4)`,
        EXIT.badConfig,
      );
    log.warn(
      { bindAddress: config.bindAddress },
      'serving without auth on a non-loopback bind (ALLOW_UNAUTHENTICATED)',
    );
  }
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
  const ports = buildPorts(config, { log, clock, migrationsDir: deps.assets.migrationsDir });
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
    const engine = engineFor(ports, log);
    await engine.boot();
    const app = createApp(ports, engine, { webRoot: deps.assets.webRoot, tools: deps.tools?.(ports) ?? {} });
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
        try {
          await closeServer(bound?.server ?? null); // stop accepting
          await engine.shutdown();
          // why: spec §7 releases the lock after the checkpoint; db.close() checkpoints again, harmlessly.
          ports.db.checkpoint();
        } finally {
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
      tools: (p) => inProcessTools(p),
    });
  } catch (err) {
    log.error({ err: { message: safeMessage(err, secrets) } }, 'boot failed');
    throw err;
  }
  log.info({ port: running.port, bindAddress: config.bindAddress }, 'listening');
  const stop = (signal: string) => {
    log.info({ signal }, 'shutting down');
    running.close().then(
      () => process.exit(EXIT.ok),
      (err: unknown) => {
        log.error({ err: { message: safeMessage(err, secrets) } }, 'shutdown failed');
        process.exit(EXIT.failed);
      },
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}
