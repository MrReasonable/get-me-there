import { rmSync } from 'node:fs';
import { systemClock } from '@gmt/core';
import { acquireLock } from './lock.js';
import { profileDirs } from './paths.js';
import { Refusal } from './refusal.js';
import { type Entry, type EntryContext, EX_CONFIG } from './run.js';

/**
 * `clear-signed-in` (spec §2; devops-011): with the worker stopped (it takes the lock), wipes the profiles first, then
 * clears the persisted signed-in refusal, so the next start runs in a fresh signed-out profile.
 */
export function clearSignedIn(ctx: EntryContext, pid: number): number {
  let lock: { release(): void };
  try {
    lock = acquireLock(ctx.dataDir, { pid });
  } catch (e) {
    ctx.err(`${e instanceof Error ? e.message : String(e)}: stop the worker first`);
    return EX_CONFIG;
  }
  try {
    // why: CAMOUFOX_PAGES_AT_ONCE: every page session's profile, so none keeps the account it may have held
    for (const dir of profileDirs(ctx.dataDir)) rmSync(dir, { recursive: true, force: true });
    new Refusal({ dir: ctx.dataDir, clock: systemClock }).clear();
    ctx.out(
      'profile wiped and the signed-in refusal cleared; the next start uses a fresh signed-out profile',
    );
    return 0;
  } finally {
    lock.release();
  }
}

export const entry: Entry = async (ctx) => clearSignedIn(ctx, process.pid);
