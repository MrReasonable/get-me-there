import { basename, dirname, join } from 'node:path/posix';
import { asIsoDateTime, MOVED_MARKER, movedMarkerText } from '@gmt/core';
import type { Deps } from '../deps.js';
import { type Action, runAction } from '../plan/action.js';
import { databasePath } from '../services/specs.js';

/**
 * Putting a database in place as the native one (spec §13 imports and restore): the source is copied to a 0600
 * temporary file beside the target, checked with `PRAGMA integrity_check` (scripts/check-backup.mjs), the target's
 * `-wal` and `-shm` are removed, and the temporary file is renamed over the target, so the native database is always
 * absent, the old one or the new one, never partial.
 */
export const importingPath = (db: string): string => `${db}.importing`;

/** The `node scripts/check-backup.mjs <file>` step. */
export const checkAction = (deps: Deps, file: string): Action =>
  runAction([deps.execPath, join(deps.checkout, 'scripts', 'check-backup.mjs'), file], deps.checkout, {
    describe: `check ${file} with PRAGMA integrity_check (scripts/check-backup.mjs)`,
  });

/** Copy, check, clear the side files, rename into place. */
export function placeActions(
  deps: Deps,
  source: string,
  target = databasePath(deps.platform.paths),
): Action[] {
  const tmp = importingPath(target);
  // why: always planned (a removal of nothing is no error): a step before this one, the backup of the database being
  // replaced, can leave a -wal or -shm that was not there when the plan was made
  return [
    { kind: 'copy', from: source, to: tmp, mode: 0o600 },
    checkAction(deps, tmp),
    { kind: 'remove', path: `${target}-wal`, recursive: false },
    { kind: 'remove', path: `${target}-shm`, recursive: false },
    { kind: 'rename', from: tmp, to: target },
  ];
}

/** The marker's text for a move now: `core`'s one format, the instant in UTC to the millisecond. */
export const markerNow = (deps: Deps): string => movedMarkerText(asIsoDateTime(deps.now().toISOString()));

/** `--import-db`'s marker, written by the CLI itself beside the database it moved. */
export const markerBesideAction = (deps: Deps, db: string): Action => ({
  kind: 'writeFile',
  path: join(dirname(db), MOVED_MARKER),
  contents: markerNow(deps),
  mode: 0o644,
  secret: false,
});

/** A backup a child printed as `{ "ok": true, "file": "<path>" }` (scripts/backup.mjs's one line), or why not. */
export function printedBackup(
  stdout: string,
  dirPrefix: string,
): { ok: true; file: string } | { ok: false; error: string } {
  try {
    const v: unknown = JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
    if (
      typeof v === 'object' &&
      v !== null &&
      'ok' in v &&
      v.ok === true &&
      'file' in v &&
      typeof v.file === 'string'
    ) {
      const f = v.file;
      if (
        f.startsWith(`${dirPrefix}/`) &&
        /^[A-Za-z0-9._-]+\.db$/.test(basename(f)) &&
        !f.slice(dirPrefix.length + 1).includes('/')
      )
        return { ok: true, file: f };
    }
  } catch {
    // reported below
  }
  return { ok: false, error: 'the backup did not print the file it wrote' };
}

/** Runs a backup child whose output names its file; the step is shown in the plan and recorded like an action. */
export async function capturedBackup(
  deps: Deps,
  argv: readonly string[],
  dirPrefix: string,
): Promise<{ ok: true; file: string } | { ok: false; error: string }> {
  deps.io.out(`running: ${argv.join(' ')}\n`);
  const r = await deps.run(argv, { cwd: deps.checkout, timeoutMs: 600_000 });
  if (r.code !== 0) return { ok: false, error: `the backup exited with ${r.code}` };
  return printedBackup(r.stdout, dirPrefix);
}

/** `--import-db`: the source's lock, read without taking it (scripts/lock-state.mjs). */
export async function lockFree(deps: Deps, db: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await deps.run([deps.execPath, join(deps.checkout, 'scripts', 'lock-state.mjs'), db], {
    cwd: deps.checkout,
    timeoutMs: 60_000,
  });
  if (r.code !== 0) return { ok: false, error: `cannot read the lock of ${db}` };
  try {
    const v: unknown = JSON.parse(r.stdout);
    if (typeof v === 'object' && v !== null && 'state' in v && v.state !== 'fresh') return { ok: true };
  } catch {
    return { ok: false, error: `cannot read the lock of ${db}` };
  }
  return {
    ok: false,
    error: `an app or a tool is using ${db} (its lock is held): stop it, then run setup again`,
  };
}

/** `--replace-database`: the native database backed up before anything replaces it. */
export const nativeBackupAction = (deps: Deps): Action =>
  runAction(
    [
      deps.execPath,
      join(deps.checkout, 'scripts', 'backup.mjs'),
      '--db',
      databasePath(deps.platform.paths),
      '--dir',
      join(deps.platform.paths.data, 'backups'),
    ],
    deps.checkout,
    {
      describe: `back up the native database into ${join(deps.platform.paths.data, 'backups')} before replacing it`,
    },
  );
