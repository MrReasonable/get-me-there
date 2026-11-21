#!/usr/bin/env node
// Reports how many settings a database holds (settings plan ruling 15; review I2, controller ruling R20): `gmt setup`
// reads it to know whether the app holds its settings, so that it writes no app.env line the app would ignore, with the
// app running or stopped. Opens the file read-only through @gmt/db's storedSettingCount and prints one JSON line,
// { "rows": <n> }; no name or value leaves the file.
//   node scripts/settings-held.mjs <database>
// Exit codes from the plan's single table (apps/api EXIT): 0 ok (a count printed), 64 usage, 1 failed: the built
// packages cannot be loaded or the file cannot be read (nothing is printed then).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: node scripts/settings-held.mjs <database>';

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  let EXIT;
  let storedSettingCount;
  try {
    // why: no rule of its own, like lock-state.mjs: the read is @gmt/db's
    const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
    ({ EXIT } = await import(new URL('../apps/api/dist/tools/types.js', import.meta.url).href));
    ({ storedSettingCount } = await import(pathToFileURL(requireFromApi.resolve('@gmt/db')).href));
  } catch (err) {
    process.stderr.write(`settings-held: cannot load the built packages (run pnpm build): ${message(err)}\n`);
    return 1;
  }
  const args = process.argv.slice(2);
  const file = args[0];
  if (args.length !== 1 || file === undefined || file === '' || file.startsWith('--')) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.usage;
  }
  try {
    process.stdout.write(`${JSON.stringify({ rows: storedSettingCount(file) })}\n`);
    return EXIT.ok;
  } catch (err) {
    process.stderr.write(`settings-held failed: ${message(err)}\n`);
    return EXIT.failed;
  }
}

process.exitCode = await main();
