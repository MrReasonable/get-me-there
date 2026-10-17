import { describe, expect, it } from 'vitest';
import { AUTH_MISSING, parseConfig } from '../../src/config/schema.js';

const realpath = (p: string) => p;
const minimal = {
  NODE_ENV: 'production',
  DATABASE_PATH: '/data/get-me-there.db',
  APP_BASIC_AUTH_USER: 'ian',
  APP_BASIC_AUTH_PASS: 'correct-horse-battery',
  IN_CONTAINER: '1',
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

describe('parseConfig (spec §12)', () => {
  it('parses the minimal production config with defaults', () => {
    const c = ok(minimal);
    expect(c.port).toBe(3000);
    expect(c.bindAddress).toBe('0.0.0.0');
    expect(c.allowedHosts).toEqual(['localhost:3000', '127.0.0.1:3000']);
    expect(c.spend.monthlyCapMicroGbp).toBe(0); // no billed provider → 0
    expect(c.spend.executionMaxFreeCalls).toBe(2000);
    expect(c.spend.softConfirmMicroGbp).toBe(1_000_000);
    expect(c.staleAfterHours).toBe(192);
    expect(c.providers.searchapi).toBeNull();
    expect(c.providers.travelpayouts).toBeNull();
    expect(c.providers.fixture).toBeNull();
    expect(c.smtp).toBeNull();
    expect(c.inContainer).toBe(true);
    expect(c.appBaseUrl).toBeNull();
  });
  it('treats empty strings as unset', () => {
    expect(ok({ ...minimal, SEARCHAPI_KEY: '', SMTP_HOST: '' }).providers.searchapi).toBeNull();
  });
  it('requires both auth vars or neither, password ≥ 12', () => {
    expect(errors({ ...minimal, APP_BASIC_AUTH_PASS: undefined })).toContain('APP_BASIC_AUTH_PASS');
    expect(errors({ ...minimal, APP_BASIC_AUTH_USER: undefined })).toContain('APP_BASIC_AUTH_USER');
    expect(errors({ ...minimal, APP_BASIC_AUTH_PASS: 'short' })).toContain('APP_BASIC_AUTH_PASS');
  });
  it('refuses unauthenticated on a non-loopback bind unless ALLOW_UNAUTHENTICATED=true', () => {
    const noAuth = { ...minimal, APP_BASIC_AUTH_USER: undefined, APP_BASIC_AUTH_PASS: undefined };
    expect(errors({ ...noAuth, IN_CONTAINER: undefined })).toEqual(
      expect.arrayContaining(['BIND_ADDRESS', 'ALLOW_UNAUTHENTICATED']),
    );
    expect(ok({ ...noAuth, ALLOW_UNAUTHENTICATED: 'true' }).auth).toBeNull();
    expect(ok({ ...noAuth, BIND_ADDRESS: '127.0.0.1' }).auth).toBeNull();
    expect(ok({ ...noAuth, BIND_ADDRESS: 'localhost' }).auth).toBeNull();
  });
  it('the compose refusal without auth names the two lines to add, not the variables compose fixes (devops-final-001, ruling 14)', () => {
    const noAuth = { ...minimal, APP_BASIC_AUTH_USER: undefined, APP_BASIC_AUTH_PASS: undefined };
    const r = parseConfig(noAuth, { realpath });
    if (r.ok) throw new Error('expected failure');
    // why: in the container BIND_ADDRESS is fixed by compose and ALLOW_UNAUTHENTICATED is not forwarded, so neither
    // is a field the operator can act on; the two auth lines are.
    expect(r.errors.map((e) => e.field)).toEqual(['APP_BASIC_AUTH_USER', 'ALLOW_UNAUTHENTICATED']);
    expect(r.errors[0]?.message).toBe(AUTH_MISSING);
    const host = parseConfig({ ...noAuth, IN_CONTAINER: undefined }, { realpath });
    if (host.ok) throw new Error('expected failure');
    // why: outside the container BIND_ADDRESS is the operator's own, so it is named as well.
    expect(host.errors.map((e) => e.field)).toEqual([
      'APP_BASIC_AUTH_USER',
      'BIND_ADDRESS',
      'ALLOW_UNAUTHENTICATED',
    ]);
  });
  it('fills the 40usd preset and lets variables override', () => {
    const c = ok({ ...minimal, SEARCHAPI_KEY: 'k'.repeat(32), SEARCHAPI_PLAN: '40usd' });
    expect(c.providers.searchapi?.limits).toMatchObject({
      monthlyCallCap: 10_000,
      window: 'month',
      ratePerHour: 2000,
      ratePerMinute: 10,
      concurrency: 2,
      costPerCallMicroGbp: 0,
      planFixedMicroGbp: 32_000_000,
      excludedFromSchedule: false,
    });
    expect(c.spend.monthlyCapMicroGbp).toBe(35_000_000);
    expect(c.spend.executionMaxCalls).toBe(2000);
    expect(c.spend.executionMaxCostMicroGbp).toBe(0);
    const o = ok({
      ...minimal,
      SEARCHAPI_KEY: 'k'.repeat(32),
      SEARCHAPI_PLAN: '40usd',
      MONTHLY_SPEND_CAP_PENCE: '3000',
      SEARCHAPI_MONTHLY_CALL_CAP: '5000',
      SEARCHAPI_RATE_PER_MINUTE: '3',
      SEARCHAPI_RATE_PER_HOUR: '100',
      SEARCHAPI_CONCURRENCY: '1',
      SEARCHAPI_CACHE_TTL_HOURS: '2',
      SEARCHAPI_COST_PER_CALL_MICRO_GBP: '3200',
      SEARCHAPI_PLAN_FIXED_PENCE: '0',
      SEARCHAPI_BILLING_DAY: '5',
      EXECUTION_MAX_CALLS: '10',
      EXECUTION_MAX_COST_PENCE: '50',
    });
    expect(o.spend.monthlyCapMicroGbp).toBe(30_000_000);
    expect(o.spend.executionMaxCalls).toBe(10);
    expect(o.spend.executionMaxCostMicroGbp).toBe(500_000);
    expect(o.providers.searchapi?.limits).toMatchObject({
      monthlyCallCap: 5000,
      ratePerMinute: 3,
      ratePerHour: 100,
      concurrency: 1,
      cacheTtlHours: 2,
      costPerCallMicroGbp: 3200,
      planFixedMicroGbp: 0,
      billingDay: 5,
    });
  });
  it('trial is the default plan: lifetime window, excluded from schedule, trialUsed seeded', () => {
    const c = ok({ ...minimal, SEARCHAPI_KEY: 'k'.repeat(32), SEARCHAPI_TRIAL_USED: '9' });
    expect(c.providers.searchapi?.plan).toBe('trial');
    expect(c.providers.searchapi?.limits).toMatchObject({
      monthlyCallCap: 100,
      window: 'lifetime',
      excludedFromSchedule: true,
      ratePerHour: 20,
      ratePerMinute: 2,
      concurrency: 1,
    });
    expect(c.providers.searchapi?.trialUsed).toBe(9);
    expect(c.spend.executionMaxCalls).toBe(0);
    expect(String(c.providers.searchapi?.key)).toBe('[redacted]');
  });
  it('travelpayouts defaults and overrides', () => {
    const c = ok({ ...minimal, TRAVELPAYOUTS_TOKEN: 't'.repeat(32) });
    expect(c.providers.travelpayouts?.limits).toMatchObject({
      monthlyCallCap: 50_000,
      window: 'month',
      ratePerMinute: 200,
      ratePerHour: 10_000,
      concurrency: 4,
      cacheTtlHours: 6,
      costPerCallMicroGbp: 0,
      planFixedMicroGbp: 0,
      billingDay: 1,
    });
    const o = ok({
      ...minimal,
      TRAVELPAYOUTS_TOKEN: 't'.repeat(32),
      TRAVELPAYOUTS_BILLING_DAY: '3',
      TRAVELPAYOUTS_MONTHLY_CALL_CAP: '100',
      TRAVELPAYOUTS_RATE_PER_MINUTE: '5',
      TRAVELPAYOUTS_RATE_PER_HOUR: '50',
      TRAVELPAYOUTS_CONCURRENCY: '2',
      TRAVELPAYOUTS_CACHE_TTL_HOURS: '1',
    });
    expect(o.providers.travelpayouts?.limits).toMatchObject({
      billingDay: 3,
      monthlyCallCap: 100,
      ratePerMinute: 5,
      ratePerHour: 50,
      concurrency: 2,
      cacheTtlHours: 1,
    });
  });
  it('rejects a Travelpayouts cache TTL beyond the vendor 48-hour freshness window as a config error', () => {
    const tp = { ...minimal, TRAVELPAYOUTS_TOKEN: 't'.repeat(32) };
    expect(errors({ ...tp, TRAVELPAYOUTS_CACHE_TTL_HOURS: '49' })).toContain('TRAVELPAYOUTS_CACHE_TTL_HOURS');
    expect(
      ok({ ...tp, TRAVELPAYOUTS_CACHE_TTL_HOURS: '48' }).providers.travelpayouts?.limits.cacheTtlHours,
    ).toBe(48);
  });
  it('rejects non-integer pence and billing days outside 1–28', () => {
    expect(errors({ ...minimal, MONTHLY_SPEND_CAP_PENCE: '12.5' })).toContain('MONTHLY_SPEND_CAP_PENCE');
    expect(errors({ ...minimal, GLOBAL_BILLING_DAY: '29' })).toContain('GLOBAL_BILLING_DAY');
    expect(errors({ ...minimal, SEARCHAPI_KEY: 'k'.repeat(32), SEARCHAPI_BILLING_DAY: '0' })).toContain(
      'SEARCHAPI_BILLING_DAY',
    );
  });
  it('SMTP is all or nothing; tls none only on loopback or the dev mailpit host', () => {
    const smtp = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      ALERT_EMAIL_TO: 'a@example.com',
      ALERT_EMAIL_FROM: 'x@example.com',
    };
    expect(ok({ ...minimal, ...smtp }).smtp?.tls).toBe('implicit');
    expect(ok({ ...minimal, ...smtp, SMTP_TLS: 'starttls' }).smtp?.tls).toBe('starttls');
    expect(errors({ ...minimal, ...smtp, SMTP_PASS: undefined })).toContain('SMTP_PASS');
    expect(errors({ ...minimal, ...smtp, SMTP_TLS: 'none' })).toContain('SMTP_TLS');
    expect(ok({ ...minimal, ...smtp, SMTP_HOST: '127.0.0.1', SMTP_TLS: 'none' }).smtp?.tls).toBe('none');
    expect(
      ok({
        ...minimal,
        NODE_ENV: 'development',
        IN_CONTAINER: undefined,
        ...smtp,
        SMTP_HOST: 'mailpit',
        SMTP_TLS: 'none',
      }).smtp?.tls,
    ).toBe('none');
    expect(errors({ ...minimal, ...smtp, SMTP_HOST: 'mailpit', SMTP_TLS: 'none' })).toContain('SMTP_TLS');
    expect(String(ok({ ...minimal, ...smtp }).smtp?.pass)).toBe('[redacted]');
  });
  it('realpath-resolves the database path and keeps :memory: as is', () => {
    expect(
      parseConfig(
        { ...minimal, DATABASE_PATH: '/data/link.db' },
        { realpath: () => '/real/get-me-there.db' },
      ),
    ).toMatchObject({
      ok: true,
      config: { databasePath: '/real/get-me-there.db' },
    });
    expect(
      ok({ ...minimal, NODE_ENV: 'test', DATABASE_PATH: ':memory:', IN_CONTAINER: undefined }).databasePath,
    ).toBe(':memory:');
  });
  it('adds the Vite origin to ALLOWED_HOSTS under development and honours an explicit list', () => {
    expect(ok({ ...minimal, NODE_ENV: 'development', IN_CONTAINER: undefined }).allowedHosts).toContain(
      'localhost:5173',
    );
    expect(ok({ ...minimal, ALLOWED_HOSTS: 'gmt.example, gmt.tailnet:3000 ,' }).allowedHosts).toEqual([
      'gmt.example',
      'gmt.tailnet:3000',
    ]);
  });
  it('names every bad field at once', () => {
    expect(errors({ ...minimal, PORT: 'abc', LOG_LEVEL: 'loud' })).toEqual(
      expect.arrayContaining(['PORT', 'LOG_LEVEL']),
    );
  });
  it('defaults NODE_ENV to production and rejects a bad SMTP port', () => {
    expect(ok({ ...minimal, NODE_ENV: undefined }).nodeEnv).toBe('production');
    const smtp = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 'abc',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      ALERT_EMAIL_TO: 'a@example.com',
      ALERT_EMAIL_FROM: 'x@example.com',
    };
    expect(errors({ ...minimal, ...smtp })).toEqual(['SMTP_PORT']);
  });
  it('requires DATABASE_PATH', () => {
    expect(errors({ ...minimal, DATABASE_PATH: undefined })).toContain('DATABASE_PATH');
  });
  it('APP_BASE_URL must be https and the fixture cost is only read outside production', () => {
    expect(errors({ ...minimal, APP_BASE_URL: 'http://x' })).toContain('APP_BASE_URL');
    expect(ok({ ...minimal, APP_BASE_URL: 'https://gmt.example' }).appBaseUrl).toBe('https://gmt.example');
    expect(ok({ ...minimal, FIXTURE_COST_MICRO_GBP: '3200' }).providers.fixture).toBeNull();
    expect(
      ok({
        ...minimal,
        NODE_ENV: 'test',
        DATABASE_PATH: ':memory:',
        IN_CONTAINER: undefined,
        FIXTURE_COST_MICRO_GBP: '3200',
      }).providers.fixture,
    ).toEqual({ costMicroGbp: 3200 });
    expect(
      ok({ ...minimal, NODE_ENV: 'test', DATABASE_PATH: ':memory:', IN_CONTAINER: undefined }).providers
        .fixture,
    ).toEqual({
      costMicroGbp: 0,
    });
  });
  it('wraps secrets so a config dump never shows a key', () => {
    const c = ok({ ...minimal, TRAVELPAYOUTS_TOKEN: 't'.repeat(32) });
    expect(String(c.providers.travelpayouts?.token)).toBe('[redacted]');
    expect(c.providers.travelpayouts?.token.reveal()).toBe('t'.repeat(32));
    expect(JSON.stringify(c)).not.toContain('tttt');
    expect(JSON.stringify(c)).not.toContain('correct-horse');
  });
  it('parses the remaining scalar settings', () => {
    const c = ok({
      ...minimal,
      LOG_LEVEL: 'debug',
      POINT_OF_SALE: 'IE',
      CALENDAR_STALE_AFTER_HOURS: '100',
      STUCK_AFTER_HOURS: '6',
      MAX_CELLS_PER_DEFINITION: '100',
      SCHEDULER_TIMEZONE: 'Europe/Dublin',
      AUTO_RESUME: 'false',
      MAX_AUTO_RESUMES: '1',
      MAX_WAIT_SECONDS: '10',
      REQUEST_TIMEOUT_SECONDS: '5',
      ESTIMATE_RETRY_FACTOR: '1.5',
      FX_MAX_RATE_AGE_DAYS: '7',
      TRUST_PROXY: 'true',
      SOFT_CONFIRM_PENCE: '0',
      EXECUTION_MAX_FREE_CALLS: '5',
      CHILD_MAX_CALLS: '2',
      GLOBAL_BILLING_DAY: '28',
    });
    expect(c).toMatchObject({
      logLevel: 'debug',
      pointOfSale: 'IE',
      calendarStaleAfterHours: 100,
      stuckAfterHours: 6,
      maxCellsPerDefinition: 100,
      schedulerTimezone: 'Europe/Dublin',
      autoResume: false,
      maxAutoResumes: 1,
      maxWaitSeconds: 10,
      requestTimeoutSeconds: 5,
      estimateRetryFactor: 1.5,
      fxMaxRateAgeDays: 7,
      trustProxy: true,
      spend: { softConfirmMicroGbp: 0, executionMaxFreeCalls: 5, childMaxCalls: 2, globalBillingDay: 28 },
    });
    expect(errors({ ...minimal, POINT_OF_SALE: 'gb' })).toContain('POINT_OF_SALE');
    expect(errors({ ...minimal, SCHEDULER_TIMEZONE: 'Mars/Olympus' })).toContain('SCHEDULER_TIMEZONE');
  });
});
