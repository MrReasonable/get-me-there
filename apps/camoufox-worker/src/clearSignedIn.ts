import { rmSync } from 'node:fs';
import { systemClock } from '@gmt/core';
import { acquireLock } from './lock.js';
import { profileDir } from './paths.js';
import { Refusal } from './refusal.js';
import { type Entry, type EntryContext, EX_CONFIG } from './run.js';

/**
 * `clear-signed-in` (spec §2; devops-011): with the worker stopped (it takes the lock), wipes the profile first, then
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
    rmSync(profileDir(ctx.dataDir), { recursive: true, force: true });
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
