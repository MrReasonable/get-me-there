import { join } from 'node:path/posix';
import { START_REFUSAL_TEXT, type StartRefusal, startRefusalSchema } from '@gmt/core';
import type { Files } from '../exec/files.js';
import type { Action } from '../plan/action.js';
import type { Paths, Platform, ServiceFacts } from '../platform/types.js';
import { launchdLabel } from '../services/launchd.js';

/**
 * The camoufox worker's refusal file (spec §13; brief §5): `<workerData>/start-refusal.json`, `{ reason, at }` under
 * `startRefusalSchema` and nothing else. Read once; any other shape is "unreadable" and nothing from it is shown, so a
 * hostile file cannot put a command in front of the operator. WP17's `start` and `update` call these too, with
 * `deps.files`.
 */
export const REFUSAL_FILE = 'start-refusal.json';
export const WORKER_LABEL = launchdLabel('camoufox-worker');

/** The refusal, read through Files (ca-b1-024): none when absent; unreadable when it cannot be read or is any other shape. */
export function readStartRefusal(paths: Paths, files: Files): StartRefusal | 'none' | 'unreadable' {
  let text: string | null;
  try {
    text = files.read(join(paths.workerData, REFUSAL_FILE));
  } catch {
    return 'unreadable';
  }
  if (text === null) return 'none';
  try {
    const r = startRefusalSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/** "refused, not retrying: <START_REFUSAL_TEXT summary>". */
export const refusalLine = (r: StartRefusal): string =>
  `refused, not retrying: ${START_REFUSAL_TEXT[r.reason].summary}`;

/**
 * macOS: launchd's KeepAlive cannot exclude exit 78, so a refused worker's loaded agent is booted out while the refusal
 * stands (spec §13); elsewhere, or with no refusal or no loaded agent, nothing.
 */
export function bootOutRefused(
  platform: Platform,
  facts: ReadonlyMap<string, ServiceFacts>,
  r: StartRefusal | 'none' | 'unreadable',
): Action[] {
  if (platform.os !== 'darwin' || r === 'none' || r === 'unreadable') return [];
  const f = facts.get(WORKER_LABEL);
  // why: ca-b1-016: the service manager's own stop (bootout, then wait until the label is gone), not a second argv
  return f?.loaded === true ? platform.serviceManager.stop(WORKER_LABEL, f) : [];
}
