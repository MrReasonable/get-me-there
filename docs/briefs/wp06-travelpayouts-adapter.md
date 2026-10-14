---
wp: 6
title: Travelpayouts adapter
owner: sonnet
depends_on: [4, 4b]
spec_sections: ["§2", "§5.1", "§5.2", "§6.9", "§9 item 2"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, provenance-auditor, cost-and-budget-reviewer]
status: draft
---

# WP6: Travelpayouts adapter

## 1. Goal

Build `travelpayoutsProvider(...)`, a discovery-only `FlightProvider` that turns cached Aviasales round-trip prices from `/aviasales/v3/prices_for_dates` into raw, cell-keyed calendar prices. One month tile per (origin or shared metro, destination, departure month). Nothing is defaulted and nothing is invented.

## 2. Scope

**In**

- `packages/providers/src/travelpayouts/`: month tiling (`plan`), row attribution by response dates, pagination inside `fetchTile`, envelope and currency checks, the vendor-link prefix and check, the dated parameter allowlist (parse WP4b's file and enforce it), the `ProviderHttpLimits` builder (vendor ceiling 600/min, WP4's default error table), the identity fields, and a healthcheck that sends no request.
- Tests that replay WP4b's recorded fixtures through msw on global fetch and the real http-kit, plus synthetic-shape tests for cases that were not recorded.
- Barrel exports from `packages/providers/src/index.ts`.

**Out** (owner in brackets)

- http-kit pipeline, retries, `Retry-After`, limiter, egress allowlist enforcement, cache keys, scrubbing, recorder [WP4].
- Recording the fixtures and writing `params-<date>.json`; reading the allowlist file from disk at boot; registering `travelpayoutsHttpLimits(...)` in `HttpKitDeps.limits` [WP4b wiring helper, then WP8].
- FX conversion, the `fx.converted` flag, `toGbp`, tz handling, `min_pence` per tile, stamping `pointOfSale` and `sourceKind` on stored rows, cell outcome writes, parity measurement [WP7].
- `validateVendorUrl`, `searchLinkFor` (the Aviasales search link shown when `booking` is `none`, spec §6.9), `MINOR_EXPONENT` [WP2].
- `generateCells`, `monthOf`, `toEpochDay`, `cellKeyString` [WP1].
- `AirportsRepo.sharedMetro` (the airports table) [WP3].
- The coverage-check route that runs these tiles for free [WP7 `coverageCheck`, WP8 route].

## 3. Spec sections

- **§2 Travelpayouts row.** `/aviasales/v3/prices_for_dates`, month tiles (`departure_at=YYYY-MM`, `one_way=false`, no `return_at`). The origin is an airport code, or the metro code when the definition's origins share one, with rows split by `origin_airport`. Pages of 1000. The source is authorised, cached from the last 48 h, has no `found_at`, ignores `market` and is economy only. Free, 600/min. `sourceKind` is `authorised-cached` and `maxAgeHours` is 48.
- **§2 fact 1.** Every row carries `origin_airport`. `currency=gbp` is honoured. `market` and `trip_class` are ignored, so the point of sale is unknown and only economy is searched. Rows have no `found_at`. The cheapest tiling uses the shared metro code.
- **§2 consequences.** Adapters return raw vendor shapes. The native currency is read from the response; a response that states no currency is a `parse` error. Rows for airports outside the definition are dropped. `point_of_sale` is `'unknown'`.
- **§5.1.** The contract implemented here: `DiscoveryCapability.plan` / `fetchTile` and `FlightProvider`.
- **§5.2.**
  - Tiles partition the cells and `plan` is pure.
  - Pages are fetched inside one `fetchTile`, each ledgered under the tile's index.
  - Cell keys come from the response; out-of-band entries are dropped and counted in `notes`.
  - Empty is per capability: a valid empty envelope gives `no_data`; a malformed envelope or `success:false` gives `parse`.
  - Parity: `plan(q).length` is the estimate.
  - Raw only, and `suppliedFields` come from recorded fixtures.
  - `currency=gbp` only, `pointOfSale` is unknown, and a non-economy definition gets `no_data` with a note.
  - The dated allowlist covers names and values.
  - Error mapping follows the table.
  - Vendor links must match the `aviasales.com` allowlist.
- **§6.9.** The Aviasales deep link is the search-link source for Travelpayouts rows. This adapter supplies it as `vendorLink`; WP2 `searchLinkFor` covers rows without one.
- **§9 item 2.** Tiles partition cells. `plan().length` equals msw hits exactly. Response-date keying drops out-of-band entries. The Travelpayouts empty envelope gives `no_data`. Currency is read from the response. `suppliedFields` come from recorded fixtures only. Parameter names and values match the dated allowlist.

### Mismatches found while writing this brief (spec wins; reported, not papered over)

1. **No `month` TileRequest.** Spec §2 and §5.2 say "`month` tiles", but the §5.1 `TileRequest` union has no month variant. This brief uses `{ kind: 'month-pair', departMonth: m, returnMonth: m }` so that it compiles against the frozen contract; the adapter ignores `returnMonth` because `return_at` is never sent. Recommendation: add `{ kind: 'month'; month: IsoMonth }` to §5.1.
2. **One origin per `DiscoveryQuery`.** §5.1 `DiscoveryQuery` carries a single `origin` and `destination`, so a metro collapse (spec §5.2 "collapsed to the shared metro code when the airports table gives one for every origin in the definition") is impossible from that query alone. This brief takes the origin and destination sets from `q.cells` when it is set. WP7 must pass a query whose `cells` span all of the definition's origins (and may span its destinations) to get the worked example's 14 tiles; per-pair queries give 28. Recommendation: `origins: Iata[]; destinations: Iata[]` on `DiscoveryQuery`.
3. **No `pointOfSale` field.** §5.1 `RawCalendarPrice`, `DiscoveryTileResult` and `CapabilityInfo` have nowhere to put it. This brief exports `TRAVELPAYOUTS_POINT_OF_SALE = 'unknown'` for WP7 to stamp. Recommendation: `pointOfSale` on `CapabilityInfo`.
4. **Rate limit.** Spec §2 says 600/min (the vendor ceiling). Spec §12 and `TRAVELPAYOUTS_DEFAULTS` default to 200/min. `travelpayoutsHttpLimits` keeps the configured value and clamps it to 600. No conflict in practice, but the figure is stated twice.
5. **Cache TTL.** Spec §5.3 says "TTLs from config", but the plan's constructor line has no TTL. This brief adds a required `cacheTtlSeconds` option (WP4b/WP8 pass `limits.cacheTtlHours × 3600`).
6. **Who wires the limits.** The wiring helper (WP4b) is built before WP6 exists, so the Travelpayouts `ProviderHttpLimits` builder (`travelpayoutsHttpLimits`) exported here must be registered by WP8 or WP13 in `buildPorts`.
7. **No `classifyError` hook, against the instruction for this brief.** The instruction asked for a Travelpayouts `classifyError` hook mapping the 401 plain-text body to `auth`. The WP4 brief's http-kit calls a hook *instead of* its default table, and the hook signature `(status, body, ledgerAtCap)` receives no headers. A hook would therefore drop spec §5.3's "Retry-After honoured up to MAX_WAIT_SECONDS, beyond → limiter-timeout". WP4's default table already gives everything spec §5.2 asks for Travelpayouts: 401 or 403 → `auth` (the plain-text body arrives as a string), 400 → `parse` with the vendor message, 429 → `rate-limit`. It gives `quota` only at the plan cap, and `BudgetExceeded` pre-empts that for a free provider. So `travelpayoutsHttpLimits` registers no hook, and Task 6.5 pins the mapping through the real http-kit, including a 429 `Retry-After: 3600` → `limiter-timeout`.
8. **Parity vs non-economy tiles.** Spec §5.2 requires `no_data` with a note and the instructions require no HTTP call. Those tiles therefore leave no ledger rows, and §8.1 parity (distinct tile requests equal to `plan` length) would report a break for a non-economy definition. WP7 must not count a tile with the note `cabin-unsupported:*` as a missing request.
9. **FX assertion belongs elsewhere.** §9 item 2 says "a non-GBP response asserts conversion and the FX flag", but conversion is WP7 normalisation (§5.6). Here only pass-through is asserted. The vendor sends lower-case codes (`gbp`), and the adapter upper-cases them to ISO 4217 (`GBP`) without changing amounts.
10. **File formats.** The plan does not define `params-<date>.json` or the recorded exchange file. The WP4b brief pins both (its §5.3 and §5.4), and this brief follows it: `request.url` is origin + path, the query is in `request.params`, and the allowlist is `{ provider, recordedAt, recordedBy, credential: 'header', endpoints: [{ key, method, path, params: { name: { fixed: [...] } | { kind } } }] }`. Two conflicts between the WP4 and WP4b briefs touch WP6's tests:
    - WP4b §5.3 names the hash field `sha256`, but WP4's `RecordedFixture` and `loadRecordedFixture` use `contentSha256`.
    - WP4's `loadRecordedJson` requires a content hash on every recorded-tree file (its own test calls a params allowlist "hashed"), but WP4b §5.4 writes the allowlist without one.

    WP6 loads exchanges through `loadRecordedFixture` and reads the allowlist with plain `JSON.parse`.
11. **Missing dependencies.** `depends_on: [4, 4b]` omits WP1 (`generateCells`, `monthOf`, `toEpochDay`, `cellKeyString`) and WP2 (`MINOR_EXPONENT`, `validateVendorUrl`). Both are merged in wave 1, before WP6's wave 3, but the frontmatter should read `[1, 2, 4, 4b]`.
12. **Ledger `tile_index`.** §5.1 `BudgetGuard.reserve` params have no tile index, yet §5.3 requires `tile_index` on every ledger row. This brief asserts `tileIndex` on every `HttpKitRequest`; the ledger column is WP4/WP3.
13. **An empty envelope with no currency.** Spec §2 says a response that states no currency is `parse`. The first failing test's body `{"success": true, "data": []}` has no currency. This brief treats currency as required only when there is at least one row to denominate, so an empty envelope without currency gives `no_data`.

## 4. Interfaces consumed

From spec §5.1 (`@gmt/core` `ports/provider.ts`, verbatim):

```ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
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

export interface ProviderContext { executionId: string | null; signal: AbortSignal; recordFixtures: boolean }
// Adapters are constructed once with { http: HttpKit, log: Logger, clock: Clock }; the context carries only per-call state.

export interface DiscoveryCapability { info: CapabilityInfo; plan(q: DiscoveryQuery): TilePlan[]; fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> }
export interface FlightProvider {
  readonly id: ProviderId; readonly displayName: string;
  readonly suppliedFields: readonly SuppliedField[]; readonly cabins: readonly Cabin[];
  readonly discovery?: DiscoveryCapability; readonly verification?: VerificationCapability;
  healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }>;
}
export interface Reservation { id: string; finalise(r: { outcome: 'ok' | 'error' | 'unknown'; httpStatus?: number; durationMs: number }): void }
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }
export class ProviderError extends Error { kind: 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout'; reason?: string; retryable: boolean; httpStatus?: number; retryAfterSeconds?: number }
export class BudgetExceeded extends Error { scope: 'execution-calls' | 'execution-free-calls' | 'execution-cost' | 'provider-month' | 'provider-lifetime' | 'global-month' }
export class AbortedError extends Error {}
```

From the plan's "Cross-package contracts", verbatim:

```ts
// types/ids.ts (WP0)
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$, upper-case
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata>;          // z.string().regex(/^[A-Z]{3}$/) then brand
export const isoDateSchema: z.ZodType<IsoDate>;    // regex + real calendar date check (rejects 2027-02-29)
export function asIata(s: string): Iata;           // throws on mismatch; used by tests and seeds, never on user input (zod does that)
export function asIsoDate(s: string): IsoDate;
export function asIsoDateTime(s: string): IsoDateTime;
// plus, from plan Task 0.3's implementation of ids.ts: export const asIsoMonth = (s: string): IsoMonth

// types/itinerary.ts (WP0)
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };

// ports/budget.ts (WP0)
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }

// ports/logger.ts, ports/clock.ts (WP0)
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void };   // tests

// config (WP0)
export class Secret { constructor(value: string); reveal(): string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export interface ProviderLimits { monthlyCallCap: number; window: 'month' | 'lifetime'; billingDay: number; ratePerMinute: number; ratePerHour: number; concurrency: number; cacheTtlHours: number; costPerCallMicroGbp: number; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export const TRAVELPAYOUTS_DEFAULTS: ProviderLimits;   // cap 50000/mo, 200/min, 10000/h, concurrency 4, TTL 6h, cost 0, fixed 0

// text/bannedWords.ts (WP0)
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;

// http-kit (@gmt/providers http/httpKit.ts, WP4)
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

From the WP4 brief (`packages/providers/src/http/recorder.ts`; not in the plan's contract block), used only by the test loader:

```ts
export interface RecordedFixture { recordedAt; recordedBy; providerId; endpointPath; request: { method; url; params; body }; status; body; contentSha256 }
export function loadRecordedFixture(path: string): RecordedFixture;
```

Plan, adapter constructor line (WP6 implements it, with one added option; see mismatch 5):

```ts
travelpayoutsProvider({ http, log, clock, token: Secret, paramsAllowlist, airports: { sharedMetro(iatas): string | null } })   // returning FlightProvider
```

Plan, errors: `ProviderError`, `BudgetExceeded`, `AbortedError` "constructed as `new ProviderError({ kind, reason?, retryable, httpStatus?, retryAfterSeconds?, message })`, `new BudgetExceeded({ scope, cap, current, requested })`". WP0's implementation also accepts `providerId` on both.

Plan, database block (WP3): `export class AirportsRepo { … sharedMetro(iatas: Iata[]): string | null; … }`.

Plan, WP1 produces: `toEpochDay(IsoDate): number`, `monthOf(IsoDate): IsoMonth`, `generateCells`, `cellKeyString(cell): string` (`O|D|dep|ret`). Spec §6.1: `generateCells(space: ResolvedSpace): Cell[]      // deterministic order: origin, destination, departureDate, nights`. Plan types: `export interface ResolvedSpace { origins: Iata[]; destinations: Iata[]; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }`, `export interface Cell extends CellKey { nights: number }`.

Plan, WP2 produces: `toGbp(amountMinor, currency, rateNano): number` with `MINOR_EXPONENT: Record<string, number>` and `ECB_CURRENCIES`, `validateVendorUrl(url, allowlist): Booking`.

## 5. Interfaces produced

All exported from `@gmt/providers` (barrel) unless marked internal.

```ts
// travelpayouts/provider.ts
export const TRAVELPAYOUTS_INFO: CapabilityInfo;                       // { sourceKind: 'authorised-cached', maxAgeHours: 48, provenanceNote }
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[];  // ['price']
export const TRAVELPAYOUTS_CABINS: readonly Cabin[];                   // ['economy']
export const TRAVELPAYOUTS_POINT_OF_SALE: 'unknown';
export const PAGE_LIMIT: 1000;   // internal
export const MAX_PAGES: 50;      // internal
export interface TravelpayoutsProviderOptions {
  http: HttpKit; log: Logger; clock: Clock; token: Secret;
  paramsAllowlist: TravelpayoutsParamsAllowlist;
  airports: MetroLookup;
  cacheTtlSeconds: number;      // added (mismatch 5): limits.cacheTtlHours × 3600
}
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider;   // id 'travelpayouts', displayName 'Aviasales cache'
export function buildRequestUrl(tp: TileParams, page: number): URL;  // internal

// travelpayouts/params.ts
export const TRAVELPAYOUTS_HOST: 'api.travelpayouts.com';
export const PRICES_FOR_DATES_PATH: '/aviasales/v3/prices_for_dates';
export const FIXED_PARAMS: { readonly one_way: 'false'; readonly currency: 'gbp'; readonly limit: '1000' };
export const DYNAMIC_PARAM_KINDS: { readonly origin: 'iata'; readonly destination: 'iata'; readonly departure_at: 'iso-month'; readonly page: 'positive-int' };
export const FORBIDDEN_PARAM_NAMES: readonly ['token', 'market', 'trip_class', 'return_at'];
export interface TravelpayoutsParamsAllowlist {
  readonly provider: 'travelpayouts'; readonly endpointPath: '/aviasales/v3/prices_for_dates'; readonly recordedAt: string;
  readonly fixed: Readonly<Record<string, string>>; readonly dynamic: Readonly<Record<string, RegExp>>;
}
export class ParamsAllowlistError extends Error {}
export function parseTravelpayoutsAllowlist(json: unknown): TravelpayoutsParamsAllowlist;   // input: WP4b brief §5.4 document; throws ParamsAllowlistError
export function assertParamsAllowed(allowlist: TravelpayoutsParamsAllowlist, params: URLSearchParams): void;   // throws ParamsAllowlistError

// travelpayouts/limits.ts
export const TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE: 600;
export function travelpayoutsHttpLimits(limits: ProviderLimits, opts: { maxWaitSeconds: number; requestTimeoutSeconds: number }): ProviderHttpLimits;   // no classifyError: WP4's default table applies

// travelpayouts/tiles.ts (internal)
export interface MetroLookup { sharedMetro(iatas: Iata[]): string | null }
export interface OriginGroup { readonly param: string; readonly members: readonly Iata[] }
export interface TileParams { readonly origin: string; readonly members: ReadonlySet<Iata>; readonly destination: Iata; readonly departureMonth: IsoMonth }
export function originGroups(origins: readonly Iata[], airports: MetroLookup): OriginGroup[];
export function cellsOf(q: DiscoveryQuery): CellKey[];
export function planMonthTiles(q: DiscoveryQuery, airports: MetroLookup): TilePlan[];
export function tileParams(plan: TilePlan, airports: MetroLookup): TileParams;

// travelpayouts/response.ts (internal)
export type Envelope = { ok: true; data: readonly unknown[]; currency: string | null } | { ok: false; reason: string };
export type DropReason = 'malformed-row' | 'one-way' | 'other-origin' | 'other-destination' | 'out-of-band' | 'outside-tile' | 'unpriced' | 'bad-price';
export const DROP_REASONS: readonly DropReason[];
export const AVIASALES_BASE: 'https://www.aviasales.com';
export const AVIASALES_LINK_ALLOWLIST: readonly string[];   // ['aviasales.com']
export function readEnvelope(body: unknown): Envelope;
export function resolveCurrency(raw: string | null): { ok: true; code: string; exponent: number } | { ok: false; reason: string };
export function majorToMinor(price: number, exponent: number): number | null;
export function vendorLinkFor(link: string): string | null;
export function attributeRows(rows: readonly unknown[], input: AttributionInput): Attribution;
export function attributionNotes(a: Attribution, rowsReceived: number, pages: number): string[];
export function suppliedFieldsOfRow(row: unknown): SuppliedField[];
```

**Notes vocabulary** (`DiscoveryTileResult.notes`, consumed by WP7 and shown in the coverage drill-down): `rows-received:<n>`, `pages:<n>`, `dropped:<DropReason>:<n>` (non-zero only, in `DROP_REASONS` order), `link-rejected:<n>`, `pages-truncated:50`, `cabin-unsupported:<cabin>`.

**Semantics WP7 relies on.** Covered cells with no price in a `tile` result are `no_data`. `noFares` is always `[]`, because a cache never proves that no fares exist. Several prices may share one cell (different fares), and the engine keeps the minimum per tile (spec §5.6). `providerObservedAt` is never set. `currency` is the envelope's code upper-cased. `fetchedAt` is the oldest page's.

## 6. Library notes

Verified on 2026-10-14.

- **Travelpayouts Data API, `/aviasales/v3/prices_for_dates`.** `support.travelpayouts.com` (the links in `docs/providers.md`) answered HTTP 403 to every automated fetch on 2026-10-14. The endpoint was therefore verified from Travelpayouts' own published Postman collection, "Travelpayouts Data API" (postman.com/travelpayouts, collection `16826686-bfa85f3b-c07c-42f6-8ac3-2021f453b4fc`, read as JSON through `www.postman.com/_api/collection/…?populate=true`). Verified there:
  - **Parameters.** `origin` ("IATA code of a city or an airport"), `destination`, `departure_at` ("2006-01 or 2006-01-02 format"), `return_at`, `unique`, `sorting`, `direct`, `currency` (default `rub`), `market`, `limit` ("Allowed value from 1 to 1000"), `page` ("chunked reading of a large result"), `one_way` ("true - one way, false - back-to-back"). **`trip_class` is not a parameter of this endpoint**, consistent with spike fact 1.
  - **Token.** Passed "in the X-Access-Token header or in the token parameter"; this adapter uses the header only.
  - **Response envelope.** `{ "currency": "rub", "data": [ … ], "success": true }`, with the currency in the envelope, lower-case.
  - **Row fields** in the published sample: `airline`, `departure_at` (local time with offset, `2021-09-14T08:55:00+03:00`), `destination`, `destination_airport`, `duration`, `flight_number`, `link` (a relative path such as `/MOW1409LED1?t=…`), `origin`, `origin_airport`, `price` (an integer in the currency's major unit in the sample), `return_transfers`, `transfers`.
  - **Not verifiable from the docs:**
    - `return_at` on rows: the published sample is a one-way request. The spike and WP4b's recorded fixtures are the source, and Task 6.8 asserts the field on the recordings.
    - Error bodies: the collection's "Incorrect request" and error responses have `null` bodies. The plain-text 401 `Unauthorized` comes from spike fact 5.
    - `found_at` is absent from the sample (the spike says the same).
    - The public host `api.travelpayouts.com`: the collection's `baseUrl` is an internal host. Task 6.8 asserts the host on WP4b's recorded request URLs.
    - The 600/min limit: taken from `docs/providers.md` (support article 4402565416594, which returned 403). It was not re-verified.
  - The recorded set this brief replays is WP4b's plan TP-01…TP-20: fourteen `LON` metro tiles to JFK and EWR (2027-03 to 2027-09), four airport tiles for 2027-03, one empty-envelope probe (2028-02) and one 401 with an invalid token.
- **msw 3.0.3** (dev dependency of `@gmt/providers`, plan Task 0.1). Verified with context7 `/websites/mswjs_io` and the official `https://mswjs.io/docs/migrations/2.x-to-3.x`.
  - Request handlers are imported from `msw/http` (`import { http, HttpResponse } from 'msw/http'`); the root import is gone in 3.x.
  - `setupServer` comes from `msw/node`.
  - `server.listen({ onUnhandledFrame: 'error' })` replaces 2.x's `onUnhandledRequest`.
  - Also used: `server.use`, `server.resetHandlers`, `server.close`; `HttpResponse.json(body, init?)` and `HttpResponse.text(body, init?)` (unchanged from 2.x, not listed as breaking); `request.url` (a string) and `request.headers.get(name)`.
  - Node ≥ 22 is required, which the plan meets.
- **vitest 5.0.4** (root dev dependency). Verified with context7 `/vitest-dev/vitest/v5.0.3`, the closest indexed version. Used: `describe`, `it`, `it.each`, `expect` (`toEqual`, `toMatchObject`, `toHaveLength`, `toContain`, `toThrow`, `rejects.toBeInstanceOf`, `not.toHaveProperty`), `beforeAll`, `afterEach`, `afterAll`, a per-test timeout as the third argument of `it`, and the CLI form `vitest run <file>`. Single-file runs use `pnpm --filter @gmt/providers exec vitest run <file>`, not `pnpm --filter @gmt/providers test -- <file>`, because the package `test` script runs `--coverage` with thresholds over all of `src/`, and a single-file run would fail the thresholds.

No new dependency. `@gmt/providers` already has `@gmt/core` and dev `msw@3.0.3`; `zod` is not added (envelope checks are hand-written type guards, and dates and IATA codes reuse core's `isoDateSchema` and `iataSchema`).

## 7. Files

Create:

- `packages/providers/src/travelpayouts/params.ts`
- `packages/providers/src/travelpayouts/tiles.ts`
- `packages/providers/src/travelpayouts/response.ts` (beside the plan's file map: envelope and row parsing kept apart from tiling)
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

Modify:

- `packages/providers/src/index.ts` (barrel exports, Task 6.7)

Read (not written; produced by WP4b):

- `packages/providers/fixtures/recorded/travelpayouts/params-<yyyy-mm-dd>.json`
- `packages/providers/fixtures/recorded/travelpayouts/**/<yyyy-mm-dd>-<sha>.json`

## 8. Tasks

### Task 6.1: Empty envelope → `no_data` (first failing test)

**Files:** create `src/travelpayouts/params.ts`, `src/travelpayouts/tiles.ts`, `src/travelpayouts/response.ts`, `src/travelpayouts/provider.ts`, `test/travelpayouts/harness.ts`, `test/travelpayouts/empty.test.ts`.

**Interfaces:** consumes `createHttpKit`, `HttpKit`, `ProviderHttpLimits`, `generateCells`, `monthOf`, the §5.1 provider types. Produces `travelpayoutsProvider` (first cut), `parseTravelpayoutsAllowlist`, `planMonthTiles`, `tileParams`, `cellsOf`, `readEnvelope` (first cut), `buildRequestUrl`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/harness.ts` (the final harness; later tasks import from it):

```ts
/**
 * Test harness for the Travelpayouts adapter (WP6). It builds the REAL http-kit (WP4) over
 * in-memory fakes of the BudgetGuard and ResponseCache ports, so every test runs the production
 * pipeline (cache → dedup → retry → limiter → reserve → fetch) while msw intercepts global fetch
 * (spec §5.3: there is no injectable transport).
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
import { createHttpKit, type HttpKit, type HttpKitRequest, type ProviderHttpLimits } from '../../src/http/httpKit.js';
import { parseTravelpayoutsAllowlist } from '../../src/travelpayouts/params.js';
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
  reservations: Array<{ endpointPath: string; executionId: string | null }>;
  cacheHits: number;
}

/** BudgetGuard fake: records reservations; `refuse` makes reserve throw like a 0 cap would (spec §5.3). */
export function fakeBudget(o: { refuse?: boolean } = {}): BudgetGuard & { ledger: Ledger } {
  const ledger: Ledger = { reservations: [], cacheHits: 0 };
  return {
    ledger,
    reserve(p) {
      if (o.refuse === true) {
        throw new BudgetExceeded({ scope: 'execution-free-calls', cap: 0, current: 0, requested: 1, providerId: 'travelpayouts' });
      }
      ledger.reservations.push({ endpointPath: p.endpointPath, executionId: p.executionId });
      return { id: `r${ledger.reservations.length}`, finalise: () => {} };
    },
    recordCacheHit() {
      ledger.cacheHits += 1;
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

function limitsFor(host: string): ProviderHttpLimits {
  return {
    hosts: [host],
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

/** The real http-kit, spied so tests can read the tileIndex of every page (spec §5.2). */
export function makeHarness(o: { limits?: ProviderHttpLimits; refuse?: boolean } = {}): Harness {
  const budget = fakeBudget({ refuse: o.refuse ?? false });
  const clock = fixedClock(asIsoDateTime(NOW));
  const kit = createHttpKit({
    budget,
    cache: memoryCache(),
    clock,
    log: silentLog,
    secrets: [new Secret(TOKEN)],
    limits: {
      travelpayouts: o.limits ?? limitsFor('api.travelpayouts.com'),
      searchapi: limitsFor('www.searchapi.io'),
      fixture: limitsFor('fixture.local'),
      fx: limitsFor('api.frankfurter.app'),
    },
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

/** Synthetic stand-in for AirportsRepo.sharedMetro over the worked example only (London → New York). */
export const airports = {
  sharedMetro(iatas: Iata[]): string | null {
    const within = (members: string[]) => iatas.every((i) => members.includes(i));
    if (within(['LHR', 'LGW'])) return 'LON';
    if (within(['JFK', 'EWR'])) return 'NYC';
    return null;
  },
};

/** Synthetic allowlist parameters in the shape WP4b writes to params-<date>.json (WP4b brief §5.4). */
export const ALLOWLIST_PARAMS: Record<string, unknown> = {
  origin: { kind: 'iata', observed: [] },
  destination: { kind: 'iata', observed: [] },
  departure_at: { kind: 'iso-month', observed: [] },
  one_way: { fixed: ['false'], observed: [] },
  currency: { fixed: ['gbp'], observed: [] },
  limit: { fixed: ['1000'], observed: [] },
  page: { kind: 'positive-int', observed: [] },
};

/** A whole synthetic allowlist document around `params`; `over` replaces top-level fields. */
export function allowlistWith(params: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'travelpayouts',
    recordedAt: '2026-10-14T00:00:00.000Z',
    recordedBy: 'synthetic test allowlist',
    credential: 'header',
    endpoints: [{ key: 'prices_for_dates', method: 'GET', path: '/aviasales/v3/prices_for_dates', params }],
    ...over,
  };
}

export const ALLOWLIST_JSON = allowlistWith(ALLOWLIST_PARAMS);

export function makeProvider(h: Harness, over: Partial<TravelpayoutsProviderOptions> = {}): FlightProvider {
  return travelpayoutsProvider({
    http: h.http,
    log: silentLog,
    clock: h.clock,
    token: new Secret(TOKEN),
    paramsAllowlist: parseTravelpayoutsAllowlist(ALLOWLIST_JSON),
    airports,
    cacheTtlSeconds: 6 * 3600,
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

export function cellsFor(
  origins: Iata[],
  destinations: Iata[],
  from: string,
  to: string,
  minNights: number,
  maxNights: number,
): CellKey[] {
  return generateCells({ origins, destinations, departureFrom: asIsoDate(from), departureTo: asIsoDate(to), minNights, maxNights }).map(
    ({ origin, destination, departureDate, returnDate }) => ({ origin, destination, departureDate, returnDate }),
  );
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
    const hits: URL[] = [];
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        hits.push(new URL(request.url));
        // synthetic shape: the exact body named as WP6's first failing test
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const tile = only(d.plan(q));
    const r = await d.fetchTile(tile, q, ctx());
    expect(r).toMatchObject({ kind: 'tile', index: 0, prices: [], noFares: [], fetchedAt: NOW });
    // 11 departure days × 3 nights, all covered and none priced: WP7 records each as no_data.
    expect(r.coveredCells).toHaveLength(33);
    expect(hits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/empty.test.ts`
Expected: FAIL. The suite cannot load, with an import error naming `src/travelpayouts/params.js` (or `provider.js`).

- [ ] **Step 3: Implement**

`packages/providers/src/travelpayouts/params.ts`:

```ts
/**
 * Travelpayouts request facts and the dated parameter allowlist. Spec §2 (Travelpayouts row) and
 * §5.2 "Point of sale": `currency=gbp` only, `market` and `trip_class` never sent, all
 * hard-coded. The allowlist file `fixtures/recorded/travelpayouts/params-<date>.json`, written by
 * WP4b in the shape of its brief §5.4, enumerates parameter names and values, and the adapter
 * enforces it.
 */

/** Public Data API host; the only host in this provider's egress allowlist (spec §5.3). */
export const TRAVELPAYOUTS_HOST = 'api.travelpayouts.com';

/** The only endpoint this adapter calls (spec §2); also the ledger endpoint_path (path only, spec §5.3). */
export const PRICES_FOR_DATES_PATH = '/aviasales/v3/prices_for_dates';

/**
 * Fixed parameters, hard-coded (spec §5.2). `market` and `trip_class` are absent on purpose:
 * the spike proved the vendor ignores both (spec §2 fact 1).
 */
export const FIXED_PARAMS = { one_way: 'false', currency: 'gbp', limit: '1000' } as const;

/** Parameters whose value varies per request, with the WP4b value kind each carries. `return_at` is never sent. */
export const DYNAMIC_PARAM_KINDS = { origin: 'iata', destination: 'iata', departure_at: 'iso-month', page: 'positive-int' } as const;

type DynamicKind = (typeof DYNAMIC_PARAM_KINDS)[keyof typeof DYNAMIC_PARAM_KINDS];

/** The adapter's own pattern per WP4b kind; iso-month also rejects months 00 and 13. */
const KIND_PATTERNS: Readonly<Record<DynamicKind, RegExp>> = {
  iata: /^[A-Z]{3}$/,
  'iso-month': /^\d{4}-(0[1-9]|1[0-2])$/,
  'positive-int': /^[1-9]\d*$/,
};

/** The parsed allowlist: fixed name → exact value; dynamic name → pattern its value must match. */
export interface TravelpayoutsParamsAllowlist {
  readonly provider: 'travelpayouts';
  readonly endpointPath: typeof PRICES_FOR_DATES_PATH;
  readonly recordedAt: string;
  readonly fixed: Readonly<Record<string, string>>;
  readonly dynamic: Readonly<Record<string, RegExp>>;
}

/** Raised when the allowlist file or an outgoing request breaks the allowlist; fails closed. */
export class ParamsAllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParamsAllowlistError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return [...actual].sort().join(',') === [...expected].sort().join(',');
}

/**
 * Parses WP4b's params-<date>.json (its brief §5.4) for the prices_for_dates endpoint. Spec §5.2:
 * the allowlist enumerates names and values, and the adapter's hard-coded values must equal it.
 * why: a recording that disagrees with the code means the vendor or the code drifted; refuse to
 * construct the provider rather than send either version.
 */
export function parseTravelpayoutsAllowlist(json: unknown): TravelpayoutsParamsAllowlist {
  if (!isRecord(json)) throw new ParamsAllowlistError('allowlist is not an object');
  if (json.provider !== 'travelpayouts') throw new ParamsAllowlistError('allowlist provider must be travelpayouts');
  // why: spec §2 fact 8, the credential travels in a header; an allowlist recorded any other way is refused.
  if (json.credential !== 'header') throw new ParamsAllowlistError('allowlist credential must be header');
  const { recordedAt } = json;
  if (typeof recordedAt !== 'string') throw new ParamsAllowlistError('allowlist recordedAt must be a string');
  const endpoints: readonly unknown[] = Array.isArray(json.endpoints) ? json.endpoints : [];
  const endpoint = endpoints.find((e) => isRecord(e) && e.path === PRICES_FOR_DATES_PATH);
  if (!isRecord(endpoint) || !isRecord(endpoint.params)) {
    throw new ParamsAllowlistError(`allowlist has no ${PRICES_FOR_DATES_PATH} endpoint`);
  }
  const params = endpoint.params;
  const expected = [...Object.keys(FIXED_PARAMS), ...Object.keys(DYNAMIC_PARAM_KINDS)];
  if (!sameNames(Object.keys(params), expected)) {
    throw new ParamsAllowlistError(
      `parameters ${Object.keys(params).sort().join(',')} differ from the adapter's ${[...expected].sort().join(',')}`,
    );
  }
  const fixed: Record<string, string> = {};
  for (const [name, value] of Object.entries(FIXED_PARAMS)) {
    const rule = params[name];
    if (!isRecord(rule) || !Array.isArray(rule.fixed) || rule.fixed.length !== 1 || rule.fixed[0] !== value) {
      throw new ParamsAllowlistError(`parameter ${name} must be fixed to exactly ${value} in the allowlist`);
    }
    fixed[name] = value;
  }
  const dynamic: Record<string, RegExp> = {};
  for (const [name, kind] of Object.entries(DYNAMIC_PARAM_KINDS)) {
    const rule = params[name];
    if (!isRecord(rule) || rule.kind !== kind) {
      throw new ParamsAllowlistError(`parameter ${name} must be of kind ${kind} in the allowlist`);
    }
    dynamic[name] = KIND_PATTERNS[kind];
  }
  return { provider: 'travelpayouts', endpointPath: PRICES_FOR_DATES_PATH, recordedAt, fixed, dynamic };
}
```

`packages/providers/src/travelpayouts/tiles.ts`:

```ts
/**
 * Travelpayouts month tiling. Spec §5.2: one tile per (origin or shared metro, destination,
 * departure month) on /aviasales/v3/prices_for_dates with departure_at=YYYY-MM; tiles partition
 * the query's cells; plan is pure and deterministic. No airport is named here (spec §1).
 */
import { type CellKey, type DiscoveryQuery, generateCells, type Iata, type IsoMonth, monthOf, type TilePlan } from '@gmt/core';

/** The part of AirportsRepo (WP3) the adapter needs; the plan's constructor `airports` option. */
export interface MetroLookup {
  sharedMetro(iatas: Iata[]): string | null;
}

/** One vendor `origin` parameter and the definition airports whose rows it returns. */
export interface OriginGroup {
  readonly param: string;
  readonly members: readonly Iata[];
}

/** What one tile sends and how its rows are attributed back (spec §5.2). */
export interface TileParams {
  readonly origin: string;
  readonly members: ReadonlySet<Iata>;
  readonly destination: Iata;
  readonly departureMonth: IsoMonth;
}

/** Origin grouping. First cut: one group per airport; Task 6.3 adds the shared-metro collapse. */
export function originGroups(origins: readonly Iata[], _airports: MetroLookup): OriginGroup[] {
  return origins.map((o) => ({ param: o, members: [o] }));
}

function distinct<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** The cells to tile: `q.cells` when set (spec §5.1 re-plan), else the query's full space (spec §6.1 order). */
export function cellsOf(q: DiscoveryQuery): CellKey[] {
  if (q.cells !== undefined) return q.cells;
  return generateCells({
    origins: [q.origin],
    destinations: [q.destination],
    departureFrom: q.departureFrom,
    departureTo: q.departureTo,
    minNights: q.minNights,
    maxNights: q.maxNights,
  }).map(({ origin, destination, departureDate, returnDate }) => ({ origin, destination, departureDate, returnDate }));
}

/**
 * Spec §5.2 Travelpayouts tiling. Each cell lands in exactly one bucket (its origin group, its
 * destination, its departure month), so the tiles partition the cells.
 * why: the §5.1 TileRequest union has no month variant (brief mismatch 1); 'month-pair' with
 * returnMonth = departMonth carries the month, and returnMonth is ignored because return_at is
 * never sent.
 */
export function planMonthTiles(q: DiscoveryQuery, airports: MetroLookup): TilePlan[] {
  const cells = cellsOf(q);
  const groups = originGroups(distinct(cells.map((c) => c.origin)), airports);
  const destinations = distinct(cells.map((c) => c.destination));
  const buckets = new Map<string, { month: IsoMonth; cells: CellKey[] }>();
  for (const group of groups) {
    for (const destination of destinations) {
      for (const cell of cells) {
        if (cell.destination !== destination || !group.members.includes(cell.origin)) continue;
        const month = monthOf(cell.departureDate);
        const key = `${group.param}|${destination}|${month}`;
        const bucket = buckets.get(key);
        if (bucket === undefined) buckets.set(key, { month, cells: [cell] });
        else bucket.cells.push(cell);
      }
    }
  }
  return [...buckets.values()].map(
    (b, index): TilePlan => ({
      index,
      coveredCells: b.cells,
      request: { kind: 'month-pair', departMonth: b.month, returnMonth: b.month },
    }),
  );
}

/**
 * Re-derives a tile's vendor parameters from its covered cells, so fetchTile needs nothing the
 * TilePlan does not carry. Throws on a tile that is not a Travelpayouts month tile.
 */
export function tileParams(plan: TilePlan, airports: MetroLookup): TileParams {
  if (plan.request.kind !== 'month-pair') {
    throw new Error(`travelpayouts tiles are month tiles, got ${plan.request.kind}`);
  }
  const groups = originGroups(distinct(plan.coveredCells.map((c) => c.origin)), airports);
  const destinations = distinct(plan.coveredCells.map((c) => c.destination));
  const [group] = groups;
  const [destination] = destinations;
  if (groups.length !== 1 || destinations.length !== 1 || group === undefined || destination === undefined) {
    throw new Error('a travelpayouts tile covers exactly one origin group and one destination');
  }
  return { origin: group.param, members: new Set(group.members), destination, departureMonth: plan.request.departMonth };
}
```

`packages/providers/src/travelpayouts/response.ts`:

```ts
/**
 * Travelpayouts response parsing. Spec §5.2 "Empty is per capability": for authorised-cached, a
 * schema-valid success envelope with zero entries → no_data; malformed or success:false → parse.
 */

/** A checked envelope: rows still unparsed, currency as the vendor wrote it (lower-case ISO). */
export type Envelope = { ok: true; data: readonly unknown[]; currency: string | null } | { ok: false; reason: string };

/** First cut: one failure reason. Task 6.5 adds vendor-error. */
export function readEnvelope(body: unknown): Envelope {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (b.success === true && Array.isArray(b.data) && (b.currency === undefined || typeof b.currency === 'string')) {
      return { ok: true, data: b.data, currency: typeof b.currency === 'string' ? b.currency : null };
    }
  }
  return { ok: false, reason: 'malformed-envelope' };
}
```

`packages/providers/src/travelpayouts/provider.ts` (first cut; Task 6.4 replaces `fetchTile`, Task 6.7 gives the final file):

```ts
/**
 * Travelpayouts / Aviasales Data API adapter (WP6). Spec §2 (Travelpayouts row, fact 1), §5.1,
 * §5.2. Discovery only: cached round-trip prices from /aviasales/v3/prices_for_dates, one month
 * tile per (origin or shared metro, destination, departure month). Returns raw vendor shapes;
 * the engine normalises (spec §5.6).
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
import type { HttpKit } from '../http/httpKit.js';
import { FIXED_PARAMS, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST, type TravelpayoutsParamsAllowlist } from './params.js';
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
/** Spec §2 fact 1: trip_class is ignored, so economy only. */
export const TRAVELPAYOUTS_CABINS: readonly Cabin[] = ['economy'];
/** Spec §2: market is ignored, so the point of sale is unknown on every price (brief mismatch 3). */
export const TRAVELPAYOUTS_POINT_OF_SALE = 'unknown' as const;
/** Spec §5.2: limit=1000 per page. */
export const PAGE_LIMIT = 1000;
/** Hard stop on pages per tile; a tile that reaches it says so in notes. */
export const MAX_PAGES = 50;

export interface TravelpayoutsProviderOptions {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  token: Secret;
  paramsAllowlist: TravelpayoutsParamsAllowlist;
  airports: MetroLookup;
  /** Response cache window, from TRAVELPAYOUTS_CACHE_TTL_HOURS (spec §5.3 "TTLs from config"; brief mismatch 5). */
  cacheTtlSeconds: number;
}

/** The request URL for one page of a tile. The token never appears here (spec §2 fact 8: header only). */
export function buildRequestUrl(tp: TileParams, page: number): URL {
  const url = new URL(`https://${TRAVELPAYOUTS_HOST}${PRICES_FOR_DATES_PATH}`);
  url.searchParams.set('origin', tp.origin);
  url.searchParams.set('destination', tp.destination);
  url.searchParams.set('departure_at', tp.departureMonth);
  for (const [name, value] of Object.entries(FIXED_PARAMS)) url.searchParams.set(name, value);
  url.searchParams.set('page', String(page));
  return url;
}

/** Spec §5.1 FlightProvider for Travelpayouts. First cut: one page, no row attribution yet. */
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  async function fetchTile(plan: TilePlan, _q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, opts.airports);
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
    discovery: { info: TRAVELPAYOUTS_INFO, plan: (q) => planMonthTiles(q, opts.airports), fetchTile },
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

**Interfaces:** consumes `cellKeyString`, `toEpochDay` (WP1), `MINOR_EXPONENT`, `validateVendorUrl` (WP2), `iataSchema`, `isoDateSchema` (WP0). Produces `attributeRows`, `attributionNotes`, `resolveCurrency`, `majorToMinor`, `vendorLinkFor`, `DROP_REASONS`, `AVIASALES_BASE`, `AVIASALES_LINK_ALLOWLIST`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/response.test.ts`:

```ts
import { asIata, type CellKey } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  attributeRows,
  attributionNotes,
  majorToMinor,
  resolveCurrency,
  vendorLinkFor,
} from '../../src/travelpayouts/response.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { query, row } from './harness.js';

const LHR = asIata('LHR');
const JFK = asIata('JFK');
const covered: CellKey[] = cellsOf(query());
const input = { coveredCells: covered, members: new Set([LHR]), destination: JFK, minNights: 10, maxNights: 12, currency: 'GBP', exponent: 2 };
const LINK = 'https://www.aviasales.com/search/synthetic?t=1';

describe('attributeRows: cell keys from the response (spec §5.2)', () => {
  // synthetic shapes, one per drop reason
  const rows: unknown[] = [
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }), // 11 nights: kept
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 398 }), // same cell, another fare: kept (engine keeps the minimum, §5.6)
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-14', ret: '2027-03-24', price: 401, link: 'https://evil.example/x' }), // kept, link refused
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-30', price: 350 }), // 18 nights: out-of-band
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-25', ret: '2027-04-05', price: 380 }), // after the window: outside-tile
    row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 }), // not a member: other-origin
    row({ origin: 'LHR', dest: 'EWR', dep: '2027-03-12', ret: '2027-03-23', price: 300 }), // other-destination
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: null, price: 200 }), // one-way
    { origin_airport: 'LHR' }, // malformed-row
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-15', ret: '2027-03-26', price: 0 }), // unpriced
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-16', ret: '2027-03-27', price: 412.555 }), // bad-price
  ];
  const a = attributeRows(rows, input);

  it('keeps rows whose response dates name a covered cell, keyed by those dates', () => {
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

describe('resolveCurrency (spec §2: currency read from the response)', () => {
  it('upper-cases the vendor code and finds its exponent', () => {
    expect(resolveCurrency('gbp')).toEqual({ ok: true, code: 'GBP', exponent: 2 });
    expect(resolveCurrency('usd')).toEqual({ ok: true, code: 'USD', exponent: 2 });
  });
  it.each([
    [null, 'currency-missing'],
    ['g1p', 'currency-malformed: g1p'],
    ['qqq', 'currency-exponent-unknown: QQQ'],
  ] as const)('%s → %s', (raw, reason) => {
    expect(resolveCurrency(raw)).toEqual({ ok: false, reason });
  });
});

describe('vendorLinkFor (spec §5.2 vendor links: aviasales.com allowlist)', () => {
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
Expected: FAIL with `SyntaxError: The requested module '../../src/travelpayouts/response.js' does not provide an export named 'attributeRows'` (or Vitest's equivalent "is not a function").

- [ ] **Step 3: Implement**

Replace `packages/providers/src/travelpayouts/response.ts` with:

```ts
/**
 * Travelpayouts response parsing and row attribution. Spec §2 (raw shapes, currency from the
 * response), §5.2 ("Empty is per capability", "Cell keys from the response", vendor links).
 */
import {
  type CellKey,
  cellKeyString,
  type Iata,
  type IsoDate,
  iataSchema,
  isoDateSchema,
  MINOR_EXPONENT,
  type RawCalendarPrice,
  toEpochDay,
  validateVendorUrl,
} from '@gmt/core';

/** A checked envelope: rows still unparsed, currency as the vendor wrote it (lower-case ISO). */
export type Envelope = { ok: true; data: readonly unknown[]; currency: string | null } | { ok: false; reason: string };

/** First cut: one failure reason. Task 6.5 adds vendor-error. */
export function readEnvelope(body: unknown): Envelope {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (b.success === true && Array.isArray(b.data) && (b.currency === undefined || typeof b.currency === 'string')) {
      return { ok: true, data: b.data, currency: typeof b.currency === 'string' ? b.currency : null };
    }
  }
  return { ok: false, reason: 'malformed-envelope' };
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
/** Spec §5.2: the Travelpayouts link allowlist. */
export const AVIASALES_LINK_ALLOWLIST: readonly string[] = ['aviasales.com'];

/** Spec §2: the envelope's currency, upper-cased to ISO 4217; absent → parse (brief mismatch 13). */
export function resolveCurrency(raw: string | null): { ok: true; code: string; exponent: number } | { ok: false; reason: string } {
  if (raw === null) return { ok: false, reason: 'currency-missing' };
  const code = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return { ok: false, reason: `currency-malformed: ${raw.slice(0, 10)}` };
  const exponent = MINOR_EXPONENT[code];
  if (exponent === undefined) return { ok: false, reason: `currency-exponent-unknown: ${code}` };
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
 * Spec §5.2 vendor links: the relative Aviasales path prefixed with the site, then checked
 * against the aviasales.com allowlist by core's validateVendorUrl (WP2). Null when refused.
 * why: only a site-relative path is accepted; an absolute or protocol-relative value from the
 * vendor is refused rather than resolved.
 */
export function vendorLinkFor(link: string): string | null {
  if (!link.startsWith('/') || link.startsWith('//')) return null;
  const booking = validateVendorUrl(`${AVIASALES_BASE}${link}`, [...AVIASALES_LINK_ALLOWLIST]);
  return booking.kind === 'get' ? booking.url : null;
}

export interface AttributionInput {
  coveredCells: readonly CellKey[];
  members: ReadonlySet<Iata>;
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
 * Vendor times are local with an offset (`2021-09-14T08:55:00+03:00`); the first ten
 * characters are the local calendar date, which is the cell's date (spec §6.1: calendar dates
 * never pass through UTC).
 */
function localDate(s: string): IsoDate | null {
  const r = isoDateSchema.safeParse(s.slice(0, 10));
  return r.success ? r.data : null;
}

/**
 * Spec §5.2: rows are attributed by origin_airport and destination_airport and their own dates,
 * filtered to the tile's member airports, the nights band and the covered cells. Every row that
 * is not returned is counted under exactly one DropReason.
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
    if (!origin.success || !input.members.has(origin.data)) {
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

### Task 6.3: Shared-metro collapse; tiles partition the cells

**Files:** modify `src/travelpayouts/tiles.ts` (replace `originGroups`); create `test/travelpayouts/tiles.test.ts`.

**Interfaces:** consumes `MetroLookup.sharedMetro`, `cellKeyString`. Produces the final `originGroups`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/tiles.test.ts`:

```ts
import { asIata, asIsoDate, asIsoMonth, type CellKey, cellKeyString, type TilePlan } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { cellsOf, planMonthTiles, tileParams } from '../../src/travelpayouts/tiles.js';
import { airports, cellsFor, query } from './harness.js';

const [LHR, LGW, JFK, EWR] = [asIata('LHR'), asIata('LGW'), asIata('JFK'), asIata('EWR')];
const noMetro = { sharedMetro: (): string | null => null };
// Spec §5.2 worked example: LHR, LGW → JFK, EWR; 182 days (2027-01-01 … 2027-07-01, 7 months); 10–21 nights.
const worked = cellsFor([LHR, LGW], [JFK, EWR], '2027-01-01', '2027-07-01', 10, 21);

function expectPartition(cells: readonly CellKey[], plans: readonly TilePlan[]): void {
  const keys = plans.flatMap((p) => p.coveredCells.map(cellKeyString));
  expect(keys).toHaveLength(cells.length);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(keys)).toEqual(new Set(cells.map(cellKeyString)));
  for (const [i, p] of plans.entries()) {
    expect(p.index).toBe(i);
    expect(new Set(p.coveredCells.map((c) => c.destination)).size).toBe(1);
    const months = [...new Set(p.coveredCells.map((c) => c.departureDate.slice(0, 7)))];
    expect(months).toEqual([p.request.kind === 'month-pair' ? p.request.departMonth : 'not a month tile']);
  }
}

describe('planMonthTiles (spec §5.2 Travelpayouts tiling)', () => {
  it('worked example: 2 origins sharing LON × 2 destinations × 7 months = 14 tiles', () => {
    expect(worked).toHaveLength(2 * 2 * 182 * 12);
    expect(planMonthTiles(query({ cells: worked }), airports)).toHaveLength(14);
  });

  it('by airport when the airports table gives no shared metro: 28 tiles', () => {
    expect(planMonthTiles(query({ cells: worked }), noMetro)).toHaveLength(28);
  });

  it('ignores a metro code that is not three upper-case letters', () => {
    expect(planMonthTiles(query({ cells: worked }), { sharedMetro: () => 'LONDON' })).toHaveLength(28);
  });

  it.each([
    ['worked example, shared metro', worked, airports],
    ['worked example, by airport', worked, noMetro],
    ['single-origin query without cells', cellsOf(query()), airports],
    ['every 7th cell of the worked example (re-plan subset)', worked.filter((_, i) => i % 7 === 0), airports],
  ] as const)('tiles partition the cells: %s', (_label, cells, lookup) => {
    expectPartition(cells, planMonthTiles(query({ cells: [...cells] }), lookup));
  });

  it('is pure and deterministic', () => {
    expect(planMonthTiles(query({ cells: worked }), airports)).toEqual(planMonthTiles(query({ cells: worked }), airports));
  });

  it('plans the full query space when cells is unset: one March tile of 33 cells', () => {
    const [tile, ...rest] = planMonthTiles(query(), airports);
    expect(rest).toEqual([]);
    expect(tile?.coveredCells).toHaveLength(33);
    expect(tile?.request).toEqual({ kind: 'month-pair', departMonth: '2027-03', returnMonth: '2027-03' });
  });
});

describe('tileParams', () => {
  it('sends the metro code and keeps the member airports for attribution', () => {
    const [first] = planMonthTiles(query({ cells: worked }), airports);
    if (first === undefined) throw new Error('no tile');
    const tp = tileParams(first, airports);
    expect(tp.origin).toBe('LON');
    expect([...tp.members].sort()).toEqual(['LGW', 'LHR']);
    expect(tp.destination).toBe('JFK');
    expect(tp.departureMonth).toBe('2027-01');
  });

  it('never collapses a single origin to its metro', () => {
    const [first] = planMonthTiles(query(), airports);
    if (first === undefined) throw new Error('no tile');
    expect(tileParams(first, airports).origin).toBe('LHR');
  });

  it('refuses a tile that mixes destinations', () => {
    const mixed: TilePlan = {
      index: 0,
      coveredCells: cellsFor([LHR], [JFK, EWR], '2027-03-10', '2027-03-10', 10, 10),
      request: { kind: 'month-pair', departMonth: asIsoMonth('2027-03'), returnMonth: asIsoMonth('2027-03') },
    };
    expect(() => tileParams(mixed, airports)).toThrow(/exactly one origin group and one destination/);
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
    expect(() => tileParams(rect, airports)).toThrow(/month tiles/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/tiles.test.ts`
Expected: FAIL. `worked example … = 14 tiles` fails with `expected [ …(28) ] to have a length of 14 but got 28`, and `sends the metro code` fails with `expected 'LHR' to be 'LON'`. The other tests pass.

- [ ] **Step 3: Implement**

In `packages/providers/src/travelpayouts/tiles.ts`, replace the first-cut `originGroups` with:

```ts
const CODE_RE = /^[A-Z]{3}$/;

/**
 * Spec §2 and §5.2: the origin parameter is each origin airport, collapsed to the shared metro
 * code when the airports table gives one for every origin; rows are split back by origin_airport.
 * why: a single origin is never collapsed (it would fetch other airports' rows to drop them), and
 * a malformed code from the table is treated as no metro rather than sent to the vendor.
 */
export function originGroups(origins: readonly Iata[], airports: MetroLookup): OriginGroup[] {
  if (origins.length >= 2) {
    const metro = airports.sharedMetro([...origins]);
    if (metro !== null && CODE_RE.test(metro)) return [{ param: metro, members: [...origins] }];
  }
  return origins.map((o) => ({ param: o, members: [o] }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/tiles.test.ts test/travelpayouts/empty.test.ts`
Expected: PASS, `14 passed` in `tiles.test.ts` and `1 passed` in `empty.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts shared-metro month tiles partition the cells"
```

### Task 6.4: Pagination inside `fetchTile`; every page under the tile's index

**Files:** modify `src/travelpayouts/provider.ts` (replace `fetchTile`, add imports); create `test/travelpayouts/fetchTile.test.ts`.

**Interfaces:** consumes `attributeRows`, `attributionNotes`, `resolveCurrency`, `HttpKitResponse`. Produces the paginated `fetchTile`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/fetchTile.test.ts`:

```ts
import { asIata } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PAGES } from '../../src/travelpayouts/provider.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { cellsFor, ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, NOW, only, query, row, server } from './harness.js';

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
    expect(h.requests.map((x) => x.executionId)).toEqual(['exec-1', 'exec-1']);
    expect(h.budget.ledger.reservations.map((x) => x.endpointPath)).toEqual([
      '/aviasales/v3/prices_for_dates',
      '/aviasales/v3/prices_for_dates',
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

describe('estimate parity (spec §5.2: plan(q).length is the estimate)', () => {
  it('plan().length equals msw hits exactly over a whole scan', async () => {
    const seen: string[] = [];
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        const u = new URL(request.url);
        seen.push(`${u.searchParams.get('origin')}|${u.searchParams.get('destination')}|${u.searchParams.get('departure_at')}`);
        return HttpResponse.json(envelope([]));
      }),
    );
    const cells = cellsFor([asIata('LHR'), asIata('LGW')], [asIata('JFK')], '2027-01-01', '2027-07-01', 10, 21);
    const q = query({ cells });
    const d = discoveryOf(makeProvider(makeHarness()));
    const plans = d.plan(q);
    for (const p of plans) await d.fetchTile(p, q, ctx());
    expect(plans).toHaveLength(7);
    expect(seen).toHaveLength(plans.length);
    expect(new Set(seen).size).toBe(plans.length);
    expect(seen.every((s) => s.startsWith('LON|JFK|2027-'))).toBe(true);
  });
});

describe('fetchTile returns raw vendor shapes (spec §2, §5.2 "Raw only")', () => {
  it('keys prices by the response dates and counts out-of-band and foreign rows in notes', async () => {
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
Expected: FAIL. The pagination test sees `['1']` instead of `['1', '2']`; the attribution tests see `prices: []`; the currency tests see `kind: 'tile'`; the MAX_PAGES test sees 1 hit. The parity and oldest-`fetchedAt` tests already pass with the first cut (one page each).

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
import type { HttpKit, HttpKitResponse } from '../http/httpKit.js';
import { FIXED_PARAMS, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST, type TravelpayoutsParamsAllowlist } from './params.js';
import { attributeRows, attributionNotes, readEnvelope, resolveCurrency } from './response.js';
import { type MetroLookup, planMonthTiles, type TileParams, tileParams } from './tiles.js';
```

and replace the body of `travelpayoutsProvider` with:

```ts
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  const log = opts.log.child({ providerId: 'travelpayouts' });
  let lastError: ProviderError | null = null;

  const parseError = (reason: string): ProviderError =>
    new ProviderError({ kind: 'parse', retryable: false, reason, providerId: 'travelpayouts', message: `travelpayouts response unusable: ${reason}` });

  function tileError(plan: TilePlan, error: ProviderError): DiscoveryTileResult {
    lastError = error;
    log.warn({ tileIndex: plan.index, kind: error.kind, reason: error.reason ?? null }, 'travelpayouts tile failed');
    return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error };
  }

  /**
   * Spec §5.2: one tile, all of its pages (limit=1000, page=1..n until a short page), each sent
   * through http-kit with the tile's index so the ledger counts tiles for parity.
   */
  async function fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, opts.airports);
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
      if (!env.ok) return tileError(plan, parseError(env.reason));
      if (env.currency !== null) {
        if (currency !== null && currency !== env.currency) return tileError(plan, parseError('currency-changed-between-pages'));
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
    if (rows.length === 0) {
      // Spec §5.2 "Empty is per capability": every covered cell is no_data; no currency needed (brief mismatch 13).
      return { kind: 'tile', index: plan.index, coveredCells: plan.coveredCells, fetchedAt, prices: [], noFares: [], notes: ['rows-received:0', `pages:${pages}`] };
    }
    const cur = resolveCurrency(currency);
    if (!cur.ok) return tileError(plan, parseError(cur.reason));
    const attribution = attributeRows(rows, {
      coveredCells: plan.coveredCells,
      members: tp.members,
      destination: tp.destination,
      minNights: q.minNights,
      maxNights: q.maxNights,
      currency: cur.code,
      exponent: cur.exponent,
    });
    const notes = attributionNotes(attribution, rows.length, pages);
    if (truncated) notes.push(`pages-truncated:${MAX_PAGES}`);
    // why: a cache never proves "no fares", so noFares is always empty (spec §5.2 authorised-cached).
    return { kind: 'tile', index: plan.index, coveredCells: plan.coveredCells, fetchedAt, prices: attribution.prices, noFares: [], notes };
  }

  return {
    id: 'travelpayouts',
    displayName: 'Aviasales cache',
    suppliedFields: TRAVELPAYOUTS_SUPPLIED_FIELDS,
    cabins: TRAVELPAYOUTS_CABINS,
    discovery: { info: TRAVELPAYOUTS_INFO, plan: (q) => planMonthTiles(q, opts.airports), fetchTile },
    healthcheck: async () => ({ ok: lastError === null, detail: lastError === null ? 'token configured' : `last request failed: ${lastError.kind}` }),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS. All four files are green (`fetchTile.test.ts` 9 passed); no test is skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts pagination inside one tile with tile-indexed pages"
```

### Task 6.5: Error mapping through the real http-kit; HTTP limits

**Files:** create `src/travelpayouts/limits.ts`, `test/travelpayouts/errors.test.ts`; modify `src/travelpayouts/response.ts` (replace `readEnvelope`).

**Interfaces:** consumes `ProviderHttpLimits`, `ProviderLimits`, `TRAVELPAYOUTS_DEFAULTS`, `AbortedError`, `BudgetExceeded`, and WP4's default status table (through `createHttpKit`). Produces `travelpayoutsHttpLimits`, `TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE`, the final `readEnvelope`.

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

const limitOpts = { maxWaitSeconds: 5, requestTimeoutSeconds: 5 };
const limits = travelpayoutsHttpLimits(TRAVELPAYOUTS_DEFAULTS, limitOpts);

describe('travelpayoutsHttpLimits (spec §2, §5.3)', () => {
  it('is never billable, costs nothing, allows one host and keeps the default error table (no classifyError)', () => {
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
    expect(travelpayoutsHttpLimits({ ...TRAVELPAYOUTS_DEFAULTS, ratePerMinute: 900 }, limitOpts).ratePerMinute).toBe(600);
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

  it('401 plain-text Unauthorized (spec §2 fact 5) → tile-error auth, sent once', async () => {
    const { result, hits } = run(() => HttpResponse.text('Unauthorized', { status: 401 }));
    expect(await result).toMatchObject({ kind: 'tile-error', index: 0, error: { kind: 'auth', retryable: false, httpStatus: 401 } });
    expect(hits()).toBe(1);
  });

  it("400 → parse with the vendor's message as reason, sent once", async () => {
    const { result, hits } = run(() => HttpResponse.json({ error: 'departure_at is invalid' }, { status: 400 }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'departure_at is invalid', retryable: false } });
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

  it('success:false → parse with the vendor error as reason', async () => {
    const { result } = run(() => HttpResponse.json({ success: false, data: null, error: 'invalid destination' }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'vendor-error: invalid destination', retryable: false } });
  });

  it('success:false without a message still names vendor-error', async () => {
    const { result } = run(() => HttpResponse.json({ success: false }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'vendor-error: unspecified' } });
  });

  it.each([
    ['an array', []],
    ['success missing', { data: [] }],
    ['data not an array', { success: true, data: {} }],
    ['currency not a string', { success: true, data: [], currency: 7 }],
  ] as const)('a malformed envelope (%s) → parse', async (_label, body) => {
    const { result } = run(() => HttpResponse.json(body));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'parse', reason: 'malformed-envelope' } });
  });

  it('a non-JSON 200 body → parse', async () => {
    const { result } = run(() => HttpResponse.text('<html>maintenance</html>', { status: 200 }));
    expect(await result).toMatchObject({ kind: 'tile-error', error: { kind: 'parse' } });
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
 * per-provider host allowlist). Registered as HttpKitDeps.limits.travelpayouts by the wiring
 * (brief mismatch 6).
 */
import type { ProviderLimits } from '@gmt/core';
import type { ProviderHttpLimits } from '../http/httpKit.js';
import { TRAVELPAYOUTS_HOST } from './params.js';

/** Vendor per-minute ceiling for prices_for_dates (spec §2; docs/providers.md). */
export const TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE = 600;

/**
 * The configured limits, with the rate clamped to the vendor's ceiling; never billable, cost 0.
 * why: no classifyError hook. WP4's default status table already maps every Travelpayouts case
 * as spec §5.2 requires: 401 plain text → auth, 400 → parse with the vendor message, 402 → quota,
 * 404 → upstream, 429 → rate-limit (quota only at the plan cap, which BudgetExceeded pre-empts
 * for a free provider), 5xx → upstream. A hook would replace that whole table, including its
 * Retry-After and limiter-timeout handling, because the hook receives no headers (brief mismatch 7).
 */
export function travelpayoutsHttpLimits(
  limits: ProviderLimits,
  opts: { maxWaitSeconds: number; requestTimeoutSeconds: number },
): ProviderHttpLimits {
  return {
    hosts: [TRAVELPAYOUTS_HOST],
    ratePerMinute: Math.min(limits.ratePerMinute, TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE),
    ratePerHour: limits.ratePerHour,
    concurrency: limits.concurrency,
    billable: 'never',
    costPerCallMicroGbp: 0,
    maxWaitSeconds: opts.maxWaitSeconds,
    requestTimeoutSeconds: opts.requestTimeoutSeconds,
  };
}
```

In `packages/providers/src/travelpayouts/response.ts`, replace `readEnvelope` (and its doc comment) with:

```ts
/**
 * Spec §5.2 "Empty is per capability" (authorised-cached): a schema-valid success envelope is
 * returned as is (zero rows → no_data upstream); `success:false` → `vendor-error: <message>`;
 * anything else → `malformed-envelope`. Both failures become `parse` in fetchTile.
 */
export function readEnvelope(body: unknown): Envelope {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'malformed-envelope' };
  const b = body as Record<string, unknown>;
  if (b.success === false) {
    const vendor = typeof b.error === 'string' && b.error.length > 0 ? b.error.slice(0, 200) : 'unspecified';
    return { ok: false, reason: `vendor-error: ${vendor}` };
  }
  if (b.success !== true || !Array.isArray(b.data)) return { ok: false, reason: 'malformed-envelope' };
  if (b.currency !== undefined && typeof b.currency !== 'string') return { ok: false, reason: 'malformed-envelope' };
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

### Task 6.6: Dated parameter allowlist enforced on every request

**Files:** modify `src/travelpayouts/params.ts` (append), `src/travelpayouts/provider.ts` (one call inserted); create `test/travelpayouts/recorded.ts`, `test/travelpayouts/params.test.ts`.

**Interfaces:** produces `assertParamsAllowed`, `FORBIDDEN_PARAM_NAMES`, and the test loaders `loadAllowlistJson`, `loadRecordedPricesForDates`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/recorded.ts`:

```ts
/**
 * Loaders for WP4b's recorded Travelpayouts fixtures. Exchanges go through WP4's
 * loadRecordedFixture, which refuses files outside fixtures/recorded/, synthetic files and files
 * whose content hash no longer matches (spec §5.5). File shape: WP4b brief §5.3, where
 * request.url is origin + path and request.params holds the query.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecordedFixture } from '../../src/http/recorder.js';
import { PRICES_FOR_DATES_PATH } from '../../src/travelpayouts/params.js';

export const RECORDED_ROOT = fileURLToPath(new URL('../../fixtures/recorded/travelpayouts/', import.meta.url));

export interface RecordedExchange {
  readonly file: string;
  readonly url: URL;
  readonly status: number;
  readonly body: unknown;
}

function* jsonFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* jsonFiles(p);
    else if (p.endsWith('.json')) yield p;
  }
}

/**
 * The latest dated allowlist; file names sort by date.
 * why: read as plain JSON, because WP4b §5.4 writes the allowlist without the content hash that
 * WP4's loadRecordedJson requires (brief mismatch 10).
 */
export function loadAllowlistJson(): unknown {
  const latest = readdirSync(RECORDED_ROOT)
    .filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .at(-1);
  if (latest === undefined) throw new Error(`no params-<date>.json under ${RECORDED_ROOT} (WP4b writes it)`);
  return JSON.parse(readFileSync(join(RECORDED_ROOT, latest), 'utf8'));
}

/** Every recorded prices_for_dates exchange, in file-name order, with its full request URL rebuilt. */
export function loadRecordedPricesForDates(): RecordedExchange[] {
  const out: RecordedExchange[] = [];
  for (const file of jsonFiles(RECORDED_ROOT)) {
    const name = basename(file);
    // why: *.raw.json is the unredacted local copy (gitignored, WP4b §5.3); never read it.
    if (name.startsWith('params-') || name.endsWith('.raw.json')) continue;
    const f = loadRecordedFixture(file);
    if (f.endpointPath !== PRICES_FOR_DATES_PATH) continue;
    const url = new URL(f.request.url);
    for (const [k, v] of Object.entries(f.request.params)) url.searchParams.set(k, v);
    out.push({ file, url, status: f.status, body: f.body });
  }
  return out;
}
```

`packages/providers/test/travelpayouts/params.test.ts`:

```ts
import { asIata, asIsoMonth } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertParamsAllowed, parseTravelpayoutsAllowlist } from '../../src/travelpayouts/params.js';
import { buildRequestUrl } from '../../src/travelpayouts/provider.js';
import {
  ALLOWLIST_JSON,
  ALLOWLIST_PARAMS,
  allowlistWith,
  ctx,
  discoveryOf,
  ENDPOINT,
  makeHarness,
  makeProvider,
  only,
  query,
  server,
  TOKEN,
} from './harness.js';
import { loadAllowlistJson } from './recorded.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const allow = parseTravelpayoutsAllowlist(ALLOWLIST_JSON);
const tp = { origin: 'LON', members: new Set([asIata('LHR'), asIata('LGW')]), destination: asIata('JFK'), departureMonth: asIsoMonth('2027-03') };
const sent = (): URLSearchParams => buildRequestUrl(tp, 1).searchParams;
const { page: _page, ...withoutPage } = ALLOWLIST_PARAMS;

describe('parseTravelpayoutsAllowlist (spec §5.2: dated allowlist of names and values)', () => {
  it('parses the dated allowlist WP4b recorded, and it matches the hard-coded values', () => {
    const a = parseTravelpayoutsAllowlist(loadAllowlistJson());
    expect(a.fixed).toEqual({ one_way: 'false', currency: 'gbp', limit: '1000' });
    expect(Object.keys(a.dynamic).sort()).toEqual(['departure_at', 'destination', 'origin', 'page']);
  });

  it.each([
    ['a non-object', 'nope', /not an object/],
    ['another provider', allowlistWith(ALLOWLIST_PARAMS, { provider: 'searchapi' }), /provider must be travelpayouts/],
    ['a credential recorded other than in a header', allowlistWith(ALLOWLIST_PARAMS, { credential: 'query' }), /credential must be header/],
    ['a missing recordedAt', allowlistWith(ALLOWLIST_PARAMS, { recordedAt: 7 }), /recordedAt/],
    ['no prices_for_dates endpoint', allowlistWith(ALLOWLIST_PARAMS, { endpoints: [] }), /has no \/aviasales\/v3\/prices_for_dates endpoint/],
    ['a different fixed value', allowlistWith({ ...ALLOWLIST_PARAMS, currency: { fixed: ['usd'], observed: [] } }), /currency must be fixed to exactly gbp/],
    ['two allowed values', allowlistWith({ ...ALLOWLIST_PARAMS, currency: { fixed: ['gbp', 'usd'], observed: [] } }), /currency must be fixed to exactly gbp/],
    ['an extra parameter', allowlistWith({ ...ALLOWLIST_PARAMS, market: { fixed: ['uk'], observed: [] } }), /parameters .* differ/],
    ['a missing parameter', allowlistWith(withoutPage), /parameters .* differ/],
    ['a different value kind', allowlistWith({ ...ALLOWLIST_PARAMS, departure_at: { kind: 'iso-date', observed: [] } }), /departure_at must be of kind iso-month/],
  ] as const)('rejects %s', (_label, json, message) => {
    expect(() => parseTravelpayoutsAllowlist(json)).toThrow(message);
  });
});

describe('assertParamsAllowed (spec §5.2: names and values)', () => {
  it('accepts exactly what the adapter sends', () => {
    expect(() => assertParamsAllowed(allow, sent())).not.toThrow();
  });

  it.each([
    ['an extra parameter', (p: URLSearchParams) => p.set('sorting', 'price'), /sorting is not in the allowlist/],
    ['market (ignored by the vendor, spec §2 fact 1)', (p: URLSearchParams) => p.set('market', 'uk'), /market is forbidden/],
    ['trip_class (ignored by the vendor)', (p: URLSearchParams) => p.set('trip_class', '1'), /trip_class is forbidden/],
    ['return_at (month tiles send none)', (p: URLSearchParams) => p.set('return_at', '2027-03'), /return_at is forbidden/],
    ['a wrong fixed value', (p: URLSearchParams) => p.set('currency', 'usd'), /currency=usd is not the allowlisted value gbp/],
    ['a dynamic value off-pattern', (p: URLSearchParams) => p.set('departure_at', '2027-13'), /departure_at=2027-13 does not match/],
    ['a missing parameter', (p: URLSearchParams) => p.delete('page'), /page is missing/],
    ['a duplicated parameter', (p: URLSearchParams) => p.append('origin', 'LGW'), /origin appears twice/],
  ] as const)('fails on %s', (_label, mutate, message) => {
    const p = sent();
    mutate(p);
    expect(() => assertParamsAllowed(allow, p)).toThrow(message);
  });

  it('names a token parameter without echoing its value', () => {
    const p = sent();
    p.set('token', TOKEN);
    expect(() => assertParamsAllowed(allow, p)).toThrow(/token is forbidden/);
    let message = '';
    try {
      assertParamsAllowed(allow, p);
    } catch (e) {
      message = String(e);
    }
    expect(message).not.toContain(TOKEN);
  });
});

describe('requests on the wire', () => {
  it('carry exactly the allowlisted names and values, and the token only in X-Access-Token', async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        seen.push({ url: request.url, token: request.headers.get('x-access-token') });
        return HttpResponse.json({ success: true, data: [], currency: 'gbp' });
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    await d.fetchTile(only(d.plan(q)), q, ctx());
    const req = only(seen);
    const u = new URL(req.url);
    expect([...u.searchParams.keys()].sort()).toEqual(['currency', 'departure_at', 'destination', 'limit', 'one_way', 'origin', 'page']);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      origin: 'LHR',
      destination: 'JFK',
      departure_at: '2027-03',
      one_way: 'false',
      currency: 'gbp',
      limit: '1000',
      page: '1',
    });
    expect(req.token).toBe(TOKEN);
    expect(req.url).not.toContain(TOKEN);
    expect(() => assertParamsAllowed(parseTravelpayoutsAllowlist(loadAllowlistJson()), u.searchParams)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/params.test.ts`
Expected: FAIL with `does not provide an export named 'assertParamsAllowed'`.

- [ ] **Step 3: Implement**

Append to `packages/providers/src/travelpayouts/params.ts`:

```ts
/**
 * Names that must never be sent. `token`: the credential travels in X-Access-Token only (spec §2
 * fact 8). `market`, `trip_class`: ignored by the vendor (fact 1), so sending them would only
 * pretend to a point of sale or cabin. `return_at`: month tiles send none (spec §5.2).
 */
export const FORBIDDEN_PARAM_NAMES = ['token', 'market', 'trip_class', 'return_at'] as const;

/**
 * Fails closed unless `params` is exactly the allowlist: every name once, fixed values equal,
 * dynamic values matching their pattern, nothing missing and nothing extra (spec §5.2).
 * Messages never contain the value of a forbidden name.
 */
export function assertParamsAllowed(allowlist: TravelpayoutsParamsAllowlist, params: URLSearchParams): void {
  const seen = new Set<string>();
  for (const [name, value] of params) {
    if (seen.has(name)) throw new ParamsAllowlistError(`parameter ${name} appears twice`);
    seen.add(name);
    if ((FORBIDDEN_PARAM_NAMES as readonly string[]).includes(name)) {
      throw new ParamsAllowlistError(`parameter ${name} is forbidden`);
    }
    const fixed = allowlist.fixed[name];
    if (fixed !== undefined) {
      if (value !== fixed) throw new ParamsAllowlistError(`parameter ${name}=${value} is not the allowlisted value ${fixed}`);
      continue;
    }
    const pattern = allowlist.dynamic[name];
    if (pattern === undefined) throw new ParamsAllowlistError(`parameter ${name} is not in the allowlist`);
    if (!pattern.test(value)) throw new ParamsAllowlistError(`parameter ${name}=${value} does not match ${pattern.source}`);
  }
  for (const name of [...Object.keys(allowlist.fixed), ...Object.keys(allowlist.dynamic)]) {
    if (!seen.has(name)) throw new ParamsAllowlistError(`parameter ${name} is missing`);
  }
}
```

In `packages/providers/src/travelpayouts/provider.ts`, import `assertParamsAllowed` from `./params.js` (add it to the existing `./params.js` import), and in `fetchTile` insert directly after `const url = buildRequestUrl(tp, page);`:

```ts
      // why: fail closed before anything leaves the process (spec §5.2 allowlist of names and values).
      assertParamsAllowed(opts.paramsAllowlist, url.searchParams);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS. `params.test.ts` has 22 passed (11 parse, 10 assert, 1 wire), and every other file stays green. If `params.test.ts` fails on `loadAllowlistJson` with "no params-<date>.json", WP4b has not merged: stop and report, do not create the file.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts dated parameter allowlist enforced before every request"
```

### Task 6.7: Identity, non-economy `no_data` without HTTP, healthcheck, barrel

**Files:** replace `src/travelpayouts/provider.ts` with its final form; modify `src/index.ts`; create `test/travelpayouts/provider.test.ts`.

**Interfaces:** consumes `findBannedWords`, `Secret`. Produces the final `travelpayoutsProvider` and the barrel exports.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/provider.test.ts`:

```ts
import { findBannedWords, Secret } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as barrel from '../../src/index.js';
import { TRAVELPAYOUTS_INFO, TRAVELPAYOUTS_POINT_OF_SALE } from '../../src/travelpayouts/provider.js';
import { ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, NOW, only, query, server, TOKEN } from './harness.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('travelpayoutsProvider identity (spec §2, §5.1)', () => {
  it('is a discovery-only authorised-cached provider for economy', () => {
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

describe('non-economy definitions (spec §5.2: trip_class is ignored, so no_data with a note)', () => {
  it('plans the same tiles as economy and resolves them to no_data without any HTTP call', async () => {
    let hits = 0;
    server.use(
      http.get(ENDPOINT, () => {
        hits += 1;
        return HttpResponse.json({ success: true, data: [], currency: 'gbp' });
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query({ cabin: 'business' });
    const plans = d.plan(q);
    expect(plans).toEqual(d.plan(query()));
    const tile = only(plans);
    expect(await d.fetchTile(tile, q, ctx())).toEqual({
      kind: 'tile',
      index: 0,
      coveredCells: tile.coveredCells,
      fetchedAt: NOW,
      prices: [],
      noFares: [],
      notes: ['cabin-unsupported:business'],
    });
    expect(hits).toBe(0);
    expect(h.requests).toHaveLength(0);
    expect(h.budget.ledger.reservations).toHaveLength(0);
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
  it('exports the Travelpayouts surface', () => {
    expect(typeof barrel.travelpayoutsProvider).toBe('function');
    expect(typeof barrel.parseTravelpayoutsAllowlist).toBe('function');
    expect(barrel.TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE).toBe(600);
    expect(typeof barrel.travelpayoutsHttpLimits).toBe('function');
    expect(barrel.TRAVELPAYOUTS_POINT_OF_SALE).toBe('unknown');
    expect(barrel.TRAVELPAYOUTS_HOST).toBe('api.travelpayouts.com');
    expect(barrel.TRAVELPAYOUTS_INFO.sourceKind).toBe('authorised-cached');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/provider.test.ts`
Expected: FAIL. The barrel test fails with `expected 'undefined' to be 'function'`, the non-economy test fails because `hits` is 1, the TTL tests fail with "did not throw", and the healthcheck detail tests fail on the strings.

- [ ] **Step 3: Implement**

Replace `packages/providers/src/travelpayouts/provider.ts` with the final file:

```ts
/**
 * Travelpayouts / Aviasales Data API adapter (WP6). Spec §2 (Travelpayouts row, fact 1), §5.1,
 * §5.2, §6.9. Discovery only: cached round-trip prices from /aviasales/v3/prices_for_dates, one
 * month tile per (origin or shared metro, destination, departure month), every page through
 * http-kit. Returns raw vendor shapes; the engine normalises (spec §5.6). No airport is named
 * here (spec §1).
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
import type { HttpKit, HttpKitResponse } from '../http/httpKit.js';
import {
  assertParamsAllowed,
  FIXED_PARAMS,
  PRICES_FOR_DATES_PATH,
  TRAVELPAYOUTS_HOST,
  type TravelpayoutsParamsAllowlist,
} from './params.js';
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
/** Spec §2 fact 1: trip_class is ignored, so economy only. */
export const TRAVELPAYOUTS_CABINS: readonly Cabin[] = ['economy'];
/** Spec §2: market is ignored, so the point of sale is unknown on every price (brief mismatch 3). */
export const TRAVELPAYOUTS_POINT_OF_SALE = 'unknown' as const;
/** Spec §5.2: limit=1000 per page. */
export const PAGE_LIMIT = 1000;
/** Hard stop on pages per tile; a tile that reaches it says so in notes. */
export const MAX_PAGES = 50;

export interface TravelpayoutsProviderOptions {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  token: Secret;
  paramsAllowlist: TravelpayoutsParamsAllowlist;
  airports: MetroLookup;
  /** Response cache window, from TRAVELPAYOUTS_CACHE_TTL_HOURS (spec §5.3 "TTLs from config"; brief mismatch 5). */
  cacheTtlSeconds: number;
}

/** The request URL for one page of a tile. The token never appears here (spec §2 fact 8: header only). */
export function buildRequestUrl(tp: TileParams, page: number): URL {
  const url = new URL(`https://${TRAVELPAYOUTS_HOST}${PRICES_FOR_DATES_PATH}`);
  url.searchParams.set('origin', tp.origin);
  url.searchParams.set('destination', tp.destination);
  url.searchParams.set('departure_at', tp.departureMonth);
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

  const parseError = (reason: string): ProviderError =>
    new ProviderError({ kind: 'parse', retryable: false, reason, providerId: 'travelpayouts', message: `travelpayouts response unusable: ${reason}` });

  function tileError(plan: TilePlan, error: ProviderError): DiscoveryTileResult {
    lastError = error;
    log.warn({ tileIndex: plan.index, kind: error.kind, reason: error.reason ?? null }, 'travelpayouts tile failed');
    return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error };
  }

  /**
   * Spec §5.2: one tile, all of its pages (limit=1000, page=1..n until a short page), each sent
   * through http-kit with the tile's index so the ledger counts tiles for parity.
   */
  async function fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
    if (q.cabin !== 'economy') {
      // why: spec §2 fact 1 and §5.2. trip_class is ignored by the vendor, so a request would return
      // economy prices under a premium label; no_data with a note, and nothing is sent (brief mismatch 8).
      return {
        kind: 'tile',
        index: plan.index,
        coveredCells: plan.coveredCells,
        fetchedAt: opts.clock.now(),
        prices: [],
        noFares: [],
        notes: [`cabin-unsupported:${q.cabin}`],
      };
    }
    const tp = tileParams(plan, opts.airports);
    const rows: unknown[] = [];
    let currency: string | null = null;
    let fetchedAt: IsoDateTime | undefined;
    let pages = 0;
    let truncated = false;
    for (let page = 1; ; page += 1) {
      const url = buildRequestUrl(tp, page);
      // why: fail closed before anything leaves the process (spec §5.2 allowlist of names and values).
      assertParamsAllowed(opts.paramsAllowlist, url.searchParams);
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
      if (!env.ok) return tileError(plan, parseError(env.reason));
      if (env.currency !== null) {
        if (currency !== null && currency !== env.currency) return tileError(plan, parseError('currency-changed-between-pages'));
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
    if (rows.length === 0) {
      // Spec §5.2 "Empty is per capability": every covered cell is no_data; no currency needed (brief mismatch 13).
      return { kind: 'tile', index: plan.index, coveredCells: plan.coveredCells, fetchedAt, prices: [], noFares: [], notes: ['rows-received:0', `pages:${pages}`] };
    }
    const cur = resolveCurrency(currency);
    if (!cur.ok) return tileError(plan, parseError(cur.reason));
    const attribution = attributeRows(rows, {
      coveredCells: plan.coveredCells,
      members: tp.members,
      destination: tp.destination,
      minNights: q.minNights,
      maxNights: q.maxNights,
      currency: cur.code,
      exponent: cur.exponent,
    });
    const notes = attributionNotes(attribution, rows.length, pages);
    if (truncated) notes.push(`pages-truncated:${MAX_PAGES}`);
    // why: a cache never proves "no fares", so noFares is always empty (spec §5.2 authorised-cached).
    return { kind: 'tile', index: plan.index, coveredCells: plan.coveredCells, fetchedAt, prices: attribution.prices, noFares: [], notes };
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
    discovery: { info: TRAVELPAYOUTS_INFO, plan: (q) => planMonthTiles(q, opts.airports), fetchTile },
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
export {
  assertParamsAllowed,
  ParamsAllowlistError,
  PRICES_FOR_DATES_PATH,
  parseTravelpayoutsAllowlist,
  TRAVELPAYOUTS_HOST,
  type TravelpayoutsParamsAllowlist,
} from './travelpayouts/params.js';
export { TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE, travelpayoutsHttpLimits } from './travelpayouts/limits.js';
export type { MetroLookup } from './travelpayouts/tiles.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS. `provider.test.ts` has 9 passed, and every earlier file stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts identity, economy-only no_data, healthcheck and barrel"
```

### Task 6.8: Recorded fixtures replay; `suppliedFields` from recordings

**Files:** modify `src/travelpayouts/response.ts` (append `suppliedFieldsOfRow`); create `test/travelpayouts/replay.test.ts`.

**Interfaces:** consumes WP4b's recorded fixtures and allowlist through `test/travelpayouts/recorded.ts`. Produces `suppliedFieldsOfRow`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/replay.test.ts`:

```ts
import { asIata, asIsoDate, cellKeyString, type IsoDate } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertParamsAllowed, parseTravelpayoutsAllowlist, TRAVELPAYOUTS_HOST } from '../../src/travelpayouts/params.js';
import { TRAVELPAYOUTS_SUPPLIED_FIELDS } from '../../src/travelpayouts/provider.js';
import { suppliedFieldsOfRow } from '../../src/travelpayouts/response.js';
import { cellsFor, ctx, discoveryOf, ENDPOINT, makeHarness, makeProvider, only, query, server } from './harness.js';
import { loadAllowlistJson, loadRecordedPricesForDates, type RecordedExchange } from './recorded.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const recorded = loadRecordedPricesForDates();
const ok = recorded.filter((x) => x.status === 200);

/** Recorded pages grouped into tiles by (origin, destination, departure month). */
const tiles = new Map<string, RecordedExchange[]>();
for (const x of ok) {
  const key = ['origin', 'destination', 'departure_at'].map((n) => x.url.searchParams.get(n) ?? '?').join('|');
  tiles.set(key, [...(tiles.get(key) ?? []), x]);
}

function rowsOf(x: RecordedExchange): unknown[] {
  const b = x.body as { data?: unknown } | null;
  return b !== null && Array.isArray(b.data) ? b.data : [];
}

function lastDayOf(month: string): IsoDate {
  const [y, m] = month.split('-').map(Number);
  if (y === undefined || m === undefined) throw new Error(`bad month ${month}`);
  // why: UTC arithmetic on a calendar month, never local time (spec §6.1).
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return asIsoDate(`${month}-${String(day).padStart(2, '0')}`);
}

describe('recorded Travelpayouts fixtures (WP4b) replay through msw', () => {
  it('exist for prices_for_dates, carry rows, and target the public host', () => {
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.some((x) => rowsOf(x).length > 0)).toBe(true);
    for (const x of recorded) expect(x.url.hostname).toBe(TRAVELPAYOUTS_HOST);
  });

  it.each([...tiles.entries()])('tile %s: plan().length equals msw hits, every price attributed inside the tile', async (key, pages) => {
    const [origin, destination, month] = key.split('|');
    if (origin === undefined || destination === undefined || month === undefined) throw new Error(`bad key ${key}`);
    const hits: string[] = [];
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        hits.push(page ?? '?');
        const match = pages.find((p) => p.url.searchParams.get('page') === page);
        return match === undefined
          ? HttpResponse.text('no recorded page', { status: 404 })
          : HttpResponse.json(match.body as Record<string, unknown>);
      }),
    );
    // why: the worked example's metro (LON = LHR, LGW) is the only metro the recordings use (spec §1).
    const members = origin === 'LON' ? [asIata('LHR'), asIata('LGW')] : [asIata(origin)];
    const dest = asIata(destination);
    const from = asIsoDate(`${month}-01`);
    const to = lastDayOf(month);
    const cells = cellsFor(members, [dest], from, to, 0, 90);
    const first = members[0] ?? asIata(origin);
    const q = query({ origin: first, destination: dest, departureFrom: from, departureTo: to, minNights: 0, maxNights: 90, cells });
    const d = discoveryOf(makeProvider(makeHarness()));
    const plans = d.plan(q);
    expect(plans).toHaveLength(1);
    const r = await d.fetchTile(only(plans), q, ctx());
    if (r.kind !== 'tile') throw new Error(`replay of ${key} failed: ${r.error.kind} ${r.error.reason ?? ''}`);
    expect(hits).toHaveLength(pages.length);
    const covered = new Set(r.coveredCells.map(cellKeyString));
    for (const p of r.prices) {
      expect(covered.has(cellKeyString(p))).toBe(true);
      expect(p.currency).toBe('GBP');
      expect(Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0).toBe(true);
      expect('providerObservedAt' in p).toBe(false);
      if (p.vendorLink !== undefined) expect(new URL(p.vendorLink).hostname).toBe('www.aviasales.com');
    }
    const received = pages.reduce((n, x) => n + rowsOf(x).length, 0);
    const dropped = r.notes.filter((n) => n.startsWith('dropped:')).reduce((n, s) => n + Number(s.split(':')[2]), 0);
    expect(r.notes).toContain(`rows-received:${received}`);
    expect(r.prices.length + dropped).toBe(received);
  });

  it('the recorded 401 (invalid token, TP-20) replays as tile-error auth (spec §2 fact 5)', async () => {
    const unauthorised = recorded.find((x) => x.status === 401);
    if (unauthorised === undefined) throw new Error('WP4b recorded no Travelpayouts 401');
    const body = unauthorised.body;
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
    const fields = new Set(ok.flatMap((x) => rowsOf(x).flatMap((row) => suppliedFieldsOfRow(row))));
    expect([...fields].sort()).toEqual([...TRAVELPAYOUTS_SUPPLIED_FIELDS].sort());
  });

  it('spike fact 1 holds on the recordings: origin_airport and return_at on every row, no found_at, currency gbp', () => {
    for (const x of ok) {
      expect((x.body as { currency?: unknown }).currency).toBe('gbp');
      for (const row of rowsOf(x)) {
        const r = row as Record<string, unknown>;
        expect(typeof r.origin_airport).toBe('string');
        expect(typeof r.return_at).toBe('string');
        expect(r).not.toHaveProperty('found_at');
      }
    }
  });

  it('recorded requests satisfy the dated allowlist, names and values', () => {
    const allow = parseTravelpayoutsAllowlist(loadAllowlistJson());
    for (const x of recorded) expect(() => assertParamsAllowed(allow, x.url.searchParams)).not.toThrow();
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
 * The constraint inputs a prices_for_dates row actually supplies (spec §5.2: suppliedFields
 * from recorded fixtures only).
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
Expected: PASS. Every file is green and `replay.test.ts` has `5 + <recorded 200 tiles>` passed (24 with WP4b's TP-01…TP-19). If a recorded tile fails with `currency` other than `gbp`, `return_at` missing, or `segments` reported, stop and report it as a spike-fact divergence. Do not change the assertion.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts recorded fixtures replay; suppliedFields from recordings"
```

## 9. Pinned review-focus tests

None. The plan's five Review Focus lines are owned by WP0, WP1, WP2, WP3, WP7, WP8, WP9 and WP10. One test here guards an adjacent risk: Review Focus 1 (metro codes). In WP6 a metro code is only ever a vendor query parameter taken from the airports table, never operator input. Task 6.3's "never collapses a single origin to its metro" and "ignores a metro code that is not three upper-case letters" pin that.

## 10. Definition of done

- `pnpm --filter @gmt/providers test` passes every test file. Coverage on `packages/providers/src` meets lines 85 / branches 70 / functions 85 / statements 85, with no "threshold not met" line.
- `pnpm --filter @gmt/providers exec vitest run test/travelpayouts` passes eight files with no skipped test.
- `pnpm lint` reports no diagnostics.
- `pnpm -r typecheck` exits 0.
- `node scripts/check-boundaries.mjs` exits 0 (`@gmt/providers` imports only `@gmt/core`, and no `process.env`).
- `pnpm secret-scan` exits 0.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/providers/src` prints nothing (no airport in code, spec §1).
- `grep -rn "token=" packages/providers/src/travelpayouts` prints nothing (header only, spec §2 fact 8).
- `git log --oneline main..HEAD` shows the eight `wp06:` commits of Tasks 6.1–6.8.

## 11. Open questions

None requiring operator judgement. The thirteen mismatches in §3 are contract findings for Fable to settle in the plan, in particular 1, 2, 3, 5, 7, 8 and 10. This brief compiles and runs against the frozen contracts as written, so it is dispatchable once its review passes.
