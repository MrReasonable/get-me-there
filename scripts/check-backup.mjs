#!/usr/bin/env node
// Checks a backup before a restore (spec §13 Restore; docs/setup.md section 6): opens the file read-only and runs
// SQLite's `PRAGMA integrity_check`, the check backupDatabase runs on every copy it writes.
//   node scripts/check-backup.mjs <file>
// Exit codes from the plan's single table (apps/api EXIT): 0 ok, 64 usage, 74 the backup is unusable; 1 when the
// built packages cannot be loaded.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: node scripts/check-backup.mjs <backup file>';

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  let EXIT;
  let checkBackup;
  try {
    // why: no rule of its own, like backup.mjs: the exit codes and the integrity check are apps/api's and @gmt/db's.
    const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
    ({ EXIT } = await import(new URL('../apps/api/dist/tools/types.js', import.meta.url).href));
    ({ checkBackup } = await import(pathToFileURL(requireFromApi.resolve('@gmt/db')).href));
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
    checkBackup(file);
    process.stdout.write(`${JSON.stringify({ ok: true, file })}\n`);
    return EXIT.ok;
  } catch (err) {
    process.stderr.write(`backup check failed: ${message(err)}\n`);
    return EXIT.backupFailed;
  }
}

process.exitCode = await main();
