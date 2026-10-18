/**
 * Layer B (spec §9 item 4): the real SearchApi and Travelpayouts adapters replaying WP4b's recorded session through
 * the same path as layer A: the real http-kit, the real SqliteBudgetGuard over the production budget wiring, an
 * in-memory database, msw on global fetch (the network guards' server, @gmt/providers/testing). The recordings are
 * local-only (plan decision 61), so a checkout without them skips visibly (decision 64's guard, one copy).
 */
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  type DefinitionInput,
  type Execution,
  fixedClock,
  type IsoDateTime,
  parseConfig,
} from '@gmt/core';
import {
  AIRPORTS_DATA_DIR,
  applyMigrations,
  budgetConfigFromConfig,
  createRepos,
  type Db,
  loadAirportsDataset,
  MIGRATIONS_DIR,
  openDatabase,
  type Repos,
  SqliteBudgetGuard,
  SqliteResponseCache,
  seedAirports,
} from '@gmt/db';
import {
  createHttpKit,
  defaultRecordedRoot,
  SEARCHAPI_PARAMS,
  searchApiHttpLimits,
  searchApiProvider,
  TRAVELPAYOUTS_PARAMS,
  travelpayoutsHttpLimits,
  travelpayoutsProvider,
} from '@gmt/providers';
import {
  guardedServer,
  loadParamsHistory,
  loadRecorded,
  recordingsPresent,
  replayHandlers,
} from '@gmt/providers/testing';
import { fxHttpLimits } from '../../src/fx/limits.js';
import type { EngineDeps } from '../../src/types.js';
import { capturingLogger, capturingNotifier, type LogLine } from '../support/harness.js';

export const RECORDED_ROOT = defaultRecordedRoot();
export const PRESENT = recordingsPresent(RECORDED_ROOT);
/**
 * WP4b's signature, mirroring RECORDED_BY in apps/api/src/tools/record.ts (engine may not import apps/api, spec §4); the
 * smoke's own recordings live beside its database, never here (decision 61).
 */
export const RECORD_RECORDED_BY = '@gmt/api record:fixtures';

/** The newest WP4b session that holds an in-limit calendar tile, and when it was recorded. */
export function recordedSession(): { session: string; at: IsoDateTime } {
  const calendars = loadRecorded(RECORDED_ROOT, 'searchapi', '/api/v1/search').filter(
    (r) =>
      r.recordedBy === RECORD_RECORDED_BY &&
      r.status === 200 &&
      new URL(r.request.url).searchParams.get('engine') === 'google_flights_calendar',
  );
  const last = calendars.at(-1);
  if (last === undefined) throw new Error('no recorded in-limit calendar tile (WP4b Task 12b)');
  const first = loadRecorded(RECORDED_ROOT, 'travelpayouts', '/aviasales/v3/prices_for_dates')
    .filter((r) => r.session === last.session)
    .at(0);
  return { session: last.session, at: first?.recordedAt ?? last.recordedAt };
}

/** The recorded google_flights chain: its cell (from step 1's request) and how many outbounds it expanded. */
export function recordedChain(session: string): {
  cell: { departureDate: string; returnDate: string };
  expandTop: number;
} {
  const flights = loadRecorded(RECORDED_ROOT, 'searchapi', '/api/v1/search').filter(
    (r) =>
      r.session === session &&
      r.status === 200 &&
      new URL(r.request.url).searchParams.get('engine') === 'google_flights',
  );
  const step1 = flights.find((r) => {
    const p = new URL(r.request.url).searchParams;
    return !p.has('departure_token') && !p.has('booking_token');
  });
  if (step1 === undefined) throw new Error('no recorded google_flights step 1 (WP4b Task 12b)');
  const p = new URL(step1.request.url).searchParams;
  return {
    cell: { departureDate: p.get('outbound_date') ?? '', returnDate: p.get('return_date') ?? '' },
    expandTop: flights.filter((r) => new URL(r.request.url).searchParams.has('departure_token')).length,
  };
}

export interface LayerB {
  deps: EngineDeps;
  db: Db;
  repos: Repos;
  logs: LogLine[];
  misses(): string[];
  close(): void;
}

/**
 * Engine deps over the real adapters, with the recorded session installed on the guarded msw server. why: the provider
 * and http-limit construction mirrors apps/api/src/wiring.ts `providersFor` and `httpLimitsFor` (engine may not import
 * apps/api); a change there must be repeated here, and layer B then fails on a request the recording does not hold.
 */
export function layerB(session: string, now: IsoDateTime): LayerB {
  const parsed = parseConfig(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      TRAVELPAYOUTS_TOKEN: 'test-travelpayouts-token-0123456789abcdef',
      SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef',
      SEARCHAPI_PLAN: 'trial',
      // why: the trial's 2 calls a minute would space replayed calls 30 s apart (http-kit smoothing, decision 17)
      SEARCHAPI_RATE_PER_MINUTE: '60000',
      SEARCHAPI_RATE_PER_HOUR: '600000',
      TRAVELPAYOUTS_RATE_PER_MINUTE: '60000',
      TRAVELPAYOUTS_RATE_PER_HOUR: '600000',
      REQUEST_TIMEOUT_SECONDS: '10',
    },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(`layer B config invalid: ${JSON.stringify(parsed.errors)}`);
  const config = parsed.config;
  const tp = config.providers.travelpayouts;
  const sa = config.providers.searchapi;
  if (tp === null || sa === null) throw new Error('layer B configures both vendors');
  const clock = fixedClock(asIsoDateTime(now));
  const logs: LogLine[] = [];
  const log = capturingLogger(logs);
  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  // why: no synthetic row is ever written here; the repositories enforce the provider ⇔ kind rule
  const repos = createRepos(db, clock, { allowSynthetic: false });
  seedAirports(db, loadAirportsDataset(AIRPORTS_DATA_DIR));
  const budget = new SqliteBudgetGuard(db, budgetConfigFromConfig(config), clock);
  const cache = new SqliteResponseCache(db, clock);
  const timing = {
    maxWaitSeconds: config.maxWaitSeconds,
    requestTimeoutSeconds: config.requestTimeoutSeconds,
  };
  const http = createHttpKit({
    budget,
    cache,
    clock,
    log,
    secrets: [tp.token, sa.key],
    syntheticAllowed: false,
    limits: {
      travelpayouts: travelpayoutsHttpLimits(tp.limits, config),
      searchapi: searchApiHttpLimits(sa.limits, timing),
      fx: fxHttpLimits(config),
    },
  });
  const providers = [
    travelpayoutsProvider({
      http,
      log,
      clock,
      token: tp.token,
      cacheTtlSeconds: tp.limits.cacheTtlHours * 3600,
      paramsAllowlist: TRAVELPAYOUTS_PARAMS,
    }),
    searchApiProvider({
      http,
      log,
      clock,
      key: sa.key,
      costPerCallMicroGbp: sa.limits.costPerCallMicroGbp,
      pointOfSale: config.pointOfSale,
      cacheTtlSeconds: sa.limits.cacheTtlHours * 3600,
      paramsAllowlist: SEARCHAPI_PARAMS,
    }),
  ];
  // why: the dated allowlist history lets a recording made before a parameter was added answer it (spec §5.2).
  const replay = replayHandlers(RECORDED_ROOT, { session, allowlists: loadParamsHistory(RECORDED_ROOT) });
  guardedServer.use(...replay.handlers);
  const deps: EngineDeps = {
    config,
    db,
    repos,
    budget,
    cache,
    http,
    providers,
    notifiers: [capturingNotifier([], [])],
    clock,
    log,
  };
  return { deps, db, repos, logs, misses: replay.misses, close: () => db.close() };
}

/** The recorded route and band as a definition: LHR → JFK, the recorded rectangle's nine departure days, 10–21 nights. */
export function recordedDefinition(patch: Partial<DefinitionInput> = {}): DefinitionInput {
  return {
    name: 'London to New York (layer B)',
    origins: [asIata('LHR')],
    destinations: [asIata('JFK')],
    window: { kind: 'absolute', from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-09') },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: {},
    verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: { maxCalls: 20, maxFreeCalls: 20, maxCostMicroGbp: 1_000_000 },
    providers: { discovery: ['travelpayouts', 'searchapi'], verification: [], discoveryRefreshHours: {} },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: 'Europe/London',
    enabled: true,
    ...patch,
  };
}

/** Polls until the execution leaves pending and running (real timers: replay answers at once). */
export async function settled(repos: Repos, executionId: string): Promise<Execution> {
  for (let i = 0; i < 2000; i += 1) {
    const e = repos.executions.get(executionId);
    if (e === null) throw new Error(`no execution ${executionId}`);
    if (e.status !== 'pending' && e.status !== 'running') return e;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`execution ${executionId} did not settle`);
}
