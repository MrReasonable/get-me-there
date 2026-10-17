// Spec §5.5 injected-config boot matrix; spec §4 password length and auth invariants; spec §7 the airport sanity check.
import { chmodSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { apiContract, FIXTURE_OPT_IN_PHRASE, Secret, systemClock } from '@gmt/core';
import { fixtureProvider } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootApp, type RunningApp } from '../../src/bootstrap/app.js';
import { type AssetPaths, assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { API_TEXT } from '../../src/text.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { errorOf } from '../helpers/contract.js';
import { cleanEnv, SENTINEL_AUTH, SENTINEL_SA, silentLog } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { basic, captureLines } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

function envFor(overrides: Record<string, string>): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'production',
    DATABASE_PATH: join(tempDir('gmt-matrix-'), 'm.fixture.db'),
    BIND_ADDRESS: '127.0.0.1',
    PORT: '3000',
    APP_BASIC_AUTH_USER: 'operator',
    APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
    ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE,
    LOG_LEVEL: 'error',
    ...overrides,
  });
}

function bootWith(env: Record<string, string>, assets: AssetPaths = assetPaths()): Promise<RunningApp> {
  return bootApp({
    config: loadConfigFromEnv(env),
    log: createLogger({ logLevel: 'error' }),
    listen: false,
    assets,
  });
}

/** Each boot seeds the full airports table; this file's tests may take longer than the default 5 s. */
const BOOT_TIMEOUT_MS = 30_000;

describe('injected-config boot matrix (spec §5.5)', { timeout: BOOT_TIMEOUT_MS }, () => {
  it.each([
    // label, env overrides, fixture offered?
    ['production with the phrase and .fixture.db: no fixture', {}, false],
    ['production without the phrase: no fixture', { ALLOW_FIXTURE_PROVIDER: '' }, false],
    [
      'development, phrase, .fixture.db, not in a container: fixture offered',
      { NODE_ENV: 'development' },
      true,
    ],
    ['development in a container: no fixture', { NODE_ENV: 'development', IN_CONTAINER: '1' }, false],
    [
      'development with the wrong phrase: no fixture',
      { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: 'yes' },
      false,
    ],
    [
      'development without the phrase: no fixture',
      { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: '' },
      false,
    ],
  ] as const)('%s', async (_label, overrides, expected) => {
    const running = await bootWith(envFor(overrides));
    try {
      expect(running.ports.providers.some((p) => p.id === 'fixture')).toBe(expected);
      const res = await running.app.request('http://localhost:3000/api/providers', {
        headers: { host: 'localhost:3000', authorization: basic('operator', SENTINEL_AUTH) },
      });
      expect(res.status).toBe(200);
      const body = apiContract.providersResponseSchema.parse(await res.json());
      expect(body.providers.some((p) => p.providerId === 'fixture')).toBe(expected);
      expect(body.synthetic).toBe(expected);
      if (!expected) {
        // why: spec §5.5: outside the gate the fixture provider cannot even be built
        expect(() =>
          fixtureProvider({
            http: running.ports.http,
            log: silentLog,
            clock: systemClock,
            config: running.ports.config,
            costMicroGbp: 0,
          }),
        ).toThrow();
      }
    } finally {
      await running.close();
    }
  });

  it('production refuses a definition naming the fixture provider with 422 unknown_provider', async () => {
    const running = await bootWith(envFor({}));
    try {
      const refused = await running.app.request('http://localhost:3000/api/definitions', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          authorization: basic('operator', SENTINEL_AUTH),
          'content-type': 'application/json',
          'x-requested-with': 'get-me-there',
        },
        body: JSON.stringify(exampleDefinitionInput()),
      });
      expect(refused.status).toBe(422);
      expect((await errorOf(refused)).code).toBe('unknown_provider');
    } finally {
      await running.close();
    }
  });

  it('development with the phrase but a plain .db path offers no fixture', async () => {
    const env = envFor({ NODE_ENV: 'development' });
    const running = await bootWith({
      ...env,
      DATABASE_PATH: String(env.DATABASE_PATH).replace('.fixture.db', '.db'),
    });
    try {
      expect(running.ports.providers.some((p) => p.id === 'fixture')).toBe(false);
    } finally {
      await running.close();
    }
  });

  it('refuses NODE_ENV=test before touching the database (exit 70)', async () => {
    const env = envFor({ NODE_ENV: 'test' });
    const path = String(env.DATABASE_PATH).replace('.fixture.db', '.test.db');
    await expect(bootWith({ ...env, DATABASE_PATH: path })).rejects.toMatchObject({
      exitCode: 70,
      message: expect.stringMatching(/NODE_ENV=test/),
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    'an unwritable data directory fails boot with exit code 73',
    async () => {
      const env = envFor({});
      const dir = dirname(String(env.DATABASE_PATH));
      chmodSync(dir, 0o500);
      await expect(bootWith(env)).rejects.toMatchObject({ exitCode: 73 });
    },
  );

  it('auth invariants (spec §4, review SEC-3): config refuses no auth on a public bind and a half-set pair', () => {
    expect(() =>
      loadConfigFromEnv(
        envFor({ BIND_ADDRESS: '0.0.0.0', APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' }),
      ),
    ).toThrow(/ALLOW_UNAUTHENTICATED/);
    expect(() => loadConfigFromEnv(envFor({ APP_BASIC_AUTH_PASS: '' }))).toThrow(/APP_BASIC_AUTH_PASS/);
  });

  it('bootApp re-asserts them on an injected config (78): public bind, no host, short password; the explicit flag warns', async () => {
    const env = envFor({ APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' });
    const loopback = loadConfigFromEnv(env);
    const forged = { ...loopback, bindAddress: '0.0.0.0' };
    const boot = (config: typeof loopback, lines: string[] = []) =>
      bootApp({
        config,
        log: createLogger({ logLevel: 'warn' }, { destination: captureLines(lines) }),
        listen: false,
        assets: assetPaths(),
      });
    await expect(boot(forged)).rejects.toMatchObject({ exitCode: 78 });
    await expect(boot({ ...loopback, allowedHosts: [] })).rejects.toMatchObject({ exitCode: 78 });
    // why: review SEC-R2-2: the short-password branch on an injected config, which loadConfigFromEnv never builds
    await expect(
      boot({ ...loopback, auth: { user: 'operator', pass: new Secret('elevenchars') } }),
    ).rejects.toMatchObject({ exitCode: 78, message: expect.stringMatching(/APP_BASIC_AUTH_PASS/) });
    const lines: string[] = [];
    const running = await boot({ ...forged, allowUnauthenticated: true }, lines);
    await running.close();
    expect(lines.join('')).toContain('ALLOW_UNAUTHENTICATED');
  });

  it.each([
    ['a £0-per-call plan under a zero cap: no warning', { SEARCHAPI_PLAN: 'trial' }, false],
    [
      'a billed per-call plan under a zero cap: the spec §12 warning',
      { SEARCHAPI_PLAN: '40usd', SEARCHAPI_COST_PER_CALL_MICRO_GBP: '5000', MONTHLY_SPEND_CAP_PENCE: '0' },
      true,
    ],
  ] as const)(
    'boot logs the providers configured; %s (devops-final-002, ruling 5)',
    async (_l, env, warns) => {
      const lines: string[] = [];
      const running = await bootApp({
        config: loadConfigFromEnv(envFor({ SEARCHAPI_KEY: SENTINEL_SA, ...env })),
        log: createLogger({ logLevel: 'info' }, { destination: captureLines(lines) }),
        listen: false,
        assets: assetPaths(),
      });
      await running.close();
      const records = lines.map((l) => z.looseObject({ msg: z.string() }).parse(JSON.parse(l)));
      const configured = records.find((r) => r.msg === 'providers configured');
      expect(JSON.stringify(configured)).toContain('"searchapi"');
      expect(JSON.stringify(configured)).toContain('"monthlySpendCapPence"');
      expect(records.some((r) => r.msg === API_TEXT.zeroCapBootWarning)).toBe(warns);
      expect(lines.join('')).not.toContain(SENTINEL_SA);
    },
  );

  it.each([
    ['3000p, below the £32 fee', '3000', true],
    ['3500p, the default', '3500', false],
  ] as const)(
    'a spend cap of %s on the 40usd plan: boot warns naming MONTHLY_SPEND_CAP_PENCE only when below the fees (cost-006)',
    async (_l, cap, warns) => {
      const lines: string[] = [];
      const running = await bootApp({
        config: loadConfigFromEnv(
          envFor({ SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd', MONTHLY_SPEND_CAP_PENCE: cap }),
        ),
        log: createLogger({ logLevel: 'info' }, { destination: captureLines(lines) }),
        listen: false,
        assets: assetPaths(),
      });
      await running.close();
      const warning = lines.find((l) => l.includes(API_TEXT.spendCapBelowFees(Number(cap), 3200)));
      expect(warning !== undefined).toBe(warns);
      if (warns) expect(warning).toContain('MONTHLY_SPEND_CAP_PENCE');
    },
  );

  it('a password shorter than 12 characters fails boot naming the variable', () => {
    expect(() => loadConfigFromEnv(envFor({ APP_BASIC_AUTH_PASS: 'elevenchars' }))).toThrow(
      /APP_BASIC_AUTH_PASS/,
    );
  });

  it('a failed airport sanity check fails boot (exit 1)', async () => {
    // why: the vendored files cut to ten airports, far below the 5,000 the check requires (spec §7).
    const source = assetPaths().airportsDataDir;
    const file = readdirSync(source).find((f) => /^airports\..+\.json$/.test(f)) ?? '';
    const real = z
      .looseObject({ airports: z.array(z.unknown()) })
      .parse(JSON.parse(readFileSync(join(source, file), 'utf8')));
    const dataDir = tempDir('gmt-airports-');
    writeFileSync(
      join(dataDir, 'airports.tiny.json'),
      JSON.stringify({ ...real, airports: real.airports.slice(0, 10) }),
    );
    copyFileSync(join(source, 'metros.json'), join(dataDir, 'metros.json'));
    await expect(bootWith(envFor({}), { ...assetPaths(), airportsDataDir: dataDir })).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringMatching(/airport sanity check failed/),
    });
  });
});
