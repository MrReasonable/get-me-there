import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { AppLock, budgetConfigFromConfig, MIGRATIONS_DIR } from '@gmt/db';
import { defaultFixtureRoot } from '@gmt/providers/fixture';
import { describe, expect, it } from 'vitest';
import { buildPorts, httpLimitsFor, loadConfigFromEnv } from '../../src/wiring.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from '../helpers/env.js';
import { onCleanup, tempDir } from '../helpers/tmp.js';

const FIXTURE_COST = { FIXTURE_COST_MICRO_GBP: '3200' };

function ports(env: Record<string, string>) {
  const p = buildPorts(loadConfigFromEnv(env), {
    log: silentLog,
    clock: fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z')),
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => p.db.close());
  return p;
}

describe('buildPorts (plan "Wiring and bootstraps")', () => {
  it('under syntheticAllowed (test + :memory:) builds a migrated DB, the fixture provider and the in-process fixture host', async () => {
    const p = ports(testEnv(FIXTURE_COST));
    // why: testEnv configures a Travelpayouts sentinel token, so WP6's provider is registered beside the fixture one.
    expect(p.providers.map((x) => x.id)).toEqual(['fixture', 'travelpayouts']);
    expect(p.fixtureRoot).toBe(defaultFixtureRoot());
    expect(p.recorder).toBeNull();
    expect(p.repos.airports.count()).toBe(0); // table exists: migrations applied
    expect(AppLock.inspect(p.db)).toBeNull();
    expect(p.secrets.map((s) => s.reveal()).sort()).toEqual([SENTINEL_SA, SENTINEL_TP].sort());
    expect(JSON.stringify(p.secrets)).not.toContain(SENTINEL_SA); // Secret#toJSON redacts
  });

  it('in production builds no provider and no fixture host, and a fixture.local request is refused; migrations are idempotent', async () => {
    const path = join(tempDir(), 'prod.db');
    const env = testEnv({ NODE_ENV: 'production', DATABASE_PATH: path });
    for (let i = 0; i < 2; i++) {
      const p = ports(env);
      // why: the synthetic gate is closed, so no fixture provider; the configured Travelpayouts one (WP6) remains.
      expect(p.providers.map((x) => x.id)).toEqual(['travelpayouts']);
      expect(p.fixtureRoot).toBeNull();
      const url = new URL('http://fixture.local/calendar');
      await expect(
        p.http.request({
          providerId: 'fixture',
          executionId: null,
          tileIndex: 0,
          endpointPath: url.pathname,
          method: 'GET',
          url,
          headers: {},
          cache: 'never',
          signal: new AbortController().signal,
          recordFixtures: false,
        }),
      ).rejects.toThrow(
        'fixture /calendar: egress denied (no HTTP limits configured for this provider) [egress-denied]',
      );
      expect(p.db.raw.prepare('SELECT COUNT(*) AS n FROM provider_requests').get()).toEqual({ n: 0 });
    }
    expect(existsSync(path)).toBe(true);
  });

  it.each([
    ['development without the opt-in phrase', { NODE_ENV: 'development', DATABASE_PATH: 'x.fixture.db' }],
    [
      'development with the phrase but a non-.fixture.db path',
      { NODE_ENV: 'development', ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake', DATABASE_PATH: 'x.db' },
    ],
    [
      'production with the phrase',
      {
        NODE_ENV: 'production',
        ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake',
        DATABASE_PATH: 'x.fixture.db',
      },
    ],
  ])('the synthetic gate stays closed: %s (ts-012)', (_name, extra) => {
    const dir = tempDir();
    const p = ports(testEnv({ ...extra, DATABASE_PATH: join(dir, extra.DATABASE_PATH) }));
    expect(p.providers.map((x) => x.id)).toEqual(['travelpayouts']);
    expect(p.fixtureRoot).toBeNull();
    expect(Object.keys(httpLimitsFor(p.config)).sort()).toEqual(['fx', 'travelpayouts']);
  });

  it('fails, closing the handle, when the migrations directory is missing', () => {
    expect(() =>
      buildPorts(loadConfigFromEnv(testEnv()), { log: silentLog, migrationsDir: '/nonexistent/drizzle' }),
    ).toThrow(/migration failed/);
  });

  it('httpLimitsFor at WP4b: fixture (WP4 fixtureHttpLimits at the configured cost) only under syntheticAllowed, fx always', () => {
    const config = loadConfigFromEnv(testEnv(FIXTURE_COST));
    const limits = httpLimitsFor(config);
    expect(Object.keys(limits).sort()).toEqual(['fixture', 'fx', 'travelpayouts']);
    // why: the guard refuses any reserve whose cost differs from its configured rate (WP3 rule 'cost'), so both read config
    expect(limits.fixture?.costPerCallMicroGbp).toBe(3200);
    expect(limits.fixture?.costPerCallMicroGbp).toBe(
      budgetConfigFromConfig(config).providers.fixture?.costPerCallMicroGbp,
    );
    expect(limits.fx).toMatchObject({
      hosts: ['api.frankfurter.dev'],
      billable: 'never',
      costPerCallMicroGbp: 0,
    });
  });
});
