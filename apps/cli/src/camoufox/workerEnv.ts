import { createHash } from 'node:crypto';
import { join } from 'node:path/posix';
import {
  readSharedSettings,
  SHARED_WORKER_SETTINGS,
  type SharedSettings,
  sharedMode,
  sharedSettingDiffs,
} from '@gmt/core';
import type { Files } from '../exec/files.js';
import type { Paths } from '../platform/types.js';
import { readEnvText } from '../setup/appEnv.js';

/**
 * The worker's settings file and the key the app shares with it (spec §12 "Where settings live"; brief WP17 Task 17.6).
 * `<workerData>/worker.env` (0600, in its 0700 directory) holds `CAMOUFOX_WORKER_KEY` and the shared settings, which
 * setup copies from the app's effective record so `sharedSettingDiffs` is empty; `app.env` gets the same key and
 * `CAMOUFOX_WORKER_URL`. A key is 24 random bytes as hex (48 characters, `[0-9a-f]`). Keys are compared by digest and
 * reported only as "keys differ"; no key ever reaches an output.
 */
export const WORKER_URL = 'http://127.0.0.1:8090';
export const WORKER_KEY_BYTES = 24;
export const workerEnvPath = (paths: Paths): string => join(paths.workerData, 'worker.env');
/** The app.env lines the browser step writes (beside CAMOUFOX_BROWSER_WINDOW, the window group's). */
export const BROWSER_APP_NAMES = ['CAMOUFOX_ENABLED', 'CAMOUFOX_WORKER_URL', 'CAMOUFOX_WORKER_KEY'] as const;

/** A new worker key from `randomBytes` (24 bytes, hex). */
export const newWorkerKey = (randomBytes: (n: number) => Buffer): string =>
  randomBytes(WORKER_KEY_BYTES).toString('hex');

/** The settings file's record, or null when there is none (an unreadable one throws, as Files does). */
export function readWorkerEnv(files: Files, paths: Paths): Record<string, string> | null {
  const text = files.read(workerEnvPath(paths));
  return text === null ? null : readEnvText(text);
}

/** The app's effective shared settings, the values worker.env must hold. */
export const appShared = (appRecord: Readonly<Record<string, string>>): SharedSettings =>
  readSharedSettings(appRecord).settings;

const HEADER = [
  '# get-me-there browser worker settings, written by `pnpm gmt setup` (docs/setup.md section 14).',
  '# Keep this file 0600. The shared settings must equal app.env’s; setup keeps them equal.',
];

/**
 * worker.env's text: the key, then the nine shared settings with the app's effective values; any other line already
 * there (the operator's own, CAMOUFOX_WORKER_PORT or the spacing) is kept as it was.
 */
export function renderWorkerEnv(key: string, shared: SharedSettings, existingText: string | null): string {
  const owned = new Set<string>(['CAMOUFOX_WORKER_KEY', ...SHARED_WORKER_SETTINGS]);
  const kept = (existingText ?? '').split('\n').filter((l) => {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1];
    return name !== undefined && !owned.has(name);
  });
  const lines = [
    ...HEADER,
    `CAMOUFOX_WORKER_KEY="${key}"`,
    ...SHARED_WORKER_SETTINGS.map((n) => `${n}="${shared[n]}"`),
    ...kept,
  ];
  return `${lines.join('\n')}\n`;
}

/** The names on which the two files' effective shared settings differ (names only), in the app's mode. */
export function settingsDiffer(
  appRecord: Readonly<Record<string, string>>,
  workerRecord: Readonly<Record<string, string>>,
): readonly string[] {
  const app = appShared(appRecord);
  return sharedSettingDiffs(app, readSharedSettings(workerRecord).settings, sharedMode(app));
}

const digest = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Whether the two files hold different keys (by digest; a missing key on either side differs). */
export function keysDiffer(
  appRecord: Readonly<Record<string, string | undefined>>,
  workerRecord: Readonly<Record<string, string | undefined>> | null,
): boolean {
  const a = appRecord.CAMOUFOX_WORKER_KEY;
  const w = workerRecord?.CAMOUFOX_WORKER_KEY;
  return a === undefined || w === undefined || a === '' || digest(a) !== digest(w);
}

/** app.env's text with the browser lines set (replaced in place, or appended), every other line kept. */
export function withBrowserLines(text: string, entries: ReadonlyArray<readonly [string, string]>): string {
  const wanted = new Map(entries);
  const placed = new Set<string>();
  const out: string[] = [];
  for (const l of text.replace(/\n$/, '').split('\n')) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1];
    const v = name === undefined ? undefined : wanted.get(name);
    if (name === undefined || v === undefined) {
      out.push(l);
      continue;
    }
    if (!placed.has(name)) out.push(`${name}="${v}"`);
    placed.add(name);
  }
  for (const [n, v] of wanted) if (!placed.has(n)) out.push(`${n}="${v}"`);
  return `${out.join('\n')}\n`;
}
