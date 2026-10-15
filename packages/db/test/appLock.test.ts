import { fixedClock, systemClock } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { AppLock, HEARTBEAT_INTERVAL_MS, LOCK_STALE_AFTER_MS } from '../src/appLock.js';
import { freshDb, openTracked, silentLog, sqliteCode, T0, tmpDbPath } from './helpers/db.js';

/** A sleep that advances the fake clock instead of blocking, so waits are deterministic and instant. */
const sleeper = (clock: ReturnType<typeof fixedClock>) => (ms: number) => clock.advance(ms);

describe('AppLock (spec §7 app_lock)', () => {
  it('constants: beat every 30 s, stale after 3 missed beats', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
    expect(LOCK_STALE_AFTER_MS).toBe(3 * HEARTBEAT_INTERVAL_MS);
  });

  it('symmetry: whichever holder has a fresh lock, the other is refused; release hands it over', () => {
    const path = tmpDbPath();
    const appDb = freshDb(path);
    const toolDb = openTracked(path);
    const clock = fixedClock(T0);
    const app = new AppLock(appDb, 'app', clock, silentLog, { sleep: sleeper(clock) });
    const tool = new AppLock(toolDb, 'tool', clock, silentLog, { sleep: sleeper(clock) });
    expect(app.acquire({ waitMs: 0 })).toBe('acquired');
    expect(tool.acquire({ waitMs: 0 })).toBe('refused');
    expect(AppLock.inspect(toolDb)).toEqual({ holder: 'app', heartbeatAt: T0, acquiredAt: T0 });
    app.release();
    expect(AppLock.inspect(toolDb)).toBeNull();
    expect(tool.acquire({ waitMs: 0 })).toBe('acquired');
    expect(app.acquire({ waitMs: 0 })).toBe('refused');
  });

  it('the app waits up to waitMs for a fresh tool lock that keeps beating, then refuses', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const tool = new AppLock(db, 'tool', clock, silentLog);
    expect(tool.acquire({ waitMs: 0 })).toBe('acquired');
    const app = new AppLock(db, 'app', clock, silentLog, {
      pollMs: 5000,
      sleep: (ms) => {
        clock.advance(ms);
        tool.heartbeat(); // the tool is alive
      },
    });
    expect(app.acquire({ waitMs: 60_000 })).toBe('refused');
    expect(clock.now()).toBe('2026-10-14T12:01:00.000Z'); // waited the full 60 s
    expect(AppLock.inspect(db)?.holder).toBe('tool');
  });

  it('stale takeover by heartbeat age: 90,000 ms is still fresh, 90,001 ms is stale; the age is logged', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    new AppLock(db, 'app', clock, silentLog).acquire({ waitMs: 0 }); // the previous process, never beats again
    const warn = vi.fn();
    const next = new AppLock(db, 'app', clock, { ...silentLog, warn }, { pollMs: 1, sleep: sleeper(clock) });
    clock.advance(LOCK_STALE_AFTER_MS);
    expect(next.acquire({ waitMs: 0 })).toBe('refused'); // exactly 90 s: fresh
    clock.advance(1);
    expect(next.acquire({ waitMs: 0 })).toBe('acquired'); // 90.001 s: stale
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ previousHolder: 'app', lockAgeMs: 90_001 }),
      expect.stringContaining('stale'),
    );
    expect(AppLock.inspect(db)).toEqual({
      holder: 'app',
      heartbeatAt: '2026-10-14T12:01:30.001Z',
      acquiredAt: '2026-10-14T12:01:30.001Z',
    });
  });

  it('a waiting app takes over a crashed app lock within the 90 s wait (spec §7)', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    new AppLock(db, 'app', clock, silentLog).acquire({ waitMs: 0 });
    clock.advance(30_000); // reboot 30 s after the last beat
    const next = new AppLock(db, 'app', clock, silentLog, { pollMs: 5000, sleep: sleeper(clock) });
    expect(next.acquire({ waitMs: 90_000 })).toBe('acquired');
    expect(clock.now()).toBe('2026-10-14T12:01:35.000Z'); // first poll past 90 s of heartbeat age
  });

  it('an app lock still being heartbeated after the 90 s wait is a second live app: refused, never taken over', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const live = new AppLock(db, 'app', clock, silentLog);
    live.acquire({ waitMs: 0 });
    const next = new AppLock(db, 'app', clock, silentLog, {
      pollMs: 5000,
      sleep: (ms) => {
        clock.advance(ms);
        live.heartbeat();
      },
    });
    expect(next.acquire({ waitMs: 90_000 })).toBe('refused');
    expect(AppLock.inspect(db)?.acquiredAt).toBe(T0);
  });

  it('heartbeat refreshes the holder and fails loudly once the lock has been taken over; release never deletes another holder', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const old = new AppLock(db, 'app', clock, silentLog);
    old.acquire({ waitMs: 0 });
    clock.advance(10_000);
    old.heartbeat();
    expect(AppLock.inspect(db)?.heartbeatAt).toBe('2026-10-14T12:00:10.000Z');
    clock.advance(100_000);
    const next = new AppLock(db, 'app', clock, silentLog);
    expect(next.acquire({ waitMs: 0 })).toBe('acquired');
    expect(() => old.heartbeat()).toThrow(/lost/);
    old.release(); // no-op: not ours any more
    expect(AppLock.inspect(db)?.acquiredAt).toBe('2026-10-14T12:01:50.000Z');
  });

  it('re-acquiring a lock already held by this instance succeeds', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const lock = new AppLock(db, 'app', clock, silentLog);
    expect(lock.acquire({ waitMs: 0 })).toBe('acquired');
    expect(lock.acquire({ waitMs: 0 })).toBe('acquired');
  });

  it('only one row can exist (id = 1)', () => {
    const db = freshDb();
    expect(
      sqliteCode(() =>
        db.raw
          .prepare(`INSERT INTO app_lock (id, holder, heartbeat_at, acquired_at) VALUES (2, 'app', ?, ?)`)
          .run(T0, T0),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('the read and the takeover hold the write lock: another connection cannot write in between (test-004)', () => {
    const path = tmpDbPath();
    const a = freshDb(path);
    const b = openTracked(path);
    b.raw.pragma('busy_timeout = 50');
    /** Runs `probe` after the lock row is read and before it is written, inside the attempt's transaction. */
    class ProbeLock extends AppLock {
      probe: () => void = () => undefined;
      protected override afterRead(): void {
        this.probe();
      }
    }
    const lock = new ProbeLock(a, 'app', fixedClock(T0), silentLog);
    let code: string | null = 'not probed';
    lock.probe = () => {
      code = sqliteCode(() =>
        b.raw
          .prepare(`INSERT INTO app_lock (id, holder, heartbeat_at, acquired_at) VALUES (1, 'tool', ?, ?)`)
          .run(T0, T0),
      );
    };
    expect(lock.acquire({ waitMs: 0 })).toBe('acquired');
    expect(code).toBe('SQLITE_BUSY');
    expect(AppLock.inspect(a)?.holder).toBe('app');
  });

  it('the production sleep waits in real time and then refuses a fresh foreign lock (the single real-time test, test-015)', () => {
    const db = freshDb();
    new AppLock(db, 'tool', systemClock, silentLog).acquire({ waitMs: 0 });
    const started = performance.now();
    expect(new AppLock(db, 'app', systemClock, silentLog, { pollMs: 5 }).acquire({ waitMs: 20 })).toBe(
      'refused',
    );
    expect(performance.now() - started).toBeGreaterThanOrEqual(19); // ms timer granularity
  });
});
