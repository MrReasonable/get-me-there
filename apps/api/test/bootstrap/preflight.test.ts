// The pre-migration preflight both bootstraps share (spec §7 Migrations; plan "Wiring and bootstraps": both call
// backupDatabase before buildPorts when migrations are pending). WP8's app bootstrap reuses this module (arch M-1).
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import {
  BACKUPS_KEPT,
  backupBeforeMigrations,
  backupsDirFor,
  dataDirRefusal,
  pendingOnExistingDb,
} from '../../src/bootstrap/preflight.js';
import { EXIT } from '../../src/tools/types.js';
import { tempDir } from '../helpers/tmp.js';

const clock = fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z'));
const bareDb = (): string => {
  const path = join(tempDir('gmt-pre-'), 'app.db');
  openDatabase(path).close(); // an existing database with every migration pending
  return path;
};

describe('bootstrap preflight (spec §7 Migrations)', () => {
  it('backups live beside the database and five are kept', () => {
    expect(backupsDirFor('/data/app.db')).toBe('/data/backups');
    expect(BACKUPS_KEPT).toBe(5);
  });

  it('a new file or :memory: has nothing pending; an existing bare database has every migration pending', () => {
    expect(pendingOnExistingDb(':memory:', MIGRATIONS_DIR)).toEqual([]);
    expect(pendingOnExistingDb(join(tempDir(), 'none.db'), MIGRATIONS_DIR)).toEqual([]);
    expect(pendingOnExistingDb(bareDb(), MIGRATIONS_DIR).length).toBeGreaterThan(0);
  });

  it('nothing pending: no backup, no line', () => {
    expect(backupBeforeMigrations(join(tempDir(), 'none.db'), MIGRATIONS_DIR, clock, [])).toEqual({
      ok: true,
      line: null,
    });
  });

  it('pending: backs up first and names the file', () => {
    const path = bareDb();
    const r = backupBeforeMigrations(path, MIGRATIONS_DIR, clock, []);
    expect(r).toMatchObject({ ok: true, line: expect.stringMatching(/^backup before \d+ migration\(s\): /) });
    expect(readdirSync(backupsDirFor(path))).toHaveLength(1);
  });

  it('refuses with 73 when the backups path is not a writable directory, and with 74 when the backup fails', () => {
    const notDir = bareDb();
    writeFileSync(backupsDirFor(notDir), 'not a directory');
    expect(backupBeforeMigrations(notDir, MIGRATIONS_DIR, clock, [])).toMatchObject({
      ok: false,
      code: EXIT.preflightImpossible,
      message: expect.stringContaining('is not a writable directory'),
    });
    const worldWritable = bareDb();
    mkdirSync(backupsDirFor(worldWritable));
    chmodSync(backupsDirFor(worldWritable), 0o777); // WP3 refuses a world-writable backups directory
    expect(backupBeforeMigrations(worldWritable, MIGRATIONS_DIR, clock, [])).toMatchObject({
      ok: false,
      code: EXIT.backupFailed,
      message: expect.stringContaining('backup failed, refusing to migrate'),
    });
  });

  it('refuses with 73 when the migration state cannot be read', () => {
    const path = join(tempDir('gmt-pre-'), 'app.db');
    const db = openDatabase(path);
    db.raw.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY)');
    db.close();
    expect(backupBeforeMigrations(path, MIGRATIONS_DIR, clock, [])).toMatchObject({
      ok: false,
      code: EXIT.preflightImpossible,
      message: expect.stringContaining('cannot read the migration state'),
    });
  });

  it.skipIf(process.getuid?.() === 0)('names an unwritable data directory; :memory: has none', () => {
    expect(dataDirRefusal(':memory:')).toBeNull();
    const dir = tempDir();
    expect(dataDirRefusal(join(dir, 'app.db'))).toBeNull();
    chmodSync(dir, 0o500);
    expect(dataDirRefusal(join(dir, 'app.db'))).toContain('is not writable');
    expect(existsSync(join(dir, 'app.db'))).toBe(false);
  });
});
