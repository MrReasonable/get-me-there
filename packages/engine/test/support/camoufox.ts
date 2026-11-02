/**
 * A stub camoufox provider (id `camoufox`, sourceKind `scraped-self`) and a stub Travelpayouts beside it, run through
 * the real engine, the real db BudgetGuard and an in-memory database (WP14 Task 14.9), as WP7's error-table tests stub
 * providers. Each stub reserves and finalises its own ledger row per tile, as http-kit would, so the page caps and the
 * no-page rule are the guard's own. The worked example only: London Heathrow → New York JFK.
 */
import {
  AbortedError,
  asIsoDate,
  type BlockedPage,
  type Cabin,
  type CellOutcome,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type Execution,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  type FlightListQuery,
  type FlightListResult,
  type FlightProvider,
  fixedClock,
  flightRequestSeconds,
  GRID_HORIZON_DAYS,
  GRID_STEP_DAYS,
  GRID_TIMES,
  type IsoDateTime,
  listRequestSeconds,
  type OperatorMessage,
  type PreflightResult,
  type ProviderContext,
  ProviderError,
  type ProviderId,
  parseConfig,
  type SearchDefinition,
  Secret,
  systemClock,
  type TilePlan,
} from '@gmt/core';
import {
  applyMigrations,
  budgetConfigFromConfig,
  createRepos,
  MIGRATIONS_DIR,
  openDatabase,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import {
  camoufoxProvider,
  classifyWorkerAnswer,
  createHttpKit,
  gridTileEstimate,
  type HttpKit,
  planGridTiles,
  planSingleCells,
} from '@gmt/providers';
import type { ProviderLimiter } from '@gmt/providers/testing';
import { vi } from 'vitest';
import { buildContext, type EngineContext } from '../../src/context.js';
import { createOrchestrator, type Orchestrator } from '../../src/orchestrator.js';
import type { EngineDeps, EngineOptions, RankedDatePair } from '../../src/types.js';
import {
  baseDefinition,
  capturingLogger,
  capturingNotifier,
  JFK,
  LHR,
  type LogLine,
  T0,
  TEST_AIRPORTS,
} from './harness.js';

const KEY = 'test-camoufox-worker-key-0123456789abcdef';
/** The dataset's own names for the worked-example airports (packages/db/data), which the engine sends as airportNames. */
const AIRPORTS = {
  ...TEST_AIRPORTS,
  airports: TEST_AIRPORTS.airports.map((a) =>
    a.iata === LHR
      ? { ...a, name: 'London Heathrow Airport' }
      : a.iata === JFK
        ? { ...a, name: 'John F Kennedy International Airport' }
        : a,
  ),
};

/** A block as the real adapter's classifier makes it (fix round 1, arch I1: the engine reads what the adapter sends). */
export const blockedError = (page: BlockedPage): ProviderError =>
  classifyWorkerAnswer({
    status: 423,
    body: { kind: 'blocked', page, cooldownUntil: '2026-10-16T09:00:00.000Z' },
    headers: new Headers(),
    providerId: 'camoufox',
    endpointPath: '/v1/page',
  });
export const unavailableError = (): ProviderError =>
  new ProviderError({
    kind: 'provider-unavailable',
    retryable: false,
    providerId: 'camoufox',
    message: 'camoufox /v1/page: connection refused [connection-refused]',
  });
export const authError = (): ProviderError =>
  new ProviderError({
    kind: 'auth',
    retryable: false,
    providerId: 'camoufox',
    httpStatus: 401,
    message: 'camoufox /v1/page: the worker refused CAMOUFOX_WORKER_KEY [worker-key]',
  });

export interface Stub extends FlightProvider {
  calls: TilePlan[];
  queries: DiscoveryQuery[];
  cells: number;
  bind(ctx: () => EngineContext): void;
  /** Spec rev 55 §8.1: each flight-list read the engine asked for, in order (camoufox only). */
  flightCalls: FlightCall[];
  /** The flight pages that reached the worker: reserved in the ledger and answered (after the gate and the guard). */
  flightRequests: () => number;
}

/** One flight-list read as the stub saw it. */
export interface FlightCall {
  query: FlightListQuery;
  executionId: string | null;
  /** Whether the signal the engine passed was already aborted when the read began. */
  signalAborted: boolean;
  signal: AbortSignal;
  /** Whether the engine passed a gate (`beforeSend`). */
  gated: boolean;
}

/** Options of the stub flight-list capability (Task 20.9). */
export interface FlightStubOptions {
  /** The answer of the n-th read (1-based); a thrown value is thrown by the read; undefined: a list of one flight. */
  answer?: (q: FlightListQuery, n: number) => FlightListResult | undefined;
  /** Holds the n-th read after its ledger row is reserved until `until` settles or the signal aborts (AbortedError). */
  holdCall?: { call: number; until: Promise<void> };
  /** Called as the n-th read starts (before its gate), so a test can act while a page is in flight. */
  onStart?: (n: number) => void;
  /** Called as the n-th read's page settles (its answer about to be returned), so a test can record the order. */
  onEnd?: (n: number) => void;
  /** The cabins the capability reads (default economy). */
  cabins?: Cabin[];
  /**
   * Spec rev 56 §5.3: the pages the n-th read's answer states it loaded (`pagesLoaded`, finalised as the row's
   * `page_count`); default the pages reserved (2 with `returnLimits`, else 1), as the provider plans them.
   */
  pagesLoaded?: (q: FlightListQuery, n: number) => number;
}

/** The default answer: one flight read for the pair, priced as the worked example's grid price. */
export function listAnswer(at: IsoDateTime): Extract<FlightListResult, { kind: 'list' }> {
  return {
    kind: 'list',
    fetchedAt: at,
    pointOfSale: 'GB',
    listed: 'flights',
    flights: [
      {
        departsLocal: '10:15',
        arrivesLocal: '13:20',
        arrivesDayOffset: 0,
        durationMinutes: 485,
        stops: 0,
        carriers: ['Virgin Atlantic'],
        operatedBy: null,
        amountMinor: 45_100,
      },
    ],
    minMinor: 45_100,
    tabMinor: 45_100,
    cheapestView: 'cheapest',
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: 1,
    notes: [],
    returns: null,
  };
}

function stub(
  id: ProviderId,
  sourceKind: 'scraped-self' | 'authorised-cached',
  o: {
    cells: number;
    /** WP16a review R11: the cabins the stub sells (default economy only). */
    cabins?: Cabin[];
    failTile?: number;
    error?: ProviderError;
    /** WP16a: the first `failCalls` pages fail with `error` (whatever their index), the later ones answer. */
    failCalls?: number;
    /** WP16a: awaited before the page of this call number (1-based) answers, so a test can hold a page in flight. */
    holdCall?: { call: number; until: Promise<void> };
    /**
     * WP16a: every page goes through this limiter (the production createLimiter, shared by every run of the engine) and
     * takes `pageMs` of (fake) time once admitted; `pageStarts` records each admission.
     */
    limiter?: {
      run: ProviderLimiter['run'];
      pageMs: number;
      pageStarts: Array<{ executionId: string | null; at: number }>;
    };
    preflight?: PreflightResult;
    /** One preflight answer per run, in order (fix round 1, arch M3); the last repeats. */
    preflights?: PreflightResult[];
    /** Spec §2 rev 34: plan grid pages with the run's allowances (the real planner), not one page per cell. */
    grid?: { pageAllowance: number; scrollAllowance: number; scrollSeconds?: number };
    /** Spec rev 55 §5.1 (Task 20.9): a flight-list capability (camoufox only); absent: the provider has none. */
    flights?: FlightStubOptions;
    /** Task 20.9: called as the n-th grid or list page starts (before the engine's gate), to record the order of pages. */
    onTile?: (n: number) => void;
  },
): Stub {
  let ctxOf: () => EngineContext = () => {
    throw new Error('stub not bound');
  };
  const calls: TilePlan[] = [];
  const queries: DiscoveryQuery[] = [];
  const fetchTile = async (
    plan: TilePlan,
    q: DiscoveryQuery,
    pctx: { executionId: string | null; beforeSend?: () => void },
  ): Promise<DiscoveryTileResult> => {
    o.onTile?.(calls.length + 1);
    // why: as http-kit does, the engine's last check (ProviderContext.beforeSend) runs once the limiter admits the page
    // and before it is sent; an AbortedError from it means the worker is never asked
    if (o.limiter !== undefined) {
      const l = o.limiter;
      await l.run(
        async () => {
          pctx.beforeSend?.();
          l.pageStarts.push({ executionId: pctx.executionId, at: Date.now() });
          await new Promise((r) => setTimeout(r, l.pageMs));
        },
        {
          signal: new AbortController().signal,
          maxWaitMs: 86_400_000,
          providerId: id,
          endpointPath: '/v1/page',
        },
      );
    } else pctx.beforeSend?.();
    calls.push(plan);
    queries.push(q);
    if (o.holdCall !== undefined && calls.length === o.holdCall.call) await o.holdCall.until;
    const failing =
      (o.failTile === plan.index || calls.length <= (o.failCalls ?? 0)) && o.error !== undefined;
    // why: http-kit reserves before every attempt; a refused connection is a no-page row, a page answer a page row
    const r = ctxOf().budget.reserve({
      providerId: id,
      executionId: pctx.executionId,
      tileIndex: plan.index,
      costMicroGbp: 0,
      httpAttempt: 1,
      endpointPath: id === 'camoufox' ? '/v1/page' : '/aviasales/v3/prices_for_dates',
    });
    const noPage = failing && o.error?.kind === 'provider-unavailable';
    r.finalise({
      outcome: failing ? 'error' : 'ok',
      httpStatus: failing ? 423 : 200,
      durationMs: 1,
      ...(id === 'camoufox' ? { pageClass: noPage ? 'no-page' : 'page' } : {}),
    });
    if (failing && o.error !== undefined)
      return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error: o.error };
    const [cell] = plan.coveredCells;
    return {
      kind: 'tile',
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt: ctxOf().clock.now(),
      pointOfSale: id === 'camoufox' ? 'GB' : 'unknown',
      prices:
        cell === undefined
          ? []
          : [
              {
                ...cell,
                amountMinor: 45_100,
                currency: 'GBP',
                returnDateSource: 'asked',
                vendorPriceMark: null,
              },
            ],
      noFares: [],
      notes: [],
    };
  };
  const flightCalls: FlightCall[] = [];
  let flightRequests = 0;
  // why: as http-kit orders a call: the gate (beforeSend) once admitted, then the reservation (the guard's caps), then
  // the request; a hold models a page in flight, which an abort of the engine's signal ends with AbortedError
  const readFlights = async (q: FlightListQuery, pctx: ProviderContext): Promise<FlightListResult> => {
    const f = o.flights ?? {};
    const n = flightCalls.length + 1;
    flightCalls.push({
      query: q,
      executionId: pctx.executionId,
      signalAborted: pctx.signal.aborted,
      signal: pctx.signal,
      gated: pctx.beforeSend !== undefined,
    });
    f.onStart?.(n);
    pctx.beforeSend?.();
    // why: spec rev 56 §5.3: as the provider plans it, a request with a return phase reserves the worst case (2 pages)
    const pages =
      q.returnLimits === undefined || q.returnLimits === null ? 1 : FLIGHT_LIST_PAGES_PER_PAIR_MAX;
    const r = ctxOf().budget.reserve({
      providerId: id,
      executionId: pctx.executionId,
      tileIndex: null,
      costMicroGbp: 0,
      httpAttempt: 1,
      endpointPath: '/v1/flights',
      pages,
    });
    if (f.holdCall !== undefined && f.holdCall.call === n) {
      const signal = pctx.signal;
      await Promise.race([
        f.holdCall.until,
        new Promise<void>((_, reject) => {
          if (signal.aborted) reject(new AbortedError());
          signal.addEventListener('abort', () => reject(new AbortedError()), { once: true });
        }),
      ]).catch((err: unknown) => {
        // why: as http-kit finalises an abort (attempt.ts): `unknown`, no status, no stated pages (the guard keeps the
        // planned 2), and the page class camoufox's `pageClassOf` gives with no response, `page` (21.6 review I2)
        r.finalise({ outcome: 'unknown', durationMs: 1, pageClass: 'page' });
        throw err;
      });
    }
    const answer = f.answer?.(q, n) ?? listAnswer(ctxOf().clock.now());
    f.onEnd?.(n);
    r.finalise({
      outcome: answer.kind === 'list' ? 'ok' : 'error',
      httpStatus: 200,
      durationMs: 1,
      pageClass: 'page',
      pageCount: f.pagesLoaded?.(q, n) ?? pages,
    });
    flightRequests += 1;
    return answer;
  };
  const preflights = [...(o.preflights ?? [])];
  const preflight =
    o.preflight !== undefined
      ? async () => o.preflight ?? { ok: true as const }
      : preflights.length > 0
        ? async () => (preflights.length > 1 ? preflights.shift() : preflights[0]) ?? { ok: true as const }
        : undefined;
  return {
    id,
    displayName: id,
    suppliedFields: ['price'],
    cabins: o.cabins ?? ['economy'],
    calls,
    queries,
    cells: o.cells,
    flightCalls,
    flightRequests: () => flightRequests,
    bind: (f) => {
      ctxOf = f;
    },
    ...(o.flights === undefined
      ? {}
      : {
          flightLists: {
            info: {
              sourceKind: 'scraped-self' as const,
              maxAgeHours: 0,
              provenanceNote: 'camoufox flight-list stub',
            },
            cabins: o.flights.cabins ?? ['economy'],
            read: readFlights,
          },
        }),
    discovery: {
      info: { sourceKind, maxAgeHours: sourceKind === 'scraped-self' ? 0 : 48, provenanceNote: `${id} stub` },
      plan:
        o.grid === undefined
          ? planSingleCells
          : (q: DiscoveryQuery) => {
              const g = o.grid ?? { pageAllowance: 0, scrollAllowance: 0 };
              const pairs = Math.max(1, q.share?.pairs ?? 1);
              return planGridTiles(q, {
                stepDays: GRID_STEP_DAYS,
                scrollCap: 30,
                pageAllowance: Math.floor(g.pageAllowance / pairs),
                scrollAllowance: Math.floor(g.scrollAllowance / pairs),
                today: asIsoDate(T0.slice(0, 10)),
                horizonDays: GRID_HORIZON_DAYS,
                times: GRID_TIMES,
              });
            },
      fetchTile,
      ...(o.grid === undefined
        ? {}
        : {
            interleavePairs: true as const,
            estimateTile: (t: TilePlan) =>
              gridTileEstimate(t, {
                ...GRID_TIMES,
                scrollSeconds: o.grid?.scrollSeconds ?? GRID_TIMES.scrollSeconds,
              }),
          }),
      ...(preflight === undefined ? {} : { preflight }),
    },
    healthcheck: async () => ({ ok: true, detail: 'stub' }),
  };
}
export const stubCamoufox = (o: Parameters<typeof stub>[2]): Stub => stub('camoufox', 'scraped-self', o);

/**
 * WP16a: a SearchApi with only a verification capability, which fails the test if it is ever asked (the catch-up tests
 * never reach verification). Its config needs SEARCHAPI_KEY and the 40usd plan (the trial is excluded from schedules).
 */
export function stubSearchApiVerification(): Stub {
  return {
    id: 'searchapi',
    displayName: 'searchapi',
    suppliedFields: ['price'],
    cabins: ['economy'],
    calls: [],
    queries: [],
    cells: 0,
    flightCalls: [],
    flightRequests: () => 0,
    bind: () => undefined,
    verification: {
      info: { sourceKind: 'scraped-search', maxAgeHours: 0, provenanceNote: 'searchapi stub' },
      estimate: () => ({ calls: 5, costMicroGbp: 0, seconds: 10, notes: [] }),
      search: async () => {
        throw new Error('the SearchApi stub was asked to search');
      },
    },
    healthcheck: async () => ({ ok: true, detail: 'stub' }),
  };
}
export const stubTravelpayouts = (o: Parameters<typeof stub>[2]): Stub =>
  stub('travelpayouts', 'authorised-cached', o);

/**
 * Fix round 1 (prov I3): the real camoufox adapter over a scripted HttpKit. Each request reserves and finalises one
 * ledger row as http-kit would, then answers the next scripted worker answer (a non-200 goes through the real
 * classifyWorkerAnswer), so the engine stores exactly what the adapter makes of the worker's answers.
 */
export function realCamoufox(
  answers: Array<{ status: number; body: unknown }>,
  cells: number,
  /** WP15 fix round 1 (TS 4): the real adapter in grid mode, with the run's page and scroll caps. */
  grid?: {
    executionPageCap: number;
    executionScrollCap: number;
    scrollCap?: number;
    scrollSpacingSeconds?: number;
    pageTimeoutSeconds?: number;
  },
): Stub {
  let ctxOf: () => EngineContext = () => {
    throw new Error('stub not bound');
  };
  const queue = [...answers];
  const http: HttpKit = {
    request: async (r) => {
      const a = queue.shift() ?? { status: 599, body: {} };
      const res = ctxOf().budget.reserve({
        providerId: 'camoufox',
        executionId: r.executionId,
        tileIndex: r.tileIndex,
        costMicroGbp: 0,
        httpAttempt: 1,
        endpointPath: r.endpointPath,
        ...(r.scrolls === undefined ? {} : { scrolls: r.scrolls }),
      });
      const scrolls = Reflect.get(Object(a.body), 'scrolls');
      res.finalise({
        outcome: a.status === 200 ? 'ok' : 'error',
        httpStatus: a.status,
        durationMs: 1,
        pageClass: 'page',
        ...(typeof scrolls === 'number' ? { scrollCount: scrolls } : {}),
      });
      if (a.status !== 200)
        throw classifyWorkerAnswer({
          status: a.status,
          body: a.body,
          headers: new Headers(),
          providerId: 'camoufox',
          endpointPath: r.endpointPath,
        });
      return { status: 200, body: a.body, fetchedAt: ctxOf().clock.now(), fromCache: false, cacheKey: '' };
    },
    stats: () => ({ inFlight: 0 }),
    // why: spec rev 56 §5.3: the stub answers at once; no flights answer here states nextLoadNotBefore (Task 21.6's)
    holdUntil: () => undefined,
  };
  const calls: TilePlan[] = [];
  const queries: DiscoveryQuery[] = [];
  const real = camoufoxProvider({
    http,
    log: capturingLogger([]),
    clock: fixedClock(T0),
    key: new Secret(KEY),
    workerUrl: 'http://127.0.0.1:8090',
    pointOfSale: 'GB',
    // why: spec rev 56 §12: core's computation at the defaults (90 s page timeout, 30 s spacing)
    flightRequestSeconds: {
      booking: flightRequestSeconds(90, 30, true),
      returnsOnly: flightRequestSeconds(90, 30, false),
      outboundOnly: listRequestSeconds(90),
    },
    ...(grid === undefined
      ? {}
      : {
          grid: {
            mode: 'grid' as const,
            scrollCap: 30,
            scrollSpacingSeconds: 5,
            pageTimeoutSeconds: 90,
            ...grid,
          },
          scrollsLeft: (executionId: string | null) => ctxOf().budget.scrollsLeft('camoufox', executionId),
        }),
  });
  const discovery = real.discovery;
  if (discovery === undefined) throw new Error('camoufox has discovery');
  return {
    ...real,
    calls,
    queries,
    cells,
    flightCalls: [],
    flightRequests: () => 0,
    bind: (f) => {
      ctxOf = f;
    },
    discovery: {
      info: discovery.info,
      plan: discovery.plan,
      fetchTile: (plan, q, pctx) => {
        calls.push(plan);
        queries.push(q);
        return discovery.fetchTile(plan, q, pctx);
      },
      ...(discovery.estimateTile === undefined ? {} : { estimateTile: discovery.estimateTile }),
      ...(discovery.interleavePairs === undefined ? {} : { interleavePairs: discovery.interleavePairs }),
    },
  };
}

export interface CamoufoxEngine {
  ctx: EngineContext;
  /** The deps the context was built from, for a full `createEngine` (boot, the minute job, croner). */
  deps: EngineDeps;
  /** The engine's clock: fixed at T0 unless `systemClock`, which moves the faked system time. */
  clock: ReturnType<typeof fixedClock>;
  orch: Orchestrator;
  definition: SearchDefinition;
  notifications: OperatorMessage[];
  logs: LogLine[];
  runToEnd(): Promise<Execution>;
  resume(executionId: string, o: { manual: boolean }): Promise<Execution>;
  /** Waits for an execution to leave pending/running; throws when it does not settle (never falls through). */
  settled(executionId: string): Promise<Execution>;
  /** The orchestrator's own answer to a resume (fix round 1). */
  resumeResult(
    executionId: string,
    o: { manual: boolean },
  ): ReturnType<ReturnType<typeof createOrchestrator>['resume']>;
  tick(): Promise<{ resumed: boolean }>;
  ledgerRows(providerId: ProviderId): Array<{ pageClass: string | null; outcome: string }>;
}

export function engineWith(
  stubs: Stub[],
  o: {
    camoufoxConfigCap?: number;
    snapshotCap?: number;
    monthlyCap?: number;
    scheduleCron?: string;
    /** Every operator notice fails to send (fix round 1, arch M4). */
    notifierFails?: boolean;
    /** The definition's free-call cap (fix round 2: a pause for another cap while camoufox has pages left). */
    maxFreeCalls?: number;
    /** More of the app's environment (WP15 fix round 1: STUCK_AFTER_HOURS, the scroll caps). */
    env?: Record<string, string>;
    /** WP16a: the engine reads the faked system time (vi.useFakeTimers must be on), so croner and the engine agree. */
    systemClock?: boolean;
    /** WP16a: the definition's window (default: absolute from 2026-11-02, one departure day per cell). */
    window?: SearchDefinition['window'];
    /** WP16a: the definition's verification providers (default none). */
    verification?: ProviderId[];
    /** WP16a: when the definition is created (default: the clock's start). */
    createdAt?: IsoDateTime;
    /** WP16a: the clock's start (default T0). */
    now?: IsoDateTime;
    /**
     * Task 20.9: the board's ranking the flight-list step reads (EngineOptions.rankedDatePairs); `rankedPairs` builds
     * one over the definition's own space.
     */
    rankedDatePairs?: EngineOptions['rankedDatePairs'];
    /** Task 20.9: the definition's cabin (default economy). */
    cabin?: Cabin;
    /** Spec rev 56 §8.1: freeze this flight allowance into each new execution's snapshot (an older snapshot's 10). */
    flightListPages?: number;
  } = {},
): CamoufoxEngine {
  const parsed = parseConfig(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      TRAVELPAYOUTS_TOKEN: 'test-travelpayouts-token-0123456789abcdef',
      CAMOUFOX_ENABLED: 'true',
      CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
      CAMOUFOX_WORKER_KEY: KEY,
      CAMOUFOX_EXECUTION_PAGE_CAP: String(o.camoufoxConfigCap ?? 100),
      ...(o.monthlyCap === undefined ? {} : { CAMOUFOX_MONTHLY_PAGE_CAP: String(o.monthlyCap) }),
      ...o.env,
    },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const config = parsed.config;
  const fixed = fixedClock(o.createdAt ?? o.now ?? T0);
  const clock: ReturnType<typeof fixedClock> =
    o.systemClock === true
      ? {
          now: () => systemClock.now(),
          todayLondon: () => systemClock.todayLondon(),
          advance: (ms) => vi.setSystemTime(new Date(Date.now() + ms)),
          set: (at) => vi.setSystemTime(new Date(at)),
        }
      : fixed;
  if (o.systemClock === true) clock.set(o.createdAt ?? o.now ?? T0);
  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const repos = createRepos(db, clock, { allowSynthetic: false });
  repos.airports.upsertAll(AIRPORTS);
  if (o.snapshotCap !== undefined) {
    const cap = o.snapshotCap;
    const create = repos.executions.create.bind(repos.executions);
    // why: the guard must read the page cap from the snapshot, never from config: freeze a different one than config's
    repos.executions.create = (input) =>
      create({
        ...input,
        snapshot: {
          ...input.snapshot,
          budget: { ...input.snapshot.budget, providerMaxCalls: { camoufox: cap } },
        },
      });
  }
  if (o.flightListPages !== undefined) {
    const pages = o.flightListPages;
    const create = repos.executions.create.bind(repos.executions);
    repos.executions.create = (input) =>
      create({
        ...input,
        snapshot: { ...input.snapshot, budget: { ...input.snapshot.budget, flightListPages: pages } },
      });
  }
  const budget = new SqliteBudgetGuard(db, budgetConfigFromConfig(config), clock);
  const cache = new SqliteResponseCache(db, clock);
  const logs: LogLine[] = [];
  const log = capturingLogger(logs);
  const http = createHttpKit({ budget, cache, clock, log, secrets: [], syntheticAllowed: false, limits: {} });
  const notifications: OperatorMessage[] = [];
  const deps: EngineDeps = {
    config,
    db,
    repos,
    budget,
    cache,
    http,
    providers: stubs,
    notifiers: [
      o.notifierFails === true
        ? { id: 'failing', send: async () => ({ ok: false, detail: 'smtp down' }) }
        : capturingNotifier(notifications, []),
    ],
    clock,
    log,
  };
  const ctx = buildContext(
    deps,
    o.rankedDatePairs === undefined ? {} : { rankedDatePairs: o.rankedDatePairs },
  );
  for (const s of stubs) s.bind(() => ctx);
  const orch = createOrchestrator(ctx);
  const cells = Math.max(...stubs.map((s) => s.cells));
  const first = asIsoDate('2026-11-02');
  const last = asIsoDate(
    new Date(Date.parse(`${first}T00:00:00.000Z`) + (cells - 1) * 86_400_000).toISOString().slice(0, 10),
  );
  const ids = stubs.map((s) => s.id);
  const definition = repos.definitions.create({
    ...baseDefinition(),
    ...(o.maxFreeCalls === undefined
      ? {}
      : { budget: { ...baseDefinition().budget, maxFreeCalls: o.maxFreeCalls } }),
    window: o.window ?? { kind: 'absolute', from: first, to: last },
    minNights: 10,
    maxNights: 10,
    ...(o.cabin === undefined ? {} : { cabin: o.cabin }),
    providers: {
      discovery: ids.filter((i) => stubs.find((s) => s.id === i)?.discovery !== undefined),
      verification: o.verification ?? [],
      discoveryRefreshHours: Object.fromEntries(ids.map((i) => [i, 168])),
    },
    scheduleCron: o.scheduleCron ?? null,
  });
  if (o.createdAt !== undefined && o.now !== undefined) clock.set(o.now);
  const settle = async (id: string): Promise<Execution> => {
    for (let i = 0; i < 2000; i++) {
      const e = repos.executions.get(id);
      if (e === null) throw new Error(`no execution ${id}`);
      if (e.status !== 'pending' && e.status !== 'running') return e;
      // why: under fake timers (WP16a's croner tests) a real wait would never let the pass's timers run
      await (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(2) : new Promise((r) => setTimeout(r, 2)));
    }
    throw new Error('execution did not settle');
  };
  return {
    ctx,
    deps,
    clock,
    orch,
    definition,
    notifications,
    logs,
    runToEnd: async () => {
      const r = await orch.start(definition.id, {
        trigger: 'manual',
        confirmCostPence: 1_000_000,
        confirmCalls: 1_000_000,
      });
      if (!r.ok) throw new Error(`refused: ${r.message}`);
      return settle(r.executionId);
    },
    resume: async (id, ro) => {
      const r = await orch.resume(id, ro);
      if (!r.ok) {
        const e = repos.executions.get(id);
        if (e === null) throw new Error('gone');
        return e;
      }
      return settle(id);
    },
    resumeResult: (id, ro) => orch.resume(id, ro),
    settled: (id) => settle(id),
    tick: async () => {
      const before = repos.executions.activeParent(definition.id);
      await orch.tick(definition.id);
      const after = before === null ? null : repos.executions.get(before.id);
      return { resumed: before !== null && after !== null && after.status !== before.status };
    },
    ledgerRows: (providerId) =>
      db.raw
        .prepare<[string], { pageClass: string | null; outcome: string }>(
          'SELECT page_class AS pageClass, outcome FROM provider_requests WHERE provider_id = ? ORDER BY id',
        )
        .all(providerId),
  };
}

export function outcomes(
  e: CamoufoxEngine,
  executionId: string,
  providerId: ProviderId,
): Array<CellOutcome & { reason: string | null }> {
  return e.ctx.repos.cells.outcomes(executionId, { stage: 'discovery', providerId });
}

/** Keeps vitest's fake timers out of these tests (the stubs answer at once). */
export function realTime(): void {
  vi.useRealTimers();
}

/**
 * Task 20.9: a ranking of the first `n` date pairs of the engineWith definition's space (one departure a day from
 * 2 Nov 2026, ten nights, London Heathrow to New York JFK), cheapest first, priced by camoufox; `calls` records each ask.
 */
export function rankedPairs(
  n: number,
  calls: Array<Parameters<NonNullable<EngineOptions['rankedDatePairs']>>[0]> = [],
): NonNullable<EngineOptions['rankedDatePairs']> {
  return (q) => {
    calls.push(q);
    return Array.from({ length: n }, (_, i): RankedDatePair => {
      const dep = Date.parse('2026-11-02T00:00:00.000Z') + i * 86_400_000;
      return {
        departureDate: asIsoDate(new Date(dep).toISOString().slice(0, 10)),
        returnDate: asIsoDate(new Date(dep + 10 * 86_400_000).toISOString().slice(0, 10)),
        origin: LHR,
        destination: JFK,
        pricePence: 40_000 + i,
        providerId: 'camoufox',
        sourceKind: 'scraped-self',
      };
    });
  };
}

/** A promise with its settlers, for holding a page or a read in flight (event-driven tests: never a timer). */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The flight-list rows of an execution (spec rev 55 §7 `flight_lists`), oldest first. */
export function flightRows(
  e: CamoufoxEngine,
  executionId: string | null,
): Array<{
  status: string;
  reason: string | null;
  departureDate: string;
  executionId: string | null;
  listed: string | null;
}> {
  return e.ctx.db.raw
    .prepare<
      [string | null],
      {
        status: string;
        reason: string | null;
        departureDate: string;
        executionId: string | null;
        listed: string | null;
      }
    >(
      `SELECT status, reason, departure_date AS departureDate, execution_id AS executionId, listed FROM flight_lists
        WHERE execution_id IS ? ORDER BY id`,
    )
    .all(executionId);
}

/** The `/v1/flights` page rows of an execution (an aborted request's no-page row is not a page, as the guard counts). */
export function flightLedger(e: CamoufoxEngine, executionId: string | null): number {
  return (
    e.ctx.db.raw
      .prepare<[string | null], { n: number }>(
        `SELECT count(*) AS n FROM provider_requests
          WHERE endpoint_path = '/v1/flights' AND page_class = 'page' AND execution_id IS ?`,
      )
      .get(executionId)?.n ?? 0
  );
}
