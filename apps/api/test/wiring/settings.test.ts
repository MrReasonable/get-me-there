// Settings plan rulings 2–4: the stored settings lie over the environment under the lock. A name with no row is
// imported from its env line once the parse succeeds; a row owns its name from then on, and an env line that differs is
// reported, never applied; a value the schema refuses is set aside for the boot (the default used instead) and never
// imported; a refusal of a name the page does not own still fails, as before.
import { type Config, fixedClock, Secret, type SettingRow } from '@gmt/core';
import { type Db, MIGRATIONS_DIR, SettingsRepo } from '@gmt/db';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectSecrets,
  InvalidConfigError,
  loadBootConfig,
  loadConfig,
  loadConfigFromEnv,
  openDatabase,
} from '../../src/wiring.js';
import { cleanEnv, SENTINEL_SA, SENTINEL_SMTP, SENTINEL_TP } from '../helpers/env.js';
import { T0 } from '../helpers/harness.js';

const opened: Db[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});
function migrated(): Db {
  const db = openDatabase(':memory:', MIGRATIONS_DIR);
  opened.push(db);
  return db;
}

const EMAIL = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_TLS: 'implicit',
  SMTP_USER: 'alerts@example.com',
  SMTP_PASS: SENTINEL_SMTP,
  ALERT_EMAIL_TO: 'operator@example.com',
  ALERT_EMAIL_FROM: 'alerts@example.com',
};

function envWith(extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'development',
    DATABASE_PATH: ':memory:',
    BIND_ADDRESS: '127.0.0.1',
    LOG_LEVEL: 'error',
    ...extra,
  });
}

const clock = fixedClock(T0);
const rowsOf = (db: Db): SettingRow[] => new SettingsRepo(db).all();
/** The revealed value of every secret a config holds, so two configs' secrets can be compared. */
const revealed = (c: Config) => collectSecrets(c).map((s) => s.reveal());

describe('loadConfig (settings plan ruling 3)', () => {
  it('an env-only first boot gives the env-only config and imports every owned line it sets, names only reported', () => {
    const env = envWith({
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
      MONTHLY_SPEND_CAP_PENCE: '3500',
      ...EMAIL,
    });
    const db = migrated();
    const loaded = loadConfig(env, db, { clock, writeImports: true });
    expect(loaded.config).toEqual(loadConfigFromEnv(env));
    expect(revealed(loaded.config)).toEqual(revealed(loadConfigFromEnv(env)));
    expect(loaded.imported).toEqual([
      'TRAVELPAYOUTS_TOKEN',
      'SEARCHAPI_KEY',
      'SEARCHAPI_PLAN',
      'MONTHLY_SPEND_CAP_PENCE',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_TLS',
      'SMTP_USER',
      'SMTP_PASS',
      'ALERT_EMAIL_TO',
      'ALERT_EMAIL_FROM',
    ]);
    expect(loaded.envIgnored).toEqual([]);
    expect(loaded.setAside).toEqual([]);
    expect(rowsOf(db)).toEqual(
      loaded.imported
        .map((name) => ({ name, value: env[name] }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    expect(db.raw.prepare('SELECT DISTINCT updated_at AS at FROM settings').all()).toEqual([{ at: T0 }]);
  });

  it('an env with no owned line imports nothing and gives the env-only config', () => {
    const env = envWith();
    const db = migrated();
    const loaded = loadConfig(env, db, { clock, writeImports: true });
    expect(loaded.config).toEqual(loadConfigFromEnv(env));
    expect(loaded).toMatchObject({ imported: [], envIgnored: [], setAside: [], warnings: [] });
    expect(rowsOf(db)).toEqual([]);
  });

  it('after the import the table owns the name: a changed env line is reported and not applied', () => {
    const db = migrated();
    loadConfig(envWith({ SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd' }), db, {
      clock,
      writeImports: true,
    });
    const again = loadConfig(
      envWith({ SEARCHAPI_KEY: 'another-key-0123456789', SEARCHAPI_PLAN: '40usd' }),
      db,
      {
        clock,
        writeImports: true,
      },
    );
    expect(again.imported).toEqual([]);
    expect(again.envIgnored).toEqual(['SEARCHAPI_KEY']);
    expect(again.config.providers.searchapi?.key.reveal()).toBe(SENTINEL_SA);
    expect(rowsOf(db)).toContainEqual({ name: 'SEARCHAPI_KEY', value: SENTINEL_SA });
  });

  it("a row of '' keeps its name unset whatever the env says", () => {
    const db = migrated();
    new SettingsRepo(db).write([{ name: 'TRAVELPAYOUTS_TOKEN', value: '' }], T0);
    const loaded = loadConfig(envWith({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP }), db, {
      clock,
      writeImports: true,
    });
    expect(loaded.config.providers.travelpayouts).toBeNull();
    expect(loaded.envIgnored).toEqual(['TRAVELPAYOUTS_TOKEN']);
    expect(loaded.imported).toEqual([]);
  });

  it('an imported value the schema refuses is set aside for this boot, not written, and the rest still import', () => {
    const db = migrated();
    const loaded = loadConfig(envWith({ SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: 'monthly' }), db, {
      clock,
      writeImports: true,
    });
    expect(loaded.setAside).toEqual(['SEARCHAPI_PLAN']);
    expect(loaded.imported).toEqual(['SEARCHAPI_KEY']);
    expect(loaded.config.providers.searchapi?.plan).toBe('trial');
    expect(rowsOf(db)).toEqual([{ name: 'SEARCHAPI_KEY', value: SENTINEL_SA }]);
  });

  it('a stored value refused after a bound change is set aside and reported, and its row is left as it was', () => {
    const db = migrated();
    // why: a row an earlier version accepted that this one's bound (1–28) refuses
    db.raw
      .prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)')
      .run('SEARCHAPI_BILLING_DAY', '31', T0);
    const loaded = loadConfig(envWith({ SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd' }), db, {
      clock,
      writeImports: true,
    });
    expect(loaded.setAside).toEqual(['SEARCHAPI_BILLING_DAY']);
    expect(loaded.config.providers.searchapi?.limits.billingDay).toBe(1);
    expect(rowsOf(db)).toContainEqual({ name: 'SEARCHAPI_BILLING_DAY', value: '31' });
  });

  it.each([
    ['FLIGHT_READ_PATIENCE', '2', (c: Config) => c.flightReadPatience, 12],
    ['FLIGHT_READ_PATIENCE', '51', (c: Config) => c.flightReadPatience, 12],
    ['DISCOVERY_REFRESH_DAYS', '0', (c: Config) => c.discoveryRefreshDays, 7],
    ['DISCOVERY_REFRESH_DAYS', '31', (c: Config) => c.discoveryRefreshDays, 7],
    ['NEW_SEARCH_DISCOVERY', 'travelpayouts,skyscanner', (c: Config) => c.newSearchSources.discovery, null],
    ['NEW_SEARCH_VERIFICATION', 'none,searchapi', (c: Config) => c.newSearchSources.verification, null],
  ])(
    'a stored %s of %s is set aside, the default used, boot continues, the row kept',
    (name, value, read, dflt) => {
      const db = migrated();
      db.raw.prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)').run(name, value, T0);
      const loaded = loadConfig(envWith(), db, { clock, writeImports: true });
      expect(loaded.setAside).toEqual([name]);
      expect(read(loaded.config)).toEqual(dflt);
      expect(rowsOf(db)).toContainEqual({ name, value });
    },
  );

  it('a stored mail value refused turns email off for the boot (all or nothing), naming only the refused name', () => {
    const db = migrated();
    new SettingsRepo(db).write(
      Object.entries({ ...EMAIL, ALERT_EMAIL_TO: 'Operator <operator@example.com>' }).flatMap(
        ([name, value]) => (name === 'SMTP_HOST' || name === 'ALERT_EMAIL_TO' ? [{ name, value }] : []),
      ),
      T0,
    );
    const loaded = loadConfig(envWith(EMAIL), db, { clock, writeImports: true });
    expect(loaded.setAside).toEqual(['ALERT_EMAIL_TO']);
    expect(loaded.config.smtp).toBeNull();
    // why: email is all or nothing, so none of its env lines is imported while one of its values is set aside
    expect(loaded.imported).toEqual([]);
    expect(rowsOf(db).map((r) => r.name)).toEqual(['ALERT_EMAIL_TO', 'SMTP_HOST']);
  });

  it('a refusal of a name the page does not own fails as before, naming every field and no value', () => {
    const db = migrated();
    const load = () =>
      loadConfig(envWith({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP, TRAVELPAYOUTS_CACHE_TTL_HOURS: '99' }), db, {
        clock,
        writeImports: true,
      });
    expect(load).toThrow(InvalidConfigError);
    expect(load).toThrow(/TRAVELPAYOUTS_CACHE_TTL_HOURS/);
    expect(load).not.toThrow(new RegExp(SENTINEL_TP));
    expect(rowsOf(db)).toEqual([]);
  });

  it('with writeImports false (the tool bootstrap) it layers the same config and writes nothing', () => {
    const env = envWith({ SEARCHAPI_KEY: SENTINEL_SA });
    const db = migrated();
    const loaded = loadConfig(env, db, { clock, writeImports: false });
    expect(loaded.imported).toEqual([]);
    expect(loaded.config).toEqual(loadConfigFromEnv(env));
    expect(rowsOf(db)).toEqual([]);
  });

  it('SEARCHAPI_TRIAL_USED above 0 on a stored 40usd plan is ignored with the warning, not a refusal', () => {
    const db = migrated();
    new SettingsRepo(db).write([{ name: 'SEARCHAPI_PLAN', value: '40usd' }], T0);
    const loaded = loadConfig(
      envWith({ SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: 'trial', SEARCHAPI_TRIAL_USED: '5' }),
      db,
      { clock, writeImports: true },
    );
    expect(loaded.config.providers.searchapi).toMatchObject({ plan: '40usd', trialUsed: 0 });
    expect(loaded.warnings).toEqual([
      { field: 'SEARCHAPI_TRIAL_USED', message: expect.stringContaining('SEARCHAPI_PLAN=40usd') },
    ]);
  });
});

describe('loadBootConfig (ruling 3: the first parse leaves the owned names out)', () => {
  it('parses what the environment alone fixes, whatever an owned line holds', () => {
    const config = loadBootConfig(
      envWith({ SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: 'monthly', ...EMAIL }),
    );
    expect(config.providers.searchapi).toBeNull();
    expect(config.smtp).toBeNull();
    expect(revealed(config)).toEqual([]);
  });

  it('still refuses a name the page does not own', () => {
    expect(() => loadBootConfig(envWith({ PORT: '0' }))).toThrow(/PORT/);
  });
});

describe('collectSecrets (Global Constraints: every stored secret joins the boot’s list)', () => {
  it('adds each stored secret, even one the config does not use, once, and never a plain setting', () => {
    const config = loadConfigFromEnv(envWith({ SEARCHAPI_KEY: SENTINEL_SA }));
    const secrets = collectSecrets(config, [
      { name: 'SEARCHAPI_KEY', value: SENTINEL_SA },
      { name: 'SMTP_PASS', value: SENTINEL_SMTP },
      { name: 'TRAVELPAYOUTS_TOKEN', value: '' },
      { name: 'SMTP_USER', value: 'alerts@example.com' },
    ]);
    expect(secrets.map((s) => s.reveal())).toEqual([SENTINEL_SA, SENTINEL_SMTP]);
    expect(secrets.every((s) => s instanceof Secret)).toBe(true);
  });
});
