---
wp: 6
title: Travelpayouts adapter
owner: sonnet
depends_on: [1, 2, 4, 4b]
spec_sections: ["§2", "§3", "§5.1", "§5.2", "§5.3", "§6.9", "§8.1", "§9 item 2"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, provenance-auditor, cost-and-budget-reviewer]
status: draft
---

# WP6: Travelpayouts adapter

Reconciled with spec revision 15 and the plan's "Global Constraints", "Cross-package contracts" and "Decisions taken at reconciliation" 1–29 (2026-10-15), and with the code merged on `main` at `a001e0d`. Every code block in this brief was assembled on a scratch worktree of that commit and run green (§10 lists the result).

Decisions that shape this brief: 6 (allowlist constant equals the recorded file), 8 (single-file test runs), 14 (allowlist in WP4, cache key without execution or tile ids), 15 (`classifyError` over `ResponseFacts`, cache `accept` hook, `syntheticAllowed`, `rateLimitFallbackWaitSeconds`, the `as*` helpers as the only brand mint sites), 17 (replay filters by recording session), 18 and 20 (one guarded msw server per package, synthetic labelled 429s), 19 (the closed priced-reason set: `offers-dropped:n`), 24 (shared adapter helpers, the dropped-row rule, the tile as the ledger unit, stateless healthchecks, the rev 14 metro rule), 26 (the recorder pages at most 3 per tile, which `MAX_PAGES` matches), 27 (WP6 merges before WP5, which consumes `src/shared/`), 28 (records this brief's core and http-kit additions and its parse rules), 29 (a currency core does not know is `currency-unsupported` per cell, never a tile-level error; `parseError(cause, detail, where)` with `where` always given; the shared `NoteCounter` with `add`/`get`/`list` is the only note helper). Decisions 16, 21, 22, 23 and 25 do not touch WP6 beyond what the merged code already carries. Spec rev 15 changes SearchApi only. `RawOffer.verified` (decisions 27, 29) is WP5's addition, not this brief's.

## 1. Goal

Build `travelpayoutsProvider(...)`, a discovery-only `FlightProvider` that turns cached Aviasales round-trip prices from `/aviasales/v3/prices_for_dates` into raw, cell-keyed calendar prices, and the shared adapter helpers (`majorToMinor`, `parseError`, `NoteCounter`) that WP5 consumes.

- There is one month tile per (origin, destination) pair and departure month.
- The request uses the metro code only when two or more of the definition's origins map to that metro; a lone airport is queried by its own code (spec §2, §5.2 rev 14).
- Sibling pairs that share a metro are deduplicated by the response cache, and the ledger counts one row per tile.
- The adapter reports every covered cell it received a row for but could not price, and every cell it did not finish reading, through `cellIssues`; a capped tile is marked `truncated`. That a reported cell never reaches the operator as `no_data` depends on WP7 applying `cellIssues` before its `no_data` fallback (decision 28; the WP7 rule is in §13).
- Nothing is defaulted and nothing is invented.

## 2. Scope

**In**

- `packages/providers/src/shared/` (Task 6.1), used by this adapter and by WP5:
  - `money.ts`: `majorToMinor(major, currency)`;
  - `errors.ts`: `parseError(cause, detail, where)`, `parseVendor(schema, body, cause, where)`, `ParseWhere`;
  - `notes.ts`: `NoteCounter`;
  - the fixture provider moved onto both (its private parse-error builder and its `dropped-out-of-band` note go), so the package has one parse-error rule and one notes grammar (Task 6.1).
- `packages/providers/src/travelpayouts/`:
  - month tiling per pair (`plan`);
  - the rev 14 metro-or-airport `origin` parameter;
  - row attribution by response dates, filtered to the pair, with per-cell reports of rows dropped for a covered cell;
  - pagination inside `fetchTile`, with a page cap that reports unread cells;
  - envelope, row and currency checks with zod;
  - the vendor-link prefix and check;
  - `TRAVELPAYOUTS_PARAMS` (a code constant asserted equal to the recorded allowlist file);
  - `travelpayoutsHttpLimits` (vendor ceiling 600/min, no `classifyError`, so WP4's default table applies);
  - identity fields and a stateless healthcheck that sends no request.
- Three type-only contract additions in `packages/core/src/ports/provider.ts` (Task 6.2): `DiscoveryQuery.definitionOrigins?`, `CellIssue` / `DiscoveryTileResult.cellIssues?`, and `DiscoveryTileResult.truncated?`. Decision 28 records the first two; §13 lists `truncated` and the spec §5.1 fold.
- One optional field in http-kit (Task 6.5): `HttpKitRequest.ledgerCacheHit?`, so a cached multi-page tile is one cache-hit row.
- One entry each in `apps/api/src/wiring.ts` `httpLimitsFor` and `providersFor` (plan, "Wiring and bootstraps").
- Tests:
  - every adapter test runs the real http-kit over `test/fakes.ts` (`makeKit`, `FakeBudget`, `FakeCache`, `CapturingLogger`, `SENTINELS`, `TP`) and the package's one guarded msw server (`test/support/msw.ts`), which `test/support/setup.ts` installs with `installNetworkGuards` (plan decisions 18 and 20);
  - replay of WP4b's recorded fixtures through `replayHandlers` with the recording session;
  - synthetic-shape tests, labelled, for cases that were not recorded;
  - a wiring test in `apps/api/test/wiring/`.
- Barrel exports from `packages/providers/src/index.ts`: only the plan contract's `travelpayoutsProvider`, `travelpayoutsHttpLimits` and `TRAVELPAYOUTS_PARAMS`, each with its consumer named. Everything else, the shared helpers included, stays package-internal (WP5 imports `../shared/*.js`).
- Per-directory coverage floors for `src/travelpayouts/**` and `src/shared/**` in `packages/providers/vitest.config.ts` (Task 6.7).

**Runs before WP4b merges.** Tasks 6.1–6.7 need nothing from WP4b and are implemented and committed first. Tasks 6.8 (the allowlist file), 6.9 (the recordings) and 6.10 (`apps/api/src/wiring.ts`) are blocked until WP4b is on `main`: stop after Task 6.7 if it is not, and never write recordings, an allowlist file or a wiring module by hand.

**Out** (owner in brackets)

- `ParamsAllowlist`, `loadParamsAllowlist`, `assertRequestAllowed` (`src/params/allowlist.ts`) [WP4].
- http-kit pipeline [WP4]: retries, `Retry-After`, the limiter (including its queue-age deadline, tested in WP4's `limiter.test.ts`), egress allowlist, cache keys, scrubbing, the recorder, the default status table. Also `@gmt/providers/testing` (`loadRecorded`, `replayHandlers`, `verifyRecordedTree`, `installNetworkGuards`).
- Recording the fixtures and writing `params-<date>.json` [WP4b].
- `buildPorts`, and `httpLimitsFor`/`providersFor` other than the Travelpayouts entries [WP4b, WP8].
- Engine rules [WP7]:
  - setting `DiscoveryQuery.definitionOrigins` from the snapshot's origins;
  - applying `cellIssues`: `priced` with `offers-dropped:n` when the tile also priced the cell, else `error` with the issue's `reason` and `detail` in `last_error`;
  - labelling the prices of a `truncated` tile "cheapest of the rows read";
  - the `cabin-not-offered` rule: a provider whose `cabins` excludes the definition's cabin is never called;
  - FX conversion and the `fx.converted` flag, normalisation, and `min_pence` per tile;
  - stamping provenance from `pointOfSale` and `sourceKind`;
  - cell outcome writes; parity measurement.
- Core helpers [WP2]: `validateVendorUrl`, `LINK_ALLOWLIST`, `searchLinkFor` (the Aviasales search link the UI shows when `booking` is `none`, spec §6.9), `MINOR_EXPONENT`.
- `generateCells`, `monthOf`, `toEpochDay`, `fromEpochDay` [WP1]. `cellKeyString`, `isoDateTimeOfEpochMs` [WP0].
- `AirportsRepo.metroOf` and the attributed metro list [WP3].
- The coverage-check route [WP7 `coverageCheck`, WP8 route].

## 3. Spec sections

- **§2 Travelpayouts row.** The endpoint is `/aviasales/v3/prices_for_dates`, with month tiles (`departure_at=YYYY-MM`, `one_way=false`, no `return_at`), paginated at 1000. Origin is an airport code, or the metro code when the definition's origins share one; rows split by `origin_airport`.
  - It is authorised and cached from Aviasales user searches in the last 48 h. It has no `found_at`, ignores `market`, and is economy only.
  - It is free at 600/min. `sourceKind` is `authorised-cached` and `maxAgeHours` is 48.
- **§2 fact 1.** `origin_airport` is on every row. `currency=gbp` is honoured. `market` and `trip_class` are ignored. There is no `found_at`.
- **§2 consequences.** Adapters return raw vendor shapes, and currency is read from the response: a response that states no currency is a `parse` error. Rows for airports outside the pair are dropped. `providerObservedAt` is set only when the vendor states it.
- **§3 cell outcomes.** `no_data` means the call covered the cell and had nothing cached. `priced` notes `offers-dropped:n`; `error` carries the kind or a normalisation reason, never vendor text, which goes to `last_error`.
- **§5.1.** `TileRequest` has `{ kind: 'month'; month }`. `DiscoveryTileResult` `'tile'` carries `pointOfSale`. `BudgetGuard.reserve` and `recordCacheHit` carry `tileIndex`.
- **§5.2 (rev 14).**
  - Tiles partition the cells; `plan` is pure and deterministic.
  - The query is per pair. `origin` is the pair origin's metropolitan code when two or more of the definition's origins map to that metro, else the airport code.
  - Rows are attributed by `origin_airport` and filtered to the pair and the nights band.
  - Identical metro requests from sibling pairs are answered by the response cache. The worked example gives 28 tiles, 14 upstream calls and 14 cache hits.
  - Pages are fetched inside one `fetchTile`, each ledgered under the tile's index; parity counts tiles.
  - Cell keys come from the response, and entries outside the tile or the band are dropped and counted in `notes`.
  - Empty is per capability: a valid empty envelope gives `no_data`; a malformed envelope or `success:false` gives `parse`.
  - `plan(q).length` is the estimate. `suppliedFields` come from recorded fixtures.
  - `currency=gbp` only and `pointOfSale: 'unknown'`. The adapter declares `cabins: ['economy']`.
  - The dated allowlist covers names and values.
  - Errors follow the table, with the vendor message in `last_error`, never in `reason`; a 429 without `Retry-After` waits Travelpayouts' configured 60 s.
  - Vendor links must match the `aviasales.com` allowlist.
- **§5.3.** Cache hits are ledgered non-billable rows; a joiner of an in-flight request records its own row; an adapter may veto caching a body it cannot parse.
- **§6.9.** The row's `vendorLink` is the vendor's own Aviasales link for that row, validated and carried as raw data; it is a search link (it may search the metro), never a fare link. The link the UI labels "search link, not a fare link" comes from core's `searchLinkFor`, not from this adapter.
- **§8.1 normalisation row.** Offers that fail are dropped and counted `offers-dropped:n` on a `priced` outcome; `error` with the reason only when no offer survives. A currency core does not know is `currency-unsupported` (spec §3, plan decision 29): the adapter drops those rows per cell, never fails the tile.
- **§9 item 2.** Tiles partition cells. `plan().length` matches the ledger (upstream tiles plus cache-hit rows). Response-date keying is tested. The empty envelope gives `no_data`. Currency comes from the response. `suppliedFields` come from recorded fixtures. Parameter names and values match the dated allowlist.

### Mismatches (reported, not papered over)

1. **Rate limit stated twice.** Spec §2 gives 600/min (the vendor ceiling), while spec §12 and `TRAVELPAYOUTS_DEFAULTS` give 200/min. Both hold: `travelpayoutsHttpLimits` keeps the configured value and clamps it to 600.
2. **The FX assertion is not WP6's.** §9 item 2 says "a non-GBP response asserts conversion and the FX flag", but conversion is WP7 normalisation (§5.6, WP7 Task 7.5). Here the vendor's lower-case code (`usd`) is upper-cased to ISO 4217 and amounts pass through unconverted.
3. **Empty envelope and currency (settled).** Spec §2 is applied as written: every success envelope must state a currency, the empty one included. Task 6.9 checks WP4b's recordings: every recorded 200 states `gbp`. If the recorded empty envelope (TP-19) states none, stop and report; the spec's escape clause ("unless a recorded fixture proves the vendor's convention") then needs a ruling.
4. **`TRAVELPAYOUTS_PARAMS` copies two values from the recording.** `recordedAt` and `contentSha256` exist only once WP4b has recorded. Task 6.8 Step 3 prints them from the file and the implementer writes them into the constant; it is the one literal this brief cannot show.
5. **Wiring structure.** WP4b's `providersFor` builds an `out` array with `push`, and `httpLimitsFor` returns an object literal (WP4b brief Task "wiring"). Task 6.10 adds one block to each.
6. **The testing subpath is imported by relative path.** Inside `@gmt/providers` it is `../../src/testing/index.js`, because the package `exports` point at `dist/`. It is the same module.

## 4. Interfaces consumed

Spec §5.1 (revision 14) and the merged `packages/core/src/ports/provider.ts`, the parts this package uses. The two `+` fields are the additions Task 6.2 makes (type-only, optional):

```ts
export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface DiscoveryQuery {
  origin: Iata; destination: Iata;
  departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number;
  cabin: Cabin; currency: 'GBP';
  cells?: CellKey[];               // when set, discovery.plan RE-PLANS over this subset (fewer calls); tiles still partition it
  definitionOrigins?: Iata[];      // + Task 6.2: the definition's origins (spec §2, §5.2 rev 14); absent → the pair origin alone
}
export interface TilePlan { index: number; coveredCells: CellKey[]; request: TileRequest }
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };
export interface CellIssue { cell: CellKey; reason: ErrorReason; offersDropped: number; detail: string }   // + Task 6.2
export interface RawCalendarPrice extends CellKey { amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string }
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[];
      cellIssues?: CellIssue[]; truncated?: boolean }   // + Task 6.2
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
  recentCalls(providerId: ProviderId, since: IsoDateTime): number;
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }
```

Core `errors.ts` and `types/execution.ts` (WP0, merged):

```ts
export type ProviderErrorKind = 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout';
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind; readonly reason: string | undefined; readonly retryable: boolean;
  readonly httpStatus: number | undefined; readonly retryAfterSeconds: number | undefined; readonly providerId: ProviderId | 'fx' | undefined;
  constructor(p: { kind: ProviderErrorKind; retryable: boolean; message: string; reason?: string; httpStatus?: number; retryAfterSeconds?: number; providerId?: ProviderId | 'fx' });   // the message is URL-stripped
}
export class BudgetExceeded extends Error { /* scope, cap, current, requested, providerId? */ }
export class AbortedError extends Error {}
export type NormalisationReason = 'fx-unavailable' | 'currency-unsupported' | 'unknown-airport-tz' | 'no-return-legs' | 'unmappable-carrier' | 'bad-local-time' | 'cell-mismatch';
export type ErrorReason = ProviderErrorKind | NormalisationReason;   // the closed error-reason list; "The vendor message goes to lastError, never to reason"
export function stripControlChars(s: string, replacement?: string): string;   // text/control.ts
```

Plan, "Cross-package contracts", and the merged code they name:

```ts
// types/ids.ts (WP0)
export type Iata = string & { readonly __brand: 'Iata' };  export type IsoDate = …;  export type IsoMonth = …;  export type IsoDateTime = …;
export const iataSchema: z.ZodType<Iata, string>;         // trims, upper-cases, then requires ^[A-Z]{3}$
export const isoDateSchema: z.ZodType<IsoDate, string>;   // regex + real calendar date check (rejects 2027-02-29)
export function asIata(s: string): Iata; export function asIsoDate(s: string): IsoDate; export function asIsoMonth(s: string): IsoMonth;
export function asIsoDateTime(s: string): IsoDateTime; export function isoDateTimeOfEpochMs(ms: number): IsoDateTime;
export function cellKeyString(c: CellKey): string;
// types/itinerary.ts, types/provenance.ts (WP0)
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';
// ports/logger.ts, ports/clock.ts (WP0)
export interface Logger { debug(o: object, msg?: string): void; info(…): void; warn(…): void; error(…): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
// config (WP0): Secret { reveal(): string }; ProviderLimits { …; ratePerMinute; ratePerHour; concurrency; cacheTtlHours; … };
// TRAVELPAYOUTS_DEFAULTS: cap 50000/mo, 200/min, 10000/h, concurrency 4, TTL 6h, cost 0; Config.providers.travelpayouts: { token: Secret; limits: ProviderLimits } | null;
// Config.maxWaitSeconds; Config.requestTimeoutSeconds; parseConfig(env, { realpath }): ConfigResult.
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;

// Core domain functions (WP1, WP2)
export function toEpochDay(d: IsoDate): number; export function fromEpochDay(n: number): IsoDate; export function monthOf(d: IsoDate): IsoMonth;
export function generateCells(space: ResolvedSpace): Cell[];   // ResolvedSpace { origins; destinations; departureFrom; departureTo; minNights; maxNights }
export const MINOR_EXPONENT: Record<string, number>;           // the 30 ECB currencies; ISK, JPY, KRW → 0, the rest → 2
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export function validateVendorUrl(url: string, allowlist: readonly string[]): Booking;

// Database (WP3, merged): export class AirportsRepo { constructor(db: Db); metroOf(iata: string): string | null; … }
// @gmt/db also exports openDatabase(path), applyMigrations(db, dir), MIGRATIONS_DIR (used by the wiring test).

// http-kit types (@gmt/providers src/http/types.ts, WP4, merged; re-exported from the barrel)
export interface ResponseFacts { status: number; body: unknown; headers: Headers; providerId: HttpProviderId; endpointPath: string }
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never';
  costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; rateLimitFallbackWaitSeconds?: number;
  classifyError?: (f: ResponseFacts) => ProviderError | undefined }   // undefined → the default spec §5.2 table
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<HttpProviderId, ProviderHttpLimits>>; clock: Clock; log: Logger;
  secrets: Secret[]; syntheticAllowed: boolean; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
export interface HttpKitRequest { providerId: HttpProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL;
  headers: Record<string, string>; body?: string; cache: { ttlSeconds: number; accept?: (body: unknown) => boolean } | 'never'; signal: AbortSignal; recordFixtures: boolean;
  ledgerCacheHit?: boolean }   // + Task 6.5
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
// src/http/httpKit.ts: createHttpKit(deps: HttpKitDeps): HttpKit; MAX_ATTEMPTS = 3; BACKOFF_BASE_MS = 1000.
// src/http/recorder.ts: RecordedFixture { recordedAt; recordedBy; providerId; endpointPath; request: { method; url; headers; body }; status; body; placeholders;
//   responseHeaders: Record<string, string>; session: string; contentSha256 }; canonicalJson(v): string; defaultRecordedRoot(): string.
// src/params/allowlist.ts: ParamsAllowlist { provider; recordedAt: IsoDate; endpoints: Record<string, { names: string[]; values: Record<string, string[] | 'any'> }>; contentSha256 };
//   loadParamsAllowlist(path, root?); assertRequestAllowed(allowlist, endpointPath, url) (throws ParamsNotAllowedError).
// src/util.ts: isRecord(v); zodReason(error: z.ZodError): string; parseOrThrow(schema, value, where).
// '@gmt/providers/testing' (src/testing/index.ts): installNetworkGuards, guardedServer, takeStrays, hangUntilAborted, respondAfter,
//   loadRecorded(root, providerId, endpointPath): RecordedFixture[] (recordedAt order); replayHandlers(root, { session? }): { handlers; misses() };
//   verifyRecordedTree(root, secrets?): string[].

// Package test support (packages/providers/test, merged): fakes.ts makeKit({ limits?, overrides?, secrets?, syntheticAllowed?, budget? }) → { kit, budget: FakeBudget,
//   cache: FakeCache, log: CapturingLogger, clock, events: LedgerEvent[] }; FakeBudget (ordered reserve/finalise/cache-hit/fetch events, refuse hook, open());
//   testLimits(); SENTINELS.travelpayouts; TP (the prices_for_dates URL); support/msw.ts server (= guardedServer), hangUntilAborted;
//   support/time.ts useFakeTime(), drive(p); support/guards.ts obj, arr, str, asProviderError; support/setup.ts (installNetworkGuards + "no open reservation" after each test).

// Adapter constructor and exports (plan; WP6 implements these exactly)
export function travelpayoutsProvider(o: { http: HttpKit; log: Logger; clock: Clock; token: Secret; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist; airports: { metroOf(iata: Iata): string | null } }): FlightProvider;
export function travelpayoutsHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;   // hosts ['api.travelpayouts.com'], billable 'never'; no classifyError
export const TRAVELPAYOUTS_PARAMS: ParamsAllowlist;

// Wiring (apps/api src/wiring.ts, WP4b)
export function httpLimitsFor(config: Config): HttpKitDeps['limits'];
export function providersFor(config: Config, deps: { http: HttpKit; log: Logger; clock: Clock; airports: AirportsRepo }): FlightProvider[];
```

Plan decision 24 (verbatim, the part this brief implements): "Shared adapter helpers live once in @gmt/providers: `shared/money.ts` `majorToMinor(major, currency)` (exact decimal-string arithmetic over core's MINOR_EXPONENT; null for excess precision or a non-positive amount, and the row is dropped and counted `offers-dropped:n`); `shared/errors.ts` `parseError(cause, detail)` whose `reason` is the closed-list kind-level reason and whose URL-free message carries the machine cause. A covered cell whose every row was dropped becomes `error` with the normalisation reason (spec §8.1). The ledger's unit is the tile: a sibling pair records one cache-hit row per tile, never per page. Healthchecks are stateless and probe nothing … The Travelpayouts metro query follows spec rev 14 §5.2. … `clock` stays in every adapter constructor."

## 5. Interfaces produced

Only `travelpayoutsProvider`, `travelpayoutsHttpLimits` and `TRAVELPAYOUTS_PARAMS` are exported from the `@gmt/providers` barrel (the plan contract; arch-008's rule that every barrel export names its consumer). Every other name below is package-internal: WP5 imports `src/shared/*` by relative path.

```ts
// shared/money.ts (WP5 and WP6)
export function majorToMinor(major: number, currency: string): number | null;   // exact; null: not finite positive, excess decimals, > MAX_SAFE_INTEGER minor units, unknown currency

// shared/errors.ts (WP5 and WP6)
export interface ParseWhere { providerId: ProviderId; endpointPath: string }
export function parseError(cause: string, detail: string | null, where: ParseWhere): ProviderError;
//   kind 'parse', retryable false, reason 'parse' (closed-list, kind-level), message `<provider> <path>: <detail or cause> [<cause>]` (control chars removed, detail ≤ 200, URL-stripped)
export function parseVendor<S extends z.ZodType>(schema: S, body: unknown, cause: string, where: ParseWhere): z.output<S>;   // throws parseError(cause, <failed fields>)

// shared/notes.ts (WP5 and WP6)
export class NoteCounter { add(key: string, n?: number): void; get(key: string): number; list(): string[] }   // `key:n`, sorted by key, zero counts omitted

// travelpayouts/params.ts
export const TRAVELPAYOUTS_HOST: 'api.travelpayouts.com';
export const PRICES_FOR_DATES_PATH: '/aviasales/v3/prices_for_dates';
export const PAGE_LIMIT: 1000;                                                                           // internal
export const FIXED_PARAMS: { readonly one_way: 'false'; readonly currency: 'gbp'; readonly limit: '1000' };   // internal; limit derived from PAGE_LIMIT
export const FORBIDDEN_PARAM_NAMES: readonly ['token', 'market', 'trip_class', 'return_at'];             // internal
export const TRAVELPAYOUTS_PARAMS: ParamsAllowlist;                                                       // Task 6.8

// travelpayouts/limits.ts
export const TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE: 600;
export const TRAVELPAYOUTS_RATE_LIMIT_FALLBACK_WAIT_SECONDS: 60;                                          // internal
export function travelpayoutsHttpLimits(limits: ProviderLimits, cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;

// travelpayouts/provider.ts
export const TRAVELPAYOUTS_INFO: CapabilityInfo;                       // { sourceKind: 'authorised-cached', maxAgeHours: 48, provenanceNote }
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[];  // ['price']
export const TRAVELPAYOUTS_CABINS: readonly Cabin[];                   // ['economy']
export const TRAVELPAYOUTS_POINT_OF_SALE: 'unknown';
export interface TravelpayoutsProviderOptions { http: HttpKit; log: Logger; clock: Clock; token: Secret; cacheTtlSeconds: number; paramsAllowlist: ParamsAllowlist; airports: MetroLookup }
export function travelpayoutsProvider(o: TravelpayoutsProviderOptions): FlightProvider;   // id 'travelpayouts', displayName 'Aviasales cache'
export const MAX_PAGES: 3;                                                                 // internal
export function buildRequestUrl(tp: TileParams, page: number): URL;                        // internal

// travelpayouts/tiles.ts (internal except MetroLookup)
export interface MetroLookup { metroOf(iata: Iata): string | null }
export interface TileParams { readonly origin: string; readonly pairOrigin: Iata; readonly destination: Iata; readonly month: IsoMonth }
export function originParam(q: DiscoveryQuery, airports: MetroLookup): string;
export function cellsOf(q: DiscoveryQuery): CellKey[];
export function planMonthTiles(q: DiscoveryQuery): TilePlan[];
export function tileParams(plan: TilePlan, q: DiscoveryQuery, airports: MetroLookup): TileParams;

// travelpayouts/response.ts (internal)
export const WHERE: ParseWhere;                                         // { providerId: 'travelpayouts', endpointPath: PRICES_FOR_DATES_PATH }
export interface ResponseCurrency { code: string; exponent: number | null }   // null: core knows no exponent (plan decision 29)
export interface Envelope { rows: readonly unknown[]; currency: ResponseCurrency }
export function currencyOf(raw: string | undefined): ({ ok: true } & ResponseCurrency) | { ok: false; cause: 'currency-missing' | 'currency-malformed'; detail: string | null };
export function readEnvelope(body: unknown): Envelope;                  // throws parseError
export function cacheableBody(body: unknown): boolean;                  // HttpKitRequest.cache.accept: true iff readEnvelope would accept
export const AVIASALES_BASE: 'https://www.aviasales.com';
export function vendorLinkFor(link: unknown): string | null;
export function observedAt(foundAt: unknown): IsoDateTime | null;
export interface AttributionInput { coveredCells: readonly CellKey[]; origin: Iata; destination: Iata; minNights: number; maxNights: number; currency: ResponseCurrency }
export interface Attribution { prices: RawCalendarPrice[]; cellIssues: CellIssue[]; notes: NoteCounter }
export function attributeRows(rows: readonly unknown[], input: AttributionInput): Attribution;   // throws parseError('malformed-row')
```

**Parse causes** (the bracketed machine word at the end of a `parse` error's message; `reason` is always `'parse'`): `malformed-envelope`, `vendor-error`, `currency-missing`, `currency-malformed`, `currency-changed-between-pages`, `malformed-row`, `page-repeated`.

**Cell-issue detail tags** (the bracketed word at the end of `CellIssue.detail`): `bad-price` (reason `parse`: a row price `majorToMinor` refuses), `currency-unsupported` (reason `currency-unsupported`: the response currency has no exponent in core). Unread cells of a capped tile carry reason `upstream` and detail `pagination truncated at 3 pages`.

**Notes vocabulary** (`DiscoveryTileResult.notes`, through `NoteCounter`: `key:n`, sorted, zero counts omitted): `dropped-one-way`, `dropped-other-destination`, `dropped-other-origin`, `dropped-outside-band`, `dropped-outside-tile`, `link-rejected`, `offers-dropped`, `pages`, `pages-truncated`, `rows-received`.

**Semantics WP7 relies on.**

- A covered cell with no price and no `cellIssues` entry in a `tile` result is `no_data`: the vendor returned no row for it on this query. (Whether a month query returns every cached return date for a departure day or collapses some is not documented; Task 6.9 stops if the recordings show only one return date per departure day.)
- A `cellIssues` entry is applied per cell: `priced` with `offers-dropped:<offersDropped>` when the tile also returned a price for that cell, else `error` with `reason` (`parse` for unusable rows, `currency-unsupported` for rows in a currency core does not know, `upstream` for cells left unread by the page cap) and `detail` in `last_error`. Never `no_data`.
- `truncated: true` means the tile stopped at `MAX_PAGES`: each priced cell carries the cheapest of the rows read, not necessarily the cache's minimum, and WP7 labels it so. It does not depend on the vendor's sort order.
- `noFares` is always `[]`, because a cache never proves that no fares exist.
- Several prices may share a cell, and the engine keeps the minimum (spec §5.6).
- `providerObservedAt` is set only when a row states `found_at`; spike fact 1 says rows carry none.
- `currency` is the envelope's code upper-cased; every page states it. A code core has no exponent for prices nothing: its in-cell rows become `currency-unsupported` issues.
- `fetchedAt` is the oldest page's; a cache hit's is the original `storedAt`.
- `pointOfSale` is `'unknown'` on every tile.
- A tile can cost 1 to `MAX_PAGES` upstream calls (one per 1000-row page, all under its `tile_index`); `plan().length` counts tiles, not calls. A tile served from the cache is one cache-hit row whatever its page count (`ledgerCacheHit`). The one case parity can still miscount: page 1 from the cache and a later page upstream (the TTL expired between two pages of one tile), which counts that tile twice.
- `vendorLink` is the vendor's own search link for the row; on a metro query it may search the metro rather than the cell's airport.

## 6. Library notes

Verified on 2026-10-15.

- **Travelpayouts Data API, `/aviasales/v3/prices_for_dates`.** `support.travelpayouts.com` answered HTTP 403 to every automated fetch on 2026-10-14, so the endpoint was verified from Travelpayouts' own published Postman collection "Travelpayouts Data API" (postman.com/travelpayouts, collection `16826686-bfa85f3b-c07c-42f6-8ac3-2021f453b4fc`, read as JSON), and the help-centre facts come from `docs/providers.md`, which cites the articles.
  - **Parameters:** `origin` ("IATA code of a city or an airport"), `destination`, `departure_at` ("2006-01 or 2006-01-02 format"), `return_at`, `unique`, `sorting`, `direct`, `currency` (default `rub`), `market`, `limit` ("Allowed value from 1 to 1000"), `page`, `one_way`. `trip_class` is not a parameter of this endpoint.
  - **Token:** "in the X-Access-Token header or in the token parameter". The adapter uses the header only.
  - **Envelope:** `{ "currency": "rub", "data": [...], "success": true }`.
  - **Row fields:** `airline`, `departure_at` (local with offset, `2021-09-14T08:55:00+03:00`), `destination`, `destination_airport`, `duration`, `flight_number`, `link` (relative path), `origin`, `origin_airport`, `price` (integer, major unit, in the sample), `return_at`, `return_transfers`, `transfers`. Task 6.9 pins the recorded key set to this list.
  - **Freshness:** prices_for_dates holds prices "found by users in last 48h" (`docs/providers.md`, help article 203956163). That is the vendor's declared horizon; rows carry no timestamp (spike fact 1), so the provenance note says "declared by vendor" and `maxAgeHours: 48` is never shown as a measured age. The same article lists `found_at`, `expires_at` and `actual`; the spike found no `found_at`, and Task 6.9's key pin fails if any of the three appears, so a human decides (the adapter already reads `found_at` into `providerObservedAt` when present).
  - **Round trip and passengers:** the vendor describes `one_way=false` results as round-trip ("back-to-back") prices; that description, like the 48 hours, is attributed to the vendor in the provenance note. The vendor states no passenger count, so the note names none (plan ruling: stated only if the docs state it); WP13's live smoke compares one recorded row with the vendor's own search page (decision 27).
  - **Page cap and sort order:** no worked-example month has been measured (the spike's four to six rows a month were on routes to a thin long-haul destination); `MAX_PAGES` is the recorder's cap (decision 26), and Task 6.9 stops if a recorded tile reached it. The default `sorting` of prices_for_dates is undocumented and the allowlist sends none, so a capped tile is marked `truncated` instead of trusting that unread pages hold dearer rows.
  - **Rate limit:** 600 per minute for `/v3/prices_for_dates` (`docs/providers.md`, help article 4402565416594). No 429 was recorded; `Retry-After` is unverified and every 429 test is labelled synthetic (plan decision 20).
  - **Times:** the sample row is local time with an explicit offset. One general vendor note says times are UTC, so the adapter accepts a bare date or a time with an explicit `±HH:MM` offset and refuses `Z` or offset-less times as `malformed-row`; Task 6.9 asserts on WP4b's recordings that every `departure_at`/`return_at` carries an offset and that some row's two offsets differ (a transatlantic round trip in local time). The local-date reading rests on that assertion, not on the docs. One month-boundary case is unknown: if the vendor buckets `departure_at=YYYY-MM` by UTC date, a London departure just after local midnight on the 1st (00:30 BST is 23:30 UTC on the last day of the previous month) comes back in the previous month's tile, is dropped there as `dropped-outside-tile`, and its own cell reads `no_data`. Task 6.9's report counts such rows.
  - **Not verifiable from the docs:** the passenger count a price is for; the default sort order; whether a month query without `return_at` returns every cached return date per departure day; `return_at` on rows (the sample is one-way); error bodies (null in the collection; the 401 plain-text body is spike fact 5, and the `success:false` + `error` string shape is an assumption whose other shapes fall to `malformed-envelope`); the public host (the collection's base URL is internal). Task 6.9 asserts `return_at` and the host on the recordings.
- **zod 4.6.7** (a dependency of `@gmt/providers` since WP4; the package's recorder, allowlist and fixture loaders already parse untrusted JSON with it through `util.ts`). Used: `z.object`, `z.discriminatedUnion('success', […])`, `z.literal`, `z.array`, `z.string().regex`, `z.unknown()`, `.optional()`, `.nullish()`, `.transform(...)`, `.pipe(isoDateSchema)`, `safeParse`, `z.infer`, `z.output`, `z.ZodType`. Core's `iataSchema` and `isoDateSchema` mint the brands, so no value is cast.
- **msw 3.0.3.** Handlers only: `http.get(url, resolver)` and `HttpResponse` from `msw/http`, `HttpResponse.json(body, init?)`, `new HttpResponse(text, { status, headers })`, `HttpResponse.error()`. No test creates a server: every handler goes on the package's guarded server (`test/support/msw.ts` re-exports `guardedServer`) with `server.use`, and `test/support/setup.ts` owns `listen`, `resetHandlers` and `close` and fails any test that left a stray request (plan decisions 18 and 20).
- **vitest 5.0.4.** `describe`, `it`, `it.each`, `it.skipIf`, `expect` (`toEqual`, `toMatchObject`, `toContainEqual`, `toHaveLength`, `toBeLessThanOrEqual`, `rejects.toBeInstanceOf`, `expect.objectContaining`, `expect.stringContaining`, `expect.any`), `beforeEach`/`afterEach`, `vi.useRealTimers`; fake time through `test/support/time.ts` (`useFakeTime`, `drive`), as WP4's tests do. Single files run with `pnpm --filter @gmt/providers exec vitest run <file>` (plan decision 8).

Every API above was checked by compiling and running this brief's code against the installed versions in a scratch worktree of `main` on 2026-10-15. There is no new dependency.

## 7. Files

Create:

- `packages/providers/src/shared/money.ts`, `errors.ts`, `notes.ts`
- `packages/providers/src/travelpayouts/params.ts`, `tiles.ts`, `response.ts`, `limits.ts`, `provider.ts`
- `packages/providers/test/shared/money.test.ts`, `errors.test.ts`, `notes.test.ts`
- `packages/providers/test/http/ledgerCacheHit.test.ts`
- `packages/providers/test/travelpayouts/harness.ts`, `recorded.ts`
- `packages/providers/test/travelpayouts/empty.test.ts`, `response.test.ts`, `tiles.test.ts`, `fetchTile.test.ts`, `errors.test.ts`, `provider.test.ts`, `wire.test.ts`, `params.test.ts`, `replay.test.ts`
- `apps/api/test/wiring/travelpayouts.test.ts`

Modify:

- `packages/core/src/ports/provider.ts` (three optional fields and `CellIssue`, Task 6.2)
- `packages/providers/src/http/types.ts`, `src/http/httpKit.ts` (`ledgerCacheHit`, Task 6.5)
- `packages/providers/src/index.ts` (barrel, Tasks 6.7 and 6.8)
- `packages/providers/src/fixture/provider.ts`, `test/fixture/provider.test.ts` (shared `parseError` and `NoteCounter`, Task 6.1)
- `packages/providers/test/barrel.test.ts` (the shared helpers stay out of the main barrel, Task 6.7)
- `packages/providers/vitest.config.ts` (per-directory coverage floors, Task 6.7)
- `apps/api/src/wiring.ts` (`httpLimitsFor`, `providersFor`, Task 6.10)

Read (produced by WP4b):

- `packages/providers/fixtures/recorded/travelpayouts/params-<yyyy-mm-dd>.json`
- the recorded `prices_for_dates` exchanges under `packages/providers/fixtures/recorded/travelpayouts/_aviasales_v3_prices_for_dates/`

## 8. Tasks

### Task 6.1: Shared adapter helpers (`majorToMinor`, `parseError`, `NoteCounter`)

The helpers every adapter uses, defined once (plan decisions 24 and 29). WP5 imports them from `../shared/*.js` (decision 29 makes them the only parse and note helpers), and this task moves the merged fixture provider onto them, so the package has one parse-error rule (`reason` is the kind-level `'parse'`, `where` always given) and one notes grammar.

**Files:** create `src/shared/money.ts`, `src/shared/errors.ts`, `src/shared/notes.ts` and `test/shared/money.test.ts`, `errors.test.ts`, `notes.test.ts`; modify `src/fixture/provider.ts` and `test/fixture/provider.test.ts` (all under `packages/providers/`).

**Interfaces:**

- Consumes `MINOR_EXPONENT`, `ProviderError`, `ErrorReason`, `ProviderId`, `stripControlChars` (core) and `zodReason` (`src/util.ts`).
- Produces `majorToMinor`, `parseError`, `parseVendor`, `ParseWhere`, `NoteCounter`; the fixture provider's parse errors gain `reason: 'parse'` and its drop note becomes `dropped-outside-tile:n`.

- [ ] **Step 1: Write the failing tests**

`packages/providers/test/shared/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { majorToMinor } from '../../src/shared/money.js';

describe('majorToMinor (plan decision 24; spec §6.3: integer minor units, no float money, never rounded)', () => {
  it.each([
    [412, 'GBP', 41200],
    [412.5, 'GBP', 41250],
    [412.55, 'GBP', 41255],
    [0.29, 'GBP', 29],
    [0.01, 'GBP', 1],
    [1.1, 'USD', 110],
    [61000, 'JPY', 61000],
    [9007199254740.99, 'GBP', 900719925474099],
  ] as const)('%d %s → %i', (major, currency, expected) => {
    expect(majorToMinor(major, currency)).toBe(expected);
  });

  it.each([
    ['excess precision', 412.555, 'GBP'],
    ['a fraction of a yen', 61000.5, 'JPY'],
    ['zero', 0, 'GBP'],
    ['negative', -5, 'GBP'],
    ['NaN', Number.NaN, 'GBP'],
    ['infinite', Number.POSITIVE_INFINITY, 'GBP'],
    ['exponent form (tiny)', 1e-7, 'GBP'],
    ['exponent form (huge)', 1e21, 'GBP'],
    ['beyond the safe integer range', 1e17, 'GBP'],
    ['a currency with no known exponent', 412, 'QQQ'],
    ['a lower-case code (callers upper-case first)', 412, 'gbp'],
  ] as const)('null for %s', (_label, major, currency) => {
    expect(majorToMinor(major, currency)).toBeNull();
  });
});
```

`packages/providers/test/shared/errors.test.ts`:

```ts
import { ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseError, parseVendor } from '../../src/shared/errors.js';
import { asProviderError } from '../support/guards.js';

const where = { providerId: 'travelpayouts', endpointPath: '/aviasales/v3/prices_for_dates' } as const;

describe('parseError (plan decision 24: one shared parse error, consistent with the fixture provider)', () => {
  it("is a non-retryable parse error whose reason is the kind-level 'parse' and whose message carries the cause", () => {
    const e = parseError('currency-missing', null, where);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({
      kind: 'parse',
      retryable: false,
      reason: 'parse',
      providerId: 'travelpayouts',
    });
    expect(e.message).toBe(
      'travelpayouts /aviasales/v3/prices_for_dates: currency-missing [currency-missing]',
    );
  });

  it('puts vendor detail in the message only, URL-stripped, control characters removed, capped at 200 characters', () => {
    const e = parseError(
      'vendor-error',
      `bad\nrequest https://api.example.test/x?token=abc ${'y'.repeat(300)}`,
      where,
    );
    expect(e.reason).toBe('parse');
    expect(e.message).not.toContain('\n');
    expect(e.message).not.toContain('token=abc');
    expect(e.message).toContain('https://api.example.test/x');
    expect(e.message.endsWith(' [vendor-error]')).toBe(true);
    expect(e.message.length).toBeLessThan(260);
  });
});

describe('parseVendor (zod over untrusted vendor JSON, no casts)', () => {
  const schema = z.object({ success: z.literal(true), data: z.array(z.unknown()) });

  it('returns the typed value', () => {
    expect(parseVendor(schema, { success: true, data: [1] }, 'malformed-envelope', where)).toEqual({
      success: true,
      data: [1],
    });
  });

  it('throws parseError naming the failed fields, never their values', () => {
    let caught: unknown;
    try {
      parseVendor(schema, { success: true, data: 'secret-looking-value' }, 'malformed-envelope', where);
    } catch (e) {
      caught = e;
    }
    const e = asProviderError(caught);
    expect(e).toMatchObject({ kind: 'parse', reason: 'parse' });
    expect(e.message).toContain('data:');
    expect(e.message).toContain('[malformed-envelope]');
    expect(e.message).not.toContain('secret-looking-value');
  });
});
```

`packages/providers/test/shared/notes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NoteCounter } from '../../src/shared/notes.js';

describe('NoteCounter (plan decision 24: one notes grammar for every adapter)', () => {
  it('counts keys, ignores zero counts, and lists `key:n` sorted by key', () => {
    const n = new NoteCounter();
    n.add('rows-received', 3);
    n.add('dropped-outside-band');
    n.add('dropped-outside-band');
    n.add('offers-dropped', 0);
    expect(n.get('dropped-outside-band')).toBe(2);
    expect(n.get('offers-dropped')).toBe(0);
    expect(n.list()).toEqual(['dropped-outside-band:2', 'rows-received:3']);
  });
});
```

In `packages/providers/test/fixture/provider.test.ts`, change the drop-note expectation from `notes: ['dropped-out-of-band:42'],` to `notes: ['dropped-outside-tile:42'],`, and the parse tile-error expectation from `error: { kind: 'parse', reason: undefined, message: expect.stringContaining(`[${code}]`) },` to:

```ts
      // why: the adapter's own parse errors carry the kind-level reason (shared parseError, plan decision 29); http-kit's
      // non-JSON body error leaves it unset, and the engine records `reason ?? kind` = 'parse' for both.
      error: {
        kind: 'parse',
        reason: code === 'malformed-json' ? undefined : 'parse',
        message: expect.stringContaining(`[${code}]`),
      },
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/shared test/fixture/provider.test.ts`
Expected: FAIL, `Test Files  4 failed (4)`, `Tests  5 failed | 28 passed (33)`: the three shared files with `Error: Cannot find module '../../src/shared/<money|errors|notes>.js'`, and in the fixture provider test the drop-note case and the four adapter parse cases (`[missing-currency]`, `[not-synthetic]`, `[pair-mismatch]`, `[malformed-entry]`) with `AssertionError: expected { kind: 'tile-error', … } to match object …`.

- [ ] **Step 3: Implement**

`packages/providers/src/shared/money.ts`:

```ts
/**
 * Vendor money to integer minor units, shared by every adapter (plan decision 24; spec §6.3: "No float ever holds
 * money"). WP5 (SearchApi) and WP6 (Travelpayouts) both convert through this one function.
 */
import { MINOR_EXPONENT } from '@gmt/core';

/** A plain decimal literal: digits, optionally a point and more digits. No sign, no exponent. */
const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * A vendor's major-unit amount (`412.5` GBP) as integer minor units (`41250`) with core's ISO 4217 exponent.
 * Returns null when the amount is not a finite positive number, carries more decimals than the currency has
 * (`412.555` GBP), is beyond `Number.MAX_SAFE_INTEGER` minor units, or the currency has no known exponent (callers
 * resolve the currency first: an unknown currency is a response-level parse error, not a row drop). Never rounds.
 * Callers drop a null row and count it `offers-dropped:n` (spec §8.1).
 * why: exact decimal-string arithmetic. `String(n)` is the shortest decimal that reads back as the same double, which
 * for any amount a vendor writes in JSON is the literal it wrote; multiplying by 100 instead gives 0.29 × 100 =
 * 28.999…, and Math.round would hide a third decimal the vendor really sent.
 */
export function majorToMinor(major: number, currency: string): number | null {
  const exponent = MINOR_EXPONENT[currency];
  if (exponent === undefined || !Number.isFinite(major) || major <= 0) return null;
  // why: String() switches to exponent form below 1e-6 and from 1e21; neither is a price, so both are refused here.
  const m = PLAIN_DECIMAL.exec(String(major));
  if (m === null) return null;
  const whole = m[1] ?? '';
  const fraction = m[2] ?? '';
  if (fraction.length > exponent) return null;
  const minor = BigInt(`${whole}${fraction.padEnd(exponent, '0')}`);
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minor);
}
```

`packages/providers/src/shared/errors.ts`:

```ts
/**
 * The one way an adapter reports a response it cannot use (plan decision 24; spec §5.2 "malformed → parse").
 * Shared by WP5 (SearchApi), WP6 (Travelpayouts) and the fixture provider, and shaped like http-kit's errors: a
 * URL-free message ending in a bracketed machine cause.
 */
import { type ErrorReason, ProviderError, type ProviderId, stripControlChars } from '@gmt/core';
import type { z } from 'zod';
import { zodReason } from '../util.js';

/** Where the response came from; prefixes the message the way http-kit's errors do (`travelpayouts /path: …`). */
export interface ParseWhere {
  providerId: ProviderId;
  endpointPath: string;
}

/** The kind-level reason from core's closed ErrorReason list (spec §3); the engine writes it to `cell_outcomes.reason`. */
const PARSE: ErrorReason = 'parse';
/** Longest vendor detail kept in a message (the same bound http-kit's vendorMessage uses). */
const MAX_DETAIL = 200;

/**
 * A non-retryable `parse` ProviderError. `reason` is always 'parse' (the kind-level reason; spec §3: the outcome
 * reason holds the kind or a normalisation reason, never vendor text). The machine `cause` (`malformed-envelope`,
 * `currency-missing`, …) and the vendor `detail` go in the message, which the engine writes, URL-stripped, to
 * `last_error`: `<provider> <path>: <detail or cause> [<cause>]`. `where` is always given (plan decision 29), so every
 * parse error names its provider, as http-kit's errors do.
 * why: control characters are removed and the detail is capped, because vendor text ends up in logs and the UI.
 */
export function parseError(cause: string, detail: string | null, where: ParseWhere): ProviderError {
  const text = detail === null ? cause : stripControlChars(detail, ' ').slice(0, MAX_DETAIL);
  return new ProviderError({
    kind: 'parse',
    retryable: false,
    reason: PARSE,
    message: `${where.providerId} ${where.endpointPath}: ${text} [${cause}]`,
    providerId: where.providerId,
  });
}

/**
 * Validates an untrusted vendor body with a zod schema and returns the typed result (brands come from the schema,
 * never a cast; plan decision 15), or throws `parseError(cause, <failed fields>)`. The detail names fields and
 * problems only, never vendor values.
 */
export function parseVendor<S extends z.ZodType>(
  schema: S,
  body: unknown,
  cause: string,
  where: ParseWhere,
): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw parseError(cause, zodReason(r.error), where);
  return r.data;
}
```

`packages/providers/src/shared/notes.ts`:

```ts
/**
 * Tile and search notes (`DiscoveryTileResult.notes`, `ItinerarySearchResult.notes`), one grammar for every adapter
 * (plan decision 24): `<key>:<n>`, sorted by key, zero counts omitted. Spec §5.2: every dropped entry is counted.
 */
export class NoteCounter {
  readonly #counts = new Map<string, number>();

  /** Adds `n` (default 1) to `key`; a count of zero or less is ignored. */
  add(key: string, n = 1): void {
    if (n > 0) this.#counts.set(key, (this.#counts.get(key) ?? 0) + n);
  }

  /** The count for `key` (0 when never added). */
  get(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  /** `key:n` strings sorted by key (code-unit order, locale-independent). */
  list(): string[] {
    return [...this.#counts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, n]) => `${k}:${n}`);
  }
}
```

In `packages/providers/src/fixture/provider.ts`, add to the imports:

```ts
import { parseError as sharedParseError } from '../shared/errors.js';
import { NoteCounter } from '../shared/notes.js';
```

replace the private `parseError` (its doc comment says `reason` stays unset, which decision 24 reverses) with:

```ts
/**
 * Parse failure through the shared builder (plan decisions 24 and 29): `reason` is the kind-level 'parse' and the
 * message is `fixture <path>: <code> [<code>]`.
 */
function parseError(endpointPath: string, code: string): ProviderError {
  return sharedParseError(code, null, { providerId: 'fixture', endpointPath });
}
```

insert after `if (fetchedAt === undefined) throw new Error('fetchTile: no page fetched');` in `fetchTile`:

```ts
    // why: one notes grammar in the package (shared NoteCounter); an entry for no covered cell is outside this tile.
    const notes = new NoteCounter();
    notes.add('dropped-outside-tile', dropped);
```

and change the returned `notes: dropped > 0 ? [`dropped-out-of-band:${dropped}`] : [],` to `notes: notes.list(),`. The message text of every fixture parse error is unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/providers exec vitest run test/shared test/fixture`
Expected: PASS, `Test Files  6 passed (6)`, `Tests  96 passed (96)` (24 shared: 19 money, 4 errors, 1 notes; the fixture files stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: shared adapter helpers (majorToMinor, parseError, NoteCounter); fixture provider moved onto them"
```

### Task 6.2: Empty envelope → `no_data` (first failing adapter test); contract additions

**Files:**

- Modify `packages/core/src/ports/provider.ts` (two optional fields and `CellIssue`; type-only).
- Create `src/travelpayouts/params.ts` (Task 6.8 appends `TRAVELPAYOUTS_PARAMS`), `tiles.ts` (first cut; Task 6.4 replaces `originParam`), `response.ts` (first cut; Task 6.3 completes it), `provider.ts` (first cut; Tasks 6.5 and 6.7 complete it).
- Create `test/travelpayouts/harness.ts` (final; later tasks import from it) and `test/travelpayouts/empty.test.ts`.

**Interfaces:**

- Consumes `createHttpKit` through `test/fakes.ts` `makeKit`, `generateCells`, `monthOf`, `assertRequestAllowed`, `parseVendor`, `parseError`, `NoteCounter`, and the §4 types.
- Produces `DiscoveryQuery.definitionOrigins`, `CellIssue`, `DiscoveryTileResult.cellIssues`, `DiscoveryTileResult.truncated`, `planMonthTiles`, `tileParams`, `cellsOf`, `originParam` (first cut), `readEnvelope`, `currencyOf`, `cacheableBody`, `buildRequestUrl` and `travelpayoutsProvider` (first cut).

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/harness.ts` (final):

```ts
/**
 * Test harness for the Travelpayouts adapter (WP6), built on the package's shared fakes (test/fakes.ts: FakeBudget,
 * FakeCache, CapturingLogger, SENTINELS, testLimits, TP) and the shared guarded msw server (test/support/msw.ts,
 * installed by test/support/setup.ts). Every test runs the REAL http-kit pipeline; only the BudgetGuard and
 * ResponseCache ports are fakes, and setup.ts checks after every test that no reservation was left open.
 */
import {
  asIata,
  asIsoDate,
  BudgetExceeded,
  type CellKey,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type Iata,
  type ProviderContext,
  type ProviderError,
} from '@gmt/core';
import type { HttpKit, HttpKitRequest, ProviderHttpLimits } from '../../src/http/types.js';
import type { ParamsAllowlist } from '../../src/params/allowlist.js';
import {
  type TravelpayoutsProviderOptions,
  travelpayoutsProvider,
} from '../../src/travelpayouts/provider.js';
import type { MetroLookup } from '../../src/travelpayouts/tiles.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { type LedgerEvent, makeKit, SENTINELS, testLimits } from '../fakes.js';

/** The sentinel token (test/fakes.ts SENTINELS.travelpayouts; briefs README: secrets in tests are sentinels). */
export const TOKEN = SENTINELS.travelpayouts;
/** makeKit's fixed clock start. */
export const NOW = '2026-10-14T15:00:00.000Z';

export interface Harness extends ReturnType<typeof makeKit> {
  /** The kit, spied so a test can read every request the adapter made (tileIndex, ledgerCacheHit included). */
  http: HttpKit;
  requests: HttpKitRequest[];
}

/**
 * The real http-kit with only Travelpayouts limits and `syntheticAllowed: false` (the adapter never depends on the
 * synthetic gate). `limits` replaces the limits whole (for example travelpayoutsHttpLimits' output); otherwise
 * `overrides` adjust testLimits().travelpayouts. `refuse: true` makes every reserve throw BudgetExceeded;
 * `refuse: n` refuses from the n-th reserve on (FakeBudget counts reserves before asking the hook).
 */
export function makeHarness(
  o: { limits?: ProviderHttpLimits; overrides?: Partial<ProviderHttpLimits>; refuse?: boolean | number } = {},
): Harness {
  // why: 60 000/min makes the limiter's smoothing gap 1 ms (testLimits' 600/min spaces requests 100 ms apart), so
  // multi-tile tests stay fast; tests about rates pass their own limits.
  const k = makeKit({
    syntheticAllowed: false,
    limits: {
      travelpayouts: o.limits ?? {
        ...testLimits().travelpayouts,
        ratePerMinute: 60_000,
        ratePerHour: 3_600_000,
        ...o.overrides,
      },
    },
  });
  const from = o.refuse === true ? 1 : typeof o.refuse === 'number' ? o.refuse : null;
  if (from !== null) {
    k.budget.refuse = () =>
      k.budget.reserveCalls >= from
        ? new BudgetExceeded({
            scope: 'execution-free-calls',
            cap: 0,
            current: 0,
            requested: 1,
            providerId: 'travelpayouts',
          })
        : null;
  }
  const requests: HttpKitRequest[] = [];
  // why: a spy around the real kit records each request without replacing the pipeline under test.
  const http: HttpKit = {
    request: (r) => {
      requests.push(r);
      return k.kit.request(r);
    },
    stats: () => k.kit.stats(),
  };
  return { ...k, http, requests };
}

/** Ledger events of one type, in order (FakeBudget records every reserve, finalise, cache hit and fetch). */
export function eventsOf<T extends LedgerEvent['type']>(
  h: Harness,
  type: T,
): Array<Extract<LedgerEvent, { type: T }>> {
  return h.events.filter((e): e is Extract<LedgerEvent, { type: T }> => e.type === type);
}

/** Synthetic stand-in for AirportsRepo.metroOf over the worked example only (London → New York). */
export const airports: MetroLookup = {
  metroOf: (iata) =>
    iata === 'LHR' || iata === 'LGW' ? 'LON' : iata === 'JFK' || iata === 'EWR' ? 'NYC' : null,
};
export const noMetro: MetroLookup = { metroOf: () => null };

/** Synthetic allowlist in the plan's ParamsAllowlist shape (not the recorded one; Task 6.8 tests that). */
export const ALLOWLIST: ParamsAllowlist = {
  provider: 'travelpayouts',
  recordedAt: asIsoDate('2026-10-14'),
  endpoints: {
    '/aviasales/v3/prices_for_dates': {
      names: ['currency', 'departure_at', 'destination', 'limit', 'one_way', 'origin', 'page'],
      values: {
        currency: ['gbp'],
        departure_at: 'any',
        destination: 'any',
        limit: ['1000'],
        one_way: ['false'],
        origin: 'any',
        page: 'any',
      },
    },
  },
  contentSha256: 'synthetic',
};

export function makeProvider(h: Harness, over: Partial<TravelpayoutsProviderOptions> = {}): FlightProvider {
  return travelpayoutsProvider({
    http: h.http,
    log: h.log,
    clock: h.clock,
    token: TOKEN,
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

export function ctx(signal: AbortSignal = new AbortController().signal): ProviderContext {
  return { executionId: 'exec-1', signal, recordFixtures: false };
}

/** The `tile` variant, or a thrown error naming what came back. */
export function tileOf(r: DiscoveryTileResult): Extract<DiscoveryTileResult, { kind: 'tile' }> {
  if (r.kind !== 'tile')
    throw new Error(`expected a tile, got a tile-error: ${r.error.kind} ${r.error.message}`);
  return r;
}

/** The ProviderError of a `tile-error`, or a thrown error naming what came back. */
export function errorOf(r: DiscoveryTileResult): ProviderError {
  if (r.kind !== 'tile-error')
    throw new Error(`expected a tile-error, got a tile with notes ${r.notes.join(', ')}`);
  return r.error;
}

/**
 * LHR → JFK, 10–20 March 2027, 10–12 nights: 11 × 3 = 33 cells in one departure month. The definition lists both
 * London airports, so the tile queries the shared metro (spec §5.2 rev 14).
 */
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
    definitionOrigins: [asIata('LHR'), asIata('LGW')],
    ...over,
  };
}

/** The cells of one pair over a window and band, through the adapter's own cellsOf (one generator, arch-016). */
export function cellsFor(
  origin: Iata,
  destination: Iata,
  from: string,
  to: string,
  minNights: number,
  maxNights: number,
): CellKey[] {
  return cellsOf(
    query({
      origin,
      destination,
      departureFrom: asIsoDate(from),
      departureTo: asIsoDate(to),
      minNights,
      maxNights,
    }),
  );
}

export interface RowSpec {
  origin: string;
  dest: string;
  dep: string;
  ret: string | null;
  price: unknown;
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

/** A synthetic success envelope (the documented shape) in the given currency. */
export const envelope = (data: unknown[], currency = 'gbp') => ({ success: true, data, currency });
```

`packages/providers/test/travelpayouts/empty.test.ts`:

```ts
import { HttpResponse, http } from 'msw/http';
import { describe, expect, it } from 'vitest';
import { TP } from '../fakes.js';
import { server } from '../support/msw.js';
import {
  ctx,
  discoveryOf,
  envelope,
  eventsOf,
  makeHarness,
  makeProvider,
  NOW,
  only,
  query,
  tileOf,
} from './harness.js';

describe('travelpayouts: empty is per capability (spec §5.2, authorised-cached)', () => {
  it('a schema-valid {"success": true, "data": [], "currency": "gbp"} leaves every covered cell for no_data: zero prices, zero noFares, no issues', async () => {
    let hits = 0;
    server.use(
      http.get(TP, () => {
        hits += 1;
        // synthetic shape: the documented envelope with no rows
        return HttpResponse.json(envelope([]));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r).toMatchObject({
      kind: 'tile',
      index: 0,
      pointOfSale: 'unknown',
      prices: [],
      noFares: [],
      fetchedAt: NOW,
    });
    expect(r.cellIssues).toBeUndefined();
    // 11 departure days × 3 nights, all covered and none priced: WP7 records each as no_data.
    expect(r.coveredCells).toHaveLength(33);
    expect(r.notes).toEqual(['pages:1']);
    expect(hits).toBe(1);
    // one upstream attempt, ledgered under the tile's index at zero cost, finalised once (setup.ts checks none is open)
    expect(eventsOf(h, 'reserve')).toEqual([
      expect.objectContaining({
        providerId: 'travelpayouts',
        endpointPath: '/aviasales/v3/prices_for_dates',
        executionId: 'exec-1',
        tileIndex: 0,
        httpAttempt: 1,
        costMicroGbp: 0,
      }),
    ]);
    expect(eventsOf(h, 'finalise')).toEqual([expect.objectContaining({ outcome: 'ok', httpStatus: 200 })]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/empty.test.ts`
Expected: FAIL, `Tests  no tests`, with `Error: Cannot find module '../../src/travelpayouts/provider.js' imported from …/test/travelpayouts/harness.ts`.

- [ ] **Step 3: Implement**

In `packages/core/src/ports/provider.ts`, add `import type { ErrorReason } from '../types/execution.js';` below the `CellKey` import, add the last member to `DiscoveryQuery`:

```ts
  /** when set, discovery.plan RE-PLANS over this subset (fewer calls); tiles still partition it */
  cells?: CellKey[];
  /**
   * The definition's origins, every pair's (spec §2, §5.2 rev 14). A provider that can query by metropolitan code
   * does so only when two or more of these map to the pair origin's metro. Absent: the pair's origin alone.
   */
  definitionOrigins?: Iata[];
}
```

insert directly above `export interface RawCalendarPrice`:

```ts
/**
 * A covered cell the adapter could not fully price (spec §3, §8.1; plan decision 24): rows it received for exactly
 * this cell but dropped (`offersDropped`), or a cell it never finished reading. The engine records the cell `priced`
 * with `offers-dropped:n` when the tile also returned a price for it, else `error` with `reason`, `detail` going to
 * `last_error`. Never a vendor message in `reason`.
 */
export interface CellIssue {
  cell: CellKey;
  reason: ErrorReason;
  offersDropped: number;
  detail: string;
}

```

and add the last member of the `'tile'` variant of `DiscoveryTileResult`:

```ts
      noFares: CellKey[];
      notes: string[];
      /** Per-cell shortfalls the engine must record (spec §8.1); absent or empty when every covered cell is clean. */
      cellIssues?: CellIssue[];
      /**
       * True when the adapter stopped at its page cap: a priced cell's minimum is then the cheapest of the rows read,
       * not of the vendor's whole cache, and the engine labels it so. Absent: every page was read.
       */
      truncated?: boolean;
    }
```

All three are optional, so the fixture provider, WP3 and every other consumer compile unchanged; core's barrel already re-exports `ports/provider.js`, so `CellIssue` is public. No runtime code changes, so core's coverage and mutation scores are unaffected.

`packages/providers/src/travelpayouts/params.ts`:

```ts
/**
 * Travelpayouts request facts. Spec §2 (Travelpayouts row) and §5.2 "Point of sale": `currency=gbp` only, `market`
 * and `trip_class` never sent, every fixed value hard-coded here.
 */

/** Public Data API host; the only host in this provider's egress allowlist (spec §5.3). */
export const TRAVELPAYOUTS_HOST = 'api.travelpayouts.com';

/** The only endpoint this adapter calls (spec §2); also the ledger endpoint_path and the allowlist key. */
export const PRICES_FOR_DATES_PATH = '/aviasales/v3/prices_for_dates';

/** Rows per page (spec §5.2: `limit=1000`, the vendor's maximum). A shorter page is the last one. */
export const PAGE_LIMIT = 1000;

/**
 * Fixed parameters (spec §5.2). `market` and `trip_class` are absent on purpose: the spike proved the vendor ignores
 * both (spec §2 fact 1).
 * why: `limit` is derived from PAGE_LIMIT, so the page size sent and the short-page stop rule cannot drift apart.
 */
export const FIXED_PARAMS = { one_way: 'false', currency: 'gbp', limit: `${PAGE_LIMIT}` } as const;

/**
 * Names that must never be sent. `token`: the credential travels in X-Access-Token only (spec §2 fact 8). `market`,
 * `trip_class`: ignored by the vendor (fact 1). `return_at`: month tiles send none (spec §5.2).
 */
export const FORBIDDEN_PARAM_NAMES = ['token', 'market', 'trip_class', 'return_at'] as const;
```

`packages/providers/src/travelpayouts/tiles.ts` (first cut):

```ts
/**
 * Travelpayouts month tiling. Spec §5.2 (rev 14): the query stays per (origin, destination) pair; one `month` tile
 * per departure month on /aviasales/v3/prices_for_dates; tiles partition the pair's cells; plan is pure and
 * deterministic. No airport is named here (spec §1).
 */
import {
  type CellKey,
  type DiscoveryQuery,
  generateCells,
  type Iata,
  type IsoMonth,
  monthOf,
  type TilePlan,
} from '@gmt/core';

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

/** The vendor `origin` parameter. First cut: the pair's airport; Task 6.4 adds the shared-metro rule. */
export function originParam(q: DiscoveryQuery, _airports: MetroLookup): string {
  return q.origin;
}

/**
 * The cells to tile: `q.cells` when set (spec §5.1 re-plan), else the pair's full space in generation order (spec
 * §6.1). Every cell must belong to the query's pair (plan, provider port).
 */
export function cellsOf(q: DiscoveryQuery): CellKey[] {
  if (q.cells !== undefined) {
    if (q.cells.some((c) => c.origin !== q.origin || c.destination !== q.destination)) {
      throw new Error(
        'a Travelpayouts query is per (origin, destination) pair; every cell must belong to it',
      );
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
  }).map(({ origin, destination, departureDate, returnDate }) => ({
    origin,
    destination,
    departureDate,
    returnDate,
  }));
}

/**
 * Spec §5.2: one `month` tile per departure month of the pair, months ascending, so each cell lands in exactly one
 * tile and the same query always gives the same plan.
 * why: months are sorted because a re-plan subset (`q.cells`) may arrive in any order.
 */
export function planMonthTiles(q: DiscoveryQuery): TilePlan[] {
  const buckets = new Map<IsoMonth, CellKey[]>();
  for (const cell of cellsOf(q)) {
    const month = monthOf(cell.departureDate);
    const bucket = buckets.get(month);
    if (bucket === undefined) buckets.set(month, [cell]);
    else bucket.push(cell);
  }
  return [...buckets.keys()].sort().map(
    (month, index): TilePlan => ({
      index,
      coveredCells: buckets.get(month) ?? [],
      request: { kind: 'month', month },
    }),
  );
}

/** A tile's vendor parameters, from the plan and the pair. Throws on a tile that is not a month tile. */
export function tileParams(plan: TilePlan, q: DiscoveryQuery, airports: MetroLookup): TileParams {
  if (plan.request.kind !== 'month')
    throw new Error(`travelpayouts tiles are month tiles, got ${plan.request.kind}`);
  return {
    origin: originParam(q, airports),
    pairOrigin: q.origin,
    destination: q.destination,
    month: plan.request.month,
  };
}
```

`packages/providers/src/travelpayouts/response.ts` (first cut: the envelope and its currency):

```ts
/**
 * Travelpayouts response parsing and row attribution. Spec §2 (raw shapes, currency from the response), §5.2
 * ("Empty is per capability", "Cell keys from the response", rows filtered to the pair, vendor links), §8.1 (rows
 * dropped for a covered cell are reported per cell). Untrusted JSON is read through zod schemas (plan decision 15);
 * failures are `parseError` from the shared module (plan decision 24).
 */
import { MINOR_EXPONENT } from '@gmt/core';
import { z } from 'zod';
import { type ParseWhere, parseError, parseVendor } from '../shared/errors.js';
import { PRICES_FOR_DATES_PATH } from './params.js';

/** Where every Travelpayouts parse error comes from (message prefix). */
export const WHERE: ParseWhere = { providerId: 'travelpayouts', endpointPath: PRICES_FOR_DATES_PATH };

/**
 * The envelope (Library notes: `{ "currency": "rub", "data": [...], "success": true }`). Rows stay unknown here;
 * each is read by rowSchema. `success:false` carries an optional `error` string (an assumption: the docs show no
 * error body; any other shape falls to malformed-envelope).
 */
const envelopeSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: z.array(z.unknown()), currency: z.string().optional() }),
  z.object({ success: z.literal(false), error: z.unknown().optional() }),
]);

/**
 * A response currency: the ISO 4217 code and core's minor-unit exponent, or null when core does not know the
 * currency (plan decision 29: its rows are dropped per cell as `currency-unsupported`, never a tile-level error).
 */
export interface ResponseCurrency {
  code: string;
  exponent: number | null;
}

/** A checked success envelope: rows still unparsed, the currency read from the response (spec §2). */
export interface Envelope {
  rows: readonly unknown[];
  currency: ResponseCurrency;
}

/** The envelope's currency upper-cased to ISO 4217 with core's exponent (null when unknown), or why it is unreadable. */
export function currencyOf(
  raw: string | undefined,
):
  | ({ ok: true } & ResponseCurrency)
  | { ok: false; cause: 'currency-missing' | 'currency-malformed'; detail: string | null } {
  if (raw === undefined) return { ok: false, cause: 'currency-missing', detail: null };
  const code = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code))
    return { ok: false, cause: 'currency-malformed', detail: `currency ${raw.slice(0, 10)}` };
  return { ok: true, code, exponent: MINOR_EXPONENT[code] ?? null };
}

/**
 * Spec §5.2 "Empty is per capability" (authorised-cached) and §2 "a response that states no currency is a parse
 * error": a success envelope with a usable currency is returned (zero rows → the engine records every covered cell
 * no_data); `success:false` → `vendor-error` with the vendor's text as detail; anything else → `malformed-envelope`;
 * a missing or unreadable currency → `currency-missing` / `currency-malformed`. All are non-retryable `parse` errors.
 * A readable code core has no exponent for is returned with `exponent: null` (plan decision 29).
 */
export function readEnvelope(body: unknown): Envelope {
  const env = parseVendor(envelopeSchema, body, 'malformed-envelope', WHERE);
  if (!env.success)
    throw parseError(
      'vendor-error',
      typeof env.error === 'string' && env.error.length > 0 ? env.error : null,
      WHERE,
    );
  const cur = currencyOf(env.currency);
  if (!cur.ok) throw parseError(cur.cause, cur.detail, WHERE);
  return { rows: env.data, currency: { code: cur.code, exponent: cur.exponent } };
}

/**
 * The http-kit cache `accept` hook (plan decision 15): a body is cached only when readEnvelope would accept it, so a
 * `success:false`, malformed or currency-less body is never replayed from the cache inside the TTL. A currency core
 * does not know is cacheable: the body is the vendor's valid answer, and its rows are dropped per cell either way.
 */
export function cacheableBody(body: unknown): boolean {
  const env = envelopeSchema.safeParse(body);
  return env.success && env.data.success && currencyOf(env.data.currency).ok;
}
```

`packages/providers/src/travelpayouts/provider.ts` (first cut: one page, rows counted but not attributed):

```ts
/**
 * Travelpayouts / Aviasales Data API adapter (WP6). Spec §2 (Travelpayouts row, fact 1), §5.1, §5.2 (rev 14), §6.9,
 * §8.1. Discovery only: cached round-trip prices from /aviasales/v3/prices_for_dates, one month tile per
 * (origin, destination) pair and departure month, queried by the metro code when two or more of the definition's
 * origins share it, every page through http-kit. Returns raw vendor shapes; the engine normalises (spec §5.6).
 * No airport is named here (spec §1).
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
import type { HttpKit } from '../http/types.js';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import { NoteCounter } from '../shared/notes.js';
import { FIXED_PARAMS, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST } from './params.js';
import { cacheableBody, readEnvelope } from './response.js';
import { type MetroLookup, planMonthTiles, type TileParams, tileParams } from './tiles.js';

/**
 * Spec §2 Travelpayouts row: authorised-cached, 48 h. The vendor says prices_for_dates holds round-trip prices
 * (one_way=false) that Aviasales users found within the last 48 hours (docs/providers.md, help article 203956163);
 * rows carry no timestamp (spike fact 1), so the 48 hours is the vendor's declared horizon, never a measured age, and
 * the note attributes the whole description to the vendor. The vendor states no passenger count, so the note names
 * none (ruling 4); WP13's smoke row compares a recorded price with the vendor's own search page. The note avoids every
 * §11 banned word (tested).
 */
export const TRAVELPAYOUTS_INFO: CapabilityInfo = {
  sourceKind: 'authorised-cached',
  maxAgeHours: 48,
  provenanceNote:
    "Travelpayouts describes these as cached round-trip prices that Aviasales users found within the last 48 hours (vendor's declaration; rows carry no timestamp). From the authorised Travelpayouts Data API. Economy only; point of sale unknown; not a fare quote; constraints are not checked.",
};
/**
 * Spec §5.2: from recorded fixtures only. A row names one airline, one flight number and transfer counts, which is
 * not a segment list, so only the price is supplied; Task 6.9 pins the recorded row keys so a new field fails a test.
 */
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[] = ['price'];
/** Spec §2 fact 1 and §5.2: trip_class is ignored, so economy only; the engine never calls this provider for another cabin. */
export const TRAVELPAYOUTS_CABINS: readonly Cabin[] = ['economy'];
/** Spec §2: market is ignored, so every tile's point of sale is unknown. */
export const TRAVELPAYOUTS_POINT_OF_SALE = 'unknown' as const;
/** The plan's constructor options, field for field. */
export interface TravelpayoutsProviderOptions {
  http: HttpKit;
  log: Logger;
  /** Kept for every adapter (plan decision 24); timestamps come from http-kit's fetchedAt. */
  clock: Clock;
  /** TRAVELPAYOUTS_TOKEN; sent only in the X-Access-Token header (spec §2 fact 8). Must not be empty. */
  token: Secret;
  /**
   * Response cache window: TRAVELPAYOUTS_CACHE_TTL_HOURS × 3600. Inside it, a sibling pair's identical metro request
   * is a cache hit. 0 disables that dedup: upstream calls become O × D × M instead of D × M (logged at construction).
   */
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

/** Spec §5.1 FlightProvider for Travelpayouts. First cut: one page, rows counted but not yet attributed (Task 6.5). */
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  const log = opts.log.child({ providerId: 'travelpayouts' });

  async function fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, q, opts.airports);
    const url = buildRequestUrl(tp, 1);
    // why: fail closed before anything leaves the process (spec §5.2 allowlist of names and values).
    assertRequestAllowed(opts.paramsAllowlist, PRICES_FOR_DATES_PATH, url);
    try {
      const res = await opts.http.request({
        providerId: 'travelpayouts',
        executionId: ctx.executionId,
        tileIndex: plan.index,
        endpointPath: PRICES_FOR_DATES_PATH,
        method: 'GET',
        url,
        headers: { 'X-Access-Token': opts.token.reveal(), Accept: 'application/json' },
        cache: { ttlSeconds: opts.cacheTtlSeconds, accept: cacheableBody },
        signal: ctx.signal,
        recordFixtures: ctx.recordFixtures,
      });
      const env = readEnvelope(res.body);
      const notes = new NoteCounter();
      notes.add('rows-received', env.rows.length);
      notes.add('pages', 1);
      return {
        kind: 'tile',
        index: plan.index,
        coveredCells: plan.coveredCells,
        fetchedAt: res.fetchedAt,
        pointOfSale: TRAVELPAYOUTS_POINT_OF_SALE,
        prices: [],
        noFares: [],
        notes: notes.list(),
      };
    } catch (e) {
      // why: BudgetExceeded and AbortedError belong to the engine (spec §8.1); only ProviderError becomes a tile-error.
      if (e instanceof ProviderError) {
        log.warn({ tileIndex: plan.index, kind: e.kind, message: e.message }, 'travelpayouts tile failed');
        return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error: e };
      }
      throw e;
    }
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
Expected: PASS, `Tests  1 passed (1)`. Then `pnpm -r typecheck` exits 0 (the core change compiles everywhere).

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/providers && git commit -m "wp06: travelpayouts empty envelope leaves covered cells no_data; definitionOrigins, cellIssues and truncated contract fields"
```

### Task 6.3: Row attribution by response dates, per-cell drop reports, vendor link

**Files:** modify `src/travelpayouts/response.ts` (replace the import block, append the row half); create `test/travelpayouts/response.test.ts`.

**Interfaces:**

- Consumes `cellKeyString`, `iataSchema`, `isoDateSchema`, `isoDateTimeOfEpochMs` (WP0), `daysBetween` (WP1), `LINK_ALLOWLIST`, `validateVendorUrl` (WP2), `majorToMinor`, `NoteCounter`, `zodReason`.
- Produces `attributeRows`, `AttributionInput`, `Attribution`, `vendorLinkFor`, `observedAt`, `AVIASALES_BASE`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/response.test.ts`:

```ts
import { asIata, type CellKey } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  attributeRows,
  cacheableBody,
  currencyOf,
  observedAt,
  readEnvelope,
  vendorLinkFor,
} from '../../src/travelpayouts/response.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { asProviderError } from '../support/guards.js';
import { cellsFor, envelope, query, row } from './harness.js';

const covered: CellKey[] = cellsOf(query());
const GBP = { code: 'GBP', exponent: 2 };
const input = {
  coveredCells: covered,
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  minNights: 10,
  maxNights: 12,
  currency: GBP,
};
const LINK = 'https://www.aviasales.com/search/synthetic?t=1';
const thrown = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return asProviderError(e);
  }
  throw new Error('expected a throw');
};

describe('attributeRows: cell keys from the response, filtered to the pair (spec §5.2)', () => {
  // synthetic shapes, one per outcome; a metro (LON) response also carries the sibling airport's rows
  const rows: unknown[] = [
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }), // 11 nights: kept
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 398 }), // same cell, another fare: kept (engine keeps the minimum, §5.6)
    row({
      origin: 'LHR',
      dest: 'JFK',
      dep: '2027-03-14',
      ret: '2027-03-24',
      price: 401,
      link: 'https://evil.example/x',
    }), // kept, link refused
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-30', price: 350 }), // 18 nights: outside-band
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-25', ret: '2027-04-05', price: 380 }), // after the window: outside-tile
    row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 }), // sibling airport of the metro: other-origin
    row({ origin: 'LHR', dest: 'EWR', dep: '2027-03-12', ret: '2027-03-23', price: 300 }), // other-destination
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: null, price: 200 }), // one-way
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-15', ret: '2027-03-26', price: 0 }), // covered cell, unusable price
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-15', ret: '2027-03-26', price: '412' }), // same cell, price not a number
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-16', ret: '2027-03-27', price: 412.555 }), // covered cell, excess precision
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: -1 }), // priced cell, one bad row beside the good ones
  ];
  const a = attributeRows(rows, input);

  it('keeps rows whose response dates name a covered cell of the pair, keyed by those dates', () => {
    expect(a.prices).toEqual([
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-12',
        returnDate: '2027-03-23',
        amountMinor: 41200,
        currency: 'GBP',
        vendorLink: LINK,
      },
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-12',
        returnDate: '2027-03-23',
        amountMinor: 39800,
        currency: 'GBP',
        vendorLink: LINK,
      },
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-14',
        returnDate: '2027-03-24',
        amountMinor: 40100,
        currency: 'GBP',
      },
    ]);
  });

  it('counts every foreign or out-of-band row, every dropped offer and every refused link in notes', () => {
    expect(a.notes.list()).toEqual([
      'dropped-one-way:1',
      'dropped-other-destination:1',
      'dropped-other-origin:1',
      'dropped-outside-band:1',
      'dropped-outside-tile:1',
      'link-rejected:1',
      'offers-dropped:4',
    ]);
  });

  it('reports each covered cell with dropped rows (spec §8.1): error reason parse unless the tile also priced it', () => {
    expect(a.cellIssues).toEqual([
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-15', returnDate: '2027-03-26' },
        reason: 'parse',
        offersDropped: 2,
        detail: expect.stringContaining('[bad-price]'),
      },
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-16', returnDate: '2027-03-27' },
        reason: 'parse',
        offersDropped: 1,
        detail: expect.stringContaining('[bad-price]'),
      },
      // the engine records this one priced with offers-dropped:1, because the tile priced it too
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-12', returnDate: '2027-03-23' },
        reason: 'parse',
        offersDropped: 1,
        detail: expect.any(String),
      },
    ]);
  });

  it('never sets providerObservedAt when rows carry no found_at (spec §2 fact 1)', () => {
    expect(a.prices.every((p) => !('providerObservedAt' in p))).toBe(true);
  });

  it('uses a row found_at, when the vendor states one, as providerObservedAt (ruling 9)', () => {
    const found = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      found_at: '2026-10-13T09:30:00+03:00',
    };
    expect(attributeRows([found], input).prices.map((p) => p.providerObservedAt)).toEqual([
      '2026-10-13T06:30:00.000Z',
    ]);
  });

  it('throws malformed-row when a row cannot be placed at all (no cell can be told apart)', () => {
    expect(thrown(() => attributeRows([{ origin_airport: 'LHR' }], input))).toMatchObject({
      kind: 'parse',
      reason: 'parse',
      message: expect.stringContaining('[malformed-row]'),
    });
  });
});

describe('a currency core does not know (plan decision 29: currency-unsupported per cell, never a tile error)', () => {
  it('drops every row of a covered cell, counts it, and reports the cell with reason currency-unsupported', () => {
    const qqq = { ...input, currency: { code: 'QQQ', exponent: null } };
    const a = attributeRows(
      [
        row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
        row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 398 }),
        row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 }),
      ],
      qqq,
    );
    expect(a.prices).toEqual([]);
    expect(a.notes.list()).toEqual(['dropped-other-origin:1', 'offers-dropped:2']);
    expect(a.cellIssues).toEqual([
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-12', returnDate: '2027-03-23' },
        reason: 'currency-unsupported',
        offersDropped: 2,
        detail: expect.stringContaining('[currency-unsupported]'),
      },
    ]);
  });
});

describe('response dates are local calendar dates (spec §6.1: never through UTC)', () => {
  it("keys by the vendor's local date: 23:30 at UTC-5 is the next day in UTC", () => {
    const late = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      departure_at: '2027-03-12T23:30:00-05:00',
    };
    expect(attributeRows([late], input).prices.map((p) => p.departureDate)).toEqual(['2027-03-12']);
  });

  it('keys a month-end departure by its local date, not the UTC date in the next month (ts-005)', () => {
    const lateMarch = {
      ...input,
      coveredCells: cellsFor(asIata('LHR'), asIata('JFK'), '2027-03-25', '2027-03-31', 10, 12),
    };
    // 23:30 at UTC-5 on 31 March is 1 April in UTC; the cell (and so the March tile) follows the local date.
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-31', ret: '2027-04-11', price: 412 }),
      departure_at: '2027-03-31T23:30:00-05:00',
    };
    expect(attributeRows([r], lateMarch).prices.map((p) => [p.departureDate, p.returnDate])).toEqual([
      ['2027-03-31', '2027-04-11'],
    ]);
  });

  it('counts nights across a leap day (2028-02-29) and a year end', () => {
    const leap = {
      ...input,
      coveredCells: cellsFor(asIata('LHR'), asIata('JFK'), '2028-02-20', '2028-02-29', 10, 12),
    };
    const viaLeapDay = row({ origin: 'LHR', dest: 'JFK', dep: '2028-02-20', ret: '2028-03-01', price: 412 }); // 10 nights through 29 Feb
    const onLeapDay = row({ origin: 'LHR', dest: 'JFK', dep: '2028-02-29', ret: '2028-03-11', price: 413 }); // departs 29 Feb, 11 nights
    expect(attributeRows([viaLeapDay, onLeapDay], leap).prices.map((p) => p.amountMinor)).toEqual([
      41200, 41300,
    ]);
    const yearEnd = {
      ...input,
      coveredCells: cellsFor(asIata('LHR'), asIata('JFK'), '2027-12-20', '2027-12-31', 10, 12),
    };
    const r = row({ origin: 'LHR', dest: 'JFK', dep: '2027-12-31', ret: '2028-01-12', price: 414 }); // 12 nights into the next year
    expect(attributeRows([r], yearEnd).prices.map((p) => p.returnDate)).toEqual(['2028-01-12']);
  });

  it.each([
    ['a Z time', '2027-03-12T08:55:00Z'],
    ['an offset-less time', '2027-03-12T08:55:00'],
    ['a non-date', 'next tuesday'],
    ['an impossible date', '2027-02-30T08:55:00+00:00'],
    ['an impossible hour', '2027-03-12T25:55:00+00:00'],
    ['an impossible minute', '2027-03-12T08:61:00+00:00'],
  ])('refuses %s as malformed (local or UTC cannot be told)', (_label, departureAt) => {
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      departure_at: departureAt,
    };
    expect(thrown(() => attributeRows([r], input)).message).toContain('[malformed-row]');
  });

  it('accepts a bare date', () => {
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      departure_at: '2027-03-12',
      return_at: '2027-03-23',
    };
    expect(attributeRows([r], input).prices).toHaveLength(1);
  });
});

describe('readEnvelope and the cache accept hook (spec §2: currency read from the response; §5.2: malformed → parse)', () => {
  it('upper-cases the vendor currency code and finds its exponent', () => {
    expect(readEnvelope(envelope([], 'gbp')).currency).toEqual(GBP);
    expect(readEnvelope(envelope([], 'usd')).currency).toEqual({ code: 'USD', exponent: 2 });
  });

  it.each([
    ['no currency', { success: true, data: [] }, 'currency-missing'],
    ['a malformed currency', { success: true, data: [], currency: 'g1p' }, 'currency-malformed'],
    ['success:false', { success: false, error: 'invalid destination' }, 'vendor-error'],
    ['an array', [], 'malformed-envelope'],
    ['success missing', { data: [] }, 'malformed-envelope'],
    ['data not an array', { success: true, data: {}, currency: 'gbp' }, 'malformed-envelope'],
    ['currency not a string', { success: true, data: [], currency: 7 }, 'malformed-envelope'],
  ] as const)('%s → parse [%s], never cached', (_label, body, cause) => {
    expect(thrown(() => readEnvelope(body))).toMatchObject({
      kind: 'parse',
      retryable: false,
      reason: 'parse',
      message: expect.stringContaining(`[${cause}]`),
    });
    expect(cacheableBody(body)).toBe(false);
  });

  it('carries the vendor text of success:false in the message only', () => {
    const e = thrown(() => readEnvelope({ success: false, error: 'invalid destination' }));
    expect(e.reason).toBe('parse');
    expect(e.message).toContain('invalid destination');
  });

  it('caches a usable envelope, rows or none', () => {
    expect(cacheableBody(envelope([]))).toBe(true);
    expect(
      cacheableBody(
        envelope([row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 })]),
      ),
    ).toBe(true);
  });

  it('currencyOf reports the cause and a short detail', () => {
    expect(currencyOf(undefined)).toEqual({ ok: false, cause: 'currency-missing', detail: null });
    expect(currencyOf('g1p')).toEqual({ ok: false, cause: 'currency-malformed', detail: 'currency g1p' });
  });

  it('a readable currency core has no exponent for is not a parse error (plan decision 29): exponent null, cacheable', () => {
    expect(readEnvelope(envelope([], 'qqq')).currency).toEqual({ code: 'QQQ', exponent: null });
    expect(currencyOf('qqq')).toEqual({ ok: true, code: 'QQQ', exponent: null });
    expect(cacheableBody(envelope([], 'qqq'))).toBe(true);
  });
});

describe('vendorLinkFor (spec §5.2 vendor links: LINK_ALLOWLIST.travelpayouts)', () => {
  it('prefixes the relative link with the Aviasales site', () => {
    expect(vendorLinkFor('/search/synthetic?t=1')).toBe(LINK);
  });
  it.each(['https://evil.example/x', '//evil.example/x', 'search/relative', '', 7, null])(
    'refuses %j',
    (link) => {
      expect(vendorLinkFor(link)).toBeNull();
    },
  );
});

describe('observedAt', () => {
  it.each([
    ['2026-10-13T09:30:00Z', '2026-10-13T09:30:00.000Z'],
    ['2026-10-13T09:30:00+03:00', '2026-10-13T06:30:00.000Z'],
    ['2026-10-13', null],
    ['2026-10-13T09:30:00', null],
    [1_760_000_000, null],
    [undefined, null],
  ] as const)('%j → %j', (raw, expected) => {
    expect(observedAt(raw)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/response.test.ts`
Expected: FAIL, `Tests  no tests`, with `TypeError: attributeRows is not a function` (the describe body calls it while the file is collected).

- [ ] **Step 3: Implement**

In `packages/providers/src/travelpayouts/response.ts`, replace the four import lines with:

```ts
import {
  type CellIssue,
  type CellKey,
  cellKeyString,
  daysBetween,
  type Iata,
  type IsoDateTime,
  iataSchema,
  isoDateSchema,
  isoDateTimeOfEpochMs,
  LINK_ALLOWLIST,
  MINOR_EXPONENT,
  type RawCalendarPrice,
  validateVendorUrl,
} from '@gmt/core';
import { z } from 'zod';
import { type ParseWhere, parseError, parseVendor } from '../shared/errors.js';
import { majorToMinor } from '../shared/money.js';
import { NoteCounter } from '../shared/notes.js';
import { zodReason } from '../util.js';
import { PRICES_FOR_DATES_PATH } from './params.js';
```

and append:

```ts
/**
 * A vendor time read as its local calendar date (spec §6.1: never through UTC). Accepted: a bare date, or a date-time
 * with an explicit `±HH:MM` offset, which is the documented form (`2021-09-14T08:55:00+03:00`). A `Z` or offset-less
 * time is refused: whether it is local or UTC cannot be told, and a UTC reading keys evening flights a day late.
 * why: core's vendor-time parser (normalise/localTime.ts) is not exported and takes no bare date, so this pattern
 * checks the time part's ranges itself; the calendar date is then checked by core's isoDateSchema.
 */
const LOCAL_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;
const localDateSchema = z
  .string()
  .regex(LOCAL_TIME)
  .transform((s) => s.slice(0, 10))
  .pipe(isoDateSchema);

/**
 * One row. The attribution fields are required and checked (an unreadable one makes the whole response `parse`,
 * because the row cannot be placed in or out of any cell); `price`, `link` and `found_at` are read leniently and
 * judged per row. Other documented fields (airline, flight_number, transfers, duration) are not used.
 */
const rowSchema = z.object({
  origin_airport: iataSchema,
  destination_airport: iataSchema,
  departure_at: localDateSchema,
  return_at: localDateSchema.nullish(),
  price: z.unknown(),
  link: z.unknown().optional(),
  found_at: z.unknown().optional(),
});

/** The Aviasales site the vendor's relative `link` is relative to (docs/providers.md). */
export const AVIASALES_BASE = 'https://www.aviasales.com';

/**
 * Spec §5.2 vendor links: the relative Aviasales path prefixed with the site, then checked by core's
 * validateVendorUrl against LINK_ALLOWLIST.travelpayouts (WP2). Null when refused. This is the vendor's own search
 * link for the row (it may search the metro), never a fare link; the UI's search link is core's searchLinkFor.
 * why: only a site-relative path is accepted; an absolute or protocol-relative value is refused, never resolved.
 */
export function vendorLinkFor(link: unknown): string | null {
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) return null;
  const booking = validateVendorUrl(`${AVIASALES_BASE}${link}`, LINK_ALLOWLIST.travelpayouts);
  return booking.kind === 'get' ? booking.url : null;
}

/**
 * An instant with an explicit zone, the only form a vendor observation time is taken in.
 * why: with the zone in the string, Date.parse is exact; core's toIsoDateTime needs a time kind and an airport zone.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Spec §2 and §3: `providerObservedAt` only when the vendor states when the price was found. Spike fact 1 says
 * prices_for_dates rows carry no `found_at`; if a row ever does, its instant is used, else nothing is set (the
 * declared 48-hour horizon applies). An unreadable value is ignored, never guessed.
 */
export function observedAt(foundAt: unknown): IsoDateTime | null {
  if (typeof foundAt !== 'string' || !INSTANT.test(foundAt)) return null;
  const ms = Date.parse(foundAt);
  return Number.isNaN(ms) ? null : isoDateTimeOfEpochMs(ms);
}

type Row = z.infer<typeof rowSchema>;

/**
 * Where a row belongs: the pair's cell its own dates name, or the note key it is dropped under when it belongs to no
 * cell of this pair and band.
 */
function placeRow(row: Row, input: AttributionInput): { cell: CellKey } | { drop: string } {
  if (row.return_at === null || row.return_at === undefined) return { drop: 'dropped-one-way' };
  if (row.origin_airport !== input.origin) return { drop: 'dropped-other-origin' };
  if (row.destination_airport !== input.destination) return { drop: 'dropped-other-destination' };
  const nights = daysBetween(row.departure_at, row.return_at);
  if (nights < input.minNights || nights > input.maxNights) return { drop: 'dropped-outside-band' };
  return {
    cell: {
      origin: row.origin_airport,
      destination: row.destination_airport,
      departureDate: row.departure_at,
      returnDate: row.return_at,
    },
  };
}

export interface AttributionInput {
  coveredCells: readonly CellKey[];
  /** The pair's origin airport; rows from other airports of a metro response are dropped. */
  origin: Iata;
  destination: Iata;
  minNights: number;
  maxNights: number;
  currency: ResponseCurrency;
}

export interface Attribution {
  prices: RawCalendarPrice[];
  /** One entry per covered cell that had rows dropped (spec §8.1): reason 'parse', the count, a URL-free detail. */
  cellIssues: CellIssue[];
  /** Tile-level counts: `dropped-*`, `offers-dropped`, `link-rejected` (spec §5.2: every drop is counted). */
  notes: NoteCounter;
}

/**
 * Spec §5.2: rows are attributed by `origin_airport`, `destination_airport` and their own local dates, filtered to
 * the pair, the nights band and the covered cells. A row for another airport, another destination, a one-way row, an
 * out-of-band or uncovered date pair is dropped and counted in notes. A row for exactly a covered cell whose price is
 * unusable (not a number, not positive, or more decimals than the currency has: shared majorToMinor) is dropped,
 * counted `offers-dropped` and reported for that cell, so the engine records `error` (reason 'parse') when no other
 * row priced it, never `no_data` (spec §3, §8.1; plan decision 24).
 * Throws `parseError('malformed-row')` when a row cannot be read at all.
 */
export function attributeRows(rows: readonly unknown[], input: AttributionInput): Attribution {
  const covered = new Set(input.coveredCells.map(cellKeyString));
  const notes = new NoteCounter();
  const prices: RawCalendarPrice[] = [];
  const dropped = new Map<string, { cell: CellKey; n: number }>();
  for (const [i, raw] of rows.entries()) {
    const r = rowSchema.safeParse(raw);
    if (!r.success) throw parseError('malformed-row', `row ${i}: ${zodReason(r.error)}`, WHERE);
    const row = r.data;
    const placed = placeRow(row, input);
    if ('drop' in placed) {
      notes.add(placed.drop);
      continue;
    }
    const { cell } = placed;
    const key = cellKeyString(cell);
    if (!covered.has(key)) {
      notes.add('dropped-outside-tile');
      continue;
    }
    const amountMinor = typeof row.price === 'number' ? majorToMinor(row.price, input.currency.code) : null;
    if (amountMinor === null) {
      notes.add('offers-dropped');
      const d = dropped.get(key);
      if (d === undefined) dropped.set(key, { cell, n: 1 });
      else d.n += 1;
      continue;
    }
    const price: RawCalendarPrice = { ...cell, amountMinor, currency: input.currency.code };
    const seen = observedAt(row.found_at);
    if (seen !== null) price.providerObservedAt = seen;
    const link = vendorLinkFor(row.link);
    if (link !== null) price.vendorLink = link;
    else if (row.link !== undefined && row.link !== null) notes.add('link-rejected');
    prices.push(price);
  }
  const { code, exponent } = input.currency;
  const rowsWord = (n: number): string => `${n} row${n === 1 ? '' : 's'}`;
  const cellIssues = [...dropped.values()].map(
    ({ cell, n }): CellIssue =>
      exponent === null
        ? {
            cell,
            reason: 'currency-unsupported',
            offersDropped: n,
            detail: `travelpayouts: ${rowsWord(n)} for this cell priced in ${code}, which has no known minor unit [currency-unsupported]`,
          }
        : {
            cell,
            reason: 'parse',
            offersDropped: n,
            detail: `travelpayouts: ${rowsWord(n)} for this cell had no usable ${code} price (not a positive amount with at most ${exponent} decimals) [bad-price]`,
          },
  );
  return { prices, cellIssues, notes };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS, `Test Files  2 passed (2)`, `Tests  43 passed (43)` (42 in `response.test.ts`, 1 in `empty.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts row attribution by response dates, per-cell drop reports (bad price, unsupported currency), vendor link"
```

### Task 6.4: Metro origin (spec rev 14); month tiles partition the pair's cells

**Files:** modify `src/travelpayouts/tiles.ts` (replace the first-cut `originParam`); create `test/travelpayouts/tiles.test.ts`.

**Interfaces:** consumes `MetroLookup.metroOf`, `DiscoveryQuery.definitionOrigins`, `cellKeyString`. Produces the final `originParam`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/tiles.test.ts`:

```ts
import {
  asIata,
  asIsoDate,
  type CellKey,
  cellKeyString,
  type DiscoveryQuery,
  type Iata,
  type TilePlan,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildRequestUrl } from '../../src/travelpayouts/provider.js';
import { cellsOf, originParam, planMonthTiles, tileParams } from '../../src/travelpayouts/tiles.js';
import { airports, cellsFor, noMetro, query } from './harness.js';

const [LHR, LGW, JFK, EWR] = [asIata('LHR'), asIata('LGW'), asIata('JFK'), asIata('EWR')];
/** Spec §5.2 worked example, one pair: 182 days (2027-01-01 … 2027-07-01, 7 months), 10–21 nights. */
const worked = (origin: Iata, destination: Iata): DiscoveryQuery =>
  query({
    origin,
    destination,
    departureFrom: asIsoDate('2027-01-01'),
    departureTo: asIsoDate('2027-07-01'),
    minNights: 10,
    maxNights: 21,
  });

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

describe('planMonthTiles (spec §5.2: per pair, one month tile per departure month)', () => {
  it("one tile per departure month: 7 for the worked example's 182-day window", () => {
    expect(planMonthTiles(worked(LHR, JFK)).map((p) => p.request)).toEqual(
      ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07'].map((m) => ({
        kind: 'month',
        month: m,
      })),
    );
  });

  it('worked example: 4 pairs × 7 months = 28 logical tiles', () => {
    const pairs = [worked(LHR, JFK), worked(LHR, EWR), worked(LGW, JFK), worked(LGW, EWR)];
    expect(pairs.reduce((n, q) => n + planMonthTiles(q).length, 0)).toBe(28);
  });

  it.each([
    ['the default query', query()],
    ['the worked example pair', worked(LHR, JFK)],
    [
      'every 7th cell of the worked pair (re-plan subset)',
      query({ ...worked(LHR, JFK), cells: cellsOf(worked(LHR, JFK)).filter((_, i) => i % 7 === 0) }),
    ],
    [
      'a December → January window (year end)',
      query({ departureFrom: asIsoDate('2027-12-20'), departureTo: asIsoDate('2028-01-10') }),
    ],
    [
      'a window across the leap day (2028-02-25 … 2028-03-02)',
      query({ departureFrom: asIsoDate('2028-02-25'), departureTo: asIsoDate('2028-03-02') }),
    ],
  ] as const)('tiles partition the cells: %s', (_label, q) => {
    expectPartition(cellsOf(q), planMonthTiles(q));
  });

  it('a leap-day window has a February tile holding the 29 February departures and a March tile', () => {
    const plans = planMonthTiles(
      query({ departureFrom: asIsoDate('2028-02-25'), departureTo: asIsoDate('2028-03-02') }),
    );
    expect(plans.map((p) => p.request)).toEqual([
      { kind: 'month', month: '2028-02' },
      { kind: 'month', month: '2028-03' },
    ]);
    expect(plans[0]?.coveredCells.filter((c) => c.departureDate === '2028-02-29')).toHaveLength(3);
  });

  it('orders tiles by month even when a re-plan subset arrives out of order', () => {
    const cells = cellsOf(
      query({ departureFrom: asIsoDate('2027-12-20'), departureTo: asIsoDate('2028-01-10') }),
    ).reverse();
    expect(planMonthTiles(query({ cells })).map((p) => p.request)).toEqual([
      { kind: 'month', month: '2027-12' },
      { kind: 'month', month: '2028-01' },
    ]);
  });

  it('is pure and deterministic', () => {
    expect(planMonthTiles(worked(LHR, JFK))).toEqual(planMonthTiles(worked(LHR, JFK)));
  });

  it('refuses cells from another pair (the query stays per pair)', () => {
    expect(() =>
      planMonthTiles(query({ cells: cellsFor(LGW, JFK, '2027-03-10', '2027-03-10', 10, 10) })),
    ).toThrow(/per \(origin, destination\) pair/);
  });
});

describe('the metro origin (spec §2 and §5.2 rev 14: the metro only when two or more of the definition’s origins share it)', () => {
  it('sends the shared metro code when the definition lists LHR and LGW', () => {
    expect(originParam(query({ definitionOrigins: [LHR, LGW] }), airports)).toBe('LON');
    expect(originParam(query({ origin: LGW, definitionOrigins: [LHR, LGW] }), airports)).toBe('LON');
  });

  it('sends the airport when the definition has one London airport (a lone airport is queried by its own code)', () => {
    expect(originParam(query({ definitionOrigins: [LHR] }), airports)).toBe('LHR');
  });

  it('sends the airport when definitionOrigins is absent (treated as the pair origin alone)', () => {
    const { definitionOrigins: _omit, ...q } = query();
    expect(originParam(q, airports)).toBe('LHR');
  });

  it("sends the airport when the definition's other origins map to other metros or none", () => {
    expect(originParam(query({ definitionOrigins: [LHR, JFK, asIata('AAA')] }), airports)).toBe('LHR');
  });

  it('sends the airport when there is no metro', () => {
    expect(originParam(query(), noMetro)).toBe('LHR');
  });

  it('ignores a metro code that is not three upper-case letters', () => {
    expect(originParam(query(), { metroOf: () => 'LONDON' })).toBe('LHR');
  });

  it('tileParams carries the vendor origin, the pair and the month', () => {
    const [first] = planMonthTiles(query());
    if (first === undefined) throw new Error('no tile');
    expect(tileParams(first, query(), airports)).toEqual({
      origin: 'LON',
      pairOrigin: 'LHR',
      destination: 'JFK',
      month: '2027-03',
    });
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

  it.each([
    ['2027-12', '2027-12'],
    ['2028-02', '2028-02'],
    ['2028-01', '2028-01'],
  ] as const)('buildRequestUrl sends departure_at=%s for the %s tile', (month, expected) => {
    const plans = planMonthTiles(
      query({ departureFrom: asIsoDate('2027-12-20'), departureTo: asIsoDate('2028-02-29') }),
    );
    const plan = plans.find((p) => p.request.kind === 'month' && p.request.month === month);
    if (plan === undefined) throw new Error(`no ${month} tile`);
    expect(buildRequestUrl(tileParams(plan, query(), airports), 1).searchParams.get('departure_at')).toBe(
      expected,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/tiles.test.ts`
Expected: FAIL, `Tests  2 failed | 20 passed (22)`:

- `sends the shared metro code when the definition lists LHR and LGW` with `AssertionError: expected 'LHR' to be 'LON'`;
- `tileParams carries the vendor origin, the pair and the month` with `expected { origin: 'LHR', …(3) } to deeply equal { origin: 'LON', …(3) }`.

The partition, leap-day, year-end, ordering and lone-airport tests already pass with the first cut, because tiling is final from Task 6.2 and the first cut always sends the airport.

- [ ] **Step 3: Implement**

In `packages/providers/src/travelpayouts/tiles.ts`, replace the first-cut `originParam` (its doc comment and body) with:

```ts
/** A metropolitan code as the vendor takes it; anything else from the table is treated as no metro. */
const CODE_RE = /^[A-Z]{3}$/;

/**
 * The vendor `origin` parameter. Spec §2 and §5.2 (rev 14): the pair origin's metropolitan code when two or more of
 * the definition's origins (`q.definitionOrigins`, the pair origin included) map to that metro, else the airport
 * code. Rows are split back to the pair by `origin_airport`; a sibling pair's identical metro request is answered by
 * the response cache inside the TTL.
 * why: a lone airport is queried by its own code, so its tile never pages through rows of airports the definition
 * does not use; a malformed code from the table is treated as no metro rather than sent to the vendor.
 */
export function originParam(q: DiscoveryQuery, airports: MetroLookup): string {
  const metro = airports.metroOf(q.origin);
  if (metro === null || !CODE_RE.test(metro)) return q.origin;
  const origins = new Set<Iata>([q.origin, ...(q.definitionOrigins ?? [])]);
  let sharing = 0;
  for (const o of origins) if (airports.metroOf(o) === metro) sharing += 1;
  return sharing >= 2 ? metro : q.origin;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS, `Test Files  3 passed (3)`, `Tests  65 passed (65)`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts metro origin only when the definition's origins share it (spec rev 14)"
```

### Task 6.5: Pagination inside `fetchTile`; one ledger row per cached tile; sibling dedup

**Files:**

- Modify `src/http/types.ts` and `src/http/httpKit.ts` (`ledgerCacheHit`); replace `src/travelpayouts/provider.ts`.
- Create `test/http/ledgerCacheHit.test.ts` and `test/travelpayouts/fetchTile.test.ts`.

**Interfaces:** consumes `attributeRows`, `readEnvelope`, `cacheableBody`, `canonicalJson`, `parseError`. Produces `HttpKitRequest.ledgerCacheHit`, `MAX_PAGES` and the paginated `fetchTile`.

- [ ] **Step 1: Write the failing tests**

`packages/providers/test/http/ledgerCacheHit.test.ts`:

```ts
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeKit, req, SEARCH } from '../fakes.js';
import { respondAfter, server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const URL1 = `${SEARCH}?engine=google_flights_calendar&page=2`;

describe('HttpKitRequest.ledgerCacheHit (plan decision 24: one cache-hit row per tile, never per page)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('false: a cache hit returns the cached body and writes no cache-hit row', async () => {
    const { kit, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ page: 2 })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    const hit = await drive(
      kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 }, ledgerCacheHit: false })),
    );
    expect(hit).toMatchObject({ fromCache: true, body: { page: 2 } });
    expect(budget.count('fetch')).toBe(1);
    expect(budget.count('cache-hit')).toBe(0);
  });

  it('false: a joined in-flight request writes no cache-hit row; the leader still ledgers its upstream attempt', async () => {
    const { kit, budget } = makeKit();
    server.use(
      http.get(SEARCH, ({ request }) => respondAfter(request, 2000, () => HttpResponse.json({ page: 2 }))),
    );
    const leader = kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } }));
    const joiner = kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 }, ledgerCacheHit: false }));
    const [a, b] = await drive(Promise.all([leader, joiner]));
    expect(a.body).toEqual(b.body);
    expect(budget.sequence()).toEqual(['reserve', 'fetch', 'finalise:ok']);
  });

  it('absent: the cache hit is ledgered as before', async () => {
    const { kit, budget } = makeKit();
    server.use(http.get(SEARCH, () => HttpResponse.json({ page: 2 })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    await drive(kit.request(req({ url: URL1, cache: { ttlSeconds: 3600 } })));
    expect(budget.count('cache-hit')).toBe(1);
  });
});
```

`packages/providers/test/travelpayouts/fetchTile.test.ts`:

```ts
import { AbortedError, asIata, asIsoDate, BudgetExceeded, cellKeyString, type Iata } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { describe, expect, it } from 'vitest';
import { MAX_PAGES } from '../../src/travelpayouts/provider.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { TP } from '../fakes.js';
import { server } from '../support/msw.js';
import {
  ctx,
  discoveryOf,
  envelope,
  errorOf,
  eventsOf,
  type Harness,
  makeHarness,
  makeProvider,
  NOW,
  only,
  query,
  row,
  tileOf,
} from './harness.js';

const covered = cellsOf(query());

/** Synthetic rows cycling over the 33 covered cells, every one inside the band; `origin` picks the airport. */
function rowsFor(n: number, offset = 0, origin = 'LHR'): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => {
    const c = covered[(i + offset) % covered.length];
    if (c === undefined) throw new Error('no covered cell');
    return row({
      origin,
      dest: c.destination,
      dep: c.departureDate,
      ret: c.returnDate,
      price: 300 + ((i + offset) % 50),
    });
  });
}
const pageOf = (request: Request) => new URL(request.url).searchParams.get('page') ?? '?';
const tileIndexes = (h: Harness, type: 'reserve' | 'cache-hit') => eventsOf(h, type).map((e) => e.tileIndex);

describe('fetchTile pagination (spec §5.2: one tile, every page ledgered under its tile_index)', () => {
  it('fetches page 2 after a full page of 1000 and stops at a short page (synthetic 1000 + 3)', async () => {
    const pages: string[] = [];
    server.use(
      http.get(TP, ({ request }) => {
        const page = pageOf(request);
        pages.push(page);
        return HttpResponse.json(envelope(page === '1' ? rowsFor(1000) : rowsFor(3, 1000)));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const tile = only(d.plan(q));
    const r = tileOf(await d.fetchTile(tile, q, ctx()));
    expect(pages).toEqual(['1', '2']);
    // two upstream attempts, both first attempts under the tile's index, at zero cost, each finalised once
    expect(eventsOf(h, 'reserve').map((e) => [e.tileIndex, e.httpAttempt, e.costMicroGbp])).toEqual([
      [tile.index, 1, 0],
      [tile.index, 1, 0],
    ]);
    expect(eventsOf(h, 'finalise')).toHaveLength(2);
    expect(r.prices).toHaveLength(1003);
    expect(r.truncated).toBeUndefined();
    expect(r.notes).toEqual(['pages:2', 'rows-received:1003']);
  });

  it('a full last page costs one more request that returns zero rows', async () => {
    const pages: string[] = [];
    server.use(
      http.get(TP, ({ request }) => {
        const page = pageOf(request);
        pages.push(page);
        return HttpResponse.json(envelope(page === '1' ? rowsFor(1000) : []));
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(pages).toEqual(['1', '2']);
    expect(r.prices).toHaveLength(1000);
    expect(r.notes).toEqual(['pages:2', 'rows-received:1000']);
  });

  it(`stops at MAX_PAGES (${MAX_PAGES}): rows read still price their cells; every other covered cell is an upstream issue, never no_data (ruling 10)`, async () => {
    // every page carries 1000 rows over cells 0..5: cells 0..4 priced, cell 5 only with price 0 (distinct prices per
    // page, so no page repeats)
    const firstSix = covered.slice(0, 6);
    server.use(
      http.get(TP, ({ request }) => {
        const n = Number(pageOf(request));
        const data = Array.from({ length: 1000 }, (_, i) => {
          const c = firstSix[i % 6];
          if (c === undefined) throw new Error('no cell');
          const price = i % 6 === 5 ? 0 : 300 + n + (i % 7);
          return row({ origin: 'LHR', dest: 'JFK', dep: c.departureDate, ret: c.returnDate, price });
        });
        return HttpResponse.json(envelope(data));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const tile = only(d.plan(q));
    const r = tileOf(await d.fetchTile(tile, q, ctx()));
    expect(eventsOf(h, 'reserve')).toHaveLength(MAX_PAGES);
    expect(tileIndexes(h, 'reserve').every((i) => i === tile.index)).toBe(true);
    expect(new Set(r.prices.map(cellKeyString))).toEqual(new Set(firstSix.slice(0, 5).map(cellKeyString)));
    const [badPrice, ...unread] = r.cellIssues ?? [];
    // the cell whose rows were all unusable keeps its parse issue; it is not reported twice
    expect(badPrice).toMatchObject({ cell: firstSix[5], reason: 'parse' });
    expect(unread).toHaveLength(covered.length - 6);
    expect(
      unread.every(
        (i) =>
          i.reason === 'upstream' &&
          i.offersDropped === 0 &&
          i.detail === `pagination truncated at ${MAX_PAGES} pages`,
      ),
    ).toBe(true);
    expect(r.notes).toContain(`pages-truncated:${MAX_PAGES}`);
    // ruling 5: priced cells hold the cheapest of the rows read, and the tile says so
    expect(r.truncated).toBe(true);
  });

  it(`a short page at MAX_PAGES (${MAX_PAGES}) is the last page, not a truncation (ts2-004)`, async () => {
    server.use(
      http.get(TP, ({ request }) => {
        const n = Number(pageOf(request));
        return HttpResponse.json(envelope(n < MAX_PAGES ? rowsFor(1000, n) : rowsFor(999, n)));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(eventsOf(h, 'reserve')).toHaveLength(MAX_PAGES);
    expect(r.truncated).toBeUndefined();
    expect(r.cellIssues).toBeUndefined();
    expect(r.notes.some((n) => n.startsWith('pages-truncated'))).toBe(false);
  });

  it('BudgetExceeded on page 2 propagates; page 1 prices are never returned as a partial tile (ts2-004)', async () => {
    server.use(
      http.get(TP, ({ request }) =>
        HttpResponse.json(envelope(pageOf(request) === '1' ? rowsFor(1000) : rowsFor(3))),
      ),
    );
    const h = makeHarness({ refuse: 2 });
    const d = discoveryOf(makeProvider(h));
    const q = query();
    await expect(d.fetchTile(only(d.plan(q)), q, ctx())).rejects.toBeInstanceOf(BudgetExceeded);
    expect(eventsOf(h, 'reserve')).toHaveLength(1);
  });

  it('an abort after page 1 raises AbortedError; page 1 prices are never returned (ts2-004)', async () => {
    const ac = new AbortController();
    server.use(
      http.get(TP, () => {
        ac.abort();
        return HttpResponse.json(envelope(rowsFor(1000)));
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    await expect(d.fetchTile(only(d.plan(q)), q, ctx(ac.signal))).rejects.toBeInstanceOf(AbortedError);
  });

  it('a vendor that ignores `page` (the same full page again) is a parse error, not a silent loop', async () => {
    let hits = 0;
    server.use(
      http.get(TP, () => {
        hits += 1;
        return HttpResponse.json(envelope(rowsFor(1000)));
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx()))).toMatchObject({
      kind: 'parse',
      reason: 'parse',
      message: expect.stringContaining('[page-repeated]'),
    });
    expect(hits).toBe(2);
  });

  it('stamps fetchedAt with the oldest page (spec §2), which differs from the newest here', async () => {
    const h = makeHarness();
    server.use(
      http.get(TP, ({ request }) => {
        if (pageOf(request) === '1') return HttpResponse.json(envelope(rowsFor(1000)));
        return HttpResponse.json(envelope(rowsFor(3)));
      }),
    );
    // why: the clock moves between the two pages, so page 2's fetchedAt is later and only "oldest" gives NOW.
    const kit = h.http;
    h.http = {
      request: async (r) => {
        const res = await kit.request(r);
        h.clock.advance(60_000);
        return res;
      },
      stats: () => kit.stats(),
    };
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r.fetchedAt).toBe(NOW);
    expect(h.clock.now()).toBe('2026-10-14T15:02:00.000Z');
  });
});

describe('currency on every page (spec §2: a response that states no currency is a parse error)', () => {
  it('passes a non-GBP currency through unconverted (upper-cased ISO code); FX is WP7 normalisation', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope(
            [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 500 })],
            'usd',
          ),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r.prices.map((p) => [p.amountMinor, p.currency])).toEqual([[50000, 'USD']]);
  });

  it('rows under an envelope without currency are a parse error', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json({
          success: true,
          data: [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 })],
        }),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx()))).toMatchObject({
      kind: 'parse',
      retryable: false,
      message: expect.stringContaining('[currency-missing]'),
    });
  });

  it('page 2 with rows and no currency is a parse error; its rows never take page 1’s currency (prov-wp06-002)', async () => {
    server.use(
      http.get(TP, ({ request }) =>
        HttpResponse.json(
          pageOf(request) === '1' ? envelope(rowsFor(1000)) : { success: true, data: rowsFor(3) },
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx())).message).toContain('[currency-missing]');
  });

  it('a currency core does not know is a tile with per-cell currency-unsupported issues, never a tile error (plan decision 29)', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope(
            [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 500 })],
            'qqq',
          ),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r.prices).toEqual([]);
    expect(r.cellIssues).toEqual([
      expect.objectContaining({ reason: 'currency-unsupported', offersDropped: 1 }),
    ]);
  });

  it('a currency that changes between pages is a parse error', async () => {
    server.use(
      http.get(TP, ({ request }) =>
        HttpResponse.json(pageOf(request) === '1' ? envelope(rowsFor(1000)) : envelope(rowsFor(3), 'eur')),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx())).message).toContain(
      '[currency-changed-between-pages]',
    );
  });
});

describe('fetchTile returns raw vendor shapes (spec §2, §5.2 "Raw only")', () => {
  it('keys prices by the response dates, reports a covered cell whose only row was unusable, and counts the rest in notes', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope([
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-30', price: 350 }),
            row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 }),
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-13', ret: '2027-03-24', price: 0 }),
          ]),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
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
    // the 13 → 24 March cell had a row, so the engine records it error (reason parse), never no_data (spec §8.1)
    expect(r.cellIssues).toEqual([
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-13', returnDate: '2027-03-24' },
        reason: 'parse',
        offersDropped: 1,
        detail: expect.stringContaining('[bad-price]'),
      },
    ]);
    expect(r.noFares).toEqual([]);
    expect(r.pointOfSale).toBe('unknown');
    expect(r.notes).toEqual([
      'dropped-other-origin:1',
      'dropped-outside-band:1',
      'offers-dropped:1',
      'pages:1',
      'rows-received:4',
    ]);
  });

  it('a malformed row anywhere makes the tile a parse error: its cells cannot be told apart', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope([
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
            { price: 1 },
          ]),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx())).message).toContain('[malformed-row]');
  });
});

/** The worked example's pairs over its 182-day window, 10–21 nights; the definition lists both London airports. */
const workedQuery = (origin: Iata, destination: Iata) =>
  query({
    origin,
    destination,
    departureFrom: asIsoDate('2027-01-01'),
    departureTo: asIsoDate('2027-07-01'),
    minNights: 10,
    maxNights: 21,
  });

describe('estimate parity and cache dedup across sibling pairs (spec §5.2, §8.1)', () => {
  it('worked example: 28 tiles, 14 upstream calls, 14 cache hits, every ledger row under its own tile index', async () => {
    const upstream: string[] = [];
    server.use(
      http.get(TP, ({ request }) => {
        const u = new URL(request.url);
        upstream.push(
          `${u.searchParams.get('origin')}|${u.searchParams.get('destination')}|${u.searchParams.get('departure_at')}`,
        );
        return HttpResponse.json(envelope([]));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    let tiles = 0;
    for (const origin of [asIata('LHR'), asIata('LGW')]) {
      for (const destination of [asIata('JFK'), asIata('EWR')]) {
        const q = workedQuery(origin, destination);
        for (const p of d.plan(q)) {
          tiles += 1;
          const before = h.events.length;
          tileOf(await d.fetchTile(p, q, ctx()));
          // each tile leaves exactly one ledger row (upstream reserve or cache hit) with its own index
          const rows = h.events.slice(before).filter((e) => e.type === 'reserve' || e.type === 'cache-hit');
          expect(
            rows.map((e) => (e.type === 'reserve' || e.type === 'cache-hit' ? e.tileIndex : null)),
          ).toEqual([p.index]);
        }
      }
    }
    expect(tiles).toBe(28);
    expect(upstream).toHaveLength(14);
    expect(new Set(upstream).size).toBe(14);
    expect(upstream.every((s) => s.startsWith('LON|'))).toBe(true);
    expect(eventsOf(h, 'reserve')).toHaveLength(14);
    expect(eventsOf(h, 'cache-hit')).toHaveLength(14);
  });

  it('a 2-page metro tile served to the sibling pair from the cache is one cache-hit row, not one per page (plan decision 24)', async () => {
    server.use(
      http.get(TP, ({ request }) => {
        const lhr = rowsFor(500, 0, 'LHR');
        const lgw = rowsFor(500, 0, 'LGW');
        return HttpResponse.json(
          pageOf(request) === '1' ? envelope([...lhr, ...lgw]) : envelope(rowsFor(3, 7, 'LGW')),
        );
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    for (const origin of [asIata('LHR'), asIata('LGW')]) {
      const q = query({ origin });
      tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    }
    // parity = distinct upstream tiles (1) + cache-hit rows (1) = plan().length summed over the two pairs (2)
    expect(eventsOf(h, 'reserve')).toHaveLength(2);
    expect(new Set(tileIndexes(h, 'reserve')).size).toBe(1);
    expect(eventsOf(h, 'cache-hit')).toHaveLength(1);
    expect(h.requests.map((r) => [r.url.searchParams.get('page'), r.ledgerCacheHit])).toEqual([
      ['1', true],
      ['2', false],
      ['1', true],
      ['2', false],
    ]);
  });

  it('known gap, pinned so a fix flips it on purpose: page 1 cached but page 2 expired counts the tile twice in parity (ts2-004)', async () => {
    server.use(
      http.get(TP, ({ request }) =>
        HttpResponse.json(pageOf(request) === '1' ? envelope(rowsFor(1000)) : envelope(rowsFor(3))),
      ),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const lhr = query({ origin: asIata('LHR') });
    const lgw = query({ origin: asIata('LGW') });
    tileOf(await d.fetchTile(only(d.plan(lhr)), lhr, ctx()));
    // page 2's cache entry expires before the sibling pair reads it
    const page2 = h.cache.sets[1];
    if (page2 === undefined) throw new Error('page 2 was not cached');
    h.cache.entries.delete(page2.key);
    tileOf(await d.fetchTile(only(d.plan(lgw)), lgw, ctx()));
    // the sibling tile leaves a cache-hit row (page 1) and an upstream row (page 2) under one tile index
    expect(eventsOf(h, 'cache-hit')).toHaveLength(1);
    expect(eventsOf(h, 'reserve')).toHaveLength(3);
  });

  it('one LON response serves both pairs, each receiving only its own origin_airport rows (ts-003)', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope([
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
            row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 377 }),
          ]),
        ),
      ),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const lhrQ = query({ origin: asIata('LHR') });
    const lgwQ = query({ origin: asIata('LGW') });
    const lhr = tileOf(await d.fetchTile(only(d.plan(lhrQ)), lhrQ, ctx()));
    h.clock.advance(30 * 60_000);
    const lgw = tileOf(await d.fetchTile(only(d.plan(lgwQ)), lgwQ, ctx()));
    expect(lhr.prices.map((p) => [p.origin, p.amountMinor])).toEqual([['LHR', 41200]]);
    expect(lgw.prices.map((p) => [p.origin, p.amountMinor])).toEqual([['LGW', 37700]]);
    expect(eventsOf(h, 'fetch')).toHaveLength(1);
    expect(eventsOf(h, 'cache-hit').map((e) => e.tileIndex)).toEqual([0]);
    // a cache hit carries the original storedAt (spec §2), not the time of the second call
    expect(lgw.fetchedAt).toBe(NOW);
  });

  it('LHR→JFK and LGW→JFK in parallel: 14 tiles, 7 upstream calls, 7 cache-hit rows (plan decision 15: joiners leave their own row)', async () => {
    let upstream = 0;
    server.use(
      http.get(TP, () => {
        upstream += 1;
        return HttpResponse.json(envelope([]));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const runs = [asIata('LHR'), asIata('LGW')].flatMap((origin) => {
      const q = workedQuery(origin, asIata('JFK'));
      return d.plan(q).map((p) => d.fetchTile(p, q, ctx()));
    });
    const results = await Promise.all(runs);
    expect(results.every((r) => r.kind === 'tile')).toBe(true);
    expect(upstream).toBe(7);
    expect(eventsOf(h, 'reserve')).toHaveLength(7);
    expect(eventsOf(h, 'cache-hit')).toHaveLength(7);
  });

  it('a lone London origin queries its own airport and makes O × D × M calls (spec §5.2 rev 14)', async () => {
    const origins: Array<string | null> = [];
    server.use(
      http.get(TP, ({ request }) => {
        origins.push(new URL(request.url).searchParams.get('origin'));
        return HttpResponse.json(envelope([]));
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query({ definitionOrigins: [asIata('LHR')] });
    tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(origins).toEqual(['LHR']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/http/ledgerCacheHit.test.ts test/travelpayouts/fetchTile.test.ts`
Expected: FAIL, `Tests  18 failed | 6 passed (24)`. The first failures:

- `false: a cache hit returns the cached body and writes no cache-hit row`: `AssertionError: expected 1 to be +0`;
- `fetches page 2 after a full page of 1000 …`: `expected [ '1' ] to deeply equal [ '1', '2' ]`;
- `stops at MAX_PAGES (undefined) …`: `MAX_PAGES` is not exported yet;
- `passes a non-GBP currency through unconverted …`: `expected [] to deeply equal [ [ 50000, 'USD' ] ]`.

These six pass already, because each makes one request per tile and the first cut parses the envelope: `absent: the cache hit is ledgered as before`, `rows under an envelope without currency are a parse error`, the abort-after-page-1 case, the 28/14/14 worked example, the 14/7/7 concurrent case and the lone-London-origin case.

- [ ] **Step 3: Implement**

In `packages/providers/src/http/types.ts`, add the last member of `HttpKitRequest`:

```ts
  signal: AbortSignal;
  recordFixtures: boolean;
  /**
   * `false`: a cache hit or a joined in-flight request leaves no cache-hit ledger row. A paginating adapter sets it on
   * every page after the first, so a tile served from the cache is one cache-hit row, as parity counts tiles (spec
   * §5.2, §8.1; plan decision 24). Absent or `true`: the row is written. Upstream attempts are always ledgered.
   */
  ledgerCacheHit?: boolean;
}
```

In `packages/providers/src/http/httpKit.ts`, change the first line of `recordJoin` to:

```ts
    if (r.providerId === 'fx' || r.ledgerCacheHit === false) return;
```

and the cache-hit branch of `request` to:

```ts
        // why: a later page of a paginated tile (ledgerCacheHit false) adds no row; the tile's first page already did.
        if (r.providerId !== 'fx' && r.ledgerCacheHit !== false)
          deps.budget.recordCacheHit({
```

(the `recordCacheHit` arguments are unchanged). The cache key does not read the new field, so nothing else in http-kit changes.

Replace `packages/providers/src/travelpayouts/provider.ts` with:

```ts
/**
 * Travelpayouts / Aviasales Data API adapter (WP6). Spec §2 (Travelpayouts row, fact 1), §5.1, §5.2 (rev 14), §6.9,
 * §8.1. Discovery only: cached round-trip prices from /aviasales/v3/prices_for_dates, one month tile per
 * (origin, destination) pair and departure month, queried by the metro code when two or more of the definition's
 * origins share it, every page through http-kit. Returns raw vendor shapes; the engine normalises (spec §5.6).
 * No airport is named here (spec §1).
 */
import {
  type Cabin,
  type CapabilityInfo,
  type CellIssue,
  type Clock,
  cellKeyString,
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
import { canonicalJson } from '../http/recorder.js';
import type { HttpKit } from '../http/types.js';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import { parseError } from '../shared/errors.js';
import { FIXED_PARAMS, PAGE_LIMIT, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST } from './params.js';
import { attributeRows, cacheableBody, type ResponseCurrency, readEnvelope, WHERE } from './response.js';
import { type MetroLookup, planMonthTiles, type TileParams, tileParams } from './tiles.js';

/**
 * Spec §2 Travelpayouts row: authorised-cached, 48 h. The vendor says prices_for_dates holds round-trip prices
 * (one_way=false) that Aviasales users found within the last 48 hours (docs/providers.md, help article 203956163);
 * rows carry no timestamp (spike fact 1), so the 48 hours is the vendor's declared horizon, never a measured age, and
 * the note attributes the whole description to the vendor. The vendor states no passenger count, so the note names
 * none (ruling 4); WP13's smoke row compares a recorded price with the vendor's own search page. The note avoids every
 * §11 banned word (tested).
 */
export const TRAVELPAYOUTS_INFO: CapabilityInfo = {
  sourceKind: 'authorised-cached',
  maxAgeHours: 48,
  provenanceNote:
    "Travelpayouts describes these as cached round-trip prices that Aviasales users found within the last 48 hours (vendor's declaration; rows carry no timestamp). From the authorised Travelpayouts Data API. Economy only; point of sale unknown; not a fare quote; constraints are not checked.",
};
/**
 * Spec §5.2: from recorded fixtures only. A row names one airline, one flight number and transfer counts, which is
 * not a segment list, so only the price is supplied; Task 6.9 pins the recorded row keys so a new field fails a test.
 */
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[] = ['price'];
/** Spec §2 fact 1 and §5.2: trip_class is ignored, so economy only; the engine never calls this provider for another cabin. */
export const TRAVELPAYOUTS_CABINS: readonly Cabin[] = ['economy'];
/** Spec §2: market is ignored, so every tile's point of sale is unknown. */
export const TRAVELPAYOUTS_POINT_OF_SALE = 'unknown' as const;
/**
 * Most pages read for one tile. why: a loop guard. 3 pages (3000 rows) is the cap WP4b's recorder uses (plan decision
 * 26), so every page the adapter can ask for is one a recording can hold, and it bounds the free calls a vendor that
 * ignores `page` could cost (each page is a ledger row). No worked-example month has been measured yet; Task 6.9 stops
 * if a recorded tile reached the cap. A tile that reaches it is marked `truncated` (its priced cells hold the cheapest
 * of the rows read) and reports an `upstream` issue for each covered cell it did not price (spec §3: an unsearched
 * cell never reads as searched).
 */
export const MAX_PAGES = 3;

/** The plan's constructor options, field for field. */
export interface TravelpayoutsProviderOptions {
  http: HttpKit;
  log: Logger;
  /** Kept for every adapter (plan decision 24); timestamps come from http-kit's fetchedAt. */
  clock: Clock;
  /** TRAVELPAYOUTS_TOKEN; sent only in the X-Access-Token header (spec §2 fact 8). Must not be empty. */
  token: Secret;
  /**
   * Response cache window: TRAVELPAYOUTS_CACHE_TTL_HOURS × 3600. Inside it, a sibling pair's identical metro request
   * is a cache hit. 0 disables that dedup: upstream calls become O × D × M instead of D × M (logged at construction).
   */
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

const older = (a: IsoDateTime | undefined, b: IsoDateTime): IsoDateTime => (a === undefined || b < a ? b : a);

/** Spec §5.1 FlightProvider for Travelpayouts: discovery capability only, no verification. */
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  const log = opts.log.child({ providerId: 'travelpayouts' });

  function tileError(plan: TilePlan, error: ProviderError): DiscoveryTileResult {
    log.warn(
      { tileIndex: plan.index, kind: error.kind, message: error.message },
      'travelpayouts tile failed',
    );
    return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error };
  }

  /** Every page of one tile, in order; throws ProviderError (classified or parse), BudgetExceeded or AbortedError. */
  async function readPages(plan: TilePlan, tp: TileParams, ctx: ProviderContext) {
    const rows: unknown[] = [];
    let currency: ResponseCurrency | undefined;
    let fetchedAt: IsoDateTime | undefined;
    let previous: string | undefined;
    let pages = 0;
    let truncated = false;
    for (let page = 1; ; page += 1) {
      const url = buildRequestUrl(tp, page);
      // why: fail closed before anything leaves the process (spec §5.2 allowlist of names and values).
      assertRequestAllowed(opts.paramsAllowlist, PRICES_FOR_DATES_PATH, url);
      const res = await opts.http.request({
        providerId: 'travelpayouts',
        executionId: ctx.executionId,
        tileIndex: plan.index,
        endpointPath: PRICES_FOR_DATES_PATH,
        method: 'GET',
        url,
        headers: { 'X-Access-Token': opts.token.reveal(), Accept: 'application/json' },
        cache: { ttlSeconds: opts.cacheTtlSeconds, accept: cacheableBody },
        signal: ctx.signal,
        recordFixtures: ctx.recordFixtures,
        // why: the ledger's unit is the tile (plan decision 24); only the first page of a cached tile leaves a row.
        ledgerCacheHit: page === 1,
      });
      pages += 1;
      // why: spec §2, fetchedAt of a multi-call result is the oldest call; ISO strings order lexically.
      fetchedAt = older(fetchedAt, res.fetchedAt);
      const env = readEnvelope(res.body);
      // why: every page states its own currency (spec §2), so no page's amounts take another page's currency.
      if (currency !== undefined && env.currency.code !== currency.code) {
        throw parseError(
          'currency-changed-between-pages',
          `page ${page} is in ${env.currency.code}, page 1 in ${currency.code}`,
          WHERE,
        );
      }
      currency = env.currency;
      rows.push(...env.rows);
      if (env.rows.length < PAGE_LIMIT) break;
      // why: a vendor that ignores `page` returns the same full page forever; stop at the second copy (cost-wp06-004).
      const fingerprint = canonicalJson(env.rows);
      if (fingerprint === previous)
        throw parseError('page-repeated', `page ${page} repeats page ${page - 1}`, WHERE);
      previous = fingerprint;
      if (page === MAX_PAGES) {
        truncated = true;
        break;
      }
    }
    // why: unreachable; the loop runs at least once and sets both (kept for the type checker).
    if (currency === undefined || fetchedAt === undefined) throw new Error('travelpayouts: no page was read');
    return { rows, currency, fetchedAt, pages, truncated };
  }

  /**
   * Spec §5.2: one tile, all of its pages (limit=1000, page=1..n until a short page, at most MAX_PAGES), each sent
   * through http-kit under the tile's index. Spec §8.1: a ProviderError on any page makes the whole tile a
   * tile-error (no partial prices); BudgetExceeded and AbortedError propagate to the engine.
   */
  async function fetchTile(
    plan: TilePlan,
    q: DiscoveryQuery,
    ctx: ProviderContext,
  ): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, q, opts.airports);
    let read: Awaited<ReturnType<typeof readPages>>;
    let attribution: ReturnType<typeof attributeRows>;
    try {
      read = await readPages(plan, tp, ctx);
      attribution = attributeRows(read.rows, {
        coveredCells: plan.coveredCells,
        origin: tp.pairOrigin,
        destination: tp.destination,
        minNights: q.minNights,
        maxNights: q.maxNights,
        currency: read.currency,
      });
    } catch (e) {
      // why: only classified vendor failures become a tile-error; no adapter-level retry (spec §5.2).
      if (e instanceof ProviderError) return tileError(plan, e);
      throw e;
    }
    const { notes } = attribution;
    notes.add('rows-received', read.rows.length);
    notes.add('pages', read.pages);
    const cellIssues: CellIssue[] = [...attribution.cellIssues];
    if (read.truncated) {
      // why: spec §3, rows on unread pages may price any cell still without one, so each such cell is an error
      // (reason upstream), never no_data; cells already priced or already reported keep their result (ruling 10).
      notes.add('pages-truncated', MAX_PAGES);
      const done = new Set([
        ...attribution.prices.map(cellKeyString),
        ...cellIssues.map((i) => cellKeyString(i.cell)),
      ]);
      for (const cell of plan.coveredCells) {
        if (done.has(cellKeyString(cell))) continue;
        cellIssues.push({
          cell,
          reason: 'upstream',
          offersDropped: 0,
          detail: `pagination truncated at ${MAX_PAGES} pages`,
        });
      }
    }
    log.debug(
      { tileIndex: plan.index, prices: attribution.prices.length, notes: notes.list() },
      'travelpayouts tile read',
    );
    return {
      kind: 'tile',
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt: read.fetchedAt,
      pointOfSale: TRAVELPAYOUTS_POINT_OF_SALE,
      prices: attribution.prices,
      // why: a cache never proves "no fares", so noFares is always empty (spec §5.2 authorised-cached).
      noFares: [],
      notes: notes.list(),
      ...(cellIssues.length > 0 ? { cellIssues } : {}),
      // why: prices on a capped tile are the cheapest of the rows read; WP7 labels them so (ruling 5).
      ...(read.truncated ? { truncated: true } : {}),
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

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/providers exec vitest run test/http test/travelpayouts`
Expected: PASS, `Test Files  16 passed (16)` (WP4's http tests stay green), `Tests  250 passed (250)`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts pagination inside one tile, page cap with unread-cell issues and the truncated flag; one cache-hit row per tile"
```

### Task 6.6: Error mapping through the real http-kit; HTTP limits

**Files:** create `src/travelpayouts/limits.ts` and `test/travelpayouts/errors.test.ts`.

**Interfaces:**

- Consumes `ProviderHttpLimits`, `ProviderLimits`, `Config` (`maxWaitSeconds`, `requestTimeoutSeconds`), `TRAVELPAYOUTS_DEFAULTS`, `AbortedError`, `BudgetExceeded`, WP4's default status table (through the kit), `takeStrays`, `hangUntilAborted`, `useFakeTime`, `drive`.
- Produces `travelpayoutsHttpLimits`, `TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE`, `TRAVELPAYOUTS_RATE_LIMIT_FALLBACK_WAIT_SECONDS`.

WP4's own tests cover the limiter's queue-age deadline (`limiter.test.ts`) and redirect refusal (`egress.test.ts`) for every provider; they are not repeated here.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/errors.test.ts`:

```ts
import { AbortedError, BudgetExceeded, type DiscoveryTileResult, TRAVELPAYOUTS_DEFAULTS } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderHttpLimits } from '../../src/http/types.js';
import { takeStrays } from '../../src/testing/network.js';
import { travelpayoutsHttpLimits } from '../../src/travelpayouts/limits.js';
import { TP } from '../fakes.js';
import { hangUntilAborted, server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';
import {
  ctx,
  discoveryOf,
  envelope,
  errorOf,
  eventsOf,
  type Harness,
  makeHarness,
  makeProvider,
  only,
  query,
  row,
} from './harness.js';

const cfg = { maxWaitSeconds: 5, requestTimeoutSeconds: 5 };

describe('travelpayoutsHttpLimits (spec §2, §5.3)', () => {
  it('is never billable, costs nothing, allows one host, waits 60 s on a bare 429 and has no classifyError', () => {
    expect(travelpayoutsHttpLimits(TRAVELPAYOUTS_DEFAULTS, cfg)).toEqual({
      hosts: ['api.travelpayouts.com'],
      ratePerMinute: 200,
      ratePerHour: 10_000,
      concurrency: 4,
      billable: 'never',
      costPerCallMicroGbp: 0,
      maxWaitSeconds: 5,
      requestTimeoutSeconds: 5,
      rateLimitFallbackWaitSeconds: 60,
    });
  });

  it('clamps the per-minute rate to the vendor ceiling of 600 (spec §2)', () => {
    expect(
      travelpayoutsHttpLimits({ ...TRAVELPAYOUTS_DEFAULTS, ratePerMinute: 900 }, cfg).ratePerMinute,
    ).toBe(600);
  });
});

/**
 * SYNTHETIC error bodies: none of these was recorded (spec §2 fact 5 recorded only the plain-text 401). The vendor's
 * error body shape is unverified; a success:false envelope with an `error` string is an assumption, and any other
 * shape falls to malformed-envelope. Retry-After values are synthetic too (plan decision 20).
 */
const SYNTHETIC = {
  unauthorised: () =>
    new HttpResponse('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } }),
  status: (status: number, headers: Record<string, string> = {}) =>
    new HttpResponse(JSON.stringify({ error: `synthetic ${status}` }), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
};

describe('fetchTile error mapping through the real http-kit (spec §5.2 Errors; fake timers, spec §9)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  function run(
    handler: (request: Request) => Response | Promise<Response>,
    o: { limits?: ProviderHttpLimits; overrides?: Partial<ProviderHttpLimits>; refuse?: boolean } = {},
  ) {
    let hits = 0;
    server.use(
      http.get(TP, ({ request }) => {
        hits += 1;
        return handler(request);
      }),
    );
    const h = makeHarness({
      ...(o.limits === undefined ? {} : { limits: o.limits }),
      overrides: { maxWaitSeconds: 5, requestTimeoutSeconds: 5, ...o.overrides },
      ...(o.refuse === undefined ? {} : { refuse: o.refuse }),
    });
    const d = discoveryOf(makeProvider(h));
    const q = query();
    return { h, result: drive(d.fetchTile(only(d.plan(q)), q, ctx())), hits: () => hits };
  }
  const attempts = (h: Harness) =>
    eventsOf(h, 'reserve').map((e) => [e.httpAttempt, e.costMicroGbp, e.tileIndex]);
  const finals = (h: Harness) => eventsOf(h, 'finalise').map((e) => [e.outcome, e.httpStatus ?? null]);

  it.each([
    [401, 'auth', SYNTHETIC.unauthorised],
    [403, 'auth', () => SYNTHETIC.status(403)],
    [402, 'quota', () => SYNTHETIC.status(402)],
    [400, 'parse', () => SYNTHETIC.status(400)],
    [404, 'upstream', () => SYNTHETIC.status(404)],
  ] as const)(
    'HTTP %i → tile-error %s, sent once, one ledger row finalised error',
    async (status, kind, handler) => {
      const { h, result, hits } = run(handler);
      expect(errorOf(await result)).toMatchObject({ kind, retryable: false, httpStatus: status });
      expect(hits()).toBe(1);
      expect(attempts(h)).toEqual([[1, 0, 0]]);
      expect(finals(h)).toEqual([['error', status]]);
    },
  );

  it.each([500, 503])(
    "HTTP %i → upstream after http-kit's three attempts, three ledger rows with httpAttempt 1, 2, 3",
    async (status) => {
      const { h, result, hits } = run(() => SYNTHETIC.status(status));
      expect(errorOf(await result)).toMatchObject({ kind: 'upstream', retryable: true, httpStatus: status });
      expect(hits()).toBe(3);
      expect(attempts(h)).toEqual([
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ]);
      expect(finals(h)).toEqual([
        ['error', status],
        ['error', status],
        ['error', status],
      ]);
    },
  );

  it("429 with Retry-After: 0 (synthetic) → rate-limit after http-kit's three attempts", async () => {
    const { h, result, hits } = run(() => SYNTHETIC.status(429, { 'Retry-After': '0' }));
    expect(errorOf(await result)).toMatchObject({ kind: 'rate-limit', retryable: true });
    expect(hits()).toBe(3);
    expect(attempts(h)).toHaveLength(3);
  });

  it('travelpayoutsHttpLimits itself drives the kit: a bare 429 waits its 60 s fallback, beyond MAX_WAIT_SECONDS 5 → limiter-timeout (ts2-003)', async () => {
    const { h, result, hits } = run(() => SYNTHETIC.status(429), {
      limits: travelpayoutsHttpLimits(TRAVELPAYOUTS_DEFAULTS, cfg),
    });
    expect(errorOf(await result)).toMatchObject({
      kind: 'limiter-timeout',
      retryable: false,
      retryAfterSeconds: 60,
    });
    expect(hits()).toBe(1);
    // billable 'never': the attempt is ledgered at zero cost and finalised once
    expect(attempts(h)).toEqual([[1, 0, 0]]);
  });

  it('429 without Retry-After waits the 60 s fallback (spec §5.2): beyond MAX_WAIT_SECONDS 5 → limiter-timeout, sent once', async () => {
    const { result, hits } = run(() => SYNTHETIC.status(429), {
      overrides: { rateLimitFallbackWaitSeconds: 60 },
    });
    expect(errorOf(await result)).toMatchObject({
      kind: 'limiter-timeout',
      retryable: false,
      retryAfterSeconds: 60,
    });
    expect(hits()).toBe(1);
  });

  it('429 without Retry-After, MAX_WAIT_SECONDS 3900: retried after the 60 s fallback, three ledger rows', async () => {
    const times: number[] = [];
    const { h, result, hits } = run(
      () => {
        times.push(Date.now());
        return SYNTHETIC.status(429);
      },
      { overrides: { maxWaitSeconds: 3900, rateLimitFallbackWaitSeconds: 60 } },
    );
    expect(errorOf(await result)).toMatchObject({ kind: 'rate-limit' });
    expect(hits()).toBe(3);
    expect(attempts(h)).toHaveLength(3);
    const [t1, t2] = times;
    if (t1 === undefined || t2 === undefined) throw new Error('two attempts expected');
    expect(t2 - t1).toBeGreaterThanOrEqual(60_000);
  });

  it('429 asking to wait beyond MAX_WAIT_SECONDS → limiter-timeout, sent once (Retry-After honoured, spec §5.3)', async () => {
    const { result, hits } = run(() => SYNTHETIC.status(429, { 'Retry-After': '3600' }));
    expect(errorOf(await result)).toMatchObject({ kind: 'limiter-timeout', retryAfterSeconds: 3600 });
    expect(hits()).toBe(1);
  });

  it('a socket failure → network after three attempts', async () => {
    const { result, hits } = run(() => HttpResponse.error());
    expect(errorOf(await result)).toMatchObject({ kind: 'network' });
    expect(hits()).toBe(3);
  });

  it('a per-request timeout (REQUEST_TIMEOUT_SECONDS 5) → network; Travelpayouts is never billed, so it is retried', async () => {
    const { h, result, hits } = run((request) => hangUntilAborted(request));
    expect(errorOf(await result)).toMatchObject({
      kind: 'network',
      message: expect.stringContaining('[timeout]'),
    });
    expect(hits()).toBe(3);
    expect(finals(h).map(([o]) => o)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('a failure on page 2 makes the whole tile a tile-error; page 1 prices are never returned as a partial tile', async () => {
    const full = Array.from({ length: 1000 }, (_, i) =>
      row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 + i }),
    );
    const { h, result } = run((request) =>
      new URL(request.url).searchParams.get('page') === '1'
        ? HttpResponse.json(envelope(full))
        : SYNTHETIC.unauthorised(),
    );
    const r: DiscoveryTileResult = await result;
    expect(errorOf(r)).toMatchObject({ kind: 'auth', httpStatus: 401 });
    expect(finals(h)).toEqual([
      ['ok', 200],
      ['error', 401],
    ]);
  });

  it('success:false (synthetic) → parse, the vendor text only in the message', async () => {
    const { result } = run(() => HttpResponse.json({ success: false, error: 'invalid destination' }));
    const e = errorOf(await result);
    expect(e).toMatchObject({ kind: 'parse', reason: 'parse' });
    expect(e.message).toContain('invalid destination');
    expect(e.message).toContain('[vendor-error]');
  });

  it('a non-JSON 200 body → parse', async () => {
    const { result } = run(
      () =>
        new HttpResponse('<html>maintenance</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    expect(errorOf(await result)).toMatchObject({ kind: 'parse' });
  });

  it('an unusable body is never cached (cache accept hook): fetching the tile again reaches upstream again, no cache-hit row', async () => {
    let hits = 0;
    server.use(
      http.get(TP, () => {
        hits += 1;
        // rows but no currency: readEnvelope refuses it, so the cache must too (cost-wp06-006)
        return HttpResponse.json({
          success: true,
          data: [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 })],
        });
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const tile = only(d.plan(q));
    await drive(d.fetchTile(tile, q, ctx()));
    await drive(d.fetchTile(tile, q, ctx()));
    expect(hits).toBe(2);
    expect(eventsOf(h, 'cache-hit')).toHaveLength(0);
    expect(h.cache.sets).toHaveLength(0);
  });

  it('an aborted signal raises AbortedError, never a tile-error, and sends nothing', async () => {
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const ac = new AbortController();
    ac.abort();
    await expect(d.fetchTile(only(d.plan(q)), q, ctx(ac.signal))).rejects.toBeInstanceOf(AbortedError);
    expect(eventsOf(h, 'reserve')).toHaveLength(0);
  });

  it('an abort while the request is in flight raises AbortedError and finalises the attempt unknown', async () => {
    server.use(http.get(TP, ({ request }) => hangUntilAborted(request)));
    const h = makeHarness({ overrides: { requestTimeoutSeconds: 60 } });
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const ac = new AbortController();
    const p = d.fetchTile(only(d.plan(q)), q, ctx(ac.signal));
    setTimeout(() => ac.abort(), 1000);
    await expect(drive(p)).rejects.toBeInstanceOf(AbortedError);
    expect(finals(h)).toEqual([['unknown', null]]);
  });

  it('BudgetExceeded from reserve propagates, nothing is sent and no reservation is left open', async () => {
    const { h, result, hits } = run(() => HttpResponse.json(envelope([])), { refuse: true });
    await expect(result).rejects.toBeInstanceOf(BudgetExceeded);
    expect(hits()).toBe(0);
    expect(eventsOf(h, 'finalise')).toHaveLength(0);
    expect(h.budget.open()).toEqual([]);
  });

  it('the network guard covers this adapter: a request no handler answers is a stray, never the real vendor (ts-001)', async () => {
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    expect(errorOf(await drive(d.fetchTile(only(d.plan(q)), q, ctx())))).toMatchObject({ kind: 'network' });
    // takeStrays clears the list, so the setup file's after-each stray check passes once it is asserted here
    expect(takeStrays()).toEqual(
      Array(3).fill('GET https://api.travelpayouts.com/aviasales/v3/prices_for_dates'),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/errors.test.ts`
Expected: FAIL, `Tests  no tests`, with `Error: Cannot find module '../../src/travelpayouts/limits.js' imported from …/test/travelpayouts/errors.test.ts`. Only the three `travelpayoutsHttpLimits` tests are failing-first; the error-mapping rows characterise WP4's http-kit through this adapter and would pass against Task 6.5's code once the import resolves.

- [ ] **Step 3: Implement**

`packages/providers/src/travelpayouts/limits.ts`:

```ts
/**
 * Travelpayouts HTTP limits for http-kit. Spec §2 (free, 600/min), §5.3 (never billable, per-provider host
 * allowlist). Registered by apps/api httpLimitsFor (Task 6.10).
 */
import type { Config, ProviderLimits } from '@gmt/core';
import type { ProviderHttpLimits } from '../http/types.js';
import { TRAVELPAYOUTS_HOST } from './params.js';

/** Vendor per-minute ceiling for prices_for_dates (spec §2; docs/providers.md). */
export const TRAVELPAYOUTS_VENDOR_RATE_PER_MINUTE = 600;

/**
 * Wait for a 429 that carries no Retry-After (spec §5.2: "Travelpayouts 60 s"). why: the vendor states its limits
 * per minute (docs/providers.md, help article 4402565416594), so a refused request can succeed once the minute turns
 * over. Retry-After itself is unverified against this vendor (no 429 was recorded, plan decision 20).
 */
export const TRAVELPAYOUTS_RATE_LIMIT_FALLBACK_WAIT_SECONDS = 60;

/**
 * The configured limits with the rate clamped to the vendor's ceiling; never billable, cost 0.
 * why: no classifyError, because WP4's default table already maps every Travelpayouts case spec §5.2 lists
 * (401/403 → auth, 400 → parse, 402 → quota, 404 → upstream, 429 → rate-limit, 5xx → upstream); there is nothing
 * vendor-specific to recognise, and http-kit applies Retry-After, the fallback wait and limiter-timeout either way.
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
    rateLimitFallbackWaitSeconds: TRAVELPAYOUTS_RATE_LIMIT_FALLBACK_WAIT_SECONDS,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS, `Test Files  5 passed (5)`, `Tests  110 passed (110)` (24 in `errors.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts error mapping through http-kit and http limits"
```

### Task 6.7: Identity, stateless healthcheck, request guards, barrel

**Files:** modify `src/travelpayouts/provider.ts` (two edits), `src/index.ts`, `test/barrel.test.ts` and `vitest.config.ts`; create `test/travelpayouts/provider.test.ts` and `test/travelpayouts/wire.test.ts`.

**Interfaces:** consumes `findBannedWords`, `Secret`, `assertRequestAllowed`. Produces the final `travelpayoutsProvider`, the two barrel exports `travelpayoutsProvider` and `travelpayoutsHttpLimits` (Task 6.8 adds `TRAVELPAYOUTS_PARAMS`) and the per-directory coverage floors.

- [ ] **Step 1: Write the failing tests**

`packages/providers/test/travelpayouts/provider.test.ts`:

```ts
import { findBannedWords, Secret } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import * as barrel from '../../src/index.js';
import { TRAVELPAYOUTS_INFO, TRAVELPAYOUTS_POINT_OF_SALE } from '../../src/travelpayouts/provider.js';
import { ctx, discoveryOf, makeHarness, makeProvider, TOKEN } from './harness.js';

describe('travelpayoutsProvider identity (spec §2, §5.1, §5.2)', () => {
  it('is a discovery-only authorised-cached provider that declares economy only', () => {
    const p = makeProvider(makeHarness());
    expect(p.id).toBe('travelpayouts');
    expect(p.displayName).toBe('Aviasales cache');
    expect(p.verification).toBeUndefined();
    expect(p.cabins).toEqual(['economy']);
    expect(p.suppliedFields).toEqual(['price']);
    expect(discoveryOf(p).info).toEqual({
      sourceKind: 'authorised-cached',
      maxAgeHours: 48,
      provenanceNote: TRAVELPAYOUTS_INFO.provenanceNote,
    });
    expect(TRAVELPAYOUTS_POINT_OF_SALE).toBe('unknown');
  });

  it('the provenance note attributes the round trip and the 48 hours to the vendor, names no passenger count, and uses no banned word (spec §11)', () => {
    expect(TRAVELPAYOUTS_INFO.provenanceNote).toContain(
      "Travelpayouts describes these as cached round-trip prices that Aviasales users found within the last 48 hours (vendor's declaration; rows carry no timestamp)",
    );
    // ruling 4: the vendor states no passenger count, so the note states none
    expect(TRAVELPAYOUTS_INFO.provenanceNote).not.toMatch(/adult|passenger/);
    expect(findBannedWords(TRAVELPAYOUTS_INFO.provenanceNote)).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN])('refuses cacheTtlSeconds %d', (ttl) => {
    expect(() => makeProvider(makeHarness(), { cacheTtlSeconds: ttl })).toThrow(/cacheTtlSeconds/);
  });

  it('refuses an empty token at construction (fails closed: no request is ever made with it)', () => {
    expect(() => makeProvider(makeHarness(), { token: new Secret('') })).toThrow(
      /TRAVELPAYOUTS_TOKEN is empty/,
    );
  });

  it('warns at construction when the response cache is off, because metro dedup then stops (cost-wp06-009)', () => {
    const h = makeHarness();
    makeProvider(h, { cacheTtlSeconds: 0 });
    expect(h.log.lines.some((l) => l.includes('metro dedup off'))).toBe(true);
  });
});

describe('healthcheck (stateless, plan decision 24)', () => {
  it('sends no request, writes no ledger row, and never echoes the token', async () => {
    const h = makeHarness();
    const p = makeProvider(h);
    const first = await p.healthcheck(ctx());
    const second = await p.healthcheck(ctx());
    expect(first).toEqual({
      ok: true,
      detail: 'not probed: token configured; the healthcheck sends no request',
    });
    expect(second).toEqual(first);
    expect(h.events).toEqual([]);
    expect(JSON.stringify(first)).not.toContain(TOKEN.reveal());
  });
});

describe('@gmt/providers barrel (arch-008: the plan contract plus named-consumer extras only)', () => {
  it('exports the adapter and its limits for apps/api wiring, and keeps the shared helpers and constants internal', () => {
    expect(typeof barrel.travelpayoutsProvider).toBe('function');
    expect(typeof barrel.travelpayoutsHttpLimits).toBe('function');
    for (const name of [
      'majorToMinor',
      'parseError',
      'parseVendor',
      'NoteCounter',
      'TRAVELPAYOUTS_INFO',
      'TRAVELPAYOUTS_HOST',
      'PRICES_FOR_DATES_PATH',
    ])
      expect(name in barrel, name).toBe(false);
  });
});
```

`packages/providers/test/travelpayouts/wire.test.ts`:

```ts
import { asIata, asIsoMonth } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { describe, expect, it } from 'vitest';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import { FIXED_PARAMS, PAGE_LIMIT, PRICES_FOR_DATES_PATH } from '../../src/travelpayouts/params.js';
import { buildRequestUrl } from '../../src/travelpayouts/provider.js';
import { TP } from '../fakes.js';
import { server } from '../support/msw.js';
import {
  ALLOWLIST,
  ctx,
  discoveryOf,
  envelope,
  eventsOf,
  makeHarness,
  makeProvider,
  only,
  query,
  TOKEN,
} from './harness.js';

const tp = {
  origin: 'LON',
  pairOrigin: asIata('LHR'),
  destination: asIata('JFK'),
  month: asIsoMonth('2027-03'),
};
const sent = (): URL => buildRequestUrl(tp, 1);

describe('assertRequestAllowed (WP4) on Travelpayouts requests (spec §5.2: names and values)', () => {
  it('accepts exactly what the adapter sends', () => {
    expect(() => assertRequestAllowed(ALLOWLIST, PRICES_FOR_DATES_PATH, sent())).not.toThrow();
  });

  it.each([
    ['an extra parameter', (u: URL) => u.searchParams.set('sorting', 'price')],
    ['market (ignored by the vendor, spec §2 fact 1)', (u: URL) => u.searchParams.set('market', 'uk')],
    ['trip_class (ignored by the vendor)', (u: URL) => u.searchParams.set('trip_class', '1')],
    ['return_at (month tiles send none)', (u: URL) => u.searchParams.set('return_at', '2027-03')],
    ['a wrong fixed value', (u: URL) => u.searchParams.set('currency', 'usd')],
    ['a duplicated parameter', (u: URL) => u.searchParams.append('origin', 'LGW')],
  ] as const)('refuses %s', (_label, mutate) => {
    const u = sent();
    mutate(u);
    expect(() => assertRequestAllowed(ALLOWLIST, PRICES_FOR_DATES_PATH, u)).toThrow();
  });

  it('refuses a token parameter without echoing its value', () => {
    const u = sent();
    u.searchParams.set('token', TOKEN.reveal());
    let caught: unknown;
    try {
      assertRequestAllowed(ALLOWLIST, PRICES_FOR_DATES_PATH, u);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain(TOKEN.reveal());
  });

  it('the page size sent is the page size the short-page rule uses (arch-015)', () => {
    expect(FIXED_PARAMS.limit).toBe(String(PAGE_LIMIT));
  });
});

describe('requests on the wire', () => {
  it('carry exactly the allowlisted names and values, the metro origin, and the token only in X-Access-Token', async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    server.use(
      http.get(TP, ({ request }) => {
        seen.push({ url: request.url, token: request.headers.get('x-access-token') });
        return HttpResponse.json(envelope([]));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    await d.fetchTile(only(d.plan(q)), q, ctx());
    const req = only(seen);
    expect(Object.fromEntries(new URL(req.url).searchParams)).toEqual({
      origin: 'LON',
      destination: 'JFK',
      departure_at: '2027-03',
      one_way: 'false',
      currency: 'gbp',
      limit: '1000',
      page: '1',
    });
    expect(req.token).toBe(TOKEN.reveal());
    expect(req.url).not.toContain(TOKEN.reveal());
    // the token reaches no log line and no ledger row (spec §5.3 sentinel rule)
    expect(h.log.lines.join('\n')).not.toContain(TOKEN.reveal());
    expect(JSON.stringify(eventsOf(h, 'reserve'))).not.toContain(TOKEN.reveal());
  });

  it('an adapter request outside the allowlist is refused before any request is sent', async () => {
    const h = makeHarness();
    const narrow = {
      ...ALLOWLIST,
      endpoints: { [PRICES_FOR_DATES_PATH]: { names: ['origin'], values: { origin: 'any' as const } } },
    };
    const d = discoveryOf(makeProvider(h, { paramsAllowlist: narrow }));
    const q = query();
    await expect(d.fetchTile(only(d.plan(q)), q, ctx())).rejects.toThrow(/not in the/);
    expect(h.events).toEqual([]);
  });
});
```

In `packages/providers/test/barrel.test.ts`, extend the main barrel's "not exported" list after `'classifyResponse',` with:

```ts
      // WP6: the shared adapter helpers stay package-internal (WP5 imports them from ../shared/*.js)
      'majorToMinor',
      'parseError',
      'parseVendor',
      'NoteCounter',
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/provider.test.ts test/travelpayouts/wire.test.ts test/barrel.test.ts`
Expected: FAIL, `Tests  7 failed | 16 passed (23)`: the three `refuses cacheTtlSeconds` cases and the empty-token case (`expected [Function] to throw an error`), the cache-off warning (`expected false to be true`), the healthcheck (`expected { Object (ok, detail) } to deeply equal { ok: true, …(1) }`) and the barrel (`expected 'undefined' to be 'function'`). `wire.test.ts` and `barrel.test.ts` pass already: the allowlist check and the header-only token have been in `fetchTile` since Task 6.2, and nothing is exported yet; they pin both.

- [ ] **Step 3: Implement**

In `packages/providers/src/travelpayouts/provider.ts`, replace the line `  const log = opts.log.child({ providerId: 'travelpayouts' });` at the top of `travelpayoutsProvider` with:

```ts
  if (!Number.isSafeInteger(opts.cacheTtlSeconds) || opts.cacheTtlSeconds < 0) {
    throw new Error('travelpayoutsProvider: cacheTtlSeconds must be a non-negative integer');
  }
  // why: fail closed; an empty token could only produce 401s, each a ledger row and a disabled provider.
  if (opts.token.reveal().length === 0)
    throw new Error('travelpayoutsProvider: TRAVELPAYOUTS_TOKEN is empty');
  const log = opts.log.child({ providerId: 'travelpayouts' });
  if (opts.cacheTtlSeconds === 0) {
    log.warn(
      { cacheTtlSeconds: 0 },
      'travelpayouts: response cache disabled; metro dedup off, upstream calls = O × D × M',
    );
  }
```

and replace `    healthcheck: async () => ({ ok: true, detail: 'token configured' }),` with:

```ts
    // why: stateless like every adapter (plan decision 24). A probe needs an airport pair, and no airport is named in
    // code (spec §1); the token was checked at construction.
    healthcheck: async () => ({
      ok: true,
      detail: 'not probed: token configured; the healthcheck sends no request',
    }),
```

The file is now final.

Append to `packages/providers/src/index.ts`:

```ts
export { travelpayoutsHttpLimits } from './travelpayouts/limits.js'; // WP6: apps/api httpLimitsFor
export { travelpayoutsProvider } from './travelpayouts/provider.js'; // WP6: apps/api providersFor
```

In `packages/providers/vitest.config.ts`, replace the `thresholds` line with:

```ts
      thresholds: {
        lines: 85,
        branches: 70,
        functions: 85,
        statements: 85,
        // why: the adapter and the shared adapter helpers hold to a higher floor, enforced here rather than read by eye
        // (WP6 ts2-006); a glob threshold applies to the files it matches, beside the package-wide floor.
        'src/travelpayouts/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/shared/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
      },
```

(vitest 5 matches each glob against file paths relative to the config root, `packages/providers`; the assembly checked that a 99% branch floor on `src/travelpayouts/**` fails the run with `ERROR: Coverage for branches (95.16%) does not meet "src/travelpayouts/**" threshold (99%)`.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts test/barrel.test.ts`
Expected: PASS, `Test Files  8 passed (8)`, `Tests  133 passed (133)`. Then `pnpm --filter @gmt/providers test` passes with both directory floors met.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts identity, stateless healthcheck, construction guards, contract-only barrel, directory coverage floors"
```

### Task 6.8: `TRAVELPAYOUTS_PARAMS` equal to the recorded allowlist (needs WP4b)

**Files:** append to `src/travelpayouts/params.ts`; modify `src/index.ts`; create `test/travelpayouts/recorded.ts` and `test/travelpayouts/params.test.ts`.

**Interfaces:** consumes `loadRecorded`, `RecordedFixture`, `defaultRecordedRoot`, `loadParamsAllowlist`, `assertRequestAllowed`, `asIsoDate`. Produces `TRAVELPAYOUTS_PARAMS` and the test helpers `RECORDED_ROOT`, `paramsFilePath`, `latestSession`.

- [ ] **Step 1: Write the failing test**

`packages/providers/test/travelpayouts/recorded.ts`:

```ts
/**
 * Loaders for WP4b's recorded Travelpayouts fixtures, through the package's testing subpath (`@gmt/providers/testing`,
 * imported relatively because the package exports point at dist/). loadRecorded refuses files outside
 * fixtures/recorded/ and files whose contentSha256 no longer matches (spec §5.5).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRecordedRoot, type RecordedFixture } from '../../src/http/recorder.js';
import { loadRecorded } from '../../src/testing/index.js';
import { PRICES_FOR_DATES_PATH } from '../../src/travelpayouts/params.js';

/** The package's recorded tree, the same root WP4's recorder writes to (arch-016: one definition). */
export const RECORDED_ROOT = defaultRecordedRoot();
const TRAVELPAYOUTS_DIR = join(RECORDED_ROOT, 'travelpayouts');

/** Path of the latest dated allowlist file (names sort by date); WP4's loadParamsAllowlist reads it. */
export function paramsFilePath(): string {
  const latest = readdirSync(TRAVELPAYOUTS_DIR)
    .filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .at(-1);
  if (latest === undefined)
    throw new Error(`no params-<date>.json under ${TRAVELPAYOUTS_DIR} (WP4b writes it)`);
  return join(TRAVELPAYOUTS_DIR, latest);
}

/**
 * The prices_for_dates recordings of the latest recording session only (plan decision 17: replay filters by session,
 * so a re-recording never mixes pages of two sessions), each with its request URL (credential-free, query kept).
 */
export function latestSession(): {
  session: string;
  recordings: Array<{ url: URL; fixture: RecordedFixture }>;
} {
  const all = loadRecorded(RECORDED_ROOT, 'travelpayouts', PRICES_FOR_DATES_PATH);
  const last = all.at(-1);
  if (last === undefined) throw new Error('WP4b recorded no Travelpayouts prices_for_dates exchange');
  // why: loadRecorded returns recordedAt order, so the last file belongs to the newest session.
  const recordings = all
    .filter((f) => f.session === last.session)
    .map((fixture) => ({ url: new URL(fixture.request.url), fixture }));
  return { session: last.session, recordings };
}
```

`packages/providers/test/travelpayouts/params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as barrel from '../../src/index.js';
import { assertRequestAllowed, loadParamsAllowlist } from '../../src/params/allowlist.js';
import {
  FIXED_PARAMS,
  FORBIDDEN_PARAM_NAMES,
  PRICES_FOR_DATES_PATH,
  TRAVELPAYOUTS_PARAMS,
} from '../../src/travelpayouts/params.js';
import { buildRequestUrl } from '../../src/travelpayouts/provider.js';
import { planMonthTiles, tileParams } from '../../src/travelpayouts/tiles.js';
import { airports, query } from './harness.js';
import { paramsFilePath } from './recorded.js';

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

  it('accepts every page URL the adapter builds, metro and airport origins alike', () => {
    const [plan] = planMonthTiles(query());
    if (plan === undefined) throw new Error('no tile');
    for (const q of [query(), query({ definitionOrigins: [] })]) {
      for (const page of [1, 2]) {
        expect(() =>
          assertRequestAllowed(
            TRAVELPAYOUTS_PARAMS,
            PRICES_FOR_DATES_PATH,
            buildRequestUrl(tileParams(plan, q, airports), page),
          ),
        ).not.toThrow();
      }
    }
  });

  it('is exported from the @gmt/providers barrel for apps/api wiring', () => {
    expect(barrel.TRAVELPAYOUTS_PARAMS).toBe(TRAVELPAYOUTS_PARAMS);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/params.test.ts`
Expected: FAIL, `Tests  3 failed | 1 passed (4)`: `expected undefined to deeply equal { provider: 'travelpayouts', …(3) }`, then `TypeError: Cannot read properties of undefined (reading 'endpoints')` twice. (The barrel test passes vacuously until Step 3, as `undefined` is `undefined`.) If the error is instead `no params-<date>.json under …`, WP4b has not merged: stop and report, and do not create the file.

- [ ] **Step 3: Implement**

Print the two values only the recording knows (§3 mismatch 4):

```bash
node -e "const f=require('fs');const d='packages/providers/fixtures/recorded/travelpayouts';const n=f.readdirSync(d).filter(x=>/^params-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().at(-1);const j=JSON.parse(f.readFileSync(d+'/'+n,'utf8'));console.log(j.recordedAt, j.contentSha256)"
```

In `packages/providers/src/travelpayouts/params.ts`, add below the module doc comment:

```ts
import { asIsoDate } from '@gmt/core';
import type { ParamsAllowlist } from '../params/allowlist.js';
```

and append, writing the two printed values in place of `RECORDED_AT_PRINTED_ABOVE` and `CONTENT_SHA256_PRINTED_ABOVE`:

```ts
// why: these two values exist only once WP4b has recorded; they are copied verbatim from
// fixtures/recorded/travelpayouts/params-<date>.json (Task 6.8 Step 3 prints them), and the equality test fails if
// either drifts. asIsoDate is the brand's only mint site (plan decision 15).
const RECORDED_AT = asIsoDate('RECORDED_AT_PRINTED_ABOVE');
const CONTENT_SHA256 = 'CONTENT_SHA256_PRINTED_ABOVE';

/**
 * The runtime allowlist (plan decision 6: a code constant asserted equal to the recorded file). Keyed by endpoint
 * path; names in ascending order; 'any' for per-request values (plan decision 14).
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

In `packages/providers/src/index.ts`, insert between the two Travelpayouts lines:

```ts
export { TRAVELPAYOUTS_PARAMS } from './travelpayouts/params.js'; // WP6: apps/api providersFor
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts`
Expected: PASS for `params.test.ts` (`4 passed`) and every earlier file. If the equality test fails on `endpoints` (a different key or name order in WP4b's file), stop and report it (plan decision 14 pins path keys and ascending names); do not reshape the constant to the file.

- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "wp06: TRAVELPAYOUTS_PARAMS equals the recorded allowlist"
```

### Task 6.9: Recorded fixtures replay; `suppliedFields`, time format and metro completeness from the recordings (needs WP4b)

This task adds no production code: it checks the adapter, unchanged, against what the vendor really sent. Every assertion is a fact the brief relies on; if one fails, stop and report it with the failing line, and do not change the assertion or the adapter to fit.

**Files:** create `test/travelpayouts/replay.test.ts`.

**Interfaces:** consumes `replayHandlers(root, { session })`, `verifyRecordedTree`, `latestSession`, `majorToMinor`, `AVIASALES_BASE`, `TRAVELPAYOUTS_PARAMS`, `obj`/`arr`/`str` (test/support/guards.ts).

- [ ] **Step 1: Write the test**

`packages/providers/test/travelpayouts/replay.test.ts`:

```ts
import {
  asIata,
  asIsoDate,
  cellKeyString,
  type DiscoveryQuery,
  fromEpochDay,
  type Iata,
  monthOf,
  toEpochDay,
} from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import { majorToMinor } from '../../src/shared/money.js';
import { replayHandlers, verifyRecordedTree } from '../../src/testing/index.js';
import {
  PRICES_FOR_DATES_PATH,
  TRAVELPAYOUTS_HOST,
  TRAVELPAYOUTS_PARAMS,
} from '../../src/travelpayouts/params.js';
import { MAX_PAGES } from '../../src/travelpayouts/provider.js';
import { AVIASALES_BASE } from '../../src/travelpayouts/response.js';
import { SENTINELS } from '../fakes.js';
import { arr, obj, str } from '../support/guards.js';
import { server } from '../support/msw.js';
import {
  ctx,
  discoveryOf,
  errorOf,
  eventsOf,
  makeHarness,
  makeProvider,
  only,
  query,
  tileOf,
} from './harness.js';
import { latestSession, RECORDED_ROOT } from './recorded.js';

const { session, recordings } = latestSession();
const ok = recordings.filter((x) => x.fixture.status === 200);
/** The data rows of a recorded body, narrowed without a cast (test/support/guards.ts). */
const rowsOf = (body: unknown): unknown[] => arr(obj(body).data);
const param = (u: URL, name: string): string => str(u.searchParams.get(name));

/** Recorded 200 pages grouped into tiles by (origin, destination, departure month), pages in order from 1. */
const tiles = new Map<string, typeof ok>();
for (const x of ok) {
  const key = ['origin', 'destination', 'departure_at'].map((n) => param(x.url, n)).join('|');
  tiles.set(key, [...(tiles.get(key) ?? []), x]);
}

/** Row keys the vendor documents for prices_for_dates (Library notes). Any other key needs a human decision. */
const DOCUMENTED_ROW_KEYS = [
  'airline',
  'departure_at',
  'destination',
  'destination_airport',
  'duration',
  'flight_number',
  'link',
  'origin',
  'origin_airport',
  'price',
  'return_at',
  'return_transfers',
  'transfers',
];

/** The worked example's airports per recorded origin parameter: LON serves both London airports. */
const pairOriginsOf = (origin: string): Iata[] =>
  origin === 'LON' ? [asIata('LHR'), asIata('LGW')] : [asIata(origin)];

/** One month of departures, 1–120 nights: wide enough that the band drops only rows a definition could not hold. */
function monthQuery(
  origin: Iata,
  destination: Iata,
  month: string,
  definitionOrigins: Iata[],
): DiscoveryQuery {
  const from = asIsoDate(`${month}-01`);
  let last = toEpochDay(from);
  while (monthOf(fromEpochDay(last + 1)) === monthOf(from)) last += 1;
  return query({
    origin,
    destination,
    departureFrom: from,
    departureTo: fromEpochDay(last),
    minNights: 1,
    maxNights: 120,
    definitionOrigins,
  });
}

/** Installs the recorded session's replay handlers; afterEach asserts no request missed them. */
let misses: () => string[] = () => [];
function replay(): void {
  const r = replayHandlers(RECORDED_ROOT, { session });
  server.use(...r.handlers);
  misses = r.misses;
}
afterEach(() => {
  // why: a miss means the adapter sent a request the vendor was never asked; the replay answered it with an error.
  expect(misses()).toEqual([]);
  misses = () => [];
});

const sumCounts = (notes: readonly string[], keys: (k: string) => boolean): number =>
  notes.map((n) => n.split(':')).reduce((s, [k = '', v = '0']) => (keys(k) ? s + Number(v) : s), 0);

describe('recorded Travelpayouts fixtures (WP4b) replay through replayHandlers (plan decision 17: one session)', () => {
  it('exist for prices_for_dates, carry rows, target the public host, pass the recorded-tree checks and hold no credential header', () => {
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.some((x) => rowsOf(x.fixture.body).length > 0)).toBe(true);
    for (const x of recordings) expect(x.url.hostname).toBe(TRAVELPAYOUTS_HOST);
    // why: the recorder drops credential headers entirely (plan http-kit block); the real token's absence from every
    // file is enforced by WP4's recorder tests and `pnpm secret-scan`, since this test only knows the sentinel (ts2-002).
    for (const x of recordings)
      expect(Object.keys(x.fixture.request.headers).map((k) => k.toLowerCase())).not.toContain(
        'x-access-token',
      );
    expect(
      verifyRecordedTree(RECORDED_ROOT, [SENTINELS.travelpayouts]).filter((p) =>
        p.startsWith('travelpayouts'),
      ),
    ).toEqual([]);
  });

  it.each([...tiles.entries()])(
    'tile %s replays for every pair it serves: pages from 1, rows accounted for, one ledger row per tile',
    async (key, pages) => {
      const [origin = '', destination = '', month = ''] = key.split('|');
      expect(pages.map((p) => param(p.url, 'page'))).toEqual(pages.map((_, i) => String(i + 1)));
      replay();
      const pairOrigins = pairOriginsOf(origin);
      const h = makeHarness();
      const d = discoveryOf(makeProvider(h));
      const received = pages.reduce((n, p) => n + rowsOf(p.fixture.body).length, 0);
      for (const pairOrigin of pairOrigins) {
        const q = monthQuery(pairOrigin, asIata(destination), month, pairOrigins);
        const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
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
        expect(sumCounts(r.notes, (k) => k === 'rows-received')).toBe(received);
        const dropped = sumCounts(r.notes, (k) => k.startsWith('dropped-') || k === 'offers-dropped');
        expect(r.prices.length + dropped).toBe(received);
      }
      // the first pair reaches upstream once per page; the sibling is served from the cache: one row for its whole tile
      expect(eventsOf(h, 'reserve')).toHaveLength(pages.length);
      expect(eventsOf(h, 'cache-hit')).toHaveLength(pairOrigins.length - 1);
    },
  );

  it('the first recorded LHR → JFK row becomes exactly its cell and amount (ts-006)', async () => {
    const metro = ok.find(
      (x) =>
        param(x.url, 'origin') === 'LON' &&
        param(x.url, 'destination') === 'JFK' &&
        rowsOf(x.fixture.body).some((r) => obj(r).origin_airport === 'LHR'),
    );
    if (metro === undefined) throw new Error('WP4b recorded no LON → JFK tile with an LHR row');
    const first = obj(rowsOf(metro.fixture.body).find((r) => obj(r).origin_airport === 'LHR'));
    replay();
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = monthQuery(asIata('LHR'), asIata('JFK'), param(metro.url, 'departure_at'), [
      asIata('LHR'),
      asIata('LGW'),
    ]);
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    const price = typeof first.price === 'number' ? majorToMinor(first.price, 'GBP') : null;
    expect(r.prices).toContainEqual({
      origin: 'LHR',
      destination: 'JFK',
      departureDate: str(first.departure_at).slice(0, 10),
      returnDate: str(first.return_at).slice(0, 10),
      amountMinor: price,
      currency: 'GBP',
      vendorLink: `${AVIASALES_BASE}${str(first.link)}`,
    });
  });

  it('a metro tile prices every cell the airport tile prices, at the same or a lower minimum (prov-wp06-004, pie-wp06-005)', async () => {
    replay();
    const airportTiles = ok.filter((x) => param(x.url, 'origin') !== 'LON' && param(x.url, 'page') === '1');
    expect(airportTiles.length).toBeGreaterThan(0);
    for (const x of airportTiles) {
      const origin = asIata(param(x.url, 'origin'));
      const destination = asIata(param(x.url, 'destination'));
      const month = param(x.url, 'departure_at');
      const d = discoveryOf(makeProvider(makeHarness()));
      const viaAirport = monthQuery(origin, destination, month, [origin]);
      const viaMetro = monthQuery(origin, destination, month, [asIata('LHR'), asIata('LGW')]);
      const a = tileOf(await d.fetchTile(only(d.plan(viaAirport)), viaAirport, ctx()));
      const m = tileOf(await d.fetchTile(only(d.plan(viaMetro)), viaMetro, ctx()));
      const minOf = (ps: typeof a.prices) => {
        const out = new Map<string, number>();
        for (const p of ps)
          out.set(
            cellKeyString(p),
            Math.min(out.get(cellKeyString(p)) ?? Number.POSITIVE_INFINITY, p.amountMinor),
          );
        return out;
      };
      const metroMin = minOf(m.prices);
      // If this fails, compare the two recordings' recordedAt before concluding that the metro query hides fares the
      // airport query sees (the vendor cache moves within 48 h); then stop and report: spec §5.2 would need a ruling.
      for (const [cell, amount] of minOf(a.prices)) {
        expect(metroMin.has(cell), `${cell} priced by the airport tile but absent from the metro tile`).toBe(
          true,
        );
        expect(metroMin.get(cell), `${cell} via the metro`).toBeLessThanOrEqual(amount);
      }
    }
  });

  it('vendor times are local with an explicit offset, never Z, and the recordings show two different offsets (pie-wp06-001)', () => {
    const rows = ok.flatMap((x) => rowsOf(x.fixture.body).map(obj));
    const offset = /[+-]\d{2}:\d{2}$/;
    for (const r of rows) {
      expect(str(r.departure_at)).toMatch(offset);
      expect(str(r.return_at)).toMatch(offset);
    }
    // a transatlantic round trip departs at one UTC offset and returns at another, which proves local times
    expect(rows.some((r) => str(r.departure_at).slice(-6) !== str(r.return_at).slice(-6))).toBe(true);
  });

  it('recorded rows carry only documented keys: no found_at, expires_at or actual, nothing that supplies a constraint input (spec §5.2 suppliedFields)', () => {
    const keys = new Set(ok.flatMap((x) => rowsOf(x.fixture.body).flatMap((r) => Object.keys(obj(r)))));
    // If this fails, stop and report the new key: a human decides whether it supplies anything (TRAVELPAYOUTS_SUPPLIED_FIELDS).
    expect([...keys].filter((k) => !DOCUMENTED_ROW_KEYS.includes(k))).toEqual([]);
  });

  it(`no recorded tile reached the ${MAX_PAGES}-page cap, so the cap guards a loop rather than deciding coverage (pie-wp06-r2-003)`, () => {
    // If this fails, stop and report the tile: a worked-example month holds more rows than MAX_PAGES pages.
    for (const [key, pages] of tiles) expect(pages.length, key).toBeLessThan(MAX_PAGES);
  });

  it('some recorded departure date carries two or more return dates, so a month query is not one row per departure (pie-wp06-r2-001)', () => {
    // If this fails, stop and report: no_data for a nights value of a priced departure day would then mean "the
    // vendor collapsed it", not "nothing cached", and spec §3's no_data meaning for this provider needs a ruling.
    const returnsPerDeparture = new Map<string, Set<string>>();
    for (const [key, pages] of tiles)
      for (const p of pages)
        for (const r of rowsOf(p.fixture.body).map(obj)) {
          const k = `${key}|${String(r.origin_airport)}|${str(r.departure_at).slice(0, 10)}`;
          returnsPerDeparture.set(
            k,
            (returnsPerDeparture.get(k) ?? new Set()).add(str(r.return_at).slice(0, 10)),
          );
        }
    expect([...returnsPerDeparture.values()].some((returns) => returns.size >= 2)).toBe(true);
  });

  it("every recorded 200 states currency 'gbp', the empty envelope included (spec §2; settles brief §3 mismatch 3)", () => {
    for (const x of ok) expect(obj(x.fixture.body).currency).toBe('gbp');
  });

  const empty = ok.filter((x) => rowsOf(x.fixture.body).length === 0);
  // why: TP-19 is best-effort (WP4b); when the probed month held rows there is no empty recording, the test shows as
  // skipped and the report says so, rather than passing without asserting anything.
  it.skipIf(empty.length === 0)(
    'a recorded empty envelope replays as a tile with no prices and no issues: every covered cell is left for no_data',
    async () => {
      replay();
      for (const x of empty) {
        const origins = pairOriginsOf(param(x.url, 'origin'));
        const [first = asIata('LHR')] = origins;
        const q = monthQuery(
          first,
          asIata(param(x.url, 'destination')),
          param(x.url, 'departure_at'),
          origins,
        );
        const d = discoveryOf(makeProvider(makeHarness()));
        const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
        expect(r.prices).toEqual([]);
        expect(r.cellIssues).toBeUndefined();
        expect(r.notes).toEqual(['pages:1']);
      }
    },
  );

  it('the recorded 401 (invalid token) replays as tile-error auth (spec §2 fact 5)', async () => {
    const unauthorised = recordings.find((x) => x.fixture.status === 401);
    if (unauthorised === undefined) throw new Error('WP4b recorded no Travelpayouts 401');
    replay();
    const origins = pairOriginsOf(param(unauthorised.url, 'origin'));
    const [first = asIata('LHR')] = origins;
    const q = monthQuery(
      first,
      asIata(param(unauthorised.url, 'destination')),
      param(unauthorised.url, 'departure_at'),
      origins,
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx()))).toMatchObject({
      kind: 'auth',
      retryable: false,
      httpStatus: 401,
    });
  });

  it('recorded requests satisfy TRAVELPAYOUTS_PARAMS, names and values, and vendor links are site-relative paths', () => {
    for (const x of recordings)
      expect(() => assertRequestAllowed(TRAVELPAYOUTS_PARAMS, PRICES_FOR_DATES_PATH, x.url)).not.toThrow();
    for (const x of ok)
      for (const r of rowsOf(x.fixture.body)) expect(str(obj(r).link).startsWith('/')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @gmt/providers exec vitest run test/travelpayouts/replay.test.ts`
Expected: PASS, `Tests  <11 + the number of recorded 200 tiles> passed`. Under WP4b's call list that is 19 tiles (TP-01…14: LON→JFK and LON→EWR for 2027-03…09; TP-15…18: the four airport tiles of 2027-03; TP-19: the empty-envelope probe), so `30 passed`, or `29 passed | 1 skipped` when TP-19's month held rows and the empty-envelope test skips (say so in the report). Print the tile count in the report. Before WP4b has merged the file fails to load with `WP4b recorded no Travelpayouts prices_for_dates exchange`: that is the blocked state, not a red step to fix.

Then print the facts the brief cannot assert in advance, and put the output in the report:

```bash
node - <<'EOF'
const f=require('fs'),p=require('path');const d='packages/providers/fixtures/recorded/travelpayouts/_aviasales_v3_prices_for_dates';const all=f.readdirSync(d).filter(n=>/^\d{4}-\d{2}-\d{2}-[0-9a-f]{12}\.json$/.test(n)).map(n=>JSON.parse(f.readFileSync(p.join(d,n),'utf8'))).sort((a,b)=>a.recordedAt<b.recordedAt?-1:1);const s=all.at(-1).session;const t=new Map();for(const x of all.filter(x=>x.session===s&&x.status===200)){const u=new URL(x.request.url);const k=['origin','destination','departure_at'].map(q=>u.searchParams.get(q)).join('|');t.set(k,[...(t.get(k)??[]),{page:Number(u.searchParams.get('page')),rows:x.body.data}]);}for(const[k,ps]of t){ps.sort((a,b)=>a.page-b.page);const rows=ps.flatMap(x=>x.rows);const m=k.split('|')[2];const r=new Map();for(const x of rows){const key=x.origin_airport+x.departure_at.slice(0,10);r.set(key,(r.get(key)??new Set()).add(x.return_at.slice(0,10)));}const sorted=rows.every((x,i)=>i===0||rows[i-1].price<=x.price);console.log(k,'pages',ps.length,'rows',rows.length,'maxReturnsPerDeparture',Math.max(0,...[...r.values()].map(v=>v.size)),'departuresNotInTileMonth',rows.filter(x=>x.departure_at.slice(0,7)!==m).length,'priceSortedInPageOrder',sorted);}
EOF
```

For each recorded tile it prints the page count and rows received (pie-wp06-r2-003; the test above already stops at the cap), the most return dates any departure day carries (pie-wp06-r2-001), the rows whose local departure date lies outside the tile's month, which shows whether the vendor buckets `departure_at` by UTC (pie-wp06-001), and whether prices are non-decreasing in page order, the vendor's undocumented default sort (pie-wp06-r2-004; informational, because a capped tile is marked `truncated` whatever the order). Also report, without asserting a route, whether the recorded `link` paths name the metro (`LON`) or the airport, so WP9/WP10 can check their "search link" label (§5).

- [ ] **Step 3: Commit**

```bash
git add packages/providers && git commit -m "wp06: travelpayouts recorded fixtures replay; supplied fields, local times and metro completeness from recordings"
```

### Task 6.10: Wire the adapter into `apps/api` (needs WP4b)

**Files:** modify `apps/api/src/wiring.ts` (`httpLimitsFor` and `providersFor`, one entry each); create `apps/api/test/wiring/travelpayouts.test.ts` (beside WP4b's `test/wiring/` tests).

**Interfaces:**

- Consumes `httpLimitsFor`, `providersFor` (WP4b), `parseConfig` (WP0), `AirportsRepo`, `openDatabase`, `applyMigrations`, `MIGRATIONS_DIR` (WP3), and `travelpayoutsProvider`, `travelpayoutsHttpLimits`, `TRAVELPAYOUTS_PARAMS` (this brief).
- Produces nothing new: the plan's "WP5 and WP6 each add their provider's line".

- [ ] **Step 1: Write the failing test**

`apps/api/test/wiring/travelpayouts.test.ts`:

```ts
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  type Config,
  type DiscoveryQuery,
  fixedClock,
  type Logger,
  parseConfig,
} from '@gmt/core';
import { AirportsRepo, applyMigrations, MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { type HttpKit, type HttpKitRequest, travelpayoutsHttpLimits } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { httpLimitsFor, providersFor } from '../../src/wiring.js';

const TOKEN = 'test-travelpayouts-token-0123456789abcdef';
const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
const base = { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1' };

function config(env: Record<string, string>): Config {
  const r = parseConfig(env, { realpath: (p) => p });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}
const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
};

/** A spy kit: records each request and answers with an empty Travelpayouts envelope (no network, no msw). */
function spyKit(): { http: HttpKit; seen: HttpKitRequest[] } {
  const seen: HttpKitRequest[] = [];
  const http: HttpKit = {
    request: (r) => {
      seen.push(r);
      return Promise.resolve({
        status: 200,
        body: { success: true, data: [], currency: 'gbp' },
        fetchedAt: NOW,
        fromCache: false,
        cacheKey: 'k',
      });
    },
    stats: () => ({ inFlight: 0 }),
  };
  return { http, seen };
}

/** A real AirportsRepo over an empty in-memory database: the wiring type without a cast (plan decision 15). */
function emptyAirports(): AirportsRepo {
  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return new AirportsRepo(db);
}

describe('apps/api wiring: Travelpayouts (plan "Wiring and bootstraps")', () => {
  it('httpLimitsFor registers travelpayoutsHttpLimits when TRAVELPAYOUTS_TOKEN is set: rate clamped to 600, never billable', () => {
    const c = config({ ...base, TRAVELPAYOUTS_TOKEN: TOKEN, TRAVELPAYOUTS_RATE_PER_MINUTE: '900' });
    const tp = c.providers.travelpayouts;
    if (tp === null) throw new Error('travelpayouts not configured');
    const limits = httpLimitsFor(c).travelpayouts;
    expect(limits).toEqual(travelpayoutsHttpLimits(tp.limits, c));
    expect(limits).toMatchObject({
      hosts: ['api.travelpayouts.com'],
      ratePerMinute: 600,
      billable: 'never',
      costPerCallMicroGbp: 0,
      rateLimitFallbackWaitSeconds: 60,
    });
  });

  it('httpLimitsFor has no travelpayouts entry without a token', () => {
    expect(httpLimitsFor(config(base)).travelpayouts).toBeUndefined();
  });

  it('providersFor constructs the adapter only with a token, with the configured TTL, the airports table and the header-only token', async () => {
    const { http, seen } = spyKit();
    const deps = { http, log: silentLog, clock: fixedClock(NOW), airports: emptyAirports() };
    expect(providersFor(config(base), deps).map((p) => p.id)).not.toContain('travelpayouts');
    const p = providersFor(
      config({ ...base, TRAVELPAYOUTS_TOKEN: TOKEN, TRAVELPAYOUTS_CACHE_TTL_HOURS: '3' }),
      deps,
    ).find((x) => x.id === 'travelpayouts');
    if (p?.discovery === undefined) throw new Error('travelpayouts discovery not constructed');
    const q: DiscoveryQuery = {
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureFrom: asIsoDate('2027-03-10'),
      departureTo: asIsoDate('2027-03-10'),
      minNights: 10,
      maxNights: 10,
      cabin: 'economy',
      currency: 'GBP',
      definitionOrigins: [asIata('LHR'), asIata('LGW')],
    };
    const [plan] = p.discovery.plan(q);
    if (plan === undefined) throw new Error('no tile');
    expect(
      (
        await p.discovery.fetchTile(plan, q, {
          executionId: 'exec-1',
          signal: new AbortController().signal,
          recordFixtures: false,
        })
      ).kind,
    ).toBe('tile');
    const [req] = seen;
    expect(req?.cache).toMatchObject({ ttlSeconds: 3 * 3600 });
    // the empty airports table maps no metro, so the origin is the airport
    expect(req?.url.searchParams.get('origin')).toBe('LHR');
    expect(req?.headers['X-Access-Token']).toBe(TOKEN);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring/travelpayouts.test.ts`
Expected: FAIL, `Tests  2 failed | 1 passed (3)`: `AssertionError: expected undefined to deeply equal { …(9) }` and `Error: travelpayouts discovery not constructed`.

- [ ] **Step 3: Implement**

In `apps/api/src/wiring.ts`, add `TRAVELPAYOUTS_PARAMS`, `travelpayoutsHttpLimits` and `travelpayoutsProvider` to the existing `@gmt/providers` import (Biome sorts the names).

In `httpLimitsFor`, add this entry to the returned object literal, after the `fixture` entry:

```ts
    // WP6: Travelpayouts, only when configured (spec §2, §5.3).
    ...(config.providers.travelpayouts === null
      ? {}
      : { travelpayouts: travelpayoutsHttpLimits(config.providers.travelpayouts.limits, config) }),
```

In `providersFor`, insert before `return out;`:

```ts
  // WP6: Travelpayouts, only when configured; the cache TTL is what dedups sibling pairs' metro requests (spec §5.2).
  const tp = config.providers.travelpayouts;
  if (tp !== null) {
    out.push(
      travelpayoutsProvider({
        http: deps.http,
        log: deps.log,
        clock: deps.clock,
        token: tp.token,
        cacheTtlSeconds: tp.limits.cacheTtlHours * 3600,
        paramsAllowlist: TRAVELPAYOUTS_PARAMS,
        airports: deps.airports,
      }),
    );
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/wiring/travelpayouts.test.ts`
Expected: PASS, `Tests  3 passed (3)`. Then `pnpm --filter @gmt/api test` passes with its thresholds; WP4b's own wiring tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp06: wire the travelpayouts adapter and its http limits into apps/api"
```

## 9. Pinned review-focus tests

None of the plan's Review Focus lines is owned by WP6. One test here guards an adjacent risk, Review Focus 1 (metro codes): in WP6 a metro code is only ever a vendor query parameter taken from the airports table, never operator input, and only when two of the definition's origins share it. Task 6.4's metro tests ("sends the airport when the definition has one London airport", "sends the airport when there is no metro", "ignores a metro code that is not three upper-case letters") pin that.

## 10. Definition of done

- `pnpm --filter @gmt/providers test` passes every test file with no "does not meet" line: the package floor (lines 85 / branches 70 / functions 85 / statements 85) and the per-directory floors Task 6.7 puts in `vitest.config.ts` (95 / 90 / 95 / 95 for `src/travelpayouts/**` and `src/shared/**`; the assembly measured statements 99.5 / branches 95.2 and 100 / 93.3).
- `pnpm --filter @gmt/providers exec vitest run test/travelpayouts test/shared test/http/ledgerCacheHit.test.ts test/fixture test/barrel.test.ts` passes 17 files; the only skip allowed is Task 6.9's empty-envelope test when TP-19 held rows (say so in the report).
- `pnpm --filter @gmt/api test` passes with its thresholds, including `test/wiring/travelpayouts.test.ts`.
- `pnpm lint` reports no diagnostics. `pnpm -r typecheck` exits 0.
- `pnpm boundaries` (`node scripts/check-boundaries.mjs`) exits 0: `@gmt/providers` imports only `@gmt/core`, production code never imports the testing subpath, and `process.env` is read only in the allowed files.
- `pnpm secret-scan` exits 0.
- `grep -rnE "'(LHR|LGW|JFK|EWR|LON|NYC)'" packages/providers/src` prints nothing (no airport in code, spec §1).
- `grep -rnE '\bas (unknown|string|number|boolean|[A-Z{(\[])|[=(,:] *<[A-Z][A-Za-z]*>[a-z(]' packages/providers/src/shared packages/providers/src/travelpayouts packages/providers/test/shared packages/providers/test/travelpayouts apps/api/test/wiring/travelpayouts.test.ts | grep -vE '^[^:]+:[0-9]+: *(\*|//)' | grep -v 'as const'` prints nothing (no `as` casts and no `<T>x` assertions, comment lines skipped; plan decision 15). §13 asks for one shared `scripts/check-casts.mjs` instead.
- `grep -rn "token=" packages/providers/src/travelpayouts` prints nothing (header only, spec §2 fact 8).
- `grep -rn "PRINTED_ABOVE" packages/providers/src` prints nothing (Task 6.8's two copied values are filled in).
- `git log --oneline main..HEAD` shows the ten `wp06:` commits of Tasks 6.1–6.10.

**Assembly record (2026-10-15, scratch worktree of `main` at `a001e0d`).** Tasks 6.1–6.9 applied in order: every red step failed with the message and counts quoted above and every green step passed. Tasks 6.8 and 6.9 ran against a synthetic stand-in recorded tree that mirrors WP4b's call list (TP-01…20 in WP4b's file format, written by a scratch script, never committed): 4 and 30 tests passed. Task 6.10 ran against a scratch `wiring.ts` holding WP4b's `httpLimitsFor`/`providersFor`: 3 tests passed. Final state: `pnpm -r typecheck` exit 0, `pnpm lint` clean, `pnpm boundaries` exit 0, `pnpm secret-scan` clean; `pnpm --filter @gmt/providers test` 31 of 31 files, 454 tests, with every floor met (the per-directory floor was shown to fail a run when raised above the measured value); without the stand-in tree, 29 of 31 files pass and the two that need WP4b's recordings (`params.test.ts` equality, `replay.test.ts`) fail as expected.

## 11. Open questions

None. The round-1 questions are settled: healthchecks are stateless, `ok: true`, detail `not probed` (decision 24 as reworded); the metro rule covers origins only and destinations are never collapsed (decision 28, spec rev 14 §5.2).

## 12. Changes outside `src/travelpayouts`

- `packages/core/src/ports/provider.ts` (Task 6.2): `DiscoveryQuery.definitionOrigins?: Iata[]`, `CellIssue` with `DiscoveryTileResult['tile'].cellIssues?: CellIssue[]`, and `DiscoveryTileResult['tile'].truncated?: boolean`. The first two are recorded in decision 28; `truncated` answers ruling 5 without a new closed-list reason (a `CellIssue` must carry an `ErrorReason`, and none means "cheapest of the rows read").
- `packages/providers/src/http/types.ts`, `httpKit.ts` (Task 6.5): `HttpKitRequest.ledgerCacheHit?: boolean` (decision 28).
- `packages/providers/src/shared/` (Task 6.1), and the fixture provider moved onto `parseError` and `NoteCounter` (Task 6.1; its adapter parse errors now carry `reason: 'parse'`, its drop note is `dropped-outside-tile:n`).
- `packages/providers/src/index.ts` and `test/barrel.test.ts` (Tasks 6.7, 6.8): three exports, the shared helpers listed as not exported.
- `packages/providers/vitest.config.ts` (Task 6.7): per-directory coverage floors.
- `apps/api/src/wiring.ts` (Task 6.10): the two Travelpayouts entries.

## 13. For the plan (not yet recorded there)

1. **WP7 rule for `cellIssues` and `truncated`** (prov-wp06-r2-001; decision 28 adds the field but not the engine rule). In commitTile, before the `no_data` fallback, per covered cell: a cell with a price in the tile and a `cellIssues` entry is `priced` with `offers-dropped:<offersDropped>` (merged with the engine's own normalisation drops into one `offers-dropped:n`); a cell with only an entry is `error` with the entry's `reason` and `last_error = detail`; a cell with neither stays `no_data`. A `truncated` tile's prices are labelled "cheapest of the rows read" (in the outcome or price row, WP7's choice; no new closed-list reason). WP7 tests: an issue-only cell becomes `error` (`parse`, `currency-unsupported`, `upstream`); a priced cell with an issue becomes `priced` with the merged `offers-dropped:n`.
2. **Contract fold** (prov-wp06-r2-002): add `definitionOrigins?` (absent means the pair origin alone), `CellIssue` / `cellIssues?` (an entry is never `no_data`) and `truncated?` to spec §5.1 and to the plan's "Provider port" block; add `ledgerCacheHit?` to the plan's http-kit block.
3. **WP5 alignment** (arch-008, arch-010): WP5 deletes its own `NoteCounter` (`shapes.ts`, with `count()`) and imports `src/shared/notes.ts` (`get()`); calls `parseError(cause, detail, { providerId: 'searchapi', endpointPath })` instead of writing a `searchapi …` prefix into the detail; uses `parseVendor` wherever it does `safeParse` + `parseError(cause, zodReason(…))`; builds its harness on `test/fakes.ts` with `syntheticAllowed: false`; puts its wiring test at `apps/api/test/wiring/searchapi.test.ts`. The shared helpers are not barrel exports.
4. **One cast check** (arch-r2-004): a repo script `scripts/check-casts.mjs`, run in CI beside `check-boundaries.mjs`, so every brief's definition of done calls one rule instead of its own grep.
5. **WP13 smoke row** (pie-wp06-002; decision 27 records "compare one recorded fare with the vendor's own page"): for Travelpayouts, compare one recorded round-trip row (TP-01 or TP-15) with the Aviasales search page for the same airports and dates, and record the passenger count that page assumes; the provenance note names no passenger count until then.
