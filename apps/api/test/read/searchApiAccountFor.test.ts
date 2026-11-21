// searchApiAccountFor: the balance cache over a pass's ports (settings plan ruling 10): the request goes out under the
// unledgered id with the key and the operator's zone, and the ledger's SearchApi count says when a run billed calls.
// The http kit is a double and the body SYNTHETIC (the vendor's documented account shape); nothing leaves the process.
import { asIsoDateTime, type BudgetGuard, fixedClock, type Logger } from '@gmt/core';
import type { HttpKit, HttpKitRequest } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { searchApiAccountFor } from '../../src/read/searchApiAccount.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { SENTINEL_SA } from '../helpers/env.js';

const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };
const T0 = asIsoDateTime('2026-11-19T14:00:00.000Z');
const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

function ports(env: Record<string, string>, calls: { n: number }) {
  const requests: HttpKitRequest[] = [];
  const http: HttpKit = {
    request: (r) => {
      requests.push(r);
      return Promise.resolve({
        status: 200,
        body: {
          account: { remaining_searches: 38 - calls.n, monthly_allowance: 10_000 },
          subscription: { period_start: '2026-11-01T00:00:00Z', period_end: '2026-12-01T03:00:00Z' },
        },
        fetchedAt: T0,
        cacheKey: 'k',
        fromCache: false,
      });
    },
    stats: () => ({ inFlight: 0 }),
    holdUntil: () => undefined,
  };
  const budget: BudgetGuard = {
    reserve: () => {
      throw new Error('the balance read reserves nothing');
    },
    recordCacheHit: () => undefined,
    usage: () => ({
      calls: calls.n,
      costMicroGbp: 0,
      cap: 100,
      windowUsed: true,
      windowStart: T0,
      windowEnd: T0,
    }),
    recentCalls: () => 0,
  };
  return {
    requests,
    ports: { config: loadConfigFromEnv({ ...base, ...env }), http, clock: fixedClock(T0), log, budget },
  };
}

describe('searchApiAccountFor', () => {
  it('without a key: null, and nothing asked', async () => {
    const r = ports({}, { n: 0 });
    const port = searchApiAccountFor(r.ports);
    expect(await port.read()).toBeNull();
    expect(r.requests).toEqual([]);
  });

  it('with a key: the read goes out unledgered in the operator’s zone, and a run that billed calls drops the cache', async () => {
    const calls = { n: 0 };
    const r = ports(
      { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd', SCHEDULER_TIMEZONE: 'America/New_York' },
      calls,
    );
    const port = searchApiAccountFor(r.ports);
    expect(await port.read()).toMatchObject({ remaining: 38, periodEnd: '2026-11-30' });
    expect(r.requests.map((q) => q.providerId)).toEqual(['searchapi-account']);
    await port.read();
    expect(r.requests).toHaveLength(1);
    port.runEnded(); // nothing billed: kept
    await port.read();
    expect(r.requests).toHaveLength(1);
    calls.n = 4; // a run billed four calls
    port.runEnded();
    expect(await port.read()).toMatchObject({ remaining: 34 });
    expect(r.requests).toHaveLength(2);
  });
});
