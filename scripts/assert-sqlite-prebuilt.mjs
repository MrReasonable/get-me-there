#!/usr/bin/env node
// Fails unless better-sqlite3 runs from the prebuilt binary shipped inside its npm tarball.
// Spec §4 and §13: the prebuilt is fail-closed, with no source-build fallback.
//
// why: better-sqlite3 13.x has no install script; prebuilds/<platform>-<arch>.node arrives in
// the tarball whose sha512 pnpm-lock.yaml pins. Its loader (lib/binding.js) falls back to
// build/Release/better_sqlite3.node when no prebuilt matches, so this script requires the
// prebuilt to exist, requires build/ to be absent, and loads the module once.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const EXPECTED_VERSION = '13.0.3';

// why: resolve from packages/db, the only workspace package that depends on better-sqlite3,
// so the script works in the repository and in the image (which keeps the workspace layout).
const requireFromDb = createRequire(new URL('../packages/db/package.json', import.meta.url));
const pkgPath = requireFromDb.resolve('better-sqlite3/package.json');
const root = dirname(pkgPath);
const { version } = requireFromDb('better-sqlite3/package.json');
const prebuilt = join(root, 'prebuilds', `${process.platform}-${process.arch}.node`);

const failures = [];
if (version !== EXPECTED_VERSION)
  failures.push(`better-sqlite3 ${version} resolved, expected ${EXPECTED_VERSION}`);
if (!existsSync(prebuilt)) failures.push(`no prebuilt binary at ${prebuilt}`);
if (existsSync(join(root, 'build')))
  failures.push(`a source build exists at ${join(root, 'build')}; refusing it`);

if (failures.length === 0) {
  try {
    const Database = requireFromDb('better-sqlite3');
    const db = new Database(':memory:');
    db.prepare('select sqlite_version() as v').get();
    db.close();
  } catch (err) {
    failures.push(`better-sqlite3 failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(`better-sqlite3 ${version} prebuilt ok: ${prebuilt}`);
