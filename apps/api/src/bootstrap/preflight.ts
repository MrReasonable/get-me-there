/**
 * The pre-migration preflight both bootstraps share (spec §7 SQLite settings and Migrations; plan "Wiring and
 * bootstraps": both call backupDatabase before buildPorts when pendingMigrations() is non-empty). The tool bootstrap
 * uses it today and WP8's app bootstrap reuses it (arch M-1); WP12's scripts/backup.mjs uses the same directory and
 * keep count. Under bootstrap/, so the process.env rule is unchanged; nothing here reads the environment.
 */
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Clock, Secret } from '@gmt/core';
import { backupDatabase, openDatabase, pendingMigrations } from '@gmt/db';
import { safeMessage } from '../safeMessage.js';
import { EXIT } from '../tools/types.js';

/** Spec §7 Migrations: keep the last 5 backups. */
export const BACKUPS_KEPT = 5;

/** Spec §7: backups live beside the database (`/data/backups` in the container). */
export function backupsDirFor(databasePath: string): string {
  return join(dirname(databasePath), 'backups');
}

/** Why the database's directory cannot take a new file or SQLite's side files, or null (73 in the tool). */
export function dataDirRefusal(databasePath: string): string | null {
  if (databasePath === ':memory:') return null;
  try {
    accessSync(dirname(databasePath), constants.W_OK);
    return null;
  } catch {
    return `data directory ${dirname(databasePath)} is not writable; refusing (spec §7)`;
  }
}

/**
 * Pending migrations on a database file that already exists (none for a new file or :memory:). why: this opens the file
 * read-write through openDatabase (journal-mode pragma, checkpoint on close) but changes no schema; only the app_lock
 * read before it is strictly read-only (arch-r2-003).
 */
export function pendingOnExistingDb(databasePath: string, migrationsDir: string): string[] {
  if (databasePath === ':memory:' || !existsSync(databasePath)) return [];
  const db = openDatabase(databasePath);
  try {
    return pendingMigrations(db, migrationsDir);
  } finally {
    db.close();
  }
}

export type BackupOutcome =
  | { ok: true; line: string | null }
  | { ok: false; code: typeof EXIT.preflightImpossible | typeof EXIT.backupFailed; message: string };

/**
 * Backs the database up when migrations are pending (spec §7: "a failed backup refuses migrations"). 73 when the
 * migration state cannot be read or the backups path is not a writable directory; 74 when the backup itself fails.
 * Messages are scrubbed of every configured secret and URL query.
 */
export function backupBeforeMigrations(
  databasePath: string,
  migrationsDir: string,
  clock: Clock,
  secrets: readonly Secret[],
): BackupOutcome {
  let pending: string[];
  try {
    pending = pendingOnExistingDb(databasePath, migrationsDir);
  } catch (e) {
    return {
      ok: false,
      code: EXIT.preflightImpossible,
      message: `cannot read the migration state: ${safeMessage(e, secrets)}`,
    };
  }
  if (pending.length === 0) return { ok: true, line: null };
  const backupsDir = backupsDirFor(databasePath);
  if (existsSync(backupsDir)) {
    try {
      if (!statSync(backupsDir).isDirectory()) throw new Error('not a directory');
      accessSync(backupsDir, constants.W_OK);
    } catch {
      return {
        ok: false,
        code: EXIT.preflightImpossible,
        message: `${pending.length} pending migration(s) but the backups directory ${backupsDir} is not a writable directory; refusing to migrate (spec §7)`,
      };
    }
  }
  try {
    // why: backupDatabase creates the directory itself, 0o700 (arch-015)
    const { file } = backupDatabase(databasePath, backupsDir, { keep: BACKUPS_KEPT, clock });
    return { ok: true, line: `backup before ${pending.length} migration(s): ${file}` };
  } catch (e) {
    return {
      ok: false,
      code: EXIT.backupFailed,
      message: `backup failed, refusing to migrate (spec §7): ${safeMessage(e, secrets)}`,
    };
  }
}
