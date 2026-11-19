// Settings plan rulings 2–4 at boot: both bootstraps parse the environment without the owned names, refuse and migrate
// as before, then lay the stored settings over the environment under the lock. A first boot imports the owned lines and
// logs their names only; a value the schema refuses is set aside and the app still boots; an env line the table owns is
// reported, never applied; the refusals still come before any migration or import; the tool bootstrap writes nothing.
import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BudgetExceeded,
  fixedClock,
  MOVED_MARKER,
  PENCE_TO_MICRO,
  type Secret,
  type SettingRow,
} from '@gmt/core';
import {
  AppLock,
  applyMigrations,
  MIGRATIONS_DIR,
  openDatabase,
  pendingMigrations,
  SettingsRepo,
} from '@gmt/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bootApp, type RunningApp } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { EXIT, runTool } from '../../src/bootstrap/tool.js';
import { createLogger } from '../../src/logger.js';
import { loadBootConfig } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_SA, SENTINEL_SMTP, SENTINEL_TP, silentLog, toolEnv } from '../helpers/env.js';
import { captureLines, T0 } from '../helpers/harness.js';
import { testRecording } from '../helpers/recording.js';
import { fileTempDir, tempDir } from '../helpers/tmp.js';

/** Each boot reads the full airports table; a loaded runner may take longer than the default 5 s. */
const BOOT_TIMEOUT_MS = 30_000;

const EMAIL = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_TLS: 'implicit',
  SMTP_USER: 'alerts@example.com',
  SMTP_PASS: SENTINEL_SMTP,
  ALERT_EMAIL_TO: 'operator@example.com',
  ALERT_EMAIL_FROM: 'alerts@example.com',
};

function devEnv(dbPath: string, extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'development',
    DATABASE_PATH: dbPath,
    BIND_ADDRESS: '127.0.0.1',
    LOG_LEVEL: 'info',
    ...extra,
  });
}

/**
 * A database migrated and seeded once for this file; each test boots its own copy (app.shutdown.test.ts's pattern),
 * so a test waits on its own boot, not on seeding the airports table.
 */
let template = '';
beforeAll(async () => {
  template = join(fileTempDir('gmt-settings-seed-'), 'seed.db');
  const env = devEnv(template);
  const running = await bootApp({
    config: loadBootConfig(env),
    env,
    clock: fixedClock(T0),
    log: silentLog,
    listen: false,
    assets: assetPaths(),
  });
  await running.close();
}, BOOT_TIMEOUT_MS);

function seededDb(rows: readonly SettingRow[] = []): string {
  const dbPath = join(tempDir('gmt-settings-'), 's.db');
  copyFileSync(template, dbPath);
  if (rows.length > 0) {
    const db = openDatabase(dbPath);
    // why: rows as an earlier save left them, some of which this version may refuse; written raw, past the repository
    const put = db.raw.prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)');
    for (const r of rows) put.run(r.name, r.value, T0);
    db.close();
  }
  return dbPath;
}

function storedRows(dbPath: string): SettingRow[] {
  const db = openDatabase(dbPath);
  try {
    return new SettingsRepo(db).all();
  } finally {
    db.close();
  }
}

const record = z.looseObject({ msg: z.string(), level: z.number() });
const recordsOf = (lines: string[]) => lines.map((l) => record.parse(JSON.parse(l)));

async function boot(
  env: Record<string, string>,
  lines: string[] = [],
  logSecrets: Secret[] = [],
): Promise<RunningApp> {
  return bootApp({
    config: loadBootConfig(env),
    env,
    log: createLogger({ logLevel: 'info' }, { destination: captureLines(lines), secrets: logSecrets }),
    logSecrets,
    clock: fixedClock(T0),
    listen: false,
    assets: assetPaths(),
  });
}

describe('the app boot lays the stored settings over the environment (settings plan ruling 3)', {
  timeout: BOOT_TIMEOUT_MS,
}, () => {
  it('a first boot imports the owned lines, logs their names only, and every stored secret joins the scrub list', async () => {
    const dbPath = seededDb();
    const lines: string[] = [];
    const scrub: Secret[] = [];
    const running = await boot(
      devEnv(dbPath, { TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SEARCHAPI_KEY: SENTINEL_SA, ...EMAIL }),
      lines,
      scrub,
    );
    const imported = [
      'TRAVELPAYOUTS_TOKEN',
      'SEARCHAPI_KEY',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_TLS',
      'SMTP_USER',
      'SMTP_PASS',
      'ALERT_EMAIL_TO',
      'ALERT_EMAIL_FROM',
    ];
    try {
      expect(running.ports.settingsReport).toEqual({ imported, envIgnored: [], setAside: [] });
      expect(running.ports.config.smtp?.pass.reveal()).toBe(SENTINEL_SMTP);
      expect(running.ports.secrets.map((s) => s.reveal())).toEqual(
        expect.arrayContaining([SENTINEL_TP, SENTINEL_SA, SENTINEL_SMTP]),
      );
      // why: a line logged after boot that carries a stored secret reaches the sink scrubbed
      running.ports.log.info({ detail: `refused ${SENTINEL_SMTP}` }, 'probe');
    } finally {
      await running.close();
    }
    expect(storedRows(dbPath).map((r) => r.name)).toEqual([...imported].sort());
    const line = recordsOf(lines).find((r) => r.msg === 'settings imported from the environment');
    expect(line).toMatchObject({ names: imported });
    const all = lines.join('');
    for (const s of [SENTINEL_TP, SENTINEL_SA, SENTINEL_SMTP]) expect(all).not.toContain(s);
    expect(all).toContain('"msg":"probe"');
  });

  it('an imported value the schema refuses is set aside and not written; the app boots and logs its name', async () => {
    const dbPath = seededDb();
    const lines: string[] = [];
    const running = await boot(
      devEnv(dbPath, { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: 'monthly' }),
      lines,
    );
    try {
      expect(running.ports.settingsReport).toEqual({
        imported: ['SEARCHAPI_KEY'],
        envIgnored: [],
        setAside: ['SEARCHAPI_PLAN'],
      });
      expect(running.ports.config.providers.searchapi?.plan).toBe('trial');
    } finally {
      await running.close();
    }
    expect(storedRows(dbPath)).toEqual([{ name: 'SEARCHAPI_KEY', value: SENTINEL_SA }]);
    expect(recordsOf(lines).find((r) => r.msg === 'stored settings set aside for this boot')).toMatchObject({
      names: ['SEARCHAPI_PLAN'],
      level: 40,
    });
  });

  it('a stored value refused after a bound change is set aside and reported; its row stays for Settings to fix', async () => {
    // why: 2899 is out of the 1–28 bound and distinctive, so its absence from the log means something
    const dbPath = seededDb([{ name: 'SEARCHAPI_BILLING_DAY', value: '2899' }]);
    const lines: string[] = [];
    const running = await boot(
      devEnv(dbPath, { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd' }),
      lines,
    );
    try {
      expect(running.ports.settingsReport.setAside).toEqual(['SEARCHAPI_BILLING_DAY']);
      expect(running.ports.config.providers.searchapi?.limits.billingDay).toBe(1);
    } finally {
      await running.close();
    }
    expect(storedRows(dbPath)).toContainEqual({ name: 'SEARCHAPI_BILLING_DAY', value: '2899' });
    const setAside = recordsOf(lines).filter((r) => r.msg === 'stored settings set aside for this boot');
    // why: the line carries the names and pino's own fields, nothing else, so no value can ride along
    expect(setAside.map(({ level, time, pid, hostname, msg, ...rest }) => rest)).toEqual([
      { names: ['SEARCHAPI_BILLING_DAY'] },
    ]);
    expect(lines.join('')).not.toContain('2899');
  });

  it('an env line that differs from a stored row is reported once, not applied', async () => {
    const dbPath = seededDb([
      { name: 'SEARCHAPI_KEY', value: SENTINEL_SA },
      { name: 'SEARCHAPI_PLAN', value: '40usd' },
    ]);
    const lines: string[] = [];
    const running = await boot(
      devEnv(dbPath, { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: 'trial' }),
      lines,
    );
    try {
      expect(running.ports.settingsReport).toEqual({
        imported: [],
        envIgnored: ['SEARCHAPI_PLAN'],
        setAside: [],
      });
      expect(running.ports.config.providers.searchapi?.plan).toBe('40usd');
    } finally {
      await running.close();
    }
    const ignored = recordsOf(lines).filter(
      (r) => r.msg === 'lines in .env ignored: Settings holds these names',
    );
    expect(ignored).toEqual([expect.objectContaining({ names: ['SEARCHAPI_PLAN'], level: 40 })]);
  });

  it('SEARCHAPI_TRIAL_USED=5 on the 40usd plan boots with the warning', async () => {
    const lines: string[] = [];
    const running = await boot(
      devEnv(seededDb(), { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: '40usd', SEARCHAPI_TRIAL_USED: '5' }),
      lines,
    );
    try {
      expect(running.ports.config.providers.searchapi?.trialUsed).toBe(0);
    } finally {
      await running.close();
    }
    expect(recordsOf(lines)).toContainEqual(
      expect.objectContaining({
        level: 40,
        field: 'SEARCHAPI_TRIAL_USED',
        msg: "applies only to the trial's lifetime window; SEARCHAPI_PLAN=40usd counts a monthly window, so remove SEARCHAPI_TRIAL_USED or set it to 0",
      }),
    );
  });
});

/** A copy of the migrations without 0014, so a database made with it has the settings table still to come. */
function migrationsBefore0014(): string {
  const dir = join(tempDir('gmt-settings-mig-'), 'drizzle');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  rmSync(join(dir, '0014_settings.sql'));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = z
    .object({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .loose()
    .parse(JSON.parse(readFileSync(journalPath, 'utf8')));
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.tag !== '0014_settings') }),
  );
  return dir;
}

describe('the refusals still come before any migration or import (settings plan ruling 3)', {
  timeout: BOOT_TIMEOUT_MS,
}, () => {
  const owned = { SEARCHAPI_KEY: SENTINEL_SA, TRAVELPAYOUTS_TOKEN: SENTINEL_TP };

  it('NODE_ENV=test refuses with 70 and never creates the database', async () => {
    const dbPath = join(tempDir('gmt-settings-'), 'new.db');
    await expect(boot(devEnv(dbPath, { ...owned, NODE_ENV: 'test' }))).rejects.toMatchObject({
      exitCode: EXIT.refusedTestEnv,
    });
    expect(existsSync(dbPath)).toBe(false);
  });

  it.each([
    ['a database moved to a native install refuses with 78', 'moved', EXIT.badConfig],
    ['a live app lock refuses with 75', 'locked', EXIT.lockRefused],
  ] as const)('%s, the settings table still to come', async (_label, cause, exitCode) => {
    const dir = tempDir('gmt-settings-');
    const dbPath = join(dir, 'old.db');
    const db = openDatabase(dbPath);
    applyMigrations(db, migrationsBefore0014());
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual(['0014_settings']);
    const clock = fixedClock(T0);
    const holder = new AppLock(db, 'app', clock, silentLog);
    if (cause === 'moved') writeFileSync(join(dir, MOVED_MARKER), '2027-03-01T09:30:00.000Z\n');
    else expect(holder.acquire({ waitMs: 0 })).toBe('acquired');
    try {
      const env = devEnv(dbPath, owned);
      await expect(
        bootApp({
          config: loadBootConfig(env),
          env,
          log: silentLog,
          clock,
          listen: false,
          assets: assetPaths(),
          // why: the other app keeps heartbeating while this one waits on the shared clock
          sleep: async (ms) => {
            clock.advance(ms);
            holder.heartbeat();
          },
        }),
      ).rejects.toMatchObject({ exitCode });
      expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual(['0014_settings']);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'settings'").get()).toEqual(
        {
          n: 0,
        },
      );
    } finally {
      holder.release();
      db.close();
    }
  });
});

describe('what is checked only once the stored settings are read comes after the backup and the migrations (ruling 3)', {
  timeout: BOOT_TIMEOUT_MS,
}, () => {
  /** A database one migration behind (0014 to come), so a boot or a tool run backs it up and migrates it first. */
  function behind(): { dir: string; dbPath: string } {
    const dir = tempDir('gmt-settings-');
    const dbPath = join(dir, 'old.db');
    const db = openDatabase(dbPath);
    applyMigrations(db, migrationsBefore0014());
    db.close();
    return { dir, dbPath };
  }
  function state(dbPath: string) {
    const db = openDatabase(dbPath);
    try {
      return {
        pending: pendingMigrations(db, MIGRATIONS_DIR),
        rows: db.raw.prepare('SELECT COUNT(*) AS n FROM settings').get(),
      };
    } finally {
      db.close();
    }
  }

  it('a record run without a key: backed up, migrated, then refused with 78 naming both places a key lives', async () => {
    const { dir, dbPath } = behind();
    const out: string[] = [];
    const errors: string[] = [];
    const code = await runTool(
      'record',
      ['--budget', '5', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03', '--dry-run'],
      {
        env: toolEnv(dbPath, { SEARCHAPI_KEY: '' }),
        out: (l) => out.push(l),
        err: (l) => errors.push(l),
        recording: testRecording().recording,
      },
    );
    expect(code).toBe(EXIT.badConfig);
    expect(errors).toEqual([
      'record:fixtures needs TRAVELPAYOUTS_TOKEN and SEARCHAPI_KEY, set in Settings or .env',
    ]);
    expect(out.slice(0, 3)).toEqual([
      expect.stringMatching(/^backup before 1 migration\(s\)/),
      `database: ${dbPath}`,
      'tool lock acquired',
    ]);
    expect(out.at(-1)).toBe('tool lock released');
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
    expect(state(dbPath)).toEqual({ pending: [], rows: { n: 0 } });
  });

  it('a bad variable read only when a key is set fails the app boot with 78 after the migrations, importing nothing', async () => {
    const { dir, dbPath } = behind();
    const env = devEnv(dbPath, { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_COST_PER_CALL_MICRO_GBP: '-1' });
    const err = await boot(env).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toMatchObject({
      exitCode: EXIT.badConfig,
      message: expect.stringContaining('SEARCHAPI_COST_PER_CALL_MICRO_GBP'),
    });
    expect(String(err)).not.toContain(SENTINEL_SA);
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
    expect(state(dbPath)).toEqual({ pending: [], rows: { n: 0 } });
  });
});

describe('the tool bootstrap reads the same layered config and writes nothing (settings plan ruling 3)', {
  timeout: BOOT_TIMEOUT_MS,
}, () => {
  it("its guard refuses at a stored row's lower spend cap, and no env line is imported", async () => {
    const dbPath = seededDb([{ name: 'MONTHLY_SPEND_CAP_PENCE', value: '100' }]);
    const rec = testRecording();
    const seen: { cap: number | null; refusal: unknown } = { cap: null, refusal: null };
    const code = await runTool('smoke', ['--origin', 'LHR', '--destination', 'JFK', '--budget', '4'], {
      // why: the env's own cap (£50) would admit a £2 call; the stored £1 must refuse it
      env: toolEnv(dbPath, { MONTHLY_SPEND_CAP_PENCE: '5000', SEARCHAPI_COST_PER_CALL_MICRO_GBP: '2000000' }),
      out: () => undefined,
      err: () => undefined,
      recording: rec.recording,
      runners: {
        smoke: async (ports) => {
          seen.cap = ports.config.spend.monthlyCapMicroGbp;
          try {
            ports.budget.reserve({
              providerId: 'searchapi',
              executionId: null,
              tileIndex: null,
              costMicroGbp: 2_000_000,
              httpAttempt: 1,
              endpointPath: '/api/v1/search',
            });
          } catch (e) {
            seen.refusal = e;
          }
          return EXIT.ok;
        },
      },
    });
    expect(code).toBe(EXIT.ok);
    expect(seen.cap).toBe(100 * PENCE_TO_MICRO);
    expect(seen.refusal).toBeInstanceOf(BudgetExceeded);
    expect(seen.refusal).toMatchObject({ scope: 'global-month' });
    expect(storedRows(dbPath)).toEqual([{ name: 'MONTHLY_SPEND_CAP_PENCE', value: '100' }]);
  });
});
