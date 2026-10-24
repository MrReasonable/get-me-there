import { asIata, asIsoDate, asIsoDateTime, fixedClock, type Logger, PLAN_PRESETS } from '@gmt/core';
import { type HttpKit, searchApiHttpLimits } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { httpLimitsFor, loadConfigFromEnv, providersFor } from '../../src/wiring.js';

const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };
const withKey = { ...base, SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' };
const lines: string[] = [];
const log: Logger = {
  debug: (o) => lines.push(JSON.stringify(o)),
  info: (o) => lines.push(JSON.stringify(o)),
  warn: (o) => lines.push(JSON.stringify(o)),
  error: (o) => lines.push(JSON.stringify(o)),
  child: () => log,
};
// why: providersFor only constructs adapters; nothing here sends a request.
const http: HttpKit = {
  request: async () => {
    throw new Error('no network in this test');
  },
  stats: () => ({ inFlight: 0 }),
};
const clock = fixedClock(asIsoDateTime('2026-10-14T12:00:00.000Z'));
// why: providersFor takes { http, log, clock } on main (plan decision 34 removed the airports dependency).
const deps = { http, log, clock, appInstance: 'test-instance' };

describe('wiring: SearchApi (plan "Wiring and bootstraps")', () => {
  it('adds searchapi http limits when SEARCHAPI_KEY is set', () => {
    const l = httpLimitsFor(loadConfigFromEnv(withKey)).searchapi;
    expect(l).toMatchObject({
      hosts: ['www.searchapi.io'],
      billable: 'http-200',
      ratePerMinute: 10,
      ratePerHour: 2000,
      concurrency: 2,
    });
    // why: the classifier stays module-local (plan decision 30); the wired one is the one the adapter's limits carry.
    const own = searchApiHttpLimits(PLAN_PRESETS['40usd'], { maxWaitSeconds: 1, requestTimeoutSeconds: 1 });
    expect(l?.classifyError).toBe(own.classifyError);
  });

  it('constructs the searchapi provider when SEARCHAPI_KEY is set, and not otherwise', () => {
    expect(providersFor(loadConfigFromEnv(withKey), deps).map((p) => p.id)).toContain('searchapi');
    expect(providersFor(loadConfigFromEnv(base), deps).map((p) => p.id)).not.toContain('searchapi');
    expect(httpLimitsFor(loadConfigFromEnv(base)).searchapi).toBeUndefined();
  });

  it('SEARCHAPI_COST_PER_CALL_MICRO_GBP reaches both the ledger rate and the estimate (one source, ruling po-006)', () => {
    const config = loadConfigFromEnv({ ...withKey, SEARCHAPI_COST_PER_CALL_MICRO_GBP: '1234' });
    expect(httpLimitsFor(config).searchapi?.costPerCallMicroGbp).toBe(1234);
    const sa = providersFor(config, deps).find((p) => p.id === 'searchapi');
    const estimate = sa?.verification?.estimate({
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureDate: asIsoDate('2026-11-02'),
      returnDate: asIsoDate('2026-11-14'),
      cabin: 'economy',
      adults: 1,
      currency: 'GBP',
      expandTop: 2,
      bookingLinks: true,
    });
    expect(estimate?.costMicroGbp).toBe(5 * 1234);
  });
});
