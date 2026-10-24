import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { START_REFUSAL_TEXT, type StartRefusal, startRefusalSchema } from '@gmt/core';
import { type Action, runAction } from '../plan/action.js';
import type { Paths, Platform, ServiceFacts } from '../platform/types.js';

/**
 * The camoufox worker's refusal file (spec §13; brief §5): `<workerData>/start-refusal.json`, `{ reason, at }` under
 * `startRefusalSchema` and nothing else. Read once; any other shape is "unreadable" and nothing from it is shown, so a
 * hostile file cannot put a command in front of the operator. WP17's `start` and `update` call these too.
 */
export const REFUSAL_FILE = 'start-refusal.json';
export const WORKER_LABEL = 'local.get-me-there.camoufox-worker';

export async function readStartRefusal(paths: Paths): Promise<StartRefusal | 'none' | 'unreadable'> {
  let text: string;
  try {
    text = await readFile(join(paths.workerData, REFUSAL_FILE), 'utf8');
  } catch (e) {
    return e instanceof Error && 'code' in e && e.code === 'ENOENT' ? 'none' : 'unreadable';
  }
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
  if (facts.get(WORKER_LABEL)?.loaded !== true) return [];
  return [runAction(['launchctl', 'bootout', `gui/${platform.uid}/${WORKER_LABEL}`], '/')];
}
