import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';

interface Journal {
  entries: Array<{ tag: string; when: number }>;
}

/** Drizzle's journal lists every migration tag; `__drizzle_migrations` records the applied ones. */
export function pendingMigrations(db: Db, migrationsDir: string): string[] {
  const journal: Journal = JSON.parse(readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'));
  const hasTable = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  // why: drizzle applies migrations in journal order and stores each folder timestamp as created_at, so
  // everything with a later `when` is pending; MAX() over an empty table yields one NULL row.
  const applied: number | null = hasTable
    ? (db.raw
        .prepare<[], { at: number | null }>('SELECT MAX(created_at) AS at FROM __drizzle_migrations')
        .get()?.at ?? null)
    : null;
  return journal.entries.filter((e) => applied === null || e.when > applied).map((e) => e.tag);
}

/** Applies the committed Drizzle SQL migrations idempotently. Spec §7 "Migrations". */
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] } {
  let pending: string[];
  // why: migration 0005 rebuilds tables other tables reference; PRAGMA foreign_keys has no effect inside the migrator's
  // transaction, so it is turned off around the run and every reference is checked after it (WP14 Task 14.7).
  const fk = db.raw.pragma('foreign_keys', { simple: true });
  db.raw.pragma('foreign_keys = OFF');
  try {
    pending = pendingMigrations(db, migrationsDir);
    migrate(db.drizzle, { migrationsFolder: migrationsDir });
    const broken = db.raw.pragma('foreign_key_check');
    if (Array.isArray(broken) && broken.length > 0)
      // why: fix round 1 (arch M14): the migration is already recorded, so every boot fails here until the database is
      // restored; the message names that way back
      throw new Error(
        `foreign_key_check found ${broken.length} broken references after the migration was recorded; restore the pre-migration backup (the backups directory beside DATABASE_PATH)`,
      );
  } catch (err) {
    throw new Error(
      `migration failed in ${migrationsDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    db.raw.pragma(`foreign_keys = ${fk === 1 ? 'ON' : 'OFF'}`);
  }
  return { applied: pending };
}
