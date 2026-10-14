---
wp: 5
title: SearchApi adapter
owner: opus
depends_on: [1, 2, 4, 4b]
spec_sections: ["§2", "§5.1", "§5.2", "§5.4", "§9 item 2"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, provenance-auditor, cost-and-budget-reviewer, security-reviewer]
status: draft
---

# WP5: SearchApi adapter

Reconciled on 2026-10-14 against spec revision 10 (incl. the §5.4 settled cases) and the plan's contracts at commit 790d1ea (round-2 pins, decision 14).

## 1. Goal

Build `searchApiProvider` in `@gmt/providers`: one `FlightProvider` that plans and fetches `google_flights_calendar` rectangle tiles for discovery, and runs the three-step `google_flights` chain for verification. It goes through http-kit only, returns raw vendor shapes, is tested by replaying WP4b's recorded fixtures through msw, and is wired into `apps/api`.

## 2. Scope

**In**

- `plan`: pure rectangle tiling of 8 outbound days × the tight return span. Tiles partition the query's cells, with the ≤200-combination assertion (spec §2 fact 2, §5.2).
- `fetchTile`: request building and the parameter allowlist check, then response parsing. Cell keys come from the response. Out-of-band entries are dropped. `has_no_flights` → `noFares`. An empty grid → `parse`. Currency and `pointOfSale` are read from the echo (spec §5.2).
- `search`: the step 1 → 2 → 3 chain with every outcome rule of spec §5.4. Unpriced options are skipped. The price-source rule applies. `fetchedAt` is the oldest step's. `routeHistory` comes from `price_insights.price_history`.
- Verification `estimate`, `healthcheck`, `suppliedFields`, `cabins`, and the two `CapabilityInfo` values.
- `searchApiHttpLimits` (hosts, `billable: 'http-200'`, and `classifyError` for the recorded 401/400 bodies plus 429 quota discrimination).
- `SEARCHAPI_PARAMS`, a code constant that a test asserts equal to the recorded `params-<date>.json`.
- One line each in `apps/api/src/wiring.ts`, in `httpLimitsFor` and `providersFor` (a Modify, per the plan's wiring contract).
- Test support: in-memory budget and cache ports around the real http-kit, and thin helpers over WP4's `loadRecorded`/`replayHandlers`. Synthetic-shape builders cover the cases the recordings lack.

**Out**

- The http-kit pipeline: retries, limiter, ledger finalisation, cache (key = method + credential-free URL + scrubbed headers + body, never execution or tile ids), egress allowlist enforcement, recorder, the default status classifier. Also `replayHandlers`/`loadRecorded` (the `@gmt/providers/testing` subpath), `RecordedFixture`, and `ParamsAllowlist` / `loadParamsAllowlist` / `assertRequestAllowed` (`src/params/allowlist.ts`). Owner: **WP4**.
- Recording the fixtures and writing `params-<date>.json`; the rest of `wiring.ts`. Owner: **WP4b**.
- Cabins a provider does not offer. The engine marks those cells `no_data` with reason `cabin-not-offered` without calling the provider (spec §3, §5.2). Owner: **WP7**. This adapter declares all four cabins.
- Normalisation: carrier/flight-number canonicalisation, local times, hashing, FX, vendor-URL validation against `google.com`, search links. Owner: **WP2** (pure) and **WP7** (step).
- Persisting `route_price_history`, stamping `pointOfSale` on stored rows, and copying `ProviderError.message` into `last_error`. Owner: **WP7** over **WP3**.
- The `bookingLinks` zod refinement on definitions. Owner: **WP0** `api-contract`. This brief adds the adapter-side guard only.
- Layer-B engine tests with this adapter, and the live smoke. Owner: **WP13**.
- Travelpayouts. Owner: **WP6**.

## 3. Spec sections

- **§2 SearchApi rows.** `google_flights_calendar` is `scraped-aggregate` with `maxAgeHours` 24: ≤200 combinations per call, per airport only, entries `{departure, return, price, is_lowest_price}` in the request currency, 9–29 s per call. `google_flights` is `scraped-search` with `maxAgeHours` 0. It is three steps, some options carry no `price`, and step 3 always runs.
- **§2 fact 2.** HTTP 400 above 200 combinations. ~23 rectangles of 8 × 19 days per pair for the default band (rev 10).
- **§2 fact 3.** Step 3 showed a seller below the airline fare, so `bookingLinks` is forced on. Some options are unpriced.
- **§2 fact 4.** The vendor caches repeats. The ledger counts every HTTP 200. The local window is `SEARCHAPI_CACHE_TTL_HOURS`.
- **§2 fact 5.** Recorded bodies: 401 `{"error":"Invalid API key."}` and a 400 with a descriptive message. 429 and quota responses map by status and ledger state.
- **§2 fact 8.** The key goes only in `Authorization: Bearer`, never in a URL.
- **§2 bonus.** Step 1's `price_insights.price_history` is returned as `routeHistory` on every verification.
- **§3 (rev 10).** An outcome's `reason` is the `ProviderError.kind` or a normalisation reason (`no-return-legs` among them). The vendor message goes to `last_error`, never `reason`. `pointOfSale` is any ISO alpha-2 echo or `'unknown'`.
- **§5.1 (rev 10).** The shapes listed in §4 below, including `pointOfSale` on both results, optional `routeHistory`, and `tileIndex` on `reserve`.
- **§5.2 (entire).** Tiling with the tight span, asserted ≤200 before reserve. Cell keys from the response, with drops counted in `notes`. Empty-is-per-capability. Estimate parity. Output is raw only, with `suppliedFields` checked against recorded fixtures. Point of sale: `gl` = `POINT_OF_SALE` lower-cased, `hl=en`, `currency=GBP`, `pointOfSale` from the echo. The dated allowlist names parameters and values. The error table, with the 400 vendor message in `last_error`. No adapter retries.
- **§5.4 (entire).** `travel_class` values (`first_class` for first), the chain, unpriced skips, every priced step-2 option persisted, step 3 for the cheapest priced option per outbound, the outcome rules, the price-source rule, and calls = `1 + expandTop × 2`. Also the three cases the vendor can produce: every step-1 option unpriced → throw `upstream` with `reason = 'no-priced-options'` (non-retryable on resume); a failed step 3 keeps the step-2 airline offer with `partial: true`; split bookings are skipped and counted in `notes`.
- **§9 item 2 (this adapter's rows).** Partition and `plan().length` = msw hits. Out-of-band drops. Empty grid → `parse`. `has_no_flights` → `noFares`. Currency from the response. `suppliedFields` from recorded fixtures. Allowlist names and values. Error mapping incl. 403 and quota discrimination. Token responses never cached. Sentinel key.

## 4. Interfaces consumed

Copied from the plan's "Cross-package contracts" (rewritten 2026-10-14) without change. Spec §5.1 rev 10 types not repeated below (`CapabilityInfo`, `DiscoveryQuery`, `TilePlan`, `RawCalendarPrice`, `ItineraryQuery`, `RawSegment`, `RawOffer`, `ProviderContext`, `DiscoveryCapability`, `VerificationCapability`, `FlightProvider`, `CostEstimate`, `Reservation`, `ResponseCache`, `ProviderError`, `BudgetExceeded`, `AbortedError`) are exactly as in spec §5.1.

```ts
// @gmt/core types/provenance.ts, types/definition.ts, types/itinerary.ts (WP0)
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = string | 'unknown';   // ISO 3166-1 alpha-2 upper-case (POINT_OF_SALE echoes), or 'unknown'
export interface ResolvedSpace { origins: Iata[]; destinations: Iata[]; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export function cellKeyString(c: CellKey): string;
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }

// @gmt/core ports/provider.ts (spec §5.1 rev 10)
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[] }
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };
export interface ItinerarySearchResult {
  offers: RawOffer[]; coverage: 'priced' | 'empty'; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; partial: boolean; failedExpansions: number; notes: string[];
  routeHistory?: Array<{ date: IsoDate; lowestPriceMinor: number; currency: string }>;   // SearchApi price_insights.price_history; the engine upserts route_price_history
}
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
// A provider whose `cabins` excludes the definition's cabin is not called at all: the engine marks every cell for that provider and stage no_data with reason 'cabin-not-offered' (spec rev 10).

// @gmt/core ports/budget.ts, ports/logger.ts, ports/clock.ts, errors.ts, config, text (WP0)
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
// ProviderError constructed as new ProviderError({ kind, retryable, message, reason?, httpStatus?, retryAfterSeconds?, providerId? });
// "The outcome `reason` column holds the kind or normalisation reason only; the vendor message (URL-stripped) goes to `lastError`."
export type NormalisationReason = 'fx-unavailable' | 'currency-unsupported' | 'unknown-airport-tz' | 'no-return-legs' | 'unmappable-carrier' | 'bad-local-time';
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export type PlanId = 'trial' | '40usd';
export interface ProviderLimits { monthlyCallCap: number; window: 'month' | 'lifetime'; billingDay: number; ratePerMinute: number; ratePerHour: number; concurrency: number; cacheTtlHours: number; costPerCallMicroGbp: number; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export const PLAN_PRESETS: Record<PlanId, ProviderLimits & { monthlySpendCapMicroGbp: number; executionMaxCalls: number; executionMaxCostMicroGbp: number }>;
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export const BANNED_WORD_ALLOWLIST: readonly string[] = ['smoke:live', 'lives in'];
export function asIata(s: string): Iata; export function asIsoDate(s: string): IsoDate; export function asIsoDateTime(s: string): IsoDateTime;
export function parseConfig(env: Record<string, string | undefined>, opts: ParseConfigOptions): ConfigResult;

// @gmt/core WP1 and WP2
export function toEpochDay(d: IsoDate): number; export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number /* b − a */;
export function generateCells(space: ResolvedSpace): Cell[];
export const MINOR_EXPONENT: Record<string, number>;

// @gmt/providers http/httpKit.ts and testing subpath (WP4)
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never'; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; classifyError?: (status: number, body: unknown, ledgerAtCap: boolean) => ProviderError }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<ProviderId | 'fx', ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[]; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
export interface HttpKitRequest { providerId: ProviderId | 'fx'; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body?: string; cache: { ttlSeconds: number } | 'never'; signal: AbortSignal; recordFixtures: boolean }
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
export interface RecordedFixture { recordedAt: IsoDateTime; recordedBy: string; providerId: string; endpointPath: string; request: { method: string; url: string /* credential-free, query kept */; headers: Record<string, string> /* scrubbed */; body: string | null }; status: number; body: unknown; placeholders: Record<string, string>; contentSha256: string }
// '@gmt/providers/testing' subpath export (src/testing/index.ts): fixtureHandlers(root): RequestHandler[]; replayHandlers(recordedRoot): RequestHandler[] (serves fixtures/recorded by matching method, path and credential-free query, reversing placeholders); loadRecorded(root, providerId, endpointPath): RecordedFixture[]. msw is a dependency of the package (not dev) because this subpath imports it; production code never imports the subpath (boundary script asserts).

// Adapter constructors and exports (WP5, WP6), from the plan
export function searchApiProvider(o: { http: HttpKit; log: Logger; clock: Clock; key: Secret; plan: PlanId; pointOfSale: string; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist }): FlightProvider;
export function searchApiHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;   // hosts ['www.searchapi.io'], billable 'http-200', classifyError for the recorded 401/400 bodies and 429 quota discrimination
export const SEARCHAPI_PARAMS: ParamsAllowlist;   // code constant; a test asserts it equals fixtures/recorded/searchapi/params-<date>.json
export interface ParamsAllowlist { provider: ProviderId; recordedAt: IsoDate; endpoints: Record<string /* endpoint path */, { names: string[] /* ascending */; values: Record<string, string[] | 'any'> }>; contentSha256: string }   // src/params/allowlist.ts (WP4): the type, loadParamsAllowlist(path), assertRequestAllowed(allowlist, endpointPath, url)
export function canonicalCacheKey(r: HttpKitRequest, secrets: Secret[]): string;   // sha256 over method + credential-free URL (query kept) + scrubbed headers + body only; never executionId or tileIndex

// apps/api src/wiring.ts (WP4b)
export function httpLimitsFor(config: Config): HttpKitDeps['limits'];   // WP4b writes it with fixture + fx; WP5 and WP6 each add their provider's line (a Modify in their briefs)
export function providersFor(config: Config, deps: { http: HttpKit; log: Logger; clock: Clock; airports: AirportsRepo }): FlightProvider[];   // same ownership rule
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;
```

From WP4b (files):

- `packages/providers/fixtures/recorded/searchapi/_api_v1_search/<yyyy-mm-dd>-<sha12>.json`: `RecordedFixture` files. `endpointPath` is `/api/v1/search`, and `/` becomes `_` in the directory name.
- `packages/providers/fixtures/recorded/searchapi/params-<yyyy-mm-dd>.json`: a `ParamsAllowlist`.

## 5. Interfaces produced

Exported from `@gmt/providers` (`src/index.ts`) exactly as the plan's contract names them (§4 above): `searchApiProvider`, `searchApiHttpLimits`, `SEARCHAPI_PARAMS`. `ParamsAllowlist` is WP4's and is imported, not redefined. The brief also exports:

```ts
// src/searchapi/*: names later briefs and WP13 may read
export const SEARCHAPI_HOST: 'www.searchapi.io';
export const SEARCHAPI_DISPLAY_NAME: 'Google Flights via SearchApi';
export const SEARCHAPI_DISCOVERY_INFO: CapabilityInfo;      // scraped-aggregate, maxAgeHours 24
export const SEARCHAPI_VERIFICATION_INFO: CapabilityInfo;   // scraped-search, maxAgeHours 0
export function classifySearchApiError(status: number, body: unknown, ledgerAtCap: boolean): ProviderError;
export const MAX_COMBINATIONS: 200;
export const OUTBOUND_BLOCK_DAYS: 8;
export function planRectangles(q: DiscoveryQuery): TilePlan[];
```

`SEARCHAPI_PARAMS.endpoints` has the one key `/api/v1/search`, per the pinned type (keyed by endpoint path). Both engines share that path, so its `names` are the ascending union of both engines' parameters and `engine` lists both values. As a result, the allowlist cannot stop a calendar request carrying a `departure_token`. The request builders are the per-engine guard, and Task 5.3 tests them name by name.

## 6. Library notes

All verified on **2026-10-14**.

**SearchApi `google_flights_calendar`**, https://www.searchapi.io/docs/google-flights-calendar-api (WebFetch).

- `GET https://www.searchapi.io/api/v1/search` with `Authorization: Bearer <key>`.
- Request parameters: `engine`, `departure_id`, `arrival_id`, `flight_type=round_trip`, `outbound_date`, `outbound_date_start`, `outbound_date_end`, `return_date`, `return_date_start`, `return_date_end`, `travel_class` (`economy | premium_economy | business | first_class`, now also in spec §5.4), `adults`, `currency`, `gl`, `hl`. Defaults are `gl=us`, `hl=en`, `currency=USD`, so all three are always sent. `outbound_date`/`return_date` are required even with the ranges.
- Response: top-level `calendar[]` of `{ departure, return, price, is_lowest_price? }`. **`has_no_flights: true` is per entry, and such entries omit `price`.**
- The docs say over 200 combinations "will return an empty response"; the spike recorded HTTP 400. Neither is reachable, because the assertion runs before the request.
- **Not documented:** `search_parameters` and any currency echo. WP4b's recordings are the evidence (Task 5.2 asserts it).

**SearchApi `google_flights`**, https://www.searchapi.io/docs/google-flights-api (WebFetch).

- Same endpoint and header. Parameters: the calendar's common set plus `stops` (`any | nonstop | one_stop_or_fewer | two_stops_or_fewer`), `departure_token` and `booking_token`. Documented token requests resend the original search parameters.
- Response: `best_flights[]` with `flights[]` (`departure_airport`/`arrival_airport` `{ id, date, time }`, `airline`, `flight_number` like `"IB 212"`, `travel_class` like `"Economy"`, `duration` in minutes, `airplane`), `price` in major units, and `departure_token` / `booking_token`.
- `booking_options[]`: `book_with`, `price`, `baggage_prices` (array of strings), `booking_request { url, post_data }` (example url `https://www.google.com/travel/clk/f`), `booking_phone`, `is_split_booking`.
- `price_insights.price_history` is `[{ price, iso_date }]`, where `iso_date` is an ISO instant.
- **Not found on the page:** `other_flights`, `search_parameters`, and the key holding step-2 return options. The adapter reads `best_flights ∪ other_flights`. The recorded-chain test (Task 5.6) is the authority.

**msw 3.0.3**, https://mswjs.io/docs/migrations/2.x-to-3.x and https://mswjs.io/docs/runbook (WebFetch and context7 `/websites/mswjs_io`).

- `setupServer` from `msw/node`.
- `http`/`HttpResponse` from `msw/http`, no longer the root.
- `server.listen({ onUnhandledFrame: 'error' })` replaces `onUnhandledRequest`.
- `server.events.on('request:start', ({ request }) => …)` still exists; only `connection` was renamed.
- Handlers read `new URL(request.url).searchParams` and `request.headers.get(...)` and reply with `HttpResponse.json(body, { status })`.
- msw is now a regular dependency of `@gmt/providers` (WP4).

**vitest 5.0.4**, https://vitest.dev/guide/migration.html (WebFetch).

- An unawaited `rejects` fails the test; every `rejects` here is awaited.
- `toThrow('')` matches anything and is not used.
- `clearMocks` defaults on; no mocks are used.
- Per-task runs use `pnpm --filter @gmt/providers exec vitest run <file>`, so no coverage threshold applies to a partial run (plan decision 8).

**zod 4.6.7** (context7 `/colinhacks/zod`), a `@gmt/providers` dependency per the plan.

- Used: `z.object` (strips unknown keys), `z.array`, `z.string().regex`, `z.number().nonnegative()`, `z.boolean()`, `.optional()`, `.nullish()`, `z.record(z.string(), schema)` (two arguments in v4), `safeParse`, `z.infer`.

**Inputs from WP4b (pre-dispatch check).** These are factual checks, not design questions; a failure is a WP4b fix. Task 5.2's inventory test fails until they hold:

1. `loadRecorded(root, 'searchapi', '/api/v1/search')` returns at least:
   - one HTTP 200 calendar tile spanning ≤ 8 outbound days, requested with `outbound_date = outbound_date_start` and `return_date = return_date_start`;
   - a step 1;
   - a step 2 for each of the cheapest `n` priced outbounds (n ≥ 1);
   - a step 3 for the cheapest priced return option of each;
   - the 401 and 400 bodies.
2. Every HTTP 200 body carries `search_parameters.currency` and `search_parameters.gl`.
3. `params-<date>.json` (read with WP4's `loadParamsAllowlist`) equals `SEARCHAPI_PARAMS` in Task 5.3: one endpoint `/api/v1/search`, names ascending, and `'any'` for `departure_id`, `arrival_id`, every date, `gl`, `departure_token` and `booking_token`.

## 7. Files

Create, under `packages/providers/`:

- `src/searchapi/params.ts`: host, endpoint, `SEARCHAPI_PARAMS`, `TRAVEL_CLASS`, request builders, auth header
- `src/searchapi/shapes.ts`: vendor zod shapes, echo reader, minor units, note counter, `parseError`
- `src/searchapi/errors.ts`: `classifySearchApiError`, `searchApiHttpLimits`
- `src/searchapi/calendar.ts`: rectangle tiling, calendar fetch and parse
- `src/searchapi/itinerary.ts`: the chain and its estimate
- `src/searchapi/provider.ts`: `searchApiProvider`
- `test/searchapi/support/ports.ts`: in-memory budget and cache, capturing logger, real http-kit, request capture
- `test/searchapi/support/recorded.ts`: helpers over WP4's `loadRecorded`
- `test/searchapi/support/synthetic.ts`: synthetic-shape builders and handler (never written to disk)
- `test/searchapi/support/provider.ts`: provider factory
- `test/searchapi/tiling.test.ts`, `inventory.test.ts`, `params.test.ts`, `errors.test.ts`, `calendar.test.ts`, `itinerary.test.ts`, `booking.test.ts`, `provider.test.ts`, `sentinel.test.ts`

Modify:

- `packages/providers/src/index.ts`: exports (Task 5.8)
- `apps/api/src/wiring.ts`: the SearchApi line in `httpLimitsFor` and in `providersFor` (Task 5.10)

Create, under `apps/api/`:

- `test/wiring.searchapi.test.ts` (Task 5.10)

Nothing is written under `fixtures/`.

## 8. Tasks

Per-task commands run one file without coverage; §10 runs the package with thresholds.

### Task 5.1: Rectangle tiling (first failing test)

**Files:** create `src/searchapi/calendar.ts` (tiling part) and `test/searchapi/tiling.test.ts`.

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
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual(expected);
    expect(expected.length).toBe(182 * 12);
  });

  it('every tile is a rectangle within the 200-combination limit', () => {
    for (const p of plans) {
      expect(p.request.kind).toBe('rectangle');
      if (p.request.kind !== 'rectangle') continue;
      expect(combinations(p.request)).toBeLessThanOrEqual(MAX_COMBINATIONS);
    }
  });

  it('uses 8 outbound days × the tight 19-day return span, about 23 tiles per pair (spec §2 fact 2, §5.2 rev 10)', () => {
    expect(plans.length).toBe(Math.ceil(182 / OUTBOUND_BLOCK_DAYS)); // 23
    const first = plans[0]?.request;
    if (first?.kind !== 'rectangle') throw new Error('expected a rectangle');
    expect(span(first.departFrom, first.departTo)).toBe(8);
    expect(span(first.returnFrom, first.returnTo)).toBe(19); // 8 + (21 − 10): 152 combinations, 96 useful cells
    expect(first).toMatchObject({ departFrom: '2026-10-21', returnFrom: '2026-10-31', returnTo: '2026-11-18' });
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
    const subset = all.filter((_, i) => i % 7 === 0).reverse(); // unordered on purpose
    const re = planRectangles({ ...q, cells: subset });
    expect(re.flatMap((p) => p.coveredCells.map(keyOf)).sort()).toEqual(subset.map(keyOf).sort());
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
/** Spec §5.2: 8 outbound days per tile × the tight return span (~23 tiles per pair over 182 days). */
export const OUTBOUND_BLOCK_DAYS = 8;

/** The rectangle variant of the vendor-neutral tile request (spec §5.1). */
export type Rectangle = Extract<TileRequest, { kind: 'rectangle' }>;

/** Outbound days × return days of a rectangle, the quantity SearchApi caps at 200. Spec §5.2. */
export function combinations(r: Rectangle): number {
  const outbound = toEpochDay(r.departTo) - toEpochDay(r.departFrom) + 1;
  const inbound = toEpochDay(r.returnTo) - toEpochDay(r.returnFrom) + 1;
  return outbound * inbound;
}

/** The ≤200 assertion of spec §5.2; `fetchTile` repeats it before `http.request`, so it precedes `budget.reserve`. */
export function assertWithinLimit(r: Rectangle): void {
  const n = combinations(r);
  if (n > MAX_COMBINATIONS) {
    throw new RangeError(`searchapi rectangle ${r.departFrom}..${r.departTo} × ${r.returnFrom}..${r.returnTo} has ${n} combinations, above ${MAX_COMBINATIONS}`);
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

/** The tight bounding rectangle of a block; `first` is its earliest cell. */
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
 * Pure, deterministic rectangle tiling for `google_flights_calendar`. Spec §5.2 (rev 10).
 * Cells (the band, or `q.cells` on a re-plan) are sorted and cut into blocks of up to 8
 * consecutive departure days; each tile is the block's tight bounding box, so tiles
 * partition the input exactly. A block that would exceed 200 combinations shrinks a day at a
 * time; one departure day always fits because nights ≤ 90 (spec §6.1).
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

### Task 5.2: Test support and the recorded-fixture inventory

**Files:** create `test/searchapi/support/ports.ts`, `test/searchapi/support/recorded.ts`, `test/searchapi/support/synthetic.ts`, and `test/searchapi/inventory.test.ts`. Create `src/searchapi/params.ts` with the endpoint constants only (Task 5.3 completes it).

**Interfaces:** consumes WP4's `loadRecorded`, `createHttpKit` and `RecordedFixture`. Produces test helpers, plus `SEARCHAPI_HOST`, `SEARCHAPI_ENDPOINT` and `SEARCHAPI_ENDPOINT_PATH`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/inventory.test.ts
import { describe, expect, it } from 'vitest';
import { byEngine, chainRecording, searchApiRecordings } from './support/recorded.js';

const recorded = searchApiRecordings();
const echoOf = (body: unknown) => (body as { search_parameters?: { currency?: unknown; gl?: unknown } }).search_parameters;

describe('WP4b recordings this brief relies on ("Inputs from WP4b")', () => {
  it('has a calendar tile of ≤ 8 outbound days with outbound_date/return_date equal to the range starts', () => {
    const cal = byEngine(recorded, 'google_flights_calendar').find((r) => r.status === 200);
    expect(cal).toBeDefined();
    const p = cal?.params ?? {};
    expect(p.outbound_date).toBe(p.outbound_date_start);
    expect(p.return_date).toBe(p.return_date_start);
  });

  it('has a full step 1 → 2 → 3 chain', () => {
    const { step2s, step3s } = chainRecording(recorded);
    expect(step3s.length).toBe(step2s.length);
  });

  it('has the 401 and 400 bodies (spec §2 fact 5)', () => {
    expect(recorded.find((r) => r.status === 401)?.body).toEqual({ error: 'Invalid API key.' });
    expect(recorded.some((r) => r.status === 400)).toBe(true);
  });

  it('every HTTP 200 body echoes currency and gl in search_parameters (spec §5.2 rests on this)', () => {
    for (const r of recorded.filter((x) => x.status === 200)) {
      expect(typeof echoOf(r.body)?.currency).toBe('string');
      expect(typeof echoOf(r.body)?.gl).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/inventory.test.ts`
Expected: FAIL. `./support/recorded.js` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// src/searchapi/params.ts (initial; Task 5.3 extends it)
/** SearchApi's single host; `searchApiHttpLimits` gives it to http-kit as the egress allowlist (spec §5.3). */
export const SEARCHAPI_HOST = 'www.searchapi.io';
/** Both engines share one endpoint; `engine` selects calendar or itinerary. Verified 2026-10-14. */
export const SEARCHAPI_ENDPOINT = `https://${SEARCHAPI_HOST}/api/v1/search`;
/** Path only, as written to `provider_requests.endpoint_path` (spec §5.3: no query). */
export const SEARCHAPI_ENDPOINT_PATH = '/api/v1/search';
```

```ts
// test/searchapi/support/recorded.ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecordedFixture } from '../../../src/index.js';
import { SEARCHAPI_ENDPOINT_PATH } from '../../../src/searchapi/params.js';
import { loadRecorded } from '../../../src/testing/index.js';

/** The recorded tree root (spec §5.3), as WP4's loadRecorded and replayHandlers take it. */
export const RECORDED_ROOT = fileURLToPath(new URL('../../../fixtures/recorded/', import.meta.url));

export type SearchApiRecording = RecordedFixture & { params: Record<string, string> };

/** Every SearchApi recording, with the credential-free query parsed into params (placeholders kept). */
export function searchApiRecordings(): SearchApiRecording[] {
  return loadRecorded(RECORDED_ROOT, 'searchapi', SEARCHAPI_ENDPOINT_PATH).map((r) => ({ ...r, params: Object.fromEntries(new URL(r.request.url).searchParams.entries()) }));
}

export const byEngine = (rs: readonly SearchApiRecording[], engine: string) => rs.filter((r) => r.params.engine === engine);

/** The recorded step 1 → 2 → 3 chain. */
export function chainRecording(rs: readonly SearchApiRecording[]) {
  const ok = byEngine(rs, 'google_flights').filter((r) => r.status === 200);
  const step1 = ok.find((r) => !('departure_token' in r.params) && !('booking_token' in r.params));
  const step2s = ok.filter((r) => 'departure_token' in r.params);
  const step3s = ok.filter((r) => 'booking_token' in r.params);
  if (step1 === undefined || step2s.length === 0 || step3s.length === 0) throw new Error('WP4b recordings must include a full step 1 → 2 → 3 chain');
  return { step1, step2s, step3s };
}

/** A required recorded parameter, or a failure naming it. */
export function need(params: Readonly<Record<string, string>>, name: string): string {
  const v = params[name];
  if (v === undefined) throw new Error(`recorded request lacks ${name}`);
  return v;
}

/** Path of the newest dated parameter allowlist WP4b wrote (`searchapi/params-<yyyy-mm-dd>.json`), for WP4's loadParamsAllowlist. */
export function latestParamsPath(): string {
  const dir = join(RECORDED_ROOT, 'searchapi');
  const last = readdirSync(dir).filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().at(-1);
  if (last === undefined) throw new Error(`no params-<date>.json under ${dir}`);
  return join(dir, last);
}
```

```ts
// test/searchapi/support/synthetic.ts
// Synthetic SearchApi shapes for cases the recordings do not contain. Every test using these
// says "(synthetic)" in its name; nothing here is ever written under fixtures/.
import { type ItineraryQuery, asIata, asIsoDate } from '@gmt/core';
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
import { type BudgetGuard, type IsoDateTime, type Logger, PLAN_PRESETS, type ProviderContext, type ResponseCache, Secret, asIsoDateTime, fixedClock } from '@gmt/core';
import type { SetupServerApi } from 'msw/node';
import { type HttpKit, createHttpKit } from '../../../src/http/httpKit.js';
import { searchApiHttpLimits } from '../../../src/searchapi/errors.js';

/** Sentinel key: asserted never to reach any sink but the Authorization header. */
export const SENTINEL_KEY = 'test-searchapi-key-0123456789abcdef';
export const T0 = '2026-10-14T12:00:00.000Z';

export interface TestPorts {
  http: HttpKit; key: Secret; log: Logger; logLines: string[];
  clock: ReturnType<typeof fixedClock>;
  reserves: Array<{ endpointPath: string; httpAttempt: number; tileIndex: number | null }>;
}

/** The real http-kit (WP4) over in-memory ports; `providers` may not import `db` (spec §4). */
export function testPorts(): TestPorts {
  const key = new Secret(SENTINEL_KEY);
  const clock = fixedClock(asIsoDateTime(T0));
  const reserves: TestPorts['reserves'] = [];
  const budget: BudgetGuard = {
    reserve: (p) => {
      reserves.push({ endpointPath: p.endpointPath, httpAttempt: p.httpAttempt, tileIndex: p.tileIndex });
      return { id: `r${reserves.length}`, finalise: () => undefined };
    },
    recordCacheHit: () => undefined,
    usage: () => ({ calls: reserves.length, costMicroGbp: 0, cap: null, windowStart: null, windowEnd: null }),
  };
  const store = new Map<string, { body: unknown; storedAt: IsoDateTime }>();
  const cache: ResponseCache = { get: (k) => store.get(k), set: (k, body, _ttl, storedAt) => { store.set(k, { body, storedAt }); } };
  const logLines: string[] = [];
  const write = (o: object, msg?: string): void => { logLines.push(JSON.stringify({ o, msg })); };
  const log: Logger = { debug: write, info: write, warn: write, error: write, child: () => log };
  // why: generous test rates so bottleneck never queues a 5-call chain; classification is unchanged.
  const searchapi = { ...searchApiHttpLimits(PLAN_PRESETS['40usd'], { maxWaitSeconds: 5, requestTimeoutSeconds: 5 }), ratePerMinute: 1000, ratePerHour: 100_000, concurrency: 4 };
  const http = createHttpKit({ budget, cache, clock, log, secrets: [key], limits: { searchapi } });
  return { http, key, log, logLines, clock, reserves };
}

export function ctx(): ProviderContext {
  return { executionId: 'exec-test', signal: new AbortController().signal, recordFixtures: false };
}

/** Every request msw sees, for allowlist and header assertions (msw 3 `request:start`). */
export function captureRequests(server: SetupServerApi): Array<{ params: Record<string, string>; authorization: string | null; url: string }> {
  const seen: Array<{ params: Record<string, string>; authorization: string | null; url: string }> = [];
  server.events.on('request:start', ({ request }) => {
    seen.push({ params: Object.fromEntries(new URL(request.url).searchParams.entries()), authorization: request.headers.get('authorization'), url: request.url });
  });
  return seen;
}
```

`ports.ts` imports `errors.ts`, which Task 5.4 creates; the first test importing `ports.ts` is Task 5.5's. Until then, `pnpm --filter @gmt/providers typecheck` reports that one module as missing. vitest only transforms what a test imports, so this task's run is unaffected.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/inventory.test.ts`
Expected: PASS, 4 tests. A failure here is a WP4b recording gap; report it rather than weaken the test.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi test support and recorded-fixture inventory"
```

### Task 5.3: Parameter allowlist and request builders

**Files:** create `test/searchapi/params.test.ts`. Complete `src/searchapi/params.ts`.

**Interfaces:** consumes `Cabin`, `DiscoveryQuery`, `ItineraryQuery`, `Secret`, `IsoDate`, and WP4's `ParamsAllowlist`, `loadParamsAllowlist`, `assertRequestAllowed`. Produces `SEARCHAPI_PARAMS`, `TRAVEL_CLASS`, `calendarParams`, `flightsParams`, `toUrl`, `authHeaders`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/params.test.ts
import { Secret, asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { assertRequestAllowed, loadParamsAllowlist } from '../../src/params/allowlist.js';
import { SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_PARAMS, TRAVEL_CLASS, authHeaders, calendarParams, flightsParams, toUrl } from '../../src/searchapi/params.js';
import { latestParamsPath } from './support/recorded.js';
import { CELL_QUERY } from './support/synthetic.js';

const rect = { kind: 'rectangle', departFrom: asIsoDate('2026-11-02'), departTo: asIsoDate('2026-11-09'), returnFrom: asIsoDate('2026-11-12'), returnTo: asIsoDate('2026-11-30') } as const;
const calQ = { origin: asIata('LHR'), destination: asIata('JFK'), cabin: 'economy' as const };
const allowed = (params: Record<string, string>) => () => assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, toUrl(params));

describe('SearchApi parameter allowlist (spec §5.2 dated allowlist)', () => {
  it('SEARCHAPI_PARAMS equals the recorded params-<date>.json, names, values and hash', () => {
    expect(SEARCHAPI_PARAMS).toEqual(loadParamsAllowlist(latestParamsPath()));
  });

  it('names are ascending, as the pinned type requires', () => {
    const names = SEARCHAPI_PARAMS.endpoints[SEARCHAPI_ENDPOINT_PATH]?.names ?? [];
    expect(names).toEqual([...names].sort());
  });

  it('calendar parameters: exact names, values and point of sale (gl = POINT_OF_SALE lower-cased, hl=en, currency=GBP)', () => {
    const p = calendarParams(calQ, rect, 'GB');
    expect(p).toEqual({
      engine: 'google_flights_calendar', departure_id: 'LHR', arrival_id: 'JFK', flight_type: 'round_trip',
      outbound_date: '2026-11-02', outbound_date_start: '2026-11-02', outbound_date_end: '2026-11-09',
      return_date: '2026-11-12', return_date_start: '2026-11-12', return_date_end: '2026-11-30',
      travel_class: 'economy', adults: '1', currency: 'GBP', gl: 'gb', hl: 'en',
    });
    expect(allowed(p)).not.toThrow();
  });

  it.each([
    ['economy', 'economy'], ['premium_economy', 'premium_economy'], ['business', 'business'], ['first', 'first_class'],
  ] as const)('cabin %s maps to travel_class %s (spec §5.4)', (cabin, value) => {
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

  it('itinerary steps carry exactly the google_flights names; steps 2 and 3 add one token', () => {
    const s1 = flightsParams(CELL_QUERY, 'GB');
    expect(Object.keys(s1).sort()).toEqual(['adults', 'arrival_id', 'currency', 'departure_id', 'engine', 'flight_type', 'gl', 'hl', 'outbound_date', 'return_date', 'travel_class']);
    expect(flightsParams(CELL_QUERY, 'GB', { departure_token: 'tok' })).toEqual({ ...s1, departure_token: 'tok' });
    expect(flightsParams(CELL_QUERY, 'GB', { booking_token: 'tok' })).toEqual({ ...s1, booking_token: 'tok' });
    expect(allowed({ ...s1, booking_token: 'tok' })).not.toThrow();
  });

  it('refuses an unknown name and a disallowed value, and the URL never carries a key', () => {
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), api_key: 'x' })).toThrow();
    expect(allowed({ ...calendarParams(calQ, rect, 'GB'), currency: 'USD' })).toThrow();
    expect(toUrl(calendarParams(calQ, rect, 'GB')).search).not.toContain('api_key');
  });

  it('puts the key in Authorization: Bearer only (spec §2 fact 8)', () => {
    expect(authHeaders(new Secret('test-searchapi-key-0123456789abcdef'))).toEqual({ Authorization: 'Bearer test-searchapi-key-0123456789abcdef', Accept: 'application/json' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/params.test.ts`
Expected: FAIL. `SEARCHAPI_PARAMS` (and the builders) are not exported from `params.js`.

- [ ] **Step 3: Implement**

Append to `src/searchapi/params.ts`, with the imports moved to the top:

```ts
import type { Cabin, DiscoveryQuery, IsoDate, ItineraryQuery, Secret, TileRequest } from '@gmt/core';
import type { ParamsAllowlist } from '../params/allowlist.js';

const TRAVEL_CLASSES = ['economy', 'premium_economy', 'business', 'first_class'];

/** Cabin → vendor `travel_class` (spec §5.4: `first` is `first_class`). */
export const TRAVEL_CLASS: Readonly<Record<Cabin, string>> = { economy: 'economy', premium_economy: 'premium_economy', business: 'business', first: 'first_class' };

// why: these two values identify the WP4b recording this constant mirrors; copy them from the
// newest packages/providers/fixtures/recorded/searchapi/params-<date>.json (Task 5.3 Step 3).
const RECORDED_AT = '2026-10-14' as IsoDate;
const RECORDED_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Every parameter name and value this adapter may send (spec §5.2), in WP4's pinned
 * `ParamsAllowlist` shape: keyed by endpoint path, names ascending. Both engines share
 * `/api/v1/search`, so names are the union of the calendar and itinerary sets; the per-engine
 * guard is `calendarParams`/`flightsParams`, tested name by name. A test asserts deep equality
 * with WP4b's recorded `params-<date>.json`.
 */
export const SEARCHAPI_PARAMS: ParamsAllowlist = {
  provider: 'searchapi',
  recordedAt: RECORDED_AT,
  endpoints: {
    [SEARCHAPI_ENDPOINT_PATH]: {
      names: [
        'adults', 'arrival_id', 'booking_token', 'currency', 'departure_id', 'departure_token', 'engine', 'flight_type', 'gl', 'hl',
        'outbound_date', 'outbound_date_end', 'outbound_date_start', 'return_date', 'return_date_end', 'return_date_start', 'stops', 'travel_class',
      ],
      values: {
        adults: ['1'], arrival_id: 'any', booking_token: 'any', currency: ['GBP'], departure_id: 'any', departure_token: 'any',
        engine: ['google_flights', 'google_flights_calendar'], flight_type: ['round_trip'], gl: 'any', hl: ['en'],
        outbound_date: 'any', outbound_date_end: 'any', outbound_date_start: 'any', return_date: 'any', return_date_end: 'any', return_date_start: 'any',
        stops: ['nonstop', 'one_stop_or_fewer', 'two_stops_or_fewer'], travel_class: TRAVEL_CLASSES,
      },
    },
  },
  contentSha256: RECORDED_SHA256,
};

/** Spec §5.2 point of sale: GBP and English hard-coded, `gl` from POINT_OF_SALE. */
function localisation(pointOfSale: string): Record<string, string> {
  return { currency: 'GBP', gl: pointOfSale.toLowerCase(), hl: 'en' };
}

/** `google_flights_calendar` parameters for one rectangle; `outbound_date`/`return_date` are vendor-required even with ranges. */
export function calendarParams(q: Pick<DiscoveryQuery, 'origin' | 'destination' | 'cabin'>, r: Extract<TileRequest, { kind: 'rectangle' }>, pointOfSale: string): Record<string, string> {
  return {
    engine: 'google_flights_calendar', departure_id: q.origin, arrival_id: q.destination, flight_type: 'round_trip',
    outbound_date: r.departFrom, outbound_date_start: r.departFrom, outbound_date_end: r.departTo,
    return_date: r.returnFrom, return_date_start: r.returnFrom, return_date_end: r.returnTo,
    travel_class: TRAVEL_CLASS[q.cabin], adults: '1', ...localisation(pointOfSale),
  };
}

const STOPS: Readonly<Record<number, string>> = { 0: 'nonstop', 1: 'one_stop_or_fewer', 2: 'two_stops_or_fewer' };

/** `google_flights` parameters for one cell; steps 2 and 3 resend them plus one token (docs 2026-10-14). Spec §5.4. */
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

/** The one place the key is revealed: an Authorization header (spec §2 fact 8, §5.3). */
export function authHeaders(key: Secret): Record<string, string> {
  return { Authorization: `Bearer ${key.reveal()}`, Accept: 'application/json' };
}
```

Set `RECORDED_AT` and `RECORDED_SHA256` to the file's two values. The 2026-10-14 date and the hash shown are stand-ins for the WP4b output, and the first test fails until they match. Print the real values with:

`node -e "const f=require('fs'),d='packages/providers/fixtures/recorded/searchapi',n=f.readdirSync(d).filter(x=>/^params-/.test(x)).sort().at(-1),j=JSON.parse(f.readFileSync(d+'/'+n));console.log(j.recordedAt,j.contentSha256)"`

If the test reports any other difference (names, value lists, `'any'` placement), the recording and this constant disagree on what the adapter sends. Resolve it with Fable; do not edit either side to match blindly. `assertRequestAllowed` is WP4's; it throws on a name or value outside the allowlist.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/params.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SEARCHAPI_PARAMS allowlist and request builders (spec §5.2)"
```

### Task 5.4: Error classification and http limits

**Files:** create `src/searchapi/errors.ts` and `test/searchapi/errors.test.ts`.

**Interfaces:** consumes `ProviderError`, `ProviderLimits`, `PLAN_PRESETS`, `ProviderHttpLimits`, `Config`. Produces `classifySearchApiError` and `searchApiHttpLimits`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/errors.test.ts
import { PLAN_PRESETS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { classifySearchApiError, searchApiHttpLimits } from '../../src/searchapi/errors.js';
import { searchApiRecordings } from './support/recorded.js';

const recorded = searchApiRecordings();

describe('classifySearchApiError (spec §5.2 errors rev 10, §2 fact 5)', () => {
  it('the recorded 401 body → auth, non-retryable; the vendor message in the message, never in reason', () => {
    const r = recorded.find((x) => x.status === 401);
    if (r === undefined) throw new Error('WP4b must record the 401 body');
    const e = classifySearchApiError(401, r.body, false);
    expect(e).toMatchObject({ kind: 'auth', retryable: false, httpStatus: 401, providerId: 'searchapi' });
    expect(e.reason).toBeUndefined();
    expect(e.message).toContain('Invalid API key.');
  });

  it('the recorded 400 body → parse, non-retryable, vendor message carried for last_error', () => {
    const r = recorded.find((x) => x.status === 400);
    if (r === undefined) throw new Error('WP4b must record the 400 body');
    const e = classifySearchApiError(400, r.body, false);
    expect(e).toMatchObject({ kind: 'parse', retryable: false, httpStatus: 400 });
    expect(e.reason).toBeUndefined();
    expect(e.message).toContain((r.body as { error: string }).error.slice(0, 40));
  });

  it.each([
    [403, false, 'auth', false],
    [402, false, 'quota', false],
    [404, false, 'upstream', false],
    [429, false, 'rate-limit', true],
    [429, true, 'quota', false], // quota discrimination by ledger state
    [500, false, 'upstream', true],
    [503, false, 'upstream', true],
    [418, false, 'upstream', false],
  ] as const)('HTTP %i (ledger at cap: %s) → %s, retryable %s', (status, atCap, kind, retryable) => {
    const e = classifySearchApiError(status, { error: 'x' }, atCap);
    expect(e).toMatchObject({ kind, retryable, httpStatus: status, providerId: 'searchapi' });
    expect(e.reason).toBeUndefined();
  });

  it('tolerates a string body and an empty body', () => {
    expect(classifySearchApiError(400, 'bad request', false).message).toContain('bad request');
    expect(classifySearchApiError(400, null, false).message).toContain('no message');
  });

  it('never keeps a URL query in the message', () => {
    expect(classifySearchApiError(400, { error: 'see https://www.searchapi.io/api/v1/search?api_key=SECRET' }, false).message).not.toContain('SECRET');
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
import { type Config, ProviderError, type ProviderLimits } from '@gmt/core';
import type { ProviderHttpLimits } from '../http/httpKit.js';
import { SEARCHAPI_HOST } from './params.js';

/** The vendor's message: `{"error": "..."}` (spec §2 fact 5), a plain string, or nothing. */
function vendorMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === 'string') return e.slice(0, 200);
  }
  if (typeof body === 'string' && body.length > 0) return body.slice(0, 200);
  return 'no message';
}

/**
 * http-kit's `classifyError` hook for SearchApi. Spec §5.2 (rev 10): 401/403 auth, 402 quota,
 * 400 parse (non-retryable), 404 upstream non-retryable, 429 rate-limit unless the ledger shows
 * the plan cap (then quota), 5xx upstream retryable. `reason` is left unset: the outcome
 * reason is the kind, and the vendor message travels in `message` to `last_error` (spec §3).
 * ProviderError strips URLs from the message.
 */
export function classifySearchApiError(status: number, body: unknown, ledgerAtCap: boolean): ProviderError {
  const base = { providerId: 'searchapi' as const, httpStatus: status, message: `searchapi HTTP ${status}: ${vendorMessage(body)}` };
  if (status === 401 || status === 403) return new ProviderError({ ...base, kind: 'auth', retryable: false });
  if (status === 402) return new ProviderError({ ...base, kind: 'quota', retryable: false });
  if (status === 400) return new ProviderError({ ...base, kind: 'parse', retryable: false });
  if (status === 404) return new ProviderError({ ...base, kind: 'upstream', retryable: false });
  if (status === 429) {
    // why: no quota body is recorded yet (spec §2 fact 5), so the ledger decides.
    return ledgerAtCap
      ? new ProviderError({ ...base, kind: 'quota', retryable: false, message: `${base.message} (plan call cap reached)` })
      : new ProviderError({ ...base, kind: 'rate-limit', retryable: true });
  }
  if (status >= 500) return new ProviderError({ ...base, kind: 'upstream', retryable: true });
  return new ProviderError({ ...base, kind: 'upstream', retryable: false });
}

/**
 * SearchApi's http-kit limits (plan contract). Billable on HTTP 200 on every plan: on a
 * subscription the cost is 0 but the call cap counts (spec §5.3 billable rule).
 */
export function searchApiHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits {
  return {
    hosts: [SEARCHAPI_HOST], ratePerMinute: limits.ratePerMinute, ratePerHour: limits.ratePerHour, concurrency: limits.concurrency,
    billable: 'http-200', costPerCallMicroGbp: limits.costPerCallMicroGbp,
    maxWaitSeconds: cfg.maxWaitSeconds, requestTimeoutSeconds: cfg.requestTimeoutSeconds, classifyError: classifySearchApiError,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/errors.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi error classification and http limits (spec §5.2, §5.3)"
```

### Task 5.5: Calendar tile fetch and parse

**Files:** create `src/searchapi/shapes.ts` and `test/searchapi/calendar.test.ts`. Extend `src/searchapi/calendar.ts`.

**Interfaces:** consumes `HttpKit`, `ProviderContext`, `DiscoveryTileResult`, `RawCalendarPrice`, `ProviderError`, `MINOR_EXPONENT`, `cellKeyString`, WP4's `replayHandlers`. Produces `fetchCalendarTile`, `parseCalendarBody`, `CalendarDeps`, `readEcho`, `toMinor`, `NoteCounter`, `parseError`, and the vendor shapes.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/calendar.test.ts
import { type DiscoveryQuery, type TilePlan, addDays, asIata, asIsoDate, cellKeyString, toEpochDay } from '@gmt/core';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import { type CalendarDeps, fetchCalendarTile, planRectangles } from '../../src/searchapi/calendar.js';
import { SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_PARAMS, TRAVEL_CLASS } from '../../src/searchapi/params.js';
import { replayHandlers } from '../../src/testing/index.js';
import { SENTINEL_KEY, captureRequests, ctx, testPorts } from './support/ports.js';
import { RECORDED_ROOT, byEngine, need, searchApiRecordings } from './support/recorded.js';
import { ECHO, syntheticHandler } from './support/synthetic.js';

const recorded = searchApiRecordings();
const server = setupServer(...replayHandlers(RECORDED_ROOT));
const sent = captureRequests(server);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  // why: spec §5.2 / §9 item 2: every outgoing request's names and values are in the dated allowlist.
  for (const r of sent) expect(() => assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, new URL(r.url))).not.toThrow();
  sent.length = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

const deps = (p = testPorts()): CalendarDeps & { ports: ReturnType<typeof testPorts> } => ({ http: p.http, log: p.log, key: p.key, pointOfSale: 'GB', allowlist: SEARCHAPI_PARAMS, cacheTtlSeconds: 3600, ports: p });
const day = (s: string) => toEpochDay(asIsoDate(s));
const small: DiscoveryQuery = { origin: asIata('LHR'), destination: asIata('JFK'), departureFrom: asIsoDate('2026-11-02'), departureTo: asIsoDate('2026-11-04'), minNights: 10, maxNights: 12, cabin: 'economy', currency: 'GBP' };
const smallPlan = (): TilePlan => {
  const [t] = planRectangles(small);
  if (t === undefined) throw new Error('expected one tile');
  return t;
};
/** Calendar body with one entry per covered cell, priced 500, plus extras. */
const gridFor = (plan: TilePlan, extra: object[] = [], echo: object = ECHO) => ({
  ...echo,
  calendar: [...plan.coveredCells.map((c) => ({ departure: c.departureDate, return: c.returnDate, price: 500 })), ...extra] as object[],
});

describe('fetchTile, recorded (spec §5.2, §9 item 2)', () => {
  it('replays the recorded tile: response-keyed prices, GBP from the echo, pointOfSale from gl, tileIndex on reserve', async () => {
    const rec = byEngine(recorded, 'google_flights_calendar').find((r) => r.status === 200);
    if (rec === undefined) throw new Error('WP4b must record one HTTP 200 calendar tile');
    const p = rec.params;
    const departureFrom = asIsoDate(need(p, 'outbound_date_start'));
    const departureTo = asIsoDate(need(p, 'outbound_date_end'));
    const cabin = (Object.entries(TRAVEL_CLASS).find(([, v]) => v === (p.travel_class ?? 'economy'))?.[0] ?? 'economy') as DiscoveryQuery['cabin'];
    // why: choose the band whose tight rectangle is exactly the recorded one, so the plan reproduces it.
    const q: DiscoveryQuery = {
      origin: asIata(need(p, 'departure_id')), destination: asIata(need(p, 'arrival_id')), departureFrom, departureTo,
      minNights: day(need(p, 'return_date_start')) - day(departureFrom), maxNights: day(need(p, 'return_date_end')) - day(departureTo), cabin, currency: 'GBP',
    };
    const [plan, ...rest] = planRectangles(q);
    if (plan === undefined) throw new Error('expected one tile');
    expect(rest).toHaveLength(0);
    const d = deps();
    const res = await fetchCalendarTile(d, plan, q, ctx());
    if (res.kind !== 'tile') throw new Error(`expected a tile, got ${res.error.message}`);
    const covered = new Set(plan.coveredCells.map(cellKeyString));
    expect(res.prices.length).toBeGreaterThan(0); // spec §2: every probed route fully priced
    for (const price of res.prices) {
      expect(covered.has(cellKeyString(price))).toBe(true);
      expect(price.currency).toBe('GBP');
      expect(Number.isInteger(price.amountMinor)).toBe(true);
    }
    expect(res.pointOfSale).toBe('GB');
    expect(res.fetchedAt).toBe('2026-10-14T12:00:00.000Z');
    expect(d.ports.reserves).toEqual([{ endpointPath: '/api/v1/search', httpAttempt: 1, tileIndex: plan.index }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.authorization).toBe(`Bearer ${SENTINEL_KEY}`);
    expect(sent[0]?.url).not.toContain(SENTINEL_KEY);
  });

  it('a recorded 401 body becomes a tile-error of kind auth (spec §2 fact 5)', async () => {
    const r401 = recorded.find((r) => r.status === 401);
    if (r401 === undefined) throw new Error('WP4b must record the 401 body');
    server.use(syntheticHandler(() => ({ status: 401, body: r401.body }), []));
    expect(await fetchCalendarTile(deps(), smallPlan(), small, ctx())).toMatchObject({ kind: 'tile-error', error: { kind: 'auth', retryable: false, httpStatus: 401 } });
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
      for (let d = asIsoDate(p.get('outbound_date_start') ?? ''); d <= asIsoDate(p.get('outbound_date_end') ?? ''); d = addDays(d, 1))
        for (let r = asIsoDate(p.get('return_date_start') ?? ''); r <= asIsoDate(p.get('return_date_end') ?? ''); r = addDays(r, 1)) out.push({ departure: d, return: r, price: 480 });
      return { status: 200, body: { ...ECHO, calendar: out } };
    }, seen));
    const d = deps();
    const results = [];
    for (const plan of plans) results.push(await fetchCalendarTile(d, plan, q, ctx()));
    expect(seen).toHaveLength(plans.length);
    for (const [i, res] of results.entries()) {
      if (res.kind !== 'tile') throw new Error('expected tile');
      expect(res.prices).toHaveLength(plans[i]?.coveredCells.length ?? -1);
      expect(res.notes.some((n) => n.startsWith('dropped-outside-tile:'))).toBe(true);
    }
  });

  it('has_no_flights: true on an entry → that cell in noFares, no price (synthetic)', async () => {
    const plan = smallPlan();
    const [first] = plan.coveredCells;
    if (first === undefined) throw new Error('cells');
    const body = gridFor(plan);
    body.calendar[0] = { departure: first.departureDate, return: first.returnDate, has_no_flights: true };
    server.use(syntheticHandler(() => ({ status: 200, body }), []));
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    if (res.kind !== 'tile') throw new Error('expected tile');
    expect(res.noFares).toEqual([first]);
    expect(res.prices).toHaveLength(plan.coveredCells.length - 1);
  });

  it('an empty grid under a passing ≤200 assertion → parse, never no_data (synthetic)', async () => {
    server.use(syntheticHandler(() => ({ status: 200, body: { ...ECHO, calendar: [] } }), []));
    const res = await fetchCalendarTile(deps(), smallPlan(), small, ctx());
    expect(res).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', retryable: false } });
    if (res.kind === 'tile-error') expect(res.error.message).toMatch(/empty-grid/);
  });

  it('a response that states no currency → parse (synthetic)', async () => {
    const plan = smallPlan();
    server.use(syntheticHandler(() => ({ status: 200, body: { calendar: gridFor(plan).calendar } }), []));
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    if (res.kind !== 'tile-error') throw new Error('expected tile-error');
    expect(res.error.kind).toBe('parse');
    expect(res.error.message).toMatch(/no-currency/);
  });

  it('a gl echo other than the requested point of sale → parse (synthetic)', async () => {
    const plan = smallPlan();
    server.use(syntheticHandler(() => ({ status: 200, body: gridFor(plan, [], { search_parameters: { currency: 'GBP', gl: 'us' } }) }), []));
    const res = await fetchCalendarTile(deps(), plan, small, ctx());
    if (res.kind !== 'tile-error') throw new Error('expected tile-error');
    expect(res.error.message).toMatch(/point-of-sale-mismatch/);
  });

  it('a malformed envelope → parse (synthetic)', async () => {
    server.use(syntheticHandler(() => ({ status: 200, body: { ...ECHO, calendar: 'nope' } }), []));
    const res = await fetchCalendarTile(deps(), smallPlan(), small, ctx());
    if (res.kind !== 'tile-error') throw new Error('expected tile-error');
    expect(res.error.message).toMatch(/malformed-calendar/);
  });

  it('drops and counts entries outside the tile, outside the band, duplicated, unpriced or without a return (synthetic)', async () => {
    const plan = smallPlan();
    const [a, b] = plan.coveredCells;
    if (a === undefined || b === undefined) throw new Error('cells');
    // why: q.cells may carry an off-band cell only through an engine bug; the band check still applies.
    const offBand = { ...a, returnDate: addDays(a.departureDate, 30) };
    const withOff: TilePlan = { ...plan, coveredCells: [...plan.coveredCells, offBand] };
    const body = gridFor(plan, [
      { departure: '2026-12-01', return: '2026-12-11', price: 1 },
      { departure: offBand.departureDate, return: offBand.returnDate, price: 1 },
      { departure: a.departureDate, return: a.returnDate, price: 999 },
      { departure: b.departureDate },
    ]);
    body.calendar[1] = { departure: b.departureDate, return: b.returnDate }; // unpriced, not no-flights
    server.use(syntheticHandler(() => ({ status: 200, body }), []));
    const res = await fetchCalendarTile(deps(), withOff, small, ctx());
    if (res.kind !== 'tile') throw new Error('expected tile');
    // the off-band covered cell is never "seen", so it is also counted as absent
    expect(res.notes).toEqual(['covered-cells-absent:1', 'dropped-duplicate:1', 'dropped-no-return:1', 'dropped-outside-band:1', 'dropped-outside-tile:1', 'unpriced-skipped:1']);
    expect(res.prices.find((p) => cellKeyString(p) === cellKeyString(a))?.amountMinor).toBe(50000);
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
    const plan: TilePlan = { index: 0, coveredCells: [], request: { kind: 'month', month: '2026-11' as never } };
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

  it('sends travel_class=first_class for the first cabin, gl=gb, no api_key (synthetic)', async () => {
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

/**
 * A non-retryable `parse` error. Spec §3 (rev 10): the outcome reason is the kind, so the
 * specific cause is a tag at the head of the message (which becomes `last_error`).
 */
export function parseError(tag: string, detail: string): ProviderError {
  return new ProviderError({ kind: 'parse', retryable: false, message: `searchapi ${tag}: ${detail}`, providerId: 'searchapi' });
}

const echoSchema = z.object({ currency: z.string().optional(), gl: z.string().optional() });
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `google_flights_calendar` (docs 2026-10-14): `has_no_flights` is per entry and such entries omit `price`. */
export const calendarResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  calendar: z.array(z.object({
    departure: dateString, return: dateString.optional(), price: z.number().nonnegative().optional(),
    is_lowest_price: z.boolean().optional(), has_no_flights: z.boolean().optional(),
  })),
});

const airportSchema = z.object({ id: z.string(), date: z.string(), time: z.string() });
export const segmentSchema = z.object({
  departure_airport: airportSchema, arrival_airport: airportSchema, airline: z.string().optional(), flight_number: z.string(),
  travel_class: z.string().optional(), duration: z.number().int().nonnegative().optional(), airplane: z.string().optional(),
});
export const optionSchema = z.object({
  flights: z.array(segmentSchema), price: z.number().nonnegative().optional(),
  departure_token: z.string().optional(), booking_token: z.string().optional(),
});
/** Steps 1 and 2. `other_flights` is not on the docs page; read when present. */
export const flightsResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  best_flights: z.array(optionSchema).optional(),
  other_flights: z.array(optionSchema).optional(),
  price_insights: z.object({ price_history: z.array(z.object({ price: z.number().nonnegative(), iso_date: z.string() })).nullish() }).nullish(),
});
export const bookingOptionSchema = z.object({
  book_with: z.string().optional(), price: z.number().nonnegative().optional(), baggage_prices: z.array(z.string()).optional(),
  booking_request: z.object({ url: z.string(), post_data: z.string() }).optional(), booking_phone: z.string().optional(),
  is_split_booking: z.boolean().optional(),
});
/** Step 3 (`booking_token`). */
export const bookingResponseSchema = z.object({ search_parameters: echoSchema.optional(), booking_options: z.array(bookingOptionSchema).optional() });
export type VendorSegment = z.infer<typeof segmentSchema>;
export type VendorOption = z.infer<typeof optionSchema>;
export type VendorBookingOption = z.infer<typeof bookingOptionSchema>;

/**
 * Currency and point of sale from the `search_parameters` echo. Spec §2: a response that
 * states no currency is a parse error; spec §5.2: `pointOfSale` is the upper-cased `gl` echo.
 */
export function readEcho(echo: z.infer<typeof echoSchema> | undefined, requestedGl: string): { currency: string; pointOfSale: string } {
  const currency = echo?.currency;
  if (currency === undefined || !/^[A-Za-z]{3}$/.test(currency)) throw parseError('no-currency', 'response states no currency (search_parameters.currency)');
  const gl = echo?.gl;
  if (gl === undefined || !/^[A-Za-z]{2}$/.test(gl)) throw parseError('no-point-of-sale', 'response does not echo gl (search_parameters.gl)');
  if (gl.toLowerCase() !== requestedGl) throw parseError('point-of-sale-mismatch', `echoed gl=${gl}; requested gl=${requestedGl}`);
  return { currency: currency.toUpperCase(), pointOfSale: gl.toUpperCase() };
}

/** Vendor major units → integer minor units with the ISO 4217 exponent (spec §6.3). */
export function toMinor(major: number, currency: string): number {
  const exponent = MINOR_EXPONENT[currency];
  if (exponent === undefined) throw parseError('currency-unknown', `prices in ${currency}, which has no known minor-unit exponent`);
  const minor = Math.round(major * 10 ** exponent);
  if (!Number.isSafeInteger(minor) || minor < 0) throw parseError('bad-price', `unusable price ${major} ${currency}`);
  return minor;
}

/** Counted reasons for `notes` (spec §5.2: drops are counted). Sorted, `reason:n`. */
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

Append to `src/searchapi/calendar.ts`, merging the imports into its import block:

```ts
import { type DiscoveryTileResult, type Logger, type ProviderContext, ProviderError, type RawCalendarPrice, type Secret, cellKeyString } from '@gmt/core';
import type { HttpKit } from '../http/httpKit.js';
import { type ParamsAllowlist, assertRequestAllowed } from '../params/allowlist.js';
import { SEARCHAPI_ENDPOINT_PATH, authHeaders, calendarParams, toUrl } from './params.js';
import { NoteCounter, calendarResponseSchema, parseError, readEcho, toMinor } from './shapes.js';

/** What `fetchTile` needs; built once by `searchApiProvider`. */
export interface CalendarDeps { http: HttpKit; log: Logger; key: Secret; pointOfSale: string; allowlist: ParamsAllowlist; cacheTtlSeconds: number }

/**
 * Parses one calendar response for one tile. Spec §5.2: cell keys from the response; entries
 * outside `coveredCells` or the band are dropped and counted; `has_no_flights` → `noFares`;
 * an empty grid → parse; currency and point of sale from the echo.
 */
export function parseCalendarBody(body: unknown, plan: TilePlan, q: DiscoveryQuery, requestedGl: string): { prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[]; pointOfSale: string } {
  const parsed = calendarResponseSchema.safeParse(body);
  if (!parsed.success) throw parseError('malformed-calendar', 'calendar response did not match the documented shape');
  const echo = readEcho(parsed.data.search_parameters, requestedGl);
  // why: spec §5.2: under a passing ≤200 assertion an empty grid is a vendor fault, never "no data".
  if (parsed.data.calendar.length === 0) throw parseError('empty-grid', 'calendar returned an empty grid within the 200-combination limit');
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
    // why: membership first, so only keys matching a planned (valid) cell reach date arithmetic.
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
 * allowlist check run before `http.request`, so neither reaches `budget.reserve`. A
 * `ProviderError` becomes a `tile-error` for exactly this tile's cells; `BudgetExceeded` and
 * `AbortedError` propagate.
 */
export async function fetchCalendarTile(d: CalendarDeps, plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
  const req = plan.request;
  if (req.kind !== 'rectangle') throw new TypeError(`searchapi plans rectangle tiles only; got ${req.kind}`);
  assertWithinLimit(req);
  const url = toUrl(calendarParams(q, req, d.pointOfSale));
  assertRequestAllowed(d.allowlist, SEARCHAPI_ENDPOINT_PATH, url);
  try {
    // why: the cache key excludes execution and tile ids (plan decision 14), so an identical rectangle from a resumed run is a cache hit.
    const res = await d.http.request({
      providerId: 'searchapi', executionId: ctx.executionId, tileIndex: plan.index, endpointPath: SEARCHAPI_ENDPOINT_PATH,
      method: 'GET', url, headers: authHeaders(d.key), cache: { ttlSeconds: d.cacheTtlSeconds },
      signal: ctx.signal, recordFixtures: ctx.recordFixtures,
    });
    const parsed = parseCalendarBody(res.body, plan, q, d.pointOfSale.toLowerCase());
    d.log.debug({ tileIndex: plan.index, prices: parsed.prices.length, noFares: parsed.noFares.length, notes: parsed.notes }, 'searchapi calendar tile parsed');
    return { kind: 'tile', index: plan.index, coveredCells: plan.coveredCells, fetchedAt: res.fetchedAt, ...parsed };
  } catch (err) {
    if (err instanceof ProviderError) return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error: err };
    throw err;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/calendar.test.ts`
Expected: PASS, 14 tests, with the `afterEach` allowlist assertions holding for every request.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi calendar tiles: response keying, empty grid → parse, has_no_flights → noFares"
```

### Task 5.6: Itinerary chain, steps 1 and 2, with outcome rules and route history

**Files:** create `src/searchapi/itinerary.ts` and `test/searchapi/itinerary.test.ts`.

**Interfaces:** consumes `ItineraryQuery`, `ItinerarySearchResult`, `RawOffer`, `RawSegment`, `ProviderError`, `PLAN_PRESETS`, `HttpKit`, Tasks 5.3–5.5. Produces `searchItinerary`, `estimateItinerary`, `assertBookingLinks`, `toRawSegment`, `bookingOffers`, `ItineraryDeps`, `WORST_SECONDS_PER_CALL`.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/itinerary.test.ts
import { asIata, asIsoDate } from '@gmt/core';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import { type ItineraryDeps, searchItinerary, toRawSegment } from '../../src/searchapi/itinerary.js';
import { SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { replayHandlers } from '../../src/testing/index.js';
import { captureRequests, ctx, testPorts } from './support/ports.js';
import { RECORDED_ROOT, chainRecording, need, searchApiRecordings } from './support/recorded.js';
import { CELL_QUERY, IN_1, IN_2, OUT_A, OUT_B, POST, bookingBody, flightsBody, option, seg, syntheticHandler } from './support/synthetic.js';

const server = setupServer(...replayHandlers(RECORDED_ROOT));
const sent = captureRequests(server);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  for (const r of sent) expect(() => assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, new URL(r.url))).not.toThrow();
  sent.length = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

const deps = (p = testPorts()): ItineraryDeps & { ports: ReturnType<typeof testPorts> } => ({ http: p.http, log: p.log, key: p.key, pointOfSale: 'GB', allowlist: SEARCHAPI_PARAMS, ports: p });
const A = option(OUT_A, 600, { departure_token: 'dA' });
const B = option(OUT_B, 640, { departure_token: 'dB' });
const agent = (price: number) => ({ book_with: 'Synthetic Travel Agent', price, booking_request: POST });
const ok = (body: unknown) => ({ status: 200, body });

/** Routes synthetic replies by token: step 1 has none, step 2 a departure_token, step 3 a booking_token. */
function chain(step1: unknown, step2: Record<string, { status: number; body: unknown }>, step3: Record<string, { status: number; body: unknown }> = {}) {
  const seen: URLSearchParams[] = [];
  server.use(syntheticHandler((p) => {
    const dep = p.get('departure_token');
    const bk = p.get('booking_token');
    if (bk !== null) return step3[bk] ?? { status: 404, body: { error: 'unknown booking token' } };
    if (dep !== null) return step2[dep] ?? { status: 404, body: { error: 'unknown departure token' } };
    return ok(step1);
  }, seen));
  return seen;
}

describe('itinerary chain, recorded (spec §5.4, §9 item 2)', () => {
  it('replays the recorded 1 → 2 → 3 chain into priced GBP offers with a Google POST booking and route history', async () => {
    const { step1, step2s, step3s } = chainRecording(searchApiRecordings());
    const p = step1.params;
    const q = { ...CELL_QUERY, origin: asIata(need(p, 'departure_id')), destination: asIata(need(p, 'arrival_id')), departureDate: asIsoDate(need(p, 'outbound_date')), returnDate: asIsoDate(need(p, 'return_date')), expandTop: step2s.length };
    const d = deps();
    const res = await searchItinerary(d, q, ctx());
    expect(sent).toHaveLength(1 + step2s.length + step3s.length);
    expect(d.ports.reserves.every((r) => r.tileIndex === null)).toBe(true);
    expect(res.coverage).toBe('priced');
    expect(res.offers.length).toBeGreaterThan(0);
    for (const o of res.offers) {
      expect(o.currency).toBe('GBP');
      expect(o.outbound.length).toBeGreaterThan(0);
      expect(o.inbound.length).toBeGreaterThan(0);
      expect(Number.isInteger(o.amountMinor)).toBe(true);
    }
    expect(res.offers.some((o) => o.booking.kind === 'post' && new URL(o.booking.url).hostname.endsWith('google.com'))).toBe(true);
    expect(res.routeHistory?.length ?? 0).toBeGreaterThan(0); // spec §2 bonus
    expect(res.pointOfSale).toBe('GB');
  });
});

describe('itinerary outcome rules (spec §5.4), synthetic shapes', () => {
  it('step 1 zero options → coverage empty, one call (synthetic)', async () => {
    const seen = chain(flightsBody([]), {});
    expect(await searchItinerary(deps(), CELL_QUERY, ctx())).toMatchObject({ coverage: 'empty', offers: [], partial: false, failedExpansions: 0, pointOfSale: 'GB' });
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
    const res = await searchItinerary(deps(), CELL_QUERY, ctx());
    expect(res.notes).toEqual(expect.arrayContaining(['unpriced-skipped:step1:1', 'unpriced-skipped:step2:1']));
    expect(seen.some((p) => p.get('departure_token') === 'dU')).toBe(false);
    expect(seen.some((p) => p.get('booking_token') === 'b2')).toBe(false);
  });

  it('all step-1 options unpriced → upstream no-priced-options, nothing expanded (spec §5.4) (synthetic)', async () => {
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

  it('auth at step 2 propagates instead of counting as a failed expansion (spec §8.1) (synthetic)', async () => {
    server.use(syntheticHandler((p) => (p.has('departure_token') ? { status: 401, body: { error: 'Invalid API key.' } } : ok(flightsBody([A]))), []));
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({ kind: 'auth' });
  });

  it('a step-1 response that states no currency → parse (synthetic)', async () => {
    chain({ best_flights: [A] }, {});
    await expect(searchItinerary(deps(), CELL_QUERY, ctx())).rejects.toMatchObject({ kind: 'parse', message: expect.stringMatching(/no-currency/) });
  });

  it('fetchedAt of the chain is the oldest step (spec §2) (synthetic)', async () => {
    const d = deps();
    server.use(syntheticHandler((p) => {
      d.ports.clock.advance(60_000);
      if (p.has('booking_token')) return ok(bookingBody([agent(573)]));
      if (p.has('departure_token')) return ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]));
      return ok(flightsBody([A]));
    }, []));
    expect((await searchItinerary(d, { ...CELL_QUERY, expandTop: 1 }, ctx())).fetchedAt).toBe('2026-10-14T12:01:00.000Z');
  });

  it('google_flights responses are never cached: a repeat search sends every call again (spec §5.3) (synthetic)', async () => {
    const seen = chain(flightsBody([A]), { dA: ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })])) }, { b1: ok(bookingBody([agent(573)])) });
    const d = deps();
    await searchItinerary(d, { ...CELL_QUERY, expandTop: 1 }, ctx());
    await searchItinerary(d, { ...CELL_QUERY, expandTop: 1 }, ctx());
    expect(seen).toHaveLength(6);
  });

  it('returns price_insights.price_history as routeHistory in minor units (synthetic)', async () => {
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
    expect((await searchItinerary(deps(), { ...CELL_QUERY, expandTop: 1 }, ctx())).routeHistory).toEqual([]);
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
    expect(toRawSegment(seg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', 'Synthetic Air One', 'Premium economy'))).toEqual({
      marketingCarrier: 'X1', flightNumber: '100', from: 'LHR', to: 'JFK', depart: '2026-11-02T09:05', arrive: '2026-11-02T23:00',
      timeKind: 'local', cabin: 'premium_economy', durationMinutes: 420, aircraft: 'Synthetic 787',
    });
  });
  it('an unrecognised travel_class leaves cabin unstated; an unsplittable flight number passes whole for core to reject', () => {
    const s = toRawSegment(seg('LHR', 'JFK', '2026-11-02', '09:05', 'Synthetic 100', 'Synthetic Air One', 'Mystery'));
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
  type BaggageSnapshot, type Cabin, type CostEstimate, type Iata, type IsoDate, type IsoDateTime, type ItineraryQuery,
  type ItinerarySearchResult, type Logger, PLAN_PRESETS, type PlanId, type ProviderContext, ProviderError, type RawOffer,
  type RawSegment, type Secret,
} from '@gmt/core';
import type { HttpKit, HttpKitResponse } from '../http/httpKit.js';
import { type ParamsAllowlist, assertRequestAllowed } from '../params/allowlist.js';
import { SEARCHAPI_ENDPOINT_PATH, authHeaders, flightsParams, toUrl } from './params.js';
import {
  NoteCounter, type VendorBookingOption, type VendorOption, type VendorSegment, bookingResponseSchema,
  flightsResponseSchema, parseError, readEcho, toMinor,
} from './shapes.js';

type RouteHistory = NonNullable<ItinerarySearchResult['routeHistory']>;
export interface ItineraryDeps { http: HttpKit; log: Logger; key: Secret; pointOfSale: string; allowlist: ParamsAllowlist }

/** Slowest calendar call measured on 2026-10-14 (spec §2: 9–29 s); itinerary latency was not measured separately. */
export const WORST_SECONDS_PER_CALL = 29;

/** Spec §5.4: `bookingLinks` is forced true for SearchApi. */
export function assertBookingLinks(q: ItineraryQuery): void {
  if (q.bookingLinks !== true) throw new TypeError('searchapi itinerary queries require bookingLinks: true (spec §5.4)');
}

/** `VerificationCapability.estimate`: calls = 1 + expandTop × 2 (spec §5.4); cost from the plan preset. */
export function estimateItinerary(q: ItineraryQuery, plan: PlanId): CostEstimate {
  assertBookingLinks(q);
  const calls = 1 + q.expandTop * 2;
  return {
    calls, costMicroGbp: calls * PLAN_PRESETS[plan].costPerCallMicroGbp, seconds: calls * WORST_SECONDS_PER_CALL,
    notes: [`1 outbound search + ${q.expandTop} × (return search + booking options)`, `${WORST_SECONDS_PER_CALL} s per call, the slowest calendar call measured on 2026-10-14`],
  };
}

const CABIN_BY_TRAVEL_CLASS: Readonly<Record<string, Cabin>> = { economy: 'economy', 'premium economy': 'premium_economy', business: 'business', first: 'first' };

/**
 * A vendor segment as a `RawSegment`, raw only (spec §5.2): vendor local times as given, the cabin
 * only when a recognised class is stated, the flight number split at the designator when it
 * matches `^[A-Z0-9]{2}\s*\d{1,4}[A-Z]?$`, otherwise passed whole so core rejects the offer.
 */
export function toRawSegment(s: VendorSegment): RawSegment {
  const m = /^([A-Z0-9]{2})\s*(\d{1,4}[A-Z]?)$/.exec(s.flight_number.trim());
  const seg: RawSegment = {
    marketingCarrier: m?.[1] ?? s.flight_number, flightNumber: m?.[2] ?? s.flight_number,
    from: s.departure_airport.id as Iata, to: s.arrival_airport.id as Iata,
    depart: `${s.departure_airport.date}T${s.departure_airport.time}`, arrive: `${s.arrival_airport.date}T${s.arrival_airport.time}`, timeKind: 'local',
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
  const url = toUrl(params);
  assertRequestAllowed(d.allowlist, SEARCHAPI_ENDPOINT_PATH, url);
  // why: every google_flights response carries departure or booking tokens; spec §5.3: token-bearing responses are never cached.
  return d.http.request({
    providerId: 'searchapi', executionId: ctx.executionId, tileIndex: null, endpointPath: SEARCHAPI_ENDPOINT_PATH,
    method: 'GET', url, headers: authHeaders(d.key), cache: 'never', signal: ctx.signal, recordFixtures: ctx.recordFixtures,
  });
}

function parseFlights(body: unknown, gl: string) {
  const r = flightsResponseSchema.safeParse(body);
  if (!r.success) throw parseError('malformed-flights', 'google_flights response did not match the documented shape');
  return { ...readEcho(r.data.search_parameters, gl), options: [...(r.data.best_flights ?? []), ...(r.data.other_flights ?? [])], priceHistory: r.data.price_insights?.price_history ?? [] };
}

function parseBooking(body: unknown, gl: string) {
  const r = bookingResponseSchema.safeParse(body);
  if (!r.success) throw parseError('malformed-booking-options', 'booking options response did not match the documented shape');
  return { ...readEcho(r.data.search_parameters, gl), options: r.data.booking_options ?? [] };
}

function toRouteHistory(points: ReadonlyArray<{ price: number; iso_date: string }>, currency: string, notes: NoteCounter): RouteHistory {
  const out: RouteHistory = [];
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
  return { outbound: out.map(toRawSegment), inbound: inb.map(toRawSegment), seller, requestedCabin: q.cabin, amountMinor, currency, booking, ...(baggage === undefined ? {} : { baggage }) };
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

/** Step-3 booking options as offers (spec §5.4); split, unpriced and seller-less options are counted, not persisted. */
export function bookingOffers(q: ItineraryQuery, out: readonly VendorSegment[], inb: readonly VendorSegment[], options: readonly VendorBookingOption[], currency: string, notes: NoteCounter): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const b of options) {
    // why: spec §5.4 (rev 10): split bookings are skipped and counted; a sum of two prices would be our number, not the vendor's.
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
 * `VerificationCapability.search` for SearchApi: the spec §5.4 chain. Step 2 runs for the
 * `expandTop` cheapest priced outbounds and every priced return option is an offer; step 3
 * runs for the cheapest priced return per outbound, every usable booking option is an offer,
 * and that option's step-2 price stays only when no step-3 seller names the airline. Outcome
 * rules: step 1 empty → `empty`; options but no step 2 yields legs → `upstream`/`no-return-legs`;
 * some step 2 fail → `partial` with `failedExpansions`. `fetchedAt` is the oldest step's.
 */
export async function searchItinerary(d: ItineraryDeps, q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult> {
  assertBookingLinks(q);
  const gl = d.pointOfSale.toLowerCase();
  const notes = new NoteCounter();
  const base = flightsParams(q, d.pointOfSale);

  const s1 = await send(d, base, ctx);
  const r1 = parseFlights(s1.body, gl);
  const fetched: IsoDateTime[] = [s1.fetchedAt];
  const routeHistory = toRouteHistory(r1.priceHistory, r1.currency, notes);
  if (r1.options.length === 0) {
    return { offers: [], coverage: 'empty', fetchedAt: s1.fetchedAt, pointOfSale: r1.pointOfSale, partial: false, failedExpansions: 0, notes: notes.list(), routeHistory };
  }

  const usable1: Array<Priced<VendorOption>> = [];
  for (const o of r1.options) {
    if (!isPriced(o)) notes.add('unpriced-skipped:step1');
    else if (o.departure_token === undefined) notes.add('no-departure-token:step1');
    else if (o.flights.length === 0) notes.add('no-segments:step1');
    else usable1.push(o);
  }
  if (usable1.length === 0) {
    // why: spec §5.4 (rev 10): every step-1 option unpriced → upstream, reason no-priced-options, non-retryable on resume.
    throw new ProviderError({ kind: 'upstream', reason: 'no-priced-options', retryable: false, providerId: 'searchapi', message: `searchapi: step 1 returned ${r1.options.length} options and none was priced and expandable` });
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
      // why: spec §5.4 (rev 10): a failed step 3 keeps the step-2 airline offer and the cell is priced with partial: true.
      partial = true;
      notes.add('booking-options-failed');
      offers.push(step2Offer);
      continue;
    }
    offers.push(...step3);
    const names = airlineNames(out.flights, cheapest.flights);
    // why: spec §5.4 price-source rule: the step-2 price is the airline's own fare; keep it only when step 3 does not list the airline.
    if (!step3.some((o) => names.has(o.seller.trim().toLowerCase()))) offers.push(step2Offer);
  }

  if (withLegs === 0) {
    throw new ProviderError({ kind: 'upstream', reason: 'no-return-legs', retryable: false, providerId: 'searchapi', message: `searchapi: ${expand.length} outbound expansions produced no return legs (${failed} failed)` });
  }
  const fetchedAt = fetched.reduce((a, b) => (b < a ? b : a));
  d.log.debug({ offers: offers.length, failedExpansions: failed, notes: notes.list() }, 'searchapi itinerary chain parsed');
  return { offers, coverage: 'priced', fetchedAt, pointOfSale: r1.pointOfSale, partial: partial || failed > 0, failedExpansions: failed, notes: notes.list(), routeHistory };
}
```

The `?? ''` on `out.departure_token` is never taken, because `usable1` holds only tokened options. It satisfies the type without a non-null assertion. The adapter sets `ProviderError.reason` only to `no-return-legs` and `no-priced-options`, the two reasons spec §5.4 names. Every other cause is a tag in the message, which goes to `last_error`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/itinerary.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi itinerary chain with spec §5.4 outcome rules and route history"
```

### Task 5.7: Step 3 booking options and the price-source rule

**Files:** create `test/searchapi/booking.test.ts`. The code is Task 5.6's `bookingOffers` and step-3 block; this task pins their behaviour.

**Interfaces:** consumes `searchItinerary`. Produces nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/booking.test.ts
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { searchItinerary } from '../../src/searchapi/itinerary.js';
import { SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { ctx, testPorts } from './support/ports.js';
import { CELL_QUERY, IN_1, IN_2, IN_3, OUT_A, POST, bookingBody, flightsBody, option, syntheticHandler } from './support/synthetic.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const deps = () => {
  const p = testPorts();
  return { http: p.http, log: p.log, key: p.key, pointOfSale: 'GB', allowlist: SEARCHAPI_PARAMS };
};
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
    expect(res.offers.filter((o) => o.seller === 'Synthetic Air One').map((o) => o.amountMinor).sort((a, b) => a - b)).toEqual([60000, 65000, 70000]);
  });

  it('a step-3 option naming the airline replaces the step-2 airline offer (price-source rule) (synthetic)', async () => {
    run(flightsBody([option(IN_1, 603, { booking_token: 'b1' })]), {
      b1: { status: 200, body: bookingBody([{ book_with: 'Synthetic Air One', price: 603, booking_request: POST }, { book_with: 'Synthetic Travel Agent', price: 573, booking_request: POST }]) },
    });
    const res = await searchItinerary(deps(), q, ctx());
    expect(res.offers.map((o) => [o.seller, o.amountMinor, o.booking.kind])).toEqual([['Synthetic Air One', 60300, 'post'], ['Synthetic Travel Agent', 57300, 'post']]);
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
    expect(res.offers.map((o) => o.seller)).toEqual(['Synthetic Air One']);
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

Temporarily replace Task 5.6's step-3 `try` block with `offers.push(step2Offer); continue;`, then run `pnpm --filter @gmt/providers exec vitest run test/searchapi/booking.test.ts`.
Expected: FAIL on the step-3 assertions (6 of 8).

- [ ] **Step 3: Implement.** Restore the step-3 block from Task 5.6.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/booking.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: SearchApi step-3 booking options and the price-source rule (spec §5.4)"
```

### Task 5.8: Provider assembly, supplied fields from recordings, estimate, healthcheck, barrel

**Files:** create `src/searchapi/provider.ts`, `test/searchapi/support/provider.ts` and `test/searchapi/provider.test.ts`. Modify `src/index.ts`.

**Interfaces:** consumes everything above, plus `findBannedWords`, `BANNED_WORD_ALLOWLIST` and `SuppliedField`. Produces `searchApiProvider` (plan contract signature), `SEARCHAPI_DISPLAY_NAME`, `SEARCHAPI_DISCOVERY_INFO`, `SEARCHAPI_VERIFICATION_INFO`, and the barrel exports.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/provider.test.ts
import { BANNED_WORD_ALLOWLIST, type SuppliedField, asIata, asIsoDate, findBannedWords } from '@gmt/core';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as pkg from '../../src/index.js';
import { SEARCHAPI_DISCOVERY_INFO, SEARCHAPI_DISPLAY_NAME, SEARCHAPI_VERIFICATION_INFO } from '../../src/searchapi/provider.js';
import { bookingResponseSchema, flightsResponseSchema } from '../../src/searchapi/shapes.js';
import { ctx, testPorts } from './support/ports.js';
import { capabilities, makeProvider } from './support/provider.js';
import { type SearchApiRecording, byEngine, searchApiRecordings } from './support/recorded.js';
import { CELL_QUERY, syntheticHandler } from './support/synthetic.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** The SuppliedFields the recorded responses evidence (spec §5.2: checked against recorded fixtures only). */
function evidence(rs: readonly SearchApiRecording[]): SuppliedField[] {
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

  it('declares discovery scraped-aggregate ≤24 h and verification scraped-search 0 h (spec §2 table)', () => {
    const { discovery, verification } = capabilities(p);
    expect(discovery.info).toEqual(SEARCHAPI_DISCOVERY_INFO);
    expect(discovery.info).toMatchObject({ sourceKind: 'scraped-aggregate', maxAgeHours: 24 });
    expect(verification.info).toMatchObject({ sourceKind: 'scraped-search', maxAgeHours: 0 });
    expect(discovery.info.provenanceNote).toContain('Google date grid via SearchApi'); // spec §11 rev 10 vocabulary
    expect(verification.info.provenanceNote).toContain('Google Flights via SearchApi');
  });

  it('display name and provenance notes carry no banned word (spec §11)', () => {
    for (const text of [SEARCHAPI_DISPLAY_NAME, SEARCHAPI_DISCOVERY_INFO.provenanceNote, SEARCHAPI_VERIFICATION_INFO.provenanceNote]) expect(findBannedWords(text, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });

  it('supports all four cabins (the engine handles cabins a provider lacks)', () => {
    expect(p.cabins).toEqual(['economy', 'premium_economy', 'business', 'first']);
  });

  it('suppliedFields equals what the recorded fixtures evidence, and nothing more', () => {
    expect([...p.suppliedFields].sort()).toEqual(evidence(searchApiRecordings()));
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
    const q = { origin: asIata('LHR'), destination: asIata('JFK'), departureFrom: asIsoDate('2026-10-21'), departureTo: asIsoDate('2027-04-20'), minNights: 10, maxNights: 21, cabin: 'economy' as const, currency: 'GBP' as const };
    expect(capabilities(p).discovery.plan(q)).toHaveLength(23);
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

  it('refuses a point of sale that is not an upper-case ISO alpha-2 code', () => {
    expect(() => makeProvider(testPorts(), { pointOfSale: 'gb' })).toThrow(/POINT_OF_SALE/);
  });

  it('exports the plan contract names from the package barrel', () => {
    expect(typeof pkg.searchApiProvider).toBe('function');
    expect(typeof pkg.searchApiHttpLimits).toBe('function');
    expect(pkg.SEARCHAPI_PARAMS.provider).toBe('searchapi');
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
import type { ParamsAllowlist } from '../params/allowlist.js';
import { type CalendarDeps, fetchCalendarTile, planRectangles } from './calendar.js';
import { type ItineraryDeps, estimateItinerary, searchItinerary } from './itinerary.js';

/** The label user-facing strings use for this provider's itinerary source (spec §11). */
export const SEARCHAPI_DISPLAY_NAME = 'Google Flights via SearchApi';

/** Spec §2 table, calendar row; spec §11 rev 10 names this source "Google date grid via SearchApi". */
export const SEARCHAPI_DISCOVERY_INFO: CapabilityInfo = {
  sourceKind: 'scraped-aggregate',
  maxAgeHours: 24,
  provenanceNote: 'Google date grid via SearchApi: date-grid prices that SearchApi scrapes from Google Flights. SearchApi may answer a repeat from its own cache, whose window is undocumented; 24 hours is the declared upper bound.',
};

/** Spec §2 table, itinerary row: scraping-derived search run at request time. */
export const SEARCHAPI_VERIFICATION_INFO: CapabilityInfo = {
  sourceKind: 'scraped-search',
  maxAgeHours: 0,
  provenanceNote: "Google Flights via SearchApi: itinerary search run at request time, scraped from Google Flights by SearchApi, with seller prices from Google's booking options.",
};

/** Exactly the fields the recorded fixtures evidence (spec §5.2); a test re-derives this list from the recordings. */
export const SEARCHAPI_SUPPLIED_FIELDS: readonly SuppliedField[] = ['segments', 'segmentTimes', 'segmentCabins', 'seller', 'price', 'baggage'];
/** All four cabins map to a vendor `travel_class` (spec §5.4). */
export const SEARCHAPI_CABINS: readonly Cabin[] = ['economy', 'premium_economy', 'business', 'first'];

/**
 * The SearchApi `FlightProvider` (spec §5.1, §5.2, §5.4), with the plan's constructor signature.
 * Discovery is `google_flights_calendar` rectangles; verification is the three-step
 * `google_flights` chain. Everything goes through http-kit; the adapter never retries.
 * why: `clock` is part of the shared constructor shape; `fetchedAt` comes from http-kit.
 */
export function searchApiProvider(o: { http: HttpKit; log: Logger; clock: Clock; key: Secret; plan: PlanId; pointOfSale: string; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist }): FlightProvider {
  if (!/^[A-Z]{2}$/.test(o.pointOfSale)) throw new TypeError(`POINT_OF_SALE must be an upper-case ISO 3166-1 alpha-2 code; got ${o.pointOfSale}`);
  const log = o.log.child({ providerId: 'searchapi' });
  const calendar: CalendarDeps = { http: o.http, log, key: o.key, pointOfSale: o.pointOfSale, allowlist: o.paramsAllowlist, cacheTtlSeconds: o.cacheTtlSeconds };
  const itinerary: ItineraryDeps = { http: o.http, log, key: o.key, pointOfSale: o.pointOfSale, allowlist: o.paramsAllowlist };
  return {
    id: 'searchapi',
    displayName: SEARCHAPI_DISPLAY_NAME,
    suppliedFields: SEARCHAPI_SUPPLIED_FIELDS,
    cabins: SEARCHAPI_CABINS,
    discovery: { info: SEARCHAPI_DISCOVERY_INFO, plan: planRectangles, fetchTile: (plan, q, ctx) => fetchCalendarTile(calendar, plan, q, ctx) },
    verification: { info: SEARCHAPI_VERIFICATION_INFO, estimate: (q) => estimateItinerary(q, o.plan), search: (q, ctx) => searchItinerary(itinerary, q, ctx) },
    // why: a probe would spend a call against the plan's cap (and the one-off trial balance), so health reports configuration only.
    healthcheck: async () => ({ ok: true, detail: `key configured, plan ${o.plan}; no request sent because every SearchApi call counts against the plan` }),
  };
}
```

```ts
// test/searchapi/support/provider.ts
import type { FlightProvider } from '@gmt/core';
import { SEARCHAPI_PARAMS } from '../../../src/searchapi/params.js';
import { searchApiProvider } from '../../../src/searchapi/provider.js';
import type { TestPorts } from './ports.js';

type Options = Parameters<typeof searchApiProvider>[0];

export function makeProvider(p: TestPorts, overrides: Partial<Options> = {}): FlightProvider {
  return searchApiProvider({ http: p.http, log: p.log, clock: p.clock, key: p.key, plan: '40usd', pointOfSale: 'GB', cacheTtlSeconds: 3600, paramsAllowlist: SEARCHAPI_PARAMS, ...overrides });
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
export { SEARCHAPI_DISCOVERY_INFO, SEARCHAPI_DISPLAY_NAME, SEARCHAPI_VERIFICATION_INFO, searchApiProvider } from './searchapi/provider.js';
export { classifySearchApiError, searchApiHttpLimits } from './searchapi/errors.js';
export { SEARCHAPI_HOST, SEARCHAPI_PARAMS } from './searchapi/params.js';
export { MAX_COMBINATIONS, OUTBOUND_BLOCK_DAYS, planRectangles } from './searchapi/calendar.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi && pnpm --filter @gmt/providers typecheck`
Expected: PASS for every file under `test/searchapi/`, and typecheck is clean. If the evidence test reports a field the recordings do not show (for example `baggage`), remove it from `SEARCHAPI_SUPPLIED_FIELDS`. Never edit the evidence function to match.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: searchApiProvider assembly, supplied fields from recordings, estimate and healthcheck"
```

### Task 5.9: Sentinel key and egress for this adapter

**Files:** create `test/searchapi/sentinel.test.ts`.

**Interfaces:** consumes `makeProvider`, `testPorts`, `replayHandlers`, `captureRequests`. Produces nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// test/searchapi/sentinel.test.ts
import { asIata, asIsoDate, toEpochDay } from '@gmt/core';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replayHandlers } from '../../src/testing/index.js';
import { SENTINEL_KEY, captureRequests, ctx, testPorts } from './support/ports.js';
import { capabilities, makeProvider } from './support/provider.js';
import { RECORDED_ROOT, byEngine, chainRecording, need, searchApiRecordings } from './support/recorded.js';
import { CELL_QUERY, syntheticHandler } from './support/synthetic.js';

const recorded = searchApiRecordings();
const server = setupServer(...replayHandlers(RECORDED_ROOT));
const sent = captureRequests(server);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

describe('the SearchApi key reaches no sink but the Authorization header (spec §5.3 sentinel test, §2 fact 8)', () => {
  it('calendar, chain and an error path leave no trace of the key outside the header', async () => {
    const ports = testPorts();
    const p = makeProvider(ports);
    const { discovery, verification } = capabilities(p);
    const sinks: string[] = [];
    const day = (s: string) => toEpochDay(asIsoDate(s));

    const cal = byEngine(recorded, 'google_flights_calendar').find((r) => r.status === 200);
    if (cal === undefined) throw new Error('calendar recording');
    const cp = cal.params;
    const q = { origin: asIata(need(cp, 'departure_id')), destination: asIata(need(cp, 'arrival_id')), departureFrom: asIsoDate(need(cp, 'outbound_date_start')), departureTo: asIsoDate(need(cp, 'outbound_date_end')), minNights: day(need(cp, 'return_date_start')) - day(need(cp, 'outbound_date_start')), maxNights: day(need(cp, 'return_date_end')) - day(need(cp, 'outbound_date_end')), cabin: 'economy' as const, currency: 'GBP' as const };
    for (const plan of discovery.plan(q)) sinks.push(JSON.stringify(await discovery.fetchTile(plan, q, ctx())));

    const { step1, step2s } = chainRecording(recorded);
    const s = step1.params;
    sinks.push(JSON.stringify(await verification.search({ ...CELL_QUERY, origin: asIata(need(s, 'departure_id')), destination: asIata(need(s, 'arrival_id')), departureDate: asIsoDate(need(s, 'outbound_date')), returnDate: asIsoDate(need(s, 'return_date')), expandTop: step2s.length }, ctx())));

    const r401 = recorded.find((r) => r.status === 401);
    server.use(syntheticHandler(() => ({ status: 401, body: r401?.body ?? { error: 'Invalid API key.' } }), []));
    try {
      await verification.search(CELL_QUERY, ctx());
    } catch (err) {
      sinks.push(String(err), JSON.stringify(err), err instanceof Error ? (err.stack ?? '') : '');
    }
    server.resetHandlers();

    sinks.push(...ports.logLines, JSON.stringify(p), ...sent.map((r) => r.url));
    for (const text of sinks) expect(text).not.toContain(SENTINEL_KEY);
    expect(sent.length).toBeGreaterThan(2);
    for (const r of sent) {
      expect(r.authorization).toBe(`Bearer ${SENTINEL_KEY}`);
      expect(new URL(r.url).searchParams.has('api_key')).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

The behaviour exists by design, so prove the test bites. Temporarily make `toUrl` also set `api_key` from a module-level copy of the key, and add `api_key` to `SEARCHAPI_PARAMS` names. Then run `pnpm --filter @gmt/providers exec vitest run test/searchapi/sentinel.test.ts`.
Expected: FAIL, with a captured URL containing the sentinel. Revert both changes.

- [ ] **Step 3: Implement.** No production change; the revert is the implementation.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/searchapi/sentinel.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp05: sentinel-key test for the SearchApi adapter's calendar, chain and error paths"
```

### Task 5.10: Wire SearchApi into `apps/api`

**Files:** modify `apps/api/src/wiring.ts`. Create `apps/api/test/wiring.searchapi.test.ts`.

**Interfaces:** consumes `httpLimitsFor`, `providersFor`, `loadConfigFromEnv` (WP4b), and `searchApiProvider`, `searchApiHttpLimits`, `SEARCHAPI_PARAMS`. Produces SearchApi in `Ports.providers` and in http-kit limits whenever `SEARCHAPI_KEY` is set.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/wiring.searchapi.test.ts
import type { AirportsRepo } from '@gmt/db';
import { type HttpKit, classifySearchApiError } from '@gmt/providers';
import { fixedClock, asIsoDateTime, type Logger } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { httpLimitsFor, loadConfigFromEnv, providersFor } from '../src/wiring.js';

const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };
const withKey = { ...base, SEARCHAPI_KEY: 'test-searchapi-key-0123456789abcdef', SEARCHAPI_PLAN: '40usd' };
const log: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => log };
// why: providersFor only constructs adapters; nothing here sends a request.
const http: HttpKit = { request: async () => { throw new Error('no network in this test'); }, stats: () => ({ inFlight: 0 }) };
const airports = { metroOf: () => null } as unknown as AirportsRepo;
const deps = { http, log, clock: fixedClock(asIsoDateTime('2026-10-14T12:00:00.000Z')), airports };

describe('wiring: SearchApi (plan "Wiring and bootstraps")', () => {
  it('adds searchapi http limits when SEARCHAPI_KEY is set', () => {
    const l = httpLimitsFor(loadConfigFromEnv(withKey)).searchapi;
    expect(l).toMatchObject({ hosts: ['www.searchapi.io'], billable: 'http-200', ratePerMinute: 10, ratePerHour: 2000, concurrency: 2 });
    expect(l?.classifyError).toBe(classifySearchApiError);
  });

  it('constructs the searchapi provider when SEARCHAPI_KEY is set, and not otherwise', () => {
    expect(providersFor(loadConfigFromEnv(withKey), deps).map((p) => p.id)).toContain('searchapi');
    expect(providersFor(loadConfigFromEnv(base), deps).map((p) => p.id)).not.toContain('searchapi');
    expect(httpLimitsFor(loadConfigFromEnv(base)).searchapi).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring.searchapi.test.ts`
Expected: FAIL. `httpLimitsFor(...).searchapi` is undefined and no provider has id `searchapi`.

- [ ] **Step 3: Implement**

In `apps/api/src/wiring.ts`, add the imports and one entry in each function. Follow the shape WP4b used for `fixture` and `fx`: a local `limits` object in `httpLimitsFor` and a `providers` array in `providersFor`. If WP4b named them differently, keep its names.

```ts
import { SEARCHAPI_PARAMS, searchApiHttpLimits, searchApiProvider } from '@gmt/providers';

// inside httpLimitsFor(config), beside the fixture and fx entries:
if (config.providers.searchapi !== null) limits.searchapi = searchApiHttpLimits(config.providers.searchapi.limits, config);

// inside providersFor(config, deps), beside the fixture provider:
// why: SEARCHAPI_CACHE_TTL_HOURS (spec §12) is the local window for calendar tiles; itinerary steps are never cached.
if (config.providers.searchapi !== null) {
  const s = config.providers.searchapi;
  providers.push(searchApiProvider({ http: deps.http, log: deps.log, clock: deps.clock, key: s.key, plan: s.plan, pointOfSale: config.pointOfSale, cacheTtlSeconds: s.limits.cacheTtlHours * 3600, paramsAllowlist: SEARCHAPI_PARAMS }));
}
```

`searchApiHttpLimits(…, config)` takes a `Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>`, and the whole config satisfies it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring.searchapi.test.ts && node scripts/check-boundaries.mjs`
Expected: PASS, 2 tests. The boundary script exits 0 (`apps/api` may import `@gmt/providers`, and the test imports `@gmt/db` only as a type).

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp05: wire SearchApi into httpLimitsFor and providersFor"
```

## 9. Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP5. The adapter-local edge inputs most likely to bite first are pinned here:

- A wide nights band would push 8 outbound days over 200 combinations (Task 5.1, "shrinks the outbound block").
- An over-limit calendar request, which the docs say returns "empty" and the spike recorded as 400 (Task 5.5, "asserts ≤200 combinations before reserve").
- A step-1 response whose options are all unpriced (Task 5.6; spec §5.4 `no-priced-options`).
- A split booking at step 3 (Task 5.7).
- A missing currency echo (Task 5.5 synthetic test, plus the Task 5.2 inventory assertion over every recording).

## 10. Definition of done

- `pnpm --filter @gmt/providers test` passes with `providers`' thresholds of 85% lines and 70% branches (and 85% functions and statements).
- `pnpm --filter @gmt/api test` passes with its thresholds.
- `pnpm lint` is clean, with no `any` and no non-null assertion.
- `pnpm -r typecheck` is clean.
- `node scripts/check-boundaries.mjs` exits 0. Production `src/` never imports `src/testing/`.
- `pnpm secret-scan` prints `secret scan: clean`.
- `grep -rn "api_key" packages/providers/src/searchapi` prints nothing.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/providers/src` prints nothing.
- `git status --porcelain packages/providers/fixtures` prints nothing.
- Every task's checkbox is ticked.

## 11. Open questions

None block dispatch. These items are reported for Fable; the spec wins where it speaks.

- **O1, `SEARCHAPI_PARAMS` values that depend on WP4b's file.** The constant must deep-equal WP4b's `params-<date>.json`, including `recordedAt` and `contentSha256`. Those two values do not exist until WP4b records. Task 5.3 shows stand-ins and a command that prints the real ones. The `'any'` placements in §6 "Inputs from WP4b" item 3 must match WP4b's file.
- **O2, vendor docs gaps.** The vendor docs do not show `search_parameters`, `other_flights`, or the key holding step-2 return options. The spec §5.2 currency and point-of-sale rule rests on WP4b's recordings (Task 5.2 asserts it).
- **O3, a path-keyed allowlist cannot tell the two engines apart.** The pinned `ParamsAllowlist` is keyed by endpoint path, and both SearchApi engines use `/api/v1/search`. So `assertRequestAllowed` accepts the union of both engines' names; a calendar request carrying `departure_token` would pass it. The per-engine guard is the request builders, whose exact name sets Task 5.3 tests. If the plan wants the allowlist itself to enforce this, `endpoints` would need an engine-qualified key, which is a WP4 contract change.
