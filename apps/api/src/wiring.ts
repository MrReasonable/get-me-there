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
  type FlightProvider,
  type Logger,
  parseConfig,
  type ResponseCache,
  type Secret,
  syntheticAllowed,
  systemClock,
} from '@gmt/core';
import {
  type AirportsRepo,
  applyMigrations,
  budgetConfigFromConfig,
  createRepos,
  type Db,
  openDatabase,
  type Repos,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import {
  createHttpKit,
  type FixtureRecorder,
  fixtureHttpLimits,
  fixtureProvider,
  type HttpKit,
  type HttpKitDeps,
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

/**
 * Parses the environment once through the core schema (spec §12). Throws InvalidConfigError naming
 * every bad field; a DATABASE_PATH that cannot be resolved is reported as that field, never a value.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config {
  let result: ReturnType<typeof parseConfig>;
  try {
    result = parseConfig(env, { realpath: tolerantRealpath });
  } catch (e) {
    throw new InvalidConfigError([
      {
        field: 'DATABASE_PATH',
        message: `cannot be resolved (${errnoCode(e) ?? (e instanceof Error ? e.message : 'error')})`,
      },
    ]);
  }
  if (!result.ok) throw new InvalidConfigError(result.errors);
  return result.config;
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
}

/** Every configured secret, for http-kit and recorder scrubbing (spec §5.3). */
export function collectSecrets(config: Config): Secret[] {
  const out: Secret[] = [];
  if (config.providers.travelpayouts !== null) out.push(config.providers.travelpayouts.token);
  if (config.providers.searchapi !== null) out.push(config.providers.searchapi.key);
  if (config.smtp !== null) out.push(config.smtp.pass);
  if (config.auth !== null) out.push(config.auth.pass);
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
    // why: plan decision 2 — frankfurter lives at api.frankfurter.dev; the .app host redirects and http-kit refuses redirects
    fx: {
      hosts: ['api.frankfurter.dev'],
      ratePerMinute: 10,
      ratePerHour: 100,
      concurrency: 1,
      billable: 'never',
      costPerCallMicroGbp: 0,
      ...timing,
    },
  };
}

/** Providers for this config. Same ownership rule as httpLimitsFor: WP5/WP6 each add one line. */
export function providersFor(
  config: Config,
  deps: { http: HttpKit; log: Logger; clock: Clock; airports: AirportsRepo },
): FlightProvider[] {
  const out: FlightProvider[] = [];
  const cost = fixtureCost(config);
  if (cost !== null) {
    out.push(
      fixtureProvider({ http: deps.http, log: deps.log, clock: deps.clock, config, costMicroGbp: cost }),
    );
  }
  return out;
}

/**
 * Opens the DB, applies migrations (callers run the backup preflight first), then builds repos,
 * guard, cache, http-kit and providers (plan "Wiring and bootstraps"). The in-process fixture host
 * is passed only under syntheticAllowed (plan decision 7: the only transport seam, gated).
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
  const clock = opts.clock ?? systemClock;
  const db = openDatabase(config.databasePath);
  try {
    applyMigrations(db, opts.migrationsDir);
    const allowSynthetic = syntheticAllowed(config);
    const repos = createRepos(db, clock, { allowSynthetic });
    const budget = new SqliteBudgetGuard(db, budgetConfigFromConfig(config), clock);
    const cache = new SqliteResponseCache(db, clock);
    const secrets = collectSecrets(config);
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
    const providers = providersFor(config, { http, log: opts.log, clock, airports: repos.airports });
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
    };
  } catch (e) {
    db.close(); // why: never leave a half-built handle holding the WAL
    throw e;
  }
}
