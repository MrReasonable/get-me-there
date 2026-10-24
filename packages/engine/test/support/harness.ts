/**
 * Layer-A engine test harness (spec §9 item 4): "the fixture provider as an HTTP adapter at fixture.local … through
 * the real http-kit and the real db BudgetGuard with the fixture cost rule, in-memory DB".
 *
 * It lives under test/ (never src/), so engine src stays free of airport codes and test libraries. Transport (plan
 * decisions 7 and 15): http-kit (`syntheticAllowed: true`) reaches `fixture.local` through its gated `inProcessHosts`
 * seam, answered by WP4's `fixtureRouter(defaultFixtureRoot(), config)`. Every control is WP4's: scenario rules
 * (`scenarioRequest`), `hold` rules and `releaseRequest`. The harness only logs what reaches the router
 * (`h.requests`). The only provider registered is the fixture provider, under its own id `fixture` with sourceKind
 * `synthetic` (ruling 1); a test that changes its behaviour wraps it (test/support/wrappers.ts) under that same id.
 */
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  type CellKey,
  type CellOutcome,
  type CellOutcomeStatus,
  type DefinitionInput,
  type Execution,
  type FlightProvider,
  fixedClock,
  generateCells,
  type IsoDateTime,
  type Logger,
  type Notifier,
  type OperatorMessage,
  type ProviderId,
  type ProvidersConfig,
  parseConfig,
  type SearchDefinition,
  type Stage,
  syntheticAllowed,
  systemClock,
} from '@gmt/core';
import {
  type AirportsDataset,
  applyMigrations,
  budgetConfigFromConfig,
  type CellsRepo,
  createRepos,
  type Db,
  type ExecutionsRepo,
  MIGRATIONS_DIR,
  openDatabase,
  type Repos,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import { createHttpKit, fixtureHttpLimits, fixtureProvider, type ProviderHttpLimits } from '@gmt/providers';
import {
  defaultFixtureRoot,
  type FixtureRule,
  fixtureRouter,
  releaseRequest,
  scenarioRequest,
} from '@gmt/providers/fixture';
import { expect, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import { fxHttpLimits } from '../../src/fx/limits.js';
import { createOrchestrator, type Orchestrator } from '../../src/orchestrator.js';
import type { EngineDeps, EngineOptions, StartOptions, StartResult } from '../../src/types.js';

// --- the worked example (docs/briefs/README.md: London → New York only) ---
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');
/** Default "now" for every harness: a Wednesday morning, BST. */
export const T0 = asIsoDateTime('2026-10-14T09:00:00.000Z');
/** The base definition's window: 14 departure days, i.e. two 7-day fixture tiles per pair (WP4 FIXTURE_TILE_DAYS). */
export const WINDOW = { from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-15') } as const;
/** Per-call test cost of the fixture provider (the SearchApi per-call figure of spec §6.3, 0.32p). */
export const FIXTURE_COST_MICRO_GBP = 3200;
export const HOUR = 3_600_000;

/** Tiny synthetic airports dataset: the four worked-example airports with their real IANA zones and metros. */
export const TEST_AIRPORTS: AirportsDataset = {
  version: 'engine-layer-a-1',
  airports: [
    {
      iata: LHR,
      icao: 'EGLL',
      name: 'London Heathrow',
      city: 'London',
      country: 'GB',
      tz: 'Europe/London',
      lat: 51.47,
      lon: -0.4543,
      metro: 'LON',
    },
    {
      iata: LGW,
      icao: 'EGKK',
      name: 'London Gatwick',
      city: 'London',
      country: 'GB',
      tz: 'Europe/London',
      lat: 51.1481,
      lon: -0.1903,
      metro: 'LON',
    },
    {
      iata: JFK,
      icao: 'KJFK',
      name: 'John F. Kennedy International',
      city: 'New York',
      country: 'US',
      tz: 'America/New_York',
      lat: 40.6398,
      lon: -73.7789,
      metro: 'NYC',
    },
    {
      iata: EWR,
      icao: 'KEWR',
      name: 'Newark Liberty International',
      city: 'New York',
      country: 'US',
      tz: 'America/New_York',
      lat: 40.6925,
      lon: -74.1687,
      metro: 'NYC',
    },
  ],
  metros: { LON: [LHR, LGW], NYC: [JFK, EWR] },
};

// --- capturing logger and notifier ---
export interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  bindings: Record<string, unknown>;
  fields: Record<string, unknown>;
  msg: string | undefined;
}

/** A pino-shaped Logger that records every line with its accumulated child bindings. */
export function capturingLogger(lines: LogLine[], bindings: Record<string, unknown> = {}): Logger {
  const at =
    (level: LogLine['level']) =>
    (fields: object, msg?: string): void => {
      lines.push({ level, bindings, fields: { ...fields }, msg });
    };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (b: object) => capturingLogger(lines, { ...bindings, ...b }),
  };
}

/** A Notifier (plan "Notifier port") that records operator messages and digests and always succeeds. */
export function capturingNotifier(operator: OperatorMessage[], digests: unknown[]): Notifier {
  return {
    id: 'capture',
    send: async (m) => {
      if (m.kind === 'operator') operator.push(m.message);
      else digests.push(m);
      return { ok: true };
    },
  };
}

// --- request log (observation only: every control is WP4's scenario rules, hold and release) ---
export interface FixtureRequest {
  kind: 'calendar' | 'itinerary' | 'other';
  pair: string;
  ordinal: number;
  path: string;
  params: Record<string, string>;
}

/** The one hold id the layer-A tests use; `h.releaseHolds()` releases it. */
export const HOLD_ID = 'layer-a';

/** WP4 scenario rules for every §8.1 row (WP4 brief, "Which rule drives which spec §8.1 row"); `times` counts http-kit attempts. */
export const FIXTURE_RULES = {
  rateLimit: { kind: 'status', status: 429 },
  upstream: { kind: 'status', status: 503 },
  network: { kind: 'network' },
  badRequest: { kind: 'status', status: 400, body: { error: 'synthetic bad request' } },
  malformed: { kind: 'malformed' },
  notFound: { kind: 'status', status: 404 },
  auth: { kind: 'status', status: 401 },
  quota: { kind: 'status', status: 402 },
  limiterTimeout: { kind: 'status', status: 429, headers: { 'retry-after': '4000' } },
  noReturnLegs: { kind: 'no-return-legs' },
  partial: { kind: 'partial', failedExpansions: 1 },
  empty: { kind: 'empty' },
  // why: WP4 hold rule — a held request waits for releaseRequest(id) or its own abort
  hold: { kind: 'hold', id: HOLD_ID },
} as const satisfies Record<string, FixtureRule['respond']>;

/** One discovery tile of the base window: WP4 tiles start every 7 departure days from WINDOW.from. */
export function tileRule(
  origin: string,
  departFrom: string,
  respond: FixtureRule['respond'],
  times?: number,
): FixtureRule {
  return {
    match: { path: '/calendar', params: { origin, departFrom } },
    respond,
    ...(times !== undefined ? { times } : {}),
  };
}
/** The next `times` itinerary requests, whichever cells they are for. */
export function itineraryRule(respond: FixtureRule['respond'], times?: number): FixtureRule {
  return { match: { path: '/itinerary' }, respond, ...(times !== undefined ? { times } : {}) };
}

/** WP4 routes: `/calendar` (discovery tile) and `/itinerary` (verification); anything else is `other`. */
export function fixtureRequestKey(url: URL): Omit<FixtureRequest, 'ordinal'> {
  const kind =
    url.pathname === '/calendar' ? 'calendar' : url.pathname === '/itinerary' ? 'itinerary' : 'other';
  return {
    kind,
    pair: `${url.searchParams.get('origin') ?? '?'}-${url.searchParams.get('destination') ?? '?'}`,
    path: url.pathname,
    params: Object.fromEntries(url.searchParams),
  };
}

// --- definitions ---
/** Discovery by the fixture provider only. */
export function noVerification(): ProvidersConfig {
  return { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 168 } };
}
/** Discovery and verification by the fixture provider. */
export function withVerification(): ProvidersConfig {
  return { discovery: ['fixture'], verification: ['fixture'], discoveryRefreshHours: { fixture: 168 } };
}
/** Verification only (no discovery provider): every cell is a selection candidate by stride (spec §6.7). */
export function verificationOnly(): ProvidersConfig {
  return { discovery: [], verification: ['fixture'], discoveryRefreshHours: {} };
}
/** LHR → JFK over WINDOW, 7–8 nights: 28 cells, two fixture tiles. */
export function baseDefinition(): DefinitionInput {
  return {
    name: 'London to New York (layer A)',
    origins: [LHR],
    destinations: [JFK],
    window: { kind: 'absolute', from: WINDOW.from, to: WINDOW.to },
    minNights: 7,
    maxNights: 8,
    cabin: 'economy',
    constraints: {},
    verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    providers: noVerification(),
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: 'Europe/London',
    enabled: true,
  };
}

/**
 * The refusal's message after checking its code; throws when the start went ahead, so a test never skips an assertion
 * behind `if (!r.ok)` (test-strategy-reviewer-029).
 */
export function refusedWith(r: StartResult, code: Extract<StartResult, { ok: false }>['code']): string {
  if (r.ok) throw new Error(`expected a refusal with code ${code}; it started ${r.executionId}`);
  expect(r.code).toBe(code);
  return r.message;
}
export function discoveryOf(p: FlightProvider): NonNullable<FlightProvider['discovery']> {
  if (p.discovery === undefined) throw new Error(`${p.id} has no discovery capability`);
  return p.discovery;
}
export function verificationOf(p: FlightProvider): NonNullable<FlightProvider['verification']> {
  if (p.verification === undefined) throw new Error(`${p.id} has no verification capability`);
  return p.verification;
}

export interface LedgerRow {
  providerId: string;
  executionId: string | null;
  endpointPath: string;
  tileIndex: number | null;
  outcome: string;
  billable: number | null;
  httpAttempt: number;
  costMicroGbp: number;
}

/** Tables a test may count rows of, per execution or in total. */
export type CountedTable =
  | 'calendar_prices'
  | 'price_observations'
  | 'provider_requests'
  | 'route_price_history';

export interface HarnessOptions {
  /** Extra or overriding environment for parseConfig (strings, as in .env). */
  env?: Record<string, string>;
  now?: IsoDateTime;
  /** Pool size for the fixture, both in the engine (EngineOptions.providerConcurrency) and in http-kit. */
  fixtureConcurrency?: number;
  /** The guard's fixture call cap (budgetConfigFromConfig fixes 100 000; no config field exists for it). */
  fixtureMonthlyCallCap?: number;
  /**
   * The guard's billable flag for the fixture (default true). False makes the guard count its calls against
   * execution-free-calls, as it does Travelpayouts' (test-strategy-reviewer-027); the engine's own limits still say billed.
   */
  fixtureBillable?: boolean;
  /** The guard's cap window for the fixture (default 'month'); 'lifetime' stands in for the SearchApi trial (cost-r2-004). */
  fixtureWindow?: 'month' | 'lifetime';
  /** Per-call cost of the fixture, passed as FIXTURE_COST_MICRO_GBP (default FIXTURE_COST_MICRO_GBP). */
  fixtureCostMicroGbp?: number;
  /** Wraps the fixture provider (still id `fixture`, still synthetic): test/support/wrappers.ts. */
  transformFixture?: (fixture: FlightProvider) => FlightProvider;
  /**
   * Fake setTimeout/setInterval/Date at `now` so http-kit's backoff, the limiter and croner run on the same time as
   * the fixed clock; `waitForSettled` advances them (test-strategy-reviewer-003, -004).
   */
  fakeTimers?: boolean;
  /**
   * WP16a: the engine reads the process clock (core's systemClock), which fake timers drive, so croner's jobs, the
   * heartbeat and the engine agree on the instant; `h.clock.set`/`advance` then move the faked system time. Needs
   * `fakeTimers`.
   */
  systemClock?: boolean;
}

/** Anything with a shutdown the harness must await before it closes the database. */
export interface Stoppable {
  shutdown(): Promise<void>;
}

export interface Harness {
  deps: EngineDeps;
  options: EngineOptions;
  config: EngineDeps['config'];
  clock: ReturnType<typeof fixedClock>;
  db: Db;
  repos: Repos;
  fixture: FlightProvider;
  logs: LogLine[];
  notifications: OperatorMessage[];
  digests: unknown[];
  requests: FixtureRequest[];
  /** WP4 scenario control: scenarioRequest(rules) (replaces the rules). */
  fixtureScenario(rules: FixtureRule[]): Promise<void>;
  /** WP4 hold control: releaseRequest(id) answers every request held under that id normally. */
  releaseHolds(id?: string): Promise<void>;
  onTileCommit(fn: (n: number, executionId: string) => void): void;
  beforeTileWrite(fn: (attempt: number, executionId: string) => void): void;
  onStageStart(stage: Stage, fn: (executionId: string) => void): void;
  clearHooks(): void;
  createDefinition(patch?: Partial<DefinitionInput>): SearchDefinition;
  /** A fresh orchestrator over this harness (a "fresh process": no in-memory state survives); shut down by close(). */
  orch(options?: EngineOptions): Orchestrator;
  /** Registers anything with a shutdown (an Engine) so close() stops it first. */
  track<T extends Stoppable>(s: T): T;
  waitForSettled(executionId: string): Promise<Execution>;
  /** Awaits `p`, advancing fake timers meanwhile (http-kit's limiter and backoff run on them); plain await otherwise. */
  drive<T>(p: Promise<T>): Promise<T>;
  runToCompletion(
    engine: {
      start(id: string, o: StartOptions): Promise<StartResult>;
    },
    definitionId: string,
    opts?: StartOptions,
  ): Promise<Execution>;
  /** CellsRepo.outcomes with a status filter applied here (the repository filters by stage, provider and cells only). */
  outcomes(
    executionId: string,
    filter?: { stage?: Stage; providerId?: ProviderId; status?: CellOutcomeStatus },
  ): CellOutcome[];
  ledgerRows(executionId: string): LedgerRow[];
  /** Spec §8.1 parity count for the fixture's discovery: distinct first-attempt tiles + cache hits (LedgerRepo.countsFor). */
  tileRequests(executionId: string): number;
  count(table: CountedTable, executionId?: string): number;
  spendLedger(p: {
    providerId: ProviderId;
    rows: number;
    costMicroGbpEach: number;
    executionId?: string | null;
  }): void;
  /** Idempotent: shuts down every tracked orchestrator and engine, releases holds, closes the database. */
  close(): Promise<void>;
}

const open = new Set<Harness>();

/** Closes every harness still open (the vitest setup file calls it after each test). */
export async function closeHarnesses(): Promise<void> {
  for (const h of [...open]) await h.close();
}

/** Expected tile count for a definition: the fixture's own plan per pair over that pair's cells. */
export function expectedTiles(
  h: Harness,
  def: Pick<SearchDefinition, 'window' | 'origins' | 'destinations' | 'minNights' | 'maxNights' | 'cabin'>,
): number {
  if (def.window.kind !== 'absolute') throw new Error('expectedTiles needs an absolute window');
  const d = discoveryOf(h.fixture);
  let n = 0;
  for (const origin of def.origins) {
    for (const destination of def.destinations) {
      const cells: CellKey[] = generateCells({
        origins: [origin],
        destinations: [destination],
        departureFrom: def.window.from,
        departureTo: def.window.to,
        minNights: def.minNights,
        maxNights: def.maxNights,
      });
      n += d.plan({
        origin,
        destination,
        departureFrom: def.window.from,
        departureTo: def.window.to,
        minNights: def.minNights,
        maxNights: def.maxNights,
        cabin: def.cabin,
        currency: 'GBP',
        cells,
      }).length;
    }
  }
  return n;
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  const now = opts.now ?? T0;
  if (opts.fakeTimers === true) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(now));
  }
  const parsed = parseConfig(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      // why: the fixture provider is billed at FIXTURE_COST_MICRO_GBP, so the global and execution cost caps must allow it
      MONTHLY_SPEND_CAP_PENCE: '100000',
      EXECUTION_MAX_CALLS: '1000',
      EXECUTION_MAX_COST_PENCE: '100000',
      REQUEST_TIMEOUT_SECONDS: '10',
      FIXTURE_COST_MICRO_GBP: String(opts.fixtureCostMicroGbp ?? FIXTURE_COST_MICRO_GBP),
      ...opts.env,
    },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(`harness config invalid: ${JSON.stringify(parsed.errors)}`);
  const config = parsed.config;
  // why: the production gate, never a hard-coded true (prov-wp07-012); the harness config must open it
  if (!syntheticAllowed(config)) throw new Error('harness config must satisfy syntheticAllowed');
  const fixtureCfg = config.providers.fixture;
  if (fixtureCfg === null) throw new Error('harness config has no fixture provider');
  if (opts.systemClock === true && opts.fakeTimers !== true) throw new Error('systemClock needs fakeTimers');
  const fixed = fixedClock(now);
  const clock: ReturnType<typeof fixedClock> =
    opts.systemClock === true
      ? {
          now: () => systemClock.now(),
          todayLondon: () => systemClock.todayLondon(),
          advance: (ms) => vi.setSystemTime(new Date(Date.now() + ms)),
          set: (at) => vi.setSystemTime(new Date(at)),
        }
      : fixed;
  const logs: LogLine[] = [];
  const log = capturingLogger(logs);
  const notifications: OperatorMessage[] = [];
  const digests: unknown[] = [];

  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const repos = createRepos(db, clock, { allowSynthetic: syntheticAllowed(config) });
  repos.airports.upsertAll(TEST_AIRPORTS);

  // why: the production wiring (arch-014); only the fixture's call cap, which no config field sets, is overridden
  const fromConfig = budgetConfigFromConfig(config);
  const fixtureBudget = fromConfig.providers.fixture;
  if (fixtureBudget === undefined) throw new Error('budgetConfigFromConfig left out the fixture provider');
  const budgetConfig = {
    ...fromConfig,
    providers: {
      ...fromConfig.providers,
      fixture: {
        ...fixtureBudget,
        monthlyCallCap: opts.fixtureMonthlyCallCap ?? fixtureBudget.monthlyCallCap,
        billable: opts.fixtureBillable ?? fixtureBudget.billable,
        window: opts.fixtureWindow ?? fixtureBudget.window,
      },
    },
  };
  const budget = new SqliteBudgetGuard(db, budgetConfig, clock);
  const cache = new SqliteResponseCache(db, clock);
  const fixtureHttp: ProviderHttpLimits = {
    ...fixtureHttpLimits({
      costPerCallMicroGbp: fixtureCfg.costMicroGbp,
      maxWaitSeconds: config.maxWaitSeconds,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
    }),
    concurrency: opts.fixtureConcurrency ?? 4,
  };
  const fxHttp = fxHttpLimits(config);

  // --- WP4's fixture router, in process; the log only observes (no second request layer) ---
  const router = fixtureRouter(defaultFixtureRoot(), config);
  const requests: FixtureRequest[] = [];
  const ordinals: Record<FixtureRequest['kind'], number> = { calendar: 0, itinerary: 0, other: 0 };
  const observed = async (req: Request): Promise<Response> => {
    const key = fixtureRequestKey(new URL(req.url));
    ordinals[key.kind] += 1;
    requests.push({ ...key, ordinal: ordinals[key.kind] });
    return router.fetch(req);
  };
  const http = createHttpKit({
    budget,
    cache,
    clock,
    log,
    secrets: [],
    syntheticAllowed: syntheticAllowed(config),
    limits: { fixture: fixtureHttp, fx: fxHttp },
    // why: plan decision 7 — the only transport seam; frankfurter goes to global fetch (stubbed per test, test/support/fx.ts)
    inProcessHosts: { 'fixture.local': observed },
  });
  const fixture = fixtureProvider({ http, log, clock, config, costMicroGbp: fixtureCfg.costMicroGbp });
  const providers = [opts.transformFixture ? opts.transformFixture(fixture) : fixture];

  // --- write hooks ---
  let before: Array<(n: number, executionId: string) => void> = [];
  let after: Array<(n: number, executionId: string) => void> = [];
  let stageHooks: Array<{ stage: Stage; fn: (executionId: string) => void }> = [];
  let attempts = 0;
  let commits = 0;
  const writeTile = repos.cells.writeTile.bind(repos.cells);
  repos.cells.writeTile = (...args: Parameters<CellsRepo['writeTile']>) => {
    attempts += 1;
    for (const f of before) f(attempts, args[0]);
    writeTile(...args);
    commits += 1;
    for (const f of after) f(commits, args[0]);
  };
  const setStatus = repos.executions.setStatus.bind(repos.executions);
  repos.executions.setStatus = (...args: Parameters<ExecutionsRepo['setStatus']>) => {
    setStatus(...args);
    const stage = args[2]?.stage;
    for (const hk of stageHooks) if (stage === hk.stage) hk.fn(args[0]);
  };

  const deps: EngineDeps = {
    config,
    db,
    repos,
    budget,
    cache,
    http,
    providers,
    notifiers: [capturingNotifier(notifications, digests)],
    clock,
    log,
  };
  const options: EngineOptions =
    opts.fixtureConcurrency !== undefined
      ? { providerConcurrency: { fixture: opts.fixtureConcurrency } }
      : {};
  const tracked: Stoppable[] = [];
  let closed = false;

  // why: real or fake timers alike — under fake timers each step advances them, so backoff, the limiter and croner move
  const step = (): Promise<unknown> =>
    vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(25) : new Promise((r) => setTimeout(r, 5));
  const waitForSettled = async (executionId: string): Promise<Execution> => {
    for (let i = 0; i < 4000; i += 1) {
      const e = repos.executions.get(executionId);
      if (e === null) throw new Error(`no execution ${executionId}`);
      if (e.status !== 'pending' && e.status !== 'running') return e;
      await step();
    }
    throw new Error(`execution ${executionId} did not settle`);
  };
  const drive = async <T>(p: Promise<T>): Promise<T> => {
    let settled = false;
    const mark = (): void => {
      settled = true;
    };
    p.then(mark, mark);
    for (let i = 0; i < 4000 && !settled; i += 1) await step();
    return p;
  };
  const tableCount = (table: CountedTable, executionId?: string): number => {
    const row =
      executionId === undefined
        ? db.raw.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()
        : db.raw
            .prepare<[string], { n: number }>(`SELECT count(*) AS n FROM ${table} WHERE execution_id = ?`)
            .get(executionId);
    return row?.n ?? 0;
  };

  const h: Harness = {
    deps,
    options,
    config,
    clock,
    db,
    repos,
    fixture: providers[0] ?? fixture,
    logs,
    notifications,
    digests,
    requests,
    fixtureScenario: async (rules) => {
      const res = await router.fetch(scenarioRequest(rules));
      if (!res.ok) throw new Error(`fixture scenario refused: ${res.status} ${await res.text()}`);
    },
    releaseHolds: async (id = HOLD_ID) => {
      const res = await router.fetch(releaseRequest(id));
      if (!res.ok) throw new Error(`fixture release refused: ${res.status}`);
    },
    onTileCommit: (fn) => {
      after.push(fn);
    },
    beforeTileWrite: (fn) => {
      before.push(fn);
    },
    onStageStart: (stage, fn) => {
      stageHooks.push({ stage, fn });
    },
    clearHooks: () => {
      before = [];
      after = [];
      stageHooks = [];
      attempts = 0;
      commits = 0;
    },
    createDefinition: (patch = {}) => repos.definitions.create({ ...baseDefinition(), ...patch }),
    orch: (o = options) => h.track(createOrchestrator(buildContext(deps, o))),
    track: (s) => {
      tracked.push(s);
      return s;
    },
    waitForSettled,
    drive,
    runToCompletion: async (engine, definitionId, o = { trigger: 'manual' }) => {
      const r = await engine.start(definitionId, o);
      if (!r.ok) throw new Error(`start refused: ${r.code}: ${r.message}`);
      return waitForSettled(r.executionId);
    },
    outcomes: (executionId, filter = {}) => {
      const { status, ...repoFilter } = filter;
      const rows = repos.cells.outcomes(executionId, repoFilter);
      return status === undefined ? rows : rows.filter((o) => o.status === status);
    },
    ledgerRows: (executionId) =>
      db.raw
        .prepare<[string], LedgerRow>(
          `SELECT provider_id AS providerId, execution_id AS executionId, endpoint_path AS endpointPath, tile_index AS tileIndex,
                  outcome, billable, http_attempt AS httpAttempt, cost_micro_gbp AS costMicroGbp
             FROM provider_requests WHERE execution_id = ? ORDER BY id`,
        )
        .all(executionId),
    tileRequests: (executionId) => {
      const row = repos.ledger
        .countsFor(executionId)
        .perProvider.find((p) => p.providerId === 'fixture' && p.stage === 'discovery');
      return (row?.tiles ?? 0) + (row?.cacheHits ?? 0);
    },
    count: tableCount,
    spendLedger: ({ providerId, rows, costMicroGbpEach, executionId = null }) => {
      const at = clock.now();
      const insert = db.raw.prepare(
        `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms,
                                        http_status, outcome, billable, cost_micro_gbp, http_attempt)
         VALUES (?, ?, '/test-spend', NULL, ?, ?, 0, 200, 'ok', 1, ?, 1)`,
      );
      db.transaction(() => {
        for (let i = 0; i < rows; i += 1) insert.run(providerId, executionId, at, at, costMicroGbpEach);
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      open.delete(h);
      // why: release first so a held request cannot keep a shutdown waiting, then stop every pass before the DB closes
      await h.releaseHolds().catch(() => undefined);
      for (const s of tracked.splice(0)) await s.shutdown();
      db.close();
    },
  };
  open.add(h);
  return h;
}
