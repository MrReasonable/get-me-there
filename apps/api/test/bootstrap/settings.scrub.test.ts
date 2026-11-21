// Review fix round 1 of the settings store (Global Constraints: every stored secret joins the boot's secrets list): a
// stored key the config does not use joins both bootstraps' scrub lists straight after the stored settings are read,
// so a failure while the ports are built that quotes it reaches no sink.
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { applyMigrations, MIGRATIONS_DIR, openDatabase, SettingsRepo } from '@gmt/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/bootstrap/app.js';
import { BootError } from '../../src/bootstrap/errors.js';
import { EXIT, runTool } from '../../src/bootstrap/tool.js';
import { cleanEnv, SENTINEL_AUTH, toolEnv } from '../helpers/env.js';
import { captureLines, T0 } from '../helpers/harness.js';
import { testRecording } from '../helpers/recording.js';
import { tempDir } from '../helpers/tmp.js';

const STORED = 'stored-only-mail-password-0123456789';

// why: the one seam that fails while the ports are built; the failure quotes the stored password, as a library error
// carrying a credential might
vi.mock('../../src/wiring.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/wiring.js')>();
  return {
    ...real,
    buildFromDb: () => {
      throw new Error(`could not build the ports: ${STORED}`);
    },
  };
});

beforeEach(() => {
  expect.hasAssertions();
});

/**
 * A migrated database holding a mail host and password but no other mail setting: email is all or nothing, so the boot
 * leaves email out and the password is in no config, only in the table.
 */
function storedOnlyKey(): string {
  const dbPath = join(tempDir('gmt-scrub-'), 's.db');
  const db = openDatabase(dbPath);
  applyMigrations(db, MIGRATIONS_DIR);
  new SettingsRepo(db).write(
    [
      { name: 'SMTP_HOST', value: 'smtp.example.com' },
      { name: 'SMTP_PASS', value: STORED },
    ],
    T0,
  );
  db.close();
  return dbPath;
}

describe('a stored key no config uses is scrubbed from a failure after the settings are read', {
  timeout: 30_000,
}, () => {
  it('the app: main logs and rethrows the failure without it', async () => {
    const lines: string[] = [];
    const err = await main(
      cleanEnv({
        NODE_ENV: 'production',
        DATABASE_PATH: storedOnlyKey(),
        BIND_ADDRESS: '127.0.0.1',
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
        LOG_LEVEL: 'error',
      }),
      // why: a fixed clock, never the wall; the database is fresh, so the lock is free and no wait runs
      { boot: { clock: fixedClock(T0) }, logDestination: captureLines(lines) },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BootError);
    if (!(err instanceof BootError)) return;
    expect(err.message).toContain('could not build the ports');
    expect(err.message).not.toContain(STORED);
    expect(err.exitCode).toBe(EXIT.failed);
    // why: the log is a sink too: its boot-failure line names the failure and never the stored password
    const log = lines.join('\n');
    expect(log).toContain('boot failed');
    expect(log).toContain('could not build the ports');
    expect(log).not.toContain(STORED);
  });

  it('the tool: its refusal line is without it', async () => {
    const errors: string[] = [];
    const code = await runTool('smoke', ['--origin', 'LHR', '--destination', 'JFK', '--budget', '4'], {
      env: toolEnv(storedOnlyKey()),
      out: () => undefined,
      err: (l) => errors.push(l),
      recording: testRecording().recording,
    });
    expect(code).toBe(EXIT.failed);
    expect(errors.join('\n')).toContain('could not build the ports');
    expect(errors.join('\n')).not.toContain(STORED);
  });
});
