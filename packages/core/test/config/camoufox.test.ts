import { describe, expect, it } from 'vitest';
import { CAMOUFOX_WORKER_HOSTS, camoufoxWorkerUrlOk, parseConfig } from '../../src/config/schema.js';

const realpath = (p: string) => p;
const minimal = {
  NODE_ENV: 'production',
  DATABASE_PATH: '/data/get-me-there.db',
  APP_BASIC_AUTH_USER: 'ian',
  APP_BASIC_AUTH_PASS: 'correct-horse-battery',
  IN_CONTAINER: '1',
};
const ON = {
  ...minimal,
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: 'http://host.docker.internal:8090',
  CAMOUFOX_WORKER_KEY: 'test-camoufox-worker-key-0123456789abcdef',
};
function ok(env: Record<string, string | undefined>) {
  const r = parseConfig(env, { realpath });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}
function errors(env: Record<string, string | undefined>) {
  const r = parseConfig(env, { realpath });
  if (r.ok) throw new Error('expected failure');
  return r.errors.map((e) => e.field);
}

describe('CAMOUFOX_* (spec §12 rev 32)', () => {
  it('off by default: no camoufox provider', () => {
    expect(ok(minimal).providers.camoufox).toBeNull();
  });
  it('on, with every default and every ProviderLimits value stated', () => {
    const c = ok(ON).providers.camoufox;
    expect(c).toMatchObject({
      workerUrl: 'http://host.docker.internal:8090',
      minSpacingSeconds: 30,
      executionPageCap: 100,
      cooldownHours: 48,
      pageTimeoutSeconds: 90,
    });
    expect(c?.key.reveal()).toBe(ON.CAMOUFOX_WORKER_KEY);
    expect(c?.limits).toEqual({
      monthlyCallCap: 1500,
      window: 'month',
      billingDay: 1,
      ratePerMinute: 2,
      ratePerHour: 120,
      concurrency: 1,
      cacheTtlHours: 0,
      costPerCallMicroGbp: 0,
      planFixedMicroGbp: 0,
      excludedFromSchedule: false,
      executionCallCap: 100,
      pagesOnly: true,
      minSpacingSeconds: 30,
      executionScrollCap: 600,
      monthlyScrollCap: 6000,
    });
  });
  it('a 45 s spacing gives 1 a minute and 80 an hour', () => {
    expect(ok({ ...ON, CAMOUFOX_MIN_SPACING_SECONDS: '45' }).providers.camoufox?.limits).toMatchObject({
      ratePerMinute: 1,
      ratePerHour: 80,
    });
  });
  it('every override is read', () => {
    const c = ok({
      ...ON,
      CAMOUFOX_EXECUTION_PAGE_CAP: '400',
      CAMOUFOX_MONTHLY_PAGE_CAP: '900',
      CAMOUFOX_BILLING_DAY: '15',
      CAMOUFOX_COOLDOWN_HOURS: '72',
      CAMOUFOX_PAGE_TIMEOUT_SECONDS: '240',
      CAMOUFOX_MODE: 'list',
    }).providers.camoufox;
    expect(c).toMatchObject({ executionPageCap: 400, cooldownHours: 72, pageTimeoutSeconds: 240 });
    expect(c?.limits).toMatchObject({ monthlyCallCap: 900, billingDay: 15, executionCallCap: 400 });
  });
  it.each([
    ['CAMOUFOX_MIN_SPACING_SECONDS', '29'],
    ['CAMOUFOX_MIN_SPACING_SECONDS', '601'],
    ['CAMOUFOX_EXECUTION_PAGE_CAP', '401'],
    ['CAMOUFOX_EXECUTION_PAGE_CAP', '0'],
    ['CAMOUFOX_COOLDOWN_HOURS', '23'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '29'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '241'],
    ['CAMOUFOX_WORKER_KEY', 'short'],
    ['CAMOUFOX_WORKER_URL', 'http://192.168.1.10:8090'],
    ['CAMOUFOX_WORKER_URL', 'https://worker.example.test'],
    ['CAMOUFOX_WORKER_URL', 'http://127.0.0.1'],
    ['CAMOUFOX_WORKER_URL', 'http://127.0.0.1:8090/path'],
    ['CAMOUFOX_WORKER_URL', 'http://user:pw@127.0.0.1:8090'],
    ['CAMOUFOX_MODE', 'calendar'],
    ['CAMOUFOX_ENABLED', 'yes'],
  ])('%s=%s fails boot naming the field', (name, value) => {
    expect(errors({ ...ON, [name]: value })).toContain(name);
  });
  it('fix round 1 (TS M6): the key must be at least 32 characters, exactly', () => {
    expect(errors({ ...ON, CAMOUFOX_WORKER_KEY: 'k'.repeat(31) })).toEqual(['CAMOUFOX_WORKER_KEY']);
    expect(ok({ ...ON, CAMOUFOX_WORKER_KEY: 'k'.repeat(32) }).providers.camoufox?.key.reveal()).toBe(
      'k'.repeat(32),
    );
  });
  it('fix round 1 (arch M7): the spacing is a ProviderLimits value, so the engine reads it like the other limits', () => {
    expect(
      ok({ ...ON, CAMOUFOX_MIN_SPACING_SECONDS: '600' }).providers.camoufox?.limits.minSpacingSeconds,
    ).toBe(600);
  });
  it('enabled without a key or URL fails boot naming each', () => {
    expect(errors({ ...minimal, CAMOUFOX_ENABLED: 'true' })).toEqual(
      expect.arrayContaining(['CAMOUFOX_WORKER_KEY', 'CAMOUFOX_WORKER_URL']),
    );
  });
  it('a bad value fails boot even while the provider is off', () => {
    expect(errors({ ...minimal, CAMOUFOX_MODE: 'calendar' })).toContain('CAMOUFOX_MODE');
  });
  it.each([
    'http://127.0.0.1:8090',
    'http://localhost:8090',
    'http://[::1]:8090',
    'https://127.0.0.1:8443',
    'http://host.docker.internal:8090',
  ])('accepts %s', (u) => {
    expect(ok({ ...ON, CAMOUFOX_WORKER_URL: u }).providers.camoufox?.workerUrl).toBe(u);
  });
});

describe('camoufoxWorkerUrlOk (arch-012: the one URL rule)', () => {
  it.each([
    ['not a URL', 'not a url'],
    ['another scheme', 'ftp://127.0.0.1:8090'],
    ['a host outside the list', 'http://10.0.0.1:8090'],
    ['no port', 'http://localhost'],
    ['a path', 'http://localhost:8090/v1'],
    ['an empty userinfo', 'http://@localhost:8090'],
    ['a password only', 'http://:pw@localhost:8090'],
    ['a query', 'http://localhost:8090?x=1'],
    ['an empty query', 'http://localhost:8090/?'],
    ['a fragment', 'http://localhost:8090#x'],
  ])('refuses %s', (_n, u) => {
    expect(camoufoxWorkerUrlOk(u)).toBe(false);
  });
  it('names the four hosts', () => {
    expect(CAMOUFOX_WORKER_HOSTS).toEqual(['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal']);
  });
});
