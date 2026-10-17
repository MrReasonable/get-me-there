import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// why: decision 49 keeps tests of root scripts beside them, run by the root Vitest project `scripts`. These test only
// what the two CLIs own: arguments, the one output line, the defaults, forwarding --keep, and mapping a failure to an
// exit code. VACUUM INTO, integrity_check, the 0700/0600 modes, refuse-existing, the world-writable refusal and
// pruning are WP3's backupDatabase and are tested there (review arch-wp12-r1-007).
const REPO = fileURLToPath(new URL('../', import.meta.url));
const NAME = /^get-me-there-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/;
const Database = createRequire(join(REPO, 'packages', 'db', 'package.json'))('better-sqlite3');

/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// why: both CLIs load the built packages and apps/api's build (as they do in the image), so those are built first.
beforeAll(() => {
  execFileSync('pnpm', ['--filter', '@gmt/api...', 'build'], { cwd: REPO, stdio: 'ignore' });
}, 300_000);

function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'gmt-backup-cli-'));
  dirs.push(d);
  return d;
}

/** A small WAL database standing in for /data/get-me-there.db. @param {string} dir */
function sampleDb(dir) {
  const path = join(dir, 'get-me-there.db');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (x INTEGER NOT NULL); INSERT INTO t (x) VALUES (42);');
  db.close();
  return path;
}

/** @param {string} script @param {string[]} args @param {Record<string, string>} [env] */
function run(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}
const backup = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ env = {}) =>
  run(join(REPO, 'scripts', 'backup.mjs'), args, env);
const check = (/** @type {string[]} */ args) => run(join(REPO, 'scripts', 'check-backup.mjs'), args);

/** @param {string} dir */
function backups(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => NAME.test(f)) : [];
}

describe('scripts/backup.mjs (spec §13 Backup; the plan’s exit-code table)', () => {
  it('exits 0 and prints exactly one JSON line naming a copy that holds the data', () => {
    const dir = tempDir();
    const r = backup(['--db', sampleDb(dir), '--dir', join(dir, 'b')]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(r.stdout.trimEnd().split('\n')).toHaveLength(1);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    const copy = new Database(out.file, { readonly: true });
    expect(copy.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
    copy.close();
  });

  it('defaults to DATABASE_PATH, resolved like the config, and the backups folder beside the real file', () => {
    const dir = tempDir();
    const real = sampleDb(dir);
    const linkDir = join(tempDir(), 'link');
    mkdirSync(linkDir);
    symlinkSync(real, join(linkDir, 'get-me-there.db'));
    const r = backup([], { DATABASE_PATH: join(linkDir, 'get-me-there.db') });
    expect(r.status).toBe(0);
    expect(backups(join(realpathSync(dir), 'backups'))).toHaveLength(1);
    expect(backups(join(linkDir, 'backups'))).toHaveLength(0);
  });

  it('forwards --keep to the routine', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    for (let i = 0; i < 2; i++) expect(backup(['--db', db]).status).toBe(0);
    expect(backups(join(dir, 'backups'))).toHaveLength(2);
    expect(backup(['--db', db, '--keep', '1']).status).toBe(0);
    expect(backups(join(dir, 'backups'))).toHaveLength(1);
  });

  it('exits 74 with the routine’s cause when the backup fails', () => {
    const dir = tempDir();
    const db = join(dir, 'get-me-there.db');
    writeFileSync(db, 'this is not a database file '.repeat(200));
    const r = backup(['--db', db]);
    expect(r.status).toBe(74);
    expect(r.stderr).toMatch(/^backup failed: .*file is not a database/);
  });

  it.each([
    [[], 'DATABASE_PATH is required'],
    [['--force'], 'unknown argument --force'],
    [['--db'], '--db needs a value'],
    [['--db', 'a', '--keep', '0'], '--keep must be a positive integer'],
    [['--db', 'a', '--keep', 'two'], '--keep must be a positive integer'],
    [['--db', 'a', '--db', 'b'], '--db is given twice'],
  ])('exits 64 on bad arguments %j', (args, reason) => {
    const r = backup(args);
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(/^usage: node scripts\/backup\.mjs/);
    expect(r.stderr).toContain(reason);
    expect(r.stdout).toBe('');
  });

  it('exits 1 naming the build when the built packages are missing, never 74', () => {
    const fake = tempDir();
    mkdirSync(join(fake, 'scripts'));
    mkdirSync(join(fake, 'apps', 'api'), { recursive: true });
    writeFileSync(join(fake, 'apps', 'api', 'package.json'), '{"name":"@gmt/api","type":"module"}');
    copyFileSync(join(REPO, 'scripts', 'backup.mjs'), join(fake, 'scripts', 'backup.mjs'));
    const r = run(join(fake, 'scripts', 'backup.mjs'), ['--db', join(fake, 'x.db')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^backup: cannot load the built packages \(run pnpm build\)/);
  });
});

describe('scripts/check-backup.mjs (spec §13 Restore)', () => {
  it('exits 0 for a good backup', () => {
    const dir = tempDir();
    const made = JSON.parse(backup(['--db', sampleDb(dir)]).stdout);
    const r = check([made.file]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, file: made.file });
  });

  it('exits 74 for a file that is not a database or does not exist', () => {
    const dir = tempDir();
    const bad = join(dir, 'bad.db');
    writeFileSync(bad, 'not a database '.repeat(200));
    for (const f of [bad, join(dir, 'absent.db')]) {
      const r = check([f]);
      expect(r.status).toBe(74);
      expect(r.stderr).toMatch(/^backup check failed: /);
    }
  });

  it('exits 64 without exactly one file argument', () => {
    for (const args of [[], ['a', 'b'], ['--help']]) expect(check(args).status).toBe(64);
  });
});
