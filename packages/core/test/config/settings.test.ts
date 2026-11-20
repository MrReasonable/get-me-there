// Plan rulings 1, 2 (UX stage 3 Settings): the names the Settings page owns, how stored rows lie over the environment,
// the page's labels and refusal words, and the money parser for amounts typed in pounds.
import { describe, expect, it } from 'vitest';
import { PLAN_PRESETS } from '../../src/config/presets.js';
import { parseBootConfig, parseConfig } from '../../src/config/schema.js';
import {
  DEFAULT_CAMOUFOX_BROWSER_WINDOW,
  DEFAULT_DISCOVERY_REFRESH_DAYS,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  DEFAULT_SEARCHAPI_BILLING_DAY,
  DEFAULT_SEARCHAPI_PLAN,
  DEFAULT_SMTP_TLS,
  EMAIL_NAMES,
  isOwnedName,
  layerSettings,
  MIN_SECRET_LENGTH,
  OWNED_NAMES,
  type OwnedName,
  ownedNameSchema,
  poundsToPence,
  SECRET_TOO_SHORT,
  SETTING_LABELS,
  SETTINGS_NAMES,
  SMTP_ALL_OR_NOTHING,
  SMTP_REQUIRED_NAMES,
  settingRefusal,
} from '../../src/config/settings.js';
import { findBannedWords } from '../../src/text/bannedWords.js';

describe('SETTINGS_NAMES (ruling 1)', () => {
  it('lists the eighteen owned names in order, the two keys and the mail password secret', () => {
    expect(SETTINGS_NAMES.map((s) => s.name)).toEqual([
      'TRAVELPAYOUTS_TOKEN',
      'SEARCHAPI_KEY',
      'SEARCHAPI_PLAN',
      'SEARCHAPI_BILLING_DAY',
      'CAMOUFOX_BROWSER_WINDOW',
      'FLIGHT_READ_PATIENCE',
      'DISCOVERY_REFRESH_DAYS',
      'NEW_SEARCH_DISCOVERY',
      'NEW_SEARCH_VERIFICATION',
      'MONTHLY_SPEND_CAP_PENCE',
      'EXECUTION_MAX_CALLS',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_TLS',
      'SMTP_USER',
      'SMTP_PASS',
      'ALERT_EMAIL_TO',
      'ALERT_EMAIL_FROM',
    ]);
    expect(SETTINGS_NAMES.filter((s) => s.secret).map((s) => s.name)).toEqual([
      'TRAVELPAYOUTS_TOKEN',
      'SEARCHAPI_KEY',
      'SMTP_PASS',
    ]);
    expect(OWNED_NAMES).toEqual(SETTINGS_NAMES.map((s) => s.name));
  });

  it('isOwnedName knows the owned names and nothing else, env-only ones included', () => {
    for (const n of OWNED_NAMES) expect(isOwnedName(n), n).toBe(true);
    for (const n of ['SEARCHAPI_TRIAL_USED', 'CAMOUFOX_ENABLED', 'DATABASE_PATH', 'searchapi_key', ''])
      expect(isOwnedName(n), n).toBe(false);
    expect(ownedNameSchema.options).toEqual(OWNED_NAMES);
  });
});

describe('the mail group (spec §8.3: all or nothing)', () => {
  it('names the six settings email needs, in the schema’s order, and every mail setting with SMTP_TLS', () => {
    expect(SMTP_REQUIRED_NAMES).toEqual([
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'ALERT_EMAIL_TO',
      'ALERT_EMAIL_FROM',
    ]);
    expect([...EMAIL_NAMES].sort()).toEqual(
      [
        'SMTP_HOST',
        'SMTP_PORT',
        'SMTP_TLS',
        'SMTP_USER',
        'SMTP_PASS',
        'ALERT_EMAIL_TO',
        'ALERT_EMAIL_FROM',
      ].sort(),
    );
  });
});

describe('layerSettings (ruling 2: one owner per name)', () => {
  const name: OwnedName = 'SEARCHAPI_PLAN';
  const other = { DATABASE_PATH: '/data/app.db' };
  it.each([
    // label, env value, stored row value (null = no row), merged value, imported, ignored
    ['no row, env set: the env line, imported', '40usd', null, '40usd', true, false],
    ['no row, env absent: nothing', undefined, null, undefined, false, false],
    ['no row, env blank: nothing (blank is unset)', '', null, '', false, false],
    ['row, env absent: the row', undefined, '40usd', '40usd', false, false],
    ['row, env the same: the row', '40usd', '40usd', '40usd', false, false],
    ['row, env different: the row, the line ignored', 'trial', '40usd', '40usd', false, true],
    ["row '', env absent: unset", undefined, '', '', false, false],
    ["row '', env blank: unset, nothing ignored", '', '', '', false, false],
    ["row '', env set: unset, the line ignored", 'trial', '', '', false, true],
    ['row, env blank: the row, nothing ignored', '', '40usd', '40usd', false, false],
  ] as const)('%s', (_label, envValue, rowValue, merged, imported, ignored) => {
    const env = { ...other, [name]: envValue };
    const rows = rowValue === null ? [] : [{ name, value: rowValue }];
    const out = layerSettings(env, rows);
    expect(out.merged[name]).toBe(merged);
    expect(out.merged.DATABASE_PATH).toBe('/data/app.db');
    expect(out.imports).toEqual(imported ? [name] : []);
    expect(out.envIgnored).toEqual(ignored ? [name] : []);
  });

  it('never changes the env it is given, and lists names in SETTINGS_NAMES order', () => {
    const env = { SMTP_HOST: 'mail.example.com', TRAVELPAYOUTS_TOKEN: 'tp', SEARCHAPI_PLAN: 'trial' };
    const out = layerSettings(env, [
      { name: 'SEARCHAPI_PLAN', value: '40usd' },
      { name: 'SMTP_HOST', value: 'smtp.example.com' },
    ]);
    expect(env).toEqual({
      SMTP_HOST: 'mail.example.com',
      TRAVELPAYOUTS_TOKEN: 'tp',
      SEARCHAPI_PLAN: 'trial',
    });
    expect(out.imports).toEqual(['TRAVELPAYOUTS_TOKEN']);
    expect(out.envIgnored).toEqual(['SEARCHAPI_PLAN', 'SMTP_HOST']);
    expect(out.merged).toEqual({
      SMTP_HOST: 'smtp.example.com',
      TRAVELPAYOUTS_TOKEN: 'tp',
      SEARCHAPI_PLAN: '40usd',
    });
  });
});

describe('the refresh defaults', () => {
  it('7 days, which is 168 hours', () => {
    expect(DEFAULT_DISCOVERY_REFRESH_DAYS).toBe(7);
    expect(DEFAULT_DISCOVERY_REFRESH_HOURS).toBe(168);
  });
});

describe('SETTING_LABELS and settingRefusal (the page and the 422 share them)', () => {
  const envName = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;
  it('gives every owned name a label without an env name or a banned word', () => {
    expect(Object.keys(SETTING_LABELS).sort()).toEqual([...OWNED_NAMES].sort());
    for (const n of OWNED_NAMES) {
      expect(SETTING_LABELS[n], n).not.toMatch(envName);
      expect(findBannedWords(SETTING_LABELS[n]), n).toEqual([]);
    }
  });

  it('the labels are the page’s words, one per name', () => {
    expect(SETTING_LABELS).toEqual({
      TRAVELPAYOUTS_TOKEN: 'Travelpayouts token',
      SEARCHAPI_KEY: 'SearchApi key',
      SEARCHAPI_PLAN: 'SearchApi plan',
      SEARCHAPI_BILLING_DAY: 'SearchApi billing day',
      CAMOUFOX_BROWSER_WINDOW: 'When the browser may run',
      FLIGHT_READ_PATIENCE: 'Reads in a row without a cheaper trip',
      DISCOVERY_REFRESH_DAYS: "Days before a date's calendar price is read again",
      NEW_SEARCH_DISCOVERY: 'Calendar sources for new searches',
      NEW_SEARCH_VERIFICATION: 'Trip check sources for new searches',
      MONTHLY_SPEND_CAP_PENCE: 'Monthly spend limit',
      EXECUTION_MAX_CALLS: 'SearchApi credits per new search',
      SMTP_HOST: 'Mail server',
      SMTP_PORT: 'Mail server port',
      SMTP_TLS: 'Mail server encryption',
      SMTP_USER: 'Mail server user name',
      SMTP_PASS: 'Mail password',
      ALERT_EMAIL_TO: 'Send alerts to',
      ALERT_EMAIL_FROM: 'Send alerts from',
    });
  });

  it('gives words for every owned name, without an env name, a banned word or the refused value', () => {
    for (const n of OWNED_NAMES) {
      const words = settingRefusal(n, { field: n, message: `${n} must be one of x; got secret-value-123` });
      expect(words, n).not.toMatch(envName);
      expect(words, n).not.toContain('secret-value-123');
      expect(words.length, n).toBeGreaterThan(10);
      expect(findBannedWords(words), n).toEqual([]);
    }
  });

  it("a value the schema refuses for each new setting comes out in that setting's own words, never its env name", () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_PATH: ':memory:',
      APP_BASIC_AUTH_USER: 'a',
      APP_BASIC_AUTH_PASS: 'correct-horse-battery',
      IN_CONTAINER: '1',
    };
    const words = (name: OwnedName, value: string): string => {
      const r = parseConfig({ ...base, [name]: value }, { realpath: (p) => p });
      if (r.ok) throw new Error('expected a refusal');
      const error = r.errors.find((e) => e.field === name);
      if (error === undefined) throw new Error('expected the refusal to name the field');
      return settingRefusal(name, error);
    };
    expect(words('FLIGHT_READ_PATIENCE', '2')).toBe('Choose a whole number of reads from 3 to 50.');
    expect(words('DISCOVERY_REFRESH_DAYS', '31')).toBe('Choose a whole number of days from 1 to 30.');
    expect(words('NEW_SEARCH_DISCOVERY', 'skyscanner')).toBe(
      'Choose calendar sources this app has set up, or none.',
    );
    expect(words('NEW_SEARCH_VERIFICATION', 'none,searchapi')).toBe(
      'Choose trip check sources this app has set up, or none.',
    );
  });

  it('a mail setting missing from a half-set group says email needs it, naming its label', () => {
    expect(settingRefusal('ALERT_EMAIL_TO', { field: 'ALERT_EMAIL_TO', message: SMTP_ALL_OR_NOTHING })).toBe(
      `Email needs ${SETTING_LABELS.ALERT_EMAIL_TO.toLowerCase()} too: fill it in, or remove email.`,
    );
    expect(settingRefusal('ALERT_EMAIL_TO', { field: 'ALERT_EMAIL_TO', message: 'not a mailbox' })).toBe(
      'Give one email address, like you@example.com.',
    );
    // why: only the schema's own all-or-nothing words read as a missing setting, never any other or an empty message
    expect(settingRefusal('ALERT_EMAIL_TO', { field: 'ALERT_EMAIL_TO', message: '' })).toBe(
      'Give one email address, like you@example.com.',
    );
  });

  it('uses credits, never searches, for SearchApi', () => {
    const all = OWNED_NAMES.flatMap((n) => [SETTING_LABELS[n], settingRefusal(n, { field: n, message: '' })]);
    expect(all.join(' ')).toContain('credits');
    expect(all.join(' ')).not.toMatch(/searches left|SearchApi searches/);
  });

  it('a secret shorter than the floor http-kit keeps is refused by the schema, in words naming its label', () => {
    expect(MIN_SECRET_LENGTH).toBe(8);
    const base = {
      NODE_ENV: 'development',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'alerts@example.com',
      ALERT_EMAIL_TO: 'operator@example.com',
      ALERT_EMAIL_FROM: 'alerts@example.com',
    };
    const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
    const long = 'x'.repeat(MIN_SECRET_LENGTH);
    const refused = parseConfig(
      { ...base, TRAVELPAYOUTS_TOKEN: short, SEARCHAPI_KEY: short, SMTP_PASS: short },
      { realpath: (p) => p },
    );
    expect(refused.ok ? [] : refused.errors).toEqual([
      { field: 'TRAVELPAYOUTS_TOKEN', message: SECRET_TOO_SHORT },
      { field: 'SEARCHAPI_KEY', message: SECRET_TOO_SHORT },
      { field: 'SMTP_PASS', message: SECRET_TOO_SHORT },
    ]);
    const kept = parseConfig(
      { ...base, TRAVELPAYOUTS_TOKEN: long, SEARCHAPI_KEY: long, SMTP_PASS: long },
      { realpath: (p) => p },
    );
    expect(kept.ok).toBe(true);
    expect(settingRefusal('SMTP_PASS', { field: 'SMTP_PASS', message: SECRET_TOO_SHORT })).toBe(
      'Mail password is too short: it needs at least 8 characters.',
    );
    expect(settingRefusal('SEARCHAPI_KEY', { field: 'SEARCHAPI_KEY', message: SECRET_TOO_SHORT })).toBe(
      'SearchApi key is too short: it needs at least 8 characters.',
    );
  });

  it('the half-set mail rule in the schema uses the message settingRefusal recognises', () => {
    const r = parseConfig(
      {
        NODE_ENV: 'development',
        DATABASE_PATH: ':memory:',
        BIND_ADDRESS: '127.0.0.1',
        SMTP_HOST: 'smtp.example.com',
      },
      { realpath: (p) => p },
    );
    expect(r.ok ? [] : r.errors.filter((e) => e.field === 'ALERT_EMAIL_TO')).toEqual([
      { field: 'ALERT_EMAIL_TO', message: SMTP_ALL_OR_NOTHING },
    ]);
  });
});

describe('poundsToPence (Global Constraints: never parseFloat)', () => {
  it.each([
    ['0.29', 29],
    ['1.15', 115],
    ['35.55', 3555],
    ['35', 3500],
    ['35.5', 3550],
    ['0', 0],
    ['007.10', 710],
  ] as const)('%s is %i pence', (text, pence) => {
    expect(poundsToPence(text)).toBe(pence);
  });

  it.each(['-1', '1.234', '£5', '', ' 5', '5 ', '1.', '.5', '1e3', '0x10', '1,000', '9'.repeat(20)])(
    'refuses %j',
    (text) => {
      expect(poundsToPence(text)).toBeNull();
    },
  );
});

describe('parseBootConfig (ruling 3)', () => {
  const base = { NODE_ENV: 'development', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };
  it('leaves every owned name out, so an owned refusal never stops the first parse', () => {
    const r = parseBootConfig(
      {
        ...base,
        SEARCHAPI_KEY: 'k'.repeat(32),
        SEARCHAPI_PLAN: 'monthly',
        SMTP_HOST: 'smtp.example.com',
        TRAVELPAYOUTS_TOKEN: 't'.repeat(32),
        MONTHLY_SPEND_CAP_PENCE: '-5',
      },
      { realpath: (p) => p },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.config.providers.searchapi).toBeNull();
    expect(r.config.providers.travelpayouts).toBeNull();
    expect(r.config.smtp).toBeNull();
    expect(r.config.spend.monthlyCapMicroGbp).toBe(0);
  });

  it('still refuses a name the page does not own', () => {
    const r = parseBootConfig({ ...base, PORT: '0' }, { realpath: (p) => p });
    expect(r.ok ? [] : r.errors.map((e) => e.field)).toEqual(['PORT']);
  });
});

describe('the defaults the Settings page shows for an unset name (Task 5 fix round 1, minor 6)', () => {
  const base = { NODE_ENV: 'development', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };
  it('are the values the schema reads when the name is unset', () => {
    const r = parseConfig({ ...base, SEARCHAPI_KEY: 'k'.repeat(32) }, { realpath: (p) => p });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect([DEFAULT_SEARCHAPI_PLAN, DEFAULT_SEARCHAPI_BILLING_DAY, DEFAULT_CAMOUFOX_BROWSER_WINDOW]).toEqual([
      'trial',
      1,
      'scheduled',
    ]);
    expect(r.config.providers.searchapi?.plan).toBe(DEFAULT_SEARCHAPI_PLAN);
    expect(r.config.providers.searchapi?.limits.billingDay).toBe(DEFAULT_SEARCHAPI_BILLING_DAY);
    expect(r.config.camoufoxBrowserWindow).toBe(DEFAULT_CAMOUFOX_BROWSER_WINDOW);
    expect(PLAN_PRESETS['40usd'].billingDay).toBe(DEFAULT_SEARCHAPI_BILLING_DAY);
  });

  it('mail encryption unset is encrypted from the start (settings plan Task 6: the email form shows it)', () => {
    const r = parseConfig(
      {
        ...base,
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_USER: 'mailer',
        SMTP_PASS: 'synthetic-pass-123',
        ALERT_EMAIL_TO: 'alerts@example.com',
        ALERT_EMAIL_FROM: 'flights@example.com',
      },
      { realpath: (p) => p },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(DEFAULT_SMTP_TLS).toBe('implicit');
    expect(r.config.smtp?.tls).toBe(DEFAULT_SMTP_TLS);
  });
});
