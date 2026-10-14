---
wp: 6
title: Travelpayouts adapter
owner: sonnet
depends_on: [1, 2, 4, 4b]
spec_sections: ["§2", "§5.1", "§5.2", "§6.9", "§9 item 2"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, provenance-auditor, cost-and-budget-reviewer]
status: draft
---

# WP6: Travelpayouts adapter

Reconciled with spec revision 10 and the plan's rewritten "Cross-package contracts" (2026-10-14).

## 1. Goal

Build `travelpayoutsProvider(...)`, a discovery-only `FlightProvider` that turns cached Aviasales round-trip prices from `/aviasales/v3/prices_for_dates` into raw, cell-keyed calendar prices.

- There is one month tile per (origin, destination) pair and departure month.
- The request uses the origin's metro code when the airports table has one.
- Sibling pairs that share a metro are deduplicated by the response cache.
- Nothing is defaulted and nothing is invented.

## 2. Scope

**In**

- `packages/providers/src/travelpayouts/`:
  - month tiling per pair (`plan`);
  - the metro-or-airport `origin` parameter;
  - row attribution by response dates, filtered to the pair;
  - pagination inside `fetchTile`;
  - envelope and currency checks;
  - the vendor-link prefix and check;
  - `TRAVELPAYOUTS_PARAMS` (a code constant asserted equal to the recorded allowlist file);
  - `travelpayoutsHttpLimits` (vendor ceiling 600/min, no `classifyError`, so WP4's default table applies);
  - identity fields and a healthcheck that sends no request.
- One line each in `apps/api/src/wiring.ts` `httpLimitsFor` and `providersFor`, which is a Modify (plan, "Wiring and bootstraps").
- Tests:
  - replay of WP4b's recorded fixtures with the `@gmt/providers/testing` helpers through msw and the real http-kit;
  - synthetic-shape tests for cases that were not recorded;
  - a wiring test in `apps/api`.
- Barrel exports from `packages/providers/src/index.ts`.

**Out** (owner in brackets)

- `ParamsAllowlist`, `loadParamsAllowlist`, `assertRequestAllowed` (`src/params/allowlist.ts`) [WP4].
- http-kit pipeline [WP4]: retries, `Retry-After`, limiter, egress allowlist, cache keys, scrubbing, the recorder, and the default status table. Also `@gmt/providers/testing` (`loadRecorded`, `replayHandlers`).
- Recording the fixtures and writing `params-<date>.json` [WP4b].
- `buildPorts`, and `httpLimitsFor`/`providersFor` other than the Travelpayouts lines [WP4b, WP8].
- Engine rules [WP7]:
  - the `cabin-not-offered` rule: a provider whose `cabins` excludes the definition's cabin is never called;
  - FX conversion and the `fx.converted` flag, normalisation, and `min_pence` per tile;
  - stamping provenance from `pointOfSale` and `sourceKind`;
  - cell outcome writes, and writing the vendor message to `last_error`;
  - parity measurement.
- Core helpers [WP2]: `validateVendorUrl`, `LINK_ALLOWLIST`, `searchLinkFor` (the Aviasales search link shown when `booking` is `none`, spec §6.9), and `MINOR_EXPONENT`.
- `generateCells`, `monthOf`, `toEpochDay` [WP1]. `cellKeyString` [WP0].
- `AirportsRepo.metroOf` and the attributed metro list [WP3].
- The coverage-check route [WP7 `coverageCheck`, WP8 route].

## 3. Spec sections

- **§2 Travelpayouts row.** The endpoint is `/aviasales/v3/prices_for_dates`, with month tiles (`departure_at=YYYY-MM`, `one_way=false`, no `return_at`), paginated at 1000.
  - It is authorised and cached from the last 48 h. It has no `found_at`, ignores `market`, and is economy only.
  - It is free at 600/min. `sourceKind` is `authorised-cached` and `maxAgeHours` is 48.
- **§2 fact 1.** `origin_airport` is on every row. `currency=gbp` is honoured. `market` and `trip_class` are ignored. There is no `found_at`.
- **§2 consequences.** Adapters return raw vendor shapes, and currency is read from the response. Rows for airports outside the pair are dropped.
- **§5.1 (rev 10).**
  - `TileRequest` has `{ kind: 'month'; month }`.
  - `DiscoveryTileResult` `'tile'` carries `pointOfSale`.
  - `BudgetGuard.reserve` and `recordCacheHit` carry `tileIndex`.
- **§5.2 (rev 10).**
  - Tiles partition the cells.
  - The query is per pair. `origin` is the pair origin's metro code when the airports table maps it to one, else the airport.
  - Rows are attributed by `origin_airport` and filtered to the pair and the nights band.
  - Identical metro requests from sibling pairs are answered by the response cache. The worked example gives 28 tiles, 14 upstream calls and 14 cache hits.
  - Pages are fetched inside one `fetchTile`, each ledgered under the tile's index.
  - Cell keys come from the response, and out-of-band entries are dropped and counted.
  - Empty is per capability: a valid empty envelope gives `no_data`; a malformed envelope or `success:false` gives `parse`.
  - `plan(q).length` is the estimate.
  - `suppliedFields` come from recorded fixtures.
  - `currency=gbp` only and `pointOfSale: 'unknown'`.
  - The adapter declares `cabins: ['economy']`, and the engine handles every other cabin.
  - The dated allowlist covers names and values.
  - Errors follow the table, with the vendor message in `last_error`, never in `reason`.
  - Vendor links must match the `aviasales.com` allowlist.
- **§6.9.** The Aviasales deep link is the search-link source for Travelpayouts rows, supplied here as `vendorLink`.
- **§9 item 2.** Tiles partition cells. `plan().length` matches the ledger (upstream plus cache hits). Response-date keying is tested. The empty envelope gives `no_data`. Currency comes from the response. `suppliedFields` come from recorded fixtures. Parameter names and values match the dated allowlist.

### Mismatches still open after revision 10 (spec wins; reported, not papered over)

1. **Rate limit stated twice.** Spec §2 gives 600/min (the vendor ceiling), while spec §12 and `TRAVELPAYOUTS_DEFAULTS` give 200/min. `travelpayoutsHttpLimits` keeps the configured value and clamps it to 600.
2. **The FX assertion is not WP6's.** §9 item 2 says "a non-GBP response asserts conversion and the FX flag", but conversion is WP7 normalisation (§5.6). Here only pass-through is asserted: the vendor's lower-case code (`gbp`) is upper-cased to ISO 4217 and amounts are unchanged.
3. **Empty envelope without currency.** Spec §2 says a response that states no currency is `parse`. The first failing test's body `{"success": true, "data": []}` has no currency. This brief requires currency only when at least one row is to be denominated.
4. *(Resolved by plan item 14.)* `ParamsAllowlist`, `loadParamsAllowlist` and `assertRequestAllowed` live in WP4's `src/params/allowlist.ts`. This brief imports them and defines no allowlist code of its own.
5. *(Resolved by plan item 14.)* `endpoints` is keyed by endpoint path, with `names` ascending, and `TRAVELPAYOUTS_PARAMS` follows that.
6. **`TRAVELPAYOUTS_PARAMS` copies two values from the recording.** `recordedAt` and `contentSha256` exist only once WP4b has recorded. Task 6.6 Step 3 prints them from the file, and the implementer writes them into the constant. That is the one place this brief cannot show the final literal.
7. *(Resolved by plan item 14.)* `canonicalCacheKey` covers method, credential-free URL, scrubbed headers and body only, never execution or tile ids. Task 6.4's 14 cache hits test that contract.
8. **`replayHandlers` cannot be used here.** It matches on the credential-free query, and the recorded 401 (invalid token) shares its query with the recorded 200 for the same tile. The replay tests use `loadRecorded` from `@gmt/providers/testing` with their own per-tile handlers.
9. **The testing subpath is imported by relative path.** Inside `@gmt/providers` the subpath is imported as `../../src/testing/index.js`, because the package `exports` point at `dist/`. It is the same module.
10. **Wiring structure is unknown.** WP4b's exact code shape for `httpLimitsFor`/`providersFor` is not in the plan. Task 6.9 adds one spread entry to each, in the object or array they return.

## 4. Interfaces consumed

Spec §5.1 (revision 10), the parts this package uses, verbatim:

```ts
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
  | { kind: 'month'; month: IsoMonth }                                   // Travelpayouts month tiles
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };
export interface RawCalendarPrice extends CellKey {
  amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string;
}
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[] }
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };
export interface ProviderContext { executionId: string | null; signal: AbortSignal; recordFixtures: boolean }
export interface DiscoveryCapability { info: CapabilityInfo; plan(q: DiscoveryQuery): TilePlan[]; fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> }
export interface FlightProvider {
  readonly id: ProviderId; readonly displayName: string;
  readonly suppliedFields: readonly SuppliedField[]; readonly cabins: readonly Cabin[];
  readonly discovery?: DiscoveryCapability; readonly verification?: VerificationCapability;
  healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }>;
}
export interface Reservation { id: string; finalise(r: { outcome: 'ok' | 'error' | 'unknown'; httpStatus?: number; durationMs: number }): void }
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }
export class ProviderError extends Error { kind: 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout'; reason?: string; retryable: boolean; httpStatus?: number; retryAfterSeconds?: number }
export class BudgetExceeded extends Error { scope: 'execution-calls' | 'execution-free-calls' | 'execution-cost' | 'provider-month' | 'provider-lifetime' | 'global-month' }
export class AbortedError extends Error {}
// Plan, provider port: DiscoveryQuery stays per (origin, destination) pair. Travelpayouts queries by the origin's metro code when the airports table maps it to one (rows filtered to the pair by origin_airport); identical metro requests from other pairs are answered by the response cache inside the TTL, so a definition whose origins share a metro costs D × M upstream calls.
// Plan, provider port: A provider whose `cabins` excludes the definition's cabin is not called at all: the engine marks every cell for that provider and stage no_data with reason 'cabin-not-offered' (spec rev 10).
```

Plan, "Cross-package contracts", verbatim:

```ts
// types/ids.ts (WP0)
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$ after upper-casing
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata, string>;  // trims, upper-cases, then requires ^[A-Z]{3}$ (so 'lhr' → 'LHR'; 'LHRX' rejected)
export const isoDateSchema: z.ZodType<IsoDate, string>;    // regex + real calendar date check (rejects 2027-02-29)
export function asIata(s: string): Iata;           // throws on mismatch; tests and seeds only
export function asIsoDate(s: string): IsoDate;
export function asIsoMonth(s: string): IsoMonth;
export function asIsoDateTime(s: string): IsoDateTime;
export function cellKeyString(c: CellKey): string;        // `${origin}|${destination}|${departureDate}|${returnDate}` — lives here (WP0) so WP1, WP2, WP3 all share it

// types/provenance.ts (WP0)
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';   // defined here; ports/provider.ts re-exports it
export type PointOfSale = string | 'unknown';   // ISO 3166-1 alpha-2 upper-case (POINT_OF_SALE echoes), or 'unknown'; pointOfSaleSchema = z.string().regex(/^[A-Z]{2}$/).or(z.literal('unknown'))

// types/itinerary.ts (WP0)
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };

// ports/budget.ts (WP0)
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }

// ports/logger.ts, ports/clock.ts (WP0)
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };

// errors.ts (WP0): The outcome `reason` column holds the kind or normalisation reason only; the vendor message (URL-stripped) goes to `lastError`.

// config (WP0, Task 0.5): Secret { reveal(): string; toString(): '[redacted]' }; ProviderLimits { …; ratePerMinute; ratePerHour; concurrency; cacheTtlHours; … };
// TRAVELPAYOUTS_DEFAULTS: cap 50000/mo, 200/min, 10000/h, concurrency 4, TTL 6h, cost 0, fixed 0;
// Config.providers.travelpayouts: { token: Secret; limits: ProviderLimits } | null; Config.maxWaitSeconds; Config.requestTimeoutSeconds; parseConfig(env, { realpath }): ConfigResult.
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;

// Database (WP3)
export class AirportsRepo { … metroOf(iata): string | null; … }

// http-kit (@gmt/providers http/httpKit.ts, WP4)
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never'; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; classifyError?: (status: number, body: unknown, ledgerAtCap: boolean) => ProviderError }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<ProviderId | 'fx', ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[]; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
export interface HttpKitRequest { providerId: ProviderId | 'fx'; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body?: string; cache: { ttlSeconds: number } | 'never'; signal: AbortSignal; recordFixtures: boolean }
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
export interface RecordedFixture { recordedAt: IsoDateTime; recordedBy: string; providerId: string; endpointPath: string; request: { method: string; url: string /* credential-free, query kept */; headers: Record<string, string> /* scrubbed */; body: string | null }; status: number; body: unknown; placeholders: Record<string, string>; contentSha256: string }
// '@gmt/providers/testing' subpath export (src/testing/index.ts): fixtureHandlers(root): RequestHandler[]; replayHandlers(recordedRoot): RequestHandler[] (serves fixtures/recorded by matching method, path and credential-free query, reversing placeholders); loadRecorded(root, providerId, endpointPath): RecordedFixture[]. msw is a dependency of the package (not dev) because this subpath imports it; production code never imports the subpath (boundary script asserts).

// Adapter constructors and exports (WP6 implements these exactly)
export function travelpayoutsProvider(o: { http: HttpKit; log: Logger; clock: Clock; token: Secret; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist; airports: { metroOf(iata: Iata): string | null } }): FlightProvider;
export function travelpayoutsHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;   // hosts ['api.travelpayouts.com'], billable 'never'; no classifyError (default table maps 401 → auth)
export const TRAVELPAYOUTS_PARAMS: ParamsAllowlist;
export interface ParamsAllowlist { provider: ProviderId; recordedAt: IsoDate; endpoints: Record<string /* endpoint path */, { names: string[] /* ascending */; values: Record<string, string[] | 'any'> }>; contentSha256: string }   // src/params/allowlist.ts (WP4): the type, loadParamsAllowlist(path), assertRequestAllowed(allowlist, endpointPath, url)

// Core domain functions (WP1, WP2)
export function toEpochDay(d: IsoDate): number; export function monthOf(d: IsoDate): IsoMonth;
export function generateCells(space: ResolvedSpace): Cell[];
export const MINOR_EXPONENT: Record<string, number>;
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export function validateVendorUrl(url: string, allowlist: string[]): Booking;

// Wiring (apps/api src/wiring.ts, WP4b)
export function httpLimitsFor(config: Config): HttpKitDeps['limits'];   // WP4b writes it with fixture + fx; WP5 and WP6 each add their provider's line (a Modify in their briefs)
export function providersFor(config: Config, deps: { http: HttpKit; log: Logger; clock: Clock; airports: AirportsRepo }): FlightProvider[];   // same ownership rule
```

Plan decision 6: "The recorded-fixture file format and hash field (`contentSha256`) are pinned above; parameter allowlists carry the same hash; the runtime allowlist is a code constant asserted equal to the recorded file." Decision 8: per-task test runs use `pnpm --filter @gmt/<pkg> exec vitest run <file>`.

## 5. Interfaces produced

All exported from `@gmt/providers` (barrel) unless marked internal.

```ts
// travelpayouts/params.ts
export const TRAVELPAYOUTS_HOST: 'api.travelpayouts.com';
export const PRICES_FOR_DATES_PATH: '/aviasales/v3/prices_for_dates';
export const FIXED_PARAMS: { readonly one_way: 'false'; readonly currency: 'gbp'; readonly limit: '1000' };   // internal
export const FORBIDDEN_PARAM_NAMES: readonly ['token', 'market', 'trip_class', 'return_at'];             // internal
export const TRAVELPAYOUTS_PARAMS: ParamsAllowlist;   // ParamsAllowlist imported from ../params/allowlist.js (WP4)

// travelpayouts/limits.ts
export const TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE: 600;
export function travelpayoutsHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;

// travelpayouts/provider.ts
export const TRAVELPAYOUTS_INFO: CapabilityInfo;                       // { sourceKind: 'authorised-cached', maxAgeHours: 48, provenanceNote }
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[];  // ['price']
export const TRAVELPAYOUTS_CABINS: readonly Cabin[];                   // ['economy']
export const TRAVELPAYOUTS_POINT_OF_SALE: 'unknown';
export interface TravelpayoutsProviderOptions { http: HttpKit; log: Logger; clock: Clock; token: Secret; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist; airports: MetroLookup }
export function travelpayoutsProvider(o: TravelpayoutsProviderOptions): FlightProvider;   // id 'travelpayouts', displayName 'Aviasales cache'
export const PAGE_LIMIT: 1000; export const MAX_PAGES: 50;                                 // internal
export function buildRequestUrl(tp: TileParams, page: number): URL;                        // internal

// travelpayouts/tiles.ts (internal except MetroLookup)
export interface MetroLookup { metroOf(iata: Iata): string | null }
export interface TileParams { readonly origin: string; readonly pairOrigin: Iata; readonly destination: Iata; readonly month: IsoMonth }
export function originParam(origin: Iata, airports: MetroLookup): string;
export function cellsOf(q: DiscoveryQuery): CellKey[];
export function planMonthTiles(q: DiscoveryQuery): TilePlan[];
export function tileParams(plan: TilePlan, q: DiscoveryQuery, airports: MetroLookup): TileParams;

// travelpayouts/response.ts (internal)
export type Envelope = { ok: true; data: readonly unknown[]; currency: string | null } | { ok: false; reason: 'malformed-envelope' | 'vendor-error'; detail: string | null };
export type DropReason = 'malformed-row' | 'one-way' | 'other-origin' | 'other-destination' | 'out-of-band' | 'outside-tile' | 'unpriced' | 'bad-price';
export const DROP_REASONS: readonly DropReason[];
export const AVIASALES_BASE: 'https://www.aviasales.com';
export function readEnvelope(body: unknown): Envelope;
export function resolveCurrency(raw: string | null): { ok: true; code: string; exponent: number } | { ok: false; reason: 'currency-missing' | 'currency-malformed' | 'currency-exponent-unknown'; detail: string | null };
export function majorToMinor(price: number, exponent: number): number | null;
export function vendorLinkFor(link: string): string | null;
export function attributeRows(rows: readonly unknown[], input: AttributionInput): Attribution;
export function attributionNotes(a: Attribution, rowsReceived: number, pages: number): string[];
export function suppliedFieldsOfRow(row: unknown): SuppliedField[];
```

**`ProviderError.reason` vocabulary** (spec rev 10: machine reasons only; vendor text goes in the message, which the engine writes to `last_error`):

- `malformed-envelope`
- `vendor-error`
- `currency-missing`
- `currency-malformed`
- `currency-exponent-unknown`
- `currency-changed-between-pages`
- `unexpected-status`

**Notes vocabulary** (`DiscoveryTileResult.notes`):

- `rows-received:<n>`
- `pages:<n>`
- `dropped:<DropReason>:<n>` (non-zero only, in `DROP_REASONS` order)
- `link-rejected:<n>`
- `pages-truncated:50`

**Semantics WP7 relies on.**

- Covered cells with no price in a `tile` result are `no_data`.
- `noFares` is always `[]`, because a cache never proves that no fares exist.
- Several prices may share a cell, and the engine keeps the minimum (spec §5.6).
- `providerObservedAt` is never set.
- `currency` is the envelope's code upper-cased.
- `fetchedAt` is the oldest page's (a cache hit's is the original `storedAt`).
- `pointOfSale` is `'unknown'` on every tile.

## 6. Library notes

Verified on 2026-10-14.

- **Travelpayouts Data API, `/aviasales/v3/prices_for_dates`.** `support.travelpayouts.com` (linked from `docs/providers.md`) answered HTTP 403 to every automated fetch. The endpoint was verified from Travelpayouts' own published Postman collection "Travelpayouts Data API" (postman.com/travelpayouts, collection `16826686-bfa85f3b-c07c-42f6-8ac3-2021f453b4fc`, read as JSON).
  - **Parameters:** `origin` ("IATA code of a city or an airport"), `destination`, `departure_at` ("2006-01 or 2006-01-02 format"), `return_at`, `unique`, `sorting`, `direct`, `currency` (default `rub`), `market`, `limit` ("Allowed value from 1 to 1000"), `page`, `one_way`. **`trip_class` is not a parameter of this endpoint.**
  - **Token:** passed "in the X-Access-Token header or in the token parameter". The adapter uses the header only.
  - **Envelope:** `{ "currency": "rub", "data": [...], "success": true }`.
  - **Row fields:** `airline`, `departure_at` (local with offset, `2021-09-14T08:55:00+03:00`), `destination`, `destination_airport`, `duration`, `flight_number`, `link` (relative path), `origin`, `origin_airport`, `price` (integer, major unit, in the sample), `return_transfers`, `transfers`.
  - **Not verifiable from the docs:**
    - `return_at` on rows (the sample is one-way).
    - Error bodies (null in the collection); the 401 plain-text body comes from spike fact 5.
    - The public host `api.travelpayouts.com` (the collection's base URL is internal).
    - The 600/min limit (taken from `docs/providers.md`).

    Task 6.8 asserts `return_at` and the host on WP4b's recordings.
- **msw 3.0.3.** Verified with context7 `/websites/mswjs_io` and `https://mswjs.io/docs/migrations/2.x-to-3.x`.
  - Imports: `http` and `HttpResponse` from `msw/http`; `setupServer` from `msw/node`.
  - `server.listen({ onUnhandledFrame: 'error' })` is the 3.x rename of `onUnhandledRequest`.
  - Also used: `server.use`, `server.resetHandlers`, `server.close`, `HttpResponse.json(body, init?)`, `HttpResponse.text(body, init?)`, `request.url`, `request.headers.get`.
  - msw is a runtime dependency of `@gmt/providers` (plan: the testing subpath imports it).
- **vitest 5.0.4.** Verified with context7 `/vitest-dev/vitest/v5.0.3` (closest indexed).
  - Used: `describe`, `it`, `it.each`, `expect` (`toEqual`, `toMatchObject`, `toHaveLength`, `toContain`, `toThrow`, `rejects.toBeInstanceOf`, `not.toHaveProperty`), `beforeAll`, `afterEach`, `afterAll`, and a per-test timeout as the third argument.
  - Single files run with `pnpm --filter @gmt/<pkg> exec vitest run <file>` (plan decision 8).

There is no new dependency, and `zod` is not added to `@gmt/providers`. Envelope checks are hand-written guards, and dates and IATA codes reuse core's `isoDateSchema` and `iataSchema`.

## 7. Files

Create:

- `packages/providers/src/travelpayouts/params.ts`
- `packages/providers/src/travelpayouts/tiles.ts`
- `packages/providers/src/travelpayouts/response.ts`
- `packages/providers/src/travelpayouts/limits.ts`
- `packages/providers/src/travelpayouts/provider.ts`
- `packages/providers/test/travelpayouts/harness.ts`
- `packages/providers/test/travelpayouts/recorded.ts`
- `packages/providers/test/travelpayouts/empty.test.ts`
- `packages/providers/test/travelpayouts/response.test.ts`
- `packages/providers/test/travelpayouts/tiles.test.ts`
- `packages/providers/test/travelpayouts/fetchTile.test.ts`
- `packages/providers/test/travelpayouts/errors.test.ts`
- `packages/providers/test/travelpayouts/params.test.ts`
- `packages/providers/test/travelpayouts/provider.test.ts`
- `packages/providers/test/travelpayouts/replay.test.ts`
- `apps/api/test/wiring.travelpayouts.test.ts`

Modify:

- `packages/providers/src/index.ts` (barrel, Task 6.7)
- `apps/api/src/wiring.ts` (`httpLimitsFor`, `providersFor`, Task 6.9)

Read (produced by WP4b):

- `packages/providers/fixtures/recorded/travelpayouts/params-<yyyy-mm-dd>.json`
- the recorded `prices_for_dates` exchanges under `packages/providers/fixtures/recorded/travelpayouts/`

## 8. Tasks

### Task 6.1: Empty envelope → `no_data` (first failing test)

**Files:**

- Create `src/travelpayouts/params.ts` (constants), `tiles.ts`, `response.ts` (first cut) and `provider.ts` (first cut).
- Create `test/travelpayouts/harness.ts` and `test/travelpayouts/empty.test.ts`.

**Interfaces:**

- Consumes `createHttpKit`, `generateCells`, `monthOf`, and the §5.1 types.
- Produces `planMonthTiles`, `tileParams`, `cellsOf`, `originParam` (first cut), `readEnvelope` (first cut), `buildRequestUrl` and `travelpayoutsProvider` (first cut).

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/harness.ts` (final; later tasks import from it):

```ts
/**
 * Test harness for the Travelpayouts adapter (WP6). It builds the REAL http-kit (WP4) over
 * in-memory fakes of the BudgetGuard and ResponseCache ports, so every test runs the production
 * pipeline (cache → dedup → retry → limiter → reserve → fetch) while msw intercepts global fetch.
 */
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  BudgetExceeded,
  type BudgetGuard,
  type CellKey,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type FlightProvider,
  fixedClock,
  generateCells,
  type Iata,
  type IsoDateTime,
  type Logger,
  type ProviderContext,
  type ResponseCache,
  Secret,
} from '@gmt/core';
import { setupServer } from 'msw/node';
import type { ParamsAllowlist } from '../../src/params/allowlist.js';
import { createHttpKit, type HttpKit, type HttpKitRequest, type ProviderHttpLimits } from '../../src/http/httpKit.js';
import type { MetroLookup } from '../../src/travelpayouts/tiles.js';
import { type TravelpayoutsProviderOptions, travelpayoutsProvider } from '../../src/travelpayouts/provider.js';

/** Sentinel credential (briefs README: secrets in tests are sentinels). */
export const TOKEN = 'test-travelpayouts-token-0123456789abcdef';
export const ENDPOINT = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
export const NOW = '2026-10-14T15:00:00.000Z';

/** One msw server, shared by every Travelpayouts test file; each file calls listen/resetHandlers/close. */
export const server = setupServer();

export const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
};

export interface Ledger {
  reservations: Array<{ endpointPath: string; executionId: string | null; tileIndex: number | null }>;
  cacheHits: Array<{ endpointPath: string; tileIndex: number | null }>;
}

/** BudgetGuard fake: records reservations and cache hits with their tileIndex; `refuse` throws like a 0 cap. */
export function fakeBudget(o: { refuse?: boolean } = {}): BudgetGuard & { ledger: Ledger } {
  const ledger: Ledger = { reservations: [], cacheHits: [] };
  return {
    ledger,
    reserve(p) {
      if (o.refuse === true) {
        throw new BudgetExceeded({ scope: 'execution-free-calls', cap: 0, current: 0, requested: 1, providerId: 'travelpayouts' });
      }
      ledger.reservations.push({ endpointPath: p.endpointPath, executionId: p.executionId, tileIndex: p.tileIndex });
      return { id: `r${ledger.reservations.length}`, finalise: () => {} };
    },
    recordCacheHit(p) {
      ledger.cacheHits.push({ endpointPath: p.endpointPath, tileIndex: p.tileIndex });
    },
    usage: () => ({ calls: ledger.reservations.length, costMicroGbp: 0, cap: null, windowStart: null, windowEnd: null }),
  };
}

export function memoryCache(): ResponseCache {
  const m = new Map<string, { body: unknown; storedAt: IsoDateTime }>();
  return {
    get: (k) => m.get(k),
    set: (k, body, _ttlSeconds, storedAt) => {
      m.set(k, { body, storedAt });
    },
  };
}

function defaultLimits(): ProviderHttpLimits {
  return {
    hosts: ['api.travelpayouts.com'],
    ratePerMinute: 600,
    ratePerHour: 36_000,
    concurrency: 4,
    billable: 'never',
    costPerCallMicroGbp: 0,
    maxWaitSeconds: 5,
    requestTimeoutSeconds: 5,
  };
}

export interface Harness {
  http: HttpKit;
  requests: HttpKitRequest[];
  budget: ReturnType<typeof fakeBudget>;
  clock: ReturnType<typeof fixedClock>;
}

/** The real http-kit, spied so tests can read every request the adapter made (tileIndex included). */
export function makeHarness(o: { limits?: ProviderHttpLimits; refuse?: boolean } = {}): Harness {
  const budget = fakeBudget({ refuse: o.refuse ?? false });
  const clock = fixedClock(asIsoDateTime(NOW));
  const kit = createHttpKit({
    budget,
    cache: memoryCache(),
    clock,
    log: silentLog,
    secrets: [new Secret(TOKEN)],
    limits: { travelpayouts: o.limits ?? defaultLimits() },
  });
  const requests: HttpKitRequest[] = [];
  // why: a spy around the real kit records each request without replacing the pipeline under test.
  const http: HttpKit = {
    request: (r) => {
      requests.push(r);
      return kit.request(r);
    },
    stats: () => kit.stats(),
  };
  return { http, requests, budget, clock };
}

/** Synthetic stand-in for AirportsRepo.metroOf over the worked example only (London → New York). */
export const airports: MetroLookup = {
  metroOf: (iata) => (iata === 'LHR' || iata === 'LGW' ? 'LON' : iata === 'JFK' || iata === 'EWR' ? 'NYC' : null),
};
export const noMetro: MetroLookup = { metroOf: () => null };

/** Synthetic allowlist in the plan's ParamsAllowlist shape (not the recorded one; Task 6.6 tests that). */
export const ALLOWLIST: ParamsAllowlist = {
  provider: 'travelpayouts',
  recordedAt: asIsoDate('2026-10-14'),
  endpoints: {
    '/aviasales/v3/prices_for_dates': {
      names: ['currency', 'departure_at', 'destination', 'limit', 'one_way', 'origin', 'page'],
      values: { currency: ['gbp'], departure_at: 'any', destination: 'any', limit: ['1000'], one_way: ['false'], origin: 'any', page: 'any' },
    },
  },
  contentSha256: 'synthetic',
};

export function makeProvider(h: Harness, over: Partial<TravelpayoutsProviderOptions> = {}): FlightProvider {
  return travelpayoutsProvider({
    http: h.http,
    log: silentLog,
    clock: h.clock,
    token: new Secret(TOKEN),
    cacheTtlSeconds: 6 * 3600,
    paramsAllowlist: ALLOWLIST,
    airports,
    ...over,
  });
}

export function discoveryOf(p: FlightProvider): DiscoveryCapability {
  if (p.discovery === undefined) throw new Error(`${p.id} has no discovery capability`);
  return p.discovery;
}

export function only<T>(xs: readonly T[]): T {
  const [x, ...rest] = xs;
  if (x === undefined || rest.length > 0) throw new Error(`expected exactly one item, got ${xs.length}`);
  return x;
}

export function ctx(): ProviderContext {
  return { executionId: 'exec-1', signal: new AbortController().signal, recordFixtures: false };
}

/** LHR → JFK, 10–20 March 2027, 10–12 nights: 11 × 3 = 33 cells in one departure month. */
export function query(over: Partial<DiscoveryQuery> = {}): DiscoveryQuery {
  return {
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    departureFrom: asIsoDate('2027-03-10'),
    departureTo: asIsoDate('2027-03-20'),
    minNights: 10,
    maxNights: 12,
    cabin: 'economy',
    currency: 'GBP',
    ...over,
  };
}

export function cellsFor(origin: Iata, destination: Iata, from: string, to: string, minNights: number, maxNights: number): CellKey[] {
  return generateCells({
    origins: [origin],
    destinations: [destination],
    departureFrom: asIsoDate(from),
    departureTo: asIsoDate(to),
    minNights,
    maxNights,
  }).map(({ origin: o, destination: d, departureDate, returnDate }) => ({ origin: o, destination: d, departureDate, returnDate }));
}

export interface RowSpec {
  origin: string;
  dest: string;
  dep: string;
  ret: string | null;
  price: number;
  link?: string;
}

/** Synthetic row in the documented prices_for_dates shape (Library notes); carrier `ZZ` is synthetic. */
export function row(s: RowSpec): Record<string, unknown> {
  return {
    origin: s.origin,
    destination: s.dest,
    origin_airport: s.origin,
    destination_airport: s.dest,
    departure_at: `${s.dep}T08:55:00+00:00`,
    ...(s.ret === null ? {} : { return_at: `${s.ret}T18:10:00-04:00` }),
    price: s.price,
    airline: 'ZZ',
    flight_number: '100',
    transfers: 0,
    return_transfers: 0,
    duration: 900,
    link: s.link ?? '/search/synthetic?t=1',
  };
}
```

`packages/providers/test/travelpayouts/empty.test.ts`:

```ts
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, NOW, only, query, server } from './harness.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('travelpayouts: empty is per capability (spec §5.2, authorised-cached)', () => {
  it('a schema-valid {"success": true, "data": []} marks every covered cell no_data: zero prices, zero noFares', async () => {
    let hits = 0;
    server.use(
      http.get(ENDPOINT, () => {
        hits += 1;
        // synthetic shape: the exact body named as WP6's first failing test
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const tile = only(d.plan(q));
    const r = await d.fetchTile(tile, q, ctx());
    expect(r).toMatchObject({ kind: 'tile', index: 0, pointOfSale: 'unknown', prices: [], noFares: [], fetchedAt: NOW });
    // 11 departure days × 3 nights, all covered and none priced: WP7 records each as no_data.
    expect(r.coveredCells).toHaveLength(33);
    expect(hits).toBe(1);
    expect(h.budget.ledger.reservations).toEqual([{ endpointPath: '/aviasales/v3/prices_for_dates', executionId: 'exec-1', tileIndex: 0 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/empty.test.ts`
Expected: FAIL. The suite cannot load, with an import error naming a missing `src/travelpayouts/*.js` module.

- [ ] **Step 3: Implement**

`packages/providers/src/travelpayouts/params.ts` (first cut; Task 6.6 appends `TRAVELPAYOUTS_PARAMS`):

```ts
/**
 * Travelpayouts request facts. Spec §2 (Travelpayouts row) and §5.2 "Point of sale":
 * `currency=gbp` only, `market` and `trip_class` never sent, all hard-coded.
 */

/** Public Data API host; the only host in this provider's egress allowlist (spec §5.3). */
export const TRAVELPAYOUTS_HOST = 'api.travelpayouts.com';

/** The only endpoint this adapter calls (spec §2); also the ledger endpoint_path and the allowlist key. */
export const PRICES_FOR_DATES_PATH = '/aviasales/v3/prices_for_dates';

/**
 * Fixed parameters (spec §5.2). `market` and `trip_class` are absent on purpose: the spike
 * proved the vendor ignores both (spec §2 fact 1).
 */
export const FIXED_PARAMS = { one_way: 'false', currency: 'gbp', limit: '1000' } as const;

/**
 * Names that must never be sent. `token`: the credential travels in X-Access-Token only (spec §2
 * fact 8). `market`, `trip_class`: ignored by the vendor (fact 1). `return_at`: month tiles send
 * none (spec §5.2).
 */
export const FORBIDDEN_PARAM_NAMES = ['token', 'market', 'trip_class', 'return_at'] as const;
```

`packages/providers/src/travelpayouts/tiles.ts` (first cut; Task 6.3 replaces `originParam`):

```ts
/**
 * Travelpayouts month tiling. Spec §5.2 (rev 10): the query stays per (origin, destination) pair;
 * one `month` tile per departure month on /aviasales/v3/prices_for_dates; tiles partition the
 * pair's cells; plan is pure and deterministic. No airport is named here (spec §1).
 */
import { type CellKey, type DiscoveryQuery, generateCells, type Iata, type IsoMonth, monthOf, type TilePlan } from '@gmt/core';

/** The part of AirportsRepo (WP3) the adapter needs; the plan's constructor `airports` option. */
export interface MetroLookup {
  metroOf(iata: Iata): string | null;
}

/** What one tile sends (`origin` may be a metro code) and which pair its rows are filtered to. */
export interface TileParams {
  readonly origin: string;
  readonly pairOrigin: Iata;
  readonly destination: Iata;
  readonly month: IsoMonth;
}

/** The vendor `origin` parameter. First cut: the airport; Task 6.3 adds the metro code. */
export function originParam(origin: Iata, _airports: MetroLookup): string {
  return origin;
}

/**
 * The cells to tile: `q.cells` when set (spec §5.1 re-plan), else the pair's full space in
 * generation order (spec §6.1). Every cell must belong to the query's pair (plan, provider port).
 */
export function cellsOf(q: DiscoveryQuery): CellKey[] {
  if (q.cells !== undefined) {
    if (q.cells.some((c) => c.origin !== q.origin || c.destination !== q.destination)) {
      throw new Error('a Travelpayouts query is per (origin, destination) pair; every cell must belong to it');
    }
    return q.cells;
  }
  return generateCells({
    origins: [q.origin],
    destinations: [q.destination],
    departureFrom: q.departureFrom,
    departureTo: q.departureTo,
    minNights: q.minNights,
    maxNights: q.maxNights,
  }).map(({ origin, destination, departureDate, returnDate }) => ({ origin, destination, departureDate, returnDate }));
}

/** Spec §5.2: one `month` tile per departure month of the pair; each cell lands in exactly one. */
export function planMonthTiles(q: DiscoveryQuery): TilePlan[] {
  const buckets = new Map<IsoMonth, CellKey[]>();
  for (const cell of cellsOf(q)) {
    const month = monthOf(cell.departureDate);
    const bucket = buckets.get(month);
    if (bucket === undefined) buckets.set(month, [cell]);
    else bucket.push(cell);
  }
  return [...buckets.entries()].map(([month, cells], index): TilePlan => ({ index, coveredCells: cells, request: { kind: 'month', month } }));
}

/** A tile's vendor parameters, from the plan and the pair. Throws on a tile that is not a month tile. */
export function tileParams(plan: TilePlan, q: DiscoveryQuery, airports: MetroLookup): TileParams {
  if (plan.request.kind !== 'month') throw new Error(`travelpayouts tiles are month tiles, got ${plan.request.kind}`);
  return { origin: originParam(q.origin, airports), pairOrigin: q.origin, destination: q.destination, month: plan.request.month };
}
```

`packages/providers/src/travelpayouts/response.ts` (first cut):

```ts
/**
 * Travelpayouts response parsing. Spec §5.2 "Empty is per capability": for authorised-cached, a
 * schema-valid success envelope with zero entries → no_data; malformed or success:false → parse.
 */

/** A checked envelope (rows still unparsed, currency as the vendor wrote it), or a machine reason plus vendor detail. */
export type Envelope =
  | { ok: true; data: readonly unknown[]; currency: string | null }
  | { ok: false; reason: 'malformed-envelope' | 'vendor-error'; detail: string | null };

/** First cut: one failure reason. Task 6.5 adds vendor-error. */
export function readEnvelope(body: unknown): Envelope {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (b.success === true && Array.isArray(b.data) && (b.currency === undefined || typeof b.currency === 'string')) {
      return { ok: true, data: b.data, currency: typeof b.currency === 'string' ? b.currency : null };
    }
  }
  return { ok: false, reason: 'malformed-envelope', detail: null };
}
```

`packages/providers/src/travelpayouts/provider.ts` (first cut; Task 6.4 replaces `fetchTile`, Task 6.7 gives the final file):

```ts
/**
 * Travelpayouts / Aviasales Data API adapter (WP6). Spec §2 (Travelpayouts row, fact 1), §5.1,
 * §5.2. Discovery only: cached round-trip prices from /aviasales/v3/prices_for_dates, one month
 * tile per pair and departure month. Returns raw vendor shapes; the engine normalises (spec §5.6).
 */
import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type Logger,
  type ProviderContext,
  ProviderError,
  type Secret,
  type SuppliedField,
  type TilePlan,
} from '@gmt/core';
import type { ParamsAllowlist } from '../params/allowlist.js';
import type { HttpKit } from '../http/httpKit.js';
import { FIXED_PARAMS, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST } from './params.js';
import { readEnvelope } from './response.js';
import { type MetroLookup, planMonthTiles, type TileParams, tileParams } from './tiles.js';

/** Spec §2 Travelpayouts row: authorised-cached, 48 h. The note avoids every §11 banned word. */
export const TRAVELPAYOUTS_INFO: CapabilityInfo = {
  sourceKind: 'authorised-cached',
  maxAgeHours: 48,
  provenanceNote:
    'Cached round-trip prices that Aviasales users found in the last 48 hours, from the authorised Travelpayouts Data API. Economy only; point of sale unknown; not a fare quote; constraints are not checked.',
};
/** Spec §5.2: from recorded fixtures only (Task 6.8 derives it from them). A row states a price and nothing else checkable. */
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[] = ['price'];
/** Spec §2 fact 1 and §5.2 (rev 10): trip_class is ignored, so economy only; the engine handles other cabins. */
export const TRAVELPAYOUTS_CABINS: readonly Cabin[] = ['economy'];
/** Spec §2: market is ignored, so every tile's point of sale is unknown. */
export const TRAVELPAYOUTS_POINT_OF_SALE = 'unknown' as const;
/** Spec §5.2: limit=1000 per page. */
export const PAGE_LIMIT = 1000;
/** Hard stop on pages per tile; a tile that reaches it says so in notes. */
export const MAX_PAGES = 50;

/** The plan's constructor options, field for field. */
export interface TravelpayoutsProviderOptions {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  token: Secret;
  /** Response cache window: TRAVELPAYOUTS_CACHE_TTL_HOURS × 3600. Inside it, sibling pairs' metro requests are cache hits. */
  cacheTtlSeconds: number;
  paramsAllowlist: ParamsAllowlist;
  airports: MetroLookup;
}

/** The request URL for one page of a tile. The token never appears here (spec §2 fact 8: header only). */
export function buildRequestUrl(tp: TileParams, page: number): URL {
  const url = new URL(`https://${TRAVELPAYOUTS_HOST}${PRICES_FOR_DATES_PATH}`);
  url.searchParams.set('origin', tp.origin);
  url.searchParams.set('destination', tp.destination);
  url.searchParams.set('departure_at', tp.month);
  for (const [name, value] of Object.entries(FIXED_PARAMS)) url.searchParams.set(name, value);
  url.searchParams.set('page', String(page));
  return url;
}

/** Spec §5.1 FlightProvider for Travelpayouts. First cut: one page, no row attribution yet. */
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  async function fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, q, opts.airports);
    const res = await opts.http.request({
      providerId: 'travelpayouts',
      executionId: ctx.executionId,
      tileIndex: plan.index,
      endpointPath: PRICES_FOR_DATES_PATH,
      method: 'GET',
      url: buildRequestUrl(tp, 1),
      headers: { 'X-Access-Token': opts.token.reveal(), Accept: 'application/json' },
      cache: { ttlSeconds: opts.cacheTtlSeconds },
      signal: ctx.signal,
      recordFixtures: ctx.recordFixtures,
    });
    const env = readEnvelope(res.body);
    if (!env.ok) {
      const error = new ProviderError({
        kind: 'parse',
        retryable: false,
        reason: env.reason,
        providerId: 'travelpayouts',
        message: `travelpayouts response unusable: ${env.reason}`,
      });
      return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error };
    }
    return {
      kind: 'tile',
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt: res.fetchedAt,
      pointOfSale: TRAVELPAYOUTS_POINT_OF_SALE,
      prices: [],
      noFares: [],
      notes: [`rows-received:${env.data.length}`, 'pages:1'],
    };
  }

  return {
    id: 'travelpayouts',
    displayName: 'Aviasales cache',
    suppliedFields: TRAVELPAYOUTS_SUPPLIED_FIELDS,
    cabins: TRAVELPAYOUTS_CABINS,
    discovery: { info: TRAVELPAYOUTS_INFO, plan: (q) => planMonthTiles(q), fetchTile },
    healthcheck: async () => ({ ok: true, detail: 'token configured' }),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/empty.test.ts`
Expected: PASS, `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts empty envelope marks covered cells no_data"
```

### Task 6.2: Row attribution by response dates, currency and vendor link

**Files:** replace `src/travelpayouts/response.ts`; create `test/travelpayouts/response.test.ts`.

**Interfaces:**

- Consumes `cellKeyString`, `iataSchema`, `isoDateSchema` (WP0), `toEpochDay` (WP1), and `MINOR_EXPONENT`, `LINK_ALLOWLIST`, `validateVendorUrl` (WP2).
- Produces `attributeRows`, `attributionNotes`, `resolveCurrency`, `majorToMinor`, `vendorLinkFor`, `DROP_REASONS` and `AVIASALES_BASE`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/response.test.ts`:

```ts
import { asIata, type CellKey } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { attributeRows, attributionNotes, majorToMinor, resolveCurrency, vendorLinkFor } from '../../src/travelpayouts/response.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { query, row } from './harness.js';

const covered: CellKey[] = cellsOf(query());
const input = { coveredCells: covered, origin: asIata('LHR'), destination: asIata('JFK'), minNights: 10, maxNights: 12, currency: 'GBP', exponent: 2 };
const LINK = 'https://www.aviasales.com/search/synthetic?t=1';

describe('attributeRows: cell keys from the response, filtered to the pair (spec §5.2)', () => {
  // synthetic shapes, one per drop reason; a metro (LON) response also carries the sibling airport's rows
  const rows: unknown[] = [
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }), // 11 nights: kept
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 398 }), // same cell, another fare: kept (engine keeps the minimum, §5.6)
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-14', ret: '2027-03-24', price: 401, link: 'https://evil.example/x' }), // kept, link refused
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-30', price: 350 }), // 18 nights: out-of-band
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-25', ret: '2027-04-05', price: 380 }), // after the window: outside-tile
    row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 }), // sibling airport of the metro: other-origin
    row({ origin: 'LHR', dest: 'EWR', dep: '2027-03-12', ret: '2027-03-23', price: 300 }), // other-destination
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: null, price: 200 }), // one-way
    { origin_airport: 'LHR' }, // malformed-row
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-15', ret: '2027-03-26', price: 0 }), // unpriced
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-16', ret: '2027-03-27', price: 412.555 }), // bad-price
  ];
  const a = attributeRows(rows, input);

  it('keeps rows whose response dates name a covered cell of the pair, keyed by those dates', () => {
    expect(a.prices).toEqual([
      { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-12', returnDate: '2027-03-23', amountMinor: 41200, currency: 'GBP', vendorLink: LINK },
      { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-12', returnDate: '2027-03-23', amountMinor: 39800, currency: 'GBP', vendorLink: LINK },
      { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-14', returnDate: '2027-03-24', amountMinor: 40100, currency: 'GBP' },
    ]);
  });

  it('drops out-of-band and foreign entries and counts every one in notes', () => {
    expect(a.dropped).toEqual({
      'malformed-row': 1,
      'one-way': 1,
      'other-origin': 1,
      'other-destination': 1,
      'out-of-band': 1,
      'outside-tile': 1,
      unpriced: 1,
      'bad-price': 1,
    });
    expect(a.linksRejected).toBe(1);
    expect(attributionNotes(a, rows.length, 1)).toEqual([
      'rows-received:11',
      'pages:1',
      'dropped:malformed-row:1',
      'dropped:one-way:1',
      'dropped:other-origin:1',
      'dropped:other-destination:1',
      'dropped:out-of-band:1',
      'dropped:outside-tile:1',
      'dropped:unpriced:1',
      'dropped:bad-price:1',
      'link-rejected:1',
    ]);
  });

  it('never sets providerObservedAt: prices_for_dates rows carry no found_at (spec §2 fact 1)', () => {
    expect(a.prices.every((p) => !('providerObservedAt' in p))).toBe(true);
  });

  it("keys by the vendor's local date, never shifted through UTC (spec §6.1)", () => {
    // 23:30 at UTC-5 is the next day in UTC; the cell date is the local one.
    const late = { ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }), departure_at: '2027-03-12T23:30:00-05:00' };
    expect(attributeRows([late], input).prices.map((p) => p.departureDate)).toEqual(['2027-03-12']);
  });
});

describe('majorToMinor (spec §6.3: integer minor units, no float money)', () => {
  it.each([
    [412, 2, 41200],
    [412.5, 2, 41250],
    [0.29, 2, 29],
    [61000, 0, 61000],
    [412.555, 2, null],
    [0, 2, null],
    [-5, 2, null],
    [Number.NaN, 2, null],
  ] as const)('%d at exponent %i → %s', (price, exponent, expected) => {
    expect(majorToMinor(price, exponent)).toBe(expected);
  });
});

describe('resolveCurrency (spec §2: currency read from the response; rev 10: vendor text never in reason)', () => {
  it('upper-cases the vendor code and finds its exponent', () => {
    expect(resolveCurrency('gbp')).toEqual({ ok: true, code: 'GBP', exponent: 2 });
    expect(resolveCurrency('usd')).toEqual({ ok: true, code: 'USD', exponent: 2 });
  });
  it.each([
    [null, 'currency-missing', null],
    ['g1p', 'currency-malformed', 'g1p'],
    ['qqq', 'currency-exponent-unknown', 'QQQ'],
  ] as const)('%s → %s', (raw, reason, detail) => {
    expect(resolveCurrency(raw)).toEqual({ ok: false, reason, detail });
  });
});

describe('vendorLinkFor (spec §5.2 vendor links: LINK_ALLOWLIST.travelpayouts)', () => {
  it('prefixes the relative link with the Aviasales site', () => {
    expect(vendorLinkFor('/search/synthetic?t=1')).toBe(LINK);
  });
  it.each(['https://evil.example/x', '//evil.example/x', 'search/relative', ''])('refuses %j', (link) => {
    expect(vendorLinkFor(link)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/response.test.ts`
Expected: FAIL with `does not provide an export named 'attributeRows'`.

- [ ] **Step 3: Implement**

Replace `packages/providers/src/travelpayouts/response.ts` with:

```ts
/**
 * Travelpayouts response parsing and row attribution. Spec §2 (raw shapes, currency from the
 * response), §5.2 ("Empty is per capability", "Cell keys from the response", rows filtered to the
 * pair, vendor links). Reasons are machine words only; vendor text travels as `detail` and ends up
 * in the error message → last_error (spec rev 10).
 */
import {
  type CellKey,
  cellKeyString,
  type Iata,
  type IsoDate,
  iataSchema,
  isoDateSchema,
  LINK_ALLOWLIST,
  MINOR_EXPONENT,
  type RawCalendarPrice,
  toEpochDay,
  validateVendorUrl,
} from '@gmt/core';

/** A checked envelope (rows still unparsed, currency as the vendor wrote it), or a machine reason plus vendor detail. */
export type Envelope =
  | { ok: true; data: readonly unknown[]; currency: string | null }
  | { ok: false; reason: 'malformed-envelope' | 'vendor-error'; detail: string | null };

/** First cut: one failure reason. Task 6.5 adds vendor-error. */
export function readEnvelope(body: unknown): Envelope {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (b.success === true && Array.isArray(b.data) && (b.currency === undefined || typeof b.currency === 'string')) {
      return { ok: true, data: b.data, currency: typeof b.currency === 'string' ? b.currency : null };
    }
  }
  return { ok: false, reason: 'malformed-envelope', detail: null };
}

/** Why a row was not returned; each is counted in notes (spec §5.2). */
export type DropReason =
  | 'malformed-row'
  | 'one-way'
  | 'other-origin'
  | 'other-destination'
  | 'out-of-band'
  | 'outside-tile'
  | 'unpriced'
  | 'bad-price';
export const DROP_REASONS: readonly DropReason[] = [
  'malformed-row',
  'one-way',
  'other-origin',
  'other-destination',
  'out-of-band',
  'outside-tile',
  'unpriced',
  'bad-price',
];

/** The Aviasales site the vendor's relative `link` is relative to (docs/providers.md). */
export const AVIASALES_BASE = 'https://www.aviasales.com';

/** Spec §2: the envelope's currency, upper-cased to ISO 4217; absent → parse (brief mismatch 3). */
export function resolveCurrency(
  raw: string | null,
):
  | { ok: true; code: string; exponent: number }
  | { ok: false; reason: 'currency-missing' | 'currency-malformed' | 'currency-exponent-unknown'; detail: string | null } {
  if (raw === null) return { ok: false, reason: 'currency-missing', detail: null };
  const code = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return { ok: false, reason: 'currency-malformed', detail: raw.slice(0, 10) };
  const exponent = MINOR_EXPONENT[code];
  if (exponent === undefined) return { ok: false, reason: 'currency-exponent-unknown', detail: code };
  return { ok: true, code, exponent };
}

/**
 * A vendor major-unit price to integer minor units (spec §6.3). Null when the price is not
 * positive or carries more precision than the currency has.
 * why: toFixed + string concatenation avoids float multiplication (0.29 × 100 = 28.999…).
 */
export function majorToMinor(price: number, exponent: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const fixed = price.toFixed(exponent);
  if (Number(fixed) !== price) return null;
  const minor = Number(fixed.replace('.', ''));
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Spec §5.2 vendor links: the relative Aviasales path prefixed with the site, then checked by
 * core's validateVendorUrl against LINK_ALLOWLIST.travelpayouts (WP2). Null when refused.
 * why: only a site-relative path is accepted; an absolute or protocol-relative value is refused, never resolved.
 */
export function vendorLinkFor(link: string): string | null {
  if (!link.startsWith('/') || link.startsWith('//')) return null;
  const booking = validateVendorUrl(`${AVIASALES_BASE}${link}`, LINK_ALLOWLIST.travelpayouts);
  return booking.kind === 'get' ? booking.url : null;
}

export interface AttributionInput {
  coveredCells: readonly CellKey[];
  /** The pair's origin airport; rows from other airports of a metro response are dropped. */
  origin: Iata;
  destination: Iata;
  minNights: number;
  maxNights: number;
  currency: string;
  exponent: number;
}

export interface Attribution {
  prices: RawCalendarPrice[];
  dropped: Record<DropReason, number>;
  linksRejected: number;
}

interface Row {
  origin_airport: string;
  destination_airport: string;
  departure_at: string;
  return_at: string | null;
  price: unknown;
  link: string | null;
}

function readRow(x: unknown): Row | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.origin_airport !== 'string' || typeof r.destination_airport !== 'string' || typeof r.departure_at !== 'string') {
    return null;
  }
  if (r.return_at !== undefined && r.return_at !== null && typeof r.return_at !== 'string') return null;
  if (r.link !== undefined && r.link !== null && typeof r.link !== 'string') return null;
  return {
    origin_airport: r.origin_airport,
    destination_airport: r.destination_airport,
    departure_at: r.departure_at,
    return_at: typeof r.return_at === 'string' ? r.return_at : null,
    price: r.price,
    link: typeof r.link === 'string' ? r.link : null,
  };
}

/**
 * Vendor times are local with an offset (`2021-09-14T08:55:00+03:00`); the first ten characters
 * are the local calendar date, which is the cell's date (spec §6.1: never through UTC).
 */
function localDate(s: string): IsoDate | null {
  const r = isoDateSchema.safeParse(s.slice(0, 10));
  return r.success ? r.data : null;
}

/**
 * Spec §5.2: rows are attributed by origin_airport and destination_airport and their own dates,
 * filtered to the pair, the nights band and the covered cells. Every row that is not returned
 * is counted under exactly one DropReason.
 */
export function attributeRows(rows: readonly unknown[], input: AttributionInput): Attribution {
  const covered = new Set(input.coveredCells.map(cellKeyString));
  const dropped = Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number>;
  const prices: RawCalendarPrice[] = [];
  let linksRejected = 0;
  for (const raw of rows) {
    const row = readRow(raw);
    if (row === null) {
      dropped['malformed-row'] += 1;
      continue;
    }
    if (row.return_at === null) {
      dropped['one-way'] += 1;
      continue;
    }
    const origin = iataSchema.safeParse(row.origin_airport);
    if (!origin.success || origin.data !== input.origin) {
      dropped['other-origin'] += 1;
      continue;
    }
    if (row.destination_airport !== input.destination) {
      dropped['other-destination'] += 1;
      continue;
    }
    const departureDate = localDate(row.departure_at);
    const returnDate = localDate(row.return_at);
    if (departureDate === null || returnDate === null) {
      dropped['malformed-row'] += 1;
      continue;
    }
    const nights = toEpochDay(returnDate) - toEpochDay(departureDate);
    if (nights < input.minNights || nights > input.maxNights) {
      dropped['out-of-band'] += 1;
      continue;
    }
    const cell: CellKey = { origin: origin.data, destination: input.destination, departureDate, returnDate };
    if (!covered.has(cellKeyString(cell))) {
      dropped['outside-tile'] += 1;
      continue;
    }
    if (typeof row.price !== 'number' || !(row.price > 0)) {
      dropped.unpriced += 1;
      continue;
    }
    const amountMinor = majorToMinor(row.price, input.exponent);
    if (amountMinor === null) {
      dropped['bad-price'] += 1;
      continue;
    }
    const price: RawCalendarPrice = { ...cell, amountMinor, currency: input.currency };
    const link = row.link === null ? null : vendorLinkFor(row.link);
    if (link !== null) price.vendorLink = link;
    else if (row.link !== null) linksRejected += 1;
    prices.push(price);
  }
  return { prices, dropped, linksRejected };
}

/** The notes vocabulary of brief §5; non-zero drop counts only, in DROP_REASONS order. */
export function attributionNotes(a: Attribution, rowsReceived: number, pages: number): string[] {
  const notes = [`rows-received:${rowsReceived}`, `pages:${pages}`];
  for (const reason of DROP_REASONS) {
    if (a.dropped[reason] > 0) notes.push(`dropped:${reason}:${a.dropped[reason]}`);
  }
  if (a.linksRejected > 0) notes.push(`link-rejected:${a.linksRejected}`);
  return notes;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/response.test.ts`
Expected: PASS, `21 passed` (4 attribution, 8 majorToMinor, 4 resolveCurrency, 5 vendorLinkFor).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts row attribution by response dates, currency and vendor link"
```

### Task 6.3: Metro origin parameter; month tiles partition the pair's cells

**Files:** modify `src/travelpayouts/tiles.ts` (replace `originParam`); create `test/travelpayouts/tiles.test.ts`.

**Interfaces:** consumes `MetroLookup.metroOf` and `cellKeyString`. Produces the final `originParam`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/tiles.test.ts`:

```ts
import { asIata, asIsoDate, type CellKey, cellKeyString, type DiscoveryQuery, type Iata, type TilePlan } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { cellsOf, planMonthTiles, tileParams } from '../../src/travelpayouts/tiles.js';
import { airports, cellsFor, noMetro, query } from './harness.js';

const [LHR, LGW, JFK, EWR] = [asIata('LHR'), asIata('LGW'), asIata('JFK'), asIata('EWR')];
/** Spec §5.2 worked example, one pair: 182 days (2027-01-01 … 2027-07-01, 7 months), 10–21 nights. */
const worked = (origin: Iata, destination: Iata): DiscoveryQuery =>
  query({ origin, destination, departureFrom: asIsoDate('2027-01-01'), departureTo: asIsoDate('2027-07-01'), minNights: 10, maxNights: 21 });

function expectPartition(cells: readonly CellKey[], plans: readonly TilePlan[]): void {
  const keys = plans.flatMap((p) => p.coveredCells.map(cellKeyString));
  expect(keys).toHaveLength(cells.length);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(keys)).toEqual(new Set(cells.map(cellKeyString)));
  for (const [i, p] of plans.entries()) {
    expect(p.index).toBe(i);
    const months = [...new Set(p.coveredCells.map((c) => c.departureDate.slice(0, 7)))];
    expect(months).toEqual([p.request.kind === 'month' ? p.request.month : 'not a month tile']);
  }
}

describe('planMonthTiles (spec §5.2 rev 10: per pair, one month tile per departure month)', () => {
  it("one tile per departure month: 7 for the worked example's 182-day window", () => {
    const plans = planMonthTiles(worked(LHR, JFK));
    expect(plans.map((p) => p.request)).toEqual(
      ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07'].map((m) => ({ kind: 'month', month: m })),
    );
  });

  it('worked example: 4 pairs × 7 months = 28 logical tiles', () => {
    const pairs = [worked(LHR, JFK), worked(LHR, EWR), worked(LGW, JFK), worked(LGW, EWR)];
    expect(pairs.reduce((n, q) => n + planMonthTiles(q).length, 0)).toBe(28);
  });

  it.each([
    ['the default query', query()],
    ['the worked example pair', worked(LHR, JFK)],
    ['every 7th cell of the worked pair (re-plan subset)', query({ ...worked(LHR, JFK), cells: cellsOf(worked(LHR, JFK)).filter((_, i) => i % 7 === 0) })],
  ] as const)('tiles partition the cells: %s', (_label, q) => {
    expectPartition(cellsOf(q), planMonthTiles(q));
  });

  it('is pure and deterministic', () => {
    expect(planMonthTiles(worked(LHR, JFK))).toEqual(planMonthTiles(worked(LHR, JFK)));
  });

  it('refuses cells from another pair (the query stays per pair)', () => {
    expect(() => planMonthTiles(query({ cells: cellsFor(LGW, JFK, '2027-03-10', '2027-03-10', 10, 10) }))).toThrow(/per \(origin, destination\) pair/);
  });
});

describe('tileParams and the metro origin (spec §5.2 rev 10)', () => {
  const firstOf = (q: DiscoveryQuery): TilePlan => {
    const [first] = planMonthTiles(q);
    if (first === undefined) throw new Error('no tile');
    return first;
  };

  it("sends the pair origin's metro code when the airports table maps it to one", () => {
    expect(tileParams(firstOf(query()), query(), airports)).toEqual({ origin: 'LON', pairOrigin: 'LHR', destination: 'JFK', month: '2027-03' });
  });

  it('sends the airport when there is no metro', () => {
    expect(tileParams(firstOf(query()), query(), noMetro).origin).toBe('LHR');
  });

  it('ignores a metro code that is not three upper-case letters', () => {
    expect(tileParams(firstOf(query()), query(), { metroOf: () => 'LONDON' }).origin).toBe('LHR');
  });

  it('refuses a tile that is not a month tile', () => {
    const rect: TilePlan = {
      index: 0,
      coveredCells: cellsOf(query()),
      request: {
        kind: 'rectangle',
        departFrom: asIsoDate('2027-03-10'),
        departTo: asIsoDate('2027-03-20'),
        returnFrom: asIsoDate('2027-03-20'),
        returnTo: asIsoDate('2027-04-01'),
      },
    };
    expect(() => tileParams(rect, query(), airports)).toThrow(/month tiles/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/tiles.test.ts`
Expected: FAIL. Only `sends the pair origin's metro code` fails, with `expected { origin: 'LHR', … } to deeply equal { origin: 'LON', … }`; the other ten pass with the first cut.

- [ ] **Step 3: Implement**

In `packages/providers/src/travelpayouts/tiles.ts`, replace the first-cut `originParam` with:

```ts
const CODE_RE = /^[A-Z]{3}$/;

/**
 * Spec §5.2 (rev 10): `origin` is the pair origin's metropolitan code when the airports table
 * maps it to one, else the airport. Rows are filtered back to the pair by origin_airport, and a
 * sibling pair's identical request is answered by the response cache inside the TTL.
 * why: a malformed code from the table is treated as no metro rather than sent to the vendor.
 */
export function originParam(origin: Iata, airports: MetroLookup): string {
  const metro = airports.metroOf(origin);
  return metro !== null && CODE_RE.test(metro) ? metro : origin;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/tiles.test.ts test/travelpayouts/empty.test.ts`
Expected: PASS, `11 passed` in `tiles.test.ts` and `1 passed` in `empty.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts metro origin parameter and per-pair month tiles"
```

### Task 6.4: Pagination inside `fetchTile`; cache dedup across sibling pairs

**Files:** modify `src/travelpayouts/provider.ts` (imports and `travelpayoutsProvider` body); create `test/travelpayouts/fetchTile.test.ts`.

**Interfaces:** consumes `attributeRows`, `attributionNotes`, `resolveCurrency` and `HttpKitResponse`. Produces the paginated `fetchTile`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/fetchTile.test.ts`:

```ts
import { asIata, asIsoDate } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PAGES } from '../../src/travelpayouts/provider.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, NOW, only, query, row, server } from './harness.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const covered = cellsOf(query());

/** Synthetic rows cycling over the 33 covered cells, every one inside the band. */
function rowsFor(n: number, offset = 0): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => {
    const c = covered[(i + offset) % covered.length];
    if (c === undefined) throw new Error('no covered cell');
    return row({ origin: c.origin, dest: c.destination, dep: c.departureDate, ret: c.returnDate, price: 300 + ((i + offset) % 50) });
  });
}
const envelope = (data: unknown[], currency = 'gbp') => ({ success: true, data, currency });
const pageOf = (request: Request) => new URL(request.url).searchParams.get('page') ?? '?';

describe('fetchTile pagination (spec §5.2: one tile, every page ledgered under its tile_index)', () => {
  it('fetches page 2 after a full page of 1000 and stops at a short page (synthetic 1000 + 3)', async () => {
    const pages: string[] = [];
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        const page = pageOf(request);
        pages.push(page);
        return HttpResponse.json(envelope(page === '1' ? rowsFor(1000) : rowsFor(3, 1000)));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const tile = only(d.plan(q));
    const r = await d.fetchTile(tile, q, ctx());
    expect(pages).toEqual(['1', '2']);
    expect(h.requests.map((x) => x.tileIndex)).toEqual([tile.index, tile.index]);
    expect(h.budget.ledger.reservations).toEqual([
      { endpointPath: '/aviasales/v3/prices_for_dates', executionId: 'exec-1', tileIndex: tile.index },
      { endpointPath: '/aviasales/v3/prices_for_dates', executionId: 'exec-1', tileIndex: tile.index },
    ]);
    if (r.kind !== 'tile') throw new Error(`expected a tile, got ${r.kind}`);
    expect(r.prices).toHaveLength(1003);
    expect(r.notes).toEqual(['rows-received:1003', 'pages:2']);
  });

  it('a full last page costs one more request that returns zero rows', async () => {
    const pages: string[] = [];
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        const page = pageOf(request);
        pages.push(page);
        return HttpResponse.json(envelope(page === '1' ? rowsFor(1000) : []));
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = await d.fetchTile(only(d.plan(q)), q, ctx());
    expect(pages).toEqual(['1', '2']);
    if (r.kind !== 'tile') throw new Error(`expected a tile, got ${r.kind}`);
    expect(r.prices).toHaveLength(1000);
    expect(r.notes).toEqual(['rows-received:1000', 'pages:2']);
  });

  it(`stops at MAX_PAGES (${MAX_PAGES}) and says so in notes`, async () => {
    let hits = 0;
    server.use(
      http.get(ENDPOINT, () => {
        hits += 1;
        return HttpResponse.json(envelope(rowsFor(1000)));
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = await d.fetchTile(only(d.plan(q)), q, ctx());
    expect(hits).toBe(MAX_PAGES);
    expect(r.kind === 'tile' && r.notes.includes(`pages-truncated:${MAX_PAGES}`)).toBe(true);
  }, 20_000);

  it('stamps fetchedAt with the oldest page (spec §2: oldest call of a multi-call result)', async () => {
    const h = makeHarness();
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        if (pageOf(request) === '1') return HttpResponse.json(envelope(rowsFor(1000)));
        h.clock.advance(60_000);
        return HttpResponse.json(envelope(rowsFor(3)));
      }),
    );
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const r = await d.fetchTile(only(d.plan(q)), q, ctx());
    expect(r.kind === 'tile' && r.fetchedAt).toBe(NOW);
  });
});

describe('estimate parity and cache dedup across sibling pairs (spec §5.2 rev 10)', () => {
  it('worked example: 28 tiles, 14 upstream calls, 14 cache hits, every one ledgered under its tile index', async () => {
    const upstream: string[] = [];
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        const u = new URL(request.url);
        upstream.push(`${u.searchParams.get('origin')}|${u.searchParams.get('destination')}|${u.searchParams.get('departure_at')}`);
        return HttpResponse.json(envelope([]));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    let tiles = 0;
    for (const origin of [asIata('LHR'), asIata('LGW')]) {
      for (const destination of [asIata('JFK'), asIata('EWR')]) {
        const q = query({ origin, destination, departureFrom: asIsoDate('2027-01-01'), departureTo: asIsoDate('2027-07-01'), minNights: 10, maxNights: 21 });
        for (const p of d.plan(q)) {
          tiles += 1;
          expect((await d.fetchTile(p, q, ctx())).kind).toBe('tile');
        }
      }
    }
    expect(tiles).toBe(28);
    expect(h.requests).toHaveLength(28);
    expect(upstream).toHaveLength(14);
    expect(new Set(upstream).size).toBe(14);
    expect(upstream.every((s) => s.startsWith('LON|'))).toBe(true);
    expect(h.budget.ledger.reservations).toHaveLength(14);
    expect(h.budget.ledger.cacheHits).toHaveLength(14);
    expect([...h.budget.ledger.reservations, ...h.budget.ledger.cacheHits].every((x) => x.tileIndex !== null)).toBe(true);
  });
});

describe('fetchTile returns raw vendor shapes (spec §2, §5.2 "Raw only")', () => {
  it('keys prices by the response dates and counts out-of-band and sibling-airport rows in notes', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          envelope([
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-30', price: 350 }),
            row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 }),
          ]),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = await d.fetchTile(only(d.plan(q)), q, ctx());
    if (r.kind !== 'tile') throw new Error(`expected a tile, got ${r.kind}`);
    expect(r.prices).toEqual([
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-12',
        returnDate: '2027-03-23',
        amountMinor: 41200,
        currency: 'GBP',
        vendorLink: 'https://www.aviasales.com/search/synthetic?t=1',
      },
    ]);
    expect(r.noFares).toEqual([]);
    expect(r.pointOfSale).toBe('unknown');
    expect(r.notes).toEqual(['rows-received:3', 'pages:1', 'dropped:other-origin:1', 'dropped:out-of-band:1']);
  });

  it('passes a non-GBP currency through unconverted (upper-cased ISO code); FX is WP7 normalisation', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(envelope([row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 500 })], 'usd')),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = await d.fetchTile(only(d.plan(q)), q, ctx());
    expect(r.kind === 'tile' && r.prices.map((p) => [p.amountMinor, p.currency])).toEqual([[50000, 'USD']]);
  });

  it('rows under an envelope without currency are a parse error (spec §2)', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json({ success: true, data: [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 })] }),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = await d.fetchTile(only(d.plan(q)), q, ctx());
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'currency-missing', retryable: false } });
  });

  it('a currency that changes between pages is a parse error', async () => {
    server.use(
      http.get(ENDPOINT, ({ request }) =>
        HttpResponse.json(pageOf(request) === '1' ? envelope(rowsFor(1000)) : envelope(rowsFor(3), 'eur')),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = await d.fetchTile(only(d.plan(q)), q, ctx());
    expect(r).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'currency-changed-between-pages' } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/fetchTile.test.ts`
Expected: FAIL.

- The pagination tests see one page.
- The attribution tests see `prices: []`.
- The currency tests see `kind: 'tile'`.

The cache-dedup and oldest-`fetchedAt` tests already pass with the first cut, because each makes one request per tile.

- [ ] **Step 3: Implement**

In `packages/providers/src/travelpayouts/provider.ts`, change the imports to:

```ts
import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type IsoDateTime,
  type Logger,
  type ProviderContext,
  ProviderError,
  type Secret,
  type SuppliedField,
  type TilePlan,
} from '@gmt/core';
import type { ParamsAllowlist } from '../params/allowlist.js';
import type { HttpKit, HttpKitResponse } from '../http/httpKit.js';
import { FIXED_PARAMS, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST } from './params.js';
import { attributeRows, attributionNotes, readEnvelope, resolveCurrency } from './response.js';
import { type MetroLookup, planMonthTiles, type TileParams, tileParams } from './tiles.js';
```

and replace the body of `travelpayoutsProvider` with:

```ts
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  const log = opts.log.child({ providerId: 'travelpayouts' });
  let lastError: ProviderError | null = null;

  // why: spec rev 10, `reason` is a machine word; vendor text goes into the message, which the engine writes to last_error.
  const parseError = (reason: string, detail: string | null): ProviderError =>
    new ProviderError({
      kind: 'parse',
      retryable: false,
      reason,
      providerId: 'travelpayouts',
      message: detail === null ? `travelpayouts response unusable: ${reason}` : `travelpayouts response unusable: ${reason}: ${detail}`,
    });

  function tileError(plan: TilePlan, error: ProviderError): DiscoveryTileResult {
    lastError = error;
    log.warn({ tileIndex: plan.index, kind: error.kind, reason: error.reason ?? null }, 'travelpayouts tile failed');
    return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error };
  }

  /**
   * Spec §5.2: one tile, all of its pages (limit=1000, page=1..n until a short page), each sent
   * through http-kit with the tile's index, so the ledger (upstream rows and cache hits) counts tiles.
   */
  async function fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, q, opts.airports);
    const rows: unknown[] = [];
    let currency: string | null = null;
    let fetchedAt: IsoDateTime | undefined;
    let pages = 0;
    let truncated = false;
    for (let page = 1; ; page += 1) {
      const url = buildRequestUrl(tp, page);
      let res: HttpKitResponse;
      try {
        res = await opts.http.request({
          providerId: 'travelpayouts',
          executionId: ctx.executionId,
          tileIndex: plan.index,
          endpointPath: PRICES_FOR_DATES_PATH,
          method: 'GET',
          url,
          headers: { 'X-Access-Token': opts.token.reveal(), Accept: 'application/json' },
          cache: { ttlSeconds: opts.cacheTtlSeconds },
          signal: ctx.signal,
          recordFixtures: ctx.recordFixtures,
        });
      } catch (e) {
        // why: BudgetExceeded and AbortedError belong to the engine (spec §8.1); only classified
        // vendor failures become a tile-error. No adapter-level retry (spec §5.2).
        if (e instanceof ProviderError) return tileError(plan, e);
        throw e;
      }
      pages += 1;
      const env = readEnvelope(res.body);
      if (!env.ok) return tileError(plan, parseError(env.reason, env.detail));
      if (env.currency !== null) {
        if (currency !== null && currency !== env.currency) return tileError(plan, parseError('currency-changed-between-pages', null));
        currency = env.currency;
      }
      // why: spec §2, fetchedAt of a multi-call result is the oldest call; ISO strings order lexically.
      if (fetchedAt === undefined || res.fetchedAt < fetchedAt) fetchedAt = res.fetchedAt;
      rows.push(...env.data);
      if (env.data.length < PAGE_LIMIT) break;
      if (page >= MAX_PAGES) {
        truncated = true;
        break;
      }
    }
    if (fetchedAt === undefined) throw new Error('travelpayouts: no page was fetched');
    lastError = null;
    const base = { kind: 'tile' as const, index: plan.index, coveredCells: plan.coveredCells, fetchedAt, pointOfSale: TRAVELPAYOUTS_POINT_OF_SALE };
    if (rows.length === 0) {
      // Spec §5.2 "Empty is per capability": every covered cell is no_data; no currency needed (brief mismatch 3).
      return { ...base, prices: [], noFares: [], notes: ['rows-received:0', `pages:${pages}`] };
    }
    const cur = resolveCurrency(currency);
    if (!cur.ok) return tileError(plan, parseError(cur.reason, cur.detail));
    const attribution = attributeRows(rows, {
      coveredCells: plan.coveredCells,
      origin: tp.pairOrigin,
      destination: tp.destination,
      minNights: q.minNights,
      maxNights: q.maxNights,
      currency: cur.code,
      exponent: cur.exponent,
    });
    const notes = attributionNotes(attribution, rows.length, pages);
    if (truncated) notes.push(`pages-truncated:${MAX_PAGES}`);
    // why: a cache never proves "no fares", so noFares is always empty (spec §5.2 authorised-cached).
    return { ...base, prices: attribution.prices, noFares: [], notes };
  }

  return {
    id: 'travelpayouts',
    displayName: 'Aviasales cache',
    suppliedFields: TRAVELPAYOUTS_SUPPLIED_FIELDS,
    cabins: TRAVELPAYOUTS_CABINS,
    discovery: { info: TRAVELPAYOUTS_INFO, plan: (q) => planMonthTiles(q), fetchTile },
    healthcheck: async () => ({ ok: lastError === null, detail: lastError === null ? 'token configured' : `last request failed: ${lastError.kind}` }),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS. All four files are green, and `fetchTile.test.ts` has 9 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts pagination inside one tile; sibling-pair cache dedup"
```

### Task 6.5: Error mapping through the real http-kit; HTTP limits

**Files:** create `src/travelpayouts/limits.ts` and `test/travelpayouts/errors.test.ts`; modify `src/travelpayouts/response.ts` (replace `readEnvelope`).

**Interfaces:**

- Consumes `ProviderHttpLimits`, `ProviderLimits`, `Config` (`maxWaitSeconds`, `requestTimeoutSeconds`), `TRAVELPAYOUTS_DEFAULTS`, `AbortedError`, `BudgetExceeded`, and WP4's default status table (through `createHttpKit`).
- Produces `travelpayoutsHttpLimits`, `TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE` and the final `readEnvelope`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/errors.test.ts`:

```ts
import { AbortedError, BudgetExceeded, TRAVELPAYOUTS_DEFAULTS } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { travelpayoutsHttpLimits } from '../../src/travelpayouts/limits.js';
import { ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, only, query, server } from './harness.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const cfg = { maxWaitSeconds: 5, requestTimeoutSeconds: 5 };
const limits = travelpayoutsHttpLimits(TRAVELPAYOUTS_DEFAULTS, cfg);

describe('travelpayoutsHttpLimits (spec §2, §5.3)', () => {
  it('is never billable, costs nothing, allows one host and has no classifyError (WP4 default table)', () => {
    expect(limits).toEqual({
      hosts: ['api.travelpayouts.com'],
      ratePerMinute: 200,
      ratePerHour: 10_000,
      concurrency: 4,
      billable: 'never',
      costPerCallMicroGbp: 0,
      maxWaitSeconds: 5,
      requestTimeoutSeconds: 5,
    });
  });

  it('clamps the per-minute rate to the vendor ceiling of 600 (spec §2)', () => {
    expect(travelpayoutsHttpLimits({ ...TRAVELPAYOUTS_DEFAULTS, ratePerMinute: 900 }, cfg).ratePerMinute).toBe(600);
  });
});

describe('fetchTile error mapping through the real http-kit (spec §5.2 Errors)', () => {
  function run(handler: () => Response, o: { refuse?: boolean } = {}) {
    let hits = 0;
    server.use(
      http.get(ENDPOINT, () => {
        hits += 1;
        return handler();
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness({ limits, refuse: o.refuse ?? false })));
    const q = query();
    return { result: d.fetchTile(only(d.plan(q)), q, ctx()), hits: () => hits };
  }
  async function errorOf(p: Promise<unknown>) {
    const r = (await p) as { kind: string; error?: { kind: string; reason?: string; message: string } };
    if (r.kind !== 'tile-error' || r.error === undefined) throw new Error(`expected a tile-error, got ${r.kind}`);
    return r.error;
  }

  it('401 plain-text Unauthorized (spec §2 fact 5) → tile-error auth, sent once', async () => {
    const { result, hits } = run(() => HttpResponse.text('Unauthorized', { status: 401 }));
    expect(await result).toMatchObject({ kind: 'tile-error', index: 0, error: { kind: 'auth', retryable: false, httpStatus: 401 } });
    expect(hits()).toBe(1);
  });

  it('400 → parse, non-retryable, sent once', async () => {
    const { result, hits } = run(() => HttpResponse.json({ error: 'departure_at is invalid' }, { status: 400 }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', retryable: false, httpStatus: 400 } });
    expect(hits()).toBe(1);
  });

  it('402 → quota, sent once', async () => {
    const { result, hits } = run(() => HttpResponse.text('', { status: 402 }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'quota', retryable: false } });
    expect(hits()).toBe(1);
  });

  it('404 → upstream, not retried', async () => {
    const { result, hits } = run(() => HttpResponse.text('Not Found', { status: 404 }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'upstream', retryable: false } });
    expect(hits()).toBe(1);
  });

  it("500 → upstream after http-kit's three attempts", async () => {
    const { result, hits } = run(() => HttpResponse.text('', { status: 500, headers: { 'Retry-After': '0' } }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'upstream', retryable: true } });
    expect(hits()).toBe(3);
  }, 20_000);

  it("429 → rate-limit after http-kit's three attempts", async () => {
    const { result, hits } = run(() => HttpResponse.text('', { status: 429, headers: { 'Retry-After': '0' } }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'rate-limit', retryable: true } });
    expect(hits()).toBe(3);
  }, 20_000);

  it('429 asking to wait beyond MAX_WAIT_SECONDS → limiter-timeout, sent once (Retry-After honoured, spec §5.3)', async () => {
    const { result, hits } = run(() => HttpResponse.text('', { status: 429, headers: { 'Retry-After': '3600' } }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'limiter-timeout' } });
    expect(hits()).toBe(1);
  });

  it('success:false → parse, reason vendor-error, the vendor text only in the message (spec rev 10)', async () => {
    const { result } = run(() => HttpResponse.json({ success: false, data: null, error: 'invalid destination' }));
    const e = await errorOf(result);
    expect(e).toMatchObject({ kind: 'parse', reason: 'vendor-error' });
    expect(e.message).toContain('invalid destination');
  });

  it('success:false without a message is still vendor-error', async () => {
    const { result } = run(() => HttpResponse.json({ success: false }));
    expect(await errorOf(result)).toMatchObject({ kind: 'parse', reason: 'vendor-error' });
  });

  it.each([
    ['an array', []],
    ['success missing', { data: [] }],
    ['data not an array', { success: true, data: {} }],
    ['currency not a string', { success: true, data: [], currency: 7 }],
  ] as const)('a malformed envelope (%s) → parse', async (_label, body) => {
    const { result } = run(() => HttpResponse.json(body));
    expect(await errorOf(result)).toMatchObject({ kind: 'parse', reason: 'malformed-envelope' });
  });

  it('a non-JSON 200 body → parse', async () => {
    const { result } = run(() => HttpResponse.text('<html>maintenance</html>', { status: 200 }));
    expect(await errorOf(result)).toMatchObject({ kind: 'parse' });
  });

  it('an aborted signal raises AbortedError, never a tile-error', async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json({ success: true, data: [] })));
    const d = discoveryOf(makeProvider(makeHarness({ limits })));
    const q = query();
    const ac = new AbortController();
    ac.abort();
    await expect(d.fetchTile(only(d.plan(q)), q, { ...ctx(), signal: ac.signal })).rejects.toBeInstanceOf(AbortedError);
  });

  it('BudgetExceeded from reserve propagates and no request is sent', async () => {
    const { result, hits } = run(() => HttpResponse.json({ success: true, data: [] }), { refuse: true });
    await expect(result).rejects.toBeInstanceOf(BudgetExceeded);
    expect(hits()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/errors.test.ts`
Expected: FAIL. The suite cannot load, with an import error naming `src/travelpayouts/limits.js`.

- [ ] **Step 3: Implement**

`packages/providers/src/travelpayouts/limits.ts`:

```ts
/**
 * Travelpayouts HTTP limits for http-kit. Spec §2 (free, 600/min), §5.3 (never billable,
 * per-provider host allowlist). Registered by apps/api httpLimitsFor (Task 6.9).
 */
import type { Config, ProviderLimits } from '@gmt/core';
import type { ProviderHttpLimits } from '../http/httpKit.js';
import { TRAVELPAYOUTS_HOST } from './params.js';

/** Vendor per-minute ceiling for prices_for_dates (spec §2; docs/providers.md). */
export const TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE = 600;

/**
 * The configured limits with the rate clamped to the vendor's ceiling; never billable, cost 0.
 * why: no classifyError. WP4's default table maps every Travelpayouts case spec §5.2 lists
 * (401 plain text → auth, 400 → parse, 402 → quota, 404 → upstream, 429 → rate-limit, 5xx →
 * upstream), and a hook would replace that table along with its Retry-After and limiter-timeout
 * handling, because the hook receives no headers (plan: "no classifyError (default table maps 401 → auth)").
 */
export function travelpayoutsHttpLimits(
  limits: ProviderLimits,
  cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>,
): ProviderHttpLimits {
  return {
    hosts: [TRAVELPAYOUTS_HOST],
    ratePerMinute: Math.min(limits.ratePerMinute, TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE),
    ratePerHour: limits.ratePerHour,
    concurrency: limits.concurrency,
    billable: 'never',
    costPerCallMicroGbp: 0,
    maxWaitSeconds: cfg.maxWaitSeconds,
    requestTimeoutSeconds: cfg.requestTimeoutSeconds,
  };
}
```

In `packages/providers/src/travelpayouts/response.ts`, replace `readEnvelope` (and its doc comment) with:

```ts
/**
 * Spec §5.2 "Empty is per capability" (authorised-cached): a schema-valid success envelope is
 * returned as is (zero rows → no_data upstream); `success:false` → `vendor-error` with the
 * vendor's text as detail; anything else → `malformed-envelope`. Both become `parse` in fetchTile.
 */
export function readEnvelope(body: unknown): Envelope {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'malformed-envelope', detail: null };
  const b = body as Record<string, unknown>;
  if (b.success === false) {
    return { ok: false, reason: 'vendor-error', detail: typeof b.error === 'string' && b.error.length > 0 ? b.error.slice(0, 200) : null };
  }
  if (b.success !== true || !Array.isArray(b.data)) return { ok: false, reason: 'malformed-envelope', detail: null };
  if (b.currency !== undefined && typeof b.currency !== 'string') return { ok: false, reason: 'malformed-envelope', detail: null };
  return { ok: true, data: b.data, currency: typeof b.currency === 'string' ? b.currency : null };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS. `errors.test.ts` has 18 passed (2 limits, 16 error-mapping), and the other files stay green.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts error mapping through http-kit and http limits"
```

### Task 6.6: `TRAVELPAYOUTS_PARAMS` equal to the recorded allowlist; enforced on every request

**Files:**

- Modify: append to `src/travelpayouts/params.ts`; insert one call into `src/travelpayouts/provider.ts`.
- Create: `test/travelpayouts/recorded.ts`, `test/travelpayouts/params.test.ts`.

**Interfaces:**

- Consumes `loadRecorded` (`@gmt/providers/testing`), `RecordedFixture`, and `loadParamsAllowlist`, `assertRequestAllowed` (WP4 `src/params/allowlist.ts`).
- Produces `TRAVELPAYOUTS_PARAMS` and the test helpers `paramsFilePath` and `loadPricesForDates`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/recorded.ts`:

```ts
/**
 * Loaders for WP4b's recorded Travelpayouts fixtures, through the package's testing subpath
 * (`@gmt/providers/testing`; imported relatively because the package exports point at dist/,
 * brief mismatch 9). loadRecorded refuses files outside fixtures/recorded/ and files whose
 * contentSha256 no longer matches (spec §5.5).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecordedFixture } from '../../src/index.js';
import { loadRecorded } from '../../src/testing/index.js';
import { PRICES_FOR_DATES_PATH } from '../../src/travelpayouts/params.js';

export const RECORDED_ROOT = fileURLToPath(new URL('../../fixtures/recorded/', import.meta.url));
const TRAVELPAYOUTS_DIR = join(RECORDED_ROOT, 'travelpayouts');

/** Path of the latest dated allowlist file (names sort by date); WP4's loadParamsAllowlist reads it. */
export function paramsFilePath(): string {
  const latest = readdirSync(TRAVELPAYOUTS_DIR)
    .filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .at(-1);
  if (latest === undefined) throw new Error(`no params-<date>.json under ${TRAVELPAYOUTS_DIR} (WP4b writes it)`);
  return join(TRAVELPAYOUTS_DIR, latest);
}

/** Every recorded prices_for_dates exchange with its request URL (credential-free, query kept). */
export function loadPricesForDates(): Array<{ url: URL; fixture: RecordedFixture }> {
  return loadRecorded(RECORDED_ROOT, 'travelpayouts', PRICES_FOR_DATES_PATH).map((fixture) => ({ url: new URL(fixture.request.url), fixture }));
}
```

`packages/providers/test/travelpayouts/params.test.ts`:

```ts
import { asIata, asIsoMonth } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertRequestAllowed, loadParamsAllowlist } from '../../src/params/allowlist.js';
import { FIXED_PARAMS, FORBIDDEN_PARAM_NAMES, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_PARAMS } from '../../src/travelpayouts/params.js';
import { buildRequestUrl } from '../../src/travelpayouts/provider.js';
import { ALLOWLIST, ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, only, query, server, TOKEN } from './harness.js';
import { paramsFilePath } from './recorded.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const tp = { origin: 'LON', pairOrigin: asIata('LHR'), destination: asIata('JFK'), month: asIsoMonth('2027-03') };
const sent = (): URL => buildRequestUrl(tp, 1);

describe('TRAVELPAYOUTS_PARAMS (plan decision 6: a code constant equal to the recorded file)', () => {
  it('equals fixtures/recorded/travelpayouts/params-<date>.json, contentSha256 included', () => {
    expect(TRAVELPAYOUTS_PARAMS).toEqual(loadParamsAllowlist(paramsFilePath()));
  });

  it('carries the hard-coded fixed values and no forbidden name (spec §5.2)', () => {
    const rules = TRAVELPAYOUTS_PARAMS.endpoints[PRICES_FOR_DATES_PATH];
    if (rules === undefined) throw new Error('no prices_for_dates rules');
    for (const [name, value] of Object.entries(FIXED_PARAMS)) expect(rules.values[name]).toEqual([value]);
    for (const name of FORBIDDEN_PARAM_NAMES) expect(rules.names).not.toContain(name);
  });

  it('accepts exactly what the adapter sends', () => {
    expect(() => assertRequestAllowed(TRAVELPAYOUTS_PARAMS, PRICES_FOR_DATES_PATH, sent())).not.toThrow();
  });
});

describe("assertRequestAllowed (WP4) on Travelpayouts requests (spec §5.2: names and values)", () => {
  it.each([
    ['an extra parameter', (u: URL) => u.searchParams.set('sorting', 'price')],
    ['market (ignored by the vendor, spec §2 fact 1)', (u: URL) => u.searchParams.set('market', 'uk')],
    ['trip_class (ignored by the vendor)', (u: URL) => u.searchParams.set('trip_class', '1')],
    ['return_at (month tiles send none)', (u: URL) => u.searchParams.set('return_at', '2027-03')],
    ['a wrong fixed value', (u: URL) => u.searchParams.set('currency', 'usd')],
    ['a missing parameter', (u: URL) => u.searchParams.delete('page')],
    ['a duplicated parameter', (u: URL) => u.searchParams.append('origin', 'LGW')],
  ] as const)('refuses %s', (_label, mutate) => {
    const u = sent();
    mutate(u);
    expect(() => assertRequestAllowed(TRAVELPAYOUTS_PARAMS, PRICES_FOR_DATES_PATH, u)).toThrow();
  });

  it('refuses an endpoint the allowlist does not list', () => {
    expect(() => assertRequestAllowed(ALLOWLIST, '/v1/prices/calendar', sent())).toThrow();
  });

  it('refuses a token parameter without echoing its value', () => {
    const u = sent();
    u.searchParams.set('token', TOKEN);
    let caught: unknown;
    try {
      assertRequestAllowed(ALLOWLIST, PRICES_FOR_DATES_PATH, u);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain(TOKEN);
  });
});

describe('requests on the wire', () => {
  it('carry exactly the allowlisted names and values, the metro origin, and the token only in X-Access-Token', async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        seen.push({ url: request.url, token: request.headers.get('x-access-token') });
        return HttpResponse.json({ success: true, data: [], currency: 'gbp' });
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness(), { paramsAllowlist: TRAVELPAYOUTS_PARAMS }));
    const q = query();
    await d.fetchTile(only(d.plan(q)), q, ctx());
    const req = only(seen);
    const u = new URL(req.url);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      origin: 'LON',
      destination: 'JFK',
      departure_at: '2027-03',
      one_way: 'false',
      currency: 'gbp',
      limit: '1000',
      page: '1',
    });
    expect(req.token).toBe(TOKEN);
    expect(req.url).not.toContain(TOKEN);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/params.test.ts`
Expected: FAIL with `does not provide an export named 'TRAVELPAYOUTS_PARAMS'`. If the error is instead "no params-<date>.json", WP4b has not merged: stop and report, and do not create the file.

- [ ] **Step 3: Implement**

Print the two values that only the recording knows (brief mismatch 6):

```bash
node -e "const f=require('fs');const d='packages/providers/fixtures/recorded/travelpayouts';const n=f.readdirSync(d).filter(x=>/^params-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().at(-1);const j=JSON.parse(f.readFileSync(d+'/'+n,'utf8'));console.log(j.recordedAt, j.contentSha256)"
```

Append to `packages/providers/src/travelpayouts/params.ts`, writing the two printed values into `RECORDED_AT` and `CONTENT_SHA256`:

```ts
import type { IsoDate } from '@gmt/core';
import type { ParamsAllowlist } from '../params/allowlist.js';

// why: these two fields only exist once WP4b has recorded; they are copied verbatim from
// fixtures/recorded/travelpayouts/params-<date>.json, and the equality test fails if either drifts.
const RECORDED_AT = 'RECORDED_AT_PRINTED_ABOVE' as IsoDate;
const CONTENT_SHA256 = 'CONTENT_SHA256_PRINTED_ABOVE';

/**
 * The runtime allowlist (plan decision 6: a code constant asserted equal to the recorded file).
 * Keyed by endpoint path; names in ascending order; 'any' for per-request values (plan item 14).
 */
export const TRAVELPAYOUTS_PARAMS: ParamsAllowlist = {
  provider: 'travelpayouts',
  recordedAt: RECORDED_AT,
  endpoints: {
    [PRICES_FOR_DATES_PATH]: {
      names: ['currency', 'departure_at', 'destination', 'limit', 'one_way', 'origin', 'page'],
      values: {
        currency: [FIXED_PARAMS.currency],
        departure_at: 'any',
        destination: 'any',
        limit: [FIXED_PARAMS.limit],
        one_way: [FIXED_PARAMS.one_way],
        origin: 'any',
        page: 'any',
      },
    },
  },
  contentSha256: CONTENT_SHA256,
};
```

Move the two `import type` lines to the top of the file with the other imports (Biome `organizeImports`).

In `packages/providers/src/travelpayouts/provider.ts`, add `import { assertRequestAllowed } from '../params/allowlist.js';` and insert directly after `const url = buildRequestUrl(tp, page);`:

```ts
      // why: fail closed before anything leaves the process (spec §5.2 allowlist of names and values).
      assertRequestAllowed(opts.paramsAllowlist, PRICES_FOR_DATES_PATH, url);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS. `params.test.ts` has 13 passed (3 constant, 7 table, 1 endpoint, 1 token, 1 wire), and every other file stays green. If the equality test fails on `endpoints` (a different key or name order in WP4b's file), stop and report it (plan item 14 pins path keys and ascending names). Do not reshape the constant to the file.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: TRAVELPAYOUTS_PARAMS equals the recorded allowlist and is enforced before every request"
```

### Task 6.7: Identity, healthcheck, barrel

**Files:** replace `src/travelpayouts/provider.ts` with its final form; modify `src/index.ts`; create `test/travelpayouts/provider.test.ts`.

**Interfaces:** consumes `findBannedWords` and `Secret`. Produces the final `travelpayoutsProvider` and the barrel exports.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/provider.test.ts`:

```ts
import { findBannedWords, Secret } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as barrel from '../../src/index.js';
import { TRAVELPAYOUTS_INFO, TRAVELPAYOUTS_POINT_OF_SALE } from '../../src/travelpayouts/provider.js';
import { ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, only, query, server, TOKEN } from './harness.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('travelpayoutsProvider identity (spec §2, §5.1, §5.2 rev 10)', () => {
  it('is a discovery-only authorised-cached provider that declares economy only', () => {
    const p = makeProvider(makeHarness());
    expect(p.id).toBe('travelpayouts');
    expect(p.displayName).toBe('Aviasales cache');
    expect(p.verification).toBeUndefined();
    expect(p.cabins).toEqual(['economy']);
    expect(p.suppliedFields).toEqual(['price']);
    expect(discoveryOf(p).info).toEqual({ sourceKind: 'authorised-cached', maxAgeHours: 48, provenanceNote: TRAVELPAYOUTS_INFO.provenanceNote });
    expect(TRAVELPAYOUTS_POINT_OF_SALE).toBe('unknown');
  });

  it('provenance note uses no banned word (spec §11)', () => {
    expect(findBannedWords(TRAVELPAYOUTS_INFO.provenanceNote)).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN])('refuses cacheTtlSeconds %d', (ttl) => {
    expect(() => makeProvider(makeHarness(), { cacheTtlSeconds: ttl })).toThrow(/cacheTtlSeconds/);
  });
});

describe('healthcheck (sends no request; reports the last classified failure)', () => {
  it('goes false after a 401 tile and true again after a successful one, never echoing the token', async () => {
    let status = 401;
    server.use(
      http.get(ENDPOINT, () =>
        status === 401 ? HttpResponse.text('Unauthorized', { status: 401 }) : HttpResponse.json({ success: true, data: [], currency: 'gbp' }),
      ),
    );
    const p = makeProvider(makeHarness());
    const d = discoveryOf(p);
    const q = query();
    const tile = only(d.plan(q));
    const before = await p.healthcheck(ctx());
    expect(before.ok).toBe(true);
    expect(before.detail).toContain('no failed request');
    await d.fetchTile(tile, q, ctx());
    const failed = await p.healthcheck(ctx());
    expect(failed).toEqual({ ok: false, detail: 'last request failed: auth (HTTP 401)' });
    status = 200;
    await d.fetchTile(tile, q, ctx());
    expect((await p.healthcheck(ctx())).ok).toBe(true);
    expect(JSON.stringify([before, failed])).not.toContain(TOKEN);
  });

  it('reports an empty token', async () => {
    const p = makeProvider(makeHarness(), { token: new Secret('') });
    expect(await p.healthcheck(ctx())).toEqual({ ok: false, detail: 'TRAVELPAYOUTS_TOKEN is empty' });
  });
});

describe('@gmt/providers barrel', () => {
  it('exports the Travelpayouts surface named in the plan', () => {
    expect(typeof barrel.travelpayoutsProvider).toBe('function');
    expect(typeof barrel.travelpayoutsHttpLimits).toBe('function');
    expect(barrel.TRAVELPAYOUTS_PARAMS.provider).toBe('travelpayouts');
    expect(barrel.TRAVELPAYOUTS_POINT_OF_SALE).toBe('unknown');
    expect(barrel.TRAVELPAYOUTS_HOST).toBe('api.travelpayouts.com');
    expect(barrel.TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE).toBe(600);
    expect(barrel.TRAVELPAYOUTS_INFO.sourceKind).toBe('authorised-cached');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/provider.test.ts`
Expected: FAIL.

- The barrel test fails with `expected 'undefined' to be 'function'`.
- The TTL tests fail with "did not throw".
- The healthcheck tests fail on the detail strings.

- [ ] **Step 3: Implement**

Replace `packages/providers/src/travelpayouts/provider.ts` with the final file:

```ts
/**
 * Travelpayouts / Aviasales Data API adapter (WP6). Spec §2 (Travelpayouts row, fact 1), §5.1,
 * §5.2 (rev 10), §6.9. Discovery only: cached round-trip prices from
 * /aviasales/v3/prices_for_dates, one month tile per (origin, destination) pair and departure
 * month, queried by the origin's metro code when there is one, every page through http-kit.
 * Returns raw vendor shapes; the engine normalises (spec §5.6). No airport is named here (spec §1).
 */
import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type IsoDateTime,
  type Logger,
  type ProviderContext,
  ProviderError,
  type Secret,
  type SuppliedField,
  type TilePlan,
} from '@gmt/core';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import type { HttpKit, HttpKitResponse } from '../http/httpKit.js';
import { FIXED_PARAMS, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST } from './params.js';
import { attributeRows, attributionNotes, readEnvelope, resolveCurrency } from './response.js';
import { type MetroLookup, planMonthTiles, type TileParams, tileParams } from './tiles.js';

/** Spec §2 Travelpayouts row: authorised-cached, 48 h. The note avoids every §11 banned word. */
export const TRAVELPAYOUTS_INFO: CapabilityInfo = {
  sourceKind: 'authorised-cached',
  maxAgeHours: 48,
  provenanceNote:
    'Cached round-trip prices that Aviasales users found in the last 48 hours, from the authorised Travelpayouts Data API. Economy only; point of sale unknown; not a fare quote; constraints are not checked.',
};
/** Spec §5.2: from recorded fixtures only (Task 6.8 derives it from them). A row states a price and nothing else checkable. */
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[] = ['price'];
/** Spec §2 fact 1 and §5.2 (rev 10): trip_class is ignored, so economy only; the engine never calls this provider for another cabin. */
export const TRAVELPAYOUTS_CABINS: readonly Cabin[] = ['economy'];
/** Spec §2: market is ignored, so every tile's point of sale is unknown. */
export const TRAVELPAYOUTS_POINT_OF_SALE = 'unknown' as const;
/** Spec §5.2: limit=1000 per page. */
export const PAGE_LIMIT = 1000;
/** Hard stop on pages per tile; a tile that reaches it says so in notes. */
export const MAX_PAGES = 50;

/** The plan's constructor options, field for field. */
export interface TravelpayoutsProviderOptions {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  token: Secret;
  /** Response cache window: TRAVELPAYOUTS_CACHE_TTL_HOURS × 3600. Inside it, sibling pairs' metro requests are cache hits. */
  cacheTtlSeconds: number;
  paramsAllowlist: ParamsAllowlist;
  airports: MetroLookup;
}

/** The request URL for one page of a tile. The token never appears here (spec §2 fact 8: header only). */
export function buildRequestUrl(tp: TileParams, page: number): URL {
  const url = new URL(`https://${TRAVELPAYOUTS_HOST}${PRICES_FOR_DATES_PATH}`);
  url.searchParams.set('origin', tp.origin);
  url.searchParams.set('destination', tp.destination);
  url.searchParams.set('departure_at', tp.month);
  for (const [name, value] of Object.entries(FIXED_PARAMS)) url.searchParams.set(name, value);
  url.searchParams.set('page', String(page));
  return url;
}

/** Spec §5.1 FlightProvider for Travelpayouts: discovery capability only, no verification. */
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  if (!Number.isSafeInteger(opts.cacheTtlSeconds) || opts.cacheTtlSeconds < 0) {
    throw new Error('travelpayoutsProvider: cacheTtlSeconds must be a non-negative integer');
  }
  const log = opts.log.child({ providerId: 'travelpayouts' });
  // why: the healthcheck sends no request, because a probe needs an airport pair and no airport is
  // named in code (spec §1); it reports the most recent classified failure instead.
  let lastError: ProviderError | null = null;

  // why: spec rev 10, `reason` is a machine word; vendor text goes into the message, which the engine writes to last_error.
  const parseError = (reason: string, detail: string | null): ProviderError =>
    new ProviderError({
      kind: 'parse',
      retryable: false,
      reason,
      providerId: 'travelpayouts',
      message: detail === null ? `travelpayouts response unusable: ${reason}` : `travelpayouts response unusable: ${reason}: ${detail}`,
    });

  function tileError(plan: TilePlan, error: ProviderError): DiscoveryTileResult {
    lastError = error;
    log.warn({ tileIndex: plan.index, kind: error.kind, reason: error.reason ?? null }, 'travelpayouts tile failed');
    return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error };
  }

  /**
   * Spec §5.2: one tile, all of its pages (limit=1000, page=1..n until a short page), each sent
   * through http-kit with the tile's index, so the ledger (upstream rows and cache hits) counts tiles.
   */
  async function fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, q, opts.airports);
    const rows: unknown[] = [];
    let currency: string | null = null;
    let fetchedAt: IsoDateTime | undefined;
    let pages = 0;
    let truncated = false;
    for (let page = 1; ; page += 1) {
      const url = buildRequestUrl(tp, page);
      // why: fail closed before anything leaves the process (spec §5.2 allowlist of names and values).
      assertRequestAllowed(opts.paramsAllowlist, PRICES_FOR_DATES_PATH, url);
      let res: HttpKitResponse;
      try {
        res = await opts.http.request({
          providerId: 'travelpayouts',
          executionId: ctx.executionId,
          tileIndex: plan.index,
          endpointPath: PRICES_FOR_DATES_PATH,
          method: 'GET',
          url,
          headers: { 'X-Access-Token': opts.token.reveal(), Accept: 'application/json' },
          cache: { ttlSeconds: opts.cacheTtlSeconds },
          signal: ctx.signal,
          recordFixtures: ctx.recordFixtures,
        });
      } catch (e) {
        // why: BudgetExceeded and AbortedError belong to the engine (spec §8.1); only classified
        // vendor failures become a tile-error. No adapter-level retry (spec §5.2).
        if (e instanceof ProviderError) return tileError(plan, e);
        throw e;
      }
      pages += 1;
      const env = readEnvelope(res.body);
      if (!env.ok) return tileError(plan, parseError(env.reason, env.detail));
      if (env.currency !== null) {
        if (currency !== null && currency !== env.currency) return tileError(plan, parseError('currency-changed-between-pages', null));
        currency = env.currency;
      }
      // why: spec §2, fetchedAt of a multi-call result is the oldest call; ISO strings order lexically.
      if (fetchedAt === undefined || res.fetchedAt < fetchedAt) fetchedAt = res.fetchedAt;
      rows.push(...env.data);
      if (env.data.length < PAGE_LIMIT) break;
      if (page >= MAX_PAGES) {
        truncated = true;
        break;
      }
    }
    if (fetchedAt === undefined) throw new Error('travelpayouts: no page was fetched');
    lastError = null;
    const base = { kind: 'tile' as const, index: plan.index, coveredCells: plan.coveredCells, fetchedAt, pointOfSale: TRAVELPAYOUTS_POINT_OF_SALE };
    if (rows.length === 0) {
      // Spec §5.2 "Empty is per capability": every covered cell is no_data; no currency needed (brief mismatch 3).
      return { ...base, prices: [], noFares: [], notes: ['rows-received:0', `pages:${pages}`] };
    }
    const cur = resolveCurrency(currency);
    if (!cur.ok) return tileError(plan, parseError(cur.reason, cur.detail));
    const attribution = attributeRows(rows, {
      coveredCells: plan.coveredCells,
      origin: tp.pairOrigin,
      destination: tp.destination,
      minNights: q.minNights,
      maxNights: q.maxNights,
      currency: cur.code,
      exponent: cur.exponent,
    });
    const notes = attributionNotes(attribution, rows.length, pages);
    if (truncated) notes.push(`pages-truncated:${MAX_PAGES}`);
    // why: a cache never proves "no fares", so noFares is always empty (spec §5.2 authorised-cached).
    return { ...base, prices: attribution.prices, noFares: [], notes };
  }

  async function healthcheck(_ctx: ProviderContext): Promise<{ ok: boolean; detail: string }> {
    if (opts.token.reveal().length === 0) return { ok: false, detail: 'TRAVELPAYOUTS_TOKEN is empty' };
    if (lastError !== null) {
      const status = lastError.httpStatus === undefined ? '' : ` (HTTP ${lastError.httpStatus})`;
      return { ok: false, detail: `last request failed: ${lastError.kind}${status}` };
    }
    return { ok: true, detail: 'token configured; no failed request since start; the healthcheck sends no request' };
  }

  return {
    id: 'travelpayouts',
    displayName: 'Aviasales cache',
    suppliedFields: TRAVELPAYOUTS_SUPPLIED_FIELDS,
    cabins: TRAVELPAYOUTS_CABINS,
    discovery: { info: TRAVELPAYOUTS_INFO, plan: (q) => planMonthTiles(q), fetchTile },
    healthcheck,
  };
}
```

Append to `packages/providers/src/index.ts`:

```ts
// Travelpayouts adapter (WP6). Spec §2, §5.2.
export {
  TRAVELPAYOUTS_CABINS,
  TRAVELPAYOUTS_INFO,
  TRAVELPAYOUTS_POINT_OF_SALE,
  TRAVELPAYOUTS_SUPPLIED_FIELDS,
  type TravelpayoutsProviderOptions,
  travelpayoutsProvider,
} from './travelpayouts/provider.js';
export { PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST, TRAVELPAYOUTS_PARAMS } from './travelpayouts/params.js';
export { TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE, travelpayoutsHttpLimits } from './travelpayouts/limits.js';
export type { MetroLookup } from './travelpayouts/tiles.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS. `provider.test.ts` has 8 passed, and every earlier file stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts identity, healthcheck and barrel"
```

### Task 6.8: Recorded fixtures replay; `suppliedFields` from recordings

**Files:** modify `src/travelpayouts/response.ts` (append `suppliedFieldsOfRow`); create `test/travelpayouts/replay.test.ts`.

**Interfaces:** consumes WP4b's recordings through `loadPricesForDates` (built on `loadRecorded`). Produces `suppliedFieldsOfRow`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/replay.test.ts`:

```ts
import { asIata, asIsoDate, cellKeyString, type IsoDate } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import { PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST, TRAVELPAYOUTS_PARAMS } from '../../src/travelpayouts/params.js';
import { TRAVELPAYOUTS_SUPPLIED_FIELDS } from '../../src/travelpayouts/provider.js';
import { suppliedFieldsOfRow } from '../../src/travelpayouts/response.js';
import { ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, noMetro, only, query, server } from './harness.js';
import { loadPricesForDates } from './recorded.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const recorded = loadPricesForDates();
const ok = recorded.filter((x) => x.fixture.status === 200);

/** Recorded 200 pages grouped into tiles by (origin, destination, departure month). */
const tiles = new Map<string, typeof ok>();
for (const x of ok) {
  const key = ['origin', 'destination', 'departure_at'].map((n) => x.url.searchParams.get(n) ?? '?').join('|');
  tiles.set(key, [...(tiles.get(key) ?? []), x]);
}

function rowsOf(body: unknown): unknown[] {
  return typeof body === 'object' && body !== null && Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : [];
}

function sameQuery(a: URL, b: URL): boolean {
  const norm = (u: URL) => JSON.stringify([...u.searchParams.entries()].sort());
  return norm(a) === norm(b);
}

function lastDayOf(month: string): IsoDate {
  const [y, m] = month.split('-').map(Number);
  if (y === undefined || m === undefined) throw new Error(`bad month ${month}`);
  // why: UTC arithmetic on a calendar month, never local time (spec §6.1).
  return asIsoDate(`${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`);
}

describe("recorded Travelpayouts fixtures (WP4b) replay through msw (@gmt/providers/testing's loadRecorded)", () => {
  it('exist for prices_for_dates, carry rows, and target the public host', () => {
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.some((x) => rowsOf(x.fixture.body).length > 0)).toBe(true);
    for (const x of recorded) expect(x.url.hostname).toBe(TRAVELPAYOUTS_HOST);
  });

  it.each([...tiles.entries()])('tile %s replays for every pair it serves; a sibling pair is a cache hit', async (key, pages) => {
    const [origin, destination, month] = key.split('|');
    if (origin === undefined || destination === undefined || month === undefined) throw new Error(`bad key ${key}`);
    let hits = 0;
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        hits += 1;
        // the adapter's request must equal a recorded one exactly (names and values)
        const match = pages.find((p) => sameQuery(p.url, new URL(request.url)));
        return match === undefined
          ? HttpResponse.text('no recorded page for this query', { status: 404 })
          : HttpResponse.json(match.fixture.body as Record<string, unknown>);
      }),
    );
    // why: the worked example's metro (LON = LHR, LGW) serves both origins; an airport tile was recorded without a metro.
    const isMetro = origin === 'LON';
    const pairOrigins = isMetro ? [asIata('LHR'), asIata('LGW')] : [asIata(origin)];
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h, isMetro ? {} : { airports: noMetro }));
    const received = pages.reduce((n, p) => n + rowsOf(p.fixture.body).length, 0);
    const from = asIsoDate(`${month}-01`);
    const to = lastDayOf(month);
    for (const pairOrigin of pairOrigins) {
      const q = query({ origin: pairOrigin, destination: asIata(destination), departureFrom: from, departureTo: to, minNights: 0, maxNights: 90 });
      const r = await d.fetchTile(only(d.plan(q)), q, ctx());
      if (r.kind !== 'tile') throw new Error(`replay of ${key} for ${pairOrigin} failed: ${r.error.kind} ${r.error.message}`);
      expect(r.pointOfSale).toBe('unknown');
      const covered = new Set(r.coveredCells.map(cellKeyString));
      for (const p of r.prices) {
        expect(p.origin).toBe(pairOrigin);
        expect(covered.has(cellKeyString(p))).toBe(true);
        expect(p.currency).toBe('GBP');
        expect(Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0).toBe(true);
        expect('providerObservedAt' in p).toBe(false);
        if (p.vendorLink !== undefined) expect(new URL(p.vendorLink).hostname).toBe('www.aviasales.com');
      }
      const dropped = r.notes.filter((n) => n.startsWith('dropped:')).reduce((n, s) => n + Number(s.split(':')[2]), 0);
      expect(r.notes).toContain(`rows-received:${received}`);
      expect(r.prices.length + dropped).toBe(received);
    }
    // plan().length per pair is 1; the first pair reaches upstream once per page, the sibling is served by the cache.
    expect(hits).toBe(pages.length);
    expect(h.budget.ledger.cacheHits).toHaveLength(pages.length * (pairOrigins.length - 1));
  });

  it('the recorded 401 (invalid token) replays as tile-error auth (spec §2 fact 5)', async () => {
    const unauthorised = recorded.find((x) => x.fixture.status === 401);
    if (unauthorised === undefined) throw new Error('WP4b recorded no Travelpayouts 401');
    const body = unauthorised.fixture.body;
    server.use(
      http.get(ENDPOINT, () =>
        typeof body === 'string' ? HttpResponse.text(body, { status: 401 }) : HttpResponse.json(body as Record<string, unknown>, { status: 401 }),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(await d.fetchTile(only(d.plan(q)), q, ctx())).toMatchObject({ kind: 'tile-error', error: { kind: 'auth', retryable: false, httpStatus: 401 } });
  });

  it('suppliedFields equal what the recorded rows actually supply (spec §5.2)', () => {
    const fields = new Set(ok.flatMap((x) => rowsOf(x.fixture.body).flatMap((row) => suppliedFieldsOfRow(row))));
    expect([...fields].sort()).toEqual([...TRAVELPAYOUTS_SUPPLIED_FIELDS].sort());
  });

  it('spike fact 1 holds on the recordings: origin_airport and return_at on every row, no found_at, currency gbp', () => {
    for (const x of ok) {
      expect((x.fixture.body as { currency?: unknown }).currency).toBe('gbp');
      for (const row of rowsOf(x.fixture.body)) {
        const r = row as Record<string, unknown>;
        expect(typeof r.origin_airport).toBe('string');
        expect(typeof r.return_at).toBe('string');
        expect(r).not.toHaveProperty('found_at');
      }
    }
  });

  it('recorded requests satisfy TRAVELPAYOUTS_PARAMS, names and values', () => {
    for (const x of recorded) expect(() => assertRequestAllowed(TRAVELPAYOUTS_PARAMS, PRICES_FOR_DATES_PATH, x.url)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/replay.test.ts`
Expected: FAIL with `does not provide an export named 'suppliedFieldsOfRow'`.

- [ ] **Step 3: Implement**

Append to `packages/providers/src/travelpayouts/response.ts` (and add `type SuppliedField` to its `@gmt/core` import):

```ts
/**
 * The constraint inputs a prices_for_dates row actually supplies (spec §5.2: suppliedFields from
 * recorded fixtures only).
 * why: a row names one airline, one flight number and transfer counts. That is not a segment
 * list, so segments, segmentTimes and seller are never claimed and their constraints stay
 * unverified (spec §6.2). Any array-valued field would be a segment list this code has not seen,
 * so it is reported as 'segments' and makes the Task 6.8 test fail for a human to look.
 */
export function suppliedFieldsOfRow(row: unknown): SuppliedField[] {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return [];
  const r = row as Record<string, unknown>;
  const out: SuppliedField[] = [];
  if (typeof r.price === 'number' && r.price > 0) out.push('price');
  if (Object.values(r).some((v) => Array.isArray(v))) out.push('segments');
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS. Every file is green, and `replay.test.ts` has `5 + <recorded 200 tiles>` passed. If a recorded tile fails on a currency other than `gbp`, a missing `return_at`, a reported `segments`, or a 404 from the replay handler (the adapter's request differs from the recorded one), stop and report it. Do not change the assertion.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts recorded fixtures replay; suppliedFields from recordings"
```

### Task 6.9: Wire the adapter into `apps/api`

**Files:** modify `apps/api/src/wiring.ts` (`httpLimitsFor` and `providersFor`, one entry each); create `apps/api/test/wiring.travelpayouts.test.ts`.

**Interfaces:**

- Consumes `httpLimitsFor`, `providersFor` (WP4b), `parseConfig` (WP0), and `travelpayoutsProvider`, `travelpayoutsHttpLimits`, `TRAVELPAYOUTS_PARAMS` (this brief).
- Produces nothing new. This is the plan's "WP5 and WP6 each add their provider's line (a Modify in their briefs)".

- [ ] **Step 1: Write the failing test**

`apps/api/test/wiring.travelpayouts.test.ts`:

```ts
import { asIsoDateTime, type Config, fixedClock, type Logger, parseConfig } from '@gmt/core';
import type { AirportsRepo } from '@gmt/db';
import { type HttpKit, travelpayoutsHttpLimits } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { httpLimitsFor, providersFor } from '../src/wiring.js';

const TOKEN = 'test-travelpayouts-token-0123456789abcdef';
const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };

function config(env: Record<string, string>): Config {
  const r = parseConfig(env, { realpath: (p) => p });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}
const silentLog: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silentLog };
const unusedHttp: HttpKit = { request: () => Promise.reject(new Error('not called')), stats: () => ({ inFlight: 0 }) };
// why: providersFor's contract takes an AirportsRepo; the Travelpayouts adapter only calls metroOf, so a one-method stand-in is enough here.
const airports = { metroOf: () => null } as unknown as AirportsRepo;
const deps = { http: unusedHttp, log: silentLog, clock: fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z')), airports };

describe('apps/api wiring: Travelpayouts (plan "Wiring and bootstraps")', () => {
  it('httpLimitsFor registers travelpayoutsHttpLimits when TRAVELPAYOUTS_TOKEN is set', () => {
    const c = config({ ...base, TRAVELPAYOUTS_TOKEN: TOKEN });
    const tp = c.providers.travelpayouts;
    if (tp === null) throw new Error('travelpayouts not configured');
    expect(httpLimitsFor(c).travelpayouts).toEqual(travelpayoutsHttpLimits(tp.limits, c));
  });

  it('httpLimitsFor has no travelpayouts entry without a token', () => {
    expect(httpLimitsFor(config(base)).travelpayouts).toBeUndefined();
  });

  it('providersFor constructs the adapter when TRAVELPAYOUTS_TOKEN is set, and not otherwise', () => {
    expect(providersFor(config({ ...base, TRAVELPAYOUTS_TOKEN: TOKEN }), deps).map((p) => p.id)).toContain('travelpayouts');
    expect(providersFor(config(base), deps).map((p) => p.id)).not.toContain('travelpayouts');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring.travelpayouts.test.ts`
Expected: FAIL. The first test sees `undefined`, and the third test's first assertion fails (`expected [ … ] to include 'travelpayouts'`).

- [ ] **Step 3: Implement**

In `apps/api/src/wiring.ts`, add to the imports:

```ts
import { TRAVELPAYOUTS_PARAMS, travelpayoutsHttpLimits, travelpayoutsProvider } from '@gmt/providers';
```

In `httpLimitsFor`, add this entry to the object literal it returns:

```ts
    // WP6: Travelpayouts, only when configured (spec §2, §5.3).
    ...(config.providers.travelpayouts === null
      ? {}
      : { travelpayouts: travelpayoutsHttpLimits(config.providers.travelpayouts.limits, config) }),
```

In `providersFor`, add this entry to the array it returns:

```ts
    // WP6: Travelpayouts, only when configured; the cache TTL is what dedups sibling pairs' metro requests (spec §5.2).
    ...(config.providers.travelpayouts === null
      ? []
      : [
          travelpayoutsProvider({
            http: deps.http,
            log: deps.log,
            clock: deps.clock,
            token: config.providers.travelpayouts.token,
            cacheTtlSeconds: config.providers.travelpayouts.limits.cacheTtlHours * 3600,
            paramsAllowlist: TRAVELPAYOUTS_PARAMS,
            airports: deps.airports,
          }),
        ]),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring.travelpayouts.test.ts`
Expected: PASS, `3 passed`. Then run `pnpm --filter @gmt/api test`, which must pass with its thresholds; WP4b's own wiring tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp06: wire the travelpayouts adapter and its http limits into apps/api"
```

## 9. Pinned review-focus tests

None. The plan's Review Focus lines are owned by other packages. One test here guards an adjacent risk, Review Focus 1 (metro codes): in WP6 a metro code is only ever a vendor query parameter taken from the airports table, never operator input. Task 6.3's "sends the airport when there is no metro" and "ignores a metro code that is not three upper-case letters" pin that.

## 10. Definition of done

- `pnpm --filter @gmt/providers test` passes every test file. Coverage on `packages/providers/src` meets lines 85 / branches 70 / functions 85 / statements 85, with no "threshold not met" line.
- `pnpm --filter @gmt/providers exec vitest run test/travelpayouts` passes eight files with no skipped test.
- `pnpm --filter @gmt/api test` passes with its thresholds (including `test/wiring.travelpayouts.test.ts`).
- `pnpm lint` reports no diagnostics.
- `pnpm -r typecheck` exits 0.
- `node scripts/check-boundaries.mjs` exits 0. `@gmt/providers` imports only `@gmt/core`, production code never imports the testing subpath, and `process.env` is read only in the allowed files.
- `pnpm secret-scan` exits 0.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/providers/src` prints nothing (no airport in code, spec §1).
- `grep -rn "token=" packages/providers/src/travelpayouts` prints nothing (header only, spec §2 fact 8).
- `grep -rn "PRINTED_ABOVE" packages/providers/src` prints nothing (Task 6.6's two copied values are filled in).
- `git log --oneline main..HEAD` shows the nine `wp06:` commits of Tasks 6.1–6.9.

## 11. Open questions

None requires operator judgement. Mismatches 6, 8, 9 and 10 in §3 remain coordination notes for Fable; 4, 5 and 7 are settled by plan item 14.
