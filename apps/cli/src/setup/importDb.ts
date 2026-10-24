import { basename, dirname, join } from 'node:path/posix';
import { asIsoDateTime, MOVED_MARKER, movedMarkerText } from '@gmt/core';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { type Action, runAction } from '../plan/action.js';
import { databasePath } from '../services/specs.js';

/**
 * Putting a database in place as the native one (spec §13 imports and restore; one implementation for both, U8): the
 * source is copied to a 0600 temporary file beside the target and checked with `PRAGMA integrity_check`
 * (scripts/check-backup.mjs); the current database is either kept whole under a timestamped name, its `-wal` and
 * `-shm` moved with it (restore), or left to the backup taken before (an import); any side file left is removed; and
 * the copy is renamed into place. The native database is always absent, the old one or the new one, never partial.
 */
export const importingPath = (db: string): string => `${db}.importing`;

/** The `node scripts/check-backup.mjs <file>` step. */
export const checkAction = (deps: Deps, file: string): Action =>
  runAction([deps.execPath, join(deps.checkout, 'scripts', 'check-backup.mjs'), file], deps.checkout, {
    describe: `check ${file} with PRAGMA integrity_check (scripts/check-backup.mjs)`,
    env: deps.childEnv,
  });

/** A filesystem-safe stamp of the instant, for names that must never replace an earlier copy. */
export const stampOf = (d: Date): string => d.toISOString().replace(/[:.]/g, '-');

/**
 * Copy, check, keep or clear the current file and its side files, rename into place. `keepAs` keeps the current
 * database (with its WAL pair, which SQLite pairs by name) under that name; without it the side files are removed,
 * always planned because a step before this one can leave them.
 */
export function placeActions(
  deps: Deps,
  source: string,
  opts: { target?: string; keepAs?: string } = {},
): Action[] {
  const target = opts.target ?? databasePath(deps.platform.paths);
  const tmp = importingPath(target);
  const present = (p: string) => deps.files.size(p) !== null;
  const keep: Action[] =
    opts.keepAs === undefined || !present(target)
      ? []
      : [
          { kind: 'rename', from: target, to: opts.keepAs },
          ...['-wal', '-shm']
            .filter((s) => present(`${target}${s}`))
            .map((s): Action => ({ kind: 'rename', from: `${target}${s}`, to: `${opts.keepAs}${s}` })),
        ];
  return [
    { kind: 'copy', from: source, to: tmp, mode: 0o600 },
    checkAction(deps, tmp),
    ...keep,
    { kind: 'remove', path: `${target}-wal`, recursive: false },
    { kind: 'remove', path: `${target}-shm`, recursive: false },
    { kind: 'rename', from: tmp, to: target },
  ];
}

const checkedSchema = z.object({
  ok: z.literal(true),
  resumable: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(),
});

/** What scripts/check-backup.mjs printed about a checked file: the runs a start resumes and the schedules it may catch up. */
export function checkedSummary(stdout: string): { resumable: number; scheduled: number } | null {
  try {
    const r = checkedSchema.safeParse(JSON.parse(stdout.trim().split('\n').at(-1) ?? ''));
    return r.success ? { resumable: r.data.resumable, scheduled: r.data.scheduled } : null;
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * cb-b1-010: what the first start on a restored or imported database does, said before the operator starts it (the
 * boot resumes what it held as unfinished and catches up a missed firing once per scheduled search); empty when nothing.
 */
export function startNote(
  summary: { resumable: number; scheduled: number } | null,
  when: 'later' | 'now' = 'later',
): string {
  if (summary === null) return '';
  const parts: string[] = [];
  const runs = plural(summary.resumable, 'unfinished run', 'unfinished runs');
  if (summary.resumable > 0)
    parts.push(
      when === 'later'
        ? `Starting the app resumes ${runs} from this database (set AUTO_RESUME=false in app.env first to leave them for you to resume or cancel).`
        : `The app now starts on this database and resumes ${runs} it holds (cancel them from the app's status bar if you did not want them).`,
    );
  if (summary.scheduled > 0)
    parts.push(
      summary.scheduled === 1
        ? '1 scheduled search may catch up its latest missed firing once when the app starts; that run spends calls like any other.'
        : `${summary.scheduled} scheduled searches may each catch up their latest missed firing once when the app starts; those runs spend calls like any other.`,
    );
  return parts.length === 0 ? '' : `${parts.join(' ')}\n`;
}

/**
 * cb-b1-010: what to correct after the ledger went back in time, by SearchApi plan (the trial's count lives in app.env;
 * the paid plan's cap is the hard stop).
 */
export function dashboardText(plan: string | undefined): string {
  if (plan === 'trial')
    return 'A restored ledger lacks any call made after its backup: check SearchApi’s dashboard and raise SEARCHAPI_TRIAL_USED in app.env to match (pnpm gmt setup --reconfigure searchapi), and check each other vendor’s dashboard.';
  if (plan === '40usd')
    return 'A restored ledger lacks any call made after its backup: check SearchApi’s dashboard and lower SEARCHAPI_MONTHLY_CALL_CAP in app.env by the calls it shows since the backup, and check each other vendor’s dashboard.';
  return 'A restored ledger lacks any call made after its backup, so check each vendor’s dashboard.';
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

const printedSchema = z.object({ ok: z.literal(true), file: z.string() });

/**
 * The backup a child printed as `{ "ok": true, "file": "<path>" }` (scripts/backup.mjs's one line), when it names a
 * `.db` file directly inside `dirPrefix`; else why not.
 */
export function printedBackup(
  stdout: string,
  dirPrefix: string,
): { ok: true; file: string } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
  } catch {
    return { ok: false, error: 'the backup did not print the file it wrote' };
  }
  const r = printedSchema.safeParse(json);
  if (!r.success) return { ok: false, error: 'the backup did not print the file it wrote' };
  const f = r.data.file;
  return dirname(f) === dirPrefix && /^[A-Za-z0-9._-]+\.db$/.test(basename(f))
    ? { ok: true, file: f }
    : { ok: false, error: 'the backup did not print the file it wrote' };
}

/** `scripts/backup.mjs --db <db> --dir <dir>` as an action, its printed file read with printedBackup. */
export const backupAction = (deps: Deps, db: string, dir: string, extra: readonly string[] = []): Action =>
  runAction(
    [deps.execPath, join(deps.checkout, 'scripts', 'backup.mjs'), '--db', db, '--dir', dir, ...extra],
    deps.checkout,
    { env: deps.childEnv },
  );

/** `--replace-database`: the native database backed up before anything replaces it. */
export const nativeBackupAction = (deps: Deps): Action =>
  backupAction(deps, databasePath(deps.platform.paths), join(deps.platform.paths.data, 'backups'));

// why: U9 (ca-b1-017, dev-b1-014): an unknown state is not free; only no lock, or one whose holder stopped beating
const lockSchema = z.object({ state: z.enum(['absent', 'fresh', 'stale']) });

/** `--import-db`: the source's lock, read without taking it (scripts/lock-state.mjs). Only absent or stale is free. */
export async function lockFree(deps: Deps, db: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await deps.run([deps.execPath, join(deps.checkout, 'scripts', 'lock-state.mjs'), db], {
    cwd: deps.checkout,
    timeoutMs: 60_000,
    env: deps.childEnv,
  });
  let state: string | null = null;
  try {
    const parsed = lockSchema.safeParse(JSON.parse(r.stdout));
    state = r.code === 0 && parsed.success ? parsed.data.state : null;
  } catch {
    state = null;
  }
  if (state === null) return { ok: false, error: `cannot read the lock of ${db}` };
  if (state === 'fresh')
    return {
      ok: false,
      error: `an app or a tool is using ${db} (its lock is held): stop it, then run setup again`,
    };
  return { ok: true };
}
