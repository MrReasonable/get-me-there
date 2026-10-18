import type {
  BudgetGuard,
  Clock,
  IsoDateTime,
  Logger,
  ProviderError,
  ProviderId,
  ResponseCache,
  Secret,
} from '@gmt/core';

/**
 * Every id http-kit serves: the providers plus the never-ledgered FX refresh (spec §4, §5.3) and the camoufox worker's
 * status route (`camoufox-status`, spec §5.3 rev 32: the unledgered preflight, GET /v1/status only).
 */
export type HttpProviderId = ProviderId | 'fx' | 'camoufox-status';
/** The ids http-kit never ledgers: no reservation, no cache-hit row, no hourly seed from the ledger. */
export const UNLEDGERED_IDS: ReadonlySet<HttpProviderId> = new Set<HttpProviderId>(['fx', 'camoufox-status']);
/**
 * The id a ProviderError carries (core's port knows the providers and 'fx'): the worker's status route is camoufox's.
 */
export function errorProviderId(id: HttpProviderId): ProviderId | 'fx' {
  return id === 'camoufox-status' ? 'camoufox' : id;
}
/** Narrows an id to a ledgered ProviderId (every id but the unledgered ones). */
export function ledgeredId(id: HttpProviderId): ProviderId | null {
  return id === 'fx' || id === 'camoufox-status' ? null : id;
}

/** What a classifier sees about one non-2xx response (plan http-kit block). `body` and header values are scrubbed. */
export interface ResponseFacts {
  status: number;
  body: unknown;
  headers: Headers;
  providerId: HttpProviderId;
  endpointPath: string;
}

/**
 * Per-provider HTTP policy, built from `Config` by WP4b's wiring (spec §5.3): hostname allowlist, chained
 * per-hour and per-minute reservoirs with `maxConcurrent`, the queue deadline, the per-request timeout.
 */
export interface ProviderHttpLimits {
  hosts: string[];
  ratePerMinute: number;
  ratePerHour: number;
  concurrency: number;
  /** In http-kit this governs only timeout and failed-body-read retryability; the ledger's billable flag is WP3's. */
  billable: 'http-200' | 'never';
  costPerCallMicroGbp: number;
  maxWaitSeconds: number;
  requestTimeoutSeconds: number;
  /** Wait for a 429 without Retry-After (Travelpayouts 60). Absent: such a 429 is non-retryable with a retry time at the hourly window. */
  rateLimitFallbackWaitSeconds?: number;
  /** Consulted first for a non-2xx response; `undefined` falls through to the default spec §5.2 table. */
  classifyError?: (f: ResponseFacts) => ProviderError | undefined;
  /**
   * When set, the limiter's minTime (start to start), in place of ceil(60000 / ratePerMinute) (decision 69 ruling 7):
   * camoufox's spacing taken directly, so the app's starts are never closer than the worker's.
   */
  minIntervalMs?: number;
  /** The camoufox worker's explicit port and scheme (spec §12 rev 32): egress requires exactly these. */
  workerPort?: number;
  workerScheme?: 'http:' | 'https:';
  /**
   * `false`: a timeout, a dropped socket or a failed body read is never retried (cost-001, PIE-07): one camoufox tile
   * never costs two Google loads.
   */
  retryTransport?: false;
  /**
   * A connection refused before any byte was sent (ECONNREFUSED or EHOSTUNREACH, read from the fetch error's
   * `cause.code`, never its message) becomes this kind, non-retryable (decision 69 "worker absent").
   */
  connectRefusedKind?: 'provider-unavailable';
  /**
   * Whether an attempt loaded a page, passed to `reservation.finalise` (spec §5.3 rev 32). `status` and `headers` are
   * null when no response arrived; a refused connection is `no-page` whatever this says, a timeout after sending is
   * whatever this says for a null response.
   */
  pageClass?: (f: { status: number | null; headers: Headers | null }) => 'page' | 'no-page';
}

/** What createHttpKit needs (spec §5.3 rev 11). */
export interface HttpKitDeps {
  budget: BudgetGuard;
  cache: ResponseCache;
  /** Limits per enabled id; a request for an id without limits is refused by egress. */
  limits: Partial<Record<HttpProviderId, ProviderHttpLimits>>;
  clock: Clock;
  log: Logger;
  /** Every configured secret; non-empty whenever a real provider is configured. */
  secrets: Secret[];
  /** syntheticAllowed(config), computed by wiring; required true for inProcessHosts or limits.fixture. */
  syntheticAllowed: boolean;
  recorder?: FixtureRecorder;
  /** The one transport seam: a request whose hostname is a key here is dispatched in process (fixture.local only). */
  inProcessHosts?: Record<string, (req: Request) => Promise<Response>>;
}

/** One logical request. Credentials travel only in `headers` (spec §2 fact 8); `endpointPath` is the URL path. */
export interface HttpKitRequest {
  providerId: HttpProviderId;
  executionId: string | null;
  tileIndex: number | null;
  endpointPath: string;
  method: 'GET' | 'POST';
  url: URL;
  headers: Record<string, string>;
  body?: string;
  /** `accept` vetoes caching a body the adapter cannot parse; null or empty bodies are never cached. */
  cache: { ttlSeconds: number; accept?: (body: unknown) => boolean } | 'never';
  signal: AbortSignal;
  recordFixtures: boolean;
  /**
   * `false`: a cache hit or a joined in-flight request leaves no cache-hit ledger row. A paginating adapter sets it on
   * every page after the first, so a tile served from the cache is one cache-hit row, as parity counts tiles (spec
   * §5.2, §8.1; plan decision 24). Absent or `true`: the row is written. Upstream attempts are always ledgered.
   */
  ledgerCacheHit?: boolean;
}

/** `fetchedAt` is the original `storedAt` on a cache hit and the leader's on a joined request (spec §2). */
export interface HttpKitResponse {
  status: number;
  body: unknown;
  fetchedAt: IsoDateTime;
  fromCache: boolean;
  cacheKey: string;
}

/** The single egress path for provider HTTP. Spec §5.3. */
export interface HttpKit {
  request(r: HttpKitRequest): Promise<HttpKitResponse>;
  stats(): { inFlight: number };
}

/** Writes one attempt as a dated, hashed, redacted fixture (spec §5.3 "Recorder"); resolves to the path written. */
export interface FixtureRecorder {
  record(r: {
    providerId: HttpProviderId;
    endpointPath: string;
    request: HttpKitRequest;
    status: number;
    body: unknown;
    /** When the response arrived (http-kit's clock); written as recordedAt (prov-r2-003). */
    fetchedAt: IsoDateTime;
    /** The response headers; the recorder keeps only an allowlisted subset (plan decision 20). Absent → none. */
    responseHeaders?: Headers;
  }): Promise<string>;
}
