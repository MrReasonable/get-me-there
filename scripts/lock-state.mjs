#!/usr/bin/env node
// Reports a database's app_lock without taking it (spec §7; WP16b `gmt setup --import-db <path>` reads it to know the
// checkout's app or tool is not running): opens the file read-only through @gmt/db's readOnlyLockState and prints one
// JSON line, { "state": "absent" } or { "state": "fresh" | "stale", "holder": …, "heartbeatAt": … }.
//   node scripts/lock-state.mjs <database>
// Exit codes from the plan's single table (apps/api EXIT): 0 ok, 64 usage; 1 when the built packages cannot be loaded.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: node scripts/lock-state.mjs <database>';

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  let EXIT;
  let readOnlyLockState;
  let systemClock;
  try {
    // why: no rule of its own, like check-backup.mjs: the lock's freshness rule is @gmt/db's
    const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
    ({ EXIT } = await import(new URL('../apps/api/dist/tools/types.js', import.meta.url).href));
    ({ readOnlyLockState } = await import(pathToFileURL(requireFromApi.resolve('@gmt/db')).href));
    ({ systemClock } = await import(pathToFileURL(requireFromApi.resolve('@gmt/core')).href));
  } catch (err) {
    process.stderr.write(`lock-state: cannot load the built packages (run pnpm build): ${message(err)}\n`);
    return 1;
  }
  const args = process.argv.slice(2);
  const file = args[0];
  if (args.length !== 1 || file === undefined || file === '' || file.startsWith('--')) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.usage;
  }
  try {
    process.stdout.write(`${JSON.stringify(readOnlyLockState(file, systemClock))}\n`);
    return EXIT.ok;
  } catch (err) {
    process.stderr.write(`lock-state failed: ${message(err)}\n`);
    return EXIT.backupFailed;
  }
}

process.exitCode = await main();
