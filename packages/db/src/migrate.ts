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
  const hasTable = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (hasTable === undefined) return journal.entries.map((e) => e.tag);
  const last = db.raw.prepare('SELECT MAX(created_at) AS at FROM __drizzle_migrations').get() as { at: number | null };
  // why: drizzle applies migrations in journal order and stores each folder timestamp as created_at,
  // so everything with a later `when` is pending.
  return journal.entries.filter((e) => last.at === null || e.when > last.at).map((e) => e.tag);
}

/** Applies the committed Drizzle SQL migrations idempotently. Spec §7 "Migrations". */
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] } {
  let pending: string[];
  try {
    pending = pendingMigrations(db, migrationsDir);
    migrate(db.drizzle, { migrationsFolder: migrationsDir });
  } catch (err) {
    throw new Error(`migration failed in ${migrationsDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { applied: pending };
}
