// Spawns the real entry the way `pnpm record:fixtures` does (node --conditions=@gmt/source --import tsx), with an env
// built from scratch (no inherited secrets, no .env file) and DNS refused in the child.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIsoDateTime, fixedClock, systemClock } from '@gmt/core';
import { AppLock, applyMigrations, MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { SENTINEL_SA, SENTINEL_TP, silentLog, toolEnv } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

const API_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NO_NETWORK = fileURLToPath(new URL('../support/noNetwork.mjs', import.meta.url));
const DRY = ['--budget', '5', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03', '--dry-run'];
/** Node's arguments for every spawned child: workspace sources, and the DNS-refusal preload (one list, r3-ts-006). */
const NODE_ARGS = ['--conditions=@gmt/source', '--import', NO_NETWORK] as const;

function spawnTool(env: Record<string, string>) {
  return spawnSync(
    process.execPath,
    [...NODE_ARGS, '--import', 'tsx', 'src/bootstrap/tool.ts', 'record', ...DRY],
    {
      cwd: API_ROOT,
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
}

const freshDbPath = (): string => join(tempDir('gmt-spawn-'), 'tool.db');

function holdAppLock(dbPath: string, stale: boolean): void {
  const db = openDatabase(dbPath);
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = stale
    ? fixedClock(asIsoDateTime(new Date(Date.now() - 10 * 60_000).toISOString()))
    : systemClock;
  expect(new AppLock(db, 'app', clock, silentLog).acquire({ waitMs: 0 })).toBe('acquired');
  db.close();
}

describe('tool bootstrap as a real process (spec §5.5, §7)', () => {
  it('NODE_ENV=test → exit 70, nothing opened', () => {
    const dbPath = freshDbPath();
    const r = spawnTool(toolEnv(dbPath, { NODE_ENV: 'test' }));
    expect(r.stderr).toContain('tool bootstrap refuses NODE_ENV=test');
    expect(r.status).toBe(70);
    expect(existsSync(dbPath)).toBe(false);
  }, 60_000);

  it('a fresh app lock → exit 75, lock untouched', () => {
    const dbPath = freshDbPath();
    holdAppLock(dbPath, false);
    const r = spawnTool(toolEnv(dbPath));
    expect(r.stderr).toContain('app_lock is held by app');
    expect(r.status).toBe(75);
    const db = openDatabase(dbPath);
    expect(AppLock.inspect(db)?.holder).toBe('app');
    db.close();
  }, 60_000);

  // why: a dry run makes no HTTP request, so this proves only the bootstrap's own output; http-kit's debug lines are
  // covered through the real pino logger in test/logger.test.ts (sec2-004)
  it('otherwise, at debug log level, acquires the tool lock, prints the plan and releases the lock; the bootstrap prints no credential', () => {
    const dbPath = freshDbPath();
    const r = spawnTool(toolEnv(dbPath, { LOG_LEVEL: 'debug' }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('tool lock acquired');
    expect(r.stdout).toContain('SA-06');
    expect(r.stdout).toContain('tool lock released');
    for (const s of [SENTINEL_SA, SENTINEL_TP, 'Bearer ']) expect(`${r.stdout}${r.stderr}`).not.toContain(s);
    const db = openDatabase(dbPath);
    expect(AppLock.inspect(db)).toBeNull();
    db.close();
  }, 60_000);

  it('a stale app lock is taken over', () => {
    const dbPath = freshDbPath();
    holdAppLock(dbPath, true);
    expect(spawnTool(toolEnv(dbPath)).status).toBe(0);
  }, 60_000);

  it('the package script resolves workspace sources, loads the operator .env only through Node and runs this entry', () => {
    const pkg: unknown = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({
      scripts: {
        tool: 'node --conditions=@gmt/source --env-file-if-exists=../../.env --import tsx src/bootstrap/tool.ts',
      },
    });
  });

  it('every spawned child gets the DNS-refusal preload, and under it fetch, as http-kit uses it, cannot reach a host (r2-ts-006, r3-ts-006)', () => {
    expect(NODE_ARGS).toContain(NO_NETWORK);
    const r = spawnSync(
      process.execPath,
      [
        ...NODE_ARGS,
        '--input-type=module',
        '-e',
        "fetch('https://example.invalid/').then(() => process.stdout.write('fetched'), (e) => process.stdout.write(String(e.cause?.message ?? e.message)))",
      ],
      { cwd: API_ROOT, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000 },
    );
    expect(r.stdout).toContain('spawned tool test makes no DNS lookups (example.invalid)');
  }, 30_000);
});
