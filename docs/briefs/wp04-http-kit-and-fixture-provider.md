---
wp: 4
title: "providers: http-kit, recorder, scrubbing, egress, fixture provider"
owner: opus
depends_on: [0]
spec_sections: ["§4", "§5.2 Errors", "§5.3", "§5.4 (chained steps)", "§5.5", "§9 item 2", "§14"]
reviewers: [code-architect, test-strategy-reviewer, cost-and-budget-reviewer, security-reviewer, provenance-auditor, provider-integration-expert]
mutate: {}
status: merged
---

# WP4 — providers: http-kit, recorder, scrubbing, egress, fixture provider

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Work task by task; every step is a checkbox. Read the spec (`docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`, **revision 12**) and the plan (`docs/superpowers/plans/2026-10-14-flight-price-optimiser-plan.md`, contracts after round 4, decision 17) before Task 4.1. Where this brief and the spec disagree, the spec wins and this brief is the bug: stop and report.

## Goal

Build `@gmt/providers`' HTTP layer — the one path by which any provider reaches the network, fixed by spec §5.3 (cache → dedup → retry { limiter → reserve → fetch → finalise } → cache.set) with egress control, secret scrubbing and the fixture recorder — plus the parameter allowlists, the replay handlers and the synthetic fixture provider that WP7's layer-A engine tests drive through it.

## Scope

**In**

- `createHttpKit` and every type in the plan's "http-kit" contract block (round 3), over `globalThis.fetch`, with the one gated transport seam `HttpKitDeps.inProcessHosts` (spec §5.3 rev 11): requests to `fixture.local` are dispatched in process only when `syntheticAllowed` is true; every other pipeline step still runs. Creating a kit turns off global fetch's own header and body timeouts for its process (`src/http/dispatcher.ts`, spec §5.3 rev 44), so each attempt's per-request timeout is the one bound that ends it.
- The default status → `ProviderError` table (spec §5.2 rev 11) with the adapter hook `classifyError(f: ResponseFacts) => ProviderError | undefined` consulted first; one post-step applies `Retry-After`, the header-less 429 fallback, the over-long-wait → `limiter-timeout` rule and scrubbing to whichever error results.
- Per-request timeout, abort, socket errors, a failed body read after the status line, a 10 MiB body cap, the redirect refusal.
- Per-provider limiter: bottleneck per-hour reservoir chained into a per-minute reservoir that gates execution (`maxConcurrent`; `minTime = ceil(60 000 / ratePerMinute)` as smoothing), the rate guaranteed per fixed window from creation (plan decision 17), the hourly reservoir seeded from `BudgetGuard.recentCalls`; queue deadline `maxWaitSeconds` with a `retryAfterSeconds` to the exhausted window; refunds for abandoned jobs.
- In-flight dedup with ledgered joiners (own `recordCacheHit` row, own signal, re-issue after the leader's abort or another execution's cap) and the response cache path (`recordCacheHit` with `tileIndex`, original `storedAt` as `fetchedAt`, scrubbed bodies, `accept` veto, never a null or empty body, `cache: 'never'`).
- Egress: hostname allowlist per provider, `https:` only (plain `http:` for `fixture.local` only), no explicit port, no userinfo, no credential anywhere in a URL, no credential header on `fx` or `fixture` requests, `redirect: 'error'`.
- `'fx'` requests: limiter, allowlist, timeout, retry and cache as for any provider, but **never ledgered** (no `reserve`, `finalise` or `recordCacheHit`).
- `scrubSecrets` (raw, URL-encoded, form-encoded, JSON-escaped, base64 and base64url forms), `stripUrl`, `canonicalCacheKey` (method + credential-free URL + non-credential headers + body; never `executionId`, `tileIndex` or `providerId`).
- `createRecorder` writing the pinned `RecordedFixture` format (with `session`; `recordedAt` from the `fetchedAt` http-kit passes; fails closed; session-scoped positional token placeholders; credential headers dropped; `.raw.json` beside it), `contentHash`, and the recorded-tree loaders.
- `src/params/allowlist.ts`: `ParamsAllowlist` (keys `<path>` or `<path>?engine=<value>`), `loadParamsAllowlist`, `assertRequestAllowed`.
- The `@gmt/providers/testing` subpath: `fixtureHandlers(root, gate)`, `replayHandlers(recordedRoot, opts?: { session? })` returning `{ handlers, misses() }`, `loadRecorded`, `withContentHash` — the only module tree that imports msw.
- The `@gmt/providers/fixture` subpath: `fixtureRouter(root, gate)` and the scenario-control contract (`POST /__fixture/scenario`, `x-fixture-scenario`, hold and `POST /__fixture/release`), with paged-calendar and chained-verification fixtures for layer-A parity tests.
- The fixture tree under `packages/providers/fixtures/synthetic/fixture/` and `fixtureProvider` with its gate.
- The http-kit and fixture rows of spec §9 item 2, the sentinel-key test over every sink this package writes, and the fixture-tree test.

**Out**

- `SqliteBudgetGuard` (including `recentCalls`), `SqliteResponseCache`, cap predicates, the ledger schema, `billable` computation at finalise: **WP3** (`@gmt/db`). Tests here use the in-memory fakes of Task 4.1, whose `usage` models the spec §5.3 predicate.
- SearchApi and Travelpayouts adapters, `searchApiHttpLimits`/`travelpayoutsHttpLimits` (with `rateLimitFallbackWaitSeconds` 60 for Travelpayouts and none for SearchApi) and their `classifyError` overrides, the `SEARCHAPI_PARAMS`/`TRAVELPAYOUTS_PARAMS` constants: **WP5**, **WP6**.
- Recording real fixtures and the parameter allowlist files, `apps/api/src/wiring.ts` (`httpLimitsFor`, `providersFor`, `syntheticAllowed` and `inProcessHosts: { 'fixture.local': … }` passed only under the gate, the recorder with `recordedBy`), and the wiring assertion that `fixtureHttpLimits` and `fixtureProvider` both take `config.providers.fixture.costMicroGbp`: **WP4b**.
- pino `redact` configuration and its test: **WP4b** (`createLogger`); the fixture-mode boot matrix: **WP8**.
- **The whole-process sentinel-key test** (DB columns, API bodies, emails, pino output with redact): **WP13**. This package's sentinel test covers the sinks it writes: ledger arguments, cache keys and bodies, returned bodies, error messages and fields, recorder output and its own log lines.
- Engine use of the scenario rules (every §8.1 row in both stages): **WP7**; replay of recorded fixtures in layer-B tests: **WP13**.
- Replacing `src/fixture/dates.ts` with core's epoch-day helpers once WP1 has merged: a **WP13** integration-review item (WP4 depends on WP0 only).
- Agreement between `ProviderHttpLimits.billable` (timeout and body-read retryability here) and WP3's finalise billable rule: a **WP13** integration check.
- FX refresh itself (`engine/src/fx/refresh.ts`): **WP7**.
- Keeping msw out of the production image: msw is a runtime dependency of this package (plan decision 7) used only by `./testing`, so **WP12**'s Dockerfile prunes it after `pnpm deploy --prod` (sec-010; the boundary script and DoD 10 already prove the production barrel never loads it).

## Spec sections

- **§5.3 (entire, rev 11)** — the fixed pipeline; the `inProcessHosts` seam gated by `syntheticAllowed`; joiners ledgered and raced against their own signal; the adapter's cache veto; billable rule (`fixture` iff HTTP 200 at the configured test cost); reserve before every attempt; aborted attempts finalise `unknown` before `AbortedError`; every ledger row carries `tile_index`; FX through http-kit, never ledgered; egress allowlist and `redirect: 'error'` with the 302 test; one scrubbing rule for every sink; recorder layout, fail-closed credentials, `search_metadata` URLs stripped, deterministic token placeholders.
- **§4 (`providers` row)** — the fixture provider is served by msw in tests and, in fixture mode, by an in-process router that http-kit dispatches to for that one hostname, a seam gated by `syntheticAllowed`.
- **§5.5 (fixture provider and gates)** — `syntheticAllowed`; the fixture provider's constructor throws when it is false; every fixture price is `synthetic`; the recorder writes only under `fixtures/recorded/` with a content hash and `recordedBy` that the fixture-tree test verifies.
- **§5.2 "Errors" (rev 11)** — 401/403 → `auth`; 402 → `quota`; 400 → `parse` (non-retryable) with the vendor's message in `last_error` (so in `ProviderError.message`, never `reason`); 404 → `upstream` non-retryable; 429 → `rate-limit`, or `quota` only when the adapter's classifier recognises the recorded quota body; a 429 without `Retry-After` waits the provider's fallback (Travelpayouts 60 s) or, with none, is non-retryable with a retry time at the hourly window; other 5xx → `upstream`; malformed → `parse`; socket → `network`; per-request timeout → `network` finalised `unknown`, not retried for billed vendors; limiter deadline → `limiter-timeout`; `signal.aborted` → `AbortedError`; no adapter-level retries. The dated allowlist enumerates parameter names **and values**.
- **§5.4 (rev 12) chained steps** — in a multi-step verification only an `upstream`, `network` or `parse` failure of a step is a failed expansion; `auth`, `quota`, `rate-limit` and `limiter-timeout` propagate unchanged. The fixture provider's chained pair follows it so WP7 and WP5 pin the same outcome.
- **§3 outcome `reason`** — `reason` is the kind or a named normalisation reason; §8.1 writes `reason = error.reason ?? kind`, so http-kit never sets `ProviderError.reason` (diagnostic codes such as `[timeout]` end the message instead); only `no-return-legs` is set, by the fixture provider.
- **§9 item 2 (http-kit, recorder, fixture rows)** — every test listed there that is not adapter-specific, with msw on global fetch.
- **§14 (scrubbing rule)** — no secrets and no full URLs in any log line.

## Interfaces consumed

From `@gmt/core` (WP0), copied from spec §5.1 (rev 11) and the plan's contracts (round 3). `ProviderId`, `SourceKind`, `Cabin`, `PointOfSale` live in `types/provenance.ts`; `CellKey` and `cellKeyString` in `types/definition.ts`; `ports/provider.ts` imports and re-exports them. The `as*` helpers are the only brand mint sites (plan decision 15); this package never writes `as Iata` or `as IsoDate`.

```ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = string | 'unknown';
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export function cellKeyString(c: CellKey): string;        // `${origin}|${destination}|${departureDate}|${returnDate}`
export const providerIdSchema, cabinSchema;               // zod
export const isoDateSchema: z.ZodType<IsoDate, string>; export const isoDateTimeSchema: z.ZodType<IsoDateTime, string>;
export function asIata(s: string): Iata; export function asIsoDate(s: string): IsoDate; export function asIsoDateTime(s: string): IsoDateTime;   // throw on mismatch

export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }
export interface DiscoveryQuery {
  origin: Iata; destination: Iata;
  departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number;
  cabin: Cabin; currency: 'GBP';
  cells?: CellKey[];
}
export interface TilePlan { index: number; coveredCells: CellKey[]; request: TileRequest }
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };
export interface RawCalendarPrice extends CellKey { amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string }
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
  recentCalls(providerId: ProviderId, since: IsoDateTime): number;   // upstream attempts since `since`; http-kit seeds its hourly reservoir from it after a restart
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }

export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };

export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }

// errors.ts: ProviderError, BudgetExceeded, AbortedError, stripUrlsInText; ProviderErrorKind exported.
// new ProviderError({ kind, retryable, message, reason?, httpStatus?, retryAfterSeconds?, providerId? }); new BudgetExceeded({ scope, cap, current, requested, providerId? })

export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export interface SyntheticGateInput { nodeEnv: 'production' | 'development' | 'test'; databasePath: string; allowFixtureProvider: string | null; inContainer: boolean }
export function syntheticAllowed(c: SyntheticGateInput): boolean;
```

## Interfaces produced

The plan's "http-kit" block (round 3) with these exact names; later packages rely on them:

```ts
export interface ResponseFacts { status: number; body: unknown /* scrubbed */; headers: Headers; providerId: ProviderId | 'fx'; endpointPath: string }
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never'; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; rateLimitFallbackWaitSeconds?: number; classifyError?: (f: ResponseFacts) => ProviderError | undefined }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<ProviderId | 'fx', ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[]; syntheticAllowed: boolean; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
export interface HttpKitRequest { providerId: ProviderId | 'fx'; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body?: string; cache: { ttlSeconds: number; accept?: (body: unknown) => boolean } | 'never'; signal: AbortSignal; recordFixtures: boolean }
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
export interface RecordedFixture { recordedAt: IsoDateTime; recordedBy: string; providerId: string; endpointPath: string; request: { method: string; url: string; headers: Record<string, string>; body: string | null }; status: number; body: unknown; placeholders: Record<string, string>; session: string; contentSha256: string }
export interface FixtureRecorder { record(r: { providerId: ProviderId | 'fx'; endpointPath: string; request: HttpKitRequest; status: number; body: unknown; fetchedAt: IsoDateTime }): Promise<string> }
export function createRecorder(opts: { root: string; secrets: Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;
export function contentHash(f: Omit<RecordedFixture, 'contentSha256'>): string;
export function scrubSecrets<T>(value: T, secrets: Secret[]): T;
export function stripUrl(url: string): string;
export function canonicalCacheKey(r: HttpKitRequest, secrets: Secret[]): string;
export interface ParamsAllowlist { provider: ProviderId; recordedAt: IsoDate; endpoints: Record<string /* '<path>' or '<path>?engine=<value>' */, { names: string[]; values: Record<string, string[] | 'any'> }>; contentSha256: string }
export function loadParamsAllowlist(path: string): ParamsAllowlist;
export function assertRequestAllowed(allowlist: ParamsAllowlist, endpointPath: string, url: URL): void;
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: SyntheticGateInput; costMicroGbp: number }): FlightProvider;
// '@gmt/providers/fixture':
export function fixtureRouter(root: string, gate: SyntheticGateInput): Hono;
// '@gmt/providers/testing':
export function fixtureHandlers(root: string, gate: SyntheticGateInput): RequestHandler[];
export function replayHandlers(recordedRoot: string, opts?: { session?: string }): { handlers: RequestHandler[]; misses(): string[] };
export function loadRecorded(root: string, providerId: string, endpointPath: string): RecordedFixture[];
export function withContentHash<T extends object>(file: T): T & { contentSha256: string };   // test and record-tool use only
```

Behaviour this brief settles (no name changes):

- **Construction checks.** `createHttpKit` throws when `inProcessHosts` names any host other than `fixture.local`; when `inProcessHosts` is non-empty or `limits.fixture` is set while `syntheticAllowed` is false; when any non-empty secret is shorter than 8 characters (`MIN_SECRET_LENGTH`, matching `scripts/secret-scan.mjs`); and when `limits.searchapi` or `limits.travelpayouts` is set while no non-empty secret is configured. `fixtureRouter`, `fixtureHandlers` and the fixture server throw unless `syntheticAllowed(gate)`.
- **Classification.** `ResponseFacts.headers` is a `Headers` whose values are scrubbed; `body` is scrubbed. http-kit calls `classifyError(f)` first, falls through to the default table on `undefined`, then applies one post-step to the result: message (and any `reason`) re-scrubbed and URL-stripped; for a retryable error the wait is `Retry-After`, else for a 429 `rateLimitFallbackWaitSeconds`; a wait above `maxWaitSeconds` becomes non-retryable `limiter-timeout` carrying the wait; a retryable 429 with neither becomes non-retryable `rate-limit` with `retryAfterSeconds` = seconds to the limiter's next hourly refresh. The ledger-at-cap arm is gone (plan decision 15): a 429 is `quota` only when `classifyError` says so.
- **Limiter.** The rate is guaranteed per fixed bottleneck window counted from limiter creation; `minTime = ceil(60 000 / ratePerMinute)` only smooths launches; both bottlenecks run a 5 s heartbeat (a refresh lands at most 5 s late). `limiter-timeout` from the queue carries `retryAfterSeconds` = seconds to the next refresh of the exhausted window (hour if the hourly reservoir is empty, else minute); WP7 uses `err.retryAfterSeconds` for `resume_after` from both limiter-timeout sources. Abandoned queued jobs refund their minute and hour tokens.
- **Dedup.** A joiner's response has `fromCache: true` and the leader's `fetchedAt`.
- **Recorder layout.** `<root>/<providerId>/<endpointPath with every / replaced by _>/<yyyy-mm-dd>-<first 12 hex of contentSha256>.json` (`/api/v1/search` → `_api_v1_search`); the unmodified vendor body goes beside it as `.raw.json` (gitignored everywhere by `**/fixtures/recorded/**/*.raw.json`). `session` is the recorder's creation instant plus a random suffix (`20261014T150000000Z-a1b2c3`), the same value every placeholder carries (`<key:n@session>`), so two sessions never share a placeholder or an identity, even when started in the same millisecond (prov-r2-001). `recordedAt` is the `fetchedAt` http-kit passes, the instant the response arrived (prov-r2-003). `placeholders` maps each placeholder used in the file to its token key. `request.headers` drops credential headers entirely and the recorder refuses any other header carrying a secret.
- **Hash wording.** `contentSha256` is **tamper-evidence, not a signature**: it detects a file edited after recording; anyone with the code can compute it for a forged file. `withContentHash` is therefore exported only from `./testing` (tests and WP4b's record tool); it is not in the main barrel.
- **Replay.** Requests match on method, origin, path and decoded query **with placeholders as recorded** — a replayed response hands the adapter `<departure_token:0@…>`, the adapter sends it back, and it equals the recorded value, so nothing needs reversing. Identical requests from one session take the recordings in `recordedAt` order, then the last; a match key served by more than one session is refused at construction unless `opts.session` picks one. **An unmatched request is pushed to `misses()` and answered with `HttpResponse.error()`**: msw 3 passes an unanswered request through to the real network (seen in a scratch run: a live vendor 401), so nothing may fall through; every consumer asserts `misses()` is empty in `afterEach`.
- **Allowlist keys.** `<path>` or `<path>?<name>=<value>` (in practice `engine`); `assertRequestAllowed` uses the discriminated key whose parameter matches the URL, else the bare `<path>` key, and refuses a URL matching none when the path has only discriminated keys. Messages name parameters, never values.
- **Types.** msw 3 exports no documented `RequestHandler`; `src/testing/handlers.ts` defines `type RequestHandler = ReturnType<typeof http.all>`. `fixtureHandlers`'s `gate` is required, as in the plan.

Additional exports, each with its consumer (everything else stays module-internal; tests import by relative path):

```ts
// @gmt/providers (main barrel)
export type HttpProviderId = ProviderId | 'fx';                        // WP4b httpLimitsFor
export const CREDENTIAL_HEADERS: ReadonlySet<string>;                  // WP4b createLogger redact list
export function canonicalJson(v: unknown): string;                     // WP5/WP6 constant-equals-file tests
export class RecorderRefusedError extends Error {}                     // WP4b record tool
export class ParamsNotAllowedError extends Error {}                    // WP5, WP6
export function fixtureHttpLimits(o: { costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number }): ProviderHttpLimits;   // WP4b httpLimitsFor
// @gmt/providers/fixture
export function scenarioRequest(rules: FixtureRule[]): Request;        // WP7
export function releaseRequest(id: string, respond?: FixtureResponse): Request;   // WP7
export type FixtureRule; export type FixtureResponse;                  // WP7
export function defaultFixtureRoot(): string;                          // WP4b, WP7
export const FIXTURE_TILE_DAYS = 7;                                    // WP7 (tile arithmetic in layer-A expectations)
// @gmt/providers/testing
export function replayHandlers(...)                                    // WP5, WP6, WP13
```

## Library notes

All versions from plan Task 0.1. Verified with context7 on 2026-10-14.

- **bottleneck 2.19.5** (`/sgrondin/bottleneck`: README "Reservoir Intervals", "chain()", "Constructor"; `_autodocs/configuration.md` "Job Options"; `_autodocs/api-reference/bottleneck.md` `currentReservoir`/`incrementReservoir`). Used: `new Bottleneck({ maxConcurrent, minTime, reservoir, reservoirRefreshAmount, reservoirRefreshInterval })`, `a.chain(b)` (a job scheduled on `a` must then pass `b`), `schedule(fn)`, `currentReservoir(): Promise<number | null>`, `incrementReservoir(n): Promise<number>` (also re-drains the queue). Also the local-datastore option `heartbeatInterval` (default 250 ms when reservoir intervals are set; set to 5 000 here). Facts relied on, confirmed in a scratch run on 2026-10-14: refresh intervals must be multiples of the heartbeat (60 000 and 3 600 000 are); the reservoir window starts at limiter creation (fixed, not sliding), so the guarantee is per fixed window; `minTime` is the minimum gap between job launches; the job option `expiration` bounds a *running* job, not queue time, so the queue deadline is our own timer; the store yields through `setTimeout(0)`, so under fake timers even `currentReservoir()` must be driven.
- **p-retry 8.0.1** (`/sindresorhus/p-retry`: `_autodocs/types.md`, `_autodocs/configuration.md` "Callback ordering", `_autodocs/api-reference/p-retry.md`). Used: `pRetry(input, { retries, minTimeout, factor, randomize, signal, shouldRetry, onFailedAttempt })`. Facts relied on: `input` gets the 1-based attempt number; callback order `shouldConsumeRetry` → `onFailedAttempt` → `shouldRetry`, and **`onFailedAttempt` runs even when `shouldRetry` will refuse**, so the Retry-After sleep checks retryability and `retriesLeft` itself; `onFailedAttempt` may be async and is awaited; `randomize: true` multiplies each delay by a random factor in [1, 2], so delays are 1–2 s then 2–4 s; a non-network `TypeError` is never retried (http-kit never lets one escape an attempt); with `signal`, abort rethrows the signal's reason, mapped to `AbortedError`. `retries: 2` gives three attempts.
- **msw 3.0.3** (`/websites/mswjs_io`: "Migrations 2.x → 3.x", "Network errors", "Quick start", "Runbook"). Used: `setupServer` from `msw/node`; `http`, `HttpResponse` from `msw/http` (v3 moved them off the root); `HttpResponse.json`, `new HttpResponse(body, init)`, `HttpResponse.error()`; `server.listen({ onUnhandledFrame: 'error' })` (v3 renamed `onUnhandledRequest`); `server.use`, `resetHandlers`, `close`; `server.events.on('request:start', ({ request }) => …)`, `removeAllListeners()`. A resolver may return a plain `Response` (including `Response.error()`). Facts confirmed in a scratch run on 2026-10-14, which shape the tests: msw 3 intercepts at the socket level; a handler that returns `undefined`, a mocked `3xx` (msw follows it itself with the real fetch, whatever the redirect mode), a mocked body stream that errors (the fetch itself rejects), and a socket whose request the client aborts before msw has an answer are all passed to the real network or fail before the body. Hence: replay misses answer `HttpResponse.error()`; the setup file installs an initial catch-all that answers any unmatched request with a network error and records it as a stray, and refuses every DNS lookup in the test process; slow and hanging handlers settle on the client's abort; redirect and body-failure cases run through the in-process seam. msw is a runtime dependency (plan decision 7) imported only under `src/testing/`.
- **hono 4.13.13** (`/honojs/hono/v4.13.0`: `_autodocs/api-reference/hono.md`, `docs/MIGRATION.md`). Used: `new Hono()`, `app.all('*', (c) => …)` returning a `Response`, `c.req.raw`, `app.request(url, init)` and `app.fetch(request)` in tests. WP4b passes `async (req) => router.fetch(req)` as `inProcessHosts['fixture.local']`.
- **vitest 5.0.4** (`/vitest-dev/vitest/v5.0.3`, `docs/api/vi.md`). Used: `vi.useFakeTimers({ toFake })`, `vi.advanceTimersByTimeAsync`, `vi.useRealTimers`. `nextTick` and `queueMicrotask` are never faked by default; this brief also leaves `setImmediate` real and fakes `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `Date`. Workspace packages resolve through the root `vitest.aliases.ts` (`resolve: { alias: gmtAliases(repoRoot) }`), which every package's `vitest.config.ts` on main already uses (plan decision 17); this brief adds only `setupFiles`.
- **undici 7.30.1** (`/nodejs/undici`: "Timeouts", `docs/docs/api/Client.md`, `README.md` "undici.setGlobalDispatcher"; checked 2026-10-26). Used: `new Agent({ headersTimeout: 0, bodyTimeout: 0 })` (`0` turns each off; the defaults are 300 s, and Node's global fetch applies them) and `setGlobalDispatcher`, which stores the dispatcher under the symbols the undici bundled with Node 22 to 26 reads, so global fetch uses it; a dispatcher passed per request must instead speak the bundled undici's own contract (and its type is `undici-types`', not this package's). Its timers fire at about one second's resolution, so the tests' stand-in timeout is 1 s.
- **Node 22 built-ins** (Node docs): `fetch` (undici) with `redirect: 'error'` rejects with a `TypeError` whose `cause` names the redirect; `AbortSignal.any`; `Response.body.getReader()`; `Buffer.toString('base64' | 'base64url')`; `node:crypto` `createHash`; `node:fs` `realpathSync`, `mkdirSync`, `writeFileSync(…, { flag: 'wx' })`; `node:child_process` `execFileSync` (the tree test's `git ls-files`). The per-request timeout uses `setTimeout` + `AbortController` because vitest cannot fake `AbortSignal.timeout`'s internal timer.

## Files

Create (all paths under `packages/providers/`):

- `src/index.ts` (replace WP0's empty barrel), `src/util.ts`
- `src/http/types.ts`, `httpKit.ts`, `attempt.ts`, `classify.ts`, `sleep.ts`, `limiter.ts`, `cacheKey.ts`, `scrub.ts`, `egress.ts`, `recorder.ts`
- `src/params/allowlist.ts`
- `src/fixture/constants.ts`, `dates.ts`, `tree.ts`, `server.ts`, `router.ts`, `provider.ts`, `index.ts` (the `./fixture` subpath)
- `src/testing/index.ts`, `handlers.ts`, `replay.ts` (the only files that import msw)
- `fixtures/synthetic/fixture/calendar/{LHR-JFK,LHR-EWR,LGW-JFK,LGW-EWR}.json`, `fixtures/synthetic/fixture/itinerary/{LHR-JFK,LHR-EWR,LGW-JFK,LGW-EWR}.json`, `fixtures/recorded/.gitkeep`
- Tests: `test/fakes.ts`, `test/support/{msw,setup,time,guards}.ts`, `test/http/{pipeline,scrub,cacheKey,limiter,errors,egress,inProcess,cache,recorder,sentinel}.test.ts`, `test/params/allowlist.test.ts`, `test/fixture/{server,provider,tree}.test.ts`, `test/testing/replay.test.ts`, `test/barrel.test.ts`

Modify: `packages/providers/package.json` (`./fixture` and `./testing` subpaths, each with `@gmt/source` and `default`; msw as a dependency), `packages/providers/vitest.config.ts` (main's file plus `setupFiles`); the repository `.gitignore` (Task 4.7); delete `packages/providers/test/smoke.test.ts` (Task 4.13). `packages/providers/tsconfig.test.json` is WP0's.

The plan's file map lists `src/fixture/router.ts` and `src/testing/index.ts`; this brief adds `src/fixture/server.ts` (the routing core both transports share), `src/fixture/index.ts`, `src/testing/handlers.ts`, `src/testing/replay.ts`, `src/params/allowlist.ts` and the single-responsibility helpers (`attempt.ts`, `sleep.ts`, `types.ts`, `constants.ts`, `dates.ts`, `tree.ts`, `util.ts`).

## Fixture tree and request routing (design for WP7)

**Tree.** `packages/providers/fixtures/synthetic/fixture/` holds one file per worked-example pair in each of two directories, every file carrying `"synthetic": true`:

- `calendar/<O>-<D>.json`: `{ synthetic, currency, baseMinor, weekdayStepMinor, perNightMinor, noFaresNights, noDataNights, pageSize? }`. Prices are a formula, so any window works: `amountMinor = baseMinor + (epochDay(departureDate) mod 7) × weekdayStepMinor + nights × perNightMinor`. A night count in `noFaresNights` is answered as `noFares`; one in `noDataNights` is omitted (the engine sees `no_data`). `pageSize` (set for `LGW-EWR`, 40) splits a tile's answer into pages that the provider fetches under one `tileIndex`.
- `itinerary/<O>-<D>.json`: `{ synthetic, chain?, options: [{ seller, carrier, outbound: { flightNumber, depart, arrive, arriveDayOffset }, inbound: {…}, priceDeltaMinor, cabinBagIncluded, checkedBags }] }`. Each offer's price is the calendar price for its cell plus `priceDeltaMinor`; times are local wall-clock templates placed on the cell's dates. `chain: true` (set for `LGW-JFK`) makes verification a three-step chain like SearchApi's. Carriers `ZZ` and `ZX` are synthetic designators. No offer ever carries a booking link.

**Transports.** One routing core (`src/fixture/server.ts`) answers in two places: msw's `fixtureHandlers(root, gate)` on global fetch (unit, provider and WP7 layer-A tests) and `fixtureRouter(root, gate)` reached through `HttpKitDeps.inProcessHosts['fixture.local']` (fixture mode, wired by WP4b). Each handler set or router holds its own scenario and hold state, so a test sends control requests to the instance its kit uses: `fetch(scenarioRequest(rules))` under msw, `router.fetch(scenarioRequest(rules))` in process.

**Routes** (`http://fixture.local`):

| Request | Meaning |
|---|---|
| `GET /calendar?origin&destination&departFrom&departTo&returnFrom&returnTo&cabin&currency[&page]` | one discovery tile (a `rectangle`): every `(dep, ret)` in it with 0 ≤ nights ≤ 90, so entries outside the tile's band come back and the adapter drops them (`dropped-out-of-band:n`). Answers carry `page` and `pages` (1 and 1 unless the pair has `pageSize`). Unknown pair → 404; missing or malformed parameter, a rectangle over 400 days, or a page out of range → 400 |
| `GET /itinerary?origin&destination&departureDate&returnDate&cabin&currency&expandTop` | verification step 1. A plain pair answers `{ chain: false, outboundOptions, failedExpansions, offers }`; a chained pair answers `{ chain: true, outboundOptions, outbounds: ['o0', 'o1', …], offers: [] }` |
| `GET /itinerary/return?<same>&outbound=o<i>` | chained step 2: the airline-direct offer for that outbound |
| `GET /itinerary/booking?<same>&outbound=o<i>` | chained step 3: an agency offer for the same itinerary, 300 minor units cheaper |
| `GET /health` | `{ synthetic: true, ok: true }` |
| `POST /__fixture/scenario` body `{ rules: FixtureRule[] }` | replaces the scenario rules; `DELETE` clears them; invalid rules → 400 |
| `POST /__fixture/release` body `{ id, respond? }` | settles every request held under `id` with `respond` (default the normal response); answers `{ synthetic: true, released: n }` |

**Scenario rules.** `FixtureRule = { match: { path?, params? }, respond: FixtureResponse, times? }`, validated on arrival (unknown kind, unknown path, non-string param, status outside 200–599, a header other than `retry-after`/`content-type`, or a non-positive `times` → 400). For each request the first rule whose `path` equals the request path and whose `params` all equal the query values, with `times` remaining (default unlimited), answers it and decrements `times`; otherwise the normal response. A single request may instead carry `x-fixture-scenario: <FixtureResponse JSON>` (direct tests only; invalid → 400). `FixtureResponse` kinds: `normal`, `status` (status 200–599, optional body and headers), `malformed`, `network`, `hang`, `hold` (`id`), `empty`, `no-fares`, `no-currency`, `no-return-legs`, `partial` (`failedExpansions`), `variant` (`currency`, `carrier`, `connectVia`, `scope`), `cacheable` (the normal response marked `cacheable: true`, which the provider's cache `accept` admits).

**Which rule drives which spec §8.1 / §9 item 4 row** (WP7 uses these; `times` counts http-kit attempts, three per call):

| Row | Rule (`respond`, with `match.path` `/calendar`, `/itinerary`, `/itinerary/return` or `/itinerary/booking`; narrow with `params`, e.g. `{ departFrom: '2026-11-09' }` for one tile) |
|---|---|
| rate-limit after retries | `{ kind: 'status', status: 429, headers: { 'retry-after': '1' } }`, `times: 3` (a header-less 429 on the fixture provider, which has no fallback, is non-retryable at once) |
| upstream after retries | `{ kind: 'status', status: 503 }`, `times: 3` |
| network after retries | `{ kind: 'network' }`, `times: 3` |
| parse (and "2 consecutive parse disables the provider") | `{ kind: 'malformed' }` or `{ kind: 'status', status: 400, body: { error: 'synthetic bad request' } }`; `times: 2` across two tiles |
| auth on any call (including a chained step) | `{ kind: 'status', status: 401 }`; on `/itinerary/return` or `/itinerary/booking` of the chained pair it propagates unchanged and stops the chain (spec §5.4 rev 12) |
| quota on any call (including a chained step) | `{ kind: 'status', status: 402 }` (the fixture provider has no quota-body classifier, so a 429 is never quota); propagates from a chained step like auth |
| upstream `no-return-legs` | `{ kind: 'no-return-legs' }` on `/itinerary` (plain pair), or every `/itinerary/return` failing on the chained pair |
| `limiter-timeout` | `{ kind: 'status', status: 429, headers: { 'retry-after': '7200' } }` (beyond `MAX_WAIT_SECONDS` 3900); `resume_after` = now + `err.retryAfterSeconds` for this and the queue-deadline source |
| `BudgetExceeded` (any scope), incl. mid-chain | not a server response: set the cap in the real `BudgetGuard` (WP3); on the chained pair (`LGW-JFK`) a cap of 2 calls stops the chain after step 2 of the first outbound |
| `AbortedError` (cancel / SIGTERM) | `{ kind: 'hang' }`, then cancel or abort |
| concurrency 4 with 1 call left → 1 billable call; stopping breach aborts siblings → `not_run`; SIGTERM mid-tile | `{ kind: 'hold', id: 'h1' }` on the tiles, act, then `releaseRequest('h1')` |
| `fx-unavailable` | `{ kind: 'variant', currency: 'USD' }` with no USD rate in the FX repository |
| `currency-unsupported` | `{ kind: 'variant', currency: 'XTS' }` (ISO 4217 test code) |
| `unknown-airport-tz` | `{ kind: 'variant', connectVia: '<a code absent from the test airports table>' }` on `/itinerary` |
| unmappable carrier, `offers-dropped:n` | `{ kind: 'variant', carrier: 'Z!' }` (first offer → `offers-dropped:1`); `scope: 'all-offers'` → `error` |
| tile-error marks exactly its cells | any error rule narrowed by `params.departFrom` |
| `empty`, `no_data`, `noFares` | `{ kind: 'empty' }` (`/itinerary` → `empty`; `/calendar` → every covered cell `no_data`), `{ kind: 'no-fares' }` |
| `partial-expansion` | `{ kind: 'partial', failedExpansions: 1 }` on a plain pair, or `{ kind: 'status', status: 503 }`, `times: 3`, with `params: { outbound: 'o1' }` on `/itinerary/return` of the chained pair |
| parity over a multi-row tile | the paged pair `LGW-EWR`: one tile = several ledger rows under one `tileIndex` |
| parity with cache-hit rows | `{ kind: 'cacheable' }` on `/calendar` (`times: 1`), then the same tile again: one upstream row, one cache-hit row |

## Tasks

Single-file test runs skip coverage (the package `test` script enforces thresholds, which a partial run would fail): `pnpm --filter @gmt/providers exec vitest run <file>`. Vitest resolves workspace packages from source through the root `vitest.aliases.ts` that main's `vitest.config.ts` already uses, and tsc through `customConditions` and the `@gmt/source` export condition, so no build step precedes a test run. Every task ends with `pnpm --filter @gmt/providers typecheck` (both `tsconfig.json` and `tsconfig.test.json`). The final state of every file in this brief was assembled and run on 2026-10-14 against main (`5a0b72f`): 223 tests passed in four consecutive runs, typecheck, lint, the boundary script and the build were clean, and coverage was 92.2% lines, 86.6% branches. No `as` cast appears in `src/` or `test/` except `as const` and `satisfies` (plan decision 15); parsed JSON is narrowed with guards, brands come from core's `as*` helpers.

### Task 4.1: Reserve happens before fetch on every attempt (first failing test)

**Files:**
- Modify: `packages/providers/package.json`, `packages/providers/vitest.config.ts`
- Create: `src/util.ts`, `src/http/types.ts`, `src/http/classify.ts` (first version), `src/http/attempt.ts` (first version), `src/http/httpKit.ts` (first version); `test/support/msw.ts`, `test/support/setup.ts`, `test/support/time.ts`, `test/support/guards.ts`, `test/fakes.ts`
- Test: `test/http/pipeline.test.ts`

**Interfaces:**
- Consumes: `BudgetGuard` (with `recentCalls`), `Reservation`, `ResponseCache`, `Logger`, `fixedClock`, `Secret`, `ProviderError`, `BudgetExceeded` (WP0).
- Produces: every type of the http-kit contract block (`src/http/types.ts`); `createHttpKit` (retry + reserve + fetch + finalise only); `MAX_ATTEMPTS`, `BACKOFF_BASE_MS`; the test fakes.

- [ ] **Step 1: Package wiring**

`packages/providers/package.json`:

```json
{
  "name": "@gmt/providers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "@gmt/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./fixture": {
      "@gmt/source": "./src/fixture/index.ts",
      "types": "./dist/fixture/index.d.ts",
      "default": "./dist/fixture/index.js"
    },
    "./testing": {
      "@gmt/source": "./src/testing/index.ts",
      "types": "./dist/testing/index.d.ts",
      "default": "./dist/testing/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json",
    "test": "vitest run --coverage"
  },
  "dependencies": {
    "@gmt/core": "workspace:*",
    "bottleneck": "2.19.5",
    "hono": "4.13.13",
    "msw": "3.0.3",
    "p-retry": "8.0.1",
    "zod": "4.6.7"
  }
}
```

`// why:` msw is a runtime dependency (plan decision 7) because the `./testing` subpath imports it and other packages' tests consume that subpath; production code never imports `./testing`, and WP0's boundary script rejects any msw import outside `packages/providers/src/testing/`. `./fixture` holds the gated fixture router so the main barrel carries no fixture server.

`packages/providers/vitest.config.ts` (main's file, which already resolves workspace packages through the root `vitest.aliases.ts`; this brief adds only `setupFiles` and drops the duplicated `include` entry):

```ts
import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'providers',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
```

`test/support/msw.ts`:

```ts
import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';

/** Requests no test handler answered; test/support/setup.ts fails the test that leaves any. */
export const strays: string[] = [];

/**
 * The package's single msw server on global fetch (spec §9 item 2). Tests add handlers with `server.use`.
 * why: the initial catch-all answers anything unmatched with a network error, so no test can ever reach the real
 * network, whatever msw does with an unanswered request (arch-r2-001); the request is recorded as a stray.
 */
export const server = setupServer(
  http.all('*', ({ request }) => {
    strays.push(`${request.method} ${new URL(request.url).origin}${new URL(request.url).pathname}`);
    return HttpResponse.error();
  }),
);

/**
 * A response that never comes until the client aborts, then a network error.
 * why: msw 3 passes a request whose handler is still pending when the client aborts through to the real network;
 * settling on abort keeps every "hang" scenario inside the process (seen in a scratch run, arch-r2-001).
 */
export function hangUntilAborted(request: Request): Promise<Response> {
  return new Promise<Response>((resolve) => {
    if (request.signal.aborted) resolve(HttpResponse.error());
    request.signal.addEventListener('abort', () => resolve(HttpResponse.error()), { once: true });
  });
}

/** Answers with `make()` after `ms`, or with a network error as soon as the client aborts (same reason as above). */
export function respondAfter(request: Request, ms: number, make: () => Response): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const timer = setTimeout(() => resolve(make()), ms);
    request.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve(HttpResponse.error());
      },
      { once: true },
    );
  });
}
```

`test/support/setup.ts`:

```ts
import dns from 'node:dns';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { liveBudgets } from '../fakes.js';
import { server, strays } from './msw.js';

// why: msw 3 intercepts at the socket level and passes a socket through to the real network when the client aborts
// before msw has an answer (seen in a scratch run: a TLS handshake with the real vendor). Refusing every DNS lookup
// in this process means such a socket fails locally; no test ever reaches the network.
const refuseLookup = (hostname: string, ...rest: unknown[]): void => {
  const callback = rest.find((x) => typeof x === 'function');
  const error = Object.assign(new Error(`tests make no DNS lookups (${hostname})`), { code: 'ENOTFOUND' });
  if (typeof callback === 'function') process.nextTick(() => callback(error));
};
Object.defineProperty(dns, 'lookup', { value: refuseLookup, writable: true, configurable: true });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  // why: every reservation is finalised exactly once on every path (spec §5.3); a leak here is a budget bug.
  for (const budget of liveBudgets.splice(0)) expect(budget.open(), 'open reservations').toEqual([]);
  // why: a request no test handler answered was caught by the catch-all in msw.ts; it is a test bug, never a pass.
  expect(strays.splice(0), 'requests no handler answered').toEqual([]);
  server.resetHandlers();
  server.events.removeAllListeners();
});
afterAll(() => server.close());
```

`test/support/time.ts`:

```ts
import { vi } from 'vitest';

/** Fakes the timers http-kit, p-retry and bottleneck use; setImmediate, nextTick and queueMicrotask stay real. */
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
export async function driveError(
  p: Promise<unknown>,
  opts?: { stepMs?: number; maxMs?: number },
): Promise<unknown> {
  try {
    await drive(p, opts);
  } catch (e) {
    return e;
  }
  throw new Error('expected the request to fail');
}

/** Advances fake time by `ms` with real macrotask turns in between (for "nothing else happens later" checks). */
export async function idle(ms: number, stepMs = 1000): Promise<void> {
  for (let t = 0; t < ms; t += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
```

`test/support/guards.ts`:

```ts
import { ProviderError } from '@gmt/core';
import { isRecord } from '../../src/util.js';

/** Narrowing helpers so tests never cast parsed JSON (plan decision 15). */
export function obj(v: unknown): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`expected an object, got ${JSON.stringify(v)}`);
  return v;
}
export function arr(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error(`expected an array, got ${JSON.stringify(v)}`);
  return v;
}
export function str(v: unknown): string {
  if (typeof v !== 'string') throw new Error(`expected a string, got ${JSON.stringify(v)}`);
  return v;
}
export function asProviderError(v: unknown): ProviderError {
  if (!(v instanceof ProviderError)) throw new Error(`expected a ProviderError, got ${String(v)}`);
  return v;
}
export async function jsonOf(res: Response): Promise<unknown> {
  const v: unknown = await res.json();
  return v;
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
    };
    this.rows.push(row);
    this.events.push({ type: 'reserve', at: Date.now(), ...p });
    return {
      id: row.id,
      finalise: (r) => {
        if (row.outcome !== 'pending') throw new Error(`reservation ${row.id} finalised twice`);
        row.outcome = r.outcome;
        row.httpStatus = r.httpStatus;
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
    return { calls: rows.length, costMicroGbp: 0, cap, ...window };
  }

  recentCalls(providerId: ProviderId, since: IsoDateTime): number {
    // why: tests seed the count directly and assert the window through recentSince (WP3 filters started_at >= since).
    this.recentSince.push(since);
    return this.recent.get(providerId) ?? 0;
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
};
export const ALL_SECRETS: Secret[] = [
  SENTINELS.searchapi,
  SENTINELS.travelpayouts,
  SENTINELS.smtp,
  SENTINELS.basicAuth,
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
```

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
    const v: unknown = JSON.parse(text);
    return v;
  } catch {
    return text;
  }
}

/** Orders [name, value] pairs by name, then value (canonical query order for cache keys and replay). */
export function byPair(a: readonly [string, string], b: readonly [string, string]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

/** The `code` of a Node system error, without casting. */
export function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}
```

- [ ] **Step 2: Write the failing test**

`test/http/pipeline.test.ts`:

```ts
import { HttpResponse, http } from 'msw/http';
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
        return n === 1
          ? HttpResponse.json({ error: 'busy' }, { status: 503 })
          : HttpResponse.json({ ok: true });
      }),
    );

    const res = await drive(kit.request(req({ url: `${SEARCH}?engine=google_flights_calendar` })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.fromCache).toBe(false);
    expect(budget.sequence()).toEqual([
      'reserve',
      'fetch',
      'finalise:error',
      'reserve',
      'fetch',
      'finalise:ok',
    ]);
    const reserves = budget.events.flatMap((e) => (e.type === 'reserve' ? [e] : []));
    expect(reserves.map((e) => e.httpAttempt)).toEqual([1, 2]);
    expect(reserves.every((e) => e.endpointPath === '/api/v1/search' && e.tileIndex === 0)).toBe(true);
    const finals = budget.events.flatMap((e) => (e.type === 'finalise' ? [e] : []));
    expect(finals.map((e) => e.httpStatus)).toEqual([503, 200]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/pipeline.test.ts`
Expected: FAIL — `Failed to load url ../src/http/httpKit.js` (imported by `test/fakes.ts`).

- [ ] **Step 4: Implement**

`src/http/types.ts` (final; later tasks do not change it):

```ts
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

/** Every id http-kit serves: the three providers plus the never-ledgered FX refresh (spec §4, §5.3). */
export type HttpProviderId = ProviderId | 'fx';

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
  }): Promise<string>;
}
```

`src/http/classify.ts` (first version; Task 4.4 replaces it):

```ts
import { ProviderError } from '@gmt/core';
import type { ResponseFacts } from './types.js';

/** Minimal classification: 5xx is retryable upstream, anything else non-retryable upstream. Spec §5.2. */
export function classifyResponse(f: ResponseFacts): ProviderError {
  return new ProviderError({
    kind: 'upstream',
    retryable: f.status >= 500,
    httpStatus: f.status,
    providerId: f.providerId,
    message: `${f.providerId} ${f.endpointPath}: HTTP ${f.status}`,
  });
}
```

`src/http/attempt.ts` (first version; Task 4.4 replaces it):

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

/** Per-attempt inputs from the retry loop. */
export interface AttemptContext {
  attempt: number;
}

/**
 * One attempt of spec §5.3's retry body: budget.reserve → fetch → reservation.finalise. Reserve runs before
 * the request leaves the process on every attempt, so a refused cap means no upstream call.
 */
export async function runAttempt(deps: HttpKitDeps, r: HttpKitRequest, limits: ProviderHttpLimits, ctx: AttemptContext): Promise<AttemptResult> {
  // why: 'fx' is not a ProviderId in the BudgetGuard port and spec §5.6 says FX calls are never ledgered.
  const reservation: Reservation | null =
    r.providerId === 'fx'
      ? null
      : deps.budget.reserve({
          providerId: r.providerId,
          executionId: r.executionId,
          tileIndex: r.tileIndex,
          costMicroGbp: limits.costPerCallMicroGbp,
          httpAttempt: ctx.attempt,
          endpointPath: r.endpointPath,
        });
  const started = Date.now();
  const res = await fetch(r.url, { method: r.method, headers: r.headers, ...(r.body === undefined ? {} : { body: r.body }), redirect: 'error' });
  const text = await res.text();
  const ok = res.status >= 200 && res.status < 300;
  reservation?.finalise({ outcome: ok ? 'ok' : 'error', httpStatus: res.status, durationMs: Date.now() - started });
  const body: unknown = text === '' ? null : JSON.parse(text);
  if (!ok) throw classifyResponse({ status: res.status, body, headers: res.headers, providerId: r.providerId, endpointPath: r.endpointPath });
  return { status: res.status, body, fetchedAt: deps.clock.now() };
}
```

`src/http/httpKit.ts` (first version; Tasks 4.3, 4.4 and 4.6 replace it, Task 4.5 edits it):

```ts
import { ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { runAttempt } from './attempt.js';
import type { HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse } from './types.js';

export type { FixtureRecorder, HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse, HttpProviderId, ProviderHttpLimits, ResponseFacts } from './types.js';

/** Spec §5.3: p-retry, max 3 attempts. */
export const MAX_ATTEMPTS = 3;
/** Exponential backoff base: 1–2 s before attempt 2, 2–4 s before attempt 3 (randomised). */
export const BACKOFF_BASE_MS = 1000;

/** Only a ProviderError marked retryable is retried; auth, quota, parse and BudgetExceeded never are. */
export function isRetryable(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.retryable;
}

/** Spec §5.3 http-kit over globalThis.fetch; the gated in-process seam for fixture.local arrives in Task 4.5. */
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  let inFlight = 0;
  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    const limits = deps.limits[r.providerId];
    if (limits === undefined) {
      throw new ProviderError({ kind: 'upstream', retryable: false, providerId: r.providerId, message: `${r.providerId}: no HTTP limits configured [egress-denied]` });
    }
    inFlight += 1;
    try {
      const result = await pRetry((attempt) => runAttempt(deps, r, limits, { attempt }), {
        retries: MAX_ATTEMPTS - 1,
        minTimeout: BACKOFF_BASE_MS,
        factor: 2,
        // why: jitter keeps tiles that failed together from retrying in lockstep; tests assert ranges.
        randomize: true,
        shouldRetry: ({ error }) => isRetryable(error),
      });
      return { ...result, fromCache: false, cacheKey: '' };
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

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 6: Commit**

```bash
git add packages/providers && git commit -m "wp04: http-kit reserves before fetch on every attempt (spec §5.3)"
```

### Task 4.2: `stripUrl`, `scrubSecrets`, `canonicalCacheKey`

**Files:**
- Create: `src/http/scrub.ts`, `src/http/cacheKey.ts`
- Test: `test/http/scrub.test.ts`, `test/http/cacheKey.test.ts`

**Interfaces:**
- Produces: `stripUrl`, `scrubSecrets`, `containsSecret`, `secretForms`, `canonicalCacheKey`, `CREDENTIAL_HEADERS`.

- [ ] **Step 1: Write the failing tests**

`test/http/scrub.test.ts`:

```ts
import { Secret } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { containsSecret, scrubSecrets, secretForms, stripUrl } from '../../src/http/scrub.js';

const key = new Secret('test-searchapi-key-0123456789abcdef');
const odd = new Secret('p@ss/word+0123456789 "q"\\');

describe('stripUrl (spec §5.3: origin + path only)', () => {
  it('drops query, fragment and userinfo', () => {
    expect(stripUrl('https://user:pw@www.searchapi.io/api/v1/search?api_key=x&engine=y#frag')).toBe(
      'https://www.searchapi.io/api/v1/search',
    );
  });
  it('keeps a non-default port', () =>
    expect(stripUrl('http://fixture.local:8080/calendar?a=1')).toBe('http://fixture.local:8080/calendar'));
  it('returns <url> for anything unparseable', () => expect(stripUrl('not a url')).toBe('<url>'));
});

describe('secret forms (sec-002)', () => {
  const v = odd.reveal();
  const b64 = Buffer.from(v, 'utf8').toString('base64');
  it.each([
    ['raw', v],
    ['URL-encoded', encodeURIComponent(v)],
    ['form-encoded', new URLSearchParams({ v }).toString().slice(2)],
    ['JSON-escaped', JSON.stringify(v).slice(1, -1)],
    ['base64', b64],
    ['base64 without padding', b64.replace(/=+$/, '')],
    ['base64url', Buffer.from(v, 'utf8').toString('base64url')],
  ])('%s form is detected and scrubbed', (_label, form) => {
    expect(secretForms(v)).toContain(form);
    expect(containsSecret(`prefix ${form} suffix`, [odd])).toBe(true);
    expect(scrubSecrets(`prefix ${form} suffix`, [odd])).toBe('prefix [redacted] suffix');
  });
});

describe('scrubSecrets (deep, keys included)', () => {
  it('replaces secrets anywhere in a structure, object keys included', () => {
    const value = {
      a: `Invalid API key ${key.reveal()}`,
      list: [`x${encodeURIComponent(odd.reveal())}y`, 3, null, true],
      [key.reveal()]: { nested: odd.reveal() },
    };
    const out = scrubSecrets(value, [key, odd]);
    const text = JSON.stringify(out);
    expect(containsSecret(text, [key, odd])).toBe(false);
    expect(out).toEqual({
      a: 'Invalid API key [redacted]',
      list: ['x[redacted]y', 3, null, true],
      '[redacted]': { nested: '[redacted]' },
    });
  });
  it('leaves values without secrets unchanged', () => {
    expect(scrubSecrets({ n: 1, s: 'plain' }, [key])).toEqual({ n: 1, s: 'plain' });
  });
  it('ignores an empty secret instead of redacting everything', () => {
    expect(scrubSecrets('abc', [new Secret('')])).toBe('abc');
    expect(secretForms('')).toEqual([]);
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
    const a = canonicalCacheKey(
      req({ url, headers: { authorization: `Bearer ${SENTINELS.searchapi.reveal()}` } }),
      ALL_SECRETS,
    );
    const b = canonicalCacheKey(
      req({ url, headers: { authorization: 'Bearer another-key-entirely' } }),
      ALL_SECRETS,
    );
    const c = canonicalCacheKey(
      req({ url, headers: { 'X-Access-Token': SENTINELS.travelpayouts.reveal() } }),
      ALL_SECRETS,
    );
    expect([b, c]).toEqual([a, a]);
  });
  it('is independent of query parameter order', () => {
    const reordered = `${SEARCH}?arrival_id=JFK&engine=google_flights&departure_id=LHR`;
    expect(canonicalCacheKey(req({ url }), ALL_SECRETS)).toBe(
      canonicalCacheKey(req({ url: reordered }), ALL_SECRETS),
    );
  });
  it('changes with any parameter value, the host, the method or the body', () => {
    const base = canonicalCacheKey(req({ url }), ALL_SECRETS);
    expect(canonicalCacheKey(req({ url: url.replace('JFK', 'EWR') }), ALL_SECRETS)).not.toBe(base);
    expect(
      canonicalCacheKey(req({ url: url.replace('www.searchapi.io', 'api.travelpayouts.com') }), ALL_SECRETS),
    ).not.toBe(base);
    expect(canonicalCacheKey(req({ url, method: 'POST' }), ALL_SECRETS)).not.toBe(base);
    expect(canonicalCacheKey(req({ url, body: '{"a":1}' }), ALL_SECRETS)).not.toBe(base);
  });
  it('never includes executionId, tileIndex or providerId, so sibling pairs share a cached metro response (plan decision 14)', () => {
    const base = canonicalCacheKey(req({ url, executionId: 'exec-1', tileIndex: 0 }), ALL_SECRETS);
    expect(canonicalCacheKey(req({ url, executionId: 'exec-2', tileIndex: 7 }), ALL_SECRETS)).toBe(base);
    expect(canonicalCacheKey(req({ url, executionId: null, tileIndex: null }), ALL_SECRETS)).toBe(base);
    expect(canonicalCacheKey(req({ url, providerId: 'travelpayouts' }), ALL_SECRETS)).toBe(base);
  });
  it('drops a parameter whose value is a secret, so the key matches the credential-free request', () => {
    const leaky = `${url}&api_key=${SENTINELS.searchapi.reveal()}`;
    expect(canonicalCacheKey(req({ url: leaky }), ALL_SECRETS)).toBe(
      canonicalCacheKey(req({ url }), ALL_SECRETS),
    );
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

/**
 * Every textual form in which a secret can reach a sink (spec §5.3 "base64 and URL-encoded forms where feasible"):
 * raw, encodeURIComponent, URLSearchParams form-encoding, JSON string escaping, base64 (padded and not) and base64url.
 */
export function secretForms(value: string): string[] {
  if (value === '') return [];
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return [
    value,
    encodeURIComponent(value),
    new URLSearchParams({ v: value }).toString().slice(2),
    JSON.stringify(value).slice(1, -1),
    b64,
    b64.replace(/=+$/, ''),
    Buffer.from(value, 'utf8').toString('base64url'),
  ];
}

function formsOf(secrets: readonly Secret[]): string[] {
  const out = new Set<string>();
  for (const s of secrets) for (const f of secretForms(s.reveal())) out.add(f);
  // why: longest first, so a form that contains another is replaced whole.
  return [...out].sort((a, b) => b.length - a.length);
}

/** True when any secret, in any of its forms, occurs in `text`. */
export function containsSecret(text: string, secrets: readonly Secret[]): boolean {
  return formsOf(secrets).some((f) => text.includes(f));
}

/**
 * Deep copy of `value` with every secret occurrence (any form, in values and object keys) replaced by
 * `[redacted]`. Throws if a secret is still present afterwards. Spec §5.3: cache bodies, error messages and
 * returned bodies are scrubbed before any sink sees them.
 */
export function scrubSecrets<T>(value: T, secrets: readonly Secret[]): T;
// why: the implementation signature is wider so the structural copy needs no cast; the copy has the input's shape.
export function scrubSecrets(value: unknown, secrets: readonly Secret[]): unknown {
  const forms = formsOf(secrets);
  if (forms.length === 0) return value;
  const text = (s: string): string => forms.reduce((acc, f) => acc.split(f).join(REDACTED), s);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), walk(x)]));
    return v;
  };
  const out = walk(value);
  const serialised = typeof out === 'string' ? out : (JSON.stringify(out) ?? '');
  if (containsSecret(serialised, secrets)) throw new Error('scrubSecrets: a secret survived scrubbing');
  return out;
}
```

`src/http/cacheKey.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Secret } from '@gmt/core';
import { byPair } from '../util.js';
import { containsSecret, scrubSecrets } from './scrub.js';
import type { HttpKitRequest } from './types.js';

/** Header names that carry credentials for any vendor this app talks to; never in a cache key or a recording. */
export const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'x-access-token',
  'x-api-key',
  'cookie',
]);

/**
 * Cache key = sha256 hex over method + credential-free URL (origin, path, sorted query pairs without any
 * secret-bearing pair) + sorted non-credential headers + the body with secrets redacted — nothing else
 * (plan http-kit block). Never `executionId`, `tileIndex` or `providerId`.
 * why: Travelpayouts sibling pairs that share a metro code issue identical requests from different tiles and
 * executions and must share the cached response (plan decision 14, spec §5.2).
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
Expected: PASS, 20 tests.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: stripUrl, scrubSecrets over every encoded form, credential-free cache key (spec §5.3)"
```

### Task 4.3: Limiter — hourly reservoir chained into a per-minute gate, seeding, queue deadline, refunds

**Files:**
- Create: `src/http/limiter.ts`
- Replace: `src/http/httpKit.ts` (second version)
- Test: `test/http/limiter.test.ts`

**Interfaces:**
- Consumes: bottleneck 2.19.5; `BudgetGuard.recentCalls` (WP0 port, WP3 implementation).
- Produces: `createLimiter(limits, { usedThisHour }): ProviderLimiter` with `run`, `secondsToHourRefresh`, `reservoirs`; `MINUTE_MS`, `HOUR_MS`.

Design (spec §5.3 "chained per-minute + per-hour reservoirs, maxConcurrent; queue age ≤ MAX_WAIT_SECONDS and !signal.aborted checked before reserve"): a job is admitted by the per-hour bottleneck and then executed by the per-minute bottleneck, which carries `maxConcurrent` and `minTime = ceil(60 000 / ratePerMinute)` as smoothing; the rate is guaranteed per fixed bottleneck window counted from creation (plan decision 17), and the tests assert exactly that, with an explicit 60 s timeout for the hour-scale cases. The hourly reservoir starts at `ratePerHour − recentCalls(provider, now − 1 h)` so a restart inside an hour does not grant a fresh hour (`fx` starts full: it is not ledgered). Both windows are fixed from limiter creation (bottleneck semantics); SearchApi's own hourly window semantics are unpublished, so the seeding plus the header-less-429 rule of Task 4.4 bound the overshoot.

- [ ] **Step 1: Write the failing test**

`test/http/limiter.test.ts`:

```ts
import { AbortedError } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLimiter } from '../../src/http/limiter.js';
import { FakeBudget, makeKit, req, SEARCH, TP, testLimits } from '../fakes.js';
import { asProviderError } from '../support/guards.js';
import { respondAfter, server } from '../support/msw.js';
import { drive, driveError, idle, useFakeTime } from '../support/time.js';

const ok = () => server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
const fetchTimes = (events: ReturnType<typeof makeKit>['events'], t0: number) =>
  events.flatMap((e) => (e.type === 'fetch' ? [e.at - t0] : [])).sort((a, b) => a - b);
// why: distinct query values so in-flight dedup (Task 4.6) never merges these requests.
const nth = (i: number) => req({ url: `${SEARCH}?n=${i}` });
// why: bottleneck guarantees the rate per fixed window counted from limiter creation (plan decision 17); minTime only smooths.
const maxPerFixedMinute = (times: number[]) =>
  Math.max(
    ...[...new Set(times.map((t) => Math.floor(t / 60_000)))].map(
      (w) => times.filter((t) => Math.floor(t / 60_000) === w).length,
    ),
  );
const HOURS = { stepMs: 30_000, maxMs: 8_000_000 };

// why: the hour-scale cases advance fake time over two hours; the default 5 s test timeout is too short.
describe('limiter (spec §5.3)', { timeout: 60_000 }, () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('maxConcurrent 1 runs one request at a time', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { concurrency: 1 } } });
    server.use(
      http.get(SEARCH, ({ request }) => respondAfter(request, 10_000, () => HttpResponse.json({ ok: true }))),
    );
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2))]));
    expect(fetchTimes(events, t0)[1] ?? 0).toBeGreaterThanOrEqual(10_000);
  });

  it('a per-minute reservoir of 2 allows at most 2 fetches per fixed minute window and holds the third until the minute refreshes', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 2 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2)), kit.request(nth(3))]));
    const at = fetchTimes(events, t0);
    expect(at[2] ?? 0).toBeGreaterThanOrEqual(59_000);
    expect(maxPerFixedMinute(at)).toBeLessThanOrEqual(2);
  });

  it('the hourly reservoir holds a request even when the minute has room', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 10, ratePerHour: 2 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2)), kit.request(nth(3))]), HOURS);
    expect(fetchTimes(events, t0)[2] ?? 0).toBeGreaterThanOrEqual(3_590_000);
  });

  it('no fixed minute window, before or after an hourly refill, holds more than ratePerMinute fetches (cost-005)', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 2, ratePerHour: 3 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([1, 2, 3, 4, 5, 6].map((i) => kit.request(nth(i)))), HOURS);
    const at = fetchTimes(events, t0);
    expect(at).toHaveLength(6);
    expect(maxPerFixedMinute(at)).toBeLessThanOrEqual(2);
  });

  it('seeds the hourly reservoir from recentCalls, so a restart does not grant a fresh hour (ruling 9)', async () => {
    const budget = new FakeBudget([]);
    budget.recent.set('searchapi', 1);
    const { kit, events } = makeKit({ budget, overrides: { searchapi: { ratePerHour: 2 } } });
    ok();
    const t0 = Date.now();
    await drive(Promise.all([kit.request(nth(1)), kit.request(nth(2))]), HOURS);
    const at = fetchTimes(events, t0);
    expect(new Set(budget.recentSince)).toEqual(new Set(['2026-10-14T14:00:00.000Z']));
    expect(at[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
    expect(at[1] ?? 0).toBeGreaterThanOrEqual(3_590_000);
  });

  it('a queue wait beyond maxWaitSeconds → limiter-timeout with retryAfterSeconds to the minute refresh; the abandoned job never reserves', async () => {
    const { kit, budget } = makeKit({ overrides: { searchapi: { ratePerMinute: 1, maxWaitSeconds: 30 } } });
    ok();
    const first = kit.request(nth(1));
    const second = kit.request(nth(2));
    await drive(first);
    const err = asProviderError(await driveError(second));
    expect(err).toMatchObject({
      kind: 'limiter-timeout',
      retryable: false,
      message: expect.stringContaining('[queue-wait-exceeded]'),
    });
    expect(err.retryAfterSeconds ?? 0).toBeGreaterThanOrEqual(29);
    expect(err.retryAfterSeconds ?? 0).toBeLessThanOrEqual(31);
    await idle(70_000);
    expect(budget.reserveCalls).toBe(1);
    expect(budget.count('fetch')).toBe(1);
  });

  it('when the hourly reservoir is the exhausted one, retryAfterSeconds points at the hour refresh', async () => {
    const { kit } = makeKit({
      overrides: { searchapi: { ratePerMinute: 10, ratePerHour: 1, maxWaitSeconds: 60 } },
    });
    ok();
    await drive(kit.request(nth(1)));
    const err = asProviderError(await driveError(kit.request(nth(2))));
    expect(err.kind).toBe('limiter-timeout');
    expect(err.retryAfterSeconds ?? 0).toBeGreaterThan(3400);
  });

  it('an abort while queued → AbortedError, and the abandoned job never reserves', async () => {
    const { kit, budget } = makeKit({ overrides: { searchapi: { ratePerMinute: 1 } } });
    ok();
    await drive(kit.request(nth(1)));
    const ac = new AbortController();
    const queued = kit.request(req({ url: `${SEARCH}?n=2`, signal: ac.signal }));
    setTimeout(() => ac.abort(), 5000);
    expect(await driveError(queued)).toBeInstanceOf(AbortedError);
    await idle(70_000);
    expect(budget.reserveCalls).toBe(1);
  });

  it('each provider has its own limiter', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { ratePerMinute: 1 } } });
    ok();
    server.use(http.get(TP, () => HttpResponse.json({ success: true })));
    const t0 = Date.now();
    await drive(kit.request(nth(1)));
    await drive(kit.request(req({ url: TP, providerId: 'travelpayouts', headers: {} })));
    expect(fetchTimes(events, t0).every((t) => t < 1000)).toBe(true);
  });
});

describe('createLimiter token refunds (cost-006)', { timeout: 60_000 }, () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('a job abandoned by limiter-timeout refunds its minute and hour tokens when it is finally released', async () => {
    const limits = testLimits({ searchapi: { ratePerMinute: 1, ratePerHour: 10, concurrency: 1 } }).searchapi;
    const limiter = createLimiter(limits, { usedThisHour: 0 });
    const o = {
      signal: new AbortController().signal,
      maxWaitMs: 30_000,
      providerId: 'searchapi' as const,
      endpointPath: '/api/v1/search',
    };
    await drive(limiter.run(async () => 'a', o));
    await driveError(limiter.run(async () => 'b', o));
    await idle(61_000);
    // why: bottleneck's store yields through setTimeout(0), so even a reservoir read needs fake time driven.
    expect(await drive(limiter.reservoirs())).toEqual({ minute: 1, hour: 9 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/limiter.test.ts`
Expected: FAIL — `Failed to load url ../../src/http/limiter.js`.

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
  /** Whole seconds until the hourly window next refreshes (fixed window from creation). */
  secondsToHourRefresh(): number;
  /** Current reservoir levels (tests and diagnostics). */
  reservoirs(): Promise<{ minute: number; hour: number }>;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
const HEARTBEAT_MS = 5_000;

/**
 * Per-provider limiter. The hourly bottleneck (reservoir = ratePerHour − usedThisHour, refreshed to ratePerHour)
 * admits a job; the chained per-minute bottleneck (reservoir = ratePerMinute, maxConcurrent, minTime) runs it.
 * The queue deadline is our own timer plus an age check at release, because bottleneck's `expiration` bounds a
 * running job, not queue time. A job whose caller already gave up refunds both tokens and does nothing.
 */
export function createLimiter(l: ProviderHttpLimits, seed: { usedThisHour: number }): ProviderLimiter {
  const createdAt = Date.now();
  // why: a 5 s heartbeat (bottleneck's local default is 250 ms) keeps refresh checks cheap — both windows are multiples
  // of it — so hours of fake time in tests and idle limiters in production cost little; a refresh lands ≤ 5 s late.
  const perHour = new Bottleneck({
    reservoir: Math.max(0, l.ratePerHour - seed.usedThisHour),
    reservoirRefreshAmount: l.ratePerHour,
    reservoirRefreshInterval: HOUR_MS,
    heartbeatInterval: HEARTBEAT_MS,
  });
  const perMinute = new Bottleneck({
    maxConcurrent: l.concurrency,
    // why: smoothing only — the rate guarantee is per fixed bottleneck window from creation (plan decision 17).
    minTime: Math.ceil(MINUTE_MS / l.ratePerMinute),
    reservoir: l.ratePerMinute,
    reservoirRefreshAmount: l.ratePerMinute,
    reservoirRefreshInterval: MINUTE_MS,
    heartbeatInterval: HEARTBEAT_MS,
  });
  perHour.chain(perMinute);

  const secondsTo = (windowMs: number): number =>
    Math.max(1, Math.ceil((windowMs - ((Date.now() - createdAt) % windowMs)) / 1000));
  const reservoirs = async (): Promise<{ minute: number; hour: number }> => ({
    minute: (await perMinute.currentReservoir()) ?? 0,
    hour: (await perHour.currentReservoir()) ?? 0,
  });
  const refund = async (): Promise<void> => {
    await Promise.all([perMinute.incrementReservoir(1), perHour.incrementReservoir(1)]);
  };

  return {
    secondsToHourRefresh: () => secondsTo(HOUR_MS),
    reservoirs,
    run<T>(fn: () => Promise<T>, o: LimiterRunOptions): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let state: 'queued' | 'running' | 'gone' = 'queued';
        const enqueuedAt = Date.now();
        const timedOut = (seconds: number): ProviderError =>
          new ProviderError({
            kind: 'limiter-timeout',
            retryable: false,
            providerId: o.providerId,
            retryAfterSeconds: seconds,
            message: `${o.providerId} ${o.endpointPath}: waited more than ${Math.round(o.maxWaitMs / 1000)}s for a rate-limit slot [queue-wait-exceeded]`,
          });
        const leave = (): void => {
          state = 'gone';
          clearTimeout(timer);
          o.signal.removeEventListener('abort', onAbort);
        };
        const timeOut = (): void => {
          if (state !== 'queued') return;
          leave();
          // why: the error carries the seconds until the exhausted window reopens, so WP7's resume_after is data (po-003).
          reservoirs().then(
            ({ hour }) => reject(timedOut(hour === 0 ? secondsTo(HOUR_MS) : secondsTo(MINUTE_MS))),
            () => reject(timedOut(secondsTo(MINUTE_MS))),
          );
        };
        const onAbort = (): void => {
          if (state !== 'queued') return;
          leave();
          reject(new AbortedError());
        };
        const timer = setTimeout(timeOut, o.maxWaitMs);
        o.signal.addEventListener('abort', onAbort, { once: true });
        if (o.signal.aborted) onAbort();

        perHour
          .schedule(async () => {
            if (state === 'queued' && Date.now() - enqueuedAt > o.maxWaitMs) timeOut();
            if (state !== 'queued') {
              // why: the caller already received limiter-timeout or AbortedError; refund so a dead job does not eat the next window (cost-006).
              await refund();
              return;
            }
            if (o.signal.aborted) {
              onAbort();
              await refund();
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
          .catch((e: unknown) => {
            if (state !== 'queued') return;
            leave();
            reject(e instanceof Error ? e : new Error(String(e)));
          });
      });
    },
  };
}
```

`src/http/httpKit.ts` (second version; Task 4.4 replaces it):

```ts
import { isoDateTimeOfEpochMs, ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { runAttempt } from './attempt.js';
import { createLimiter, HOUR_MS, type ProviderLimiter } from './limiter.js';
import type { HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse, HttpProviderId } from './types.js';

export type { FixtureRecorder, HttpKit, HttpKitDeps, HttpKitRequest, HttpKitResponse, HttpProviderId, ProviderHttpLimits, ResponseFacts } from './types.js';

/** Spec §5.3: p-retry, max 3 attempts. */
export const MAX_ATTEMPTS = 3;
/** Exponential backoff base: 1–2 s before attempt 2, 2–4 s before attempt 3 (randomised). */
export const BACKOFF_BASE_MS = 1000;
const HTTP_PROVIDER_IDS = ['travelpayouts', 'searchapi', 'fixture', 'fx'] as const satisfies readonly HttpProviderId[];

/** Only a ProviderError marked retryable is retried; auth, quota, parse and BudgetExceeded never are. */
export function isRetryable(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.retryable;
}

/** Spec §5.3 http-kit over globalThis.fetch; the gated in-process seam for fixture.local arrives in Task 4.5. */
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  const limiters = new Map<HttpProviderId, ProviderLimiter>();
  const since = isoDateTimeOfEpochMs(Date.parse(deps.clock.now()) - HOUR_MS);
  for (const id of HTTP_PROVIDER_IDS) {
    const l = deps.limits[id];
    if (l === undefined) continue;
    // why: seed the hourly reservoir from the ledger so a restart inside an hour does not grant a fresh one (ruling 9); fx is not ledgered.
    limiters.set(id, createLimiter(l, { usedThisHour: id === 'fx' ? 0 : deps.budget.recentCalls(id, since) }));
  }
  let inFlight = 0;

  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    const limits = deps.limits[r.providerId];
    const limiter = limiters.get(r.providerId);
    if (limits === undefined || limiter === undefined) {
      throw new ProviderError({ kind: 'upstream', retryable: false, providerId: r.providerId, message: `${r.providerId}: no HTTP limits configured [egress-denied]` });
    }
    const run = { signal: r.signal, maxWaitMs: limits.maxWaitSeconds * 1000, providerId: r.providerId, endpointPath: r.endpointPath };
    inFlight += 1;
    try {
      const result = await pRetry((attempt) => limiter.run(() => runAttempt(deps, r, limits, { attempt }), run), {
        retries: MAX_ATTEMPTS - 1,
        minTimeout: BACKOFF_BASE_MS,
        factor: 2,
        // why: jitter keeps tiles that failed together from retrying in lockstep; tests assert ranges.
        randomize: true,
        shouldRetry: ({ error }) => isRetryable(error),
      });
      return { ...result, fromCache: false, cacheKey: '' };
    } finally {
      inFlight -= 1;
    }
  }
  return { request, stats: () => ({ inFlight }) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/limiter.test.ts test/http/pipeline.test.ts`
Expected: PASS, 11 tests.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: per-provider limiter seeded from the ledger, queue deadline with retry time, token refunds (spec §5.3)"
```

### Task 4.4: Error mapping, Retry-After, the header-less 429, backoff, timeouts, aborts, body failures, redirects

**Files:**
- Replace: `src/http/classify.ts`, `src/http/attempt.ts`, `src/http/httpKit.ts` (third version)
- Create: `src/http/sleep.ts`
- Test: `test/http/errors.test.ts`

**Interfaces:**
- Consumes: `ProviderError`, `ProviderErrorKind`, `stripUrlsInText`, `AbortedError` (WP0); `scrubSecrets` (Task 4.2); `ProviderLimiter.secondsToHourRefresh` (Task 4.3).
- Produces: `classifyResponse(f: ResponseFacts)`, `finishError`, `parseRetryAfter`, `vendorMessage`, `classifyThrown`, `malformedBody`, `redirectRefused`, `requestTimeout`, `bodyReadFailed`, `bodyTooLarge`, `raceAbort`, `sleep`, `MAX_BODY_BYTES`.

Rules this task implements (spec §5.2 rev 11, plan decision 15): the adapter's `classifyError(facts)` runs first with a scrubbed body and scrubbed header values, `undefined` falls through to the default table, and `finishError` then applies to whichever error results: re-scrub and URL-strip the message (and any `reason`); for a retryable error take the wait from `Retry-After`, else for a 429 from `rateLimitFallbackWaitSeconds`; a wait above `maxWaitSeconds` → non-retryable `limiter-timeout` carrying the wait; a retryable 429 with neither → non-retryable `rate-limit` with `retryAfterSeconds` = seconds to the hourly refresh. Once a status line has arrived, a failure reading the body is finalised with that status: `unknown` and non-retryable for a billed vendor's HTTP 200 (the vendor has charged it), `error` and retryable otherwise. Bodies above 10 MiB are refused.

- [ ] **Step 1: Write the failing tests**

`test/http/errors.test.ts`:

```ts
import { AbortedError, asIsoDateTime, ProviderError } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES } from '../../src/http/attempt.js';
import { classifyThrown, parseRetryAfter } from '../../src/http/classify.js';
import type { ResponseFacts } from '../../src/http/types.js';
import { makeKit, req, SEARCH, SENTINELS, TP } from '../fakes.js';
import { asProviderError } from '../support/guards.js';
import { hangUntilAborted, server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const reply = (
  status: number,
  body: unknown = { error: `synthetic ${status}` },
  headers: Record<string, string> = {},
) =>
  server.use(
    http.get(
      SEARCH,
      () =>
        new HttpResponse(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        }),
    ),
  );
const hang = (url: string) => server.use(http.get(url, ({ request }) => hangUntilAborted(request)));
const tpReq = () =>
  req({
    url: TP,
    providerId: 'travelpayouts',
    headers: { 'x-access-token': SENTINELS.travelpayouts.reveal() },
  });
const fetchTimes = (events: ReturnType<typeof makeKit>['events'], t0: number) =>
  events.flatMap((e) => (e.type === 'fetch' ? [e.at - t0] : []));
const finals = (events: ReturnType<typeof makeKit>['events']) =>
  events.flatMap((e) => (e.type === 'finalise' ? [e] : []));

describe('default error mapping (spec §5.2 "Errors", §9 item 2)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'quota'],
    [404, 'upstream'],
    [409, 'upstream'],
  ] as const)('HTTP %i → %s, never retried', async (status, kind) => {
    const { kit, budget } = makeKit();
    reply(status);
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind,
      retryable: false,
      httpStatus: status,
    });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error']);
  });

  it('HTTP 400 → parse; the vendor message is in the message (→ last_error), never in reason; never retried', async () => {
    const { kit, budget } = makeKit();
    reply(400, { error: 'Too many combinations: 240 > 200' });
    const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
    expect(err).toMatchObject({ kind: 'parse', retryable: false, reason: undefined });
    expect(err.message).toContain('Too many combinations: 240 > 200');
    expect(budget.count('fetch')).toBe(1);
  });

  it("Travelpayouts' recorded plain-text 401 (spec §2 fact 5) → auth through the non-JSON path, one attempt", async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get(
        TP,
        () => new HttpResponse('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } }),
      ),
    );
    expect(await driveError(kit.request(tpReq()))).toMatchObject({ kind: 'auth', retryable: false });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error']);
  });

  it('HTTP 429 with Retry-After → rate-limit, retried to 3 attempts', async () => {
    const { kit, budget } = makeKit();
    reply(429, {}, { 'Retry-After': '1' });
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'rate-limit',
      retryable: true,
      httpStatus: 429,
    });
    expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e.httpAttempt] : []))).toEqual([1, 2, 3]);
  });

  it('a 429 is never quota by default, even with the ledger at its cap (the ledger arm is dropped, rev 11)', async () => {
    const { kit, budget } = makeKit();
    budget.caps.set('provider-month:searchapi', 1);
    reply(429, {}, { 'Retry-After': '1' });
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({ kind: 'rate-limit' });
  });

  it('a header-less 429 with no fallback (SearchApi) → non-retryable rate-limit, retry time at the hourly window', async () => {
    const { kit, budget } = makeKit();
    reply(429);
    const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
    expect(err).toMatchObject({
      kind: 'rate-limit',
      retryable: false,
      message: expect.stringContaining('[no-retry-after]'),
    });
    expect(err.retryAfterSeconds ?? 0).toBeGreaterThan(3500);
    expect(budget.count('fetch')).toBe(1);
  });

  it('a header-less 429 with a fallback (Travelpayouts, 60 s) waits the fallback before the next attempt', async () => {
    const { kit, events } = makeKit();
    let n = 0;
    server.use(
      http.get(TP, () =>
        ++n === 1 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json({ success: true, data: [] }),
      ),
    );
    const t0 = Date.now();
    await drive(kit.request(tpReq()));
    expect(fetchTimes(events, t0)[1] ?? 0).toBeGreaterThanOrEqual(60_000);
  });

  it('HTTP 503 → upstream retryable; three finalise(error) rows', async () => {
    const { kit, events } = makeKit();
    reply(503);
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'upstream',
      retryable: true,
      httpStatus: 503,
    });
    expect(finals(events).map((e) => e.outcome)).toEqual(['error', 'error', 'error']);
  });

  it('malformed JSON on a 200 → parse, never retried, finalised ok with status 200 (the vendor billed it)', async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get(
        SEARCH,
        () =>
          new HttpResponse('{"calendar": [', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'parse',
      retryable: false,
      message: expect.stringContaining('[malformed-json]'),
    });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:ok']);
  });

  it('a socket error → network, retried to 3 attempts, finalised error without status', async () => {
    const { kit, events } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.error()));
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'network',
      retryable: true,
      message: expect.stringContaining('[socket]'),
    });
    expect(finals(events).every((e) => e.outcome === 'error' && e.httpStatus === undefined)).toBe(true);
    expect(finals(events)).toHaveLength(3);
  });
});

describe('adapter classifyError (plan decision 15)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('is consulted first: a recognised quota body on a 429 → quota, one attempt', async () => {
    const { kit, budget } = makeKit({
      overrides: {
        searchapi: {
          classifyError: (f) =>
            f.status === 429 && JSON.stringify(f.body).includes('exhausted')
              ? new ProviderError({
                  kind: 'quota',
                  retryable: false,
                  httpStatus: f.status,
                  message: 'searchapi: plan quota body',
                })
              : undefined,
        },
      },
    });
    reply(429, { error: 'monthly searches exhausted' });
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({ kind: 'quota' });
    expect(budget.count('fetch')).toBe(1);
  });

  it('undefined falls through to the default table, and the Retry-After wait still applies', async () => {
    const { kit, events } = makeKit({ overrides: { searchapi: { classifyError: () => undefined } } });
    let n = 0;
    server.use(
      http.get(SEARCH, () =>
        ++n === 1
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } })
          : HttpResponse.json({ ok: 1 }),
      ),
    );
    const t0 = Date.now();
    await drive(kit.request(req({ url: SEARCH })));
    expect(fetchTimes(events, t0)[1] ?? 0).toBeGreaterThanOrEqual(30_000);
  });

  it('sees a scrubbed body and scrubbed headers, and its message is re-scrubbed (arch-001, sec-001)', async () => {
    const seen: ResponseFacts[] = [];
    const key = SENTINELS.searchapi.reveal();
    const { kit } = makeKit({
      overrides: {
        searchapi: {
          classifyError: (f) => {
            seen.push(f);
            return new ProviderError({
              kind: 'auth',
              retryable: false,
              message: `vendor said ${JSON.stringify(f.body)}; key ${key}; see https://x.example/?k=1`,
            });
          },
        },
      },
    });
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({ error: `Invalid API key ${key}` }, { status: 401, headers: { 'x-echo': key } }),
      ),
    );
    const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
    expect(JSON.stringify(seen[0]?.body)).not.toContain(key);
    expect(seen[0]?.headers.get('x-echo')).toBe('[redacted]');
    expect(err.message).not.toContain(key);
    expect(err.message).not.toContain('?k=1');
    expect(err.message).toContain('[redacted]');
  });
});

describe('Retry-After and backoff (fake timers)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('backs off 1–2 s then 2–4 s between attempts (randomised)', async () => {
    const { kit, events } = makeKit();
    let n = 0;
    server.use(
      http.get(SEARCH, () =>
        ++n < 3 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json({ ok: 1 }),
      ),
    );
    const t0 = Date.now();
    await drive(kit.request(req({ url: SEARCH })), { stepMs: 50 });
    const [a0 = 0, a1 = 0, a2 = 0] = fetchTimes(events, t0);
    expect(a1 - a0).toBeGreaterThanOrEqual(1000);
    expect(a1 - a0).toBeLessThanOrEqual(2200);
    expect(a2 - a1).toBeGreaterThanOrEqual(2000);
    expect(a2 - a1).toBeLessThanOrEqual(4200);
  });

  it('honours Retry-After (seconds) before the next attempt', async () => {
    const { kit, events } = makeKit();
    let n = 0;
    server.use(
      http.get(SEARCH, () =>
        ++n === 1
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '30' } })
          : HttpResponse.json({ ok: 1 }),
      ),
    );
    const t0 = Date.now();
    await drive(kit.request(req({ url: SEARCH })));
    expect(fetchTimes(events, t0)[1] ?? 0).toBeGreaterThanOrEqual(30_000);
  });

  it.each([429, 503])(
    'a Retry-After beyond maxWaitSeconds on %i → limiter-timeout carrying the wait, not retried',
    async (status) => {
      const { kit, budget } = makeKit();
      reply(status, {}, { 'Retry-After': '7200' });
      const err = asProviderError(await driveError(kit.request(req({ url: SEARCH }))));
      expect(err).toMatchObject({
        kind: 'limiter-timeout',
        retryable: false,
        retryAfterSeconds: 7200,
        message: expect.stringContaining('[retry-after-exceeds-max-wait]'),
      });
      expect(budget.count('fetch')).toBe(1);
    },
  );

  it('parses an HTTP-date Retry-After relative to the clock', () => {
    const now = asIsoDateTime('2026-10-14T15:00:00.000Z');
    expect(parseRetryAfter('Wed, 14 Oct 2026 15:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('Wed, 14 Oct 2026 14:00:00 GMT', now)).toBe(0);
  });
});

describe('per-request timeout, abort, body failures and redirect', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('timeout on a billed vendor → network, finalised unknown, not retried, still counted by usage()', async () => {
    const { kit, budget } = makeKit({ overrides: { searchapi: { requestTimeoutSeconds: 5 } } });
    hang(SEARCH);
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'network',
      retryable: false,
      message: expect.stringContaining('[timeout]'),
    });
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:unknown']);
    expect(budget.usage({ kind: 'provider-month', providerId: 'searchapi' }).calls).toBe(1);
  });

  it('timeout on a free vendor (billable never) → retried to 3 attempts, each finalised unknown', async () => {
    const { kit, events } = makeKit({ overrides: { travelpayouts: { requestTimeoutSeconds: 5 } } });
    hang(TP);
    expect(await driveError(kit.request(tpReq()))).toMatchObject({ kind: 'network', retryable: true });
    expect(finals(events).map((e) => e.outcome)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('abort mid-fetch → finalise(unknown) before AbortedError, no retry, still counted by usage()', async () => {
    const { kit, budget } = makeKit();
    hang(SEARCH);
    const ac = new AbortController();
    const p = kit.request(req({ url: SEARCH, signal: ac.signal }));
    setTimeout(() => ac.abort(), 1000);
    expect(await driveError(p)).toBeInstanceOf(AbortedError);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:unknown']);
    expect(budget.usage({ kind: 'provider-month', providerId: 'searchapi' }).calls).toBe(1);
  });

  it('an already-aborted signal → AbortedError with no reserve and no fetch', async () => {
    const { kit, budget } = makeKit();
    const ac = new AbortController();
    ac.abort();
    expect(await driveError(kit.request(req({ url: SEARCH, signal: ac.signal })))).toBeInstanceOf(
      AbortedError,
    );
    expect(budget.reserveCalls).toBe(0);
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

  it('a body above 10 MiB → upstream, non-retryable (sec-014)', async () => {
    const { kit, budget } = makeKit();
    server.use(http.get(SEARCH, () => new HttpResponse('a'.repeat(MAX_BODY_BYTES + 1), { status: 200 })));
    expect(await driveError(kit.request(req({ url: SEARCH })))).toMatchObject({
      kind: 'upstream',
      retryable: false,
      message: expect.stringContaining('[body-too-large]'),
    });
    expect(budget.count('fetch')).toBe(1);
  });

  it("the runtime's refused-redirect rejection maps to upstream redirect-refused, never a retried network error", () => {
    const thrown = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    expect(classifyThrown(thrown, { providerId: 'searchapi', endpointPath: '/api/v1/search' })).toMatchObject(
      {
        kind: 'upstream',
        retryable: false,
        message: expect.stringContaining('[redirect-refused]'),
      },
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/errors.test.ts`
Expected: FAIL — `MAX_BODY_BYTES` is undefined, `parseRetryAfter is not a function`, and the mapping cases mismatch the first-version classification (for example `expected 'upstream' to be 'auth'`, and the timeout and abort cases never settle: `drive: promise did not settle`).

- [ ] **Step 3: Implement**

`src/http/classify.ts` (replace; final):

```ts
import {
  type IsoDateTime,
  ProviderError,
  type ProviderErrorKind,
  type Secret,
  stripUrlsInText,
} from '@gmt/core';
import { isRecord } from '../util.js';
import { scrubSecrets } from './scrub.js';
import type { HttpProviderId, ProviderHttpLimits, ResponseFacts } from './types.js';

type Where = { providerId: HttpProviderId; endpointPath: string };
interface ErrorParts {
  kind: ProviderErrorKind;
  retryable: boolean;
  detail: string;
  httpStatus?: number;
  code?: string;
  retryAfterSeconds?: number;
}

/**
 * Builds a ProviderError whose message names provider and path only, never a URL, ending in a bracketed diagnostic
 * code (`[timeout]`, `[redirect-refused]`, …) that tests and logs match.
 * why: `ProviderError.reason` becomes `cell_outcomes.reason` (spec §8.1 `reason = error.reason ?? kind`), which
 * holds the kind or a spec-named reason only (spec §3), so http-kit never sets `reason`; vendor text travels in
 * the message, which the engine writes to `last_error`.
 */
function providerError(w: Where, p: ErrorParts): ProviderError {
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

/** The vendor's own message (`error` or `message` field, or a text body) from an already-scrubbed body; URL-free, ≤ 200 chars. */
export function vendorMessage(body: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof body === 'string') raw = body;
  else if (isRecord(body)) {
    const m = body.error ?? body.message;
    if (typeof m === 'string') raw = m;
  }
  if (raw === undefined || raw.trim() === '') return undefined;
  return stripUrlsInText(raw).trim().slice(0, 200);
}

/**
 * The default spec §5.2 (rev 11) table: 401/403 auth · 402 quota · 400 parse (vendor message in the message) ·
 * 404 upstream · 429 rate-limit (retryable; quota only through an adapter's classifyError) · 5xx upstream
 * (retryable) · any other status upstream (non-retryable). Waits are applied afterwards by `finishError`.
 */
export function classifyResponse(f: ResponseFacts): ProviderError {
  const w: Where = { providerId: f.providerId, endpointPath: f.endpointPath };
  const httpStatus = f.status;
  if (httpStatus === 401 || httpStatus === 403)
    return providerError(w, {
      kind: 'auth',
      retryable: false,
      httpStatus,
      detail: `HTTP ${httpStatus} (credentials refused)`,
    });
  if (httpStatus === 402)
    return providerError(w, { kind: 'quota', retryable: false, httpStatus, detail: 'HTTP 402 (plan quota)' });
  if (httpStatus === 400) {
    const vendor = vendorMessage(f.body);
    return providerError(w, {
      kind: 'parse',
      retryable: false,
      httpStatus,
      code: 'bad-request',
      detail: `HTTP 400${vendor ? ` (${vendor})` : ''}`,
    });
  }
  if (httpStatus === 404)
    return providerError(w, { kind: 'upstream', retryable: false, httpStatus, detail: 'HTTP 404' });
  if (httpStatus === 429)
    return providerError(w, { kind: 'rate-limit', retryable: true, httpStatus, detail: 'HTTP 429' });
  if (httpStatus >= 500)
    return providerError(w, { kind: 'upstream', retryable: true, httpStatus, detail: `HTTP ${httpStatus}` });
  return providerError(w, { kind: 'upstream', retryable: false, httpStatus, detail: `HTTP ${httpStatus}` });
}

export interface FinishContext {
  facts: ResponseFacts;
  limits: ProviderHttpLimits;
  now: IsoDateTime;
  secrets: readonly Secret[];
  secondsToHourRefresh: () => number;
}

/**
 * The post-step for whichever error classification produced (adapter or default), spec §5.2 rev 11:
 * the message and any reason are re-scrubbed and URL-stripped (an adapter may have copied vendor text or a key);
 * a retryable error waits `Retry-After`, else (429) `rateLimitFallbackWaitSeconds`; a wait above `maxWaitSeconds`
 * becomes non-retryable `limiter-timeout` carrying the wait; a retryable 429 with no wait at all becomes
 * non-retryable `rate-limit` with `retryAfterSeconds` = seconds to the limiter's hourly refresh.
 */
export function finishError(err: ProviderError, c: FinishContext): ProviderError {
  const clean = (s: string): string => stripUrlsInText(scrubSecrets(s, c.secrets));
  const message = clean(err.message);
  const base = {
    kind: err.kind,
    retryable: err.retryable,
    providerId: c.facts.providerId,
    ...(err.httpStatus === undefined ? {} : { httpStatus: err.httpStatus }),
    ...(err.reason === undefined ? {} : { reason: clean(err.reason) }),
    ...(err.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: err.retryAfterSeconds }),
  };
  if (!err.retryable) return new ProviderError({ ...base, message });
  const is429 = c.facts.status === 429;
  const wait =
    parseRetryAfter(c.facts.headers.get('retry-after'), c.now) ??
    (is429 ? c.limits.rateLimitFallbackWaitSeconds : undefined);
  if (wait === undefined) {
    if (!is429) return new ProviderError({ ...base, message });
    return new ProviderError({
      ...base,
      retryable: false,
      retryAfterSeconds: c.secondsToHourRefresh(),
      message: `${message} [no-retry-after]`,
    });
  }
  if (wait > c.limits.maxWaitSeconds) {
    return new ProviderError({
      ...base,
      kind: 'limiter-timeout',
      retryable: false,
      retryAfterSeconds: wait,
      message: `${message} (asks to wait ${wait}s, beyond MAX_WAIT_SECONDS ${c.limits.maxWaitSeconds}) [retry-after-exceeds-max-wait]`,
    });
  }
  return new ProviderError({ ...base, retryAfterSeconds: wait, message });
}

/** A 2xx whose body is not JSON. Spec §5.2: malformed → parse. */
export function malformedBody(w: Where, httpStatus: number): ProviderError {
  return providerError(w, {
    kind: 'parse',
    retryable: false,
    httpStatus,
    code: 'malformed-json',
    detail: `HTTP ${httpStatus} with a body that is not JSON`,
  });
}

/** A 3xx reached us, or fetch refused to follow one (`redirect: 'error'`). Spec §5.3 egress. */
export function redirectRefused(w: Where, httpStatus?: number): ProviderError {
  return providerError(w, {
    kind: 'upstream',
    retryable: false,
    code: 'redirect-refused',
    detail: 'redirect refused (redirect: error)',
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
}

/** Per-request timeout. Spec §5.2: network, finalised unknown, not retried for billed vendors. */
export function requestTimeout(w: Where, billable: 'http-200' | 'never'): ProviderError {
  return providerError(w, {
    kind: 'network',
    retryable: billable === 'never',
    code: 'timeout',
    detail: 'request timed out (REQUEST_TIMEOUT_SECONDS)',
  });
}

/** The status line arrived but the body could not be read; billed 200s are not retried (the vendor charged them). */
export function bodyReadFailed(w: Where, httpStatus: number, billed: boolean): ProviderError {
  return providerError(w, {
    kind: 'network',
    retryable: !billed,
    httpStatus,
    code: 'body-read-failed',
    detail: `HTTP ${httpStatus}, body read failed`,
  });
}

/** A body above MAX_BODY_BYTES. */
export function bodyTooLarge(w: Where, httpStatus: number): ProviderError {
  return providerError(w, {
    kind: 'upstream',
    retryable: false,
    httpStatus,
    code: 'body-too-large',
    detail: `HTTP ${httpStatus} with a body above the size cap`,
  });
}

/** A rejection from fetch itself: a refused redirect, or a socket-level failure (network, retryable). */
export function classifyThrown(err: unknown, w: Where): ProviderError {
  const cause = err instanceof Error ? err.cause : undefined;
  const text = `${err instanceof Error ? err.message : String(err)} ${cause instanceof Error ? cause.message : String(cause ?? '')}`;
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

`src/http/attempt.ts` (replace; Tasks 4.5, 4.7 and 4.8 add one block each):

```ts
import { AbortedError, type IsoDateTime, type Reservation } from '@gmt/core';
import {
  bodyReadFailed,
  bodyTooLarge,
  classifyResponse,
  classifyThrown,
  finishError,
  malformedBody,
  redirectRefused,
  requestTimeout,
} from './classify.js';
import { scrubSecrets } from './scrub.js';
import type { HttpKitDeps, HttpKitRequest, ProviderHttpLimits, ResponseFacts } from './types.js';

/** Response bodies above this are refused (sec-014): a misbehaving vendor cannot exhaust memory. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** The outcome of one successful HTTP attempt; `body` is already scrubbed of every secret. */
export interface AttemptResult {
  status: number;
  body: unknown;
  fetchedAt: IsoDateTime;
}

/** Per-attempt inputs from the retry loop. */
export interface AttemptContext {
  attempt: number;
  secondsToHourRefresh: () => number;
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

/** Reads the body as text, or null when it exceeds MAX_BODY_BYTES (declared or streamed). */
async function readCapped(res: Response, signal: AbortSignal): Promise<string | null> {
  if (Number(res.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    await res.body?.cancel();
    return null;
  }
  if (res.body === null) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await raceAbort(reader.read(), signal);
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function scrubbedHeaders(h: Headers, deps: HttpKitDeps): Headers {
  const out = new Headers();
  h.forEach((value, name) => {
    out.set(name, scrubSecrets(value, deps.secrets));
  });
  return out;
}

/**
 * One attempt of spec §5.3's retry body: budget.reserve → fetch → reservation.finalise → classify.
 * - reserve runs before the request leaves the process (BudgetExceeded propagates, nothing is sent);
 * - fetch uses `redirect: 'error'` and the per-request timeout combined with the caller's signal;
 * - finalise runs exactly once per reserve: `ok` for 2xx (even a malformed body: the vendor billed it), `error`
 *   for any other status or a socket failure, `unknown` for timeout and abort and for a billed 200 whose body
 *   then fails; an abort finalises `unknown` before AbortedError propagates.
 */
export async function runAttempt(
  deps: HttpKitDeps,
  r: HttpKitRequest,
  limits: ProviderHttpLimits,
  ctx: AttemptContext,
): Promise<AttemptResult> {
  if (r.signal.aborted) throw new AbortedError();
  const w = { providerId: r.providerId, endpointPath: r.endpointPath };
  // why: 'fx' is not a ProviderId in the BudgetGuard port and spec §5.6 says FX calls are never ledgered.
  const reservation: Reservation | null =
    r.providerId === 'fx'
      ? null
      : deps.budget.reserve({
          providerId: r.providerId,
          executionId: r.executionId,
          tileIndex: r.tileIndex,
          costMicroGbp: limits.costPerCallMicroGbp,
          httpAttempt: ctx.attempt,
          endpointPath: r.endpointPath,
        });
  // why: durations use Date.now() so vitest fake timers drive them; instants (fetchedAt) use the Clock port.
  const started = Date.now();
  const finalise = (outcome: 'ok' | 'error' | 'unknown', httpStatus?: number): void =>
    reservation?.finalise({
      outcome,
      durationMs: Date.now() - started,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
  // why: setTimeout + AbortController rather than AbortSignal.timeout, whose Node-internal timer vitest cannot fake.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), limits.requestTimeoutSeconds * 1000);
  const signal = AbortSignal.any([r.signal, timeout.signal]);

  let res: Response;
  try {
    const init: RequestInit = {
      method: r.method,
      headers: r.headers,
      ...(r.body === undefined ? {} : { body: r.body }),
      redirect: 'error',
      signal,
    };
    res = await raceAbort(fetch(r.url, init), signal);
    if (res.type === 'error') throw new TypeError('network error');
  } catch (err) {
    clearTimeout(timer);
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
  }

  const status = res.status;
  // why (cost-001): once a 200 status line has arrived a billed vendor has charged the call, so a body failure is
  // finalised 'unknown' with the status (counted by the cap predicate) and not retried.
  const billed200 = limits.billable === 'http-200' && status === 200;
  let text: string | null;
  try {
    text = await readCapped(res, signal);
  } catch {
    if (r.signal.aborted) {
      finalise('unknown', status);
      throw new AbortedError();
    }
    if (timeout.signal.aborted) {
      finalise('unknown', status);
      throw requestTimeout(w, limits.billable);
    }
    finalise(billed200 ? 'unknown' : 'error', status);
    throw bodyReadFailed(w, status, billed200);
  } finally {
    clearTimeout(timer);
  }

  const ok = status >= 200 && status < 300;
  const fetchedAt = deps.clock.now();
  finalise(ok ? 'ok' : 'error', status);
  if (status >= 300 && status < 400) throw redirectRefused(w, status);
  if (text === null) throw bodyTooLarge(w, status);

  let body: unknown;
  let malformed = false;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
    malformed = true;
  }

  const scrubbed = scrubSecrets(body, deps.secrets);
  if (!ok) {
    const facts: ResponseFacts = {
      status,
      body: scrubbed,
      headers: scrubbedHeaders(res.headers, deps),
      ...w,
    };
    const raw = limits.classifyError?.(facts) ?? classifyResponse(facts);
    throw finishError(raw, {
      facts,
      limits,
      now: deps.clock.now(),
      secrets: deps.secrets,
      secondsToHourRefresh: ctx.secondsToHourRefresh,
    });
  }
  if (malformed) throw malformedBody(w, status);
  return { status, body: scrubbed, fetchedAt };
}
```

`src/http/httpKit.ts` (third version; Task 4.5 edits it, Task 4.6 replaces it): identical to the second version except the `try` block of `request`, which becomes

```ts
    try {
      const result = await pRetry(
        (attempt) => limiter.run(() => runAttempt(deps, r, limits, { attempt, secondsToHourRefresh: () => limiter.secondsToHourRefresh() }), run),
        {
          retries: MAX_ATTEMPTS - 1,
          minTimeout: BACKOFF_BASE_MS,
          factor: 2,
          // why: jitter keeps tiles that failed together from retrying in lockstep; tests assert ranges.
          randomize: true,
          signal: r.signal,
          shouldRetry: ({ error }) => isRetryable(error),
          // why: p-retry calls onFailedAttempt even when shouldRetry will refuse, so the wait checks retryability
          // and remaining attempts itself; the sleep is abortable.
          onFailedAttempt: async ({ error, retriesLeft }) => {
            if (retriesLeft > 0 && isRetryable(error) && error.retryAfterSeconds !== undefined) await sleep(error.retryAfterSeconds * 1000, r.signal);
          },
        },
      );
      return { ...result, fromCache: false, cacheKey: '' };
    } catch (err) {
      // why: p-retry rethrows the signal's reason on abort; the engine contract is AbortedError (spec §5.2).
      if (r.signal.aborted && !(err instanceof AbortedError)) throw new AbortedError();
      throw err;
    } finally {
      inFlight -= 1;
    }
```

with the imports extended to `import { AbortedError, isoDateTimeOfEpochMs, ProviderError } from '@gmt/core';` and `import { sleep } from './sleep.js';`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/errors.test.ts test/http/limiter.test.ts test/http/pipeline.test.ts`
Expected: PASS, 40 tests (29 errors, 10 limiter, 1 pipeline). The redirect and body-failure cases need the in-process seam and live in `test/http/inProcess.test.ts` (Task 4.5): msw follows a mocked 3xx with the real fetch and rejects a fetch whose mocked body stream errors.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: error table with adapter fall-through, waits and scrubbing post-step, timeouts, aborts, body failures (spec §5.2, §5.3)"
```

### Task 4.5: Egress allowlist, construction checks and the gated in-process seam

**Files:**
- Create: `src/http/egress.ts`, `src/fixture/constants.ts`
- Modify: `src/http/httpKit.ts`, `src/http/attempt.ts`
- Test: `test/http/egress.test.ts`, `test/http/inProcess.test.ts`

**Interfaces:**
- Produces: `assertKitConfig(deps)`, `assertEgress(r, limits, secrets): asserts limits is ProviderHttpLimits`, `MIN_SECRET_LENGTH`; `HttpKitDeps.inProcessHosts` dispatch (spec §5.3 rev 11); the fixture constants.

- [ ] **Step 1: Write the failing tests**

`test/http/egress.test.ts`:

```ts
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH, SENTINELS, TP, testLimits } from '../fakes.js';
import { asProviderError } from '../support/guards.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const key = SENTINELS.searchapi.reveal();

describe('egress allowlist (spec §5.3 "Egress")', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  const refused = async (r: Parameters<typeof req>[0]) => {
    const { kit, budget } = makeKit();
    const err = asProviderError(await driveError(kit.request(req(r))));
    expect(err).toMatchObject({
      kind: 'upstream',
      retryable: false,
      message: expect.stringContaining('[egress-denied]'),
    });
    expect(budget.reserveCalls).toBe(0);
    expect(budget.count('fetch')).toBe(0);
    return err;
  };

  it('refuses a host outside the provider allowlist before reserve, naming the host', async () => {
    expect((await refused({ url: TP })).message).toContain('api.travelpayouts.com');
  });
  it('refuses plain http for a real vendor', async () => {
    await refused({ url: 'http://www.searchapi.io/api/v1/search' });
  });
  it('refuses userinfo in the URL', async () => {
    await refused({ url: 'https://someone:pw@www.searchapi.io/api/v1/search' });
  });
  it('refuses an explicit port (sec-005)', async () => {
    await refused({ url: 'https://www.searchapi.io:8443/api/v1/search' });
  });
  it('refuses a credential in the query, keeping it out of the message', async () => {
    expect((await refused({ url: `${SEARCH}?api_key=${key}` })).message).not.toContain(key);
  });
  it('refuses a credential smuggled into a hostname without echoing it (sec-005)', async () => {
    expect((await refused({ url: `https://${key}.evil.example/api/v1/search` })).message).not.toContain(key);
  });
  it('refuses an endpointPath that is not the URL path or carries a query', async () => {
    await refused({ url: SEARCH, endpointPath: '/api/v1/search?engine=x' });
    await refused({ url: SEARCH, endpointPath: '/other' });
  });
  it('refuses a provider id with no limits configured', async () => {
    const limits = testLimits();
    const { kit, budget } = makeKit({ limits: { searchapi: limits.searchapi, fx: limits.fx } });
    expect(
      await driveError(kit.request(req({ url: TP, providerId: 'travelpayouts', headers: {} }))),
    ).toMatchObject({ message: expect.stringContaining('[egress-denied]') });
    expect(budget.reserveCalls).toBe(0);
  });
  it.each([
    'https://www.searchapi.io.evil.example/api/v1/search',
    'https://evil.example/www.searchapi.io',
    'https://www.searchapi.io@evil.example/api/v1/search',
    'https://www.searchapi.io./api/v1/search',
    'https://www.searchаpi.io/api/v1/search',
    'https://www.searchapi.io\\@evil.example/api/v1/search',
  ])('refuses the lookalike %s (sec-004)', async (url) => {
    await refused({ url, endpointPath: '/api/v1/search' });
  });
  it('an upper-case host is normalised by URL to the allowlisted host and allowed', async () => {
    const { kit } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ ok: true })));
    expect((await drive(kit.request(req({ url: 'https://WWW.SEARCHAPI.IO/api/v1/search' })))).body).toEqual({
      ok: true,
    });
  });
  it.each([
    ['fx', 'https://api.frankfurter.dev/v1/latest?from=GBP'],
    ['fixture', 'http://fixture.local/health'],
  ] as const)('refuses any credential header on a %s request (ruling 13)', async (providerId, url) => {
    await refused({ url, providerId, headers: { 'X-Access-Token': SENTINELS.travelpayouts.reveal() } });
  });
  it('allows plain http only for the fixture host', async () => {
    const { kit } = makeKit();
    server.use(
      http.get('http://fixture.local/health', () => HttpResponse.json({ synthetic: true, ok: true })),
    );
    expect(
      (
        await drive(
          kit.request(req({ url: 'http://fixture.local/health', providerId: 'fixture', headers: {} })),
        )
      ).body,
    ).toEqual({ synthetic: true, ok: true });
    await refused({ url: 'http://fixture.local/health', providerId: 'travelpayouts', headers: {} });
  });
});
```

`test/http/inProcess.test.ts`:

```ts
import { AbortedError, Secret } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBudget, makeKit, req, testLimits } from '../fakes.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const HEALTH = 'http://fixture.local/health';
const healthReq = (over: Partial<Parameters<typeof req>[0]> = {}) =>
  req({ url: HEALTH, providerId: 'fixture', headers: {}, tileIndex: null, ...over });
const finals = (events: ReturnType<typeof makeKit>['events']) =>
  events.flatMap((e) => (e.type === 'finalise' ? [e] : []));

describe('in-process transport seam (spec §5.3 rev 11)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('dispatches fixture.local in process; reserve precedes dispatch and finalise follows; msw sees nothing', async () => {
    const budget = new FakeBudget([]);
    const seen: string[] = [];
    const { kit } = makeKit({
      budget,
      inProcessHosts: {
        'fixture.local': async (r) => {
          seen.push(`${r.method} ${r.url}`);
          budget.events.push({ type: 'fetch', at: Date.now(), url: r.url, method: r.method, headers: {} });
          return Response.json({ synthetic: true, ok: true });
        },
      },
    });
    expect((await drive(kit.request(healthReq()))).body).toEqual({ synthetic: true, ok: true });
    expect(seen).toEqual([`GET ${HEALTH}`]);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:ok']);
  });

  it('the per-request timeout and abort apply to an in-process call', async () => {
    const hang = { 'fixture.local': () => new Promise<Response>(() => undefined) };
    const timed = makeKit({ inProcessHosts: hang, overrides: { fixture: { requestTimeoutSeconds: 5 } } });
    expect(await driveError(timed.kit.request(healthReq()))).toMatchObject({
      kind: 'network',
      message: expect.stringContaining('[timeout]'),
    });
    expect(timed.budget.sequence()).toEqual(['reserve', 'finalise:unknown']);
    const aborted = makeKit({ inProcessHosts: hang });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    expect(await driveError(aborted.kit.request(healthReq({ signal: ac.signal })))).toBeInstanceOf(
      AbortedError,
    );
  });

  it('an in-process Response.error() is a socket error: network, retried to 3 attempts', async () => {
    const { kit, budget } = makeKit({ inProcessHosts: { 'fixture.local': async () => Response.error() } });
    expect(await driveError(kit.request(healthReq()))).toMatchObject({
      kind: 'network',
      retryable: true,
      message: expect.stringContaining('[socket]'),
    });
    expect(budget.sequence()).toEqual([
      'reserve',
      'finalise:error',
      'reserve',
      'finalise:error',
      'reserve',
      'finalise:error',
    ]);
  });

  it('egress still applies: a provider whose allowlist lacks fixture.local cannot reach it in process', async () => {
    const { kit, budget } = makeKit({ inProcessHosts: { 'fixture.local': async () => Response.json({}) } });
    expect(await driveError(kit.request(healthReq({ providerId: 'searchapi' })))).toMatchObject({
      message: expect.stringContaining('[egress-denied]'),
    });
    expect(budget.reserveCalls).toBe(0);
  });
});

describe('createHttpKit construction checks (ruling 7, sec-003)', () => {
  it('refuses an in-process host other than fixture.local', () => {
    expect(() => makeKit({ inProcessHosts: { 'www.searchapi.io': async () => Response.json({}) } })).toThrow(
      /fixture\.local/,
    );
  });
  it('refuses inProcessHosts or limits.fixture unless syntheticAllowed is true', () => {
    expect(() =>
      makeKit({
        syntheticAllowed: false,
        inProcessHosts: { 'fixture.local': async () => Response.json({}) },
      }),
    ).toThrow(/syntheticAllowed/);
    expect(() => makeKit({ syntheticAllowed: false })).toThrow(/syntheticAllowed/);
    const limits = testLimits();
    expect(() =>
      makeKit({ syntheticAllowed: false, limits: { searchapi: limits.searchapi, fx: limits.fx } }),
    ).not.toThrow();
  });
  it('refuses a configured secret shorter than 8 characters', () => {
    expect(() => makeKit({ secrets: [new Secret('short')] })).toThrow(/at least 8/);
  });
  it('refuses an empty secrets list when a real provider is configured, and allows it for fixture/fx only', () => {
    expect(() => makeKit({ secrets: [] })).toThrow(/secrets/);
    expect(() => makeKit({ secrets: [new Secret('')] })).toThrow(/secrets/);
    const limits = testLimits();
    expect(() => makeKit({ secrets: [], limits: { fixture: limits.fixture, fx: limits.fx } })).not.toThrow();
  });
});

describe('body failures and redirects, driven in process (cost-001, arch-r2-005)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  const brokenBody = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"calendar": ['));
        c.error(new Error('connection reset'));
      },
    });

  // why: msw rejects the fetch itself when a mocked body stream errors, so a failure after the status line is driven
  // through the in-process seam, which hands the stream to the reader untouched (arch-r2-005).
  const fixtureBody = (billable: 'http-200' | 'never') =>
    makeKit({
      overrides: { fixture: { billable } },
      inProcessHosts: { 'fixture.local': async () => new Response(brokenBody(), { status: 200 }) },
    });
  const fixtureReq = () => req({ url: 'http://fixture.local/calendar', providerId: 'fixture', headers: {} });

  it('a body that fails after a billed 200 status → finalised unknown with status 200, non-retryable (cost-001)', async () => {
    const { kit, budget, events } = fixtureBody('http-200');
    expect(await driveError(kit.request(fixtureReq()))).toMatchObject({
      kind: 'network',
      retryable: false,
      message: expect.stringContaining('[body-read-failed]'),
    });
    expect(budget.sequence()).toEqual(['reserve', 'finalise:unknown']);
    expect(finals(events)[0]?.httpStatus).toBe(200);
  });

  it('the same failure on a free vendor → finalised error with the status, retried', async () => {
    const { kit, events } = fixtureBody('never');
    expect(await driveError(kit.request(fixtureReq()))).toMatchObject({ kind: 'network', retryable: true });
    expect(finals(events).map((e) => [e.outcome, e.httpStatus])).toEqual([
      ['error', 200],
      ['error', 200],
      ['error', 200],
    ]);
  });

  // why: msw 3 follows a mocked 3xx itself with the real fetch, whatever the request's redirect mode, so a mocked 302
  // would reach the network (seen in a scratch run); the redirect rule is proven here and by the classifyThrown case in
  // errors.test.ts, none of which leaves the process.
  it('a 3xx answer is refused: one attempt, finalised error with the status, nothing followed', async () => {
    let calls = 0;
    const { kit, budget } = makeKit({
      inProcessHosts: {
        'fixture.local': async () => {
          calls += 1;
          return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
        },
      },
    });
    const r = req({ url: 'http://fixture.local/calendar', providerId: 'fixture', headers: {} });
    expect(await driveError(kit.request(r))).toMatchObject({
      kind: 'upstream',
      retryable: false,
      httpStatus: 302,
      message: expect.stringContaining('[redirect-refused]'),
    });
    expect(calls).toBe(1);
    expect(budget.sequence()).toEqual(['reserve', 'finalise:error']);
  });

  it("every request is built with redirect: 'error' (the same init goes to fetch and to the in-process seam)", async () => {
    const seen: string[] = [];
    const { kit } = makeKit({
      inProcessHosts: {
        'fixture.local': async (r) => {
          seen.push(r.redirect);
          return Response.json({ synthetic: true, ok: true });
        },
      },
    });
    await drive(kit.request(req({ url: 'http://fixture.local/health', providerId: 'fixture', headers: {} })));
    expect(seen).toEqual(['error']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/egress.test.ts test/http/inProcess.test.ts`
Expected: FAIL — requests to non-allowlisted hosts reach `reserve` ("expected 1 to be 0") and the setup file's stray check reports them; the in-process cases reach msw's catch-all instead of the seam; the construction checks do not throw.

- [ ] **Step 3: Implement**

`src/fixture/constants.ts`:

```ts
/** The fixture provider's only host (spec §5.5, §9 item 2: its allowlist is fixture.local only). */
export const FIXTURE_HOST = 'fixture.local';
export const FIXTURE_ORIGIN = `http://${FIXTURE_HOST}`;
/** Scenario control: POST { rules } replaces the rules, DELETE clears them. */
export const SCENARIO_PATH = '/__fixture/scenario';
/** Hold release: POST { id, respond? } settles every request held under id. */
export const RELEASE_PATH = '/__fixture/release';
/** Per-request override header carrying a JSON-encoded FixtureResponse (direct tests only). */
export const SCENARIO_HEADER = 'x-fixture-scenario';
```

`src/http/egress.ts`:

```ts
import { ProviderError, type Secret } from '@gmt/core';
import { FIXTURE_HOST } from '../fixture/constants.js';
import { CREDENTIAL_HEADERS } from './cacheKey.js';
import { containsSecret } from './scrub.js';
import type { HttpKitDeps, HttpKitRequest, ProviderHttpLimits } from './types.js';

const PATH_ONLY = /^\/[^?#]*$/;
/** Shortest secret http-kit accepts; matches scripts/secret-scan.mjs (sec-003). */
export const MIN_SECRET_LENGTH = 8;

/**
 * Construction checks (ruling 7, sec-003): the in-process seam names fixture.local only; it and limits.fixture
 * need syntheticAllowed; every non-empty secret is at least MIN_SECRET_LENGTH long; a real provider needs at
 * least one secret, otherwise scrubbing, the cache-key filter, egress and the recorder would all be silent.
 */
export function assertKitConfig(
  deps: Pick<HttpKitDeps, 'inProcessHosts' | 'limits' | 'syntheticAllowed' | 'secrets'>,
): void {
  const hosts = Object.keys(deps.inProcessHosts ?? {});
  for (const host of hosts)
    if (host !== FIXTURE_HOST) throw new Error(`inProcessHosts may name only ${FIXTURE_HOST}, got ${host}`);
  if ((hosts.length > 0 || deps.limits.fixture !== undefined) && !deps.syntheticAllowed) {
    throw new Error('inProcessHosts and limits.fixture require syntheticAllowed (spec §5.5)');
  }
  const values = deps.secrets.map((s) => s.reveal()).filter((v) => v !== '');
  if (values.some((v) => v.length < MIN_SECRET_LENGTH))
    throw new Error(`every configured secret must be at least ${MIN_SECRET_LENGTH} characters`);
  if (
    (deps.limits.searchapi !== undefined || deps.limits.travelpayouts !== undefined) &&
    values.length === 0
  ) {
    throw new Error('secrets must be non-empty when a real provider is configured');
  }
}

/**
 * Spec §5.3 "Egress", checked before the cache, the ledger or the network: the provider has limits; no secret in
 * any form appears in the URL (checked first, so a key in a hostname never reaches a message); no userinfo; no
 * explicit port; https (plain http only for the fixture provider at fixture.local); the hostname is exactly in the
 * provider's allowlist (URL normalises case); `endpointPath` equals the URL path; `fx` and `fixture` requests carry
 * no credential header (ruling 13).
 */
export function assertEgress(
  r: HttpKitRequest,
  limits: ProviderHttpLimits | undefined,
  secrets: readonly Secret[],
): asserts limits is ProviderHttpLimits {
  const safePath =
    PATH_ONLY.test(r.endpointPath) && !containsSecret(r.endpointPath, secrets)
      ? r.endpointPath
      : '<invalid endpointPath>';
  function deny(why: string): never {
    throw new ProviderError({
      kind: 'upstream',
      retryable: false,
      providerId: r.providerId,
      message: `${r.providerId} ${safePath}: egress denied (${why}) [egress-denied]`,
    });
  }
  if (limits === undefined) deny('no HTTP limits configured for this provider');
  const u = r.url;
  if (containsSecret(u.href, secrets)) deny('a credential appears in the URL');
  if (u.username !== '' || u.password !== '') deny('userinfo in URL');
  if (u.port !== '') deny('explicit port');
  const schemeOk =
    u.protocol === 'https:' ||
    (u.protocol === 'http:' && r.providerId === 'fixture' && u.hostname === FIXTURE_HOST);
  if (!schemeOk) deny(`scheme ${u.protocol} not allowed`);
  if (!limits.hosts.includes(u.hostname)) deny(`host ${u.hostname} not in the allowlist`);
  if (!PATH_ONLY.test(r.endpointPath) || r.endpointPath !== u.pathname)
    deny('endpointPath must equal the URL path');
  if (r.providerId === 'fx' || r.providerId === 'fixture') {
    for (const name of Object.keys(r.headers))
      if (CREDENTIAL_HEADERS.has(name.toLowerCase()))
        deny(`credential header ${name.toLowerCase()} on a ${r.providerId} request`);
  }
}
```

`src/http/httpKit.ts`: add `import { assertEgress, assertKitConfig } from './egress.js';`, then replace

```ts
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  const limiters = new Map<HttpProviderId, ProviderLimiter>();
```

with

```ts
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  assertKitConfig(deps);
  const limiters = new Map<HttpProviderId, ProviderLimiter>();
```

and replace

```ts
    const limits = deps.limits[r.providerId];
    const limiter = limiters.get(r.providerId);
    if (limits === undefined || limiter === undefined) {
      throw new ProviderError({ kind: 'upstream', retryable: false, providerId: r.providerId, message: `${r.providerId}: no HTTP limits configured [egress-denied]` });
    }
```

with

```ts
    if (r.signal.aborted) throw new AbortedError();
    const limits = deps.limits[r.providerId];
    assertEgress(r, limits, deps.secrets);
    const limiter = limiters.get(r.providerId);
    // why: unreachable after assertEgress (every configured id has a limiter); kept for type narrowing.
    if (limiter === undefined) throw new Error(`no limiter for ${r.providerId}`);
```

`src/http/attempt.ts`: dispatch through the seam. Replace

```ts
    res = await raceAbort(fetch(r.url, init), signal);
```

with

```ts
    // why: spec §5.3 rev 11 — the gated in-process seam (fixture.local only); every other host goes to globalThis.fetch.
    const inProcess = deps.inProcessHosts?.[r.url.hostname];
    res = await raceAbort(inProcess ? inProcess(new Request(r.url, init)) : fetch(r.url, init), signal);
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/providers exec vitest run test/http`
Expected: PASS, 90 tests.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: egress allowlist, construction checks and the gated in-process fixture seam (spec §5.3, §5.5)"
```

### Task 4.6: Cache path and in-flight dedup with ledgered joiners (final `httpKit.ts`)

**Files:**
- Replace: `src/http/httpKit.ts`
- Test: `test/http/cache.test.ts`

**Interfaces:**
- Consumes: `ResponseCache`, `BudgetGuard.recordCacheHit`, `BudgetExceeded` (WP0); `canonicalCacheKey` (Task 4.2); `raceAbort` (Task 4.4).
- Produces: the full spec §5.3 pipeline; `HttpKitResponse.cacheKey`; `stats().inFlight` = in-flight deduplicated requests.

Rules (spec §5.3 rev 11, ruling 4–5): a cache hit records a non-billable `recordCacheHit` row with the caller's `tileIndex` and returns the original `storedAt` as `fetchedAt`; only a successful body that is neither `null` nor empty text, and that the request's `accept` admits, is stored; a request identical to one in flight joins it, records its own cache-hit row once the shared call succeeds (not for `fx`), is raced against its own signal, and re-issues the request itself when the shared call ends in the leader's `AbortedError` or in a `BudgetExceeded` on an `execution-*` scope of another execution.

- [ ] **Step 1: Write the failing test**

`test/http/cache.test.ts`:

```ts
import { AbortedError, BudgetExceeded } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH, SENTINELS } from '../fakes.js';
import { respondAfter, server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const URL1 = `${SEARCH}?engine=google_flights_calendar&departure_id=LHR&arrival_id=JFK`;
const slow = (body: unknown = { once: true }) =>
  server.use(
    http.get(SEARCH, ({ request }) =>
      respondAfter(
        request,
        2000,
        () => new HttpResponse(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      ),
    ),
  );
// why: both outcomes are awaited together, so neither promise rejects without a handler attached (arch-r2-006).
const both = (a: Promise<unknown>, b: Promise<unknown>) =>
  drive(Promise.all([a.catch((e: unknown) => e), b.catch((e: unknown) => e)]));
const cacheHits = (events: ReturnType<typeof makeKit>['events']) =>
  events.flatMap((e) => (e.type === 'cache-hit' ? [e] : []));

describe('cache path (spec §5.3 pipeline)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('a hit makes zero upstream calls, records a non-billable cache hit with the caller’s tileIndex, returns the original storedAt', async () => {
    const { kit, budget, cache, clock, events } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ calendar: [1] })));
    const first = await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    clock.advance(30 * 60_000);
    const second = await drive(
      kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 }, executionId: 'exec-2', tileIndex: 5 })),
    );
    expect(budget.count('fetch')).toBe(1);
    expect(second).toMatchObject({
      fromCache: true,
      fetchedAt: '2026-10-14T15:00:00.000Z',
      body: { calendar: [1] },
      cacheKey: first.cacheKey,
    });
    expect(cacheHits(events)).toEqual([
      expect.objectContaining({
        providerId: 'searchapi',
        executionId: 'exec-2',
        tileIndex: 5,
        endpointPath: '/api/v1/search',
      }),
    ]);
    expect(cache.sets).toHaveLength(1);
  });

  it('a miss stores the scrubbed body with the request TTL and storedAt = now', async () => {
    const { kit, cache } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ echo: `key ${SENTINELS.searchapi.reveal()}` })));
    const res = await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    expect(cache.sets).toEqual([
      {
        key: res.cacheKey,
        body: { echo: 'key [redacted]' },
        ttlSeconds: 600,
        storedAt: '2026-10-14T15:00:00.000Z',
      },
    ]);
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

  it('an empty 200 body is never cached, so the next identical request asks the vendor again (prov-004)', async () => {
    const { kit, cache, budget } = makeKit();
    server.use(http.get(SEARCH, () => new HttpResponse('', { status: 200 })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600 } })));
    expect(cache.sets).toHaveLength(0);
    expect(budget.count('fetch')).toBe(2);
  });

  it('a body the adapter rejects through accept is not cached (pie-004)', async () => {
    const { kit, cache, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ success: false })));
    const accept = (b: unknown) =>
      typeof b === 'object' && b !== null && 'success' in b && b.success === true;
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600, accept } })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 600, accept } })));
    expect(cache.sets).toHaveLength(0);
    expect(budget.count('fetch')).toBe(2);
  });

  it("'fx' requests are never ledgered: no reserve, no cache-hit row", async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get('https://api.frankfurter.dev/v1/latest', () => HttpResponse.json({ rates: { USD: 1.3 } })),
    );
    const r = req({
      url: 'https://api.frankfurter.dev/v1/latest?from=GBP',
      providerId: 'fx',
      headers: {},
      cache: { ttlSeconds: 3600 },
    });
    await drive(kit.request(r));
    await drive(kit.request(r));
    expect([budget.reserveCalls, budget.count('cache-hit'), budget.count('fetch')]).toEqual([0, 0, 1]);
  });
});

describe('in-flight dedup (spec §5.3 rev 11, ruling 4)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('two concurrent identical requests: one reserve, one fetch, and a cache-hit row for the joiner’s own execution and tile', async () => {
    const { kit, budget, events } = makeKit();
    slow();
    const a = kit.request(req({ url: URL1, executionId: 'exec-A', tileIndex: 1 }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B', tileIndex: 2 }));
    expect(kit.stats().inFlight).toBe(1);
    const [ra, rb] = await drive(Promise.all([a, b]));
    expect([budget.reserveCalls, budget.count('fetch')]).toEqual([1, 1]);
    expect(cacheHits(events)).toEqual([
      expect.objectContaining({ executionId: 'exec-B', tileIndex: 2, endpointPath: '/api/v1/search' }),
    ]);
    expect(rb).toMatchObject({ body: ra.body, fetchedAt: ra.fetchedAt, fromCache: true });
    expect(ra.fromCache).toBe(false);
    expect(kit.stats().inFlight).toBe(0);
  });

  it('a joiner that aborts gets AbortedError on its own signal; the leader is unaffected and the joiner writes no row', async () => {
    const { kit, events } = makeKit();
    slow();
    const ac = new AbortController();
    const a = kit.request(req({ url: URL1, executionId: 'exec-A' }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B', signal: ac.signal }));
    setTimeout(() => ac.abort(), 500);
    const [ra, eb] = await both(a, b);
    expect(eb).toBeInstanceOf(AbortedError);
    expect(ra).toMatchObject({ body: { once: true } });
    expect(cacheHits(events)).toEqual([]);
  });

  it('when the leader is aborted the live joiner re-issues the request itself and succeeds', async () => {
    const { kit, budget } = makeKit();
    slow();
    const ac = new AbortController();
    const a = kit.request(req({ url: URL1, executionId: 'exec-A', signal: ac.signal }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B' }));
    setTimeout(() => ac.abort(), 500);
    const [ea, rb] = await both(a, b);
    expect(ea).toBeInstanceOf(AbortedError);
    expect(rb).toMatchObject({ body: { once: true } });
    expect(budget.sequence().filter((s) => s !== 'fetch')).toEqual([
      'reserve',
      'finalise:unknown',
      'reserve',
      'finalise:ok',
    ]);
  });

  it('a BudgetExceeded on the leader’s own execution scope makes a joiner from another execution re-issue', async () => {
    const { kit, budget } = makeKit();
    slow();
    budget.refuse = (p) =>
      p.executionId === 'exec-A'
        ? new BudgetExceeded({ scope: 'execution-calls', cap: 0, current: 0, requested: 1 })
        : null;
    const a = kit.request(req({ url: URL1, executionId: 'exec-A' }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B' }));
    const [ea, rb] = await both(a, b);
    expect(ea).toBeInstanceOf(BudgetExceeded);
    expect(rb).toMatchObject({ body: { once: true } });
    expect(budget.count('fetch')).toBe(1);
  });

  it('a BudgetExceeded on a shared provider scope reaches the joiner unchanged (no re-issue)', async () => {
    const { kit, budget } = makeKit();
    slow();
    budget.refuse = () =>
      new BudgetExceeded({
        scope: 'provider-month',
        cap: 10_000,
        current: 10_000,
        requested: 1,
        providerId: 'searchapi',
      });
    const a = kit.request(req({ url: URL1, executionId: 'exec-A' }));
    const b = kit.request(req({ url: URL1, executionId: 'exec-B' }));
    const [ea, eb] = await both(a, b);
    expect(ea).toBeInstanceOf(BudgetExceeded);
    expect(eb).toBeInstanceOf(BudgetExceeded);
    expect([budget.reserveCalls, budget.count('fetch')]).toEqual([1, 0]);
  });
});

describe('BudgetExceeded never reaches the network (spec §9 item 2)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('refused on the first attempt: thrown before any msw hit, never retried', async () => {
    const { kit, budget } = makeKit();
    const refusal = new BudgetExceeded({
      scope: 'provider-month',
      cap: 10_000,
      current: 10_000,
      requested: 1,
      providerId: 'searchapi',
    });
    budget.refuse = () => refusal;
    server.use(http.get(SEARCH, () => HttpResponse.json({})));
    expect(await driveError(kit.request(req({ url: URL1 })))).toBe(refusal);
    expect([budget.reserveCalls, budget.count('fetch')]).toEqual([1, 0]);
  });

  it('refused on the retry attempt after a 503: no second fetch, the BudgetExceeded instance is thrown (test-003)', async () => {
    const { kit, budget } = makeKit();
    const refusal = new BudgetExceeded({ scope: 'execution-calls', cap: 1, current: 1, requested: 1 });
    budget.refuse = (p) => (p.httpAttempt === 2 ? refusal : null);
    server.use(http.get(SEARCH, () => HttpResponse.json({}, { status: 503 })));
    expect(await driveError(kit.request(req({ url: URL1 })))).toBe(refusal);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:error']);
    expect(budget.reserveCalls).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/cache.test.ts`
Expected: FAIL — the second request reaches msw ("expected 2 to be 1"), `cache.sets` is empty, `stats().inFlight` counts 2, and no cache-hit rows are written.

- [ ] **Step 3: Implement**

`src/http/httpKit.ts` (replace; final except the log lines Task 4.8 adds):

```ts
import { AbortedError, BudgetExceeded, isoDateTimeOfEpochMs, ProviderError } from '@gmt/core';
import pRetry from 'p-retry';
import { type AttemptResult, raceAbort, runAttempt } from './attempt.js';
import { canonicalCacheKey } from './cacheKey.js';
import { assertEgress, assertKitConfig } from './egress.js';
import { createLimiter, HOUR_MS, type ProviderLimiter } from './limiter.js';
import { sleep } from './sleep.js';
import type {
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
} from './types.js';

export type {
  FixtureRecorder,
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
  ResponseFacts,
} from './types.js';

/** Spec §5.3: p-retry, max 3 attempts. */
export const MAX_ATTEMPTS = 3;
/** Exponential backoff base: 1–2 s before attempt 2, 2–4 s before attempt 3 (randomised). */
export const BACKOFF_BASE_MS = 1000;
const HTTP_PROVIDER_IDS = [
  'travelpayouts',
  'searchapi',
  'fixture',
  'fx',
] as const satisfies readonly HttpProviderId[];

/** Only a ProviderError marked retryable is retried; auth, quota, parse and BudgetExceeded never are. */
export function isRetryable(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.retryable;
}

/** A body worth caching: not null, not empty text, and admitted by the adapter's veto (spec §5.3 rev 11). */
function shouldCache(cache: { accept?: (body: unknown) => boolean }, body: unknown): boolean {
  if (body === null || body === '') return false;
  return cache.accept === undefined ? true : cache.accept(body);
}

interface Flight {
  promise: Promise<HttpKitResponse>;
  leader: HttpKitRequest;
}

/**
 * Spec §5.3 (rev 11) http-kit over globalThis.fetch; the only other transport is the gated `inProcessHosts` seam
 * for fixture.local. 'fx' is never ledgered.
 *
 *   egress → cache lookup ─hit─▶ recordCacheHit → { body, fetchedAt: storedAt }
 *     │miss
 *   in-flight dedup (joiners ledger a cache hit, own their abort) → p-retry (3 attempts) {
 *       limiter (queue age, abort) → budget.reserve → fetch → reservation.finalise → classify
 *   } → cache.set when cacheable → { body, fetchedAt: now }
 *
 * Throws ProviderError (classified), BudgetExceeded (from reserve, before any fetch), AbortedError.
 */
export function createHttpKit(deps: HttpKitDeps): HttpKit {
  assertKitConfig(deps);
  const limiters = new Map<HttpProviderId, ProviderLimiter>();
  const since = isoDateTimeOfEpochMs(Date.parse(deps.clock.now()) - HOUR_MS);
  for (const id of HTTP_PROVIDER_IDS) {
    const l = deps.limits[id];
    if (l === undefined) continue;
    // why: seed the hourly reservoir from the ledger so a restart inside an hour does not grant a fresh one (ruling 9); fx is not ledgered.
    limiters.set(
      id,
      createLimiter(l, { usedThisHour: id === 'fx' ? 0 : deps.budget.recentCalls(id, since) }),
    );
  }
  const inFlight = new Map<string, Flight>();

  async function upstream(
    r: HttpKitRequest,
    limits: ProviderHttpLimits,
    limiter: ProviderLimiter,
    key: string,
  ): Promise<HttpKitResponse> {
    const run = {
      signal: r.signal,
      maxWaitMs: limits.maxWaitSeconds * 1000,
      providerId: r.providerId,
      endpointPath: r.endpointPath,
    };
    let result: AttemptResult;
    try {
      result = await pRetry(
        (attempt) =>
          limiter.run(
            () =>
              runAttempt(deps, r, limits, {
                attempt,
                secondsToHourRefresh: () => limiter.secondsToHourRefresh(),
              }),
            run,
          ),
        {
          retries: MAX_ATTEMPTS - 1,
          minTimeout: BACKOFF_BASE_MS,
          factor: 2,
          // why: jitter keeps tiles that failed together from retrying in lockstep; tests assert ranges.
          randomize: true,
          signal: r.signal,
          shouldRetry: ({ error }) => isRetryable(error),
          // why: p-retry calls onFailedAttempt even when shouldRetry will refuse, so the wait checks retryability
          // and remaining attempts itself; the sleep is abortable.
          onFailedAttempt: async ({ error, retriesLeft }) => {
            if (retriesLeft > 0 && isRetryable(error) && error.retryAfterSeconds !== undefined)
              await sleep(error.retryAfterSeconds * 1000, r.signal);
          },
        },
      );
    } catch (err) {
      // why: p-retry rethrows the signal's reason on abort; the engine contract is AbortedError (spec §5.2).
      if (r.signal.aborted && !(err instanceof AbortedError)) throw new AbortedError();
      throw err;
    }
    if (r.cache !== 'never' && shouldCache(r.cache, result.body))
      deps.cache.set(key, result.body, r.cache.ttlSeconds, result.fetchedAt);
    return {
      status: result.status,
      body: result.body,
      fetchedAt: result.fetchedAt,
      fromCache: false,
      cacheKey: key,
    };
  }

  async function join(r: HttpKitRequest, flight: Flight): Promise<HttpKitResponse> {
    let shared: HttpKitResponse;
    try {
      shared = await raceAbort(flight.promise, r.signal);
    } catch (err) {
      if (r.signal.aborted) throw new AbortedError();
      const leaderAborted = err instanceof AbortedError;
      const othersCap =
        err instanceof BudgetExceeded &&
        err.scope.startsWith('execution-') &&
        flight.leader.executionId !== r.executionId;
      // why: the leader's cancellation or its own execution cap says nothing about this caller (ruling 4);
      // it re-issues under its own signal and its own scopes.
      if (leaderAborted || othersCap) return request(r);
      throw err;
    }
    // why: parity counts first-attempt rows plus cache hits per tile (spec §8.1), so a joiner leaves its own row.
    if (r.providerId !== 'fx')
      deps.budget.recordCacheHit({
        providerId: r.providerId,
        executionId: r.executionId,
        tileIndex: r.tileIndex,
        endpointPath: r.endpointPath,
      });
    return { ...shared, fromCache: true };
  }

  async function request(r: HttpKitRequest): Promise<HttpKitResponse> {
    if (r.signal.aborted) throw new AbortedError();
    const limits = deps.limits[r.providerId];
    assertEgress(r, limits, deps.secrets);
    const limiter = limiters.get(r.providerId);
    // why: unreachable after assertEgress (every configured id has a limiter); kept for type narrowing.
    if (limiter === undefined) throw new Error(`no limiter for ${r.providerId}`);
    const key = canonicalCacheKey(r, deps.secrets);

    if (r.cache !== 'never') {
      const hit = deps.cache.get(key);
      if (hit !== undefined) {
        // why: spec §5.3 — cache hits are ledgered as non-billable rows so parity counts them; 'fx' is not ledgered.
        if (r.providerId !== 'fx')
          deps.budget.recordCacheHit({
            providerId: r.providerId,
            executionId: r.executionId,
            tileIndex: r.tileIndex,
            endpointPath: r.endpointPath,
          });
        return { status: 200, body: hit.body, fetchedAt: hit.storedAt, fromCache: true, cacheKey: key };
      }
    }

    const flight = inFlight.get(key);
    if (flight !== undefined) return join(r, flight);
    const promise: Promise<HttpKitResponse> = upstream(r, limits, limiter, key).finally(() => {
      if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    });
    inFlight.set(key, { promise, leader: r });
    return promise;
  }

  return { request, stats: () => ({ inFlight: inFlight.size }) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http`
Expected: PASS, 104 tests.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: cache path with accept veto, in-flight dedup with ledgered joiners that own their abort (spec §5.3)"
```

### Task 4.7: Recorder — the pinned `RecordedFixture` format, fails closed, positional session-scoped placeholders, strict loaders

**Files:**
- Create: `src/http/recorder.ts`, `fixtures/recorded/.gitkeep`
- Modify: `src/http/attempt.ts`, the repository `.gitignore`
- Test: `test/http/recorder.test.ts`

**Interfaces:**
- Consumes: `Clock`, `Secret`, `isoDateTimeSchema` (WP0); `containsSecret`, `stripUrl`, `CREDENTIAL_HEADERS` (Task 4.2).
- Produces: `createRecorder`, `RecorderRefusedError`, `RecordedFixture`, `contentHash`, `canonicalJson`, `withContentHash`, `verifyContentHash`, `loadRecordedJson(path, root?)`, `loadRecordedFixture(path, root?)`, `defaultRecordedRoot()`; http-kit calls `deps.recorder.record` for every attempt that received an HTTP response when `r.recordFixtures` is true.

File layout and body: see "Interfaces produced". Rules (spec §5.3 "Recorder", §5.5; prov-002, prov-003, prov-006, prov-007, sec-008, test-005):

- **Fails closed.** If any configured secret, in any form, would be written to the recording or the `.raw.json`, or appears in a non-credential request header, the recorder throws `RecorderRefusedError` and writes nothing. Credential headers are dropped entirely.
- **Placeholders are positional.** A token is any non-empty string under a key matching `/^[a-z0-9]+(?:_[a-z0-9]+)*_token$/` (`departure_token`, `booking_token`, `next_page_token`) in a body, or the value of a query parameter with such a name (in the request URL or inside a URL string in a body). Only those positions are rewritten, to `<key:n@session>`; if a raw token value appears anywhere else in the recording, the recorder refuses rather than rewrite unrelated text.
- **Session and time.** `session` is the recorder's creation instant plus a random suffix and is stored in every file and every placeholder; `recordedAt` is the `fetchedAt` http-kit passes with each attempt, so it is the instant the response arrived whatever clock the recorder holds (prov-r2-003).
- **Tamper-evidence, not a signature.** `contentSha256` = sha256 over `canonicalJson` of the file without that field. It detects a file edited after recording; it does not authenticate the recorder.
- **Strict loaders.** `loadRecordedJson(path, root = defaultRecordedRoot())` requires the real path inside the real root (which must end in `fixtures/recorded`), no `synthetic` key, a string `recordedAt` and a matching hash; `loadRecordedFixture` additionally requires every `RecordedFixture` field with its type, `recordedBy` and `session` non-empty, `recordedAt` in `toISOString()` form, the file at `<root>/<providerId>/<endpointPath with / → _>/`, and a file name whose date and 12-hex prefix match `recordedAt` and `contentSha256`. It builds the result field by field (no cast).

- [ ] **Step 1: Write the failing test**

`test/http/recorder.test.ts`:

```ts
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalJson,
  contentHash,
  createRecorder,
  loadRecordedFixture,
  loadRecordedJson,
  RecorderRefusedError,
  verifyContentHash,
  withContentHash,
} from '../../src/http/recorder.js';
import { ALL_SECRETS, makeKit, req, SEARCH, SENTINELS } from '../fakes.js';
import { obj } from '../support/guards.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const T0 = '2026-10-14T15:00:00.000Z';
const key = SENTINELS.searchapi.reveal();
function tree(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'gmt-rec-')), 'fixtures', 'recorded');
  mkdirSync(root, { recursive: true });
  return root;
}
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.endsWith('.raw.json'))
    .map((d) => join(d.parentPath, d.name))
    .sort();
}
const recorder = (root: string, at = T0) =>
  createRecorder({
    root,
    secrets: ALL_SECRETS,
    clock: fixedClock(asIsoDateTime(at)),
    recordedBy: 'wp04-test',
  });
const call = (url: string, body: unknown, over: Partial<Parameters<typeof req>[0]> = {}, status = 200) => ({
  providerId: 'searchapi' as const,
  endpointPath: '/api/v1/search',
  request: req({ url, headers: { accept: 'application/json', authorization: `Bearer ${key}` }, ...over }),
  status,
  body,
  fetchedAt: asIsoDateTime(T0),
});
const SESSION = /^20261014T150000000Z-[0-9a-f]{6}$/;
const refusedAndEmpty = async (root: string, p: Promise<string>) => {
  expect(await p.catch((e: unknown) => e)).toBeInstanceOf(RecorderRefusedError);
  expect(readdirSync(root)).toEqual([]);
};
function parsed(path: string): Record<string, unknown> {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return obj(v);
}

describe('createRecorder (spec §5.3 "Recorder", §5.5)', () => {
  it('writes <root>/<provider>/<endpointPath with / → _>/<date>-<sha12>.json plus a .raw.json, drops credential headers, returns the path', async () => {
    const root = tree();
    const path = await recorder(root).record(
      call(`${SEARCH}?engine=google_flights&departure_id=LHR`, { price: 41200 }),
    );
    expect(path).toMatch(/searchapi\/_api_v1_search\/2026-10-14-[0-9a-f]{12}\.json$/);
    expect(files(root)).toEqual([path]);
    expect(existsSync(path.replace(/\.json$/, '.raw.json'))).toBe(true);
    const f = loadRecordedFixture(path, root);
    expect(f).toEqual({
      recordedAt: T0,
      recordedBy: 'wp04-test',
      providerId: 'searchapi',
      endpointPath: '/api/v1/search',
      request: {
        method: 'GET',
        url: `${SEARCH}?engine=google_flights&departure_id=LHR`,
        headers: { accept: 'application/json' },
        body: null,
      },
      status: 200,
      body: { price: 41200 },
      placeholders: {},
      session: expect.stringMatching(SESSION),
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const { contentSha256, ...rest } = f;
    expect(contentHash(rest)).toBe(contentSha256);
    expect(readFileSync(path, 'utf8')).not.toMatch(/authorization|x-access-token/i);
  });

  it.each([
    ['raw in the response body', () => call(SEARCH, { echo: `Invalid key ${key}` })],
    [
      'URL-encoded in the response body',
      () => call(SEARCH, { next: `https://x.example/?k=${encodeURIComponent(SENTINELS.smtp.reveal())}` }),
    ],
    [
      'base64 in the response body',
      () => call(SEARCH, { blob: Buffer.from(SENTINELS.basicAuth.reveal()).toString('base64') }),
    ],
    ['in the request URL', () => call(`${SEARCH}?api_key=${key}`, {})],
    ['in the request body', () => call(SEARCH, {}, { method: 'POST', body: JSON.stringify({ key }) })],
    ['in a non-credential header value', () => call(SEARCH, {}, { headers: { 'x-custom': key } })],
  ])('fails closed on a secret %s: throws and writes nothing (test-005, sec-002)', async (_label, make) => {
    const root = tree();
    await refusedAndEmpty(root, recorder(root).record(make()));
  });

  it('strips search_metadata URLs to origin + path; a raw body carrying a key is refused, not written', async () => {
    const root = tree();
    const path = await recorder(root).record(
      call(SEARCH, { search_metadata: { request_url: `${SEARCH}?engine=google_flights&id=s1`, id: 's1' } }),
    );
    expect(obj(loadRecordedFixture(path, root).body).search_metadata).toEqual({
      request_url: SEARCH,
      id: 's1',
    });
    const other = tree();
    await refusedAndEmpty(
      other,
      recorder(other).record(call(SEARCH, { search_metadata: { request_url: `${SEARCH}?api_key=${key}` } })),
    );
  });

  it('replaces tokens with session placeholders, consistent from a response to the next request', async () => {
    const root = tree();
    const rec = recorder(root);
    const p1 = await rec.record(
      call(`${SEARCH}?engine=google_flights`, {
        best_flights: [{ departure_token: 'RAW-TOKEN-AAAA' }, { departure_token: 'RAW-TOKEN-BBBB' }],
      }),
    );
    const p2 = await rec.record(
      call(`${SEARCH}?engine=google_flights&departure_token=RAW-TOKEN-BBBB`, {
        booking_options: [{ booking_token: 'RAW-TOKEN-CCCC' }],
      }),
    );
    const [one, two] = [loadRecordedFixture(p1, root), loadRecordedFixture(p2, root)];
    expect(JSON.stringify([one, two])).not.toContain('RAW-TOKEN');
    const s = one.session;
    expect(s).toMatch(SESSION);
    expect(two.session).toBe(s);
    expect(one.body).toEqual({
      best_flights: [
        { departure_token: `<departure_token:0@${s}>` },
        { departure_token: `<departure_token:1@${s}>` },
      ],
    });
    expect(one.placeholders).toEqual({
      [`<departure_token:0@${s}>`]: 'departure_token',
      [`<departure_token:1@${s}>`]: 'departure_token',
    });
    expect(new URL(two.request.url).searchParams.get('departure_token')).toBe(`<departure_token:1@${s}>`);
    expect(two.body).toEqual({ booking_options: [{ booking_token: `<booking_token:0@${s}>` }] });
  });

  it('rewrites only token positions, including token-named parameters inside URL strings; other text is untouched (prov-007)', async () => {
    const root = tree();
    const t = 'RAW-LONG-TOKEN-0001';
    const path = await recorder(root).record(
      call(SEARCH, {
        departure_token: t,
        next: `${SEARCH}?departure_token=${t}&engine=google_flights`,
        label: 'flight 0001 on page 2',
      }),
    );
    const body = obj(loadRecordedFixture(path, root).body);
    expect(body.label).toBe('flight 0001 on page 2');
    expect(String(body.departure_token)).toMatch(/^<departure_token:0@/);
    expect(new URL(String(body.next)).searchParams.get('departure_token')).toBe(body.departure_token);
  });

  it('refuses rather than rewrite when a token value also appears outside a token position (prov-007)', async () => {
    const root = tree();
    await refusedAndEmpty(root, recorder(root).record(call(SEARCH, { next_page_token: 'A1', seat: 'A1' })));
  });

  it('two sessions never share a session id or a placeholder, even when started at the same instant (prov-r2-001)', async () => {
    const r1 = tree();
    const r2 = tree();
    const a = loadRecordedFixture(
      await recorder(r1).record(call(SEARCH, { departure_token: 'RAW-TOKEN-AAAA' })),
      r1,
    );
    const b = loadRecordedFixture(
      await recorder(r2).record(call(SEARCH, { departure_token: 'RAW-TOKEN-AAAA' })),
      r2,
    );
    expect(a.session).not.toBe(b.session);
    expect(Object.keys(a.placeholders)).not.toEqual(Object.keys(b.placeholders));
  });

  it('is deterministic apart from the session id: a fresh recorder at the same instant writes the same recording', async () => {
    const run = async () => {
      const root = tree();
      const f = loadRecordedFixture(
        await recorder(root).record(call(SEARCH, { best_flights: [{ departure_token: 'RAW-TOKEN-AAAA' }] })),
        root,
      );
      const { session, contentSha256: _hash, ...rest } = f;
      return JSON.stringify(rest).replaceAll(session, '<session>');
    };
    expect(await run()).toEqual(await run());
  });

  it('refuses a root outside fixtures/recorded, an empty recordedBy, an unsafe endpointPath and the synthetic fixture provider', async () => {
    const clock = fixedClock(asIsoDateTime(T0));
    expect(() =>
      createRecorder({
        root: mkdtempSync(join(tmpdir(), 'gmt-x-')),
        secrets: ALL_SECRETS,
        clock,
        recordedBy: 'x',
      }),
    ).toThrow(RecorderRefusedError);
    expect(() => createRecorder({ root: tree(), secrets: ALL_SECRETS, clock, recordedBy: ' ' })).toThrow(
      RecorderRefusedError,
    );
    const root = tree();
    await refusedAndEmpty(root, recorder(root).record({ ...call(SEARCH, {}), providerId: 'fixture' }));
    await refusedAndEmpty(
      root,
      recorder(root).record({ ...call(SEARCH, {}), endpointPath: '/api/../x?y=1' }),
    );
  });

  it('canonicalJson has a known answer: keys sorted at every level, undefined dropped (prov-009)', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null, u: undefined } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('withContentHash has a known answer computed outside the code (prov-009)', () => {
    // printf '%s' '{"provider":"fixture","recordedAt":"2026-10-14"}' | shasum -a 256
    expect(withContentHash({ recordedAt: '2026-10-14', provider: 'fixture' }).contentSha256).toBe(
      'de30e2add53421370edd2145b64e66cc9ef3809b91667c70d0e694e4cfd58c73',
    );
  });
});

describe('recorded-tree loaders (spec §9 item 2 fixture-tree rules)', () => {
  const rewrite = (
    path: string,
    mutate: (o: Record<string, unknown>) => Record<string, unknown>,
    to = path,
  ): string => {
    writeFileSync(to, JSON.stringify(withContentHash(mutate(parsed(path)))));
    return to;
  };

  it('round-trips a recording and refuses it once hand-edited (tamper-evidence)', async () => {
    const root = tree();
    const path = await recorder(root).record(call(SEARCH, { price: 41200 }));
    expect(loadRecordedFixture(path, root).body).toEqual({ price: 41200 });
    writeFileSync(path, readFileSync(path, 'utf8').replace('41200', '1'));
    expect(() => loadRecordedFixture(path, root)).toThrow(/content hash mismatch/);
  });

  it('refuses a file outside the recorded root and a synthetic file inside it', () => {
    const root = tree();
    const outside = join(mkdtempSync(join(tmpdir(), 'gmt-o-')), 'x.json');
    writeFileSync(outside, JSON.stringify(withContentHash({ recordedAt: T0, recordedBy: 'x' })));
    expect(() => loadRecordedJson(outside, root)).toThrow(/recorded root/);
    const syn = join(root, 'syn.json');
    writeFileSync(syn, JSON.stringify(withContentHash({ synthetic: true, recordedAt: T0 })));
    expect(() => loadRecordedJson(syn, root)).toThrow(/synthetic/);
  });

  it.each([
    [
      'a missing recordedBy',
      (o: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'recordedBy')),
      /recordedBy/,
    ],
    ['an empty recordedBy', (o: Record<string, unknown>) => ({ ...o, recordedBy: '  ' }), /recordedBy/],
    [
      'a malformed recordedAt',
      (o: Record<string, unknown>) => ({ ...o, recordedAt: '2026-10-14T15:00:00Z' }),
      /recordedAt/,
    ],
    [
      'a providerId that is not its directory',
      (o: Record<string, unknown>) => ({ ...o, providerId: 'travelpayouts' }),
      /not under/,
    ],
    [
      'a recordedAt whose date is not the file name’s',
      (o: Record<string, unknown>) => ({ ...o, recordedAt: '2026-10-15T15:00:00.000Z' }),
      /file name/,
    ],
    [
      'a missing session',
      (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'session')),
      /session/,
    ],
    [
      'headers that are not all strings',
      (o: Record<string, unknown>) => ({ ...o, request: { ...obj(o.request), headers: { accept: 1 } } }),
      /headers/,
    ],
  ])('loadRecordedFixture refuses %s (prov-002)', async (_label, mutate, message) => {
    const root = tree();
    const path = rewrite(await recorder(root).record(call(SEARCH, { price: 1 })), mutate);
    expect(() => loadRecordedFixture(path, root)).toThrow(message);
  });

  it('refuses a file whose name does not carry its hash prefix', async () => {
    const root = tree();
    const path = await recorder(root).record(call(SEARCH, { price: 1 }));
    const renamed = path.replace(/-[0-9a-f]{12}\.json$/, '-000000000000.json');
    copyFileSync(path, renamed);
    expect(() => loadRecordedFixture(renamed, root)).toThrow(/file name/);
  });

  it('loadRecordedJson accepts a hashed allowlist file (no recordedBy); verifyContentHash rejects an unhashed object', () => {
    const root = tree();
    mkdirSync(join(root, 'searchapi'));
    const p = join(root, 'searchapi', 'params-2026-10-14.json');
    writeFileSync(
      p,
      JSON.stringify(withContentHash({ provider: 'searchapi', recordedAt: '2026-10-14', endpoints: {} })),
    );
    expect(loadRecordedJson(p, root)).toMatchObject({ provider: 'searchapi' });
    expect(verifyContentHash({ provider: 'searchapi' })).toBe(false);
    expect(() => loadRecordedFixture(p, root)).toThrow();
  });
});

describe('http-kit recording hook', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('records every attempt that got a response, error bodies included, only when recordFixtures is true; recordedAt is when the kit received it (prov-r2-003)', async () => {
    const root = tree();
    // why: the recorder's own clock is an hour off and the kit's has moved on, so only fetchedAt can produce the asserted instant.
    const { kit, clock } = makeKit({ recorder: recorder(root, '2026-10-14T16:00:00.000Z') });
    clock.advance(30 * 60_000);
    let n = 0;
    server.use(
      http.get(SEARCH, () =>
        ++n === 1
          ? HttpResponse.json({ error: 'slow down' }, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json({ ok: n }),
      ),
    );
    await drive(kit.request(req({ url: `${SEARCH}?engine=a`, recordFixtures: true })));
    await drive(kit.request(req({ url: `${SEARCH}?engine=b`, recordFixtures: false })));
    const recorded = files(root).map((f) => loadRecordedFixture(f, root));
    expect(recorded.map((f) => f.status).sort()).toEqual([200, 429]);
    expect(recorded.every((f) => f.recordedAt === clock.now())).toBe(true);
  });

  it('a recorder refusal fails the request loudly', async () => {
    const { kit } = makeKit({ recorder: recorder(tree()) });
    server.use(http.get(SEARCH, () => HttpResponse.json({ echo: key })));
    expect(await driveError(kit.request(req({ url: SEARCH, recordFixtures: true })))).toBeInstanceOf(
      RecorderRefusedError,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/recorder.test.ts`
Expected: FAIL — `Failed to load url ../../src/http/recorder.js`.

- [ ] **Step 3: Implement**

`src/http/recorder.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Clock, type IsoDateTime, isoDateTimeSchema, type Secret } from '@gmt/core';
import { errnoCode, isRecord, parseMaybeJson } from '../util.js';
import { CREDENTIAL_HEADERS } from './cacheKey.js';
import { containsSecret, stripUrl } from './scrub.js';
import type { FixtureRecorder } from './types.js';

/** The recorder refused to write (credential present, token outside a token position, wrong tree, synthetic provider). */
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
  /** The recording session: recorder creation instant plus a random suffix; the same value the placeholders carry (prov-r2-001). */
  session: string;
  contentSha256: string;
}

const TOKEN_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*_token$/;
const RECORDED_DIR = `${sep}fixtures${sep}recorded`;
const SAFE_PATH = /^\/[A-Za-z0-9._/-]*$/;
const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]{12})\.json$/;

/** Absolute path of this package's recorded tree (works from src/ and dist/). */
export function defaultRecordedRoot(): string {
  return fileURLToPath(new URL('../../fixtures/recorded', import.meta.url));
}

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

function hashOf(file: object): string {
  const rest = Object.fromEntries(Object.entries(file).filter(([k]) => k !== 'contentSha256'));
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** sha256 hex over canonicalJson of a recording without its hash field. Tamper-evidence, not a signature (prov-003). */
export function contentHash(f: Omit<RecordedFixture, 'contentSha256'>): string {
  return hashOf(f);
}

/** Adds `contentSha256` over everything else. Exported only through `./testing` (tests, WP4b's record tool). */
export function withContentHash<T extends object>(file: T): T & { contentSha256: string } {
  return { ...file, contentSha256: hashOf(file) };
}

/** Recomputes the content hash of any recorded-tree JSON; false for anything edited after recording. */
export function verifyContentHash(file: unknown): boolean {
  return isRecord(file) && typeof file.contentSha256 === 'string' && hashOf(file) === file.contentSha256;
}

/** Token-named query parameters of a URL string (empty for anything that is not an http(s) URL). */
function urlTokenParams(s: string): Array<[string, string]> {
  if (!/^https?:\/\//i.test(s)) return [];
  try {
    return [...new URL(s).searchParams.entries()].filter(([k, v]) => TOKEN_KEY.test(k) && v !== '');
  } catch {
    return [];
  }
}

/** Placeholder table for opaque vendor tokens, scoped to one recording session (prov-006). */
function tokenTable(session: string) {
  const byRaw = new Map<string, { placeholder: string; key: string }>();
  const counters = new Map<string, number>();
  const register = (key: string, raw: string, seen: Set<string>): void => {
    seen.add(raw);
    if (byRaw.has(raw)) return;
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    byRaw.set(raw, { placeholder: `<${key}:${n}@${session}>`, key });
  };
  const collect = (v: unknown, seen: Set<string>): void => {
    if (typeof v === 'string') {
      for (const [k, raw] of urlTokenParams(v)) register(k, raw, seen);
    } else if (Array.isArray(v)) {
      for (const x of v) collect(x, seen);
    } else if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (TOKEN_KEY.test(k) && typeof x === 'string' && x !== '') register(k, x, seen);
        else collect(x, seen);
      }
    }
  };
  const placeholderOf = (raw: string, used: Map<string, string>): string | undefined => {
    const t = byRaw.get(raw);
    if (t === undefined) return undefined;
    used.set(t.placeholder, t.key);
    return t.placeholder;
  };
  const replaceUrl = (s: string, used: Map<string, string>): string => {
    const pairs = urlTokenParams(s);
    if (pairs.length === 0) return s;
    const u = new URL(s);
    u.search = new URLSearchParams(
      [...u.searchParams.entries()].map(([k, v]): [string, string] => [
        k,
        (TOKEN_KEY.test(k) ? placeholderOf(v, used) : undefined) ?? v,
      ]),
    ).toString();
    return u.href;
  };
  // why: only token positions are rewritten (prov-007); any raw token left elsewhere makes the recorder refuse.
  const deep = (v: unknown, used: Map<string, string>): unknown => {
    if (typeof v === 'string') return replaceUrl(v, used);
    if (Array.isArray(v)) return v.map((x) => deep(x, used));
    if (isRecord(v)) {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          k,
          TOKEN_KEY.test(k) && typeof x === 'string' ? (placeholderOf(x, used) ?? x) : deep(x, used),
        ]),
      );
    }
    return v;
  };
  return { register, collect, placeholderOf, replaceUrl, deep };
}

/** Strips query and userinfo from every URL string under a `search_metadata` key (spec §5.3). */
function stripMetadataUrls(v: unknown, inside: boolean): unknown {
  if (typeof v === 'string') return inside && /^https?:\/\//i.test(v) ? stripUrl(v) : v;
  if (Array.isArray(v)) return v.map((x) => stripMetadataUrls(x, inside));
  if (isRecord(v))
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, stripMetadataUrls(x, inside || k === 'search_metadata')]),
    );
  return v;
}

/** Writes `text` unless the file exists (same content on the same day hashes to the same name). */
function writeOnce(path: string, text: string): void {
  try {
    writeFileSync(path, text, { flag: 'wx' });
  } catch (e) {
    if (errnoCode(e) !== 'EEXIST') throw e;
  }
}

/**
 * Fixture recorder, spec §5.3 "Recorder": writes RecordedFixture files under `<root>` (which must end in
 * fixtures/recorded) with the raw vendor body beside each as `.raw.json` (gitignored), and fails closed.
 */
export function createRecorder(opts: {
  root: string;
  secrets: readonly Secret[];
  clock: Clock;
  recordedBy: string;
}): FixtureRecorder {
  const root = resolve(opts.root);
  if (!root.endsWith(RECORDED_DIR))
    throw new RecorderRefusedError(`recorder root must end in fixtures/recorded (spec §5.5), got ${root}`);
  if (opts.recordedBy.trim() === '')
    throw new RecorderRefusedError('recordedBy must name who ran the recording');
  // why: two sessions never share an identity, even when started in the same millisecond (prov-r2-001).
  const session = `${opts.clock.now().replace(/[-:.]/g, '')}-${randomBytes(3).toString('hex')}`;
  const tokens = tokenTable(session);
  const refuse = (r: { providerId: string; endpointPath: string }, why: string): RecorderRefusedError =>
    new RecorderRefusedError(
      `refusing to record ${r.providerId} ${SAFE_PATH.test(r.endpointPath) ? r.endpointPath : '<unsafe endpointPath>'}: ${why}`,
    );

  return {
    async record(r) {
      if (r.providerId === 'fixture')
        throw refuse(r, 'the fixture provider is synthetic and is never recorded (spec §5.5)');
      if (!SAFE_PATH.test(r.endpointPath) || r.endpointPath.includes('..'))
        throw refuse(r, 'unsafe endpointPath');
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(r.request.headers)) {
        const lower = name.toLowerCase();
        if (CREDENTIAL_HEADERS.has(lower)) continue;
        if (containsSecret(value, opts.secrets))
          throw refuse(r, `a credential appears in header ${lower} (test-005)`);
        headers[lower] = value;
      }

      const seen = new Set<string>();
      const params = [...r.request.url.searchParams.entries()];
      for (const [k, v] of params) if (TOKEN_KEY.test(k) && v !== '') tokens.register(k, v, seen);
      const requestJson = parseMaybeJson(r.request.body);
      tokens.collect(requestJson, seen);
      tokens.collect(r.body, seen);

      const used = new Map<string, string>();
      const url = new URL(r.request.url.href);
      url.username = '';
      url.password = '';
      url.hash = '';
      url.search = new URLSearchParams(
        params.map(([k, v]): [string, string] => [
          k,
          (TOKEN_KEY.test(k) ? tokens.placeholderOf(v, used) : undefined) ?? v,
        ]),
      ).toString();
      const requestBody =
        r.request.body === undefined
          ? null
          : typeof requestJson === 'string'
            ? requestJson
            : JSON.stringify(tokens.deep(requestJson, used));
      const body = tokens.deep(stripMetadataUrls(r.body, false), used);
      const unhashed: Omit<RecordedFixture, 'contentSha256'> = {
        // why: the instant the response arrived (http-kit's clock), not the recorder's write time (prov-r2-003).
        recordedAt: r.fetchedAt,
        recordedBy: opts.recordedBy,
        providerId: r.providerId,
        endpointPath: r.endpointPath,
        request: { method: r.request.method, url: url.href, headers, body: requestBody },
        status: r.status,
        body,
        placeholders: Object.fromEntries([...used].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
        session,
      };
      const file: RecordedFixture = { ...unhashed, contentSha256: contentHash(unhashed) };
      const text = `${JSON.stringify(file, null, 2)}\n`;
      const raw = `${JSON.stringify(r.body, null, 2) ?? 'null'}\n`;
      if (containsSecret(text, opts.secrets) || containsSecret(raw, opts.secrets))
        throw refuse(r, 'a credential would be written (spec §5.3)');
      if ([...seen].some((t) => text.includes(t)))
        throw refuse(
          r,
          'an opaque token also appears outside a token position; nothing is rewritten (prov-007)',
        );

      const dir = join(root, r.providerId, r.endpointPath.replaceAll('/', '_'));
      mkdirSync(dir, { recursive: true });
      // why: a symlinked provider directory must not redirect the write outside the recorded tree.
      if (!realpathSync(dir).startsWith(`${realpathSync(root)}${sep}`))
        throw refuse(r, `the target directory resolves outside ${root}`);
      const target = join(dir, `${file.recordedAt.slice(0, 10)}-${file.contentSha256.slice(0, 12)}.json`);
      writeOnce(target, text);
      writeOnce(target.replace(/\.json$/, '.raw.json'), raw);
      return target;
    },
  };
}

/** Loads any hashed file of the recorded tree (a recording or a ParamsAllowlist) after the §5.5 checks. */
export function loadRecordedJson(
  path: string,
  root: string = defaultRecordedRoot(),
): Record<string, unknown> {
  if (!resolve(root).endsWith(RECORDED_DIR))
    throw new Error(`recorded root must end in fixtures/recorded, got ${root}`);
  const real = realpathSync(path);
  if (!real.startsWith(`${realpathSync(root)}${sep}`))
    throw new Error(`refusing ${path}: recorded files load only from the recorded root ${root} (spec §5.5)`);
  const json: unknown = JSON.parse(readFileSync(real, 'utf8'));
  if (!isRecord(json)) throw new Error(`refusing ${path}: not a JSON object`);
  if ('synthetic' in json) throw new Error(`refusing ${path}: a synthetic file inside the recorded tree`);
  if (typeof json.recordedAt !== 'string') throw new Error(`refusing ${path}: recordedAt is required`);
  if (!verifyContentHash(json))
    throw new Error(`refusing ${path}: content hash mismatch (edited after recording?)`);
  return json;
}

function stringRecord(v: unknown): Record<string, string> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'string') return null;
    out[k] = x;
  }
  return out;
}

/** Loads one recorded HTTP attempt with every field and its location checked (prov-002); built field by field. */
export function loadRecordedFixture(path: string, root: string = defaultRecordedRoot()): RecordedFixture {
  const json = loadRecordedJson(path, root);
  const fail = (why: string): Error => new Error(`refusing ${path}: ${why}`);
  const recordedAt = isoDateTimeSchema.safeParse(json.recordedAt);
  if (!recordedAt.success) throw fail('recordedAt is not a toISOString() instant');
  const { recordedBy, providerId, endpointPath, status, request, contentSha256, session } = json;
  if (typeof session !== 'string' || session === '') throw fail('session is missing');
  if (typeof recordedBy !== 'string' || recordedBy.trim() === '')
    throw fail('recordedBy is missing or empty');
  if (typeof providerId !== 'string' || typeof endpointPath !== 'string' || !SAFE_PATH.test(endpointPath))
    throw fail('providerId or endpointPath is missing');
  if (typeof status !== 'number' || !Number.isInteger(status)) throw fail('status must be an integer');
  if (typeof contentSha256 !== 'string') throw fail('contentSha256 is missing');
  if (!isRecord(request)) throw fail('request is missing');
  const { method, url } = request;
  const requestBody = request.body;
  if (typeof method !== 'string' || typeof url !== 'string')
    throw fail('request.method and request.url must be strings');
  if (!(requestBody === null || typeof requestBody === 'string'))
    throw fail('request.body must be a string or null');
  const headers = stringRecord(request.headers);
  if (headers === null) throw fail('request.headers must map names to strings');
  const placeholders = stringRecord(json.placeholders);
  if (placeholders === null) throw fail('placeholders must map placeholders to token keys');
  const parts = relative(realpathSync(resolve(root)), realpathSync(path)).split(sep);
  const [dirProvider, dirEndpoint, fileName = ''] = parts;
  if (parts.length !== 3 || dirProvider !== providerId || dirEndpoint !== endpointPath.replaceAll('/', '_')) {
    throw fail('the file is not under <root>/<providerId>/<endpointPath with / → _>/');
  }
  const name = FILE_NAME.exec(fileName);
  if (name === null || name[1] !== recordedAt.data.slice(0, 10) || name[2] !== contentSha256.slice(0, 12)) {
    throw fail('the file name does not match recordedAt and contentSha256');
  }
  return {
    recordedAt: recordedAt.data,
    recordedBy,
    providerId,
    endpointPath,
    request: { method, url, headers, body: requestBody },
    status,
    body: json.body,
    placeholders,
    session,
    contentSha256,
  };
}
```

`fixtures/recorded/.gitkeep`: empty file (WP4b fills the tree).

Repository `.gitignore`: append

```gitignore
# raw vendor bodies written beside recorded fixtures (sec-008); never committed, wherever a recorded root lives
**/fixtures/recorded/**/*.raw.json
```

`src/http/attempt.ts`: record after the body is parsed and before classification, so error bodies (429, 400, quota) are recorded too, with the raw body so the recorder can fail closed and with `fetchedAt` so `recordedAt` is the instant the response arrived (prov-r2-003). Replace

```ts
  const scrubbed = scrubSecrets(body, deps.secrets);
```

with

```ts
  if (r.recordFixtures && deps.recorder !== undefined) {
    // why: before classification, so 429/quota/400 bodies are captured (spec §9 item 7); a refusal fails the request.
    await deps.recorder.record({
      providerId: r.providerId,
      endpointPath: r.endpointPath,
      request: r,
      status,
      body,
      fetchedAt,
    });
  }
  const scrubbed = scrubSecrets(body, deps.secrets);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http`
Expected: PASS, 133 tests.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add .gitignore packages/providers && git commit -m "wp04: recorder writing the pinned RecordedFixture format, failing closed, positional session placeholders, strict loaders (spec §5.3, §5.5)"
```

### Task 4.8: Sentinel-key test over every sink this package writes; attempt logging

**Files:**
- Modify: `src/http/attempt.ts`, `src/http/httpKit.ts`
- Test: `test/http/sentinel.test.ts`

**Interfaces:**
- Produces: http-kit log lines — `debug 'http attempt'` `{ providerId, endpointPath, attempt, httpStatus, durationMs }`; `warn 'http attempt failed'` `{ providerId, endpointPath, attempt, stage: 'request' | 'body', failure: 'aborted' | 'timeout' | 'network' }`; `debug 'http cache hit'` and `debug 'http joined in-flight request'` `{ providerId, endpointPath }`; `warn 'http request failed'` `{ providerId, endpointPath, error }` (the error's message, which never holds a URL query or a secret). No line carries a URL, a header or a body. pino `redact` is WP4b's (`createLogger`), the whole-process sentinel test WP13's.

The test exercises every path that can carry a credential — all four sentinels echoed raw, URL-encoded and base64 in a success body and in 401/400 error bodies, a `search_metadata` URL, a socket error, a timeout, an abort, a credential in the URL and in `endpointPath`, a recorder refusal, both vendor header styles, and an adapter `classifyError` that copies vendor text and the key into its message — and asserts that no sentinel, in any form, appears in any sink this package writes: ledger arguments (reserve, cache-hit), cache keys and bodies, returned bodies, error messages and fields, recorder output (`.json` and `.raw.json`), log lines. Positive controls keep it from passing vacuously: every provider key reached msw in a request header; every sentinel form reached a scrub site (the scrubbed echo body holds one `[redacted]` per form); at least one log line per attempt (this control fails until the logging below exists).

- [ ] **Step 1: Write the failing test**

`test/http/sentinel.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock, ProviderError } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecorder } from '../../src/http/recorder.js';
import { containsSecret } from '../../src/http/scrub.js';
import { ALL_SECRETS, makeKit, req, SEARCH, SENTINELS, TP } from '../fakes.js';
import { hangUntilAborted, server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const key = SENTINELS.searchapi.reveal();
const token = SENTINELS.travelpayouts.reveal();
// every distinct form of every sentinel (raw, URL-encoded, form-encoded, JSON-escaped, base64, base64url); the SMTP
// sentinel's reserved characters make those forms differ (test-r2-003), and each must reach a scrub site.
const echoes = [
  ...new Set(
    ALL_SECRETS.flatMap((s) => {
      const v = s.reveal();
      return [
        v,
        encodeURIComponent(v),
        new URLSearchParams({ v }).toString().slice(2),
        JSON.stringify(v).slice(1, -1),
        Buffer.from(v).toString('base64'),
        Buffer.from(v).toString('base64url'),
      ];
    }),
  ),
];

describe('sentinel-key test (spec §5.3 secret scrubbing, §14)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('no secret, in any form, reaches the ledger, cache, errors, bodies, recorder output or logs on any path', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'gmt-sen-')), 'fixtures', 'recorded');
    mkdirSync(root, { recursive: true });
    const recorder = createRecorder({
      root,
      secrets: ALL_SECRETS,
      clock: fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z')),
      recordedBy: 'sentinel',
    });
    const main = makeKit({ recorder, overrides: { searchapi: { requestTimeoutSeconds: 5 } } });
    const echoing = makeKit({
      overrides: {
        searchapi: {
          classifyError: (f) =>
            new ProviderError({
              kind: 'auth',
              retryable: false,
              message: `vendor said ${JSON.stringify(f.body)}; key ${key}; ${encodeURIComponent(key)}`,
            }),
        },
      },
    });

    server.use(
      http.get(SEARCH, ({ request }) => {
        const scenario = new URL(request.url).searchParams.get('s');
        if (scenario === 'echo')
          return HttpResponse.json({ echoes, search_metadata: { request_url: `${SEARCH}?api_key=${key}` } });
        if (scenario === 'meta')
          return HttpResponse.json({
            search_metadata: { request_url: `${SEARCH}?engine=x&id=s1` },
            price: 1,
          });
        if (scenario === '401')
          return HttpResponse.json(
            { error: `Invalid API key ${key}`, echoes },
            { status: 401, headers: { 'x-echo': key } },
          );
        if (scenario === '400')
          return HttpResponse.json({ error: `bad request for ${encodeURIComponent(key)}` }, { status: 400 });
        if (scenario === 'socket') return HttpResponse.error();
        return hangUntilAborted(request); // 'hang'
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
    const k = main.kit;
    await run(k.request(req({ url: `${SEARCH}?s=echo`, cache: { ttlSeconds: 600 } })));
    await run(k.request(req({ url: `${SEARCH}?s=echo`, cache: { ttlSeconds: 600 } }))); // cache hit
    await run(k.request(req({ url: `${SEARCH}?s=meta`, recordFixtures: true }))); // recorded (+ .raw.json)
    await run(k.request(req({ url: `${SEARCH}?s=echo`, recordFixtures: true }))); // recorder refuses
    await run(k.request(req({ url: `${SEARCH}?s=401` })));
    await run(k.request(req({ url: `${SEARCH}?s=400` })));
    await run(k.request(req({ url: `${SEARCH}?s=socket` })));
    await run(k.request(req({ url: `${SEARCH}?s=hang` }))); // timeout
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    await run(k.request(req({ url: `${SEARCH}?s=hang&a=1`, signal: ac.signal }))); // abort
    await run(k.request(req({ url: `${SEARCH}?api_key=${key}` }))); // egress refusal
    await run(k.request(req({ url: `${SEARCH}?s=x`, endpointPath: `/api/v1/search?api_key=${key}` })));
    await run(
      k.request(
        req({
          url: `${TP}?origin=LON`,
          providerId: 'travelpayouts',
          headers: { 'x-access-token': token },
          cache: { ttlSeconds: 600 },
        }),
      ),
    );
    await run(echoing.kit.request(req({ url: `${SEARCH}?s=401` }))); // adapter classifier copies vendor text and the key

    // positive controls
    const sent = [...main.events, ...echoing.events]
      .flatMap((e) => (e.type === 'fetch' ? [JSON.stringify(e.headers)] : []))
      .join('\n');
    expect(sent).toContain(key);
    expect(sent).toContain(token);
    expect(JSON.stringify(results[0]).split('[redacted]').length - 1).toBeGreaterThanOrEqual(echoes.length);
    expect(errors.length).toBeGreaterThanOrEqual(9);
    for (const kit of [main, echoing]) {
      expect(kit.log.lines.filter((l) => l.includes('"msg":"http attempt')).length).toBeGreaterThanOrEqual(
        kit.budget.reserveCalls,
      );
    }

    const errorText = JSON.stringify(
      errors.map((e) => (e instanceof Error ? { ...e, name: e.name, message: e.message } : e)),
    );
    const sinks = {
      ledger: JSON.stringify([...main.events, ...echoing.events].filter((e) => e.type !== 'fetch')),
      cacheKeys: JSON.stringify([...main.cache.entries.keys(), ...echoing.cache.entries.keys()]),
      cacheBodies: JSON.stringify([...main.cache.entries.values(), ...echoing.cache.entries.values()]),
      bodies: JSON.stringify(results),
      errors: errorText,
      recorder: readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => readFileSync(join(d.parentPath, d.name), 'utf8'))
        .join('\n'),
      logs: [...main.log.lines, ...echoing.log.lines].join('\n'),
    };
    expect(sinks.recorder).toContain('"price": 1');
    for (const [name, text] of Object.entries(sinks))
      expect({ sink: name, leaks: containsSecret(text, ALL_SECRETS) }).toEqual({ sink: name, leaks: false });
    expect(sinks.logs).not.toMatch(/https?:\/\/\S*\?/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/sentinel.test.ts`
Expected: FAIL on the logging positive control — `expected 0 to be greater than or equal to N`, N being the number of reserves (no `http attempt` lines exist yet).

- [ ] **Step 3: Implement**

`src/http/attempt.ts`: add the logging. After

```ts
  const signal = AbortSignal.any([r.signal, timeout.signal]);
```

insert

```ts
  // why: path, never URL; no headers, no body (spec §14).
  const logFailure = (stage: 'request' | 'body'): void =>
    deps.log.warn(
      {
        providerId: r.providerId,
        endpointPath: r.endpointPath,
        attempt: ctx.attempt,
        stage,
        failure: r.signal.aborted ? 'aborted' : timeout.signal.aborted ? 'timeout' : 'network',
      },
      'http attempt failed',
    );
```

Replace

```ts
    clearTimeout(timer);
    if (r.signal.aborted) {
```

with

```ts
    clearTimeout(timer);
    logFailure('request');
    if (r.signal.aborted) {
```

Replace

```ts
  } catch {
    if (r.signal.aborted) {
```

with

```ts
  } catch {
    logFailure('body');
    if (r.signal.aborted) {
```

After

```ts
  finalise(ok ? 'ok' : 'error', status);
```

insert

```ts
  deps.log.debug(
    {
      providerId: r.providerId,
      endpointPath: r.endpointPath,
      attempt: ctx.attempt,
      httpStatus: status,
      durationMs: Date.now() - started,
    },
    'http attempt',
  );
```

`src/http/httpKit.ts`: in `upstream`, at the top of the `catch (err)` block (before the `// why: p-retry rethrows` line) insert

```ts
      deps.log.warn(
        {
          providerId: r.providerId,
          endpointPath: r.endpointPath,
          error: err instanceof Error ? err.message : String(err),
        },
        'http request failed',
      );
```

in `join`, before `return { ...shared, fromCache: true };` insert

```ts
    deps.log.debug(
      { providerId: r.providerId, endpointPath: r.endpointPath },
      'http joined in-flight request',
    );
```

and in `request`, before `return { status: 200, body: hit.body, fetchedAt: hit.storedAt, fromCache: true, cacheKey: key };` insert

```ts
        deps.log.debug({ providerId: r.providerId, endpointPath: r.endpointPath }, 'http cache hit');
```

Egress refusals happen before `upstream` and are not logged by http-kit; the engine logs the error it receives (its message carries `<invalid endpointPath>` rather than a tainted path).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/http`
Expected: PASS, 134 tests. If a sink check fails, the assertion names the sink; fix the code that writes it, never the test.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: sentinel-key test over every sink incl. an echoing classifier, attempt logging without URLs (spec §5.3, §14)"
```

### Task 4.9: Fixture tree, gated fixture server with validated scenario control, hold/release, paging and chains; msw handlers and Hono router

**Files:**
- Create: `fixtures/synthetic/fixture/calendar/{LHR-JFK,LHR-EWR,LGW-JFK,LGW-EWR}.json`, `fixtures/synthetic/fixture/itinerary/{LHR-JFK,LHR-EWR,LGW-JFK,LGW-EWR}.json`
- Create: `src/fixture/dates.ts`, `src/fixture/tree.ts`, `src/fixture/server.ts`, `src/fixture/router.ts`, `src/fixture/index.ts`, `src/testing/handlers.ts`, `src/testing/index.ts`
- Test: `test/fixture/server.test.ts`

**Interfaces:**
- Consumes: `syntheticAllowed`, `SyntheticGateInput`, `asIsoDate` (WP0); hono 4.13.13; msw 3.0.3 (`http.all`).
- Produces: `defaultFixtureRoot`, `loadFixtureTree`, `calendarPriceMinor`, `createFixtureServer(root, gate)`, `FixtureResponse`, `FixtureRule`, `FIXTURE_PATHS`, `parseFixtureResponse`, `parseFixtureRules`, `scenarioRequest`, `releaseRequest`, `fixtureRouter(root, gate)` (`@gmt/providers/fixture`), `fixtureHandlers(root, gate)` and `RequestHandler` (`@gmt/providers/testing`).

- [ ] **Step 1: Write the fixture tree**

`fixtures/synthetic/fixture/calendar/LHR-JFK.json`:

```json
{
  "synthetic": true,
  "currency": "GBP",
  "baseMinor": 41200,
  "weekdayStepMinor": 1500,
  "perNightMinor": 900,
  "noFaresNights": [],
  "noDataNights": []
}
```

`fixtures/synthetic/fixture/calendar/LHR-EWR.json`:

```json
{
  "synthetic": true,
  "currency": "GBP",
  "baseMinor": 39800,
  "weekdayStepMinor": 1700,
  "perNightMinor": 850,
  "noFaresNights": [],
  "noDataNights": [10]
}
```

`fixtures/synthetic/fixture/calendar/LGW-JFK.json`:

```json
{
  "synthetic": true,
  "currency": "GBP",
  "baseMinor": 43500,
  "weekdayStepMinor": 1200,
  "perNightMinor": 950,
  "noFaresNights": [21],
  "noDataNights": []
}
```

`fixtures/synthetic/fixture/calendar/LGW-EWR.json` (the paged pair):

```json
{
  "synthetic": true,
  "currency": "GBP",
  "baseMinor": 40900,
  "weekdayStepMinor": 1600,
  "perNightMinor": 800,
  "noFaresNights": [],
  "noDataNights": [],
  "pageSize": 40
}
```

`fixtures/synthetic/fixture/itinerary/LHR-JFK.json`:

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

`itinerary/LHR-EWR.json`, `itinerary/LGW-JFK.json` and `itinerary/LGW-EWR.json` are the same file with flight numbers `201`–`204`, `301`–`304` and `401`–`404` and `priceDeltaMinor` `2500`/`0`, `4100`/`600` and `3000`/`200` respectively; `LGW-JFK.json` also carries `"chain": true` after `"synthetic": true` (the chained-verification pair).

`// why:` `ZZ` and `ZX` are synthetic designators matching `^[A-Z0-9]{2}$` (spec §6.4) so the engine can hash the itineraries; sellers say "Synthetic" so no screenshot of fixture mode resembles a real fare.

- [ ] **Step 2: Write the failing test**

`test/fixture/server.test.ts`:

```ts
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ORIGIN, RELEASE_PATH, SCENARIO_HEADER, SCENARIO_PATH } from '../../src/fixture/constants.js';
import { fixtureRouter } from '../../src/fixture/router.js';
import {
  createFixtureServer,
  type FixtureResponse,
  type FixtureRule,
  releaseRequest,
  scenarioRequest,
} from '../../src/fixture/server.js';
import { calendarPriceMinor, defaultFixtureRoot, loadFixtureTree } from '../../src/fixture/tree.js';
import { fixtureHandlers } from '../../src/testing/handlers.js';
import { arr, jsonOf, obj } from '../support/guards.js';
import { server } from '../support/msw.js';

const ROOT = defaultFixtureRoot();
const GATE = {
  nodeEnv: 'test',
  databasePath: ':memory:',
  allowFixtureProvider: null,
  inContainer: false,
} as const;
const PROD = {
  nodeEnv: 'production',
  databasePath: '/data/get-me-there.db',
  allowFixtureProvider: null,
  inContainer: true,
} as const;
const cal = (q: Record<string, string>) => `${FIXTURE_ORIGIN}/calendar?${new URLSearchParams(q)}`;
const tile = {
  origin: 'LHR',
  destination: 'JFK',
  departFrom: '2026-11-02',
  departTo: '2026-11-08',
  returnFrom: '2026-11-12',
  returnTo: '2026-11-29',
  cabin: 'economy',
  currency: 'GBP',
};
const itinQ = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-11-02',
  returnDate: '2026-11-16',
  cabin: 'economy',
  currency: 'GBP',
  expandTop: '2',
};
const itin = (q: Record<string, string> = {}, path = '/itinerary') =>
  `${FIXTURE_ORIGIN}${path}?${new URLSearchParams({ ...itinQ, ...q })}`;
const get = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { status: res.status, body: obj(await jsonOf(res)) };
};
const withScenario = (respond: FixtureResponse | Record<string, unknown>) => ({
  headers: { [SCENARIO_HEADER]: JSON.stringify(respond) },
});
const scenario = (rules: FixtureRule[]) => fetch(scenarioRequest(rules));
function brokenTree(file: string, content: unknown): string {
  const copy = join(mkdtempSync(join(tmpdir(), 'gmt-t-')), 'fixtures', 'synthetic', 'fixture');
  cpSync(ROOT, copy, { recursive: true });
  writeFileSync(join(copy, file), JSON.stringify(content));
  return copy;
}

describe('fixture tree loader (spec §5.5)', () => {
  it('loads the four worked-example pairs, every file synthetic; LGW-EWR is paged and LGW-JFK chained', () => {
    const t = loadFixtureTree(ROOT);
    expect([...t.calendar.keys()].sort()).toEqual(['LGW-EWR', 'LGW-JFK', 'LHR-EWR', 'LHR-JFK']);
    expect([...t.itinerary.keys()].sort()).toEqual(['LGW-EWR', 'LGW-JFK', 'LHR-EWR', 'LHR-JFK']);
    expect(t.calendar.get('LGW-EWR')?.pageSize).toBe(40);
    expect(t.itinerary.get('LGW-JFK')?.chain).toBe(true);
    expect(t.itinerary.get('LHR-JFK')?.chain).toBe(false);
  });
  it('refuses a tree that is not fixtures/synthetic/fixture', () => {
    expect(() => loadFixtureTree(mkdtempSync(join(tmpdir(), 'gmt-t-')))).toThrow(
      /fixtures\/synthetic\/fixture/,
    );
  });
  const goodCal = {
    synthetic: true,
    currency: 'GBP',
    baseMinor: 1,
    weekdayStepMinor: 1,
    perNightMinor: 1,
    noFaresNights: [],
    noDataNights: [],
  };
  const goodLeg = { flightNumber: '101', depart: '09:30', arrive: '12:40', arriveDayOffset: 0 };
  const goodOpt = {
    seller: 'S',
    carrier: 'ZZ',
    outbound: goodLeg,
    inbound: goodLeg,
    priceDeltaMinor: 0,
    cabinBagIncluded: true,
    checkedBags: 0,
  };
  it.each([
    [
      'a calendar file without synthetic: true',
      'calendar/LHR-JFK.json',
      { ...goodCal, synthetic: undefined },
      /synthetic/,
    ],
    ['a missing currency', 'calendar/LHR-JFK.json', { ...goodCal, currency: undefined }, /currency/],
    ['a non-integer baseMinor', 'calendar/LHR-JFK.json', { ...goodCal, baseMinor: 1.5 }, /baseMinor/],
    [
      'a non-integer night list',
      'calendar/LHR-JFK.json',
      { ...goodCal, noDataNights: ['10'] },
      /noDataNights/,
    ],
    ['a zero pageSize', 'calendar/LHR-JFK.json', { ...goodCal, pageSize: 0 }, /pageSize/],
    ['an empty options list', 'itinerary/LHR-JFK.json', { synthetic: true, options: [] }, /options/],
    [
      'a bad carrier',
      'itinerary/LHR-JFK.json',
      { synthetic: true, options: [{ ...goodOpt, carrier: 'Z!' }] },
      /carrier/,
    ],
    [
      'a bad leg time',
      'itinerary/LHR-JFK.json',
      { synthetic: true, options: [{ ...goodOpt, outbound: { ...goodLeg, depart: '9:30' } }] },
      /depart/,
    ],
    [
      'a non-boolean chain',
      'itinerary/LHR-JFK.json',
      { synthetic: true, chain: 'yes', options: [goodOpt] },
      /chain/,
    ],
  ])('refuses %s (test-010)', (_label, file, content, message) => {
    expect(() => loadFixtureTree(brokenTree(file, content))).toThrow(message);
  });
});

describe('the gate (ruling 7, prov-008)', () => {
  it('createFixtureServer, fixtureRouter and fixtureHandlers throw unless syntheticAllowed(gate)', () => {
    expect(() => createFixtureServer(ROOT, PROD)).toThrow(/syntheticAllowed/);
    expect(() => fixtureRouter(ROOT, PROD)).toThrow(/syntheticAllowed/);
    expect(() => fixtureHandlers(ROOT, PROD)).toThrow(/syntheticAllowed/);
    expect(() => createFixtureServer(ROOT, GATE)).not.toThrow();
  });
});

describe('fixture server via msw (http://fixture.local)', () => {
  beforeEach(() => server.use(...fixtureHandlers(ROOT, GATE)));

  it('answers a calendar tile with the formula price for every in-rectangle cell, on one page', async () => {
    const { status, body } = await get(cal(tile));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      synthetic: true,
      currency: 'GBP',
      origin: 'LHR',
      destination: 'JFK',
      noFares: [],
      page: 1,
      pages: 1,
    });
    expect(body.cacheable).toBeUndefined();
    const prices = arr(body.prices).map(obj);
    expect(prices).toHaveLength(126); // 7 departure days × 18 return days, all 4–27 nights
    // 2026-11-02 is epoch day 20759 (mod 7 = 4): 41200 + 4 × 1500 + 14 × 900
    expect(
      prices.find((p) => p.departureDate === '2026-11-02' && p.returnDate === '2026-11-16')?.amountMinor,
    ).toBe(59_800);
    const file = loadFixtureTree(ROOT).calendar.get('LHR-JFK');
    expect(file && calendarPriceMinor(file, '2026-11-02', 14)).toBe(59_800);
  });

  it('applies noFaresNights and noDataNights from the pair file', async () => {
    expect(arr((await get(cal({ ...tile, origin: 'LGW' }))).body.noFares)).toHaveLength(7);
    const ewr = arr((await get(cal({ ...tile, destination: 'EWR' }))).body.prices).map(obj);
    expect(ewr.filter((p) => p.departureDate === '2026-11-02' && p.returnDate === '2026-11-12')).toEqual([]);
  });

  it('pages a paged pair: 126 entries in 4 pages of up to 40; a page out of range → 400', async () => {
    const q = { ...tile, origin: 'LGW', destination: 'EWR' };
    const first = (await get(cal(q))).body;
    expect([first.page, first.pages, arr(first.prices).length]).toEqual([1, 4, 40]);
    const last = (await get(cal({ ...q, page: '4' }))).body;
    expect(arr(last.prices)).toHaveLength(6);
    expect((await get(cal({ ...q, page: '5' }))).status).toBe(400);
    expect((await get(cal({ ...q, page: 'x' }))).status).toBe(400);
  });

  it('404s an unknown pair and 400s a missing or malformed parameter or an over-large rectangle', async () => {
    expect((await get(cal({ ...tile, destination: 'BBB' }))).status).toBe(404);
    const { departFrom: _d, ...missing } = tile;
    expect((await get(cal(missing))).status).toBe(400);
    expect((await get(cal({ ...tile, departTo: '2026-13-40' }))).status).toBe(400);
    expect((await get(cal({ ...tile, departTo: '2028-11-08' }))).status).toBe(400);
    expect((await get(itin({ returnDate: '2026-11-01' }))).status).toBe(400);
    expect((await get(`${FIXTURE_ORIGIN}/nowhere`)).status).toBe(404);
  });

  it('answers a plain itinerary search with offers built from the templates, priced from the calendar', async () => {
    const { body } = await get(itin());
    expect(body).toMatchObject({
      synthetic: true,
      chain: false,
      currency: 'GBP',
      outboundOptions: 2,
      failedExpansions: 0,
    });
    const offers = arr(body.offers).map(obj);
    expect(offers.map((o) => o.amountMinor)).toEqual([59_800 + 3800, 59_800]);
    expect(offers[0]).toMatchObject({
      seller: 'Synthetic Air',
      taxesIncluded: true,
      outbound: [
        {
          carrier: 'ZZ',
          flightNumber: '101',
          from: 'LHR',
          to: 'JFK',
          depart: '2026-11-02T09:30',
          arrive: '2026-11-02T12:40',
          cabin: 'economy',
        },
      ],
      inbound: [
        {
          carrier: 'ZZ',
          flightNumber: '102',
          from: 'JFK',
          to: 'LHR',
          depart: '2026-11-16T18:30',
          arrive: '2026-11-17T06:40',
          cabin: 'economy',
        },
      ],
      baggage: { cabinBag: 'included', checkedBags: 1 },
      selfTransfer: false,
    });
    expect(arr((await get(itin({ expandTop: '1' }))).body.offers)).toHaveLength(1);
  });

  it('answers the chained pair in three steps: outbounds, then a return offer and an agency offer per outbound', async () => {
    const q = { origin: 'LGW', destination: 'JFK' };
    const step1 = (await get(itin(q))).body;
    expect(step1).toMatchObject({ chain: true, outboundOptions: 2, outbounds: ['o0', 'o1'], offers: [] });
    const ret = arr((await get(itin({ ...q, outbound: 'o0' }, '/itinerary/return'))).body.offers).map(obj);
    const book = arr((await get(itin({ ...q, outbound: 'o0' }, '/itinerary/booking'))).body.offers).map(obj);
    expect(ret[0]).toMatchObject({ seller: 'Synthetic Air' });
    expect(book[0]).toMatchObject({ seller: 'Synthetic Agency' });
    expect(Number(book[0]?.amountMinor)).toBe(Number(ret[0]?.amountMinor) - 300);
    expect((await get(itin({ ...q, outbound: 'o9' }, '/itinerary/return'))).status).toBe(404);
    expect((await get(itin({ outbound: 'o0' }, '/itinerary/return'))).status).toBe(404); // LHR-JFK is not chained
  });

  it('scenario rules answer matching requests `times` times, then normal responses resume; DELETE clears', async () => {
    await scenario([
      {
        match: { path: '/calendar', params: { departFrom: '2026-11-02' } },
        respond: { kind: 'status', status: 503 },
        times: 2,
      },
    ]);
    expect((await get(cal(tile))).status).toBe(503);
    expect((await get(cal({ ...tile, departFrom: '2026-11-03' }))).status).toBe(200);
    expect((await get(cal(tile))).status).toBe(503);
    expect((await get(cal(tile))).status).toBe(200);
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 401 } }]);
    expect((await get(cal(tile))).status).toBe(401);
    await fetch(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, { method: 'DELETE' });
    expect((await get(cal(tile))).status).toBe(200);
  });

  it.each([
    ['an unknown kind', { rules: [{ match: {}, respond: { kind: 'nonsense' } }] }],
    ['an unknown path', { rules: [{ match: { path: '/calender' }, respond: { kind: 'empty' } }] }],
    ['a status outside 200–599', { rules: [{ match: {}, respond: { kind: 'status', status: 700 } }] }],
    [
      'a disallowed response header',
      { rules: [{ match: {}, respond: { kind: 'status', status: 429, headers: { 'set-cookie': 'x' } } }] },
    ],
    ['a non-string param', { rules: [{ match: { params: { page: 2 } }, respond: { kind: 'empty' } }] }],
    ['times 0', { rules: [{ match: {}, respond: { kind: 'empty' }, times: 0 }] }],
    ['no rules array', { rule: [] }],
  ])('refuses a scenario with %s → 400 (po-004, sec-012)', async (_label, body) => {
    const res = await fetch(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('refuses a malformed or invalid x-fixture-scenario header and a GET on the control path', async () => {
    expect((await fetch(cal(tile), { headers: { [SCENARIO_HEADER]: '{not json' } })).status).toBe(400);
    expect((await fetch(cal(tile), withScenario({ kind: 'nonsense' }))).status).toBe(400);
    expect((await fetch(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`)).status).toBe(405);
  });

  it('serves every FixtureResponse kind', async () => {
    const r429 = await fetch(
      cal(tile),
      withScenario({ kind: 'status', status: 429, headers: { 'retry-after': '7200' } }),
    );
    expect([r429.status, r429.headers.get('retry-after')]).toEqual([429, '7200']);
    expect(await (await fetch(cal(tile), withScenario({ kind: 'malformed' }))).text()).toBe(
      '{"synthetic": true, "prices": [',
    );
    await expect(fetch(cal(tile), withScenario({ kind: 'network' }))).rejects.toThrow();
    const ac = new AbortController();
    const hung = fetch(cal(tile), { ...withScenario({ kind: 'hang' }), signal: ac.signal });
    ac.abort();
    await expect(hung).rejects.toThrow();
    expect((await get(cal(tile), withScenario({ kind: 'empty' }))).body).toMatchObject({
      prices: [],
      noFares: [],
    });
    expect(arr((await get(cal(tile), withScenario({ kind: 'no-fares' }))).body.noFares)).toHaveLength(126);
    expect((await get(cal(tile), withScenario({ kind: 'no-currency' }))).body.currency).toBeUndefined();
    expect((await get(cal(tile), withScenario({ kind: 'variant', currency: 'USD' }))).body.currency).toBe(
      'USD',
    );
    expect((await get(cal(tile), withScenario({ kind: 'cacheable' }))).body.cacheable).toBe(true);
    expect((await get(itin(), withScenario({ kind: 'empty' }))).body).toMatchObject({
      outboundOptions: 0,
      offers: [],
    });
    expect((await get(itin(), withScenario({ kind: 'no-return-legs' }))).body).toMatchObject({
      outboundOptions: 2,
      offers: [],
    });
    expect((await get(itin(), withScenario({ kind: 'partial', failedExpansions: 1 }))).body).toMatchObject({
      outboundOptions: 2,
      failedExpansions: 1,
    });
    const v = arr(
      (await get(itin(), withScenario({ kind: 'variant', carrier: 'Z!', connectVia: 'QQQ' }))).body.offers,
    ).map(obj);
    expect(
      arr(v[0]?.outbound)
        .map(obj)
        .map((s) => [s.carrier, s.from, s.to]),
    ).toEqual([
      ['Z!', 'LHR', 'QQQ'],
      ['Z!', 'QQQ', 'JFK'],
    ]);
    expect(
      arr(v[1]?.outbound)
        .map(obj)
        .map((s) => s.carrier),
    ).toEqual(['ZX']);
  });

  it('holds requests under an id until released, then answers them with the given or the normal response (po-005)', async () => {
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'hold', id: 'h1' }, times: 2 }]);
    let settled = 0;
    const a = fetch(cal(tile)).then((r) => {
      settled += 1;
      return r.status;
    });
    const b = fetch(cal({ ...tile, departFrom: '2026-11-03' })).then((r) => {
      settled += 1;
      return r.status;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(0);
    const ack = obj(await jsonOf(await fetch(releaseRequest('h1', { kind: 'status', status: 503 }))));
    expect(ack).toEqual({ synthetic: true, released: 2 });
    expect(await Promise.all([a, b])).toEqual([503, 503]);
    expect(obj(await jsonOf(await fetch(releaseRequest('nobody'))))).toEqual({
      synthetic: true,
      released: 0,
    });
    expect((await fetch(`${FIXTURE_ORIGIN}${RELEASE_PATH}`, { method: 'POST', body: '{}' })).status).toBe(
      400,
    );
  });
});

describe('fixtureRouter (Hono) serves the same tree', () => {
  beforeEach(() => server.use(...fixtureHandlers(ROOT, GATE)));

  it('returns byte-identical calendar and itinerary bodies to the msw handlers', async () => {
    const router = fixtureRouter(ROOT, GATE);
    for (const url of [cal(tile), itin()]) {
      expect(await (await router.request(url)).text()).toBe(await (await fetch(url)).text());
    }
  });
  it('honours scenario rules on its own state, sent with scenarioRequest', async () => {
    const router = fixtureRouter(ROOT, GATE);
    const ack = await router.fetch(
      scenarioRequest([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 402 } }]),
    );
    expect(obj(await jsonOf(ack))).toEqual({ synthetic: true, rules: 1 });
    expect((await router.request(cal(tile))).status).toBe(402);
    expect((await router.request(`${FIXTURE_ORIGIN}/health`)).status).toBe(200);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/server.test.ts`
Expected: FAIL — `Failed to load url ../../src/fixture/router.js`.

- [ ] **Step 4: Implement**

`src/fixture/dates.ts`:

```ts
import { asIsoDate, type IsoDate } from '@gmt/core';

const DAY_MS = 86_400_000;

// why: UTC arithmetic on calendar values, never Date-local (spec §6.1). WP1's epoch-day helpers are not a
// dependency of WP4 (it depends on WP0 only); WP13's integration review replaces this file with core's helpers.

/** Days since 1970-01-01 for a `YYYY-MM-DD` string. */
export function epochDayOf(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS;
}

export function isoDateOfEpochDay(n: number): IsoDate {
  return asIsoDate(new Date(n * DAY_MS).toISOString().slice(0, 10));
}

export function addDaysIso(d: string, n: number): IsoDate {
  return isoDateOfEpochDay(epochDayOf(d) + n);
}

export function daysBetweenIso(a: string, b: string): number {
  return epochDayOf(b) - epochDayOf(a);
}

/** `YYYY-MM-DDTHH:mm` plus `minutes`, as wall-clock arithmetic (no timezone involved). */
export function localPlusMinutes(local: string, minutes: number): string {
  const ms = Date.UTC(
    Number(local.slice(0, 4)),
    Number(local.slice(5, 7)) - 1,
    Number(local.slice(8, 10)),
    Number(local.slice(11, 13)),
    Number(local.slice(14, 16)),
  );
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
  currency: string;
  baseMinor: number;
  weekdayStepMinor: number;
  perNightMinor: number;
  noFaresNights: number[];
  noDataNights: number[];
  pageSize?: number;
}
export interface LegTemplate {
  flightNumber: string;
  depart: string;
  arrive: string;
  arriveDayOffset: number;
}
export interface OptionTemplate {
  seller: string;
  carrier: string;
  outbound: LegTemplate;
  inbound: LegTemplate;
  priceDeltaMinor: number;
  cabinBagIncluded: boolean;
  checkedBags: number;
}
/** `itinerary/<O>-<D>.json`: offer templates placed on a cell's dates; `chain` makes verification three steps. */
export interface ItineraryPairFile {
  chain: boolean;
  options: OptionTemplate[];
}
export interface FixtureTree {
  root: string;
  calendar: Map<string, CalendarPairFile>;
  itinerary: Map<string, ItineraryPairFile>;
}

const TREE_SUFFIX = `${sep}fixtures${sep}synthetic${sep}fixture`;
const PAIR_FILE = /^[A-Z]{3}-[A-Z]{3}\.json$/;
const HHMM = /^\d{2}:\d{2}$/;

/** Absolute path of this package's synthetic tree (works from src/ and dist/). */
export function defaultFixtureRoot(): string {
  return fileURLToPath(new URL('../../fixtures/synthetic/fixture', import.meta.url));
}

/** The formula price for a cell: base + weekday step × (epoch day mod 7) + nights × per-night. */
export function calendarPriceMinor(file: CalendarPairFile, departureDate: string, nights: number): number {
  return (
    file.baseMinor + (epochDayOf(departureDate) % 7) * file.weekdayStepMinor + nights * file.perNightMinor
  );
}

type Obj = Record<string, unknown>;
function int(o: Obj, k: string, where: string, min = 0): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min)
    throw new Error(`${where}: ${k} must be an integer ≥ ${min}`);
  return v;
}
function str(o: Obj, k: string, where: string, re?: RegExp): string {
  const v = o[k];
  if (typeof v !== 'string' || v === '' || (re !== undefined && !re.test(v)))
    throw new Error(`${where}: ${k} is missing or malformed`);
  return v;
}
function ints(o: Obj, k: string, where: string): number[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new Error(`${where}: ${k} must be an integer array`);
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isInteger(x))
      throw new Error(`${where}: ${k} must be an integer array`);
    out.push(x);
  }
  return out;
}
function obj(o: Obj, k: string, where: string): Obj {
  const v = o[k];
  if (!isRecord(v)) throw new Error(`${where}: ${k} must be an object`);
  return v;
}
function bool(o: Obj, k: string, where: string, fallback?: boolean): boolean {
  const v = o[k];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'boolean') throw new Error(`${where}: ${k} must be a boolean`);
  return v;
}
function leg(o: Obj, where: string): LegTemplate {
  return {
    flightNumber: str(o, 'flightNumber', where, /^\d{1,4}$/),
    depart: str(o, 'depart', where, HHMM),
    arrive: str(o, 'arrive', where, HHMM),
    arriveDayOffset: int(o, 'arriveDayOffset', where),
  };
}

function readPairs(dir: string): Array<{ pair: string; file: string; json: Obj }> {
  return readdirSync(dir)
    .filter((n) => PAIR_FILE.test(n))
    .sort()
    .map((n) => {
      const file = join(dir, n);
      const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!isRecord(json) || json.synthetic !== true)
        throw new Error(`refusing ${file}: every fixture-tree file carries "synthetic": true (spec §5.5)`);
      return { pair: n.slice(0, 7), file, json };
    });
}

/**
 * Loads and validates the synthetic tree. Refuses any root other than …/fixtures/synthetic/fixture (after realpath,
 * so a symlink cannot point it at the recorded tree) and any file without `"synthetic": true`. Spec §5.5, §9 item 2.
 */
export function loadFixtureTree(root: string): FixtureTree {
  const real = realpathSync(root);
  if (!real.endsWith(TREE_SUFFIX))
    throw new Error(
      `refusing fixture tree ${root}: the fixture provider reads only fixtures/synthetic/fixture (spec §5.5)`,
    );
  const calendar = new Map<string, CalendarPairFile>();
  for (const { pair, file, json } of readPairs(join(real, 'calendar'))) {
    calendar.set(pair, {
      currency: str(json, 'currency', file, /^[A-Z]{3}$/),
      baseMinor: int(json, 'baseMinor', file),
      weekdayStepMinor: int(json, 'weekdayStepMinor', file),
      perNightMinor: int(json, 'perNightMinor', file),
      noFaresNights: ints(json, 'noFaresNights', file),
      noDataNights: ints(json, 'noDataNights', file),
      ...(json.pageSize === undefined ? {} : { pageSize: int(json, 'pageSize', file, 1) }),
    });
  }
  const itinerary = new Map<string, ItineraryPairFile>();
  for (const { pair, file, json } of readPairs(join(real, 'itinerary'))) {
    const options = json.options;
    if (!Array.isArray(options) || options.length === 0)
      throw new Error(`${file}: options must be a non-empty array`);
    itinerary.set(pair, {
      chain: bool(json, 'chain', file, false),
      options: options.map((raw: unknown, i) => {
        const where = `${file} options[${i}]`;
        if (!isRecord(raw)) throw new Error(`${where}: not an object`);
        return {
          seller: str(raw, 'seller', where),
          carrier: str(raw, 'carrier', where, /^[A-Z0-9]{2}$/),
          outbound: leg(obj(raw, 'outbound', where), `${where}.outbound`),
          inbound: leg(obj(raw, 'inbound', where), `${where}.inbound`),
          priceDeltaMinor: int(raw, 'priceDeltaMinor', where),
          cabinBagIncluded: bool(raw, 'cabinBagIncluded', where),
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
import { isoDateSchema, type SyntheticGateInput, syntheticAllowed } from '@gmt/core';
import { isRecord } from '../util.js';
import { FIXTURE_ORIGIN, RELEASE_PATH, SCENARIO_HEADER, SCENARIO_PATH } from './constants.js';
import { addDaysIso, daysBetweenIso, localPlusMinutes } from './dates.js';
import {
  type CalendarPairFile,
  calendarPriceMinor,
  type FixtureTree,
  type LegTemplate,
  loadFixtureTree,
  type OptionTemplate,
} from './tree.js';

/** How the fixture server answers one request. Documented in the brief's §8.1 mapping table. */
export type FixtureResponse =
  | { kind: 'normal' }
  | { kind: 'status'; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: 'malformed' }
  | { kind: 'network' }
  | { kind: 'hang' }
  | { kind: 'hold'; id: string }
  | { kind: 'empty' }
  | { kind: 'no-fares' }
  | { kind: 'no-currency' }
  | { kind: 'no-return-legs' }
  | { kind: 'partial'; failedExpansions: number }
  | {
      kind: 'variant';
      currency?: string;
      carrier?: string;
      connectVia?: string;
      scope?: 'first-offer' | 'all-offers';
    }
  | { kind: 'cacheable' };
type Generated = Exclude<FixtureResponse, { kind: 'status' | 'malformed' | 'network' | 'hang' | 'hold' }>;

export const FIXTURE_PATHS = [
  '/calendar',
  '/itinerary',
  '/itinerary/return',
  '/itinerary/booking',
  '/health',
] as const;
export type FixturePath = (typeof FIXTURE_PATHS)[number];

/** First matching rule with `times` left answers the request. `params` match query values exactly. */
export interface FixtureRule {
  match: { path?: FixturePath; params?: Record<string, string> };
  respond: FixtureResponse;
  times?: number;
}

export interface FixtureServer {
  handle(request: Request): Promise<Response>;
  setRules(rules: FixtureRule[]): void;
  reset(): void;
}

const SIMPLE_KINDS = [
  'normal',
  'malformed',
  'network',
  'hang',
  'empty',
  'no-fares',
  'no-currency',
  'no-return-legs',
  'cacheable',
] as const;
const RESPONSE_HEADERS = ['retry-after', 'content-type'] as const;
const SCOPES = ['first-offer', 'all-offers'] as const;
const MAX_NIGHTS = 90;
const MAX_SPAN_DAYS = 400;
const AGENCY_DISCOUNT_MINOR = 300;

/** Validates one FixtureResponse; a string is the reason it is refused (po-004, sec-012). */
export function parseFixtureResponse(v: unknown): FixtureResponse | string {
  if (!isRecord(v) || typeof v.kind !== 'string') return 'respond must be an object with a string kind';
  const kind = v.kind;
  const simple = SIMPLE_KINDS.find((k) => k === kind);
  if (simple !== undefined) return { kind: simple };
  if (kind === 'status') {
    const status = v.status;
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599)
      return 'status must be an integer 200–599';
    const rawHeaders = v.headers;
    let headers: Record<string, string> | undefined;
    if (rawHeaders !== undefined) {
      if (!isRecord(rawHeaders)) return 'headers must be an object';
      headers = {};
      for (const [name, value] of Object.entries(rawHeaders)) {
        const lower = name.toLowerCase();
        if (!RESPONSE_HEADERS.some((h) => h === lower) || typeof value !== 'string')
          return `header ${name} is not allowed`;
        headers[lower] = value;
      }
    }
    return {
      kind: 'status',
      status,
      ...(v.body === undefined ? {} : { body: v.body }),
      ...(headers === undefined ? {} : { headers }),
    };
  }
  if (kind === 'hold')
    return typeof v.id === 'string' && v.id !== '' ? { kind: 'hold', id: v.id } : 'hold needs a non-empty id';
  if (kind === 'partial') {
    const n = v.failedExpansions;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0
      ? { kind: 'partial', failedExpansions: n }
      : 'partial needs an integer failedExpansions ≥ 0';
  }
  if (kind === 'variant') {
    const out: {
      kind: 'variant';
      currency?: string;
      carrier?: string;
      connectVia?: string;
      scope?: 'first-offer' | 'all-offers';
    } = { kind: 'variant' };
    const { currency, carrier, connectVia, scope } = v;
    if (currency !== undefined) {
      if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
        return 'variant currency must be three upper-case letters';
      out.currency = currency;
    }
    if (carrier !== undefined) {
      if (typeof carrier !== 'string' || carrier.length < 1 || carrier.length > 3)
        return 'variant carrier must be 1–3 characters';
      out.carrier = carrier;
    }
    if (connectVia !== undefined) {
      if (typeof connectVia !== 'string' || !/^[A-Z]{3}$/.test(connectVia))
        return 'variant connectVia must be three upper-case letters';
      out.connectVia = connectVia;
    }
    if (scope !== undefined) {
      const s = SCOPES.find((x) => x === scope);
      if (s === undefined) return 'variant scope must be first-offer or all-offers';
      out.scope = s;
    }
    return out;
  }
  return `unknown kind ${kind}`;
}

/** Validates a scenario body `{ rules }`; a string is the reason it is refused. */
export function parseFixtureRules(v: unknown): FixtureRule[] | string {
  if (!isRecord(v) || !Array.isArray(v.rules)) return 'body must be { rules: FixtureRule[] }';
  const rules: FixtureRule[] = [];
  for (const [i, raw] of v.rules.entries()) {
    if (!isRecord(raw)) return `rules[${i}] must be an object`;
    const m = raw.match;
    if (!isRecord(m)) return `rules[${i}]: match is required`;
    const match: { path?: FixturePath; params?: Record<string, string> } = {};
    if (m.path !== undefined) {
      const path = FIXTURE_PATHS.find((p) => p === m.path);
      if (path === undefined) return `rules[${i}]: unknown path ${String(m.path)}`;
      match.path = path;
    }
    const rawParams = m.params;
    if (rawParams !== undefined) {
      if (!isRecord(rawParams)) return `rules[${i}]: params must be an object`;
      const params: Record<string, string> = {};
      for (const [k, x] of Object.entries(rawParams)) {
        if (typeof x !== 'string') return `rules[${i}]: param ${k} must be a string`;
        params[k] = x;
      }
      match.params = params;
    }
    const respond = parseFixtureResponse(raw.respond);
    if (typeof respond === 'string') return `rules[${i}]: ${respond}`;
    const times = raw.times;
    if (times !== undefined && (typeof times !== 'number' || !Number.isInteger(times) || times < 1))
      return `rules[${i}]: times must be a positive integer`;
    rules.push({ match, respond, ...(typeof times === 'number' ? { times } : {}) });
  }
  return rules;
}

/** The scenario-control request (WP7, WP13): send with `fetch(...)` under msw or `router.fetch(...)` in process. */
export function scenarioRequest(rules: FixtureRule[]): Request {
  return new Request(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
}

/** Releases every request held under `id`, answering it with `respond` (default the normal response). */
export function releaseRequest(id: string, respond?: FixtureResponse): Request {
  return new Request(`${FIXTURE_ORIGIN}${RELEASE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, ...(respond ? { respond } : {}) }),
  });
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const refuse = (status: number, error: string): Response =>
  json({ synthetic: true, error: `synthetic: ${error}` }, status);

async function readJson(request: Request): Promise<unknown> {
  try {
    const v: unknown = await request.json();
    return v;
  } catch {
    return undefined;
  }
}

/**
 * The fixture provider's server (spec §5.5: an ordinary HTTP endpoint at http://fixture.local), one routing core
 * shared by the msw handlers (tests) and the Hono router (fixture mode). Every generated body carries
 * `synthetic: true`. Throws unless syntheticAllowed(gate) (ruling 7). State (rules, held requests) lives here.
 */
export function createFixtureServer(root: string, gate: SyntheticGateInput): FixtureServer {
  if (!syntheticAllowed(gate))
    throw new Error('fixture server refused: syntheticAllowed(gate) is false (spec §5.5)');
  const tree: FixtureTree = loadFixtureTree(root);
  let rules: Array<{ rule: FixtureRule; remaining: number }> = [];
  const held = new Map<
    string,
    Array<{ url: URL; request: Request; settle: (res: Response | Promise<Response>) => void }>
  >();
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
      if (
        m.params !== undefined &&
        !Object.entries(m.params).every(([k, v]) => url.searchParams.get(k) === v)
      )
        continue;
      entry.remaining -= 1;
      return entry.rule.respond;
    }
    return { kind: 'normal' };
  };

  const need = (url: URL, names: string[], dates: string[]): Record<string, string> | Response => {
    const out: Record<string, string> = {};
    for (const n of names) {
      const v = url.searchParams.get(n);
      if (v === null || v === '') return refuse(400, `missing parameter ${n}`);
      if (dates.includes(n) && !isoDateSchema.safeParse(v).success) return refuse(400, `${n} is not a date`);
      out[n] = v;
    }
    return out;
  };

  function calendar(respond: Generated, url: URL): Response {
    const dates = ['departFrom', 'departTo', 'returnFrom', 'returnTo'];
    const p = need(url, ['origin', 'destination', ...dates], dates);
    if (p instanceof Response) return p;
    const {
      origin = '',
      destination = '',
      departFrom = '',
      departTo = '',
      returnFrom = '',
      returnTo = '',
    } = p;
    const file = tree.calendar.get(`${origin}-${destination}`);
    if (file === undefined) return refuse(404, `no calendar fixture for ${origin}-${destination}`);
    if (
      daysBetweenIso(departFrom, departTo) > MAX_SPAN_DAYS ||
      daysBetweenIso(returnFrom, returnTo) > MAX_SPAN_DAYS
    )
      return refuse(400, 'rectangle too large');
    const entries: Array<{ departureDate: string; returnDate: string; amountMinor: number | null }> = [];
    if (respond.kind !== 'empty') {
      for (let dep: string = departFrom; dep <= departTo; dep = addDaysIso(dep, 1)) {
        for (let ret: string = returnFrom; ret <= returnTo; ret = addDaysIso(ret, 1)) {
          const nights = daysBetweenIso(dep, ret);
          if (nights < 0 || nights > MAX_NIGHTS || file.noDataNights.includes(nights)) continue;
          const noFare = respond.kind === 'no-fares' || file.noFaresNights.includes(nights);
          entries.push({
            departureDate: dep,
            returnDate: ret,
            amountMinor: noFare ? null : calendarPriceMinor(file, dep, nights),
          });
        }
      }
    }
    const pageSize = file.pageSize ?? Math.max(1, entries.length);
    const pages = Math.max(1, Math.ceil(entries.length / pageSize));
    const pageParam = url.searchParams.get('page') ?? '1';
    const page = /^\d+$/.test(pageParam) ? Number(pageParam) : Number.NaN;
    if (!(page >= 1 && page <= pages)) return refuse(400, `page must be 1–${pages}`);
    const slice = entries.slice((page - 1) * pageSize, page * pageSize);
    const body: Record<string, unknown> = {
      synthetic: true,
      origin,
      destination,
      page,
      pages,
      prices: slice.flatMap((e) =>
        e.amountMinor === null
          ? []
          : [{ departureDate: e.departureDate, returnDate: e.returnDate, amountMinor: e.amountMinor }],
      ),
      noFares: slice.flatMap((e) =>
        e.amountMinor === null ? [{ departureDate: e.departureDate, returnDate: e.returnDate }] : [],
      ),
    };
    if (respond.kind !== 'no-currency')
      body.currency =
        respond.kind === 'variant' && respond.currency !== undefined ? respond.currency : file.currency;
    if (respond.kind === 'cacheable') body.cacheable = true;
    return json(body);
  }

  function legs(
    carrier: string,
    t: LegTemplate,
    from: string,
    to: string,
    date: string,
    cabin: string,
    via: string | undefined,
  ): unknown[] {
    const depart = `${date}T${t.depart}`;
    const arrive = `${addDaysIso(date, t.arriveDayOffset)}T${t.arrive}`;
    if (via === undefined)
      return [{ carrier, flightNumber: t.flightNumber, from, to, depart, arrive, cabin }];
    // why: the connection exists only to drive the engine's unknown-airport-tz path; times are template arithmetic.
    return [
      {
        carrier,
        flightNumber: t.flightNumber,
        from,
        to: via,
        depart,
        arrive: localPlusMinutes(depart, 120),
        cabin,
      },
      {
        carrier,
        flightNumber: String(Number(t.flightNumber) + 1000),
        from: via,
        to,
        depart: localPlusMinutes(depart, 180),
        arrive,
        cabin,
      },
    ];
  }

  function offerOf(
    o: OptionTemplate,
    index: number,
    p: Record<string, string>,
    nights: number,
    cal: CalendarPairFile,
    respond: Generated,
  ): Record<string, unknown> {
    const { origin = '', destination = '', departureDate = '', returnDate = '', cabin = '' } = p;
    const applies = respond.kind === 'variant' && (respond.scope === 'all-offers' || index === 0);
    const carrier = applies && respond.carrier !== undefined ? respond.carrier : o.carrier;
    const via = applies ? respond.connectVia : undefined;
    return {
      seller: o.seller,
      amountMinor: calendarPriceMinor(cal, departureDate, nights) + o.priceDeltaMinor,
      taxesIncluded: true,
      outbound: legs(carrier, o.outbound, origin, destination, departureDate, cabin, via),
      inbound: legs(carrier, o.inbound, destination, origin, returnDate, cabin, undefined),
      baggage: { cabinBag: o.cabinBagIncluded ? 'included' : 'not-included', checkedBags: o.checkedBags },
      selfTransfer: false,
    };
  }

  /** Shared request parsing for the itinerary routes. */
  function itineraryContext(url: URL, extra: string[]) {
    const dates = ['departureDate', 'returnDate'];
    const p = need(url, ['origin', 'destination', ...dates, 'cabin', ...extra], dates);
    if (p instanceof Response) return p;
    const pair = `${p.origin}-${p.destination}`;
    const cal = tree.calendar.get(pair);
    const it = tree.itinerary.get(pair);
    if (cal === undefined || it === undefined) return refuse(404, `no itinerary fixture for ${pair}`);
    const nights = daysBetweenIso(p.departureDate ?? '', p.returnDate ?? '');
    if (nights < 0) return refuse(400, 'returnDate before departureDate');
    return { p, cal, it, nights };
  }

  function header(
    p: Record<string, string>,
    respond: Generated,
    cal: CalendarPairFile,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      synthetic: true,
      origin: p.origin,
      destination: p.destination,
      departureDate: p.departureDate,
      returnDate: p.returnDate,
      cabin: p.cabin,
    };
    if (respond.kind !== 'no-currency')
      base.currency =
        respond.kind === 'variant' && respond.currency !== undefined ? respond.currency : cal.currency;
    return base;
  }

  function itinerary(respond: Generated, url: URL): Response {
    const c = itineraryContext(url, []);
    if (c instanceof Response) return c;
    const { p, cal, it, nights } = c;
    const base = header(p, respond, cal);
    if (it.chain) {
      const outbounds = respond.kind === 'empty' ? [] : it.options.map((_o, i) => `o${i}`);
      return json({
        ...base,
        chain: true,
        outboundOptions: outbounds.length,
        outbounds,
        failedExpansions: 0,
        offers: [],
      });
    }
    const expandTop = Number(url.searchParams.get('expandTop') ?? it.options.length);
    const options = it.options.slice(
      0,
      Number.isInteger(expandTop) && expandTop > 0 ? expandTop : it.options.length,
    );
    if (respond.kind === 'empty')
      return json({ ...base, chain: false, outboundOptions: 0, failedExpansions: 0, offers: [] });
    if (respond.kind === 'no-return-legs')
      return json({
        ...base,
        chain: false,
        outboundOptions: options.length,
        failedExpansions: options.length,
        offers: [],
      });
    const offers = options.map((o, i) => offerOf(o, i, p, nights, cal, respond));
    const failed = respond.kind === 'partial' ? Math.min(respond.failedExpansions, offers.length) : 0;
    return json({
      ...base,
      chain: false,
      outboundOptions: options.length,
      failedExpansions: failed,
      offers: offers.slice(0, offers.length - failed),
    });
  }

  function chainStep(respond: Generated, url: URL, step: 'return' | 'booking'): Response {
    const c = itineraryContext(url, ['outbound']);
    if (c instanceof Response) return c;
    const { p, cal, it, nights } = c;
    if (!it.chain) return refuse(404, `${p.origin}-${p.destination} is not a chained pair`);
    const id = /^o(\d+)$/.exec(p.outbound ?? '');
    const index = id === null ? -1 : Number(id[1]);
    const option = it.options[index];
    if (option === undefined) return refuse(404, `no outbound ${p.outbound ?? ''}`);
    const base = { ...header(p, respond, cal), outbound: p.outbound };
    if (respond.kind === 'empty' || respond.kind === 'no-return-legs') return json({ ...base, offers: [] });
    const offer = offerOf(option, index, p, nights, cal, respond);
    if (step === 'return') return json({ ...base, offers: [offer] });
    const agencyPrice =
      calendarPriceMinor(cal, p.departureDate ?? '', nights) + option.priceDeltaMinor - AGENCY_DISCOUNT_MINOR;
    return json({ ...base, offers: [{ ...offer, seller: 'Synthetic Agency', amountMinor: agencyPrice }] });
  }

  function route(respond: Generated, url: URL): Response {
    switch (url.pathname) {
      case '/health':
        return json({ synthetic: true, ok: true });
      case '/calendar':
        return calendar(respond, url);
      case '/itinerary':
        return itinerary(respond, url);
      case '/itinerary/return':
        return chainStep(respond, url, 'return');
      case '/itinerary/booking':
        return chainStep(respond, url, 'booking');
      default:
        return refuse(404, `no fixture route ${url.pathname}`);
    }
  }

  function render(respond: FixtureResponse, url: URL, request: Request): Response | Promise<Response> {
    switch (respond.kind) {
      case 'status':
        return json(
          respond.body ?? { synthetic: true, error: `synthetic HTTP ${respond.status}` },
          respond.status,
          respond.headers ?? {},
        );
      case 'malformed':
        return new Response('{"synthetic": true, "prices": [', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      case 'network':
        return Response.error();
      case 'hang':
        // why: answers only when the client gives up (abort or per-request timeout), and then with a network error:
        // msw 3 sends a request still pending at abort to the real network, and a rejection here would become a 500.
        return new Promise<Response>((resolve) => {
          if (request.signal.aborted) resolve(Response.error());
          request.signal.addEventListener('abort', () => resolve(Response.error()), { once: true });
        });
      case 'hold':
        return new Promise<Response>((resolve) => {
          const list = held.get(respond.id) ?? [];
          list.push({ url, request, settle: resolve });
          held.set(respond.id, list);
        });
      case 'normal':
      case 'empty':
      case 'no-fares':
      case 'no-currency':
      case 'no-return-legs':
      case 'partial':
      case 'variant':
      case 'cacheable':
        return route(respond, url);
      default: {
        // why: exhaustive (po-004) — a new kind must be handled here before it compiles.
        const unreachable: never = respond;
        throw new Error(`unhandled fixture response ${JSON.stringify(unreachable)}`);
      }
    }
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === SCENARIO_PATH) {
      if (request.method === 'DELETE') {
        reset();
        return new Response(null, { status: 204 });
      }
      if (request.method !== 'POST') return refuse(405, 'use POST or DELETE');
      const parsed = parseFixtureRules(await readJson(request));
      if (typeof parsed === 'string') return refuse(400, parsed);
      setRules(parsed);
      return json({ synthetic: true, rules: rules.length });
    }
    if (url.pathname === RELEASE_PATH) {
      if (request.method !== 'POST') return refuse(405, 'use POST');
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.id !== 'string' || body.id === '')
        return refuse(400, 'body must be { id, respond? }');
      const respond =
        body.respond === undefined ? { kind: 'normal' as const } : parseFixtureResponse(body.respond);
      if (typeof respond === 'string') return refuse(400, respond);
      const waiting = held.get(body.id) ?? [];
      held.delete(body.id);
      for (const w of waiting) w.settle(render(respond, w.url, w.request));
      return json({ synthetic: true, released: waiting.length });
    }
    const inline = request.headers.get(SCENARIO_HEADER);
    let respond: FixtureResponse;
    if (inline === null) respond = pick(url);
    else {
      let parsedHeader: unknown;
      try {
        parsedHeader = JSON.parse(inline);
      } catch {
        return refuse(400, `${SCENARIO_HEADER} is not JSON`);
      }
      const r = parseFixtureResponse(parsedHeader);
      if (typeof r === 'string') return refuse(400, r);
      respond = r;
    }
    return render(respond, url, request);
  }

  return { handle, setRules, reset };
}
```

`src/fixture/router.ts`:

```ts
import type { SyntheticGateInput } from '@gmt/core';
import { Hono } from 'hono';
import { createFixtureServer } from './server.js';

/**
 * The synthetic tree as a Hono router for fixture mode (spec §4, §5.3 rev 11). Throws unless syntheticAllowed(gate).
 * WP4b's wiring reaches it only through http-kit's gated seam: `inProcessHosts: { 'fixture.local': async (req) => router.fetch(req) }`.
 */
export function fixtureRouter(root: string, gate: SyntheticGateInput): Hono {
  const fixture = createFixtureServer(root, gate);
  const app = new Hono();
  app.all('*', (c) => fixture.handle(c.req.raw));
  return app;
}
```

`src/fixture/index.ts` (the `@gmt/providers/fixture` subpath; Task 4.10 adds `FIXTURE_TILE_DAYS`):

```ts
// `@gmt/providers/fixture`: the gated fixture router and its scenario-control contract (WP4b wiring, WP7 tests).
export { fixtureRouter } from './router.js'; // WP4b: inProcessHosts['fixture.local']
export { type FixtureResponse, type FixtureRule, releaseRequest, scenarioRequest } from './server.js'; // WP7
export { defaultFixtureRoot } from './tree.js'; // WP4b, WP7
```

`src/testing/handlers.ts`:

```ts
import type { SyntheticGateInput } from '@gmt/core';
import { http } from 'msw/http';
import { FIXTURE_ORIGIN } from '../fixture/constants.js';
import { createFixtureServer } from '../fixture/server.js';

/** msw 3's HTTP handler type (no documented entrypoint exports `RequestHandler`; verified 2026-10-14). */
export type RequestHandler = ReturnType<typeof http.all>;

/**
 * msw handlers serving the synthetic tree at http://fixture.local on global fetch (spec §5.5, §9 item 4 layer A).
 * Throws unless syntheticAllowed(gate). Exported from `@gmt/providers/testing` only.
 */
export function fixtureHandlers(root: string, gate: SyntheticGateInput): RequestHandler[] {
  const fixture = createFixtureServer(root, gate);
  return [http.all(`${FIXTURE_ORIGIN}/*`, ({ request }) => fixture.handle(request))];
}
```

`src/testing/index.ts` (Task 4.11 adds the replay exports):

```ts
// `@gmt/providers/testing`: the only module tree that imports msw (plan decision 7). Production code never imports it.
export { withContentHash } from '../http/recorder.js';
export { fixtureHandlers, type RequestHandler } from './handlers.js';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/server.test.ts`
Expected: PASS, 31 tests.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 6: Commit**

```bash
git add packages/providers && git commit -m "wp04: gated fixture server with validated scenario control, hold/release, paging and chains; msw and Hono transports (spec §4, §5.5)"
```

### Task 4.10: Fixture provider — gate, tiling, paged tiles, chained verification, cacheable tiles, through http-kit

**Files:**
- Create: `src/fixture/provider.ts`
- Modify: `src/fixture/index.ts`
- Test: `test/fixture/provider.test.ts`

**Interfaces:**
- Consumes: `syntheticAllowed`, `cellKeyString`, `asIata`, the §5.1 types (WP0); `HttpKit` (Tasks 4.1–4.8); the fixture server (Task 4.9).
- Produces: `fixtureProvider`, `fixtureHttpLimits`, `planFixtureTiles`, `FIXTURE_TILE_DAYS`, `FIXTURE_CALENDAR_TTL_SECONDS`.

Rules (spec §5.5, §5.3 billable rule, §5.2, §5.1): the constructor throws unless `syntheticAllowed(config)`; both capabilities declare `{ sourceKind: 'synthetic', provenanceNote, maxAgeHours: 0 }`; every result carries `pointOfSale: 'unknown'` and no `routeHistory`; the HTTP limits allow host `fixture.local` only, `billable: 'http-200'`, `costPerCallMicroGbp` = the configured test cost (WP4b passes the same `config.providers.fixture.costMicroGbp` to both, cost-007); requests are never recorded (`recordFixtures: false` whatever `ctx` says); a response without `synthetic: true` is a `parse` error; booking is always `{ kind: 'none' }`; `taxesIncluded` is read from the response, never asserted; `healthcheck` makes no call. Tiles are `rectangle`s of up to 7 departure days partitioning the query's cells (or `q.cells`, re-planned). A tile fetches every page under its own `tileIndex`; `fetchedAt` is the oldest page's. Calendar requests ask for caching with an `accept` that admits only bodies the server marked `cacheable: true`, so the default is uncached and a `cacheable` scenario produces cache-hit rows. Verification estimates `1 + 2 × expandTop` calls; a chained pair runs step 1, then for each of the first `expandTop` outbounds a return step and a booking step: only an `upstream`, `network` or `parse` failure counts — in `failedExpansions` (partial) for a return step, as a note for a booking step — while `auth`, `quota`, `rate-limit` and `limiter-timeout` from any step, `AbortedError` and `BudgetExceeded` propagate unchanged and stop the chain (spec §5.4 rev 12, prov-r2-002), and no surviving offer with outbounds present is `upstream` with `reason: 'no-return-legs'`.

- [ ] **Step 1: Write the failing test**

`test/fixture/provider.test.ts`:

```ts
import {
  AbortedError,
  asIata,
  asIsoDate,
  BudgetExceeded,
  cellKeyString,
  type DiscoveryQuery,
  type ItineraryQuery,
  type ProviderContext,
  ProviderError,
} from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureHttpLimits, fixtureProvider, planFixtureTiles } from '../../src/fixture/provider.js';
import { fixtureRouter } from '../../src/fixture/router.js';
import { type FixtureRule, scenarioRequest } from '../../src/fixture/server.js';
import { defaultFixtureRoot } from '../../src/fixture/tree.js';
import type { FixtureRecorder } from '../../src/http/types.js';
import { fixtureHandlers } from '../../src/testing/handlers.js';
import { CapturingLogger, FakeBudget, makeKit, testLimits } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const GATE = {
  nodeEnv: 'test',
  databasePath: ':memory:',
  allowFixtureProvider: null,
  inContainer: false,
} as const;
const COST = 3200;
const NOTE =
  'synthetic data from the fixture provider, generated for tests and local development; not a fare';
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
const chained: ItineraryQuery = { ...iq, origin: asIata('LGW') };
const ctx = (over: Partial<ProviderContext> = {}): ProviderContext => ({
  executionId: 'exec-1',
  signal: new AbortController().signal,
  recordFixtures: true,
  ...over,
});
const scenario = (rules: FixtureRule[]) => fetch(scenarioRequest(rules));
const limits = () => ({
  ...testLimits(),
  fixture: fixtureHttpLimits({ costPerCallMicroGbp: COST, maxWaitSeconds: 3900, requestTimeoutSeconds: 60 }),
});

function setup(
  o: {
    budget?: FakeBudget;
    recorder?: FixtureRecorder;
    inProcessHosts?: Record<string, (req: Request) => Promise<Response>>;
  } = {},
) {
  const k = makeKit({ limits: limits(), ...o });
  const provider = fixtureProvider({
    http: k.kit,
    log: new CapturingLogger(),
    clock: k.clock,
    config: GATE,
    costMicroGbp: COST,
  });
  const discovery = provider.discovery;
  const verification = provider.verification;
  if (discovery === undefined || verification === undefined)
    throw new Error('fixture provider lacks a capability');
  return { ...k, provider, discovery, verification };
}
const firstTile = (query: DiscoveryQuery = q) => {
  const plan = planFixtureTiles(query)[0];
  if (plan === undefined) throw new Error('no plan');
  return plan;
};

describe('fixture provider gate and declarations (spec §5.5)', () => {
  it.each([
    [
      'production',
      {
        nodeEnv: 'production',
        databasePath: '/data/get-me-there.db',
        allowFixtureProvider: null,
        inContainer: true,
      },
    ],
    [
      'production with the phrase',
      {
        nodeEnv: 'production',
        databasePath: '/tmp/x.fixture.db',
        allowFixtureProvider: 'i-understand-this-is-fake',
        inContainer: false,
      },
    ],
    [
      'development without the phrase',
      {
        nodeEnv: 'development',
        databasePath: '/tmp/x.fixture.db',
        allowFixtureProvider: null,
        inContainer: false,
      },
    ],
    [
      'development in the container',
      {
        nodeEnv: 'development',
        databasePath: '/tmp/x.fixture.db',
        allowFixtureProvider: 'i-understand-this-is-fake',
        inContainer: true,
      },
    ],
    [
      'test with a production db path',
      {
        nodeEnv: 'test',
        databasePath: '/data/get-me-there.db',
        allowFixtureProvider: null,
        inContainer: false,
      },
    ],
  ] as const)('throws for %s', (_label, config) => {
    const { kit, clock } = makeKit();
    expect(() =>
      fixtureProvider({ http: kit, log: new CapturingLogger(), clock, config, costMicroGbp: COST }),
    ).toThrow(/syntheticAllowed/);
  });
  it('constructs under the test gate and the development opt-in', () => {
    const { kit, clock } = makeKit();
    const dev = {
      nodeEnv: 'development',
      databasePath: '/tmp/x.fixture.db',
      allowFixtureProvider: 'i-understand-this-is-fake',
      inContainer: false,
    } as const;
    for (const config of [GATE, dev])
      expect(
        fixtureProvider({ http: kit, log: new CapturingLogger(), clock, config, costMicroGbp: COST }).id,
      ).toBe('fixture');
  });
  it('declares synthetic provenance on both capabilities, fixture.local as its only host, billable on HTTP 200 at the test cost (prov-010)', () => {
    const { provider, discovery, verification } = setup();
    const info = { sourceKind: 'synthetic', provenanceNote: NOTE, maxAgeHours: 0 };
    expect([provider.id, discovery.info, verification.info]).toEqual(['fixture', info, info]);
    expect(
      fixtureHttpLimits({ costPerCallMicroGbp: COST, maxWaitSeconds: 1, requestTimeoutSeconds: 1 }),
    ).toMatchObject({ hosts: ['fixture.local'], billable: 'http-200', costPerCallMicroGbp: COST });
    expect(verification.estimate(iq)).toMatchObject({ calls: 5, costMicroGbp: 5 * COST });
  });
});

describe('planFixtureTiles (tiles partition the cells)', () => {
  const all = (tiles: ReturnType<typeof planFixtureTiles>) =>
    tiles.flatMap((t) => t.coveredCells.map(cellKeyString));

  it('28 departure days × 12 nights = 336 cells in 4 seven-day rectangles, disjoint and complete', () => {
    const tiles = planFixtureTiles(q);
    expect(tiles.map((t) => t.index)).toEqual([0, 1, 2, 3]);
    const keys = all(tiles);
    expect([keys.length, new Set(keys).size]).toEqual([336, 336]);
    expect(tiles[0]?.request).toEqual({
      kind: 'rectangle',
      departFrom: '2026-11-02',
      departTo: '2026-11-08',
      returnFrom: '2026-11-12',
      returnTo: '2026-11-29',
    });
  });
  it('re-plans over q.cells: fewer tiles, still a partition of exactly those cells', () => {
    const subset = planFixtureTiles(q)
      .flatMap((t) => t.coveredCells)
      .filter((c) => c.departureDate === '2026-11-03' || c.departureDate === '2026-11-20');
    const tiles = planFixtureTiles({ ...q, cells: subset });
    expect(tiles).toHaveLength(2);
    expect(all(tiles).sort()).toEqual(subset.map(cellKeyString).sort());
  });
  it('is deterministic', () => expect(planFixtureTiles(q)).toEqual(planFixtureTiles(q)));
});

describe('fixture discovery through the real http-kit and msw', () => {
  beforeEach(() => {
    useFakeTime();
    server.use(...fixtureHandlers(defaultFixtureRoot(), GATE));
  });
  afterEach(() => vi.useRealTimers());

  it('fetchTile returns synthetic prices for exactly its covered cells, drops out-of-band entries, ledgers one billable-rule call', async () => {
    const { discovery, budget } = setup();
    const plan = firstTile();
    const result = await drive(discovery.fetchTile(plan, q, ctx()));
    if (result.kind !== 'tile') throw new Error(`expected a tile, got ${result.kind}`);
    const covered = new Set(plan.coveredCells.map(cellKeyString));
    expect(result.prices).toHaveLength(84);
    expect(result.prices.every((p) => covered.has(cellKeyString(p)) && p.currency === 'GBP')).toBe(true);
    expect(
      result.prices.find((p) => p.returnDate === '2026-11-16' && p.departureDate === '2026-11-02')
        ?.amountMinor,
    ).toBe(59_800);
    expect(result).toMatchObject({
      notes: ['dropped-out-of-band:42'],
      fetchedAt: '2026-10-14T15:00:00.000Z',
      pointOfSale: 'unknown',
    });
    expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e] : []))).toEqual([
      expect.objectContaining({
        providerId: 'fixture',
        costMicroGbp: COST,
        tileIndex: 0,
        endpointPath: '/calendar',
        httpAttempt: 1,
      }),
    ]);
    expect(budget.events.find((e) => e.type === 'finalise')).toMatchObject({
      outcome: 'ok',
      httpStatus: 200,
    });
  });

  it('reports noFares from the pair file and leaves noData nights absent', async () => {
    const { discovery } = setup();
    const lgw = { ...q, origin: asIata('LGW') };
    const r = await drive(discovery.fetchTile(firstTile(lgw), lgw, ctx()));
    if (r.kind !== 'tile') throw new Error(r.kind);
    expect([r.noFares.length, r.prices.length]).toEqual([7, 77]);
  });

  it('fetches every page of a paged tile under one tileIndex (multi-row tile for parity, pie-008)', async () => {
    const { discovery, budget } = setup();
    const paged = { ...q, origin: asIata('LGW'), destination: asIata('EWR') };
    const r = await drive(discovery.fetchTile(firstTile(paged), paged, ctx()));
    if (r.kind !== 'tile') throw new Error(r.kind);
    expect(r.prices).toHaveLength(84);
    const reserves = budget.events.flatMap((e) => (e.type === 'reserve' ? [e] : []));
    expect(reserves).toHaveLength(4);
    expect(reserves.every((e) => e.tileIndex === 0 && e.httpAttempt === 1)).toBe(true);
  });

  it('caches a tile only when the server marks it cacheable; the repeat is a cache-hit row with the tile index', async () => {
    const { discovery, budget } = setup();
    const plan = firstTile();
    await drive(discovery.fetchTile(plan, q, ctx()));
    await drive(discovery.fetchTile(plan, q, ctx()));
    expect([budget.count('fetch'), budget.count('cache-hit')]).toEqual([2, 0]);
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'cacheable' }, times: 1 }]);
    const marked = { ...q, departureFrom: asIsoDate('2026-11-09') };
    await drive(discovery.fetchTile(firstTile(marked), marked, ctx()));
    await drive(discovery.fetchTile(firstTile(marked), marked, ctx({ executionId: 'exec-2' })));
    expect(budget.events.filter((e) => e.type === 'cache-hit')).toEqual([
      expect.objectContaining({ providerId: 'fixture', executionId: 'exec-2', tileIndex: 0 }),
    ]);
  });

  it('returns tile-error for a ProviderError after retries, marking exactly its covered cells', async () => {
    await scenario([
      {
        match: { path: '/calendar', params: { departFrom: '2026-11-02' } },
        respond: { kind: 'status', status: 503 },
        times: 3,
      },
    ]);
    const { discovery } = setup();
    const plan = firstTile();
    const r = await drive(discovery.fetchTile(plan, q, ctx()));
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'upstream', httpStatus: 503 } });
    expect(r.coveredCells).toBe(plan.coveredCells);
  });

  it.each([
    [{ kind: 'no-currency' }, 'missing-currency'],
    [
      {
        kind: 'status',
        status: 200,
        body: {
          currency: 'GBP',
          origin: 'LHR',
          destination: 'JFK',
          page: 1,
          pages: 1,
          prices: [],
          noFares: [],
        },
      },
      'not-synthetic',
    ],
    [
      {
        kind: 'status',
        status: 200,
        body: {
          synthetic: true,
          currency: 'GBP',
          origin: 'LGW',
          destination: 'JFK',
          page: 1,
          pages: 1,
          prices: [],
          noFares: [],
        },
      },
      'pair-mismatch',
    ],
    [
      {
        kind: 'status',
        status: 200,
        body: {
          synthetic: true,
          currency: 'GBP',
          origin: 'LHR',
          destination: 'JFK',
          page: 1,
          pages: 1,
          prices: [{ departureDate: '2026-11-02' }],
          noFares: [],
        },
      },
      'malformed-entry',
    ],
    [{ kind: 'malformed' }, 'malformed-json'],
  ] as const)('a %j response is a parse tile-error ([%s])', async (respond, code) => {
    await scenario([{ match: { path: '/calendar' }, respond }]);
    const { discovery } = setup();
    expect(await drive(discovery.fetchTile(firstTile(), q, ctx()))).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'parse', reason: undefined, message: expect.stringContaining(`[${code}]`) },
    });
  });

  it('AbortedError propagates out of fetchTile (it is not a tile-error)', async () => {
    await scenario([{ match: { path: '/calendar' }, respond: { kind: 'hang' } }]);
    const { discovery } = setup();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    expect(await driveError(discovery.fetchTile(firstTile(), q, ctx({ signal: ac.signal })))).toBeInstanceOf(
      AbortedError,
    );
  });
});

describe('fixture verification through the real http-kit and msw', () => {
  beforeEach(() => {
    useFakeTime();
    server.use(...fixtureHandlers(defaultFixtureRoot(), GATE));
  });
  afterEach(() => vi.useRealTimers());

  it('search returns priced synthetic offers with no booking link, the requested cabin and the server’s taxesIncluded', async () => {
    const { verification, budget } = setup();
    const r = await drive(verification.search(iq, ctx()));
    expect(r).toMatchObject({
      coverage: 'priced',
      partial: false,
      failedExpansions: 0,
      fetchedAt: '2026-10-14T15:00:00.000Z',
      pointOfSale: 'unknown',
    });
    expect(r.routeHistory).toBeUndefined();
    expect(r.offers).toHaveLength(2);
    expect(r.offers[0]).toMatchObject({
      seller: 'Synthetic Air',
      requestedCabin: 'economy',
      amountMinor: 63_600,
      currency: 'GBP',
      taxesIncluded: true,
      booking: { kind: 'none' },
      baggage: { cabinBag: 'included', checkedBags: 1 },
      outbound: [
        {
          marketingCarrier: 'ZZ',
          flightNumber: '101',
          from: 'LHR',
          to: 'JFK',
          depart: '2026-11-02T09:30',
          timeKind: 'local',
          cabin: 'economy',
        },
      ],
    });
    expect(budget.events.find((e) => e.type === 'reserve')).toMatchObject({
      endpointPath: '/itinerary',
      tileIndex: null,
      costMicroGbp: COST,
    });
  });

  it('search: empty → coverage empty; no-return-legs → upstream non-retryable with that reason; partial → partial', async () => {
    const { verification } = setup();
    await scenario([{ match: { path: '/itinerary' }, respond: { kind: 'empty' }, times: 1 }]);
    expect(await drive(verification.search(iq, ctx()))).toMatchObject({ coverage: 'empty', offers: [] });
    await scenario([{ match: { path: '/itinerary' }, respond: { kind: 'no-return-legs' }, times: 1 }]);
    const err = await driveError(verification.search(iq, ctx()));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'upstream', reason: 'no-return-legs', retryable: false });
    await scenario([
      { match: { path: '/itinerary' }, respond: { kind: 'partial', failedExpansions: 1 }, times: 1 },
    ]);
    expect(await drive(verification.search(iq, ctx()))).toMatchObject({
      coverage: 'priced',
      partial: true,
      failedExpansions: 1,
    });
  });

  it('a chained pair makes 1 + 2 × expandTop calls and returns the airline and agency offers per outbound', async () => {
    const { verification, budget } = setup();
    const r = await drive(verification.search(chained, ctx()));
    expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e.endpointPath] : []))).toEqual([
      '/itinerary',
      '/itinerary/return',
      '/itinerary/booking',
      '/itinerary/return',
      '/itinerary/booking',
    ]);
    expect(r.offers.map((o) => o.seller)).toEqual([
      'Synthetic Air',
      'Synthetic Agency',
      'Synthetic Travel',
      'Synthetic Agency',
    ]);
    expect(r).toMatchObject({ coverage: 'priced', partial: false });
  });

  it('a chained return step that fails after retries counts as a failed expansion (partial)', async () => {
    await scenario([
      {
        match: { path: '/itinerary/return', params: { outbound: 'o1' } },
        respond: { kind: 'status', status: 503 },
        times: 3,
      },
    ]);
    const { verification } = setup();
    const r = await drive(verification.search(chained, ctx()));
    expect(r).toMatchObject({ partial: true, failedExpansions: 1 });
    expect(r.offers).toHaveLength(2);
  });

  it('every chained return step failing → upstream no-return-legs', async () => {
    await scenario([{ match: { path: '/itinerary/return' }, respond: { kind: 'status', status: 404 } }]);
    const { verification } = setup();
    expect(await driveError(verification.search(chained, ctx()))).toMatchObject({
      kind: 'upstream',
      reason: 'no-return-legs',
    });
  });

  it.each([
    [401, 'auth'],
    [402, 'quota'],
  ] as const)(
    'a %i on a chained step propagates as %s and stops the chain (prov-r2-002, spec §5.4 rev 12)',
    async (status, kind) => {
      await scenario([
        {
          match: { path: '/itinerary/return', params: { outbound: 'o0' } },
          respond: { kind: 'status', status },
        },
      ]);
      const { verification, budget } = setup();
      expect(await driveError(verification.search(chained, ctx()))).toMatchObject({
        kind,
        httpStatus: status,
      });
      expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e.endpointPath] : []))).toEqual([
        '/itinerary',
        '/itinerary/return',
      ]);
    },
  );

  it('a limiter-timeout on a booking step propagates with its retry time instead of becoming a note', async () => {
    await scenario([
      {
        match: { path: '/itinerary/booking' },
        respond: { kind: 'status', status: 429, headers: { 'retry-after': '7200' } },
      },
    ]);
    const { verification } = setup();
    expect(await driveError(verification.search(chained, ctx()))).toMatchObject({
      kind: 'limiter-timeout',
      retryAfterSeconds: 7200,
    });
  });

  it('a BudgetExceeded mid-chain propagates (earlier steps stay ledgered)', async () => {
    const budget = new FakeBudget([]);
    budget.refuse = () =>
      budget.reserveCalls === 3
        ? new BudgetExceeded({ scope: 'execution-calls', cap: 2, current: 2, requested: 1 })
        : null;
    const { verification } = setup({ budget });
    expect(await driveError(verification.search(chained, ctx()))).toBeInstanceOf(BudgetExceeded);
    expect(budget.events.flatMap((e) => (e.type === 'reserve' ? [e.endpointPath] : []))).toEqual([
      '/itinerary',
      '/itinerary/return',
    ]);
  });
});

describe('fixture provider transport and recording', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('works over the gated in-process seam (fixture mode) with no msw handler, scenarios sent to that router', async () => {
    const router = fixtureRouter(defaultFixtureRoot(), GATE);
    const { discovery, budget } = setup({
      inProcessHosts: { 'fixture.local': async (req) => router.fetch(req) },
    });
    expect(await drive(discovery.fetchTile(firstTile(), q, ctx()))).toMatchObject({
      kind: 'tile',
      pointOfSale: 'unknown',
    });
    await router.fetch(
      scenarioRequest([{ match: { path: '/calendar' }, respond: { kind: 'status', status: 401 } }]),
    );
    expect(await drive(discovery.fetchTile(firstTile(), q, ctx()))).toMatchObject({
      kind: 'tile-error',
      error: { kind: 'auth' },
    });
    expect([budget.count('fetch'), budget.count('reserve')]).toEqual([0, 2]);
  });

  it('never records, even when ctx.recordFixtures is true (test-002, prov-005)', async () => {
    server.use(...fixtureHandlers(defaultFixtureRoot(), GATE));
    let recordCalls = 0;
    const spy: FixtureRecorder = {
      record: async () => {
        recordCalls += 1;
        return '';
      },
    };
    const { discovery, verification } = setup({ recorder: spy });
    expect(await drive(discovery.fetchTile(firstTile(), q, ctx({ recordFixtures: true })))).toMatchObject({
      kind: 'tile',
    });
    expect(await drive(verification.search(chained, ctx({ recordFixtures: true })))).toMatchObject({
      coverage: 'priced',
    });
    expect(recordCalls).toBe(0);
  });

  it('healthcheck makes no call', async () => {
    const { provider, budget } = setup();
    expect(await provider.healthcheck(ctx())).toEqual({
      ok: true,
      detail: 'synthetic fixture provider; no upstream call',
    });
    expect(budget.reserveCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/provider.test.ts`
Expected: FAIL — `Failed to load url ../../src/fixture/provider.js`.

- [ ] **Step 3: Implement**

`src/fixture/provider.ts`:

```ts
import {
  asIata,
  type Cabin,
  type CapabilityInfo,
  type CellKey,
  type Clock,
  cabinSchema,
  cellKeyString,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type Iata,
  type IsoDate,
  type IsoDateTime,
  type ItineraryQuery,
  type ItinerarySearchResult,
  isoDateSchema,
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
import type { HttpKit, HttpKitRequest, HttpKitResponse, ProviderHttpLimits } from '../http/types.js';
import { isRecord } from '../util.js';
import { FIXTURE_HOST, FIXTURE_ORIGIN } from './constants.js';
import { epochDayOf, isoDateOfEpochDay } from './dates.js';

/** Departure days per discovery tile. */
export const FIXTURE_TILE_DAYS = 7;
/** TTL for calendar responses the server marks cacheable. */
export const FIXTURE_CALENDAR_TTL_SECONDS = 3600;

/** Every cabin; the list is core's (arch-r2-008). */
const CABINS: readonly Cabin[] = cabinSchema.options;
const SUPPLIED: readonly SuppliedField[] = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'selfTransfer',
  'baggage',
  'seller',
  'price',
];
const INFO: CapabilityInfo = {
  sourceKind: 'synthetic',
  provenanceNote:
    'synthetic data from the fixture provider, generated for tests and local development; not a fare',
  maxAgeHours: 0,
};
/** Synthetic data has no market; spec §5.1 requires pointOfSale on every result. */
const FIXTURE_POINT_OF_SALE: PointOfSale = 'unknown';

/**
 * HTTP limits for the fixture provider (spec §5.3 billable rule: `fixture` iff HTTP 200 at the configured test cost;
 * spec §9 item 2: host allowlist is fixture.local only). WP4b's httpLimitsFor uses this.
 */
export function fixtureHttpLimits(o: {
  costPerCallMicroGbp: number;
  maxWaitSeconds: number;
  requestTimeoutSeconds: number;
}): ProviderHttpLimits {
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

function enumerate(q: DiscoveryQuery): CellKey[] {
  const out: CellKey[] = [];
  for (let d = epochDayOf(q.departureFrom); d <= epochDayOf(q.departureTo); d += 1) {
    for (let n = q.minNights; n <= q.maxNights; n += 1) {
      out.push({
        origin: q.origin,
        destination: q.destination,
        departureDate: isoDateOfEpochDay(d),
        returnDate: isoDateOfEpochDay(d + n),
      });
    }
  }
  return out;
}

/**
 * Pure, deterministic tiling (spec §5.2): blocks of FIXTURE_TILE_DAYS departure days from `departureFrom`, each a
 * `rectangle` spanning its covered cells. With `q.cells` set, re-plans over that subset. Tiles partition the cells.
 */
export function planFixtureTiles(q: DiscoveryQuery): TilePlan[] {
  const cells = q.cells
    ? q.cells.filter((c) => c.origin === q.origin && c.destination === q.destination)
    : enumerate(q);
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
      const departFrom = deps[0];
      const departTo = deps[deps.length - 1];
      const returnFrom = rets[0];
      const returnTo = rets[rets.length - 1];
      if (
        departFrom === undefined ||
        departTo === undefined ||
        returnFrom === undefined ||
        returnTo === undefined
      )
        throw new Error('planFixtureTiles: empty block');
      return {
        index,
        coveredCells: covered,
        request: { kind: 'rectangle', departFrom, departTo, returnFrom, returnTo },
      };
    });
}

/** Parse failure with a bracketed diagnostic code in the message; `reason` stays unset (it feeds cell_outcomes.reason). */
function parseError(endpointPath: string, code: string): ProviderError {
  return new ProviderError({
    kind: 'parse',
    retryable: false,
    providerId: 'fixture',
    message: `fixture ${endpointPath}: ${code} [${code}]`,
  });
}

/** Envelope checks shared by every endpoint: synthetic marker, currency read from the response, pair echo. */
function envelope(
  endpointPath: string,
  body: unknown,
  origin: string,
  destination: string,
): { b: Record<string, unknown>; currency: string } {
  if (!isRecord(body)) throw parseError(endpointPath, 'malformed-envelope');
  // why: spec §5.5 — the provider refuses anything not marked synthetic, so it can never carry real data.
  if (body.synthetic !== true) throw parseError(endpointPath, 'not-synthetic');
  const currency = body.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
    throw parseError(endpointPath, 'missing-currency');
  if (body.origin !== origin || body.destination !== destination)
    throw parseError(endpointPath, 'pair-mismatch');
  return { b: body, currency };
}

/** A dated calendar entry, its dates narrowed by core's schema so lookups go through cellKeyString (arch-r2-007). */
function dated(
  endpointPath: string,
  e: unknown,
): { departureDate: IsoDate; returnDate: IsoDate; e: Record<string, unknown> } {
  if (!isRecord(e)) throw parseError(endpointPath, 'malformed-entry');
  const departureDate = isoDateSchema.safeParse(e.departureDate);
  const returnDate = isoDateSchema.safeParse(e.returnDate);
  if (!departureDate.success || !returnDate.success) throw parseError(endpointPath, 'malformed-entry');
  return { departureDate: departureDate.data, returnDate: returnDate.data, e };
}

function iata(endpointPath: string, v: unknown): Iata {
  if (typeof v !== 'string') throw parseError(endpointPath, 'malformed-segment');
  try {
    return asIata(v);
  } catch {
    throw parseError(endpointPath, 'malformed-segment');
  }
}

function segment(endpointPath: string, s: unknown): RawSegment {
  if (!isRecord(s)) throw parseError(endpointPath, 'malformed-segment');
  const { carrier, flightNumber, depart, arrive, cabin } = s;
  if (
    typeof carrier !== 'string' ||
    typeof flightNumber !== 'string' ||
    typeof depart !== 'string' ||
    typeof arrive !== 'string'
  )
    throw parseError(endpointPath, 'malformed-segment');
  const seg: RawSegment = {
    marketingCarrier: carrier,
    flightNumber,
    from: iata(endpointPath, s.from),
    to: iata(endpointPath, s.to),
    depart,
    arrive,
    timeKind: 'local',
  };
  const stated = cabinSchema.safeParse(cabin);
  if (stated.success) seg.cabin = stated.data;
  return seg;
}

function offer(endpointPath: string, o: unknown, q: ItineraryQuery, currency: string): RawOffer {
  if (!isRecord(o)) throw parseError(endpointPath, 'malformed-offer');
  const { seller, amountMinor, outbound, inbound } = o;
  if (
    typeof seller !== 'string' ||
    typeof amountMinor !== 'number' ||
    !Number.isInteger(amountMinor) ||
    amountMinor < 0
  )
    throw parseError(endpointPath, 'malformed-offer');
  if (!Array.isArray(outbound) || !Array.isArray(inbound)) throw parseError(endpointPath, 'malformed-offer');
  const raw: RawOffer = {
    outbound: outbound.map((s: unknown) => segment(endpointPath, s)),
    inbound: inbound.map((s: unknown) => segment(endpointPath, s)),
    seller,
    requestedCabin: q.cabin,
    amountMinor,
    currency,
    // why: synthetic data never links anywhere (spec §5.2 vendor links; §5.5 no fabricated data).
    booking: { kind: 'none' },
  };
  // why: only what the response states is passed on (prov-011); nothing is defaulted.
  if (typeof o.taxesIncluded === 'boolean') raw.taxesIncluded = o.taxesIncluded;
  if (typeof o.selfTransfer === 'boolean') raw.selfTransfer = o.selfTransfer;
  const bag = o.baggage;
  if (isRecord(bag)) {
    raw.baggage = {
      ...(bag.cabinBag === 'included' || bag.cabinBag === 'not-included' ? { cabinBag: bag.cabinBag } : {}),
      ...(typeof bag.checkedBags === 'number' ? { checkedBags: bag.checkedBags } : {}),
    };
  }
  return raw;
}

function offersOf(
  endpointPath: string,
  b: Record<string, unknown>,
  q: ItineraryQuery,
  currency: string,
): RawOffer[] {
  const offers = b.offers;
  if (!Array.isArray(offers)) throw parseError(endpointPath, 'malformed-envelope');
  return offers.map((o: unknown) => offer(endpointPath, o, q, currency));
}

const older = (a: IsoDateTime | undefined, b: IsoDateTime): IsoDateTime => (a === undefined || b < a ? b : a);

/** Spec §5.4 rev 12: a chain step that failed for vendor or transport reasons; refusals of the account are not. */
function isExpansionFailure(e: unknown): e is ProviderError {
  return e instanceof ProviderError && (e.kind === 'upstream' || e.kind === 'network' || e.kind === 'parse');
}

/**
 * The fixture provider (spec §5.5): an ordinary HTTP adapter against http://fixture.local through the real
 * http-kit, constructed only when syntheticAllowed(config). Every price is sourceKind 'synthetic'.
 */
export function fixtureProvider(opts: {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  config: SyntheticGateInput;
  costMicroGbp: number;
}): FlightProvider {
  if (!syntheticAllowed(opts.config))
    throw new Error('fixture provider refused: syntheticAllowed(config) is false (spec §5.5)');
  const log = opts.log.child({ providerId: 'fixture' });

  const call = (
    endpointPath: string,
    params: Record<string, string>,
    ctx: ProviderContext,
    tileIndex: number | null,
    cache: HttpKitRequest['cache'],
  ): Promise<HttpKitResponse> => {
    const url = new URL(endpointPath, FIXTURE_ORIGIN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // why: recordFixtures is always false — synthetic data is never recorded (spec §5.5).
    return opts.http.request({
      providerId: 'fixture',
      executionId: ctx.executionId,
      tileIndex,
      endpointPath,
      method: 'GET',
      url,
      headers: { accept: 'application/json' },
      cache,
      signal: ctx.signal,
      recordFixtures: false,
    });
  };
  // why: cached only when the server marks the body cacheable, so layer-A scenarios are never masked by default.
  const calendarCache: HttpKitRequest['cache'] = {
    ttlSeconds: FIXTURE_CALENDAR_TTL_SECONDS,
    accept: (b) => isRecord(b) && b.synthetic === true && b.cacheable === true,
  };

  async function fetchTile(
    plan: TilePlan,
    q: DiscoveryQuery,
    ctx: ProviderContext,
  ): Promise<DiscoveryTileResult> {
    const fail = (error: ProviderError): DiscoveryTileResult => ({
      kind: 'tile-error',
      index: plan.index,
      coveredCells: plan.coveredCells,
      error,
    });
    const r = plan.request;
    if (r.kind !== 'rectangle') return fail(parseError('/calendar', `unsupported-tile-${r.kind}`));
    const params = {
      origin: q.origin,
      destination: q.destination,
      departFrom: r.departFrom,
      departTo: r.departTo,
      returnFrom: r.returnFrom,
      returnTo: r.returnTo,
      cabin: q.cabin,
      currency: q.currency,
    };
    const covered = new Map(plan.coveredCells.map((c) => [cellKeyString(c), c]));
    const prices: RawCalendarPrice[] = [];
    const noFares: CellKey[] = [];
    let dropped = 0;
    let fetchedAt: IsoDateTime | undefined;
    try {
      let page = 1;
      let pages = 1;
      do {
        const res = await call(
          '/calendar',
          page === 1 ? params : { ...params, page: String(page) },
          ctx,
          plan.index,
          calendarCache,
        );
        // why: a multi-call result carries the oldest call's fetchedAt (spec §2).
        fetchedAt = older(fetchedAt, res.fetchedAt);
        const { b, currency } = envelope('/calendar', res.body, q.origin, q.destination);
        const { prices: rawPrices, noFares: rawNoFares, pages: total } = b;
        if (
          !Array.isArray(rawPrices) ||
          !Array.isArray(rawNoFares) ||
          typeof total !== 'number' ||
          !Number.isInteger(total) ||
          total < 1
        )
          throw parseError('/calendar', 'malformed-envelope');
        pages = total;
        for (const raw of rawPrices) {
          const { departureDate, returnDate, e } = dated('/calendar', raw);
          const amount = e.amountMinor;
          if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0)
            throw parseError('/calendar', 'malformed-entry');
          const cell = covered.get(
            cellKeyString({ origin: q.origin, destination: q.destination, departureDate, returnDate }),
          );
          if (cell === undefined) dropped += 1;
          else prices.push({ ...cell, amountMinor: amount, currency });
        }
        for (const raw of rawNoFares) {
          const { departureDate, returnDate } = dated('/calendar', raw);
          const cell = covered.get(
            cellKeyString({ origin: q.origin, destination: q.destination, departureDate, returnDate }),
          );
          if (cell === undefined) dropped += 1;
          else noFares.push(cell);
        }
        page += 1;
      } while (page <= pages);
    } catch (e) {
      // why: spec §8.1 — a ProviderError marks exactly this tile's cells; AbortedError and BudgetExceeded propagate.
      if (e instanceof ProviderError) return fail(e);
      throw e;
    }
    if (fetchedAt === undefined) throw new Error('fetchTile: no page fetched');
    log.debug(
      { tileIndex: plan.index, prices: prices.length, noFares: noFares.length, dropped },
      'fixture tile',
    );
    return {
      kind: 'tile',
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt,
      pointOfSale: FIXTURE_POINT_OF_SALE,
      prices,
      noFares,
      notes: dropped > 0 ? [`dropped-out-of-band:${dropped}`] : [],
    };
  }

  async function search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult> {
    const params = {
      origin: q.origin,
      destination: q.destination,
      departureDate: q.departureDate,
      returnDate: q.returnDate,
      cabin: q.cabin,
      currency: q.currency,
      expandTop: String(q.expandTop),
    };
    const first = await call('/itinerary', params, ctx, null, 'never');
    const { b, currency } = envelope('/itinerary', first.body, q.origin, q.destination);
    const noReturnLegs = (): ProviderError =>
      new ProviderError({
        kind: 'upstream',
        retryable: false,
        providerId: 'fixture',
        reason: 'no-return-legs',
        message: 'fixture /itinerary: outbound options but no return legs',
      });
    const result = (
      offers: RawOffer[],
      failedExpansions: number,
      notes: string[],
      fetchedAt: IsoDateTime,
    ): ItinerarySearchResult => ({
      offers,
      coverage: offers.length > 0 ? 'priced' : 'empty',
      fetchedAt,
      pointOfSale: FIXTURE_POINT_OF_SALE,
      partial: failedExpansions > 0,
      failedExpansions,
      notes,
    });

    if (b.chain === true) {
      const outbounds = b.outbounds;
      if (!Array.isArray(outbounds) || !outbounds.every((o): o is string => typeof o === 'string'))
        throw parseError('/itinerary', 'malformed-envelope');
      const offers: RawOffer[] = [];
      const notes: string[] = [];
      let failed = 0;
      let fetchedAt = first.fetchedAt;
      for (const outbound of outbounds.slice(0, q.expandTop)) {
        try {
          const ret = await call('/itinerary/return', { ...params, outbound }, ctx, null, 'never');
          fetchedAt = older(fetchedAt, ret.fetchedAt);
          const step = envelope('/itinerary/return', ret.body, q.origin, q.destination);
          offers.push(...offersOf('/itinerary/return', step.b, q, step.currency));
        } catch (e) {
          // why: spec §5.4 rev 12 — only a vendor or transport failure (upstream, network, parse) is a failed expansion;
          // auth, quota, rate-limit and limiter-timeout refusals, budget and abort stop the chain unchanged.
          if (!isExpansionFailure(e)) throw e;
          failed += 1;
          continue;
        }
        try {
          const book = await call('/itinerary/booking', { ...params, outbound }, ctx, null, 'never');
          fetchedAt = older(fetchedAt, book.fetchedAt);
          const step = envelope('/itinerary/booking', book.body, q.origin, q.destination);
          offers.push(...offersOf('/itinerary/booking', step.b, q, step.currency));
        } catch (e) {
          if (!isExpansionFailure(e)) throw e;
          notes.push(`booking-step-failed:${outbound}`);
        }
      }
      if (outbounds.length > 0 && offers.length === 0) throw noReturnLegs();
      return result(offers, failed, notes, fetchedAt);
    }

    const { outboundOptions, failedExpansions } = b;
    if (typeof outboundOptions !== 'number' || typeof failedExpansions !== 'number')
      throw parseError('/itinerary', 'malformed-envelope');
    const offers = offersOf('/itinerary', b, q, currency);
    if (outboundOptions > 0 && offers.length === 0) throw noReturnLegs();
    return result(offers, failedExpansions, [], first.fetchedAt);
  }

  return {
    id: 'fixture',
    displayName: 'Fixture provider (synthetic)',
    suppliedFields: SUPPLIED,
    cabins: CABINS,
    discovery: { info: INFO, plan: planFixtureTiles, fetchTile },
    verification: {
      info: INFO,
      // why: an upper bound matching the SearchApi shape (step 1 + return and booking per expanded outbound); plain pairs use fewer.
      estimate: (q) => ({
        calls: 1 + 2 * q.expandTop,
        costMicroGbp: (1 + 2 * q.expandTop) * opts.costMicroGbp,
        seconds: 1 + 2 * q.expandTop,
        notes: ['fixture provider: synthetic calls'],
      }),
      search,
    },
    healthcheck: async () => ({ ok: true, detail: 'synthetic fixture provider; no upstream call' }),
  };
}
```

`src/fixture/index.ts`: add

```ts
export { FIXTURE_TILE_DAYS } from './provider.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture`
Expected: PASS, 64 tests (31 server, 33 provider).

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: fixture provider behind syntheticAllowed: paged tiles, chained verification, cacheable tiles (spec §5.5)"
```

### Task 4.11: Replay of recorded fixtures — `replayHandlers` with a miss log, and `loadRecorded`

**Files:**
- Create: `src/testing/replay.ts`
- Modify: `src/testing/index.ts`
- Test: `test/testing/replay.test.ts`

**Interfaces:**
- Consumes: `loadRecordedFixture`, `RecordedFixture` (Task 4.7); msw 3.0.3.
- Produces (`@gmt/providers/testing`): `replayHandlers(recordedRoot, opts?: { session?: string }): { handlers: RequestHandler[]; misses(): string[] }`, `loadRecorded(root, providerId, endpointPath): RecordedFixture[]` — consumed by WP5/WP6 adapter tests and WP13's layer-B engine tests.

Rules: a request is answered by the recordings whose method, origin, path and decoded query (sorted pairs) equal the request's, placeholders compared as recorded; identical requests from one session take the matching recordings in `recordedAt` order (file name breaks ties), then the last one repeatedly; every recording loads through `loadRecordedFixture`, so a hand-edited file fails before any test uses it; `.raw.json` files and `params-*.json` allowlists are skipped. **An unmatched request is pushed to `misses()`** (method, URL without query, sorted query names) **and answered with `HttpResponse.error()`** — msw 3 would otherwise pass it to the real network (arch-r2-001); through http-kit it surfaces as a retried network error, so **every consumer asserts `expect(replay.misses()).toEqual([])` in `afterEach`**, and the tests prove with a lower-priority guard handler that a miss never falls through. A match key served by recordings from more than one `session` is refused at construction unless `opts.session` selects one (prov-r2-001); WP4b stamps every recording with the same `recordedBy`, so `recordedBy` cannot tell runs apart.

- [ ] **Step 1: Write the failing test**

`test/testing/replay.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock, type IsoDateTime } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecorder, loadRecordedFixture } from '../../src/http/recorder.js';
import { loadRecorded, replayHandlers } from '../../src/testing/replay.js';
import { ALL_SECRETS, makeKit, req, SEARCH } from '../fakes.js';
import { arr, jsonOf, obj, str } from '../support/guards.js';
import { server } from '../support/msw.js';
import { driveError, useFakeTime } from '../support/time.js';

const T0 = '2026-10-14T15:00:00.000Z';
function tree(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'gmt-rep-')), 'fixtures', 'recorded');
  mkdirSync(root, { recursive: true });
  return root;
}
const rec = (root: string) =>
  createRecorder({
    root,
    secrets: ALL_SECRETS,
    clock: fixedClock(asIsoDateTime(T0)),
    recordedBy: 'wp04-test',
  });
const at = (url: string, body: unknown, status = 200, fetchedAt: IsoDateTime = asIsoDateTime(T0)) => ({
  providerId: 'searchapi' as const,
  endpointPath: '/api/v1/search',
  request: req({ url }),
  status,
  body,
  fetchedAt,
});
/** Counts any request that would leave for the real vendor: registered first, so it runs only if replay falls through. */
function networkGuard(): { hits: () => number } {
  let hits = 0;
  server.use(
    http.all('https://www.searchapi.io/*', () => {
      hits += 1;
      return HttpResponse.error();
    }),
  );
  return { hits: () => hits };
}

async function recordChain(): Promise<string> {
  const root = tree();
  const r = rec(root);
  await r.record(
    at(`${SEARCH}?engine=google_flights&departure_id=LHR`, {
      best_flights: [{ departure_token: 'RAW-TOKEN-AAAA', price: 603 }],
    }),
  );
  await r.record(
    at(`${SEARCH}?engine=google_flights&departure_token=RAW-TOKEN-AAAA`, {
      best_flights: [{ booking_token: 'RAW-TOKEN-BBBB', price: 573 }],
    }),
  );
  await r.record(
    at(`${SEARCH}?engine=google_flights_calendar&departure_id=LGW`, { error: 'Too many combinations' }, 400),
  );
  writeFileSync(join(root, 'searchapi', 'params-2026-10-14.json'), '{"not":"a recording"}');
  return root;
}

describe('replayHandlers and loadRecorded (WP5/WP6 adapter tests, WP13 layer B)', () => {
  it('replays a recorded chain: the served placeholder, sent back, matches the next recorded request', async () => {
    const replay = replayHandlers(await recordChain());
    server.use(...replay.handlers);
    const step1 = obj(await jsonOf(await fetch(`${SEARCH}?departure_id=LHR&engine=google_flights`)));
    const token = str(obj(arr(step1.best_flights)[0]).departure_token);
    expect(token).toMatch(/^<departure_token:0@20261014T150000000Z-[0-9a-f]{6}>$/);
    const step2 = await fetch(
      `${SEARCH}?engine=google_flights&departure_token=${encodeURIComponent(token)}`,
      { headers: { authorization: 'Bearer anything' } },
    );
    expect(obj(arr(obj(await jsonOf(step2)).best_flights)[0])).toMatchObject({ price: 573 });
    expect(replay.misses()).toEqual([]);
  });

  it('replays the recorded status and body of an error response', async () => {
    server.use(...replayHandlers(await recordChain()).handlers);
    const res = await fetch(`${SEARCH}?engine=google_flights_calendar&departure_id=LGW`);
    expect([res.status, await jsonOf(res)]).toEqual([400, { error: 'Too many combinations' }]);
  });

  it('an unrecorded request is logged as a miss (names only), answered with a network error, and never reaches the network (arch-r2-001)', async () => {
    const guard = networkGuard();
    const replay = replayHandlers(await recordChain());
    server.use(...replay.handlers);
    await expect(fetch(`${SEARCH}?engine=google_flights&departure_id=EWR`)).rejects.toThrow();
    expect(replay.misses()).toEqual(['GET https://www.searchapi.io/api/v1/search ?departure_id&engine']);
    expect(guard.hits()).toBe(0);
  });

  it('identical requests from one session replay in recordedAt order, then repeat the last; loadRecorded skips raw bodies and allowlists', async () => {
    const root = tree();
    const r = rec(root);
    const url = `${SEARCH}?engine=google_flights&departure_id=LHR`;
    await r.record(at(url, { search: 1 }, 200, asIsoDateTime('2026-10-14T15:00:00.000Z')));
    await r.record(at(url, { search: 2 }, 200, asIsoDateTime('2026-10-14T15:00:01.000Z')));
    writeFileSync(join(root, 'searchapi', 'params-2026-10-14.json'), '{}');
    expect(loadRecorded(root, 'searchapi', '/api/v1/search').map((f) => f.body)).toEqual([
      { search: 1 },
      { search: 2 },
    ]);
    expect(loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates')).toEqual([]);
    server.use(...replayHandlers(root).handlers);
    const bodies = [
      await jsonOf(await fetch(url)),
      await jsonOf(await fetch(url)),
      await jsonOf(await fetch(url)),
    ];
    expect(bodies).toEqual([{ search: 1 }, { search: 2 }, { search: 2 }]);
  });

  it('refuses a request recorded by two same-day sessions unless opts.session picks one (prov-r2-001)', async () => {
    const root = tree();
    const url = `${SEARCH}?engine=google_flights&departure_id=LHR`;
    const first = await rec(root).record(at(url, { run: 1 }));
    await rec(root).record(at(url, { run: 2 }, 200, asIsoDateTime('2026-10-14T18:00:00.000Z')));
    expect(() => replayHandlers(root)).toThrow(/opts\.session/);
    const session = loadRecordedFixture(first, root).session;
    server.use(...replayHandlers(root, { session }).handlers);
    expect(await jsonOf(await fetch(url))).toEqual({ run: 1 });
  });
});

describe('a replay miss through http-kit (prov-001)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('shows up in misses() as a retried network error, so the consumer’s afterEach fails; nothing reaches the network', async () => {
    const guard = networkGuard();
    const replay = replayHandlers(await recordChain());
    server.use(...replay.handlers);
    const { kit } = makeKit();
    expect(
      await driveError(kit.request(req({ url: `${SEARCH}?engine=google_flights&departure_id=EWR` }))),
    ).toMatchObject({ kind: 'network' });
    expect(replay.misses()).toHaveLength(3);
    expect(guard.hits()).toBe(0);
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
import { stripUrl } from '../http/scrub.js';
import { byPair } from '../util.js';
import type { RequestHandler } from './handlers.js';

const isRecording = (name: string): boolean =>
  name.endsWith('.json') && !name.endsWith('.raw.json') && !name.startsWith('params-');

/** Match key: method, origin, path and the sorted, decoded query pairs (placeholders as recorded). */
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
  return entries.flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : isRecording(e.name) ? [join(dir, e.name)] : [],
  );
}

/** Loaded recordings in recordedAt order, file path breaking ties (pie-010). */
function loadAll(root: string, dir: string): Array<{ path: string; f: RecordedFixture }> {
  return walk(dir)
    .map((path) => ({ path, f: loadRecordedFixture(path, root) }))
    .sort((a, b) =>
      a.f.recordedAt !== b.f.recordedAt
        ? a.f.recordedAt < b.f.recordedAt
          ? -1
          : 1
        : a.path < b.path
          ? -1
          : a.path > b.path
            ? 1
            : 0,
    );
}

/** One provider endpoint's recordings, in recordedAt order. `endpointPath` uses the recorder's layout (/ → _). */
export function loadRecorded(root: string, providerId: string, endpointPath: string): RecordedFixture[] {
  return loadAll(root, join(root, providerId, endpointPath.replaceAll('/', '_'))).map(({ f }) => f);
}

/**
 * msw handlers that answer requests from the recorded tree (plan http-kit block): match on method, origin, path and
 * query (placeholders as recorded); serve the recorded status and body; identical requests from one session take the
 * recordings in recordedAt order, then the last. A match key served by more than one recording session is refused at
 * construction unless `opts.session` picks one (prov-r2-001). An unmatched request is pushed to `misses()` and answered
 * with a network error, so nothing ever reaches the real network (arch-r2-001); consumers assert misses() is empty.
 */
export function replayHandlers(
  recordedRoot: string,
  opts: { session?: string } = {},
): { handlers: RequestHandler[]; misses(): string[] } {
  const all = loadAll(recordedRoot, recordedRoot).filter(
    ({ f }) => opts.session === undefined || f.session === opts.session,
  );
  const byKey = new Map<string, RecordedFixture[]>();
  for (const { f } of all) {
    const k = keyOf(f.request.method, new URL(f.request.url));
    byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  for (const [k, list] of byKey) {
    const sessions = new Set(list.map((f) => f.session));
    if (sessions.size > 1)
      throw new Error(
        `replay: ${k} is recorded by sessions ${[...sessions].join(' and ')}; pass opts.session to choose one`,
      );
  }
  const served = new Map<string, number>();
  const misses: string[] = [];
  const origins = [...new Set(all.map(({ f }) => new URL(f.request.url).origin))].sort();
  const handlers = origins.map((origin) =>
    http.all(`${origin}/*`, ({ request }) => {
      const url = new URL(request.url);
      const k = keyOf(request.method, url);
      const list = byKey.get(k);
      const n = served.get(k) ?? 0;
      const f = list?.[Math.min(n, list.length - 1)];
      if (f === undefined) {
        // why: names only, never values — a value could be a token or a key. msw 3 passes an unanswered request
        // through to the network, so a miss is answered here with a network error instead (arch-r2-001).
        misses.push(
          `${request.method} ${stripUrl(request.url)} ?${[...new Set(url.searchParams.keys())].sort().join('&')}`,
        );
        return HttpResponse.error();
      }
      served.set(k, n + 1);
      // why: a malformed vendor body was recorded as text; replay it byte for byte so the parse path is exercised.
      const text = typeof f.body === 'string' ? f.body : JSON.stringify(f.body);
      return new HttpResponse(text, { status: f.status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return { handlers, misses: () => [...misses] };
}
```

`src/testing/index.ts` (replace; final):

```ts
// `@gmt/providers/testing`: the only module tree that imports msw (plan decision 7). Production code never imports it.
export { withContentHash } from '../http/recorder.js';
export { fixtureHandlers, type RequestHandler } from './handlers.js';
export { loadRecorded, replayHandlers } from './replay.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/testing/replay.test.ts`
Expected: PASS, 6 tests.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: replayHandlers with a miss log and session check, loadRecorded (@gmt/providers/testing)"
```

### Task 4.12: Parameter allowlists — `ParamsAllowlist`, `loadParamsAllowlist`, `assertRequestAllowed`

**Files:**
- Create: `src/params/allowlist.ts`
- Test: `test/params/allowlist.test.ts`

**Interfaces:**
- Consumes: `loadRecordedJson`, `defaultRecordedRoot`, `withContentHash` (Task 4.7); `providerIdSchema`, `isoDateSchema` (WP0).
- Produces (plan http-kit block; imported by WP4b, WP5, WP6): `ParamsAllowlist`, `loadParamsAllowlist(path, root?)`, `assertRequestAllowed(allowlist, endpointPath, url)`, `ParamsNotAllowedError`.

Rules (spec §5.2 "the dated allowlist enumerates parameter names **and values**; tests assert both"; pie-005): `endpoints` keys are `<path>` or `<path>?<name>=<value>` (SearchApi multiplexes engines on `/api/v1/search`, so it keys by `?engine=`); each entry's `names` is strictly ascending; `values` has exactly one entry per name, a non-empty string list or `'any'`; the file lives in the recorded tree and carries a valid `contentSha256`; `provider` and `recordedAt` are validated by core's schemas. `assertRequestAllowed` refuses a URL whose path is not the endpoint; picks the discriminated key whose parameter matches the URL, else the bare `<path>` key, and refuses when neither exists; then refuses any query parameter not in `names` and any value not listed. Messages name the parameter, never the value.

- [ ] **Step 1: Write the failing test**

`test/params/allowlist.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withContentHash } from '../../src/http/recorder.js';
import {
  assertRequestAllowed,
  loadParamsAllowlist,
  ParamsNotAllowedError,
} from '../../src/params/allowlist.js';

const EP = '/api/v1/search';
const good = {
  provider: 'searchapi',
  recordedAt: '2026-10-14',
  endpoints: {
    [`${EP}?engine=google_flights`]: {
      names: ['currency', 'departure_id', 'departure_token', 'engine', 'gl'],
      values: {
        currency: ['GBP'],
        departure_id: 'any',
        departure_token: 'any',
        engine: ['google_flights'],
        gl: ['gb'],
      },
    },
    [`${EP}?engine=google_flights_calendar`]: {
      names: ['currency', 'departure_id', 'engine', 'gl'],
      values: { currency: ['GBP'], departure_id: 'any', engine: ['google_flights_calendar'], gl: ['gb'] },
    },
    '/other': { names: ['q'], values: { q: 'any' } },
  },
};
let root = '';
function write(content: unknown): string {
  root = join(mkdtempSync(join(tmpdir(), 'gmt-par-')), 'fixtures', 'recorded');
  mkdirSync(join(root, 'searchapi'), { recursive: true });
  const p = join(root, 'searchapi', 'params-2026-10-14.json');
  writeFileSync(p, JSON.stringify(content));
  return p;
}
const load = (content: unknown) => {
  const p = write(content);
  return loadParamsAllowlist(p, root);
};
const allowlist = () => load(withContentHash(good));
const url = (q: string, path = EP) => new URL(`https://www.searchapi.io${path}?${q}`);
const flights = 'engine=google_flights&gl=gb&currency=GBP&departure_id=LHR';

describe('loadParamsAllowlist (spec §5.2 dated allowlist)', () => {
  it('loads a hashed allowlist from the recorded tree, built from validated parts', () => {
    expect(allowlist()).toMatchObject({
      provider: 'searchapi',
      recordedAt: '2026-10-14',
      endpoints: { '/other': { names: ['q'], values: { q: 'any' } } },
    });
  });
  it('refuses a hand-edited file (content hash)', () => {
    expect(() => load({ ...withContentHash(good), recordedAt: '2026-10-15' })).toThrow(
      /content hash mismatch/,
    );
  });
  it('refuses names that are not strictly ascending, a value entry for an unlisted name, and a name without values', () => {
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: { [EP]: { names: ['gl', 'engine'], values: { gl: ['gb'], engine: 'any' } } },
        }),
      ),
    ).toThrow(/ascending/);
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: { [EP]: { names: ['gl'], values: { gl: ['gb'], hl: ['en'] } } },
        }),
      ),
    ).toThrow(/hl/);
    expect(() =>
      load(
        withContentHash({ ...good, endpoints: { [EP]: { names: ['gl', 'hl'], values: { gl: ['gb'] } } } }),
      ),
    ).toThrow(/hl/);
  });
  it('refuses an unknown provider and a recordedAt that is not a real date (arch-010)', () => {
    expect(() => load(withContentHash({ ...good, provider: 'kiwi' }))).toThrow(/provider/);
    expect(() => load(withContentHash({ ...good, recordedAt: '2026-13-40' }))).toThrow(/recordedAt/);
  });
  it('refuses an endpoint key that is neither <path> nor <path>?<name>=<value>', () => {
    expect(() =>
      load(
        withContentHash({ ...good, endpoints: { 'api/v1/search': { names: ['q'], values: { q: 'any' } } } }),
      ),
    ).toThrow(/endpoint key/);
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: { [`${EP}?engine=a&gl=b`]: { names: ['q'], values: { q: 'any' } } },
        }),
      ),
    ).toThrow(/endpoint key/);
  });
});

describe('assertRequestAllowed (names and values)', () => {
  it('accepts listed names with listed values, and any value where the allowlist says any', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url(flights))).not.toThrow();
  });
  it('refuses an unlisted parameter, naming it', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url(`${flights}&hl=en`))).toThrow(
      ParamsNotAllowedError,
    );
    expect(() => assertRequestAllowed(allowlist(), EP, url(`${flights}&hl=en`))).toThrow(/hl/);
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
    expect(() => assertRequestAllowed(allowlist(), '/nowhere', url('q=1', '/nowhere'))).toThrow(
      ParamsNotAllowedError,
    );
    expect(() =>
      assertRequestAllowed(allowlist(), EP, url('engine=google_flights', '/api/v2/search')),
    ).toThrow(/path/);
  });
});

describe('engine-discriminated keys (pie-005)', () => {
  it('uses the key whose engine matches: departure_token is allowed on google_flights and refused on the calendar engine', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url(`${flights}&departure_token=x`))).not.toThrow();
    expect(() =>
      assertRequestAllowed(
        allowlist(),
        EP,
        url('engine=google_flights_calendar&gl=gb&currency=GBP&departure_token=x'),
      ),
    ).toThrow(/departure_token/);
  });
  it('refuses a request matching no discriminated key when the path has only discriminated keys', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url('engine=google_hotels&gl=gb'))).toThrow(
      /no allowlist entry/,
    );
  });
  it('falls back to the bare <path> key when the discriminator does not match and a bare key exists', () => {
    const withBare = load(
      withContentHash({
        ...good,
        endpoints: { ...good.endpoints, [EP]: { names: ['engine'], values: { engine: ['google_hotels'] } } },
      }),
    );
    expect(() => assertRequestAllowed(withBare, EP, url('engine=google_hotels'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/params/allowlist.test.ts`
Expected: FAIL — `Failed to load url ../../src/params/allowlist.js`.

- [ ] **Step 3: Implement**

`src/params/allowlist.ts`:

```ts
import { type IsoDate, isoDateSchema, type ProviderId, providerIdSchema } from '@gmt/core';
import { defaultRecordedRoot, loadRecordedJson } from '../http/recorder.js';
import { isRecord } from '../util.js';

/**
 * Dated parameter allowlist, spec §5.2: every parameter name **and value** an adapter may send, per endpoint key
 * (`<path>` or `<path>?<name>=<value>`). Written by WP4b under fixtures/recorded/<provider>/params-<date>.json with
 * withContentHash; WP5/WP6 hold an equal code constant (SEARCHAPI_PARAMS, TRAVELPAYOUTS_PARAMS) and assert the two match.
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

const KEY = /^(\/[^?#]*)(?:\?([a-z0-9_]+)=([^&=#]+))?$/;

function parseKey(key: string): { path: string; name: string | undefined; value: string | undefined } | null {
  const m = KEY.exec(key);
  if (m === null || m[1] === undefined) return null;
  return { path: m[1], name: m[2], value: m[3] };
}

/** Loads and validates an allowlist file (recorded tree, content hash, core schemas, key form, ascending names, values per name). */
export function loadParamsAllowlist(path: string, root: string = defaultRecordedRoot()): ParamsAllowlist {
  const json = loadRecordedJson(path, root);
  const fail = (why: string): Error => new Error(`refusing params allowlist ${path}: ${why}`);
  const provider = providerIdSchema.safeParse(json.provider);
  if (!provider.success) throw fail('unknown provider');
  const recordedAt = isoDateSchema.safeParse(json.recordedAt);
  if (!recordedAt.success) throw fail('recordedAt must be a real YYYY-MM-DD date');
  const rawEndpoints = json.endpoints;
  if (!isRecord(rawEndpoints)) throw fail('endpoints must be an object keyed by endpoint');
  const endpoints: ParamsAllowlist['endpoints'] = {};
  for (const [key, entry] of Object.entries(rawEndpoints)) {
    if (parseKey(key) === null) throw fail(`endpoint key ${key} must be <path> or <path>?<name>=<value>`);
    if (!isRecord(entry)) throw fail(`endpoint ${key} is not an object`);
    const rawNames = entry.names;
    const rawValues = entry.values;
    if (!Array.isArray(rawNames) || !isRecord(rawValues))
      throw fail(`endpoint ${key} needs names and values`);
    const names: string[] = [];
    for (const n of rawNames) {
      if (typeof n !== 'string') throw fail(`endpoint ${key}: names must be strings`);
      const prev = names[names.length - 1];
      if (prev !== undefined && !(prev < n))
        throw fail(`endpoint ${key}: names must be strictly ascending (${prev}, ${n})`);
      names.push(n);
    }
    const values: Record<string, string[] | 'any'> = {};
    for (const n of names) {
      const v = rawValues[n];
      if (v === 'any') values[n] = 'any';
      else if (Array.isArray(v) && v.length > 0 && v.every((x): x is string => typeof x === 'string'))
        values[n] = [...v];
      else throw fail(`endpoint ${key}: name ${n} needs 'any' or a non-empty value list`);
    }
    for (const k of Object.keys(rawValues))
      if (!names.includes(k)) throw fail(`endpoint ${key}: values lists ${k}, which is not in names`);
    endpoints[key] = { names, values };
  }
  const contentSha256 = json.contentSha256;
  if (typeof contentSha256 !== 'string') throw fail('contentSha256 is missing');
  return { provider: provider.data, recordedAt: recordedAt.data, endpoints, contentSha256 };
}

/**
 * Throws ParamsNotAllowedError unless every query parameter of `url` is listed, with an allowed value, under the most
 * specific matching key for `endpointPath` (spec §5.2). Adapters call it before http-kit; messages name parameters only.
 */
export function assertRequestAllowed(allowlist: ParamsAllowlist, endpointPath: string, url: URL): void {
  const who = `${allowlist.provider} ${endpointPath}`;
  if (url.pathname !== endpointPath)
    throw new ParamsNotAllowedError(`${who}: URL path does not match the endpoint`);
  let bare: string | undefined;
  let chosen: string | undefined;
  let discriminated = false;
  for (const key of Object.keys(allowlist.endpoints).sort()) {
    const k = parseKey(key);
    if (k === null || k.path !== endpointPath) continue;
    if (k.name === undefined) bare = key;
    else {
      discriminated = true;
      if (url.searchParams.get(k.name) === k.value) chosen = key;
    }
  }
  const key = chosen ?? bare;
  if (key === undefined) {
    throw new ParamsNotAllowedError(
      discriminated
        ? `${who}: no allowlist entry matches this request's discriminator`
        : `${who}: endpoint is not in the ${allowlist.recordedAt} allowlist`,
    );
  }
  const entry = allowlist.endpoints[key];
  if (entry === undefined)
    throw new ParamsNotAllowedError(`${who}: endpoint is not in the ${allowlist.recordedAt} allowlist`);
  for (const [name, value] of url.searchParams.entries()) {
    if (!entry.names.includes(name))
      throw new ParamsNotAllowedError(
        `${who}: parameter ${name} is not in the ${allowlist.recordedAt} allowlist`,
      );
    const allowed = entry.values[name];
    if (allowed !== 'any' && !(allowed ?? []).includes(value))
      throw new ParamsNotAllowedError(
        `${who}: a value of ${name} is not in the ${allowlist.recordedAt} allowlist`,
      );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/params/allowlist.test.ts`
Expected: PASS, 12 tests.

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp04: ParamsAllowlist with engine-discriminated keys, loader and request check (spec §5.2)"
```

### Task 4.13: Fixture-tree scan, barrels, and the package definition of done

**Files:**
- Replace: `src/index.ts`
- Delete: `test/smoke.test.ts` (WP0 placeholder; superseded by `test/barrel.test.ts`)
- Test: `test/fixture/tree.test.ts`, `test/barrel.test.ts`

**Interfaces:**
- Produces: the public surface of `@gmt/providers`, `@gmt/providers/fixture` and `@gmt/providers/testing` as listed in "Interfaces produced"; everything else stays module-internal (arch-008).

The fixture-tree scan is a function over a root so that its negative cases run against a temporary tree with known faults (test-008) before it runs over the committed tree: every file is under `synthetic/fixture/` or `recorded/` and is JSON; synthetic files carry `synthetic: true` and no recording fields; recorded `params-*.json` load through `loadParamsAllowlist` and every other recorded file through `loadRecordedFixture` (hash, `recordedBy`, `recordedAt`, location, file name), with its request host in its provider's allowlist (prov-003); no file holds a sentinel in any form; and no `.raw.json` is tracked by git (sec-008). The recorded half of the committed tree is empty until WP4b; the temporary tree is its positive control.

- [ ] **Step 1: Write the failing tests**

`test/fixture/tree.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultFixtureRoot, loadFixtureTree } from '../../src/fixture/tree.js';
import {
  createRecorder,
  loadRecordedFixture,
  loadRecordedJson,
  withContentHash,
} from '../../src/http/recorder.js';
import { containsSecret } from '../../src/http/scrub.js';
import { loadParamsAllowlist } from '../../src/params/allowlist.js';
import { isRecord } from '../../src/util.js';
import { ALL_SECRETS, req, SEARCH, SENTINELS } from '../fakes.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
// why: a recording's request must target its provider's real host (prov-003 cross-check); vendor hosts, not airports.
const PROVIDER_HOST: Record<string, string> = {
  searchapi: 'www.searchapi.io',
  travelpayouts: 'api.travelpayouts.com',
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Every problem in a fixtures root (spec §9 item 2 fixture-tree rules); empty means clean. */
function scanFixtures(root: string): string[] {
  const problems: string[] = [];
  const recordedRoot = join(root, 'recorded');
  const files = walk(root).filter((f) => !f.endsWith('.gitkeep') && !f.endsWith('.raw.json'));
  for (const f of files) {
    const rel = relative(root, f);
    const fail = (why: string): void => {
      problems.push(`${rel}: ${why}`);
    };
    if (!f.endsWith('.json')) {
      fail('not a JSON file');
      continue;
    }
    const text = readFileSync(f, 'utf8');
    if (containsSecret(text, ALL_SECRETS)) fail('holds a sentinel');
    const parsed: unknown = JSON.parse(text);
    if (rel.startsWith(`synthetic${sep}fixture${sep}`)) {
      if (!isRecord(parsed) || parsed.synthetic !== true) fail('synthetic file without "synthetic": true');
      else if ('recordedAt' in parsed || 'contentSha256' in parsed)
        fail('synthetic file with recording fields');
    } else if (rel.startsWith(`recorded${sep}`)) {
      try {
        if (rel.split(sep).at(-1)?.startsWith('params-')) loadParamsAllowlist(f, recordedRoot);
        else {
          const rec = loadRecordedFixture(f, recordedRoot);
          if (new URL(rec.request.url).hostname !== PROVIDER_HOST[rec.providerId])
            fail(`request host is not ${rec.providerId}'s`);
        }
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    } else fail('outside synthetic/fixture and recorded');
  }
  return problems;
}

describe('fixture-tree scan (spec §9 item 2: every committed fixture scanned)', () => {
  it('reports each planted fault in a temporary tree (positive control, test-008)', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'gmt-scan-')), 'fixtures');
    cpSync(defaultFixtureRoot(), join(root, 'synthetic', 'fixture'), { recursive: true });
    const recordedRoot = join(root, 'recorded');
    mkdirSync(recordedRoot, { recursive: true });
    const recorder = createRecorder({
      root: recordedRoot,
      secrets: ALL_SECRETS,
      clock: fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z')),
      recordedBy: 'scan-test',
    });
    const fetchedAt = asIsoDateTime('2026-10-14T15:00:00.000Z');
    const good = await recorder.record({
      providerId: 'searchapi',
      endpointPath: '/api/v1/search',
      request: req({ url: `${SEARCH}?engine=google_flights` }),
      status: 200,
      body: { price: 1 },
      fetchedAt,
    });
    const edited = await recorder.record({
      providerId: 'searchapi',
      endpointPath: '/api/v1/search',
      request: req({ url: `${SEARCH}?engine=google_flights_calendar` }),
      status: 200,
      body: { price: 41200 },
      fetchedAt,
    });
    // a recording whose request went to another provider's host (prov-003 cross-check, test-r2-002)
    const wrongHost = await recorder.record({
      providerId: 'searchapi',
      endpointPath: '/aviasales/v3/prices_for_dates',
      request: req({ url: 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=LON' }),
      status: 200,
      body: { price: 2 },
      fetchedAt,
    });
    writeFileSync(edited, readFileSync(edited, 'utf8').replace('41200', '1'));
    writeFileSync(
      join(recordedRoot, 'searchapi', 'params-2026-10-14.json'),
      JSON.stringify(
        withContentHash({
          provider: 'searchapi',
          recordedAt: '2026-10-14',
          endpoints: { '/api/v1/search': { names: ['gl'], values: { gl: ['gb'] } } },
        }),
      ),
    );
    writeFileSync(
      join(root, 'synthetic', 'fixture', 'calendar', 'AAA-BBB.json'),
      JSON.stringify({ currency: 'GBP' }),
    );
    writeFileSync(
      join(root, 'synthetic', 'fixture', 'itinerary', 'AAA-CCC.json'),
      JSON.stringify({ synthetic: true, note: SENTINELS.smtp.reveal() }),
    );
    writeFileSync(join(root, 'synthetic', 'notes.txt'), 'stray');
    const problems = scanFixtures(root);
    expect(
      problems.some((p) => p.includes(relative(root, edited)) && p.includes('content hash mismatch')),
    ).toBe(true);
    expect(
      problems.some(
        (p) => p.includes('AAA-BBB.json') && p.endsWith('synthetic file without "synthetic": true'),
      ),
    ).toBe(true);
    expect(problems.some((p) => p.includes('AAA-CCC.json') && p.endsWith('holds a sentinel'))).toBe(true);
    expect(problems.some((p) => p.includes('notes.txt') && p.endsWith('not a JSON file'))).toBe(true);
    expect(
      problems.some(
        (p) => p.includes(relative(root, wrongHost)) && p.endsWith("request host is not searchapi's"),
      ),
    ).toBe(true);
    expect(problems.some((p) => p.includes(relative(root, good)))).toBe(false);
    expect(problems.some((p) => p.includes('params-2026-10-14.json'))).toBe(false);
  });

  it('the committed fixtures tree is clean and the synthetic tree loads', () => {
    expect(scanFixtures(FIXTURES)).toEqual([]);
    expect(loadFixtureTree(join(FIXTURES, 'synthetic', 'fixture')).calendar.size).toBe(4);
  });

  it('no .raw.json file is tracked by git anywhere in the repository (sec-008)', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter((f) => f.endsWith('.raw.json'));
    expect(tracked).toEqual([]);
  });

  it('loaders refuse the wrong tree in both directions', () => {
    expect(() => loadFixtureTree(join(FIXTURES, 'recorded'))).toThrow(/fixtures\/synthetic\/fixture/);
    expect(() =>
      loadRecordedJson(
        join(FIXTURES, 'synthetic', 'fixture', 'calendar', 'LHR-JFK.json'),
        join(FIXTURES, 'recorded'),
      ),
    ).toThrow(/recorded root/);
  });
});
```

`test/barrel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as fixture from '../src/fixture/index.js';
import * as providers from '../src/index.js';
import * as testing from '../src/testing/index.js';

const surface = (m: object): Record<string, unknown> => ({ ...m });

describe('@gmt/providers public surface (plan "http-kit" contract, arch-008)', () => {
  it('the main barrel exports the contract and the named-consumer extras, and nothing test-only', () => {
    const main = surface(providers);
    for (const name of [
      'createHttpKit',
      'createRecorder',
      'contentHash',
      'scrubSecrets',
      'stripUrl',
      'canonicalCacheKey',
      'fixtureProvider',
      'loadParamsAllowlist',
      'assertRequestAllowed',
      'canonicalJson',
      'fixtureHttpLimits',
      'RecorderRefusedError',
      'ParamsNotAllowedError',
    ]) {
      expect(typeof main[name], name).toBe('function');
    }
    expect(main.CREDENTIAL_HEADERS).toBeInstanceOf(Set);
    for (const name of [
      'withContentHash',
      'fixtureRouter',
      'fixtureHandlers',
      'replayHandlers',
      'createFixtureServer',
      'loadRecordedFixture',
      'classifyResponse',
    ]) {
      expect(name in main, name).toBe(false);
    }
  });
  it('./testing exports fixtureHandlers, replayHandlers, loadRecorded and withContentHash', () => {
    const t = surface(testing);
    for (const name of ['fixtureHandlers', 'replayHandlers', 'loadRecorded', 'withContentHash'])
      expect(typeof t[name], name).toBe('function');
  });
  it('./fixture exports the gated router and the scenario-control contract', () => {
    const f = surface(fixture);
    for (const name of ['fixtureRouter', 'scenarioRequest', 'releaseRequest', 'defaultFixtureRoot'])
      expect(typeof f[name], name).toBe('function');
    expect(f.FIXTURE_TILE_DAYS).toBe(7);
    // why: every export names its consumer (arch-r2-010); the control paths stay behind scenarioRequest/releaseRequest.
    expect(Object.keys(f).sort()).toEqual([
      'FIXTURE_TILE_DAYS',
      'defaultFixtureRoot',
      'fixtureRouter',
      'releaseRequest',
      'scenarioRequest',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/tree.test.ts test/barrel.test.ts`
Expected: `tree.test.ts` PASS (it guards files committed in Tasks 4.7 and 4.9, and its positive control plants every fault it must report); `barrel.test.ts` FAIL — `expected 'undefined' to be 'function'` for `createHttpKit` (WP0's barrel is empty).

- [ ] **Step 3: Implement**

`src/index.ts`:

```ts
// Barrel for @gmt/providers (spec §4: imports @gmt/core only; no SQLite, reads no environment variables). The plan contract plus the
// named-consumer extras; the fixture router lives in ./fixture and msw-based helpers in ./testing (plan decision 7).

export { fixtureHttpLimits, fixtureProvider } from './fixture/provider.js'; // fixtureHttpLimits: WP4b httpLimitsFor
export { CREDENTIAL_HEADERS, canonicalCacheKey } from './http/cacheKey.js'; // CREDENTIAL_HEADERS: WP4b createLogger
export { createHttpKit } from './http/httpKit.js';
export {
  canonicalJson,
  contentHash,
  createRecorder,
  type RecordedFixture,
  RecorderRefusedError,
} from './http/recorder.js'; // canonicalJson: WP5/WP6; RecorderRefusedError: WP4b
export { scrubSecrets, stripUrl } from './http/scrub.js';
export type {
  FixtureRecorder,
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
  ResponseFacts,
} from './http/types.js';
export {
  assertRequestAllowed,
  loadParamsAllowlist,
  type ParamsAllowlist,
  ParamsNotAllowedError,
} from './params/allowlist.js';
```

Delete `packages/providers/test/smoke.test.ts`.

- [ ] **Step 4: Run the whole package**

Run: `pnpm --filter @gmt/providers test`
Expected: PASS, 223 tests in 16 files; coverage at or above 85% lines, 70% branches, 85% functions, 85% statements, no threshold error. If a threshold misses, add tests for the uncovered branches named in the coverage table (the parsers' refusal branches are the usual gap); never lower a threshold (test-010).

- [ ] **Typecheck**

Run: `pnpm --filter @gmt/providers typecheck`
Expected: exit 0 (both `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json` print nothing).

- [ ] **Step 5: Commit**

```bash
git add -A packages/providers && git commit -m "wp04: providers barrels and the fixture-tree scan with a planted-fault control (spec §9 item 2)"
```

## Pinned review-focus tests

None. The plan's five Review Focus lines are owned by WP0, WP1, WP2, WP3, WP7, WP8, WP9 and WP10; none names WP4. Review Focus 5 (SQLite busy or full during a tile write) reaches this package only as a non-`ProviderError` thrown inside the engine's write, which `fixtureProvider.fetchTile` lets propagate unchanged (Task 4.10 rethrows everything that is not a `ProviderError`).

## Definition of done

Run from the repository root; each must hold exactly:

1. `pnpm --filter @gmt/providers test` → all 223 tests pass (measured 92.2% lines, 86.6% branches, 97.4% functions, 95.5% statements on 2026-10-14); coverage ≥ 85% lines, ≥ 70% branches, ≥ 85% functions and statements; exit 0.
2. `pnpm lint:fix && pnpm lint` → `Checked … files … No fixes applied.` with zero errors; exit 0 (the brief's code blocks are already formatted, so `lint:fix` changes nothing unless an edit drifted).
3. `pnpm --filter @gmt/providers typecheck` and `pnpm -r typecheck` → exit 0 (both `tsconfig.json` and `tsconfig.test.json`, so test code is type-checked).
4. `node scripts/check-boundaries.mjs` → exit 0, no output (providers depends on `@gmt/core` only, reads no `process.env`, imports msw only under `src/testing/`).
5. `pnpm secret-scan` → `secret scan: clean`.
6. `grep -rnE "process\.env|better-sqlite3|drizzle" packages/providers/src` → no output.
7. `grep -rnwE "LHR|LGW|JFK|EWR|LON|NYC" packages/providers/src` → no output (airports appear only in `fixtures/` and `test/`).
8. `grep -rln "from 'msw" packages/providers/src | grep -v "src/testing/"` → no output.
9. `grep -rnE "[])A-Za-z0-9_] as (unknown|any|never|string|number|[A-Z][A-Za-z0-9_<>]*)\b" packages/providers/src packages/providers/test` → no output (no casts besides `as const`; plan decision 15).
10. `pnpm --filter "@gmt/providers..." build && grep -rlE "from ['\"]msw" packages/providers/dist | grep -v "/dist/testing/"` → no output; and `node --input-type=module -e "import { registerHooks } from 'node:module'; registerHooks({ resolve(s, c, next) { if (s === 'msw' || s.startsWith('msw/')) throw new Error('msw reached from the production barrel'); return next(s, c); } }); const m = await import('./packages/providers/dist/index.js'); console.log(typeof m.createHttpKit)"` → prints `function` (Node ≥ 22.15 for `module.registerHooks`; sec-009).
11. `git check-ignore packages/providers/fixtures/recorded/searchapi/_api_v1_search/2026-10-14-000000000000.raw.json` → prints the path.

## Open questions

None blocking. Recorded for the contract owner:

- **msw 3 behaviour found in the scratch run (2026-10-14).** msw 3.0.3 intercepts at the socket level and sends to the real network: a request whose handler returns `undefined`, the target of a mocked 3xx (it follows redirects itself), and a socket whose request the client aborts before msw answers. The brief contains all three (replay misses answer an error; redirects and body failures run in process; the setup file's catch-all, abort-settling handlers and refused DNS lookups keep every test local). WP5, WP6, WP7 and WP13 tests that use msw should reuse `test/support/setup.ts`'s pattern; the plan may want it as a workspace-wide test rule.

- **Spec §5.3 transport sentence (arch-007).** Revision 11 now states the `inProcessHosts` seam and the full `HttpKitDeps`; the interim "no injectable transport" wording this brief once repeated is gone from every doc comment here. Nothing further is needed.
- **Per-provider secret binding (sec-006), deferred by ruling 13.** `HttpKitDeps.secrets` stays a flat list, so http-kit cannot stop a request tagged `travelpayouts` from carrying the SearchApi key to Travelpayouts' host; adapters keep `key`/`token` and build their own headers. This build refuses credential headers only on `fx` and `fixture` requests.
- **CI commit-trailer rule for recorded files (prov-003): declined** (plan decision 15). The hash is tamper-evidence only, as the brief states.
- **Plan Task 0.1 still lists `msw@3.0.3` as a devDependency of `@gmt/providers`**, contradicting plan decision 7 and this brief's `package.json` (runtime dependency for `./testing`). The Task 0.1 text needs the one-word fix.
- **`withContentHash` for WP4b's record tool** is exported only from `./testing` (plan block: "test and record-tool use only"). If the record tool counts as production code under the boundary script's "production never imports `./testing`" rule, WP4b needs either an allowlisted import or a separate msw-free subpath; this brief follows the plan text.
