#!/usr/bin/env node
// On-demand SQLite backup for get-me-there. Spec §13 "Backup".
//   docker compose exec -T app node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n>]
// A thin wrapper over the built packages, holding no rule of its own: the routine is @gmt/db `backupDatabase` (WP3),
// and the exit codes (`EXIT`), the backups directory (`backupsDirFor`) and the keep count (`BACKUPS_KEPT`) are the ones
// both bootstraps use, imported from apps/api's build (plan decision 32). Run it as the app's user (the image's
// `node`), never as root (plan decision 26).
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n ≥ 1>]';

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The built modules, through apps/api's dependency links (present after `pnpm build` and in the image). why: scripts/
 * is not a workspace package, so a bare import would not resolve.
 */
async function load() {
  const api = new URL('../apps/api/', import.meta.url);
  const requireFromApi = createRequire(new URL('package.json', api));
  const imp = (/** @type {string} */ p) => import(pathToFileURL(p).href);
  const [db, core, types, preflight] = await Promise.all([
    imp(requireFromApi.resolve('@gmt/db')),
    imp(requireFromApi.resolve('@gmt/core')),
    import(new URL('dist/tools/types.js', api).href),
    import(new URL('dist/bootstrap/preflight.js', api).href),
  ]);
  return {
    backupDatabase: db.backupDatabase,
    systemClock: core.systemClock,
    EXIT: types.EXIT,
    backupsDirFor: preflight.backupsDirFor,
    BACKUPS_KEPT: preflight.BACKUPS_KEPT,
  };
}

/**
 * @param {string[]} argv
 * @param {string | undefined} envDb
 * @param {{ backupsDirFor: (db: string) => string; BACKUPS_KEPT: number }} rules
 * @returns {{ ok: true; db: string; dir: string; keep: number } | { ok: false; reason: string }}
 */
export function parseArgs(argv, envDb, rules) {
  /** @type {Map<string, string>} */
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] ?? '';
    const value = argv[i + 1];
    if (!['--db', '--dir', '--keep'].includes(name)) return { ok: false, reason: `unknown argument ${name}` };
    if (flags.has(name)) return { ok: false, reason: `${name} is given twice` };
    if (value === undefined || value === '' || value.startsWith('--'))
      return { ok: false, reason: `${name} needs a value` };
    flags.set(name, value);
  }
  const keepRaw = flags.get('--keep') ?? String(rules.BACKUPS_KEPT);
  const keep = Number(keepRaw);
  if (!/^\d+$/.test(keepRaw) || !Number.isSafeInteger(keep) || keep < 1)
    return { ok: false, reason: `--keep must be a positive integer, got ${keepRaw}` };
  const given = flags.get('--db') ?? (envDb === undefined || envDb === '' ? undefined : envDb);
  // why: like the config, the CLI has no default database; compose sets DATABASE_PATH for the container.
  if (given === undefined) return { ok: false, reason: '--db or DATABASE_PATH is required' };
  // why: the bootstraps resolve DATABASE_PATH with realpath before deriving the backups directory, so a symlinked
  // path backs up beside the real file here too; a missing file is reported by backupDatabase itself.
  const db = existsSync(given) ? realpathSync(given) : given;
  return { ok: true, db, dir: flags.get('--dir') ?? rules.backupsDirFor(db), keep };
}

async function main() {
  let mods;
  try {
    mods = await load();
  } catch (err) {
    // why: a setup fault, not a failed backup; 1 is the table's "a tool run failed" (EXIT itself did not load).
    process.stderr.write(`backup: cannot load the built packages (run pnpm build): ${message(err)}\n`);
    return 1;
  }
  // why: an operator script is a command-line entry point, like the bootstraps, so it may read the environment (plan
  // decision 9; scripts/check-boundaries.mjs allows exactly apps/api/src/bootstrap/ and scripts/*.mjs). The one read.
  const args = parseArgs(process.argv.slice(2), process.env.DATABASE_PATH, mods);
  if (!args.ok) {
    process.stderr.write(`${USAGE}\n${args.reason}\n`);
    return mods.EXIT.usage;
  }
  try {
    const r = mods.backupDatabase(args.db, args.dir, { keep: args.keep, clock: mods.systemClock });
    process.stdout.write(`${JSON.stringify({ ok: true, file: r.file })}\n`);
    return mods.EXIT.ok;
  } catch (err) {
    process.stderr.write(`backup failed: ${message(err)}\n`);
    return mods.EXIT.backupFailed;
  }
}

// why: WP16b: the gmt CLI's tests import parseArgs to prove the daily job's argv parses here, so the backup runs only
// when this file is the program (the image and the services run it as `node scripts/backup.mjs`); `import.meta.main`
// is in every Node the engines field allows (22.18 and later), the one guard shape for scripts (ca-b1-021)
if (import.meta.main) process.exitCode = await main();
