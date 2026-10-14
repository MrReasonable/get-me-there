import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '@gmt/core';
import Database from 'better-sqlite3';

const BACKUP_FILE = /^get-me-there-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/;

/** The default check: SQLite's own integrity verdict on the copy. */
function integrityCheck(file: string): string {
  const out = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return String(out.pragma('integrity_check', { simple: true }));
  } finally {
    out.close();
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
    .filter((f) => BACKUP_FILE.test(f))
    .sort()
    .reverse();
  for (const old of backups.slice(opts.keep)) rmSync(join(backupsDir, old));
  return { file };
}
