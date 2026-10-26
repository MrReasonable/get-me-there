import type { Action } from '../plan/action.js';

/**
 * The worker's lock as the CLI reads it (`<workerData>/worker.lock`, core's WORKER_LOCK_FILE, holding the holder's pid):
 * the worker's own `lockHeld` rule, so a restart waits exactly as long as the worker's start check would refuse as
 * `locked`. Both executors judge a `waitUnlocked` action with these.
 */

/** The live pid holding a lock file's text, or null: no file, a pid that is not a positive integer, or a dead one. */
export function liveHolder(text: string | null, alive: (pid: number) => boolean): number | null {
  if (text === null) return null;
  // why: Number() ignores surrounding white space, so the text reads as the worker's trimmed read of it does
  const pid = Number(text);
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
}

/** What a `waitUnlocked` that ran out of time says: which process is still running, and what it holds. */
export const stillHeld = (a: Extract<Action, { kind: 'waitUnlocked' }>, pid: number): string =>
  `${a.holder} (pid ${pid}) is still running and holds ${a.path} after ${a.timeoutSeconds} s`;
