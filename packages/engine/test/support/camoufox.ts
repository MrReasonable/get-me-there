/**
 * A stub camoufox provider (id `camoufox`, sourceKind `scraped-self`) and a stub Travelpayouts beside it, run through
 * the real engine, the real db BudgetGuard and an in-memory database (WP14 Task 14.9), as WP7's error-table tests stub
 * providers. Each stub reserves and finalises its own ledger row per tile, as http-kit would, so the page caps and the
 * no-page rule are the guard's own. The worked example only: London Heathrow → New York JFK.
 */
import {
  asIsoDate,
  type CellOutcome,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type Execution,
  type FlightProvider,
  fixedClock,
  type OperatorMessage,
  type PreflightResult,
  ProviderError,
  type ProviderId,
  parseConfig,
  type SearchDefinition,
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
import { createHttpKit, planSingleCells } from '@gmt/providers';
import { vi } from 'vitest';
import { buildContext, type EngineContext } from '../../src/context.js';
import { createOrchestrator } from '../../src/orchestrator.js';
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

export const blockedError = (page: string): ProviderError =>
  new ProviderError({
    kind: 'blocked',
    retryable: false,
    providerId: 'camoufox',
    httpStatus: 423,
    message: `camoufox /v1/page: Google showed a bot check (CAPTCHA); cooling down until 2026-10-16T09:00:00.000Z [blocked:${page}]`,
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
}

function stub(
  id: ProviderId,
  sourceKind: 'scraped-self' | 'authorised-cached',
  o: { cells: number; failTile?: number; error?: ProviderError; preflight?: PreflightResult },
): Stub {
  let ctxOf: () => EngineContext = () => {
    throw new Error('stub not bound');
  };
  const calls: TilePlan[] = [];
  const queries: DiscoveryQuery[] = [];
  const fetchTile = async (
    plan: TilePlan,
    q: DiscoveryQuery,
    pctx: { executionId: string | null },
  ): Promise<DiscoveryTileResult> => {
    calls.push(plan);
    queries.push(q);
    const failing = o.failTile === plan.index && o.error !== undefined;
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
      prices: cell === undefined ? [] : [{ ...cell, amountMinor: 45_100, currency: 'GBP' }],
      noFares: [],
      notes: [],
    };
  };
  const preflight = o.preflight;
  return {
    id,
    displayName: id,
    suppliedFields: ['price'],
    cabins: ['economy'],
    calls,
    queries,
    cells: o.cells,
    bind: (f) => {
      ctxOf = f;
    },
    discovery: {
      info: { sourceKind, maxAgeHours: sourceKind === 'scraped-self' ? 0 : 48, provenanceNote: `${id} stub` },
      plan: planSingleCells,
      fetchTile,
      ...(preflight === undefined ? {} : { preflight: async () => preflight }),
    },
    healthcheck: async () => ({ ok: true, detail: 'stub' }),
  };
}
export const stubCamoufox = (o: Parameters<typeof stub>[2]): Stub => stub('camoufox', 'scraped-self', o);
export const stubTravelpayouts = (o: { cells: number }): Stub =>
  stub('travelpayouts', 'authorised-cached', o);

export interface CamoufoxEngine {
  ctx: EngineContext;
  definition: SearchDefinition;
  notifications: OperatorMessage[];
  logs: LogLine[];
  runToEnd(): Promise<Execution>;
  resume(executionId: string, o: { manual: boolean }): Promise<Execution>;
  tick(): Promise<{ resumed: boolean }>;
  ledgerRows(providerId: ProviderId): Array<{ pageClass: string | null; outcome: string }>;
}

export function engineWith(
  stubs: Stub[],
  o: { camoufoxConfigCap?: number; snapshotCap?: number; monthlyCap?: number; scheduleCron?: string } = {},
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
    },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const config = parsed.config;
  const clock = fixedClock(T0);
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
  const budget = new SqliteBudgetGuard(db, budgetConfigFromConfig(config), clock);
  const cache = new SqliteResponseCache(db, clock);
  const logs: LogLine[] = [];
  const log = capturingLogger(logs);
  const http = createHttpKit({ budget, cache, clock, log, secrets: [], syntheticAllowed: false, limits: {} });
  const notifications: OperatorMessage[] = [];
  const ctx = buildContext({
    config,
    db,
    repos,
    budget,
    cache,
    http,
    providers: stubs,
    notifiers: [capturingNotifier(notifications, [])],
    clock,
    log,
  });
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
    window: { kind: 'absolute', from: first, to: last },
    minNights: 10,
    maxNights: 10,
    providers: {
      discovery: ids,
      verification: [],
      discoveryRefreshHours: Object.fromEntries(ids.map((i) => [i, 168])),
    },
    scheduleCron: o.scheduleCron ?? null,
  });
  const settle = async (id: string): Promise<Execution> => {
    for (let i = 0; i < 2000; i++) {
      const e = repos.executions.get(id);
      if (e === null) throw new Error(`no execution ${id}`);
      if (e.status !== 'pending' && e.status !== 'running') return e;
      await new Promise((r) => setTimeout(r, 2));
    }
    throw new Error('execution did not settle');
  };
  return {
    ctx,
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
