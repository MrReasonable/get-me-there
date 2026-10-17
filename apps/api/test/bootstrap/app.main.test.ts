// The entry's boot-error path: what `main` rethrows is what start.ts writes to stderr (the container log).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/bootstrap/app.js';
import { BootError } from '../../src/bootstrap/errors.js';
import { EXIT } from '../../src/tools/types.js';
import { cleanEnv, SENTINEL_AUTH, SENTINEL_SA } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

function envFor(databasePath: string): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'production',
    DATABASE_PATH: databasePath,
    BIND_ADDRESS: '127.0.0.1',
    ALLOWED_HOSTS: '127.0.0.1:3000',
    PORT: '3000',
    APP_BASIC_AUTH_USER: 'operator',
    APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
    SEARCHAPI_KEY: SENTINEL_SA,
    LOG_LEVEL: 'error',
  });
}

async function failure(env: Record<string, string>): Promise<unknown> {
  return main(env).then(
    () => null,
    (e: unknown) => e,
  );
}

describe('main boot failure', () => {
  it('rethrows a BootError with no configured secret in its message, keeping its exit code', async () => {
    // why: the database path is a directory named after the key, so the lock-read refusal names the key in its message.
    const dir = join(tempDir('gmt-main-'), SENTINEL_SA);
    mkdirSync(dir);
    const err = await failure(envFor(dir));
    expect(err).toBeInstanceOf(BootError);
    if (!(err instanceof BootError)) return;
    expect(err.message).not.toContain(SENTINEL_SA);
    expect(err.exitCode).toBe(EXIT.preflightImpossible);
  });
});
