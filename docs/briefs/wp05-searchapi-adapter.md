---
wp: 5
title: SearchApi adapter
owner: opus
depends_on: [1, 2, 4, 4b, 6]
spec_sections: ["§2", "§3", "§5.1", "§5.2", "§5.3", "§5.4", "§5.6", "§6.2", "§6.3", "§6.4", "§8.1", "§9 item 2"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, provenance-auditor, cost-and-budget-reviewer, security-reviewer]
mutate: {}
status: merged
---

# WP5: SearchApi adapter

Reconciled on 2026-10-15 against spec revision 15, the plan's "Cross-package contracts" and decisions 1–31 (main at c4fd052), the WP4b brief at 8014bdf (recorded allowlist and call list SA-01…SA-06, aligned to decision 29) and the WP6 brief at bf5aab1 (the shared modules, `CellIssue`, `truncated` and the decision-30 barrel this brief builds on). The plan sequences WP5 after WP6 (dispatch table and decision 13, 32b7edc), so every edit below is written against a WP6-merged base. Every code block was assembled on main (c4fd052) on 2026-10-15, with local stand-ins for WP6's three shared modules and its `provider.ts` additions (copied from its brief) and for WP4b's `apps/api/src/wiring.ts`. There `pnpm -r typecheck`, `pnpm lint` and `pnpm boundaries` are clean and every core, providers and api test passes, the providers per-directory coverage floor included, except Task 5.9's, which needed WP4b's recordings. Since then the recordings, WP6 and decisions 32–41 have landed, and every code block below is the merged branch file (2026-10-16): the shared modules are WP6's real ones, `providersFor` takes `{ http, log, clock }` (decision 34), the route history is best-effort (decision 40), step-2 fares dropped for a missing airline make the result partial (decision 41), and step-3 codeshare listings fly the designators their sellers list (fix round 1).

## 1. Goal

Build `searchApiProvider` in `@gmt/providers`: one `FlightProvider` that plans and fetches `google_flights_calendar` rectangle tiles for discovery and runs the three-step `google_flights` chain for verification, through http-kit only, returning raw vendor shapes with nothing invented, tested against synthetic labelled shapes and WP4b's recordings, and wired into `apps/api`.

## 2. Scope

**In**

- `RawOffer.verified: boolean` in core's provider port (Task 5.0, plan decision 29): true only when a step-3 seller listing confirmed the price, false for every step-2 offer; the fixture provider and core's test helper set it.
- `plan`: pure rectangle tiling with the largest outbound block `b` such that `b × (b + maxNights − minNights) ≤ 200`, bounded by the window length (spec rev 15: 9 days × 20 return days for the worked 10–21-night band, 21 tiles per pair; 14 × 14 for a fixed-length stay, 13 tiles). Tiles partition the query's cells and every rectangle is asserted ≤200 before reserve.
- `fetchTile`: request building and the allowlist check, then parsing. Cell keys come from the response; out-of-tile, out-of-band, bad-date and return-less entries are dropped and counted; `has_no_flights` → `noFares` only when the vendor stated no price for the cell; an empty grid → `parse`; every in-tile priced entry is returned (duplicates included) so the engine's minimum-per-tile rule decides; every covered cell with a dropped row is reported in `cellIssues` (decision 28) so the engine writes `error` or `priced` with `offers-dropped`, never `no_data`; currency and `pointOfSale` come from the echo.
- `search`: the step 1 → 2 → 3 chain with every outcome rule of spec §5.4 and plan decisions 17, 24, 25, 27 and 31: only `upstream`, `network` and `parse` count as a failed expansion; a body without an options key is `parse`, never `empty`; priced-but-unusable step-1 options are `parse`, only all-unpriced ones `no-priced-options`; the price-source rule against the step-2 offer's own airline; an outbound whose step-2 prices were all dropped, or a step 3 whose non-split options were all unusable, makes the result partial; a chain that ends with zero usable offers throws (`parse`, or `upstream`/`currency-unsupported`), never a priced result with no offers; a chain stopped by budget or cancel returns the offers it already paid for.
- Money through WP6's shared `majorToMinor` (no rounding): a refused amount drops the row (`offers-dropped:n`, reason `parse`); a currency core does not know is the normalisation reason `currency-unsupported` in both adapters, rows dropped and counted, never a tile-level parse error (decision 29).
- Never invent a seller: a step-2 offer is named by the airline the vendor states, or dropped and counted (decision 27); `suppliedFields` never declares `seller`.
- `separate_tickets=1` on both engines (documented on both; decision 29), `sort_by=price` on `google_flights`, no `stops`.
- Verification `estimate` at the configured `limits.costPerCallMicroGbp`; a stateless healthcheck that probes nothing; `suppliedFields`, `cabins`, the two `CapabilityInfo` values (itinerary `maxAgeHours: 'unknown'`, spec rev 15).
- `searchApiHttpLimits` (one host, `billable: 'http-200'`, no `rateLimitFallbackWaitSeconds`, a classifier for the recorded 401 body only) and the error table, 429 rows included, tested through the real http-kit with synthetic labelled bodies (plan decision 20).
- `SEARCHAPI_PARAMS`, a code constant equal to WP4b's recorded `params-<date>.json`.
- One entry each in `apps/api/src/wiring.ts` `httpLimitsFor` and `providersFor`; the barrel exports the provider, limits and params constant only (decision 30).
- A coverage floor for `src/searchapi/**` (90 lines / 80 branches / 90 functions / 90 statements) in `packages/providers/vitest.config.ts`, beside WP6's (decision 31).
- Tests on the package's own harness: `makeKit`, `FakeBudget`, `FakeCache`, `CapturingLogger` and `SENTINELS` from `test/fakes.ts`, `server` (the guarded msw server) from `test/support/msw.ts`, fake time from `test/support/time.ts`.

**Out**

- The http-kit pipeline: retries, limiter, ledger finalisation, cache and its TTL expiry, in-flight dedup, egress allowlist, recorder, the default status classifier, Retry-After handling; `replayHandlers`/`loadRecorded` and the network guards (`@gmt/providers/testing`); `ParamsAllowlist`, `loadParamsAllowlist`, `assertRequestAllowed`. Owner: **WP4**.
- `packages/providers/src/shared/money.ts` (`majorToMinor`), `shared/errors.ts` (`parseError`, `parseVendor`, `ParseWhere`) and `shared/notes.ts` (`NoteCounter`), and core's `CellIssue` and `DiscoveryTileResult.cellIssues?`. Owner: **WP6** (Tasks 6.1, 6.2; decisions 24, 28, 29), which merges first; this brief imports them and never redefines them.
- Recording the fixtures, writing `params-<date>.json`, and the rest of `wiring.ts`. Owner: **WP4b**.
- Cabins a provider does not offer (`no_data` / `cabin-not-offered` without a call). Owner: **WP7**; this adapter declares all four cabins.
- Normalisation: carrier and flight-number canonicalisation, local times, hashing, FX, vendor-URL validation against `google.com`, the one-calendar-price-per-tile minimum, applying `cellIssues`, writing `verified: false` offers as unverified. Owner: **WP2** (pure) and **WP7** (step).
- Persisting `route_price_history` (GBP points only, plan decision 25), stamping `pointOfSale`, writing `last_error`, the `partial-expansion` outcome reason, and writing a search result that resolves after the stop signal (decision 27). Owner: **WP7** over **WP3**.
- The `bookingLinks` refinement on definitions. Owner: **WP0** `api-contract`; this brief adds the adapter-side guard.
- Layer-B engine tests with this adapter and the live smoke, including decision 27's rows (compare one recorded fare with the vendor's own page; a 9-day rectangle; `separate_tickets=1` excludes separate tickets). Owner: **WP13**.
- Travelpayouts. Owner: **WP6**.

## 3. Spec sections

- **§2 SearchApi rows (rev 15).** `google_flights_calendar` is `scraped-aggregate`, `maxAgeHours` 24, a declared conservative assumption over an undocumented vendor cache: ≤200 combinations per call, per airport only, entries `{ departure, return, price, is_lowest_price }` in the request currency. `google_flights` is `scraped-search` with `maxAgeHours: 'unknown'` (the vendor may answer from a cache of undocumented age, fact 4). Three steps, some options unpriced, step 3 always runs.
- **§2 facts 2–5, 8 and the bonus.** HTTP 400 above 200 combinations; step-1 price = step-2 price for the cheapest pairing and an OTA below it at step 3; vendor caching; the 401 body `{"error":"Invalid API key."}` and a descriptive 400; no 429 or quota body recorded; the key only in `Authorization: Bearer`; step 1's `price_insights.price_history` stored on every verification when present (best-effort, decision 40: the recorded step 1 carries none).
- **§3.** An outcome's `reason` is the `ProviderError.kind` or a normalisation reason (`no-return-legs`, `currency-unsupported` …); the vendor message goes to `last_error`. `priced` needs at least one written offer; `empty` is positive evidence of no fares; `no_data` is "the call covered the cell but had nothing", which a dropped row must never become. A fare offer is `(itinerary, provider, seller, cabin)`. "Verified" is reserved for the verdict class; an unconfirmed step-2 price is never one (decision 27).
- **§5.1.** The provider port shapes in §4 below.
- **§5.2 (rev 15).** Tiling with the largest block under 200 combinations, response keying with counted drops, empty per capability, estimate parity, raw only with `suppliedFields` checked against recorded fixtures, point of sale (`gl` = POINT_OF_SALE lower-cased, `hl=en`, `currency=GBP`, `pointOfSale` from the echo), the dated allowlist of names and values, the error table (401/403 auth, 402 quota, 400 parse with the vendor message, 404 upstream, 429 rate-limit or recognised quota body, a header-less 429 with no configured fallback non-retryable at the hourly window, 5xx upstream), no adapter retries.
- **§5.3.** http-kit owns caching (token-bearing SearchApi responses never cached), egress, scrubbing and the sentinel-key rule; recorded tokens replay as `<key:n@session>` placeholders (rev 13).
- **§5.4 (rev 12).** `travel_class` values; the chain; unpriced options skipped and counted; every priced step-2 option persisted; step 3 for the cheapest per outbound; outcome rules with only `upstream`, `network` and `parse` as a failed expansion; the price-source rule; `no-priced-options`; a failed step 3 keeps the step-2 offer, partial; split bookings skipped and counted; calls = `1 + expandTop × 2`.
- **§5.6.** One calendar price per tile is the engine's (the minimum, vendor order breaking ties), so the adapter passes duplicates through; offers that fail are dropped and counted `offers-dropped:n`; a cell with no surviving row is `error` with the reason, reported per cell through `cellIssues` (decision 28).
- **§6.2–§6.4.** Constraint verdicts read the provider's `suppliedFields` (an absent field is `unverified`, never `pass`); money is integer minor units at the ISO 4217 exponent with no float arithmetic; identity uses canonical carriers and flight numbers (core's designator rule).
- **§8.1.** The error table the engine applies to what this adapter throws: `auth`/`quota` disable the provider, `parse` twice disables it, `limiter-timeout` pauses, `BudgetExceeded` is never an `error`, `AbortedError` returns cells to `not_run`.
- **§9 item 2 (this adapter's rows).** Partition and `plan().length` = upstream hits; out-of-band drops; empty grid → parse; `has_no_flights` → `noFares`; currency from the response; `suppliedFields` from recorded fixtures; allowlist names and values; the error table incl. 403 and quota discrimination; token responses never cached; the sentinel key.

## 4. Interfaces consumed

Copied from the merged code on main (`packages/core/src`, `packages/providers/src`, `packages/providers/test`) and the plan's contracts. Where the plan's text differs from main, main is shown and the difference is noted.

```ts
// @gmt/core types/ids.ts, types/definition.ts, types/provenance.ts, types/itinerary.ts (WP0)
export type Iata = string & { readonly __brand: 'Iata' }; export type IsoDate = …; export type IsoMonth = …; export type IsoDateTime = …;
export const iataSchema: z.ZodType<Iata, string>;      // trims, upper-cases, ^[A-Z]{3}$ — rejects a vendor place id such as '/m/04jpl'
export const isoDateSchema: z.ZodType<IsoDate, string>; // rejects impossible dates (2027-02-30)
export function asIata(s: string): Iata; export function asIsoDate(s: string): IsoDate; export function asIsoMonth(s: string): IsoMonth; export function asIsoDateTime(s: string): IsoDateTime;   // with the schemas, the only brand mint sites
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first'; export const cabinSchema: z.ZodEnum<…>;   // cabinSchema.options is the cabin list
export type PointOfSale = string | 'unknown';
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export function cellKeyString(c: CellKey): string;
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }

// @gmt/core ports/provider.ts (spec §5.1)
export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }
export interface DiscoveryQuery { origin: Iata; destination: Iata; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number; cabin: Cabin; currency: 'GBP'; cells?: CellKey[] }
export type TileRequest = { kind: 'month'; month: IsoMonth } | { kind: 'length-month'; length: number; month: IsoMonth } | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth } | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };
export interface TilePlan { index: number; coveredCells: CellKey[]; request: TileRequest }
export interface CellIssue { cell: CellKey; reason: ErrorReason; offersDropped: number; detail: string }   // WP6 Task 6.2 (decision 28)
export interface RawCalendarPrice extends CellKey { amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string }
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[]; cellIssues?: CellIssue[]; truncated?: boolean /* both WP6 Task 6.2 (decisions 28, 30); SearchApi tiles are one page and never set truncated */ }
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };
export interface ItineraryQuery extends CellKey { cabin: Cabin; adults: 1; currency: 'GBP'; maxStops?: number; expandTop: number; bookingLinks: boolean }
export interface RawSegment { marketingCarrier: string; operatingCarrier?: string; flightNumber: string; from: Iata; to: Iata; depart: string; arrive: string; timeKind: 'local' | 'utc' | 'offset'; cabin?: Cabin; durationMinutes?: number; aircraft?: string }
export interface RawOffer { outbound: RawSegment[]; inbound: RawSegment[]; seller: string; requestedCabin: Cabin; amountMinor: number; currency: string; taxesIncluded?: boolean; baggage?: BaggageSnapshot; fareConditions?: FareConditions; selfTransfer?: boolean; booking: { kind: 'get'; url: string } | { kind: 'post'; url: string; postData: string } | { kind: 'none' }; bookingExpiresAt?: IsoDateTime; verified: boolean /* added by this brief, Task 5.0 (decisions 27, 29) */ }
export interface ItinerarySearchResult { offers: RawOffer[]; coverage: 'priced' | 'empty'; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; partial: boolean; failedExpansions: number; notes: string[]; routeHistory?: Array<{ date: IsoDate; lowestPriceMinor: number; currency: string }> }
export interface ProviderContext { executionId: string | null; signal: AbortSignal; recordFixtures: boolean }
export interface CostEstimate { calls: number; costMicroGbp: number; seconds: number; notes: string[] }
export interface DiscoveryCapability { info: CapabilityInfo; plan(q: DiscoveryQuery): TilePlan[]; fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> }
export interface VerificationCapability { info: CapabilityInfo; estimate(q: ItineraryQuery): CostEstimate; search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult> }
export interface FlightProvider { readonly id: ProviderId; readonly displayName: string; readonly suppliedFields: readonly SuppliedField[]; readonly cabins: readonly Cabin[]; readonly discovery?: DiscoveryCapability; readonly verification?: VerificationCapability; healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }> }

// @gmt/core ports/budget.ts (plan decision 15)
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
  recentCalls(providerId: ProviderId, since: IsoDateTime): number;   // a count of upstream attempts; it reports no outcomes (§13)
}

// @gmt/core errors.ts, ports/logger.ts, ports/clock.ts, config, dates, normalise, text (WP0–WP2)
export class ProviderError extends Error { readonly kind: ProviderErrorKind; readonly reason: string | undefined; readonly retryable: boolean; readonly httpStatus: number | undefined; readonly retryAfterSeconds: number | undefined; readonly providerId: ProviderId | 'fx' | undefined; constructor(p: { kind; retryable; message; reason?; httpStatus?; retryAfterSeconds?; providerId? }) }   // message passes through stripUrlsInText
export type ProviderErrorKind = 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout';
export class BudgetExceeded extends Error { readonly scope: BudgetScopeKind; readonly cap: number; readonly current: number; readonly requested: number; readonly providerId: ProviderId | undefined }
export class AbortedError extends Error {}
export type NormalisationReason = 'fx-unavailable' | 'currency-unsupported' | 'unknown-airport-tz' | 'no-return-legs' | 'unmappable-carrier' | 'bad-local-time' | 'cell-mismatch';
export type ErrorReason = ProviderErrorKind | NormalisationReason;   // types/execution.ts: the closed list a CellIssue.reason takes
export interface Logger { debug(o: object, msg?: string): void; info(…): void; warn(…): void; error(…): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
export class Secret { constructor(value: string); reveal(): string }
export interface ProviderLimits { monthlyCallCap; window; billingDay; ratePerMinute; ratePerHour; concurrency; cacheTtlHours; costPerCallMicroGbp; planFixedMicroGbp; excludedFromSchedule }
export const PLAN_PRESETS: Record<PlanId, PlanPreset>;
export interface Config { pointOfSale: string; maxWaitSeconds: number; requestTimeoutSeconds: number; providers: { searchapi: { key: Secret; plan: PlanId; trialUsed: number; limits: ProviderLimits } | null; … }; … }   // limits.costPerCallMicroGbp honours SEARCHAPI_COST_PER_CALL_MICRO_GBP
export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number /* b − a */;
export function generateCells(space: ResolvedSpace): Cell[];
export const MINOR_EXPONENT: Record<string, number>;
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>; export const BANNED_WORD_ALLOWLIST: readonly string[];

// @gmt/providers src/http/types.ts (WP4) — the types live here, not in httpKit.ts
export interface ResponseFacts { status: number; body: unknown; headers: Headers; providerId: HttpProviderId; endpointPath: string }
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never'; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; rateLimitFallbackWaitSeconds?: number; classifyError?: (f: ResponseFacts) => ProviderError | undefined }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<HttpProviderId, ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[]; syntheticAllowed: boolean; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
export interface HttpKitRequest { providerId: HttpProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body?: string; cache: { ttlSeconds: number; accept?: (body: unknown) => boolean } | 'never'; signal: AbortSignal; recordFixtures: boolean }
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime /* clock.now() after the body is read; storedAt on a cache hit */; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
// src/http/httpKit.ts: createHttpKit(deps: HttpKitDeps): HttpKit — a header-less 429 with no fallback wait → non-retryable rate-limit, retryAfterSeconds = seconds to the hourly refresh, message '[no-retry-after]'; Retry-After above maxWaitSeconds → limiter-timeout
// src/http/recorder.ts: defaultRecordedRoot(): string; withContentHash<T extends object>(file: T): T & { contentSha256: string }; interface RecordedFixture { recordedAt; recordedBy; session; providerId; endpointPath; request: { method; url; headers; body }; status; body; responseHeaders?; placeholders; contentSha256 }
// src/params/allowlist.ts: interface ParamsAllowlist { provider: ProviderId; recordedAt: IsoDate; endpoints: Record<string, { names: string[]; values: Record<string, string[] | 'any'> }>; contentSha256: string }; loadParamsAllowlist(path, root?); assertRequestAllowed(allowlist, endpointPath, url) throws ParamsNotAllowedError
// src/util.ts: isRecord(v): v is Record<string, unknown>; zodReason(error: z.ZodError): string (field paths and messages, never values)
// '@gmt/providers/testing' (src/testing/index.ts): loadRecorded(root, providerId, endpointPath): RecordedFixture[]; replayHandlers(recordedRoot, opts?: { session?: string }): { handlers; misses(): string[] }; guardedServer; installNetworkGuards(hooks)

// @gmt/providers test support (WP4) — reused, never copied
// test/fakes.ts: makeKit(o?: { limits?; overrides?; secrets?; recorder?; inProcessHosts?; syntheticAllowed?; budget? }): { kit; budget: FakeBudget; cache: FakeCache; log: CapturingLogger; clock; events: LedgerEvent[] }  (registers its budget in liveBudgets, so test/support/setup.ts asserts every reservation is finalised; records every upstream request as a 'fetch' event)
//   FakeBudget(events) { refuse: ((p) => BudgetExceeded | null) | null; reserveCalls; count(type); … }; FakeCache { sets; entries }; CapturingLogger { lines }; SENTINELS.searchapi: Secret
// test/support/msw.ts: export { guardedServer as server } — the one msw server; setup.ts resets its handlers and listeners after each test and fails a test whose request no handler answered
// test/support/time.ts: useFakeTime(); drive(p); driveError(p)   test/support/guards.ts: obj(v); asProviderError(v)

// From WP6 (Task 6.1; decisions 24, 28, 29) — consumed by these exact names, never redefined here
// src/shared/money.ts
export function majorToMinor(major: number, currency: string): number | null;   // exact decimal-string arithmetic over MINOR_EXPONENT; null: not finite positive, excess decimals, > MAX_SAFE_INTEGER minor units, unknown currency
// src/shared/errors.ts
export interface ParseWhere { providerId: ProviderId; endpointPath: string }
export function parseError(cause: string, detail: string | null, where: ParseWhere): ProviderError;   // kind 'parse', non-retryable, reason 'parse'; message `<provider> <path>: <detail or cause> [<cause>]`; providerId from where (required, decision 30)
export function parseVendor<S extends z.ZodType>(schema: S, body: unknown, cause: string, where: ParseWhere): z.output<S>;   // throws parseError(cause, zodReason(...), where)
// src/shared/notes.ts
export class NoteCounter { add(key: string, n?: number): void; get(key: string): number; list(): string[] /* `key:n`, code-unit order, zeros omitted */ }

// apps/api src/wiring.ts (WP4b)
export function httpLimitsFor(config: Config): HttpKitDeps['limits'];
export function providersFor(config: Config, deps: { http: HttpKit; log: Logger; clock: Clock }): FlightProvider[];   // decision 34: no airports
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;
```

From WP4b (files, WP4b brief §7): `packages/providers/fixtures/recorded/searchapi/_api_v1_search/<yyyy-mm-dd>-<sha12>.json` (SA-01 401, SA-02 calendar in the production shape, 9 × 20 for the worked band (decision 29), SA-03 over-limit 400 or empty 200, SA-04…SA-06 the chain) and `packages/providers/fixtures/recorded/searchapi/params-<yyyy-mm-dd>.json`.

## 5. Interfaces produced

Exported from `@gmt/providers` (`src/index.ts`):

```ts
export function searchApiProvider(o: { http: HttpKit; log: Logger; clock: Clock; key: Secret; costPerCallMicroGbp: number; pointOfSale: string; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist }): FlightProvider;
export function searchApiHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;   // hosts ['www.searchapi.io'], billable 'http-200', no rateLimitFallbackWaitSeconds, classifyError = classifySearchApiError
export const SEARCHAPI_PARAMS: ParamsAllowlist;   // equal to WP4b's recorded params-<date>.json; contentSha256 computed with withContentHash
```

`searchApiProvider` takes `costPerCallMicroGbp`, the configured `limits.costPerCallMicroGbp`, so the estimate prices calls at the rate http-kit ledgers with (decision 27); `clock` stays (decision 24).

Added to `@gmt/core` (`src/ports/provider.ts`, Task 5.0; decisions 27, 29):

```ts
export interface RawOffer { /* … as in §4 … */ verified: boolean }   // true only when a step-3 seller listing confirmed the price
```

Module-local (not in the barrel, decision 30; no other package names them): `classifySearchApiError` (reached as `searchApiHttpLimits(…).classifyError`, both in `limits.ts` as Travelpayouts' are), `parseFlights`, `parseBooking`, `toRouteHistory` (`steps.ts`), `SEARCHAPI_HOST`, `SEARCHAPI_WHERE`, `SEARCHAPI_DISPLAY_NAME`, `SEARCHAPI_DISCOVERY_INFO`, `SEARCHAPI_VERIFICATION_INFO`, `SEARCHAPI_SUPPLIED_FIELDS`, `MAX_COMBINATIONS`, `outboundBlockDays`, `planRectangles`. `SEARCHAPI_PARAMS.endpoints` has two keys, `/api/v1/search?engine=google_flights_calendar` and `/api/v1/search?engine=google_flights`; `assertRequestAllowed` picks the one whose `engine` matches.

## 6. Endpoints and parameters

`GET https://www.searchapi.io/api/v1/search`, credential in `Authorization: Bearer <key>` only. "Docs" = the vendor pages read on 2026-10-14 and re-read by provider-integration-expert on 2026-10-15 (review evidence); this revision made no vendor request. The values are exactly WP4b's recorded allowlist (WP4b brief at 8014bdf with decision 29's alignment).

| Parameter | Calendar | google_flights (steps 1–3) | Status |
|---|---|---|---|
| `engine` | `google_flights_calendar` | `google_flights` | docs |
| `departure_id`, `arrival_id` | airport codes (`any`) | airport codes (`any`) | docs; city codes rejected (fact 2) |
| `flight_type` | `round_trip` | `round_trip` | docs |
| `outbound_date`, `return_date` | the rectangle's start dates | the cell's dates | docs mark both required |
| `outbound_date_start`/`_end`, `return_date_start`/`_end` | rectangle bounds | — | docs set only the 200-combination cap (the end defaults to start + 7 when omitted); SA-02 is recorded in the production shape, 9 × 20 for the worked band (decision 29), and WP13 tries a 9-day rectangle live (decision 27) |
| `travel_class` | `economy`, `premium_economy`, `business`, `first_class` | same | docs; spec §5.4; sent on every request (decision 20) |
| `adults` | `1` | `1` | docs (default 1); sent explicitly (decision 24) |
| `currency` | `GBP` | `GBP` | docs (default `USD`) |
| `gl` | `gb` (the recorded point of sale) | `gb` | docs (default `us`); another POINT_OF_SALE needs a new recording, so the constructor refuses it |
| `hl` | `en` | `en` | docs |
| `sort_by` | — | `price` | docs (2026-10-15): default `top_flights`; `price`, `departure_time`, `arrival_time`, `duration`, `emissions`; step 1 is still sorted locally, so "cheapest" holds over the returned options only |
| `separate_tickets` | `1` | `1` | docs (2026-10-15), both pages: "Set to `1` to hide separate and self-transfer tickets, or `0` to show them" (default `0`); sent on both so discovery ranks cells by the fares verification searches (decision 29). WP13 checks the behaviour live (decision 27) |
| `departure_token` | — | step 2 only (`any`) | docs for the parameter; resending the step-1 parameters with it is evidenced by WP4b's SA-05, not the docs |
| `booking_token` | — | step 3 only (`any`) | docs, including the resend of the step-1 parameters |
| `stops` | never | never | DiscoveryQuery has no maxStops; a recorded Phase 4 gap (decision 24) |
| `api_key` | never | never | fact 8 |

Response fields read: calendar `search_parameters.{currency, gl}`, `calendar[].{departure, return, price, has_no_flights}`; google_flights `best_flights[]` and `other_flights[]` (`other_flights` is not on the docs page, yet WP4b's recorded step 1 and step 2 carry their options there only; both are read) of `{ flights[] { departure_airport, arrival_airport { id, date, time }, airline?, flight_number, travel_class?, duration?, airplane? }, price?, departure_token?, booking_token? }`, `price_insights.price_history[] { price, iso_date }` (best-effort, decision 40: absent in the recorded step 1, which yields an empty history and the informational note `route-history-absent:1`), `booking_options[] { book_with?, price?, baggage_prices?, booking_request? { url, post_data }, booking_phone?, is_split_booking?, flight_numbers? }` (`flight_numbers` is one designator per flight, outbound then inbound; recorded codeshare sellers list their own, for example EI 381/111/110/380, AA 8059/8317/8316/8060 and BA 5941/6131/6130/5940 for one pairing). The docs define no error bodies, status codes, Retry-After or rate-limit headers, and do not define what a round-trip `price` means: the recorded chain test asserts spike fact 3 instead.

## 7. Inputs from WP4b (recordings)

Factual checks. A failure of item 1 or 3 is a WP4b fix; a failure of item 2 is vendor behaviour WP4b cannot change, so it goes to Fable as a design question (which currency and point-of-sale evidence the adapter may then use), never to WP4b. They are asserted by Task 5.9, the only task whose tests need the recordings; every other test is synthetic and runs without them. Without WP4b's tree they fail with a message starting `pending-fixtures:`.

1. `loadRecorded(root, 'searchapi', '/api/v1/search')` returns at least: a non-empty HTTP 200 calendar tile (SA-02) in the production shape (its outbound days are the largest `b` with `b × (b + spread) ≤ 200` for its band, 9 × 20 for the worked band, decision 29), with a grid entry for every outbound day, requested with `outbound_date = outbound_date_start` and `return_date = return_date_start`; the over-limit probe (SA-03) as a 400 whose message names the 200-combination limit (the docs say "empty response"; the recording wins); a step 1 (SA-04); a step 2 whose `departure_token` appears in step 1's body (SA-05); a step 3 whose `booking_token` appears in a step-2 body (SA-06); the 401 body (SA-01).
2. Every HTTP 200 body with content carries `search_parameters.currency` and `search_parameters.gl`.
3. `params-<date>.json`, read with `loadParamsAllowlist`, deep-equals `SEARCHAPI_PARAMS` (names, values, `recordedAt`, `contentSha256`), and every recorded request passes it.

## 8. Library notes

All checked on **2026-10-15** against the installed packages (versions from the plan's Task 0.1 list) and the merged code that uses them.

**msw 3.0.3.** Tests import only `http` and `HttpResponse` from `msw/http`, and register handlers on the package's single guarded server (`server` from `test/support/msw.ts`) with `server.use(...)` inside each test; no test file calls `setupServer` or `listen` (plan decision 18). The guard's afterEach resets handlers and removes every listener, so handlers and `replayHandlers(...)` are registered per test, never at module scope. Synthetic handlers answer with `new HttpResponse(text, { status, headers })`, as `replayHandlers` does, so headers such as `retry-after` reach http-kit. Upstream requests are observed through `makeKit`'s `fetch` events (its own `request:start` listener), not a second listener.

**vitest 5.0.4.** `useFakeTime()`/`drive()`/`driveError()` from `test/support/time.ts` drive http-kit's retries and Retry-After waits; every `rejects` is awaited. Per-task runs use `pnpm --filter @gmt/providers exec vitest run <file>` (no coverage threshold on a partial run, plan decision 8).

**zod 4.6.7** (a `@gmt/providers` dependency). Used: `z.object` (strips unknown keys), `z.array`, `z.unknown`, `z.string`, `z.number`, `z.boolean`, `.optional()`, `.nullish()`, `.int().nonnegative()`, `safeParse` (per entry, where one bad entry is dropped rather than fatal), `parse` (tests only), `z.infer`; whole-body validation goes through WP6's `parseVendor`, whose message names fields and problems, never values. Brands come only from core's `iataSchema`/`isoDateSchema` and the `as*` helpers.

**SearchApi** `google_flights_calendar` and `google_flights` (https://www.searchapi.io/docs/google-flights-calendar-api, https://www.searchapi.io/docs/google-flights-api): parameters and response fields as in §6; over 200 combinations the docs say "will return an empty response", the spike recorded HTTP 400 (WP4b's SA-03 settles it); `GET /api/v1/me` exists, but whether it costs a credit is undocumented, so the healthcheck does not call it.

## 9. Files

Create, under `packages/providers/`:

- `src/searchapi/calendar.ts`: rectangle tiling (Task 5.1), calendar fetch and parse (Task 5.4)
- `src/searchapi/params.ts`: host, endpoint, `SEARCHAPI_PARAMS`, `TRAVEL_CLASS`, point-of-sale check, request builders, auth header
- `src/searchapi/limits.ts`: `classifySearchApiError`, `searchApiHttpLimits` (named as WP6's `travelpayouts/limits.ts`)
- `src/searchapi/shapes.ts`: vendor zod shapes, echo reader, money with drop reasons
- `src/searchapi/offers.ts`: segments, stated airline, step-3 offers with the seller-listed flights, the price-source match
- `src/searchapi/steps.ts`: the step-1/2 and step-3 body parsers and the route-history conversion
- `src/searchapi/itinerary.ts`: the chain and its estimate
- `src/searchapi/provider.ts`: `searchApiProvider` and the capability infos
- `test/searchapi/support/kit.ts`: `saKit` over `makeKit`, `ctx`, the allowlist afterEach check
- `test/searchapi/support/synthetic.ts`: synthetic-shape builders and handler (never written to disk)
- `test/searchapi/support/provider.ts`: provider factory
- `test/searchapi/support/recorded.ts`: helpers over WP4's `loadRecorded`
- `test/searchapi/tiling.test.ts`, `params.test.ts`, `errors.test.ts`, `calendar.test.ts`, `offers.test.ts`, `itinerary.test.ts`, `provider.test.ts`, `sentinel.test.ts`, `recorded.test.ts`

Modify:

- `packages/core/src/ports/provider.ts`: `RawOffer.verified` (Task 5.0)
- `packages/core/test/helpers/offers.ts` and `packages/core/test/normalise/itinerary.test.ts`: the helper's offer states `verified`; the identity test pins that it never changes the hash (Task 5.0)
- `packages/providers/src/fixture/provider.ts` and `packages/providers/test/fixture/provider.test.ts`: fixture offers state `verified: true` (Task 5.0)
- `packages/providers/src/index.ts`: three exports (Task 5.7)
- `packages/providers/vitest.config.ts`: the `src/searchapi/**` coverage floor (Task 5.7)
- `packages/providers/test/barrel.test.ts`: the new public names, and four that must stay module-local (Task 5.7)
- `apps/api/src/wiring.ts`: the SearchApi entry in `httpLimitsFor` and in `providersFor` (Task 5.10)
- `apps/api/test/wiring/buildPorts.test.ts`: WP4b's exact provider and limit lists gain `searchapi`, because its `testEnv` sets a SearchApi sentinel key (Task 5.10)
- `apps/api/src/tools/recordRequests.ts`: `recordingLimits` uses `searchApiHttpLimits` (plan decision 23, Task 5.10)
- `apps/api/test/tools/record.test.ts`: an explicit 15 s timeout on the `priorToolCredits` test, which builds a real SQLite ledger (Task 5.10)

Create, under `apps/api/`: `test/wiring/searchapi.test.ts` and `test/tools/recordingLimits.test.ts` (Task 5.10, beside WP4b's tests).

Nothing is written under `fixtures/`, and nothing under `src/shared/` (WP6's).

## 10. Tasks

Per-task commands run one file without coverage; section 12 runs the packages with thresholds. Every test that uses a synthetic vendor shape says "(synthetic)" in its name.

### Task 5.0: `RawOffer.verified` in core's provider port (first failing test)

**Files:** modify `packages/core/src/ports/provider.ts`, `packages/core/test/helpers/offers.ts`, `packages/core/test/normalise/itinerary.test.ts`, `packages/providers/src/fixture/provider.ts` and `packages/providers/test/fixture/provider.test.ts`.

**Interfaces:** consumes `RawOffer`. Produces `RawOffer.verified: boolean` (plan decisions 27, 29): true only when a seller listing confirmed the price. A type-only change to core (no runtime code, so core's 100% thresholds are unaffected); every `RawOffer` constructor in the repository states it, so no default is ever applied.

- [ ] **Step 1: Write the failing test**

The edits are given as anchors, not hunks, because WP6 (merged first) also edits the fixture files.

In `packages/providers/test/fixture/provider.test.ts`, in "search returns priced synthetic offers …", add `verified: true,` to the first offer's expected object, directly after `booking: { kind: 'none' },`.

In `packages/core/test/normalise/itinerary.test.ts`, rename the identity test to `'price, cabin, seller, provider, booking, currency and verified do not change identity'` and add `verified: false,` as the first property of its `other` offer (spec §6.4: the flag is never identity).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/provider.test.ts`
Expected: FAIL in "search returns priced synthetic offers …": the received offer has no `verified` property.

- [ ] **Step 3: Implement**

In `packages/core/src/ports/provider.ts`, add the last member of `RawOffer`:

```ts
  bookingExpiresAt?: IsoDateTime;
  /**
   * True only when a seller listing confirmed this price (SearchApi step 3); false for a price the vendor declares
   * without one (a SearchApi step-2 option). The engine writes an unverified offer with `unverified` set and never
   * as a verified fare (plan decisions 27 and 29).
   */
  verified: boolean;
}
```

In `packages/providers/src/fixture/provider.ts`, in `offer()`, directly after `booking: { kind: 'none' },` (decision 31):

```ts
    // why: under the synthetic gate these offers stand in for confirmed prices (plan decision 31), so the engine's
    // verified path is exercised; their provenance stays `synthetic` and is never a confirmation of a real fare.
    verified: true,
```

In `packages/core/test/helpers/offers.ts`, in `offer()`, add `verified: true,` directly after `booking: { kind: 'none' },` (before `...over`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/fixture/provider.test.ts && pnpm --filter @gmt/core exec vitest run test/normalise/itinerary.test.ts && pnpm --filter @gmt/core typecheck && pnpm --filter @gmt/providers typecheck`
Expected: PASS, 33 and 32 tests; both typechecks clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/providers && git commit -m "wp05: RawOffer.verified in core's provider port (decisions 27, 29)"
```

### Task 5.1: Rectangle tiling (first failing test)

**Files:** create `src/searchapi/calendar.ts` (tiling part) and `test/searchapi/tiling.test.ts`.

**Interfaces:** consumes `DiscoveryQuery`, `TilePlan`, `TileRequest`, `CellKey`, `generateCells`, `addDays`, `daysBetween`, `cellKeyString`. Produces `MAX_COMBINATIONS`, `Rectangle`, `combinations`, `assertWithinLimit`, `outboundBlockDays`, `planRectangles`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/tiling.test.ts
import {
  addDays,
  asIata,
  asIsoDate,
  type CellKey,
  cellKeyString,
  type DiscoveryQuery,
  daysBetween,
  generateCells,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  combinations,
  MAX_COMBINATIONS,
  outboundBlockDays,
  planRectangles,
} from '../../src/searchapi/calendar.js';

// Worked example (spec §1): LHR → JFK, 10–21 nights over a 182-day window.
const FROM = asIsoDate('2026-10-21');
const TO = addDays(FROM, 181); // 2027-04-20, inclusive: 182 departure days
const q: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: FROM,
  departureTo: TO,
  minNights: 10,
  maxNights: 21,
  cabin: 'economy',
  currency: 'GBP',
};
const space = (d: DiscoveryQuery) => ({
  origins: [d.origin],
  destinations: [d.destination],
  departureFrom: d.departureFrom,
  departureTo: d.departureTo,
  minNights: d.minNights,
  maxNights: d.maxNights,
});
const keyOf = (c: CellKey) => cellKeyString(c);
const span = (a: string, b: string) => daysBetween(asIsoDate(a), asIsoDate(b)) + 1;
const firstRect = (plans: ReturnType<typeof planRectangles>) => {
  const r = plans[0]?.request;
  if (r?.kind !== 'rectangle') throw new Error('expected a rectangle');
  return r;
};

describe('planRectangles (spec §5.2 SearchApi tiling, §2 fact 2)', () => {
  const plans = planRectangles(q);

  it('tiles partition the band: every cell exactly once, nothing else', () => {
    const expected = generateCells(space(q)).map(keyOf).sort();
    const covered = plans.flatMap((p) => p.coveredCells.map(keyOf));
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual(expected);
    expect(expected.length).toBe(182 * 12);
  });

  it('every tile is a rectangle within the 200-combination limit, and its cells lie inside it', () => {
    for (const p of plans) {
      if (p.request.kind !== 'rectangle') throw new Error('expected a rectangle');
      const r = p.request;
      expect(combinations(r)).toBeLessThanOrEqual(MAX_COMBINATIONS);
      for (const c of p.coveredCells) {
        expect(c.departureDate >= r.departFrom && c.departureDate <= r.departTo).toBe(true);
        expect(c.returnDate >= r.returnFrom && c.returnDate <= r.returnTo).toBe(true);
      }
    }
  });

  it('worked 10–21 band: 9 outbound days × 20 return days, 21 tiles per pair (b × (b + 11) ≤ 200)', () => {
    expect(outboundBlockDays(q)).toBe(9); // 9 × 20 = 180; 10 × 21 = 210 > 200
    expect(plans).toHaveLength(Math.ceil(182 / 9)); // 21
    const first = firstRect(plans);
    expect(span(first.departFrom, first.departTo)).toBe(9);
    expect(span(first.returnFrom, first.returnTo)).toBe(20);
    expect(first).toMatchObject({
      departFrom: '2026-10-21',
      returnFrom: '2026-10-31',
      returnTo: '2026-11-19',
    });
  });

  it('a fixed-length stay grows the block to 14 days: 13 tiles instead of 23 (14 × 14 = 196)', () => {
    const fixed = { ...q, minNights: 14, maxNights: 14 };
    expect(outboundBlockDays(fixed)).toBe(14);
    const p = planRectangles(fixed);
    expect(p).toHaveLength(13);
    expect(combinations(firstRect(p))).toBe(196);
  });

  it('a wide band shrinks the block: 0–90 nights fits 2 outbound days (2 × 92 = 184; 3 × 93 = 279)', () => {
    const wide = { ...q, departureTo: addDays(FROM, 29), minNights: 0, maxNights: 90 };
    expect(outboundBlockDays(wide)).toBe(2);
    expect(span(firstRect(planRectangles(wide)).departFrom, firstRect(planRectangles(wide)).departTo)).toBe(
      2,
    );
  });

  it('a spread of 10 sits exactly on the limit: 10 outbound days × 20 return days = 200 (synthetic)', () => {
    const exact = { ...q, minNights: 10, maxNights: 20 };
    expect(outboundBlockDays(exact)).toBe(10);
    expect(combinations(firstRect(planRectangles(exact)))).toBe(200);
  });

  it('for every spread 0..90 and several windows, the block is the largest b with b × (b + spread) ≤ 200', () => {
    for (const windowDays of [1, 3, 9, 14, 30, 182])
      for (let spread = 0; spread <= 90; spread++) {
        const band = { ...q, departureTo: addDays(FROM, windowDays - 1), minNights: 0, maxNights: spread };
        const b = outboundBlockDays(band);
        expect(b * (b + spread)).toBeLessThanOrEqual(MAX_COMBINATIONS);
        // why: unless the window bounds it, one more day must overflow, so no plan uses more tiles than needed.
        if (b < windowDays) expect((b + 1) * (b + 1 + spread)).toBeGreaterThan(MAX_COMBINATIONS);
        else expect(b).toBe(windowDays);
      }
  });

  it('for every spread 0..90 over a 30-day window, every tile is within 200, tiles partition the band, and a full block is b × (b + spread)', () => {
    for (let spread = 0; spread <= 90; spread++) {
      const band = { ...q, departureTo: addDays(FROM, 29), minNights: 0, maxNights: spread };
      const b = outboundBlockDays(band);
      const plans = planRectangles(band);
      const covered = plans.flatMap((p) => p.coveredCells.map(keyOf)).sort();
      expect(covered).toEqual(generateCells(space(band)).map(keyOf).sort());
      for (const p of plans) {
        if (p.request.kind !== 'rectangle') throw new Error('expected a rectangle');
        expect(combinations(p.request)).toBeLessThanOrEqual(MAX_COMBINATIONS);
      }
      expect(combinations(firstRect(plans))).toBe(b * (b + spread));
    }
  });

  it('the block never exceeds the window: a 3-day window is one 3-day tile', () => {
    const short = { ...q, departureTo: addDays(FROM, 2) };
    expect(outboundBlockDays(short)).toBe(3);
    expect(planRectangles(short)).toHaveLength(1);
  });

  it('is deterministic and indexes tiles 0..n-1', () => {
    expect(planRectangles(q)).toEqual(plans);
    expect(plans.map((p) => p.index)).toEqual(plans.map((_, i) => i));
  });

  it('re-plans over a cells subset and still partitions exactly that subset', () => {
    const all = generateCells(space(q)).map(({ origin, destination, departureDate, returnDate }) => ({
      origin,
      destination,
      departureDate,
      returnDate,
    }));
    const subset = all.filter((_, i) => i % 7 === 0).reverse(); // unordered on purpose
    const re = planRectangles({ ...q, cells: subset });
    expect(re.flatMap((p) => p.coveredCells.map(keyOf)).sort()).toEqual(subset.map(keyOf).sort());
    expect(re.length).toBeLessThanOrEqual(plans.length);
  });

  it('a subset carrying an off-band cell still yields tiles within the limit (the shrink guard)', () => {
    const [a] = generateCells(space(q));
    if (a === undefined) throw new Error('cells');
    const offBand = {
      origin: a.origin,
      destination: a.destination,
      departureDate: a.departureDate,
      returnDate: addDays(a.departureDate, 60),
    };
    const near = {
      ...offBand,
      departureDate: addDays(a.departureDate, 5),
      returnDate: addDays(a.departureDate, 15),
    };
    for (const p of planRectangles({ ...q, cells: [offBand, near] }))
      if (p.request.kind === 'rectangle')
        expect(combinations(p.request)).toBeLessThanOrEqual(MAX_COMBINATIONS);
  });

  it('an empty subset plans no tiles', () => {
    expect(planRectangles({ ...q, cells: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/tiling.test.ts`
Expected: FAIL. The suite reports that `../../src/searchapi/calendar.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/calendar.ts (tiling part; Task 5.4 adds the fetch)
import {
  addDays,
  type CellKey,
  type DiscoveryQuery,
  daysBetween,
  generateCells,
  type IsoDate,
  type TilePlan,
  type TileRequest,
} from '@gmt/core';

/** Spec §2 fact 2: the calendar engine refuses more than 200 outbound × return combinations (HTTP 400). */
export const MAX_COMBINATIONS = 200;

/** The rectangle variant of the vendor-neutral tile request (spec §5.1). */
export type Rectangle = Extract<TileRequest, { kind: 'rectangle' }>;

/** Outbound days × return days of a rectangle, the quantity SearchApi caps at 200. Spec §5.2. */
export function combinations(r: Rectangle): number {
  return (daysBetween(r.departFrom, r.departTo) + 1) * (daysBetween(r.returnFrom, r.returnTo) + 1);
}

/** The ≤200 assertion of spec §5.2; `fetchTile` repeats it before `http.request`, so it precedes `budget.reserve`. */
export function assertWithinLimit(r: Rectangle): void {
  const n = combinations(r);
  if (n > MAX_COMBINATIONS) {
    throw new RangeError(
      `searchapi rectangle ${r.departFrom}..${r.departTo} × ${r.returnFrom}..${r.returnTo} has ${n} combinations, above ${MAX_COMBINATIONS}`,
    );
  }
}

/**
 * Outbound days per tile: the largest b with b × (b + maxNights − minNights) ≤ 200, bounded by the window
 * length (ruling CBR-03). A block of b departure days needs b + spread return days, so this is the widest
 * rectangle the vendor accepts: 9 days for the worked 10–21-night band (9 × 20 = 180), 14 for a fixed-length
 * stay (14 × 14 = 196). One day always fits because nights ≤ 90 (spec §6.1).
 */
export function outboundBlockDays(
  q: Pick<DiscoveryQuery, 'departureFrom' | 'departureTo' | 'minNights' | 'maxNights'>,
): number {
  const spread = q.maxNights - q.minNights;
  const windowDays = daysBetween(q.departureFrom, q.departureTo) + 1;
  let b = 1;
  while ((b + 1) * (b + 1 + spread) <= MAX_COMBINATIONS) b += 1;
  return Math.max(1, Math.min(b, windowDays));
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

/** The tight bounding rectangle of a block; `first` is its earliest cell. */
function boundsOf(first: CellKey, group: readonly CellKey[]): Rectangle {
  const r: Rectangle = {
    kind: 'rectangle',
    departFrom: first.departureDate,
    departTo: first.departureDate,
    returnFrom: first.returnDate,
    returnTo: first.returnDate,
  };
  for (const c of group) {
    if (c.departureDate > r.departTo) r.departTo = c.departureDate;
    if (c.returnDate < r.returnFrom) r.returnFrom = c.returnDate;
    if (c.returnDate > r.returnTo) r.returnTo = c.returnDate;
  }
  return r;
}

/**
 * `DiscoveryCapability.plan` for SearchApi: pure, deterministic rectangle tiling of `google_flights_calendar`.
 * Spec §5.2. Cells (the band, or `q.cells` on a re-plan) are sorted and cut into blocks of
 * `outboundBlockDays(q)` consecutive departure days; each tile is its block's tight bounding box, so tiles
 * partition the input exactly. A block whose box would still exceed 200 combinations (only possible when
 * `q.cells` carries an off-band cell) shrinks a day at a time.
 */
export function planRectangles(q: DiscoveryQuery): TilePlan[] {
  const source: CellKey[] =
    q.cells ??
    generateCells({
      origins: [q.origin],
      destinations: [q.destination],
      departureFrom: q.departureFrom,
      departureTo: q.departureTo,
      minNights: q.minNights,
      maxNights: q.maxNights,
    }).map(({ origin, destination, departureDate, returnDate }) => ({
      origin,
      destination,
      departureDate,
      returnDate,
    }));
  const cells = [...source].sort(byDepartureThenReturn);
  const widest = outboundBlockDays(q);
  const tiles: TilePlan[] = [];
  let start = 0;
  while (start < cells.length) {
    const first = cells[start];
    if (first === undefined) break;
    let block = widest;
    let group = takeBlock(cells, start, addDays(first.departureDate, block - 1));
    let rect = boundsOf(first, group);
    // why: a re-plan subset may hold a cell outside the band (an engine bug); shrink rather than overflow.
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
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi rectangle tiling with the widest block under 200 combinations (spec §5.2)"
```

### Task 5.2: Parameter allowlist and request builders

**Files:** create `src/searchapi/params.ts` and `test/searchapi/params.test.ts`.

**Interfaces:** consumes `Cabin`, `DiscoveryQuery`, `ItineraryQuery`, `Secret`, `asIsoDate`, WP4's `withContentHash`, `ParamsAllowlist`, `assertRequestAllowed`, WP6's `ParseWhere`, and `SENTINELS` from `test/fakes.ts`. Produces `SEARCHAPI_HOST`, `SEARCHAPI_ENDPOINT`, `SEARCHAPI_ENDPOINT_PATH`, `SEARCHAPI_WHERE`, `TRAVEL_CLASS`, `SORT_BY_PRICE`, `EXCLUDE_SEPARATE_TICKETS`, `SEARCHAPI_PARAMS`, `assertPointOfSaleAllowed`, `calendarParams`, `flightsParams`, `toUrl`, `authHeaders`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/params.test.ts
import { asIata, asIsoDate, type ItineraryQuery } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { withContentHash } from '../../src/http/recorder.js';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import {
  assertPointOfSaleAllowed,
  authHeaders,
  calendarParams,
  flightsParams,
  SEARCHAPI_ENDPOINT_PATH,
  SEARCHAPI_PARAMS,
  TRAVEL_CLASS,
  toUrl,
} from '../../src/searchapi/params.js';
import { SENTINELS } from '../fakes.js';

const rect = {
  kind: 'rectangle',
  departFrom: asIsoDate('2026-11-02'),
  departTo: asIsoDate('2026-11-10'),
  returnFrom: asIsoDate('2026-11-12'),
  returnTo: asIsoDate('2026-12-01'),
} as const;
const calQ = { origin: asIata('LHR'), destination: asIata('JFK'), cabin: 'economy' as const };
const cellQ: ItineraryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2026-11-02'),
  returnDate: asIsoDate('2026-11-14'),
  cabin: 'economy',
  adults: 1,
  currency: 'GBP',
  expandTop: 2,
  bookingLinks: true,
};
const allowed = (params: Record<string, string>) => () =>
  assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, toUrl(params));

describe('SEARCHAPI_PARAMS (spec §5.2 dated allowlist, plan decision 24)', () => {
  it('has the two engine-qualified keys, names ascending, and a hash computed over its content', () => {
    expect(Object.keys(SEARCHAPI_PARAMS.endpoints).sort()).toEqual([
      '/api/v1/search?engine=google_flights',
      '/api/v1/search?engine=google_flights_calendar',
    ]);
    for (const e of Object.values(SEARCHAPI_PARAMS.endpoints)) expect(e.names).toEqual([...e.names].sort());
    const { contentSha256, ...rest } = SEARCHAPI_PARAMS;
    expect(withContentHash(rest).contentSha256).toBe(contentSha256);
  });

  it('sends adults=1, travel_class and separate_tickets=1 on both engines, sort_by=price on google_flights, never stops (decision 29)', () => {
    const cal = SEARCHAPI_PARAMS.endpoints['/api/v1/search?engine=google_flights_calendar'];
    const fl = SEARCHAPI_PARAMS.endpoints['/api/v1/search?engine=google_flights'];
    expect(cal?.values).toMatchObject({
      separate_tickets: ['1'],
      adults: ['1'],
      travel_class: ['business', 'economy', 'first_class', 'premium_economy'],
    });
    expect(fl?.values).toMatchObject({ adults: ['1'], sort_by: ['price'], separate_tickets: ['1'] });
    expect(cal?.names).not.toContain('stops');
    expect(fl?.names).not.toContain('stops');
    expect(cal?.names).not.toContain('sort_by');
  });
});

describe('request builders (spec §5.2 point of sale, §5.4 travel_class)', () => {
  it('calendar parameters: exact names and values, gl = POINT_OF_SALE lower-cased, hl=en, currency=GBP', () => {
    const p = calendarParams(calQ, rect, 'GB');
    expect(p).toEqual({
      engine: 'google_flights_calendar',
      departure_id: 'LHR',
      arrival_id: 'JFK',
      flight_type: 'round_trip',
      outbound_date: '2026-11-02',
      outbound_date_start: '2026-11-02',
      outbound_date_end: '2026-11-10',
      return_date: '2026-11-12',
      return_date_start: '2026-11-12',
      return_date_end: '2026-12-01',
      separate_tickets: '1',
      travel_class: 'economy',
      adults: '1',
      currency: 'GBP',
      gl: 'gb',
      hl: 'en',
    });
    expect(allowed(p)).not.toThrow();
  });

  it.each([
    ['economy', 'economy'],
    ['premium_economy', 'premium_economy'],
    ['business', 'business'],
    ['first', 'first_class'],
  ] as const)('cabin %s maps to travel_class %s on both engines', (cabin, value) => {
    expect(TRAVEL_CLASS[cabin]).toBe(value);
    expect(calendarParams({ ...calQ, cabin }, rect, 'GB').travel_class).toBe(value);
    expect(flightsParams({ ...cellQ, cabin }, 'GB').travel_class).toBe(value);
    expect(allowed(flightsParams({ ...cellQ, cabin }, 'GB'))).not.toThrow();
  });

  it('itinerary steps carry exactly the google_flights names; steps 2 and 3 add one token', () => {
    const s1 = flightsParams(cellQ, 'GB');
    expect(Object.keys(s1).sort()).toEqual([
      'adults',
      'arrival_id',
      'currency',
      'departure_id',
      'engine',
      'flight_type',
      'gl',
      'hl',
      'outbound_date',
      'return_date',
      'separate_tickets',
      'sort_by',
      'travel_class',
    ]);
    expect(flightsParams(cellQ, 'GB', { departure_token: 'tok' })).toEqual({ ...s1, departure_token: 'tok' });
    expect(flightsParams(cellQ, 'GB', { booking_token: 'tok' })).toEqual({ ...s1, booking_token: 'tok' });
    expect(allowed({ ...s1, booking_token: 'tok' })).not.toThrow();
  });

  it('ignores ItineraryQuery.maxStops: no stops parameter is ever sent (recorded gap, §13)', () => {
    expect(flightsParams({ ...cellQ, maxStops: 0 }, 'GB')).toEqual(flightsParams(cellQ, 'GB'));
  });

  it('holds each engine to its own names', () => {
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), departure_token: 'tok' })).toThrow();
    expect(allowed({ ...flightsParams(cellQ, 'GB'), outbound_date_start: '2026-11-02' })).toThrow();
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), sort_by: 'price' })).toThrow();
  });

  it('refuses an unknown name, a disallowed value and a stops filter', () => {
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), api_key: 'x' })).toThrow();
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), currency: 'USD' })).toThrow();
    expect(allowed({ ...flightsParams(cellQ, 'GB'), stops: 'nonstop' })).toThrow();
    expect(allowed({ ...flightsParams(cellQ, 'GB'), separate_tickets: '0' })).toThrow();
    expect(allowed({ ...calendarParams(calQ, rect, 'US') })).toThrow();
  });

  it('puts the key in Authorization: Bearer only, never in the URL (spec §2 fact 8)', () => {
    const key = SENTINELS.searchapi;
    expect(authHeaders(key)).toEqual({ Authorization: `Bearer ${key.reveal()}`, Accept: 'application/json' });
    expect(toUrl(flightsParams(cellQ, 'GB')).href).not.toContain(key.reveal());
  });
});

describe('assertPointOfSaleAllowed (spec §5.2)', () => {
  it('accepts the recorded point of sale and refuses another or a malformed one', () => {
    expect(() => assertPointOfSaleAllowed(SEARCHAPI_PARAMS, 'GB')).not.toThrow();
    expect(() => assertPointOfSaleAllowed(SEARCHAPI_PARAMS, 'US')).toThrow(
      /not in the .* SearchApi allowlist/,
    );
    expect(() => assertPointOfSaleAllowed(SEARCHAPI_PARAMS, 'gb')).toThrow(/upper-case ISO 3166-1/);
  });

  it('accepts any point of sale when an allowlist lists gl as any', () => {
    const open = {
      ...SEARCHAPI_PARAMS,
      endpoints: { '/api/v1/search': { names: ['gl'], values: { gl: 'any' as const } } },
    };
    expect(() => assertPointOfSaleAllowed(open, 'US')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/params.test.ts`
Expected: FAIL. `../../src/searchapi/params.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/params.ts
import {
  asIsoDate,
  type Cabin,
  type DiscoveryQuery,
  type IsoDate,
  type ItineraryQuery,
  type Secret,
  type TileRequest,
} from '@gmt/core';
import { withContentHash } from '../http/recorder.js';
import type { ParamsAllowlist } from '../params/allowlist.js';
import type { ParseWhere } from '../shared/errors.js';

/** SearchApi's single host; `searchApiHttpLimits` gives it to http-kit as the egress allowlist (spec §5.3). */
export const SEARCHAPI_HOST = 'www.searchapi.io';
/** Both engines share one endpoint; `engine` selects calendar or itinerary (vendor docs, 2026-10-14). */
export const SEARCHAPI_ENDPOINT = `https://${SEARCHAPI_HOST}/api/v1/search`;
/** Path only, as written to `provider_requests.endpoint_path` (spec §5.3: no query). */
export const SEARCHAPI_ENDPOINT_PATH = '/api/v1/search';

/** Passed to every shared `parseError`/`parseVendor` call, so parse errors carry `providerId` and the path prefix. */
export const SEARCHAPI_WHERE: ParseWhere = { providerId: 'searchapi', endpointPath: SEARCHAPI_ENDPOINT_PATH };

/** Cabin → vendor `travel_class` (spec §5.4: `first` is `first_class`). */
export const TRAVEL_CLASS: Readonly<Record<Cabin, string>> = {
  economy: 'economy',
  premium_economy: 'premium_economy',
  business: 'business',
  first: 'first_class',
};

/**
 * `sort_by` value for `google_flights` (vendor default `top_flights`; `price` is documented, read 2026-10-15),
 * so step 1's options arrive cheapest first (spec §5.4). The adapter still sorts locally: "cheapest" holds only
 * over the options the vendor returned.
 */
export const SORT_BY_PRICE = 'price';
/**
 * `separate_tickets` value for both engines. Both docs pages say "Set to `1` to hide separate and self-transfer
 * tickets, or `0` to show them" (default `0`; re-read 2026-10-15). Sent on both, so discovery ranks cells by the
 * same kind of fare verification searches (plan decision 29). ItineraryQuery carries no self-transfer permission
 * (a Phase 4 gap, decision 27), so the adapter always excludes them and never states `selfTransfer`.
 */
export const EXCLUDE_SEPARATE_TICKETS = '1';

// why: the date of WP4b's recording run; the Task 5.9 test fails until it equals the recorded file's
// recordedAt (print it with the command in Task 5.9 Step 3). The hash is computed, never copied.
const RECORDED_AT: IsoDate = asIsoDate('2026-10-15');

const TRAVEL_CLASSES = ['business', 'economy', 'first_class', 'premium_economy'];
const CALENDAR_KEY = `${SEARCHAPI_ENDPOINT_PATH}?engine=google_flights_calendar`;
const FLIGHTS_KEY = `${SEARCHAPI_ENDPOINT_PATH}?engine=google_flights`;

/**
 * Every parameter name and value this adapter may send (spec §5.2), in WP4's `ParamsAllowlist` shape, equal to
 * WP4b's recorded `params-<date>.json` (plan decision 24). Both engines share `/api/v1/search`, so each has an
 * engine-qualified key and `assertRequestAllowed` holds it to its own names. `gl` is the recorded point of
 * sale only; another POINT_OF_SALE needs a new recording (the constructor refuses it).
 */
export const SEARCHAPI_PARAMS: ParamsAllowlist = withContentHash({
  provider: 'searchapi',
  recordedAt: RECORDED_AT,
  endpoints: {
    [CALENDAR_KEY]: {
      names: [
        'adults',
        'arrival_id',
        'currency',
        'departure_id',
        'engine',
        'flight_type',
        'gl',
        'hl',
        'outbound_date',
        'outbound_date_end',
        'outbound_date_start',
        'return_date',
        'return_date_end',
        'return_date_start',
        'separate_tickets',
        'travel_class',
      ],
      values: {
        adults: ['1'],
        arrival_id: 'any',
        currency: ['GBP'],
        departure_id: 'any',
        engine: ['google_flights_calendar'],
        flight_type: ['round_trip'],
        gl: ['gb'],
        hl: ['en'],
        outbound_date: 'any',
        outbound_date_end: 'any',
        outbound_date_start: 'any',
        return_date: 'any',
        return_date_end: 'any',
        return_date_start: 'any',
        separate_tickets: [EXCLUDE_SEPARATE_TICKETS],
        travel_class: TRAVEL_CLASSES,
      },
    },
    [FLIGHTS_KEY]: {
      names: [
        'adults',
        'arrival_id',
        'booking_token',
        'currency',
        'departure_id',
        'departure_token',
        'engine',
        'flight_type',
        'gl',
        'hl',
        'outbound_date',
        'return_date',
        'separate_tickets',
        'sort_by',
        'travel_class',
      ],
      values: {
        adults: ['1'],
        arrival_id: 'any',
        booking_token: 'any',
        currency: ['GBP'],
        departure_id: 'any',
        departure_token: 'any',
        engine: ['google_flights'],
        flight_type: ['round_trip'],
        gl: ['gb'],
        hl: ['en'],
        outbound_date: 'any',
        return_date: 'any',
        separate_tickets: [EXCLUDE_SEPARATE_TICKETS],
        sort_by: [SORT_BY_PRICE],
        travel_class: TRAVEL_CLASSES,
      },
    },
  },
});

/**
 * Refuses a POINT_OF_SALE the allowlist cannot send (spec §5.2: `gl` is POINT_OF_SALE lower-cased, and the
 * dated allowlist names values). Called by the constructor, so a misconfiguration fails at boot rather than as
 * a refused request on every tile.
 */
export function assertPointOfSaleAllowed(allow: ParamsAllowlist, pointOfSale: string): void {
  if (!/^[A-Z]{2}$/.test(pointOfSale))
    throw new TypeError(`POINT_OF_SALE must be an upper-case ISO 3166-1 alpha-2 code; got ${pointOfSale}`);
  for (const entry of Object.values(allow.endpoints)) {
    const gl = entry.values.gl;
    if (gl !== undefined && gl !== 'any' && !gl.includes(pointOfSale.toLowerCase()))
      throw new TypeError(
        `POINT_OF_SALE ${pointOfSale} is not in the ${allow.recordedAt} SearchApi allowlist (gl: ${gl.join(', ')}); record fixtures for it first`,
      );
  }
}

/** Spec §5.2 point of sale: GBP and English hard-coded, `gl` from POINT_OF_SALE; one adult (ItineraryQuery.adults is 1). */
function common(pointOfSale: string, cabin: Cabin): Record<string, string> {
  return {
    adults: '1',
    currency: 'GBP',
    gl: pointOfSale.toLowerCase(),
    hl: 'en',
    travel_class: TRAVEL_CLASS[cabin],
  };
}

/** `google_flights_calendar` parameters for one rectangle; `outbound_date`/`return_date` are vendor-required even with ranges. */
export function calendarParams(
  q: Pick<DiscoveryQuery, 'origin' | 'destination' | 'cabin'>,
  r: Extract<TileRequest, { kind: 'rectangle' }>,
  pointOfSale: string,
): Record<string, string> {
  return {
    engine: 'google_flights_calendar',
    departure_id: q.origin,
    arrival_id: q.destination,
    flight_type: 'round_trip',
    outbound_date: r.departFrom,
    outbound_date_start: r.departFrom,
    outbound_date_end: r.departTo,
    return_date: r.returnFrom,
    return_date_start: r.returnFrom,
    return_date_end: r.returnTo,
    separate_tickets: EXCLUDE_SEPARATE_TICKETS,
    ...common(pointOfSale, q.cabin),
  };
}

/**
 * `google_flights` parameters for one cell (spec §5.4). Steps 2 and 3 resend them plus one token: the docs show
 * this for `booking_token`; for `departure_token` it is evidenced by WP4b's SA-05 recording, not by the docs.
 * No `stops`: DiscoveryQuery has no maxStops, so neither engine filters stops (§13, Phase 4 gap).
 */
export function flightsParams(
  q: ItineraryQuery,
  pointOfSale: string,
  token?: { departure_token: string } | { booking_token: string },
): Record<string, string> {
  const p: Record<string, string> = {
    engine: 'google_flights',
    departure_id: q.origin,
    arrival_id: q.destination,
    flight_type: 'round_trip',
    outbound_date: q.departureDate,
    return_date: q.returnDate,
    sort_by: SORT_BY_PRICE,
    separate_tickets: EXCLUDE_SEPARATE_TICKETS,
    ...common(pointOfSale, q.cabin),
  };
  return token === undefined ? p : { ...p, ...token };
}

/** The request URL: endpoint plus the given parameters, nothing else (the key never travels in a URL). */
export function toUrl(params: Readonly<Record<string, string>>): URL {
  const u = new URL(SEARCHAPI_ENDPOINT);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

/** The one place the key is revealed: an Authorization header (spec §2 fact 8, §5.3). */
export function authHeaders(key: Secret): Record<string, string> {
  return { Authorization: `Bearer ${key.reveal()}`, Accept: 'application/json' };
}
```

`RECORDED_AT` is a stand-in until Task 5.9 compares the constant with WP4b's file; the hash is computed with WP4's `withContentHash`, never copied. The names and values are WP4b's recorded allowlist exactly (WP4b brief at 8014bdf, plan decisions 24 and 29); if Task 5.9 reports any difference other than `recordedAt`, the recording and this constant disagree on what the adapter sends: resolve it with Fable, never edit either side to match.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/params.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SEARCHAPI_PARAMS mirrors the recorded allowlist; request builders (spec §5.2, decision 24)"
```

### Task 5.3: Error classification, http limits and the error table through http-kit

**Files:** create `src/searchapi/limits.ts`, `test/searchapi/support/kit.ts`, `test/searchapi/support/synthetic.ts` and `test/searchapi/errors.test.ts`.

**Interfaces:** consumes `ProviderError`, `ProviderLimits`, `PLAN_PRESETS`, `Config`, `ProviderHttpLimits`, `ResponseFacts`, `isRecord`, and the test harness (`makeKit`, `FakeBudget`, `LedgerEvent`, `SENTINELS`, `server`, `useFakeTime`, `drive`, `driveError`, `asProviderError`). Produces `classifySearchApiError`, `searchApiHttpLimits`, and the test helpers `saKit`, `saLimits`, `KEY`, `ctx`, `sentUrls`, `assertEverySentAllowed`, `syntheticHandler` and the synthetic builders.

The 429 rows are synthetic and labelled (plan decision 20): the vendor documents no 429 body or headers and WP4b makes no 429 burst, so these tests pin http-kit's behaviour with SearchApi's limits (no `rateLimitFallbackWaitSeconds`, spec §5.2), not the vendor's; Retry-After behaviour stays unverified against the vendor.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/support/kit.ts
// The real http-kit (WP4) over the package's fakes (test/fakes.ts), with SearchApi's own limits.
import { PLAN_PRESETS, type ProviderContext } from '@gmt/core';
import type { ProviderHttpLimits } from '../../../src/http/types.js';
import { assertRequestAllowed } from '../../../src/params/allowlist.js';
import { searchApiHttpLimits } from '../../../src/searchapi/limits.js';
import { SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_PARAMS } from '../../../src/searchapi/params.js';
import { type FakeBudget, type LedgerEvent, makeKit, SENTINELS } from '../../fakes.js';

/** The sentinel key: asserted never to reach any sink but the Authorization header (spec §5.3). */
export const KEY = SENTINELS.searchapi;

/** SearchApi limits as wired, with generous rates so bottleneck never queues a chain; classification unchanged. */
export function saLimits(over: Partial<ProviderHttpLimits> = {}): ProviderHttpLimits {
  return {
    ...searchApiHttpLimits(PLAN_PRESETS['40usd'], { maxWaitSeconds: 3900, requestTimeoutSeconds: 60 }),
    ratePerMinute: 600,
    ratePerHour: 36_000,
    concurrency: 4,
    ...over,
  };
}

const logs: LedgerEvent[][] = [];

/** makeKit with only the searchapi limits and syntheticAllowed false, as production wiring builds it. */
export function saKit(o: { budget?: FakeBudget; limits?: Partial<ProviderHttpLimits> } = {}) {
  const k = makeKit({
    limits: { searchapi: saLimits(o.limits) },
    syntheticAllowed: false,
    ...(o.budget === undefined ? {} : { budget: o.budget }),
  });
  logs.push(k.events);
  return k;
}

/** Upstream request URLs msw saw, from makeKit's fetch events. */
export function sentUrls(events: readonly LedgerEvent[]): URL[] {
  return events.flatMap((e) => (e.type === 'fetch' ? [new URL(e.url)] : []));
}

/**
 * Spec §5.2 / §9 item 2: every request any kit sent since the last call has names and values in the dated
 * allowlist. Each test file calls it in afterEach.
 */
export function assertEverySentAllowed(): void {
  for (const url of logs.splice(0).flatMap(sentUrls))
    assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, url);
}

export function ctx(signal: AbortSignal = new AbortController().signal): ProviderContext {
  return { executionId: 'exec-test', signal, recordFixtures: false };
}
```

```ts
// test/searchapi/support/synthetic.ts
// Synthetic SearchApi shapes for cases the recordings do not contain. Every test using them says "(synthetic)"
// in its name; nothing here is written under fixtures/ or passed through the recorder. The drift test in
// recorded.test.ts checks these shapes' keys against the recorded bodies.
import { asIata, asIsoDate, type ItineraryQuery } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { SEARCHAPI_ENDPOINT } from '../../../src/searchapi/params.js';

export const ECHO = { search_parameters: { currency: 'GBP', gl: 'gb', hl: 'en' } };
export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}
export const ok = (body: unknown): Reply => ({ status: 200, body });

/** One handler answering every SearchApi request through `respond`, as replay does: a JSON text body. */
export function syntheticHandler(respond: (p: URLSearchParams) => Reply) {
  return http.get(SEARCHAPI_ENDPOINT, ({ request }) => {
    const r = respond(new URL(request.url).searchParams);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new HttpResponse(text, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  });
}

/** One vendor segment; carriers are clearly synthetic, airports the worked example's. */
export function seg(
  from: string,
  to: string,
  date: string,
  time: string,
  flightNumber: string,
  airline?: string,
  travelClass = 'Economy',
) {
  return {
    departure_airport: { id: from, date, time },
    arrival_airport: { id: to, date, time: '23:00' },
    ...(airline === undefined ? {} : { airline }),
    flight_number: flightNumber,
    travel_class: travelClass,
    duration: 420,
    airplane: 'Synthetic 787',
  };
}

export const OUT_A = [seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100', 'Synthetic Air One')];
export const OUT_B = [seg('LHR', 'JFK', '2026-11-02', '13:00', 'Y2 200', 'Synthetic Air Two')];
export const IN_1 = [seg('JFK', 'LHR', '2026-11-14', '18:00', 'X1 101', 'Synthetic Air One')];
export const IN_2 = [seg('JFK', 'LHR', '2026-11-14', '20:00', 'X1 103', 'Synthetic Air One')];
export const IN_3 = [seg('JFK', 'LHR', '2026-11-14', '22:00', 'X1 105', 'Synthetic Air One')];

export function option(
  flights: unknown[],
  price: number | undefined,
  token: { departure_token: string } | { booking_token: string },
) {
  return { flights, ...(price === undefined ? {} : { price }), ...token };
}
// why: WP4b's recorded step 1 and step 2 bodies carry their options under `other_flights` only (no `best_flights`,
// 2026-10-15 recordings), so the builder uses the recorded key and the drift guard holds; tests that need the
// documented `best_flights` key write it out explicitly.
export const flightsBody = (options: unknown[], extra: object = {}) => ({
  ...ECHO,
  other_flights: options,
  ...extra,
});
export const bookingBody = (options: unknown[]) => ({ ...ECHO, booking_options: options });
export const POST = { url: 'https://www.google.com/travel/clk/f', post_data: 'u=synthetic' };
export const agent = (price: number, bookWith = 'Synthetic Travel Agent') => ({
  book_with: bookWith,
  price,
  booking_request: POST,
});

/** The worked-example cell (spec §1). */
export const CELL_QUERY: ItineraryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2026-11-02'),
  returnDate: asIsoDate('2026-11-14'),
  cabin: 'economy',
  adults: 1,
  currency: 'GBP',
  expandTop: 2,
  bookingLinks: true,
};
```

```ts
// test/searchapi/errors.test.ts
import { PLAN_PRESETS } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpKitRequest } from '../../src/http/types.js';
import { classifySearchApiError, searchApiHttpLimits } from '../../src/searchapi/limits.js';
import { authHeaders, SEARCHAPI_ENDPOINT_PATH } from '../../src/searchapi/params.js';
import { asProviderError } from '../support/guards.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';
import { assertEverySentAllowed, KEY, saKit } from './support/kit.js';
import { ok, type Reply, syntheticHandler } from './support/synthetic.js';

// why: a calendar-shaped URL with allowlisted names; the classifier and http-kit see only status, body and headers.
const URL_ =
  'https://www.searchapi.io/api/v1/search?engine=google_flights_calendar&departure_id=LHR&arrival_id=JFK&flight_type=round_trip&outbound_date=2026-11-02&outbound_date_start=2026-11-02&outbound_date_end=2026-11-03&return_date=2026-11-12&return_date_start=2026-11-12&return_date_end=2026-11-14&travel_class=economy&adults=1&currency=GBP&gl=gb&hl=en';
const facts = (status: number, body: unknown) => ({
  status,
  body,
  headers: new Headers(),
  providerId: 'searchapi' as const,
  endpointPath: SEARCHAPI_ENDPOINT_PATH,
});
const request = (): HttpKitRequest => ({
  providerId: 'searchapi',
  executionId: 'exec-test',
  tileIndex: 0,
  endpointPath: SEARCHAPI_ENDPOINT_PATH,
  method: 'GET',
  url: new URL(URL_),
  headers: authHeaders(KEY),
  cache: 'never',
  signal: new AbortController().signal,
  recordFixtures: false,
});
/** The spike's recorded 401 body (spec §2 fact 5), reproduced as a synthetic labelled body. */
const INVALID_KEY_BODY = { error: 'Invalid API key.' };

beforeEach(() => useFakeTime());
afterEach(() => {
  vi.useRealTimers();
  assertEverySentAllowed();
});

/** Serves `replies` in order (the last repeats) and returns the kit with its ledger. */
function serve(...replies: Reply[]) {
  let n = 0;
  server.use(syntheticHandler(() => replies[Math.min(n++, replies.length - 1)] ?? ok({})));
  return saKit();
}

describe('classifySearchApiError (spec §5.2, §2 fact 5)', () => {
  it('recognises the recorded 401 body → auth, non-retryable, vendor text in the message, no reason (synthetic)', () => {
    const e = classifySearchApiError(facts(401, INVALID_KEY_BODY));
    expect(e).toMatchObject({ kind: 'auth', retryable: false, httpStatus: 401, providerId: 'searchapi' });
    expect(e?.reason).toBeUndefined();
    expect(e?.message).toContain('Invalid API key.');
  });

  it.each([
    ['a 401 with another body', 401, { error: 'something else' }],
    ['a 401 with a text body', 401, 'Unauthorized'],
    ['a 429 with no body', 429, null],
    ['a 429 with a quota-like body (no quota body is recorded)', 429, { error: 'Monthly quota exceeded' }],
    ['a 400', 400, { error: 'Unsupported value' }],
    ['a 500', 500, { error: 'boom' }],
  ] as const)('falls through to the default table for %s (synthetic)', (_label, status, body) => {
    expect(classifySearchApiError(facts(status, body))).toBeUndefined();
  });
});

describe('searchApiHttpLimits (spec §5.3, §5.2)', () => {
  it('maps plan limits, the one host, http-200, the configured cost and the classifier; no 429 fallback wait', () => {
    const l = searchApiHttpLimits(
      { ...PLAN_PRESETS['40usd'], costPerCallMicroGbp: 1234 },
      { maxWaitSeconds: 3900, requestTimeoutSeconds: 60 },
    );
    expect(l).toMatchObject({
      hosts: ['www.searchapi.io'],
      ratePerMinute: 10,
      ratePerHour: 2000,
      concurrency: 2,
      billable: 'http-200',
      costPerCallMicroGbp: 1234,
      maxWaitSeconds: 3900,
      requestTimeoutSeconds: 60,
    });
    expect(l.classifyError).toBe(classifySearchApiError);
    expect('rateLimitFallbackWaitSeconds' in l).toBe(false);
    expect(
      searchApiHttpLimits(PLAN_PRESETS.trial, { maxWaitSeconds: 1, requestTimeoutSeconds: 1 }),
    ).toMatchObject({ ratePerMinute: 2, ratePerHour: 20, concurrency: 1 });
  });
});

// why: plan decision 20: the vendor's 429 shape and headers are undocumented and unrecorded, so these bodies are
// synthetic and labelled, and the Retry-After rows record http-kit's behaviour, not the vendor's.
describe('error table through the real http-kit with SearchApi limits (spec §5.2, §9 item 2), synthetic', () => {
  it.each([
    ['the recorded 401 body', { status: 401, body: INVALID_KEY_BODY }, 'auth', /Invalid API key\./],
    ['a 401 with another body', { status: 401, body: { error: 'x' } }, 'auth', /HTTP 401/],
    ['a 403', { status: 403, body: { error: 'Forbidden' } }, 'auth', /HTTP 403/],
    ['a 402', { status: 402, body: { error: 'Payment required' } }, 'quota', /HTTP 402/],
    [
      'a 400 with a vendor message',
      { status: 400, body: { error: 'Unsupported value of travel_class' } },
      'parse',
      /Unsupported value of travel_class/,
    ],
    ['a 404', { status: 404, body: { error: 'Not found' } }, 'upstream', /HTTP 404/],
    ['an HTML 200', { status: 200, body: '<html>maintenance</html>' }, 'parse', /malformed-json/],
  ] as const)(
    '%s → %s, non-retryable, one attempt, no reason (synthetic)',
    async (_label, reply, kind, message) => {
      const k = serve(reply);
      const err = asProviderError(await driveError(k.kit.request(request())));
      expect(err).toMatchObject({ kind, retryable: false, providerId: 'searchapi' });
      expect(err.reason).toBeUndefined();
      expect(err.message).toMatch(message);
      expect(k.budget.count('reserve')).toBe(1);
    },
  );

  it('a header-less 429 → non-retryable rate-limit with the hourly retry time, one attempt (synthetic)', async () => {
    const k = serve({ status: 429, body: { error: 'Too many requests' } });
    const err = asProviderError(await driveError(k.kit.request(request())));
    expect(err).toMatchObject({ kind: 'rate-limit', retryable: false, httpStatus: 429 });
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(err.message).toMatch(/no-retry-after/);
    expect(k.budget.count('reserve')).toBe(1);
  });

  it('a 429 with ratelimit headers but no Retry-After is treated as header-less (vendor headers unverified) (synthetic)', async () => {
    const k = serve({
      status: 429,
      body: null,
      headers: { 'x-ratelimit-remaining': '0', 'ratelimit-reset': '120' },
    });
    const err = asProviderError(await driveError(k.kit.request(request())));
    expect(err).toMatchObject({ kind: 'rate-limit', retryable: false });
    expect(k.budget.count('reserve')).toBe(1);
  });

  it('a 429 with a quota-like body stays rate-limit: no quota body is recorded (synthetic)', async () => {
    const k = serve({ status: 429, body: { error: 'Monthly quota exceeded' } });
    expect(asProviderError(await driveError(k.kit.request(request()))).kind).toBe('rate-limit');
  });

  it('a 429 with Retry-After: 30 waits and retries; the retry succeeds (synthetic)', async () => {
    const k = serve({ status: 429, body: null, headers: { 'retry-after': '30' } }, ok({ calendar: [] }));
    const t0 = Date.now();
    const res = await drive(k.kit.request(request()));
    expect(res.status).toBe(200);
    // why (review test-strategy 4): an immediate retry would also reach attempt 2; the wait itself is the behaviour.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(30_000);
    expect(k.budget.events.filter((e) => e.type === 'reserve').map((e) => e.httpAttempt)).toEqual([1, 2]);
  });

  it('a 429 asking to wait beyond MAX_WAIT_SECONDS → limiter-timeout, no retry (synthetic)', async () => {
    const k = serve({ status: 429, body: null, headers: { 'retry-after': '99999' } });
    const err = asProviderError(await driveError(k.kit.request(request())));
    expect(err).toMatchObject({ kind: 'limiter-timeout', retryable: false, retryAfterSeconds: 99999 });
    expect(k.budget.count('reserve')).toBe(1);
  });

  it.each([500, 503])(
    'a %i → upstream, retried by http-kit to three attempts, then thrown (synthetic)',
    async (status) => {
      const k = serve({ status, body: { error: 'boom' } });
      const err = asProviderError(await driveError(k.kit.request(request())));
      expect(err).toMatchObject({ kind: 'upstream', httpStatus: status });
      expect(k.budget.count('reserve')).toBe(3);
    },
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/errors.test.ts`
Expected: FAIL. `../../src/searchapi/limits.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/limits.ts
/**
 * SearchApi HTTP limits for http-kit, with the classifier they carry (spec §5.2, §5.3). The module name follows
 * travelpayouts/limits.ts; registered by apps/api httpLimitsFor (Task 5.10).
 */
import { type Config, ProviderError, type ProviderLimits } from '@gmt/core';
import type { ProviderHttpLimits, ResponseFacts } from '../http/types.js';
import { isRecord } from '../util.js';
import { SEARCHAPI_HOST } from './params.js';

/** The 401 body the spike recorded (spec §2 fact 5). */
const INVALID_KEY = 'Invalid API key.';

/**
 * http-kit's `classifyError` hook for SearchApi (spec §5.2, plan decision 15). It recognises SearchApi bodies
 * only and returns `undefined` for everything else, so http-kit's default table applies (401/403 auth, 402
 * quota, 400 parse with the vendor message, 404 upstream, 429 rate-limit, 5xx upstream); http-kit then applies
 * Retry-After, the hourly fallback for a header-less 429, limiter-timeout and scrubbing. Recognised today: the
 * recorded 401 body, so its vendor text reaches `last_error`. No quota body has been recorded (spec §2 fact 5),
 * so a 429 is never `quota`. `reason` stays unset: the outcome reason is the kind (spec §3).
 */
export function classifySearchApiError(f: ResponseFacts): ProviderError | undefined {
  const error = isRecord(f.body) ? f.body.error : undefined;
  if (f.status === 401 && error === INVALID_KEY) {
    return new ProviderError({
      kind: 'auth',
      retryable: false,
      httpStatus: 401,
      providerId: 'searchapi',
      message: `searchapi ${f.endpointPath}: HTTP 401 (${INVALID_KEY})`,
    });
  }
  return undefined;
}

/**
 * SearchApi's http-kit limits (plan contract). `billable: 'http-200'` makes a timeout non-retryable. No
 * `rateLimitFallbackWaitSeconds`: spec §5.2 configures none for SearchApi, so a 429 without Retry-After is
 * non-retryable `rate-limit` with a retry time at the hourly refresh. The vendor's 429 headers are undocumented
 * and unrecorded (plan decision 20), so that rule is the only one tested against synthetic labelled bodies.
 */
export function searchApiHttpLimits(
  limits: ProviderLimits,
  cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>,
): ProviderHttpLimits {
  return {
    hosts: [SEARCHAPI_HOST],
    ratePerMinute: limits.ratePerMinute,
    ratePerHour: limits.ratePerHour,
    concurrency: limits.concurrency,
    billable: 'http-200',
    costPerCallMicroGbp: limits.costPerCallMicroGbp,
    maxWaitSeconds: cfg.maxWaitSeconds,
    requestTimeoutSeconds: cfg.requestTimeoutSeconds,
    classifyError: classifySearchApiError,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/errors.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi classifier, http limits and the error table through http-kit (spec §5.2, decision 20)"
```

### Task 5.4: Calendar tile fetch and parse

**Files:** create `src/searchapi/shapes.ts` and `test/searchapi/calendar.test.ts`. Replace `src/searchapi/calendar.ts` with the full file below (the tiling part is unchanged; the imports grow and the fetch is appended).

**Interfaces:** consumes `HttpKit`, `ProviderContext`, `DiscoveryTileResult`, `CellIssue`, `RawCalendarPrice`, `ProviderError`, `MINOR_EXPONENT`, `isoDateSchema`, `cellKeyString`, WP6's `majorToMinor`, `parseError`, `parseVendor` and `NoteCounter`. Produces `fetchCalendarTile`, `parseCalendarBody`, `CalendarDeps`, `ParsedCalendar`, and in `shapes.ts` the vendor schemas, `readEcho`, `currencySupported`, `Minor`, `minorOrDrop`. A row carrying both `has_no_flights: true` and a price is a stated fare: priced (or dropped and reported), its cell counted `conflicting-entries`, never "no fares".

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/calendar.test.ts
import {
  AbortedError,
  addDays,
  asIata,
  asIsoDate,
  asIsoMonth,
  BudgetExceeded,
  cellKeyString,
  type DiscoveryQuery,
  type TilePlan,
} from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type ParamsAllowlist, ParamsNotAllowedError } from '../../src/params/allowlist.js';
import { type CalendarDeps, fetchCalendarTile, planRectangles } from '../../src/searchapi/calendar.js';
import { SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { FakeBudget } from '../fakes.js';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, KEY, saKit, sentUrls } from './support/kit.js';
import { ECHO, ok, type Reply, syntheticHandler } from './support/synthetic.js';

afterEach(() => assertEverySentAllowed());

const TTL = 3600;
const deps = (k = saKit()): CalendarDeps & { k: ReturnType<typeof saKit> } => ({
  http: k.kit,
  log: k.log,
  key: KEY,
  pointOfSale: 'GB',
  allowlist: SEARCHAPI_PARAMS,
  cacheTtlSeconds: TTL,
  k,
});
const small: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2026-11-02'),
  departureTo: asIsoDate('2026-11-04'),
  minNights: 10,
  maxNights: 12,
  cabin: 'economy',
  currency: 'GBP',
};
const smallPlan = (): TilePlan => {
  const [t, ...rest] = planRectangles(small);
  if (t === undefined || rest.length > 0) throw new Error('expected one tile');
  return t;
};
type Entry = Record<string, unknown>;
/** A calendar body with one entry per covered cell priced 500, plus `extra` entries. */
const gridFor = (plan: TilePlan, extra: Entry[] = [], echo: object = ECHO): { calendar: Entry[] } => ({
  ...echo,
  calendar: [
    ...plan.coveredCells.map(
      (c): Entry => ({ departure: c.departureDate, return: c.returnDate, price: 500 }),
    ),
    ...extra,
  ],
});
const answer = (reply: Reply) => server.use(syntheticHandler(() => reply));
async function tileOf(plan: TilePlan, q: DiscoveryQuery = small, d = deps()) {
  const res = await fetchCalendarTile(d, plan, q, ctx());
  if (res.kind !== 'tile') throw new Error(`expected a tile, got ${res.error.message}`);
  return res;
}
async function errorOf(plan: TilePlan, q: DiscoveryQuery = small) {
  const res = await fetchCalendarTile(deps(), plan, q, ctx());
  if (res.kind !== 'tile-error') throw new Error('expected a tile-error');
  return res.error;
}

describe('fetchTile request and ledger (spec §5.2, §8.1 parity), synthetic', () => {
  it('plan().length equals upstream hits over a 3-tile scan; each reserve carries its tile index, attempt 1 (synthetic)', async () => {
    const q: DiscoveryQuery = {
      ...small,
      departureTo: addDays(small.departureFrom, 23),
      minNights: 10,
      maxNights: 21,
    };
    const plans = planRectangles(q);
    expect(plans).toHaveLength(3); // 24 departure days in blocks of 9
    // why: answer every rectangle combination, so out-of-band entries exist and must be dropped.
    server.use(
      syntheticHandler((p) => {
        const calendar: Entry[] = [];
        for (
          let d = asIsoDate(p.get('outbound_date_start') ?? '');
          d <= asIsoDate(p.get('outbound_date_end') ?? '');
          d = addDays(d, 1)
        )
          for (
            let r = asIsoDate(p.get('return_date_start') ?? '');
            r <= asIsoDate(p.get('return_date_end') ?? '');
            r = addDays(r, 1)
          )
            calendar.push({ departure: d, return: r, price: 480 });
        return ok({ ...ECHO, calendar });
      }),
    );
    const d = deps();
    for (const plan of plans) {
      const res = await tileOf(plan, q, d);
      expect(res.prices).toHaveLength(plan.coveredCells.length);
      expect(res.notes.some((n) => n.startsWith('dropped-outside-tile:'))).toBe(true);
    }
    expect(sentUrls(d.k.events)).toHaveLength(plans.length);
    expect(d.k.events.flatMap((e) => (e.type === 'reserve' ? [[e.tileIndex, e.httpAttempt]] : []))).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it('sends the key only as Authorization: Bearer, travel_class=first_class for first, gl=gb (synthetic)', async () => {
    const plan = smallPlan();
    answer(ok(gridFor(plan)));
    const d = deps();
    await tileOf(plan, { ...small, cabin: 'first' }, d);
    const fetches = d.k.events.flatMap((e) => (e.type === 'fetch' ? [e] : []));
    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.headers.authorization).toBe(`Bearer ${KEY.reveal()}`);
    expect(fetches[0]?.url).not.toContain(KEY.reveal());
    const p = new URL(fetches[0]?.url ?? '').searchParams;
    expect(p.get('travel_class')).toBe('first_class');
    expect(p.get('gl')).toBe('gb');
    expect(p.get('adults')).toBe('1');
  });

  it('a repeat within the TTL is a cache hit: one reserve, one cache-hit row with the tile index, the original fetchedAt (synthetic)', async () => {
    const plan = smallPlan();
    answer(ok(gridFor(plan)));
    const d = deps();
    const one = await tileOf(plan, small, d);
    d.k.clock.advance(60_000);
    const two = await tileOf(plan, small, d);
    expect(sentUrls(d.k.events)).toHaveLength(1);
    expect(two.fetchedAt).toBe(one.fetchedAt);
    expect(
      d.k.events.flatMap((e) =>
        e.type === 'reserve' || e.type === 'cache-hit' ? [[e.type, e.tileIndex]] : [],
      ),
    ).toEqual([
      ['reserve', plan.index],
      ['cache-hit', plan.index],
    ]);
    // why: expiry is the cache port's (WP3); the adapter's part is passing SEARCHAPI_CACHE_TTL_HOURS through.
    expect(d.k.cache.sets.map((s) => s.ttlSeconds)).toEqual([TTL]);
  });

  it('a grid the parser rejects is never cached: the repeat goes upstream again (plan decision 15) (synthetic)', async () => {
    answer(ok({ ...ECHO, calendar: [] }));
    const d = deps();
    await fetchCalendarTile(d, smallPlan(), small, ctx());
    await fetchCalendarTile(d, smallPlan(), small, ctx());
    expect(sentUrls(d.k.events)).toHaveLength(2);
    expect(d.k.cache.sets).toHaveLength(0);
  });

  it('asserts ≤200 combinations before reserve: no ledger row, no request (spec §5.2)', async () => {
    const d = deps();
    const tooBig: TilePlan = {
      index: 0,
      coveredCells: [],
      request: {
        kind: 'rectangle',
        departFrom: asIsoDate('2026-11-01'),
        departTo: asIsoDate('2026-11-10'),
        returnFrom: asIsoDate('2026-11-11'),
        returnTo: asIsoDate('2026-12-01'),
      },
    };
    await expect(fetchCalendarTile(d, tooBig, small, ctx())).rejects.toThrow(/210 combinations/);
    expect(d.k.events).toEqual([]);
  });

  it('a rectangle of exactly 200 combinations is sent; 201 is refused before reserve (synthetic)', async () => {
    answer(ok({ ...ECHO, calendar: [{ departure: '2026-11-01', return: '2026-11-11', price: 480 }] }));
    const rect = (departTo: string, returnTo: string): TilePlan => ({
      index: 0,
      coveredCells: [],
      request: {
        kind: 'rectangle',
        departFrom: asIsoDate('2026-11-01'),
        departTo: asIsoDate(departTo),
        returnFrom: asIsoDate('2026-11-11'),
        returnTo: asIsoDate(returnTo),
      },
    });
    const d = deps();
    expect((await fetchCalendarTile(d, rect('2026-11-10', '2026-11-30'), small, ctx())).kind).toBe('tile'); // 10 × 20
    expect(sentUrls(d.k.events)).toHaveLength(1);
    const e = deps();
    await expect(fetchCalendarTile(e, rect('2026-11-03', '2027-01-16'), small, ctx())).rejects.toThrow(
      /201 combinations/,
    ); // 3 × 67
    expect(e.k.events).toEqual([]);
  });

  it('a request the allowlist refuses never reaches reserve or the network (adapter-level check)', async () => {
    const key = '/api/v1/search?engine=google_flights_calendar';
    // why: a restrictive allowlist (hl fr only) makes the adapter's own pre-request check the one that must refuse.
    const strict: ParamsAllowlist = {
      ...SEARCHAPI_PARAMS,
      endpoints: Object.fromEntries(
        Object.entries(SEARCHAPI_PARAMS.endpoints).map(([k, e]) => [
          k,
          k === key ? { ...e, values: { ...e.values, hl: ['fr'] } } : e,
        ]),
      ),
    };
    const d = { ...deps(), allowlist: strict };
    await expect(fetchCalendarTile(d, smallPlan(), small, ctx())).rejects.toBeInstanceOf(
      ParamsNotAllowedError,
    );
    expect(d.k.events).toEqual([]);
  });

  it('refuses a non-rectangle tile before any request', async () => {
    const d = deps();
    const plan: TilePlan = {
      index: 0,
      coveredCells: [],
      request: { kind: 'month', month: asIsoMonth('2026-11') },
    };
    await expect(fetchCalendarTile(d, plan, small, ctx())).rejects.toThrow(/rectangle/);
    expect(d.k.events).toEqual([]);
  });

  it('BudgetExceeded propagates rather than becoming a tile-error, and nothing is sent', async () => {
    const budget = new FakeBudget([]);
    budget.refuse = () =>
      new BudgetExceeded({
        scope: 'provider-month',
        cap: 1,
        current: 1,
        requested: 1,
        providerId: 'searchapi',
      });
    const d = deps(saKit({ budget }));
    await expect(fetchCalendarTile(d, smallPlan(), small, ctx())).rejects.toBeInstanceOf(BudgetExceeded);
    expect(sentUrls(d.k.events)).toHaveLength(0);
  });

  it('an aborted signal propagates AbortedError, never a tile-error', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(fetchCalendarTile(deps(), smallPlan(), small, ctx(ac.signal))).rejects.toBeInstanceOf(
      AbortedError,
    );
  });

  it('an HTTP error becomes a tile-error for exactly this tile (synthetic 401)', async () => {
    answer({ status: 401, body: { error: 'Invalid API key.' } });
    const plan = smallPlan();
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    expect(res).toMatchObject({
      kind: 'tile-error',
      index: plan.index,
      coveredCells: plan.coveredCells,
      error: { kind: 'auth', retryable: false },
    });
  });
});

describe('fetchTile parsing (spec §5.2), synthetic shapes', () => {
  it('response-keyed prices in minor units, currency and pointOfSale from the echo, fetchedAt from http-kit (synthetic)', async () => {
    const plan = smallPlan();
    answer(ok(gridFor(plan)));
    const res = await tileOf(plan);
    expect(res.prices).toHaveLength(plan.coveredCells.length);
    expect(res.prices.every((p) => p.amountMinor === 50_000 && p.currency === 'GBP')).toBe(true);
    expect(new Set(res.prices.map(cellKeyString))).toEqual(new Set(plan.coveredCells.map(cellKeyString)));
    expect(res).toMatchObject({
      pointOfSale: 'GB',
      fetchedAt: '2026-10-14T15:00:00.000Z',
      noFares: [],
      notes: [],
    });
  });

  it('has_no_flights: true on an entry → that cell in noFares, no price (synthetic)', async () => {
    const plan = smallPlan();
    const [first] = plan.coveredCells;
    if (first === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: first.departureDate, return: first.returnDate, has_no_flights: true };
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([first]);
    expect(res.prices).toHaveLength(plan.coveredCells.length - 1);
  });

  it('a grid where every entry has no flights is a tile of noFares, not a parse error (synthetic)', async () => {
    const plan = smallPlan();
    answer(
      ok({
        ...ECHO,
        calendar: plan.coveredCells.map((c) => ({
          departure: c.departureDate,
          return: c.returnDate,
          has_no_flights: true,
        })),
      }),
    );
    const res = await tileOf(plan);
    expect(res.prices).toEqual([]);
    expect(res.noFares).toEqual(plan.coveredCells);
  });

  it('an empty grid under a passing ≤200 assertion → parse, never no_data (synthetic)', async () => {
    answer(ok({ ...ECHO, calendar: [] }));
    const e = await errorOf(smallPlan());
    expect(e).toMatchObject({ kind: 'parse', retryable: false });
    expect(e.message).toMatch(/empty-grid/);
  });

  it.each([
    [
      'states no currency',
      { calendar: [{ departure: '2026-11-02', return: '2026-11-12', price: 1 }] },
      /no-currency/,
    ],
    [
      'does not echo gl',
      {
        search_parameters: { currency: 'GBP' },
        calendar: [{ departure: '2026-11-02', return: '2026-11-12', price: 1 }],
      },
      /no-point-of-sale/,
    ],
    [
      'echoes another gl',
      {
        search_parameters: { currency: 'GBP', gl: 'us' },
        calendar: [{ departure: '2026-11-02', return: '2026-11-12', price: 1 }],
      },
      /point-of-sale-mismatch/,
    ],
    [
      'has a malformed envelope',
      { ...ECHO, calendar: 'nope' },
      /^(?=.*malformed-calendar)(?=.*calendar: Invalid input)/,
    ],
  ] as const)('a response that %s → parse (synthetic)', async (_label, body, message) => {
    answer(ok(body));
    const e = await errorOf(smallPlan());
    expect(e).toMatchObject({ kind: 'parse', retryable: false, providerId: 'searchapi' });
    expect(e.message).toMatch(message);
  });

  it('drops and counts entries outside the tile, outside the band, without a return, with an impossible date, or unpriced (synthetic)', async () => {
    const plan = smallPlan();
    const [a, b] = plan.coveredCells;
    if (a === undefined || b === undefined) throw new Error('cells');
    // why: q.cells may carry an off-band cell only through an engine bug; the band check still applies.
    const offBand = { ...a, returnDate: addDays(a.departureDate, 30) };
    const withOff: TilePlan = { ...plan, coveredCells: [...plan.coveredCells, offBand] };
    const body = gridFor(plan, [
      { departure: '2026-12-01', return: '2026-12-11', price: 1 },
      { departure: offBand.departureDate, return: offBand.returnDate, price: 1 },
      { departure: a.departureDate },
      { departure: '2027-02-30', return: '2027-03-10', price: 1 },
    ]);
    body.calendar[1] = { departure: b.departureDate, return: b.returnDate }; // unpriced, not no-flights
    answer(ok(body));
    const res = await tileOf(withOff);
    expect(res.notes).toEqual([
      'covered-cells-absent:1',
      'dropped-bad-date:1',
      'dropped-no-return:1',
      'dropped-outside-band:1',
      'dropped-outside-tile:1',
      'unpriced-skipped:1',
    ]);
    expect(res.prices.some((p) => cellKeyString(p) === cellKeyString(b))).toBe(false);
    // why: an unpriced row is neither "no fares" nor a dropped price; the engine decides the cell from that absence.
    expect(res.noFares.some((c) => cellKeyString(c) === cellKeyString(b))).toBe(false);
    expect(res.cellIssues ?? []).toEqual([]);
  });

  it('duplicates pass through so the engine keeps the minimum: a cheaper second entry is returned (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    answer(ok(gridFor(plan, [{ departure: a.departureDate, return: a.returnDate, price: 420 }])));
    const res = await tileOf(plan);
    expect(res.prices.filter((p) => cellKeyString(p) === cellKeyString(a)).map((p) => p.amountMinor)).toEqual(
      [50_000, 42_000],
    );
    expect(res.notes).toContain('duplicate-entries:1');
  });

  it('a cell with both a price and has_no_flights is priced, never no fares, and counted (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar.unshift({ departure: a.departureDate, return: a.returnDate, has_no_flights: true });
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([]);
    expect(res.notes).toEqual(['conflicting-entries:1', 'duplicate-entries:1']);
  });

  it('one row carrying both has_no_flights and a price is a priced conflicting entry, never "no fares" (review provenance Minor) (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: a.departureDate, return: a.returnDate, has_no_flights: true, price: 455 };
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([]);
    expect(res.prices.filter((p) => cellKeyString(p) === cellKeyString(a)).map((p) => p.amountMinor)).toEqual(
      [45_500],
    );
    expect(res.notes).toEqual(['conflicting-entries:1']);
  });

  it('one row carrying both has_no_flights and an unusable price is reported, never "no fares" (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: a.departureDate, return: a.returnDate, has_no_flights: true, price: 0 };
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([]);
    expect(res.notes).toEqual(['conflicting-entries:1', 'offers-dropped:1']);
    expect(res.cellIssues).toMatchObject([{ cell: a, reason: 'parse', offersDropped: 1 }]);
  });

  it('a no-flights entry beside a vendor price that was dropped is not "no fares": counted conflicting, with an issue (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: a.departureDate, return: a.returnDate, has_no_flights: true };
    body.calendar.push({ departure: a.departureDate, return: a.returnDate, price: 0 });
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.noFares).toEqual([]);
    expect(res.notes).toEqual(['conflicting-entries:1', 'duplicate-entries:1', 'offers-dropped:1']);
    expect(res.cellIssues).toEqual([
      { cell: a, reason: 'parse', offersDropped: 1, detail: expect.stringMatching(/1 calendar row/) },
    ]);
  });

  it('notes covered cells the grid left out, without inventing a status for them (synthetic)', async () => {
    const plan = smallPlan();
    const body = gridFor(plan);
    body.calendar.pop();
    answer(ok(body));
    const res = await tileOf(plan);
    expect(res.notes).toEqual(['covered-cells-absent:1']);
    expect(res.prices.length + res.noFares.length).toBe(plan.coveredCells.length - 1);
  });
});

describe('fetchTile money (spec §6.3, plan decision 24: shared majorToMinor, no rounding), synthetic', () => {
  const priced = (price: number, currency = 'GBP') => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    answer(
      ok({
        search_parameters: { currency, gl: 'gb' },
        calendar: [{ departure: a.departureDate, return: a.returnDate, price }],
      }),
    );
    return tileOf(plan);
  };

  it('573.5 GBP is 57350 pence', async () => {
    expect((await priced(573.5)).prices.map((p) => p.amountMinor)).toEqual([57_350]);
  });

  it.each([573.555, 0, -10])(
    '%s is dropped and counted offers-dropped, never rounded or kept (synthetic)',
    async (price) => {
      const res = await priced(price);
      expect(res.prices).toEqual([]);
      expect(res.notes).toContain('offers-dropped:1');
      // why: decision 28: the cell is reported, so the engine writes `error` (reason parse), never `no_data`.
      expect(res.cellIssues).toMatchObject([{ reason: 'parse', offersDropped: 1 }]);
    },
  );

  it('a USD echo passes through as USD at its exponent; JPY has exponent 0 (currency from the response) (synthetic)', async () => {
    expect((await priced(610.25, 'usd')).prices).toMatchObject([{ amountMinor: 61_025, currency: 'USD' }]);
    expect((await priced(81_000, 'JPY')).prices).toMatchObject([{ amountMinor: 81_000, currency: 'JPY' }]);
  });

  it('a currency core does not know is currency-unsupported: rows dropped and counted, the tile is not a parse error (synthetic)', async () => {
    const res = await priced(500, 'XAU');
    expect(res.prices).toEqual([]);
    expect(res.notes).toEqual(['covered-cells-absent:8', 'offers-dropped:1']);
    expect(res.cellIssues).toMatchObject([{ reason: 'currency-unsupported', offersDropped: 1 }]);
  });

  it('a cell with one dropped row and one good row is priced and reported; a clean tile carries no cellIssues (synthetic)', async () => {
    const plan = smallPlan();
    const [a] = plan.coveredCells;
    if (a === undefined) throw new Error('cells');
    answer(ok(gridFor(plan, [{ departure: a.departureDate, return: a.returnDate, price: 412.345 }])));
    const res = await tileOf(plan);
    expect(res.prices.filter((p) => cellKeyString(p) === cellKeyString(a)).map((p) => p.amountMinor)).toEqual(
      [50_000],
    );
    expect(res.cellIssues).toEqual([
      { cell: a, reason: 'parse', offersDropped: 1, detail: expect.any(String) },
    ]);
    answer(ok(gridFor(plan)));
    expect('cellIssues' in (await tileOf(plan))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/calendar.test.ts`
Expected: FAIL. Every test fails, most with `TypeError: fetchCalendarTile is not a function` (vitest's module transform leaves a missing named import undefined), the rest on assertions downstream of it: every test in the file fetches.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/shapes.ts
import { MINOR_EXPONENT } from '@gmt/core';
import { z } from 'zod';
import { parseError } from '../shared/errors.js';
import { majorToMinor } from '../shared/money.js';
import type { NoteCounter } from '../shared/notes.js';
import { SEARCHAPI_WHERE } from './params.js';

const echoSchema = z.object({ currency: z.string().optional(), gl: z.string().optional() });

/**
 * `google_flights_calendar` (docs 2026-10-14): `has_no_flights` is per entry and such entries omit `price`. Dates
 * stay strings here and are checked per entry with core's `isoDateSchema`, so one bad entry is dropped and counted
 * rather than failing the tile; prices stay numbers and go through `majorToMinor`.
 */
export const calendarResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  calendar: z.array(
    z.object({
      departure: z.string(),
      return: z.string().optional(),
      price: z.number().optional(),
      is_lowest_price: z.boolean().optional(),
      has_no_flights: z.boolean().optional(),
    }),
  ),
});

const airportSchema = z.object({ id: z.string(), date: z.string(), time: z.string() });
/** One flight of an option; `id` may be a vendor place id rather than an IATA code (docs), so it is checked per segment. */
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
  price: z.number().optional(),
  departure_token: z.string().optional(),
  booking_token: z.string().optional(),
});
/** One `price_insights.price_history` point; checked per point so a bad one is dropped, never fatal. */
export const historyPointSchema = z.object({ price: z.number(), iso_date: z.string() });
/** Steps 1 and 2. `other_flights` is not on the docs page; it is read when present. */
export const flightsResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  best_flights: z.array(optionSchema).optional(),
  other_flights: z.array(optionSchema).optional(),
  price_insights: z.object({ price_history: z.array(z.unknown()).nullish() }).nullish(),
});
export const bookingOptionSchema = z.object({
  book_with: z.string().optional(),
  price: z.number().optional(),
  baggage_prices: z.array(z.string()).optional(),
  booking_request: z.object({ url: z.string(), post_data: z.string() }).optional(),
  booking_phone: z.string().optional(),
  is_split_booking: z.boolean().optional(),
  /** The designators the seller lists, one per flight in step-1 then step-2 order (recorded 2026-10-15). */
  flight_numbers: z.array(z.string()).optional(),
});
/** Step 3 (`booking_token`). */
export const bookingResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  booking_options: z.array(bookingOptionSchema).optional(),
});
export type VendorSegment = z.infer<typeof segmentSchema>;
export type VendorOption = z.infer<typeof optionSchema>;
export type VendorBookingOption = z.infer<typeof bookingOptionSchema>;

/**
 * Currency and point of sale from the `search_parameters` echo. Spec §2: a response that states no currency is a
 * parse error; spec §5.2: `pointOfSale` is the upper-cased `gl` echo, and an echo other than the request is a
 * parse error (the vendor answered for another market).
 */
export function readEcho(
  echo: z.infer<typeof echoSchema> | undefined,
  requestedGl: string,
): { currency: string; pointOfSale: string } {
  const currency = echo?.currency;
  if (currency === undefined || !/^[A-Za-z]{3}$/.test(currency))
    throw parseError(
      'no-currency',
      'the response states no currency (search_parameters.currency)',
      SEARCHAPI_WHERE,
    );
  const gl = echo?.gl;
  if (gl === undefined || !/^[A-Za-z]{2}$/.test(gl))
    throw parseError(
      'no-point-of-sale',
      'the response does not echo gl (search_parameters.gl)',
      SEARCHAPI_WHERE,
    );
  if (gl.toLowerCase() !== requestedGl)
    throw parseError(
      'point-of-sale-mismatch',
      `echoed gl=${gl}; requested gl=${requestedGl}`,
      SEARCHAPI_WHERE,
    );
  return { currency: currency.toUpperCase(), pointOfSale: gl.toUpperCase() };
}

/** True when core knows the currency's minor-unit exponent (spec §6.3); otherwise rows are `currency-unsupported`. */
export function currencySupported(currency: string): boolean {
  return MINOR_EXPONENT[currency] !== undefined;
}

/** A vendor price as minor units, or why the row was dropped (a closed-list reason for `CellIssue.reason`). */
export type Minor =
  | { minor: number; dropped: null }
  | { minor: null; dropped: 'currency-unsupported' | 'parse' };

/**
 * Vendor major units → integer minor units through WP6's shared `majorToMinor` (exact decimal arithmetic, plan
 * decision 24; never rounded). A row is dropped and counted `offers-dropped` (WP6's notes vocabulary): with
 * reason `currency-unsupported` when core knows no exponent for the currency (plan decision 29: a normalisation
 * reason, never a tile-level parse error), else with reason `parse` (decision 28: a bad vendor price) for excess
 * precision or a non-positive amount. The reason travels in the result (a `CellIssue`, an error), not in a note.
 */
export function minorOrDrop(major: number, currency: string, notes: NoteCounter): Minor {
  if (!currencySupported(currency)) {
    notes.add('offers-dropped');
    return { minor: null, dropped: 'currency-unsupported' };
  }
  const minor = majorToMinor(major, currency);
  if (minor === null) {
    notes.add('offers-dropped');
    return { minor: null, dropped: 'parse' };
  }
  return { minor, dropped: null };
}
```

```ts
// src/searchapi/calendar.ts
import {
  addDays,
  type CellIssue,
  type CellKey,
  cellKeyString,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  daysBetween,
  generateCells,
  type IsoDate,
  isoDateSchema,
  type Logger,
  type ProviderContext,
  ProviderError,
  type RawCalendarPrice,
  type Secret,
  type TilePlan,
  type TileRequest,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import { parseError, parseVendor } from '../shared/errors.js';
import { NoteCounter } from '../shared/notes.js';
import { authHeaders, calendarParams, SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_WHERE, toUrl } from './params.js';
import { calendarResponseSchema, currencySupported, minorOrDrop, readEcho } from './shapes.js';

/** Spec §2 fact 2: the calendar engine refuses more than 200 outbound × return combinations (HTTP 400). */
export const MAX_COMBINATIONS = 200;

/** The rectangle variant of the vendor-neutral tile request (spec §5.1). */
export type Rectangle = Extract<TileRequest, { kind: 'rectangle' }>;

/** Outbound days × return days of a rectangle, the quantity SearchApi caps at 200. Spec §5.2. */
export function combinations(r: Rectangle): number {
  return (daysBetween(r.departFrom, r.departTo) + 1) * (daysBetween(r.returnFrom, r.returnTo) + 1);
}

/** The ≤200 assertion of spec §5.2; `fetchTile` repeats it before `http.request`, so it precedes `budget.reserve`. */
export function assertWithinLimit(r: Rectangle): void {
  const n = combinations(r);
  if (n > MAX_COMBINATIONS) {
    throw new RangeError(
      `searchapi rectangle ${r.departFrom}..${r.departTo} × ${r.returnFrom}..${r.returnTo} has ${n} combinations, above ${MAX_COMBINATIONS}`,
    );
  }
}

/**
 * Outbound days per tile: the largest b with b × (b + maxNights − minNights) ≤ 200, bounded by the window
 * length (ruling CBR-03). A block of b departure days needs b + spread return days, so this is the widest
 * rectangle the vendor accepts: 9 days for the worked 10–21-night band (9 × 20 = 180), 14 for a fixed-length
 * stay (14 × 14 = 196). One day always fits because nights ≤ 90 (spec §6.1).
 */
export function outboundBlockDays(
  q: Pick<DiscoveryQuery, 'departureFrom' | 'departureTo' | 'minNights' | 'maxNights'>,
): number {
  const spread = q.maxNights - q.minNights;
  const windowDays = daysBetween(q.departureFrom, q.departureTo) + 1;
  let b = 1;
  while ((b + 1) * (b + 1 + spread) <= MAX_COMBINATIONS) b += 1;
  return Math.max(1, Math.min(b, windowDays));
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

/** The tight bounding rectangle of a block; `first` is its earliest cell. */
function boundsOf(first: CellKey, group: readonly CellKey[]): Rectangle {
  const r: Rectangle = {
    kind: 'rectangle',
    departFrom: first.departureDate,
    departTo: first.departureDate,
    returnFrom: first.returnDate,
    returnTo: first.returnDate,
  };
  for (const c of group) {
    if (c.departureDate > r.departTo) r.departTo = c.departureDate;
    if (c.returnDate < r.returnFrom) r.returnFrom = c.returnDate;
    if (c.returnDate > r.returnTo) r.returnTo = c.returnDate;
  }
  return r;
}

/**
 * `DiscoveryCapability.plan` for SearchApi: pure, deterministic rectangle tiling of `google_flights_calendar`.
 * Spec §5.2. Cells (the band, or `q.cells` on a re-plan) are sorted and cut into blocks of
 * `outboundBlockDays(q)` consecutive departure days; each tile is its block's tight bounding box, so tiles
 * partition the input exactly. A block whose box would still exceed 200 combinations (only possible when
 * `q.cells` carries an off-band cell) shrinks a day at a time.
 */
export function planRectangles(q: DiscoveryQuery): TilePlan[] {
  const source: CellKey[] =
    q.cells ??
    generateCells({
      origins: [q.origin],
      destinations: [q.destination],
      departureFrom: q.departureFrom,
      departureTo: q.departureTo,
      minNights: q.minNights,
      maxNights: q.maxNights,
    }).map(({ origin, destination, departureDate, returnDate }) => ({
      origin,
      destination,
      departureDate,
      returnDate,
    }));
  const cells = [...source].sort(byDepartureThenReturn);
  const widest = outboundBlockDays(q);
  const tiles: TilePlan[] = [];
  let start = 0;
  while (start < cells.length) {
    const first = cells[start];
    if (first === undefined) break;
    let block = widest;
    let group = takeBlock(cells, start, addDays(first.departureDate, block - 1));
    let rect = boundsOf(first, group);
    // why: a re-plan subset may hold a cell outside the band (an engine bug); shrink rather than overflow.
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

/** What `fetchTile` needs; built once by `searchApiProvider`. */
export interface CalendarDeps {
  http: HttpKit;
  log: Logger;
  key: Secret;
  pointOfSale: string;
  allowlist: ParamsAllowlist;
  cacheTtlSeconds: number;
}

/** A tile's parsed content, before `fetchedAt` and the tile identity are added. */
export interface ParsedCalendar {
  prices: RawCalendarPrice[];
  noFares: CellKey[];
  notes: string[];
  pointOfSale: string;
  /** Present only when a covered cell had a row dropped (decision 28; WP6 omits it the same way). */
  cellIssues?: CellIssue[];
}

/** `n calendar row(s)` for a cell issue's detail. */
const rowsWord = (n: number): string => (n === 1 ? '1 calendar row' : `${n} calendar rows`);

/**
 * A cell issue's detail in WP6's grammar: provider prefix, what happened, the machine tag in brackets (`bad-price`
 * for reason `parse`, `currency-unsupported` for that reason), so `last_error` reads one way for both adapters.
 */
function dropDetail(n: number, currency: string, reason: 'currency-unsupported' | 'parse'): string {
  return reason === 'currency-unsupported'
    ? `searchapi: ${rowsWord(n)} for this cell priced in ${currency}, which has no known minor unit [currency-unsupported]`
    : `searchapi: ${rowsWord(n)} for this cell had no usable ${currency} price (not a positive amount with at most its currency's decimals) [bad-price]`;
}

/**
 * Parses one calendar response for one tile. Spec §5.2: cell keys from the response; entries outside
 * `coveredCells` or the nights band are dropped and counted; `has_no_flights` → `noFares`; an empty grid →
 * parse; currency and point of sale from the echo. Every in-tile priced entry is returned, duplicates included,
 * so the engine's one-price-per-cell rule (spec §5.6: the minimum, vendor order breaking ties) decides. A cell
 * for which the vendor stated a price is never "no fares", even when that price was dropped; a cell with both is
 * counted `conflicting-entries`. Every covered cell with a dropped row gets a `CellIssue` (decision 28): the engine
 * records it `priced` with `offers-dropped:n` when another row priced it, else `error` with the issue's reason
 * (`currency-unsupported` or `parse`), never `no_data`.
 */
export function parseCalendarBody(
  body: unknown,
  plan: TilePlan,
  q: DiscoveryQuery,
  requestedGl: string,
): ParsedCalendar {
  const data = parseVendor(calendarResponseSchema, body, 'malformed-calendar', SEARCHAPI_WHERE);
  const echo = readEcho(data.search_parameters, requestedGl);
  // why: spec §5.2: under a passing ≤200 assertion an empty grid is a vendor fault, never "no data".
  if (data.calendar.length === 0)
    throw parseError('empty-grid', 'an empty grid within the 200-combination limit', SEARCHAPI_WHERE);
  const covered = new Set(plan.coveredCells.map(cellKeyString));
  const seen = new Set<string>();
  const stated = new Set<string>();
  const noFlights = new Set<string>();
  // why: one response states one currency, so every dropped row of a tile has the same reason.
  const dropReason = currencySupported(echo.currency) ? 'parse' : 'currency-unsupported';
  const dropped = new Map<string, number>();
  const notes = new NoteCounter();
  const prices: RawCalendarPrice[] = [];
  for (const e of data.calendar) {
    if (e.return === undefined) {
      notes.add('dropped-no-return');
      continue;
    }
    const dep = isoDateSchema.safeParse(e.departure);
    const ret = isoDateSchema.safeParse(e.return);
    if (!dep.success || !ret.success) {
      notes.add('dropped-bad-date');
      continue;
    }
    const cell: CellKey = {
      origin: q.origin,
      destination: q.destination,
      departureDate: dep.data,
      returnDate: ret.data,
    };
    const key = cellKeyString(cell);
    if (!covered.has(key)) {
      notes.add('dropped-outside-tile');
      continue;
    }
    const nights = daysBetween(cell.departureDate, cell.returnDate);
    if (nights < q.minNights || nights > q.maxNights) {
      notes.add('dropped-outside-band');
      continue;
    }
    if (seen.has(key)) notes.add('duplicate-entries');
    seen.add(key);
    if (e.has_no_flights === true) {
      noFlights.add(key);
      // why: a row that also states a price is a stated fare, never "no fares"; the cell counts as conflicting below.
      if (e.price === undefined) continue;
    }
    if (e.price === undefined) {
      notes.add('unpriced-skipped');
      continue;
    }
    stated.add(key);
    const m = minorOrDrop(e.price, echo.currency, notes);
    if (m.minor === null) {
      dropped.set(key, (dropped.get(key) ?? 0) + 1);
      continue;
    }
    prices.push({ ...cell, amountMinor: m.minor, currency: echo.currency });
  }
  const noFares = plan.coveredCells.filter((c) => {
    const key = cellKeyString(c);
    return noFlights.has(key) && !stated.has(key);
  });
  notes.add('conflicting-entries', [...noFlights].filter((k) => stated.has(k)).length);
  // why: an absent cell is neither priced nor "no fares"; the engine decides its outcome, the note keeps it visible.
  notes.add('covered-cells-absent', covered.size - seen.size);
  const cellIssues: CellIssue[] = plan.coveredCells.flatMap((cell) => {
    const n = dropped.get(cellKeyString(cell));
    if (n === undefined) return [];
    return [{ cell, reason: dropReason, offersDropped: n, detail: dropDetail(n, echo.currency, dropReason) }];
  });
  return {
    prices,
    noFares,
    notes: notes.list(),
    pointOfSale: echo.pointOfSale,
    ...(cellIssues.length === 0 ? {} : { cellIssues }),
  };
}

/**
 * `DiscoveryCapability.fetchTile` for SearchApi. Spec §5.2. The rectangle check, the ≤200 assertion and the
 * allowlist check run before `http.request`, so none reaches `budget.reserve`. A `ProviderError` becomes a
 * `tile-error` for exactly this tile's cells; `BudgetExceeded` and `AbortedError` propagate.
 */
export async function fetchCalendarTile(
  d: CalendarDeps,
  plan: TilePlan,
  q: DiscoveryQuery,
  ctx: ProviderContext,
): Promise<DiscoveryTileResult> {
  const req = plan.request;
  if (req.kind !== 'rectangle') throw new TypeError(`searchapi plans rectangle tiles only; got ${req.kind}`);
  assertWithinLimit(req);
  const url = toUrl(calendarParams(q, req, d.pointOfSale));
  assertRequestAllowed(d.allowlist, SEARCHAPI_ENDPOINT_PATH, url);
  const gl = d.pointOfSale.toLowerCase();
  // why: plan decision 15: `accept` vetoes caching a body this parser rejects, so a bad grid is never served again;
  // only a parse refusal means "do not cache", anything else is a bug and propagates.
  const accept = (body: unknown): boolean => {
    try {
      parseCalendarBody(body, plan, q, gl);
      return true;
    } catch (err) {
      if (err instanceof ProviderError) return false;
      throw err;
    }
  };
  try {
    // why: the cache key excludes execution and tile ids (plan decision 14), so an identical rectangle from a
    // resumed run is a cache hit, ledgered with this tile's index (spec §8.1 parity).
    const res = await d.http.request({
      providerId: 'searchapi',
      executionId: ctx.executionId,
      tileIndex: plan.index,
      endpointPath: SEARCHAPI_ENDPOINT_PATH,
      method: 'GET',
      url,
      headers: authHeaders(d.key),
      cache: { ttlSeconds: d.cacheTtlSeconds, accept },
      signal: ctx.signal,
      recordFixtures: ctx.recordFixtures,
    });
    const parsed = parseCalendarBody(res.body, plan, q, gl);
    d.log.debug(
      {
        tileIndex: plan.index,
        prices: parsed.prices.length,
        noFares: parsed.noFares.length,
        notes: parsed.notes,
      },
      'searchapi calendar tile parsed',
    );
    return {
      kind: 'tile',
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt: res.fetchedAt,
      ...parsed,
    };
  } catch (err) {
    if (err instanceof ProviderError)
      return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error: err };
    throw err;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/calendar.test.ts test/searchapi/tiling.test.ts`
Expected: PASS, 33 and 13 tests, with the afterEach allowlist check holding for every request.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi calendar tiles: response keying, counted drops, duplicates to the engine, exact money"
```

### Task 5.5: Segments, stated airline and step-3 offers

**Files:** create `src/searchapi/offers.ts` and `test/searchapi/offers.test.ts`.

**Interfaces:** consumes `RawSegment`, `RawOffer` (with `verified`), `BaggageSnapshot`, `iataSchema`, WP6's `NoteCounter`, Task 5.4's shapes and `minorOrDrop`. Produces `toRawSegment`, `toRawSegments`, `statedAirline`, `Pairing`, `bookingOffers`, `step3NamesAirline`. A step-3 listing's `flight_numbers` relabel the pairing's segments: a designator that differs from step 2's becomes the segment's marketing carrier and flight number and step 2's carrier its `operatingCarrier` (the spec's Segment has no operating flight number), counted `codeshare-listing-step3`, so a codeshare listing is its own itinerary under spec §6.4's marketing-flight hash; a listing with a different number of flights is another itinerary, dropped and counted `itinerary-mismatch-step3`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/offers.test.ts
import { asIata, canonicalCarrier, canonicalFlightNumber, type RawOffer } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  bookingOffers,
  type Pairing,
  statedAirline,
  step3NamesAirline,
  toRawSegment,
  toRawSegments,
} from '../../src/searchapi/offers.js';
import { bookingOptionSchema, segmentSchema } from '../../src/searchapi/shapes.js';
import { NoteCounter } from '../../src/shared/notes.js';
import { agent, POST, seg } from './support/synthetic.js';

const vendorSeg = (...a: Parameters<typeof seg>) => segmentSchema.parse(seg(...a));
const options = (raw: unknown[]) => raw.map((o) => bookingOptionSchema.parse(o));
const out = toRawSegments([vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', 'Synthetic Air One')]);
const inb = toRawSegments([vendorSeg('JFK', 'LHR', '2026-11-14', '18:00', 'X1 101', 'Synthetic Air One')]);
if (out === null || inb === null) throw new Error('segments');
const pairing: Pairing = { cabin: 'economy', outbound: out, inbound: inb };
const offer = (seller: string): RawOffer => ({
  outbound: out,
  inbound: inb,
  seller,
  requestedCabin: 'economy',
  amountMinor: 1,
  currency: 'GBP',
  booking: { kind: 'none' },
  verified: true,
});

describe('toRawSegment (raw only, spec §5.2), synthetic', () => {
  it('splits the carrier from the flight number, keeps vendor local times, states cabin only when given (synthetic)', () => {
    expect(
      toRawSegment(
        vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', 'Synthetic Air One', 'Premium economy'),
      ),
    ).toEqual({
      marketingCarrier: 'X1',
      flightNumber: '100',
      from: 'LHR',
      to: 'JFK',
      depart: '2026-11-02T09:05',
      arrive: '2026-11-02T23:00',
      timeKind: 'local',
      cabin: 'premium_economy',
      durationMinutes: 420,
      aircraft: 'Synthetic 787',
    });
  });

  it('an unrecognised class leaves cabin unstated; an unsplittable or all-digit number passes whole for core to reject (synthetic)', () => {
    const s = toRawSegment(
      vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'Synthetic 100', 'Synthetic Air One', 'Mystery'),
    );
    expect(s?.cabin).toBeUndefined();
    expect(s?.marketingCarrier).toBe('Synthetic 100');
    expect(toRawSegment(vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', '0938'))?.marketingCarrier).toBe(
      '0938',
    );
    expect(toRawSegment(vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', '9X 12'))).toMatchObject({
      marketingCarrier: '9X',
      flightNumber: '12',
    });
  });

  it('a vendor place id that is not an IATA code makes the segment, and the option, unusable (synthetic)', () => {
    expect(toRawSegment(vendorSeg('/m/04jpl', 'JFK', '2026-11-02', '09:05', 'X1 100'))).toBeNull();
    expect(
      toRawSegments([
        vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100'),
        vendorSeg('JFK', '/m/02_286', '2026-11-02', '23:00', 'X1 7'),
      ]),
    ).toBeNull();
    expect(toRawSegments([])).toBeNull();
    expect(toRawSegment(vendorSeg('lhr', 'JFK', '2026-11-02', '09:05', 'X1 100'))?.from).toBe(asIata('LHR'));
  });
});

describe('toRawSegment agrees with core (spec §6.4), synthetic', () => {
  it.each(['X1 100', '9X 12', 'BA0938', 'X1100'])(
    'the split of %s is one core canonicalises without error (synthetic)',
    (number) => {
      const s = toRawSegment(vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', number));
      if (s === null) throw new Error('segment');
      // why: the adapter's designator split copies core's rule; a drift fails here, not later as unmappable-carrier.
      expect(() => canonicalFlightNumber(s.flightNumber, canonicalCarrier(s.marketingCarrier))).not.toThrow();
    },
  );
});

describe('statedAirline (never invent a seller), synthetic', () => {
  it('is the airline the vendor states on the first outbound flight, else null; never the flight number (synthetic)', () => {
    expect(
      statedAirline([vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', ' Synthetic Air One ')]),
    ).toBe('Synthetic Air One');
    expect(statedAirline([vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100')])).toBeNull();
    expect(statedAirline([vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', '  ')])).toBeNull();
    expect(statedAirline([])).toBeNull();
  });
});

describe('bookingOffers (spec §5.4 step 3), synthetic', () => {
  it('each usable option is a verified offer with its seller, minor units, POST booking and baggage notes (synthetic)', () => {
    const notes = new NoteCounter();
    const offers = bookingOffers(
      pairing,
      options([{ ...agent(573), baggage_prices: ['1 free carry-on', '1st checked bag: 60'] }]),
      'GBP',
      notes,
    );
    expect(offers).toEqual([
      {
        outbound: out,
        inbound: inb,
        seller: 'Synthetic Travel Agent',
        requestedCabin: 'economy',
        amountMinor: 57_300,
        currency: 'GBP',
        booking: { kind: 'post', url: POST.url, postData: POST.post_data },
        baggage: { notes: ['1 free carry-on', '1st checked bag: 60'] },
        verified: true,
      },
    ]);
    expect(notes.list()).toEqual([]);
  });

  it('a phone-only option is an offer with booking none, counted (synthetic)', () => {
    const notes = new NoteCounter();
    const [o] = bookingOffers(
      pairing,
      options([{ book_with: 'Synthetic Phone Desk', price: 590, booking_phone: '+44 0000 000000' }]),
      'GBP',
      notes,
    );
    expect(o?.booking).toEqual({ kind: 'none' });
    expect(notes.list()).toEqual(['phone-only-booking:1']);
  });

  it('split bookings, unpriced, seller-less and unusable-price options are skipped and counted (synthetic)', () => {
    const notes = new NoteCounter();
    const offers = bookingOffers(
      pairing,
      options([
        { is_split_booking: true, price: 400 },
        { book_with: 'Synthetic Travel Agent' },
        { price: 500, booking_request: POST },
        { book_with: ' ', price: 500 },
        agent(573.555),
        agent(0),
      ]),
      'GBP',
      notes,
    );
    expect(offers).toEqual([]);
    expect(notes.list()).toEqual([
      'no-seller-skipped-step3:2',
      'offers-dropped:2',
      'split-booking-skipped:1',
      'unpriced-skipped-step3:1',
    ]);
  });

  it('a currency core does not know drops the options as currency-unsupported (synthetic)', () => {
    const notes = new NoteCounter();
    expect(bookingOffers(pairing, options([agent(573)]), 'XAU', notes)).toEqual([]);
    expect(notes.list()).toEqual(['offers-dropped:1']);
  });
});

describe('step3NamesAirline (spec §5.4 price-source rule), synthetic', () => {
  it('matches the step-2 airline exactly after trim and lower-case, never a near miss or another carrier (synthetic)', () => {
    expect(step3NamesAirline([offer('synthetic air one ')], 'Synthetic Air One')).toBe(true);
    expect(step3NamesAirline([offer('Synthetic Air One plc')], 'Synthetic Air One')).toBe(false);
    expect(step3NamesAirline([offer('Synthetic Air Two')], 'Synthetic Air One')).toBe(false);
    expect(step3NamesAirline([], 'Synthetic Air One')).toBe(false);
  });
});

describe('bookingOffers codeshare listings (spec §6.4 identity on marketing flights; ruling on review pie I-1), synthetic', () => {
  it('a listing naming the pairing flights keeps the step-2 segments, with no operating carrier and no note (synthetic)', () => {
    const notes = new NoteCounter();
    const [o] = bookingOffers(
      pairing,
      options([{ ...agent(573), flight_numbers: ['X1 100', 'X1 101'] }]),
      'GBP',
      notes,
    );
    expect(o?.outbound).toEqual(out);
    expect(o?.inbound).toEqual(inb);
    expect(o?.outbound[0]?.operatingCarrier).toBeUndefined();
    expect(notes.list()).toEqual([]);
  });

  it('a codeshare listing carries the seller-listed marketing flights; the step-2 carrier becomes the operating carrier (synthetic)', () => {
    const notes = new NoteCounter();
    const [o] = bookingOffers(
      pairing,
      options([{ ...agent(590, 'Synthetic Partner Air'), flight_numbers: ['Y2 5941', 'X1 101'] }]),
      'GBP',
      notes,
    );
    expect(o?.outbound).toEqual([
      { ...out[0], marketingCarrier: 'Y2', flightNumber: '5941', operatingCarrier: 'X1' },
    ]);
    // why: a leg the seller lists under the step-2 designator is not a codeshare and stays as step 2 gave it.
    expect(o?.inbound).toEqual(inb);
    expect(notes.list()).toEqual(['codeshare-listing-step3:1']);
  });

  it('the split of a listed designator agrees with core, so the codeshare itinerary hashes on the listed flights (synthetic)', () => {
    const [o] = bookingOffers(
      pairing,
      options([{ ...agent(590), flight_numbers: ['Y2 5941', 'Y2 5940'] }]),
      'GBP',
      new NoteCounter(),
    );
    const s = o?.outbound[0];
    if (s === undefined) throw new Error('segment');
    expect(canonicalFlightNumber(s.flightNumber, canonicalCarrier(s.marketingCarrier))).toBe(5941);
    expect(o?.inbound[0]).toMatchObject({
      marketingCarrier: 'Y2',
      flightNumber: '5940',
      operatingCarrier: 'X1',
    });
  });

  it('a listing whose flight count differs from the pairing is another itinerary: dropped and counted (synthetic)', () => {
    const notes = new NoteCounter();
    expect(
      bookingOffers(pairing, options([{ ...agent(590), flight_numbers: ['Y2 5941'] }]), 'GBP', notes),
    ).toEqual([]);
    expect(notes.list()).toEqual(['itinerary-mismatch-step3:1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/offers.test.ts`
Expected: FAIL. `../../src/searchapi/offers.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/offers.ts
import { type BaggageSnapshot, type Cabin, iataSchema, type RawOffer, type RawSegment } from '@gmt/core';
import type { NoteCounter } from '../shared/notes.js';
import { minorOrDrop, type VendorBookingOption, type VendorSegment } from './shapes.js';

const CABIN_BY_TRAVEL_CLASS: Readonly<Record<string, Cabin>> = {
  economy: 'economy',
  'premium economy': 'premium_economy',
  business: 'business',
  first: 'first',
};

// why: core's rule (canonicalFlightNumber): the designator must contain a letter, so "0938" is never carrier "09".
const FLIGHT_RE = /^([A-Z][A-Z0-9]|[0-9][A-Z])\s*(\d{1,4})$/;

/** A vendor designator split at core's rule, or passed whole (both parts) so core rejects it as unmappable. */
function splitDesignator(raw: string): { carrier: string; number: string } {
  const m = FLIGHT_RE.exec(raw.trim().toUpperCase());
  return { carrier: m?.[1] ?? raw, number: m?.[2] ?? raw };
}

/**
 * A vendor segment as a `RawSegment`, raw only (spec §5.2): vendor local times as given; the cabin only when a
 * recognised class is stated; the flight number split at the designator when it matches core's rule, otherwise
 * passed whole so core rejects the offer (`unmappable-carrier`). Airport ids go through core's `iataSchema`, the
 * only brand mint site; a vendor place id that is not an IATA code returns null and the caller drops and counts
 * the option.
 */
export function toRawSegment(s: VendorSegment): RawSegment | null {
  const from = iataSchema.safeParse(s.departure_airport.id);
  const to = iataSchema.safeParse(s.arrival_airport.id);
  if (!from.success || !to.success) return null;
  const d = splitDesignator(s.flight_number);
  const seg: RawSegment = {
    marketingCarrier: d.carrier,
    flightNumber: d.number,
    from: from.data,
    to: to.data,
    depart: `${s.departure_airport.date}T${s.departure_airport.time}`,
    arrive: `${s.arrival_airport.date}T${s.arrival_airport.time}`,
    timeKind: 'local',
  };
  const cabin =
    s.travel_class === undefined ? undefined : CABIN_BY_TRAVEL_CLASS[s.travel_class.trim().toLowerCase()];
  if (cabin !== undefined) seg.cabin = cabin;
  if (s.duration !== undefined) seg.durationMinutes = s.duration;
  if (s.airplane !== undefined) seg.aircraft = s.airplane;
  return seg;
}

/** Every segment converted, or null when any one cannot be (the whole option is then dropped). */
export function toRawSegments(segs: readonly VendorSegment[]): RawSegment[] | null {
  const out: RawSegment[] = [];
  for (const s of segs) {
    const r = toRawSegment(s);
    if (r === null) return null;
    out.push(r);
  }
  return out.length === 0 ? null : out;
}

/** The airline the vendor states on the first outbound flight, trimmed, or null when it states none. Never inferred. */
export function statedAirline(segs: readonly VendorSegment[]): string | null {
  const a = segs[0]?.airline?.trim();
  return a === undefined || a === '' ? null : a;
}

/** The legs and cabin every offer of one outbound/return pairing shares. */
export interface Pairing {
  cabin: Cabin;
  outbound: RawSegment[];
  inbound: RawSegment[];
}

/** Same flight: same carrier and the same number (leading zeros aside, as core canonicalises them). */
function sameDesignator(seg: RawSegment, listed: { carrier: string; number: string }): boolean {
  if (seg.marketingCarrier !== listed.carrier) return false;
  const a = /^\d+$/.test(seg.flightNumber) ? Number(seg.flightNumber) : seg.flightNumber;
  const b = /^\d+$/.test(listed.number) ? Number(listed.number) : listed.number;
  return a === b;
}

/**
 * The pairing's legs as one seller lists them. A codeshare seller sells the same physical flights under its own
 * designators (recorded 2026-10-15: Aer Lingus lists EI 381/111/110/380, American AA 8059/8317/8316/8060, British
 * Airways BA 5941/6131/6130/5940 for one pairing). Each listed designator becomes the segment's marketing carrier and
 * flight number, and the step-2 carrier the operating one where they differ, so identity hashes on the flights the
 * seller sells (spec §6.4: codeshares hash on the marketing carrier). The spec's Segment has no operating flight
 * number, so only the operating carrier is kept. Null when the listing has a different number of flights: another
 * itinerary, never this pairing's fare.
 */
function listedLegs(
  p: Pairing,
  listed: readonly string[] | undefined,
  notes: NoteCounter,
): { outbound: RawSegment[]; inbound: RawSegment[] } | null {
  if (listed === undefined) return { outbound: p.outbound, inbound: p.inbound };
  if (listed.length !== p.outbound.length + p.inbound.length) {
    notes.add('itinerary-mismatch-step3');
    return null;
  }
  let codeshare = false;
  const relabel = (seg: RawSegment, i: number): RawSegment => {
    const raw = listed[i];
    if (raw === undefined) return seg;
    const d = splitDesignator(raw);
    if (sameDesignator(seg, d)) return seg;
    codeshare = true;
    return {
      ...seg,
      marketingCarrier: d.carrier,
      flightNumber: d.number,
      operatingCarrier: seg.marketingCarrier,
    };
  };
  const outbound = p.outbound.map((seg, i) => relabel(seg, i));
  const inbound = p.inbound.map((seg, i) => relabel(seg, p.outbound.length + i));
  if (codeshare) notes.add('codeshare-listing-step3');
  return { outbound, inbound };
}

/**
 * Step-3 booking options as offers (spec §5.4): each usable option is its own offer, `verified: true`, with its
 * `book_with` seller, `baggage_prices` as baggage notes, its booking POST, and the flights it lists (`listedLegs`: a
 * codeshare listing is its own itinerary). Split bookings, unpriced options, options naming no seller and listings of
 * another itinerary are skipped and counted; a price the shared `majorToMinor` refuses is dropped and counted.
 */
export function bookingOffers(
  p: Pairing,
  options: readonly VendorBookingOption[],
  currency: string,
  notes: NoteCounter,
): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const b of options) {
    // why: spec §5.4: split bookings are skipped and counted; a sum of two prices would be our number, not the vendor's.
    if (b.is_split_booking === true) {
      notes.add('split-booking-skipped');
      continue;
    }
    if (b.price === undefined) {
      notes.add('unpriced-skipped-step3');
      continue;
    }
    const seller = b.book_with?.trim();
    if (seller === undefined || seller === '') {
      notes.add('no-seller-skipped-step3');
      continue;
    }
    const legs = listedLegs(p, b.flight_numbers, notes);
    if (legs === null) continue;
    const { minor: amountMinor } = minorOrDrop(b.price, currency, notes);
    if (amountMinor === null) continue;
    let booking: RawOffer['booking'] = { kind: 'none' };
    // why: booking_request is a POST to Google, stored and rendered as a form, never fetched server-side (spec §5.4).
    if (b.booking_request !== undefined)
      booking = { kind: 'post', url: b.booking_request.url, postData: b.booking_request.post_data };
    else if (b.booking_phone !== undefined) notes.add('phone-only-booking');
    const baggage: BaggageSnapshot | undefined =
      b.baggage_prices !== undefined && b.baggage_prices.length > 0
        ? { notes: [...b.baggage_prices] }
        : undefined;
    offers.push({
      outbound: legs.outbound,
      inbound: legs.inbound,
      seller,
      requestedCabin: p.cabin,
      amountMinor,
      currency,
      booking,
      ...(baggage === undefined ? {} : { baggage }),
      // why: a seller listing at step 3 is the only confirmation of a price this vendor gives (plan decision 27).
      verified: true,
    });
  }
  return offers;
}

/**
 * Spec §5.4 price-source rule: the step-2 price is the airline's own fare, kept as an airline-direct offer only when
 * no step-3 option names that airline. "Names" is an exact match after trimming and lower-casing against the airline
 * the step-2 offer carries (never a connecting carrier); a near-miss spelling keeps the step-2 offer.
 */
export function step3NamesAirline(step3: readonly RawOffer[], airline: string): boolean {
  const want = airline.trim().toLowerCase();
  return step3.some((o) => o.seller.trim().toLowerCase() === want);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/offers.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi segments, stated airline only, step-3 offers and the price-source match (spec §5.4)"
```

### Task 5.6: The itinerary chain, outcome rules, stops and route history

**Files:** create `src/searchapi/itinerary.ts`, `src/searchapi/steps.ts` and `test/searchapi/itinerary.test.ts`.

**Interfaces:** consumes `ItineraryQuery`, `ItinerarySearchResult`, `RawOffer`, `ProviderError`, `BudgetExceeded`, `AbortedError`, `isoDateSchema`, `HttpKit`, WP6's `parseError`, `parseVendor`, `majorToMinor`, `NoteCounter`, `ParamsNotAllowedError`, Tasks 5.2–5.5. Produces `searchItinerary`, `estimateItinerary`, `assertBookingLinks`, `ItineraryDeps`, `WORST_SECONDS_PER_CALL`, and in `steps.ts` `parseFlights`, `parseBooking`, `toRouteHistory`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/itinerary.test.ts
import { AbortedError, BudgetExceeded, type ItinerarySearchResult } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type ParamsAllowlist, ParamsNotAllowedError } from '../../src/params/allowlist.js';
import { estimateItinerary, type ItineraryDeps, searchItinerary } from '../../src/searchapi/itinerary.js';
import { SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { FakeBudget } from '../fakes.js';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, KEY, saKit, sentUrls } from './support/kit.js';
import {
  agent,
  bookingBody,
  CELL_QUERY,
  ECHO,
  flightsBody,
  IN_1,
  IN_2,
  IN_3,
  OUT_A,
  OUT_B,
  ok,
  option,
  type Reply,
  seg,
  syntheticHandler,
} from './support/synthetic.js';

afterEach(() => assertEverySentAllowed());

const deps = (k = saKit()): ItineraryDeps & { k: ReturnType<typeof saKit> } => ({
  http: k.kit,
  log: k.log,
  key: KEY,
  pointOfSale: 'GB',
  allowlist: SEARCHAPI_PARAMS,
  k,
});
const A = option(OUT_A, 600, { departure_token: 'dA' });
const B = option(OUT_B, 640, { departure_token: 'dB' });
const q1 = { ...CELL_QUERY, expandTop: 1 };
const notFound: Reply = { status: 404, body: { error: 'Not found' } };

/** Routes synthetic replies by token: step 1 has none, step 2 a departure_token, step 3 a booking_token. */
function chain(
  step1: unknown,
  step2: Record<string, Reply>,
  step3: Record<string, Reply> = {},
  onRequest: (p: URLSearchParams) => void = () => undefined,
) {
  server.use(
    syntheticHandler((p) => {
      onRequest(p);
      const bk = p.get('booking_token');
      const dep = p.get('departure_token');
      if (bk !== null) return step3[bk] ?? notFound;
      if (dep !== null) return step2[dep] ?? notFound;
      return ok(step1);
    }),
  );
}
const tokens = (d: { k: ReturnType<typeof saKit> }, name: string) =>
  sentUrls(d.k.events).flatMap((u) => u.searchParams.getAll(name));
/** Seller, amount, booking kind and the decision-27 flag of every offer, in order. */
const sellers = (r: ItinerarySearchResult) =>
  r.offers.map((o) => [o.seller, o.amountMinor, o.booking.kind, o.verified]);
const step2Only = (r: ItinerarySearchResult) => r.offers.length > 0 && r.offers.every((o) => !o.verified);

describe('itinerary outcome rules (spec §5.4), synthetic shapes', () => {
  it('step 1 zero options → coverage empty, one call (synthetic)', async () => {
    chain(flightsBody([]), {});
    const d = deps();
    expect(await searchItinerary(d, CELL_QUERY, ctx())).toMatchObject({
      coverage: 'empty',
      offers: [],
      partial: false,
      failedExpansions: 0,
      pointOfSale: 'GB',
    });
    expect(sentUrls(d.k.events)).toHaveLength(1);
  });

  it('a step-1 body with neither best_flights nor other_flights → parse no-options-key, never empty (synthetic)', async () => {
    chain({ ...ECHO, price_insights: null }, {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'parse',
      message: expect.stringMatching(/no-options-key/),
    });
  });

  it('other_flights alone is read (synthetic)', async () => {
    chain(
      { ...ECHO, other_flights: [A] },
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    expect((await searchItinerary(deps(), q1, ctx())).coverage).toBe('priced');
  });

  it('options, but every step 2 fails → upstream no-return-legs, non-retryable (synthetic)', async () => {
    chain(flightsBody([A, B]), {});
    const d = deps();
    await expect(searchItinerary(d, CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'no-return-legs',
      retryable: false,
    });
    expect(sentUrls(d.k.events)).toHaveLength(3);
  });

  it('options, but every step 2 returns no legs → upstream no-return-legs (synthetic)', async () => {
    chain(flightsBody([A, B]), { dA: ok(flightsBody([])), dB: ok(flightsBody([])) });
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'no-return-legs',
    });
  });

  it('a step 2 without an options key is a failed expansion (parse), not "no legs" (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])), dB: ok({ ...ECHO }) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 1 });
    expect(res.notes).toContain('expansion-failed:1');
  });

  it('some step 2 succeed → priced, partial, failedExpansions counted (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 1 });
    expect(res.notes).toContain('expansion-failed:1');
  });

  it('a step 2 with zero legs contributes nothing and is not a failure (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])), dB: ok(flightsBody([])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: false, failedExpansions: 0 });
    expect(res.notes).toContain('no-return-legs-for-outbound:1');
    expect(res.offers.every((o) => o.outbound[0]?.flightNumber === '100')).toBe(true);
  });

  it('unpriced options are skipped and counted at step 1 and step 2, never expanded or persisted (synthetic)', async () => {
    const unpriced = option(OUT_B, undefined, { departure_token: 'dU' });
    chain(
      flightsBody([unpriced, A]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 600, { booking_token: 'b1' }),
            option(IN_2, undefined, { booking_token: 'b2' }),
          ]),
        ),
      },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const d = deps();
    const res = await searchItinerary(d, CELL_QUERY, ctx());
    expect(res.notes).toEqual(
      expect.arrayContaining(['unpriced-skipped-step1:1', 'unpriced-skipped-step2:1']),
    );
    expect(tokens(d, 'departure_token')).toEqual(['dA']);
    expect(tokens(d, 'booking_token')).toEqual(['b1']);
  });

  it('all step-1 options unpriced → upstream no-priced-options, nothing expanded (spec §5.4) (synthetic)', async () => {
    chain(flightsBody([option(OUT_A, undefined, { departure_token: 'dA' })]), {});
    const d = deps();
    await expect(searchItinerary(d, CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'no-priced-options',
      retryable: false,
    });
    expect(sentUrls(d.k.events)).toHaveLength(1);
  });

  it('all step-1 options unpriced stays upstream no-priced-options (spec §5.4) and is distinct from unusable ones (synthetic)', async () => {
    chain(
      flightsBody([
        option(OUT_A, undefined, { departure_token: 'dA' }),
        option(OUT_B, undefined, { departure_token: 'dB' }),
      ]),
      {},
    );
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'no-priced-options',
    });
  });

  it('priced step-1 options without a token, with a non-IATA airport or an unusable price → parse unusable-step1-options, never no-priced-options (synthetic)', async () => {
    const noToken = { flights: OUT_A, price: 500 };
    const badAirport = option(
      [seg('/m/04jpl', 'JFK', '2026-11-02', '09:00', 'X1 100', 'Synthetic Air One')],
      510,
      { departure_token: 'dX' },
    );
    const badPrice = option(OUT_B, 520.005, { departure_token: 'dY' });
    chain(flightsBody([noToken, badAirport, badPrice]), {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'parse',
      providerId: 'searchapi',
      message: expect.stringMatching(
        /no-departure-token-step1:1, route-history-absent:1, unusable-price-step1:1, unusable-segments-step1:1.*\[unusable-step1-options\]/,
      ),
    });
  });

  it('expands the expandTop cheapest priced outbounds, cheapest first (synthetic)', async () => {
    const C = option(OUT_B, 590, { departure_token: 'dC' });
    chain(
      flightsBody([B, A, C]),
      { dC: ok(flightsBody([option(IN_1, 590, { booking_token: 'bC' })])) },
      { bC: ok(bookingBody([agent(560)])) },
    );
    const d = deps();
    await searchItinerary(d, q1, ctx());
    expect(tokens(d, 'departure_token')).toEqual(['dC']);
  });

  it('every request is a google_flights request with sort_by=price, separate_tickets=1, adults=1, tileIndex null, never cached (synthetic)', async () => {
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const d = deps();
    await searchItinerary(d, q1, ctx());
    await searchItinerary(d, q1, ctx());
    const urls = sentUrls(d.k.events);
    expect(urls).toHaveLength(6);
    for (const u of urls)
      expect([
        u.searchParams.get('sort_by'),
        u.searchParams.get('separate_tickets'),
        u.searchParams.get('adults'),
      ]).toEqual(['price', '1', '1']);
    expect(d.k.events.filter((e) => e.type === 'reserve').every((e) => e.tileIndex === null)).toBe(true);
    expect(d.k.budget.count('cache-hit')).toBe(0);
    expect(d.k.cache.sets).toHaveLength(0);
  });

  it('fetchedAt of the chain is the oldest step: http-kit stamps each response after its body is read (synthetic)', async () => {
    const d = deps();
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
      () => d.k.clock.advance(60_000),
    );
    expect((await searchItinerary(d, q1, ctx())).fetchedAt).toBe('2026-10-14T15:01:00.000Z');
  });

  it('bookingLinks false throws before any request (spec §5.4: forced true) (synthetic)', async () => {
    chain(flightsBody([A]), {});
    const d = deps();
    await expect(searchItinerary(d, { ...CELL_QUERY, bookingLinks: false }, ctx())).rejects.toThrow(
      /bookingLinks/,
    );
    expect(d.k.events).toEqual([]);
  });
});

describe('errors that propagate (spec §5.4 rev 12, plan decision 17), synthetic', () => {
  it.each([
    ['a header-less 429', { status: 429, body: null }, 'rate-limit'],
    ['a 401', { status: 401, body: { error: 'Invalid API key.' } }, 'auth'],
    ['a 402', { status: 402, body: { error: 'Payment required' } }, 'quota'],
    [
      'a 429 asking to wait beyond MAX_WAIT_SECONDS',
      { status: 429, body: null, headers: { 'retry-after': '99999' } },
      'limiter-timeout',
    ],
  ] as const)(
    '%s at step 2 rejects with %s; no further step-2 or step-3 request (synthetic)',
    async (_label, reply, kind) => {
      chain(flightsBody([A, B]), {
        dA: reply,
        dB: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])),
      });
      const d = deps();
      await expect(searchItinerary(d, CELL_QUERY, ctx())).rejects.toMatchObject({ kind });
      expect(sentUrls(d.k.events)).toHaveLength(2);
    },
  );

  it.each([
    ['a header-less 429', { status: 429, body: null }, 'rate-limit'],
    ['a 401', { status: 401, body: { error: 'Invalid API key.' } }, 'auth'],
    ['a 402', { status: 402, body: { error: 'Payment required' } }, 'quota'],
    [
      'a 429 asking to wait beyond MAX_WAIT_SECONDS',
      { status: 429, body: null, headers: { 'retry-after': '99999' } },
      'limiter-timeout',
    ],
  ] as const)(
    '%s at step 3 rejects with %s rather than returning a partial result; three requests (synthetic)',
    async (_label, reply, kind) => {
      chain(
        flightsBody([A]),
        { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
        { b1: reply },
      );
      const d = deps();
      await expect(searchItinerary(d, q1, ctx())).rejects.toMatchObject({ kind, retryable: false });
      expect(sentUrls(d.k.events)).toHaveLength(3);
    },
  );

  it('a request the allowlist refuses never reaches reserve or the network (adapter-level check)', async () => {
    const key = '/api/v1/search?engine=google_flights';
    // why: a restrictive allowlist (sort_by departure_time only) makes the adapter's own check the one that refuses.
    const strict: ParamsAllowlist = {
      ...SEARCHAPI_PARAMS,
      endpoints: Object.fromEntries(
        Object.entries(SEARCHAPI_PARAMS.endpoints).map(([k, e]) => [
          k,
          k === key ? { ...e, values: { ...e.values, sort_by: ['departure_time'] } } : e,
        ]),
      ),
    };
    chain(flightsBody([A]), {});
    const d = { ...deps(), allowlist: strict };
    await expect(searchItinerary(d, q1, ctx())).rejects.toBeInstanceOf(ParamsNotAllowedError);
    expect(d.k.events).toEqual([]);
  });

  it('a BudgetExceeded at step 1 or at the first step 2 propagates: nothing was gathered yet', async () => {
    chain(flightsBody([A]), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) });
    for (const refuseAt of [1, 2]) {
      const budget = new FakeBudget([]);
      budget.refuse = () =>
        budget.reserveCalls === refuseAt
          ? new BudgetExceeded({ scope: 'execution-calls', cap: 1, current: 1, requested: 1 })
          : null;
      const d = deps(saKit({ budget }));
      await expect(searchItinerary(d, q1, ctx())).rejects.toBeInstanceOf(BudgetExceeded);
      expect(sentUrls(d.k.events)).toHaveLength(refuseAt - 1);
    }
  });
});

describe('a chain stopped by budget or cancel keeps what it paid for (plan decision 24, CBR-05), synthetic', () => {
  const step2 = {
    dA: ok(
      flightsBody([option(IN_1, 600, { booking_token: 'b1' }), option(IN_2, 650, { booking_token: 'b2' })]),
    ),
  };

  it('a BudgetExceeded at step 3 returns the step-2 offers as a partial result, and no further request (synthetic)', async () => {
    chain(flightsBody([A]), step2, { b1: ok(bookingBody([agent(573)])) });
    const budget = new FakeBudget([]);
    budget.refuse = (p) =>
      budget.reserveCalls === 3
        ? new BudgetExceeded({
            scope: 'execution-calls',
            cap: 2,
            current: 2,
            requested: 1,
            providerId: p.providerId,
          })
        : null;
    const d = deps(saKit({ budget }));
    const res = await searchItinerary(d, q1, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 0 });
    expect(sellers(res)).toEqual([
      ['Synthetic Air One', 65_000, 'none', false],
      ['Synthetic Air One', 60_000, 'none', false],
    ]);
    expect(res.notes).toContain('chain-stopped-budget:1');
    expect(sentUrls(d.k.events)).toHaveLength(2);
  });

  it('a BudgetExceeded at the second step 2 returns the first outbound’s offers, partial (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      { ...step2, dB: ok(flightsBody([option(IN_3, 700, { booking_token: 'b3' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const budget = new FakeBudget([]);
    budget.refuse = () =>
      budget.reserveCalls === 4
        ? new BudgetExceeded({ scope: 'provider-month', cap: 3, current: 3, requested: 1 })
        : null;
    const res = await searchItinerary(deps(saKit({ budget })), CELL_QUERY, ctx());
    expect(res.partial).toBe(true);
    expect(
      res.offers.map((o) => [o.amountMinor, o.verified]).sort(([a], [b]) => Number(a) - Number(b)),
    ).toEqual([
      [57_300, true],
      [60_000, false],
      [65_000, false],
    ]);
  });

  it('an operator cancel between step 2 and step 3 returns the step-2 offers, partial, and sends no step 3 (synthetic)', async () => {
    const ac = new AbortController();
    chain(flightsBody([A]), step2, { b1: ok(bookingBody([agent(573)])) });
    // why: the cancel lands just as step 3 is reserved, after step 2 was paid for (a deterministic hook; http-kit
    // checks the signal before every reservation).
    const budget = new (class extends FakeBudget {
      override reserve(p: Parameters<FakeBudget['reserve']>[0]) {
        if (this.reserveCalls === 2) ac.abort();
        if (ac.signal.aborted) throw new AbortedError();
        return super.reserve(p);
      }
    })([]);
    const d = deps(saKit({ budget }));
    const res = await searchItinerary(d, q1, ctx(ac.signal));
    expect(res.partial).toBe(true);
    expect(res.notes).toContain('chain-stopped-abort:1');
    expect(res.offers).toHaveLength(2);
    expect(step2Only(res)).toBe(true);
    expect(tokens(d, 'booking_token')).toEqual([]);
  });

  it('a cancel before step 1 propagates AbortedError (synthetic)', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(searchItinerary(deps(), q1, ctx(ac.signal))).rejects.toBeInstanceOf(AbortedError);
  });
});

describe('step 3 and the price-source rule (spec §5.4), synthetic shapes', () => {
  it('every priced step-2 return option is its own offer; step 3 runs only for the cheapest (synthetic)', async () => {
    chain(
      flightsBody([A]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 650, { booking_token: 'b1' }),
            option(IN_2, 600, { booking_token: 'b2' }),
            option(IN_3, 700, { booking_token: 'b3' }),
          ]),
        ),
      },
      { b2: ok(bookingBody([agent(573)])) },
    );
    const d = deps();
    const res = await searchItinerary(d, q1, ctx());
    expect(tokens(d, 'booking_token')).toEqual(['b2']);
    expect(res.offers.map((o) => o.amountMinor).sort((a, b) => a - b)).toEqual([
      57_300, 60_000, 65_000, 70_000,
    ]);
    expect(res.notes).toEqual(['airline-direct-kept:1', 'route-history-absent:1']);
    expect(res.partial).toBe(false);
    // decision 27: only the step-3 seller listing is verified; every step-2 price stays unverified.
    expect(res.offers.filter((o) => o.verified).map((o) => o.amountMinor)).toEqual([57_300]);
  });

  it('a step-3 option naming the airline replaces the step-2 airline offer (synthetic)', async () => {
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(IN_1, 603, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(603, 'Synthetic Air One'), agent(573)])) },
    );
    expect(sellers(await searchItinerary(deps(), q1, ctx()))).toEqual([
      ['Synthetic Air One', 60_300, 'post', true],
      ['Synthetic Travel Agent', 57_300, 'post', true],
    ]);
  });

  it('a step-3 seller that is a connecting carrier or a near-miss spelling keeps the step-2 offer (synthetic)', async () => {
    const mixed = [
      seg('JFK', 'BOS', '2026-11-14', '15:00', 'Y2 300', 'Synthetic Air Two'),
      seg('BOS', 'LHR', '2026-11-14', '19:00', 'X1 107', 'Synthetic Air One'),
    ];
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(mixed, 610, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(580, 'Synthetic Air Two'), agent(600, 'Synthetic Air One plc')])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(sellers(res)).toEqual([
      ['Synthetic Air Two', 58_000, 'post', true],
      ['Synthetic Air One plc', 60_000, 'post', true],
      ['Synthetic Air One', 61_000, 'none', false],
    ]);
    expect(res.notes).toEqual(['airline-direct-kept:1', 'route-history-absent:1']);
  });

  it('an outbound whose first flight states no airline: step-2 offers are dropped and counted, never named; step 3 still runs (synthetic)', async () => {
    const anon = option([seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100')], 600, { departure_token: 'dA' });
    chain(
      flightsBody([anon]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 600, { booking_token: 'b1' }),
            option(IN_2, 650, { booking_token: 'b2' }),
          ]),
        ),
      },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(sellers(res)).toEqual([['Synthetic Travel Agent', 57_300, 'post', true]]);
    expect(res.notes).toEqual(['no-airline-skipped-step2:2', 'route-history-absent:1']);
    // why: decision 41: vendor-priced step-2 fares are missing from the cell, so it is never written complete.
    expect(res.partial).toBe(true);
  });

  it('a dropped no-airline step-2 fare below every step-3 listing makes the result partial: the cell minimum is not the vendor minimum (decision 41) (synthetic)', async () => {
    const anon = option([seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100')], 600, { departure_token: 'dA' });
    chain(
      flightsBody([anon]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(620)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(sellers(res)).toEqual([['Synthetic Travel Agent', 62_000, 'post', true]]);
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 0 });
    expect(res.notes).toContain('no-airline-skipped-step2:1');
  });

  it('a step 3 whose only options are split bookings keeps the step-2 offer; the result is not partial (synthetic)', async () => {
    chain(
      flightsBody([A]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([{ is_split_booking: true, price: 400 }])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(sellers(res)).toEqual([['Synthetic Air One', 60_000, 'none', false]]);
    expect(res).toMatchObject({
      partial: false,
      notes: ['route-history-absent:1', 'split-booking-skipped:1'],
    });
  });

  it.each([
    ['fails (404)', notFound, 'booking-options-failed:1'],
    ['has no booking_options key', ok({ ...ECHO }), 'booking-options-failed:1'],
    ['fails the schema', ok({ ...ECHO, booking_options: 'x' }), 'booking-options-failed:1'],
    [
      'echoes another gl',
      ok({ search_parameters: { currency: 'GBP', gl: 'us' }, booking_options: [agent(560)] }),
      'booking-options-failed:1',
    ],
  ] as const)(
    'a step 3 that %s keeps the step-2 offer and marks the result partial, not a failed expansion (synthetic)',
    async (_label, reply, note) => {
      chain(
        flightsBody([A]),
        { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
        { b1: reply },
      );
      const res = await searchItinerary(deps(), q1, ctx());
      expect(res).toMatchObject({
        coverage: 'priced',
        partial: true,
        failedExpansions: 0,
        notes: [note, 'route-history-absent:1'],
      });
      expect(res.offers.map((o) => o.amountMinor)).toEqual([60_000]);
      expect(step2Only(res)).toBe(true);
    },
  );

  it.each([
    ['no booking_token', { dA: ok(flightsBody([{ flights: IN_1, price: 600 }])) }, {}],
    [
      'a 404 at step 3',
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: notFound },
    ],
    [
      'split-only booking options',
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([{ is_split_booking: true, price: 400 }])) },
    ],
  ] as const)(
    'an airline-less outbound with %s ends with no usable offer → parse no-usable-offers, never a priced empty result (decision 31) (synthetic)',
    async (_label, step2, step3) => {
      const anon = option([seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100')], 600, {
        departure_token: 'dA',
      });
      chain(flightsBody([anon]), step2, step3);
      await expect(searchItinerary(deps(), q1, ctx())).rejects.toMatchObject({
        kind: 'parse',
        providerId: 'searchapi',
        message: expect.stringMatching(/\[no-usable-offers\]/),
      });
    },
  );

  it('an airline-less outbound whose step 3 prices are in an unknown currency → upstream currency-unsupported (synthetic)', async () => {
    const anon = option([seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100')], 600, { departure_token: 'dA' });
    chain(
      flightsBody([anon]),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok({ search_parameters: { currency: 'XAU', gl: 'gb' }, booking_options: [agent(560)] }) },
    );
    await expect(searchItinerary(deps(), q1, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'currency-unsupported',
    });
  });

  it('an outbound whose step-2 prices were all dropped marks the result partial even when another outbound priced (decision 31) (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      {
        dA: ok({
          search_parameters: { currency: 'XAU', gl: 'gb' },
          best_flights: [option(IN_1, 600, { booking_token: 'b1' })],
        }),
        dB: ok(flightsBody([option(IN_2, 640, { booking_token: 'b2' })])),
      },
      { b2: ok(bookingBody([agent(610)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ coverage: 'priced', partial: true, failedExpansions: 0 });
    expect(res.notes).toContain('returns-dropped-for-outbound:1');
  });

  it('a cheapest return without a booking_token keeps the step-2 offer and is partial: step 3 could not run (synthetic)', async () => {
    chain(flightsBody([A]), { dA: ok(flightsBody([{ flights: IN_1, price: 600 }])) });
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res).toMatchObject({
      partial: true,
      notes: ['no-booking-token-step2:1', 'route-history-absent:1'],
    });
    expect(res.offers).toHaveLength(1);
    expect(step2Only(res)).toBe(true);
  });

  it.each([
    [
      'are seller-less',
      bookingBody([
        { price: 560, booking_request: { url: 'https://www.google.com/travel/clk/f', post_data: 'u=s' } },
      ]),
      ['booking-options-unusable-step3:1', 'no-seller-skipped-step3:1', 'route-history-absent:1'],
    ],
    [
      'are in a currency core does not know',
      { search_parameters: { currency: 'XAU', gl: 'gb' }, booking_options: [agent(560)] },
      ['booking-options-unusable-step3:1', 'offers-dropped:1', 'route-history-absent:1'],
    ],
  ] as const)(
    'a step 3 whose non-split options %s keeps the step-2 offer and is partial (synthetic)',
    async (_label, body, notes) => {
      chain(
        flightsBody([A]),
        { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
        { b1: ok(body) },
      );
      const res = await searchItinerary(deps(), q1, ctx());
      expect(res).toMatchObject({ partial: true, notes });
      expect(sellers(res)).toEqual([['Synthetic Air One', 60_000, 'none', false]]);
    },
  );

  it('calls per cell are 1 + expandTop × 2 when every step succeeds (spec §5.4) (synthetic)', async () => {
    server.use(
      syntheticHandler((p) => {
        if (p.has('booking_token')) return ok(bookingBody([agent(573)]));
        const dep = p.get('departure_token');
        if (dep !== null) return ok(flightsBody([option(IN_1, 600, { booking_token: `b-${dep}` })]));
        return ok(flightsBody([A, B]));
      }),
    );
    const d = deps();
    await searchItinerary(d, CELL_QUERY, ctx());
    expect(sentUrls(d.k.events)).toHaveLength(1 + 2 * 2);
    expect(estimateItinerary(CELL_QUERY, 0).calls).toBe(5);
  });
});

describe('currency, money and route history (spec §2, §6.3, plan decisions 24–25), synthetic', () => {
  it('a step-1 response that states no currency → parse (synthetic)', async () => {
    chain({ best_flights: [A] }, {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'parse',
      message: expect.stringMatching(/no-currency/),
    });
  });

  it('a step-1 currency core does not know → upstream currency-unsupported, never parse, one call (synthetic)', async () => {
    chain({ search_parameters: { currency: 'XAU', gl: 'gb' }, best_flights: [A] }, {});
    const d = deps();
    await expect(searchItinerary(d, CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'currency-unsupported',
      retryable: false,
    });
    expect(sentUrls(d.k.events)).toHaveLength(1);
  });

  it('a USD echo passes through as USD at its exponent (currency from the response) (synthetic)', async () => {
    const usd = { search_parameters: { currency: 'USD', gl: 'gb' } };
    chain(
      { ...usd, best_flights: [A] },
      { dA: ok({ ...usd, best_flights: [option(IN_1, 760.5, { booking_token: 'b1' })] }) },
      { b1: ok({ ...usd, booking_options: [agent(720.25)] }) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.offers.map((o) => [o.amountMinor, o.currency])).toEqual([
      [72_025, 'USD'],
      [76_050, 'USD'],
    ]);
  });

  it('a step-2 price with excess precision is dropped and counted offers-dropped, never rounded (synthetic)', async () => {
    chain(
      flightsBody([A]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 600, { booking_token: 'b1' }),
            option(IN_2, 612.345, { booking_token: 'b2' }),
          ]),
        ),
      },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.offers.map((o) => o.amountMinor)).not.toContain(61_235);
    expect(res.notes).toContain('offers-dropped:1');
  });

  it('price_insights.price_history becomes routeHistory in minor units; bad points are dropped and counted (synthetic)', async () => {
    const history = {
      price_insights: {
        price_history: [
          { price: 646, iso_date: '2026-09-19T04:00:00Z' },
          { price: 612.5, iso_date: '2026-09-20T04:00:00Z' },
          { price: 600, iso_date: 'garbage' },
          { price: 600, iso_date: '2026-02-30T04:00:00Z' },
          { price: 0, iso_date: '2026-09-21T04:00:00Z' },
          { iso_date: '2026-09-22T04:00:00Z' },
        ],
      },
    };
    chain(
      flightsBody([A], history),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.routeHistory).toEqual([
      { date: '2026-09-19', lowestPriceMinor: 64_600, currency: 'GBP' },
      { date: '2026-09-20', lowestPriceMinor: 61_250, currency: 'GBP' },
    ]);
    expect(res.notes).toContain('route-history-dropped:4');
    expect(res.notes.some((n) => n.startsWith('route-history-absent'))).toBe(false);
  });

  it('a step-1 body failing the schema → parse malformed-flights with providerId searchapi (synthetic)', async () => {
    chain({ ...ECHO, best_flights: 'x' }, {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({
      kind: 'parse',
      providerId: 'searchapi',
      message: expect.stringMatching(/malformed-flights/),
    });
  });

  it('a step-2 return leg through a non-IATA airport is counted and never an offer (synthetic)', async () => {
    const odd = [seg('JFK', '/m/02_286', '2026-11-14', '18:00', 'X1 109', 'Synthetic Air One')];
    chain(
      flightsBody([A]),
      {
        dA: ok(
          flightsBody([
            option(IN_1, 600, { booking_token: 'b1' }),
            option(odd, 550, { booking_token: 'bX' }),
          ]),
        ),
      },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.notes).toContain('unusable-segments-step2:1');
    expect(res.offers.map((o) => o.amountMinor)).not.toContain(55_000);
  });

  it('a step-2 body echoing another gl is a failed expansion (parse), never priced (synthetic)', async () => {
    chain(
      flightsBody([A, B]),
      {
        dA: ok({
          search_parameters: { currency: 'GBP', gl: 'us' },
          best_flights: [option(IN_1, 600, { booking_token: 'b1' })],
        }),
        dB: ok(flightsBody([option(IN_2, 640, { booking_token: 'b2' })])),
      },
      { b2: ok(bookingBody([agent(610)])) },
    );
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res).toMatchObject({ partial: true, failedExpansions: 1 });
    expect(res.offers.map((o) => o.amountMinor)).not.toContain(60_000);
  });

  it('step-2 returns all in a currency core does not know → currency-unsupported, never no-return-legs (synthetic)', async () => {
    chain(flightsBody([A]), {
      dA: ok({
        search_parameters: { currency: 'XAU', gl: 'gb' },
        best_flights: [option(IN_1, 600, { booking_token: 'b1' })],
      }),
    });
    await expect(searchItinerary(deps(), q1, ctx())).rejects.toMatchObject({
      kind: 'upstream',
      reason: 'currency-unsupported',
    });
  });

  it('step-2 returns whose prices are all unusable → parse unusable-return-prices, never no-return-legs (synthetic)', async () => {
    chain(flightsBody([A]), { dA: ok(flightsBody([option(IN_1, 600.125, { booking_token: 'b1' })])) });
    await expect(searchItinerary(deps(), q1, ctx())).rejects.toMatchObject({
      kind: 'parse',
      providerId: 'searchapi',
      message: expect.stringMatching(/unusable-return-prices/),
    });
  });

  it.each([
    ['a null price_insights', { price_insights: null }],
    ['a price_insights without price_history', { price_insights: {} }],
    ['no price_insights key (the recorded shape)', {}],
  ])(
    '%s yields an empty routeHistory and the informational route-history-absent count, never an error or a partial (decision 40) (synthetic)',
    async (_label, extra) => {
      chain(
        flightsBody([A], extra),
        { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
        { b1: ok(bookingBody([agent(573)])) },
      );
      const res = await searchItinerary(deps(), q1, ctx());
      expect(res).toMatchObject({ routeHistory: [], partial: false, coverage: 'priced' });
      expect(res.notes.filter((n) => n.startsWith('route-history'))).toEqual(['route-history-absent:1']);
    },
  );

  it('an empty price_history is a series the vendor stated: empty routeHistory, no absent count (synthetic)', async () => {
    chain(
      flightsBody([A], { price_insights: { price_history: [] } }),
      { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) },
      { b1: ok(bookingBody([agent(573)])) },
    );
    const res = await searchItinerary(deps(), q1, ctx());
    expect(res.routeHistory).toEqual([]);
    expect(res.notes.some((n) => n.startsWith('route-history'))).toBe(false);
  });
});

describe('estimateItinerary (spec §5.4, §12; ruling po-006)', () => {
  it('calls = 1 + expandTop × 2, priced at the configured per-call cost, 29 s per call', () => {
    expect(estimateItinerary(CELL_QUERY, 1234)).toMatchObject({
      calls: 5,
      costMicroGbp: 5 * 1234,
      seconds: 145,
    });
    expect(estimateItinerary({ ...CELL_QUERY, expandTop: 3 }, 0)).toMatchObject({
      calls: 7,
      costMicroGbp: 0,
    });
    expect(() => estimateItinerary({ ...CELL_QUERY, bookingLinks: false }, 0)).toThrow(/bookingLinks/);
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
  AbortedError,
  BudgetExceeded,
  type CostEstimate,
  type IsoDateTime,
  type ItineraryQuery,
  type ItinerarySearchResult,
  type Logger,
  type ProviderContext,
  ProviderError,
  type RawOffer,
  type RawSegment,
  type Secret,
} from '@gmt/core';
import type { HttpKit, HttpKitResponse } from '../http/types.js';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import { parseError } from '../shared/errors.js';
import { majorToMinor } from '../shared/money.js';
import { NoteCounter } from '../shared/notes.js';
import { bookingOffers, statedAirline, step3NamesAirline, toRawSegments } from './offers.js';
import { authHeaders, flightsParams, SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_WHERE, toUrl } from './params.js';
import { currencySupported, minorOrDrop, type VendorOption } from './shapes.js';
import { parseBooking, parseFlights, toRouteHistory } from './steps.js';

/** What `search` needs; built once by `searchApiProvider`. */
export interface ItineraryDeps {
  http: HttpKit;
  log: Logger;
  key: Secret;
  pointOfSale: string;
  allowlist: ParamsAllowlist;
}

/** Slowest calendar call measured on 2026-10-14 (spec §2: 9–29 s); itinerary latency was not measured separately. */
export const WORST_SECONDS_PER_CALL = 29;

/** Spec §5.4: `bookingLinks` is forced true for SearchApi. */
export function assertBookingLinks(q: ItineraryQuery): void {
  if (q.bookingLinks !== true)
    throw new TypeError('searchapi itinerary queries require bookingLinks: true (spec §5.4)');
}

/**
 * `VerificationCapability.estimate`: calls = 1 + expandTop × 2 (spec §5.4), priced at the configured
 * `limits.costPerCallMicroGbp`, the same rate http-kit ledgers every reservation with (spec §12 override
 * SEARCHAPI_COST_PER_CALL_MICRO_GBP included), so estimate and ledger never disagree.
 */
export function estimateItinerary(q: ItineraryQuery, costPerCallMicroGbp: number): CostEstimate {
  assertBookingLinks(q);
  const calls = 1 + q.expandTop * 2;
  return {
    calls,
    costMicroGbp: calls * costPerCallMicroGbp,
    seconds: calls * WORST_SECONDS_PER_CALL,
    notes: [
      `1 outbound search + ${q.expandTop} × (return search + booking options)`,
      `${costPerCallMicroGbp} µGBP per call, the configured SearchApi rate`,
      `${WORST_SECONDS_PER_CALL} s per call, the slowest calendar call measured on 2026-10-14`,
    ],
  };
}

/**
 * Spec §5.4 (rev 12) and plan decision 17: only `upstream`, `network` and `parse` are a failed expansion; `auth`,
 * `quota`, `rate-limit` and `limiter-timeout` from any step propagate unchanged.
 */
function isExpansionFailure(err: unknown): err is ProviderError {
  return (
    err instanceof ProviderError &&
    (err.kind === 'upstream' || err.kind === 'network' || err.kind === 'parse')
  );
}

/**
 * The chain's `currency-unsupported` error (spec §3: a normalisation reason, never `parse`; plan decision 29):
 * non-retryable `upstream`, the message naming the step.
 */
function currencyUnsupported(message: string): ProviderError {
  return new ProviderError({
    kind: 'upstream',
    reason: 'currency-unsupported',
    retryable: false,
    providerId: 'searchapi',
    message,
  });
}

/** A refused reservation or an operator cancel: the chain stops (plan decisions 24 and 25). */
function isChainStop(err: unknown): err is BudgetExceeded | AbortedError {
  return err instanceof BudgetExceeded || err instanceof AbortedError;
}

async function send(
  d: ItineraryDeps,
  params: Record<string, string>,
  ctx: ProviderContext,
): Promise<HttpKitResponse> {
  const url = toUrl(params);
  assertRequestAllowed(d.allowlist, SEARCHAPI_ENDPOINT_PATH, url);
  // why: every google_flights response carries departure or booking tokens; spec §5.3: token-bearing responses
  // are never cached.
  return d.http.request({
    providerId: 'searchapi',
    executionId: ctx.executionId,
    tileIndex: null,
    endpointPath: SEARCHAPI_ENDPOINT_PATH,
    method: 'GET',
    url,
    headers: authHeaders(d.key),
    cache: 'never',
    signal: ctx.signal,
    recordFixtures: ctx.recordFixtures,
  });
}

/** A priced option with its converted legs. */
interface Usable {
  option: VendorOption;
  minor: number;
  segs: RawSegment[];
}

/**
 * `VerificationCapability.search` for SearchApi: the spec §5.4 chain.
 * - Step 1: options sorted by price (sent with sort_by=price, then sorted locally; "cheapest" holds over the
 *   options the vendor returned only). Zero options → `empty`; options but none priced and usable →
 *   `upstream`/`no-priced-options`; a currency core does not know → `upstream`/`currency-unsupported`.
 * - Step 2 for the `expandTop` cheapest: every priced return option is an offer, `verified: false`, whose seller is
 *   the airline the vendor states on the first outbound flight; with no stated airline those offers are dropped and
 *   counted (`no-airline-skipped-step2`), never given an invented seller (plan decision 27), and the result is partial (decision 41). Returns whose prices
 *   were all dropped are not "no legs": if no outbound yields a usable leg the cell is `currency-unsupported` or
 *   `parse`, never `no-return-legs`.
 * - Step 3 for the cheapest return per outbound: every usable booking option is an offer, `verified: true`; the
 *   step-2 price stays as the airline-direct offer (still `verified: false`) only when no step-3 option names that
 *   airline. A failed step 3, none possible (no booking_token), or one whose non-split options were all unusable
 *   keeps the step-2 offer and marks the result partial.
 * - Only upstream, network and parse count as a failed expansion; every other error propagates. A
 *   BudgetExceeded or AbortedError after offers were gathered returns them with partial: true (written with reason
 *   `partial-expansion`, plan decisions 24 and 27) so a resume does not re-bill the chain; before any offer it
 *   propagates.
 * `fetchedAt` is the oldest step's (spec §2).
 */
export async function searchItinerary(
  d: ItineraryDeps,
  q: ItineraryQuery,
  ctx: ProviderContext,
): Promise<ItinerarySearchResult> {
  assertBookingLinks(q);
  const gl = d.pointOfSale.toLowerCase();
  const notes = new NoteCounter();
  const base = flightsParams(q, d.pointOfSale);

  const s1 = await send(d, base, ctx);
  const r1 = parseFlights(s1.body, gl, 'step 1');
  const fetched: IsoDateTime[] = [s1.fetchedAt];
  const routeHistory = toRouteHistory(r1.priceHistory, r1.currency, notes);
  if (r1.options.length === 0) {
    return {
      offers: [],
      coverage: 'empty',
      fetchedAt: s1.fetchedAt,
      pointOfSale: r1.pointOfSale,
      partial: false,
      failedExpansions: 0,
      notes: notes.list(),
      routeHistory,
    };
  }
  if (!currencySupported(r1.currency)) {
    // why: spec §8.1: currency-unsupported is a normalisation reason, never parse; stopping here spends no step-2 call
    // on prices that could only be dropped.
    throw currencyUnsupported(
      `searchapi step 1: prices in ${r1.currency}, which has no known minor-unit exponent`,
    );
  }

  const usable1: Array<Usable & { token: string }> = [];
  for (const o of r1.options) {
    const segs = toRawSegments(o.flights);
    const minor = o.price === undefined ? null : majorToMinor(o.price, r1.currency);
    if (o.price === undefined) notes.add('unpriced-skipped-step1');
    else if (o.departure_token === undefined) notes.add('no-departure-token-step1');
    else if (segs === null) notes.add('unusable-segments-step1');
    else if (minor === null) notes.add('unusable-price-step1');
    else usable1.push({ option: o, minor, segs, token: o.departure_token });
  }
  if (usable1.length === 0 && r1.options.some((o) => o.price !== undefined)) {
    // why: decision 31: the vendor priced options the adapter could not use; that is a parse fault, not "no prices".
    throw parseError(
      'unusable-step1-options',
      `step 1: ${r1.options.length} options and none usable (${notes.list().join(', ')})`,
      SEARCHAPI_WHERE,
    );
  }
  if (usable1.length === 0) {
    // why: spec §5.4: every step-1 option unpriced → upstream, reason no-priced-options, non-retryable on resume.
    throw new ProviderError({
      kind: 'upstream',
      reason: 'no-priced-options',
      retryable: false,
      providerId: 'searchapi',
      message: `searchapi step 1: ${r1.options.length} options and none priced`,
    });
  }
  const expand = [...usable1].sort((a, b) => a.minor - b.minor).slice(0, q.expandTop); // stable: vendor order breaks ties

  const offers: RawOffer[] = [];
  const add = (o: RawOffer | null): void => {
    if (o !== null) offers.push(o);
  };
  let failed = 0;
  let withLegs = 0;
  // why: returns the vendor priced but the adapter could not use are not "no legs" (PA2-04); their reasons decide
  // the cell's error when no outbound yields a usable leg.
  const legDrops = new Set<'currency-unsupported' | 'parse'>();
  let partial = false;
  let stop: BudgetExceeded | AbortedError | null = null;
  for (const out of expand) {
    let r2: ReturnType<typeof parseFlights>;
    try {
      const s2 = await send(d, { ...base, departure_token: out.token }, ctx);
      fetched.push(s2.fetchedAt);
      r2 = parseFlights(s2.body, gl, 'step 2');
    } catch (err) {
      if (isExpansionFailure(err)) {
        failed += 1;
        notes.add('expansion-failed');
        continue;
      }
      if (isChainStop(err) && offers.length > 0) {
        stop = err;
        break;
      }
      throw err;
    }
    const returns: Usable[] = [];
    const dropped = new Set<'currency-unsupported' | 'parse'>();
    for (const o of r2.options) {
      const segs = toRawSegments(o.flights);
      if (o.price === undefined) notes.add('unpriced-skipped-step2');
      else if (segs === null) notes.add('unusable-segments-step2');
      else {
        const m = minorOrDrop(o.price, r2.currency, notes);
        if (m.minor === null) dropped.add(m.dropped);
        else returns.push({ option: o, minor: m.minor, segs });
      }
    }
    if (returns.length === 0) {
      if (dropped.size > 0) {
        // why: decision 31 (PA3-02): this outbound's fares were present and are missing from the cell.
        partial = true;
        notes.add('returns-dropped-for-outbound');
        for (const reason of dropped) legDrops.add(reason);
      } else notes.add('no-return-legs-for-outbound'); // spec §5.4: contributes nothing, not a failure
      continue;
    }
    withLegs += 1;
    // why: never invent a seller (plan decision 24): only an airline the vendor states names a step-2 offer.
    const airline = statedAirline(out.option.flights);
    if (airline === null) {
      notes.add('no-airline-skipped-step2', returns.length);
      // why: plan decision 41: the vendor priced these returns and none can be written, so the cell's minimum may be
      // above the vendor's; it is never written complete.
      partial = true;
    }
    const step2Offer = (r: Usable): RawOffer | null =>
      airline === null
        ? null
        : {
            outbound: out.segs,
            inbound: r.segs,
            seller: airline,
            requestedCabin: q.cabin,
            amountMinor: r.minor,
            currency: r2.currency,
            booking: { kind: 'none' },
            // why: a step-2 price is SearchApi's declaration of Google's fare for the airline, never a seller
            // listing (plan decision 27): WP7 writes it unverified, whatever later happens at step 3.
            verified: false,
          };
    const cheapest = returns.reduce((m, r) => (r.minor < m.minor ? r : m));
    for (const r of returns) if (r !== cheapest) add(step2Offer(r));
    const direct = step2Offer(cheapest);
    const bookingToken = cheapest.option.booking_token;
    if (bookingToken === undefined) {
      // why: spec §5.4: step 3 always runs, because a seller can undercut the airline; without it the cell is partial.
      notes.add('no-booking-token-step2');
      partial = true;
      add(direct);
      continue;
    }
    let step3: RawOffer[];
    try {
      const s3 = await send(d, { ...base, booking_token: bookingToken }, ctx);
      fetched.push(s3.fetchedAt);
      const r3 = parseBooking(s3.body, gl);
      if (!currencySupported(r3.currency)) legDrops.add('currency-unsupported');
      step3 = bookingOffers(
        { cabin: q.cabin, outbound: out.segs, inbound: cheapest.segs },
        r3.options,
        r3.currency,
        notes,
      );
      // why: seller prices step 3 exists to find were present but unusable, so the cheapest may be lower than shown
      // (PA2-03); only split bookings are excluded by rule and leave the result whole.
      if (step3.length === 0 && r3.options.some((o) => o.is_split_booking !== true)) {
        partial = true;
        notes.add('booking-options-unusable-step3');
      }
    } catch (err) {
      if (isExpansionFailure(err)) {
        // why: spec §5.4: a failed step 3 keeps the step-2 airline offer and the cell is priced with partial: true.
        partial = true;
        notes.add('booking-options-failed');
        add(direct);
        continue;
      }
      if (isChainStop(err)) {
        add(direct);
        if (offers.length > 0) {
          stop = err;
          break;
        }
      }
      throw err;
    }
    offers.push(...step3);
    if (direct !== null && !step3NamesAirline(step3, direct.seller)) {
      add(direct);
      if (step3.length > 0) notes.add('airline-direct-kept');
    }
  }

  if (stop !== null) {
    notes.add(stop instanceof BudgetExceeded ? 'chain-stopped-budget' : 'chain-stopped-abort');
    d.log.info(
      { offers: offers.length, notes: notes.list() },
      'searchapi chain stopped; returning the offers already paid for',
    );
  } else if (withLegs === 0 && legDrops.has('currency-unsupported')) {
    throw currencyUnsupported(
      `searchapi step 2: return prices in a currency with no known minor-unit exponent`,
    );
  } else if (withLegs === 0 && legDrops.size > 0) {
    throw parseError(
      'unusable-return-prices',
      'step 2: every priced return had an unusable price',
      SEARCHAPI_WHERE,
    );
  } else if (withLegs === 0) {
    throw new ProviderError({
      kind: 'upstream',
      reason: 'no-return-legs',
      retryable: false,
      providerId: 'searchapi',
      message: `searchapi: ${expand.length} outbound expansions produced no return legs (${failed} failed)`,
    });
  }
  if (offers.length === 0) {
    // why: decision 31 (PA3-01): the vendor priced return legs but no offer survived (no stated airline and no usable
    // step-3 listing). A priced result without offers would be written `empty`, positive evidence of no fares.
    if (legDrops.has('currency-unsupported'))
      throw currencyUnsupported(
        'searchapi: no usable offer; prices in a currency with no known minor-unit exponent',
      );
    throw parseError(
      'no-usable-offers',
      `priced legs but no offer attributable to a stated seller (${notes.list().join(', ')})`,
      SEARCHAPI_WHERE,
    );
  }
  const fetchedAt = fetched.reduce((a, b) => (b < a ? b : a));
  d.log.debug(
    { offers: offers.length, failedExpansions: failed, notes: notes.list() },
    'searchapi itinerary chain parsed',
  );
  return {
    offers,
    coverage: 'priced',
    fetchedAt,
    pointOfSale: r1.pointOfSale,
    partial: partial || failed > 0 || stop !== null,
    failedExpansions: failed,
    notes: notes.list(),
    routeHistory,
  };
}
```

```ts
// src/searchapi/steps.ts
// The google_flights step parsers and the route-history conversion, beside the chain that calls them.
import { type ItinerarySearchResult, isoDateSchema } from '@gmt/core';
import { parseError, parseVendor } from '../shared/errors.js';
import { majorToMinor } from '../shared/money.js';
import type { NoteCounter } from '../shared/notes.js';
import { SEARCHAPI_WHERE } from './params.js';
import { bookingResponseSchema, flightsResponseSchema, historyPointSchema, readEcho } from './shapes.js';

type RouteHistory = NonNullable<ItinerarySearchResult['routeHistory']>;

/**
 * Steps 1 and 2 (`step` names which in the message). A body with neither `best_flights` nor `other_flights` is a parse error, never "no options": an
 * unread key must not become positive evidence of no fares (spec §3 `empty`).
 */
export function parseFlights(body: unknown, gl: string, step: string) {
  const data = parseVendor(flightsResponseSchema, body, 'malformed-flights', SEARCHAPI_WHERE);
  const echo = readEcho(data.search_parameters, gl);
  if (data.best_flights === undefined && data.other_flights === undefined)
    throw parseError(
      'no-options-key',
      `${step}: neither best_flights nor other_flights is present`,
      SEARCHAPI_WHERE,
    );
  return {
    ...echo,
    options: [...(data.best_flights ?? []), ...(data.other_flights ?? [])],
    // why: null when the vendor sent no series at all (plan decision 40: best-effort), told apart from an empty one.
    priceHistory: data.price_insights?.price_history ?? null,
  };
}

/** Step 3. A body without `booking_options` is a failed step 3 (the step-2 offer is kept, partial). */
export function parseBooking(body: unknown, gl: string) {
  const data = parseVendor(bookingResponseSchema, body, 'malformed-booking-options', SEARCHAPI_WHERE);
  const echo = readEcho(data.search_parameters, gl);
  if (data.booking_options === undefined)
    throw parseError('no-booking-options-key', 'step 3: booking_options is not present', SEARCHAPI_WHERE);
  return { ...echo, options: data.booking_options };
}

/**
 * `price_insights.price_history` as Google's route-level price-insight series, indicative (spec §2 bonus, §7; the
 * engine stores it in route_price_history, GBP points only per plan decision 25). That label is the spec's; whether
 * the series is per route or per searched dates and cabin is unverified (§13). A point that is malformed, has an impossible date or a price the shared `majorToMinor` refuses is dropped and counted
 * `route-history-dropped`; it never fails the step. A response with no series at all yields an empty history and the
 * informational count `route-history-absent` (plan decision 40: best-effort).
 */
export function toRouteHistory(
  points: readonly unknown[] | null,
  currency: string,
  notes: NoteCounter,
): RouteHistory {
  const out: RouteHistory = [];
  if (points === null) {
    // why: plan decision 40: the series is best-effort (WP4b's recorded step 1 carries none), so its absence is an
    // informational count, never an error, an issue or a partial result.
    notes.add('route-history-absent');
    return out;
  }
  for (const raw of points) {
    const p = historyPointSchema.safeParse(raw);
    // why: `iso_date` is an instant (e.g. 2026-09-19T04:00:00Z); its UTC calendar date is the series day.
    const date = p.success ? isoDateSchema.safeParse(p.data.iso_date.slice(0, 10)) : null;
    // why: majorToMinor refuses a currency core has no exponent for, so no separate currency check is needed.
    const minor = p.success ? majorToMinor(p.data.price, currency) : null;
    if (date === null || !date.success || minor === null) {
      notes.add('route-history-dropped');
      continue;
    }
    out.push({ date: date.data, lowestPriceMinor: minor, currency });
  }
  return out;
}
```

The adapter sets `ProviderError.reason` only to `no-return-legs`, `no-priced-options` (spec §5.4) and `currency-unsupported` (a normalisation reason, spec §3; decision 29); its parse errors carry the kind-level reason `parse` from WP6's `parseError`, with `providerId: 'searchapi'` and the cause in brackets; every other cause is a note or a tag in the message, which goes to `last_error`. Every step-2 offer is `verified: false` and every step-3 offer `verified: true` (decision 27), so WP7 never writes a declared step-2 price as a verified fare. A chain that ends with zero usable offers (an outbound with no stated airline and no usable step-3 listing) throws `parse` (`no-usable-offers`) or `upstream`/`currency-unsupported` (decision 31), because a priced result with no offers would be written `empty`. Note keys use hyphens only (`unpriced-skipped-step1`, `chain-stopped-budget`), so the shared `key:n` grammar has exactly one colon. A chain stopped by a refused reservation or an operator cancel after offers were gathered resolves rather than rejects: the result is `priced` with `partial: true` and the note `chain-stopped-budget` or `chain-stopped-abort`, which WP7 writes with `partial-expansion` after the stop signal (decision 27), so a resume does not re-bill the chain; the stop itself reaches the engine through `ctx.signal` and the next reservation (decision 25). Step-2 fares dropped because the outbound states no airline make the result `partial: true` whenever returns were priced (decision 41: the cell's minimum may be above the vendor's). The route history is best-effort (decision 40): a step 1 with no series yields `routeHistory: []` and the informational note `route-history-absent:1`, never an error or a partial result, and every exact note list in the synthetic tests whose step 1 carries no `price_insights` includes that note; an empty `price_history: []` is a series the vendor stated and adds no note.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/itinerary.test.ts`
Expected: PASS, 64 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi itinerary chain with spec §5.4 rules, propagation per decision 17 and paid-for partials"
```

### Task 5.7: Provider assembly, estimate, healthcheck, barrel

**Files:** create `src/searchapi/provider.ts`, `test/searchapi/support/provider.ts` and `test/searchapi/provider.test.ts`. Modify `src/index.ts`, `test/barrel.test.ts` and `vitest.config.ts`.

**Interfaces:** consumes everything above, plus `cabinSchema`, `findBannedWords`, `BANNED_WORD_ALLOWLIST`. Produces `searchApiProvider` (section 5 signature), `SEARCHAPI_DISPLAY_NAME`, `SEARCHAPI_DISCOVERY_INFO`, `SEARCHAPI_VERIFICATION_INFO`, `SEARCHAPI_SUPPLIED_FIELDS`, and the barrel exports.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/support/provider.ts
import type { FlightProvider } from '@gmt/core';
import { SEARCHAPI_PARAMS } from '../../../src/searchapi/params.js';
import { searchApiProvider } from '../../../src/searchapi/provider.js';
import { KEY, saKit } from './kit.js';

type Options = Parameters<typeof searchApiProvider>[0];

export function makeProvider(k = saKit(), overrides: Partial<Options> = {}): FlightProvider {
  return searchApiProvider({
    http: k.kit,
    log: k.log,
    clock: k.clock,
    key: KEY,
    costPerCallMicroGbp: 0,
    pointOfSale: 'GB',
    cacheTtlSeconds: 3600,
    paramsAllowlist: SEARCHAPI_PARAMS,
    ...overrides,
  });
}

/** Both capabilities, or a failure: SearchApi always exposes discovery and verification. */
export function capabilities(p: FlightProvider) {
  const { discovery, verification } = p;
  if (discovery === undefined || verification === undefined)
    throw new Error('searchapi exposes both capabilities');
  return { discovery, verification };
}
```

```ts
// test/searchapi/provider.test.ts
import { asIata, asIsoDate, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SEARCHAPI_DISCOVERY_INFO,
  SEARCHAPI_DISPLAY_NAME,
  SEARCHAPI_VERIFICATION_INFO,
} from '../../src/searchapi/provider.js';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, saKit } from './support/kit.js';
import { capabilities, makeProvider } from './support/provider.js';
import { CELL_QUERY, ok, syntheticHandler } from './support/synthetic.js';

afterEach(() => assertEverySentAllowed());

describe('searchApiProvider (spec §5.1, §2)', () => {
  const p = makeProvider();

  it('identifies as searchapi with the labelled display name and all four cabins', () => {
    expect(p.id).toBe('searchapi');
    expect(p.displayName).toBe('Google Flights via SearchApi');
    expect(p.cabins).toEqual(['economy', 'premium_economy', 'business', 'first']);
  });

  it('declares discovery scraped-aggregate ≤24 h and verification scraped-search of unknown age (plan decision 24)', () => {
    const { discovery, verification } = capabilities(p);
    expect(discovery.info).toEqual(SEARCHAPI_DISCOVERY_INFO);
    expect(discovery.info).toMatchObject({ sourceKind: 'scraped-aggregate', maxAgeHours: 24 });
    expect(verification.info).toMatchObject({ sourceKind: 'scraped-search', maxAgeHours: 'unknown' });
  });

  it('provenance notes say what is assumed and what is declared (PA-10, PA-11, ruling 2)', () => {
    expect(SEARCHAPI_DISCOVERY_INFO.provenanceNote).toContain('Google date grid via SearchApi');
    expect(SEARCHAPI_DISCOVERY_INFO.provenanceNote).toContain(
      'window is undocumented; the app assumes up to 24 hours',
    );
    expect(SEARCHAPI_DISCOVERY_INFO.provenanceNote).toContain('separate-ticket');
    expect(SEARCHAPI_VERIFICATION_INFO.provenanceNote).toContain('Google Flights via SearchApi');
    expect(SEARCHAPI_VERIFICATION_INFO.provenanceNote).toContain('cached result of undocumented age');
    expect(SEARCHAPI_VERIFICATION_INFO.provenanceNote).toContain(
      "declaration of Google's round-trip price for one adult",
    );
  });

  it('display name and provenance notes carry no banned word (spec §11)', () => {
    for (const text of [
      SEARCHAPI_DISPLAY_NAME,
      SEARCHAPI_DISCOVERY_INFO.provenanceNote,
      SEARCHAPI_VERIFICATION_INFO.provenanceNote,
    ])
      expect(findBannedWords(text, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });

  it('never declares seller, selfTransfer or fareConditions (never invent a seller; Task 5.9 checks the rest against recordings)', () => {
    for (const f of ['seller', 'selfTransfer', 'fareConditions'] as const)
      expect(p.suppliedFields).not.toContain(f);
  });

  it('estimate prices calls at the configured per-call cost, the rate http-kit ledgers with (ruling po-006)', () => {
    expect(
      capabilities(makeProvider(saKit(), { costPerCallMicroGbp: 1234 })).verification.estimate(CELL_QUERY),
    ).toMatchObject({ calls: 5, costMicroGbp: 5 * 1234, seconds: 145 });
    expect(capabilities(p).verification.estimate({ ...CELL_QUERY, expandTop: 3 })).toMatchObject({
      calls: 7,
      costMicroGbp: 0,
    });
  });

  it('plan length is the discovery estimate (spec §5.2 estimate parity): 21 tiles for the worked band', () => {
    const q = {
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureFrom: asIsoDate('2026-10-21'),
      departureTo: asIsoDate('2027-04-20'),
      minNights: 10,
      maxNights: 21,
      cabin: 'economy' as const,
      currency: 'GBP' as const,
    };
    expect(capabilities(p).discovery.plan(q)).toHaveLength(21);
  });

  it('healthcheck is stateless and sends nothing: ok, detail "not probed" (plan decision 24)', async () => {
    server.use(syntheticHandler(() => ok({})));
    const k = saKit();
    const h = await makeProvider(k).healthcheck(ctx());
    expect(h).toEqual({ ok: true, detail: expect.stringMatching(/^not probed/) });
    expect(k.events).toEqual([]);
  });

  it('refuses a point of sale the recorded allowlist cannot send, or a malformed one', () => {
    expect(() => makeProvider(saKit(), { pointOfSale: 'gb' })).toThrow(/POINT_OF_SALE/);
    expect(() => makeProvider(saKit(), { pointOfSale: 'US' })).toThrow(/record fixtures for it first/);
  });
});
```

In `test/barrel.test.ts` (decision 30's surface), add to the main barrel's exported-functions list, after `'ParamsNotAllowedError',`:

```ts
      // WP5: the SearchApi adapter's provider and limits (plan decision 30)
      'searchApiProvider',
      'searchApiHttpLimits',
```

after `expect(main.CREDENTIAL_HEADERS).toBeInstanceOf(Set);`:

```ts
    expect(main.SEARCHAPI_PARAMS).toMatchObject({ provider: 'searchapi' });
```

and to its "not exported" list, after WP6's `'NoteCounter',` line:

```ts
      // WP5: SearchApi internals stay module-local (plan decision 30)
      'classifySearchApiError',
      'planRectangles',
      'SEARCHAPI_HOST',
      'SEARCHAPI_DISCOVERY_INFO',
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/provider.test.ts test/barrel.test.ts`
Expected: FAIL. `../../src/searchapi/provider.js` cannot be resolved, and the barrel test reports `searchApiProvider` missing.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/provider.ts
import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  cabinSchema,
  type FlightProvider,
  type Logger,
  type Secret,
  type SuppliedField,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';
import type { ParamsAllowlist } from '../params/allowlist.js';
import { type CalendarDeps, fetchCalendarTile, planRectangles } from './calendar.js';
import { estimateItinerary, type ItineraryDeps, searchItinerary } from './itinerary.js';
import { assertPointOfSaleAllowed } from './params.js';

/** The label user-facing strings use for this provider's itinerary source (spec §11). */
export const SEARCHAPI_DISPLAY_NAME = 'Google Flights via SearchApi';

/** Spec §2 table, calendar row; spec §11 names this source "Google date grid via SearchApi". */
export const SEARCHAPI_DISCOVERY_INFO: CapabilityInfo = {
  sourceKind: 'scraped-aggregate',
  maxAgeHours: 24,
  provenanceNote:
    'Google date grid via SearchApi: date-grid prices SearchApi scrapes from Google Flights, in the currency the response states. SearchApi may answer a repeat from its own cache, whose window is undocumented; the app assumes up to 24 hours. SearchApi is asked to exclude separate-ticket itineraries.',
};

/**
 * Spec §2 table, itinerary row, with plan decision 24: `maxAgeHours` is 'unknown' because the vendor may serve a
 * cached result of undocumented age (spec §2 fact 4), never 0.
 */
export const SEARCHAPI_VERIFICATION_INFO: CapabilityInfo = {
  sourceKind: 'scraped-search',
  maxAgeHours: 'unknown',
  provenanceNote:
    "Google Flights via SearchApi: an itinerary search SearchApi runs on Google Flights when the cell is searched; SearchApi may serve a cached result of undocumented age. A price with a seller comes from Google's booking options. A price shown for the airline is SearchApi's declaration of Google's round-trip price for one adult, not confirmed by a seller listing.",
};

/**
 * What the recorded fixtures evidence (spec §5.2; Task 5.9 re-derives it from the recordings). 'seller' is never
 * declared: a step-2 offer carries the airline the vendor states, not a seller the vendor lists (plan decision 24),
 * and 'selfTransfer' is not, because separate tickets are excluded by request, not stated per offer.
 */
export const SEARCHAPI_SUPPLIED_FIELDS: readonly SuppliedField[] = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'price',
  'baggage',
];
/** All four cabins map to a vendor `travel_class` (spec §5.4); the list is core's. */
const SEARCHAPI_CABINS: readonly Cabin[] = cabinSchema.options;

/**
 * The SearchApi `FlightProvider` (spec §5.1, §5.2, §5.4). Discovery is `google_flights_calendar` rectangles;
 * verification is the three-step `google_flights` chain. Everything goes through http-kit; the adapter never
 * retries. `costPerCallMicroGbp` is the configured `limits.costPerCallMicroGbp`, the rate http-kit ledgers with.
 * The healthcheck is stateless and probes nothing (plan decision 24).
 */
export function searchApiProvider(o: {
  http: HttpKit;
  log: Logger;
  // why: every adapter takes the shared { http, log, clock } constructor shape (spec §5.1, plan decision 24); this one
  // reads no clock because fetchedAt comes from http-kit.
  clock: Clock;
  key: Secret;
  costPerCallMicroGbp: number;
  pointOfSale: string;
  cacheTtlSeconds: number;
  paramsAllowlist: ParamsAllowlist;
}): FlightProvider {
  assertPointOfSaleAllowed(o.paramsAllowlist, o.pointOfSale);
  const log = o.log.child({ providerId: 'searchapi' });
  const calendar: CalendarDeps = {
    http: o.http,
    log,
    key: o.key,
    pointOfSale: o.pointOfSale,
    allowlist: o.paramsAllowlist,
    cacheTtlSeconds: o.cacheTtlSeconds,
  };
  const itinerary: ItineraryDeps = {
    http: o.http,
    log,
    key: o.key,
    pointOfSale: o.pointOfSale,
    allowlist: o.paramsAllowlist,
  };
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
      estimate: (q) => estimateItinerary(q, o.costPerCallMicroGbp),
      search: (q, ctx) => searchItinerary(itinerary, q, ctx),
    },
    healthcheck: async () => ({
      ok: true,
      detail: 'not probed: key configured; no request sent (decision 24: healthchecks probe nothing)',
    }),
  };
}
```

Append to `src/index.ts`:

```ts
export { searchApiHttpLimits } from './searchapi/limits.js'; // WP5: apps/api httpLimitsFor
export { SEARCHAPI_PARAMS } from './searchapi/params.js'; // WP5: apps/api providersFor
export { searchApiProvider } from './searchapi/provider.js'; // WP5: apps/api providersFor
```

In `packages/providers/vitest.config.ts`, add to the `thresholds` object WP6 wrote, after its `'src/shared/**'` entry (decision 31):

```ts
        // why: the SearchApi adapter holds to its own floor so the package average cannot mask it (plan decision 31).
        'src/searchapi/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
```

(The assembly checked that the floor bites: a 99% branch floor on `src/searchapi/**` fails the run with `ERROR: Coverage for branches (96.16%) does not meet "src/searchapi/**" threshold (99%)`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/provider.test.ts test/barrel.test.ts && pnpm --filter @gmt/providers typecheck`
Expected: PASS, 9 and 3 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: searchApiProvider assembly, configured-rate estimate, stateless healthcheck, barrel"
```

### Task 5.8: Sentinel key across calendar, chain, cache, ledger and both error paths

**Files:** create `test/searchapi/sentinel.test.ts`.

**Interfaces:** consumes `makeProvider`, `saKit`, `KEY`, the synthetic builders. Produces nothing new. The sinks swept are every result and error message (the calendar 401 tile-error and the chain 401, which reach `last_error`), every log line, the cache entries and every ledger event; the provider object holds only functions and is not swept.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/sentinel.test.ts
import { asIata, asIsoDate, type DiscoveryQuery } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, KEY, saKit } from './support/kit.js';
import { capabilities, makeProvider } from './support/provider.js';
import {
  agent,
  bookingBody,
  CELL_QUERY,
  ECHO,
  flightsBody,
  IN_1,
  OUT_A,
  ok,
  option,
  syntheticHandler,
} from './support/synthetic.js';

afterEach(() => assertEverySentAllowed());

const q: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2026-11-02'),
  departureTo: asIsoDate('2026-11-03'),
  minNights: 10,
  maxNights: 11,
  cabin: 'economy',
  currency: 'GBP',
};

describe('the SearchApi key reaches no sink but the Authorization header (spec §5.3 sentinel test, §2 fact 8)', () => {
  it('calendar, chain, cache, ledger, logs, results and both error paths hold no trace of the key (synthetic)', async () => {
    const secret = KEY.reveal();
    server.use(
      syntheticHandler((p) => {
        if (p.get('departure_id') === 'LGW') return { status: 401, body: { error: 'Invalid API key.' } };
        if (p.get('engine') === 'google_flights_calendar')
          return ok({ ...ECHO, calendar: [{ departure: '2026-11-02', return: '2026-11-12', price: 480 }] });
        if (p.has('booking_token')) return ok(bookingBody([agent(573)]));
        if (p.has('departure_token')) return ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]));
        return ok(flightsBody([option(OUT_A, 600, { departure_token: 'dA' })]));
      }),
    );
    const k = saKit();
    const p = makeProvider(k);
    const { discovery, verification } = capabilities(p);
    const sinks: string[] = [];
    for (const plan of discovery.plan(q))
      sinks.push(JSON.stringify(await discovery.fetchTile(plan, q, ctx())));
    // the calendar error path: a 401 tile-error, whose message becomes last_error
    const lgw = { ...q, origin: asIata('LGW') };
    for (const plan of discovery.plan(lgw)) {
      const tile = await discovery.fetchTile(plan, lgw, ctx());
      expect(tile.kind).toBe('tile-error');
      sinks.push(JSON.stringify(tile), tile.kind === 'tile-error' ? tile.error.message : '');
    }
    sinks.push(JSON.stringify(await verification.search({ ...CELL_QUERY, expandTop: 1 }, ctx())));
    const err: unknown = await verification.search({ ...CELL_QUERY, origin: asIata('LGW') }, ctx()).then(
      () => {
        throw new Error('expected the 401 to reject');
      },
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ kind: 'auth' });
    sinks.push(String(err), JSON.stringify(err), err instanceof Error ? (err.stack ?? '') : '');
    sinks.push(...k.log.lines, JSON.stringify([...k.cache.entries.entries()]));
    sinks.push(...k.events.map((e) => JSON.stringify(e.type === 'fetch' ? { ...e, headers: {} } : e)));
    for (const text of sinks) expect(text).not.toContain(secret);
    const fetches = k.events.flatMap((e) => (e.type === 'fetch' ? [e] : []));
    expect(fetches).toHaveLength(6); // 1 calendar tile + the calendar 401 + 3 chain steps + the chain 401
    for (const f of fetches) {
      expect(f.headers.authorization).toBe(`Bearer ${secret}`);
      expect(f.url).not.toContain(secret);
      expect(new URL(f.url).searchParams.has('api_key')).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

The behaviour exists by design, so prove the test bites: temporarily add `d.log.debug({ headers: authHeaders(d.key) }, 'searchapi calendar request');` as the first line of the `try` block in `fetchCalendarTile`, then run `pnpm --filter @gmt/providers exec vitest run test/searchapi/sentinel.test.ts`.
Expected: FAIL: `expected '…' not to contain 'test-searchapi-key-0123456789abcdef'` on a log line. Revert the line.

- [ ] **Step 3: Implement.** No production change; the revert is the implementation.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/sentinel.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: sentinel-key test over the SearchApi calendar, chain, cache, ledger and 401 path"
```

### Task 5.9: Recorded fixtures: inventory, allowlist equality, replay, supplied fields, drift

**Files:** create `test/searchapi/support/recorded.ts` and `test/searchapi/recorded.test.ts`. Modify `src/searchapi/params.ts` (`RECORDED_AT` only).

**Interfaces:** consumes WP4's `loadRecorded`, `replayHandlers`, `defaultRecordedRoot`, `loadParamsAllowlist`, WP6's `majorToMinor`, and everything above. Produces nothing new.

Pre-flight: WP4b's recorded tree must be on the branch (`ls packages/providers/fixtures/recorded/searchapi` lists `_api_v1_search` and a `params-<date>.json`). Without it every test in this file fails with `pending-fixtures: …`; report that to Fable rather than weakening a test.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/support/recorded.ts
// Helpers over WP4's loadRecorded for WP4b's SearchApi recordings (SA-01…SA-06, WP4b brief §7).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate, type Cabin, cabinSchema } from '@gmt/core';
import { defaultRecordedRoot, type RecordedFixture } from '../../../src/http/recorder.js';
import { combinations, MAX_COMBINATIONS } from '../../../src/searchapi/calendar.js';
import { SEARCHAPI_ENDPOINT_PATH, TRAVEL_CLASS } from '../../../src/searchapi/params.js';
import { calendarResponseSchema } from '../../../src/searchapi/shapes.js';
import { loadRecorded } from '../../../src/testing/index.js';
import { errnoCode } from '../../../src/util.js';

export const RECORDED_ROOT = defaultRecordedRoot();
export type SearchApiRecording = RecordedFixture & { params: Record<string, string> };

/**
 * Every SearchApi recording, with the credential-free query parsed into params (placeholders kept). Fails with a
 * `pending-fixtures` message while WP4b's recorded tree is absent, so the cause is never mistaken for a WP5 bug.
 */
export function searchApiRecordings(): SearchApiRecording[] {
  const rs = loadRecorded(RECORDED_ROOT, 'searchapi', SEARCHAPI_ENDPOINT_PATH);
  if (rs.length === 0)
    throw new Error(
      `pending-fixtures: no SearchApi recordings under ${RECORDED_ROOT}; WP4b's recording run (SA-01…SA-06) must land first`,
    );
  return rs.map((r) => ({ ...r, params: Object.fromEntries(new URL(r.request.url).searchParams.entries()) }));
}

export const byEngine = (rs: readonly SearchApiRecording[], engine: string) =>
  rs.filter((r) => r.params.engine === engine);

/** A required recorded parameter, or a failure naming it. */
export function need(params: Readonly<Record<string, string>>, name: string): string {
  const v = params[name];
  if (v === undefined) throw new Error(`recorded request lacks ${name}`);
  return v;
}

/** The cabin whose travel_class the recording sent. */
export function cabinOf(params: Readonly<Record<string, string>>): Cabin {
  const sent = need(params, 'travel_class');
  const cabin = cabinSchema.options.find((c) => TRAVEL_CLASS[c] === sent);
  if (cabin === undefined) throw new Error(`recorded travel_class ${sent} maps to no cabin`);
  return cabin;
}

/**
 * The recorded in-limit calendar tile (SA-02): an HTTP 200 whose rectangle is ≤ 200 combinations and whose grid is
 * not empty, so the over-limit probe (SA-03, a 400 or an empty 200) is never picked.
 */
export function calendarTile(rs: readonly SearchApiRecording[]): SearchApiRecording {
  const tile = byEngine(rs, 'google_flights_calendar').find((r) => {
    const body = calendarResponseSchema.safeParse(r.body);
    return r.status === 200 && body.success && body.data.calendar.length > 0;
  });
  if (tile === undefined) throw new Error('WP4b must record one non-empty HTTP 200 calendar tile (SA-02)');
  return tile;
}

/** The recorded over-limit probe (SA-03): the calendar request whose rectangle exceeds 200 combinations. */
export function overLimit(rs: readonly SearchApiRecording[]): SearchApiRecording {
  const over = byEngine(rs, 'google_flights_calendar').find(
    (r) =>
      combinations({
        kind: 'rectangle',
        departFrom: asIsoDate(need(r.params, 'outbound_date_start')),
        departTo: asIsoDate(need(r.params, 'outbound_date_end')),
        returnFrom: asIsoDate(need(r.params, 'return_date_start')),
        returnTo: asIsoDate(need(r.params, 'return_date_end')),
      }) > MAX_COMBINATIONS,
  );
  if (over === undefined) throw new Error('WP4b must record the over-limit probe (SA-03)');
  return over;
}

/** The recorded step 1 → 2 → 3 chain (SA-04…SA-06). */
export function chainRecording(rs: readonly SearchApiRecording[]) {
  const ok = byEngine(rs, 'google_flights').filter((r) => r.status === 200);
  const step1 = ok.find((r) => !('departure_token' in r.params) && !('booking_token' in r.params));
  const step2s = ok.filter((r) => 'departure_token' in r.params);
  const step3s = ok.filter((r) => 'booking_token' in r.params);
  if (step1 === undefined || step2s.length === 0 || step3s.length === 0)
    throw new Error('WP4b recordings must include a full step 1 → 2 → 3 chain');
  return { step1, step2s, step3s };
}

/** Path of the newest dated parameter allowlist WP4b wrote (`searchapi/params-<yyyy-mm-dd>.json`). */
export function latestParamsPath(): string {
  const dir = join(RECORDED_ROOT, 'searchapi');
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch (e) {
    // why: only a missing directory means "not recorded yet"; any other failure (EACCES …) is reported as itself.
    if (errnoCode(e) !== 'ENOENT') throw e;
  }
  const last = names
    .filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .at(-1);
  if (last === undefined) throw new Error(`pending-fixtures: no params-<date>.json under ${dir}`);
  return join(dir, last);
}
```

```ts
// test/searchapi/recorded.test.ts
// pending-fixtures: every test here replays or reads WP4b's recordings and fails with a "pending-fixtures" message
// until they land (WP5 depends on WP4b). No other test file needs them.
import {
  addDays,
  asIata,
  asIsoDate,
  canonicalCarrier,
  canonicalFlightNumber,
  daysBetween,
  type ItineraryQuery,
  itineraryHash,
  type RawOffer,
  type RawSegment,
  type SuppliedField,
} from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRequestAllowed, loadParamsAllowlist } from '../../src/params/allowlist.js';
import { fetchCalendarTile, outboundBlockDays, planRectangles } from '../../src/searchapi/calendar.js';
import { searchItinerary } from '../../src/searchapi/itinerary.js';
import { classifySearchApiError } from '../../src/searchapi/limits.js';
import { authHeaders, SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { SEARCHAPI_SUPPLIED_FIELDS } from '../../src/searchapi/provider.js';
import {
  bookingResponseSchema,
  calendarResponseSchema,
  flightsResponseSchema,
} from '../../src/searchapi/shapes.js';
import { majorToMinor } from '../../src/shared/money.js';
import { replayHandlers } from '../../src/testing/index.js';
import { obj } from '../support/guards.js';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, KEY, saKit, sentUrls } from './support/kit.js';
import {
  byEngine,
  cabinOf,
  calendarTile,
  chainRecording,
  latestParamsPath,
  need,
  overLimit,
  RECORDED_ROOT,
  type SearchApiRecording,
  searchApiRecordings,
} from './support/recorded.js';
import { bookingBody, CELL_QUERY, ECHO, flightsBody, OUT_A, option } from './support/synthetic.js';

let misses: (() => string[]) | null = null;
/** Serves the recorded tree for this test; afterEach asserts nothing missed. */
function replay(): void {
  const r = replayHandlers(RECORDED_ROOT);
  server.use(...r.handlers);
  misses = r.misses;
}
afterEach(() => {
  assertEverySentAllowed();
  if (misses !== null) expect(misses()).toEqual([]);
  misses = null;
});

const tokensIn = (body: unknown, name: string): string[] => {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null)
      for (const [k, x] of Object.entries(v)) {
        if (k === name && typeof x === 'string') out.push(x);
        walk(x);
      }
  };
  walk(body);
  return out;
};
const flights = (r: SearchApiRecording) => {
  const p = flightsResponseSchema.safeParse(r.body);
  if (!p.success) throw new Error('recorded google_flights body does not parse');
  return [...(p.data.best_flights ?? []), ...(p.data.other_flights ?? [])];
};
const bookings = (r: SearchApiRecording) => bookingResponseSchema.parse(r.body).booking_options ?? [];
const minor = (major: number) => {
  const m = majorToMinor(major, 'GBP');
  if (m === null) throw new Error(`recorded price ${major} is not a GBP amount`);
  return m;
};

describe('WP4b recordings this brief relies on (§7 "Inputs from WP4b") — pending-fixtures', () => {
  it('has the in-limit calendar tile in the production shape: the largest-b block for its band, every outbound day answered', () => {
    const rec = calendarTile(searchApiRecordings());
    const p = rec.params;
    expect(p.outbound_date).toBe(p.outbound_date_start);
    expect(p.return_date).toBe(p.return_date_start);
    const from = asIsoDate(need(p, 'outbound_date_start'));
    const to = asIsoDate(need(p, 'outbound_date_end'));
    const days = daysBetween(from, to) + 1;
    const band = {
      minNights: daysBetween(from, asIsoDate(need(p, 'return_date_start'))),
      maxNights: daysBetween(to, asIsoDate(need(p, 'return_date_end'))),
    };
    // why: decision 29: SA-02 is recorded as production plans it (9 × 20 for the worked band), so replay exercises
    // the tile shape the adapter really sends; the block is the window-free largest b for the recorded band.
    expect(days).toBe(outboundBlockDays({ departureFrom: from, departureTo: addDays(from, 181), ...band }));
    const answered = new Set(calendarResponseSchema.parse(rec.body).calendar.map((e) => e.departure));
    expect(answered.size).toBe(days);
  });

  it('has a chain whose step-2 departure_token comes from step 1 and whose step-3 booking_token comes from a step 2', () => {
    const { step1, step2s, step3s } = chainRecording(searchApiRecordings());
    const departures = tokensIn(step1.body, 'departure_token');
    for (const s of step2s) expect(departures).toContain(need(s.params, 'departure_token'));
    const bookingTokens = step2s.flatMap((s) => tokensIn(s.body, 'booking_token'));
    for (const s of step3s) expect(bookingTokens).toContain(need(s.params, 'booking_token'));
    expect(step3s).toHaveLength(step2s.length);
  });

  it('has the 401 body, and the over-limit probe as a descriptive 400 naming the 200-combination limit (spec §2 facts 2 and 5)', () => {
    const rs = searchApiRecordings();
    expect(rs.find((r) => r.status === 401)?.body).toEqual({ error: 'Invalid API key.' });
    // why: the recording is a 400 (the docs say "empty response"); a re-record that came back an empty 200 would change
    // what an empty grid means, so it must fail here rather than pass silently (review pie M-2).
    const over = overLimit(rs);
    expect(over.status).toBe(400);
    expect(String(obj(over.body).error ?? '')).toMatch(/200 combinations/);
  });

  it('every HTTP 200 body with content echoes currency and gl in search_parameters (spec §5.2 rests on this)', () => {
    for (const r of searchApiRecordings().filter((x) => x.status === 200)) {
      if (calendarResponseSchema.safeParse(r.body).data?.calendar.length === 0) continue; // SA-03 as an empty 200
      const echo = obj(obj(r.body).search_parameters);
      expect(typeof echo.currency).toBe('string');
      expect(typeof echo.gl).toBe('string');
    }
  });
});

describe('SEARCHAPI_PARAMS against the recording (spec §5.2, plan decision 24) — pending-fixtures', () => {
  it('equals the recorded params-<date>.json: names, values, recordedAt and hash', () => {
    expect(SEARCHAPI_PARAMS).toEqual(loadParamsAllowlist(latestParamsPath()));
  });

  it('every recorded request passes it', () => {
    for (const r of searchApiRecordings())
      assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, new URL(r.request.url));
  });
});

describe('recorded replay through the adapter (spec §5.2, §5.4, §9 item 2) — pending-fixtures', () => {
  it('the recorded tile: every in-band priced entry at its exact minor amount; entries are accounted for; tileIndex on reserve', async () => {
    const rec = calendarTile(searchApiRecordings());
    const p = rec.params;
    const departureFrom = asIsoDate(need(p, 'outbound_date_start'));
    const departureTo = asIsoDate(need(p, 'outbound_date_end'));
    // why: the band whose tight rectangle is exactly the recorded one, so the plan reproduces the recorded request.
    const q = {
      origin: asIata(need(p, 'departure_id')),
      destination: asIata(need(p, 'arrival_id')),
      departureFrom,
      departureTo,
      minNights: daysBetween(departureFrom, asIsoDate(need(p, 'return_date_start'))),
      maxNights: daysBetween(departureTo, asIsoDate(need(p, 'return_date_end'))),
      cabin: cabinOf(p),
      currency: 'GBP' as const,
    };
    const [plan, ...rest] = planRectangles(q);
    if (plan === undefined) throw new Error('expected one tile');
    expect(rest).toHaveLength(0);
    replay();
    const k = saKit();
    const res = await fetchCalendarTile(
      {
        http: k.kit,
        log: k.log,
        key: KEY,
        pointOfSale: 'GB',
        allowlist: SEARCHAPI_PARAMS,
        cacheTtlSeconds: 3600,
      },
      plan,
      q,
      ctx(),
    );
    if (res.kind !== 'tile') throw new Error(`expected a tile, got ${res.error.message}`);
    const entries = calendarResponseSchema.parse(rec.body).calendar;
    const inBand = entries.filter(
      (e) =>
        e.return !== undefined &&
        e.price !== undefined &&
        e.has_no_flights !== true &&
        (() => {
          const n = daysBetween(asIsoDate(e.departure), asIsoDate(e.return ?? ''));
          return n >= q.minNights && n <= q.maxNights;
        })(),
    );
    expect(res.prices.map((x) => [x.departureDate, x.returnDate, x.amountMinor])).toEqual(
      inBand.map((e) => [e.departure, e.return, minor(e.price ?? 0)]),
    );
    expect(res.prices.every((x) => x.currency === 'GBP')).toBe(true);
    expect(res.pointOfSale).toBe('GB');
    expect(k.events.flatMap((e) => (e.type === 'reserve' ? [[e.tileIndex, e.httpAttempt]] : []))).toEqual([
      [plan.index, 1],
    ]);
  });

  it('the recorded chain: 1 + 2n calls, step-1 price = cheapest step-2 price (spike fact 3), the recorded sellers, a Google POST, route history', async () => {
    const rs = searchApiRecordings();
    const { step1, step2s, step3s } = chainRecording(rs);
    const p = step1.params;
    const q: ItineraryQuery = {
      ...CELL_QUERY,
      origin: asIata(need(p, 'departure_id')),
      destination: asIata(need(p, 'arrival_id')),
      departureDate: asIsoDate(need(p, 'outbound_date')),
      returnDate: asIsoDate(need(p, 'return_date')),
      cabin: cabinOf(p),
      expandTop: step2s.length,
    };
    replay();
    const k = saKit();
    const res = await searchItinerary(
      { http: k.kit, log: k.log, key: KEY, pointOfSale: 'GB', allowlist: SEARCHAPI_PARAMS },
      q,
      ctx(),
    );
    expect(sentUrls(k.events)).toHaveLength(1 + step2s.length + step3s.length);
    expect(res).toMatchObject({ coverage: 'priced', partial: false, failedExpansions: 0, pointOfSale: 'GB' });
    // spike fact 3, for every expanded outbound: its step-1 price is the cheapest priced step-2 option's price.
    for (const s2 of step2s) {
      const expanded = flights(step1).find((o) => o.departure_token === need(s2.params, 'departure_token'));
      const cheapest2 = Math.min(
        ...flights(s2).flatMap((o) => (o.price === undefined ? [] : [minor(o.price)])),
      );
      expect(minor(expanded?.price ?? 0)).toBe(cheapest2);
      // why (review pie M-1): the cheapest step-2 price also equals the step-3 listing of the airline step 1 states,
      // the only evidence that a step-2 price is the round-trip total. The non-cheapest step-2 prices have no step 3
      // behind them and are trip totals by analogy only, which is why they stay verified: false.
      const cheapest = flights(s2).find((o) => o.price !== undefined && minor(o.price) === cheapest2);
      const s3 = step3s.find((r) => r.params.booking_token === cheapest?.booking_token);
      const airline = expanded?.flights[0]?.airline;
      const own = s3 === undefined ? undefined : bookings(s3).find((b) => b.book_with === airline);
      expect(own?.price === undefined ? null : minor(own.price)).toBe(cheapest2);
    }
    for (const b of step3s.flatMap(bookings)) {
      if (b.is_split_booking === true || b.price === undefined || b.book_with === undefined) continue;
      expect(
        res.offers.some((o) => o.seller === b.book_with?.trim() && o.amountMinor === minor(b.price ?? 0)),
      ).toBe(true);
    }
    // Codeshares (review pie I-1): each verified offer flies the designators its seller lists, the step-2 carrier
    // operating where they differ, so the itinerary identity (spec §6.4, marketing flights) separates the listings.
    const listedBy = new Map(
      step3s
        .flatMap(bookings)
        .flatMap((b) =>
          b.book_with === undefined || b.flight_numbers === undefined
            ? []
            : [[b.book_with.trim(), b.flight_numbers]],
        ),
    );
    const verified = res.offers.filter((o) => o.verified);
    for (const o of verified) {
      const segs = [...o.outbound, ...o.inbound];
      expect(segs.map((x) => `${x.marketingCarrier} ${x.flightNumber}`)).toEqual(listedBy.get(o.seller));
      const step2Carrier = flights(step1)
        .flatMap((x) => x.flights)[0]
        ?.flight_number.split(' ')[0];
      for (const x of segs)
        expect(x.operatingCarrier).toBe(x.marketingCarrier === step2Carrier ? undefined : step2Carrier);
    }
    const hashOf = (o: RawOffer) => {
      const h = (x: RawSegment) => ({
        marketingCarrier: canonicalCarrier(x.marketingCarrier),
        flightNumber: canonicalFlightNumber(x.flightNumber, canonicalCarrier(x.marketingCarrier)),
        from: x.from,
        to: x.to,
        departLocal: x.depart,
      });
      return itineraryHash(o.outbound.map(h), o.inbound.map(h));
    };
    const carriers = new Set(verified.map((o) => o.outbound[0]?.marketingCarrier));
    expect(new Set(verified.map(hashOf)).size).toBe(carriers.size);
    expect(carriers.size).toBeGreaterThan(1); // the recording lists EI, AA and BA designators
    expect(res.notes).toContain(
      `codeshare-listing-step3:${verified.filter((o) => o.outbound[0]?.operatingCarrier !== undefined).length}`,
    );
    // decision 27: an offer is verified exactly when a recorded step-3 seller listing confirmed it.
    const listed = step3s
      .flatMap(bookings)
      .filter((b) => b.is_split_booking !== true && b.price !== undefined && b.book_with !== undefined);
    expect(res.offers.filter((o) => o.verified)).toHaveLength(listed.length);
    for (const o of res.offers.filter((x) => !x.verified)) expect(o.booking.kind).toBe('none');
    const posts = res.offers.flatMap((o) =>
      o.booking.kind === 'post' ? [new URL(o.booking.url).hostname] : [],
    );
    expect(posts.length).toBeGreaterThan(0);
    for (const h of posts) expect(h === 'google.com' || h.endsWith('.google.com')).toBe(true);
    // why: plan decision 40: price_insights is best-effort; the recorded step 1 carries none, so the history is empty,
    // the result stays whole (asserted above) and only the informational count records the absence.
    expect('price_insights' in obj(step1.body)).toBe(false);
    expect(res.routeHistory).toEqual([]);
    expect(res.notes.filter((n) => n.startsWith('route-history'))).toEqual(['route-history-absent:1']);
  });

  it('the recorded 401 body is recognised: auth with the vendor text (spec §2 fact 5)', () => {
    const r401 = searchApiRecordings().find((r) => r.status === 401);
    if (r401 === undefined) throw new Error('WP4b must record the 401 body (SA-01)');
    const e = classifySearchApiError({
      status: 401,
      body: r401.body,
      headers: new Headers(),
      providerId: 'searchapi',
      endpointPath: SEARCHAPI_ENDPOINT_PATH,
    });
    expect(e).toMatchObject({ kind: 'auth', retryable: false });
    expect(e?.message).toContain('Invalid API key.');
  });

  // why (review pie M-2, test-strategy 2 and 3): the recorded error bodies replayed through the real http-kit with
  // SearchApi's limits, so a regression in mapping either real body fails against the recording, not only a synthetic one.
  it.each([
    ['the recorded 401', 'auth', 401, /Invalid API key\./],
    // why: http-kit keeps the first 200 characters of a vendor message (WP4), so the start of the recorded text is asserted.
    [
      'the recorded over-limit 400',
      'parse',
      400,
      /HTTP 400 \(The combination of outbound parameters .*\[bad-request\]/,
    ],
  ] as const)(
    '%s through http-kit → %s, non-retryable, one attempt, vendor text in the message',
    async (_label, kind, status, text) => {
      const rec = searchApiRecordings().find((r) => r.status === status);
      if (rec === undefined) throw new Error(`WP4b must record the HTTP ${status} body`);
      replay();
      const k = saKit();
      const err: unknown = await k.kit
        .request({
          providerId: 'searchapi',
          executionId: 'exec-test',
          tileIndex: null,
          endpointPath: SEARCHAPI_ENDPOINT_PATH,
          method: 'GET',
          url: new URL(rec.request.url),
          headers: authHeaders(KEY),
          cache: 'never',
          signal: new AbortController().signal,
          recordFixtures: false,
        })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toMatchObject({ kind, retryable: false, httpStatus: status, providerId: 'searchapi' });
      expect(err instanceof Error ? err.message : '').toMatch(text);
      expect(k.budget.count('reserve')).toBe(1);
    },
  );
});

describe('supplied fields and synthetic drift against the recordings (spec §5.2) — pending-fixtures', () => {
  /** The SuppliedFields the recorded responses evidence; 'seller' and 'selfTransfer' are never declared (§4). */
  function evidence(rs: readonly SearchApiRecording[]): SuppliedField[] {
    const ok = byEngine(rs, 'google_flights').filter((r) => r.status === 200);
    const options = ok.flatMap((r) => (flightsResponseSchema.safeParse(r.body).success ? flights(r) : []));
    const segs = options.flatMap((o) => o.flights);
    const books = ok.flatMap((r) => bookingResponseSchema.safeParse(r.body).data?.booking_options ?? []);
    const out: SuppliedField[] = [];
    if (segs.length > 0 && segs.every((s) => s.flight_number.length > 0 && s.departure_airport.id.length > 0))
      out.push('segments');
    if (
      segs.length > 0 &&
      segs.every((s) => s.departure_airport.time.length > 0 && s.arrival_airport.time.length > 0)
    )
      out.push('segmentTimes');
    if (segs.length > 0 && segs.every((s) => s.travel_class !== undefined)) out.push('segmentCabins');
    if (options.some((o) => typeof o.price === 'number')) out.push('price');
    if (books.some((b) => (b.baggage_prices?.length ?? 0) > 0)) out.push('baggage');
    return out.sort();
  }

  it('suppliedFields equals what the recorded fixtures evidence, and nothing more', () => {
    expect([...SEARCHAPI_SUPPLIED_FIELDS].sort()).toEqual(evidence(searchApiRecordings()));
  });

  it('synthetic builders use only top-level keys the recorded bodies carry (drift guard)', () => {
    const rs = searchApiRecordings();
    const recordedKeys = new Set(rs.filter((r) => r.status === 200).flatMap((r) => Object.keys(obj(r.body))));
    const optionKeys = new Set(
      byEngine(rs, 'google_flights')
        .filter((r) => r.status === 200)
        .flatMap((r) => flights(r).flatMap((o) => Object.keys(o))),
    );
    for (const body of [flightsBody([]), bookingBody([]), ECHO])
      for (const key of Object.keys(body)) expect(recordedKeys).toContain(key);
    for (const key of Object.keys(option(OUT_A, 1, { departure_token: 't' })))
      expect(optionKeys).toContain(key);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/recorded.test.ts`
Expected: PASS at once. WP4b recorded on 2026-10-15, so Task 5.2's `RECORDED_AT` already equals the recorded file's `recordedAt` and the allowlist equality holds. Two recorded facts shaped the tests above: the step-1 and step-2 bodies carry their options under `other_flights` only, so the synthetic `flightsBody` builder emits `other_flights` and the drift guard holds; and the recorded step 1 carries no `price_insights`, so the recorded chain asserts an empty route history with `route-history-absent:1` (decision 40). Any other failure is a recording gap or a disagreement to report to Fable, never a test to weaken.

- [ ] **Step 3: Implement**

If a later recording moves the date, print it and set `RECORDED_AT` in `src/searchapi/params.ts` to it (`asIsoDate('<that date>')`):

`node -e "const f=require('fs'),d='packages/providers/fixtures/recorded/searchapi',n=f.readdirSync(d).filter(x=>/^params-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().at(-1);console.log(JSON.parse(f.readFileSync(d+'/'+n,'utf8')).recordedAt)"`

If the supplied-fields test reports a field the recordings do not evidence (for example `baggage`), remove it from `SEARCHAPI_SUPPLIED_FIELDS`; never edit `evidence` to match. If the chain test finds the step-1 price differs from the cheapest step-2 price, record it as an inventory fact for Fable (spike fact 3 no longer holds) instead of changing the assertion.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi`
Expected: PASS for every file under `test/searchapi/` (13 tests in `recorded.test.ts`), with no replay miss.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi recorded-fixture inventory, allowlist equality, replay and supplied fields"
```

### Task 5.10: Wire SearchApi into `apps/api`

**Files:** modify `apps/api/src/wiring.ts`, `apps/api/test/wiring/buildPorts.test.ts`, `apps/api/src/tools/recordRequests.ts` and `apps/api/test/tools/record.test.ts`. Create `apps/api/test/wiring/searchapi.test.ts` and `apps/api/test/tools/recordingLimits.test.ts`.

**Interfaces:** consumes `httpLimitsFor`, `providersFor` (deps `{ http, log, clock }`, decision 34), `loadConfigFromEnv`, `recordingLimits` (WP4b), and `searchApiProvider`, `searchApiHttpLimits`, `SEARCHAPI_PARAMS`. Produces SearchApi in `Ports.providers` and in http-kit limits whenever `SEARCHAPI_KEY` is set.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/wiring/searchapi.test.ts
import { asIata, asIsoDate, asIsoDateTime, fixedClock, type Logger, PLAN_PRESETS } from '@gmt/core';
import { type HttpKit, searchApiHttpLimits } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { httpLimitsFor, loadConfigFromEnv, providersFor } from '../../src/wiring.js';

const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };
const withKey = { ...base, SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' };
const lines: string[] = [];
const log: Logger = {
  debug: (o) => lines.push(JSON.stringify(o)),
  info: (o) => lines.push(JSON.stringify(o)),
  warn: (o) => lines.push(JSON.stringify(o)),
  error: (o) => lines.push(JSON.stringify(o)),
  child: () => log,
};
// why: providersFor only constructs adapters; nothing here sends a request.
const http: HttpKit = {
  request: async () => {
    throw new Error('no network in this test');
  },
  stats: () => ({ inFlight: 0 }),
};
const clock = fixedClock(asIsoDateTime('2026-10-14T12:00:00.000Z'));
// why: providersFor takes { http, log, clock } on main (plan decision 34 removed the airports dependency).
const deps = { http, log, clock };

describe('wiring: SearchApi (plan "Wiring and bootstraps")', () => {
  it('adds searchapi http limits when SEARCHAPI_KEY is set', () => {
    const l = httpLimitsFor(loadConfigFromEnv(withKey)).searchapi;
    expect(l).toMatchObject({
      hosts: ['www.searchapi.io'],
      billable: 'http-200',
      ratePerMinute: 10,
      ratePerHour: 2000,
      concurrency: 2,
    });
    // why: the classifier stays module-local (plan decision 30); the wired one is the one the adapter's limits carry.
    const own = searchApiHttpLimits(PLAN_PRESETS['40usd'], { maxWaitSeconds: 1, requestTimeoutSeconds: 1 });
    expect(l?.classifyError).toBe(own.classifyError);
  });

  it('constructs the searchapi provider when SEARCHAPI_KEY is set, and not otherwise', () => {
    expect(providersFor(loadConfigFromEnv(withKey), deps).map((p) => p.id)).toContain('searchapi');
    expect(providersFor(loadConfigFromEnv(base), deps).map((p) => p.id)).not.toContain('searchapi');
    expect(httpLimitsFor(loadConfigFromEnv(base)).searchapi).toBeUndefined();
  });

  it('SEARCHAPI_COST_PER_CALL_MICRO_GBP reaches both the ledger rate and the estimate (one source, ruling po-006)', () => {
    const config = loadConfigFromEnv({ ...withKey, SEARCHAPI_COST_PER_CALL_MICRO_GBP: '1234' });
    expect(httpLimitsFor(config).searchapi?.costPerCallMicroGbp).toBe(1234);
    const sa = providersFor(config, deps).find((p) => p.id === 'searchapi');
    const estimate = sa?.verification?.estimate({
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureDate: asIsoDate('2026-11-02'),
      returnDate: asIsoDate('2026-11-14'),
      cabin: 'economy',
      adults: 1,
      currency: 'GBP',
      expandTop: 2,
      bookingLinks: true,
    });
    expect(estimate?.costMicroGbp).toBe(5 * 1234);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring/searchapi.test.ts`
Expected: FAIL. `httpLimitsFor(...).searchapi` is undefined and no provider has id `searchapi`.

- [ ] **Step 3: Implement**

In `apps/api/src/wiring.ts` (WP4b's: `httpLimitsFor` returns an object literal with a `timing` local; `providersFor` pushes onto `out`), add the three names to the existing `@gmt/providers` import, one spread entry in `httpLimitsFor`'s returned object beside `fixture`, and one block before `providersFor` returns:

```ts
import {
  // …WP4b's existing names…
  SEARCHAPI_PARAMS,
  searchApiHttpLimits,
  searchApiProvider,
} from '@gmt/providers';

// in httpLimitsFor's returned object, after the fixture entry:
    ...(config.providers.searchapi === null
      ? {}
      : { searchapi: searchApiHttpLimits(config.providers.searchapi.limits, timing) }),

// in providersFor, before `return out;`:
  const sa = config.providers.searchapi;
  if (sa !== null) {
    // why: one rate source: the estimate prices calls at the same limits.costPerCallMicroGbp http-kit ledgers with;
    // SEARCHAPI_CACHE_TTL_HOURS (spec §12) is the local window for calendar tiles (itinerary steps are never cached).
    out.push(
      searchApiProvider({
        http: deps.http,
        log: deps.log,
        clock: deps.clock,
        key: sa.key,
        costPerCallMicroGbp: sa.limits.costPerCallMicroGbp,
        pointOfSale: config.pointOfSale,
        cacheTtlSeconds: sa.limits.cacheTtlHours * 3600,
        paramsAllowlist: SEARCHAPI_PARAMS,
      }),
    );
  }
```

If WP4b named the locals differently, keep its names.

WP4b's `test/wiring/buildPorts.test.ts` pins the exact provider ids and `httpLimitsFor` keys, and its `testEnv` sets a SearchApi sentinel key, so its four expected lists gain `searchapi` (providers `['fixture', 'travelpayouts', 'searchapi']` or `['travelpayouts', 'searchapi']`; limit keys `['fixture', 'fx', 'searchapi', 'travelpayouts']` or `['fx', 'searchapi', 'travelpayouts']`) with their why-comments, as WP6 did for Travelpayouts; the lists stay exact.

In `apps/api/src/tools/recordRequests.ts`, `recordingLimits`' hand-written `searchapi` entry becomes `searchapi: searchApiHttpLimits(sa.limits, t)` (plan decision 23), so the recording run carries the adapter's host, billing mode, cost and 401 classifier; `test/tools/recordingLimits.test.ts` pins both entries equal to the adapters' own limits. In `test/tools/record.test.ts`, the `priorToolCredits` test takes `{ timeout: 15_000 }` with a why-comment: it builds two real SQLite-backed ports and once ran at 5,014 ms under full-suite load.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring/searchapi.test.ts && pnpm boundaries`
Expected: PASS, 3 tests (and the api suite whole, `buildPorts.test.ts` and `recordingLimits.test.ts` included); the boundary script exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp05: wire SearchApi into httpLimitsFor and providersFor at the configured per-call rate"
```

## 11. Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP5. The adapter-local edge inputs most likely to bite first are pinned here:

- A wide nights band or a fixed-length stay changes the block size (Task 5.1, "a wide band shrinks the block", "a fixed-length stay grows the block").
- An over-limit rectangle never reaches reserve (Task 5.4, "asserts ≤200 combinations before reserve").
- A 429 at step 2 or step 3 propagates instead of becoming a partial or a no-return-legs cell (Task 5.6, "errors that propagate").
- A vendor body that drops its options key is a parse error, never "no fares" (Task 5.6, "no-options-key").
- A price with more precision than its currency is dropped, never rounded, and its cell is reported, never `no_data` (Tasks 5.4 and 5.6).
- A step-2 price is never passed on as confirmed: every step-2 offer is `verified: false` (Task 5.6).
- A chain the vendor priced but that yields no usable offer is an error, never a priced-and-empty result (Task 5.6, decision 31).
- A step-2 fare dropped for a missing airline makes the result partial, even when a dearer step-3 listing survives (Task 5.6, decision 41).
- A calendar row with both `has_no_flights` and a price is never "no fares" (Task 5.4).
- A codeshare seller's listing flies its own designators, so it is a distinct itinerary, pinned against the recorded step 3 (Tasks 5.5 and 5.9).

## 12. Definition of done

Run on the merged branch (2026-10-16) with WP4b's recordings present: every command below passes. The providers suite ran 663 tests at 98% lines / 90.5% branches, `src/searchapi` at 99.51% lines / 95.37% branches / 100% functions under its own floor (raising that floor's branches to 99% fails the run with `Coverage for branches (95.37%) does not meet "src/searchapi/**" threshold (99%)`, so the floor bites); core ran 718 tests at its 100% thresholds; the api suite ran 195; the whole workspace ran 1,843 in 127 files.

- `pnpm --filter @gmt/providers test` passes with no "does not meet" line: the package floor (85 / 70 / 85 / 85), WP6's per-directory floors, and `src/searchapi/**` at 90 lines / 80 branches / 90 functions / 90 statements (Task 5.7), `recorded.test.ts` included.
- `pnpm --filter @gmt/core test` passes at core's 100% thresholds (Task 5.0 is type-only).
- `pnpm --filter @gmt/api test` passes with its thresholds (85% lines, 70% branches, 85% functions and statements).
- `pnpm test` (the whole workspace) passes.
- `pnpm lint` is clean (no `any`, no non-null assertion); `pnpm -r typecheck` is clean (tests included, through `tsconfig.test.json`).
- `pnpm boundaries` exits 0; production `src/` never imports `src/testing/` or msw.
- `grep -rnE " as (unknown|never|[A-Z][A-Za-z]*(<|\[|;|,|\)))" packages/providers/src/searchapi packages/providers/test/searchapi apps/api/test/wiring/searchapi.test.ts` prints nothing (`as const` is the only cast).
- `grep -rnE "setupServer|Math.round|class NoteCounter|function parseError|function majorToMinor" packages/providers/src/searchapi packages/providers/test/searchapi` prints nothing (one msw server; no rounding; WP6's helpers only).
- `grep -rnE "notes\.add\('[^']*:" packages/providers/src/searchapi` prints nothing (note keys carry no colon).
- `pnpm secret-scan` prints `secret scan: clean`.
- `grep -rn "api_key" packages/providers/src/searchapi` prints nothing.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/providers/src` prints nothing.
- `git status --porcelain packages/providers/fixtures packages/providers/src/shared` prints nothing.
- Every task's checkbox is ticked.

## 13. Open questions

Decisions 24–31 settle every question rounds 1–3 raised (seller-less offers dropped, `RawOffer.verified`, the cost option, spec rev 15's tiling and itinerary age, the chain-stop result, the WP13 smoke rows, self-transfer as a Phase 4 gap, `separate_tickets` on both engines, the currency rule, the stateless healthcheck, the empty-chain rule, the fixture flag, the coverage floors, WP6 first); they are implemented above, as are decisions 34, 40 and 41. The notes below are for Fable or WP13; none blocks this brief:

- **Route-history scope (spec note for Fable; not blocking).** The adapter labels `price_insights.price_history` as the spec does, Google's route-level price-insight series, indicative (spec §2 bonus, §7). Nothing evidences that scope: the series is fetched per cell with `travel_class`, and if it is per date pair and cabin, `route_price_history`'s key (route, cabin, provider, date) merges series from different cells under a route-level label. Proposed: a WP13 smoke row comparing `price_history` from two cells on the same route; if they differ, revise the spec §7 label (or key) at the next spec revision.
- **`show_cheapest_flights` (WP13 smoke row; plan or spec §13).** The `google_flights` docs offer `show_cheapest_flights=true` ("By default, best flights are shown"); the adapter sends `sort_by=price` only, so step 1 may omit cheaper options Google keeps out of its best set, and "cheapest" holds over the returned options only (as `params.ts` says). Proposed: a WP13 smoke row on one cell with and without the parameter, comparing option count and minimum; if the minimum changes, record it (a new params file) and add it to both allowlists, otherwise record that it was tested and not needed.
- **Spec §2 text (Fable, next revision).** The bonus paragraph still says step 1's `price_insights.price_history` is "stored on every verification"; decision 40 makes it best-effort (absent in the recording; an empty history with an informational note). Spike fact 2 still gives ~23 rectangles of 8 × 19 = 152 combinations per pair; §5.2 and the code tile 9 × 20 = 180, 21 per pair for the worked band.
- **Plan contract comment (Fable).** The plan's `searchApiHttpLimits` contract comment says the classifier covers "the recorded 401/400 bodies and 429 quota discrimination"; the code, decision 15 and this brief recognise the recorded 401 body only (400 and 429 take http-kit's default table; a 429 is never `quota`).
- **Operating flight number.** A codeshare step-3 offer keeps step 2's carrier as `operatingCarrier`; the spec's Segment has no operating flight-number field, so the operated flight number (EI 381 behind BA 5941) is not carried. Whether the UI must show it is a spec question.
- **Rate-limit mid-chain (accepted residual, plan decision 41).** A `limiter-timeout` or header-less 429 at a later step propagates and drops the step-2 offers already paid for (decision 17); only budget and cancel return them. Low exposure on the $40 plan, real on the trial plan.
