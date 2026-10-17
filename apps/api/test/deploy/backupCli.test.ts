// Drift guard (review arch-wp12-r1-001): scripts/backup.mjs and scripts/check-backup.mjs hold no rule of their own;
// they load EXIT, BACKUPS_KEPT and backupsDirFor from apps/api's build. This type-checked test ties their behaviour
// to the source values, so a stale build or a local copy of a rule fails here.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '@gmt/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { BACKUPS_KEPT, backupsDirFor } from '../../src/bootstrap/preflight.js';
import { EXIT } from '../../src/tools/types.js';
import { tempDir } from '../helpers/tmp.js';
import { REPO } from './files.js';

beforeAll(() => {
  execFileSync('pnpm', ['--filter', '@gmt/api...', 'build'], { cwd: REPO, stdio: 'ignore' });
}, 300_000);

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(REPO, 'scripts', script), ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}

describe('the backup CLIs follow apps/api’s rules (plan decision 32, the single exit-code table)', () => {
  it('backs up into backupsDirFor(DATABASE_PATH) and keeps BACKUPS_KEPT by default', () => {
    const dir = tempDir();
    const db = join(dir, 'get-me-there.db');
    // why: apps/api never imports better-sqlite3 (decision 23); @gmt/db opens the file
    const d = openDatabase(db);
    d.raw.exec('CREATE TABLE t (x INTEGER)');
    d.close();
    for (let i = 0; i <= BACKUPS_KEPT; i++)
      expect(run('backup.mjs', [], { DATABASE_PATH: db }).status).toBe(EXIT.ok);
    expect(readdirSync(backupsDirFor(db))).toHaveLength(BACKUPS_KEPT);
  });

  it('maps usage and failures to EXIT.usage and EXIT.backupFailed', () => {
    const dir = tempDir();
    expect(run('backup.mjs', ['--db', join(dir, 'x.db'), '--keep', '0']).status).toBe(EXIT.usage);
    expect(run('backup.mjs', ['--db', join(dir, 'absent.db')]).status).toBe(EXIT.backupFailed);
    expect(run('check-backup.mjs', []).status).toBe(EXIT.usage);
    writeFileSync(join(dir, 'bad.db'), 'not a database '.repeat(200));
    expect(run('check-backup.mjs', [join(dir, 'bad.db')]).status).toBe(EXIT.backupFailed);
  });
});
