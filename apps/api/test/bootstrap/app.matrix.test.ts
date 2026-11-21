// Spec §5.5 injected-config boot matrix; spec §4 password length and auth invariants; spec §7 the airport sanity check.
import { chmodSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AUTH_MISSING,
  AUTH_MISSING_NATIVE,
  apiContract,
  type Config,
  FIXTURE_OPT_IN_PHRASE,
  fixedClock,
  Secret,
  systemClock,
} from '@gmt/core';
import { fixtureProvider } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootApp, type RunningApp } from '../../src/bootstrap/app.js';
import { type AssetPaths, assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { API_TEXT } from '../../src/text.js';
import { loadBootConfig, loadConfigFromEnv } from '../../src/wiring.js';
import { errorOf } from '../helpers/contract.js';
import { cleanEnv, SENTINEL_AUTH, SENTINEL_SA, silentLog } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { basic, bootEnv, captureLines, T0 } from '../helpers/harness.js';
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
    ...bootEnv(env),
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
      const booted = bootWith(env);
      try {
        await expect(booted).rejects.toMatchObject({ exitCode: 73 });
      } finally {
        // why: a host that ignores the mode (Windows) boots; the app is closed so its database file can be removed
        await (await booted.catch(() => null))?.close();
      }
    },
  );

  it('auth invariants (spec §4, review SEC-3): config refuses no auth beyond this machine and a half-set pair', () => {
    const noAuth = { APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' };
    expect(() => loadConfigFromEnv(envFor({ ...noAuth, BIND_ADDRESS: '0.0.0.0' }))).toThrow(
      /BIND_ADDRESS: the app binds 0\.0\.0\.0.*pnpm gmt setup --reconfigure password/,
    );
    expect(() => loadConfigFromEnv(envFor({ ...noAuth, ALLOWED_HOSTS: 'flights.example.com' }))).toThrow(
      /ALLOWED_HOSTS: flights\.example\.com is not this machine/,
    );
    expect(loadConfigFromEnv(envFor(noAuth)).auth).toBeNull();
    expect(() => loadConfigFromEnv(envFor({ APP_BASIC_AUTH_PASS: '' }))).toThrow(/APP_BASIC_AUTH_PASS/);
  });

  describe('bootApp re-asserts them on an injected config (78)', () => {
    // why: each test's own data directory (envFor makes one), so a refusal never shares a database with a boot
    const noAuth = (over: Partial<Config> = {}) => {
      const env = envFor({ APP_BASIC_AUTH_USER: '', APP_BASIC_AUTH_PASS: '' });
      return { config: { ...loadBootConfig(env), ...over }, env };
    };
    const container = { inContainer: true, bindAddress: '0.0.0.0', publishedAddress: '127.0.0.1' };
    // why: a fresh fixed clock on every boot, so locking, migrations and the engine's boot never read wall-clock time
    const boot = ({ config, env }: { config: Config; env: Record<string, string> }, lines: string[] = []) =>
      bootApp({
        config,
        env,
        log: createLogger({ logLevel: 'warn' }, { destination: captureLines(lines) }),
        clock: fixedClock(T0),
        listen: false,
        assets: assetPaths(),
      });

    it.each([
      [
        'a native public bind',
        { bindAddress: '0.0.0.0' },
        `BIND_ADDRESS: the app binds 0.0.0.0, which other devices can reach, and has no password: ${AUTH_MISSING_NATIVE}`,
      ],
      [
        'a native loopback bind with a tailnet name',
        { allowedHosts: ['localhost:3000', 'laptop.tail1234.ts.net'] },
        `ALLOWED_HOSTS: laptop.tail1234.ts.net is not this machine, so the app answers to another name, and it has no password: ${AUTH_MISSING_NATIVE}`,
      ],
      [
        'a container published on loopback with a public name',
        { ...container, allowedHosts: ['flights.example.com'] },
        `ALLOWED_HOSTS: flights.example.com is not this machine, so the app answers to another name, and it has no password: ${AUTH_MISSING}`,
      ],
      [
        'a container with no published address',
        { ...container, publishedAddress: null },
        `PUBLISHED_ADDRESS: not set, so the app cannot tell that only this machine reaches it, and it has no password: ${AUTH_MISSING}`,
      ],
      [
        'a container published on 0.0.0.0',
        { ...container, publishedAddress: '0.0.0.0' },
        `PUBLISHED_ADDRESS: the app is published on 0.0.0.0, which other devices can reach, and has no password: ${AUTH_MISSING}`,
      ],
      [
        'a native loopback bind behind a declared proxy',
        { trustProxy: true },
        `TRUST_PROXY: true says a proxy forwards other devices to the app, and it has no password: ${AUTH_MISSING_NATIVE}`,
      ],
      ['no allowed host', { allowedHosts: [] }, 'ALLOWED_HOSTS is empty; refusing to serve'],
    ] satisfies Array<[string, Partial<Config>, string]>)('refuses %s', async (_label, over, message) => {
      await expect(boot(noAuth(over))).rejects.toMatchObject({ exitCode: 78, message });
    });

    it('refuses a short password, which loadConfigFromEnv never builds (review SEC-R2-2)', async () => {
      await expect(
        boot(noAuth({ auth: { user: 'operator', pass: new Secret('elevenchars') } })),
      ).rejects.toMatchObject({ exitCode: 78, message: expect.stringMatching(/APP_BASIC_AUTH_PASS/) });
    });

    it.each([
      ['a native loopback bind', {}],
      [
        '[::1]:3000, 127.0.0.2 and LOCALHOST:3000',
        { allowedHosts: ['[::1]:3000', '127.0.0.2', 'LOCALHOST:3000'] },
      ],
      ['a container published on loopback', container],
    ] satisfies Array<[string, Partial<Config>]>)(
      'boots with no password and no warning on %s',
      async (_label, over) => {
        const lines: string[] = [];
        const running = await boot(noAuth(over), lines);
        await running.close();
        expect(lines.join('')).not.toContain('ALLOW_UNAUTHENTICATED');
      },
    );

    it('ALLOW_UNAUTHENTICATED bypasses both checks with a warning (a tailnet-only host)', async () => {
      const lines: string[] = [];
      const running = await boot(
        noAuth({
          bindAddress: '0.0.0.0',
          allowedHosts: ['laptop.tail1234.ts.net'],
          allowUnauthenticated: true,
        }),
        lines,
      );
      await running.close();
      expect(lines.join('')).toContain('ALLOW_UNAUTHENTICATED');
    });
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
        ...bootEnv(envFor({ SEARCHAPI_KEY: SENTINEL_SA, ...env })),
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
        ...bootEnv(
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
