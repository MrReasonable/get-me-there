/** Spec §7 `app_lock` for the app holder, judged read-only before anything touches the database (plan decision 53). */
import type { Clock, Logger, Secret } from '@gmt/core';
import { readOnlyLockState } from '@gmt/db';
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';
import { BootError } from './errors.js';

/** Spec §7: a fresh tool lock makes the app wait up to 60 s, then refuse. */
export const TOOL_LOCK_WAIT_MS = 60_000;
/**
 * Spec §7: a fresh app lock is waited on up to 90 s (three missed 30 s beats): a crashed app's lock goes stale inside
 * that time; one still being heartbeated after it belongs to a second live app, which is refused (decision 53).
 */
export const APP_LOCK_WAIT_MS = 90_000;
export const LOCK_POLL_MS = 1_000;
const LOG_EVERY_MS = 10_000;

export interface LockWaitDeps {
  databasePath: string;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  log: Logger;
  secrets: readonly Secret[];
}

const seconds = (v: number): number => Math.round(v / 1000);

/**
 * Plan decision 53: before any backup or migration, the app reads `app_lock` read-only (WP3's `readOnlyLockState`, as
 * the record tool does) and waits while it is fresh — up to 60 s for a tool, 90 s for another app — polling every
 * second and logging the holder and the lock's age every 10 s; it returns once the lock is absent or stale, and refuses
 * with 75 when the wait runs out. A second app started against a live one therefore never backs up or migrates. The
 * lock itself is taken after the migrations, when the table is sure to exist (`AppLock.acquire`, which also catches a
 * process that took it in between). why: not `AppLock.acquire`'s own wait (review arch-006): acquire writes the lock
 * row, so it needs the migrated table, and the point of decision 53 is that nothing writes before the lock is judged.
 */
export async function waitForLockFree(d: LockWaitDeps): Promise<void> {
  const started = Date.parse(d.clock.now());
  let lastLogAt = Number.NEGATIVE_INFINITY;
  for (;;) {
    let state: ReturnType<typeof readOnlyLockState>;
    try {
      state = readOnlyLockState(d.databasePath, d.clock);
    } catch (e) {
      throw new BootError(
        `cannot read app_lock in ${d.databasePath}: ${safeMessage(e, d.secrets)}; refusing (spec §7)`,
        EXIT.preflightImpossible,
      );
    }
    if (state.state !== 'fresh') return;
    const now = Date.parse(d.clock.now());
    const waited = now - started;
    const lockAgeMs = now - Date.parse(state.heartbeatAt);
    const limit = state.holder === 'tool' ? TOOL_LOCK_WAIT_MS : APP_LOCK_WAIT_MS;
    // why: strictly past the limit: WP3 calls a lock fresh up to and including 90 s, so a crashed app's lock taken as
    // the wait began turns stale on the next poll after 90 s, not on the poll at 90 s.
    if (waited > limit)
      throw new BootError(
        state.holder === 'tool'
          ? `app_lock is held by a tool process (heartbeat ${seconds(lockAgeMs)}s ago); waited ${seconds(waited)}s; start the app when the tool has finished`
          : `app_lock is held by another app process that is still heartbeating (${seconds(lockAgeMs)}s ago); refusing to start a second app`,
        EXIT.lockRefused,
      );
    if (waited - lastLogAt >= LOG_EVERY_MS) {
      d.log.warn({ holder: state.holder, lockAgeMs, waitedMs: waited }, 'waiting for app_lock');
      lastLogAt = waited;
    }
    await d.sleep(LOCK_POLL_MS);
  }
}
