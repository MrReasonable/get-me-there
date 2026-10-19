import { asIata, asIsoDate, asIsoDateTime, type Config, fixedClock, parseConfig } from '@gmt/core';
import type { HttpKit } from '@gmt/providers';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultDefinitionInput } from '../../src/defaults.js';
import { budgetScopes } from '../../src/read/usage.js';
import { collectSecrets, httpLimitsFor, providersFor } from '../../src/wiring.js';
import { cleanEnv, silentLog } from '../helpers/env.js';

const KEY = 'test-camoufox-worker-key-0123456789abcdef';
const ON = {
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: 'http://host.docker.internal:8090',
  CAMOUFOX_WORKER_KEY: KEY,
};
function config(extra: Record<string, string> = {}): Config {
  const r = parseConfig(
    cleanEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1', ...extra }),
    { realpath: (p) => p },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}
const http: HttpKit = {
  request: () => Promise.reject(new Error('no request in this test')),
  stats: () => ({ inFlight: 0 }),
};
const deps = { http, log: silentLog, clock: fixedClock(asIsoDateTime('2026-10-18T05:00:00.000Z')) };

beforeEach(() => {
  expect.hasAssertions();
});

describe('apps/api wiring: camoufox (brief Task 14.10)', () => {
  it('off by default: no limits, no provider, no secret', () => {
    const c = config();
    expect(httpLimitsFor(c).camoufox).toBeUndefined();
    expect(httpLimitsFor(c)['camoufox-status']).toBeUndefined();
    expect(providersFor(c, deps).map((p) => p.id)).not.toContain('camoufox');
    expect(collectSecrets(c).map((s) => s.reveal())).not.toContain(KEY);
  });
  it('on: the worker origin, never billable, concurrency 1, no transport retries; the status route; discovery only; the key collected', () => {
    const c = config(ON);
    expect(httpLimitsFor(c).camoufox).toMatchObject({
      hosts: ['host.docker.internal'],
      workerPort: 8090,
      workerScheme: 'http:',
      billable: 'never',
      concurrency: 1,
      retryTransport: false,
    });
    expect(httpLimitsFor(c)['camoufox-status']).toMatchObject({
      hosts: ['host.docker.internal'],
      workerPort: 8090,
    });
    const p = providersFor(c, deps).find((x) => x.id === 'camoufox');
    expect(p?.discovery?.info.sourceKind).toBe('scraped-self');
    expect(p?.verification).toBeUndefined();
    expect(collectSecrets(c).map((s) => s.reveal())).toContain(KEY);
  });
  it('a new definition never names camoufox, even when it is the only discovery provider configured', () => {
    const c = config(ON);
    const input = defaultDefinitionInput(c, providersFor(c, deps));
    expect(input.providers.discovery).not.toContain('camoufox');
    expect(input.providers.verification).not.toContain('camoufox');
  });
  it('an execution’s budget rows include camoufox’s own page cap scope', () => {
    const c = config(ON);
    expect(budgetScopes({ config: c, providers: providersFor(c, deps) }, 'e1')).toContainEqual({
      kind: 'provider-execution',
      executionId: 'e1',
      providerId: 'camoufox',
    });
    expect(
      budgetScopes({ config: c, providers: providersFor(c, deps) }, null).some(
        (s) => s.kind === 'provider-execution',
      ),
    ).toBe(false);
  });
});

describe('apps/api wiring: camoufox grid mode (fix round 1, CA 1)', () => {
  it('a grid page asks for, and reserves, no more scrolls than the guard says the caps leave', async () => {
    const c = config({ ...ON, CAMOUFOX_MODE: 'grid', CAMOUFOX_EXECUTION_PAGE_CAP: '1' });
    const sent: Array<{ body: unknown; scrolls: number | undefined }> = [];
    const capture: HttpKit = {
      request: (r) => {
        sent.push({ body: JSON.parse(typeof r.body === 'string' ? r.body : '{}'), scrolls: r.scrolls });
        return Promise.reject(new Error('captured'));
      },
      stats: () => ({ inFlight: 0 }),
    };
    const asked: Array<[string, string | null]> = [];
    const p = providersFor(c, {
      ...deps,
      http: capture,
      scrollsLeft: (providerId, executionId) => {
        asked.push([providerId, executionId]);
        return 3;
      },
    }).find((x) => x.id === 'camoufox');
    const d = p?.discovery;
    if (d === undefined) throw new Error('camoufox discovery');
    const q = {
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureFrom: asIsoDate('2027-03-11'),
      departureTo: asIsoDate('2027-03-24'),
      minNights: 10,
      maxNights: 10,
      cabin: 'economy' as const,
      currency: 'GBP' as const,
      airportNames: {
        origin: ['London Heathrow Airport'],
        destination: ['John F Kennedy International Airport'],
      },
    };
    const [tile] = d.plan(q);
    if (tile === undefined) throw new Error('tile');
    await expect(
      d.fetchTile(tile, q, {
        executionId: 'e1',
        signal: new AbortController().signal,
        recordFixtures: false,
      }),
    ).rejects.toThrow('captured');
    expect(asked).toEqual([['camoufox', 'e1']]);
    expect(sent).toEqual([{ body: expect.objectContaining({ scrollAllowance: 3 }), scrolls: 3 }]);
  });
});
