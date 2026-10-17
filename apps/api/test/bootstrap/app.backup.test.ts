// Spec §7 Migrations, §13 Backup: the app bootstrap reuses WP4b's preflight (plan decision 32).
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { AppLock, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootApp } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { backupsDirFor, pendingOnExistingDb } from '../../src/bootstrap/preflight.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH, silentLog } from '../helpers/env.js';
import { T0 } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

function config(dbPath: string) {
  return loadConfigFromEnv(
    cleanEnv({
      NODE_ENV: 'production',
      DATABASE_PATH: dbPath,
      BIND_ADDRESS: '127.0.0.1',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
      LOG_LEVEL: 'error',
    }),
  );
}

const journalSchema = z.looseObject({ entries: z.array(z.looseObject({ when: z.number() })) });

/** A copy of the bundled migrations plus one journal entry newer than anything applied. */
function migrationsWithProbe(): string {
  const dir = join(tempDir('gmt-mig-'), 'drizzle');
  cpSync(assetPaths().migrationsDir, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = journalSchema.parse(JSON.parse(readFileSync(journalPath, 'utf8')));
  const last = journal.entries[journal.entries.length - 1] ?? { when: 0 };
  // why: drizzle orders by `when`; the probe must be newer than every committed migration, whatever their dates.
  const when = Math.max(...journal.entries.map((e) => e.when)) + 1_000;
  journal.entries.push({ ...last, idx: journal.entries.length, when, tag: '9999_wp8_probe' });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(dir, '9999_wp8_probe.sql'), 'CREATE TABLE wp8_probe (id integer);');
  return dir;
}

function hasProbe(dbPath: string): boolean {
  const db = openDatabase(dbPath);
  try {
    return (
      db.raw.prepare("select name from sqlite_master where type = 'table' and name = 'wp8_probe'").get() !==
      undefined
    );
  } finally {
    db.close();
  }
}

async function bootOnce(dbPath: string, migrationsDir = assetPaths().migrationsDir): Promise<void> {
  const running = await bootApp({
    config: config(dbPath),
    log: createLogger({ logLevel: 'error' }),
    listen: false,
    assets: { ...assetPaths(), migrationsDir },
  });
  await running.close();
}

/** Each boot seeds the full airports table; this file's tests may take longer than the default 5 s. */
const BOOT_TIMEOUT_MS = 30_000;

describe('backup preflight (spec §7 Migrations, §13 Backup)', { timeout: BOOT_TIMEOUT_MS }, () => {
  it('a database file that does not exist yet is migrated without a backup; an up-to-date one is not backed up', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    await bootOnce(dbPath);
    expect(pendingOnExistingDb(dbPath, assetPaths().migrationsDir)).toEqual([]);
    expect(readdirSync(join(dbPath, '..'))).not.toContain('backups');
  });

  it('backs up into <db dir>/backups before applying pending migrations; the backup has the old schema', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    const probeDir = migrationsWithProbe();
    expect(pendingOnExistingDb(dbPath, probeDir)).toEqual(['9999_wp8_probe']);
    await bootOnce(dbPath, probeDir);
    expect(hasProbe(dbPath)).toBe(true);
    const backups = readdirSync(backupsDirFor(dbPath));
    expect(backups).toHaveLength(1);
    expect(hasProbe(join(backupsDirFor(dbPath), backups[0] ?? ''))).toBe(false);
  });

  it('a failed backup refuses boot with exit code 74 and leaves the schema unmigrated', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    mkdirSync(backupsDirFor(dbPath));
    chmodSync(backupsDirFor(dbPath), 0o777); // why: WP3's backupDatabase refuses a world-writable backups directory
    await expect(bootOnce(dbPath, migrationsWithProbe())).rejects.toMatchObject({
      exitCode: 74,
      message: expect.stringMatching(/backup failed, refusing to migrate/),
    });
    expect(hasProbe(dbPath)).toBe(false);
  });

  it('a backups path that is not a directory refuses boot with exit code 73', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    writeFileSync(backupsDirFor(dbPath), 'not a directory');
    await expect(bootOnce(dbPath, migrationsWithProbe())).rejects.toMatchObject({ exitCode: 73 });
    expect(hasProbe(dbPath)).toBe(false);
  });

  it('a second app against a live app lock refuses with 75 and runs no backup or migration (plan decision 53)', async () => {
    const dbPath = join(tempDir('gmt-bk-'), 'b.db');
    await bootOnce(dbPath);
    const clock = fixedClock(T0);
    const live = openDatabase(dbPath);
    const first = new AppLock(live, 'app', clock, silentLog);
    expect(first.acquire({ waitMs: 0 })).toBe('acquired');
    try {
      const probeDir = migrationsWithProbe();
      expect(pendingOnExistingDb(dbPath, probeDir)).toEqual(['9999_wp8_probe']);
      await expect(
        bootApp({
          config: config(dbPath),
          log: createLogger({ logLevel: 'error' }),
          clock,
          listen: false,
          assets: { ...assetPaths(), migrationsDir: probeDir },
          // why: the first app keeps heartbeating while the second waits on the shared clock
          sleep: async (ms) => {
            clock.advance(ms);
            first.heartbeat();
          },
        }),
      ).rejects.toMatchObject({ exitCode: 75 });
      expect(existsSync(backupsDirFor(dbPath))).toBe(false);
      expect(hasProbe(dbPath)).toBe(false);
    } finally {
      first.release();
      live.close();
    }
  });
});
