import { createHash } from 'node:crypto';
import { join } from 'node:path/posix';
import {
  readSharedSettings,
  SHARED_WORKER_SETTINGS,
  type SharedSettings,
  workerPortOf,
  workerUrlFor,
} from '@gmt/core';
import type { Files } from '../exec/files.js';
import type { Paths } from '../platform/types.js';
import { NAME_OF_LINE, readEnvText, readsBack, setLines } from '../setup/appEnv.js';

/**
 * The worker's settings file and the key the app shares with it (spec §12 "Where settings live"; brief WP17 Task 17.6).
 * `<workerData>/worker.env` (0600, in its 0700 directory) holds `CAMOUFOX_WORKER_KEY` and the shared settings, which
 * setup copies from the app's effective record so `sharedSettingDiffs` is empty; `app.env` gets the same key and
 * `CAMOUFOX_WORKER_URL`, built from worker.env's own port (core's rule). A key is 24 random bytes as hex (48
 * characters, `[0-9a-f]`). Keys are compared by digest and reported only as "keys differ"; no key ever reaches an
 * output. Both files are edited by app.env's one line editor and read back before they are written.
 */
export const WORKER_KEY_BYTES = 24;
export const workerEnvPath = (paths: Paths): string => join(paths.workerData, 'worker.env');

/** A new worker key from `randomBytes` (24 bytes, hex). */
export const newWorkerKey = (randomBytes: (n: number) => Buffer): string =>
  randomBytes(WORKER_KEY_BYTES).toString('hex');

/** The settings file's record, or null when there is none (an unreadable one throws, as Files does). */
export function readWorkerEnv(files: Files, paths: Paths): Record<string, string> | null {
  const text = files.read(workerEnvPath(paths));
  return text === null ? null : readEnvText(text);
}

/** The app's address for this machine's worker: its own CAMOUFOX_WORKER_PORT (8090 unset), null when that is no port. */
export function workerUrlOf(workerRecord: Readonly<Record<string, string>> | null): string | null {
  const port = workerPortOf(workerRecord?.CAMOUFOX_WORKER_PORT);
  return port === null ? null : workerUrlFor(port);
}

/** The app's effective shared settings, the values worker.env must hold. */
export const appShared = (appRecord: Readonly<Record<string, string>>): SharedSettings =>
  readSharedSettings(appRecord).settings;

const HEADER = [
  '# get-me-there browser worker settings, written by `pnpm gmt setup` (docs/setup.md section 14).',
  '# Keep this file 0600. The shared settings must equal app.env’s; setup keeps them equal.',
];
const OWNED = new Set<string>(['CAMOUFOX_WORKER_KEY', ...SHARED_WORKER_SETTINGS]);

/**
 * worker.env's text: the key, then the shared settings with the app's effective values; any other line already there
 * (the operator's own, CAMOUFOX_WORKER_PORT) is kept as it was. It is read back before it is returned: the owned values
 * must read back as written and every kept name as it read before; a kept value spread over several lines is refused.
 */
export function renderWorkerEnv(
  key: string,
  shared: SharedSettings,
  existingText: string | null,
): { ok: true; text: string } | { ok: false; error: string } {
  const before = readEnvText(existingText ?? '');
  const kept: string[] = [];
  for (const l of (existingText ?? '').split('\n')) {
    const name = NAME_OF_LINE.exec(l)?.[1];
    if (name === undefined || OWNED.has(name)) continue;
    // why: sec-b1-007: a value opened by a quote and not closed on its line continues on the next; the editor keeps
    // whole lines, so such a value is refused rather than cut
    const value = l.slice(l.indexOf('=') + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.lastIndexOf(q) === 0)
      return {
        ok: false,
        error: `worker.env holds ${name} over several lines; put it on one line, then run setup again`,
      };
    kept.push(l);
  }
  const entries: Array<[string, string]> = [
    ['CAMOUFOX_WORKER_KEY', key],
    ...SHARED_WORKER_SETTINGS.map((n): [string, string] => [n, String(shared[n])]),
  ];
  const text = setLines([...HEADER, ...kept].join('\n'), OWNED, entries);
  const owned = readsBack(text, entries);
  if (!owned.ok) return { ok: false, error: `worker.env ${owned.error}` };
  const keptBack = readsBack(
    text,
    Object.entries(before).filter(([n]) => !OWNED.has(n)),
  );
  return keptBack.ok ? { ok: true, text } : { ok: false, error: `worker.env ${keptBack.error}` };
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

/** The app.env names the browser step writes (beside CAMOUFOX_BROWSER_WINDOW, the browser group's). */
const BROWSER_APP = new Set(['CAMOUFOX_ENABLED', 'CAMOUFOX_WORKER_URL', 'CAMOUFOX_WORKER_KEY']);

/**
 * app.env's text with these browser lines set, through app.env's one line editor, then read back; null with the
 * reason when it would not read back as written.
 */
export function appEnvWithBrowser(
  text: string,
  entries: ReadonlyArray<readonly [string, string]>,
): { ok: true; text: string } | { ok: false; error: string } {
  const out = setLines(text, new Set(entries.map(([n]) => n).filter((n) => BROWSER_APP.has(n))), entries);
  const back = readsBack(out, entries);
  return back.ok ? { ok: true, text: out } : { ok: false, error: `app.env ${back.error}` };
}

/** The names worker.env may no longer hold: the install owns the build and its directory (decision 73). */
export const RETIRED_WORKER_NAMES = ['CAMOUFOX_BINARY_BUILD', 'CAMOUFOX_INSTALL_DIR'] as const;

/** worker.env's text without any line naming a retired name, and the retired names it held. */
export function retiredWorkerLines(text: string): { text: string; removed: string[] } {
  const record = readEnvText(text);
  const removed = RETIRED_WORKER_NAMES.filter((n) => record[n] !== undefined);
  return { text: setLines(text, new Set<string>(RETIRED_WORKER_NAMES), []), removed: [...removed] };
}
