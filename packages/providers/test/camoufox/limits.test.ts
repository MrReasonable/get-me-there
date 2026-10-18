import { parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { camoufoxHttpLimits, camoufoxStatusHttpLimits, pageClassOf } from '../../src/camoufox/index.js';

const env = {
  NODE_ENV: 'production',
  DATABASE_PATH: '/data/x.db',
  APP_BASIC_AUTH_USER: 'ian',
  APP_BASIC_AUTH_PASS: 'correct-horse-battery',
  IN_CONTAINER: '1',
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: 'http://host.docker.internal:8090',
  CAMOUFOX_WORKER_KEY: 'test-camoufox-worker-key-0123456789abcdef',
  CAMOUFOX_MIN_SPACING_SECONDS: '45',
};
function camoufox(over: Record<string, string> = {}) {
  const r = parseConfig({ ...env, ...over }, { realpath: (p) => p });
  if (!r.ok || r.config.providers.camoufox === null) throw new Error('config');
  return r.config.providers.camoufox;
}

describe('camoufoxHttpLimits (spec §5.3 rev 32; decision 69)', () => {
  it('the worker’s origin, never billable, concurrency 1, spacing as minIntervalMs, page timeout + 15 s, no transport retries', () => {
    const l = camoufoxHttpLimits(camoufox(), { maxWaitSeconds: 3900 });
    expect(l).toMatchObject({
      hosts: ['host.docker.internal'],
      workerPort: 8090,
      workerScheme: 'http:',
      ratePerMinute: 1,
      ratePerHour: 80,
      concurrency: 1,
      billable: 'never',
      costPerCallMicroGbp: 0,
      maxWaitSeconds: 3900,
      requestTimeoutSeconds: 105,
      minIntervalMs: 45_000,
      retryTransport: false,
      connectRefusedKind: 'provider-unavailable',
    });
    expect(l.classifyError).toBeTypeOf('function');
    expect(
      camoufoxHttpLimits(camoufox({ CAMOUFOX_WORKER_URL: 'https://[::1]:8443' }), { maxWaitSeconds: 1 }),
    ).toMatchObject({
      hosts: ['[::1]'],
      workerPort: 8443,
      workerScheme: 'https:',
    });
  });
  it('the status route: the same origin, a short timeout, no retries', () => {
    expect(camoufoxStatusHttpLimits(camoufox(), { maxWaitSeconds: 3900 })).toMatchObject({
      hosts: ['host.docker.internal'],
      workerPort: 8090,
      billable: 'never',
      requestTimeoutSeconds: 10,
      retryTransport: false,
    });
  });
  it('pageClass reads x-gmt-google-contacted; an absent header is a page', () => {
    expect(pageClassOf({ status: 429, headers: new Headers({ 'x-gmt-google-contacted': '0' }) })).toBe(
      'no-page',
    );
    expect(pageClassOf({ status: 200, headers: new Headers({ 'x-gmt-google-contacted': '1' }) })).toBe(
      'page',
    );
    expect(pageClassOf({ status: 504, headers: new Headers() })).toBe('page');
    expect(pageClassOf({ status: null, headers: null })).toBe('page');
  });
});
