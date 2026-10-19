import {
  asIsoDateTime,
  type BudgetExceeded,
  type BudgetGuard,
  type BudgetScope,
  fixedClock,
  type IsoDateTime,
  type Logger,
  type ProviderId,
  type Reservation,
  type ResponseCache,
  Secret,
  type Usage,
} from '@gmt/core';
import { classifyWorkerAnswer } from '../src/camoufox/answer.js';
import { pageClassOf, scrollCountOf } from '../src/camoufox/limits.js';
import { createHttpKit } from '../src/http/httpKit.js';
import type {
  FixtureRecorder,
  HttpKitRequest,
  HttpProviderId,
  ProviderHttpLimits,
} from '../src/http/types.js';
import { server } from './support/msw.js';

type ReserveParams = Parameters<BudgetGuard['reserve']>[0];
type FinaliseParams = Parameters<Reservation['finalise']>[0];

/** One entry of the shared, ordered log of ledger calls and upstream fetches. */
export type LedgerEvent =
  | ({ type: 'reserve'; at: number } & ReserveParams)
  | ({ type: 'finalise'; at: number } & FinaliseParams)
  | {
      type: 'cache-hit';
      at: number;
      providerId: ProviderId;
      executionId: string | null;
      tileIndex: number | null;
      endpointPath: string;
    }
  | { type: 'fetch'; at: number; url: string; method: string; headers: Record<string, string> };

interface Row {
  id: string;
  providerId: ProviderId;
  executionId: string | null;
  outcome: 'pending' | 'ok' | 'error' | 'unknown';
  httpStatus: number | undefined;
  /** camoufox's page class from finalise (spec §5.3 rev 32); undefined for every other provider. */
  pageClass: 'page' | 'no-page' | undefined;
  /** camoufox grid (spec §7 rev 34): the planned scrolls at reserve, then the scrolls the answer stated (or none). */
  scrolls: number | undefined;
  scrollCount: number | undefined;
}

/** Every FakeBudget built by makeKit; test/support/setup.ts asserts none holds an open reservation after a test. */
export const liveBudgets: FakeBudget[] = [];

/**
 * In-memory BudgetGuard implementing the spec §5.1 port. The real one is WP3's SqliteBudgetGuard. This fake
 * records every call in order, models the spec §5.3 cap predicate in `usage`, refuses on demand, rejects a
 * double finalise, and reports reservations never finalised.
 */
export class FakeBudget implements BudgetGuard {
  reserveCalls = 0;
  /** Return a BudgetExceeded to refuse that reservation (e.g. only when p.httpAttempt === 2). */
  refuse: ((p: ReserveParams) => BudgetExceeded | null) | null = null;
  /** `${scope.kind}:${providerId}` → cap in calls. */
  readonly caps = new Map<string, number>();
  /** Seed for recentCalls (ledger rows in the last hour), per provider. */
  readonly recent = new Map<ProviderId, number>();
  /** Every `since` recentCalls was asked about (test-r2-004). */
  readonly recentSince: IsoDateTime[] = [];
  readonly rows: Row[] = [];
  constructor(
    readonly events: LedgerEvent[],
    private readonly billed: ReadonlySet<ProviderId> = new Set<ProviderId>(['searchapi', 'fixture']),
  ) {}

  reserve(p: ReserveParams): Reservation {
    this.reserveCalls += 1;
    const refusal = this.refuse?.(p) ?? null;
    if (refusal !== null) throw refusal;
    const row: Row = {
      id: `res-${this.reserveCalls}`,
      providerId: p.providerId,
      executionId: p.executionId,
      outcome: 'pending',
      httpStatus: undefined,
      pageClass: undefined,
      scrolls: p.scrolls,
      scrollCount: undefined,
    };
    this.rows.push(row);
    this.events.push({ type: 'reserve', at: Date.now(), ...p });
    return {
      id: row.id,
      finalise: (r) => {
        if (row.outcome !== 'pending') throw new Error(`reservation ${row.id} finalised twice`);
        row.outcome = r.outcome;
        row.httpStatus = r.httpStatus;
        row.pageClass = r.pageClass;
        row.scrollCount = r.scrollCount;
        this.events.push({ type: 'finalise', at: Date.now(), ...r });
      },
    };
  }

  recordCacheHit(p: {
    providerId: ProviderId;
    executionId: string | null;
    tileIndex: number | null;
    endpointPath: string;
  }): void {
    this.events.push({ type: 'cache-hit', at: Date.now(), ...p });
  }

  /** Spec §5.3: billed vendors count pending, unknown, or ok with HTTP 200; free vendors count every non-cache row. */
  private counted(r: Row): boolean {
    if (!this.billed.has(r.providerId)) return true;
    return r.outcome === 'pending' || r.outcome === 'unknown' || (r.outcome === 'ok' && r.httpStatus === 200);
  }

  usage(scope: BudgetScope): Usage {
    const window = { windowStart: null, windowEnd: null };
    let rows: Row[] = [];
    let cap: number | null = null;
    if (scope.kind === 'provider-month' || scope.kind === 'provider-lifetime') {
      rows = this.rows.filter((r) => r.providerId === scope.providerId && this.counted(r));
      cap = this.caps.get(`${scope.kind}:${scope.providerId}`) ?? null;
    } else if (scope.kind === 'execution-calls') {
      rows = this.rows.filter(
        (r) => r.executionId === scope.executionId && this.billed.has(r.providerId) && this.counted(r),
      );
    } else if (scope.kind === 'execution-free-calls') {
      rows = this.rows.filter((r) => r.executionId === scope.executionId && !this.billed.has(r.providerId));
    }
    return { calls: rows.length, costMicroGbp: 0, cap, windowUsed: true, ...window };
  }

  scrollsLeft(): number | null {
    return null;
  }
  recentCalls(providerId: ProviderId, since: IsoDateTime): number {
    // why: tests seed the count directly and assert the window through recentSince (WP3 filters started_at >= since).
    this.recentSince.push(since);
    return this.recent.get(providerId) ?? 0;
  }

  /** One provider's rows in reserve order. */
  rowsOf(providerId: ProviderId): Row[] {
    return this.rows.filter((r) => r.providerId === providerId);
  }

  /** Reservation ids never finalised. */
  open(): string[] {
    return this.rows.filter((r) => r.outcome === 'pending').map((r) => r.id);
  }

  /** Event types in order, finalise suffixed with its outcome: ['reserve', 'fetch', 'finalise:ok']. */
  sequence(): string[] {
    return this.events.map((e) => (e.type === 'finalise' ? `finalise:${e.outcome}` : e.type));
  }

  count(type: LedgerEvent['type']): number {
    return this.events.filter((e) => e.type === type).length;
  }
}

/** In-memory ResponseCache implementing the spec §5.1 port (the real one is WP3's SqliteResponseCache). */
export class FakeCache implements ResponseCache {
  readonly entries = new Map<string, { body: unknown; storedAt: IsoDateTime; ttlSeconds: number }>();
  readonly sets: Array<{ key: string; body: unknown; ttlSeconds: number; storedAt: IsoDateTime }> = [];
  get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined {
    const e = this.entries.get(key);
    return e ? { body: e.body, storedAt: e.storedAt } : undefined;
  }
  set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void {
    this.entries.set(key, { body, storedAt, ttlSeconds });
    this.sets.push({ key, body, ttlSeconds, storedAt });
  }
}

/** Logger that keeps every line in JSON form, so a test can search all of them for a sentinel. */
export class CapturingLogger implements Logger {
  constructor(
    readonly lines: string[] = [],
    private readonly bindings: object = {},
  ) {}
  private write(level: string, o: object, msg?: string): void {
    this.lines.push(JSON.stringify({ level, ...this.bindings, ...o, msg }));
  }
  debug(o: object, msg?: string): void {
    this.write('debug', o, msg);
  }
  info(o: object, msg?: string): void {
    this.write('info', o, msg);
  }
  warn(o: object, msg?: string): void {
    this.write('warn', o, msg);
  }
  error(o: object, msg?: string): void {
    this.write('error', o, msg);
  }
  child(bindings: object): Logger {
    return new CapturingLogger(this.lines, { ...this.bindings, ...bindings });
  }
}

/** Fake values for every secret the app holds (spec §5.3 sentinel-key test). */
export const SENTINELS = {
  searchapi: new Secret('test-searchapi-key-0123456789abcdef'),
  travelpayouts: new Secret('test-travelpayouts-token-0123456789abcdef'),
  // why: reserved characters make its URL-encoded, form-encoded and base64url forms differ from the raw value (test-r2-003).
  smtp: new Secret('test-smtp-pass/0123+4567 89abcdef'),
  basicAuth: new Secret('test-basic-auth-pass-0123456789abcdef'),
  camoufox: new Secret('test-camoufox-worker-key-0123456789abcdef'),
};
export const ALL_SECRETS: Secret[] = [
  SENTINELS.searchapi,
  SENTINELS.travelpayouts,
  SENTINELS.smtp,
  SENTINELS.basicAuth,
  SENTINELS.camoufox,
];

export const SEARCH = 'https://www.searchapi.io/api/v1/search';
export const TP = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

export type LimitOverrides = Partial<Record<HttpProviderId, Partial<ProviderHttpLimits>>>;

/** Limits for every id; generous rates so only tests that target the limiter ever queue. */
export function testLimits(over: LimitOverrides = {}): Record<HttpProviderId, ProviderHttpLimits> {
  const base = {
    ratePerMinute: 600,
    ratePerHour: 36_000,
    concurrency: 4,
    maxWaitSeconds: 3900,
    requestTimeoutSeconds: 60,
  };
  return {
    searchapi: {
      ...base,
      hosts: ['www.searchapi.io'],
      billable: 'http-200',
      costPerCallMicroGbp: 0,
      ...over.searchapi,
    },
    travelpayouts: {
      ...base,
      hosts: ['api.travelpayouts.com'],
      billable: 'never',
      costPerCallMicroGbp: 0,
      rateLimitFallbackWaitSeconds: 60,
      ...over.travelpayouts,
    },
    // why: the worker's own rules (camoufoxHttpLimits) at the test rates, so the adapter tests exercise them.
    camoufox: {
      ...base,
      hosts: ['127.0.0.1'],
      workerPort: 8090,
      workerScheme: 'http:',
      billable: 'never',
      costPerCallMicroGbp: 0,
      concurrency: 1,
      requestTimeoutSeconds: 105,
      retryTransport: false,
      connectRefusedKind: 'provider-unavailable',
      pageClass: pageClassOf,
      scrollCountOf,
      classifyError: classifyWorkerAnswer,
      ...over.camoufox,
    },
    'camoufox-status': {
      ...base,
      hosts: ['127.0.0.1'],
      workerPort: 8090,
      workerScheme: 'http:',
      billable: 'never',
      costPerCallMicroGbp: 0,
      concurrency: 1,
      requestTimeoutSeconds: 10,
      retryTransport: false,
      connectRefusedKind: 'provider-unavailable',
      ...over['camoufox-status'],
    },
    fixture: {
      ...base,
      hosts: ['fixture.local'],
      billable: 'http-200',
      costPerCallMicroGbp: 3200,
      ...over.fixture,
    },
    fx: { ...base, hosts: ['api.frankfurter.dev'], billable: 'never', costPerCallMicroGbp: 0, ...over.fx },
  };
}

export interface KitOptions {
  limits?: Partial<Record<HttpProviderId, ProviderHttpLimits>>;
  overrides?: LimitOverrides;
  secrets?: Secret[];
  recorder?: FixtureRecorder;
  inProcessHosts?: Record<string, (req: Request) => Promise<Response>>;
  syntheticAllowed?: boolean;
  budget?: FakeBudget;
}

/** A kit wired to the fakes; every upstream request msw sees is appended to `events` as 'fetch'. */
export function makeKit(o: KitOptions = {}) {
  const events: LedgerEvent[] = o.budget?.events ?? [];
  const budget = o.budget ?? new FakeBudget(events);
  const cache = new FakeCache();
  const log = new CapturingLogger();
  const clock = fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z'));
  server.events.on('request:start', ({ request }) => {
    events.push({
      type: 'fetch',
      at: Date.now(),
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    });
  });
  const kit = createHttpKit({
    budget,
    cache,
    limits: o.limits ?? testLimits(o.overrides),
    clock,
    log,
    secrets: o.secrets ?? ALL_SECRETS,
    syntheticAllowed: o.syntheticAllowed ?? true,
    ...(o.recorder ? { recorder: o.recorder } : {}),
    ...(o.inProcessHosts ? { inProcessHosts: o.inProcessHosts } : {}),
  });
  liveBudgets.push(budget);
  return { kit, budget, cache, log, clock, events };
}

/** A SearchApi-shaped request with the key in the Authorization header (spec §2 fact 8). */
export function req(p: Omit<Partial<HttpKitRequest>, 'url'> & { url: string }): HttpKitRequest {
  const url = new URL(p.url);
  return {
    providerId: 'searchapi',
    executionId: 'exec-1',
    tileIndex: 0,
    endpointPath: url.pathname,
    method: 'GET',
    headers: { authorization: `Bearer ${SENTINELS.searchapi.reveal()}` },
    cache: 'never',
    signal: new AbortController().signal,
    recordFixtures: false,
    ...p,
    url,
  };
}
