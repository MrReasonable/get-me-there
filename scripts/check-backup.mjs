#!/usr/bin/env node
// Checks a backup before a restore (spec §13 Restore; docs/setup.md section 6): opens the file read-only and runs
// SQLite's `PRAGMA integrity_check`, the check backupDatabase runs on every copy it writes.
//   node scripts/check-backup.mjs <file>
// Exit codes from the plan's single table (apps/api EXIT): 0 ok, 64 usage, 74 the backup is unusable; 1 when the
// built packages cannot be loaded.
import { createRequire } from 'node:module';

const USAGE = 'usage: node scripts/check-backup.mjs <backup file>';

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  let EXIT;
  let Database;
  try {
    ({ EXIT } = await import(new URL('../apps/api/dist/tools/types.js', import.meta.url).href));
    // why: resolve from packages/db, the one workspace package that depends on better-sqlite3 (as the prebuilt check).
    Database = createRequire(new URL('../packages/db/package.json', import.meta.url))('better-sqlite3');
  } catch (err) {
    process.stderr.write(`check-backup: cannot load the built packages (run pnpm build): ${message(err)}\n`);
    return 1;
  }
  const args = process.argv.slice(2);
  const file = args[0];
  if (args.length !== 1 || file === undefined || file === '' || file.startsWith('--')) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.usage;
  }
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    let verdict;
    try {
      verdict = String(db.pragma('integrity_check', { simple: true }));
    } finally {
      db.close();
    }
    if (verdict !== 'ok') throw new Error(`integrity_check returned ${verdict}`);
    process.stdout.write(`${JSON.stringify({ ok: true, file })}\n`);
    return EXIT.ok;
  } catch (err) {
    process.stderr.write(`backup check failed: ${message(err)}\n`);
    return EXIT.backupFailed;
  }
}

process.exitCode = await main();
