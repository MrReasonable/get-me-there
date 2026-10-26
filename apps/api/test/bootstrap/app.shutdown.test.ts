// Spec §7, §13: the heartbeat, the graceful shutdown order, and a failed boot that leaves no lock behind.
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { AppLock, HEARTBEAT_INTERVAL_MS, openDatabase } from '@gmt/db';
import { takeStrays } from '@gmt/providers/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootApp, type RunningApp, SHUTDOWN_DEADLINE_MS, shutdownHandler } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { EXIT } from '../../src/tools/types.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, silentLog } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

/** The one seeding boot below, and each test's boot of a copy, as a backstop on a loaded machine. */
const BOOT_TIMEOUT_MS = 30_000;
/** Every boot runs on a fixed clock (CodeRabbit, PR #20): what a test steps is its own fake timers, never the wall. */
const T0 = asIsoDateTime('2026-10-14T12:00:00.000Z');

/**
 * Each engine a boot creates, through the real `engineFor`; with `hangShutdown` set, the next one's shutdown never
 * settles (its real shutdown is kept for the teardown), so a test can stand in a boot whose shutdown hangs.
 */
const engines = vi.hoisted(() => {
  const real: Array<() => Promise<void>> = [];
  return { hangShutdown: false, real };
});
vi.mock('../../src/bootstrap/engine.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/bootstrap/engine.js')>();
  return {
    ...orig,
    engineFor: (...args: Parameters<typeof orig.engineFor>) => {
      const engine = orig.engineFor(...args);
      if (engines.hangShutdown) {
        engines.hangShutdown = false;
        engines.real.push(engine.shutdown);
        engine.shutdown = () => new Promise<void>(() => undefined);
      }
      return engine;
    },
  };
});

function first(order: number[]): number {
  const v = order[0];
  if (v === undefined) throw new Error('not called');
  return v;
}

function devConfig(dbPath: string) {
  return loadConfigFromEnv(
    cleanEnv({
      NODE_ENV: 'development',
      DATABASE_PATH: dbPath,
      BIND_ADDRESS: '127.0.0.1',
      LOG_LEVEL: 'error',
    }),
  );
}

/** Spies on the interval timers; `heartbeat()` is the handle of the one interval at HEARTBEAT_INTERVAL_MS. */
function intervalSpies() {
  const set = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  return {
    clear,
    heartbeat: () => {
      const i = set.mock.calls.findIndex((call) => call[1] === HEARTBEAT_INTERVAL_MS);
      const r = set.mock.results[i];
      if (r === undefined || r.type !== 'return') throw new Error('no heartbeat interval was set');
      return r.value;
    },
  };
}

function lockRow(dbPath: string) {
  const db = openDatabase(dbPath);
  try {
    return AppLock.inspect(db);
  } finally {
    db.close();
  }
}

/**
 * A database migrated and seeded once for this file; every test boots its own copy. why: on CI's windows-2025 leg a
 * boot that seeded the full airports table took 15 to 25 s under load, so a test that booted and then stepped the 25 s
 * fake deadline ran past its 30 s budget. A copy needs no seed (the boot finds the dataset in place), so what a test
 * waits on is its own fake clock.
 */
const templateDir = mkdtempSync(join(tmpdir(), 'gmt-sd-seed-'));
const template = join(templateDir, 'seed.db');
beforeAll(async () => {
  const running = await bootApp({
    config: devConfig(template),
    clock: fixedClock(T0),
    log: silentLog,
    listen: false,
    assets: assetPaths(),
  });
  await running.close();
}, BOOT_TIMEOUT_MS);
afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

/** A fresh copy of the seeded database in this test's own temporary directory. */
function seededDb(): string {
  const dbPath = join(tempDir('gmt-sd-'), 's.db');
  copyFileSync(template, dbPath);
  return dbPath;
}

/**
 * Every app a test booted. why: a test that stubs the engine's shutdown to hang leaves its scheduler running (croner's
 * jobs, the FX refresh a minute after boot), which on a slow run fired a vendor request into a later test; each
 * engine is shut down for real once the test's stubs are restored.
 */
const booted: RunningApp[] = [];
const tracked = (running: RunningApp): RunningApp => {
  booted.push(running);
  return running;
};

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const running of booted.splice(0)) await running.engine.shutdown();
  for (const shutdown of engines.real.splice(0)) await shutdown();
  engines.hangShutdown = false;
});

describe('graceful shutdown (spec §7, §13)', { timeout: BOOT_TIMEOUT_MS }, () => {
  it('heartbeats every 30 s and shuts down: engine → checkpoint → release lock → close', async () => {
    const dbPath = seededDb();
    // why: only the interval timers are faked: the heartbeat is the app's one interval, croner and the engine use timeouts.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const timers = intervalSpies();
    const running = tracked(
      await bootApp({
        config: devConfig(dbPath),
        clock: fixedClock(T0),
        log: createLogger({ logLevel: 'error' }),
        listen: false,
        assets: assetPaths(),
      }),
    );
    const heartbeat = vi.spyOn(AppLock.prototype, 'heartbeat');
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);
    expect(heartbeat).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    const shutdown = vi.spyOn(running.engine, 'shutdown');
    const checkpoint = vi.spyOn(running.ports.db, 'checkpoint');
    const release = vi.spyOn(AppLock.prototype, 'release');
    const close = vi.spyOn(running.ports.db, 'close');
    await running.close();
    const checkpointOrder = first(checkpoint.mock.invocationCallOrder);
    expect(first(shutdown.mock.invocationCallOrder)).toBeLessThan(checkpointOrder);
    expect(checkpointOrder).toBeLessThan(first(release.mock.invocationCallOrder));
    expect(first(release.mock.invocationCallOrder)).toBeLessThan(first(close.mock.invocationCallOrder));
    expect(timers.clear).toHaveBeenCalledWith(timers.heartbeat()); // the heartbeat is cleared

    expect(lockRow(dbPath)).toBeNull();
    const wal = `${dbPath}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    await running.close(); // idempotent
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('a shutdown that throws still clears the heartbeat, releases the lock and closes the database (review arch Minor)', async () => {
    const dbPath = seededDb();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const timers = intervalSpies();
    const running = tracked(
      await bootApp({
        config: devConfig(dbPath),
        clock: fixedClock(T0),
        log: createLogger({ logLevel: 'error' }),
        listen: false,
        assets: assetPaths(),
      }),
    );
    vi.spyOn(running.engine, 'shutdown').mockRejectedValue(new Error('engine shutdown failed'));
    const close = vi.spyOn(running.ports.db, 'close');
    await expect(running.close()).rejects.toThrow('engine shutdown failed');
    expect(timers.clear).toHaveBeenCalledWith(timers.heartbeat());
    expect(close).toHaveBeenCalledTimes(1);
    expect(lockRow(dbPath)).toBeNull();
  });

  it('a boot that fails after taking the lock releases it and stops the heartbeat (review arch-008)', async () => {
    const dbPath = seededDb();
    // why: the timeouts are faked too, so the scheduler's timers (croner's, the FX refresh a minute after boot) can be
    // run on demand: a boot that failed after the engine booted must leave none behind to fire into a closed database
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const log = createLogger({ logLevel: 'error' });
    const timers = intervalSpies();
    // why: listen is the last step, after the lock and the heartbeat; this process's network guards refuse its address
    // lookup, so it fails here deterministically.
    await expect(
      bootApp({ config: devConfig(dbPath), clock: fixedClock(T0), log, listen: true, assets: assetPaths() }),
    ).rejects.toThrow();
    expect(lockRow(dbPath)).toBeNull();
    expect(timers.clear).toHaveBeenCalledWith(timers.heartbeat());
    // two minutes on, past the FX refresh and the minute catch-up: no request was made and nothing logged an error
    const errors = vi.spyOn(log, 'error');
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(takeStrays()).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('a failed boot whose engine shutdown hangs (CodeRabbit, PR #20)', {
  timeout: BOOT_TIMEOUT_MS,
}, () => {
  it('still releases the lock and closes the database at the deadline, logging the timeout once', async () => {
    const dbPath = seededDb();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const log = createLogger({ logLevel: 'error' });
    const errors = vi.spyOn(log, 'error');
    engines.hangShutdown = true;
    const boot = bootApp({
      config: devConfig(dbPath),
      clock: fixedClock(T0),
      log,
      listen: true,
      assets: assetPaths(),
    });
    const settled = boot.then(
      () => 'booted',
      () => 'refused',
    );
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
    expect(lockRow(dbPath)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBe('refused');
    expect(lockRow(dbPath)).toBeNull();
    expect(
      errors.mock.calls.filter((c) => String(c[1]) === 'engine shutdown after a failed boot timed out'),
    ).toHaveLength(1);
  });
});

describe('shutdown deadline (review devops M4; compose stop_grace_period is 30 s)', {
  timeout: BOOT_TIMEOUT_MS,
}, () => {
  /** A booted app plus a recording logger and exit; only the timeout timers are faked, after boot. */
  async function booted() {
    const dbPath = seededDb();
    const running = tracked(
      await bootApp({
        config: devConfig(dbPath),
        clock: fixedClock(T0),
        log: silentLog,
        listen: false,
        assets: assetPaths(),
      }),
    );
    const errors = vi.spyOn(silentLog, 'error');
    const exit = vi.fn<(code: number) => void>();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    return { dbPath, running, errors, exit };
  }
  const messages = (spy: { mock: { calls: unknown[][] } }): string[] =>
    spy.mock.calls.map((c) => String(c[1]));

  it('stays below the 30 s grace period', () => {
    expect(SHUTDOWN_DEADLINE_MS).toBeLessThan(30_000);
  });

  it('a hanging shutdown logs one timeout line, releases the lock and exits non-zero at the deadline', async () => {
    const { dbPath, running, errors, exit } = await booted();
    vi.spyOn(running.engine, 'shutdown').mockReturnValue(new Promise<void>(() => undefined));
    const release = vi.spyOn(AppLock.prototype, 'release');
    shutdownHandler(running, silentLog, [], exit)('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    expect(lockRow(dbPath)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(EXIT.failed);
    expect(release).toHaveBeenCalled();
    expect(lockRow(dbPath)).toBeNull();
    expect(messages(errors).filter((m) => m.includes('shutdown timed out'))).toHaveLength(1);
    expect(messages(errors).some((m) => m.includes('shutdown failed'))).toBe(false);
  });

  it('T12: at the deadline the engine is marked closed before the database closes, so a late job writes nothing', async () => {
    const { running, exit } = await booted();
    vi.spyOn(running.engine, 'shutdown').mockReturnValue(new Promise<void>(() => undefined));
    const order: string[] = [];
    vi.spyOn(running.engine, 'markClosed').mockImplementation(() => order.push('engine closed'));
    vi.spyOn(running.ports.db, 'close').mockImplementation(() => order.push('database closed'));
    shutdownHandler(running, silentLog, [], exit)('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS);
    expect(exit).toHaveBeenCalledWith(EXIT.failed);
    expect(order).toEqual(['engine closed', 'database closed']);
    vi.mocked(running.ports.db.close).mockRestore();
    running.ports.db.close();
  });

  it('a shutdown that finishes before the deadline exits 0 with no timeout line, and the timer is gone', async () => {
    const { running, errors, exit } = await booted();
    shutdownHandler(running, silentLog, [], exit)('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(EXIT.ok));
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS * 2);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(messages(errors).some((m) => m.includes('timed out'))).toBe(false);
  });

  it('the deadline timer does not keep the process alive', async () => {
    const { running, exit } = await booted();
    const set = vi.spyOn(globalThis, 'setTimeout');
    vi.spyOn(running.engine, 'shutdown').mockReturnValue(new Promise<void>(() => undefined));
    shutdownHandler(running, silentLog, [], exit)('SIGTERM');
    const i = set.mock.calls.findIndex((c: unknown[]) => c[1] === SHUTDOWN_DEADLINE_MS);
    const timer = set.mock.results[i];
    expect(i).toBeGreaterThanOrEqual(0);
    expect(timer?.type === 'return' && timer.value.hasRef()).toBe(false);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS);
  });
});
