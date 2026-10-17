// Spec §7, §13: the heartbeat, the graceful shutdown order, and a failed boot that leaves no lock behind.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppLock, HEARTBEAT_INTERVAL_MS, openDatabase } from '@gmt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootApp, SHUTDOWN_DEADLINE_MS, shutdownHandler } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { EXIT } from '../../src/tools/types.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, silentLog } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

/** Boot tests seed the full airports table; this file's tests may take longer than the default 5 s. */
const BOOT_TIMEOUT_MS = 30_000;

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('graceful shutdown (spec §7, §13)', { timeout: BOOT_TIMEOUT_MS }, () => {
  it('heartbeats every 30 s and shuts down: engine → checkpoint → release lock → close', async () => {
    const dbPath = join(tempDir('gmt-sd-'), 's.db');
    // why: only the interval timers are faked: the heartbeat is the app's one interval, croner and the engine use timeouts.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const timers = intervalSpies();
    const running = await bootApp({
      config: devConfig(dbPath),
      log: createLogger({ logLevel: 'error' }),
      listen: false,
      assets: assetPaths(),
    });
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
    const dbPath = join(tempDir('gmt-sd-'), 's.db');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const timers = intervalSpies();
    const running = await bootApp({
      config: devConfig(dbPath),
      log: createLogger({ logLevel: 'error' }),
      listen: false,
      assets: assetPaths(),
    });
    vi.spyOn(running.engine, 'shutdown').mockRejectedValue(new Error('engine shutdown failed'));
    const close = vi.spyOn(running.ports.db, 'close');
    await expect(running.close()).rejects.toThrow('engine shutdown failed');
    expect(timers.clear).toHaveBeenCalledWith(timers.heartbeat());
    expect(close).toHaveBeenCalledTimes(1);
    expect(lockRow(dbPath)).toBeNull();
  });

  it('a boot that fails after taking the lock releases it and stops the heartbeat (review arch-008)', async () => {
    const dbPath = join(tempDir('gmt-sd-'), 's.db');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const timers = intervalSpies();
    // why: listen is the last step, after the lock and the heartbeat; this process's network guards refuse its address
    // lookup, so it fails here deterministically.
    await expect(
      bootApp({
        config: devConfig(dbPath),
        log: createLogger({ logLevel: 'error' }),
        listen: true,
        assets: assetPaths(),
      }),
    ).rejects.toThrow();
    expect(lockRow(dbPath)).toBeNull();
    expect(timers.clear).toHaveBeenCalledWith(timers.heartbeat());
  });
});

describe('shutdown deadline (review devops M4; compose stop_grace_period is 30 s)', {
  timeout: BOOT_TIMEOUT_MS,
}, () => {
  /** A booted app plus a recording logger and exit; only the timeout timers are faked, after boot. */
  async function booted() {
    const dbPath = join(tempDir('gmt-sd-'), 's.db');
    const running = await bootApp({
      config: devConfig(dbPath),
      log: silentLog,
      listen: false,
      assets: assetPaths(),
    });
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
