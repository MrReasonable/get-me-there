import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BACKUP_FILE_PATTERN, type Clock } from '@gmt/core';
import Database from 'better-sqlite3';
import { ACTIVE_STATUS_SQL } from './schema/checks.js';

/** The default check: SQLite's own integrity verdict on the copy. Internal; exported for its test only. */
export function integrityCheck(file: string): string {
  const out = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return String(out.pragma('integrity_check', { simple: true }));
  } finally {
    out.close();
  }
}

/**
 * Spec §13 "Restore": throws unless the file opens read-only and SQLite's integrity verdict is `ok`. The rule
 * scripts/check-backup.mjs runs before a restore; `verify` is injectable like backupDatabase's, for its test.
 */
export function checkBackup(file: string, verify: (file: string) => string = integrityCheck): void {
  const verdict = verify(file);
  if (verdict !== 'ok') throw new Error(`integrity_check returned ${verdict}`);
}

/**
 * What starting the app on this database will do (cb-b1-010), read without writing: `resumable` counts the top-level
 * runs left active (the boot sweep marks a `running` one interrupted, then AUTO_RESUME resumes it), `scheduled` the
 * enabled, undeleted searches with a schedule (each may catch up its latest missed firing once). A database with no
 * such tables (never migrated) counts none.
 */
export function backupSummary(file: string): { resumable: number; scheduled: number } {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const columns = (t: string): Set<string> => {
      const rows: unknown = db.prepare(`PRAGMA table_info(${t})`).all();
      const out = new Set<string>();
      if (Array.isArray(rows))
        for (const r of rows) if (typeof r === 'object' && r !== null && 'name' in r) out.add(String(r.name));
      return out;
    };
    const n = (sql: string): number => {
      const row: unknown = db.prepare(sql).get();
      return typeof row === 'object' && row !== null && 'n' in row && typeof row.n === 'number' ? row.n : 0;
    };
    // why: an imported or restored file may predate later migrations, so each filter is used only where its column is
    const ex = columns('search_executions');
    const def = columns('search_definitions');
    return {
      resumable: ex.has('status')
        ? n(
            `SELECT COUNT(*) AS n FROM search_executions WHERE status IN (${ACTIVE_STATUS_SQL})${ex.has('is_child') ? ' AND is_child = 0' : ''}`,
          )
        : 0,
      scheduled: def.has('schedule_cron')
        ? n(
            `SELECT COUNT(*) AS n FROM search_definitions WHERE schedule_cron IS NOT NULL${def.has('enabled') ? ' AND enabled = 1' : ''}${def.has('deleted_at') ? ' AND deleted_at IS NULL' : ''}`,
          )
        : 0,
    };
  } finally {
    db.close();
  }
}

/**
 * Spec §7 "Migrations" and §13 "Backup" (decision 14): `VACUUM INTO` a timestamped file under `backupsDir`, check its
 * integrity, keep the newest `keep` backups. Throws on any failure, so the caller refuses migrations and boot fails
 * naming the cause. The copy holds every table, so it is created private (0600 in a 0700 directory).
 */
export function backupDatabase(
  dbPath: string,
  backupsDir: string,
  opts: { keep: number; clock: Clock; verify?: (file: string) => string },
): { file: string } {
  if (!Number.isSafeInteger(opts.keep) || opts.keep < 1)
    throw new RangeError(`keep must be a positive integer, got ${opts.keep}`);
  if (!existsSync(dbPath)) throw new Error(`backup refused: ${dbPath} does not exist`);
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const dir = lstatSync(backupsDir);
  if (!dir.isDirectory()) throw new Error(`backup refused: ${backupsDir} is not a directory`);
  // why: in a world-writable directory another local user could plant or swap files between our checks.
  if ((dir.mode & 0o002) !== 0) throw new Error(`backup refused: ${backupsDir} is world-writable`);
  // why: ':' is not portable in file names; the stamp stays lexically sortable.
  const file = join(backupsDir, `get-me-there-${opts.clock.now().replace(/[:.]/g, '-')}.db`);
  try {
    // why: 'wx' fails on any existing entry, symlinks included (dangling ones too), and never follows them.
    closeSync(openSync(file, 'wx', 0o600));
  } catch (err) {
    throw new Error(
      `backup refused: ${file} already exists (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  try {
    const src = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      src.prepare('VACUUM INTO ?').run(file);
    } finally {
      src.close();
    }
    const verdict = (opts.verify ?? integrityCheck)(file);
    if (verdict !== 'ok') throw new Error(`integrity_check returned ${verdict}`);
  } catch (err) {
    // why: this call created the file above, so removing it cannot delete someone else's; nothing half-written survives.
    rmSync(file, { force: true });
    throw new Error(`backup failed for ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const backups = readdirSync(backupsDir)
    .filter((f) => BACKUP_FILE_PATTERN.test(f))
    .sort()
    .reverse();
  for (const old of backups.slice(opts.keep)) rmSync(join(backupsDir, old));
  return { file };
}
