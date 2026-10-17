import { z } from 'zod';
import {
  PENCE_TO_MICRO,
  PLAN_PRESETS,
  type PlanId,
  type ProviderLimits,
  TRAVELPAYOUTS_DEFAULTS,
} from './presets.js';
import { Secret } from './secret.js';

/**
 * Parsed configuration. Spec §12: parsed once in the api bootstrap; empty = unset; invalid or
 * half-set config fails boot naming the field; nothing defaults to unlimited.
 */
export interface Config {
  nodeEnv: 'production' | 'development' | 'test';
  databasePath: string;
  port: number;
  bindAddress: string;
  allowedHosts: string[];
  appBaseUrl: string | null;
  auth: { user: string; pass: Secret } | null;
  allowUnauthenticated: boolean;
  trustProxy: boolean;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  pointOfSale: string;
  staleAfterHours: number;
  calendarStaleAfterHours: number | null;
  stuckAfterHours: number;
  maxCellsPerDefinition: number;
  schedulerTimezone: string;
  autoResume: boolean;
  maxAutoResumes: number;
  maxWaitSeconds: number;
  requestTimeoutSeconds: number;
  estimateRetryFactor: number;
  fxMaxRateAgeDays: number;
  spend: {
    monthlyCapMicroGbp: number;
    globalBillingDay: number;
    softConfirmMicroGbp: number;
    executionMaxCalls: number;
    executionMaxFreeCalls: number;
    executionMaxCostMicroGbp: number;
    childMaxCalls: number;
  };
  providers: {
    travelpayouts: { token: Secret; limits: ProviderLimits } | null;
    searchapi: { key: Secret; plan: PlanId; trialUsed: number; limits: ProviderLimits } | null;
    /** only outside production; the fixture provider itself is gated by syntheticAllowed */
    fixture: { costMicroGbp: number } | null;
  };
  /**
   * ALERT_EMAIL_MAX_PER_HOUR (decision 56): outgoing emails per hour (sent or in flight; a failed send does not count),
   * beyond which messages are logged and dropped.
   * Counted in process memory (a restart starts a fresh hour) and shared by digests and operator messages.
   */
  alertEmailMaxPerHour: number;
  smtp: {
    host: string;
    port: number;
    tls: 'implicit' | 'starttls' | 'none';
    user: string;
    pass: Secret;
    to: string;
    from: string;
  } | null;
  inContainer: boolean;
  allowFixtureProvider: string | null;
}

export interface ParseConfigOptions {
  /** injected so core stays pure; api passes fs.realpathSync, tolerating a missing file by resolving its directory */
  realpath: (p: string) => string;
}
export type ConfigError = { field: string; message: string };
export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: ConfigError[] };

type Env = Record<string, string | undefined>;
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;

/**
 * Spec §8.3: SMTP_TLS=none is allowed only for a loopback host, or the `mailpit` host under NODE_ENV=development. The
 * one copy of the rule: the config schema enforces it and the engine's EmailNotifier re-checks it (WP11).
 */
export function smtpPlaintextAllowed(host: string, nodeEnv: Config['nodeEnv']): boolean {
  return LOOPBACK.test(host) || (host === 'mailpit' && nodeEnv === 'development');
}

/**
 * One mailbox: an address only, so a list, a display name or a control character can never reach an email header
 * (spec §8.3). The config schema checks ALERT_EMAIL_TO/FROM with it and the engine's EmailNotifier re-checks (WP11).
 */
export function isMailbox(s: string): boolean {
  return z.email().safeParse(s).success;
}
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
const smtpTuple = z.tuple([z.string(), z.string(), z.string(), z.string(), z.string(), z.string()]);

/** Field readers: each validates one variable, records an error under its name, and returns undefined when unset. */
class Reader {
  readonly errors: ConfigError[] = [];
  constructor(private readonly env: Env) {}

  /** Empty string means unset (spec §12). */
  raw(name: string): string | undefined {
    const v = this.env[name];
    return v === undefined || v === '' ? undefined : v;
  }
  private check<T>(name: string, schema: { safeParse(v: unknown): z.ZodSafeParseResult<T> }): T | undefined {
    const v = this.raw(name);
    if (v === undefined) return undefined;
    const r = schema.safeParse(v);
    if (r.success) return r.data;
    this.errors.push({ field: name, message: r.error.issues.map((i) => i.message).join('; ') });
    return undefined;
  }
  str(name: string): string | undefined {
    return this.raw(name);
  }
  int(name: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
    return this.check(name, z.coerce.number().int().min(min).max(max));
  }
  num(name: string, min: number, max: number): number | undefined {
    return this.check(name, z.coerce.number().min(min).max(max));
  }
  bool(name: string): boolean | undefined {
    return this.check(
      name,
      z.enum(['true', 'false']).transform((v) => v === 'true'),
    );
  }
  oneOf<const T extends readonly [string, ...string[]]>(name: string, values: T): T[number] | undefined {
    return this.check(name, z.enum(values));
  }
  /** operator writes pence; code holds micro-GBP */
  pence(name: string): number | undefined {
    const v = this.int(name, 0);
    return v === undefined ? undefined : v * PENCE_TO_MICRO;
  }
  fail(field: string, message: string): void {
    this.errors.push({ field, message });
  }
  /** A variable that must be set; records the error and returns '' so parsing can continue and report every field. */
  required(name: string): string {
    const v = this.raw(name);
    if (v !== undefined) return v;
    this.fail(name, `${name} is required`);
    return '';
  }
}

/**
 * True when `tz` is an IANA zone this runtime knows. The one zone check: SCHEDULER_TIMEZONE here, a schedule's tz in
 * the engine's parseCron (spec §8.2 "tz validated") and an airport's tz in db's seed.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * APP_BASE_URL (spec §12): https, and nothing an email link must not carry or would break — no userinfo (credentials
 * in every email), no query and no fragment (the app appends its own). A path prefix is allowed (a reverse proxy).
 */
function appBaseUrlOk(raw: string): boolean {
  if (!z.url({ protocol: /^https$/ }).safeParse(raw).success) return false;
  const u = new URL(raw);
  return (
    u.username === '' &&
    u.password === '' &&
    u.search === '' &&
    u.hash === '' &&
    !raw.includes('#') &&
    !raw.includes('?')
  );
}

/** `maxCacheTtlHours` bounds the response cache for a provider whose data has a stated freshness window (Travelpayouts: 48). */
function providerLimits(
  r: Reader,
  prefix: string,
  base: ProviderLimits,
  maxCacheTtlHours?: number,
): ProviderLimits {
  return {
    ...base,
    billingDay: r.int(`${prefix}_BILLING_DAY`, 1, 28) ?? base.billingDay,
    monthlyCallCap: r.int(`${prefix}_MONTHLY_CALL_CAP`, 0) ?? base.monthlyCallCap,
    ratePerMinute: r.int(`${prefix}_RATE_PER_MINUTE`, 1) ?? base.ratePerMinute,
    ratePerHour: r.int(`${prefix}_RATE_PER_HOUR`, 1) ?? base.ratePerHour,
    concurrency: r.int(`${prefix}_CONCURRENCY`, 1) ?? base.concurrency,
    cacheTtlHours: r.int(`${prefix}_CACHE_TTL_HOURS`, 0, maxCacheTtlHours) ?? base.cacheTtlHours,
  };
}

/** Spec §12. Returns every bad field at once rather than the first. */
/**
 * The refusal an operator who skipped docs/setup.md section 1 reads in `docker compose logs` (devops-final-001): the
 * exact two lines to add to .env. bootApp's assertAuthInvariants says the same.
 */
export const AUTH_MISSING =
  'add two lines to .env: APP_BASIC_AUTH_USER=<a user name> and APP_BASIC_AUTH_PASS=<a password of at least 12 characters> (docs/setup.md section 1)';

export function parseConfig(env: Env, opts: ParseConfigOptions): ConfigResult {
  const r = new Reader(env);
  const nodeEnv = r.oneOf('NODE_ENV', ['production', 'development', 'test']) ?? 'production';
  const databasePathRaw = r.required('DATABASE_PATH');
  const port = r.int('PORT', 1, 65535) ?? 3000;
  const bindAddress = r.str('BIND_ADDRESS') ?? '0.0.0.0';
  const allowedHostsRaw = r.str('ALLOWED_HOSTS');
  const allowedHosts = allowedHostsRaw
    ? allowedHostsRaw
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h.length > 0)
    : [`localhost:${port}`, `127.0.0.1:${port}`, ...(nodeEnv === 'development' ? ['localhost:5173'] : [])];
  const appBaseUrl = r.str('APP_BASE_URL') ?? null;
  if (appBaseUrl !== null && !appBaseUrlOk(appBaseUrl)) {
    r.fail('APP_BASE_URL', 'APP_BASE_URL must be an https URL with no user, password, query or fragment');
  }

  // auth: both or neither; password ≥ 12 (spec §4)
  const authUser = r.str('APP_BASIC_AUTH_USER');
  const authPass = r.str('APP_BASIC_AUTH_PASS');
  let auth: Config['auth'] = null;
  if ((authUser === undefined) !== (authPass === undefined)) {
    r.fail(
      authUser === undefined ? 'APP_BASIC_AUTH_USER' : 'APP_BASIC_AUTH_PASS',
      'APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASS must both be set or both be empty',
    );
  } else if (authUser !== undefined && authPass !== undefined) {
    if (authPass.length < 12) r.fail('APP_BASIC_AUTH_PASS', 'password must be at least 12 characters');
    else auth = { user: authUser, pass: new Secret(authPass) };
  }
  const allowUnauthenticated = r.bool('ALLOW_UNAUTHENTICATED') ?? false;
  if (auth === null && authUser === undefined && !LOOPBACK.test(bindAddress) && !allowUnauthenticated) {
    // why: devops-final-001 (ruling 14): the fix is the two auth lines, so they lead. In the container BIND_ADDRESS is
    // fixed by docker-compose.yml and ALLOW_UNAUTHENTICATED is not forwarded, so neither is named as the thing to edit.
    const container = r.raw('IN_CONTAINER') !== undefined;
    r.fail('APP_BASIC_AUTH_USER', AUTH_MISSING);
    if (!container)
      r.fail(
        'BIND_ADDRESS',
        `binding ${bindAddress} without auth needs ALLOW_UNAUTHENTICATED=true (Tailscale-only hosts)`,
      );
    r.fail(
      'ALLOW_UNAUTHENTICATED',
      container
        ? 'not an option here: docker-compose.yml does not forward it, so add the two auth lines instead'
        : 'set to true only on a host that is not reachable from the internet',
    );
  }

  const pointOfSale = r.str('POINT_OF_SALE') ?? 'GB';
  if (!/^[A-Z]{2}$/.test(pointOfSale))
    r.fail('POINT_OF_SALE', 'POINT_OF_SALE must be an ISO 3166-1 alpha-2 code');
  const schedulerTimezone = r.str('SCHEDULER_TIMEZONE') ?? 'Europe/London';
  if (!isValidTimeZone(schedulerTimezone))
    r.fail('SCHEDULER_TIMEZONE', `unknown IANA time zone: ${schedulerTimezone}`);

  // providers
  const tpToken = r.str('TRAVELPAYOUTS_TOKEN');
  const travelpayouts =
    tpToken === undefined
      ? null
      : {
          token: new Secret(tpToken),
          limits: providerLimits(r, 'TRAVELPAYOUTS', TRAVELPAYOUTS_DEFAULTS, 48),
        };
  const saKey = r.str('SEARCHAPI_KEY');
  const plan: PlanId = r.oneOf('SEARCHAPI_PLAN', ['trial', '40usd']) ?? 'trial';
  const preset = PLAN_PRESETS[plan];
  const searchapi =
    saKey === undefined
      ? null
      : {
          key: new Secret(saKey),
          plan,
          trialUsed: r.int('SEARCHAPI_TRIAL_USED', 0) ?? 0,
          limits: {
            ...providerLimits(r, 'SEARCHAPI', preset),
            costPerCallMicroGbp: r.int('SEARCHAPI_COST_PER_CALL_MICRO_GBP', 0) ?? preset.costPerCallMicroGbp,
            planFixedMicroGbp: r.pence('SEARCHAPI_PLAN_FIXED_PENCE') ?? preset.planFixedMicroGbp,
          },
        };
  // why: cost-007: the trial count is zeroed on a monthly window (db budgetConfig), so a value left in .env after a
  // switch to the subscription would be silently ignored; spec §12: a variable that cannot apply fails boot, named.
  if (searchapi !== null && searchapi.limits.window === 'month' && searchapi.trialUsed > 0)
    r.fail(
      'SEARCHAPI_TRIAL_USED',
      `applies only to the trial's lifetime window; SEARCHAPI_PLAN=${plan} counts a monthly window, so remove SEARCHAPI_TRIAL_USED or set it to 0`,
    );
  const billedPreset = searchapi === null ? null : preset;
  // why: the fixture provider is never configured in production; its cost is only read where syntheticAllowed can be true.
  const fixture = nodeEnv === 'production' ? null : { costMicroGbp: r.int('FIXTURE_COST_MICRO_GBP', 0) ?? 0 };

  // smtp: all or nothing (spec §8.3)
  const smtpNames = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'ALERT_EMAIL_TO',
    'ALERT_EMAIL_FROM',
  ] as const;
  const smtpValues = smtpNames.map((n) => r.raw(n));
  const smtpSetCount = smtpValues.filter((v) => v !== undefined).length;
  let smtp: Config['smtp'] = null;
  if (smtpSetCount > 0 && smtpSetCount < smtpNames.length) {
    smtpNames.forEach((n, i) => {
      if (smtpValues[i] === undefined) r.fail(n, 'SMTP settings are all or nothing');
    });
  } else if (smtpSetCount === smtpNames.length) {
    // why: every value is known set here; the tuple parse gives typed strings without defaulted branches.
    const [host, , user, pass, to, from] = smtpTuple.parse(smtpValues);
    const smtpPort = r.int('SMTP_PORT', 1, 65535);
    const tls = r.oneOf('SMTP_TLS', ['implicit', 'starttls', 'none']) ?? 'implicit';
    if (!isMailbox(to))
      r.fail(
        'ALERT_EMAIL_TO',
        'ALERT_EMAIL_TO must be one email address (no display name, list or control character)',
      );
    if (!isMailbox(from))
      r.fail(
        'ALERT_EMAIL_FROM',
        'ALERT_EMAIL_FROM must be one email address (no display name, list or control character)',
      );
    if (tls === 'none' && !smtpPlaintextAllowed(host, nodeEnv)) {
      r.fail(
        'SMTP_TLS',
        'SMTP_TLS=none is allowed only for a loopback host or the mailpit host under NODE_ENV=development',
      );
    }
    if (smtpPort !== undefined) smtp = { host, port: smtpPort, tls, user, pass: new Secret(pass), to, from };
  }

  const spend: Config['spend'] = {
    monthlyCapMicroGbp: r.pence('MONTHLY_SPEND_CAP_PENCE') ?? billedPreset?.monthlySpendCapMicroGbp ?? 0,
    globalBillingDay: r.int('GLOBAL_BILLING_DAY', 1, 28) ?? 1,
    softConfirmMicroGbp: r.pence('SOFT_CONFIRM_PENCE') ?? 100 * PENCE_TO_MICRO,
    executionMaxCalls: r.int('EXECUTION_MAX_CALLS', 0) ?? billedPreset?.executionMaxCalls ?? 0,
    executionMaxFreeCalls: r.int('EXECUTION_MAX_FREE_CALLS', 0) ?? 2000,
    executionMaxCostMicroGbp:
      r.pence('EXECUTION_MAX_COST_PENCE') ?? billedPreset?.executionMaxCostMicroGbp ?? 0,
    childMaxCalls: r.int('CHILD_MAX_CALLS', 0) ?? 6,
  };

  const logLevel = r.oneOf('LOG_LEVEL', LOG_LEVELS) ?? 'info';
  const staleAfterHours = r.int('STALE_AFTER_HOURS', 1) ?? 192;
  const alertEmailMaxPerHour = r.int('ALERT_EMAIL_MAX_PER_HOUR', 1) ?? 20;
  const calendarStaleAfterHours = r.int('CALENDAR_STALE_AFTER_HOURS', 1) ?? null;
  const stuckAfterHours = r.int('STUCK_AFTER_HOURS', 1) ?? 12;
  const maxCellsPerDefinition = r.int('MAX_CELLS_PER_DEFINITION', 1) ?? 50_000;
  const autoResume = r.bool('AUTO_RESUME') ?? true;
  const maxAutoResumes = r.int('MAX_AUTO_RESUMES', 0) ?? 3;
  const maxWaitSeconds = r.int('MAX_WAIT_SECONDS', 1) ?? 3900;
  const requestTimeoutSeconds = r.int('REQUEST_TIMEOUT_SECONDS', 1) ?? 60;
  const estimateRetryFactor = r.num('ESTIMATE_RETRY_FACTOR', 1, 5) ?? 1.2;
  const fxMaxRateAgeDays = r.int('FX_MAX_RATE_AGE_DAYS', 1) ?? 3;
  const trustProxy = r.bool('TRUST_PROXY') ?? false;
  const inContainer = r.raw('IN_CONTAINER') !== undefined;
  const allowFixtureProvider = r.str('ALLOW_FIXTURE_PROVIDER') ?? null;

  if (r.errors.length > 0) return { ok: false, errors: r.errors };
  const databasePath = databasePathRaw === ':memory:' ? ':memory:' : opts.realpath(databasePathRaw);
  return {
    ok: true,
    config: {
      nodeEnv,
      databasePath,
      port,
      bindAddress,
      allowedHosts,
      appBaseUrl,
      auth,
      allowUnauthenticated,
      trustProxy,
      logLevel,
      pointOfSale,
      staleAfterHours,
      calendarStaleAfterHours,
      stuckAfterHours,
      maxCellsPerDefinition,
      schedulerTimezone,
      autoResume,
      maxAutoResumes,
      maxWaitSeconds,
      requestTimeoutSeconds,
      estimateRetryFactor,
      fxMaxRateAgeDays,
      spend,
      providers: { travelpayouts, searchapi, fixture },
      alertEmailMaxPerHour,
      smtp,
      inContainer,
      allowFixtureProvider,
    },
  };
}
