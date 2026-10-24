// app_meta (spec §7, decision 82; WP16a review R21, S5): the app-instance id is a random id stored with the ledger and
// the path it was made at, so one database file at one path is one app to the camoufox worker, however its host or
// container changes, and a copy opened elsewhere is a second one.

import { copyFileSync, existsSync, realpathSync, symlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaRepo } from '../src/repositories/meta.js';
import { freshDb, sqliteCode, tmpDir } from './helpers/db.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('MetaRepo.appInstanceId (decision 82)', () => {
  it('is generated on first use, a UUID, and the same on every later call and after reopening the database', () => {
    const path = join(tmpDir(), 'gmt.db');
    const db = freshDb(path);
    const first = new MetaRepo(db).appInstanceId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new MetaRepo(db).appInstanceId()).toBe(first);
    db.close();
    expect(new MetaRepo(freshDb(path)).appInstanceId()).toBe(first);
  });

  it('a copy of the database opened at another path is a second app: it gets a new id, and the original keeps its own', () => {
    const dir = tmpDir();
    const original = join(dir, 'gmt.db');
    const db = freshDb(original);
    const first = new MetaRepo(db).appInstanceId();
    db.close();
    const copy = join(dir, 'copied.db');
    copyFileSync(original, copy);
    const copied = freshDb(copy);
    const second = new MetaRepo(copied).appInstanceId();
    expect(second).not.toBe(first);
    expect(new MetaRepo(copied).appInstanceId()).toBe(second);
    expect(
      copied.raw
        .prepare<[], { value: string }>("SELECT value FROM app_meta WHERE key = 'app_instance_path'")
        .get()?.value,
    ).toBe(realpathSync.native(copy));
    copied.close();
    expect(new MetaRepo(freshDb(original)).appInstanceId()).toBe(first);
  });

  it('T10: the same file opened through a symlinked directory is the same app; the path stored is the real one', () => {
    const dir = tmpDir();
    const real = join(dir, 'gmt.db');
    const db = freshDb(real);
    const first = new MetaRepo(db).appInstanceId();
    db.close();
    const link = join(tmpDir(), 'linked');
    symlinkSync(dir, link);
    const viaLink = freshDb(join(link, 'gmt.db'));
    expect(new MetaRepo(viaLink).appInstanceId()).toBe(first);
    expect(
      viaLink.raw
        .prepare<[], { value: string }>("SELECT value FROM app_meta WHERE key = 'app_instance_path'")
        .get()?.value,
    ).toBe(realpathSync.native(real));
  });

  it('T10: on a case-insensitive volume the same file opened with other letter case is the same app', (ctx) => {
    const dir = tmpDir();
    const real = join(dir, 'gmt.db');
    const db = freshDb(real);
    const first = new MetaRepo(db).appInstanceId();
    db.close();
    const shouted = join(dirname(real), basename(real).toUpperCase());
    // why: only where the volume folds case (macOS's default) is GMT.DB the same file as gmt.db
    if (!existsSync(shouted)) ctx.skip();
    expect(new MetaRepo(freshDb(shouted)).appInstanceId()).toBe(first);
  });

  it('T10: reads and writes the id in one immediate transaction', () => {
    const db = freshDb();
    const immediate = vi.spyOn(db, 'immediateTransaction');
    new MetaRepo(db).appInstanceId();
    expect(immediate).toHaveBeenCalledTimes(1);
  });

  it('two databases are two apps', () => {
    expect(new MetaRepo(freshDb()).appInstanceId()).not.toBe(new MetaRepo(freshDb()).appInstanceId());
  });

  it('the table takes only its known keys and a non-empty value', () => {
    const db = freshDb();
    const insert = (key: string, value: string) =>
      sqliteCode(() => db.raw.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(key, value));
    expect(insert('something_else', 'x')).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert('app_instance_id', '')).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert('app_instance_path', 'x'.repeat(4097))).toBe('SQLITE_CONSTRAINT_CHECK');
  });
});
