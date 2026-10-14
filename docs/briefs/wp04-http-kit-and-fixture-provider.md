---
wp: 4
title: "providers: http-kit, recorder, scrubbing, egress, fixture provider"
owner: opus
depends_on: [0]
spec_sections: ["§4", "§5.3", "§5.5", "§5.2 Errors", "§9 item 2", "§14"]
reviewers: [code-architect, test-strategy-reviewer, cost-and-budget-reviewer, security-reviewer, provenance-auditor, provider-integration-expert]
status: draft
---

# WP4 — providers: http-kit, recorder, scrubbing, egress, fixture provider

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Work task by task; every step is a checkbox. Read the spec (`docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`, revision 9) and the plan (`docs/superpowers/plans/2026-10-14-flight-price-optimiser-plan.md`) before Task 4.1. Where this brief and the spec disagree, the spec wins and this brief is the bug: stop and report.

## Goal

Build `@gmt/providers`' HTTP layer — the one path by which any provider reaches the network, fixed by spec §5.3 (cache → dedup → retry { limiter → reserve → fetch → finalise } → cache.set) with egress control, secret scrubbing and the fixture recorder — plus the synthetic fixture provider that WP7's layer-A engine tests drive through it.

## Scope

**In**

- `createHttpKit` and every type in the plan's "http-kit" contract block (plan contracts v2, spec revision 10), over `globalThis.fetch`, with the one gated transport seam `HttpKitDeps.inProcessHosts` (spec §4 rev 10: requests to a hostname listed there are dispatched in process; every other pipeline step still runs).
- The default status → `ProviderError` classification (spec §5.2 "Errors"), `Retry-After`, per-request timeout, abort, socket errors, the redirect refusal.
- Per-provider limiter: bottleneck per-minute reservoir chained to a per-hour reservoir, `maxConcurrent`, queue deadline `maxWaitSeconds`.
- In-flight dedup and the response cache path (`recordCacheHit` with `tileIndex`, original `storedAt` as `fetchedAt`, scrubbed bodies, `cache: 'never'`).
- Egress: hostname allowlist per provider, `https:` only (plain `http:` for `fixture.local` only), no userinfo, no credential in any URL, `redirect: 'error'`.
- `'fx'` requests: limiter, allowlist, timeout, retry and cache as for any provider, but **never ledgered** (no `reserve`, `finalise` or `recordCacheHit`; spec §5.3 and §5.6 rev 10).
- `scrubSecrets`, `stripUrl`, `canonicalCacheKey`.
- `createRecorder` writing the pinned `RecordedFixture` format (fails closed, deterministic token placeholders, `recordedAt`/`recordedBy`/`contentSha256`, raw body beside it as `.raw.json`), `contentHash`, and the recorded-tree loaders.
- The `@gmt/providers/testing` subpath: `fixtureHandlers(root)`, `replayHandlers(recordedRoot)`, `loadRecorded(root, providerId, endpointPath)` — the only module that imports msw.
- The fixture tree under `packages/providers/fixtures/synthetic/fixture/`, the fixture server (one routing core served by msw via `fixtureHandlers` and in process via `fixtureRouter`), its scenario-control contract for every §8.1 error row (`POST /__fixture/scenario`, `x-fixture-scenario` header), and `fixtureProvider` with its gate.
- The http-kit and fixture rows of spec §9 item 2, the sentinel-key test over every sink reachable from this package, the fixture-tree test.

**Out**

- `SqliteBudgetGuard`, `SqliteResponseCache`, cap predicates, the ledger schema, `billable` computation at finalise: **WP3** (`@gmt/db`). Tests here use the in-memory fakes defined in Task 4.1 (`test/fakes.ts`).
- SearchApi and Travelpayouts adapters, `searchApiHttpLimits`/`travelpayoutsHttpLimits` with their `classifyError` overrides, the `SEARCHAPI_PARAMS`/`TRAVELPAYOUTS_PARAMS` constants and allowlist files: **WP5**, **WP6**, **WP4b** (this package provides the `ParamsAllowlist` type, its loader and the request check, and guarantees that a hashed allowlist file passes the fixture-tree test).
- Recording real fixtures and `apps/api/src/wiring.ts` (`httpLimitsFor`, `providersFor`, the recorder with `recordedBy`, and `inProcessHosts: { 'fixture.local': … }` passed only under `syntheticAllowed`): **WP4b**.
- The fixture-mode boot matrix, pino setup and `redact` paths: **WP8**/**WP4b** (spec §14 rule; this package only guarantees that nothing it logs carries a URL query or a credential).
- Engine use of the scenario rules (every §8.1 row in both stages): **WP7**; replay of recorded fixtures in layer-B tests: **WP13**. This brief provides both and documents which rule drives which row.
- FX refresh itself (`engine/src/fx/refresh.ts`): **WP7**.
- The boundary script's "no msw outside `src/testing/`" rule: **WP0** (`scripts/check-boundaries.mjs`); this brief's definition of done runs it.

## Spec sections

- **§5.3 (entire)** — the fixed pipeline; billable rule (`fixture` iff HTTP 200 at the configured test cost); reserve before every attempt; aborted attempts finalise `unknown` before `AbortedError` propagates; every ledger row carries `tile_index`; cache key sha256 over the credential-free canonical request, bodies scrubbed, token-bearing responses never cached; FX through http-kit, never ledgered; egress allowlist and `redirect: 'error'` with the 302 test; one scrubbing rule for every sink; recorder layout, fail-closed credentials, `search_metadata` URLs stripped, deterministic token placeholders.
- **§4 (rev 10, `providers` row)** — the fixture provider is served by msw in tests and, in fixture mode, by an in-process router that http-kit dispatches to for that one hostname, a seam gated by `syntheticAllowed`.
- **§5.5 (fixture provider and gates)** — `syntheticAllowed`; the fixture provider's constructor throws when it is false; every fixture price is `synthetic`; the recorder writes only under `fixtures/recorded/` with a content hash and `recordedBy` the fixture-tree test verifies.
- **§5.2 "Errors"** — 401/403 → `auth`; 402 → `quota`; 400 → `parse` (non-retryable) with the vendor's message in `last_error` (so in `ProviderError.message`, never `reason`); 404 → `upstream` non-retryable; 429 → `rate-limit` unless the ledger shows the provider at its plan cap or the body matches the recorded quota shape (adapter `classifyError`), then `quota`; other 5xx → `upstream`; malformed → `parse`; socket → `network`; per-request timeout → `network` finalised `unknown`, not retried for billed vendors; limiter deadline → `limiter-timeout`; `signal.aborted` → `AbortedError`; no adapter-level retries. The default table lives in `src/http/classify.ts`.
- **§3 (rev 10) outcome `reason`** — `reason` is the kind or a named normalisation reason; since §8.1 writes `reason = error.reason ?? kind`, http-kit never sets `ProviderError.reason` (diagnostic codes such as `[timeout]` end the message instead); only `no-return-legs` is set, by the fixture provider.
- **§9 item 2 (http-kit, recorder, fixture rows)** — every test listed there that is not adapter-specific, with msw on global fetch.
- **§14 (scrubbing rule)** — no secrets and no full URLs in any log line; URL query and userinfo stripped as in §5.3.

## Interfaces consumed

From `@gmt/core` (WP0), copied from spec §5.1 (revision 10) and the plan's contracts v2. `ProviderId`, `SourceKind`, `Cabin`, `PointOfSale` live in `types/provenance.ts`; `CellKey` is defined once in `types/definition.ts`; `ports/provider.ts` imports and re-exports them.

```ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';   // types/provenance.ts
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = string | 'unknown';   // ISO 3166-1 alpha-2 upper-case, or 'unknown'
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }   // types/definition.ts, the ONLY definition

export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }

export interface DiscoveryQuery {
  origin: Iata; destination: Iata;
  departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number;
  cabin: Cabin; currency: 'GBP';
  cells?: CellKey[];     // when set, discovery.plan RE-PLANS over this subset (fewer calls); tiles still partition it
}
export interface TilePlan { index: number; coveredCells: CellKey[]; request: TileRequest }   // vendor-neutral, typed
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };

export interface RawCalendarPrice extends CellKey {
  amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string;
}
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[] }
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };

export interface ItineraryQuery extends CellKey { cabin: Cabin; adults: 1; currency: 'GBP'; maxStops?: number; expandTop: number; bookingLinks: boolean }
export interface RawSegment { marketingCarrier: string; operatingCarrier?: string; flightNumber: string; from: Iata; to: Iata; depart: string; arrive: string; timeKind: 'local' | 'utc' | 'offset'; cabin?: Cabin; durationMinutes?: number; aircraft?: string }
export interface RawOffer {
  outbound: RawSegment[]; inbound: RawSegment[]; seller: string; requestedCabin: Cabin;
  amountMinor: number; currency: string; taxesIncluded?: boolean;
  baggage?: BaggageSnapshot; fareConditions?: FareConditions; selfTransfer?: boolean;
  booking: { kind: 'get'; url: string } | { kind: 'post'; url: string; postData: string } | { kind: 'none' };
  bookingExpiresAt?: IsoDateTime;
}
export interface ItinerarySearchResult {
  offers: RawOffer[]; coverage: 'priced' | 'empty'; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; partial: boolean; failedExpansions: number; notes: string[];
  routeHistory?: Array<{ date: IsoDate; lowestPriceMinor: number; currency: string }>;
}

export interface ProviderContext { executionId: string | null; signal: AbortSignal; recordFixtures: boolean }

export interface DiscoveryCapability { info: CapabilityInfo; plan(q: DiscoveryQuery): TilePlan[]; fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> }
export interface VerificationCapability { info: CapabilityInfo; estimate(q: ItineraryQuery): CostEstimate; search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult> }
export interface FlightProvider {
  readonly id: ProviderId; readonly displayName: string;
  readonly suppliedFields: readonly SuppliedField[]; readonly cabins: readonly Cabin[];
  readonly discovery?: DiscoveryCapability; readonly verification?: VerificationCapability;
  healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }>;
}
export interface CostEstimate { calls: number; costMicroGbp: number; seconds: number; notes: string[] }

export interface Reservation { id: string; finalise(r: { outcome: 'ok' | 'error' | 'unknown'; httpStatus?: number; durationMs: number }): void }
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }

// Budget port (ports/budget.ts)
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
// cap is null for a window the plan does not use (a month scope on a lifetime plan, and vice versa) and for a scope with no cap configured.

// Logger and clock
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };

// Identifiers
export type Iata = string & { readonly __brand: 'Iata' };
export type IsoDate = string & { readonly __brand: 'IsoDate' };
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' };
export function asIata(s: string): Iata;
export function asIsoDate(s: string): IsoDate;
export function asIsoDateTime(s: string): IsoDateTime;

// Itinerary types
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }

// Errors (errors.ts): `ProviderError`, `BudgetExceeded`, `AbortedError`, `NormalisationError`, `stripUrlsInText`; `ProviderErrorKind` exported.
// new ProviderError({ kind, retryable, message, reason?, httpStatus?, retryAfterSeconds?, providerId? }); new BudgetExceeded({ scope, cap, current, requested, providerId? })

// Config
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export interface SyntheticGateInput { nodeEnv: 'production' | 'development' | 'test'; databasePath: string; allowFixtureProvider: string | null; inContainer: boolean }
export function syntheticAllowed(c: SyntheticGateInput): boolean;
```

## Interfaces produced

The plan's "http-kit" block (contracts v2), with these exact names; later packages rely on them:

```ts
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never'; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; classifyError?: (status: number, body: unknown, ledgerAtCap: boolean) => ProviderError }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<ProviderId | 'fx', ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[]; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
export interface HttpKitRequest { providerId: ProviderId | 'fx'; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body?: string; cache: { ttlSeconds: number } | 'never'; signal: AbortSignal; recordFixtures: boolean }
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
export interface RecordedFixture { recordedAt: IsoDateTime; recordedBy: string; providerId: string; endpointPath: string; request: { method: string; url: string /* credential-free, query kept */; headers: Record<string, string> /* scrubbed; credential headers dropped entirely */; body: string | null }; status: number; body: unknown; placeholders: Record<string, string>; contentSha256: string }
export interface FixtureRecorder { record(r: { providerId: ProviderId | 'fx'; endpointPath: string; request: HttpKitRequest; status: number; body: unknown }): Promise<string /* path written */> }
export function createRecorder(opts: { root: string; secrets: Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;
export function contentHash(f: Omit<RecordedFixture, 'contentSha256'>): string;
export function scrubSecrets<T>(value: T, secrets: Secret[]): T;
export function stripUrl(url: string): string;
export function canonicalCacheKey(r: HttpKitRequest, secrets: Secret[]): string;   // method + credential-free URL (query kept) + scrubbed headers + body only; never executionId or tileIndex
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: SyntheticGateInput; costMicroGbp: number }): FlightProvider;
export function fixtureRouter(root: string): Hono;
// '@gmt/providers/testing' (src/testing/index.ts):
export function fixtureHandlers(root: string): RequestHandler[];
export function replayHandlers(recordedRoot: string): RequestHandler[];
export function loadRecorded(root: string, providerId: string, endpointPath: string): RecordedFixture[];
// src/params/allowlist.ts (plan decision 14; WP4b, WP5, WP6 import these):
export interface ParamsAllowlist { provider: ProviderId; recordedAt: IsoDate; endpoints: Record<string /* endpoint path */, { names: string[] /* ascending */; values: Record<string, string[] | 'any'> }>; contentSha256: string }
export function loadParamsAllowlist(path: string): ParamsAllowlist;
export function assertRequestAllowed(allowlist: ParamsAllowlist, endpointPath: string, url: URL): void;   // throws ParamsNotAllowedError
```

Precisions this brief settles (no name changes):

- `createHttpKit` throws at construction when `inProcessHosts` names any host other than `fixture.local`, so the seam cannot be widened by mistake; wiring decides *whether* to pass it (only under `syntheticAllowed`).
- The recorded-file path is `<root>/<providerId>/<endpointPath with every / replaced by _>/<yyyy-mm-dd>-<first 12 hex of contentSha256>.json` (`/api/v1/search` → `_api_v1_search`); the unmodified vendor body goes to the same name with `.raw.json`, gitignored. `placeholders` maps each placeholder used in the file to its token key (`{ "<departure_token:0>": "departure_token" }`). `request.url` keeps the query (with placeholders); `request.headers` keeps every header except credential headers (`authorization`, `x-access-token`, `x-api-key`, `proxy-authorization`, `cookie`), which are dropped entirely so the secret scan's header-name rule passes.
- `contentHash` is sha256 hex over `canonicalJson` (keys sorted at every level). The same function verifies any recorded-tree JSON carrying `contentSha256`, including WP5/WP6's `ParamsAllowlist` files.
- `scrubSecrets`, `canonicalCacheKey`, `createRecorder` accept `readonly Secret[]`.
- msw 3 exports no `RequestHandler` from a documented entrypoint (docs verified 2026-10-14); `src/testing/` types it locally as `export type RequestHandler = ReturnType<typeof http.all>`.

**Scenario-control contract** (consumed by WP7 and WP13; also the constants below): `POST http://fixture.local/__fixture/scenario` with JSON body `{ "rules": FixtureRule[] }` replaces the rules and answers `{ synthetic: true, rules: n }`; `DELETE` on the same path clears them (204). A single request may instead carry header `x-fixture-scenario: <FixtureResponse as JSON>`. `scenarioRequest(rules)` builds the POST as a `Request`, so a test sends it with `fetch(scenarioRequest(rules))` under msw or `router.fetch(scenarioRequest(rules))` against the router instance passed in `inProcessHosts`. `FixtureRule` and `FixtureResponse` are defined in Task 4.9 and the section "Fixture tree and request routing".

Additional exports (used by WP4b, WP5, WP6, WP7, WP8, WP13):

```ts
// @gmt/providers
export type HttpProviderId = ProviderId | 'fx';
export const MAX_ATTEMPTS = 3; export const BACKOFF_BASE_MS = 1000;
export interface ResponseFacts; export function classifyResponse(f: ResponseFacts): ProviderError;   // default table; adapters' classifyError may delegate
export function parseRetryAfter(value: string | null, now: IsoDateTime): number | undefined;
export function containsSecret(text: string, secrets: readonly Secret[]): boolean;
export const CREDENTIAL_HEADERS: ReadonlySet<string>;
export class RecorderRefusedError extends Error {}
export class ParamsNotAllowedError extends Error {}
export function canonicalJson(v: unknown): string;
export function verifyContentHash(file: unknown): boolean;
export function loadRecordedJson(path: string): Record<string, unknown>;   // any hashed file under fixtures/recorded/ (recordings, ParamsAllowlist)
export function loadRecordedFixture(path: string): RecordedFixture;
export function fixtureHttpLimits(o: { costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number }): ProviderHttpLimits;
export function planFixtureTiles(q: DiscoveryQuery): TilePlan[]; export const FIXTURE_TILE_DAYS = 7;
export function defaultFixtureRoot(): string; export function loadFixtureTree(root: string): FixtureTree; export function calendarPriceMinor(...): number;
export function createFixtureServer(root: string): FixtureServer;
export type FixtureResponse; export interface FixtureRule; export function scenarioRequest(rules: FixtureRule[]): Request;
export const FIXTURE_HOST = 'fixture.local'; export const FIXTURE_ORIGIN = 'http://fixture.local';
export const SCENARIO_PATH = '/__fixture/scenario'; export const SCENARIO_HEADER = 'x-fixture-scenario';
```

## Library notes

All versions from plan Task 0.1. Verified with context7 on 2026-10-14.

- **bottleneck 2.19.5** (`/sgrondin/bottleneck`, README "Reservoir Intervals", "chain()", `_autodocs/configuration.md` "Job Options" and "Limiter constructor options"). Used: `new Bottleneck({ maxConcurrent, reservoir, reservoirRefreshAmount, reservoirRefreshInterval })`, `limiter.chain(other)`, `limiter.schedule(fn)`. Facts relied on: `reservoirRefreshInterval` resets the reservoir to `reservoirRefreshAmount` every N ms and must be a multiple of 250 (60 000 and 3 600 000 are); the reservoir window starts at limiter creation, so it is a fixed window, not a sliding one; a chained job must satisfy both limiters; the local datastore runs a 250 ms heartbeat when reservoir intervals are set. **The job option `expiration` is a deadline on a running job, not on queue time**, so the queue deadline (`maxWaitSeconds`) is enforced in `limiter.ts` with our own timer plus an age check when the job starts. Default import: `import Bottleneck from 'bottleneck'`.
- **p-retry 8.0.1** (`/sindresorhus/p-retry`, `_autodocs/types.md`, `_autodocs/configuration.md` "Callback ordering", `_autodocs/api-reference/p-retry.md`). Used: `pRetry(input, { retries, minTimeout, factor, randomize, signal, shouldRetry, onFailedAttempt })`. Facts relied on: `input` receives the attempt number (1-based); callbacks receive a frozen `RetryContext { error, attemptNumber, retriesLeft, retriesConsumed, retryDelay }`; per failure the order is `shouldConsumeRetry` → `onFailedAttempt` → `shouldRetry`, and **`onFailedAttempt` runs even when `shouldRetry` will refuse**, so the `Retry-After` sleep inside it checks `retryable` and `retriesLeft` itself; `onFailedAttempt` may be async and is awaited before the backoff sleep (the docs' 429 example does exactly this); a thrown `AbortError` bypasses all callbacks; a non-network `TypeError` is never retried (http-kit never lets a raw `TypeError` escape an attempt); with `signal`, abort rethrows the signal's reason, which http-kit maps to `AbortedError`. `retries: 2` gives the spec's three attempts.
- **msw 3.0.3** (`/websites/mswjs_io`, "Migrations 2.x → 3.x", "Network errors", "Quick start", "Runbook"). Used: `setupServer` from `msw/node`; `http`, `HttpResponse` from `msw/http` (v3 moved them off the root); `HttpResponse.json(body, { status, headers })`, `new HttpResponse(null, { status: 302, headers })`, `HttpResponse.error()` (network error: the client sees `TypeError: Failed to fetch`); `server.listen({ onUnhandledFrame: 'error' })` (**v3 renamed `onUnhandledRequest` to `onUnhandledFrame`**); `server.use`, `server.resetHandlers`, `server.close`; `server.events.on('request:start', ({ request }) => …)` and `server.events.removeAllListeners()`. `passthrough` (now `msw/utils/passthrough`) is not used. A resolver may return a plain Fetch `Response`, including `Response.error()`, and returning `undefined` falls through to the next handler (used by `replayHandlers` for an unrecorded request, which then fails as unhandled). msw is a **runtime dependency** of `@gmt/providers` (plan decision 7) imported only under `src/testing/`.
- **hono 4.13.13** (`/honojs/hono/v4.13.0`, `_autodocs/api-reference/hono.md`, `docs/MIGRATION.md`). Used: `new Hono()`, `app.all('*', (c) => …)` returning a standard `Response`, `c.req.raw` (the Fetch `Request`), `app.request(url, init)` in tests. `app.fetch(request)` is the Fetch-standard handler (`Response | Promise<Response>`); WP4b passes it to http-kit as `inProcessHosts['fixture.local'] = async (req) => router.fetch(req)`.
- **vitest 5.0.4** (`/vitest-dev/vitest/v5.0.3`, `docs/api/vi.md`; 5.0.3 is the closest indexed version). Used: `vi.useFakeTimers({ toFake: [...] })`, `vi.advanceTimersByTimeAsync(ms)`, `vi.useRealTimers()`. Fact relied on: `process.nextTick` and `queueMicrotask` are never faked by default; this brief also leaves `setImmediate` real so fetch and stream internals progress, and fakes `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval` and `Date`.
- **Node 22 built-ins** (no context7 entry; Node docs): `fetch` (undici) with `redirect: 'error'` rejects with a `TypeError` whose `cause` mentions the redirect; `AbortSignal.any([...])` (Node ≥ 20.3); `node:crypto` `createHash('sha256')`; `node:fs` `realpathSync`, `mkdirSync`, `writeFileSync(…, { flag: 'wx' })`. The per-request timeout uses a `setTimeout` + `AbortController` rather than `AbortSignal.timeout`, because `AbortSignal.timeout` runs on Node-internal timers that vitest cannot fake; behaviour is identical.

## Files

Create (all paths under `packages/providers/`):

- `src/index.ts` (replace WP0's empty barrel), `src/util.ts`
- `src/http/types.ts`, `src/http/httpKit.ts`, `src/http/attempt.ts`, `src/http/classify.ts`, `src/http/sleep.ts`, `src/http/limiter.ts`, `src/http/cacheKey.ts`, `src/http/scrub.ts`, `src/http/egress.ts`, `src/http/recorder.ts`
- `src/fixture/constants.ts`, `src/fixture/dates.ts`, `src/fixture/tree.ts`, `src/fixture/server.ts`, `src/fixture/router.ts`, `src/fixture/provider.ts`
- `src/testing/index.ts`, `src/testing/handlers.ts`, `src/testing/replay.ts` (the only files that import msw)
- `src/params/allowlist.ts`
- `fixtures/synthetic/fixture/calendar/{LHR-JFK,LHR-EWR,LGW-JFK,LGW-EWR}.json`, `fixtures/synthetic/fixture/itinerary/{LHR-JFK,LHR-EWR,LGW-JFK,LGW-EWR}.json`, `fixtures/recorded/.gitkeep`
- Tests: `test/fakes.ts`, `test/support/msw.ts`, `test/support/setup.ts`, `test/support/time.ts`, `test/http/pipeline.test.ts`, `test/http/scrub.test.ts`, `test/http/cacheKey.test.ts`, `test/http/errors.test.ts`, `test/http/egress.test.ts`, `test/http/inProcess.test.ts`, `test/http/limiter.test.ts`, `test/http/cache.test.ts`, `test/http/recorder.test.ts`, `test/http/sentinel.test.ts`, `test/fixture/server.test.ts`, `test/fixture/provider.test.ts`, `test/testing/replay.test.ts`, `test/params/allowlist.test.ts`, `test/fixture/tree.test.ts`, `test/barrel.test.ts`

Modify: `packages/providers/package.json` (msw as a dependency, `./testing` subpath), `packages/providers/vitest.config.ts` (setup file), the repository `.gitignore` (`packages/providers/fixtures/recorded/**/*.raw.json`, Task 4.7); delete `packages/providers/test/smoke.test.ts` in Task 4.13 (superseded).

The plan's file map names `src/fixture/handlers.ts` as "msw handlers + a Hono router"; per plan contracts v2 the msw side lives in `src/testing/` and the shared routing core in `src/fixture/server.ts`, with `router.ts` the Hono wrapper. `attempt.ts`, `sleep.ts`, `types.ts`, `constants.ts`, `dates.ts`, `tree.ts` and `util.ts` are new single-responsibility files under the same directories.

## Fixture tree and request routing (design for WP7)

**Tree.** `packages/providers/fixtures/synthetic/fixture/` holds two directories, one file per worked-example pair (`LHR-JFK`, `LHR-EWR`, `LGW-JFK`, `LGW-EWR`), every file carrying `"synthetic": true`:

- `calendar/<O>-<D>.json`: `{ synthetic, currency, baseMinor, weekdayStepMinor, perNightMinor, noFaresNights, noDataNights }`. Prices are a formula, so any window works without regenerating files: `amountMinor = baseMinor + (epochDay(departureDate) mod 7) × weekdayStepMinor + nights × perNightMinor`. A night count in `noFaresNights` is answered as `noFares`; one in `noDataNights` is omitted (the engine sees `no_data`).
- `itinerary/<O>-<D>.json`: `{ synthetic, options: [{ seller, carrier, outbound: { flightNumber, depart, arrive, arriveDayOffset }, inbound: {…}, priceDeltaMinor, cabinBagIncluded, checkedBags }] }`. Each offer's price is the calendar price for its cell plus `priceDeltaMinor`; times are local wall-clock templates placed on the cell's dates. Carriers `ZZ` and `ZX` are synthetic designators. No offer ever carries a booking link (`booking: { kind: 'none' }`).

**Transports.** The same routing core answers in two places: msw's `fixtureHandlers(root)` on global fetch (unit, provider and WP7 layer-A tests), and `fixtureRouter(root)` reached through `HttpKitDeps.inProcessHosts['fixture.local']` (fixture mode, wired by WP4b under `syntheticAllowed`; WP7 may use it too). Each router or handler set holds its own scenario state, so a test sends scenario control to the instance its kit uses.

**Routes** (`http://fixture.local`):

| Request | Meaning |
|---|---|
| `GET /calendar?origin&destination&departFrom&departTo&returnFrom&returnTo&cabin&currency` | one discovery tile (a `rectangle`): every `(dep, ret)` in the rectangle with 0 ≤ nights ≤ 90, so entries outside the tile's band come back and the adapter drops them (`dropped-out-of-band:n`). Unknown pair → 404; missing or malformed parameter → 400 |
| `GET /itinerary?origin&destination&departureDate&returnDate&cabin&currency&expandTop` | one verification search for a cell: `{ outboundOptions, failedExpansions, offers }`, the first `expandTop` options |
| `GET /health` | `{ synthetic: true, ok: true }` |
| `POST /__fixture/scenario` body `{ rules: FixtureRule[] }` | replaces the scenario rules (test control; never called by the adapter); build it with `scenarioRequest(rules)` |
| `DELETE /__fixture/scenario` | clears the rules |

**Scenario rules.** A `FixtureRule` is `{ match: { path?, params? }, respond: FixtureResponse, times? }`. For each request the first rule whose `path` equals the request path and whose `params` all equal the query values, with `times` remaining (default unlimited), answers it and decrements `times`; otherwise the normal response is generated. A single request can also carry header `x-fixture-scenario: <FixtureResponse JSON>` (direct http-kit tests only; the adapter never sends it). `FixtureResponse` kinds: `normal`, `status` (any status, optional body and headers), `malformed` (200 with truncated JSON), `network` (socket error), `hang` (never answers until aborted), `empty`, `no-fares`, `no-currency`, `no-return-legs`, `partial` (`failedExpansions`), `variant` (`currency`, `carrier`, `connectVia`, `scope: 'first-offer' | 'all-offers'`).

**Which rule drives which spec §8.1 row** (WP7 uses these; times count http-kit attempts, three per call):

| §8.1 row | Rule (`respond`, with `match.path` `/calendar` for discovery or `/itinerary` for verification; narrow with `params`, e.g. `{ departFrom: '2026-11-09' }` for one tile) |
|---|---|
| rate-limit after retries | `{ kind: 'status', status: 429 }`, `times: 3` |
| upstream after retries | `{ kind: 'status', status: 503 }`, `times: 3` |
| network after retries | `{ kind: 'network' }`, `times: 3` |
| parse (and "2 consecutive parse disables the provider") | `{ kind: 'malformed' }` or `{ kind: 'status', status: 400, body: { error: 'synthetic bad request' } }`; `times: 2` across two tiles for the consecutive rule |
| auth on any call | `{ kind: 'status', status: 401 }` |
| quota on any call | `{ kind: 'status', status: 402 }`, or 429 while the real `BudgetGuard` shows the fixture provider at its cap |
| upstream `no-return-legs` | `{ kind: 'no-return-legs' }` on `/itinerary` |
| `limiter-timeout` | `{ kind: 'status', status: 429, headers: { 'retry-after': '7200' } }` (beyond `MAX_WAIT_SECONDS` 3900) |
| `BudgetExceeded` (any scope) | not a server response: set the cap in the real `BudgetGuard` (WP3) |
| `AbortedError` (cancel / SIGTERM) | `{ kind: 'hang' }`, then cancel or abort |
| `fx-unavailable` | `{ kind: 'variant', currency: 'USD' }` with no USD rate in the FX repository |
| `currency-unsupported` | `{ kind: 'variant', currency: 'XTS' }` (ISO 4217 test code, not ECB-covered) |
| `unknown-airport-tz` | `{ kind: 'variant', connectVia: '<a code absent from the test airports table>' }` on `/itinerary` |
| unmappable carrier, `offers-dropped:n` | `{ kind: 'variant', carrier: 'Z!' }` (first offer only → `offers-dropped:1`); `scope: 'all-offers'` → `error` |
| tile-error marks exactly its cells | any error rule narrowed by `params.departFrom` |
| `empty`, `no_data`, `noFares` | `{ kind: 'empty' }` (`/itinerary` → coverage `empty`; `/calendar` → every covered cell `no_data`), `{ kind: 'no-fares' }` |
| `partial-expansion` | `{ kind: 'partial', failedExpansions: 1 }` |

## Tasks

Test commands run a single file without coverage (the package `test` script enforces thresholds, which a partial run would fail): `pnpm --filter @gmt/providers exec vitest run <file>`.

### Task 4.1: Reserve happens before fetch on every attempt (first failing test)

**Files:**
- Modify: `packages/providers/package.json`, `packages/providers/vitest.config.ts`
- Create: `test/support/msw.ts`, `test/support/setup.ts`, `test/support/time.ts`, `test/fakes.ts`, `src/http/types.ts`, `src/http/classify.ts` (first version), `src/http/attempt.ts` (first version), `src/http/httpKit.ts` (first version)
- Test: `test/http/pipeline.test.ts`

**Interfaces:**
- Consumes: `BudgetGuard`, `Reservation`, `ResponseCache`, `Logger`, `Clock`, `fixedClock`, `Secret`, `ProviderError` (WP0).
- Produces: every type of the http-kit contract block (`src/http/types.ts`), `createHttpKit` (retry + reserve + fetch + finalise only), `MAX_ATTEMPTS`, `BACKOFF_BASE_MS`; the test fakes `FakeBudget`, `FakeCache`, `CapturingLogger`, `SENTINELS`, `makeKit`, `req`.

- [ ] **Step 1: Package wiring**

`packages/providers/package.json`:

```json
{
  "name": "@gmt/providers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing/index.d.ts", "default": "./dist/testing/index.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --coverage"
  },
  "dependencies": { "@gmt/core": "workspace:*", "bottleneck": "2.19.5", "hono": "4.13.13", "msw": "3.0.3", "p-retry": "8.0.1" }
}
```

`// why:` msw is a runtime dependency (plan decision 7) because the `./testing` subpath imports it and other packages' tests consume that subpath; production code never imports `./testing`, and the WP0 boundary script rejects any msw import outside `packages/providers/src/testing/`.

`packages/providers/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'providers',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/testing/index.ts', 'src/http/types.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
```

`test/support/msw.ts`:

```ts
import { setupServer } from 'msw/node';

/** The package's single msw server on global fetch (spec §9 item 2). Tests add handlers with `server.use`. */
export const server = setupServer();
```

`test/support/setup.ts`:

```ts
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw.js';

// why: an unhandled request is a test failure, never a real network call (spec §2 egress rule).
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  server.events.removeAllListeners();
});
afterAll(() => server.close());
```

`test/support/time.ts`:

```ts
import { vi } from 'vitest';

/**
 * Fakes the timers http-kit, p-retry and bottleneck use. setImmediate, nextTick and queueMicrotask stay
 * real so fetch and stream internals keep moving while fake time stands still.
 */
export function useFakeTime(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
}

/** Advances fake time in steps until `p` settles, then returns or rethrows its result. */
export async function drive<T>(p: Promise<T>, opts: { stepMs?: number; maxMs?: number } = {}): Promise<T> {
  const stepMs = opts.stepMs ?? 250;
  const maxMs = opts.maxMs ?? 600_000;
  let settled = false;
  const tracked = p.then(
    (v) => {
      settled = true;
      return v;
    },
    (e: unknown) => {
      settled = true;
      throw e;
    },
  );
  tracked.catch(() => undefined);
  for (let t = 0; t < maxMs && !settled; t += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    // why: one real macrotask per step lets undici and msw finish work queued with setImmediate.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!settled) throw new Error(`drive: promise did not settle within ${maxMs} ms of fake time`);
  return tracked;
}

/** Settles `p` and returns the rejection reason (fails the test if it resolves). */
export async function driveError(p: Promise<unknown>, opts?: { stepMs?: number; maxMs?: number }): Promise<unknown> {
  try {
    await drive(p, opts);
  } catch (e) {
    return e;
  }
  throw new Error('expected the request to fail');
}
```

`test/fakes.ts`:

```ts
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
import {
  createHttpKit,
  type FixtureRecorder,
  type HttpKitRequest,
  type HttpProviderId,
  type ProviderHttpLimits,
} from '../src/http/httpKit.js';
import { server } from './support/msw.js';

type ReserveParams = Parameters<BudgetGuard['reserve']>[0];
type FinaliseParams = Parameters<Reservation['finalise']>[0];

/** One entry of the shared, ordered log of ledger calls and upstream fetches. */
export type LedgerEvent =
  | ({ type: 'reserve'; at: number } & ReserveParams)
  | ({ type: 'finalise'; at: number } & FinaliseParams)
  | { type: 'cache-hit'; at: number; providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }
  | { type: 'fetch'; at: number; url: string; method: string; headers: Record<string, string> };

/**
 * In-memory BudgetGuard implementing the spec §5.1 port. The real one is WP3's SqliteBudgetGuard; this
 * fake records every call in order, can refuse with a given BudgetExceeded, and reports a cap per
 * `provider-month` / `provider-lifetime` scope so the 429 → quota rule can be exercised.
 */
export class FakeBudget implements BudgetGuard {
  reserveCalls = 0;
  refuse: BudgetExceeded | null = null;
  /** `${scope.kind}:${providerId}` → cap in calls. */
  readonly caps = new Map<string, number>();
  constructor(readonly events: LedgerEvent[]) {}

  reserve(p: ReserveParams): Reservation {
    this.reserveCalls += 1;
    if (this.refuse) throw this.refuse;
    this.events.push({ type: 'reserve', at: Date.now(), ...p });
    return {
      id: `res-${this.reserveCalls}`,
      finalise: (r) => {
        this.events.push({ type: 'finalise', at: Date.now(), ...r });
      },
    };
  }

  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void {
    this.events.push({ type: 'cache-hit', at: Date.now(), ...p });
  }

  usage(scope: BudgetScope): Usage {
    const window = { windowStart: null, windowEnd: null };
    if (scope.kind === 'provider-month' || scope.kind === 'provider-lifetime') {
      const calls = this.events.filter((e) => e.type === 'reserve' && e.providerId === scope.providerId).length;
      return { calls, costMicroGbp: 0, cap: this.caps.get(`${scope.kind}:${scope.providerId}`) ?? null, ...window };
    }
    return { calls: 0, costMicroGbp: 0, cap: null, ...window };
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

/** Logger that keeps every line as JSON text, so a test can search all of them for a sentinel. */
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
  smtp: new Secret('test-smtp-pass-0123456789abcdef'),
  basicAuth: new Secret('test-basic-auth-pass-0123456789abcdef'),
};
export const ALL_SECRETS: Secret[] = Object.values(SENTINELS);

export const SEARCH = 'https://www.searchapi.io/api/v1/search';
export const TP = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

export type LimitOverrides = Partial<Record<HttpProviderId, Partial<ProviderHttpLimits>>>;

/** Limits for every id; generous rates so only tests that target the limiter ever queue. */
export function testLimits(over: LimitOverrides = {}): Partial<Record<HttpProviderId, ProviderHttpLimits>> {
  const base = { ratePerMinute: 600, ratePerHour: 36_000, concurrency: 4, maxWaitSeconds: 3900, requestTimeoutSeconds: 60 };
  return {
    searchapi: { ...base, hosts: ['www.searchapi.io'], billable: 'http-200', costPerCallMicroGbp: 0, ...over.searchapi },
    travelpayouts: { ...base, hosts: ['api.travelpayouts.com'], billable: 'never', costPerCallMicroGbp: 0, ...over.travelpayouts },
    fixture: { ...base, hosts: ['fixture.local'], billable: 'http-200', costPerCallMicroGbp: 3200, ...over.fixture },
    fx: { ...base, hosts: ['api.frankfurter.dev'], billable: 'never', costPerCallMicroGbp: 0, ...over.fx },
  };
}

/** A kit wired to the fakes; every upstream request msw sees is appended to `events` as 'fetch'. */
export function makeKit(
  o: { limits?: LimitOverrides; secrets?: Secret[]; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> } = {},
) {
  const events: LedgerEvent[] = [];
  const budget = new FakeBudget(events);
  const cache = new FakeCache();
  const log = new CapturingLogger();
  const clock = fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z'));
  server.events.on('request:start', ({ request }) => {
    events.push({ type: 'fetch', at: Date.now(), url: request.url, method: request.method, headers: Object.fromEntries(request.headers.entries()) });
  });
  const kit = createHttpKit({
    budget,
    cache,
    limits: testLimits(o.limits),
    clock,
    log,
    secrets: o.secrets ?? ALL_SECRETS,
    ...(o.recorder ? { recorder: o.recorder } : {}),
    ...(o.inProcessHosts ? { inProcessHosts: o.inProcessHosts } : {}),
  });
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
```

- [ ] **Step 2: Write the failing test**

`test/http/pipeline.test.ts`:

```ts
import { http, HttpResponse } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

describe('http-kit pipeline order (spec §5.3)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('reserves before every fetch: 503 then 200 → reserve, fetch, finalise(error), reserve, fetch, finalise(ok)', async () => {
    const { kit, budget } = makeKit();
    let n = 0;
    server.use(
      http.get(SEARCH, () => {
        n += 1;
        return n === 1 ? HttpResponse.json({ error: 'busy' }, { status: 503 }) : HttpResponse.json({ ok: true });
      }),
    );

    const res = await drive(kit.request(req({ url: `${SEARCH}?engine=google_flights_calendar` })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.fromCache).toBe(false);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error', 'reserve', 'fetch', 'finalise:ok']);
    const reserves = budget.events.filter((e) => e.type === 'reserve');
    expect(reserves.map((e) => e.httpAttempt)).toEqual([1, 2]);
    expect(reserves.every((e) => e.endpointPath === '/api/v1/search' && e.tileIndex === 0)).toBe(true);
    const finals = budget.events.filter((e) => e.type === 'finalise');
    expect(finals.map((e) => e.httpStatus)).toEqual([503, 200]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/pipeline.test.ts`
Expected: FAIL — `Failed to load url ../src/http/httpKit.js` (imported by `test/fakes.ts`).

- [ ] **Step 4: Implement**

`src/http/types.ts`:

```ts
import type { BudgetGuard, Clock, IsoDateTime, Logger, ProviderError, ProviderId, ResponseCache, Secret } from '@gmt/core';

/** Every id http-kit serves: the three providers plus the never-billable FX refresh (spec §4, §5.3). */
export type HttpProviderId = ProviderId | 'fx';

/**
 * Per-provider HTTP policy, built from `Config` by WP4b's wiring. Spec §5.3: hostname allowlist, chained
 * per-minute and per-hour reservoirs with `maxConcurrent`, the billable rule, the queue deadline and the
 * per-request timeout. `classifyError` lets an adapter recognise a recorded vendor body (spec §5.2 quota
 * shape); without it the default table in classify.ts applies.
 */
export interface ProviderHttpLimits {
  hosts: string[];
  ratePerMinute: number;
  ratePerHour: number;
  concurrency: number;
  billable: 'http-200' | 'never';
  costPerCallMicroGbp: number;
  maxWaitSeconds: number;
  requestTimeoutSeconds: number;
  classifyError?: (status: number, body: unknown, ledgerAtCap: boolean) => ProviderError;
}

/** What createHttpKit needs. Spec §4: `createHttpKit({ budget, cache, limits, clock, log })` over globalThis.fetch. */
export interface HttpKitDeps {
  budget: BudgetGuard;
  cache: ResponseCache;
  /** Limits per enabled id; a request for an id without limits is refused by egress. */
  limits: Partial<Record<HttpProviderId, ProviderHttpLimits>>;
  clock: Clock;
  log: Logger;
  /** Every configured secret; used for scrubbing and fail-closed checks (spec §5.3). */
  secrets: Secret[];
  recorder?: FixtureRecorder;
  /**
   * Spec §4 rev 10: the one transport seam. A request whose hostname is a key here is dispatched to that
   * function instead of globalThis.fetch; limiter, reserve, finalise, cache and recorder still run.
   * Wiring passes `{ 'fixture.local': … }` only under syntheticAllowed; createHttpKit refuses any other key.
   */
  inProcessHosts?: Record<string, (req: Request) => Promise<Response>>;
}

/** One logical request. Credentials travel only in `headers` (spec §2 fact 8); `endpointPath` is the path, never a query. */
export interface HttpKitRequest {
  providerId: HttpProviderId;
  executionId: string | null;
  tileIndex: number | null;
  endpointPath: string;
  method: 'GET' | 'POST';
  url: URL;
  headers: Record<string, string>;
  body?: string;
  cache: { ttlSeconds: number } | 'never';
  signal: AbortSignal;
  recordFixtures: boolean;
}

/** `fetchedAt` is the original `storedAt` on a cache hit (spec §2 consequences). */
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

/** Writes one attempt's request and response as a dated, hashed, redacted fixture (spec §5.3 "Recorder"); resolves to the path written. */
export interface FixtureRecorder {
  record(r: { providerId: HttpProviderId; endpointPath: string; request: HttpKitRequest; status: number; body: unknown }): Promise<string>;
}
```

`src/http/classify.ts` (first version; Task 4.3 replaces it with the full spec §5.2 table):

```ts
import { ProviderError } from '@gmt/core';
import type { HttpProviderId } from './types.js';

/** Minimal classification: 5xx is retryable upstream, anything else non-retryable upstream. Spec §5.2. */
export function classifyResponse(f: { providerId: HttpProviderId; endpointPath: string; status: number }): ProviderError {
  return new ProviderError({
    kind: 'upstream',
    retryable: f.status >= 500,
    httpStatus: f.status,
    providerId: f.providerId,
    message: `${f.providerId} ${f.endpointPath}: HTTP ${f.status}`,
  });
}
```

`src/http/attempt.ts` (first version; Task 4.3 replaces it):

```ts
import type { IsoDateTime, Reservation } from '@gmt/core';
import { classifyResponse } from './classify.js';
import type { HttpKitDeps, HttpKitRequest, ProviderHttpLimits } from './types.js';

/** The outcome of one successful HTTP attempt. */
export interface AttemptResult {
  status: number;
  body: unknown;
  fetchedAt: IsoDateTime;
}

/**
 * One attempt of spec §5.3's retry body: budget.reserve → fetch → reservation.finalise. Reserve runs
 * before the request leaves the process on every attempt, so a refused cap means no upstream call.
 */
export async function runAttempt(deps: HttpKitDeps, r: HttpKitRequest, limits: ProviderHttpLimits, attempt: number): Promise<AttemptResult> {
  // why: 'fx' is not a ProviderId in the BudgetGuard port and spec §5.6 says FX calls are not ledgered.
  const reservation: Reservation | null =
    r.providerId === 'fx'
      ? null
      : deps.budget.reserve({
          providerId: r.providerId,
          executionId: r.executionId,
          tileIndex: r.tileIndex,
          costMicroGbp: limits.costPerCallMicroGbp,
          httpAttempt: attempt,
          endpointPath: r.endpointPath,
        });
  const started = Date.now();
  const res = await fetch(r.url, {
    method: r.method,
    headers: r.headers,
    ...(r.body === undefined ? {} : { body: r.body }),
    redirect: 'error',
  });
  const text = await res.text();
  const ok = res.status >= 200 && res.status < 300;
  reservation?.finalise({ outcome: ok ? 'ok' : 'error', httpStatus: res.status, durationMs: Date.now() - started });
  if (!ok) throw classifyResponse({ providerId: r.providerId, endpointPath: r.endpointPath, status: res.status });
  return { status: res.status, body: JSON.parse(text) as unknown, fetchedAt: deps.clock.now() };
}
```

`src/http/httpKit.ts` (first version; Tasks 4.3–4.6 extend it):

```ts
import { ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { runAttempt } from './attempt.js';
import type { HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse } from './types.js';

export type {
  FixtureRecorder,
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
} from './types.js';

/** Spec §5.3: p-retry, max 3 attempts. */
export const MAX_ATTEMPTS = 3;
/** Exponential backoff base: 1 s before attempt 2, 2 s before attempt 3 (deterministic, no jitter). */
export const BACKOFF_BASE_MS = 1000;

/** Only a ProviderError marked retryable is retried; auth, quota, parse and BudgetExceeded never are. */
export function isRetryable(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.retryable;
}

/** Spec §5.3 http-kit over globalThis.fetch; no injectable transport (tests use msw on global fetch). */
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  let inFlight = 0;
  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    const limits = deps.limits[r.providerId];
    if (limits === undefined) throw new ProviderError({ kind: 'upstream', retryable: false, providerId: r.providerId, message: `${r.providerId}: no HTTP limits configured [egress-denied]` });
    inFlight += 1;
    try {
      const result = await pRetry((attempt) => runAttempt(deps, r, limits, attempt), {
        retries: MAX_ATTEMPTS - 1,
        minTimeout: BACKOFF_BASE_MS,
        factor: 2,
        randomize: false,
        shouldRetry: ({ error }) => isRetryable(error),
      });
      return { status: result.status, body: result.body, fetchedAt: result.fetchedAt, fromCache: false, cacheKey: '' };
    } finally {
      inFlight -= 1;
    }
  }
  return { request, stats: () => ({ inFlight }) };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/pipeline.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add packages/providers && git commit -m "wp04: http-kit reserves before fetch on every attempt (spec §5.3)"
```

### Task 4.2: `stripUrl`, `scrubSecrets`, `canonicalCacheKey`

**Files:**
- Create: `src/util.ts`, `src/http/scrub.ts`, `src/http/cacheKey.ts`
- Test: `test/http/scrub.test.ts`, `test/http/cacheKey.test.ts`

**Interfaces:**
- Produces: `stripUrl`, `scrubSecrets`, `containsSecret`, `canonicalCacheKey`, `isRecord`, `parseMaybeJson`.

- [ ] **Step 1: Write the failing tests**

`test/http/scrub.test.ts`:

```ts
import { Secret } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { containsSecret, scrubSecrets, stripUrl } from '../../src/http/scrub.js';

const key = new Secret('test-searchapi-key-0123456789abcdef');
const odd = new Secret('p@ss/word+0123456789');

describe('stripUrl (spec §5.3: origin + path only)', () => {
  it('drops query, fragment and userinfo', () => {
    expect(stripUrl('https://user:pw@www.searchapi.io/api/v1/search?api_key=x&engine=y#frag')).toBe('https://www.searchapi.io/api/v1/search');
  });
  it('keeps a non-default port', () => expect(stripUrl('http://fixture.local:8080/calendar?a=1')).toBe('http://fixture.local:8080/calendar'));
  it('returns <url> for anything unparseable', () => expect(stripUrl('not a url')).toBe('<url>'));
});

describe('scrubSecrets (deep, keys included)', () => {
  it('replaces raw and URL-encoded secret values anywhere in a structure', () => {
    const value = {
      a: `Invalid API key ${key.reveal()}`,
      list: [`x${encodeURIComponent(odd.reveal())}y`, 3, null, true],
      [key.reveal()]: { nested: odd.reveal() },
    };
    const out = scrubSecrets(value, [key, odd]);
    expect(JSON.stringify(out)).not.toContain(key.reveal());
    expect(JSON.stringify(out)).not.toContain(odd.reveal());
    expect(JSON.stringify(out)).not.toContain(encodeURIComponent(odd.reveal()));
    expect(out.a).toBe('Invalid API key [redacted]');
    expect(out.list).toEqual(['x[redacted]y', 3, null, true]);
  });
  it('leaves values without secrets unchanged', () => {
    expect(scrubSecrets({ n: 1, s: 'plain' }, [key])).toEqual({ n: 1, s: 'plain' });
  });
  it('ignores an empty secret instead of redacting everything', () => {
    expect(scrubSecrets('abc', [new Secret('')])).toBe('abc');
  });
});

describe('containsSecret', () => {
  it('finds raw and encoded forms', () => {
    expect(containsSecret(`?k=${encodeURIComponent(odd.reveal())}`, [odd])).toBe(true);
    expect(containsSecret('nothing here', [key, odd])).toBe(false);
  });
});
```

`test/http/cacheKey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canonicalCacheKey } from '../../src/http/cacheKey.js';
import { ALL_SECRETS, req, SEARCH, SENTINELS } from '../fakes.js';

const url = `${SEARCH}?engine=google_flights&departure_id=LHR&arrival_id=JFK`;

describe('canonicalCacheKey (spec §5.3: sha256 over the credential-free canonical request)', () => {
  it('is 64 lower-case hex characters and never contains a secret', () => {
    const k = canonicalCacheKey(req({ url }), ALL_SECRETS);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    for (const s of ALL_SECRETS) expect(k).not.toContain(s.reveal());
  });
  it('ignores credential headers and their values', () => {
    const a = canonicalCacheKey(req({ url, headers: { authorization: `Bearer ${SENTINELS.searchapi.reveal()}` } }), ALL_SECRETS);
    const b = canonicalCacheKey(req({ url, headers: { authorization: 'Bearer another-key-entirely' } }), ALL_SECRETS);
    const c = canonicalCacheKey(req({ url, headers: { 'X-Access-Token': SENTINELS.travelpayouts.reveal() } }), ALL_SECRETS);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
  it('is independent of query parameter order', () => {
    const reordered = `${SEARCH}?arrival_id=JFK&engine=google_flights&departure_id=LHR`;
    expect(canonicalCacheKey(req({ url }), ALL_SECRETS)).toBe(canonicalCacheKey(req({ url: reordered }), ALL_SECRETS));
  });
  it('changes with any parameter value, the host, the method or the body', () => {
    const base = canonicalCacheKey(req({ url }), ALL_SECRETS);
    expect(canonicalCacheKey(req({ url: url.replace('JFK', 'EWR') }), ALL_SECRETS)).not.toBe(base);
    expect(canonicalCacheKey(req({ url: url.replace('www.searchapi.io', 'api.travelpayouts.com') }), ALL_SECRETS)).not.toBe(base);
    expect(canonicalCacheKey(req({ url, method: 'POST' }), ALL_SECRETS)).not.toBe(base);
    expect(canonicalCacheKey(req({ url, body: '{"a":1}' }), ALL_SECRETS)).not.toBe(base);
  });
  it('never includes executionId or tileIndex, so sibling pairs share a cached metro response (plan decision 14)', () => {
    const base = canonicalCacheKey(req({ url, executionId: 'exec-1', tileIndex: 0 }), ALL_SECRETS);
    expect(canonicalCacheKey(req({ url, executionId: 'exec-2', tileIndex: 7 }), ALL_SECRETS)).toBe(base);
    expect(canonicalCacheKey(req({ url, executionId: null, tileIndex: null }), ALL_SECRETS)).toBe(base);
  });
  it('drops a parameter whose value is a secret, so the key matches the credential-free request', () => {
    const leaky = `${url}&api_key=${SENTINELS.searchapi.reveal()}`;
    expect(canonicalCacheKey(req({ url: leaky }), ALL_SECRETS)).toBe(canonicalCacheKey(req({ url }), ALL_SECRETS));
  });
  it('keeps a non-credential header such as accept-language', () => {
    const a = canonicalCacheKey(req({ url, headers: { 'accept-language': 'en' } }), ALL_SECRETS);
    const b = canonicalCacheKey(req({ url, headers: { 'accept-language': 'fr' } }), ALL_SECRETS);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/scrub.test.ts test/http/cacheKey.test.ts`
Expected: FAIL — `Failed to load url ../../src/http/scrub.js` and `Failed to load url ../../src/http/cacheKey.js`.

- [ ] **Step 3: Implement**

`src/util.ts`:

```ts
/** Plain-object guard for vendor and fixture JSON. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON-parses a request body when it is JSON, else returns it as text; `undefined` → null. */
export function parseMaybeJson(text: string | undefined): unknown {
  if (text === undefined) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
```

`src/http/scrub.ts`:

```ts
import type { Secret } from '@gmt/core';
import { isRecord } from '../util.js';

const REDACTED = '[redacted]';

/** Origin + path only: no query, fragment or userinfo. Spec §5.3 "every URL written to any sink". */
export function stripUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '<url>';
  }
}

/** The forms in which a secret can appear in text: raw and URL-encoded. Empty secrets have none. */
function formsOf(secrets: readonly Secret[]): string[] {
  const out = new Set<string>();
  for (const s of secrets) {
    const v = s.reveal();
    if (v === '') continue;
    out.add(v);
    out.add(encodeURIComponent(v));
  }
  // why: longest first, so a secret that contains another is replaced whole.
  return [...out].sort((a, b) => b.length - a.length);
}

/** True when any secret, raw or URL-encoded, occurs in `text`. */
export function containsSecret(text: string, secrets: readonly Secret[]): boolean {
  return formsOf(secrets).some((f) => text.includes(f));
}

/**
 * Deep copy of `value` with every secret occurrence (raw or URL-encoded, in values and in object keys)
 * replaced by `[redacted]`. Throws if a secret is still present afterwards. Spec §5.3: cache bodies,
 * error reasons and returned bodies are scrubbed before any sink sees them.
 */
export function scrubSecrets<T>(value: T, secrets: readonly Secret[]): T {
  const forms = formsOf(secrets);
  if (forms.length === 0) return value;
  const text = (s: string): string => forms.reduce((acc, f) => acc.split(f).join(REDACTED), s);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), walk(x)]));
    return v;
  };
  const out = walk(value) as T;
  const serialised = typeof out === 'string' ? out : JSON.stringify(out) ?? '';
  if (containsSecret(serialised, secrets)) throw new Error('scrubSecrets: a secret survived scrubbing');
  return out;
}
```

`src/http/cacheKey.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Secret } from '@gmt/core';
import { containsSecret, scrubSecrets } from './scrub.js';
import type { HttpKitRequest } from './types.js';

/** Header names that carry credentials for any vendor this app talks to; never part of a cache key. */
export const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set(['authorization', 'proxy-authorization', 'x-access-token', 'x-api-key', 'cookie']);

const byPair = (a: [string, string], b: [string, string]): number =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;

/**
 * Cache key = sha256 hex over the credential-free canonical request (spec §5.3; plan http-kit block):
 * method + credential-free URL (origin, path, sorted query pairs without any secret-bearing pair) +
 * sorted non-credential headers + the body with secrets redacted — nothing else. Never `executionId`,
 * `tileIndex` or `providerId`. Two requests that differ only in credentials share a key.
 * why: Travelpayouts sibling pairs that share a metro code issue identical requests from different
 * tiles and executions and must share the cached response (plan decision 14, spec §5.2 rev 10).
 */
export function canonicalCacheKey(r: HttpKitRequest, secrets: readonly Secret[]): string {
  const query = [...r.url.searchParams.entries()]
    .filter(([k, v]) => !containsSecret(k, secrets) && !containsSecret(v, secrets))
    .sort(byPair);
  const headers = Object.entries(r.headers)
    .map(([k, v]): [string, string] => [k.toLowerCase(), v])
    .filter(([k, v]) => !CREDENTIAL_HEADERS.has(k) && !containsSecret(v, secrets))
    .sort(byPair);
  const canonical = JSON.stringify({
    method: r.method,
    origin: r.url.origin,
    path: r.url.pathname,
    query,
    headers,
    body: r.body === undefined ? null : scrubSecrets(r.body, secrets),
  });
  return createHash('sha256').update(canonical).digest('hex');
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/scrub.test.ts test/http/cacheKey.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: stripUrl, scrubSecrets and the credential-free cache key (spec §5.3)"
```

### Task 4.3: Error mapping, Retry-After, backoff, timeouts, aborts and the redirect refusal

**Files:**
- Replace: `src/http/classify.ts`, `src/http/attempt.ts`, `src/http/httpKit.ts`
- Create: `src/http/sleep.ts`
- Test: `test/http/errors.test.ts`

**Interfaces:**
- Consumes: `ProviderError`, `ProviderErrorKind`, `stripUrlsInText`, `AbortedError` (WP0); `scrubSecrets` (Task 4.2).
- Produces: `classifyResponse`, `parseRetryAfter`, `vendorMessage`, `classifyThrown`, `malformedBody`, `redirectRefused`, `requestTimeout`, `ledgerAtCap`, `raceAbort`, `sleep`.

- [ ] **Step 1: Write the failing tests**

`test/http/errors.test.ts`:

```ts
import { AbortedError, asIsoDateTime, ProviderError } from '@gmt/core';
import { http, HttpResponse } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRetryAfter } from '../../src/http/classify.js';
import { makeKit, req, SEARCH, SENTINELS, TP } from '../fakes.js';
import { server } from '../support/msw.js';
import { driveError, drive, useFakeTime } from '../support/time.js';

const reply = (status: number, body: unknown = { error: `synthetic ${status}` }, headers: Record<string, string> = {}) =>
  server.use(http.get(SEARCH, () => HttpResponse.json(body, { status, headers })));
const hang = (url: string) => server.use(http.get(url, () => new Promise<Response>(() => undefined)));

describe('default error mapping (spec §5.2 "Errors", §9 item 2)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'quota'],
    [404, 'upstream'],
  ] as const)('HTTP %i → %s, never retried', async (status, kind) => {
    const { kit, budget } = makeKit();
    reply(status);
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind, retryable: false, httpStatus: status });
    expect(budget.count('fetch')).toBe(1);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error']);
  });

  it('HTTP 400 → parse with the vendor message in the error message (→ last_error), never in reason; never retried', async () => {
    const { kit, budget } = makeKit();
    reply(400, { error: 'Too many combinations: 240 > 200' });
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'parse', retryable: false, reason: undefined, message: expect.stringContaining('Too many combinations: 240 > 200') });
    expect(budget.count('fetch')).toBe(1);
  });

  it('HTTP 429 → rate-limit, retried to 3 attempts', async () => {
    const { kit, budget } = makeKit();
    reply(429);
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'rate-limit', retryable: true, httpStatus: 429 });
    expect(budget.count('fetch')).toBe(3);
    expect(budget.events.filter((e) => e.type === 'reserve').map((e) => e.httpAttempt)).toEqual([1, 2, 3]);
  });

  it('HTTP 429 while the ledger shows the provider at its plan cap → quota, never retried', async () => {
    const { kit, budget } = makeKit();
    budget.caps.set('provider-month:searchapi', 1);
    reply(429);
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'quota', retryable: false, message: expect.stringContaining('[ledger-at-cap]') });
    expect(budget.count('fetch')).toBe(1);
  });

  it('a lifetime-window cap counts too (trial plan)', async () => {
    const { kit, budget } = makeKit();
    budget.caps.set('provider-lifetime:searchapi', 1);
    reply(429);
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({ kind: 'quota' });
  });

  it('HTTP 503 → upstream retryable; three finalise(error) rows', async () => {
    const { kit, budget } = makeKit();
    reply(503);
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'upstream', retryable: true, httpStatus: 503 });
    expect(budget.sequence().filter((s) => s.startsWith('finalise'))).toEqual(['finalise:error', 'finalise:error', 'finalise:error']);
  });

  it('other 4xx (409) → upstream, never retried', async () => {
    const { kit, budget } = makeKit();
    reply(409);
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({ kind: 'upstream', retryable: false });
    expect(budget.count('fetch')).toBe(1);
  });

  it('malformed JSON on a 200 → parse, never retried, finalised ok with status 200 (the vendor billed it)', async () => {
    const { kit, budget } = makeKit();
    server.use(http.get(SEARCH, () => new HttpResponse('{"calendar": [', { status: 200, headers: { 'content-type': 'application/json' } })));
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'parse', retryable: false, message: expect.stringContaining('[malformed-json]') });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:ok']);
    expect(budget.events.find((e) => e.type === 'finalise')).toMatchObject({ httpStatus: 200 });
  });

  it('a socket error → network, retried to 3 attempts, finalised error without status', async () => {
    const { kit, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.error()));
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'network', retryable: true, message: expect.stringContaining('[socket]') });
    expect(budget.count('fetch')).toBe(3);
    const finals = budget.events.filter((e) => e.type === 'finalise');
    expect(finals.every((e) => e.outcome === 'error' && e.httpStatus === undefined)).toBe(true);
  });

  it('an adapter classifyError override is used instead of the default table', async () => {
    const { kit, budget } = makeKit({
      limits: {
        searchapi: {
          classifyError: (status) => new ProviderError({ kind: 'quota', retryable: false, httpStatus: status, message: 'recorded quota body' }),
        },
      },
    });
    reply(429, { error: 'monthly searches exhausted' });
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({ kind: 'quota', message: 'recorded quota body' });
    expect(budget.count('fetch')).toBe(1);
  });
});

describe('Retry-After and backoff (fake timers)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('backs off 1 s then 2 s between attempts', async () => {
    const { kit, budget } = makeKit();
    let n = 0;
    server.use(http.get(SEARCH, () => (++n < 3 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json({ ok: 1 }))));
    const t0 = Date.now();
    await drive(kit.request(req({ url: SEARCH })), { stepMs: 50 });
    const at = budget.events.filter((e) => e.type === 'fetch').map((e) => e.at - t0);
    expect(at).toHaveLength(3);
    expect(at[1] ?? 0).toBeGreaterThanOrEqual(1000);
    expect(at[1] ?? 0).toBeLessThan(1500);
    expect((at[2] ?? 0) - (at[1] ?? 0)).toBeGreaterThanOrEqual(2000);
    expect((at[2] ?? 0) - (at[1] ?? 0)).toBeLessThan(2500);
  });

  it('honours Retry-After (seconds) before the next attempt', async () => {
    const { kit, budget } = makeKit();
    let n = 0;
    server.use(
      http.get(SEARCH, () => (++n === 1 ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } }) : HttpResponse.json({ ok: 1 }))),
    );
    const t0 = Date.now();
    await drive(kit.request(req({ url: SEARCH })));
    const at = budget.events.filter((e) => e.type === 'fetch').map((e) => e.at - t0);
    expect(at[1] ?? 0).toBeGreaterThanOrEqual(30_000);
  });

  it('a Retry-After beyond maxWaitSeconds → limiter-timeout, not retried', async () => {
    const { kit, budget } = makeKit();
    reply(429, {}, { 'Retry-After': '7200' });
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'limiter-timeout', retryable: false, retryAfterSeconds: 7200 });
    expect(budget.count('fetch')).toBe(1);
  });

  it('parses an HTTP-date Retry-After relative to the clock', () => {
    const now = asIsoDateTime('2026-10-14T15:00:00.000Z');
    expect(parseRetryAfter('Wed, 14 Oct 2026 15:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('Wed, 14 Oct 2026 14:00:00 GMT', now)).toBe(0);
  });
});

describe('per-request timeout, abort and redirect', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('timeout on a billed vendor (billable http-200) → network, finalised unknown, not retried', async () => {
    const { kit, budget } = makeKit({ limits: { searchapi: { requestTimeoutSeconds: 5 } } });
    hang(SEARCH);
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'network', message: expect.stringContaining('[timeout]'), retryable: false });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:unknown']);
  });

  it('timeout on a free vendor (billable never) → retried to 3 attempts, each finalised unknown', async () => {
    const { kit, budget } = makeKit({ limits: { travelpayouts: { requestTimeoutSeconds: 5 } } });
    hang(TP);
    const r = req({ url: TP, providerId: 'travelpayouts', headers: { 'x-access-token': SENTINELS.travelpayouts.reveal() } });
    const err = await driveError(kit.request(r));
    expect(err).toMatchObject({ kind: 'network', message: expect.stringContaining('[timeout]'), retryable: true });
    expect(budget.sequence().filter((s) => s.startsWith('finalise'))).toEqual(['finalise:unknown', 'finalise:unknown', 'finalise:unknown']);
  });

  it('abort mid-fetch → finalise(unknown) before AbortedError, no retry', async () => {
    const { kit, budget } = makeKit();
    hang(SEARCH);
    const ac = new AbortController();
    const p = kit.request(req({ url: SEARCH, signal: ac.signal }));
    setTimeout(() => ac.abort(), 1000);
    const err = await driveError(p);
    expect(err).toBeInstanceOf(AbortedError);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:unknown']);
  });

  it('an already-aborted signal → AbortedError with no reserve and no fetch', async () => {
    const { kit, budget } = makeKit();
    const ac = new AbortController();
    ac.abort();
    expect(await driveError(kit.request(req({ url: SEARCH, signal: ac.signal })))).toBeInstanceOf(AbortedError);
    expect(budget.reserveCalls).toBe(0);
    expect(budget.count('fetch')).toBe(0);
  });

  it('abort during the backoff sleep → AbortedError, no further attempt', async () => {
    const { kit, budget } = makeKit();
    reply(503);
    const ac = new AbortController();
    const p = kit.request(req({ url: SEARCH, signal: ac.signal }));
    setTimeout(() => ac.abort(), 500);
    expect(await driveError(p, { stepMs: 50 })).toBeInstanceOf(AbortedError);
    expect(budget.count('fetch')).toBe(1);
  });

  it('a 302 to another host is refused: the other host is never contacted and no credential leaves', async () => {
    const { kit, budget } = makeKit();
    let evilHits = 0;
    server.use(
      http.get(SEARCH, () => new HttpResponse(null, { status: 302, headers: { Location: 'https://evil.example/steal' } })),
      http.get('https://evil.example/steal', () => {
        evilHits += 1;
        return HttpResponse.json({});
      }),
    );
    const err = await driveError(kit.request(req({ url: SEARCH })));
    expect(err).toMatchObject({ kind: 'upstream', message: expect.stringContaining('[redirect-refused]'), retryable: false });
    expect(evilHits).toBe(0);
    const fetches = budget.events.filter((e) => e.type === 'fetch');
    expect(fetches).toHaveLength(1);
    expect(fetches.every((e) => e.url.startsWith(SEARCH))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/errors.test.ts`
Expected: FAIL — `parseRetryAfter` is not exported by `classify.js`; with that fixed, the 401/402/400/429/malformed/socket/timeout/abort/redirect cases fail against the first-version classification and attempt (e.g. "expected 'upstream' to be 'auth'").

- [ ] **Step 3: Implement**

`src/http/classify.ts` (replace):

```ts
import { type IsoDateTime, ProviderError, type ProviderErrorKind, type Secret, stripUrlsInText } from '@gmt/core';
import { isRecord } from '../util.js';
import { scrubSecrets } from './scrub.js';
import type { HttpProviderId } from './types.js';

/** Facts about one non-2xx response: the input of the default classification. Spec §5.2 "Errors". */
export interface ResponseFacts {
  providerId: HttpProviderId;
  endpointPath: string;
  status: number;
  body: unknown;
  retryAfter: string | null;
  ledgerAtCap: boolean;
  maxWaitSeconds: number;
  now: IsoDateTime;
  secrets: readonly Secret[];
}

type Where = { providerId: HttpProviderId; endpointPath: string };

/**
 * Builds a ProviderError whose message names provider and path only, never a URL, ending in a bracketed
 * diagnostic code (`[timeout]`, `[redirect-refused]`, …) that tests and logs can match.
 * why: `ProviderError.reason` becomes `cell_outcomes.reason` (spec §8.1 `reason = error.reason ?? kind`),
 * which holds the kind or a spec-named reason only (spec §3 rev 10), so http-kit never sets `reason`;
 * the vendor's message travels in `message`, which the engine writes to `last_error`.
 */
function providerError(
  w: Where,
  p: { kind: ProviderErrorKind; retryable: boolean; detail: string; httpStatus?: number; code?: string; retryAfterSeconds?: number },
): ProviderError {
  return new ProviderError({
    kind: p.kind,
    retryable: p.retryable,
    providerId: w.providerId,
    message: `${w.providerId} ${w.endpointPath}: ${p.detail}${p.code === undefined ? '' : ` [${p.code}]`}`,
    ...(p.httpStatus === undefined ? {} : { httpStatus: p.httpStatus }),
    ...(p.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: p.retryAfterSeconds }),
  });
}

/** Retry-After as whole seconds: delta-seconds or an HTTP-date relative to `now` (RFC 9110 §10.2.3). */
export function parseRetryAfter(value: string | null, now: IsoDateTime): number | undefined {
  if (value === null) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.parse(now)) / 1000));
}

/** A vendor's own message (`error` or `message` field, or a text body), scrubbed, URL-free, ≤ 200 chars; it goes into the error message (→ `last_error`), never `reason`. */
export function vendorMessage(body: unknown, secrets: readonly Secret[]): string | undefined {
  let raw: string | undefined;
  if (typeof body === 'string') raw = body;
  else if (isRecord(body)) {
    const m = body.error ?? body.message;
    if (typeof m === 'string') raw = m;
  }
  if (raw === undefined || raw.trim() === '') return undefined;
  return stripUrlsInText(scrubSecrets(raw, secrets)).trim().slice(0, 200);
}

/**
 * The default status → ProviderError table, spec §5.2 "Errors":
 * 401/403 auth · 402 quota · 400 parse (vendor message in the error message, spec rev 10) · 404 upstream · 429 rate-limit, or
 * quota when the ledger shows the plan cap · 5xx upstream (retryable) · any other status upstream
 * (non-retryable). A Retry-After above maxWaitSeconds on a retryable status becomes limiter-timeout.
 */
export function classifyResponse(f: ResponseFacts): ProviderError {
  const w: Where = { providerId: f.providerId, endpointPath: f.endpointPath };
  const httpStatus = f.status;
  const wait = parseRetryAfter(f.retryAfter, f.now);
  const waitFields = wait === undefined ? {} : { retryAfterSeconds: wait };
  const tooLong = (): ProviderError =>
    providerError(w, {
      kind: 'limiter-timeout',
      retryable: false,
      httpStatus,
      code: 'retry-after-exceeds-max-wait',
      retryAfterSeconds: wait ?? 0,
      detail: `HTTP ${httpStatus} asks to wait ${wait}s, beyond MAX_WAIT_SECONDS ${f.maxWaitSeconds}`,
    });

  if (httpStatus === 401 || httpStatus === 403) return providerError(w, { kind: 'auth', retryable: false, httpStatus, detail: `HTTP ${httpStatus} (credentials refused)` });
  if (httpStatus === 402) return providerError(w, { kind: 'quota', retryable: false, httpStatus, detail: 'HTTP 402 (plan quota)' });
  if (httpStatus === 400) {
    const vendor = vendorMessage(f.body, f.secrets);
    return providerError(w, { kind: 'parse', retryable: false, httpStatus, code: 'bad-request', detail: `HTTP 400${vendor ? ` (${vendor})` : ''}` });
  }
  if (httpStatus === 404) return providerError(w, { kind: 'upstream', retryable: false, httpStatus, detail: 'HTTP 404' });
  if (httpStatus === 429) {
    // why: spec §5.2 — a 429 at the plan cap is the quota, and retrying it only burns attempts.
    if (f.ledgerAtCap) return providerError(w, { kind: 'quota', retryable: false, httpStatus, code: 'ledger-at-cap', detail: 'HTTP 429 at the plan cap' });
    if (wait !== undefined && wait > f.maxWaitSeconds) return tooLong();
    return providerError(w, { kind: 'rate-limit', retryable: true, httpStatus, ...waitFields, detail: 'HTTP 429' });
  }
  if (httpStatus >= 500) {
    if (wait !== undefined && wait > f.maxWaitSeconds) return tooLong();
    return providerError(w, { kind: 'upstream', retryable: true, httpStatus, ...waitFields, detail: `HTTP ${httpStatus}` });
  }
  return providerError(w, { kind: 'upstream', retryable: false, httpStatus, detail: `HTTP ${httpStatus}` });
}

/** A 2xx whose body is not JSON. Spec §5.2: malformed → parse. */
export function malformedBody(w: Where, httpStatus: number): ProviderError {
  return providerError(w, { kind: 'parse', retryable: false, httpStatus, code: 'malformed-json', detail: `HTTP ${httpStatus} with a body that is not JSON` });
}

/** A 3xx reached us, or fetch refused to follow one (`redirect: 'error'`). Spec §5.3 egress. */
export function redirectRefused(w: Where, httpStatus?: number): ProviderError {
  return providerError(w, {
    kind: 'upstream',
    retryable: false,
    code: 'redirect-refused',
    ...(httpStatus === undefined ? {} : { httpStatus }),
    detail: 'redirect refused (redirect: error)',
  });
}

/** Per-request timeout. Spec §5.2: network, finalised unknown, not retried for billed vendors. */
export function requestTimeout(w: Where, billable: 'http-200' | 'never'): ProviderError {
  return providerError(w, { kind: 'network', retryable: billable === 'never', code: 'timeout', detail: 'request timed out (REQUEST_TIMEOUT_SECONDS)' });
}

/** A rejection from fetch itself: a refused redirect, or a socket-level failure (network, retryable). */
export function classifyThrown(err: unknown, w: Where): ProviderError {
  const cause = err instanceof Error && err.cause !== undefined ? err.cause : undefined;
  const text = [err instanceof Error ? err.message : String(err), cause instanceof Error ? cause.message : String(cause ?? '')].join(' ');
  if (/redirect/i.test(text)) return redirectRefused(w);
  return providerError(w, { kind: 'network', retryable: true, code: 'socket', detail: 'network error' });
}
```

`src/http/sleep.ts`:

```ts
import { AbortedError } from '@gmt/core';

/** Waits `ms`, rejecting with AbortedError as soon as `signal` aborts. Used for Retry-After (spec §5.3). */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
```

`src/http/attempt.ts` (replace):

```ts
import { AbortedError, type IsoDateTime, type Reservation } from '@gmt/core';
import { classifyResponse, classifyThrown, malformedBody, redirectRefused, requestTimeout } from './classify.js';
import { scrubSecrets } from './scrub.js';
import type { HttpKitDeps, HttpKitRequest, HttpProviderId, ProviderHttpLimits } from './types.js';

/** The outcome of one successful HTTP attempt; `body` is already scrubbed of every secret. */
export interface AttemptResult {
  status: number;
  body: unknown;
  fetchedAt: IsoDateTime;
}

/** Rejects with the signal's reason as soon as it aborts, whether or not `p` itself honours the signal. */
export function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** True when the ledger shows the provider at its plan cap in its month or lifetime window (spec §5.2 429 rule). */
export function ledgerAtCap(deps: HttpKitDeps, providerId: HttpProviderId): boolean {
  if (providerId === 'fx') return false;
  for (const kind of ['provider-month', 'provider-lifetime'] as const) {
    const u = deps.budget.usage({ kind, providerId });
    if (u.cap !== null && u.calls >= u.cap) return true;
  }
  return false;
}

/**
 * One attempt of spec §5.3's retry body: budget.reserve → fetch → reservation.finalise → classify.
 * - reserve runs before the request leaves the process (BudgetExceeded propagates, nothing is sent);
 * - fetch uses `redirect: 'error'` and the per-request timeout combined with the caller's signal;
 * - finalise runs exactly once per reserve: `ok` for 2xx (even if the body is malformed: the vendor
 *   billed it), `error` for any other status or a socket failure, `unknown` for timeout and abort;
 * - an abort finalises `unknown` before AbortedError propagates (spec §5.3, tested).
 */
export async function runAttempt(deps: HttpKitDeps, r: HttpKitRequest, limits: ProviderHttpLimits, attempt: number): Promise<AttemptResult> {
  if (r.signal.aborted) throw new AbortedError();
  const w = { providerId: r.providerId, endpointPath: r.endpointPath };
  // why: 'fx' is not a ProviderId in the BudgetGuard port and spec §5.6 says FX calls are not ledgered.
  const reservation: Reservation | null =
    r.providerId === 'fx'
      ? null
      : deps.budget.reserve({
          providerId: r.providerId,
          executionId: r.executionId,
          tileIndex: r.tileIndex,
          costMicroGbp: limits.costPerCallMicroGbp,
          httpAttempt: attempt,
          endpointPath: r.endpointPath,
        });
  // why: durations use Date.now() so vitest fake timers drive them; instants (fetchedAt) use the Clock port.
  const started = Date.now();
  const finalise = (outcome: 'ok' | 'error' | 'unknown', httpStatus?: number): void =>
    reservation?.finalise({ outcome, durationMs: Date.now() - started, ...(httpStatus === undefined ? {} : { httpStatus }) });
  // why: setTimeout + AbortController rather than AbortSignal.timeout, whose Node-internal timer vitest cannot fake.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), limits.requestTimeoutSeconds * 1000);
  const signal = AbortSignal.any([r.signal, timeout.signal]);

  let status: number;
  let retryAfter: string | null;
  let text: string;
  try {
    const res = await raceAbort(
      fetch(r.url, { method: r.method, headers: r.headers, ...(r.body === undefined ? {} : { body: r.body }), redirect: 'error', signal }),
      signal,
    );
    status = res.status;
    retryAfter = res.headers.get('retry-after');
    text = await raceAbort(res.text(), signal);
  } catch (err) {
    if (r.signal.aborted) {
      finalise('unknown');
      throw new AbortedError();
    }
    if (timeout.signal.aborted) {
      finalise('unknown');
      throw requestTimeout(w, limits.billable);
    }
    finalise('error');
    throw classifyThrown(err, w);
  } finally {
    clearTimeout(timer);
  }

  const ok = status >= 200 && status < 300;
  finalise(ok ? 'ok' : 'error', status);
  if (status >= 300 && status < 400) throw redirectRefused(w, status);

  let body: unknown;
  let malformed = false;
  try {
    body = text === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    body = text;
    malformed = true;
  }

  if (!ok) {
    const atCap = status === 429 && ledgerAtCap(deps, r.providerId);
    throw limits.classifyError
      ? limits.classifyError(status, body, atCap)
      : classifyResponse({ ...w, status, body, retryAfter, ledgerAtCap: atCap, maxWaitSeconds: limits.maxWaitSeconds, now: deps.clock.now(), secrets: deps.secrets });
  }
  if (malformed) throw malformedBody(w, status);
  return { status, body: scrubSecrets(body, deps.secrets), fetchedAt: deps.clock.now() };
}
```

`src/http/httpKit.ts` (replace; Tasks 4.4 and 4.5 add one line each, Task 4.6 adds cache and dedup):

```ts
import { AbortedError, ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { runAttempt } from './attempt.js';
import { sleep } from './sleep.js';
import type { HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse } from './types.js';

export type {
  FixtureRecorder,
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
} from './types.js';

/** Spec §5.3: p-retry, max 3 attempts. */
export const MAX_ATTEMPTS = 3;
/** Exponential backoff base: 1 s before attempt 2, 2 s before attempt 3 (deterministic, no jitter). */
export const BACKOFF_BASE_MS = 1000;

/** Only a ProviderError marked retryable is retried; auth, quota, parse and BudgetExceeded never are. */
export function isRetryable(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.retryable;
}

/** Spec §5.3 http-kit over globalThis.fetch; no injectable transport (tests use msw on global fetch). */
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  let inFlight = 0;
  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    if (r.signal.aborted) throw new AbortedError();
    const limits = deps.limits[r.providerId];
    if (limits === undefined) throw new ProviderError({ kind: 'upstream', retryable: false, providerId: r.providerId, message: `${r.providerId}: no HTTP limits configured [egress-denied]` });
    inFlight += 1;
    try {
      const result = await pRetry((attempt) => runAttempt(deps, r, limits, attempt), {
        retries: MAX_ATTEMPTS - 1,
        minTimeout: BACKOFF_BASE_MS,
        factor: 2,
        randomize: false,
        signal: r.signal,
        shouldRetry: ({ error }) => isRetryable(error),
        // why: p-retry calls onFailedAttempt even when shouldRetry will refuse, so the Retry-After wait
        // checks retryability and remaining attempts itself; the sleep is abortable.
        onFailedAttempt: async ({ error, retriesLeft }) => {
          if (retriesLeft > 0 && isRetryable(error) && error.retryAfterSeconds !== undefined) {
            await sleep(error.retryAfterSeconds * 1000, r.signal);
          }
        },
      });
      return { status: result.status, body: result.body, fetchedAt: result.fetchedAt, fromCache: false, cacheKey: '' };
    } catch (err) {
      // why: p-retry rethrows the signal's reason on abort; the engine contract is AbortedError (spec §5.2).
      if (r.signal.aborted && !(err instanceof AbortedError)) throw new AbortedError();
      throw err;
    } finally {
      inFlight -= 1;
    }
  }
  return { request, stats: () => ({ inFlight }) };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/errors.test.ts test/http/pipeline.test.ts`
Expected: PASS, 24 tests. If the redirect case fails because the runtime reports the refused redirect without the word "redirect" in `message` or `cause.message`, print `err` and `err.cause` in the test once, extend the pattern in `classifyThrown` to match that exact text, and keep every assertion of the test unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: default error table, Retry-After, backoff, timeout, abort and redirect refusal (spec §5.2, §5.3)"
```

### Task 4.4: Egress allowlist and the gated in-process seam

**Files:**
- Create: `src/http/egress.ts`, `src/fixture/constants.ts`
- Modify: `src/http/httpKit.ts`, `src/http/attempt.ts`
- Test: `test/http/egress.test.ts`, `test/http/inProcess.test.ts`

**Interfaces:**
- Produces: `assertEgress(r, limits, secrets): asserts limits is ProviderHttpLimits`, `assertInProcessHosts(hosts)`; `HttpKitDeps.inProcessHosts` dispatch (spec §4 rev 10).

- [ ] **Step 1: Write the failing test**

`test/http/egress.test.ts`:

```ts
import { ProviderError } from '@gmt/core';
import { http, HttpResponse } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH, SENTINELS } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

describe('egress allowlist (spec §5.3 "Egress")', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  const refused = async (r: Parameters<typeof req>[0]) => {
    const { kit, budget } = makeKit();
    const err = await driveError(kit.request(req(r)));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'upstream', message: expect.stringContaining('[egress-denied]'), retryable: false });
    expect(budget.reserveCalls).toBe(0);
    expect(budget.count('fetch')).toBe(0);
    return err as ProviderError;
  };

  it('refuses a host outside the provider allowlist before reserve', async () => {
    const err = await refused({ url: 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates' });
    expect(err.message).toContain('api.travelpayouts.com');
  });
  it('refuses plain http for a real vendor', async () => {
    await refused({ url: 'http://www.searchapi.io/api/v1/search' });
  });
  it('refuses userinfo in the URL', async () => {
    await refused({ url: 'https://someone:pw@www.searchapi.io/api/v1/search' });
  });
  it('refuses a credential anywhere in the URL, keeping it out of the error message', async () => {
    const err = await refused({ url: `${SEARCH}?api_key=${SENTINELS.searchapi.reveal()}` });
    expect(err.message).not.toContain(SENTINELS.searchapi.reveal());
  });
  it('refuses an endpointPath that is not the URL path or carries a query', async () => {
    await refused({ url: SEARCH, endpointPath: '/api/v1/search?engine=x' });
    await refused({ url: SEARCH, endpointPath: '/other' });
  });
  it('refuses a provider id with no limits configured', async () => {
    const { kit, budget } = makeKit();
    const r = req({ url: SEARCH });
    const err = await driveError(kit.request({ ...r, providerId: 'nope' as never }));
    expect(err).toMatchObject({ message: expect.stringContaining('[egress-denied]') });
    expect(budget.reserveCalls).toBe(0);
  });
  it('allows plain http only for the fixture host', async () => {
    const { kit } = makeKit();
    server.use(http.get('http://fixture.local/health', () => HttpResponse.json({ synthetic: true, ok: true })));
    const res = await drive(kit.request(req({ url: 'http://fixture.local/health', providerId: 'fixture', headers: {} })));
    expect(res.body).toEqual({ synthetic: true, ok: true });
    await refused({ url: 'http://fixture.local/health', providerId: 'travelpayouts', headers: {} });
  });
});
```

`test/http/inProcess.test.ts`:

```ts
import { AbortedError } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req } from '../fakes.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const HEALTH = 'http://fixture.local/health';
const fixtureReq = (over: Partial<Parameters<typeof req>[0]> = {}) => req({ url: HEALTH, providerId: 'fixture', headers: {}, tileIndex: null, ...over });

describe('in-process transport seam (spec §4 rev 10)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('dispatches fixture.local to the in-process function; reserve and finalise still run; msw sees nothing', async () => {
    const seen: string[] = [];
    const { kit, budget } = makeKit({
      inProcessHosts: {
        'fixture.local': async (r) => {
          seen.push(`${r.method} ${r.url}`);
          return Response.json({ synthetic: true, ok: true });
        },
      },
    });
    const res = await drive(kit.request(fixtureReq()));
    expect(res.body).toEqual({ synthetic: true, ok: true });
    expect(seen).toEqual([`GET ${HEALTH}`]);
    expect(budget.sequence()).toEqual(['reserve', 'finalise:ok']);
  });

  it('the per-request timeout and abort apply to an in-process call', async () => {
    const hang = { 'fixture.local': () => new Promise<Response>(() => undefined) };
    const timed = makeKit({ inProcessHosts: hang, limits: { fixture: { requestTimeoutSeconds: 5 } } });
    expect(await driveError(timed.kit.request(fixtureReq()))).toMatchObject({ kind: 'network', message: expect.stringContaining('[timeout]') });
    expect(timed.budget.sequence()).toEqual(['reserve', 'finalise:unknown']);
    const aborted = makeKit({ inProcessHosts: hang });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    expect(await driveError(aborted.kit.request(fixtureReq({ signal: ac.signal })))).toBeInstanceOf(AbortedError);
  });

  it('an in-process Response.error() is a socket error: network, retried to 3 attempts', async () => {
    const { kit, budget } = makeKit({ inProcessHosts: { 'fixture.local': async () => Response.error() } });
    expect(await driveError(kit.request(fixtureReq()))).toMatchObject({ kind: 'network', retryable: true, message: expect.stringContaining('[socket]') });
    expect(budget.sequence().filter((x) => x.startsWith('finalise'))).toEqual(['finalise:error', 'finalise:error', 'finalise:error']);
  });

  it('egress still applies: a provider whose allowlist lacks fixture.local cannot reach it in process', async () => {
    const { kit, budget } = makeKit({ inProcessHosts: { 'fixture.local': async () => Response.json({}) } });
    expect(await driveError(kit.request(fixtureReq({ providerId: 'searchapi' })))).toMatchObject({ message: expect.stringContaining('[egress-denied]') });
    expect(budget.reserveCalls).toBe(0);
  });

  it('createHttpKit refuses an in-process host other than fixture.local', () => {
    expect(() => makeKit({ inProcessHosts: { 'www.searchapi.io': async () => Response.json({}) } })).toThrow(/fixture\.local/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/egress.test.ts test/http/inProcess.test.ts`
Expected: FAIL — requests to non-allowlisted hosts reach `reserve` ("expected 1 to be 0") and msw reports the unhandled request; the in-process cases reach msw (unhandled `fixture.local`) instead of the function.

- [ ] **Step 3: Implement**

`src/http/egress.ts`:

```ts
import { ProviderError, type Secret } from '@gmt/core';
import { FIXTURE_HOST } from '../fixture/constants.js';
import { containsSecret } from './scrub.js';
import type { HttpKitRequest, ProviderHttpLimits } from './types.js';

const PATH_ONLY = /^\/[^?#]*$/;

/**
 * Spec §4 rev 10: the in-process seam exists for the synthetic fixture host only. Wiring decides whether
 * to pass it (only under syntheticAllowed); this refuses any other hostname so the seam cannot widen.
 */
export function assertInProcessHosts(hosts: Record<string, unknown> | undefined): void {
  for (const host of Object.keys(hosts ?? {})) {
    if (host !== FIXTURE_HOST) throw new Error(`inProcessHosts may name only ${FIXTURE_HOST}, got ${host}`);
  }
}

/**
 * Spec §5.3 "Egress", checked before the cache, the ledger or the network: the provider has limits;
 * the scheme is https (plain http only for the fixture provider at fixture.local); no userinfo; the
 * hostname is in the provider's allowlist; `endpointPath` is exactly the URL path; no secret appears
 * anywhere in the URL (keys travel only in headers, spec §2 fact 8).
 */
export function assertEgress(r: HttpKitRequest, limits: ProviderHttpLimits | undefined, secrets: readonly Secret[]): asserts limits is ProviderHttpLimits {
  const safePath = PATH_ONLY.test(r.endpointPath) && !containsSecret(r.endpointPath, secrets) ? r.endpointPath : '<invalid endpointPath>';
  function deny(why: string): never {
    throw new ProviderError({ kind: 'upstream', retryable: false, providerId: r.providerId, message: `${r.providerId} ${safePath}: egress denied (${why}) [egress-denied]` });
  }
  if (limits === undefined) deny('no HTTP limits configured for this provider');
  const u = r.url;
  if (u.username !== '' || u.password !== '') deny('userinfo in URL');
  const schemeOk = u.protocol === 'https:' || (u.protocol === 'http:' && r.providerId === 'fixture' && u.hostname === FIXTURE_HOST);
  if (!schemeOk) deny(`scheme ${u.protocol} not allowed`);
  if (!limits.hosts.includes(u.hostname)) deny(`host ${u.hostname} not in the allowlist`);
  if (!PATH_ONLY.test(r.endpointPath) || r.endpointPath !== u.pathname) deny('endpointPath must equal the URL path');
  if (containsSecret(u.href, secrets)) deny('a credential appears in the URL');
}
```

`src/fixture/constants.ts`:

```ts
/** The fixture provider's only host (spec §5.5, §9 item 2: its allowlist is fixture.local only). */
export const FIXTURE_HOST = 'fixture.local';
export const FIXTURE_ORIGIN = `http://${FIXTURE_HOST}`;
/** Test control route of the fixture server: POST { rules } replaces the scenario, DELETE clears it. */
export const SCENARIO_PATH = '/__fixture/scenario';
/** Per-request override header carrying a FixtureResponse as JSON (direct http-kit tests only). */
export const SCENARIO_HEADER = 'x-fixture-scenario';
```

`src/http/httpKit.ts`: add the import, check the seam at construction, and check egress per request.

```ts
import { assertEgress, assertInProcessHosts } from './egress.js';
```

Replace

```ts
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  let inFlight = 0;
```

with

```ts
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  let inFlight = 0;
  assertInProcessHosts(deps.inProcessHosts);
```

Replace

```ts
    const limits = deps.limits[r.providerId];
    if (limits === undefined) throw new ProviderError({ kind: 'upstream', retryable: false, providerId: r.providerId, message: `${r.providerId}: no HTTP limits configured [egress-denied]` });
    inFlight += 1;
```

with

```ts
    const limits = deps.limits[r.providerId];
    assertEgress(r, limits, deps.secrets);
    inFlight += 1;
```

- [ ] **Step 4: Run to verify it passes**

`src/http/attempt.ts`: dispatch through the seam. Replace

```ts
    const res = await raceAbort(
      fetch(r.url, { method: r.method, headers: r.headers, ...(r.body === undefined ? {} : { body: r.body }), redirect: 'error', signal }),
      signal,
    );
```

with

```ts
    const init: RequestInit = { method: r.method, headers: r.headers, ...(r.body === undefined ? {} : { body: r.body }), redirect: 'error', signal };
    // why: spec §4 rev 10 — the gated in-process seam (fixture.local only); every other host goes to globalThis.fetch.
    const inProcess = deps.inProcessHosts?.[r.url.hostname];
    const res = await raceAbort(inProcess ? inProcess(new Request(r.url, init)) : fetch(r.url, init), signal);
    // why: an in-process Response.error() (fixture 'network') is a socket-level failure, exactly like fetch rejecting.
    if (res.type === 'error') throw new TypeError('network error');
```

Run: `pnpm --filter @gmt/providers exec vitest run test/http/egress.test.ts test/http/inProcess.test.ts test/http/errors.test.ts test/http/pipeline.test.ts`
Expected: PASS, 36 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: egress allowlist and the gated in-process fixture seam (spec §4, §5.3)"
```

### Task 4.5: Limiter — chained per-minute and per-hour reservoirs, concurrency, queue deadline

**Files:**
- Create: `src/http/limiter.ts`
- Modify: `src/http/httpKit.ts`
- Test: `test/http/limiter.test.ts`

**Interfaces:**
- Consumes: bottleneck 2.19.5 (`new Bottleneck`, `chain`, `schedule`).
- Produces: `createLimiter(limits): ProviderLimiter`, `ProviderLimiter.run(fn, { signal, maxWaitMs, providerId, endpointPath })`.

- [ ] **Step 1: Write the failing test**

`test/http/limiter.test.ts`:

```ts
import { AbortedError, ProviderError } from '@gmt/core';
import { http, HttpResponse } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const ok = () => server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
const fetchTimes = (events: ReturnType<typeof makeKit>['events'], t0: number) => events.filter((e) => e.type === 'fetch').map((e) => e.at - t0);
// why: distinct query values so in-flight dedup (Task 4.6) never merges these requests.
const nth = (i: number) => req({ url: `${SEARCH}?n=${i}` });

describe('limiter (spec §5.3: chained per-minute + per-hour reservoirs, maxConcurrent, queue deadline)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('maxConcurrent 1 runs one request at a time', async () => {
    const { kit, events } = makeKit({ limits: { searchapi: { concurrency: 1 } } });
    server.use(
      http.get(SEARCH, async () => {
        await new Promise((r) => setTimeout(r, 10_000));
        return HttpResponse.json({ ok: true });
      }),
    );
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2))]));
    const at = fetchTimes(events, t0);
    expect(at[1] ?? 0).toBeGreaterThanOrEqual(10_000);
  });

  it('a per-minute reservoir of 2 holds the third request until the minute refreshes', async () => {
    const { kit, events } = makeKit({ limits: { searchapi: { ratePerMinute: 2 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2)), kit.request(nth(3))]));
    const at = fetchTimes(events, t0).sort((a, b) => a - b);
    expect(at[1] ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
    expect(at[2] ?? 0).toBeGreaterThanOrEqual(59_000);
  });

  it('the chained per-hour reservoir holds a request even when the minute has room', async () => {
    const { kit, events } = makeKit({ limits: { searchapi: { ratePerMinute: 10, ratePerHour: 2 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2)), kit.request(nth(3))]), { stepMs: 5000, maxMs: 4_000_000 });
    const at = fetchTimes(events, t0).sort((a, b) => a - b);
    expect(at[2] ?? 0).toBeGreaterThanOrEqual(3_590_000);
  });

  it('a queue wait beyond maxWaitSeconds → limiter-timeout with no reserve and no fetch for that request', async () => {
    const { kit, budget } = makeKit({ limits: { searchapi: { ratePerMinute: 1, maxWaitSeconds: 30 } } });
    ok();
    const first = kit.request(nth(1));
    const second = kit.request(nth(2));
    await drive(first);
    const err = await driveError(second);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'limiter-timeout', retryable: false, message: expect.stringContaining('[queue-wait-exceeded]') });
    expect(budget.reserveCalls).toBe(1);
    expect(budget.count('fetch')).toBe(1);
  });

  it('an abort while queued → AbortedError with no reserve', async () => {
    const { kit, budget } = makeKit({ limits: { searchapi: { ratePerMinute: 1 } } });
    ok();
    await drive(kit.request(nth(1)));
    const ac = new AbortController();
    const queued = kit.request(req({ url: `${SEARCH}?n=2`, signal: ac.signal }));
    setTimeout(() => ac.abort(), 5000);
    expect(await driveError(queued)).toBeInstanceOf(AbortedError);
    expect(budget.reserveCalls).toBe(1);
  });

  it('each provider has its own limiter', async () => {
    const { kit, events } = makeKit({ limits: { searchapi: { ratePerMinute: 1 } } });
    ok();
    server.use(http.get('https://api.travelpayouts.com/aviasales/v3/prices_for_dates', () => HttpResponse.json({ success: true })));
    const t0 = Date.now();
    await drive(kit.request(nth(1)));
    await drive(
      kit.request(req({ url: 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates', providerId: 'travelpayouts', headers: {} })),
    );
    expect(fetchTimes(events, t0).every((t) => t < 1000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/limiter.test.ts`
Expected: FAIL — without a limiter both concurrent requests fetch at t≈0 ("expected 0 to be greater than or equal to 10000") and the queue-timeout case resolves instead of rejecting.

- [ ] **Step 3: Implement**

`src/http/limiter.ts`:

```ts
import { AbortedError, ProviderError } from '@gmt/core';
import Bottleneck from 'bottleneck';
import type { HttpProviderId, ProviderHttpLimits } from './types.js';

export interface LimiterRunOptions {
  signal: AbortSignal;
  maxWaitMs: number;
  providerId: HttpProviderId;
  endpointPath: string;
}

/** Gate in front of every attempt (spec §5.3: inside p-retry, before reserve). */
export interface ProviderLimiter {
  run<T>(fn: () => Promise<T>, o: LimiterRunOptions): Promise<T>;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

/**
 * Per-provider limiter: a per-minute bottleneck (reservoir = ratePerMinute, maxConcurrent = concurrency)
 * chained to a per-hour bottleneck (reservoir = ratePerHour), so a job must pass both. Reservoir windows
 * are fixed windows from limiter creation (bottleneck semantics), refreshed every 60 s and 3600 s.
 *
 * Queue deadline: bottleneck's `expiration` bounds a running job, not queue time, so the deadline is a
 * timer here plus an age check when the job is released. Before `fn` (which reserves) runs, the job
 * checks queue age ≤ maxWaitMs and !signal.aborted (spec §5.3). A job whose caller already gave up
 * consumes its slot and returns without reserving or fetching.
 */
export function createLimiter(l: ProviderHttpLimits): ProviderLimiter {
  const perHour = new Bottleneck({ reservoir: l.ratePerHour, reservoirRefreshAmount: l.ratePerHour, reservoirRefreshInterval: HOUR_MS });
  const perMinute = new Bottleneck({
    maxConcurrent: l.concurrency,
    reservoir: l.ratePerMinute,
    reservoirRefreshAmount: l.ratePerMinute,
    reservoirRefreshInterval: MINUTE_MS,
  });
  perMinute.chain(perHour);

  return {
    run<T>(fn: () => Promise<T>, o: LimiterRunOptions): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let state: 'queued' | 'running' | 'gone' = 'queued';
        const enqueuedAt = Date.now();
        const timedOut = (): ProviderError =>
          new ProviderError({
            kind: 'limiter-timeout',
            retryable: false,
            providerId: o.providerId,
            message: `${o.providerId} ${o.endpointPath}: waited more than ${Math.round(o.maxWaitMs / 1000)}s for a rate-limit slot [queue-wait-exceeded]`,
          });
        const giveUp = (e: Error): void => {
          if (state !== 'queued') return;
          state = 'gone';
          clearTimeout(timer);
          o.signal.removeEventListener('abort', onAbort);
          reject(e);
        };
        const onAbort = (): void => giveUp(new AbortedError());
        const timer = setTimeout(() => giveUp(timedOut()), o.maxWaitMs);
        o.signal.addEventListener('abort', onAbort, { once: true });
        if (o.signal.aborted) onAbort();

        perMinute
          .schedule(async () => {
            // why: the caller already received limiter-timeout or AbortedError; spend nothing.
            if (state !== 'queued') return;
            if (o.signal.aborted) {
              giveUp(new AbortedError());
              return;
            }
            if (Date.now() - enqueuedAt > o.maxWaitMs) {
              giveUp(timedOut());
              return;
            }
            state = 'running';
            clearTimeout(timer);
            o.signal.removeEventListener('abort', onAbort);
            try {
              resolve(await fn());
            } catch (e) {
              reject(e);
            }
          })
          .catch((e: unknown) => giveUp(e instanceof Error ? e : new Error(String(e))));
      });
    },
  };
}
```

`src/http/httpKit.ts`: add the import, a limiter map at the top of `createHttpKit`, and route each attempt through it.

```ts
import { createLimiter, type ProviderLimiter } from './limiter.js';
import type { HttpProviderId, ProviderHttpLimits } from './types.js';
```

Replace

```ts
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  let inFlight = 0;
```

with

```ts
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  let inFlight = 0;
  const limiters = new Map<HttpProviderId, ProviderLimiter>();
  const limiterFor = (id: HttpProviderId, limits: ProviderHttpLimits): ProviderLimiter => {
    let l = limiters.get(id);
    if (l === undefined) {
      l = createLimiter(limits);
      limiters.set(id, l);
    }
    return l;
  };
```

Replace

```ts
      const result = await pRetry((attempt) => runAttempt(deps, r, limits, attempt), {
```

with

```ts
      const limiter = limiterFor(r.providerId, limits);
      const run = { signal: r.signal, maxWaitMs: limits.maxWaitSeconds * 1000, providerId: r.providerId, endpointPath: r.endpointPath };
      const result = await pRetry((attempt) => limiter.run(() => runAttempt(deps, r, limits, attempt), run), {
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/limiter.test.ts test/http/errors.test.ts test/http/pipeline.test.ts test/http/egress.test.ts test/http/inProcess.test.ts`
Expected: PASS, 42 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: per-provider chained reservoirs, concurrency and queue deadline (spec §5.3)"
```

### Task 4.6: Cache path and in-flight dedup (final `httpKit.ts`)

**Files:**
- Replace: `src/http/httpKit.ts`
- Test: `test/http/cache.test.ts`

**Interfaces:**
- Consumes: `ResponseCache`, `BudgetGuard.recordCacheHit`, `BudgetExceeded` (WP0); `canonicalCacheKey` (Task 4.2).
- Produces: the full spec §5.3 pipeline; `HttpKitResponse.cacheKey`; `stats().inFlight` = in-flight deduplicated requests.

- [ ] **Step 1: Write the failing test**

`test/http/cache.test.ts`:

```ts
import { BudgetExceeded } from '@gmt/core';
import { http, HttpResponse } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH, SENTINELS } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const URL1 = `${SEARCH}?engine=google_flights_calendar&departure_id=LHR&arrival_id=JFK`;

describe('cache path (spec §5.3 pipeline)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('a hit makes zero upstream calls, records a non-billable cache hit and returns the original storedAt', async () => {
    const { kit, budget, cache, clock } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ calendar: [1] })));
    const first = await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    clock.advance(30 * 60_000);
    const second = await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 }, executionId: 'exec-2' })));

    expect(budget.count('fetch')).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.fetchedAt).toBe('2026-10-14T15:00:00.000Z');
    expect(second.body).toEqual({ calendar: [1] });
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(budget.events.filter((e) => e.type === 'cache-hit')).toEqual([
      expect.objectContaining({ providerId: 'searchapi', executionId: 'exec-2', tileIndex: 0, endpointPath: '/api/v1/search' }),
    ]);
    expect(cache.sets).toHaveLength(1);
  });

  it('a miss stores the scrubbed body with the request TTL and storedAt = now', async () => {
    const { kit, cache } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ echo: `key ${SENTINELS.searchapi.reveal()}` })));
    const res = await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    expect(cache.sets).toEqual([{ key: res.cacheKey, body: { echo: 'key [redacted]' }, ttlSeconds: 600, storedAt: '2026-10-14T15:00:00.000Z' }]);
    expect(res.body).toEqual({ echo: 'key [redacted]' });
  });

  it("cache 'never' (token-bearing responses) is never stored or read", async () => {
    const { kit, cache, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ booking_token: 'opaque' })));
    await drive(kit.request(req({ url: URL1, cache: 'never' })));
    await drive(kit.request(req({ url: URL1, cache: 'never' })));
    expect(cache.sets).toHaveLength(0);
    expect(budget.count('fetch')).toBe(2);
    expect(budget.count('cache-hit')).toBe(0);
  });

  it('error responses are never cached', async () => {
    const { kit, cache } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ error: 'gone' }, { status: 404 })));
    await driveError(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    expect(cache.sets).toHaveLength(0);
  });

  it('two concurrent identical requests make one upstream call and share the response', async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get(SEARCH, async () => {
        await new Promise((r) => setTimeout(r, 2000));
        return HttpResponse.json({ once: true });
      }),
    );
    const a = kit.request(req({ url: URL1 }));
    const b = kit.request(req({ url: URL1 }));
    expect(kit.stats().inFlight).toBe(1);
    const [ra, rb] = await drive(Promise.all([a, b]));
    expect(budget.count('fetch')).toBe(1);
    expect(budget.reserveCalls).toBe(1);
    expect(ra.body).toEqual({ once: true });
    expect(rb).toBe(ra);
    expect(kit.stats().inFlight).toBe(0);
  });

  it('BudgetExceeded from reserve is thrown before any msw hit and never retried', async () => {
    const { kit, budget } = makeKit();
    budget.refuse = new BudgetExceeded({ scope: 'provider-month', cap: 10_000, current: 10_000, requested: 1, providerId: 'searchapi' });
    server.use(http.get(SEARCH, () => HttpResponse.json({})));
    const err = await driveError(kit.request(req({ url: URL1 })));
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(budget.count('fetch')).toBe(0);
    expect(budget.reserveCalls).toBe(1);
  });

  it("'fx' requests are never ledgered: no reserve, no cache-hit row", async () => {
    const { kit, budget } = makeKit();
    server.use(http.get('https://api.frankfurter.dev/v1/latest', () => HttpResponse.json({ rates: { USD: 1.3 } })));
    const r = req({ url: 'https://api.frankfurter.dev/v1/latest?from=GBP', providerId: 'fx', headers: {}, cache: { ttlSeconds: 3600 } });
    await drive(kit.request(r));
    await drive(kit.request(r));
    expect(budget.reserveCalls).toBe(0);
    expect(budget.count('cache-hit')).toBe(0);
    expect(budget.count('fetch')).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/cache.test.ts`
Expected: FAIL — the second request reaches msw ("expected 2 to be 1"), `cache.sets` is empty, `stats().inFlight` counts 2.

- [ ] **Step 3: Implement**

`src/http/httpKit.ts` (replace; final):

```ts
import { AbortedError, ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { type AttemptResult, runAttempt } from './attempt.js';
import { canonicalCacheKey } from './cacheKey.js';
import { assertEgress, assertInProcessHosts } from './egress.js';
import { createLimiter, type ProviderLimiter } from './limiter.js';
import { sleep } from './sleep.js';
import type { HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse, HttpProviderId, ProviderHttpLimits } from './types.js';

export type {
  FixtureRecorder,
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
} from './types.js';

/** Spec §5.3: p-retry, max 3 attempts. */
export const MAX_ATTEMPTS = 3;
/** Exponential backoff base: 1 s before attempt 2, 2 s before attempt 3 (deterministic, no jitter). */
export const BACKOFF_BASE_MS = 1000;

/** Only a ProviderError marked retryable is retried; auth, quota, parse and BudgetExceeded never are. */
export function isRetryable(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.retryable;
}

/**
 * Spec §5.3 http-kit over globalThis.fetch (tests use msw on global fetch; the only other transport is the
 * gated `inProcessHosts` seam for fixture.local, spec §4 rev 10). 'fx' is never ledgered (spec §5.6 rev 10):
 *
 *   egress check → cache lookup ─hit─▶ recordCacheHit → { body, fetchedAt: storedAt }
 *     │miss
 *   in-flight dedup → p-retry (3 attempts, Retry-After ≤ maxWaitSeconds) {
 *       limiter (queue age, abort) → budget.reserve → fetch → reservation.finalise
 *   } → cache.set when cacheable → { body, fetchedAt: now }
 *
 * Throws ProviderError (classified), BudgetExceeded (from reserve, before any fetch), AbortedError.
 */
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  assertInProcessHosts(deps.inProcessHosts);
  const limiters = new Map<HttpProviderId, ProviderLimiter>();
  const inFlight = new Map<string, Promise<HttpKitResponse>>();

  const limiterFor = (id: HttpProviderId, limits: ProviderHttpLimits): ProviderLimiter => {
    let l = limiters.get(id);
    if (l === undefined) {
      l = createLimiter(limits);
      limiters.set(id, l);
    }
    return l;
  };

  async function upstream(r: HttpKitRequest, limits: ProviderHttpLimits, key: string): Promise<HttpKitResponse> {
    const limiter = limiterFor(r.providerId, limits);
    const run = { signal: r.signal, maxWaitMs: limits.maxWaitSeconds * 1000, providerId: r.providerId, endpointPath: r.endpointPath };
    let result: AttemptResult;
    try {
      result = await pRetry((attempt) => limiter.run(() => runAttempt(deps, r, limits, attempt), run), {
        retries: MAX_ATTEMPTS - 1,
        minTimeout: BACKOFF_BASE_MS,
        factor: 2,
        randomize: false,
        signal: r.signal,
        shouldRetry: ({ error }) => isRetryable(error),
        // why: p-retry calls onFailedAttempt even when shouldRetry will refuse, so the Retry-After wait
        // checks retryability and remaining attempts itself; the sleep is abortable.
        onFailedAttempt: async ({ error, retriesLeft }) => {
          if (retriesLeft > 0 && isRetryable(error) && error.retryAfterSeconds !== undefined) {
            await sleep(error.retryAfterSeconds * 1000, r.signal);
          }
        },
      });
    } catch (err) {
      // why: p-retry rethrows the signal's reason on abort; the engine contract is AbortedError (spec §5.2).
      if (r.signal.aborted && !(err instanceof AbortedError)) throw new AbortedError();
      throw err;
    }
    // why: only successful, cacheable responses are stored; the body is already scrubbed (attempt.ts).
    if (r.cache !== 'never') deps.cache.set(key, result.body, r.cache.ttlSeconds, result.fetchedAt);
    return { status: result.status, body: result.body, fetchedAt: result.fetchedAt, fromCache: false, cacheKey: key };
  }

  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    if (r.signal.aborted) throw new AbortedError();
    const limits = deps.limits[r.providerId];
    assertEgress(r, limits, deps.secrets);
    const key = canonicalCacheKey(r, deps.secrets);

    if (r.cache !== 'never') {
      const hit = deps.cache.get(key);
      if (hit !== undefined) {
        // why: spec §5.3 — cache hits are ledgered as non-billable rows so parity counts them; 'fx' is not ledgered.
        if (r.providerId !== 'fx') deps.budget.recordCacheHit({ providerId: r.providerId, executionId: r.executionId, tileIndex: r.tileIndex, endpointPath: r.endpointPath });
        return { status: 200, body: hit.body, fetchedAt: hit.storedAt, fromCache: true, cacheKey: key };
      }
    }

    // why: identical concurrent requests share one upstream call; the ledger row belongs to the first
    // caller's execution and the first caller's signal governs the shared call.
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const p = upstream(r, limits, key).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  return { request, stats: () => ({ inFlight: inFlight.size }) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http`
Expected: PASS, every file under `test/http` (63 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: cache path with recordCacheHit and original fetchedAt, in-flight dedup (spec §5.3)"
```

### Task 4.7: Recorder — the pinned `RecordedFixture` format, fails closed, token placeholders, content hash

**Files:**
- Create: `src/http/recorder.ts`, `fixtures/recorded/.gitkeep`
- Modify: `src/http/attempt.ts`, the repository `.gitignore`
- Test: `test/http/recorder.test.ts`

**Interfaces:**
- Consumes: `Clock`, `Secret` (WP0); `containsSecret`, `scrubSecrets`, `stripUrl`, `CREDENTIAL_HEADERS` (Task 4.2).
- Produces: `createRecorder`, `RecorderRefusedError`, `RecordedFixture`, `contentHash`, `canonicalJson`, `withContentHash`, `verifyContentHash`, `loadRecordedJson`, `loadRecordedFixture`; http-kit calls `deps.recorder.record` for every attempt that received an HTTP response when `r.recordFixtures` is true.

Recorded file layout (plan contracts v2): `<root>/<providerId>/<endpointPath with every / replaced by _>/<yyyy-mm-dd>-<first 12 hex of contentSha256>.json`, where `<root>` must end in `fixtures/recorded` (`/api/v1/search` → `_api_v1_search`). Beside it, `<same name>.raw.json` holds the unmodified vendor body for local debugging; it is gitignored and subject to the same fail-closed credential check. File body (`RecordedFixture`):

```json
{
  "recordedAt": "2026-10-14T15:00:00.000Z",
  "recordedBy": "<who ran record:fixtures, set by WP4b>",
  "providerId": "searchapi",
  "endpointPath": "/api/v1/search",
  "request": {
    "method": "GET",
    "url": "https://www.searchapi.io/api/v1/search?engine=google_flights&departure_token=%3Cdeparture_token%3A1%3E",
    "headers": { "accept": "application/json" },
    "body": null
  },
  "status": 200,
  "body": { "…": "response, tokens replaced by <name:n>, search_metadata URLs stripped" },
  "placeholders": { "<booking_token:0>": "booking_token", "<departure_token:1>": "departure_token" },
  "contentSha256": "<contentHash(file without contentSha256)>"
}
```

Opaque vendor tokens are any string value under a key matching `/^[a-z0-9]+(?:_[a-z0-9]+)*_token$/` (`departure_token`, `booking_token`, `next_page_token`), in the response body, the request's query or its JSON body; each distinct raw value becomes `<key:n>` in order of first appearance, and the recorder instance keeps the table, so a token returned in one response and sent in the next request carries the same placeholder in both files. `placeholders` lists the placeholders used in that file with their token key. Replay (Task 4.11) matches requests on the recorded URL, placeholders included, so a replayed chain sends back exactly the placeholder it was served.

- [ ] **Step 1: Write the failing test**

`test/http/recorder.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { http, HttpResponse } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contentHash,
  createRecorder,
  loadRecordedFixture,
  loadRecordedJson,
  type RecordedFixture,
  RecorderRefusedError,
  verifyContentHash,
  withContentHash,
} from '../../src/http/recorder.js';
import { ALL_SECRETS, makeKit, req, SEARCH, SENTINELS } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const clock = fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z'));
function tree(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'gmt-rec-')), 'fixtures', 'recorded');
  mkdirSync(root, { recursive: true });
  return root;
}
function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (!e.name.endsWith('.raw.json')) out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out.sort();
}
const read = (f: string): RecordedFixture => JSON.parse(readFileSync(f, 'utf8'));
const recorder = (root: string) => createRecorder({ root, secrets: ALL_SECRETS, clock, recordedBy: 'wp04-test' });
const call = (url: string, body: unknown, status = 200) => ({
  providerId: 'searchapi' as const,
  endpointPath: '/api/v1/search',
  request: req({ url, headers: { accept: 'application/json', authorization: `Bearer ${SENTINELS.searchapi.reveal()}` } }),
  status,
  body,
});

describe('createRecorder (spec §5.3 "Recorder", §5.5; plan RecordedFixture)', () => {
  it('writes <root>/<provider>/<endpointPath with / → _>/<date>-<sha12>.json plus a .raw.json, and returns the path', async () => {
    const root = tree();
    const path = await recorder(root).record(call(`${SEARCH}?engine=google_flights&departure_id=LHR`, { price: 41200 }));
    expect(path).toMatch(/searchapi\/_api_v1_search\/2026-10-14-[0-9a-f]{12}\.json$/);
    expect(files(root)).toEqual([path]);
    expect(existsSync(path.replace(/\.json$/, '.raw.json'))).toBe(true);
    const json = read(path);
    expect(json).toEqual({
      recordedAt: '2026-10-14T15:00:00.000Z',
      recordedBy: 'wp04-test',
      providerId: 'searchapi',
      endpointPath: '/api/v1/search',
      request: { method: 'GET', url: `${SEARCH}?engine=google_flights&departure_id=LHR`, headers: { accept: 'application/json' }, body: null },
      status: 200,
      body: { price: 41200 },
      placeholders: {},
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const { contentSha256, ...rest } = json;
    expect(contentHash(rest)).toBe(contentSha256);
    expect(path).toContain(`-${contentSha256.slice(0, 12)}.json`);
    expect(readFileSync(path, 'utf8')).not.toMatch(/authorization|x-access-token/i);
  });

  it('fails closed on a secret substring: throws and writes nothing (neither file)', async () => {
    const root = tree();
    const err = await recorder(root)
      .record(call(SEARCH, { echo: `Invalid key ${SENTINELS.searchapi.reveal()}` }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecorderRefusedError);
    expect(readdirSync(root)).toEqual([]);
  });

  it('fails closed on a URL-encoded secret too', async () => {
    const err = await recorder(tree())
      .record(call(SEARCH, { next: `https://x.example/?k=${encodeURIComponent(SENTINELS.smtp.reveal())}` }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecorderRefusedError);
  });

  it('strips search_metadata URLs to origin + path (and the raw body that carried the key is refused, not written)', async () => {
    const root = tree();
    const path = await recorder(root).record(call(SEARCH, { search_metadata: { request_url: `${SEARCH}?engine=google_flights&id=s1`, id: 's1' } }));
    expect((read(path).body as { search_metadata: unknown }).search_metadata).toEqual({ request_url: SEARCH, id: 's1' });
    const err = await recorder(tree())
      .record(call(SEARCH, { search_metadata: { request_url: `${SEARCH}?api_key=${SENTINELS.searchapi.reveal()}` } }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecorderRefusedError);
  });

  it('replaces opaque tokens with deterministic placeholders, consistent from a response to the next request', async () => {
    const root = tree();
    const rec = recorder(root);
    const p1 = await rec.record(call(`${SEARCH}?engine=google_flights`, { best_flights: [{ departure_token: 'RAW-A' }, { departure_token: 'RAW-B' }] }));
    const p2 = await rec.record(call(`${SEARCH}?engine=google_flights&departure_token=RAW-B`, { booking_options: [{ booking_token: 'RAW-C' }] }));
    const [one, two] = [read(p1), read(p2)];
    expect(JSON.stringify([one, two])).not.toMatch(/RAW-[ABC]/);
    expect(one.body).toEqual({ best_flights: [{ departure_token: '<departure_token:0>' }, { departure_token: '<departure_token:1>' }] });
    expect(one.placeholders).toEqual({ '<departure_token:0>': 'departure_token', '<departure_token:1>': 'departure_token' });
    expect(new URL(two.request.url).searchParams.get('departure_token')).toBe('<departure_token:1>');
    expect(two.body).toEqual({ booking_options: [{ booking_token: '<booking_token:0>' }] });
    expect(two.placeholders).toEqual({ '<booking_token:0>': 'booking_token', '<departure_token:1>': 'departure_token' });
  });

  it('is deterministic: a fresh recorder over the same calls writes the same files', async () => {
    const run = async () => {
      const root = tree();
      await recorder(root).record(call(SEARCH, { best_flights: [{ departure_token: 'RAW-A' }] }));
      return files(root).map((f) => readFileSync(f, 'utf8'));
    };
    expect(await run()).toEqual(await run());
  });

  it('refuses a root outside fixtures/recorded, an empty recordedBy, and the synthetic fixture provider', async () => {
    expect(() => createRecorder({ root: mkdtempSync(join(tmpdir(), 'gmt-x-')), secrets: ALL_SECRETS, clock, recordedBy: 'x' })).toThrow(RecorderRefusedError);
    expect(() => createRecorder({ root: tree(), secrets: ALL_SECRETS, clock, recordedBy: ' ' })).toThrow(RecorderRefusedError);
    const err = await recorder(tree())
      .record({ ...call(SEARCH, {}), providerId: 'fixture' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecorderRefusedError);
  });
});

describe('recorded-tree loaders (spec §9 item 2 fixture-tree rules)', () => {
  it('round-trips a recording and refuses it once hand-edited', async () => {
    const path = await recorder(tree()).record(call(SEARCH, { price: 41200 }));
    expect(loadRecordedFixture(path).body).toEqual({ price: 41200 });
    const edited = read(path);
    (edited.body as { price: number }).price = 1;
    writeFileSync(path, JSON.stringify(edited));
    expect(() => loadRecordedFixture(path)).toThrow(/content hash mismatch/);
  });

  it('refuses a file outside fixtures/recorded and a synthetic file inside it', () => {
    const outside = join(mkdtempSync(join(tmpdir(), 'gmt-o-')), 'x.json');
    writeFileSync(outside, JSON.stringify(withContentHash({ recordedAt: '2026-10-14T15:00:00.000Z', recordedBy: 'x' })));
    expect(() => loadRecordedJson(outside)).toThrow(/fixtures\/recorded/);
    const syn = join(tree(), 'syn.json');
    writeFileSync(syn, JSON.stringify(withContentHash({ synthetic: true, recordedAt: '2026-10-14T15:00:00.000Z' })));
    expect(() => loadRecordedJson(syn)).toThrow(/synthetic/);
  });

  it('accepts a hashed ParamsAllowlist file (recordedAt is a date, no recordedBy), and verifyContentHash rejects an unhashed one', () => {
    const p = join(tree(), 'params-2026-10-14.json');
    const allowlist = withContentHash({ provider: 'searchapi', recordedAt: '2026-10-14', endpoints: { '/api/v1/search': { names: ['gl'], values: { gl: ['gb'] } } } });
    writeFileSync(p, JSON.stringify(allowlist));
    expect(loadRecordedJson(p)).toMatchObject({ provider: 'searchapi' });
    expect(verifyContentHash({ provider: 'searchapi' })).toBe(false);
    expect(() => loadRecordedFixture(p)).toThrow(/not a recorded HTTP attempt/);
  });
});

describe('http-kit recording hook', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('records every attempt that got a response, error bodies included, only when recordFixtures is true', async () => {
    const root = tree();
    const { kit } = makeKit({ recorder: recorder(root) });
    let n = 0;
    server.use(http.get(SEARCH, () => (++n === 1 ? HttpResponse.json({ error: 'slow down' }, { status: 429 }) : HttpResponse.json({ ok: n }))));
    await drive(kit.request(req({ url: `${SEARCH}?engine=a`, recordFixtures: true })));
    await drive(kit.request(req({ url: `${SEARCH}?engine=b`, recordFixtures: false })));
    expect(files(root).map((f) => read(f).status).sort()).toEqual([200, 429]);
  });

  it('a recorder refusal fails the request loudly', async () => {
    const { kit } = makeKit({ recorder: recorder(tree()) });
    server.use(http.get(SEARCH, () => HttpResponse.json({ echo: SENTINELS.searchapi.reveal() })));
    expect(await driveError(kit.request(req({ url: SEARCH, recordFixtures: true })))).toBeInstanceOf(RecorderRefusedError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/recorder.test.ts`
Expected: FAIL — `Failed to load url ../../src/http/recorder.js`.

- [ ] **Step 3: Implement**

`src/http/recorder.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Clock, IsoDateTime, Secret } from '@gmt/core';
import { isRecord, parseMaybeJson } from '../util.js';
import { CREDENTIAL_HEADERS } from './cacheKey.js';
import { containsSecret, scrubSecrets, stripUrl } from './scrub.js';
import type { FixtureRecorder } from './types.js';

/** The recorder refused to write (credential present, wrong tree, synthetic provider). Spec §5.3: fails closed. */
export class RecorderRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecorderRefusedError';
  }
}

/** One recorded HTTP attempt; the format pinned in the plan's http-kit contract. */
export interface RecordedFixture {
  recordedAt: IsoDateTime;
  recordedBy: string;
  providerId: string;
  endpointPath: string;
  request: { method: string; url: string; headers: Record<string, string>; body: string | null };
  status: number;
  body: unknown;
  placeholders: Record<string, string>;
  contentSha256: string;
}

const TOKEN_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*_token$/;
const RECORDED_DIR = `${sep}fixtures${sep}recorded`;
const SAFE_PATH = /^\/[A-Za-z0-9._\/-]*$/;

/** JSON with object keys sorted at every level and undefined members dropped: the hash input. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isRecord(v)) {
    const entries = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function hashOf(file: Record<string, unknown>): string {
  const { contentSha256: _excluded, ...rest } = file;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** sha256 hex over canonicalJson of a recording without its hash field (plan contract). */
export function contentHash(f: Omit<RecordedFixture, 'contentSha256'>): string {
  return hashOf(f as unknown as Record<string, unknown>);
}

/** Adds `contentSha256` over everything else; WP5/WP6 write their ParamsAllowlist files with it. */
export function withContentHash<T extends Record<string, unknown>>(file: T): T & { contentSha256: string } {
  return { ...file, contentSha256: hashOf(file) };
}

/** Recomputes the content hash of any recorded-tree JSON; false for anything edited after recording. */
export function verifyContentHash(file: unknown): boolean {
  return isRecord(file) && typeof file.contentSha256 === 'string' && hashOf(file) === file.contentSha256;
}

/** Placeholder table for opaque vendor tokens, shared across one recorder's lifetime. */
function tokenTable() {
  const byRaw = new Map<string, { placeholder: string; key: string }>();
  const counters = new Map<string, number>();
  const register = (key: string, raw: string): void => {
    if (raw === '' || byRaw.has(raw)) return;
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    byRaw.set(raw, { placeholder: `<${key}:${n}>`, key });
  };
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (TOKEN_KEY.test(k) && typeof x === 'string') register(k, x);
        collect(x);
      }
    }
  };
  /** Replaces every known raw token in a string, noting each placeholder used in `used`. */
  const text = (s: string, used: Map<string, string>): string => {
    // why: longest raw value first so a token that contains another is replaced whole.
    const raws = [...byRaw.keys()].sort((a, b) => b.length - a.length);
    return raws.reduce((acc, raw) => {
      if (!acc.includes(raw)) return acc;
      const t = byRaw.get(raw);
      if (t === undefined) return acc;
      used.set(t.placeholder, t.key);
      return acc.split(raw).join(t.placeholder);
    }, s);
  };
  const deep = (v: unknown, used: Map<string, string>): unknown => {
    if (typeof v === 'string') return text(v, used);
    if (Array.isArray(v)) return v.map((x) => deep(x, used));
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, used)]));
    return v;
  };
  return { register, collect, text, deep };
}

/** Strips query and userinfo from every URL string under a `search_metadata` key (spec §5.3). */
function stripMetadataUrls(v: unknown, inside: boolean): unknown {
  if (typeof v === 'string') return inside && /^https?:\/\//i.test(v) ? stripUrl(v) : v;
  if (Array.isArray(v)) return v.map((x) => stripMetadataUrls(x, inside));
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripMetadataUrls(x, inside || k === 'search_metadata')]));
  return v;
}

/** Writes `text` unless the file exists (same content on the same day hashes to the same name). */
function writeOnce(path: string, text: string): void {
  try {
    writeFileSync(path, text, { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
}

/**
 * Fixture recorder, spec §5.3 "Recorder": writes `RecordedFixture` files under `<root>` (which must end
 * in fixtures/recorded) at `<providerId>/<endpointPath with / → _>/<date>-<sha12>.json`, with the raw
 * vendor body beside it as `.raw.json` (gitignored). Tokens become deterministic placeholders,
 * search_metadata URLs are stripped, credential headers are dropped, and it **fails closed**:
 * if any configured secret (raw or URL-encoded) would be written to either file, it throws
 * RecorderRefusedError and writes nothing.
 */
export function createRecorder(opts: { root: string; secrets: readonly Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder {
  const root = resolve(opts.root);
  if (!root.endsWith(RECORDED_DIR)) throw new RecorderRefusedError(`recorder root must end in fixtures/recorded (spec §5.5), got ${root}`);
  if (opts.recordedBy.trim() === '') throw new RecorderRefusedError('recordedBy must name who ran the recording');
  const tokens = tokenTable();

  return {
    async record(r) {
      if (r.providerId === 'fixture') throw new RecorderRefusedError('the fixture provider is synthetic and is never recorded (spec §5.5)');
      if (!SAFE_PATH.test(r.endpointPath)) throw new RecorderRefusedError(`refusing to record an unsafe endpointPath for ${r.providerId}`);
      const params = [...r.request.url.searchParams.entries()];
      for (const [k, v] of params) if (TOKEN_KEY.test(k)) tokens.register(k, v);
      if (r.request.body !== undefined) tokens.collect(parseMaybeJson(r.request.body));
      tokens.collect(r.body);

      const used = new Map<string, string>();
      const url = new URL(r.request.url.href);
      url.username = '';
      url.password = '';
      url.hash = '';
      const query = new URLSearchParams();
      for (const [k, v] of params) query.append(k, tokens.text(v, used));
      url.search = query.toString();
      // why: credential headers are dropped entirely, not value-scrubbed, so the CI secret scan's header-name rule
      // (e.g. /X-Access-Token/i) passes over every recorded file (plan decision 14).
      const headers = scrubSecrets(
        Object.fromEntries(
          Object.entries(r.request.headers)
            .map(([k, v]): [string, string] => [k.toLowerCase(), v])
            .filter(([k]) => !CREDENTIAL_HEADERS.has(k)),
        ),
        opts.secrets,
      );
      const unhashed: Omit<RecordedFixture, 'contentSha256'> = {
        recordedAt: opts.clock.now(),
        recordedBy: opts.recordedBy,
        providerId: r.providerId,
        endpointPath: r.endpointPath,
        request: { method: r.request.method, url: url.href, headers, body: r.request.body === undefined ? null : tokens.text(r.request.body, used) },
        status: r.status,
        body: tokens.deep(stripMetadataUrls(r.body, false), used),
        placeholders: {},
      };
      unhashed.placeholders = Object.fromEntries([...used].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      const file: RecordedFixture = { ...unhashed, contentSha256: contentHash(unhashed) };
      const text = `${JSON.stringify(file, null, 2)}\n`;
      const raw = `${JSON.stringify(r.body, null, 2) ?? 'null'}\n`;
      if (containsSecret(text, opts.secrets) || containsSecret(raw, opts.secrets)) {
        throw new RecorderRefusedError(`refusing to record ${r.providerId} ${r.endpointPath}: a credential would be written (spec §5.3)`);
      }
      const dir = join(root, r.providerId, r.endpointPath.replaceAll('/', '_'));
      mkdirSync(dir, { recursive: true });
      // why: a symlinked provider directory must not redirect the write outside the recorded tree.
      if (!realpathSync(dir).startsWith(`${realpathSync(root)}${sep}`)) throw new RecorderRefusedError(`refusing to write outside ${root}`);
      const target = join(dir, `${file.recordedAt.slice(0, 10)}-${file.contentSha256.slice(0, 12)}.json`);
      writeOnce(target, text);
      writeOnce(target.replace(/\.json$/, '.raw.json'), raw);
      return target;
    },
  };
}

/** Loads any hashed file of the recorded tree (recording or ParamsAllowlist) after the §5.5 checks. */
export function loadRecordedJson(path: string): Record<string, unknown> {
  const real = realpathSync(path);
  if (!real.includes(`${RECORDED_DIR}${sep}`)) throw new Error(`refusing ${path}: recorded files load only from fixtures/recorded/ (spec §5.5)`);
  const json: unknown = JSON.parse(readFileSync(real, 'utf8'));
  if (!isRecord(json)) throw new Error(`refusing ${path}: not a JSON object`);
  if ('synthetic' in json) throw new Error(`refusing ${path}: a synthetic file inside the recorded tree`);
  if (typeof json.recordedAt !== 'string') throw new Error(`refusing ${path}: recordedAt is required`);
  if (!verifyContentHash(json)) throw new Error(`refusing ${path}: content hash mismatch (edited after recording?)`);
  return json;
}

/** Loads one recorded HTTP attempt (WP5/WP6 replay tests, WP13 layer B). */
export function loadRecordedFixture(path: string): RecordedFixture {
  const json = loadRecordedJson(path);
  const req = json.request;
  if (
    typeof json.recordedBy !== 'string' ||
    typeof json.providerId !== 'string' ||
    typeof json.endpointPath !== 'string' ||
    typeof json.status !== 'number' ||
    !isRecord(json.placeholders) ||
    !isRecord(req) ||
    typeof req.url !== 'string' ||
    typeof req.method !== 'string'
  ) {
    throw new Error(`refusing ${path}: not a recorded HTTP attempt`);
  }
  return json as unknown as RecordedFixture;
}
```

`fixtures/recorded/.gitkeep`: empty file (WP4b fills the tree).

Repository `.gitignore`: append

```gitignore
# raw vendor bodies written beside recorded fixtures (plan contracts v2); never committed
packages/providers/fixtures/recorded/**/*.raw.json
```

`src/http/attempt.ts`: record after the body is parsed and before classification, so error bodies (429, 400, quota) are recorded too. Replace

```ts
  if (!ok) {
    const atCap = status === 429 && ledgerAtCap(deps, r.providerId);
```

with

```ts
  if (r.recordFixtures && deps.recorder !== undefined) {
    // why: before classification, so 429/quota/400 bodies are captured (spec §9 item 7); a refusal fails the request.
    await deps.recorder.record({ providerId: r.providerId, endpointPath: r.endpointPath, request: r, status, body });
  }

  if (!ok) {
    const atCap = status === 429 && ledgerAtCap(deps, r.providerId);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http`
Expected: PASS, 75 tests.

- [ ] **Step 5: Commit**

```bash
git add .gitignore packages/providers && git commit -m "wp04: recorder writing the pinned RecordedFixture format, failing closed, with placeholders and content hash (spec §5.3, §5.5)"
```

### Task 4.8: Sentinel-key test over every sink this package reaches; attempt logging

**Files:**
- Modify: `src/http/attempt.ts`, `src/http/httpKit.ts`
- Test: `test/http/sentinel.test.ts`

**Interfaces:**
- Produces: http-kit log lines — `debug 'http attempt'` `{ providerId, endpointPath, attempt, httpStatus, durationMs }`, `warn 'http attempt failed'` `{ providerId, endpointPath, attempt, failure: 'aborted' | 'timeout' | 'network' }`, `debug 'http cache hit'` `{ providerId, endpointPath }`, `warn 'http request failed'` `{ providerId, endpointPath, error }` (the error's message, which never holds a URL or a secret). No line carries a URL, a header or a body.

The test exercises every path that can carry a credential (success with the key echoed, a `search_metadata` URL carrying it, 401 and 400 bodies quoting it, socket error, timeout, abort, a credential in the URL, a recorder refusal, both vendor header styles) and asserts that no sentinel appears in any sink this package writes: ledger `endpointPath` (reserve and cache-hit), cache keys and bodies, returned bodies, error messages and fields, recorder output (both the `.json` and the `.raw.json`), log lines. The positive controls (every sentinel reached msw in a request header; at least one log line per attempt) keep the guard from passing vacuously: the log control fails until the logging below exists.

- [ ] **Step 1: Write the failing test**

`test/http/sentinel.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { http, HttpResponse } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecorder } from '../../src/http/recorder.js';
import { ALL_SECRETS, makeKit, req, SEARCH, SENTINELS, TP } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const leaks = (text: string): string[] => ALL_SECRETS.map((s) => s.reveal()).filter((v) => text.includes(v) || text.includes(encodeURIComponent(v)));
const key = SENTINELS.searchapi.reveal();
const token = SENTINELS.travelpayouts.reveal();

describe('sentinel-key test (spec §5.3 secret scrubbing, §14)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('no secret reaches the ledger, cache, errors, bodies, recorder output or logs on any path', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'gmt-sen-')), 'fixtures', 'recorded');
    mkdirSync(root, { recursive: true });
    const recorder = createRecorder({ root, secrets: ALL_SECRETS, clock: fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z')), recordedBy: 'sentinel' });
    const { kit, budget, cache, log } = makeKit({ recorder, limits: { searchapi: { requestTimeoutSeconds: 5 } } });

    server.use(
      http.get(SEARCH, ({ request }) => {
        const scenario = new URL(request.url).searchParams.get('s');
        if (scenario === 'echo') return HttpResponse.json({ echo: `your key is ${key}`, search_metadata: { request_url: `${SEARCH}?api_key=${key}` } });
        if (scenario === 'meta') return HttpResponse.json({ search_metadata: { request_url: `${SEARCH}?engine=x&id=s1` }, price: 1 });
        if (scenario === '401') return HttpResponse.json({ error: `Invalid API key ${key}` }, { status: 401 });
        if (scenario === '400') return HttpResponse.json({ error: `bad request for ${key}` }, { status: 400 });
        if (scenario === 'socket') return HttpResponse.error();
        return new Promise<Response>(() => undefined); // 'hang'
      }),
      http.get(TP, () => HttpResponse.json({ success: true, data: [], echo: token })),
    );

    const results: unknown[] = [];
    const errors: unknown[] = [];
    const run = async (p: Promise<unknown>) => {
      try {
        results.push(await drive(p));
      } catch (e) {
        errors.push(e);
      }
    };
    await run(kit.request(req({ url: `${SEARCH}?s=echo`, cache: { ttlSeconds: 600 } })));
    await run(kit.request(req({ url: `${SEARCH}?s=echo`, cache: { ttlSeconds: 600 } })));      // cache hit
    await run(kit.request(req({ url: `${SEARCH}?s=meta`, recordFixtures: true })));            // recorded (+ .raw.json)
    await run(kit.request(req({ url: `${SEARCH}?s=echo`, recordFixtures: true })));            // recorder refuses
    await run(kit.request(req({ url: `${SEARCH}?s=401` })));
    await run(kit.request(req({ url: `${SEARCH}?s=400` })));
    await run(kit.request(req({ url: `${SEARCH}?s=socket` })));
    await run(kit.request(req({ url: `${SEARCH}?s=hang` })));                                  // timeout
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    await run(kit.request(req({ url: `${SEARCH}?s=hang&a=1`, signal: ac.signal })));           // abort
    await run(kit.request(req({ url: `${SEARCH}?api_key=${key}` })));                          // egress refusal
    await run(kit.request(req({ url: `${SEARCH}?s=x`, endpointPath: `/api/v1/search?api_key=${key}` })));
    await run(kit.request(req({ url: `${TP}?origin=LON`, providerId: 'travelpayouts', headers: { 'x-access-token': token }, cache: { ttlSeconds: 600 } })));

    // positive controls: the credentials really were sent, and every attempt was logged
    const sent = budget.events.filter((e) => e.type === 'fetch').map((e) => JSON.stringify(e.headers)).join('\n');
    expect(sent).toContain(key);
    expect(sent).toContain(token);
    expect(errors.length).toBeGreaterThanOrEqual(8);
    expect(log.lines.filter((l) => l.includes('"msg":"http attempt')).length).toBeGreaterThanOrEqual(budget.count('reserve'));

    const sinks = {
      ledger: JSON.stringify(budget.events.filter((e) => e.type !== 'fetch')),
      cacheKeys: JSON.stringify([...cache.entries.keys()]),
      cacheBodies: JSON.stringify([...cache.entries.values()]),
      bodies: JSON.stringify(results),
      errors: JSON.stringify(errors.map((e) => (e instanceof Error ? { name: e.name, message: e.message, ...e } : e))),
      recorder: readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => readFileSync(join(d.parentPath, d.name), 'utf8'))
        .join('\n'),
      logs: log.lines.join('\n'),
    };
    expect(sinks.recorder).toContain('"price": 1');
    for (const [name, text] of Object.entries(sinks)) expect({ sink: name, leaks: leaks(text) }).toEqual({ sink: name, leaks: [] });
    expect(sinks.logs).not.toMatch(/https?:\/\/\S*\?/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/sentinel.test.ts`
Expected: FAIL on the positive control — "expected 0 to be greater than or equal to N", N being the number of reserves (no `http attempt` log lines exist yet).

- [ ] **Step 3: Implement**

`src/http/attempt.ts`: log every attempt. Replace

```ts
  } catch (err) {
    if (r.signal.aborted) {
```

with

```ts
  } catch (err) {
    const failure = r.signal.aborted ? 'aborted' : timeout.signal.aborted ? 'timeout' : 'network';
    deps.log.warn({ providerId: r.providerId, endpointPath: r.endpointPath, attempt, failure }, 'http attempt failed');
    if (r.signal.aborted) {
```

and replace

```ts
  const ok = status >= 200 && status < 300;
  finalise(ok ? 'ok' : 'error', status);
```

with

```ts
  const ok = status >= 200 && status < 300;
  finalise(ok ? 'ok' : 'error', status);
  // why: path, never URL; no headers, no body (spec §14).
  deps.log.debug({ providerId: r.providerId, endpointPath: r.endpointPath, attempt, httpStatus: status, durationMs: Date.now() - started }, 'http attempt');
```

`src/http/httpKit.ts`: in `upstream`, replace

```ts
    } catch (err) {
      // why: p-retry rethrows the signal's reason on abort; the engine contract is AbortedError (spec §5.2).
      if (r.signal.aborted && !(err instanceof AbortedError)) throw new AbortedError();
      throw err;
    }
```

with

```ts
    } catch (err) {
      deps.log.warn({ providerId: r.providerId, endpointPath: r.endpointPath, error: err instanceof Error ? err.message : String(err) }, 'http request failed');
      // why: p-retry rethrows the signal's reason on abort; the engine contract is AbortedError (spec §5.2).
      if (r.signal.aborted && !(err instanceof AbortedError)) throw new AbortedError();
      throw err;
    }
```

and in `request`, replace

```ts
        if (r.providerId !== 'fx') deps.budget.recordCacheHit({ providerId: r.providerId, executionId: r.executionId, tileIndex: r.tileIndex, endpointPath: r.endpointPath });
```

with

```ts
        if (r.providerId !== 'fx') deps.budget.recordCacheHit({ providerId: r.providerId, executionId: r.executionId, tileIndex: r.tileIndex, endpointPath: r.endpointPath });
        deps.log.debug({ providerId: r.providerId, endpointPath: r.endpointPath }, 'http cache hit');
```

Egress refusals happen before `upstream` and are not logged by http-kit; the engine logs the error it receives (its message carries `<invalid endpointPath>` rather than a tainted path).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http`
Expected: PASS, 76 tests. If a sink check fails, the assertion names the sink; fix the code that writes it, never the test.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: sentinel-key test over every sink, attempt logging without URLs (spec §5.3, §14)"
```

### Task 4.9: Fixture tree, fixture server, msw handlers and Hono router

**Files:**
- Create: `fixtures/synthetic/fixture/calendar/{LHR-JFK,LHR-EWR,LGW-JFK,LGW-EWR}.json`, `fixtures/synthetic/fixture/itinerary/{LHR-JFK,LHR-EWR,LGW-JFK,LGW-EWR}.json`
- Create: `src/fixture/dates.ts`, `src/fixture/tree.ts`, `src/fixture/server.ts`, `src/fixture/router.ts`, `src/testing/handlers.ts`, `src/testing/index.ts`
- Test: `test/fixture/server.test.ts`

**Interfaces:**
- Consumes: hono 4.13.13 (`Hono`, `app.all`, `c.req.raw`), msw 3.0.3 (`http.all`).
- Produces: `defaultFixtureRoot`, `loadFixtureTree`, `FixtureTree`, `calendarPriceMinor`, `createFixtureServer`, `FixtureServer`, `FixtureResponse`, `FixtureRule`, `scenarioRequest`, `fixtureHandlers` and `RequestHandler` (from `@gmt/providers/testing`), `fixtureRouter`.

- [ ] **Step 1: Write the fixture tree**

`fixtures/synthetic/fixture/calendar/LHR-JFK.json`:

```json
{ "synthetic": true, "currency": "GBP", "baseMinor": 41200, "weekdayStepMinor": 1500, "perNightMinor": 900, "noFaresNights": [], "noDataNights": [] }
```

`fixtures/synthetic/fixture/calendar/LHR-EWR.json`:

```json
{ "synthetic": true, "currency": "GBP", "baseMinor": 39800, "weekdayStepMinor": 1700, "perNightMinor": 850, "noFaresNights": [], "noDataNights": [10] }
```

`fixtures/synthetic/fixture/calendar/LGW-JFK.json`:

```json
{ "synthetic": true, "currency": "GBP", "baseMinor": 43500, "weekdayStepMinor": 1200, "perNightMinor": 950, "noFaresNights": [21], "noDataNights": [] }
```

`fixtures/synthetic/fixture/calendar/LGW-EWR.json`:

```json
{ "synthetic": true, "currency": "GBP", "baseMinor": 40900, "weekdayStepMinor": 1600, "perNightMinor": 800, "noFaresNights": [], "noDataNights": [] }
```

`fixtures/synthetic/fixture/itinerary/LHR-JFK.json` (the other three files are identical except `flightNumber`s `201/202/203/204` for `LHR-EWR`, `301/…` for `LGW-JFK`, `401/…` for `LGW-EWR`, and `priceDeltaMinor` `2500/0`, `4100/600`, `3000/200` respectively):

```json
{
  "synthetic": true,
  "options": [
    {
      "seller": "Synthetic Air",
      "carrier": "ZZ",
      "outbound": { "flightNumber": "101", "depart": "09:30", "arrive": "12:40", "arriveDayOffset": 0 },
      "inbound": { "flightNumber": "102", "depart": "18:30", "arrive": "06:40", "arriveDayOffset": 1 },
      "priceDeltaMinor": 3800,
      "cabinBagIncluded": true,
      "checkedBags": 1
    },
    {
      "seller": "Synthetic Travel",
      "carrier": "ZX",
      "outbound": { "flightNumber": "103", "depart": "13:15", "arrive": "16:20", "arriveDayOffset": 0 },
      "inbound": { "flightNumber": "104", "depart": "21:45", "arrive": "09:55", "arriveDayOffset": 1 },
      "priceDeltaMinor": 0,
      "cabinBagIncluded": false,
      "checkedBags": 0
    }
  ]
}
```

`// why:` `ZZ` and `ZX` are synthetic designators that match `^[A-Z0-9]{2}$` (spec §6.4) so the engine can hash the itineraries; sellers say "Synthetic" so no screenshot of fixture mode resembles a real fare.

- [ ] **Step 2: Write the failing test**

`test/fixture/server.test.ts`:

```ts
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ORIGIN, SCENARIO_HEADER, SCENARIO_PATH } from '../../src/fixture/constants.js';
import { fixtureHandlers } from '../../src/testing/handlers.js';
import { fixtureRouter } from '../../src/fixture/router.js';
import { scenarioRequest } from '../../src/fixture/server.js';
import { calendarPriceMinor, defaultFixtureRoot, loadFixtureTree } from '../../src/fixture/tree.js';
import { server } from '../support/msw.js';

const ROOT = defaultFixtureRoot();
const cal = (q: Record<string, string>) => `${FIXTURE_ORIGIN}/calendar?${new URLSearchParams(q)}`;
const tile = { origin: 'LHR', destination: 'JFK', departFrom: '2026-11-02', departTo: '2026-11-08', returnFrom: '2026-11-12', returnTo: '2026-11-29', cabin: 'economy', currency: 'GBP' };
const itin = (q: Record<string, string> = {}) =>
  `${FIXTURE_ORIGIN}/itinerary?${new URLSearchParams({ origin: 'LHR', destination: 'JFK', departureDate: '2026-11-02', returnDate: '2026-11-16', cabin: 'economy', currency: 'GBP', expandTop: '2', ...q })}`;
const getJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const scenario = (rules: unknown[]) =>
  fetch(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules }) });

describe('fixture tree loader (spec §5.5)', () => {
  it('loads the four worked-example pairs, every file synthetic', () => {
    const t = loadFixtureTree(ROOT);
    expect([...t.calendar.keys()].sort()).toEqual(['LGW-EWR', 'LGW-JFK', 'LHR-EWR', 'LHR-JFK']);
    expect([...t.itinerary.keys()].sort()).toEqual(['LGW-EWR', 'LGW-JFK', 'LHR-EWR', 'LHR-JFK']);
  });
  it('refuses a tree that is not fixtures/synthetic/fixture', () => {
    expect(() => loadFixtureTree(mkdtempSync(join(tmpdir(), 'gmt-t-')))).toThrow(/fixtures\/synthetic\/fixture/);
  });
  it('refuses a file without "synthetic": true', () => {
    const copy = join(mkdtempSync(join(tmpdir(), 'gmt-t-')), 'fixtures', 'synthetic', 'fixture');
    cpSync(ROOT, copy, { recursive: true });
    writeFileSync(join(copy, 'calendar', 'LHR-JFK.json'), JSON.stringify({ currency: 'GBP', baseMinor: 1, weekdayStepMinor: 1, perNightMinor: 1, noFaresNights: [], noDataNights: [] }));
    expect(() => loadFixtureTree(copy)).toThrow(/synthetic/);
  });
});

describe('fixture server via msw (http://fixture.local)', () => {
  beforeEach(() => server.use(...fixtureHandlers(ROOT)));

  it('answers a calendar tile with the formula price for every in-rectangle cell', async () => {
    const { status, body } = await getJson(cal(tile));
    expect(status).toBe(200);
    expect(body).toMatchObject({ synthetic: true, currency: 'GBP', origin: 'LHR', destination: 'JFK', noFares: [] });
    const prices = body.prices as Array<{ departureDate: string; returnDate: string; amountMinor: number }>;
    expect(prices).toHaveLength(126); // 7 departure days × 18 return days, all 4–27 nights
    // 2026-11-02 is epoch day 20759 (mod 7 = 4): 41200 + 4 × 1500 + 14 × 900
    expect(prices.find((p) => p.departureDate === '2026-11-02' && p.returnDate === '2026-11-16')?.amountMinor).toBe(59_800);
    const file = loadFixtureTree(ROOT).calendar.get('LHR-JFK');
    expect(file && calendarPriceMinor(file, '2026-11-02', 14)).toBe(59_800);
  });

  it('applies noFaresNights and noDataNights from the pair file', async () => {
    const lgw = (await getJson(cal({ ...tile, origin: 'LGW' }))).body;
    expect((lgw.noFares as unknown[]).length).toBe(7); // 21 nights, one per departure day
    const ewr = (await getJson(cal({ ...tile, destination: 'EWR' }))).body;
    const tenNights = (ewr.prices as Array<{ departureDate: string; returnDate: string }>).filter((p) => p.departureDate === '2026-11-02' && p.returnDate === '2026-11-12');
    expect(tenNights).toEqual([]);
  });

  it('404s an unknown pair and 400s a missing or malformed parameter', async () => {
    expect((await getJson(cal({ ...tile, destination: 'BBB' }))).status).toBe(404);
    const { departFrom: _d, ...missing } = tile;
    expect((await getJson(cal(missing))).status).toBe(400);
    expect((await getJson(cal({ ...tile, departTo: '2026-13-40' }))).status).toBe(400);
  });

  it('answers an itinerary search with offers built from the templates, priced from the calendar', async () => {
    const { body } = await getJson(itin());
    expect(body).toMatchObject({ synthetic: true, currency: 'GBP', outboundOptions: 2, failedExpansions: 0 });
    const offers = body.offers as Array<Record<string, unknown>>;
    expect(offers.map((o) => o.amountMinor)).toEqual([59_800 + 3800, 59_800]);
    expect(offers[0]).toMatchObject({
      seller: 'Synthetic Air',
      outbound: [{ carrier: 'ZZ', flightNumber: '101', from: 'LHR', to: 'JFK', depart: '2026-11-02T09:30', arrive: '2026-11-02T12:40', cabin: 'economy' }],
      inbound: [{ carrier: 'ZZ', flightNumber: '102', from: 'JFK', to: 'LHR', depart: '2026-11-16T18:30', arrive: '2026-11-17T06:40', cabin: 'economy' }],
      baggage: { cabinBag: 'included', checkedBags: 1 },
      selfTransfer: false,
    });
    expect((await getJson(itin({ expandTop: '1' }))).body.offers).toHaveLength(1);
  });

  it('scenario rules answer matching requests `times` times, then normal responses resume; DELETE clears', async () => {
    await scenario([{ match: { path: '/calendar', params: { departFrom: '2026-11-02' } }, respond: { kind: 'status', status: 503 }, times: 2 }]);
    expect((await getJson(cal(tile))).status).toBe(503);
    expect((await getJson(cal({ ...tile, departFrom: '2026-11-03' }))).status).toBe(200); // params do not match
    expect((await getJson(cal(tile))).status).toBe(503);
    expect((await getJson(cal(tile))).status).toBe(200);
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 401 } }]);
    expect((await getJson(cal(tile))).status).toBe(401);
    await fetch(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, { method: 'DELETE' });
    expect((await getJson(cal(tile))).status).toBe(200);
  });

  it('serves every FixtureResponse kind', async () => {
    const as = (respond: unknown) => ({ headers: { [SCENARIO_HEADER]: JSON.stringify(respond) } });
    const r429 = await fetch(cal(tile), as({ kind: 'status', status: 429, headers: { 'retry-after': '7200' } }));
    expect([r429.status, r429.headers.get('retry-after')]).toEqual([429, '7200']);
    expect(await (await fetch(cal(tile), as({ kind: 'malformed' }))).text()).toBe('{"synthetic": true, "prices": [');
    await expect(fetch(cal(tile), as({ kind: 'network' }))).rejects.toThrow();
    const ac = new AbortController();
    const hung = fetch(cal(tile), { ...as({ kind: 'hang' }), signal: ac.signal });
    ac.abort();
    await expect(hung).rejects.toThrow();
    expect((await getJson(cal(tile), as({ kind: 'empty' }))).body).toMatchObject({ prices: [], noFares: [] });
    expect(((await getJson(cal(tile), as({ kind: 'no-fares' }))).body.noFares as unknown[]).length).toBe(126);
    expect((await getJson(cal(tile), as({ kind: 'no-currency' }))).body.currency).toBeUndefined();
    expect((await getJson(cal(tile), as({ kind: 'variant', currency: 'USD' }))).body.currency).toBe('USD');
    expect((await getJson(itin(), as({ kind: 'empty' }))).body).toMatchObject({ outboundOptions: 0, offers: [] });
    expect((await getJson(itin(), as({ kind: 'no-return-legs' }))).body).toMatchObject({ outboundOptions: 2, offers: [] });
    expect((await getJson(itin(), as({ kind: 'partial', failedExpansions: 1 }))).body).toMatchObject({ outboundOptions: 2, failedExpansions: 1 });
    const v = (await getJson(itin(), as({ kind: 'variant', carrier: 'Z!', connectVia: 'QQQ' }))).body.offers as Array<{ outbound: Array<Record<string, string>> }>;
    expect(v[0]?.outbound.map((s) => [s.carrier, s.from, s.to])).toEqual([['Z!', 'LHR', 'QQQ'], ['Z!', 'QQQ', 'JFK']]);
    expect(v[1]?.outbound.map((s) => s.carrier)).toEqual(['ZX']); // scope defaults to the first offer
  });
});

describe('fixtureRouter (Hono) serves the same tree', () => {
  beforeEach(() => server.use(...fixtureHandlers(ROOT)));

  it('returns byte-identical calendar and itinerary bodies to the msw handlers', async () => {
    const router = fixtureRouter(ROOT);
    for (const url of [cal(tile), itin()]) {
      const viaHono = await (await router.request(url)).text();
      const viaMsw = await (await fetch(url)).text();
      expect(viaHono).toBe(viaMsw);
    }
  });
  it('honours scenario rules on its own state, sent with scenarioRequest', async () => {
    const router = fixtureRouter(ROOT);
    const ack = await router.fetch(scenarioRequest([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 402 } }]));
    expect(await ack.json()).toEqual({ synthetic: true, rules: 1 });
    expect((await router.request(cal(tile))).status).toBe(402);
    expect((await router.request(`${FIXTURE_ORIGIN}/health`)).status).toBe(200);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/server.test.ts`
Expected: FAIL — `Failed to load url ../../src/testing/handlers.js`.

- [ ] **Step 4: Implement**

`src/fixture/dates.ts`:

```ts
import type { IsoDate } from '@gmt/core';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// why: UTC arithmetic on calendar values, never Date-local (spec §6.1). WP1's epoch-day helpers are not a
// dependency of WP4 (it depends on WP0 only), so the fixture code carries these few lines privately.

/** Days since 1970-01-01 for a `YYYY-MM-DD` string. */
export function epochDayOf(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS;
}

export function isoDateOfEpochDay(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10) as IsoDate;
}

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-13-40, 2027-02-29). */
export function isIsoDateString(s: string): boolean {
  return ISO_DATE.test(s) && isoDateOfEpochDay(epochDayOf(s)) === s;
}

export function addDaysIso(d: string, n: number): IsoDate {
  return isoDateOfEpochDay(epochDayOf(d) + n);
}

export function daysBetweenIso(a: string, b: string): number {
  return epochDayOf(b) - epochDayOf(a);
}

/** `YYYY-MM-DDTHH:mm` plus `minutes`, as wall-clock arithmetic (no timezone involved). */
export function localPlusMinutes(local: string, minutes: number): string {
  const ms = Date.UTC(Number(local.slice(0, 4)), Number(local.slice(5, 7)) - 1, Number(local.slice(8, 10)), Number(local.slice(11, 13)), Number(local.slice(14, 16)));
  return new Date(ms + minutes * 60_000).toISOString().slice(0, 16);
}
```

`src/fixture/tree.ts`:

```ts
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../util.js';
import { epochDayOf } from './dates.js';

/** `calendar/<O>-<D>.json`: parameters of the deterministic synthetic price formula. */
export interface CalendarPairFile {
  synthetic: true;
  currency: string;
  baseMinor: number;
  weekdayStepMinor: number;
  perNightMinor: number;
  noFaresNights: number[];
  noDataNights: number[];
}
export interface LegTemplate { flightNumber: string; depart: string; arrive: string; arriveDayOffset: number }
export interface OptionTemplate {
  seller: string;
  carrier: string;
  outbound: LegTemplate;
  inbound: LegTemplate;
  priceDeltaMinor: number;
  cabinBagIncluded: boolean;
  checkedBags: number;
}
/** `itinerary/<O>-<D>.json`: offer templates placed on a cell's dates. */
export interface ItineraryPairFile { synthetic: true; options: OptionTemplate[] }
export interface FixtureTree { root: string; calendar: Map<string, CalendarPairFile>; itinerary: Map<string, ItineraryPairFile> }

const TREE_SUFFIX = `${sep}fixtures${sep}synthetic${sep}fixture`;
const PAIR_FILE = /^[A-Z]{3}-[A-Z]{3}\.json$/;
const HHMM = /^\d{2}:\d{2}$/;

/** Absolute path of this package's synthetic tree (works from src/ and dist/). */
export function defaultFixtureRoot(): string {
  return fileURLToPath(new URL('../../fixtures/synthetic/fixture', import.meta.url));
}

/** The formula price for a cell: base + weekday step × (epoch day mod 7) + nights × per-night. */
export function calendarPriceMinor(file: CalendarPairFile, departureDate: string, nights: number): number {
  return file.baseMinor + (epochDayOf(departureDate) % 7) * file.weekdayStepMinor + nights * file.perNightMinor;
}

type Obj = Record<string, unknown>;
function int(o: Obj, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`${where}: ${k} must be a non-negative integer`);
  return v;
}
function str(o: Obj, k: string, where: string, re?: RegExp): string {
  const v = o[k];
  if (typeof v !== 'string' || v === '' || (re !== undefined && !re.test(v))) throw new Error(`${where}: ${k} is missing or malformed`);
  return v;
}
function ints(o: Obj, k: string, where: string): number[] {
  const v = o[k];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'number' && Number.isInteger(x))) throw new Error(`${where}: ${k} must be an integer array`);
  return v as number[];
}
function obj(o: Obj, k: string, where: string): Obj {
  const v = o[k];
  if (!isRecord(v)) throw new Error(`${where}: ${k} must be an object`);
  return v;
}
function leg(o: Obj, where: string): LegTemplate {
  return { flightNumber: str(o, 'flightNumber', where, /^\d{1,4}$/), depart: str(o, 'depart', where, HHMM), arrive: str(o, 'arrive', where, HHMM), arriveDayOffset: int(o, 'arriveDayOffset', where) };
}

function readPairs(dir: string): Array<{ pair: string; file: string; json: Obj }> {
  return readdirSync(dir)
    .filter((n) => PAIR_FILE.test(n))
    .sort()
    .map((n) => {
      const file = join(dir, n);
      const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!isRecord(json) || json.synthetic !== true) throw new Error(`refusing ${file}: every fixture-tree file carries "synthetic": true (spec §5.5)`);
      return { pair: n.slice(0, 7), file, json };
    });
}

/**
 * Loads and validates the synthetic tree. Refuses any root other than …/fixtures/synthetic/fixture
 * (after realpath, so a symlink cannot point it at the recorded tree) and any file without
 * `"synthetic": true`. Spec §5.5, §9 item 2 "loaders refuse the wrong tree".
 */
export function loadFixtureTree(root: string): FixtureTree {
  const real = realpathSync(root);
  if (!real.endsWith(TREE_SUFFIX)) throw new Error(`refusing fixture tree ${root}: the fixture provider reads only fixtures/synthetic/fixture (spec §5.5)`);
  const calendar = new Map<string, CalendarPairFile>();
  for (const { pair, file, json } of readPairs(join(real, 'calendar'))) {
    calendar.set(pair, {
      synthetic: true,
      currency: str(json, 'currency', file, /^[A-Z]{3}$/),
      baseMinor: int(json, 'baseMinor', file),
      weekdayStepMinor: int(json, 'weekdayStepMinor', file),
      perNightMinor: int(json, 'perNightMinor', file),
      noFaresNights: ints(json, 'noFaresNights', file),
      noDataNights: ints(json, 'noDataNights', file),
    });
  }
  const itinerary = new Map<string, ItineraryPairFile>();
  for (const { pair, file, json } of readPairs(join(real, 'itinerary'))) {
    const options = json.options;
    if (!Array.isArray(options) || options.length === 0) throw new Error(`${file}: options must be a non-empty array`);
    itinerary.set(pair, {
      synthetic: true,
      options: options.map((raw, i) => {
        const where = `${file} options[${i}]`;
        if (!isRecord(raw)) throw new Error(`${where}: not an object`);
        const bag = raw.cabinBagIncluded;
        if (typeof bag !== 'boolean') throw new Error(`${where}: cabinBagIncluded must be a boolean`);
        return {
          seller: str(raw, 'seller', where),
          carrier: str(raw, 'carrier', where, /^[A-Z0-9]{2}$/),
          outbound: leg(obj(raw, 'outbound', where), `${where}.outbound`),
          inbound: leg(obj(raw, 'inbound', where), `${where}.inbound`),
          priceDeltaMinor: int(raw, 'priceDeltaMinor', where),
          cabinBagIncluded: bag,
          checkedBags: int(raw, 'checkedBags', where),
        };
      }),
    });
  }
  return { root: real, calendar, itinerary };
}
```

`src/fixture/server.ts`:

```ts
import { isRecord } from '../util.js';
import { FIXTURE_ORIGIN, SCENARIO_HEADER, SCENARIO_PATH } from './constants.js';
import { addDaysIso, daysBetweenIso, isIsoDateString, localPlusMinutes } from './dates.js';
import { type CalendarPairFile, calendarPriceMinor, type FixtureTree, type LegTemplate, loadFixtureTree, type OptionTemplate } from './tree.js';

/** How the fixture server answers one request. Documented in the brief's §8.1 mapping table. */
export type FixtureResponse =
  | { kind: 'normal' }
  | { kind: 'status'; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: 'malformed' }
  | { kind: 'network' }
  | { kind: 'hang' }
  | { kind: 'empty' }
  | { kind: 'no-fares' }
  | { kind: 'no-currency' }
  | { kind: 'no-return-legs' }
  | { kind: 'partial'; failedExpansions: number }
  | { kind: 'variant'; currency?: string; carrier?: string; connectVia?: string; scope?: 'first-offer' | 'all-offers' };

type Generated = Exclude<FixtureResponse, { kind: 'status' | 'malformed' | 'network' | 'hang' }>;

/** First matching rule with `times` left answers the request. `params` match query values exactly. */
export interface FixtureRule {
  match: { path?: string; params?: Record<string, string> };
  respond: FixtureResponse;
  times?: number;
}

export interface FixtureServer {
  handle(request: Request): Promise<Response>;
  setRules(rules: FixtureRule[]): void;
  reset(): void;
}

/**
 * The scenario-control request (contract consumed by WP7 and WP13): `POST http://fixture.local/__fixture/scenario`
 * with `{ rules }`. Send it with `fetch(scenarioRequest(rules))` under msw, or `router.fetch(scenarioRequest(rules))`
 * against the router instance wired into `inProcessHosts`.
 */
export function scenarioRequest(rules: FixtureRule[]): Request {
  return new Request(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules }) });
}

const MAX_NIGHTS = 90;
const MAX_SPAN_DAYS = 400;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * The fixture provider's server (spec §5.5: an ordinary HTTP endpoint at http://fixture.local), one
 * routing core shared by the msw handlers (tests) and the Hono router (fixture mode). Every body it
 * generates carries `synthetic: true`. State (the scenario rules) lives in this instance.
 */
export function createFixtureServer(root: string): FixtureServer {
  const tree: FixtureTree = loadFixtureTree(root);
  let rules: Array<{ rule: FixtureRule; remaining: number }> = [];
  const setRules = (next: FixtureRule[]): void => {
    rules = next.map((rule) => ({ rule, remaining: rule.times ?? Number.POSITIVE_INFINITY }));
  };
  const reset = (): void => {
    rules = [];
  };

  const pick = (url: URL): FixtureResponse => {
    for (const entry of rules) {
      if (entry.remaining <= 0) continue;
      const m = entry.rule.match;
      if (m.path !== undefined && m.path !== url.pathname) continue;
      if (m.params !== undefined && !Object.entries(m.params).every(([k, v]) => url.searchParams.get(k) === v)) continue;
      entry.remaining -= 1;
      return entry.rule.respond;
    }
    return { kind: 'normal' };
  };

  const need = (url: URL, names: string[], dates: string[]): Record<string, string> | Response => {
    const out: Record<string, string> = {};
    for (const n of names) {
      const v = url.searchParams.get(n);
      if (v === null || v === '') return json({ synthetic: true, error: `synthetic: missing parameter ${n}` }, 400);
      if (dates.includes(n) && !isIsoDateString(v)) return json({ synthetic: true, error: `synthetic: ${n} is not a date` }, 400);
      out[n] = v;
    }
    return out;
  };

  function calendar(respond: Generated, url: URL): Response {
    const dates = ['departFrom', 'departTo', 'returnFrom', 'returnTo'];
    const p = need(url, ['origin', 'destination', ...dates], dates);
    if (p instanceof Response) return p;
    const { origin = '', destination = '', departFrom = '', departTo = '', returnFrom = '', returnTo = '' } = p;
    const file = tree.calendar.get(`${origin}-${destination}`);
    if (file === undefined) return json({ synthetic: true, error: `synthetic: no calendar fixture for ${origin}-${destination}` }, 404);
    if (daysBetweenIso(departFrom, departTo) > MAX_SPAN_DAYS || daysBetweenIso(returnFrom, returnTo) > MAX_SPAN_DAYS) {
      return json({ synthetic: true, error: 'synthetic: rectangle too large' }, 400);
    }
    const prices: Array<{ departureDate: string; returnDate: string; amountMinor: number }> = [];
    const noFares: Array<{ departureDate: string; returnDate: string }> = [];
    if (respond.kind !== 'empty') {
      for (let dep = departFrom; dep <= departTo; dep = addDaysIso(dep, 1)) {
        for (let ret = returnFrom; ret <= returnTo; ret = addDaysIso(ret, 1)) {
          const nights = daysBetweenIso(dep, ret);
          if (nights < 0 || nights > MAX_NIGHTS || file.noDataNights.includes(nights)) continue;
          if (respond.kind === 'no-fares' || file.noFaresNights.includes(nights)) noFares.push({ departureDate: dep, returnDate: ret });
          else prices.push({ departureDate: dep, returnDate: ret, amountMinor: calendarPriceMinor(file, dep, nights) });
        }
      }
    }
    const body: Record<string, unknown> = { synthetic: true, origin, destination, prices, noFares };
    if (respond.kind !== 'no-currency') body.currency = respond.kind === 'variant' && respond.currency !== undefined ? respond.currency : file.currency;
    return json(body);
  }

  function legs(carrier: string, t: LegTemplate, from: string, to: string, date: string, cabin: string, via: string | undefined): unknown[] {
    const depart = `${date}T${t.depart}`;
    const arrive = `${addDaysIso(date, t.arriveDayOffset)}T${t.arrive}`;
    if (via === undefined) return [{ carrier, flightNumber: t.flightNumber, from, to, depart, arrive, cabin }];
    // why: the connection exists only to drive the engine's unknown-airport-tz path; times are template arithmetic.
    return [
      { carrier, flightNumber: t.flightNumber, from, to: via, depart, arrive: localPlusMinutes(depart, 120), cabin },
      { carrier, flightNumber: String(Number(t.flightNumber) + 1000), from: via, to, depart: localPlusMinutes(depart, 180), arrive, cabin },
    ];
  }

  function offerOf(o: OptionTemplate, index: number, p: Record<string, string>, nights: number, cal: CalendarPairFile, respond: Generated): unknown {
    const { origin = '', destination = '', departureDate = '', returnDate = '', cabin = '' } = p;
    const applies = respond.kind === 'variant' && (respond.scope === 'all-offers' || index === 0);
    const carrier = applies && respond.carrier !== undefined ? respond.carrier : o.carrier;
    const via = applies ? respond.connectVia : undefined;
    return {
      seller: o.seller,
      amountMinor: calendarPriceMinor(cal, departureDate, nights) + o.priceDeltaMinor,
      outbound: legs(carrier, o.outbound, origin, destination, departureDate, cabin, via),
      inbound: legs(carrier, o.inbound, destination, origin, returnDate, cabin, undefined),
      baggage: { cabinBag: o.cabinBagIncluded ? 'included' : 'not-included', checkedBags: o.checkedBags },
      selfTransfer: false,
    };
  }

  function itinerary(respond: Generated, url: URL): Response {
    const dates = ['departureDate', 'returnDate'];
    const p = need(url, ['origin', 'destination', ...dates, 'cabin'], dates);
    if (p instanceof Response) return p;
    const pair = `${p.origin}-${p.destination}`;
    const cal = tree.calendar.get(pair);
    const it = tree.itinerary.get(pair);
    if (cal === undefined || it === undefined) return json({ synthetic: true, error: `synthetic: no itinerary fixture for ${pair}` }, 404);
    const nights = daysBetweenIso(p.departureDate ?? '', p.returnDate ?? '');
    if (nights < 0) return json({ synthetic: true, error: 'synthetic: returnDate before departureDate' }, 400);
    const expandTop = Number(url.searchParams.get('expandTop') ?? it.options.length);
    const options = it.options.slice(0, Number.isInteger(expandTop) && expandTop > 0 ? expandTop : it.options.length);
    const base: Record<string, unknown> = { synthetic: true, origin: p.origin, destination: p.destination, departureDate: p.departureDate, returnDate: p.returnDate, cabin: p.cabin };
    if (respond.kind !== 'no-currency') base.currency = respond.kind === 'variant' && respond.currency !== undefined ? respond.currency : cal.currency;
    if (respond.kind === 'empty') return json({ ...base, outboundOptions: 0, failedExpansions: 0, offers: [] });
    if (respond.kind === 'no-return-legs') return json({ ...base, outboundOptions: options.length, failedExpansions: options.length, offers: [] });
    const offers = options.map((o, i) => offerOf(o, i, p, nights, cal, respond));
    const failed = respond.kind === 'partial' ? Math.min(Math.max(0, respond.failedExpansions), offers.length) : 0;
    return json({ ...base, outboundOptions: options.length, failedExpansions: failed, offers: offers.slice(0, offers.length - failed) });
  }

  function render(respond: FixtureResponse, url: URL): Response | Promise<Response> {
    switch (respond.kind) {
      case 'status':
        return json(respond.body ?? { synthetic: true, error: `synthetic HTTP ${respond.status}` }, respond.status, respond.headers ?? {});
      case 'malformed':
        return new Response('{"synthetic": true, "prices": [', { status: 200, headers: { 'content-type': 'application/json' } });
      case 'network':
        return Response.error();
      case 'hang':
        // why: never settles; the client's abort or per-request timeout ends the call (a rejection here
        // would be turned into a 500 by msw instead of a hung request).
        return new Promise<Response>(() => undefined);
      default:
        if (url.pathname === '/health') return json({ synthetic: true, ok: true });
        if (url.pathname === '/calendar') return calendar(respond, url);
        if (url.pathname === '/itinerary') return itinerary(respond, url);
        return json({ synthetic: true, error: `synthetic: no fixture route ${url.pathname}` }, 404);
    }
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === SCENARIO_PATH) {
      if (request.method === 'DELETE') {
        reset();
        return new Response(null, { status: 204 });
      }
      if (request.method === 'POST') {
        const body: unknown = await request.json();
        if (!isRecord(body) || !Array.isArray(body.rules)) return json({ synthetic: true, error: 'synthetic: body must be { rules: FixtureRule[] }' }, 400);
        setRules(body.rules as FixtureRule[]);
        return json({ synthetic: true, rules: rules.length });
      }
      return json({ synthetic: true, error: 'synthetic: use POST or DELETE' }, 405);
    }
    const inline = request.headers.get(SCENARIO_HEADER);
    const respond = inline !== null ? (JSON.parse(inline) as FixtureResponse) : pick(url);
    return render(respond, url);
  }

  return { handle, setRules, reset };
}
```

`src/testing/handlers.ts`:

```ts
import { http } from 'msw/http';
import { FIXTURE_ORIGIN } from '../fixture/constants.js';
import { createFixtureServer } from '../fixture/server.js';

/** msw 3's HTTP handler type (no documented entrypoint exports `RequestHandler`; verified 2026-10-14). */
export type RequestHandler = ReturnType<typeof http.all>;

/**
 * msw handlers serving the synthetic tree at http://fixture.local on global fetch (spec §5.5, §9 item 4
 * layer A). Exported from `@gmt/providers/testing` only; production code never imports that subpath.
 */
export function fixtureHandlers(root: string): RequestHandler[] {
  const fixture = createFixtureServer(root);
  return [http.all(`${FIXTURE_ORIGIN}/*`, ({ request }) => fixture.handle(request))];
}
```

`src/fixture/router.ts`:

```ts
import { Hono } from 'hono';
import { createFixtureServer } from './server.js';

/**
 * The same tree as a Hono router for fixture mode (spec §4 rev 10). WP4b's wiring reaches it through
 * http-kit's gated seam, only under syntheticAllowed: `inProcessHosts: { 'fixture.local': async (req) => router.fetch(req) }`.
 */
export function fixtureRouter(root: string): Hono {
  const fixture = createFixtureServer(root);
  const app = new Hono();
  app.all('*', (c) => fixture.handle(c.req.raw));
  return app;
}
```

`src/testing/index.ts` (Task 4.11 adds the replay exports):

```ts
// `@gmt/providers/testing`: the only module tree that imports msw (plan decision 7). Production code never imports it.
export { fixtureHandlers, type RequestHandler } from './handlers.js';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/server.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/providers && git commit -m "wp04: synthetic fixture tree, fixture server with scenario control, msw handlers and Hono router (spec §4, §5.5)"
```

### Task 4.10: Fixture provider — gate, tiling, discovery and verification through http-kit

**Files:**
- Create: `src/fixture/provider.ts`
- Test: `test/fixture/provider.test.ts`

**Interfaces:**
- Consumes: `syntheticAllowed`, `FlightProvider` and the §5.1 types (WP0); `HttpKit` (Tasks 4.1–4.8); the fixture server (Task 4.9).
- Produces: `fixtureProvider`, `fixtureHttpLimits`, `planFixtureTiles`, `FIXTURE_TILE_DAYS`.

Rules (spec §5.5, §5.3 billable rule, §5.2, §5.1 rev 10): the constructor throws unless `syntheticAllowed(config)`; every tile and search result carries `pointOfSale: 'unknown'` (synthetic data has no market) and no `routeHistory`; `discovery.info` and `verification.info` both carry `sourceKind: 'synthetic'`, so every price this provider returns is synthetic; the HTTP limits allow host `fixture.local` only, `billable: 'http-200'`, `costPerCallMicroGbp` = the configured test cost; responses are never cached (`cache: 'never'`, so layer-A scenarios are never masked; caching is covered by Task 4.6) and never recorded (`recordFixtures: false` whatever `ctx` says); a response without `synthetic: true` is a `parse` error, so the provider cannot carry real data; booking is always `{ kind: 'none' }`; `healthcheck` makes no call. Tiles are `rectangle`s of up to `FIXTURE_TILE_DAYS` (7) departure days, partitioning the query's cells (or `q.cells`, re-planned).

- [ ] **Step 1: Write the failing test**

`test/fixture/provider.test.ts`:

```ts
import { AbortedError, asIata, asIsoDate, type CellKey, type DiscoveryQuery, type ItineraryQuery, type ProviderContext, ProviderError } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureHttpLimits, fixtureProvider, planFixtureTiles } from '../../src/fixture/provider.js';
import { fixtureRouter } from '../../src/fixture/router.js';
import { type FixtureRule, scenarioRequest } from '../../src/fixture/server.js';
import { defaultFixtureRoot } from '../../src/fixture/tree.js';
import { fixtureHandlers } from '../../src/testing/handlers.js';
import { CapturingLogger, makeKit } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const TEST_GATE = { nodeEnv: 'test', databasePath: ':memory:', allowFixtureProvider: null, inContainer: false } as const;
const COST = 3200;
const q: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2026-11-02'),
  departureTo: asIsoDate('2026-11-29'),
  minNights: 10,
  maxNights: 21,
  cabin: 'economy',
  currency: 'GBP',
};
const iq: ItineraryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2026-11-02'),
  returnDate: asIsoDate('2026-11-16'),
  cabin: 'economy',
  adults: 1,
  currency: 'GBP',
  expandTop: 2,
  bookingLinks: false,
};
const ctx = (over: Partial<ProviderContext> = {}): ProviderContext => ({ executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: true, ...over });
const key = (c: CellKey) => `${c.origin}|${c.destination}|${c.departureDate}|${c.returnDate}`;
const scenario = (rules: FixtureRule[]) => fetch(scenarioRequest(rules));

function setup() {
  const k = makeKit({ limits: { fixture: fixtureHttpLimits({ costPerCallMicroGbp: COST, maxWaitSeconds: 3900, requestTimeoutSeconds: 60 }) } });
  const provider = fixtureProvider({ http: k.kit, log: new CapturingLogger(), clock: k.clock, config: TEST_GATE, costMicroGbp: COST });
  return { ...k, provider };
}

describe('fixture provider gate (spec §5.5)', () => {
  it.each([
    ['production', { nodeEnv: 'production', databasePath: '/data/get-me-there.db', allowFixtureProvider: null, inContainer: true }],
    ['production with the phrase', { nodeEnv: 'production', databasePath: '/tmp/x.fixture.db', allowFixtureProvider: 'i-understand-this-is-fake', inContainer: false }],
    ['development without the phrase', { nodeEnv: 'development', databasePath: '/tmp/x.fixture.db', allowFixtureProvider: null, inContainer: false }],
    ['development in the container', { nodeEnv: 'development', databasePath: '/tmp/x.fixture.db', allowFixtureProvider: 'i-understand-this-is-fake', inContainer: true }],
    ['test with a production db path', { nodeEnv: 'test', databasePath: '/data/get-me-there.db', allowFixtureProvider: null, inContainer: false }],
  ] as const)('throws for %s', (_label, config) => {
    const { kit, clock } = makeKit();
    expect(() => fixtureProvider({ http: kit, log: new CapturingLogger(), clock, config, costMicroGbp: COST })).toThrow(/syntheticAllowed/);
  });
  it('constructs under the test gate and the development opt-in', () => {
    const { kit, clock } = makeKit();
    expect(fixtureProvider({ http: kit, log: new CapturingLogger(), clock, config: TEST_GATE, costMicroGbp: COST }).id).toBe('fixture');
    const dev = { nodeEnv: 'development', databasePath: '/tmp/x.fixture.db', allowFixtureProvider: 'i-understand-this-is-fake', inContainer: false } as const;
    expect(fixtureProvider({ http: kit, log: new CapturingLogger(), clock, config: dev, costMicroGbp: COST }).id).toBe('fixture');
  });
  it('declares synthetic on both capabilities and fixture.local as its only host, billable on HTTP 200 at the test cost', () => {
    const { provider } = setup();
    expect(provider.discovery?.info.sourceKind).toBe('synthetic');
    expect(provider.verification?.info.sourceKind).toBe('synthetic');
    expect(fixtureHttpLimits({ costPerCallMicroGbp: COST, maxWaitSeconds: 1, requestTimeoutSeconds: 1 })).toMatchObject({ hosts: ['fixture.local'], billable: 'http-200', costPerCallMicroGbp: COST });
    expect(provider.verification?.estimate(iq)).toMatchObject({ calls: 1, costMicroGbp: COST });
  });
});

describe('planFixtureTiles (tiles partition the cells)', () => {
  const all = (tiles: ReturnType<typeof planFixtureTiles>) => tiles.flatMap((t) => t.coveredCells.map(key));

  it('28 departure days × 12 nights = 336 cells in 4 seven-day rectangles, disjoint and complete', () => {
    const tiles = planFixtureTiles(q);
    expect(tiles.map((t) => t.index)).toEqual([0, 1, 2, 3]);
    const keys = all(tiles);
    expect(keys).toHaveLength(336);
    expect(new Set(keys).size).toBe(336);
    expect(tiles[0]?.request).toEqual({ kind: 'rectangle', departFrom: '2026-11-02', departTo: '2026-11-08', returnFrom: '2026-11-12', returnTo: '2026-11-29' });
  });
  it('re-plans over q.cells: fewer tiles, still a partition of exactly those cells', () => {
    const subset = planFixtureTiles(q).flatMap((t) => t.coveredCells).filter((c) => c.departureDate === '2026-11-03' || c.departureDate === '2026-11-20');
    const tiles = planFixtureTiles({ ...q, cells: subset });
    expect(tiles).toHaveLength(2);
    expect(all(tiles).sort()).toEqual(subset.map(key).sort());
  });
  it('is deterministic', () => expect(planFixtureTiles(q)).toEqual(planFixtureTiles(q)));
});

describe('fixture discovery and verification through the real http-kit and msw', () => {
  beforeEach(() => {
    useFakeTime();
    server.use(...fixtureHandlers(defaultFixtureRoot()));
  });
  afterEach(() => vi.useRealTimers());

  it('fetchTile returns synthetic prices for exactly its covered cells, drops out-of-band entries, ledgers one billable-rule call', async () => {
    const { provider, budget } = setup();
    const plan = planFixtureTiles(q)[0];
    if (!plan || !provider.discovery) throw new Error('no plan');
    const result = await drive(provider.discovery.fetchTile(plan, q, ctx()));
    if (result.kind !== 'tile') throw new Error(`expected a tile, got ${result.kind}`);
    expect(result.prices).toHaveLength(84);
    const covered = new Set(plan.coveredCells.map(key));
    expect(result.prices.every((p) => covered.has(key(p)) && p.currency === 'GBP')).toBe(true);
    expect(result.prices.find((p) => p.returnDate === '2026-11-16' && p.departureDate === '2026-11-02')?.amountMinor).toBe(59_800);
    expect(result.notes).toEqual(['dropped-out-of-band:42']);
    expect(result.fetchedAt).toBe('2026-10-14T15:00:00.000Z');
    expect(result.pointOfSale).toBe('unknown');
    expect(budget.events.filter((e) => e.type === 'reserve')).toEqual([
      expect.objectContaining({ providerId: 'fixture', costMicroGbp: COST, tileIndex: 0, endpointPath: '/calendar', httpAttempt: 1 }),
    ]);
    expect(budget.events.find((e) => e.type === 'finalise')).toMatchObject({ outcome: 'ok', httpStatus: 200 });
  });

  it('reports noFares from the pair file and leaves noData nights absent', async () => {
    const { provider } = setup();
    const lgw = { ...q, origin: asIata('LGW') };
    const plan = planFixtureTiles(lgw)[0];
    if (!plan || !provider.discovery) throw new Error('no plan');
    const r = await drive(provider.discovery.fetchTile(plan, lgw, ctx()));
    if (r.kind !== 'tile') throw new Error(r.kind);
    expect(r.noFares).toHaveLength(7);
    expect(r.prices).toHaveLength(77);
  });

  it('returns tile-error for a ProviderError after retries, marking exactly its covered cells', async () => {
    await scenario([{ match: { path: '/calendar', params: { departFrom: '2026-11-02' } }, respond: { kind: 'status', status: 503 }, times: 3 }]);
    const { provider } = setup();
    const plan = planFixtureTiles(q)[0];
    if (!plan || !provider.discovery) throw new Error('no plan');
    const r = await drive(provider.discovery.fetchTile(plan, q, ctx()));
    expect(r.kind).toBe('tile-error');
    if (r.kind === 'tile-error') {
      expect(r.error).toMatchObject({ kind: 'upstream', httpStatus: 503 });
      expect(r.coveredCells).toBe(plan.coveredCells);
    }
  });

  it.each([
    [{ kind: 'no-currency' }, 'missing-currency'],
    [{ kind: 'status', status: 200, body: { currency: 'GBP', origin: 'LHR', destination: 'JFK', prices: [], noFares: [] } }, 'not-synthetic'],
    [{ kind: 'malformed' }, 'malformed-json'],
  ])('a %j response is a parse tile-error ([%s])', async (respond, code) => {
    await scenario([{ match: { path: '/calendar' }, respond }]);
    const { provider } = setup();
    const plan = planFixtureTiles(q)[0];
    if (!plan || !provider.discovery) throw new Error('no plan');
    const r = await drive(provider.discovery.fetchTile(plan, q, ctx()));
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: undefined, message: expect.stringContaining(`[${code}]`) } });
  });

  it('AbortedError propagates out of fetchTile (it is not a tile-error)', async () => {
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'hang' } }]);
    const { provider } = setup();
    const plan = planFixtureTiles(q)[0];
    if (!plan || !provider.discovery) throw new Error('no plan');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    expect(await driveError(provider.discovery.fetchTile(plan, q, ctx({ signal: ac.signal })))).toBeInstanceOf(AbortedError);
  });

  it('search returns priced synthetic offers with no booking link and the requested cabin', async () => {
    const { provider, budget } = setup();
    if (!provider.verification) throw new Error('no verification');
    const r = await drive(provider.verification.search(iq, ctx()));
    expect(r).toMatchObject({ coverage: 'priced', partial: false, failedExpansions: 0, fetchedAt: '2026-10-14T15:00:00.000Z', pointOfSale: 'unknown' });
    expect(r.routeHistory).toBeUndefined();
    expect(r.offers).toHaveLength(2);
    expect(r.offers[0]).toMatchObject({
      seller: 'Synthetic Air',
      requestedCabin: 'economy',
      amountMinor: 63_600,
      currency: 'GBP',
      booking: { kind: 'none' },
      baggage: { cabinBag: 'included', checkedBags: 1 },
      outbound: [{ marketingCarrier: 'ZZ', flightNumber: '101', from: 'LHR', to: 'JFK', depart: '2026-11-02T09:30', timeKind: 'local', cabin: 'economy' }],
    });
    expect(budget.events.find((e) => e.type === 'reserve')).toMatchObject({ endpointPath: '/itinerary', tileIndex: null, costMicroGbp: COST });
  });

  it('search: empty → coverage empty; no-return-legs → upstream non-retryable; partial → partial with failedExpansions', async () => {
    const { provider } = setup();
    if (!provider.verification) throw new Error('no verification');
    const v = provider.verification;
    await scenario([{ match: { path: '/itinerary' }, respond: { kind: 'empty' }, times: 1 }]);
    expect(await drive(v.search(iq, ctx()))).toMatchObject({ coverage: 'empty', offers: [] });
    await scenario([{ match: { path: '/itinerary' }, respond: { kind: 'no-return-legs' }, times: 1 }]);
    const err = await driveError(v.search(iq, ctx()));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'upstream', reason: 'no-return-legs', retryable: false });
    await scenario([{ match: { path: '/itinerary' }, respond: { kind: 'partial', failedExpansions: 1 }, times: 1 }]);
    expect(await drive(v.search(iq, ctx()))).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 1 });
  });

  it('works over the gated in-process seam (fixture mode) with no msw handler, scenarios sent to that router', async () => {
    server.resetHandlers();
    const router = fixtureRouter(defaultFixtureRoot());
    const k = makeKit({
      inProcessHosts: { 'fixture.local': async (req) => router.fetch(req) },
      limits: { fixture: fixtureHttpLimits({ costPerCallMicroGbp: COST, maxWaitSeconds: 3900, requestTimeoutSeconds: 60 }) },
    });
    const provider = fixtureProvider({ http: k.kit, log: new CapturingLogger(), clock: k.clock, config: TEST_GATE, costMicroGbp: COST });
    const plan = planFixtureTiles(q)[0];
    if (!plan || !provider.discovery) throw new Error('no plan');
    expect(await drive(provider.discovery.fetchTile(plan, q, ctx()))).toMatchObject({ kind: 'tile', pointOfSale: 'unknown' });
    await router.fetch(scenarioRequest([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 401 } }]));
    expect(await drive(provider.discovery.fetchTile(plan, q, ctx()))).toMatchObject({ kind: 'tile-error', error: { kind: 'auth' } });
    expect(k.budget.count('fetch')).toBe(0);
    expect(k.budget.count('reserve')).toBe(2);
  });

  it('never records, even when ctx.recordFixtures is true, and healthcheck makes no call', async () => {
    const { provider, budget } = setup();
    expect(await provider.healthcheck(ctx())).toEqual({ ok: true, detail: 'synthetic fixture provider; no upstream call' });
    expect(budget.reserveCalls).toBe(0);
  });
});
```

The "never records" case is backed by the recorder's own refusal of `providerId: 'fixture'` (Task 4.7) and by `recordFixtures: false` in every request the provider builds, which the http-kit hook honours.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/provider.test.ts`
Expected: FAIL — `Failed to load url ../../src/fixture/provider.js`.

- [ ] **Step 3: Implement**

`src/fixture/provider.ts`:

```ts
import {
  type Cabin,
  type CapabilityInfo,
  type CellKey,
  type Clock,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type Iata,
  type ItineraryQuery,
  type ItinerarySearchResult,
  type Logger,
  type PointOfSale,
  type ProviderContext,
  ProviderError,
  type RawCalendarPrice,
  type RawOffer,
  type RawSegment,
  type SuppliedField,
  type SyntheticGateInput,
  syntheticAllowed,
  type TilePlan,
} from '@gmt/core';
import type { HttpKit, HttpKitResponse, ProviderHttpLimits } from '../http/types.js';
import { isRecord } from '../util.js';
import { FIXTURE_HOST, FIXTURE_ORIGIN } from './constants.js';
import { epochDayOf, isoDateOfEpochDay } from './dates.js';

/** Departure days per discovery tile. */
export const FIXTURE_TILE_DAYS = 7;

const CABINS: readonly Cabin[] = ['economy', 'premium_economy', 'business', 'first'];
const SUPPLIED: readonly SuppliedField[] = ['segments', 'segmentTimes', 'segmentCabins', 'selfTransfer', 'baggage', 'seller', 'price'];
const INFO: CapabilityInfo = {
  sourceKind: 'synthetic',
  provenanceNote: 'synthetic data from the fixture provider, generated for tests and local development; not a fare',
  maxAgeHours: 0,
};
const IATA = /^[A-Z]{3}$/;
/** Synthetic data has no market; spec §5.1 rev 10 requires pointOfSale on every result. */
const FIXTURE_POINT_OF_SALE: PointOfSale = 'unknown';

/**
 * HTTP limits for the fixture provider (spec §5.3 billable rule: `fixture` iff HTTP 200 at the
 * configured test cost; spec §9 item 2: host allowlist is fixture.local only). WP4b's wiring uses this.
 */
export function fixtureHttpLimits(o: { costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number }): ProviderHttpLimits {
  return {
    hosts: [FIXTURE_HOST],
    ratePerMinute: 6000,
    ratePerHour: 360_000,
    concurrency: 4,
    billable: 'http-200',
    costPerCallMicroGbp: o.costPerCallMicroGbp,
    maxWaitSeconds: o.maxWaitSeconds,
    requestTimeoutSeconds: o.requestTimeoutSeconds,
  };
}

const cellKey = (c: { origin: string; destination: string; departureDate: string; returnDate: string }): string =>
  `${c.origin}|${c.destination}|${c.departureDate}|${c.returnDate}`;

function enumerate(q: DiscoveryQuery): CellKey[] {
  const out: CellKey[] = [];
  for (let d = epochDayOf(q.departureFrom); d <= epochDayOf(q.departureTo); d += 1) {
    for (let n = q.minNights; n <= q.maxNights; n += 1) {
      out.push({ origin: q.origin, destination: q.destination, departureDate: isoDateOfEpochDay(d), returnDate: isoDateOfEpochDay(d + n) });
    }
  }
  return out;
}

/**
 * Pure, deterministic tiling (spec §5.2): blocks of FIXTURE_TILE_DAYS departure days from
 * `departureFrom`, each a `rectangle` spanning its covered cells. With `q.cells` set, re-plans over that
 * subset (cells of other pairs are ignored). Tiles partition the cells.
 */
export function planFixtureTiles(q: DiscoveryQuery): TilePlan[] {
  const cells = q.cells ? q.cells.filter((c) => c.origin === q.origin && c.destination === q.destination) : enumerate(q);
  const start = epochDayOf(q.departureFrom);
  const blocks = new Map<number, CellKey[]>();
  for (const c of cells) {
    const b = Math.floor((epochDayOf(c.departureDate) - start) / FIXTURE_TILE_DAYS);
    const list = blocks.get(b);
    if (list) list.push(c);
    else blocks.set(b, [c]);
  }
  return [...blocks.keys()]
    .sort((a, b) => a - b)
    .map((b, index): TilePlan => {
      const covered = blocks.get(b) ?? [];
      const deps = covered.map((c) => c.departureDate).sort();
      const rets = covered.map((c) => c.returnDate).sort();
      const [departFrom, departTo, returnFrom, returnTo] = [deps[0], deps[deps.length - 1], rets[0], rets[rets.length - 1]];
      if (!departFrom || !departTo || !returnFrom || !returnTo) throw new Error('planFixtureTiles: empty block');
      return { index, coveredCells: covered, request: { kind: 'rectangle', departFrom, departTo, returnFrom, returnTo } };
    });
}

/** Parse failure with a bracketed diagnostic code in the message; `reason` stays unset (it feeds cell_outcomes.reason). */
function parseError(endpointPath: string, code: string): ProviderError {
  return new ProviderError({ kind: 'parse', retryable: false, providerId: 'fixture', message: `fixture ${endpointPath}: ${code} [${code}]` });
}

/** Envelope checks shared by both endpoints: synthetic marker, currency read from the response, pair echo. */
function envelope(endpointPath: string, body: unknown, origin: string, destination: string): { b: Record<string, unknown>; currency: string } {
  if (!isRecord(body)) throw parseError(endpointPath, 'malformed-envelope');
  // why: spec §5.5 — the provider refuses anything not marked synthetic, so it can never carry real data.
  if (body.synthetic !== true) throw parseError(endpointPath, 'not-synthetic');
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) throw parseError(endpointPath, 'missing-currency');
  if (body.origin !== origin || body.destination !== destination) throw parseError(endpointPath, 'pair-mismatch');
  return { b: body, currency: body.currency };
}

function dated(endpointPath: string, e: unknown): { departureDate: string; returnDate: string; e: Record<string, unknown> } {
  if (!isRecord(e) || typeof e.departureDate !== 'string' || typeof e.returnDate !== 'string') throw parseError(endpointPath, 'malformed-entry');
  return { departureDate: e.departureDate, returnDate: e.returnDate, e };
}

function segment(s: unknown): RawSegment {
  if (!isRecord(s)) throw parseError('/itinerary', 'malformed-segment');
  const { carrier, flightNumber, from, to, depart, arrive, cabin } = s;
  if (typeof carrier !== 'string' || typeof flightNumber !== 'string' || typeof depart !== 'string' || typeof arrive !== 'string') throw parseError('/itinerary', 'malformed-segment');
  if (typeof from !== 'string' || !IATA.test(from) || typeof to !== 'string' || !IATA.test(to)) throw parseError('/itinerary', 'malformed-segment');
  const seg: RawSegment = { marketingCarrier: carrier, flightNumber, from: from as Iata, to: to as Iata, depart, arrive, timeKind: 'local' };
  if (typeof cabin === 'string' && (CABINS as readonly string[]).includes(cabin)) seg.cabin = cabin as Cabin;
  return seg;
}

function offer(o: unknown, q: ItineraryQuery, currency: string): RawOffer {
  if (!isRecord(o) || typeof o.seller !== 'string' || typeof o.amountMinor !== 'number' || !Number.isInteger(o.amountMinor) || o.amountMinor < 0) {
    throw parseError('/itinerary', 'malformed-offer');
  }
  if (!Array.isArray(o.outbound) || !Array.isArray(o.inbound)) throw parseError('/itinerary', 'malformed-offer');
  const raw: RawOffer = {
    outbound: o.outbound.map(segment),
    inbound: o.inbound.map(segment),
    seller: o.seller,
    requestedCabin: q.cabin,
    amountMinor: o.amountMinor,
    currency,
    taxesIncluded: true,
    // why: synthetic data never links anywhere (spec §5.2 vendor links; §5.5 no fabricated data).
    booking: { kind: 'none' },
  };
  if (typeof o.selfTransfer === 'boolean') raw.selfTransfer = o.selfTransfer;
  if (isRecord(o.baggage)) {
    const bag = o.baggage;
    raw.baggage = {
      ...(bag.cabinBag === 'included' || bag.cabinBag === 'not-included' ? { cabinBag: bag.cabinBag } : {}),
      ...(typeof bag.checkedBags === 'number' ? { checkedBags: bag.checkedBags } : {}),
    };
  }
  return raw;
}

/**
 * The fixture provider (spec §5.5): an ordinary HTTP adapter against http://fixture.local through the
 * real http-kit, constructed only when syntheticAllowed(config). Every price is sourceKind 'synthetic'.
 */
export function fixtureProvider(opts: {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  config: SyntheticGateInput;
  costMicroGbp: number;
}): FlightProvider {
  if (!syntheticAllowed(opts.config)) throw new Error('fixture provider refused: syntheticAllowed(config) is false (spec §5.5)');
  const log = opts.log.child({ providerId: 'fixture' });

  const call = (endpointPath: '/calendar' | '/itinerary', params: Record<string, string>, ctx: ProviderContext, tileIndex: number | null): Promise<HttpKitResponse> => {
    const url = new URL(endpointPath, FIXTURE_ORIGIN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // why: cache 'never' keeps layer-A scenarios unmasked; recordFixtures false because synthetic data is never recorded.
    return opts.http.request({ providerId: 'fixture', executionId: ctx.executionId, tileIndex, endpointPath, method: 'GET', url, headers: { accept: 'application/json' }, cache: 'never', signal: ctx.signal, recordFixtures: false });
  };

  async function fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
    const fail = (error: ProviderError): DiscoveryTileResult => ({ kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error });
    const r = plan.request;
    if (r.kind !== 'rectangle') return fail(parseError('/calendar', `unsupported-tile:${r.kind}`));
    try {
      const res = await call(
        '/calendar',
        { origin: q.origin, destination: q.destination, departFrom: r.departFrom, departTo: r.departTo, returnFrom: r.returnFrom, returnTo: r.returnTo, cabin: q.cabin, currency: q.currency },
        ctx,
        plan.index,
      );
      const { b, currency } = envelope('/calendar', res.body, q.origin, q.destination);
      if (!Array.isArray(b.prices) || !Array.isArray(b.noFares)) throw parseError('/calendar', 'malformed-envelope');
      const covered = new Map(plan.coveredCells.map((c) => [cellKey(c), c]));
      const prices: RawCalendarPrice[] = [];
      const noFares: CellKey[] = [];
      let dropped = 0;
      for (const raw of b.prices) {
        const { departureDate, returnDate, e } = dated('/calendar', raw);
        if (typeof e.amountMinor !== 'number' || !Number.isInteger(e.amountMinor) || e.amountMinor < 0) throw parseError('/calendar', 'malformed-entry');
        const cell = covered.get(cellKey({ origin: q.origin, destination: q.destination, departureDate, returnDate }));
        if (cell === undefined) dropped += 1;
        else prices.push({ ...cell, amountMinor: e.amountMinor, currency });
      }
      for (const raw of b.noFares) {
        const { departureDate, returnDate } = dated('/calendar', raw);
        const cell = covered.get(cellKey({ origin: q.origin, destination: q.destination, departureDate, returnDate }));
        if (cell === undefined) dropped += 1;
        else noFares.push(cell);
      }
      log.debug({ tileIndex: plan.index, prices: prices.length, noFares: noFares.length, dropped }, 'fixture tile');
      return { kind: 'tile', index: plan.index, coveredCells: plan.coveredCells, fetchedAt: res.fetchedAt, pointOfSale: FIXTURE_POINT_OF_SALE, prices, noFares, notes: dropped > 0 ? [`dropped-out-of-band:${dropped}`] : [] };
    } catch (e) {
      // why: spec §8.1 — a ProviderError marks exactly this tile's cells; AbortedError and BudgetExceeded propagate.
      if (e instanceof ProviderError) return fail(e);
      throw e;
    }
  }

  async function search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult> {
    const res = await call(
      '/itinerary',
      { origin: q.origin, destination: q.destination, departureDate: q.departureDate, returnDate: q.returnDate, cabin: q.cabin, currency: q.currency, expandTop: String(q.expandTop) },
      ctx,
      null,
    );
    const { b, currency } = envelope('/itinerary', res.body, q.origin, q.destination);
    const { outboundOptions, failedExpansions, offers } = b;
    if (typeof outboundOptions !== 'number' || typeof failedExpansions !== 'number' || !Array.isArray(offers)) throw parseError('/itinerary', 'malformed-envelope');
    const parsed = offers.map((o) => offer(o, q, currency));
    if (outboundOptions > 0 && parsed.length === 0) {
      // why: spec §5.4 outcome rule, vendor-agnostic: outbound options but no return legs is non-retryable upstream.
      throw new ProviderError({ kind: 'upstream', retryable: false, providerId: 'fixture', reason: 'no-return-legs', message: 'fixture /itinerary: outbound options but no return legs' });
    }
    return { offers: parsed, coverage: parsed.length > 0 ? 'priced' : 'empty', fetchedAt: res.fetchedAt, pointOfSale: FIXTURE_POINT_OF_SALE, partial: failedExpansions > 0, failedExpansions, notes: [] };
  }

  return {
    id: 'fixture',
    displayName: 'Fixture provider (synthetic)',
    suppliedFields: SUPPLIED,
    cabins: CABINS,
    discovery: { info: INFO, plan: planFixtureTiles, fetchTile },
    verification: {
      info: INFO,
      estimate: () => ({ calls: 1, costMicroGbp: opts.costMicroGbp, seconds: 1, notes: ['fixture provider: one synthetic call per cell'] }),
      search,
    },
    healthcheck: async () => ({ ok: true, detail: 'synthetic fixture provider; no upstream call' }),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture`
Expected: PASS, 32 tests (11 server, 21 provider).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: fixture provider behind syntheticAllowed, synthetic tiles and offers through http-kit (spec §5.5)"
```

### Task 4.11: Replay of recorded fixtures — `replayHandlers` and `loadRecorded`

**Files:**
- Create: `src/testing/replay.ts`
- Modify: `src/testing/index.ts`
- Test: `test/testing/replay.test.ts`

**Interfaces:**
- Consumes: `loadRecordedFixture`, `RecordedFixture` (Task 4.7); msw 3.0.3 (`http.all`, `HttpResponse`).
- Produces (from `@gmt/providers/testing`): `replayHandlers(recordedRoot): RequestHandler[]`, `loadRecorded(root, providerId, endpointPath): RecordedFixture[]` — consumed by WP5/WP6 adapter tests and WP13's layer-B engine tests.

Matching rule: a request is answered by the recordings whose `request.method`, origin, path and query (sorted name/value pairs, decoded) equal the request's; credentials never appear in a recorded URL (egress refuses them), so the comparison is credential-free by construction. Placeholders are compared verbatim: a replayed response hands the adapter `<departure_token:0>`, the adapter sends that string back, and it equals the recorded request's query value, so chains replay without the raw token. Identical requests are answered by the matching recordings in file-name (date) order, then the last one repeatedly. An unmatched request falls through (resolver returns `undefined`), so msw's `onUnhandledFrame: 'error'` fails the test rather than inventing a response. Every recording is loaded through `loadRecordedFixture`, so a hand-edited file fails the hash check before any test uses it. `.raw.json` files and `params-*.json` allowlists are skipped.

- [ ] **Step 1: Write the failing test**

`test/testing/replay.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { createRecorder } from '../../src/http/recorder.js';
import { loadRecorded, replayHandlers } from '../../src/testing/replay.js';
import { ALL_SECRETS, req, SEARCH } from '../fakes.js';
import { server } from '../support/msw.js';

async function recordChain(): Promise<string> {
  const root = join(mkdtempSync(join(tmpdir(), 'gmt-rep-')), 'fixtures', 'recorded');
  mkdirSync(root, { recursive: true });
  const rec = createRecorder({ root, secrets: ALL_SECRETS, clock: fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z')), recordedBy: 'wp04-test' });
  const at = (url: string, body: unknown, status = 200) => ({ providerId: 'searchapi' as const, endpointPath: '/api/v1/search', request: req({ url }), status, body });
  await rec.record(at(`${SEARCH}?engine=google_flights&departure_id=LHR`, { best_flights: [{ departure_token: 'RAW-A', price: 603 }] }));
  await rec.record(at(`${SEARCH}?engine=google_flights&departure_token=RAW-A`, { best_flights: [{ booking_token: 'RAW-B', price: 573 }] }));
  await rec.record(at(`${SEARCH}?engine=google_flights_calendar&departure_id=LGW`, { error: 'Too many combinations' }, 400));
  writeFileSync(join(root, 'searchapi', 'params-2026-10-14.json'), '{"not":"a recording"}');
  return root;
}

describe('replayHandlers and loadRecorded (WP5/WP6 adapter tests, WP13 layer B)', () => {
  it('replays a recorded chain: the served placeholder, sent back, matches the next recorded request', async () => {
    server.use(...replayHandlers(await recordChain()));
    const step1 = (await (await fetch(`${SEARCH}?departure_id=LHR&engine=google_flights`)).json()) as { best_flights: Array<{ departure_token: string }> };
    const token = step1.best_flights[0]?.departure_token ?? '';
    expect(token).toBe('<departure_token:0>');
    const step2 = await fetch(`${SEARCH}?engine=google_flights&departure_token=${encodeURIComponent(token)}`, { headers: { authorization: 'Bearer anything' } });
    expect(await step2.json()).toEqual({ best_flights: [{ booking_token: '<booking_token:0>', price: 573 }] });
  });

  it('replays the recorded status and body of an error response', async () => {
    server.use(...replayHandlers(await recordChain()));
    const res = await fetch(`${SEARCH}?engine=google_flights_calendar&departure_id=LGW`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Too many combinations' });
  });

  it('an unrecorded request is not invented: it falls through and fails as unhandled', async () => {
    server.use(...replayHandlers(await recordChain()));
    await expect(fetch(`${SEARCH}?engine=google_flights&departure_id=EWR`)).rejects.toThrow();
  });

  it('loadRecorded lists one endpoint’s recordings in file order, skipping raw bodies and allowlists', async () => {
    const root = await recordChain();
    const list = loadRecorded(root, 'searchapi', '/api/v1/search');
    expect(list).toHaveLength(3);
    expect(list.every((f) => f.providerId === 'searchapi' && f.endpointPath === '/api/v1/search')).toBe(true);
    expect(loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/testing/replay.test.ts`
Expected: FAIL — `Failed to load url ../../src/testing/replay.js`.

- [ ] **Step 3: Implement**

`src/testing/replay.ts`:

```ts
import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw/http';
import { loadRecordedFixture, type RecordedFixture } from '../http/recorder.js';
import type { RequestHandler } from './handlers.js';

const RECORDING = (name: string): boolean => name.endsWith('.json') && !name.endsWith('.raw.json') && !name.startsWith('params-');
const byPair = (a: [string, string], b: [string, string]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

/** Match key: method, origin, path and the sorted, decoded query pairs. */
function keyOf(method: string, url: URL): string {
  return `${method.toUpperCase()} ${url.origin}${url.pathname} ${JSON.stringify([...url.searchParams.entries()].sort(byPair))}`;
}

function walk(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : RECORDING(e.name) ? [join(dir, e.name)] : []))
    .sort();
}

/** Recordings for one provider endpoint, in file-name (date) order. `endpointPath` uses the recorder's layout (/ → _). */
export function loadRecorded(root: string, providerId: string, endpointPath: string): RecordedFixture[] {
  return walk(join(root, providerId, endpointPath.replaceAll('/', '_'))).map(loadRecordedFixture);
}

/**
 * msw handlers that answer requests from the recorded tree (plan contracts v2): match on method, origin,
 * path and query; serve the recorded status and body; identical requests take the recordings in order,
 * then the last; anything unrecorded falls through to msw's unhandled-request error.
 */
export function replayHandlers(recordedRoot: string): RequestHandler[] {
  const byKey = new Map<string, RecordedFixture[]>();
  for (const f of walk(recordedRoot).map(loadRecordedFixture)) {
    const k = keyOf(f.request.method, new URL(f.request.url));
    byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  const served = new Map<string, number>();
  const origins = [...new Set([...byKey.values()].flat().map((f) => new URL(f.request.url).origin))].sort();
  return origins.map((origin) =>
    http.all(`${origin}/*`, ({ request }) => {
      const k = keyOf(request.method, new URL(request.url));
      const list = byKey.get(k);
      if (list === undefined) return undefined;
      const n = served.get(k) ?? 0;
      served.set(k, n + 1);
      const f = list[Math.min(n, list.length - 1)];
      if (f === undefined) return undefined;
      // why: a malformed vendor body was recorded as text; replay it byte for byte so the parse path is exercised.
      const text = typeof f.body === 'string' ? f.body : JSON.stringify(f.body);
      return new HttpResponse(text, { status: f.status, headers: { 'content-type': 'application/json' } });
    }),
  );
}
```

`src/testing/index.ts` (replace):

```ts
// `@gmt/providers/testing`: the only module tree that imports msw (plan decision 7). Production code never imports it.
export { fixtureHandlers, type RequestHandler } from './handlers.js';
export { loadRecorded, replayHandlers } from './replay.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/testing/replay.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: replayHandlers and loadRecorded over the recorded tree (@gmt/providers/testing)"
```

### Task 4.12: Parameter allowlists — `ParamsAllowlist`, `loadParamsAllowlist`, `assertRequestAllowed`

**Files:**
- Create: `src/params/allowlist.ts`
- Test: `test/params/allowlist.test.ts`

**Interfaces:**
- Consumes: `loadRecordedJson`, `withContentHash` (Task 4.7); `ProviderId`, `IsoDate` (WP0).
- Produces (plan http-kit block, decision 14; imported by WP4b, WP5, WP6): `ParamsAllowlist`, `loadParamsAllowlist(path)`, `assertRequestAllowed(allowlist, endpointPath, url)`, `ParamsNotAllowedError`.

Rules (spec §5.2 "the dated allowlist enumerates parameter names **and values**; tests assert both"): `endpoints` is keyed by endpoint path; each entry's `names` is strictly ascending (sorted, no duplicates); `values` has exactly one entry per name, either a non-empty string array or `'any'`; the file lives under `fixtures/recorded/` and carries a valid `contentSha256` (checked by `loadRecordedJson`). `assertRequestAllowed` refuses a URL whose path is not the endpoint, any query parameter not in `names`, and any value not listed for its name; its message names the parameter, never the value (a value may be an opaque token).

- [ ] **Step 1: Write the failing test**

`test/params/allowlist.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withContentHash } from '../../src/http/recorder.js';
import { assertRequestAllowed, loadParamsAllowlist, ParamsNotAllowedError } from '../../src/params/allowlist.js';

const EP = '/api/v1/search';
const good = {
  provider: 'searchapi',
  recordedAt: '2026-10-14',
  endpoints: { [EP]: { names: ['currency', 'departure_id', 'engine', 'gl'], values: { currency: ['GBP'], departure_id: 'any', engine: ['google_flights', 'google_flights_calendar'], gl: ['gb'] } } },
};
function write(content: unknown): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'gmt-par-')), 'fixtures', 'recorded', 'searchapi');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'params-2026-10-14.json');
  writeFileSync(p, JSON.stringify(content));
  return p;
}
const allowlist = () => loadParamsAllowlist(write(withContentHash(good)));
const url = (q: string) => new URL(`https://www.searchapi.io${EP}?${q}`);

describe('loadParamsAllowlist (spec §5.2 dated allowlist)', () => {
  it('loads a hashed allowlist from the recorded tree', () => {
    expect(allowlist()).toMatchObject({ provider: 'searchapi', recordedAt: '2026-10-14', endpoints: { [EP]: { names: ['currency', 'departure_id', 'engine', 'gl'] } } });
  });
  it('refuses a hand-edited file (content hash)', () => {
    const edited = { ...withContentHash(good), recordedAt: '2026-10-15' };
    expect(() => loadParamsAllowlist(write(edited))).toThrow(/content hash mismatch/);
  });
  it('refuses names that are not strictly ascending, a value entry for an unlisted name, and a name without values', () => {
    const unsorted = { ...good, endpoints: { [EP]: { names: ['gl', 'engine'], values: { gl: ['gb'], engine: 'any' } } } };
    expect(() => loadParamsAllowlist(write(withContentHash(unsorted)))).toThrow(/ascending/);
    const extra = { ...good, endpoints: { [EP]: { names: ['gl'], values: { gl: ['gb'], hl: ['en'] } } } };
    expect(() => loadParamsAllowlist(write(withContentHash(extra)))).toThrow(/hl/);
    const missing = { ...good, endpoints: { [EP]: { names: ['gl', 'hl'], values: { gl: ['gb'] } } } };
    expect(() => loadParamsAllowlist(write(withContentHash(missing)))).toThrow(/hl/);
  });
  it('refuses an unknown provider and a recordedAt that is not a date', () => {
    expect(() => loadParamsAllowlist(write(withContentHash({ ...good, provider: 'kiwi' })))).toThrow(/provider/);
    expect(() => loadParamsAllowlist(write(withContentHash({ ...good, recordedAt: '2026-10-14T00:00:00.000Z' })))).toThrow(/recordedAt/);
  });
});

describe('assertRequestAllowed (names and values)', () => {
  it('accepts listed names with listed values, and any value where the allowlist says any', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url('engine=google_flights&gl=gb&currency=GBP&departure_id=LHR'))).not.toThrow();
  });
  it('refuses an unlisted parameter, naming it', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url('engine=google_flights&hl=en'))).toThrow(ParamsNotAllowedError);
    expect(() => assertRequestAllowed(allowlist(), EP, url('engine=google_flights&hl=en'))).toThrow(/hl/);
  });
  it('refuses an unlisted value without echoing it', () => {
    let message = '';
    try {
      assertRequestAllowed(allowlist(), EP, url('engine=google_flights&gl=us-secret-looking-value'));
    } catch (e) {
      message = e instanceof Error ? e.message : '';
    }
    expect(message).toMatch(/gl/);
    expect(message).not.toContain('us-secret-looking-value');
  });
  it('refuses an unknown endpoint and a URL whose path is not the endpoint', () => {
    expect(() => assertRequestAllowed(allowlist(), '/other', url('engine=google_flights'))).toThrow(ParamsNotAllowedError);
    expect(() => assertRequestAllowed(allowlist(), EP, new URL('https://www.searchapi.io/api/v2/search?engine=google_flights'))).toThrow(/path/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/params/allowlist.test.ts`
Expected: FAIL — `Failed to load url ../../src/params/allowlist.js`.

- [ ] **Step 3: Implement**

`src/params/allowlist.ts`:

```ts
import type { IsoDate, ProviderId } from '@gmt/core';
import { loadRecordedJson } from '../http/recorder.js';
import { isRecord } from '../util.js';

/**
 * Dated parameter allowlist, spec §5.2: every parameter name **and value** an adapter may send, per endpoint
 * path. Written by WP4b under fixtures/recorded/<provider>/params-<date>.json with withContentHash; WP5/WP6
 * hold an equal code constant (SEARCHAPI_PARAMS, TRAVELPAYOUTS_PARAMS) and assert the two match.
 */
export interface ParamsAllowlist {
  provider: ProviderId;
  recordedAt: IsoDate;
  endpoints: Record<string, { names: string[]; values: Record<string, string[] | 'any'> }>;
  contentSha256: string;
}

/** A request would send a parameter or value the dated allowlist does not list. */
export class ParamsNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParamsNotAllowedError';
  }
}

const PROVIDERS: readonly string[] = ['travelpayouts', 'searchapi', 'fixture'];

/** Loads and validates an allowlist file (recorded tree, content hash, shape, ascending names, values per name). */
export function loadParamsAllowlist(path: string): ParamsAllowlist {
  const json = loadRecordedJson(path);
  const fail = (why: string): never => {
    throw new Error(`refusing params allowlist ${path}: ${why}`);
  };
  if (typeof json.provider !== 'string' || !PROVIDERS.includes(json.provider)) fail('unknown provider');
  if (typeof json.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(json.recordedAt)) fail('recordedAt must be YYYY-MM-DD');
  if (!isRecord(json.endpoints)) fail('endpoints must be an object keyed by endpoint path');
  for (const [endpoint, entry] of Object.entries(json.endpoints as Record<string, unknown>)) {
    if (!endpoint.startsWith('/') || !isRecord(entry) || !Array.isArray(entry.names) || !isRecord(entry.values)) fail(`endpoint ${endpoint} is malformed`);
    const e = entry as { names: unknown[]; values: Record<string, unknown> };
    if (!e.names.every((n): n is string => typeof n === 'string')) fail(`endpoint ${endpoint}: names must be strings`);
    const names = e.names as string[];
    for (let i = 1; i < names.length; i += 1) {
      const prev = names[i - 1] ?? '';
      const cur = names[i] ?? '';
      if (!(prev < cur)) fail(`endpoint ${endpoint}: names must be strictly ascending (${prev}, ${cur})`);
    }
    for (const n of names) {
      const v = e.values[n];
      const ok = v === 'any' || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'));
      if (!ok) fail(`endpoint ${endpoint}: name ${n} needs 'any' or a non-empty value list`);
    }
    for (const k of Object.keys(e.values)) if (!names.includes(k)) fail(`endpoint ${endpoint}: values lists ${k}, which is not in names`);
  }
  return json as unknown as ParamsAllowlist;
}

/**
 * Throws ParamsNotAllowedError unless every query parameter of `url` is listed for `endpointPath` with an
 * allowed value (spec §5.2). Adapters call it before http-kit; messages name the parameter, never the value.
 */
export function assertRequestAllowed(allowlist: ParamsAllowlist, endpointPath: string, url: URL): void {
  const entry = allowlist.endpoints[endpointPath];
  if (entry === undefined) throw new ParamsNotAllowedError(`${allowlist.provider}: endpoint ${endpointPath} is not in the ${allowlist.recordedAt} allowlist`);
  if (url.pathname !== endpointPath) throw new ParamsNotAllowedError(`${allowlist.provider}: URL path does not match endpoint ${endpointPath}`);
  for (const [name, value] of url.searchParams.entries()) {
    if (!entry.names.includes(name)) throw new ParamsNotAllowedError(`${allowlist.provider} ${endpointPath}: parameter ${name} is not in the ${allowlist.recordedAt} allowlist`);
    const allowed = entry.values[name];
    if (allowed !== 'any' && !(allowed ?? []).includes(value)) {
      throw new ParamsNotAllowedError(`${allowlist.provider} ${endpointPath}: a value of ${name} is not in the ${allowlist.recordedAt} allowlist`);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/params/allowlist.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: ParamsAllowlist loader and request check (spec §5.2, plan decision 14)"
```

### Task 4.13: Fixture-tree test, barrel, and the package definition of done

**Files:**
- Replace: `src/index.ts`
- Delete: `test/smoke.test.ts` (WP0 placeholder; superseded by `test/barrel.test.ts`)
- Test: `test/fixture/tree.test.ts`, `test/barrel.test.ts`

**Interfaces:**
- Produces: the public surface of `@gmt/providers` and `@gmt/providers/testing` as listed in "Interfaces produced".

- [ ] **Step 1: Write the failing tests**

`test/fixture/tree.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFixtureTree } from '../../src/fixture/tree.js';
import { loadRecordedJson } from '../../src/http/recorder.js';
import { ALL_SECRETS } from '../fakes.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
// why: .raw.json files are local, gitignored debugging copies; only committed files are scanned.
const committed = walk(FIXTURES).filter((f) => !f.endsWith('.gitkeep') && !f.endsWith('.raw.json'));

describe('fixture-tree test (spec §9 item 2: every committed fixture scanned)', () => {
  it('finds the synthetic tree', () => {
    expect(committed.some((f) => f.includes(`${sep}synthetic${sep}`))).toBe(true);
  });

  it('every file is under fixtures/synthetic/fixture or fixtures/recorded, and is JSON', () => {
    for (const f of committed) {
      const rel = relative(FIXTURES, f);
      expect(rel.startsWith(`synthetic${sep}fixture${sep}`) || rel.startsWith(`recorded${sep}`), rel).toBe(true);
      expect(f.endsWith('.json'), rel).toBe(true);
    }
  });

  it('synthetic files carry "synthetic": true and no recording fields', () => {
    for (const f of committed.filter((x) => x.includes(`${sep}synthetic${sep}`))) {
      const json = JSON.parse(readFileSync(f, 'utf8'));
      expect(json.synthetic, f).toBe(true);
      expect('recordedAt' in json || 'contentSha256' in json, f).toBe(false);
    }
  });

  it('recorded files carry recordedAt, recordedBy and a content hash that recomputes (a hand-edited file fails)', () => {
    for (const f of committed.filter((x) => x.includes(`${sep}recorded${sep}`))) {
      expect(() => loadRecordedJson(f), f).not.toThrow();
    }
  });

  it('no committed fixture contains any configured sentinel', () => {
    for (const f of committed) {
      const text = readFileSync(f, 'utf8');
      for (const s of ALL_SECRETS) expect(text.includes(s.reveal()), f).toBe(false);
    }
  });

  it('loaders refuse the wrong tree in both directions', () => {
    expect(() => loadFixtureTree(join(FIXTURES, 'recorded'))).toThrow(/fixtures\/synthetic\/fixture/);
    const synthetic = committed.find((x) => x.includes(`${sep}synthetic${sep}`)) ?? '';
    expect(() => loadRecordedJson(synthetic)).toThrow(/fixtures\/recorded/);
  });
});
```

`test/barrel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as providers from '../src/index.js';
import * as testing from '../src/testing/index.js';

describe('@gmt/providers public surface (plan "http-kit" contract)', () => {
  it('exports every contract function by its exact name', () => {
    for (const name of [
      'createHttpKit',
      'createRecorder',
      'scrubSecrets',
      'stripUrl',
      'canonicalCacheKey',
      'fixtureProvider',
      'fixtureRouter',
      'classifyResponse',
      'parseRetryAfter',
      'containsSecret',
      'withContentHash',
      'verifyContentHash',
      'loadRecordedJson',
      'loadRecordedFixture',
      'fixtureHttpLimits',
      'planFixtureTiles',
      'defaultFixtureRoot',
      'loadFixtureTree',
      'createFixtureServer',
      'contentHash',
      'scenarioRequest',
      'loadParamsAllowlist',
      'assertRequestAllowed',
    ]) {
      expect(typeof (providers as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(providers.MAX_ATTEMPTS).toBe(3);
    expect(providers.FIXTURE_HOST).toBe('fixture.local');
    expect(providers.SCENARIO_PATH).toBe('/__fixture/scenario');
    expect(providers.SCENARIO_HEADER).toBe('x-fixture-scenario');
    expect(providers.CREDENTIAL_HEADERS.has('authorization')).toBe(true);
  });
  it('keeps msw out of the main barrel and exposes fixtureHandlers, replayHandlers and loadRecorded from ./testing', () => {
    for (const name of ['fixtureHandlers', 'replayHandlers', 'loadRecorded']) {
      expect(name in providers, name).toBe(false);
      expect(typeof (testing as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/tree.test.ts test/barrel.test.ts`
Expected: `tree.test.ts` PASS (it guards files committed in Tasks 4.7 and 4.9; its negative cases are proven by `server.test.ts` and `recorder.test.ts`; WP5/WP6 hashed `ParamsAllowlist` files will pass it through `loadRecordedJson`); `barrel.test.ts` FAIL — `expected 'undefined' to be 'function'` for `createHttpKit` (WP0's barrel is empty).

- [ ] **Step 3: Implement**

`src/index.ts`:

```ts
// Barrel for @gmt/providers (spec §4: imports @gmt/core only; no SQLite, no process.env).
// fixtureHandlers, replayHandlers and loadRecorded live in ./testing/ (the only msw importer, plan decision 7).
export { BACKOFF_BASE_MS, createHttpKit, isRetryable, MAX_ATTEMPTS } from './http/httpKit.js';
export type { FixtureRecorder, HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse, HttpProviderId, ProviderHttpLimits } from './http/types.js';
export { classifyResponse, parseRetryAfter, type ResponseFacts } from './http/classify.js';
export { CREDENTIAL_HEADERS, canonicalCacheKey } from './http/cacheKey.js';
export { containsSecret, scrubSecrets, stripUrl } from './http/scrub.js';
export {
  canonicalJson,
  contentHash,
  createRecorder,
  loadRecordedFixture,
  loadRecordedJson,
  type RecordedFixture,
  RecorderRefusedError,
  verifyContentHash,
  withContentHash,
} from './http/recorder.js';
export { FIXTURE_HOST, FIXTURE_ORIGIN, SCENARIO_HEADER, SCENARIO_PATH } from './fixture/constants.js';
export { FIXTURE_TILE_DAYS, fixtureHttpLimits, fixtureProvider, planFixtureTiles } from './fixture/provider.js';
export { createFixtureServer, type FixtureResponse, type FixtureRule, type FixtureServer, scenarioRequest } from './fixture/server.js';
export { fixtureRouter } from './fixture/router.js';
export { calendarPriceMinor, defaultFixtureRoot, type FixtureTree, loadFixtureTree } from './fixture/tree.js';
export { assertRequestAllowed, loadParamsAllowlist, type ParamsAllowlist, ParamsNotAllowedError } from './params/allowlist.js';
```

Delete `packages/providers/test/smoke.test.ts`.

- [ ] **Step 4: Run the whole package**

Run: `pnpm --filter @gmt/providers test`
Expected: PASS, 128 tests in 16 files; coverage table at or above 85% lines, 70% branches, 85% functions, 85% statements, no threshold error.

- [ ] **Step 5: Commit**

```bash
git add -A packages/providers && git commit -m "wp04: providers barrel and the fixture-tree test (spec §9 item 2)"
```

## Pinned review-focus tests

None. The plan's five Review Focus lines are owned by WP0, WP1, WP2, WP3, WP7, WP8, WP9 and WP10; none names WP4. Review Focus 5 (SQLite busy or full during a tile write) reaches this package only as a non-`ProviderError` thrown inside the engine's write, which `fixtureProvider.fetchTile` lets propagate unchanged (Task 4.10 rethrows everything that is not a `ProviderError`).

## Definition of done

Run from the repository root; each must hold exactly:

1. `pnpm --filter @gmt/providers test` → all 128 tests pass; coverage ≥ 85% lines, ≥ 70% branches, ≥ 85% functions and statements; exit 0.
2. `pnpm lint` → `Checked … files … No fixes applied.` with zero errors; exit 0.
3. `pnpm -r typecheck` → exit 0.
4. `node scripts/check-boundaries.mjs` → exit 0, no output (providers depends on `@gmt/core` only, reads no `process.env`, and imports msw only under `src/testing/`).
5. `pnpm secret-scan` → `secret scan: clean`.
6. `grep -rnE "process\.env|better-sqlite3|drizzle" packages/providers/src` → no output.
7. `grep -rnwE "LHR|LGW|JFK|EWR|LON|NYC" packages/providers/src` → no output (airports appear only in `fixtures/` and `test/`).
8. `grep -rn "from 'msw" packages/providers/src | grep -v "src/testing/"` → no output.
9. `pnpm --filter "@gmt/providers..." build && node --input-type=module -e "const m = await import('./packages/providers/dist/index.js'); console.log(typeof m.createHttpKit, 'fixtureHandlers' in m)"` → prints `function false` (the production barrel loads without msw).
10. `git check-ignore packages/providers/fixtures/recorded/searchapi/_api_v1_search/2026-10-14-000000000000.raw.json` → prints the path (raw bodies are never committed).

## Open questions

None. The first draft's Q1 (`tileIndex` on `reserve`/`recordCacheHit`) and its noted mismatches (FX ledgering, the fixture-mode transport, msw as a dependency, the per-request timeout, the meaning of `cap: null`, the recorded layout and allowlist hashing) were all settled by spec revision 10 and the plan's "Decisions taken at reconciliation"; this brief follows those decisions.
