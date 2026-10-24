// Spec §13 "One app per ledger" (WP16a Task 16a.4): a database moved to a native install is never opened again by the
// app or the tool bootstrap. A `MOVED-TO-NATIVE` file beside DATABASE_PATH refuses with 78 before any migration, the
// boot sweep, auto-resume or cron, naming the date, docs/setup.md section 0 and the line that removes the marker.
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, MOVED_MARKER, movedMarkerText } from '@gmt/core';
import { applyMigrations, MIGRATIONS_DIR, openDatabase, pendingMigrations } from '@gmt/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootApp } from '../../src/bootstrap/app.js';
import { BootError } from '../../src/bootstrap/errors.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { movedDatabaseRefusal } from '../../src/bootstrap/preflight.js';
import { EXIT, runTool } from '../../src/bootstrap/tool.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH, toolEnv } from '../helpers/env.js';
import { captureLines } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

beforeEach(() => {
  expect.hasAssertions();
});

/** A database directory with the marker beside `name`, dated by its content. */
function marked(name = 'get-me-there.db', content = '2027-03-01T09:30:00.000Z\n') {
  const dir = tempDir('gmt-moved-');
  writeFileSync(join(dir, MOVED_MARKER), content);
  return { dir, db: join(dir, name), marker: join(dir, MOVED_MARKER) };
}

describe('movedDatabaseRefusal (spec §13)', () => {
  it('null without the marker, and for an in-memory database', () => {
    expect(movedDatabaseRefusal(join(tempDir('gmt-moved-'), 'a.db'), false)).toBeNull();
    expect(movedDatabaseRefusal(':memory:', true)).toBeNull();
  });

  it('names the date, the docs section and, outside a container, the rm line for the marker', () => {
    const m = marked();
    expect(movedDatabaseRefusal(m.db, false)).toBe(
      `this database moved to a native install on 2027-03-01; see docs/setup.md section 0. To open it here again, remove the marker: rm '${m.marker}'`,
    );
  });

  it('outside a container, the rm line quotes a path with spaces and quotes so it can be pasted as it is', () => {
    const dir = join(tempDir('gmt-moved-'), "the operator's data");
    mkdirSync(dir);
    writeFileSync(join(dir, MOVED_MARKER), '2027-03-01T09:30:00.000Z\n');
    expect(movedDatabaseRefusal(join(dir, 'get-me-there.db'), false)).toMatch(
      /remove the marker: rm '[^']*\/the operator'\\''s data\/MOVED-TO-NATIVE'$/,
    );
  });

  it('inside a container, the removal line is the compose one', () => {
    const m = marked();
    expect(movedDatabaseRefusal(m.db, true)).toBe(
      'this database moved to a native install on 2027-03-01; see docs/setup.md section 0. To open it here again, remove the marker: docker compose run --rm --no-deps --entrypoint rm app /data/MOVED-TO-NATIVE',
    );
  });

  it('the writer’s own format reads back, dated in Europe/London like the fallback (R26: 23:30 UTC is the next day in summer)', () => {
    const m = marked('get-me-there.db', movedMarkerText(asIsoDateTime('2027-07-31T23:30:00.000Z')));
    expect(movedDatabaseRefusal(m.db, false)).toMatch(
      /^this database moved to a native install on 2027-08-01;/,
    );
  });

  it('a marker that is there but cannot be read still refuses, its date unknown (R26)', () => {
    const dir = tempDir('gmt-moved-');
    mkdirSync(join(dir, MOVED_MARKER)); // a directory: readFileSync answers EISDIR
    expect(movedDatabaseRefusal(join(dir, 'get-me-there.db'), false)).toMatch(
      /^this database moved to a native install on an unknown date \(the marker could not be read\); see docs\/setup\.md section 0/,
    );
  });

  it('a first line that is no instant (an impossible date) falls back to the modification time', () => {
    const m = marked('get-me-there.db', '2027-13-45T09:30:00.000Z\n');
    const when = new Date('2027-02-01T12:00:00.000Z');
    utimesSync(m.marker, when, when);
    expect(movedDatabaseRefusal(m.db, false)).toMatch(
      /^this database moved to a native install on 2027-02-01;/,
    );
  });

  it('a marker without a dated first line is dated by its own modification time (Europe/London)', () => {
    const m = marked('get-me-there.db', '');
    const when = new Date('2027-07-31T23:30:00.000Z'); // 00:30 BST on 1 August
    utimesSync(m.marker, when, when);
    expect(movedDatabaseRefusal(m.db, false)).toMatch(
      /^this database moved to a native install on 2027-08-01;/,
    );
  });
});

function appEnv(databasePath: string, extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'production',
    DATABASE_PATH: databasePath,
    BIND_ADDRESS: '127.0.0.1',
    PORT: '3000',
    APP_BASIC_AUTH_USER: 'operator',
    APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
    LOG_LEVEL: 'debug',
    ...extra,
  });
}

describe('the app bootstrap honours the marker (spec §13)', { timeout: 30_000 }, () => {
  it.each([
    ['not in a container', {}, /rm '.*MOVED-TO-NATIVE'$/],
    [
      'in a container',
      { IN_CONTAINER: '1' },
      /docker compose run --rm --no-deps --entrypoint rm app \/data\/MOVED-TO-NATIVE$/,
    ],
  ] as const)(
    '%s: exits 78 before a migration, the boot sweep, auto-resume or cron',
    async (_label, extra, removal) => {
      const m = marked();
      // an existing database one migration behind: a refused boot leaves it exactly so
      const db = openDatabase(m.db);
      applyMigrations(db, MIGRATIONS_DIR);
      db.raw
        .prepare(
          'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)',
        )
        .run();
      const pending = pendingMigrations(db, MIGRATIONS_DIR);
      expect(pending).toHaveLength(1);
      db.close();
      const lines: string[] = [];
      const err = await bootApp({
        config: loadConfigFromEnv(appEnv(m.db, extra)),
        log: createLogger({ logLevel: 'debug' }, { destination: captureLines(lines) }),
        listen: false,
        assets: assetPaths(),
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BootError);
      if (!(err instanceof BootError)) throw new Error('booted');
      expect(err.exitCode).toBe(EXIT.badConfig);
      expect(err.message).toMatch(
        /^this database moved to a native install on 2027-03-01; see docs\/setup\.md section 0\./,
      );
      expect(err.message).toMatch(removal);
      const after = openDatabase(m.db);
      expect(pendingMigrations(after, MIGRATIONS_DIR)).toEqual(pending);
      expect(after.raw.prepare('SELECT COUNT(*) AS n FROM app_lock').get()).toEqual({ n: 0 });
      after.close();
      expect(lines.join('\n')).not.toMatch(/boot: sweep|boot: cron|migration/);
      expect(existsSync(join(m.dir, 'backups'))).toBe(false);
    },
  );

  it('a fresh path with the marker beside it is never created', async () => {
    const m = marked();
    await expect(
      bootApp({
        config: loadConfigFromEnv(appEnv(m.db)),
        log: createLogger({ logLevel: 'error' }),
        listen: false,
        assets: assetPaths(),
      }),
    ).rejects.toMatchObject({ exitCode: EXIT.badConfig });
    expect(existsSync(m.db)).toBe(false);
  });
});

describe('the tool bootstrap honours the marker (spec §13)', { timeout: 30_000 }, () => {
  it('exits 78 naming the move, and opens nothing', async () => {
    const m = marked('tool.db');
    const err: string[] = [];
    const code = await runTool('smoke', ['--origin', 'LHR', '--destination', 'JFK', '--budget', '4'], {
      env: toolEnv(m.db),
      out: () => undefined,
      err: (l) => err.push(l),
    });
    expect(code).toBe(EXIT.badConfig);
    expect(err.join('\n')).toContain(
      'this database moved to a native install on 2027-03-01; see docs/setup.md section 0.',
    );
    expect(existsSync(m.db)).toBe(false);
  });
});
