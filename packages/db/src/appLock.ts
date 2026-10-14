import type { Clock, IsoDateTime, Logger } from '@gmt/core';
import type { Db } from './client.js';
import { oneOf, readTime } from './internal/read.js';

/** Spec §7: "Heartbeat every 30 s; stale after 3 missed beats". */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const LOCK_STALE_AFTER_MS = 3 * HEARTBEAT_INTERVAL_MS;

const HOLDERS = ['app', 'tool'] as const;
type Holder = (typeof HOLDERS)[number];
interface LockRow {
  holder: string;
  heartbeat_at: string;
  acquired_at: string;
}

/** Synchronous sleep for the boot-time wait (nothing else runs while the process is acquiring). */
function blockingSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The single-writer lock between the app and the tool bootstrap (spec §7 `app_lock`). Symmetric: either holder with
 * a fresh heartbeat excludes the other. A holding instance is identified by (holder, acquired_at), so a heartbeat or
 * release from an instance whose lock was taken over is detected rather than applied.
 */
export class AppLock {
  private acquiredAt: IsoDateTime | null = null;
  private readonly sleep: (ms: number) => void;
  private readonly pollMs: number;

  constructor(
    private readonly db: Db,
    private readonly holder: Holder,
    private readonly clock: Clock,
    private readonly log: Logger,
    opts: { sleep?: (ms: number) => void; pollMs?: number } = {},
  ) {
    this.sleep = opts.sleep ?? blockingSleep;
    this.pollMs = opts.pollMs ?? 1000;
  }

  static inspect(db: Db): { holder: Holder; heartbeatAt: IsoDateTime; acquiredAt: IsoDateTime } | null {
    const r = db.raw
      .prepare<[], LockRow>('SELECT holder, heartbeat_at, acquired_at FROM app_lock WHERE id = 1')
      .get();
    if (r === undefined) return null;
    return {
      holder: oneOf('app_lock.holder', HOLDERS, r.holder),
      heartbeatAt: readTime('app_lock.heartbeat_at', r.heartbeat_at),
      acquiredAt: readTime('app_lock.acquired_at', r.acquired_at),
    };
  }

  acquire(opts: { waitMs: number }): 'acquired' | 'refused' {
    const deadline = Date.parse(this.clock.now()) + Math.max(0, opts.waitMs);
    for (;;) {
      if (this.tryAcquire()) return 'acquired';
      const now = Date.parse(this.clock.now());
      if (now >= deadline) {
        const current = AppLock.inspect(this.db);
        this.log.warn(
          {
            holder: this.holder,
            currentHolder: current?.holder,
            lockAgeMs: current ? now - Date.parse(current.heartbeatAt) : null,
          },
          'app_lock held by a live process; refusing',
        );
        return 'refused';
      }
      this.sleep(Math.min(this.pollMs, deadline - now));
    }
  }

  /** Called every HEARTBEAT_INTERVAL_MS by the bootstrap (WP8). Throws when another process has taken the lock. */
  heartbeat(): void {
    if (this.acquiredAt === null) throw new Error('app_lock heartbeat without holding the lock');
    const changes = this.db.raw
      .prepare(
        'UPDATE app_lock SET heartbeat_at = @now WHERE id = 1 AND holder = @holder AND acquired_at = @acquiredAt',
      )
      .run({ now: this.clock.now(), holder: this.holder, acquiredAt: this.acquiredAt }).changes;
    if (changes !== 1) {
      this.acquiredAt = null;
      throw new Error('app_lock lost: another process took it over');
    }
  }

  /** Spec §7 "Graceful SIGTERM releases the lock after the checkpoint". Never deletes another holder's lock. */
  release(): void {
    if (this.acquiredAt === null) return;
    this.db.raw
      .prepare('DELETE FROM app_lock WHERE id = 1 AND holder = @holder AND acquired_at = @acquiredAt')
      .run({ holder: this.holder, acquiredAt: this.acquiredAt });
    this.acquiredAt = null;
  }

  /** Test seam between the read and the write of one attempt (the BEGIN IMMEDIATE test). Does nothing in production. */
  protected afterRead(): void {
    // why: empty in production; a test subclass probes the write lock here.
  }

  /** One attempt under BEGIN IMMEDIATE: take an absent or stale lock, or confirm our own. */
  private tryAcquire(): boolean {
    return this.db.immediateTransaction((): boolean => {
      const now = this.clock.now();
      const row = this.db.raw
        .prepare<[], LockRow>('SELECT holder, heartbeat_at, acquired_at FROM app_lock WHERE id = 1')
        .get();
      this.afterRead();
      if (row !== undefined && row.holder === this.holder && row.acquired_at === this.acquiredAt) return true;
      if (row !== undefined) {
        const ageMs = Date.parse(now) - Date.parse(row.heartbeat_at);
        if (ageMs <= LOCK_STALE_AFTER_MS) return false;
        this.log.warn(
          { holder: this.holder, previousHolder: row.holder, lockAgeMs: ageMs },
          'taking over a stale app_lock (heartbeat older than 3 missed beats)',
        );
      }
      this.db.raw
        .prepare(
          'INSERT INTO app_lock (id, holder, heartbeat_at, acquired_at) VALUES (1, @holder, @now, @now) ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, heartbeat_at = excluded.heartbeat_at, acquired_at = excluded.acquired_at',
        )
        .run({ holder: this.holder, now });
      this.acquiredAt = now;
      return true;
    });
  }
}
