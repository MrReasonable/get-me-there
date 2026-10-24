// Test-only environment builders. Secrets are sentinels (brief README); nothing reads .env.
import type { Logger } from '@gmt/core';

export const SENTINEL_SA = 'test-searchapi-key-0123456789abcdef';
export const SENTINEL_TP = 'test-travelpayouts-token-0123456789abcdef';
export const SENTINEL_SMTP = 'test-smtp-pass-0123456789abcdef';
export const SENTINEL_AUTH = 'test-basic-auth-pass-0123';

/** Every variable core's parseConfig reads (spec §12), so a value in a developer shell never leaks into a test. */
export const ALL_VARS = [
  'NODE_ENV',
  'DATABASE_PATH',
  'PORT',
  'BIND_ADDRESS',
  'ALLOWED_HOSTS',
  'APP_BASE_URL',
  'APP_BASIC_AUTH_USER',
  'APP_BASIC_AUTH_PASS',
  'ALLOW_UNAUTHENTICATED',
  'TRUST_PROXY',
  'LOG_LEVEL',
  'POINT_OF_SALE',
  'STALE_AFTER_HOURS',
  'CALENDAR_STALE_AFTER_HOURS',
  'STUCK_AFTER_HOURS',
  'MAX_CELLS_PER_DEFINITION',
  'SCHEDULER_TIMEZONE',
  'AUTO_RESUME',
  'MAX_AUTO_RESUMES',
  'MAX_WAIT_SECONDS',
  'REQUEST_TIMEOUT_SECONDS',
  'ESTIMATE_RETRY_FACTOR',
  'FX_MAX_RATE_AGE_DAYS',
  'MONTHLY_SPEND_CAP_PENCE',
  'GLOBAL_BILLING_DAY',
  'SOFT_CONFIRM_PENCE',
  'EXECUTION_MAX_CALLS',
  'EXECUTION_MAX_FREE_CALLS',
  'EXECUTION_MAX_COST_PENCE',
  'CHILD_MAX_CALLS',
  'FIXTURE_COST_MICRO_GBP',
  'TRAVELPAYOUTS_TOKEN',
  'TRAVELPAYOUTS_BILLING_DAY',
  'TRAVELPAYOUTS_MONTHLY_CALL_CAP',
  'TRAVELPAYOUTS_RATE_PER_MINUTE',
  'TRAVELPAYOUTS_RATE_PER_HOUR',
  'TRAVELPAYOUTS_CONCURRENCY',
  'TRAVELPAYOUTS_CACHE_TTL_HOURS',
  'SEARCHAPI_KEY',
  'SEARCHAPI_PLAN',
  'SEARCHAPI_TRIAL_USED',
  'SEARCHAPI_BILLING_DAY',
  'SEARCHAPI_MONTHLY_CALL_CAP',
  'SEARCHAPI_RATE_PER_MINUTE',
  'SEARCHAPI_RATE_PER_HOUR',
  'SEARCHAPI_CONCURRENCY',
  'SEARCHAPI_CACHE_TTL_HOURS',
  'SEARCHAPI_COST_PER_CALL_MICRO_GBP',
  'SEARCHAPI_PLAN_FIXED_PENCE',
  'CAMOUFOX_ENABLED',
  'CAMOUFOX_WORKER_URL',
  'CAMOUFOX_WORKER_KEY',
  'CAMOUFOX_MIN_SPACING_SECONDS',
  'CAMOUFOX_EXECUTION_PAGE_CAP',
  'CAMOUFOX_MONTHLY_PAGE_CAP',
  'CAMOUFOX_BILLING_DAY',
  'CAMOUFOX_COOLDOWN_HOURS',
  'CAMOUFOX_PAGE_TIMEOUT_SECONDS',
  'CAMOUFOX_MODE',
  'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
  'CAMOUFOX_GRID_SCROLL_CAP',
  'CAMOUFOX_EXECUTION_SCROLL_CAP',
  'CAMOUFOX_MONTHLY_SCROLL_CAP',
  'CAMOUFOX_BROWSER_WINDOW',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_TLS',
  'SMTP_USER',
  'SMTP_PASS',
  'ALERT_EMAIL_TO',
  'ALERT_EMAIL_FROM',
  'ALERT_EMAIL_MAX_PER_HOUR',
  'IN_CONTAINER',
  'ALLOW_FIXTURE_PROVIDER',
] as const;

/** A complete env map: every variable blank (= unset, spec §12), then the overrides. */
export function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ALL_VARS) env[k] = '';
  return { ...env, ...overrides };
}

/** In-memory test env with both providers configured (sentinel credentials) and fast SearchApi limits. */
export function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    BIND_ADDRESS: '127.0.0.1',
    TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
    SEARCHAPI_KEY: SENTINEL_SA,
    // why: http-kit smooths calls to ceil(60000 / ratePerMinute) ms apart (plan decision 17); the trial's 2/min and
    // Travelpayouts' 200/min would make a 26-call recording take minutes or seconds.
    SEARCHAPI_RATE_PER_MINUTE: '60000',
    SEARCHAPI_RATE_PER_HOUR: '600000',
    TRAVELPAYOUTS_RATE_PER_MINUTE: '60000',
    TRAVELPAYOUTS_RATE_PER_HOUR: '600000',
    ...extra,
  });
}

/** A development env for the tool bootstrap on a file database (the gate stays closed: no opt-in phrase). */
export function toolEnv(databasePath: string, extra: Record<string, string> = {}): Record<string, string> {
  return testEnv({ NODE_ENV: 'development', DATABASE_PATH: databasePath, LOG_LEVEL: 'error', ...extra });
}

/** A Logger that drops everything. */
export const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};
