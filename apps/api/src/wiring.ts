/**
 * The wiring helper: one config parse and one port construction shared by the app bootstrap (WP8)
 * and the tool bootstrap (this package). Spec §4 (both bootstraps are built on this helper and parse the
 * environment once through the core schema), §5.5, §7, §12.
 *
 * This module never reads the process environment: the bootstraps pass it in (the boundary script enforces it).
 */
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  type BudgetGuard,
  type Clock,
  type Config,
  type ConfigError,
  type ConfigResult,
  type FlightProvider,
  flightRequestSeconds,
  isOwnedName,
  type Logger,
  layerSettings,
  listRequestSeconds,
  OWNED_NAMES,
  type OwnedName,
  type ParseConfigOptions,
  parseBootConfig,
  parseConfig,
  type ResponseCache,
  SETTINGS_NAMES,
  Secret,
  type SettingRow,
  type SettingsReport,
  syntheticAllowed,
  systemClock,
} from '@gmt/core';
import {
  applyMigrations,
  budgetConfigFromConfig,
  createRepos,
  type Db,
  openDatabase as openSqlite,
  type Repos,
  SettingsRepo,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import { fxHttpLimits } from '@gmt/engine';
import {
  camoufoxHttpLimits,
  camoufoxProvider,
  camoufoxStatusHttpLimits,
  createHttpKit,
  type FixtureRecorder,
  fixtureHttpLimits,
  fixtureProvider,
  type HttpKit,
  type HttpKitDeps,
  SEARCHAPI_PARAMS,
  searchApiHttpLimits,
  searchApiProvider,
  TRAVELPAYOUTS_PARAMS,
  travelpayoutsHttpLimits,
  travelpayoutsProvider,
} from '@gmt/providers';
import { defaultFixtureRoot, fixtureRouter } from '@gmt/providers/fixture';

/** Thrown by loadConfigFromEnv; the message names every failing field and never a value (spec §12). */
export class InvalidConfigError extends Error {
  readonly errors: readonly ConfigError[];
  constructor(errors: readonly ConfigError[]) {
    super(`invalid configuration: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
    this.name = 'InvalidConfigError';
    this.errors = errors;
  }
}

function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}

/**
 * realpath that tolerates a database file that does not exist yet by resolving its directory
 * (plan Config contract). Spec §5.5: the synthetic gate's suffix checks run on the resolved path.
 * A dangling symlink is refused: its own name could pass the `.fixture.db` suffix check while
 * SQLite would create the file it points at (prov-wp04b-001).
 */
export function tolerantRealpath(p: string): string {
  if (p === ':memory:') return p;
  try {
    return realpathSync(p);
  } catch (e) {
    if (errnoCode(e) !== 'ENOENT') throw e;
    let dangling = false;
    try {
      dangling = lstatSync(p).isSymbolicLink();
    } catch {
      // why: lstat ENOENT means nothing exists at p, the first-boot case handled below.
    }
    if (dangling)
      throw new Error(`${p} is a symbolic link to a file that does not exist; refusing (spec §5.5)`);
    // why: a first boot has no DB file yet; a missing *directory* still fails, as it should.
    return join(realpathSync(dirname(p)), basename(p));
  }
}

type Env = Record<string, string | undefined>;

/** One parse through a core schema entry; a DATABASE_PATH that cannot be resolved is reported as that field, never a value. */
function parseWith(parse: (env: Env, opts: ParseConfigOptions) => ConfigResult, env: Env): ConfigResult {
  try {
    return parse(env, { realpath: tolerantRealpath });
  } catch (e) {
    throw new InvalidConfigError([
      {
        field: 'DATABASE_PATH',
        message: `cannot be resolved (${errnoCode(e) ?? (e instanceof Error ? e.message : 'error')})`,
      },
    ]);
  }
}

/**
 * The environment alone, every name included, through the core schema (spec §12): the config a process with no stored
 * settings runs on. The bootstraps parse with loadBootConfig and then loadConfig instead (settings plan ruling 3); this
 * serves callers with no database to read (the route-test harness, the wiring tests). Throws InvalidConfigError naming
 * every bad field, never a value.
 */
export function loadConfigFromEnv(env: Env): Config {
  const result = parseWith(parseConfig, env);
  if (!result.ok) throw new InvalidConfigError(result.errors);
  return result.config;
}

/**
 * Settings plan ruling 3: the first parse at boot, the environment with every owned name left out (core
 * parseBootConfig). The refusals, the lock wait, the backup and the migrations run on it; the full config comes from
 * loadConfig under the lock. Throws InvalidConfigError naming every bad field, never a value.
 */
export function loadBootConfig(env: Env): Config {
  const result = parseWith(parseBootConfig, env);
  if (!result.ok) throw new InvalidConfigError(result.errors);
  return result.config;
}

/**
 * The full config of a boot and what it did with the owned names (`imported`: the rows it wrote, none without
 * `writeImports`); `warnings` are variables ignored, logged by name.
 */
export interface LoadedConfig extends SettingsReport {
  config: Config;
  warnings: ConfigError[];
}

/** Each secret of `more` not already in `into`, by value, appended to it (the lists scrub by value). */
export function addSecrets(into: Secret[], more: readonly Secret[]): void {
  for (const s of more) if (!into.some((t) => t.reveal() === s.reveal())) into.push(s);
}

/**
 * Settings plan ruling 3: one line per list a boot's settings produced, names only, never a value: the env lines
 * imported, those ignored because Settings holds the name, the stored values set aside, and each variable ignored.
 */
export function logSettingsLoaded(loaded: LoadedConfig, log: Logger): void {
  if (loaded.imported.length > 0)
    log.info({ names: loaded.imported }, 'settings imported from the environment');
  if (loaded.envIgnored.length > 0)
    log.warn({ names: loaded.envIgnored }, 'lines in .env ignored: Settings holds these names');
  if (loaded.setAside.length > 0)
    log.warn({ names: loaded.setAside }, 'stored settings set aside for this boot');
  for (const w of loaded.warnings) log.warn({ field: w.field }, w.message);
}

/** Spec §8.3: email's settings are all or nothing, so one of them left out of a boot can leave out the rest. */
const EMAIL_NAMES: readonly OwnedName[] = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_TLS',
  'SMTP_USER',
  'SMTP_PASS',
  'ALERT_EMAIL_TO',
  'ALERT_EMAIL_FROM',
];

/**
 * Settings plan rulings 2 and 3, run under the app lock: the stored settings laid over the environment
 * (core layerSettings) and parsed through the one core schema. A field the schema refuses that is an owned name has its
 * stored or imported value set aside for this boot (left unset, so its default applies) and the parse is retried, at
 * most once per name; when only email's all-or-nothing rule still refuses a name already set aside, the rest of email
 * is left out too (email is off for the boot). A refusal of a name the page does not own fails as before
 * (InvalidConfigError). With `writeImports`, the env lines of names with no row are written as rows once the parse
 * succeeds, never one set aside, in the same immediate transaction as the read (the tool bootstrap writes nothing).
 */
export function loadConfig(env: Env, db: Db, opts: { clock: Clock; writeImports: boolean }): LoadedConfig {
  const repo = new SettingsRepo(db);
  const run = (): LoadedConfig => {
    const layered = layerSettings(env, repo.all());
    const refused = new Set<OwnedName>();
    const leftOut = new Set<OwnedName>();
    for (;;) {
      const merged: Env = { ...layered.merged };
      for (const name of leftOut) merged[name] = undefined;
      const result = parseWith(parseConfig, merged);
      if (result.ok) {
        const imported = opts.writeImports ? layered.imports.filter((n) => !leftOut.has(n)) : [];
        if (imported.length > 0)
          repo.write(
            imported.map((name) => ({ name, value: layered.merged[name] ?? '' })),
            opts.clock.now(),
          );
        return {
          config: result.config,
          warnings: result.warnings,
          imported,
          envIgnored: layered.envIgnored,
          setAside: OWNED_NAMES.filter((n) => refused.has(n)),
        };
      }
      const owned = result.errors.flatMap((e) => (isOwnedName(e.field) ? [e.field] : []));
      if (owned.length < result.errors.length) throw new InvalidConfigError(result.errors);
      const fresh = owned.filter((n) => !leftOut.has(n));
      if (fresh.length > 0) {
        for (const name of fresh) {
          refused.add(name);
          leftOut.add(name);
        }
        continue;
      }
      // why: a name already left out is refused again only by email's all-or-nothing rule (an unset member of a set
      // group), so the rest of email is left out with it; anything else would loop, and fails boot instead
      if (owned.every((n) => EMAIL_NAMES.includes(n)) && EMAIL_NAMES.some((n) => !leftOut.has(n))) {
        for (const name of EMAIL_NAMES) leftOut.add(name);
        continue;
      }
      throw new InvalidConfigError(result.errors);
    }
  };
  return opts.writeImports ? db.immediateTransaction(run) : run();
}

/** Everything an entrypoint needs, built once (plan "Wiring and bootstraps"). */
export interface Ports {
  config: Config;
  db: Db;
  repos: Repos;
  budget: BudgetGuard;
  cache: ResponseCache;
  http: HttpKit;
  providers: FlightProvider[];
  clock: Clock;
  log: Logger;
  secrets: Secret[];
  recorder: FixtureRecorder | null;
  fixtureRoot: string | null;
  /** Controller ruling R1: what this boot did with the Settings page's names, read by Status and Settings. */
  settingsReport: SettingsReport;
}

const SECRET_NAMES: readonly OwnedName[] = SETTINGS_NAMES.filter((s) => s.secret).map((s) => s.name);

/**
 * Every configured secret, for http-kit, recorder and log scrubbing (spec §5.3), and every stored secret setting beside
 * them (Global Constraints: every stored secret joins the boot's secrets list, used by this config or not), each value
 * once.
 */
export function collectSecrets(config: Config, stored: readonly SettingRow[] = []): Secret[] {
  const out: Secret[] = [];
  if (config.providers.travelpayouts !== null) out.push(config.providers.travelpayouts.token);
  if (config.providers.searchapi !== null) out.push(config.providers.searchapi.key);
  if (config.smtp !== null) out.push(config.smtp.pass);
  if (config.auth !== null) out.push(config.auth.pass);
  // WP14: the camoufox worker key (spec §2), scrubbed like every other credential.
  if (config.providers.camoufox !== null) out.push(config.providers.camoufox.key);
  for (const row of stored)
    if (SECRET_NAMES.includes(row.name) && row.value !== '' && !out.some((s) => s.reveal() === row.value))
      out.push(new Secret(row.value));
  return out;
}

/**
 * The fixture provider's per-call cost: FIXTURE_COST_MICRO_GBP through core's config (spec §5.3
 * "fixture iff HTTP 200 at the configured test cost"), or null when the synthetic gate is closed.
 * why: the guard (WP3 budgetConfigFromConfig) refuses any reserve whose cost differs from this value.
 */
function fixtureCost(config: Config): number | null {
  return syntheticAllowed(config) ? (config.providers.fixture?.costMicroGbp ?? 0) : null;
}

/**
 * http-kit limits per provider (spec §5.3). Ownership rule (plan): WP4b writes fixture + fx; WP5 adds
 * `...(config.providers.searchapi ? { searchapi: searchApiHttpLimits(…) } : {})` and WP6 the
 * Travelpayouts line, one line each, in their own briefs.
 */
export function httpLimitsFor(config: Config): HttpKitDeps['limits'] {
  const timing = {
    maxWaitSeconds: config.maxWaitSeconds,
    requestTimeoutSeconds: config.requestTimeoutSeconds,
  };
  const cost = fixtureCost(config);
  return {
    ...(cost === null ? {} : { fixture: fixtureHttpLimits({ costPerCallMicroGbp: cost, ...timing }) }),
    // WP5: SearchApi, only when SEARCHAPI_KEY is set (spec §2, §5.3).
    ...(config.providers.searchapi === null
      ? {}
      : { searchapi: searchApiHttpLimits(config.providers.searchapi.limits, timing) }),
    // WP6: Travelpayouts, only when configured (spec §2, §5.3).
    ...(config.providers.travelpayouts === null
      ? {}
      : { travelpayouts: travelpayoutsHttpLimits(config.providers.travelpayouts.limits, config) }),
    // WP14: camoufox and its unledgered status route, only when CAMOUFOX_ENABLED=true (spec §2, §5.3 rev 32).
    ...(config.providers.camoufox === null
      ? {}
      : {
          camoufox: camoufoxHttpLimits(config.providers.camoufox, config),
          'camoufox-status': camoufoxStatusHttpLimits(config.providers.camoufox, config),
        }),
    // why: decision 32 — the FX client's http policy lives beside it in the engine (fx/limits.ts), one copy
    fx: fxHttpLimits(timing),
  };
}

/** Providers for this config. Same ownership rule as httpLimitsFor: WP5/WP6 each add one line. */
export function providersFor(
  config: Config,
  deps: {
    http: HttpKit;
    log: Logger;
    clock: Clock;
    /**
     * Decision 82: this database's app-instance id (`repos.meta.appInstanceId()`, a random id stored with the ledger and its path),
     * sent to the camoufox worker so it can report a second app, that is a second ledger, in a month.
     */
    appInstance: string;
  },
): FlightProvider[] {
  const out: FlightProvider[] = [];
  const cost = fixtureCost(config);
  if (cost !== null) {
    out.push(
      fixtureProvider({ http: deps.http, log: deps.log, clock: deps.clock, config, costMicroGbp: cost }),
    );
  }
  // WP6: Travelpayouts, only when configured; one request per airport pair, the cache TTL only serves repeats (spec §5.2).
  const tp = config.providers.travelpayouts;
  if (tp !== null) {
    out.push(
      travelpayoutsProvider({
        http: deps.http,
        log: deps.log,
        clock: deps.clock,
        token: tp.token,
        cacheTtlSeconds: tp.limits.cacheTtlHours * 3600,
        paramsAllowlist: TRAVELPAYOUTS_PARAMS,
      }),
    );
  }
  const sa = config.providers.searchapi;
  if (sa !== null) {
    // why: one rate source: the estimate prices calls at the same limits.costPerCallMicroGbp http-kit ledgers with;
    // SEARCHAPI_CACHE_TTL_HOURS (spec §12) is the local window for calendar tiles (itinerary steps are never cached).
    out.push(
      searchApiProvider({
        http: deps.http,
        log: deps.log,
        clock: deps.clock,
        key: sa.key,
        costPerCallMicroGbp: sa.limits.costPerCallMicroGbp,
        pointOfSale: config.pointOfSale,
        cacheTtlSeconds: sa.limits.cacheTtlHours * 3600,
        paramsAllowlist: SEARCHAPI_PARAMS,
      }),
    );
  }
  // WP14: camoufox, off by default; a definition must still name it (spec §2).
  const cf = config.providers.camoufox;
  if (cf !== null)
    out.push(
      camoufoxProvider({
        http: deps.http,
        log: deps.log,
        clock: deps.clock,
        key: cf.key,
        workerUrl: cf.workerUrl,
        pointOfSale: config.pointOfSale,
        // why: spec §12 — the preflight compares these effective values with the worker's own, by name
        sharedSettings: cf.sharedSettings,
        appInstance: deps.appInstance,
        // why: spec §2 rev 34: grid mode plans each page's scrolls within CAMOUFOX_GRID_SCROLL_CAP
        grid: {
          mode: cf.mode,
          scrollCap: cf.gridScrollCap,
          scrollSpacingSeconds: cf.gridScrollSpacingSeconds,
          pageTimeoutSeconds: cf.pageTimeoutSeconds,
        },
        // why: spec rev 56 §2, §12 (ruling A6): a flights request with a return phase carries its own timeout, core's one
        // computation from the shared page timeout and spacing (780 s with the booking read, 600 s without, at the
        // defaults); discovery keeps camoufoxHttpLimits' own
        flightRequestSeconds: {
          booking: flightRequestSeconds(cf.pageTimeoutSeconds, cf.minSpacingSeconds, true),
          returnsOnly: flightRequestSeconds(cf.pageTimeoutSeconds, cf.minSpacingSeconds, false),
          outboundOnly: listRequestSeconds(cf.pageTimeoutSeconds),
        },
      }),
    );
  return out;
}

/**
 * Opens the database and applies migrations (callers run the backup preflight first; settings plan ruling 3: the
 * bootstraps then take the lock and load the config before buildFromDb). A failed migration closes the handle.
 */
export function openDatabase(databasePath: string, migrationsDir: string): Db {
  const db = openSqlite(databasePath);
  try {
    applyMigrations(db, migrationsDir);
    return db;
  } catch (e) {
    db.close(); // why: never leave a half-built handle holding the WAL
    throw e;
  }
}

/**
 * The boot's first scrub list (settings plan ruling 3): the boot config's secrets and the environment's lines for the
 * Settings page's secret names, which the boot config leaves out but a refusal before the lock could still quote.
 */
export function bootSecrets(config: Config, env: Env): Secret[] {
  return collectSecrets(
    config,
    SECRET_NAMES.flatMap((name) => {
      const value = env[name];
      return value === undefined ? [] : [{ name, value }];
    }),
  );
}

/**
 * Builds repos, guard, cache, http-kit and providers over an open, migrated database for `config` (plan "Wiring and
 * bootstraps"). The caller owns the handle and closes it on failure. The in-process fixture host is passed only under
 * syntheticAllowed (plan decision 7: the only transport seam, gated). Every stored secret joins `secrets`.
 */
export function buildFromDb(
  config: Config,
  db: Db,
  opts: {
    log: Logger;
    clock?: Clock;
    recorder?: FixtureRecorder;
    fixtureRoot?: string;
    settingsReport?: SettingsReport;
  },
): Ports {
  const clock = opts.clock ?? systemClock;
  const allowSynthetic = syntheticAllowed(config);
  const repos = createRepos(db, clock, { allowSynthetic });
  const budget = new SqliteBudgetGuard(db, budgetConfigFromConfig(config), clock);
  const cache = new SqliteResponseCache(db, clock);
  const secrets = collectSecrets(config, repos.settings.all());
  const fixtureRoot = allowSynthetic ? (opts.fixtureRoot ?? defaultFixtureRoot()) : null;
  const router = fixtureRoot === null ? null : fixtureRouter(fixtureRoot, config);
  const http = createHttpKit({
    budget,
    cache,
    limits: httpLimitsFor(config),
    clock,
    log: opts.log,
    secrets,
    syntheticAllowed: allowSynthetic,
    ...(opts.recorder !== undefined ? { recorder: opts.recorder } : {}),
    ...(router !== null
      ? { inProcessHosts: { 'fixture.local': (req: Request) => Promise.resolve(router.fetch(req)) } }
      : {}),
  });
  const providers = providersFor(config, {
    http,
    log: opts.log,
    clock,
    appInstance: repos.meta.appInstanceId(),
  });
  return {
    config,
    db,
    repos,
    budget,
    cache,
    http,
    providers,
    clock,
    log: opts.log,
    secrets,
    recorder: opts.recorder ?? null,
    fixtureRoot,
    settingsReport: opts.settingsReport ?? { imported: [], envIgnored: [], setAside: [] },
  };
}

/**
 * openDatabase and buildFromDb for a config already in hand, with no stored settings laid over it (the route-test
 * harness and the tool tests, whose config comes from loadConfigFromEnv); the bootstraps use loadConfig between them.
 */
export function buildPorts(
  config: Config,
  opts: {
    log: Logger;
    clock?: Clock;
    recorder?: FixtureRecorder;
    migrationsDir: string;
    fixtureRoot?: string;
  },
): Ports {
  const db = openDatabase(config.databasePath, opts.migrationsDir);
  try {
    return buildFromDb(config, db, opts);
  } catch (e) {
    db.close(); // why: never leave a half-built handle holding the WAL
    throw e;
  }
}
