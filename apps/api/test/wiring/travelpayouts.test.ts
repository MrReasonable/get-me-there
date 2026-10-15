import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  type Config,
  type DiscoveryQuery,
  fixedClock,
  type Logger,
  parseConfig,
} from '@gmt/core';
import { type HttpKit, type HttpKitRequest, travelpayoutsHttpLimits } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { httpLimitsFor, providersFor } from '../../src/wiring.js';

const TOKEN = 'test-travelpayouts-token-0123456789abcdef';
const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };

function config(env: Record<string, string>): Config {
  const r = parseConfig(env, { realpath: (p) => p });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}
const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
};

/** A spy kit: records each request and answers with an empty Travelpayouts envelope (no network, no msw). */
function spyKit(): { http: HttpKit; seen: HttpKitRequest[] } {
  const seen: HttpKitRequest[] = [];
  const http: HttpKit = {
    request: (r) => {
      seen.push(r);
      return Promise.resolve({
        status: 200,
        body: { success: true, data: [], currency: 'gbp' },
        fetchedAt: NOW,
        fromCache: false,
        cacheKey: 'k',
      });
    },
    stats: () => ({ inFlight: 0 }),
  };
  return { http, seen };
}

describe('apps/api wiring: Travelpayouts (plan "Wiring and bootstraps")', () => {
  it('httpLimitsFor registers travelpayoutsHttpLimits when TRAVELPAYOUTS_TOKEN is set: rate clamped to 600, never billable', () => {
    const c = config({ ...base, TRAVELPAYOUTS_TOKEN: TOKEN, TRAVELPAYOUTS_RATE_PER_MINUTE: '900' });
    const tp = c.providers.travelpayouts;
    if (tp === null) throw new Error('travelpayouts not configured');
    const limits = httpLimitsFor(c).travelpayouts;
    expect(limits).toEqual(travelpayoutsHttpLimits(tp.limits, c));
    expect(limits).toMatchObject({
      hosts: ['api.travelpayouts.com'],
      ratePerMinute: 600,
      billable: 'never',
      costPerCallMicroGbp: 0,
      rateLimitFallbackWaitSeconds: 60,
    });
  });

  it('httpLimitsFor has no travelpayouts entry without a token', () => {
    expect(httpLimitsFor(config(base)).travelpayouts).toBeUndefined();
  });

  it('providersFor constructs the adapter only with a token, with the configured TTL and the header-only token', async () => {
    const { http, seen } = spyKit();
    const deps = { http, log: silentLog, clock: fixedClock(NOW) };
    expect(providersFor(config(base), deps).map((p) => p.id)).not.toContain('travelpayouts');
    const p = providersFor(
      config({ ...base, TRAVELPAYOUTS_TOKEN: TOKEN, TRAVELPAYOUTS_CACHE_TTL_HOURS: '3' }),
      deps,
    ).find((x) => x.id === 'travelpayouts');
    if (p?.discovery === undefined) throw new Error('travelpayouts discovery not constructed');
    const q: DiscoveryQuery = {
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureFrom: asIsoDate('2027-03-10'),
      departureTo: asIsoDate('2027-03-10'),
      minNights: 10,
      maxNights: 10,
      cabin: 'economy',
      currency: 'GBP',
    };
    const [plan] = p.discovery.plan(q);
    if (plan === undefined) throw new Error('no tile');
    expect(
      (
        await p.discovery.fetchTile(plan, q, {
          executionId: 'exec-1',
          signal: new AbortController().signal,
          recordFixtures: false,
        })
      ).kind,
    ).toBe('tile');
    const [req] = seen;
    expect(req?.cache).toMatchObject({ ttlSeconds: 3 * 3600 });
    // the airport pair's own code, never a metro code (plan decision 34)
    expect(req?.url.searchParams.get('origin')).toBe('LHR');
    expect(req?.headers['X-Access-Token']).toBe(TOKEN);
  });
});
