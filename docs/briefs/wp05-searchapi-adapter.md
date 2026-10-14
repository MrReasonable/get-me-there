---
wp: 5
title: SearchApi adapter
owner: opus
depends_on: [4, 4b]
spec_sections: ["§2", "§5.1", "§5.2", "§5.4", "§9 item 2"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, provenance-auditor, cost-and-budget-reviewer, security-reviewer]
status: draft
---

# WP5: SearchApi adapter

## 1. Goal

Build `searchApiProvider` in `@gmt/providers`: one `FlightProvider` that plans and fetches `google_flights_calendar` rectangle tiles for discovery and runs the three-step `google_flights` chain for verification. It goes through http-kit only, returns raw vendor shapes, and is tested by replaying WP4b's recorded fixtures through msw.

## 2. Scope

**In**

- `plan`: pure rectangle tiling that partitions the query's cells, with the ≤200-combination assertion (spec §5.2, §2 fact 2).
- `fetchTile`: request building, the parameter allowlist check, response parsing with cell keys taken from the response, out-of-band drops, `has_no_flights` → `noFares`, empty grid → `parse`, currency and point of sale read from the echo (spec §5.2).
- `search`: the step 1 → 2 → 3 chain with every outcome rule of spec §5.4, unpriced-option skipping, the price-source rule, `fetchedAt` = oldest step, and capture of `price_insights.price_history`.
- `estimate` for verification, `healthcheck`, `suppliedFields`, `cabins`, the two `CapabilityInfo` values.
- `classifySearchApiError` (the http-kit `classifyError` hook) and `searchApiHttpLimits`. Wiring (WP4b) passes both to `createHttpKit`.
- `SEARCHAPI_PARAMS_ALLOWLIST`, a code constant that a test pins to the dated `params-<date>.json` from WP4b, and `parseParamsAllowlist`.
- Test support: in-memory budget and cache ports around the real http-kit, a recorded-fixture loader, an msw replay handler that reverses the placeholder-token substitution, and builders for synthetic shapes.

**Out**

- http-kit pipeline, retries, limiter, ledger finalisation, cache, egress allowlist enforcement, recorder, and the default status classifier. Owner: **WP4**.
- Recording the fixtures and writing `params-<date>.json`. Constructing this provider inside `buildPorts`. Owner: **WP4b**, which adds the call once this package merges (see §11 finding F7).
- Normalisation: carrier/flight-number canonicalisation, local times, hashing, FX, vendor-URL validation against the `google.com` allowlist, search links. Owner: **WP2** (pure) and **WP7** (step).
- Persisting `route_price_history` and stamping `pointOfSale` on stored rows. Owner: **WP7** (engine) over **WP3** repositories.
- The `bookingLinks` zod refinement on definitions. Owner: **WP0** `api-contract` (already specified). This brief adds the adapter-side guard only.
- Layer-B engine tests with this adapter, and the live smoke. Owner: **WP13**.
- Travelpayouts. Owner: **WP6**.

## 3. Spec sections

- **§2 SearchApi rows.** `google_flights_calendar` is `scraped-aggregate` with `maxAgeHours` 24. It allows ≤200 combinations per call and is queried per airport only. Entries are `{departure, return, price, is_lowest_price}` in the request currency; latency is 9–29 s. `google_flights` is `scraped-search` with `maxAgeHours` 0. It is three steps, some options carry no `price`, and step 3 always runs.
- **§2 fact 2.** HTTP 400 above 200 combinations; per airport only; about 23 rectangles of 8 outbound days per pair for the default band.
- **§2 fact 3.** The step-1 price equals the step-2 price for the cheapest pairing, but step 3 showed a seller below the airline fare, so `bookingLinks` is forced on. Two of nine step-1 options and one of three step-2 options had no price.
- **§2 fact 4.** The vendor caches repeats (answered in 3 s with a new search id, not billed). The ledger still counts every HTTP 200. The local cache window is `SEARCHAPI_CACHE_TTL_HOURS` (1).
- **§2 fact 5.** Recorded bodies: 401 `{"error":"Invalid API key."}` and a 400 with a descriptive message. No 429 or quota body is recorded, so those map by status and ledger state.
- **§2 fact 8.** The key goes in `Authorization: Bearer` only, never in a URL.
- **§2 bonus.** Step 1 returns `price_insights.price_history`, a free 60-day route series stored on every verification.
- **§5.1.** The `FlightProvider`, `DiscoveryCapability`, `VerificationCapability`, `TilePlan`, `TileRequest`, `RawCalendarPrice`, `DiscoveryTileResult`, `ItineraryQuery`, `RawSegment`, `RawOffer`, `ItinerarySearchResult` and `CostEstimate` shapes, plus `ProviderError`.
- **§5.2 (entire).** Tiles partition the query's cells (asserted), and setting `cells` triggers a re-plan. Cell keys come from the response, and drops are counted in `notes`. Empty is per capability: for `scraped-aggregate`, an empty grid → `parse` and `has_no_flights` → `noFares`. Estimate parity = `plan(q).length`. Output is raw only, with currency from the response. `suppliedFields` is checked against recorded fixtures. Point of sale: `gl` = `POINT_OF_SALE` lower-cased, `hl=en`, `currency=GBP`, with `pointOfSale` taken from the echo. The dated allowlist names parameters and values. Error mapping is the §5.2 table, and there are no adapter retries. `booking.url` is checked later against `google.com`.
- **§5.4 (entire).** The chain, unpriced skips, every priced step-2 option persisted, step 3 for the cheapest priced option per outbound, the outcome rules, the price-source rule, and calls per cell = `1 + expandTop × 2`.
- **§9 item 2 (this adapter's rows).** Tiles partition cells and `plan().length` equals msw hits. Response-date keying drops out-of-band entries. SearchApi empty grid → `parse` and `has_no_flights` → `noFares`. Currency comes from the response. `suppliedFields` comes from recorded fixtures only. Parameter names and values match the dated allowlist. Error mapping covers 403 and quota discrimination. Token responses are never cached. The sentinel-key test covers this adapter's paths.

## 4. Interfaces consumed

Copied from the plan's "Cross-package contracts" without change.

From `@gmt/core` (`ports/provider.ts`, spec §5.1 verbatim):

```ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';

export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }

export interface DiscoveryQuery {
  origin: Iata; destination: Iata;
  departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number;
  cabin: Cabin; currency: 'GBP';
  cells?: CellKey[];     // when set, discovery.plan RE-PLANS over this subset (fewer calls); tiles still partition it
}
export interface TilePlan { index: number; coveredCells: CellKey[]; request: TileRequest }   // vendor-neutral, typed
export type TileRequest =
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };

export interface RawCalendarPrice extends CellKey {
  amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string;
}
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[] }
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
export interface ItinerarySearchResult { offers: RawOffer[]; coverage: 'priced' | 'empty'; fetchedAt: IsoDateTime; partial: boolean; failedExpansions: number; notes: string[] }
// offers: every return option of every expanded outbound, one RawOffer each; the cheapest per outbound is the step-3 candidate.

export interface ProviderContext { executionId: string | null; signal: AbortSignal; recordFixtures: boolean }
// Adapters are constructed once with { http: HttpKit, log: Logger, clock: Clock }; the context carries only per-call state.

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
  reserve(p: { providerId: ProviderId; executionId: string | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }
```

From `@gmt/core` (`types/itinerary.ts`, `ports/budget.ts`, `ports/logger.ts`, `ports/clock.ts`, `errors.ts`, `config/*`, `text/bannedWords.ts`; WP0):

```ts
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void };   // tests
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export type PlanId = 'trial' | '40usd';
export interface ProviderLimits { monthlyCallCap: number; window: 'month' | 'lifetime'; billingDay: number; ratePerMinute: number; ratePerHour: number; concurrency: number; cacheTtlHours: number; costPerCallMicroGbp: number; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export const PLAN_PRESETS: Record<PlanId, ProviderLimits & { monthlySpendCapMicroGbp: number; executionMaxCalls: number; executionMaxCostMicroGbp: number }>;
export const BANNED_WORDS: readonly string[] = ['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time'];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export function asIata(s: string): Iata;
export function asIsoDate(s: string): IsoDate;
export function asIsoDateTime(s: string): IsoDateTime;
```

`ProviderError`, `BudgetExceeded`, `AbortedError` are exactly as spec §5.1 and are constructed as `new ProviderError({ kind, reason?, retryable, httpStatus?, retryAfterSeconds?, message })`. WP0's implementation also accepts `providerId?: ProviderId | 'fx'`, which this brief sets.

From `@gmt/core` (WP1 and WP2, both merged in wave 1 before this wave opens; see finding F6):

```ts
// WP1: toEpochDay(IsoDate): number, fromEpochDay(number): IsoDate, addDays(IsoDate, n): IsoDate,
//      generateCells(space: ResolvedSpace): Cell[], cellKeyString(cell): string (`O|D|dep|ret`)
// WP2: toGbp(amountMinor, currency, rateNano): number with MINOR_EXPONENT: Record<string, number>
export interface ResolvedSpace { origins: Iata[]; destinations: Iata[]; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }
```

From `@gmt/providers` `http/httpKit.ts` (WP4):

```ts
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never'; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; classifyError?: (status: number, body: unknown, ledgerAtCap: boolean) => ProviderError }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Record<ProviderId | 'fx', ProviderHttpLimits>; clock: Clock; log: Logger; secrets: Secret[] /* for scrubbing */; recorder?: FixtureRecorder }
export interface HttpKitRequest {
  providerId: ProviderId | 'fx'; executionId: string | null; tileIndex: number | null; endpointPath: string;
  method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body?: string;
  cache: { ttlSeconds: number } | 'never'; signal: AbortSignal; recordFixtures: boolean;
}
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
// Throws ProviderError (classified), BudgetExceeded (from reserve, before any fetch), AbortedError (signal).
// Retries: p-retry max 3 attempts on retryable ProviderError only; per-request timeout is non-retryable when limits.billable === 'http-200'.
```

The adapter constructor line, from the plan:

> `searchApiProvider({ http, log, clock, key: Secret, plan: PlanId, pointOfSale: string, paramsAllowlist })` … returning `FlightProvider`.

From WP4b (files, not code):

- `packages/providers/fixtures/recorded/searchapi/**/<yyyy-mm-dd>-<sha>.json`: recorder files. §6 "Inputs from WP4b" gives the shape this brief reads.
- `packages/providers/fixtures/recorded/searchapi/params-<yyyy-mm-dd>.json`: the dated parameter allowlist, in the shape `parseParamsAllowlist` accepts (Task 5.3).

## 5. Interfaces produced

Exported from `@gmt/providers` (`src/index.ts`). Later packages (WP4b wiring, WP7 engine, WP13) rely on these names.

```ts
// src/searchapi/provider.ts
export interface SearchApiProviderOptions {
  http: HttpKit; log: Logger; clock: Clock; key: Secret; plan: PlanId; pointOfSale: string;
  paramsAllowlist: ParamsByEngine;
  cacheTtlHours: number;            // contract addition, finding F3: SEARCHAPI_CACHE_TTL_HOURS for calendar tiles
}
export function searchApiProvider(o: SearchApiProviderOptions): FlightProvider;
export const SEARCHAPI_DISPLAY_NAME: 'Google Flights via SearchApi';
export const SEARCHAPI_DISCOVERY_INFO: CapabilityInfo;      // scraped-aggregate, maxAgeHours 24
export const SEARCHAPI_VERIFICATION_INFO: CapabilityInfo;   // scraped-search, maxAgeHours 0
export const SEARCHAPI_SUPPLIED_FIELDS: readonly SuppliedField[];
export const SEARCHAPI_CABINS: readonly Cabin[];

// src/searchapi/errors.ts
export function classifySearchApiError(status: number, body: unknown, ledgerAtCap: boolean): ProviderError;
export function searchApiHttpLimits(l: ProviderLimits, o: { maxWaitSeconds: number; requestTimeoutSeconds: number }): ProviderHttpLimits;

// src/searchapi/params.ts
export type SearchApiEngine = 'google_flights_calendar' | 'google_flights';
export type ParamRule = { values: readonly string[] } | { pattern: string };
export type ParamsByEngine = Record<SearchApiEngine, Readonly<Record<string, ParamRule>>>;
export const SEARCHAPI_PARAMS_ALLOWLIST: ParamsByEngine;
export function parseParamsAllowlist(json: unknown): { recordedAt: string; engines: ParamsByEngine };
export const SEARCHAPI_HOST: 'www.searchapi.io';

// src/searchapi/calendar.ts
export const MAX_COMBINATIONS: 200;
export const OUTBOUND_BLOCK_DAYS: 8;
export function planRectangles(q: DiscoveryQuery): TilePlan[];
export type SearchApiTileResult =
  | (Extract<DiscoveryTileResult, { kind: 'tile' }> & { pointOfSale: string })
  | Extract<DiscoveryTileResult, { kind: 'tile-error' }>;

// src/searchapi/itinerary.ts
export interface RouteHistoryPoint { date: IsoDate; lowestPriceMinor: number; currency: string }
export type SearchApiItineraryResult = ItinerarySearchResult & { routeHistory: RouteHistoryPoint[]; pointOfSale: string };
```

**Contract findings against the plan.** These are raised for Fable to adopt in the plan's contracts. The brief is dispatchable without them because the extra fields ride on structurally compatible local types.

- **F1, `routeHistory`.** `ItinerarySearchResult` has no field for `price_insights.price_history`, which spec §2 and §7 `route_price_history` require stored "on every verification". Proposed minimal core extension: `routeHistory?: Array<{ date: IsoDate; lowestPriceMinor: number; currency: string }>` on `ItinerarySearchResult`. Until it is adopted, `search` returns `SearchApiItineraryResult`, which is assignable to `ItinerarySearchResult`, and WP7 reads `routeHistory` when it is present.
- **F2, `pointOfSale`.** Spec §5.2 says `pointOfSale` is "stored … from the echo in `search_parameters`". Neither the `'tile'` result nor `ItinerarySearchResult` has a field for it. Proposed core extension: `pointOfSale?: string` (upper-cased `gl` echo) on both. Separately, `PointOfSale = 'GB' | 'unknown'` cannot represent a configurable `POINT_OF_SALE` other than `GB`. The adapter returns the echo string, and WP7 maps it onto `PointOfSale`.
- **F3, `cacheTtlHours`.** The constructor contract carries no cache TTL. The adapter sets `HttpKitRequest.cache.ttlSeconds` itself, and `SEARCHAPI_CACHE_TTL_HOURS` is an operator override, so the preset value cannot be used. Proposed: add `cacheTtlHours: number` to the constructor (WP4b passes `config.providers.searchapi.limits.cacheTtlHours`).
- **F4, `searchApiHttpLimits` / `classifySearchApiError`.** The plan's http-kit block has the `classifyError` hook, but the plan does not say who supplies SearchApi's limits object. This brief exports both and wiring passes them.

## 6. Library notes

All verified on **2026-10-14**.

**SearchApi `google_flights_calendar`**, https://www.searchapi.io/docs/google-flights-calendar-api (WebFetch, 2026-10-14). Verified:

- Endpoint `GET https://www.searchapi.io/api/v1/search`. The key may be sent as `Authorization: Bearer <key>`; this adapter uses only that form.
- Request parameters used: `engine=google_flights_calendar`, `departure_id`, `arrival_id` (3-letter codes), `flight_type=round_trip`, `outbound_date`, `outbound_date_start`, `outbound_date_end`, `return_date`, `return_date_start`, `return_date_end` (all `YYYY-MM-DD`), `travel_class`, `adults`, `currency`, `gl`, `hl`. `travel_class` values are `economy | premium_economy | business | first_class`, so the cabin `first` maps to **`first_class`**. Defaults: `gl=us`, `hl=en`, `currency=USD`, which is why all three are always sent. `outbound_date` and `return_date` are required even when the `_start`/`_end` ranges are given.
- Response: a top-level `calendar` array of `{ departure, return, price, is_lowest_price? }`. **`has_no_flights: true` is a per-entry field, and such entries omit `price`.** It is not a top-level flag.
- The docs say a request over 200 combinations "will return an empty response". The spike recorded HTTP 400 instead (spec §2 fact 2), and the recording wins. The adapter asserts ≤200 before `http.request`, so neither form is reached.
- **Not documented:** `search_parameters`, `search_metadata` and any response-level currency field. Spec §2 records that SearchApi echoes `gl=gb`, and spec §5.2 reads currency from `search_parameters.currency`. WP4b's recordings are the only evidence, so Task 5.5's recorded test asserts both are present (see "Inputs from WP4b").

**SearchApi `google_flights`**, https://www.searchapi.io/docs/google-flights-api (WebFetch, 2026-10-14). Verified:

- Same endpoint and Bearer header. Parameters: `engine=google_flights`, `departure_id`, `arrival_id`, `flight_type=round_trip`, `outbound_date`, `return_date`, `travel_class` (same four values), `adults`, `stops` (`any | nonstop | one_stop_or_fewer | two_stops_or_fewer`), `currency`, `gl`, `hl`, `departure_token` ("used to select a flight and view return flights") and `booking_token` ("retrieves booking options"). Every documented `booking_token` example also carries the original search parameters, so steps 2 and 3 resend the step-1 parameters plus the token.
- Response: `best_flights[]`, each with `flights[]` (segments with `departure_airport`/`arrival_airport` `{ id, date, time }`, `airline`, `flight_number` such as `"IB 212"`, `travel_class` such as `"Economy"`, `duration` in minutes, `airplane`), `layovers`, `total_duration`, `price` (a number in major units of the requested currency), and `departure_token` or `booking_token`.
- `booking_options[]`: `book_with`, `price`, `baggage_prices` (**an array of strings**, e.g. `"1st checked bag: 150"`), `booking_request: { url, post_data }` (the example URL is `https://www.google.com/travel/clk/f`), `booking_phone`, `estimated_phone_service_fee`, `local_prices`. Split bookings carry `is_split_booking: true` with separate `departure`/`arrival` objects.
- `price_insights.price_history` is **an array of `{ price, iso_date }`**, where `iso_date` is an ISO instant such as `2024-09-19T04:00:00Z`. This differs from SerpApi's `[[ts, price]]` pairs.
- **Not found on the page:** `other_flights` (the docs show only `best_flights`, with "…" implying more groups), `search_parameters`, and the key that holds step-2 return options. The adapter reads `best_flights ∪ other_flights` from both step 1 and step 2. Task 5.6's recorded-chain test is the authority on the step-2 key.

**msw 3.0.3**, https://mswjs.io/docs/migrations/2.x-to-3.x and https://mswjs.io/docs/http/intercepting-requests/query-parameters (WebFetch and context7 `/websites/mswjs_io`, 2026-10-14). Verified:

- `http` and `HttpResponse` are imported from **`msw/http`**; the root `msw` export no longer carries them.
- `setupServer` is imported from `msw/node`.
- `server.listen({ onUnhandledFrame: 'error' })` replaces `onUnhandledRequest`.
- `server.use`, `server.resetHandlers` and `server.close` are unchanged.
- Handlers read the request through `({ request })`, parse it with `new URL(request.url).searchParams`, read headers with `request.headers.get(...)`, and reply with `HttpResponse.json(body, { status })`.
- Node ≥ 22 is required.

**vitest 5.0.4**, https://vitest.dev/guide/migration.html (WebFetch, 2026-10-14). Used: `describe`, `it`, `it.each`, `expect`, `beforeAll`, `afterEach`, `afterAll`, `toEqual`, `toMatchObject`, `rejects.toThrow`, `rejects.toMatchObject`. Relevant v5 changes:

- An unawaited `rejects` now fails the test, so every `rejects` here is `await`ed.
- `toThrow('')` matches any message, so it is never used.
- `clearMocks` defaults to true. No mocks are used here.
- Coverage `include` paths are project-relative. The plan's package config already uses `src/**/*.ts`.

**zod 4.6.7** (context7 `/colinhacks/zod`, 2026-10-14). This is a new dependency of `@gmt/providers`, the same pinned version as `@gmt/core` (finding F8). Used:

- `z.object` (which strips unknown keys by default), `z.array`, `z.string().regex`, `z.number().nonnegative()`, `z.boolean()`, `.optional()`, `.nullish()`, `z.union`, `z.literal`, `z.record(z.string(), schema)` (two arguments in v4), `safeParse`, `z.infer`.
- Since 4.4, `z.unknown()` inside an object rejects an absent key. The recorder schema relies on that for `body`.

**Inputs from WP4b (pre-dispatch check, factual, not a design question).** The recorded tests assume the following. Fable checks them when this wave opens. A failure is a WP4b fix, not a change to this brief.

1. Recorder files parse as `{ recordedAt, recordedBy, contentHash, providerId: 'searchapi', endpointPath, request: { method, params: Record<string, string> }, status, body }`. Placeholders such as `<departure_token:0>` appear identically in a response body and in the next request's `params` (spec §5.3).
2. The recordings contain at least:
   - one HTTP 200 calendar tile whose rectangle spans ≤ 8 outbound days and was requested with `outbound_date = outbound_date_start` and `return_date = return_date_start`;
   - one step-1 response, a step 2 for each of the cheapest `n` priced outbounds (n ≥ 1), and a step 3 for the cheapest priced return option of each;
   - the 401 body `{"error":"Invalid API key."}` and a 400 body.
3. Every HTTP 200 body carries `search_parameters.currency` and `search_parameters.gl`.
4. `params-<date>.json` has the shape `parseParamsAllowlist` accepts. Its `engines` equal `SEARCHAPI_PARAMS_ALLOWLIST`.

## 7. Files

Create, under `packages/providers/`:

- `src/searchapi/params.ts`: hosts, parameter builders, cabin mapping, allowlist constant, loader and check
- `src/searchapi/shapes.ts`: zod shapes of vendor responses, echo reader, minor units, note counter
- `src/searchapi/calendar.ts`: rectangle tiling and calendar tile fetch/parse
- `src/searchapi/errors.ts`: `classifySearchApiError`, `searchApiHttpLimits`
- `src/searchapi/itinerary.ts`: the step 1 → 2 → 3 chain and its estimate
- `src/searchapi/provider.ts`: `searchApiProvider` assembly
- `test/searchapi/support/ports.ts`: in-memory budget and cache, capturing logger, real http-kit, provider factory
- `test/searchapi/support/recorded.ts`: recorded-fixture loader and msw replay handler
- `test/searchapi/support/synthetic.ts`: synthetic-shape builders and handler (never written to disk)
- `test/searchapi/support/provider.ts`: provider factory and capability accessor (Task 5.8)
- `test/searchapi/tiling.test.ts`, `replay.test.ts`, `params.test.ts`, `calendar.test.ts`, `errors.test.ts`, `itinerary.test.ts`, `booking.test.ts`, `provider.test.ts`, `sentinel.test.ts`

Modify:

- `packages/providers/src/index.ts`: export the produced interfaces (Task 5.8)
- `packages/providers/package.json`: add `"zod": "4.6.7"` to `dependencies` (Task 5.3)

Nothing is written under `fixtures/`. Synthetic shapes live only in test code.

## 8. Tasks

Per-task commands run only the task's test file, without coverage, because a partial run under `--coverage` would trip the package thresholds. The full run with thresholds is in §10.

### Task 5.1: Rectangle tiling (first failing test)

**Files:** create `src/searchapi/calendar.ts` (tiling part), `test/searchapi/tiling.test.ts`.

**Interfaces:** consumes `DiscoveryQuery`, `TilePlan`, `TileRequest`, `CellKey`, `generateCells`, `addDays`, `toEpochDay`, `cellKeyString`. Produces `MAX_COMBINATIONS`, `OUTBOUND_BLOCK_DAYS`, `combinations`, `assertWithinLimit`, `planRectangles`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/tiling.test.ts
import { type CellKey, type DiscoveryQuery, addDays, asIata, asIsoDate, cellKeyString, generateCells, toEpochDay } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { MAX_COMBINATIONS, OUTBOUND_BLOCK_DAYS, combinations, planRectangles } from '../../src/searchapi/calendar.js';

// Worked example (spec §1): LHR → JFK, 10–21 nights over a 182-day window.
const FROM = asIsoDate('2026-10-21');
const TO = addDays(FROM, 181); // 2027-04-20, inclusive: 182 departure days
const q: DiscoveryQuery = {
  origin: asIata('LHR'), destination: asIata('JFK'),
  departureFrom: FROM, departureTo: TO, minNights: 10, maxNights: 21, cabin: 'economy', currency: 'GBP',
};
const space = { origins: [q.origin], destinations: [q.destination], departureFrom: FROM, departureTo: TO, minNights: 10, maxNights: 21 };
const keyOf = (c: CellKey) => cellKeyString(c);
const span = (a: string, b: string) => toEpochDay(asIsoDate(b)) - toEpochDay(asIsoDate(a)) + 1;

describe('planRectangles (spec §5.2 SearchApi tiling, §2 fact 2)', () => {
  const plans = planRectangles(q);

  it('tiles partition the band: every cell exactly once, nothing else', () => {
    const expected = generateCells(space).map(keyOf).sort();
    const covered = plans.flatMap((p) => p.coveredCells.map(keyOf));
    expect(new Set(covered).size).toBe(covered.length); // no cell in two tiles
    expect([...covered].sort()).toEqual(expected); // and none missing
    expect(expected.length).toBe(182 * 12);
  });

  it('every tile is a rectangle within the 200-combination limit', () => {
    for (const p of plans) {
      expect(p.request.kind).toBe('rectangle');
      if (p.request.kind !== 'rectangle') continue;
      expect(combinations(p.request)).toBeLessThanOrEqual(MAX_COMBINATIONS);
    }
  });

  it('uses 8 outbound days per tile, so about 23 tiles per pair (spec §2 fact 2)', () => {
    expect(plans.length).toBe(Math.ceil(182 / OUTBOUND_BLOCK_DAYS)); // 23
    const first = plans[0]?.request;
    expect(first?.kind).toBe('rectangle');
    if (first?.kind !== 'rectangle') return;
    expect(span(first.departFrom, first.departTo)).toBe(8);
    // why: the tight return span for 8 departure days and a 10–21 band is 8 + 11 = 19 days
    // (152 combinations, 96 useful cells). Spec §5.2 quotes 8 × 24; see the brief's finding F5.
    expect(span(first.returnFrom, first.returnTo)).toBe(19);
    expect(first.departFrom).toBe('2026-10-21');
    expect(first.returnFrom).toBe('2026-10-31');
    expect(first.returnTo).toBe('2026-11-18');
  });

  it('every covered cell lies inside its tile rectangle', () => {
    for (const p of plans) {
      if (p.request.kind !== 'rectangle') continue;
      const r = p.request;
      for (const c of p.coveredCells) {
        expect(c.departureDate >= r.departFrom && c.departureDate <= r.departTo).toBe(true);
        expect(c.returnDate >= r.returnFrom && c.returnDate <= r.returnTo).toBe(true);
      }
    }
  });

  it('is deterministic and indexes tiles 0..n-1', () => {
    expect(planRectangles(q)).toEqual(plans);
    expect(plans.map((p) => p.index)).toEqual(plans.map((_, i) => i));
  });

  it('re-plans over a cells subset and still partitions exactly that subset', () => {
    const all = generateCells(space).map(({ origin, destination, departureDate, returnDate }) => ({ origin, destination, departureDate, returnDate }));
    const subset = all.filter((_, i) => i % 7 === 0).reverse(); // unordered input on purpose
    const re = planRectangles({ ...q, cells: subset });
    const covered = re.flatMap((p) => p.coveredCells.map(keyOf)).sort();
    expect(covered).toEqual(subset.map(keyOf).sort());
    expect(re.length).toBeLessThanOrEqual(plans.length);
  });

  it('an empty subset plans no tiles', () => {
    expect(planRectangles({ ...q, cells: [] })).toEqual([]);
  });

  it('shrinks the outbound block when a wide band would exceed 200 combinations', () => {
    const wide = planRectangles({ ...q, departureTo: addDays(FROM, 29), minNights: 0, maxNights: 90 });
    for (const p of wide) if (p.request.kind === 'rectangle') expect(combinations(p.request)).toBeLessThanOrEqual(MAX_COMBINATIONS);
    const first = wide[0]?.request;
    if (first?.kind !== 'rectangle') throw new Error('expected a rectangle');
    expect(span(first.departFrom, first.departTo)).toBe(2); // 2 × 92 = 184; 3 × 93 = 279 > 200
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/tiling.test.ts`
Expected: FAIL. The suite reports that `../../src/searchapi/calendar.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/calendar.ts (tiling part; Task 5.5 adds the fetch below it)
import { type CellKey, type DiscoveryQuery, type IsoDate, type TilePlan, type TileRequest, addDays, generateCells, toEpochDay } from '@gmt/core';

/** Spec §2 fact 2: the calendar engine rejects more than 200 outbound × return combinations (HTTP 400). */
export const MAX_COMBINATIONS = 200;
/** Spec §5.2: the measured rectangle width, 8 outbound days per tile (~23 tiles per pair over 182 days). */
export const OUTBOUND_BLOCK_DAYS = 8;

/** The rectangle variant of the vendor-neutral tile request (spec §5.1). */
export type Rectangle = Extract<TileRequest, { kind: 'rectangle' }>;

/** Outbound days × return days of a rectangle, the quantity SearchApi caps at 200. Spec §5.2. */
export function combinations(r: Rectangle): number {
  const outbound = toEpochDay(r.departTo) - toEpochDay(r.departFrom) + 1;
  const inbound = toEpochDay(r.returnTo) - toEpochDay(r.returnFrom) + 1;
  return outbound * inbound;
}

/**
 * The ≤200 assertion of spec §5.2. Called by `plan` and again by `fetchTile` before
 * `http.request`, so an oversized rectangle never reaches `budget.reserve`.
 */
export function assertWithinLimit(r: Rectangle): void {
  const n = combinations(r);
  if (n > MAX_COMBINATIONS) {
    throw new RangeError(
      `searchapi rectangle ${r.departFrom}..${r.departTo} × ${r.returnFrom}..${r.returnTo} has ${n} combinations, above ${MAX_COMBINATIONS}`,
    );
  }
}

function byDepartureThenReturn(a: CellKey, b: CellKey): number {
  if (a.departureDate !== b.departureDate) return a.departureDate < b.departureDate ? -1 : 1;
  if (a.returnDate !== b.returnDate) return a.returnDate < b.returnDate ? -1 : 1;
  return 0;
}

/** Cells from `start` whose departure is on or before `lastDeparture` (input sorted by departure). */
function takeBlock(cells: readonly CellKey[], start: number, lastDeparture: IsoDate): CellKey[] {
  const out: CellKey[] = [];
  for (let i = start; i < cells.length; i++) {
    const c = cells[i];
    if (c === undefined || c.departureDate > lastDeparture) break;
    out.push(c);
  }
  return out;
}

/** The smallest rectangle containing every cell of a block; `first` is the block's earliest cell. */
function boundsOf(first: CellKey, group: readonly CellKey[]): Rectangle {
  const r: Rectangle = { kind: 'rectangle', departFrom: first.departureDate, departTo: first.departureDate, returnFrom: first.returnDate, returnTo: first.returnDate };
  for (const c of group) {
    if (c.departureDate > r.departTo) r.departTo = c.departureDate;
    if (c.returnDate < r.returnFrom) r.returnFrom = c.returnDate;
    if (c.returnDate > r.returnTo) r.returnTo = c.returnDate;
  }
  return r;
}

/**
 * Pure, deterministic rectangle tiling for `google_flights_calendar`. Spec §5.2.
 *
 * Cells (the query's band, or `q.cells` when the engine re-plans a subset) are sorted by
 * departure then return and cut into blocks of up to `OUTBOUND_BLOCK_DAYS` consecutive
 * calendar days of departure. Each tile's rectangle is the tight bounding box of its block,
 * so the tiles partition the input exactly. When a wide nights band makes a block exceed
 * 200 combinations, the block shrinks one day at a time; a single departure day always fits
 * because nights ≤ 90 (spec §6.1).
 */
export function planRectangles(q: DiscoveryQuery): TilePlan[] {
  const source: CellKey[] =
    q.cells ??
    generateCells({ origins: [q.origin], destinations: [q.destination], departureFrom: q.departureFrom, departureTo: q.departureTo, minNights: q.minNights, maxNights: q.maxNights })
      .map(({ origin, destination, departureDate, returnDate }) => ({ origin, destination, departureDate, returnDate }));
  const cells = [...source].sort(byDepartureThenReturn);
  const tiles: TilePlan[] = [];
  let start = 0;
  while (start < cells.length) {
    const first = cells[start];
    if (first === undefined) break;
    let block = OUTBOUND_BLOCK_DAYS;
    let group = takeBlock(cells, start, addDays(first.departureDate, block - 1));
    let rect = boundsOf(first, group);
    // why: 8 × (8 + spread) exceeds 200 once the nights spread passes 17; shrink rather than overflow.
    while (combinations(rect) > MAX_COMBINATIONS && block > 1) {
      block -= 1;
      group = takeBlock(cells, start, addDays(first.departureDate, block - 1));
      rect = boundsOf(first, group);
    }
    assertWithinLimit(rect);
    tiles.push({ index: tiles.length, coveredCells: group, request: rect });
    start += group.length;
  }
  return tiles;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/tiling.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi rectangle tiling partitions the band (spec §5.2)"
```

### Task 5.2: Test support (ports, recorded loader, msw replay with placeholder reversal)

**Files:** create `test/searchapi/support/ports.ts`, `test/searchapi/support/recorded.ts`, `test/searchapi/support/synthetic.ts`, `test/searchapi/replay.test.ts`. Also create `src/searchapi/params.ts` with only the endpoint constants (Task 5.3 completes it).

**Interfaces:** consumes `createHttpKit`, `BudgetGuard`, `ResponseCache`, `Logger`, `fixedClock`, `Secret`, `PLAN_PRESETS`. Produces test helpers only, plus `SEARCHAPI_HOST`, `SEARCHAPI_ENDPOINT` and `SEARCHAPI_ENDPOINT_PATH`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/replay.test.ts
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ReplayLog, expandPlaceholders, loadRecorded, replayHandler, restorePlaceholder } from './support/recorded.js';

const recorded = loadRecorded();
const book: ReplayLog = { requests: [], misses: [] };
const server = setupServer(replayHandler(recorded, book));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => { book.requests.length = 0; book.misses.length = 0; });
afterAll(() => server.close());

describe('recorded-fixture replay (spec §5.3 placeholders, §9 item 2)', () => {
  it('loads at least one recorded SearchApi file', () => {
    expect(recorded.length).toBeGreaterThan(0);
    for (const r of recorded) expect(r.providerId).toBe('searchapi');
  });

  it('round-trips placeholders: body placeholders become opaque replay tokens and back', () => {
    expect(expandPlaceholders({ a: ['<departure_token:0>', 'x'] })).toEqual({ a: ['replay-departure_token-0', 'x'] });
    expect(restorePlaceholder('replay-booking_token-3')).toBe('<booking_token:3>');
    expect(restorePlaceholder('LHR')).toBe('LHR');
  });

  it('serves each recorded body for exactly its recorded parameters', async () => {
    for (const r of recorded) {
      const url = new URL('https://www.searchapi.io/api/v1/search');
      for (const [k, v] of Object.entries(r.request.params)) url.searchParams.set(k, String(expandPlaceholders(v)));
      const res = await fetch(url, { headers: { Authorization: 'Bearer test-searchapi-key-0123456789abcdef' } });
      expect(res.status).toBe(r.status);
      expect(await res.json()).toEqual(expandPlaceholders(r.body));
    }
    expect(book.misses).toEqual([]);
  });

  it('answers 418 and records a miss for parameters nothing recorded', async () => {
    const res = await fetch('https://www.searchapi.io/api/v1/search?engine=google_flights&departure_id=AAA');
    expect(res.status).toBe(418);
    expect(book.misses).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/replay.test.ts`
Expected: FAIL. `./support/recorded.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/params.ts (initial; Task 5.3 extends it)
/** SearchApi's single host; WP4b passes it to http-kit as the egress allowlist (spec §5.3). */
export const SEARCHAPI_HOST = 'www.searchapi.io';
/** Both engines share one endpoint; `engine` selects calendar or itinerary. Verified 2026-10-14. */
export const SEARCHAPI_ENDPOINT = `https://${SEARCHAPI_HOST}/api/v1/search`;
/** Path only, as written to `provider_requests.endpoint_path` (spec §5.3: no query). */
export const SEARCHAPI_ENDPOINT_PATH = '/api/v1/search';
```

```ts
// test/searchapi/support/recorded.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpResponse, http } from 'msw/http';
import { z } from 'zod';
import { SEARCHAPI_ENDPOINT } from '../../../src/searchapi/params.js';

/** WP4b's recorded tree for this provider (spec §5.3 recorder layout). Read-only in tests. */
export const RECORDED_ROOT = fileURLToPath(new URL('../../../fixtures/recorded/searchapi/', import.meta.url));

// why: the shape WP4's recorder writes, as this brief reads it ("Inputs from WP4b" item 1).
// A mismatch fails here, loudly, rather than as a confusing replay miss.
const recordedFileSchema = z.object({
  recordedAt: z.string(),
  recordedBy: z.string(),
  contentHash: z.string(),
  providerId: z.literal('searchapi'),
  endpointPath: z.string(),
  request: z.object({ method: z.union([z.literal('GET'), z.literal('POST')]), params: z.record(z.string(), z.string()) }),
  status: z.number().int(),
  body: z.unknown(),
});
export type Recorded = z.infer<typeof recordedFileSchema> & { file: string };

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Every recorder file under the SearchApi tree, sorted by path; the params allowlist is excluded. */
export function loadRecorded(): Recorded[] {
  const out: Recorded[] = [];
  for (const file of walk(RECORDED_ROOT)) {
    if (!file.endsWith('.json') || basename(file).startsWith('params-')) continue;
    const parsed = recordedFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) throw new Error(`${file} is not a recorder file: ${parsed.error.message}`);
    out.push({ ...parsed.data, file });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The newest dated parameter allowlist written by WP4b (`params-<yyyy-mm-dd>.json`). */
export function latestParamsFile(): unknown {
  const files = readdirSync(RECORDED_ROOT).filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const last = files.at(-1);
  if (last === undefined) throw new Error(`no params-<date>.json under ${RECORDED_ROOT}`);
  return JSON.parse(readFileSync(join(RECORDED_ROOT, last), 'utf8'));
}

export const byEngine = (rs: readonly Recorded[], engine: string) => rs.filter((r) => r.request.params.engine === engine);

/** The recorded step 1 → 2 → 3 chain ("Inputs from WP4b" item 2). */
export function chainRecording(rs: readonly Recorded[]) {
  const ok = byEngine(rs, 'google_flights').filter((r) => r.status === 200);
  const step1 = ok.find((r) => !('departure_token' in r.request.params) && !('booking_token' in r.request.params));
  const step2s = ok.filter((r) => 'departure_token' in r.request.params);
  const step3s = ok.filter((r) => 'booking_token' in r.request.params);
  if (step1 === undefined || step2s.length === 0 || step3s.length === 0) throw new Error('WP4b recordings must include a full step 1 → 2 → 3 chain');
  return { step1, step2s, step3s };
}

/** Required parameter of a recorded request, or a clear failure naming it. */
export function need(params: Readonly<Record<string, string>>, name: string): string {
  const v = params[name];
  if (v === undefined) throw new Error(`recorded request lacks ${name}`);
  return v;
}

const PLACEHOLDER = /<([a-z_]+):(\d+)>/g;
const REPLAY = /^replay-([a-z_]+)-(\d+)$/;

/**
 * Recorded bodies hold placeholders such as `<departure_token:0>` (spec §5.3). Replay hands the
 * adapter opaque, URL-safe stand-ins (`replay-departure_token-0`) so it sees realistic tokens.
 */
export function expandPlaceholders(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(PLACEHOLDER, 'replay-$1-$2');
  if (Array.isArray(v)) return v.map(expandPlaceholders);
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandPlaceholders(x)]));
  return v;
}

/** The reverse substitution: a stand-in sent by the adapter maps back to the recorded placeholder. */
export function restorePlaceholder(value: string): string {
  const m = REPLAY.exec(value);
  return m ? `<${m[1]}:${m[2]}>` : value;
}

function canonical(params: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
}

/** What the replay handler saw, for allowlist, header and miss assertions. */
export interface ReplayLog {
  requests: Array<{ params: Record<string, string>; authorization: string | null; url: string }>;
  misses: Array<Record<string, string>>;
}

/**
 * msw handler serving `fixtures/recorded/searchapi/**` by exact parameter match after
 * reversing the placeholder substitution. Unmatched requests get 418 and are recorded as
 * misses; every test file asserts `misses` is empty.
 */
export function replayHandler(recorded: readonly Recorded[], book: ReplayLog) {
  const byKey = new Map(recorded.map((r) => [canonical(r.request.params), r] as const));
  return http.get(SEARCHAPI_ENDPOINT, ({ request }) => {
    const sent = Object.fromEntries(new URL(request.url).searchParams.entries());
    book.requests.push({ params: sent, authorization: request.headers.get('authorization'), url: request.url });
    const restored = Object.fromEntries(Object.entries(sent).map(([k, v]) => [k, restorePlaceholder(v)]));
    const hit = byKey.get(canonical(restored));
    if (hit === undefined) {
      book.misses.push(restored);
      return HttpResponse.json({ error: 'no recorded fixture for these parameters' }, { status: 418 });
    }
    return HttpResponse.json(expandPlaceholders(hit.body) as Record<string, unknown>, { status: hit.status });
  });
}
```

```ts
// test/searchapi/support/synthetic.ts
// Synthetic SearchApi shapes for cases the recordings do not contain. Every test using these
// says "(synthetic)" in its name; nothing here is ever written under fixtures/.
import { asIata, asIsoDate, type ItineraryQuery } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { SEARCHAPI_ENDPOINT } from '../../../src/searchapi/params.js';

export const ECHO = { search_parameters: { currency: 'GBP', gl: 'gb', hl: 'en' } } as const;
export type Reply = { status: number; body: unknown };

/** One handler answering every SearchApi request through `respond`; `seen` collects the parameters. */
export function syntheticHandler(respond: (p: URLSearchParams) => Reply, seen: URLSearchParams[]) {
  return http.get(SEARCHAPI_ENDPOINT, ({ request }) => {
    const p = new URL(request.url).searchParams;
    seen.push(p);
    const r = respond(p);
    return HttpResponse.json(r.body as Record<string, unknown>, { status: r.status });
  });
}

export function seg(from: string, to: string, date: string, time: string, flightNumber: string, airline: string, travelClass = 'Economy') {
  return { departure_airport: { id: from, date, time }, arrival_airport: { id: to, date, time: '23:00' }, airline, flight_number: flightNumber, travel_class: travelClass, duration: 420, airplane: 'Synthetic 787' };
}

// Worked-example cell (spec §1) with clearly synthetic carriers.
export const OUT_A = [seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100', 'Synthetic Air One')];
export const OUT_B = [seg('LHR', 'JFK', '2026-11-02', '13:00', 'Y2 200', 'Synthetic Air Two')];
export const IN_1 = [seg('JFK', 'LHR', '2026-11-14', '18:00', 'X1 101', 'Synthetic Air One')];
export const IN_2 = [seg('JFK', 'LHR', '2026-11-14', '20:00', 'X1 103', 'Synthetic Air One')];
export const IN_3 = [seg('JFK', 'LHR', '2026-11-14', '22:00', 'X1 105', 'Synthetic Air One')];

export function option(flights: unknown[], price: number | undefined, token: { departure_token: string } | { booking_token: string }) {
  return { flights, ...(price === undefined ? {} : { price }), ...token };
}
export const flightsBody = (options: unknown[], extra: object = {}) => ({ ...ECHO, best_flights: options, ...extra });
export const bookingBody = (options: unknown[]) => ({ ...ECHO, booking_options: options });
export const POST = { url: 'https://www.google.com/travel/clk/f', post_data: 'u=synthetic' };

export const CELL_QUERY: ItineraryQuery = {
  origin: asIata('LHR'), destination: asIata('JFK'), departureDate: asIsoDate('2026-11-02'), returnDate: asIsoDate('2026-11-14'),
  cabin: 'economy', adults: 1, currency: 'GBP', expandTop: 2, bookingLinks: true,
};
```

```ts
// test/searchapi/support/ports.ts
import {
  type BudgetGuard, type IsoDateTime, type Logger, PLAN_PRESETS, type ProviderContext,
  type ResponseCache, Secret, asIsoDateTime, fixedClock,
} from '@gmt/core';
import { type HttpKit, type ProviderHttpLimits, createHttpKit } from '../../../src/http/httpKit.js';
import { searchApiHttpLimits } from '../../../src/searchapi/errors.js';

/** Sentinel key (brief rules): asserted never to reach any sink except the Authorization header. */
export const SENTINEL_KEY = 'test-searchapi-key-0123456789abcdef';
export const T0 = '2026-10-14T12:00:00.000Z';

const unused: ProviderHttpLimits = { hosts: [], ratePerMinute: 1, ratePerHour: 1, concurrency: 1, billable: 'never', costPerCallMicroGbp: 0, maxWaitSeconds: 1, requestTimeoutSeconds: 1 };

export interface TestPorts {
  http: HttpKit; key: Secret; log: Logger; logLines: string[];
  clock: ReturnType<typeof fixedClock>;
  reserves: Array<{ endpointPath: string; httpAttempt: number }>;
}

/**
 * The real http-kit (WP4) over in-memory budget and cache ports. `providers` may not import
 * `db` (spec §4), so the guard here only records reservations; WP4 tests the real pipeline.
 */
export function testPorts(): TestPorts {
  const key = new Secret(SENTINEL_KEY);
  const clock = fixedClock(asIsoDateTime(T0));
  const reserves: TestPorts['reserves'] = [];
  const budget: BudgetGuard = {
    reserve: (p) => {
      reserves.push({ endpointPath: p.endpointPath, httpAttempt: p.httpAttempt });
      return { id: `r${reserves.length}`, finalise: () => undefined };
    },
    recordCacheHit: () => undefined,
    usage: () => ({ calls: reserves.length, costMicroGbp: 0, cap: null, windowStart: null, windowEnd: null }),
  };
  const store = new Map<string, { body: unknown; storedAt: IsoDateTime }>();
  const cache: ResponseCache = {
    get: (k) => store.get(k),
    set: (k, body, _ttlSeconds, storedAt) => { store.set(k, { body, storedAt }); },
  };
  const logLines: string[] = [];
  const write = (o: object, msg?: string): void => { logLines.push(JSON.stringify({ o, msg })); };
  const log: Logger = { debug: write, info: write, warn: write, error: write, child: () => log };
  // why: generous test rates so bottleneck never queues a 5-call chain; classification is unchanged.
  const searchapi = { ...searchApiHttpLimits(PLAN_PRESETS['40usd'], { maxWaitSeconds: 5, requestTimeoutSeconds: 5 }), ratePerMinute: 1000, ratePerHour: 100_000, concurrency: 4 };
  const http = createHttpKit({ budget, cache, clock, log, secrets: [key], limits: { searchapi, travelpayouts: unused, fixture: unused, fx: unused } });
  return { http, key, log, logLines, clock, reserves };
}

export function ctx(): ProviderContext {
  return { executionId: 'exec-test', signal: new AbortController().signal, recordFixtures: false };
}
```

`ports.ts` imports `searchApiHttpLimits` from `errors.ts`, which Task 5.4 creates; the first test file importing `ports.ts` is Task 5.5's. Until Task 5.4 lands, `pnpm --filter @gmt/providers typecheck` reports that one missing module; vitest transforms only the files a test imports, so this task's run is unaffected.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/replay.test.ts`
Expected: PASS, 4 tests. `misses` is empty for every recorded file.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: recorded-fixture replay with placeholder reversal and synthetic builders"
```

### Task 5.3: Parameter allowlist and request builders

**Files:** complete `src/searchapi/params.ts`. Modify `packages/providers/package.json` (add `"zod": "4.6.7"`, then `pnpm install`). Create `test/searchapi/params.test.ts`.

**Interfaces:** consumes `Cabin`, `DiscoveryQuery`, `ItineraryQuery`, `Secret`, `Rectangle`. Produces `SearchApiEngine`, `ParamRule`, `ParamsByEngine`, `SEARCHAPI_PARAMS_ALLOWLIST`, `parseParamsAllowlist`, `paramViolations`, `assertAllowed`, `TRAVEL_CLASS`, `calendarParams`, `flightsParams`, `toUrl`, `authHeaders`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/params.test.ts
import { asIata, asIsoDate, Secret } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  SEARCHAPI_PARAMS_ALLOWLIST, TRAVEL_CLASS, assertAllowed, authHeaders, calendarParams, flightsParams,
  paramViolations, parseParamsAllowlist, toUrl,
} from '../../src/searchapi/params.js';
import { CELL_QUERY } from './support/synthetic.js';
import { latestParamsFile } from './support/recorded.js';

const rect = { kind: 'rectangle', departFrom: asIsoDate('2026-11-02'), departTo: asIsoDate('2026-11-09'), returnFrom: asIsoDate('2026-11-12'), returnTo: asIsoDate('2026-11-30') } as const;
const calQ = { origin: asIata('LHR'), destination: asIata('JFK'), cabin: 'economy' as const };

describe('SearchApi parameter allowlist (spec §5.2, dated allowlist)', () => {
  it('the code constant equals the dated allowlist WP4b recorded, names and values', () => {
    expect(parseParamsAllowlist(latestParamsFile()).engines).toEqual(SEARCHAPI_PARAMS_ALLOWLIST);
  });

  it('calendar parameters: names, values and point of sale (gl = POINT_OF_SALE lower-cased, hl=en, currency=GBP)', () => {
    const p = calendarParams(calQ, rect, 'GB');
    expect(p).toEqual({
      engine: 'google_flights_calendar', departure_id: 'LHR', arrival_id: 'JFK', flight_type: 'round_trip',
      outbound_date: '2026-11-02', outbound_date_start: '2026-11-02', outbound_date_end: '2026-11-09',
      return_date: '2026-11-12', return_date_start: '2026-11-12', return_date_end: '2026-11-30',
      travel_class: 'economy', adults: '1', currency: 'GBP', gl: 'gb', hl: 'en',
    });
    expect(paramViolations(SEARCHAPI_PARAMS_ALLOWLIST, 'google_flights_calendar', p)).toEqual([]);
  });

  it.each([
    ['economy', 'economy'], ['premium_economy', 'premium_economy'], ['business', 'business'], ['first', 'first_class'],
  ] as const)('cabin %s maps to travel_class %s (vendor docs 2026-10-14)', (cabin, value) => {
    expect(TRAVEL_CLASS[cabin]).toBe(value);
    expect(calendarParams({ ...calQ, cabin }, rect, 'GB').travel_class).toBe(value);
  });

  it.each([[0, 'nonstop'], [1, 'one_stop_or_fewer'], [2, 'two_stops_or_fewer']] as const)('maxStops %i → stops=%s', (maxStops, stops) => {
    expect(flightsParams({ ...CELL_QUERY, maxStops }, 'GB').stops).toBe(stops);
  });

  it('omits stops when maxStops is absent or above 2', () => {
    expect(flightsParams(CELL_QUERY, 'GB').stops).toBeUndefined();
    expect(flightsParams({ ...CELL_QUERY, maxStops: 3 }, 'GB').stops).toBeUndefined();
  });

  it('steps 2 and 3 resend the step-1 parameters plus one token', () => {
    const s1 = flightsParams(CELL_QUERY, 'GB');
    expect(flightsParams(CELL_QUERY, 'GB', { departure_token: 'tok' })).toEqual({ ...s1, departure_token: 'tok' });
    expect(flightsParams(CELL_QUERY, 'GB', { booking_token: 'tok' })).toEqual({ ...s1, booking_token: 'tok' });
    expect(paramViolations(SEARCHAPI_PARAMS_ALLOWLIST, 'google_flights', { ...s1, booking_token: 'tok' })).toEqual([]);
  });

  it('rejects unknown names and disallowed values, and never lets a key into the query', () => {
    const p = { ...calendarParams(calQ, rect, 'GB'), api_key: 'x', currency: 'USD' };
    const v = paramViolations(SEARCHAPI_PARAMS_ALLOWLIST, 'google_flights_calendar', p);
    expect(v).toHaveLength(2);
    expect(() => assertAllowed(SEARCHAPI_PARAMS_ALLOWLIST, 'google_flights_calendar', p)).toThrow(/api_key/);
    expect(toUrl(calendarParams(calQ, rect, 'GB')).search).not.toContain('api_key');
  });

  it('rejects a parameter set addressed to the other engine', () => {
    expect(paramViolations(SEARCHAPI_PARAMS_ALLOWLIST, 'google_flights', calendarParams(calQ, rect, 'GB')).length).toBeGreaterThan(0);
  });

  it('puts the key in Authorization: Bearer only (spec §2 fact 8)', () => {
    expect(authHeaders(new Secret('test-searchapi-key-0123456789abcdef'))).toEqual({ Authorization: 'Bearer test-searchapi-key-0123456789abcdef', Accept: 'application/json' });
  });

  it('parseParamsAllowlist refuses a malformed file', () => {
    expect(() => parseParamsAllowlist({ engines: {} })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/params.test.ts`
Expected: FAIL. `SEARCHAPI_PARAMS_ALLOWLIST` (and the other imports) is not exported from `params.js`.

- [ ] **Step 3: Implement** (append to `src/searchapi/params.ts`)

```ts
import type { Cabin, DiscoveryQuery, ItineraryQuery, Secret, TileRequest } from '@gmt/core';
import { z } from 'zod';

/** The two engines this adapter calls. Spec §2. */
export type SearchApiEngine = 'google_flights_calendar' | 'google_flights';
/** A parameter is allowed with one of `values`, or with a value matching `pattern` (dates, airports, tokens). */
export type ParamRule = { values: readonly string[] } | { pattern: string };
export type ParamsByEngine = Record<SearchApiEngine, Readonly<Record<string, ParamRule>>>;

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const IATA = '^[A-Z]{3}$';
const TOKEN = '^\\S{1,4096}$';
const TRAVEL_CLASSES = ['economy', 'premium_economy', 'business', 'first_class'] as const;

/** Cabin → vendor `travel_class`. `first` is `first_class` at SearchApi (docs verified 2026-10-14). */
export const TRAVEL_CLASS: Readonly<Record<Cabin, (typeof TRAVEL_CLASSES)[number]>> = {
  economy: 'economy', premium_economy: 'premium_economy', business: 'business', first: 'first_class',
};

const SHARED: Readonly<Record<string, ParamRule>> = {
  departure_id: { pattern: IATA },
  arrival_id: { pattern: IATA },
  flight_type: { values: ['round_trip'] },
  travel_class: { values: TRAVEL_CLASSES },
  adults: { values: ['1'] },
  currency: { values: ['GBP'] },
  gl: { pattern: '^[a-z]{2}$' },
  hl: { values: ['en'] },
};

/**
 * Every parameter name and value this adapter may send, per engine. Spec §5.2: the dated
 * allowlist (`fixtures/recorded/searchapi/params-<date>.json`, WP4b) enumerates names and
 * values, and a test pins this constant to it.
 * why: a code constant, because `.dockerignore` excludes `fixtures/recorded/` from the image.
 */
export const SEARCHAPI_PARAMS_ALLOWLIST: ParamsByEngine = {
  google_flights_calendar: {
    engine: { values: ['google_flights_calendar'] },
    ...SHARED,
    outbound_date: { pattern: DATE }, outbound_date_start: { pattern: DATE }, outbound_date_end: { pattern: DATE },
    return_date: { pattern: DATE }, return_date_start: { pattern: DATE }, return_date_end: { pattern: DATE },
  },
  google_flights: {
    engine: { values: ['google_flights'] },
    ...SHARED,
    outbound_date: { pattern: DATE }, return_date: { pattern: DATE },
    stops: { values: ['nonstop', 'one_stop_or_fewer', 'two_stops_or_fewer'] },
    departure_token: { pattern: TOKEN }, booking_token: { pattern: TOKEN },
  },
};

const ruleSchema = z.union([z.object({ values: z.array(z.string()) }), z.object({ pattern: z.string() })]);
const allowlistFileSchema = z.object({
  recordedAt: z.string(),
  engines: z.object({ google_flights_calendar: z.record(z.string(), ruleSchema), google_flights: z.record(z.string(), ruleSchema) }),
});

/** Parses WP4b's `params-<date>.json`. Throws on any other shape. */
export function parseParamsAllowlist(json: unknown): { recordedAt: string; engines: ParamsByEngine } {
  return allowlistFileSchema.parse(json);
}

/** Every way `params` breaks the allowlist for `engine`; empty means allowed. Token values are never echoed. */
export function paramViolations(allow: ParamsByEngine, engine: SearchApiEngine, params: Readonly<Record<string, string>>): string[] {
  const rules = allow[engine];
  const out: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    const rule = rules[name];
    if (rule === undefined) {
      out.push(`${engine}: parameter ${name} is not in the allowlist`);
      continue;
    }
    const ok = 'values' in rule ? rule.values.includes(value) : new RegExp(rule.pattern).test(value);
    if (!ok) out.push(`${engine}: ${name}=${name.endsWith('_token') ? '<token>' : value} is not allowed`);
  }
  return out;
}

/** Throws before any request leaves the adapter (and so before budget.reserve) when a parameter is not allowed. */
export function assertAllowed(allow: ParamsByEngine, engine: SearchApiEngine, params: Readonly<Record<string, string>>): void {
  const v = paramViolations(allow, engine, params);
  if (v.length > 0) throw new Error(`searchapi parameter allowlist: ${v.join('; ')}`);
}

/** Spec §5.2 point of sale: hard-coded GBP and English, `gl` from POINT_OF_SALE. */
function localisation(pointOfSale: string): Record<string, string> {
  return { currency: 'GBP', gl: pointOfSale.toLowerCase(), hl: 'en' };
}

/**
 * `google_flights_calendar` parameters for one rectangle. `outbound_date`/`return_date` are
 * required by the vendor even with the `_start`/`_end` ranges (docs 2026-10-14).
 */
export function calendarParams(q: Pick<DiscoveryQuery, 'origin' | 'destination' | 'cabin'>, r: Extract<TileRequest, { kind: 'rectangle' }>, pointOfSale: string): Record<string, string> {
  return {
    engine: 'google_flights_calendar', departure_id: q.origin, arrival_id: q.destination, flight_type: 'round_trip',
    outbound_date: r.departFrom, outbound_date_start: r.departFrom, outbound_date_end: r.departTo,
    return_date: r.returnFrom, return_date_start: r.returnFrom, return_date_end: r.returnTo,
    travel_class: TRAVEL_CLASS[q.cabin], adults: '1', ...localisation(pointOfSale),
  };
}

const STOPS: Readonly<Record<number, string>> = { 0: 'nonstop', 1: 'one_stop_or_fewer', 2: 'two_stops_or_fewer' };

/**
 * `google_flights` parameters for one cell. Steps 2 and 3 resend these plus one token, as
 * every documented token example does (docs 2026-10-14). Spec §5.4.
 */
export function flightsParams(q: ItineraryQuery, pointOfSale: string, token?: { departure_token: string } | { booking_token: string }): Record<string, string> {
  const p: Record<string, string> = {
    engine: 'google_flights', departure_id: q.origin, arrival_id: q.destination, flight_type: 'round_trip',
    outbound_date: q.departureDate, return_date: q.returnDate, travel_class: TRAVEL_CLASS[q.cabin], adults: String(q.adults),
    ...localisation(pointOfSale),
  };
  const stops = q.maxStops === undefined ? undefined : STOPS[q.maxStops];
  if (stops !== undefined) p.stops = stops;
  return token === undefined ? p : { ...p, ...token };
}

export function toUrl(params: Readonly<Record<string, string>>): URL {
  const u = new URL(SEARCHAPI_ENDPOINT);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

/** The only place the key is revealed: an Authorization header (spec §2 fact 8, §5.3). */
export function authHeaders(key: Secret): Record<string, string> {
  return { Authorization: `Bearer ${key.reveal()}`, Accept: 'application/json' };
}
```

Move the `import` lines to the top of the file. The three constants from Task 5.2 stay.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/params.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers pnpm-lock.yaml && git commit -m "wp05: SearchApi parameter allowlist and request builders (spec §5.2)"
```

### Task 5.4: Error classification

**Files:** create `src/searchapi/errors.ts` and `test/searchapi/errors.test.ts`.

**Interfaces:** consumes `ProviderError`, `PLAN_PRESETS`. Produces `classifySearchApiError` and `searchApiHttpLimits` (tested).

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/errors.test.ts
import { PLAN_PRESETS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { classifySearchApiError, searchApiHttpLimits } from '../../src/searchapi/errors.js';
import { loadRecorded } from './support/recorded.js';

const recorded = loadRecorded();

describe('classifySearchApiError (spec §5.2 errors, §2 fact 5)', () => {
  it('the recorded 401 body → auth, non-retryable, vendor message as reason', () => {
    const r = recorded.find((x) => x.status === 401);
    if (r === undefined) throw new Error('WP4b must record the 401 body');
    expect(r.body).toEqual({ error: 'Invalid API key.' });
    expect(classifySearchApiError(401, r.body, false)).toMatchObject({ kind: 'auth', retryable: false, httpStatus: 401, reason: 'Invalid API key.' });
  });

  it('the recorded 400 body → parse, non-retryable, with the vendor message as reason', () => {
    const r = recorded.find((x) => x.status === 400);
    if (r === undefined) throw new Error('WP4b must record the 400 body');
    const e = classifySearchApiError(400, r.body, false);
    expect(e).toMatchObject({ kind: 'parse', retryable: false, httpStatus: 400 });
    expect(e.reason).toBe((r.body as { error: string }).error.slice(0, 200));
  });

  it.each([
    [403, false, 'auth', false],
    [402, false, 'quota', false],
    [404, false, 'upstream', false],
    [429, false, 'rate-limit', true],
    [429, true, 'quota', false], // quota discrimination by ledger state (spec §5.2)
    [500, false, 'upstream', true],
    [503, false, 'upstream', true],
    [418, false, 'upstream', false],
  ] as const)('HTTP %i (ledger at cap: %s) → %s, retryable %s', (status, atCap, kind, retryable) => {
    expect(classifySearchApiError(status, { error: 'x' }, atCap)).toMatchObject({ kind, retryable, httpStatus: status, providerId: 'searchapi' });
  });

  it('tolerates a string body and an empty body', () => {
    expect(classifySearchApiError(400, 'bad request', false).reason).toBe('bad request');
    expect(classifySearchApiError(400, null, false).reason).toBe('no message');
  });

  it('never puts a URL query into the message', () => {
    const e = classifySearchApiError(400, { error: 'see https://www.searchapi.io/api/v1/search?api_key=SECRET' }, false);
    expect(e.message).not.toContain('SECRET');
  });
});

describe('searchApiHttpLimits (spec §5.3)', () => {
  it('maps plan limits, the one host, http-200 billing and the classifier', () => {
    const l = searchApiHttpLimits(PLAN_PRESETS['40usd'], { maxWaitSeconds: 3900, requestTimeoutSeconds: 60 });
    expect(l).toMatchObject({ hosts: ['www.searchapi.io'], ratePerMinute: 10, ratePerHour: 2000, concurrency: 2, billable: 'http-200', costPerCallMicroGbp: 0, maxWaitSeconds: 3900, requestTimeoutSeconds: 60 });
    expect(l.classifyError).toBe(classifySearchApiError);
    expect(searchApiHttpLimits(PLAN_PRESETS.trial, { maxWaitSeconds: 1, requestTimeoutSeconds: 1 })).toMatchObject({ ratePerMinute: 2, ratePerHour: 20, concurrency: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/errors.test.ts`
Expected: FAIL. `../../src/searchapi/errors.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/errors.ts
import { ProviderError, type ProviderLimits } from '@gmt/core';
import type { ProviderHttpLimits } from '../http/httpKit.js';
import { SEARCHAPI_HOST } from './params.js';

/** The vendor's message: `{"error": "..."}` (spec §2 fact 5), a plain string, or nothing. Never a URL with a key: keys travel in headers. */
function vendorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === 'string') return e.slice(0, 200);
  }
  if (typeof body === 'string' && body.length > 0) return body.slice(0, 200);
  return 'no message';
}

/**
 * http-kit's `classifyError` hook for SearchApi. Spec §5.2 table: 401/403 auth, 402 quota,
 * 400 parse with the vendor message as reason (non-retryable), 404 upstream non-retryable,
 * 429 rate-limit unless the ledger shows the plan cap reached (then quota), 5xx upstream
 * retryable. No quota body is recorded yet (spec §2 fact 5), so 429 is discriminated by
 * ledger state alone.
 */
export function classifySearchApiError(status: number, body: unknown, ledgerAtCap: boolean): ProviderError {
  const msg = vendorMessage(body);
  const base = { providerId: 'searchapi' as const, httpStatus: status, message: `searchapi HTTP ${status}: ${msg}` };
  if (status === 401 || status === 403) return new ProviderError({ ...base, kind: 'auth', retryable: false, reason: msg });
  if (status === 402) return new ProviderError({ ...base, kind: 'quota', retryable: false, reason: msg });
  if (status === 400) return new ProviderError({ ...base, kind: 'parse', retryable: false, reason: msg });
  if (status === 404) return new ProviderError({ ...base, kind: 'upstream', retryable: false, reason: 'not-found' });
  if (status === 429) {
    return ledgerAtCap
      ? new ProviderError({ ...base, kind: 'quota', retryable: false, reason: 'plan-cap-reached' })
      : new ProviderError({ ...base, kind: 'rate-limit', retryable: true });
  }
  if (status >= 500) return new ProviderError({ ...base, kind: 'upstream', retryable: true });
  return new ProviderError({ ...base, kind: 'upstream', retryable: false, reason: `http-${status}` });
}

/**
 * SearchApi's http-kit limits from its plan limits (spec §5.3). Billable on HTTP 200 on every
 * plan: on a subscription the cost is 0 but the call cap still counts (spec §5.3 billable rule).
 */
export function searchApiHttpLimits(l: ProviderLimits, o: { maxWaitSeconds: number; requestTimeoutSeconds: number }): ProviderHttpLimits {
  return {
    hosts: [SEARCHAPI_HOST], ratePerMinute: l.ratePerMinute, ratePerHour: l.ratePerHour, concurrency: l.concurrency,
    billable: 'http-200', costPerCallMicroGbp: l.costPerCallMicroGbp,
    maxWaitSeconds: o.maxWaitSeconds, requestTimeoutSeconds: o.requestTimeoutSeconds, classifyError: classifySearchApiError,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/errors.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi error classification incl. recorded 401/400 and 429 quota discrimination"
```

### Task 5.5: Calendar tile fetch and parse

**Files:** create `src/searchapi/shapes.ts`. Extend `src/searchapi/calendar.ts`. Create `test/searchapi/calendar.test.ts`.

**Interfaces:** consumes `HttpKit`, `ProviderContext`, `DiscoveryTileResult`, `RawCalendarPrice`, `ProviderError`, `MINOR_EXPONENT`, `cellKeyString`, `toEpochDay`. Produces `fetchCalendarTile`, `parseCalendarBody`, `SearchApiTileResult`, `CalendarDeps`, `readEcho`, `toMinor`, `NoteCounter`, `parseError` and the vendor zod shapes.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/calendar.test.ts
import { type DiscoveryQuery, type TilePlan, addDays, asIata, asIsoDate, cellKeyString, toEpochDay } from '@gmt/core';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type CalendarDeps, fetchCalendarTile, planRectangles } from '../../src/searchapi/calendar.js';
import { SEARCHAPI_PARAMS_ALLOWLIST, TRAVEL_CLASS, paramViolations } from '../../src/searchapi/params.js';
import { SENTINEL_KEY, ctx, testPorts } from './support/ports.js';
import { type ReplayLog, byEngine, loadRecorded, need, replayHandler } from './support/recorded.js';
import { ECHO, syntheticHandler } from './support/synthetic.js';

const recorded = loadRecorded();
const book: ReplayLog = { requests: [], misses: [] };
const server = setupServer(replayHandler(recorded, book));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  // why: spec §5.2 / §9 item 2: every outgoing request's names and values are in the dated allowlist.
  for (const r of book.requests) expect(paramViolations(SEARCHAPI_PARAMS_ALLOWLIST, 'google_flights_calendar', r.params)).toEqual([]);
  expect(book.misses).toEqual([]);
  book.requests.length = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

const deps = (p = testPorts()): CalendarDeps & { ports: ReturnType<typeof testPorts> } => ({ http: p.http, log: p.log, key: p.key, pointOfSale: 'GB', allowlist: SEARCHAPI_PARAMS_ALLOWLIST, cacheTtlSeconds: 3600, ports: p });
const day = (s: string) => toEpochDay(asIsoDate(s));

/** A one-tile query over 3 departure days and 10–12 nights (15 combinations, 9 cells). */
const small: DiscoveryQuery = { origin: asIata('LHR'), destination: asIata('JFK'), departureFrom: asIsoDate('2026-11-02'), departureTo: asIsoDate('2026-11-04'), minNights: 10, maxNights: 12, cabin: 'economy', currency: 'GBP' };
const smallPlan = (): TilePlan => {
  const [t] = planRectangles(small);
  if (t === undefined) throw new Error('expected one tile');
  return t;
};
/** Calendar body with one entry per covered cell, priced 500 unless overridden. */
const gridFor = (plan: TilePlan, extra: object[] = [], echo: object = ECHO) => ({
  ...echo,
  calendar: [...plan.coveredCells.map((c) => ({ departure: c.departureDate, return: c.returnDate, price: 500 })), ...extra],
});

describe('fetchTile, recorded (spec §5.2, §9 item 2)', () => {
  it('replays the recorded tile: prices keyed from the response, GBP from the echo, point of sale from gl', async () => {
    const rec = byEngine(recorded, 'google_flights_calendar').find((r) => r.status === 200);
    if (rec === undefined) throw new Error('WP4b must record one HTTP 200 calendar tile');
    const p = rec.request.params;
    const departureFrom = asIsoDate(need(p, 'outbound_date_start'));
    const departureTo = asIsoDate(need(p, 'outbound_date_end'));
    const returnFrom = need(p, 'return_date_start');
    const returnTo = need(p, 'return_date_end');
    const cabin = (Object.entries(TRAVEL_CLASS).find(([, v]) => v === (p.travel_class ?? 'economy'))?.[0] ?? 'economy') as DiscoveryQuery['cabin'];
    // why: choose the band whose tight rectangle is exactly the recorded one, so the plan reproduces it.
    const q: DiscoveryQuery = { origin: asIata(need(p, 'departure_id')), destination: asIata(need(p, 'arrival_id')), departureFrom, departureTo, minNights: day(returnFrom) - day(departureFrom), maxNights: day(returnTo) - day(departureTo), cabin, currency: 'GBP' };
    const plans = planRectangles(q);
    expect(plans).toHaveLength(1);
    const d = deps();
    const plan = plans[0] as TilePlan;
    const res = await fetchCalendarTile(d, plan, q, ctx());
    expect(res.kind).toBe('tile');
    if (res.kind !== 'tile') return;
    const covered = new Set(plan.coveredCells.map(cellKeyString));
    expect(res.prices.length).toBeGreaterThan(0); // spec §2: every probed route fully priced
    for (const price of res.prices) {
      expect(covered.has(cellKeyString(price))).toBe(true);
      expect(price.currency).toBe('GBP');
      expect(Number.isInteger(price.amountMinor)).toBe(true);
    }
    expect(res.pointOfSale).toBe('GB');
    expect(res.fetchedAt).toBe('2026-10-14T12:00:00.000Z');
    expect(book.requests).toHaveLength(1);
    expect(book.requests[0]?.authorization).toBe(`Bearer ${SENTINEL_KEY}`);
    expect(book.requests[0]?.url).not.toContain(SENTINEL_KEY);
  });

  it('a recorded 401 body becomes a tile-error of kind auth (spec §2 fact 5)', async () => {
    const r401 = recorded.find((r) => r.status === 401);
    if (r401 === undefined) throw new Error('WP4b must record the 401 body');
    const seen: URLSearchParams[] = [];
    server.use(syntheticHandler(() => ({ status: 401, body: r401.body }), seen));
    const res = await fetchCalendarTile(deps(), smallPlan(), small, ctx());
    expect(res).toMatchObject({ kind: 'tile-error', error: { kind: 'auth', retryable: false, httpStatus: 401 } });
  });
});

describe('fetchTile, synthetic shapes absent from the recordings', () => {
  it('plan().length equals upstream hits exactly over a 3-tile scan (synthetic)', async () => {
    const q: DiscoveryQuery = { ...small, departureTo: addDays(small.departureFrom, 23), minNights: 10, maxNights: 21 };
    const plans = planRectangles(q);
    expect(plans).toHaveLength(3);
    const seen: URLSearchParams[] = [];
    // why: answer every rectangle combination, so out-of-band entries exist and must be dropped.
    server.use(syntheticHandler((p) => {
      const out: object[] = [];
      for (let d = p.get('outbound_date_start') ?? ''; d <= (p.get('outbound_date_end') ?? ''); d = addDays(asIsoDate(d), 1))
        for (let r = p.get('return_date_start') ?? ''; r <= (p.get('return_date_end') ?? ''); r = addDays(asIsoDate(r), 1)) out.push({ departure: d, return: r, price: 480 });
      return { status: 200, body: { ...ECHO, calendar: out } };
    }, seen));
    const d = deps();
    const results = [];
    for (const plan of plans) results.push(await fetchCalendarTile(d, plan, q, ctx()));
    expect(seen).toHaveLength(plans.length);
    for (const [i, res] of results.entries()) {
      expect(res.kind).toBe('tile');
      if (res.kind !== 'tile') continue;
      expect(res.prices).toHaveLength(plans[i]?.coveredCells.length ?? -1);
      expect(res.notes.some((n) => n.startsWith('dropped-outside-tile:'))).toBe(true);
    }
  });

  it('has_no_flights: true on an entry → that cell in noFares, no price (synthetic)', async () => {
    const plan = smallPlan();
    const [first] = plan.coveredCells;
    if (first === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: first.departureDate, return: first.returnDate, has_no_flights: true } as never;
    server.use(syntheticHandler(() => ({ status: 200, body }), []));
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    if (res.kind !== 'tile') throw new Error('expected tile');
    expect(res.noFares).toEqual([first]);
    expect(res.prices).toHaveLength(plan.coveredCells.length - 1);
  });

  it('an empty grid under a passing ≤200 assertion → parse, never no_data (synthetic)', async () => {
    server.use(syntheticHandler(() => ({ status: 200, body: { ...ECHO, calendar: [] } }), []));
    const res = await fetchCalendarTile(deps(), smallPlan(), small, ctx());
    expect(res).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'empty-grid', retryable: false } });
  });

  it('a response that states no currency → parse (synthetic)', async () => {
    const plan = smallPlan();
    server.use(syntheticHandler(() => ({ status: 200, body: { calendar: gridFor(plan).calendar } }), []));
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    expect(res).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'no-currency' } });
  });

  it('a gl echo other than the requested point of sale → parse (synthetic)', async () => {
    const plan = smallPlan();
    server.use(syntheticHandler(() => ({ status: 200, body: gridFor(plan, [], { search_parameters: { currency: 'GBP', gl: 'us' } }) }), []));
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    expect(res).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'point-of-sale-mismatch' } });
  });

  it('a malformed envelope → parse (synthetic)', async () => {
    server.use(syntheticHandler(() => ({ status: 200, body: { ...ECHO, calendar: 'nope' } }), []));
    const res = await fetchCalendarTile(deps(), smallPlan(), small, ctx());
    expect(res).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'malformed-calendar' } });
  });

  it('drops and counts entries outside the tile, outside the band, duplicated, unpriced or without a return (synthetic)', async () => {
    const plan = smallPlan();
    const [a, b] = plan.coveredCells;
    if (a === undefined || b === undefined) throw new Error('cells');
    // why: q.cells may carry a cell outside the band only through an engine bug; the band check still applies.
    const offBand = { ...a, returnDate: addDays(a.departureDate, 30) };
    const withOff: TilePlan = { ...plan, coveredCells: [...plan.coveredCells, offBand] };
    const body = gridFor(plan, [
      { departure: '2026-12-01', return: '2026-12-11', price: 1 },             // outside the tile
      { departure: offBand.departureDate, return: offBand.returnDate, price: 1 }, // covered but 30 nights
      { departure: a.departureDate, return: a.returnDate, price: 999 },        // duplicate key
      { departure: b.departureDate },                                           // no return
    ]);
    body.calendar[1] = { departure: b.departureDate, return: b.returnDate } as never; // unpriced, not no-flights
    server.use(syntheticHandler(() => ({ status: 200, body }), []));
    const res = await fetchCalendarTile(deps(), withOff, small, ctx());
    if (res.kind !== 'tile') throw new Error('expected tile');
    // the off-band covered cell is never "seen", so it is also counted as absent
    expect(res.notes).toEqual(['covered-cells-absent:1', 'dropped-duplicate:1', 'dropped-no-return:1', 'dropped-outside-band:1', 'dropped-outside-tile:1', 'unpriced-skipped:1']);
    expect(res.prices.find((p) => cellKeyString(p) === cellKeyString(a))?.amountMinor).toBe(50000); // first entry wins
    expect(res.prices.some((p) => cellKeyString(p) === cellKeyString(b))).toBe(false);
  });

  it('notes covered cells the grid left out, without inventing a status for them (synthetic)', async () => {
    const plan = smallPlan();
    const body = gridFor(plan);
    body.calendar.pop();
    server.use(syntheticHandler(() => ({ status: 200, body }), []));
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    if (res.kind !== 'tile') throw new Error('expected tile');
    expect(res.notes).toContain('covered-cells-absent:1');
    expect(res.prices.length + res.noFares.length).toBe(plan.coveredCells.length - 1);
  });

  it('asserts ≤200 combinations before reserve: no ledger row, no request (spec §5.2)', async () => {
    const d = deps();
    const seen: URLSearchParams[] = [];
    server.use(syntheticHandler(() => ({ status: 200, body: {} }), seen));
    const tooBig: TilePlan = { index: 0, coveredCells: [], request: { kind: 'rectangle', departFrom: asIsoDate('2026-11-01'), departTo: asIsoDate('2026-11-10'), returnFrom: asIsoDate('2026-11-11'), returnTo: asIsoDate('2026-12-01') } };
    await expect(fetchCalendarTile(d, tooBig, small, ctx())).rejects.toThrow(/210 combinations/);
    expect(d.ports.reserves).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('refuses a non-rectangle tile before any request', async () => {
    const d = deps();
    const plan: TilePlan = { index: 0, coveredCells: [], request: { kind: 'length-month', length: 10, month: '2026-11' as never } };
    await expect(fetchCalendarTile(d, plan, small, ctx())).rejects.toThrow(/rectangle/);
    expect(d.ports.reserves).toHaveLength(0);
  });

  it('calendar tiles are cacheable: a repeat within the TTL sends nothing and keeps the original fetchedAt (synthetic)', async () => {
    const plan = smallPlan();
    const seen: URLSearchParams[] = [];
    server.use(syntheticHandler(() => ({ status: 200, body: gridFor(plan) }), seen));
    const d = deps();
    const one = await fetchCalendarTile(d, plan, small, ctx());
    d.ports.clock.advance(60_000);
    const two = await fetchCalendarTile(d, plan, small, ctx());
    expect(seen).toHaveLength(1);
    expect(one.kind === 'tile' && two.kind === 'tile' && two.fetchedAt === one.fetchedAt).toBe(true);
  });

  it('sends travel_class=first_class for the first cabin (synthetic)', async () => {
    const plan = smallPlan();
    const seen: URLSearchParams[] = [];
    server.use(syntheticHandler(() => ({ status: 200, body: gridFor(plan) }), seen));
    await fetchCalendarTile(deps(), plan, { ...small, cabin: 'first' }, ctx());
    expect(seen[0]?.get('travel_class')).toBe('first_class');
    expect(seen[0]?.get('gl')).toBe('gb');
    expect(seen[0]?.has('api_key')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/calendar.test.ts`
Expected: FAIL. `fetchCalendarTile` is not exported from `calendar.js`.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/shapes.ts
import { MINOR_EXPONENT, ProviderError } from '@gmt/core';
import { z } from 'zod';

/** A non-retryable `parse` error with a stable reason. Spec §5.2: malformed → parse. */
export function parseError(reason: string, message: string): ProviderError {
  return new ProviderError({ kind: 'parse', reason, retryable: false, message, providerId: 'searchapi' });
}

const echoSchema = z.object({ currency: z.string().optional(), gl: z.string().optional() });
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `google_flights_calendar` (docs 2026-10-14): `has_no_flights` is per entry and such entries omit `price`. */
export const calendarResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  calendar: z.array(z.object({
    departure: dateString,
    return: dateString.optional(),
    price: z.number().nonnegative().optional(),
    is_lowest_price: z.boolean().optional(),
    has_no_flights: z.boolean().optional(),
  })),
});

const airportSchema = z.object({ id: z.string(), date: z.string(), time: z.string() });
export const segmentSchema = z.object({
  departure_airport: airportSchema,
  arrival_airport: airportSchema,
  airline: z.string().optional(),
  flight_number: z.string(),
  travel_class: z.string().optional(),
  duration: z.number().int().nonnegative().optional(),
  airplane: z.string().optional(),
});
export const optionSchema = z.object({
  flights: z.array(segmentSchema),
  price: z.number().nonnegative().optional(),
  departure_token: z.string().optional(),
  booking_token: z.string().optional(),
});
/** `google_flights` steps 1 and 2. `other_flights` is not on the docs page; read when present. */
export const flightsResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  best_flights: z.array(optionSchema).optional(),
  other_flights: z.array(optionSchema).optional(),
  price_insights: z.object({ price_history: z.array(z.object({ price: z.number().nonnegative(), iso_date: z.string() })).nullish() }).nullish(),
});
export const bookingOptionSchema = z.object({
  book_with: z.string().optional(),
  price: z.number().nonnegative().optional(),
  baggage_prices: z.array(z.string()).optional(),
  booking_request: z.object({ url: z.string(), post_data: z.string() }).optional(),
  booking_phone: z.string().optional(),
  is_split_booking: z.boolean().optional(),
});
/** `google_flights` step 3 (`booking_token`). */
export const bookingResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  booking_options: z.array(bookingOptionSchema).optional(),
});
export type VendorSegment = z.infer<typeof segmentSchema>;
export type VendorOption = z.infer<typeof optionSchema>;
export type VendorBookingOption = z.infer<typeof bookingOptionSchema>;

/**
 * Currency and point of sale from the `search_parameters` echo. Spec §2: "a response that
 * states no currency is a parse error"; spec §5.2: `pointOfSale` comes from the `gl` echo.
 */
export function readEcho(echo: z.infer<typeof echoSchema> | undefined, requestedGl: string): { currency: string; pointOfSale: string } {
  const currency = echo?.currency;
  if (currency === undefined || !/^[A-Za-z]{3}$/.test(currency)) throw parseError('no-currency', 'searchapi response states no currency (search_parameters.currency)');
  const gl = echo?.gl;
  if (gl === undefined) throw parseError('no-point-of-sale', 'searchapi response does not echo gl (search_parameters.gl)');
  if (gl.toLowerCase() !== requestedGl) throw parseError('point-of-sale-mismatch', `searchapi echoed gl=${gl}; requested gl=${requestedGl}`);
  return { currency: currency.toUpperCase(), pointOfSale: gl.toUpperCase() };
}

/** Vendor major units → integer minor units with the ISO 4217 exponent (spec §6.3). No float survives. */
export function toMinor(major: number, currency: string): number {
  const exponent = MINOR_EXPONENT[currency];
  if (exponent === undefined) throw parseError('currency-unknown', `searchapi returned prices in ${currency}, which has no known minor-unit exponent`);
  const minor = Math.round(major * 10 ** exponent);
  if (!Number.isSafeInteger(minor) || minor < 0) throw parseError('bad-price', `searchapi returned an unusable price ${major} ${currency}`);
  return minor;
}

/** Counted reasons for `notes` (spec §5.2: drops are counted in notes). Sorted, `reason:n`. */
export class NoteCounter {
  readonly #counts = new Map<string, number>();
  add(key: string, n = 1): void {
    if (n > 0) this.#counts.set(key, (this.#counts.get(key) ?? 0) + n);
  }
  list(): string[] {
    return [...this.#counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}:${n}`);
  }
}
```


Append to `src/searchapi/calendar.ts`, merging the imports into the file's import block:

```ts
import { type DiscoveryTileResult, type Logger, type ProviderContext, ProviderError, type RawCalendarPrice, type Secret, cellKeyString } from '@gmt/core';
import type { HttpKit } from '../http/httpKit.js';
import { type ParamsByEngine, SEARCHAPI_ENDPOINT_PATH, assertAllowed, authHeaders, calendarParams, toUrl } from './params.js';
import { NoteCounter, calendarResponseSchema, parseError, readEcho, toMinor } from './shapes.js';

/** What `fetchTile` needs; built once by `searchApiProvider`. */
export interface CalendarDeps { http: HttpKit; log: Logger; key: Secret; pointOfSale: string; allowlist: ParamsByEngine; cacheTtlSeconds: number }

/** A tile result plus the `gl` echo (finding F2: the core shape has no point-of-sale field yet). */
export type SearchApiTileResult =
  | (Extract<DiscoveryTileResult, { kind: 'tile' }> & { pointOfSale: string })
  | Extract<DiscoveryTileResult, { kind: 'tile-error' }>;

/**
 * Parses one calendar response for one tile. Spec §5.2: cell keys come from the response;
 * entries outside `coveredCells` or the nights band are dropped and counted; `has_no_flights`
 * → `noFares`; an empty grid → parse; currency and point of sale from the echo.
 */
export function parseCalendarBody(body: unknown, plan: TilePlan, q: DiscoveryQuery, requestedGl: string): { prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[]; pointOfSale: string } {
  const parsed = calendarResponseSchema.safeParse(body);
  if (!parsed.success) throw parseError('malformed-calendar', 'searchapi calendar response did not match the documented shape');
  const echo = readEcho(parsed.data.search_parameters, requestedGl);
  // why: spec §5.2: under a passing ≤200 assertion an empty grid is a vendor fault, never "no data".
  if (parsed.data.calendar.length === 0) throw parseError('empty-grid', 'searchapi calendar returned an empty grid for a request within the 200-combination limit');
  const covered = new Set(plan.coveredCells.map(cellKeyString));
  const seen = new Set<string>();
  const notes = new NoteCounter();
  const prices: RawCalendarPrice[] = [];
  const noFares: CellKey[] = [];
  for (const e of parsed.data.calendar) {
    if (e.return === undefined) {
      notes.add('dropped-no-return');
      continue;
    }
    const cell: CellKey = { origin: q.origin, destination: q.destination, departureDate: e.departure as IsoDate, returnDate: e.return as IsoDate };
    const key = cellKeyString(cell);
    // why: membership first, so only keys that match a planned (valid) cell reach date arithmetic.
    if (!covered.has(key)) {
      notes.add('dropped-outside-tile');
      continue;
    }
    const nights = toEpochDay(cell.returnDate) - toEpochDay(cell.departureDate);
    if (nights < q.minNights || nights > q.maxNights) {
      notes.add('dropped-outside-band');
      continue;
    }
    if (seen.has(key)) {
      notes.add('dropped-duplicate');
      continue;
    }
    seen.add(key);
    if (e.has_no_flights === true) {
      noFares.push(cell);
      continue;
    }
    if (e.price === undefined) {
      notes.add('unpriced-skipped');
      continue;
    }
    prices.push({ ...cell, amountMinor: toMinor(e.price, echo.currency), currency: echo.currency });
  }
  // why: an absent cell is neither priced nor "no fares"; the engine decides its outcome, the note keeps it visible.
  notes.add('covered-cells-absent', covered.size - seen.size);
  return { prices, noFares, notes: notes.list(), pointOfSale: echo.pointOfSale };
}

/**
 * `DiscoveryCapability.fetchTile` for SearchApi. Spec §5.2. The ≤200 assertion and the
 * allowlist check run before `http.request`, so neither failure reaches `budget.reserve`.
 * A `ProviderError` becomes a `tile-error` for exactly this tile's cells; `BudgetExceeded`
 * and `AbortedError` propagate to the engine.
 */
export async function fetchCalendarTile(d: CalendarDeps, plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<SearchApiTileResult> {
  const req = plan.request;
  if (req.kind !== 'rectangle') throw new TypeError(`searchapi plans rectangle tiles only; got ${req.kind}`);
  assertWithinLimit(req);
  const params = calendarParams(q, req, d.pointOfSale);
  assertAllowed(d.allowlist, 'google_flights_calendar', params);
  try {
    const res = await d.http.request({
      providerId: 'searchapi', executionId: ctx.executionId, tileIndex: plan.index, endpointPath: SEARCHAPI_ENDPOINT_PATH,
      method: 'GET', url: toUrl(params), headers: authHeaders(d.key), cache: { ttlSeconds: d.cacheTtlSeconds },
      signal: ctx.signal, recordFixtures: ctx.recordFixtures,
    });
    const parsed = parseCalendarBody(res.body, plan, q, d.pointOfSale.toLowerCase());
    d.log.debug({ providerId: 'searchapi', tileIndex: plan.index, prices: parsed.prices.length, noFares: parsed.noFares.length, notes: parsed.notes }, 'searchapi calendar tile parsed');
    return { kind: 'tile', index: plan.index, coveredCells: plan.coveredCells, fetchedAt: res.fetchedAt, ...parsed };
  } catch (err) {
    if (err instanceof ProviderError) return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error: err };
    throw err;
  }
}
```

`covered-cells-absent` counts covered cells that no in-band entry mentioned (`seen` is a subset of `covered`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/calendar.test.ts`
Expected: PASS, 14 tests. The `afterEach` allowlist and miss assertions hold for every test.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi calendar tiles: response keying, empty grid → parse, has_no_flights → noFares"
```

### Task 5.6: Itinerary chain, steps 1 and 2, with outcome rules and route history

**Files:** create `src/searchapi/itinerary.ts` and `test/searchapi/itinerary.test.ts`.

**Interfaces:** consumes `ItineraryQuery`, `ItinerarySearchResult`, `RawOffer`, `RawSegment`, `ProviderError`, `PLAN_PRESETS`, `HttpKit`, the shapes and params from Tasks 5.3–5.4. Produces `searchItinerary`, `estimateItinerary`, `assertBookingLinks`, `toRawSegment`, `RouteHistoryPoint`, `SearchApiItineraryResult`, `ItineraryDeps`, `WORST_SECONDS_PER_CALL`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/itinerary.test.ts
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ItineraryDeps, searchItinerary, toRawSegment } from '../../src/searchapi/itinerary.js';
import { SEARCHAPI_PARAMS_ALLOWLIST, paramViolations } from '../../src/searchapi/params.js';
import { ctx, testPorts } from './support/ports.js';
import { type ReplayLog, chainRecording, loadRecorded, need, replayHandler } from './support/recorded.js';
import { CELL_QUERY, IN_1, IN_2, OUT_A, OUT_B, POST, bookingBody, flightsBody, option, seg, syntheticHandler } from './support/synthetic.js';
import { asIata, asIsoDate } from '@gmt/core';

const recorded = loadRecorded();
const book: ReplayLog = { requests: [], misses: [] };
const server = setupServer(replayHandler(recorded, book));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  for (const r of book.requests) expect(paramViolations(SEARCHAPI_PARAMS_ALLOWLIST, 'google_flights', r.params)).toEqual([]);
  expect(book.misses).toEqual([]);
  book.requests.length = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

const deps = (p = testPorts()): ItineraryDeps & { ports: ReturnType<typeof testPorts> } => ({ http: p.http, log: p.log, key: p.key, pointOfSale: 'GB', allowlist: SEARCHAPI_PARAMS_ALLOWLIST, ports: p });
const A = option(OUT_A, 600, { departure_token: 'dA' });
const B = option(OUT_B, 640, { departure_token: 'dB' });
const agent = (price: number) => ({ book_with: 'Synthetic Travel Agent', price, booking_request: POST });

/** Routes synthetic replies by token: step 1 has none, step 2 a departure_token, step 3 a booking_token. */
function chain(step1: unknown, step2: Record<string, { status: number; body: unknown }>, step3: Record<string, { status: number; body: unknown }> = {}) {
  const seen: URLSearchParams[] = [];
  server.use(syntheticHandler((p) => {
    const dep = p.get('departure_token');
    const bk = p.get('booking_token');
    if (bk !== null) return step3[bk] ?? { status: 404, body: { error: 'unknown booking token' } };
    if (dep !== null) return step2[dep] ?? { status: 404, body: { error: 'unknown departure token' } };
    return { status: 200, body: step1 };
  }, seen));
  return seen;
}
const ok = (body: unknown) => ({ status: 200, body });

describe('itinerary chain, recorded (spec §5.4, §9 item 2)', () => {
  it('replays the recorded 1 → 2 → 3 chain into priced offers with GBP and a Google POST booking', async () => {
    const { step1, step2s, step3s } = chainRecording(recorded);
    const p = step1.request.params;
    const q = { ...CELL_QUERY, origin: asIata(need(p, 'departure_id')), destination: asIata(need(p, 'arrival_id')), departureDate: asIsoDate(need(p, 'outbound_date')), returnDate: asIsoDate(need(p, 'return_date')), expandTop: step2s.length };
    const res = await searchItinerary(deps(), q, ctx());
    expect(book.requests).toHaveLength(1 + step2s.length + step3s.length);
    expect(res.coverage).toBe('priced');
    expect(res.offers.length).toBeGreaterThan(0);
    for (const o of res.offers) {
      expect(o.currency).toBe('GBP');
      expect(o.outbound.length).toBeGreaterThan(0);
      expect(o.inbound.length).toBeGreaterThan(0);
      expect(Number.isInteger(o.amountMinor)).toBe(true);
    }
    expect(res.offers.some((o) => o.booking.kind === 'post' && new URL(o.booking.url).hostname.endsWith('google.com'))).toBe(true);
    expect(res.routeHistory.length).toBeGreaterThan(0); // spec §2 bonus
    expect(res.pointOfSale).toBe('GB');
  });
});

describe('itinerary outcome rules (spec §5.4), synthetic shapes', () => {
  it('step 1 zero options → coverage empty, one call (synthetic)', async () => {
    const seen = chain(flightsBody([]), {});
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'empty', offers: [], partial: false, failedExpansions: 0 });
    expect(seen).toHaveLength(1);
  });

  it('options, but every step 2 fails → upstream no-return-legs, non-retryable (synthetic)', async () => {
    const seen = chain(flightsBody([A, B]), {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({ kind: 'upstream', reason: 'no-return-legs', retryable: false });
    expect(seen).toHaveLength(3);
  });

  it('options, but every step 2 returns no legs → upstream no-return-legs (synthetic)', async () => {
    chain(flightsBody([A, B]), { dA: ok(flightsBody([])), dB: ok(flightsBody([])) });
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({ kind: 'upstream', reason: 'no-return-legs' });
  });

  it('some step 2 succeed → priced, partial, failedExpansions counted (synthetic)', async () => {
    chain(flightsBody([A, B]), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) }, { b1: ok(bookingBody([agent(573)])) });
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 1 });
    expect(res.notes).toContain('expansion-failed:1');
  });

  it('a step 2 with zero legs contributes nothing and is not a failure (synthetic)', async () => {
    chain(flightsBody([A, B]), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])), dB: ok(flightsBody([])) }, { b1: ok(bookingBody([agent(573)])) });
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: false, failedExpansions: 0 });
    expect(res.notes).toContain('no-return-legs-for-outbound:1');
    expect(res.offers.every((o) => o.outbound[0]?.flightNumber === '100')).toBe(true);
  });

  it('unpriced options are skipped and counted at step 1 and step 2, never persisted (synthetic)', async () => {
    const unpriced = option(OUT_B, undefined, { departure_token: 'dU' });
    const seen = chain(flightsBody([unpriced, A]), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' }), option(IN_2, undefined, { booking_token: 'b2' })])) }, { b1: ok(bookingBody([agent(573)])) });
    const res = await searchItinerary(deps(), { ...CELL_QUERY, expandTop: 2 }, ctx());
    expect(res.notes).toEqual(expect.arrayContaining(['unpriced-skipped:step1:1', 'unpriced-skipped:step2:1']));
    expect(seen.some((p) => p.get('departure_token') === 'dU')).toBe(false);
    expect(seen.some((p) => p.get('booking_token') === 'b2')).toBe(false);
  });

  it('all step-1 options unpriced → upstream no-priced-options, nothing expanded (synthetic)', async () => {
    const seen = chain(flightsBody([option(OUT_A, undefined, { departure_token: 'dA' })]), {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({ kind: 'upstream', reason: 'no-priced-options', retryable: false });
    expect(seen).toHaveLength(1);
  });

  it('expands the expandTop cheapest priced outbounds, cheapest first (synthetic)', async () => {
    const C = option(OUT_B, 590, { departure_token: 'dC' });
    const seen = chain(flightsBody([B, A, C]), { dC: ok(flightsBody([option(IN_1, 590, { booking_token: 'bC' })])) }, { bC: ok(bookingBody([agent(560)])) });
    await searchItinerary(deps(), { ...CELL_QUERY, expandTop: 1 }, ctx());
    expect(seen.filter((p) => p.has('departure_token')).map((p) => p.get('departure_token'))).toEqual(['dC']);
  });

  it('auth at step 2 propagates instead of counting as a failed expansion (spec §8.1 error table) (synthetic)', async () => {
    const seen: URLSearchParams[] = [];
    server.use(syntheticHandler((p) => (p.has('departure_token') ? { status: 401, body: { error: 'Invalid API key.' } } : ok(flightsBody([A]))), seen));
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({ kind: 'auth' });
  });

  it('a step-1 response that states no currency → parse (synthetic)', async () => {
    chain({ best_flights: [A] }, {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({ kind: 'parse', reason: 'no-currency' });
  });

  it('fetchedAt of the chain is the oldest step (spec §2) (synthetic)', async () => {
    const d = deps();
    server.use(syntheticHandler((p) => {
      d.ports.clock.advance(60_000); // each step answers one minute after the previous
      if (p.has('booking_token')) return ok(bookingBody([agent(573)]));
      if (p.has('departure_token')) return ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]));
      return ok(flightsBody([A]));
    }, []));
    const res = await searchItinerary(d, { ...CELL_QUERY, expandTop: 1 }, ctx());
    expect(res.fetchedAt).toBe('2026-10-14T12:01:00.000Z');
  });

  it('google_flights responses are never cached: a repeat search sends every call again (spec §5.3) (synthetic)', async () => {
    const seen = chain(flightsBody([A]), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) }, { b1: ok(bookingBody([agent(573)])) });
    const d = deps();
    await searchItinerary(d, { ...CELL_QUERY, expandTop: 1 }, ctx());
    await searchItinerary(d, { ...CELL_QUERY, expandTop: 1 }, ctx());
    expect(seen).toHaveLength(6);
  });

  it('captures price_insights.price_history as routeHistory in minor units (synthetic)', async () => {
    const history = { price_insights: { price_history: [{ price: 646, iso_date: '2026-09-19T04:00:00Z' }, { price: 612, iso_date: '2026-09-20T04:00:00Z' }, { price: 600, iso_date: 'garbage' }] } };
    chain(flightsBody([A], history), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) }, { b1: ok(bookingBody([agent(573)])) });
    const res = await searchItinerary(deps(), { ...CELL_QUERY, expandTop: 1 }, ctx());
    expect(res.routeHistory).toEqual([
      { date: '2026-09-19', lowestPriceMinor: 64600, currency: 'GBP' },
      { date: '2026-09-20', lowestPriceMinor: 61200, currency: 'GBP' },
    ]);
    expect(res.notes).toContain('route-history-bad-date:1');
  });

  it('a null price_insights yields an empty routeHistory, not an error (synthetic)', async () => {
    chain(flightsBody([A], { price_insights: null }), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) }, { b1: ok(bookingBody([agent(573)])) });
    const res = await searchItinerary(deps(), { ...CELL_QUERY, expandTop: 1 }, ctx());
    expect(res.routeHistory).toEqual([]);
  });

  it('bookingLinks false throws before any request (spec §5.4: forced true) (synthetic)', async () => {
    const seen = chain(flightsBody([A]), {});
    const d = deps();
    await expect(searchItinerary(d, { ...CELL_QUERY, bookingLinks: false }, ctx())).rejects.toThrow(/bookingLinks/);
    expect(seen).toHaveLength(0);
    expect(d.ports.reserves).toHaveLength(0);
  });
});

describe('toRawSegment (raw only, spec §5.2)', () => {
  it('splits the carrier from the flight number, keeps vendor local times, states cabin only when given', () => {
    const s = toRawSegment(seg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', 'Synthetic Air One', 'Premium economy'));
    expect(s).toEqual({ marketingCarrier: 'X1', flightNumber: '100', from: 'LHR', to: 'JFK', depart: '2026-11-02T09:05', arrive: '2026-11-02T23:00', timeKind: 'local', cabin: 'premium_economy', durationMinutes: 420, aircraft: 'Synthetic 787' });
  });
  it('an unrecognised travel_class leaves cabin unstated; an unsplittable flight number is passed whole for core to reject', () => {
    const s = toRawSegment({ ...seg('LHR', 'JFK', '2026-11-02', '09:05', 'Synthetic 100', 'Synthetic Air One', 'Mystery') });
    expect(s.cabin).toBeUndefined();
    expect(s.marketingCarrier).toBe('Synthetic 100');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/itinerary.test.ts`
Expected: FAIL. `../../src/searchapi/itinerary.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/itinerary.ts
import {
  type BaggageSnapshot, type Cabin, type CostEstimate, type IsoDate, type IsoDateTime, type ItineraryQuery,
  type ItinerarySearchResult, type Logger, PLAN_PRESETS, type PlanId, type ProviderContext, ProviderError,
  type RawOffer, type RawSegment, type Iata, type Secret,
} from '@gmt/core';
import type { HttpKit, HttpKitResponse } from '../http/httpKit.js';
import { type ParamsByEngine, SEARCHAPI_ENDPOINT_PATH, assertAllowed, authHeaders, flightsParams, toUrl } from './params.js';
import {
  NoteCounter, type VendorBookingOption, type VendorOption, type VendorSegment, bookingResponseSchema,
  flightsResponseSchema, parseError, readEcho, toMinor,
} from './shapes.js';

/** One day of Google's route-level lowest price (spec §2 bonus, §7 `route_price_history`). */
export interface RouteHistoryPoint { date: IsoDate; lowestPriceMinor: number; currency: string }
/** The core result plus route history and the `gl` echo (findings F1, F2). Assignable to `ItinerarySearchResult`. */
export type SearchApiItineraryResult = ItinerarySearchResult & { routeHistory: RouteHistoryPoint[]; pointOfSale: string };
export interface ItineraryDeps { http: HttpKit; log: Logger; key: Secret; pointOfSale: string; allowlist: ParamsByEngine }

/** Slowest calendar call measured on 2026-10-14 (spec §2: 9–29 s); itinerary latency was not measured separately. */
export const WORST_SECONDS_PER_CALL = 29;

/** Spec §5.4: `bookingLinks` is forced true for SearchApi, because step 3 can show a seller below the airline fare. */
export function assertBookingLinks(q: ItineraryQuery): void {
  if (q.bookingLinks !== true) throw new TypeError('searchapi itinerary queries require bookingLinks: true (spec §5.4)');
}

/** `VerificationCapability.estimate`: calls = 1 + expandTop × 2 (spec §5.4); cost from the plan preset. */
export function estimateItinerary(q: ItineraryQuery, plan: PlanId): CostEstimate {
  assertBookingLinks(q);
  const calls = 1 + q.expandTop * 2;
  return {
    calls,
    costMicroGbp: calls * PLAN_PRESETS[plan].costPerCallMicroGbp,
    seconds: calls * WORST_SECONDS_PER_CALL,
    notes: [
      `1 outbound search + ${q.expandTop} × (return search + booking options)`,
      `${WORST_SECONDS_PER_CALL} s per call, the slowest calendar call measured on 2026-10-14`,
    ],
  };
}

const CABIN_BY_TRAVEL_CLASS: Readonly<Record<string, Cabin>> = { economy: 'economy', 'premium economy': 'premium_economy', business: 'business', first: 'first' };

/**
 * A vendor segment as a `RawSegment`. Raw only (spec §5.2): local vendor times as given, the
 * cabin only when the vendor states a recognised class, and the flight number split at the
 * carrier designator when it matches `^[A-Z0-9]{2}\s*\d{1,4}[A-Z]?$`. Otherwise the whole
 * string is passed through and core's carrier canonicalisation rejects the offer. Never guessed.
 */
export function toRawSegment(s: VendorSegment): RawSegment {
  const m = /^([A-Z0-9]{2})\s*(\d{1,4}[A-Z]?)$/.exec(s.flight_number.trim());
  const seg: RawSegment = {
    marketingCarrier: m?.[1] ?? s.flight_number,
    flightNumber: m?.[2] ?? s.flight_number,
    from: s.departure_airport.id as Iata,
    to: s.arrival_airport.id as Iata,
    depart: `${s.departure_airport.date}T${s.departure_airport.time}`,
    arrive: `${s.arrival_airport.date}T${s.arrival_airport.time}`,
    timeKind: 'local',
  };
  const cabin = s.travel_class === undefined ? undefined : CABIN_BY_TRAVEL_CLASS[s.travel_class.toLowerCase()];
  if (cabin !== undefined) seg.cabin = cabin;
  if (s.duration !== undefined) seg.durationMinutes = s.duration;
  if (s.airplane !== undefined) seg.aircraft = s.airplane;
  return seg;
}

type Priced<T> = T & { price: number };
const isPriced = <T extends { price?: number | undefined }>(o: T): o is Priced<T> => typeof o.price === 'number';

/** Spec §8.1: auth, quota, limiter-timeout, budget and abort stop the cell; only call-local faults are a failed expansion. */
function isExpansionFailure(err: unknown): err is ProviderError {
  return err instanceof ProviderError && (err.kind === 'upstream' || err.kind === 'network' || err.kind === 'rate-limit' || err.kind === 'parse');
}

async function send(d: ItineraryDeps, params: Record<string, string>, ctx: ProviderContext): Promise<HttpKitResponse> {
  assertAllowed(d.allowlist, 'google_flights', params);
  // why: every google_flights response carries departure or booking tokens, and spec §5.3 says
  // token-bearing SearchApi step responses are never cached.
  return d.http.request({
    providerId: 'searchapi', executionId: ctx.executionId, tileIndex: null, endpointPath: SEARCHAPI_ENDPOINT_PATH,
    method: 'GET', url: toUrl(params), headers: authHeaders(d.key), cache: 'never', signal: ctx.signal, recordFixtures: ctx.recordFixtures,
  });
}

function parseFlights(body: unknown, gl: string) {
  const r = flightsResponseSchema.safeParse(body);
  if (!r.success) throw parseError('malformed-flights', 'searchapi google_flights response did not match the documented shape');
  const echo = readEcho(r.data.search_parameters, gl);
  return { ...echo, options: [...(r.data.best_flights ?? []), ...(r.data.other_flights ?? [])], priceHistory: r.data.price_insights?.price_history ?? [] };
}

function parseBooking(body: unknown, gl: string) {
  const r = bookingResponseSchema.safeParse(body);
  if (!r.success) throw parseError('malformed-booking-options', 'searchapi booking options response did not match the documented shape');
  return { ...readEcho(r.data.search_parameters, gl), options: r.data.booking_options ?? [] };
}

function toRouteHistory(points: ReadonlyArray<{ price: number; iso_date: string }>, currency: string, notes: NoteCounter): RouteHistoryPoint[] {
  const out: RouteHistoryPoint[] = [];
  for (const p of points) {
    // why: `iso_date` is an instant (e.g. 2024-09-19T04:00:00Z); its UTC calendar date is the series day.
    const date = p.iso_date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      notes.add('route-history-bad-date');
      continue;
    }
    out.push({ date: date as IsoDate, lowestPriceMinor: toMinor(p.price, currency), currency });
  }
  return out;
}

function makeOffer(q: ItineraryQuery, out: readonly VendorSegment[], inb: readonly VendorSegment[], seller: string, amountMinor: number, currency: string, booking: RawOffer['booking'], baggage?: BaggageSnapshot): RawOffer {
  return {
    outbound: out.map(toRawSegment), inbound: inb.map(toRawSegment), seller, requestedCabin: q.cabin,
    amountMinor, currency, booking, ...(baggage === undefined ? {} : { baggage }),
  };
}

/** The airline whose own fare step 2 shows (spec §5.4): the first outbound segment's airline name. */
function airlineOf(out: readonly VendorSegment[]): string {
  const first = out[0];
  return first?.airline ?? first?.flight_number ?? 'airline';
}

/** Lower-cased airline names on the itinerary, to test whether a step-3 seller "names the airline". */
function airlineNames(out: readonly VendorSegment[], inb: readonly VendorSegment[]): Set<string> {
  return new Set([...out, ...inb].flatMap((s) => (s.airline === undefined ? [] : [s.airline.trim().toLowerCase()])));
}

/** Step-3 booking options as offers (spec §5.4). Split bookings, unpriced and seller-less options are counted, not persisted. */
export function bookingOffers(q: ItineraryQuery, out: readonly VendorSegment[], inb: readonly VendorSegment[], options: readonly VendorBookingOption[], currency: string, notes: NoteCounter): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const b of options) {
    // why: a split booking has two prices and two forms; RawOffer holds one booking, and summing would be our number, not the vendor's.
    if (b.is_split_booking === true) {
      notes.add('split-booking-skipped');
      continue;
    }
    if (b.price === undefined) {
      notes.add('unpriced-skipped:step3');
      continue;
    }
    if (b.book_with === undefined) {
      notes.add('no-seller-skipped:step3');
      continue;
    }
    let booking: RawOffer['booking'] = { kind: 'none' };
    // why: booking_request is a POST to Google, stored and rendered as a form, never fetched server-side (spec §5.4).
    if (b.booking_request !== undefined) booking = { kind: 'post', url: b.booking_request.url, postData: b.booking_request.post_data };
    else if (b.booking_phone !== undefined) notes.add('phone-only-booking');
    const baggage = b.baggage_prices !== undefined && b.baggage_prices.length > 0 ? { notes: [...b.baggage_prices] } : undefined;
    offers.push(makeOffer(q, out, inb, b.book_with, toMinor(b.price, currency), currency, booking, baggage));
  }
  return offers;
}

/**
 * `VerificationCapability.search` for SearchApi: the spec §5.4 chain.
 *
 * Step 1 lists outbounds. Step 2 runs for the `expandTop` cheapest priced outbounds and lists
 * return options; every priced one is an offer. Step 3 runs for the cheapest priced return
 * option per outbound; every usable booking option is an offer, and that option's step-2
 * price is kept as the airline-direct offer only when no step-3 seller names the airline.
 * Outcome rules (all tested): step 1 empty → `empty`; options but no step 2 yields legs →
 * throw `upstream`/`no-return-legs`; some step 2 fail → `partial` with `failedExpansions`.
 * `fetchedAt` is the oldest step's (spec §2).
 */
export async function searchItinerary(d: ItineraryDeps, q: ItineraryQuery, ctx: ProviderContext): Promise<SearchApiItineraryResult> {
  assertBookingLinks(q);
  const gl = d.pointOfSale.toLowerCase();
  const notes = new NoteCounter();
  const base = flightsParams(q, d.pointOfSale);

  const s1 = await send(d, base, ctx);
  const r1 = parseFlights(s1.body, gl);
  const fetched: IsoDateTime[] = [s1.fetchedAt];
  const routeHistory = toRouteHistory(r1.priceHistory, r1.currency, notes);
  if (r1.options.length === 0) {
    return { offers: [], coverage: 'empty', fetchedAt: s1.fetchedAt, partial: false, failedExpansions: 0, notes: notes.list(), routeHistory, pointOfSale: r1.pointOfSale };
  }

  const usable1: Array<Priced<VendorOption>> = [];
  for (const o of r1.options) {
    if (!isPriced(o)) notes.add('unpriced-skipped:step1');
    else if (o.departure_token === undefined) notes.add('no-departure-token:step1');
    else if (o.flights.length === 0) notes.add('no-segments:step1');
    else usable1.push(o);
  }
  if (usable1.length === 0) {
    // why: options exist, so "empty" would claim no fares; spec §5.4 skips unpriced options, so nothing can be expanded.
    throw new ProviderError({ kind: 'upstream', reason: 'no-priced-options', retryable: false, providerId: 'searchapi', message: `searchapi step 1 returned ${r1.options.length} options and none was priced and expandable` });
  }
  const expand = [...usable1].sort((a, b) => a.price - b.price).slice(0, q.expandTop); // stable: vendor order breaks ties

  const offers: RawOffer[] = [];
  let failed = 0;
  let withLegs = 0;
  let partial = false;
  for (const out of expand) {
    let r2: ReturnType<typeof parseFlights>;
    try {
      const s2 = await send(d, { ...base, departure_token: out.departure_token ?? '' }, ctx);
      fetched.push(s2.fetchedAt);
      r2 = parseFlights(s2.body, gl);
    } catch (err) {
      if (!isExpansionFailure(err)) throw err;
      failed += 1;
      notes.add('expansion-failed');
      continue;
    }
    const returns: Array<Priced<VendorOption>> = [];
    for (const o of r2.options) {
      if (!isPriced(o)) notes.add('unpriced-skipped:step2');
      else if (o.flights.length === 0) notes.add('no-segments:step2');
      else returns.push(o);
    }
    if (returns.length === 0) {
      notes.add('no-return-legs-for-outbound'); // spec §5.4: contributes nothing, not a failure
      continue;
    }
    withLegs += 1;
    const cheapest = returns.reduce((m, o) => (o.price < m.price ? o : m));
    const airline = airlineOf(out.flights);
    for (const o of returns) {
      if (o !== cheapest) offers.push(makeOffer(q, out.flights, o.flights, airline, toMinor(o.price, r2.currency), r2.currency, { kind: 'none' }));
    }
    const step2Offer = makeOffer(q, out.flights, cheapest.flights, airline, toMinor(cheapest.price, r2.currency), r2.currency, { kind: 'none' });
    if (cheapest.booking_token === undefined) {
      notes.add('no-booking-token:step2');
      offers.push(step2Offer);
      continue;
    }
    let step3: RawOffer[];
    try {
      const s3 = await send(d, { ...base, booking_token: cheapest.booking_token }, ctx);
      fetched.push(s3.fetchedAt);
      const r3 = parseBooking(s3.body, gl);
      step3 = bookingOffers(q, out.flights, cheapest.flights, r3.options, r3.currency, notes);
    } catch (err) {
      if (!isExpansionFailure(err)) throw err;
      partial = true;
      notes.add('booking-options-failed');
      offers.push(step2Offer);
      continue;
    }
    offers.push(...step3);
    const names = airlineNames(out.flights, cheapest.flights);
    // why: spec §5.4 price-source rule: the step-2 price is the airline's own fare; keep it only when step 3 does not already list the airline.
    if (!step3.some((o) => names.has(o.seller.trim().toLowerCase()))) offers.push(step2Offer);
  }

  if (withLegs === 0) {
    throw new ProviderError({ kind: 'upstream', reason: 'no-return-legs', retryable: false, providerId: 'searchapi', message: `searchapi: ${expand.length} outbound expansions produced no return legs (${failed} failed)` });
  }
  const fetchedAt = fetched.reduce((a, b) => (b < a ? b : a));
  d.log.debug({ providerId: 'searchapi', offers: offers.length, failedExpansions: failed, notes: notes.list() }, 'searchapi itinerary chain parsed');
  return { offers, coverage: 'priced', fetchedAt, partial: partial || failed > 0, failedExpansions: failed, notes: notes.list(), routeHistory, pointOfSale: r1.pointOfSale };
}
```

`out.departure_token ?? ''` never takes the fallback, because `usable1` only holds options with a token. The `?? ''` satisfies the type without a non-null assertion. An empty token would also fail the allowlist pattern `^\S{1,4096}$` before any request.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/itinerary.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi itinerary chain with spec §5.4 outcome rules and route history"
```

### Task 5.7: Step 3 booking options and the price-source rule

**Files:** create `test/searchapi/booking.test.ts`. The code is in Task 5.6's `itinerary.ts` (`bookingOffers` and the step-3 block); this task pins its behaviour.

**Interfaces:** consumes `searchItinerary`, `bookingOffers`. Produces nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/booking.test.ts
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { searchItinerary } from '../../src/searchapi/itinerary.js';
import { SEARCHAPI_PARAMS_ALLOWLIST } from '../../src/searchapi/params.js';
import { ctx, testPorts } from './support/ports.js';
import { CELL_QUERY, IN_1, IN_2, IN_3, OUT_A, POST, bookingBody, flightsBody, option, syntheticHandler } from './support/synthetic.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const deps = () => { const p = testPorts(); return { http: p.http, log: p.log, key: p.key, pointOfSale: 'GB', allowlist: SEARCHAPI_PARAMS_ALLOWLIST }; };
const q = { ...CELL_QUERY, expandTop: 1 };
const A = option(OUT_A, 600, { departure_token: 'dA' });

function run(step2: unknown, step3: Record<string, { status: number; body: unknown }>) {
  const seen: URLSearchParams[] = [];
  server.use(syntheticHandler((p) => {
    const bk = p.get('booking_token');
    if (bk !== null) return step3[bk] ?? { status: 404, body: { error: 'unknown booking token' } };
    if (p.has('departure_token')) return { status: 200, body: step2 };
    return { status: 200, body: flightsBody([A]) };
  }, seen));
  return seen;
}

describe('step 3 booking options (spec §5.4), synthetic shapes', () => {
  it('every priced step-2 return option is its own offer; step 3 runs only for the cheapest (synthetic)', async () => {
    const seen = run(
      flightsBody([option(IN_1, 650, { booking_token: 'b1' }), option(IN_2, 600, { booking_token: 'b2' }), option(IN_3, 700, { booking_token: 'b3' })]),
      { b2: { status: 200, body: bookingBody([{ book_with: 'Synthetic Travel Agent', price: 573, booking_request: POST }]) } },
    );
    const res = await searchItinerary(deps(), q, ctx());
    expect(seen.filter((p) => p.has('booking_token')).map((p) => p.get('booking_token'))).toEqual(['b2']);
    expect(res.offers.map((o) => o.amountMinor).sort((a, b) => a - b)).toEqual([57300, 60000, 65000, 70000]);
    expect(res.offers.filter((o) => o.seller === 'Synthetic Air One').map((o) => o.amountMinor).sort()).toEqual([60000, 65000, 70000]);
  });

  it('a step-3 option naming the airline replaces the step-2 airline offer (price-source rule) (synthetic)', async () => {
    run(flightsBody([option(IN_1, 603, { booking_token: 'b1' })]), {
      b1: { status: 200, body: bookingBody([{ book_with: 'Synthetic Air One', price: 603, booking_request: POST }, { book_with: 'Synthetic Travel Agent', price: 573, booking_request: POST }]) },
    });
    const res = await searchItinerary(deps(), q, ctx());
    expect(res.offers.map((o) => [o.seller, o.amountMinor, o.booking.kind])).toEqual([
      ['Synthetic Air One', 60300, 'post'],
      ['Synthetic Travel Agent', 57300, 'post'],
    ]);
  });

  it('booking_request is stored as a POST with url and postData (synthetic)', async () => {
    run(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]), { b1: { status: 200, body: bookingBody([{ book_with: 'Synthetic Travel Agent', price: 573, booking_request: POST }]) } });
    const res = await searchItinerary(deps(), q, ctx());
    expect(res.offers.find((o) => o.seller === 'Synthetic Travel Agent')?.booking).toEqual({ kind: 'post', url: 'https://www.google.com/travel/clk/f', postData: 'u=synthetic' });
  });

  it('a phone-only option is an offer with booking none, counted in notes (synthetic)', async () => {
    run(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]), { b1: { status: 200, body: bookingBody([{ book_with: 'Synthetic Phone Desk', price: 590, booking_phone: '+44 0000 000000' }]) } });
    const res = await searchItinerary(deps(), q, ctx());
    expect(res.offers.find((o) => o.seller === 'Synthetic Phone Desk')?.booking).toEqual({ kind: 'none' });
    expect(res.notes).toContain('phone-only-booking:1');
  });

  it('baggage_prices become baggage notes, never parsed into counts (raw only) (synthetic)', async () => {
    run(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]), { b1: { status: 200, body: bookingBody([{ book_with: 'Synthetic Travel Agent', price: 573, booking_request: POST, baggage_prices: ['1 free carry-on', '1st checked bag: 60'] }]) } });
    const res = await searchItinerary(deps(), q, ctx());
    expect(res.offers.find((o) => o.seller === 'Synthetic Travel Agent')?.baggage).toEqual({ notes: ['1 free carry-on', '1st checked bag: 60'] });
  });

  it('split bookings, unpriced and seller-less step-3 options are skipped and counted (synthetic)', async () => {
    run(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]), {
      b1: { status: 200, body: bookingBody([{ is_split_booking: true }, { book_with: 'Synthetic Travel Agent' }, { price: 500, booking_request: POST }]) },
    });
    const res = await searchItinerary(deps(), q, ctx());
    expect(res.notes).toEqual(expect.arrayContaining(['split-booking-skipped:1', 'unpriced-skipped:step3:1', 'no-seller-skipped:step3:1']));
    expect(res.offers.map((o) => o.seller)).toEqual(['Synthetic Air One']); // the step-2 airline offer survives
  });

  it('a failed step 3 keeps the step-2 offer and marks the result partial, not a failed expansion (synthetic)', async () => {
    run(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]), { b1: { status: 404, body: { error: 'gone' } } });
    const res = await searchItinerary(deps(), q, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 0 });
    expect(res.offers.map((o) => o.amountMinor)).toEqual([60000]);
    expect(res.notes).toContain('booking-options-failed:1');
  });

  it('calls per cell are 1 + expandTop × 2 when every step succeeds (spec §5.4) (synthetic)', async () => {
    const seen: URLSearchParams[] = [];
    const B = option(OUT_A, 620, { departure_token: 'dB' });
    server.use(syntheticHandler((p) => {
      if (p.has('booking_token')) return { status: 200, body: bookingBody([{ book_with: 'Synthetic Travel Agent', price: 573, booking_request: POST }]) };
      if (p.has('departure_token')) return { status: 200, body: flightsBody([option(IN_1, 600, { booking_token: `b-${p.get('departure_token')}` })]) };
      return { status: 200, body: flightsBody([A, B]) };
    }, seen));
    await searchItinerary(deps(), { ...CELL_QUERY, expandTop: 2 }, ctx());
    expect(seen).toHaveLength(1 + 2 * 2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Before Task 5.6's step-3 block is in place, run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/booking.test.ts`
Expected: FAIL on the step-3 assertions. If Task 5.6 already landed in full, temporarily replace the step-3 `try` block with `offers.push(step2Offer); continue;` to see 6 of 8 tests fail, then restore it.

- [ ] **Step 3: Implement.** The code is in Task 5.6 (`bookingOffers` and the step-3 block of `searchItinerary`); restore it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/booking.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi step-3 booking options and the price-source rule (spec §5.4)"
```

### Task 5.8: Provider assembly, supplied fields from recordings, estimate, healthcheck, barrel

**Files:** create `src/searchapi/provider.ts`, `test/searchapi/support/provider.ts`, `test/searchapi/provider.test.ts`. Modify `src/index.ts`.

**Interfaces:** consumes everything above, plus `findBannedWords` and `SuppliedField`. Produces `searchApiProvider`, `SearchApiProviderOptions`, `SEARCHAPI_DISPLAY_NAME`, `SEARCHAPI_DISCOVERY_INFO`, `SEARCHAPI_VERIFICATION_INFO`, `SEARCHAPI_SUPPLIED_FIELDS`, `SEARCHAPI_CABINS`, and the barrel exports of §5.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/provider.test.ts
import { type SuppliedField, asIata, asIsoDate, findBannedWords } from '@gmt/core';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as pkg from '../../src/index.js';
import { SEARCHAPI_DISCOVERY_INFO, SEARCHAPI_DISPLAY_NAME, SEARCHAPI_VERIFICATION_INFO } from '../../src/searchapi/provider.js';
import { bookingResponseSchema, flightsResponseSchema } from '../../src/searchapi/shapes.js';
import { ctx, testPorts } from './support/ports.js';
import { capabilities, makeProvider } from './support/provider.js';
import { type Recorded, byEngine, loadRecorded } from './support/recorded.js';
import { CELL_QUERY, syntheticHandler } from './support/synthetic.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Which SuppliedFields the recorded responses actually evidence (spec §5.2: checked against recorded fixtures only). */
function evidence(rs: readonly Recorded[]): SuppliedField[] {
  const bodies = byEngine(rs, 'google_flights').filter((r) => r.status === 200).map((r) => r.body);
  const options = bodies.flatMap((b) => { const p = flightsResponseSchema.safeParse(b); return p.success ? [...(p.data.best_flights ?? []), ...(p.data.other_flights ?? [])] : []; });
  const segs = options.flatMap((o) => o.flights);
  const bookings = bodies.flatMap((b) => { const p = bookingResponseSchema.safeParse(b); return p.success ? (p.data.booking_options ?? []) : []; });
  const out: SuppliedField[] = [];
  if (segs.length > 0 && segs.every((s) => s.flight_number.length > 0 && s.departure_airport.id.length > 0 && s.arrival_airport.id.length > 0)) out.push('segments');
  if (segs.length > 0 && segs.every((s) => s.departure_airport.time.length > 0 && s.arrival_airport.time.length > 0)) out.push('segmentTimes');
  if (segs.length > 0 && segs.every((s) => s.travel_class !== undefined)) out.push('segmentCabins');
  if (bookings.some((b) => b.book_with !== undefined)) out.push('seller');
  if (options.some((o) => typeof o.price === 'number')) out.push('price');
  if (bookings.some((b) => (b.baggage_prices?.length ?? 0) > 0)) out.push('baggage');
  return out.sort();
}

describe('searchApiProvider (spec §5.1, §2)', () => {
  const p = makeProvider(testPorts());

  it('identifies as searchapi with the labelled display name', () => {
    expect(p.id).toBe('searchapi');
    expect(p.displayName).toBe('Google Flights via SearchApi');
  });

  it('declares discovery as scraped-aggregate ≤24 h and verification as scraped-search 0 h (spec §2 table)', () => {
    const { discovery, verification } = capabilities(p);
    expect(discovery.info).toEqual(SEARCHAPI_DISCOVERY_INFO);
    expect(discovery.info).toMatchObject({ sourceKind: 'scraped-aggregate', maxAgeHours: 24 });
    expect(verification.info).toMatchObject({ sourceKind: 'scraped-search', maxAgeHours: 0 });
    expect(discovery.info.provenanceNote).toContain('Google Flights via SearchApi');
    expect(verification.info.provenanceNote).toContain('Google Flights via SearchApi');
  });

  it('display name and provenance notes carry no banned word (spec §11)', () => {
    for (const text of [SEARCHAPI_DISPLAY_NAME, SEARCHAPI_DISCOVERY_INFO.provenanceNote, SEARCHAPI_VERIFICATION_INFO.provenanceNote]) expect(findBannedWords(text)).toEqual([]);
  });

  it('supports all four cabins', () => {
    expect(p.cabins).toEqual(['economy', 'premium_economy', 'business', 'first']);
  });

  it('suppliedFields equals what the recorded fixtures evidence, and nothing more', () => {
    expect([...p.suppliedFields].sort()).toEqual(evidence(loadRecorded()));
    expect(p.suppliedFields).not.toContain('selfTransfer');
    expect(p.suppliedFields).not.toContain('fareConditions');
  });

  it('estimate: calls = 1 + expandTop × 2, cost from the plan (0 on both presets), seconds from 29 s per call', () => {
    const { verification } = capabilities(p);
    expect(verification.estimate(CELL_QUERY)).toMatchObject({ calls: 5, costMicroGbp: 0, seconds: 145 });
    expect(capabilities(makeProvider(testPorts(), { plan: 'trial' })).verification.estimate({ ...CELL_QUERY, expandTop: 3 })).toMatchObject({ calls: 7, costMicroGbp: 0 });
    expect(() => verification.estimate({ ...CELL_QUERY, bookingLinks: false })).toThrow(/bookingLinks/);
  });

  it('plan length is the discovery estimate (spec §5.2 estimate parity)', () => {
    const { discovery } = capabilities(p);
    const q = { origin: asIata('LHR'), destination: asIata('JFK'), departureFrom: asIsoDate('2026-10-21'), departureTo: asIsoDate('2027-04-20'), minNights: 10, maxNights: 21, cabin: 'economy' as const, currency: 'GBP' as const };
    expect(discovery.plan(q)).toHaveLength(23);
  });

  it('healthcheck sends no request, because every SearchApi call counts against the plan', async () => {
    const seen: URLSearchParams[] = [];
    server.use(syntheticHandler(() => ({ status: 200, body: {} }), seen));
    const ports = testPorts();
    const h = await makeProvider(ports).healthcheck(ctx());
    expect(h.ok).toBe(true);
    expect(h.detail).toContain('40usd');
    expect(seen).toHaveLength(0);
    expect(ports.reserves).toHaveLength(0);
  });

  it('refuses a point of sale that is not an upper-case ISO country code', () => {
    expect(() => makeProvider(testPorts(), { pointOfSale: 'gb' })).toThrow(/POINT_OF_SALE/);
  });

  it('is exported from the package barrel with its http limits and allowlist', () => {
    expect(typeof pkg.searchApiProvider).toBe('function');
    expect(typeof pkg.searchApiHttpLimits).toBe('function');
    expect(typeof pkg.classifySearchApiError).toBe('function');
    expect(pkg.SEARCHAPI_PARAMS_ALLOWLIST.google_flights.engine).toEqual({ values: ['google_flights'] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/provider.test.ts`
Expected: FAIL. `../../src/searchapi/provider.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/provider.ts
import type { Cabin, CapabilityInfo, Clock, FlightProvider, Logger, PlanId, Secret, SuppliedField } from '@gmt/core';
import type { HttpKit } from '../http/httpKit.js';
import { type CalendarDeps, fetchCalendarTile, planRectangles } from './calendar.js';
import { type ItineraryDeps, estimateItinerary, searchItinerary } from './itinerary.js';
import type { ParamsByEngine } from './params.js';

/** The label every user-facing string uses for this provider (spec §11). */
export const SEARCHAPI_DISPLAY_NAME = 'Google Flights via SearchApi';

/** Spec §2 table, calendar row: scraping-derived aggregate; 24 h is the declared, conservative bound on the vendor cache. */
export const SEARCHAPI_DISCOVERY_INFO: CapabilityInfo = {
  sourceKind: 'scraped-aggregate',
  maxAgeHours: 24,
  provenanceNote: 'Google Flights via SearchApi: date-grid prices that SearchApi scrapes from Google Flights. SearchApi may answer a repeat from its own cache, whose window is undocumented; 24 hours is the declared upper bound.',
};

/** Spec §2 table, itinerary row: scraping-derived search run at request time. */
export const SEARCHAPI_VERIFICATION_INFO: CapabilityInfo = {
  sourceKind: 'scraped-search',
  maxAgeHours: 0,
  provenanceNote: "Google Flights via SearchApi: itinerary search run at request time, scraped from Google Flights by SearchApi, with seller prices from Google's booking options.",
};

/** Exactly the fields the recorded fixtures evidence (spec §5.2); a test re-derives this list from the recordings. */
export const SEARCHAPI_SUPPLIED_FIELDS: readonly SuppliedField[] = ['segments', 'segmentTimes', 'segmentCabins', 'seller', 'price', 'baggage'];
/** All four cabins map to a vendor `travel_class` (docs 2026-10-14). */
export const SEARCHAPI_CABINS: readonly Cabin[] = ['economy', 'premium_economy', 'business', 'first'];

/** The plan's adapter constructor shape plus `cacheTtlHours` (finding F3). */
export interface SearchApiProviderOptions {
  http: HttpKit; log: Logger; clock: Clock; key: Secret; plan: PlanId; pointOfSale: string;
  paramsAllowlist: ParamsByEngine; cacheTtlHours: number;
}

/**
 * The SearchApi `FlightProvider` (spec §5.1, §5.2, §5.4). Discovery is `google_flights_calendar`
 * rectangle tiles; verification is the three-step `google_flights` chain. Everything goes
 * through http-kit (budget before fetch, ledger, cache, egress); the adapter never retries.
 * why: `clock` is part of the shared constructor shape; `fetchedAt` comes from http-kit, so the adapter never reads it.
 */
export function searchApiProvider(o: SearchApiProviderOptions): FlightProvider {
  if (!/^[A-Z]{2}$/.test(o.pointOfSale)) throw new TypeError(`POINT_OF_SALE must be an upper-case ISO 3166 code; got ${o.pointOfSale}`);
  const log = o.log.child({ providerId: 'searchapi' });
  const calendar: CalendarDeps = { http: o.http, log, key: o.key, pointOfSale: o.pointOfSale, allowlist: o.paramsAllowlist, cacheTtlSeconds: o.cacheTtlHours * 3600 };
  const itinerary: ItineraryDeps = { http: o.http, log, key: o.key, pointOfSale: o.pointOfSale, allowlist: o.paramsAllowlist };
  return {
    id: 'searchapi',
    displayName: SEARCHAPI_DISPLAY_NAME,
    suppliedFields: SEARCHAPI_SUPPLIED_FIELDS,
    cabins: SEARCHAPI_CABINS,
    discovery: {
      info: SEARCHAPI_DISCOVERY_INFO,
      plan: planRectangles,
      fetchTile: (plan, q, ctx) => fetchCalendarTile(calendar, plan, q, ctx),
    },
    verification: {
      info: SEARCHAPI_VERIFICATION_INFO,
      estimate: (q) => estimateItinerary(q, o.plan),
      search: (q, ctx) => searchItinerary(itinerary, q, ctx),
    },
    // why: a probe would spend a call against the plan's cap (and the one-off trial balance), so health reports configuration only.
    healthcheck: async () => ({ ok: true, detail: `key configured, plan ${o.plan}; no request sent because every SearchApi call counts against the plan` }),
  };
}
```

```ts
// test/searchapi/support/provider.ts
import type { FlightProvider } from '@gmt/core';
import { SEARCHAPI_PARAMS_ALLOWLIST } from '../../../src/searchapi/params.js';
import { type SearchApiProviderOptions, searchApiProvider } from '../../../src/searchapi/provider.js';
import type { TestPorts } from './ports.js';

export function makeProvider(p: TestPorts, overrides: Partial<SearchApiProviderOptions> = {}): FlightProvider {
  return searchApiProvider({ http: p.http, log: p.log, clock: p.clock, key: p.key, plan: '40usd', pointOfSale: 'GB', paramsAllowlist: SEARCHAPI_PARAMS_ALLOWLIST, cacheTtlHours: 1, ...overrides });
}

/** Both capabilities, or a failure: SearchApi always exposes discovery and verification. */
export function capabilities(p: FlightProvider) {
  const { discovery, verification } = p;
  if (discovery === undefined || verification === undefined) throw new Error('searchapi exposes both capabilities');
  return { discovery, verification };
}
```

`src/index.ts`, appended:

```ts
export * from './searchapi/provider.js';
export { classifySearchApiError, searchApiHttpLimits } from './searchapi/errors.js';
export { SEARCHAPI_HOST, SEARCHAPI_PARAMS_ALLOWLIST, parseParamsAllowlist } from './searchapi/params.js';
export type { ParamRule, ParamsByEngine, SearchApiEngine } from './searchapi/params.js';
export { MAX_COMBINATIONS, OUTBOUND_BLOCK_DAYS, planRectangles } from './searchapi/calendar.js';
export type { SearchApiTileResult } from './searchapi/calendar.js';
export type { RouteHistoryPoint, SearchApiItineraryResult } from './searchapi/itinerary.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi && pnpm --filter @gmt/providers typecheck`
Expected: PASS. Every file under `test/searchapi/` is green, and typecheck is clean, including `support/ports.ts`. If the evidence test reports a field that the recordings do not show (for example `baggage`), remove it from `SEARCHAPI_SUPPLIED_FIELDS`. Never edit the evidence function to match.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: searchApiProvider assembly, supplied fields from recordings, estimate and healthcheck"
```

### Task 5.9: Sentinel key and egress for this adapter

**Files:** create `test/searchapi/sentinel.test.ts`.

**Interfaces:** consumes `makeProvider`, `testPorts`, the replay handler and the recorded chain. Produces nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/sentinel.test.ts
import { asIata, asIsoDate, toEpochDay } from '@gmt/core';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENTINEL_KEY, ctx, testPorts } from './support/ports.js';
import { capabilities, makeProvider } from './support/provider.js';
import { type ReplayLog, byEngine, chainRecording, loadRecorded, need, replayHandler } from './support/recorded.js';
import { CELL_QUERY, syntheticHandler } from './support/synthetic.js';

const recorded = loadRecorded();
const book: ReplayLog = { requests: [], misses: [] };
const server = setupServer(replayHandler(recorded, book));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

describe('the SearchApi key reaches no sink but the Authorization header (spec §5.3 sentinel test, §2 fact 8)', () => {
  it('calendar, chain and an error path leave no trace of the key outside the header', async () => {
    const ports = testPorts();
    const p = makeProvider(ports);
    const { discovery, verification } = capabilities(p);
    const sinks: string[] = [];

    const cal = byEngine(recorded, 'google_flights_calendar').find((r) => r.status === 200);
    if (cal === undefined) throw new Error('calendar recording');
    const cp = cal.request.params;
    const day = (s: string) => toEpochDay(asIsoDate(s));
    const q = { origin: asIata(need(cp, 'departure_id')), destination: asIata(need(cp, 'arrival_id')), departureFrom: asIsoDate(need(cp, 'outbound_date_start')), departureTo: asIsoDate(need(cp, 'outbound_date_end')), minNights: day(need(cp, 'return_date_start')) - day(need(cp, 'outbound_date_start')), maxNights: day(need(cp, 'return_date_end')) - day(need(cp, 'outbound_date_end')), cabin: 'economy' as const, currency: 'GBP' as const };
    for (const plan of discovery.plan(q)) sinks.push(JSON.stringify(await discovery.fetchTile(plan, q, ctx())));

    const { step1, step2s } = chainRecording(recorded);
    const s = step1.request.params;
    sinks.push(JSON.stringify(await verification.search({ ...CELL_QUERY, origin: asIata(need(s, 'departure_id')), destination: asIata(need(s, 'arrival_id')), departureDate: asIsoDate(need(s, 'outbound_date')), returnDate: asIsoDate(need(s, 'return_date')), expandTop: step2s.length }, ctx())));

    const r401 = recorded.find((r) => r.status === 401);
    server.use(syntheticHandler(() => ({ status: 401, body: r401?.body ?? { error: 'Invalid API key.' } }), []));
    try {
      await verification.search(CELL_QUERY, ctx());
    } catch (err) {
      sinks.push(String(err), JSON.stringify(err), err instanceof Error ? (err.stack ?? '') : '');
    }
    server.resetHandlers();

    sinks.push(...ports.logLines, JSON.stringify(p), ...book.requests.map((r) => r.url));
    for (const text of sinks) expect(text).not.toContain(SENTINEL_KEY);
    for (const r of book.requests) {
      expect(r.authorization).toBe(`Bearer ${SENTINEL_KEY}`);
      expect(new URL(r.url).searchParams.has('api_key')).toBe(false);
    }
    expect(book.misses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

The behaviour already exists by design. To prove the test bites, temporarily change `authHeaders` to also return `{ 'X-Debug-Url': toUrl({ api_key: key.reveal() }).toString() }` and add `api_key` to the URL in `toUrl`, then run:
`pnpm --filter @gmt/providers exec vitest run test/searchapi/sentinel.test.ts`
Expected: FAIL. A request URL contains the sentinel, and the allowlist check throws on `api_key`. Revert the change.

- [ ] **Step 3: Implement.** No production change; the revert is the implementation.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/sentinel.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: sentinel-key test for the SearchApi adapter's calendar, chain and error paths"
```

## 9. Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP5. Lines 1–5 belong to WP0, WP1, WP2, WP3, WP7, WP8, WP9 and WP10.

The adapter-local edge inputs most likely to bite first are pinned here:

- A wide nights band that would push 8 outbound days over 200 combinations (Task 5.1, "shrinks the outbound block").
- A calendar answer over the limit that the docs call "empty" and the spike recorded as 400 (Task 5.5, "asserts ≤200 combinations before reserve").
- A step-1 response whose options are all unpriced (Task 5.6, "no-priced-options").
- A split booking at step 3 (Task 5.7).
- A recorded tile whose currency echo is missing (Task 5.5 synthetic "no currency", plus the recorded test's GBP assertion).

## 10. Definition of done

- `pnpm --filter @gmt/providers test` passes with coverage at or above `providers`' thresholds of 85% lines and 70% branches (also 85% functions and statements). `src/searchapi/*.ts` is inside `coverage.include`.
- `pnpm lint` is clean, with no `any` and no non-null assertion.
- `pnpm -r typecheck` is clean.
- `node scripts/check-boundaries.mjs` exits 0: `@gmt/providers` imports only `@gmt/core`, and there is no `process.env` under `packages/providers/src`.
- `pnpm secret-scan` prints `secret scan: clean`.
- `grep -rn "api_key" packages/providers/src/searchapi` prints nothing.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/providers/src` prints nothing (no airports in code).
- `git status --porcelain packages/providers/fixtures` prints nothing (nothing written under `fixtures/`).
- Every task's checkbox is ticked. The §11 findings are acknowledged by Fable in the plan before merge (F1–F4, F6–F8), or listed in the merge note as open plan findings.

## 11. Open questions

None that block dispatch. The design questions are settled by the spec or decided in this brief with a `// why:`.

The mismatches below are reported for Fable to resolve in the plan or spec. The spec wins where it speaks.

- **F1–F4.** The contract additions in §5: `routeHistory`, `pointOfSale` on results, `cacheTtlHours` on the constructor, and SearchApi's http limits and classifier.
- **F5.** Spec §5.2 and §2 fact 2 quote rectangles of "8 outbound × 24 return days (192 combinations, 96 useful cells for a 12-night band)". For a 10–21 band the tight return span over 8 departure days is 8 + 11 = **19** days (152 combinations, the same 96 useful cells). 24 corresponds to a 17-value band. The tile count (~23 per pair), the calls and the partition are identical either way. This brief plans tight rectangles, and the first failing test asserts 8 × 19.
- **F6.** This package also needs `@gmt/core` functions from WP1 (`generateCells`, `addDays`, `toEpochDay`, `cellKeyString`) and WP2 (`MINOR_EXPONENT`). `depends_on` lists only 4 and 4b. Both merge in wave 1, so dispatch is unaffected, but the plan's WP5 line should name them.
- **F7.** `buildPorts` (WP4b) constructs providers, but WP4b precedes WP5. The plan should say that WP5's merge (or WP8) adds `searchApiProvider` to `buildPorts`, and that the runtime allowlist is the code constant, because `.dockerignore` excludes `fixtures/recorded/`.
- **F8.** `@gmt/providers` gains `zod@4.6.7`, the version core pins, for vendor response shapes. The plan's dependency list for `@gmt/providers` should include it.
- **F9.** Spec §5.4 is silent on step-1 options that are all unpriced. Neither `empty` (which would claim no fares) nor `no-return-legs` fits. This brief throws `upstream` with reason `no-priced-options`, non-retryable; the engine's resume rule (§7) would retry it while attempts < 3. Spec §5.4 is also silent on step-3 failures and split bookings. This brief keeps the step-2 offer with `partial: true`, and skips split bookings with a note.
- **F10.** The vendor documentation does not show `search_parameters`, `other_flights` or the step-2 return-options key. Spec §5.2's currency and point-of-sale rule rests on WP4b's recordings ("Inputs from WP4b", item 3).
