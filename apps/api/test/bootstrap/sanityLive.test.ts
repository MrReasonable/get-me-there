// Spec revision 55 §7: the boot's airport check covers every live (not soft-deleted) definition, scheduled or not, so
// an unscheduled search naming a code outside the airports table fails boot as a scheduled one does.
import { join } from 'node:path';
import { asIata, asIsoDateTime, FIXTURE_OPT_IN_PHRASE, fixedClock } from '@gmt/core';
import { applyMigrations, DefinitionsRepo, MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { bootApp } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { tempDir } from '../helpers/tmp.js';

const T0 = asIsoDateTime('2026-10-14T12:00:00.000Z');

/** A database holding one definition whose origin (QQA, synthetic) is in no airports table, its `enabled` 0. */
function withUnknownAirport(deleted: boolean): string {
  const path = join(tempDir('gmt-sanity-'), 's.fixture.db');
  const db = openDatabase(path);
  applyMigrations(db, MIGRATIONS_DIR);
  const repo = new DefinitionsRepo(db, fixedClock(T0));
  const d = repo.create(
    exampleDefinitionInput({ origins: [asIata('QQA')], enabled: false, scheduleCron: null }),
  );
  if (deleted) repo.softDelete(d.id);
  db.close();
  return path;
}

const boot = (path: string) =>
  bootApp({
    config: loadConfigFromEnv(
      cleanEnv({
        NODE_ENV: 'production',
        DATABASE_PATH: path,
        BIND_ADDRESS: '127.0.0.1',
        PORT: '3000',
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
        ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE,
        LOG_LEVEL: 'error',
      }),
    ),
    log: createLogger({ logLevel: 'error' }),
    listen: false,
    assets: assetPaths(),
    // why: a fixed clock and an instant sleep, so the boot (the lock wait, the backup's stamp, the engine's timers)
    // never reads wall-clock time or waits on it
    clock: fixedClock(T0),
    sleep: async () => undefined,
  });

describe('the boot airport check over every live search (revision 55 §7)', { timeout: 30_000 }, () => {
  it('an unscheduled search (enabled 0, no cron) naming a code outside the table fails boot, naming it', async () => {
    await expect(boot(withUnknownAirport(false))).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringMatching(/airport sanity check failed: .*live definitions.*QQA/),
    });
  });

  it('a soft-deleted search is not checked', async () => {
    const app = await boot(withUnknownAirport(true));
    await app.close();
  });
});
