// Spec §7 app_lock and plan decision 53: the app reads the lock read-only before any backup or migration, waits while
// it is fresh (60 s for a tool, 90 s for another app), takes over a stale one, and refuses a live second app with 75.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { AppLock, applyMigrations, MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { APP_LOCK_WAIT_MS, TOOL_LOCK_WAIT_MS, waitForLockFree } from '../../src/bootstrap/lock.js';
import { createLogger } from '../../src/logger.js';
import { silentLog } from '../helpers/env.js';
import { captureLines, T0 } from '../helpers/harness.js';
import { onCleanup, tempDir } from '../helpers/tmp.js';

/** A migrated database file, a fixed clock, and a sleep that advances it and runs `onSleep` (a heartbeat, a release). */
function setup(onSleep: (totalMs: number) => void = () => {}) {
  const databasePath = join(tempDir('gmt-lock-'), 'app.db');
  const db = openDatabase(databasePath);
  applyMigrations(db, MIGRATIONS_DIR);
  onCleanup(() => db.close());
  const clock = fixedClock(T0);
  const lines: string[] = [];
  const log = createLogger({ logLevel: 'debug' }, { destination: captureLines(lines) });
  let slept = 0;
  const sleep = async (ms: number) => {
    slept += ms;
    clock.advance(ms);
    onSleep(slept);
  };
  const wait = () => waitForLockFree({ databasePath, clock, sleep, log, secrets: [] });
  const hold = (holder: 'app' | 'tool') => {
    const lock = new AppLock(db, holder, clock, silentLog);
    expect(lock.acquire({ waitMs: 0 })).toBe('acquired');
    return lock;
  };
  return { db, clock, lines, wait, hold, slept: () => slept };
}

describe('the read-only app_lock wait (spec §7, plan decision 53)', () => {
  it('returns at once when no lock is held, and for a file that does not exist yet', async () => {
    const s = setup();
    await s.wait();
    expect(s.slept()).toBe(0);
    await waitForLockFree({
      databasePath: join(tempDir(), 'none.db'),
      clock: s.clock,
      sleep: async () => undefined,
      log: silentLog,
      secrets: [],
    });
  });

  it('waits 60 s on a fresh tool lock, then refuses with exit code 75', async () => {
    let tool: AppLock | undefined;
    const s = setup(() => tool?.heartbeat());
    tool = s.hold('tool');
    await expect(s.wait()).rejects.toMatchObject({ exitCode: 75, message: expect.stringMatching(/tool/) });
    expect(s.slept()).toBeGreaterThanOrEqual(TOOL_LOCK_WAIT_MS);
    expect(s.slept()).toBeLessThan(TOOL_LOCK_WAIT_MS + 2_000);
  });

  it('proceeds as soon as a tool releases within the wait', async () => {
    let tool: AppLock | undefined;
    const s = setup((total) => (total >= 10_000 ? tool?.release() : tool?.heartbeat()));
    tool = s.hold('tool');
    await s.wait();
    expect(s.slept()).toBeGreaterThanOrEqual(10_000);
    expect(s.slept()).toBeLessThan(12_000);
  });

  it("proceeds once a crashed app's lock goes stale (no heartbeats), logging the lock's age", async () => {
    const s = setup();
    s.hold('app'); // the previous process, now dead
    await s.wait();
    expect(s.slept()).toBeGreaterThan(0);
    expect(s.slept()).toBeLessThanOrEqual(APP_LOCK_WAIT_MS + 1_000);
    expect(s.lines.some((l) => l.includes('"lockAgeMs"'))).toBe(true);
  });

  it('refuses a second app with 75 after 90 s while the first is still heartbeating', async () => {
    let other: AppLock | undefined;
    const s = setup(() => other?.heartbeat());
    other = s.hold('app');
    await expect(s.wait()).rejects.toMatchObject({
      exitCode: 75,
      message: expect.stringMatching(/still heartbeating/),
    });
    expect(s.slept()).toBeGreaterThanOrEqual(APP_LOCK_WAIT_MS);
  });

  it('a file that is not a database is 73, as in the tool bootstrap', async () => {
    const s = setup();
    const notDb = join(tempDir(), 'garbage.db');
    writeFileSync(notDb, 'not a database');
    await expect(
      waitForLockFree({
        databasePath: notDb,
        clock: s.clock,
        sleep: async () => undefined,
        log: silentLog,
        secrets: [],
      }),
    ).rejects.toMatchObject({ exitCode: 73 });
  });
});
