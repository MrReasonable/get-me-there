---
wp: 7
title: engine with layer-A tests
owner: opus
depends_on: [1, 2, 3, 4]
spec_sections: ["§3 (cell outcome seeding)", "§5.6", "§6.7 (selection once, child executions)", "§6.9 (results basis inputs)", "§7 (transactions, resume query, boot order)", "§8.1", "§8.2", "§8.3 (LogNotifier only)", "§9 item 4 layer A", "§14"]
reviewers: [code-architect, test-strategy-reviewer, search-strategy-reviewer, cost-and-budget-reviewer, provenance-auditor, data-model-reviewer, product-owner]
status: draft
---

# WP7 — `@gmt/engine` with layer-A tests

## 1. Goal

Build the execution engine of spec §8 (orchestrator, discovery and verification stage runners, the §5.6 normalisation step over the db repositories, reuse, estimates, pre-start checks, resume, boot and shutdown, the croner scheduler with `parseCron`, FX refresh, the maintenance job wiring and `LogNotifier`) and prove every vendor-agnostic rule of spec §9 item 4 layer A against the fixture provider through the real http-kit, the real `SqliteBudgetGuard` and an in-memory database.

## 2. Scope

**In**

- `createEngine(deps)` producing the plan's "Engine" contract: `boot`, `shutdown`, `start`, `resume`, `cancel`, `verifyCell`, `estimate`, `estimateRemaining`, `budgetFit`, `coverageCheck`, `scheduler { register, unregister, jobs, tick }`, `status`.
- `parseCron(expr, tz)`, the single croner wrapper (spec §8.2), which `api` imports for validation.
- `LogNotifier` and the operator-notification path: message templates, per-execution-and-kind deduplication, the banned-word test over every subject and body.
- The §5.6 normalisation step: airport tz from `AirportsRepo`, money through `toGbp` with `FxRepo`, one calendar price per cell per tile, `offers-dropped:n`, evidenced segment cabins, vendor-link validation.
- Bounded pools per provider `CONCURRENCY` (an in-package helper), one `AbortController` per execution, one per (stage, provider) lane, and `AbortSignal.any` per tile or cell.
- FX refresh through http-kit under the never-billable id `fx`, a daily system job, and a daily maintenance job that calls WP3's `runMaintenance`.
- Layer-A tests: `test/harness.ts` (msw serving the WP4 fixture tree on global fetch, real http-kit, real `SqliteBudgetGuard`, `openDatabase(':memory:')` + `applyMigrations`, `fixedClock`, capturing `Logger` and `Notifier`), and one test per §8.1 error-table row in both stages plus every §9 item 4 layer-A item listed in the dispatch.

**Out**

- `EmailNotifier`, the alert runner, alert templates and digest delivery: WP11 (`src/notifiers/email.ts`, `src/alerts/*`). This package emits only the "alerts running on calendar basis only" operator notification.
- Routes, the 409/422 HTTP mapping of `StartResult`, `needsConfirmation` on `PUT`, the `app_lock` heartbeat, pino construction and `redact` paths: WP8 (`apps/api`).
- Repositories, schema, migrations, the cap predicates inside `reserve`, the compare-and-set SQL, the boot-sweep SQL, `runMaintenance`: WP3 (`@gmt/db`).
- http-kit, the fixture provider and its fixture tree, error classification by status: WP4 (`@gmt/providers`).
- The pure domain functions (`resolveWindow`, `generateCells`, `selectCandidates`, `rollUp`, `normaliseOffer`, `toGbp`, `validateVendorUrl`, …): WP1 and WP2 (`@gmt/core`).
- Layer-B tests (real adapters replaying recorded fixtures): WP13.
- `route_price_history` upserts: no task here, because `ItinerarySearchResult` (spec §5.1) carries no price-history field; see Open questions.

## 3. Spec sections

| Section | What it requires of this package |
|---|---|
| §3 Cell outcome | Seed `not_run` for every cell × discovery provider at start and for every selected cell × verification provider at selection (`skipped:not_selected` otherwise); a stage with no provider has no rows and a `NULL` roll-up; an interrupted cell returns to `not_run`. |
| §5.6 | Normalise every raw price and offer: tz from the airports repository, `toGbp` with `FX_MAX_RATE_AGE_DAYS`, ECB currencies only, one calendar price per (provider, cell) per tile, `offers-dropped:n`, cabin evidence on the observation. |
| §6.7 | Selection runs once per execution, guarded by stage and the existence of verification outcomes; a child execution bypasses it (`alwaysInclude = [cell]`, `maxCells = 1`, no discovery). |
| §6.9 | The engine writes what results need: `best_observation_id`, child observations reachable through `observationsForDefinition`, verification outcomes that `latestVerificationOutcomeForCell` reads for `notSeenInLatest`, reused calendar rows carrying the original `fetched_at`. |
| §7 | Atomic units (seeding; each tile; selection + verification seeding; each reused cell; supersede in the same transaction; each verified cell); the resume query per (stage, provider); the boot `running → interrupted` update; synchronous transaction callbacks. |
| §8.1 | Lifecycle, pre-start checks per scope, `SOFT_CONFIRM`, reuse with the 0.9 tolerance, the error table, estimate and parity, resume compare-and-set, `departed`, supersede, boot order, SIGTERM, notifications, single-cell verification. |
| §8.2 | croner with `timezone`, re-registration on create/PUT/disable/enable/delete, the tick order, one-shot resume jobs, `skipped_missed`, `parseCron` as the sole validator (sub-hourly rejected, tz validated), `budgetFit`. |
| §8.3 | `LogNotifier`: plain text, provider strings control-stripped, synthetic refused. |
| §9 item 4 | Layer A: every listed behaviour as a test through the fixture provider at `fixture.local`. |
| §14 | `executionId`, `definitionId`, `providerId` on engine log lines; no full URLs. |

## 4. Interfaces consumed

Copied verbatim from the plan's "Cross-package contracts". Where a contract names a type without defining it, the shape this brief relies on is stated under **4.9 Shapes this brief assumes**; each of those is also an Open question for Fable to close in the plan before dispatch.

### 4.1 `@gmt/core` (WP0)

```ts
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$, upper-case
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export function asIata(s: string): Iata;
export function asIsoDate(s: string): IsoDate;
export function asIsoDateTime(s: string): IsoDateTime;

export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = 'GB' | 'unknown';
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}

export type WindowSpec = { kind: 'absolute'; from: IsoDate; to: IsoDate } | { kind: 'relative'; startOffsetDays: number; lengthDays: number };
export interface ResolvedSpace { origins: Iata[]; destinations: Iata[]; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }
export interface Cell extends CellKey { nights: number }
export interface VerificationPolicy { maxCells: number; topN: number; priceCeilingPence?: number; perDepartureDateBest?: number; alwaysInclude: CellKey[]; expandTop: number; bookingLinks: boolean; maxStops?: number }
export interface ExecutionBudget { maxCalls: number; maxFreeCalls: number; maxCostMicroGbp: number }
export interface ProvidersConfig { discovery: ProviderId[]; verification: ProviderId[]; discoveryRefreshHours: Partial<Record<ProviderId, number>> }
export interface SearchDefinition {
  id: string; name: string; origins: Iata[]; destinations: Iata[]; window: WindowSpec; minNights: number; maxNights: number;
  cabin: Cabin; constraints: Constraints; verification: VerificationPolicy; budget: ExecutionBudget; providers: ProvidersConfig;
  destinationNotes: Partial<Record<Iata, string>>; onwardCostPence: Partial<Record<Iata, number>>;
  scheduleCron: string | null; scheduleTz: string; confirmedCostPence: number | null; enabled: boolean;
  createdAt: IsoDateTime; updatedAt: IsoDateTime; deletedAt: IsoDateTime | null;
}
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean };

export type ExecutionStatus = 'pending' | 'running' | 'paused_budget' | 'paused_error' | 'interrupted' | 'cancelled' | 'completed'
  | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed';
export const ACTIVE_STATUSES: readonly ExecutionStatus[] = ['pending', 'running', 'paused_budget', 'paused_error', 'interrupted'];
export const RESUMABLE_STATUSES: readonly ExecutionStatus[] = ['interrupted', 'paused_budget', 'paused_error', 'cancelled', 'completed'];
export type Stage = 'discovery' | 'verification';
export type CellOutcomeStatus = 'not_run' | 'priced' | 'empty' | 'no_data' | 'error' | 'skipped';
export type SkipReason = 'not_selected' | 'budget' | 'provider_disabled' | 'departed';
export interface CellOutcome extends CellKey {
  executionId: string; stage: Stage; providerId: ProviderId; status: CellOutcomeStatus; reason: string | null;
  attempts: number; lastError: string | null; fetchedAt: IsoDateTime | null; minPence: number | null;
  cabin: Cabin | null; pointOfSale: PointOfSale | null; sourceKind: SourceKind | null; reusedFromExecutionId: string | null;
}
export interface RollUp { status: RollUpStatus | null; reason: SkipReason | string | null; minPence: number | null }
export type SelectionReason = 'always_include' | 'top_n' | 'ceiling' | 'stride';

export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export interface Offer { itineraryHash: string; providerId: ProviderId; seller: string; cabin: Cabin }

export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }

export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void };   // WP0 also adds set(at)

export type NormalisationReason = 'fx-unavailable' | 'currency-unsupported' | 'unknown-airport-tz' | 'no-return-legs' | 'unmappable-carrier' | 'bad-local-time';
export class NormalisationError extends Error { reason: NormalisationReason; detail?: string }
export function stripUrlsInText(text: string): string;   // errors.ts, WP0 Task 0.4

export const BANNED_WORDS: readonly string[];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export function parseConfig(env: Record<string, string | undefined>, opts: ParseConfigOptions): ConfigResult;
export type PlanId = 'trial' | '40usd';
export interface ProviderLimits { monthlyCallCap: number; window: 'month' | 'lifetime'; billingDay: number; ratePerMinute: number; ratePerHour: number; concurrency: number; cacheTtlHours: number; costPerCallMicroGbp: number; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export const TRAVELPAYOUTS_DEFAULTS: ProviderLimits;
// Config: exactly the plan's "Config" block (spend.softConfirmMicroGbp, spend.childMaxCalls, estimateRetryFactor,
// fxMaxRateAgeDays, autoResume, maxAutoResumes, stuckAfterHours, schedulerTimezone, pointOfSale, providers.*.limits).
// AlertDigest and OperatorMessage exactly as WP0 Task 0.4 step 3:
// OperatorMessage = { kind: 'paused_budget' | 'paused_error' | 'skipped_budget' | 'skipped_confirm' | 'skipped_window'
//   | 'skipped_missed' | 'interrupted' | 'provider_disabled' | 'parity_break' | 'alerts_calendar_only';
//   executionId: string | null; definitionId: string; subject: string; body: string }
export * as apiContract from './api-contract/index.js';   // estimateResponseSchema, budgetFitSchema, coverageCheckResponseSchema
```

Spec §5.1 port block (verbatim in `ports/provider.ts`): `ProviderId`, `CapabilityInfo`, `DiscoveryQuery`, `TilePlan`, `TileRequest`, `RawCalendarPrice`, `DiscoveryTileResult`, `ItineraryQuery`, `RawSegment`, `RawOffer`, `ItinerarySearchResult`, `ProviderContext`, `DiscoveryCapability`, `VerificationCapability`, `FlightProvider`, `CostEstimate`, `Reservation`, `BudgetGuard`, `ResponseCache`, `Notifier`, `ProviderError`, `BudgetExceeded`, `AbortedError`.

### 4.2 `@gmt/core` (WP1)

```ts
export function cellKeyString(cell: CellKey): string;                 // `O|D|dep|ret`
export function monthOf(d: IsoDate): IsoMonth;
export function monthsSpanned(from: IsoDate, to: IsoDate): IsoMonth[];
export function resolveWindow(def: WindowSpec, todayLondon: IsoDate): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean };
export function generateCells(space: ResolvedSpace): Cell[];          // deterministic order
export function selectCandidates(policy, cells, discovery: Map<string, RollUp>, hasDiscoveryProvider: boolean): Array<{ cell: CellKey; reason: SelectionReason }>;
```

### 4.3 `@gmt/core` (WP2)

```ts
export function toGbp(amountMinor: number, currency: string, rateNano: number): number;
export const MINOR_EXPONENT: Record<string, number>;
export const ECB_CURRENCIES: readonly string[];
export function validateVendorUrl(url: string, allowlist: readonly string[]): Booking;
export function normaliseOffer(raw: RawOffer, deps: { tzOf(iata): string | null; rateFor(currency): { rateNano; rateDate; source } | null; cabin: Cabin }): { itinerary: NormalisedItinerary; offer; observationFields } | NormalisationError;
```

The engine uses only `itinerary` from `normaliseOffer`'s success value; money, provenance, booking and the offer identity are built in `src/normalise.ts` from the raw offer (Task 7.7), so nothing depends on the undefined `observationFields` shape.

### 4.4 `@gmt/db` (WP0, WP3)

```ts
export interface Db { raw: BetterSqlite3.Database; drizzle: BetterSQLite3Database; transaction<T>(fn: () => T): T; close(): void }
export function openDatabase(path: string): Db;
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };
export class AirportsRepo { exists(iata): boolean; get(iata): Airport | null; search(q: string, limit): Airport[]; metroOf(iata): string | null; sharedMetro(iatas: Iata[]): string | null; count(): number; upsertAll(rows, datasetVersion): void }
export class FxRepo { rateNano(date: IsoDate, currency: string): number | null; latest(currency, maxAgeDays, today): { rateNano; date } | null; upsert(rows): void }
export class DefinitionsRepo { create(input): SearchDefinition; update(id, patch): SearchDefinition; get(id): SearchDefinition | null; list(): SearchDefinition[]; softDelete(id): void; setConfirmedCost(id, pence): void }
export class ExecutionsRepo { create(input): Execution; get(id): Execution | null; listForDefinition(id, opts): Execution[]; activeParent(definitionId): Execution | null; activeChild(definitionId, cell): Execution | null; latestCompleted(definitionId): Execution | null; claimResume(id): boolean /* compare-and-set */; setStatus(id, status, patch?): void; bootSweep(bootAt): { interrupted: string[] }; incrementAutoResume(id): number }
export class CellsRepo { seed(executionId, cells, discoveryProviders): void; seedVerification(executionId, selection, verificationProviders): void; outcomes(executionId, filter?): CellOutcome[]; resumable(executionId, stage, providerId, manual): CellKey[]; markDeparted(executionId, today): number; writeTile(executionId, providerId, result: TileWrite): void /* prices + outcomes + roll-ups atomically */; writeVerifiedCell(executionId, providerId, cell, write: VerifiedCellWrite): void; setOutcome(executionId, cell, stage, providerId, patch): void; rollUps(executionId): Map<string, { discovery: RollUp; verification: RollUp }>; buckets(executionId, stage, providerId): Buckets; selected(executionId): Array<CellKey & { reason: SelectionReason }> }
export class CalendarPricesRepo { insert(rows): void; latestPerCell(definitionId, cabin, space): CalendarPriceRow[]; reuseCandidates(definitionId, providerId, cabin, pointOfSale, sourceKind, cells, newerThan): Map<string, { outcome: CellOutcome; price: CalendarPriceRow | null }>; copyReused(executionId, rows): void; supersedeReused(executionId, providerId, cell): void; history(origin, destination, cabin): HistoryPoint[] }
export class ItinerariesRepo { upsertItinerary(it, segments): void; upsertOffer(offer): number; insertObservation(obs): number; observationsForDefinition(definitionId, executionIds, space, cabin): ObservationRow[]; offerHistory(hash): HistoryPoint[]; latestVerificationOutcomeForCell(definitionId, cell): CellOutcome | null }
export class LedgerRepo { countsFor(executionId): { calls: number; costMicroGbp: number; tiles: number; cacheHits: number }; overrun(executionId, planLength): boolean; sweepPending(olderThan): number; pruneCacheHits(olderThan, providerIds): number }
export class AlertsRepo { rules(definitionId?): AlertRule[]; create/update/delete; events(filter): AlertEvent[]; lastFiring(ruleId, dedupKey | identity, since): AlertEvent | null; insertEvent(e): number }
export class NotificationsRepo { wasSent(kind, executionId): boolean; record(kind, executionId, status): void }
export class RoutePriceHistoryRepo { upsert(rows): void; series(origin, destination, cabin, providerId): HistoryPoint[] }
export class SqliteBudgetGuard implements BudgetGuard { constructor(db, config: BudgetConfig, clock) }
export class SqliteResponseCache implements ResponseCache { constructor(db, clock) }
export function runMaintenance(db, clock, log, opts: { lifetimeProviders: ProviderId[] }): { cacheRowsDeleted: number; ledgerRowsPruned: number; dbBytes: number };
```

### 4.5 `@gmt/providers` (WP4)

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
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: Pick<Config, 'nodeEnv' | 'databasePath' | 'allowFixtureProvider' | 'inContainer'>; costMicroGbp: number }): FlightProvider;  // throws unless syntheticAllowed
export function fixtureHandlers(root: string): RequestHandler[];        // msw handlers for http://fixture.local
```

### 4.6 Fixture provider request shape (WP4 brief not yet written)

`docs/briefs/wp04-http-kit-and-fixture-provider.md` does not exist at the time of writing. The harness therefore does not depend on a WP4 error-injection switch. It installs its own msw handler **in front of** `fixtureHandlers(root)` (msw handlers are order-sensitive and `server.use` prepends) and decides per request whether to answer with an injected status or fall through to the WP4 handler by returning nothing. It reads two facts from each request, both in one function, `fixtureRequestKey(url)` in `test/harness.ts`, which is the single place to adapt once WP4 merges:

- the endpoint kind from the path prefix: `/calendar…` for discovery tiles, `/itinerary…` for verification calls;
- the pair from the `origin` and `destination` query parameters.

If WP4 instead documents `x-fixture-scenario: <name>` as a request header, the harness keeps working unchanged: the injected responses here are produced by the harness itself, not by WP4's handlers.

### 4.7 Signatures from earlier briefs this package calls but which the plan leaves open

`ExecutionsRepo.listByStatus(statuses: readonly ExecutionStatus[]): Execution[]` is needed by `boot()` (auto-resume of every `interrupted` row, not only those the sweep just marked; re-registration of one-shot jobs for every `paused_*` row with `resume_after`). The plan's `ExecutionsRepo` lacks it. It is listed in Open questions as a contract addition WP3 must provide; the tasks below call it.

### 4.8 Contract-level facts from the spec this brief relies on

- Reserve happens before every fetch; finalisation happens in http-kit before any engine write (spec §7 Transactions).
- `limiter-timeout` is raised by http-kit when a `Retry-After` exceeds `MAX_WAIT_SECONDS` or the queue deadline passes (spec §5.3); this brief reads `ProviderError.retryAfterSeconds` from it when present.
- Cache hits are ledgered by `recordCacheHit` with `outcome = 'cache_hit'` (spec §5.3).

### 4.9 Shapes this brief assumes (each is an Open question)

```ts
// @gmt/db: Execution (the plan names it; spec §7 search_executions columns, camel-cased)
export interface Execution {
  id: string; definitionId: string; isChild: boolean; childCell: CellKey | null; snapshot: DefinitionSnapshot;
  status: ExecutionStatus; stage: Stage | null; estimate: unknown /* estimate_json; the engine writes an Estimate and never reads it back */; cancelRequested: boolean; resumeAfter: IsoDateTime | null;
  autoResumeCount: number; startedAt: IsoDateTime; finishedAt: IsoDateTime | null; errorText: string | null;
}
// ExecutionsRepo.create(input: { definitionId: string; snapshot: DefinitionSnapshot; status: ExecutionStatus; estimate: unknown; isChild?: boolean; childCell?: CellKey }): Execution
//   generates the id, sets started_at = clock.now(); throws better-sqlite3's SqliteError with code SQLITE_CONSTRAINT_UNIQUE on a partial-index clash.
// ExecutionsRepo.setStatus(id, status, patch?: StatusPatch)
export interface StatusPatch { stage?: Stage | null; resumeAfter?: IsoDateTime | null; errorText?: string | null; finishedAt?: IsoDateTime | null; autoResumeCount?: number; estimate?: unknown }
// ExecutionsRepo.claimResume(id): UPDATE … SET status='running', resume_after=NULL, finished_at=NULL WHERE id=? AND status IN (RESUMABLE_STATUSES); true iff one row changed.
// ExecutionsRepo.bootSweep(bootAt): running → interrupted and pending with started_at < bootAt → interrupted, each with auto_resume_count + 1, in one transaction.
// CellsRepo.outcomes(executionId, filter?: { stage?: Stage; providerId?: ProviderId; status?: CellOutcomeStatus })
// CellsRepo.resumable(...) returns not_run, error (attempts < 3, retryable reason), skipped:budget, and with manual=true also skipped:provider_disabled and error auth/quota/parse (spec §7). Headroom for skipped:budget is the engine's decision.
// CellsRepo.setOutcome(executionId, cell, stage, providerId, patch: OutcomePatch) recomputes the cell's roll-up in the same statement batch.
export interface OutcomePatch { status: CellOutcomeStatus; reason?: string | null; lastError?: string | null; attemptsDelta?: number }
export interface TileWrite {
  tileIndex: number; fetchedAt: IsoDateTime;
  prices: CalendarPriceInsert[];                                   // ≤ 1 per cell
  outcomes: Array<{ cell: CellKey; status: 'priced' | 'empty' | 'no_data' | 'error'; reason: string | null; lastError: string | null; minPence: number | null; fetchedAt: IsoDateTime; cabin: Cabin; pointOfSale: PointOfSale; sourceKind: SourceKind }>;
}   // writeTile adds 1 to attempts of every outcome it writes (an engine pass)
export interface CalendarPriceInsert {
  executionId: string; providerId: ProviderId; sourceKind: SourceKind; cabin: Cabin; origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate;
  pricePence: number; priceNativeMinor: number; currencyNative: string; fxRateNano: number | null; fxRateDate: IsoDate | null; fxSource: string | null; fxConverted: boolean;
  pointOfSale: PointOfSale; fetchedAt: IsoDateTime; providerObservedAt: IsoDateTime | null; maxAgeHours: number | null; vendorLink: string | null; reusedFromExecutionId: string | null;
}
export type CalendarPriceRow = CalendarPriceInsert & { id: number };
export interface ReusedCopy {        // CalendarPricesRepo.copyReused(executionId, rows: ReusedCopy[]): each copy's outcome + price + roll-up in one transaction
  cell: CellKey; providerId: ProviderId; status: 'priced' | 'empty' | 'no_data'; reason: string | null; fetchedAt: IsoDateTime | null; minPence: number | null;
  cabin: Cabin; pointOfSale: PointOfSale; sourceKind: SourceKind; reusedFromExecutionId: string; price: CalendarPriceInsert | null;
}
// CalendarPricesRepo.supersedeReused(executionId, providerId, cell): deletes that cell's reused row (reused_from_execution_id IS NOT NULL) if one exists; no-op otherwise.
export interface ObservationWrite {
  itinerary: NormalisedItinerary; offer: Offer; provenance: Provenance; pricePence: number; priceNativeMinor: number; currencyNative: string;
  taxesIncluded: boolean | null; selfTransfer: boolean | null; segmentCabins: Cabin[] | null; baggage: BaggageSnapshot | null; fareConditions: FareConditions | null;
  booking: Booking; bookingExpiresAt: IsoDateTime | null; suppliedFields: SuppliedField[]; partialExpansion: boolean;
}
export interface VerifiedCellWrite {   // CellsRepo.writeVerifiedCell: itineraries, segments, offers, observations, outcome, best_observation_id, roll-up in one transaction
  status: 'priced' | 'empty' | 'error'; reason: string | null; lastError: string | null; fetchedAt: IsoDateTime;
  cabin: Cabin; pointOfSale: PointOfSale; sourceKind: SourceKind; offers: ObservationWrite[]; bestIndex: number | null;
}
// LedgerRepo.countsFor(executionId).tiles = first-attempt discovery rows (tile_index NOT NULL); .cacheHits = discovery cache hits.
// SqliteBudgetGuard reads the per-execution caps from the execution's snapshot budget (definition_snapshot_json → budget), so child caps follow the snapshot.
export interface BudgetConfig { spend: Config['spend']; providers: Partial<Record<ProviderId, { limits: ProviderLimits; billable: boolean }>> }
export interface Airport { iata: Iata; icao: string | null; name: string; city: string; country: string; tz: string; lat: number; lon: number; metro: string | null; source: string }
// FxRepo.upsert(rows: Array<{ date: IsoDate; currency: string; rateNano: number }>)
```

## 5. Interfaces produced

The plan's "Engine" contract, exactly, plus the additions marked **(addition)**, each justified in Open questions.

```ts
// src/types.ts
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export interface Repos { airports: AirportsRepo; fx: FxRepo; definitions: DefinitionsRepo; executions: ExecutionsRepo; cells: CellsRepo; calendarPrices: CalendarPricesRepo; itineraries: ItinerariesRepo; ledger: LedgerRepo; alerts: AlertsRepo; notifications: NotificationsRepo; routeHistory: RoutePriceHistoryRepo }
export type StartResult = { ok: true; executionId: string } | { ok: false; code: 'active' | 'cap' | 'confirm' | 'window'; message: string; details: unknown };
export interface Engine {
  boot(): Promise<void>;                 // sweep → auto-resume → one-shot jobs → cron
  shutdown(): Promise<void>;             // stop scheduler, abort, checkpoint
  start(definitionId: string, opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number }): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  cancel(executionId: string): Promise<boolean>;
  verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;
  estimate(definition: SearchDefinition, todayLondon: IsoDate): Estimate;
  estimateRemaining(executionId: string): Estimate;
  budgetFit(definition: SearchDefinition): BudgetFit;
  coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>;
  scheduler: { register(def: SearchDefinition): void; unregister(definitionId: string): void; jobs(): SchedulerJob[]; tick(definitionId: string): Promise<void> };
  status(): { running: string[]; degraded: boolean; nextRun: IsoDateTime | null; lastExecutionAt: IsoDateTime | null };
}
export function createEngine(deps: EngineDeps, options?: EngineOptions): Engine;   // options: (addition), optional
export function parseCron(expr: string, tz: string): { ok: true; next: (from: Date) => Date | null } | { ok: false; reason: string };   // sub-hourly rejected

// Engine-local mirrors of api-contract shapes. Each value is parsed through the matching apiContract schema in a test.
export interface Estimate {
  cells: number;
  perProvider: Array<{ providerId: ProviderId; stage: Stage; calls: number; costMicroGbp: number; costPence: number; seconds: number }>;
  totalCostMicroGbp: number; totalCostPence: number; seconds: number; assumptions: string[]; windowClamped: boolean;
  prefactor: Array<{ providerId: ProviderId; stage: Stage; calls: number }>;   // (addition) the pre-factor plan for the overrun flag
  blocked: ProviderId[];                                                        // (addition) providers skipped:budget by the pre-start check
}
export interface BudgetFit { fits: boolean; runsPerMonth: number; perScope: Array<{ scope: string; estimated: number; cap: number | null; fits: boolean }> }
export interface CoverageCheckRequest { origins: Iata[]; destinations: Iata[]; window: WindowSpec; minNights: number; maxNights: number }
export interface CoverageCheckResponse { pairs: Array<{ origin: Iata; destination: Iata; months: Array<{ month: IsoMonth; cachedRows: number }> }>; calls: number; notes: string[] }
export interface SchedulerJob { id: string; kind: 'definition' | 'resume' | 'system'; definitionId: string | null; executionId: string | null; nextRun: IsoDateTime | null }
export interface EngineOptions { providerLimits?: Partial<Record<ProviderId, ProviderRunLimits>> }   // (addition)
export interface ProviderRunLimits { concurrency: number; costPerCallMicroGbp: number; ratePerMinute: number; monthlyCallCap: number; window: 'month' | 'lifetime'; planFixedMicroGbp: number; excludedFromSchedule: boolean }

// src/notifiers/log.ts
export class LogNotifier implements Notifier { readonly id: 'log'; constructor(log: Logger); send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> }
```

The `prefactor` and `blocked` fields ride in `estimate_json`; the api-contract `estimateResponseSchema` is a zod object with the default strip behaviour, so WP8 responses drop them without a schema change. `EngineOptions.providerLimits` exists because `Config` carries no limits for the fixture provider; production wiring (WP8) passes nothing and the engine reads `config.providers.*.limits`.

## 6. Library notes

All verified on 2026-10-14.

| Library | Version | API used here | Verified against |
|---|---|---|---|
| `croner` | 10.0.1 | `new Cron(pattern, { timezone, paused: true, mode: '5-part' })` with **no function** for validation (no timer is scheduled without a function; an invalid pattern throws); `new Cron(pattern, { timezone, catch, protect: true }, fn)` for definition jobs; `new Cron(date, { maxRuns: 1, catch }, fn)` for one-shot resume jobs (a `Date` pattern fires once; `nextRun()` is `null` when it will not fire); `job.nextRun(from?)`, `job.nextRuns(n, from?)`, `job.previousRuns(n, ref?)`, `job.stop()` (permanent). 10.x is strict about ranges (`/10`, `0/10` invalid unless `sloppyRanges`) and treats `?` as `*`; `mode: '5-part'` rejects seconds and year fields. DST: a wall time inside a spring-forward gap resolves to the later instant; a fall-back overlap runs once at the first occurrence. | context7 `/hexagon/croner`: README "new Cron(pattern, options?, function?)", "job.nextRuns", "job.previousRuns", `docs/src/usage/basics.md`, `docs/src/usage/examples.md` ("Fire on a specific date/time"), `docs/src/migration.md` ("Upgrading from 9.x to 10.x"), `src/helpers/timezone.ts` `fromTZ` |
| `pino` | 10.4.0 | Not imported by `src/`; the engine depends only on the `Logger` port. Its `child(bindings)` is pino's `logger.child(bindings)`, which adds the bindings to every line of the child; WP8 constructs the root pino with `redact`. The engine binds `executionId`, `definitionId` and `providerId` through `child`. | context7 `/pinojs/pino` `docs/api.md` "logger.child(bindings, [options])", "redact" |
| `msw` | 3.0.3 | `setupServer(...handlers)` from `msw/node`; `server.listen({ onUnhandledRequest: 'error' })`, `server.use(...)` (prepends, so the harness handler runs before the WP4 fixture handlers), `server.resetHandlers()`, `server.close()`; `http.all(url, resolver)` and `HttpResponse.json(body, { status, headers })`, `HttpResponse.text`, `HttpResponse.error()` from `msw/http`; a resolver that returns nothing falls through to the next handler. | context7 `/websites/mswjs_io`: "Set up server in src/mocks/node.ts" (quick-start), "Handler order sensitivity with overrides" (defaults), "Return a mocked response" (http/mocking-responses) |
| `better-sqlite3` | 13.0.3 (through WP3; dev-only here) | Tests construct `new Database.SqliteError(message, code)` to simulate `SQLITE_FULL` (Review Focus 5). `src/` never imports it; it detects a unique-index clash by `err.code` starting `SQLITE_CONSTRAINT`. | WP3 pins the version; `SqliteError(message, code)` is the class better-sqlite3 throws for every SQLite error (its README "class SqliteError") |
| `vitest` | 5.0.4 | `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })`, `vi.setSystemTime`, `vi.advanceTimersByTimeAsync`, `vi.useRealTimers`, `vi.waitFor(cb, { timeout, interval })` (advances fake timers by `interval` on each check), `vi.spyOn`, `vi.fn`. | context7 `/vitest-dev/vitest` `docs/api/vi.md` ("vi.waitFor", "toFake"), `docs/guide/mocking/timers.md`, `docs/guide/mocking/dates.md` |
| frankfurter | HTTP API | `GET https://api.frankfurter.dev/v1/latest?from=GBP` returns `{ amount: number (1), base: string ("GBP"), date: string ("YYYY-MM-DD"), rates: Record<string, number> }`, where `rates[C]` is units of `C` per 1 GBP; 29 keys on 2026-10-14: AUD BRL CAD CHF CNY CZK DKK EUR HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR. **`https://api.frankfurter.app/latest?from=GBP` answers `301 Moved Permanently` to the `.dev/v1` URL**, and http-kit sends `redirect: 'error'`, so the engine calls the `.dev/v1` URL and the `fx` host allowlist is `api.frankfurter.dev` (see Open questions). | WebFetch of both URLs, 2026-10-14 |

## 7. Files

**Create** (all under `packages/engine/`)

- `src/index.ts` — barrel: `createEngine`, `parseCron`, `LogNotifier`, types (the plan's file map puts `createEngine` here; it lives in `src/engine.ts` so the barrel stays excluded from coverage and the factory does not).
- `src/engine.ts` — `createEngine`, `statusOf`.
- `src/types.ts` — `EngineDeps`, `Repos`, `StartResult`, `Engine`, `Estimate`, `BudgetFit`, `CoverageCheckRequest`, `CoverageCheckResponse`, `SchedulerJob`, `EngineOptions`, `ProviderRunLimits`.
- `src/context.ts` — `EngineContext`, `buildContext`.
- `src/pool.ts` — `runPool`.
- `src/run.ts` — `RunState`, `StopReason`, lanes, `stopRun`, `markRemaining`, `onFailure`, `applyBudgetBreach`, `runnableCells`, `markProgress`.
- `src/snapshot.ts` — `buildSnapshot`, `childSnapshot`.
- `src/orchestrator.ts` — `createOrchestrator`: start, resume, cancel, verifyCell, tick, shutdown, running.
- `src/registry.ts` — passes running in this process.
- `src/execute.ts` — `execute`, `finish`, `finalStatus`, `parityNotice`.
- `src/start.ts` — `startExecution`, `recordSkipped`, `refused`, `isUniqueViolation`, `formatPence`.
- `src/child.ts` — `verifyCellExecution`.
- `src/tick.ts` — `tickDefinition`.
- `src/stages/discovery.ts` (`runDiscovery`, `planTiles`, `discoveryQuery`, `commitTile`, `normaliseDeps`), `src/stages/verification.ts` (`runVerification`, `itineraryQuery`, `commitVerifiedCell`, `bestIndexOf`), `src/stages/reuse.ts` (`applyReuse`, `reusableFor`, `reuseCutoff`, `refreshHoursOf`).
- `src/normalise.ts` — the §5.6 step.
- `src/estimate.ts` — `estimateStart`, `estimateRemainingFor`, `budgetFitFor`.
- `src/budgetCheck.ts` — `checkBudget`, `spendOf`, `breachMessage`.
- `src/resume.ts` — `resumeExecution`, `isStalePaused`.
- `src/errors.ts` — `classifyFailure`.
- `src/notify.ts` — `notifyOperator`.
- `src/notifiers/messages.ts` — `operatorMessage`.
- `src/notifiers/log.ts` — `LogNotifier`.
- `src/scheduler/parseCron.ts` — `parseCron`, `isValidTimeZone`, `previousFiring`, `runsPerMonth`.
- `src/scheduler/scheduler.ts` — `createScheduler`.
- `src/boot.ts` — `bootEngine`.
- `src/coverageCheck.ts` — `coverageCheckFor`, `countCachedRows`.
- `src/fx/refresh.ts` — `refreshFx`, `FRANKFURTER_LATEST_URL`.
- `src/maintenance.ts` — `runMaintenanceJob`, `runSystemJob`, `FX_REFRESH_CRON`, `MAINTENANCE_CRON`.
- `test/harness.ts`, `test/wrappers.ts` — layer-A harness and provider decorators.
- `test/*.test.ts` — one file per task as named in each task.

**Modify**

- `packages/engine/package.json` — add dev dependencies `msw@3.0.3` (already listed by the plan) and `better-sqlite3@13.0.3`.
- `packages/engine/vitest.config.ts` — `testTimeout: 30_000`, `hookTimeout: 30_000` (http-kit's real p-retry backoff runs in the error-table tests).

**Test** — `pnpm --filter @gmt/engine test` runs every file under `packages/engine/test/`.

## 8. Tasks

Conventions for every task: imports are relative with `.js`; `import type` for types; no `any`; no non-null assertions. Run `pnpm lint:fix` before each commit (Biome orders imports and formats; the code blocks below are not pre-sorted). Every `Run` step uses the exact command shown. Every commit message starts `wp07:` and ends with the attribution line `MrReasonable <4990954+MrReasonable@users.noreply.github.com>`.

### Task 7.1: Resume after k of n tiles issues n−k (first failing test), with the layer-A harness and the pool

**Files:**
- Modify: `packages/engine/package.json`, `packages/engine/vitest.config.ts`
- Create: `packages/engine/test/harness.ts`, `packages/engine/test/resume-k-of-n.test.ts`, `packages/engine/test/pool.test.ts`
- Create: `packages/engine/src/types.ts`, `src/context.ts`, `src/pool.ts`, `src/run.ts`, `src/registry.ts`, `src/snapshot.ts`, `src/normalise.ts`, `src/stages/discovery.ts`, `src/execute.ts`, `src/start.ts`, `src/resume.ts`, `src/orchestrator.ts`

**Interfaces:**
- Consumes: §4.1–§4.6 and §4.9 of this brief.
- Produces: `src/types.ts` exactly as §5; `buildContext(deps, options?)`; `runPool(items, concurrency, signal, worker)`; `createOrchestrator(ctx)` with `start`, `resume`, `shutdown`, `running` (later tasks add `cancel`, `verifyCell`, `tick`); the harness API used by every later task.

- [ ] **Step 1: Write the failing tests**

`packages/engine/package.json` gains the two dev dependencies (the rest of the file is WP0's):

```json
{
  "devDependencies": { "@types/nodemailer": "8.0.2", "better-sqlite3": "13.0.3", "msw": "3.0.3" }
}
```

`packages/engine/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// why: the error-table tests go through http-kit's real p-retry backoff (spec §5.3: max 3 attempts),
// so a single test can take several seconds of wall time.
export default defineConfig({
  test: {
    name: 'engine',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/notifiers/email.ts', 'src/alerts/**'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
```

`packages/engine/test/harness.ts` (complete; later tasks only call it):

```ts
/**
 * Layer-A engine test harness. Spec §9 item 4: "the fixture provider as an HTTP adapter at
 * fixture.local served by msw on global fetch, through the real http-kit and the real db
 * BudgetGuard with the fixture cost rule, in-memory DB".
 *
 * The only doubles are the clock (fixedClock), the logger and notifier (capturing), and one msw
 * handler mounted in front of the WP4 fixture handlers. That front handler counts every request,
 * can hold a request until the test releases it (or the request is aborted), and can answer with
 * an injected status instead of falling through to the fixture tree. Everything between the
 * engine and the fixture tree (adapter, http-kit, limiter, reserve/finalise, cache, ledger) is real.
 */
import { fileURLToPath } from 'node:url';
import {
  type AlertDigest,
  type CellKey,
  type CellOutcome,
  type CellOutcomeStatus,
  type Clock,
  type FlightProvider,
  type IsoDateTime,
  type Logger,
  type Notifier,
  type OperatorMessage,
  type ProviderId,
  type ProviderLimits,
  type ProvidersConfig,
  type SearchDefinition,
  type Stage,
  TRAVELPAYOUTS_DEFAULTS,
  asIata,
  asIsoDate,
  asIsoDateTime,
  fixedClock,
  generateCells,
  parseConfig,
} from '@gmt/core';
import {
  AirportsRepo,
  AlertsRepo,
  type BudgetConfig,
  CalendarPricesRepo,
  CellsRepo,
  type Db,
  DefinitionsRepo,
  type Execution,
  ExecutionsRepo,
  FxRepo,
  ItinerariesRepo,
  LedgerRepo,
  NotificationsRepo,
  RoutePriceHistoryRepo,
  SqliteBudgetGuard,
  SqliteResponseCache,
  applyMigrations,
  openDatabase,
} from '@gmt/db';
import { type HttpKit, type ProviderHttpLimits, createHttpKit, fixtureHandlers, fixtureProvider } from '@gmt/providers';
import { HttpResponse, http as mswHttp } from 'msw/http';
import { type SetupServerApi, setupServer } from 'msw/node';
import { vi } from 'vitest';
import type { EngineDeps, EngineOptions, ProviderRunLimits, Repos, StartResult } from '../src/types.js';

// --- the worked example (docs/briefs/README.md: London → New York only) ---
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');
/** Default "now" for every harness: a Wednesday morning, BST. */
export const T0 = asIsoDateTime('2026-10-14T09:00:00.000Z');
/** Per-call test cost of the fixture provider (the SearchApi per-call figure of spec §6.3, 0.32p). */
export const FIXTURE_COST_MICRO_GBP = 3200;

const FIXTURE_ROOT = fileURLToPath(new URL('../../providers/fixtures/synthetic/fixture/', import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/drizzle/', import.meta.url));

/** Tiny synthetic airports dataset: the four worked-example airports with their real IANA zones and metros. */
export const TEST_AIRPORTS = [
  { iata: LHR, icao: 'EGLL', name: 'London Heathrow', city: 'London', country: 'GB', tz: 'Europe/London', lat: 51.47, lon: -0.4543, metro: 'LON', source: 'engine-layer-a' },
  { iata: LGW, icao: 'EGKK', name: 'London Gatwick', city: 'London', country: 'GB', tz: 'Europe/London', lat: 51.1481, lon: -0.1903, metro: 'LON', source: 'engine-layer-a' },
  { iata: JFK, icao: 'KJFK', name: 'John F. Kennedy International', city: 'New York', country: 'US', tz: 'America/New_York', lat: 40.6398, lon: -73.7789, metro: 'NYC', source: 'engine-layer-a' },
  { iata: EWR, icao: 'KEWR', name: 'Newark Liberty International', city: 'New York', country: 'US', tz: 'America/New_York', lat: 40.6925, lon: -74.1687, metro: 'NYC', source: 'engine-layer-a' },
];

// --- capturing logger and notifier ---
export interface LogLine { level: 'debug' | 'info' | 'warn' | 'error'; bindings: Record<string, unknown>; fields: Record<string, unknown>; msg: string | undefined }

/** A pino-shaped Logger that records every line with its accumulated child bindings. */
export function capturingLogger(lines: LogLine[], bindings: Record<string, unknown> = {}): Logger {
  const at = (level: LogLine['level']) => (fields: object, msg?: string): void => {
    lines.push({ level, bindings, fields: { ...fields }, msg });
  };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (b: object) => capturingLogger(lines, { ...bindings, ...b }),
  };
}

/** A Notifier that records every message it is asked to send and always succeeds. */
export function capturingNotifier(sent: Array<OperatorMessage | AlertDigest>): Notifier {
  return {
    id: 'capture',
    send: async (m) => {
      sent.push(m);
      return { ok: true };
    },
  };
}

// --- request counting and injection in front of the WP4 fixture handlers ---
export interface FixtureRequest { kind: 'calendar' | 'itinerary' | 'other'; pair: string; ordinal: number; path: string }
export type InjectedResponse = { status: number; json?: unknown; text?: string; headers?: Record<string, string> } | 'network-error' | 'hold';
export interface Scenario { match: (r: FixtureRequest) => boolean; respond: InjectedResponse; times?: number }

/** The error bodies the spike recorded (spec §2 fact 5) or the spec's status mapping (§5.2) implies. */
export const RESPONSES = {
  auth: { status: 401, json: { error: 'Invalid API key.' } },
  quota: { status: 402, json: { error: 'Payment required.' } },
  rateLimit: { status: 429, json: { error: 'Too many requests.' }, headers: { 'retry-after': '0' } },
  upstream: { status: 500, json: { error: 'Internal server error.' } },
  badRequest: { status: 400, json: { error: 'Requested more than 200 combinations.' } },
  malformed: { status: 200, text: 'this is not json' },
  // why: 4000 s exceeds MAX_WAIT_SECONDS (3900 by default), so http-kit raises limiter-timeout (spec §5.3)
  limiterTimeout: { status: 429, json: { error: 'Too many requests.' }, headers: { 'retry-after': '4000' } },
  network: 'network-error',
  hold: 'hold',
} as const satisfies Record<string, InjectedResponse>;

/**
 * The one place that knows the WP4 fixture URL shape: endpoint kind from the path prefix, pair from
 * the `origin` and `destination` query parameters. Adapt here if WP4 merges a different shape.
 */
export function fixtureRequestKey(url: URL): Omit<FixtureRequest, 'ordinal'> {
  const kind = url.pathname.startsWith('/calendar') ? 'calendar' : url.pathname.startsWith('/itinerary') ? 'itinerary' : 'other';
  return { kind, pair: `${url.searchParams.get('origin') ?? '?'}-${url.searchParams.get('destination') ?? '?'}`, path: url.pathname };
}

interface Deferred { promise: Promise<void>; resolve: () => void }
function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function abortedOf(signal: AbortSignal): Promise<true> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise((r) => signal.addEventListener('abort', () => r(true), { once: true }));
}

// --- definitions ---
export type DefinitionInput = Parameters<DefinitionsRepo['create']>[0];
/** Discovery by the fixture provider only. */
export function noVerification(): ProvidersConfig {
  return { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 168 } };
}
/** Discovery and verification by the fixture provider. */
export function withVerification(): ProvidersConfig {
  return { discovery: ['fixture'], verification: ['fixture'], discoveryRefreshHours: { fixture: 168 } };
}
/** LHR → JFK, 2–4 Nov 2026, 7–8 nights: 6 cells, small enough to enumerate in a test. */
export function baseDefinition(): DefinitionInput {
  return {
    name: 'London to New York (layer A)',
    origins: [LHR],
    destinations: [JFK],
    window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-04') },
    minNights: 7,
    maxNights: 8,
    cabin: 'economy',
    constraints: {},
    verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 1, bookingLinks: true },
    budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    providers: noVerification(),
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: 'Europe/London',
    confirmedCostPence: null,
    enabled: true,
  };
}

/** The fixture's discovery capability, or a thrown error (keeps tests free of non-null assertions). */
export function discoveryOf(p: FlightProvider): NonNullable<FlightProvider['discovery']> {
  if (p.discovery === undefined) throw new Error(`${p.id} has no discovery capability`);
  return p.discovery;
}
export function verificationOf(p: FlightProvider): NonNullable<FlightProvider['verification']> {
  if (p.verification === undefined) throw new Error(`${p.id} has no verification capability`);
  return p.verification;
}

function runLimits(l: ProviderLimits): ProviderRunLimits {
  return { concurrency: l.concurrency, costPerCallMicroGbp: l.costPerCallMicroGbp, ratePerMinute: l.ratePerMinute, monthlyCallCap: l.monthlyCallCap, window: l.window, planFixedMicroGbp: l.planFixedMicroGbp, excludedFromSchedule: l.excludedFromSchedule };
}

export interface LedgerRow { providerId: string; executionId: string | null; endpointPath: string; tileIndex: number | null; outcome: string; billable: number | null; httpAttempt: number; costMicroGbp: number }

export interface HarnessOptions {
  /** Extra or overriding environment for parseConfig (strings, as in .env). */
  env?: Record<string, string>;
  now?: IsoDateTime;
  fixtureConcurrency?: number;
  fixtureMonthlyCallCap?: number;
  fixtureExcludedFromSchedule?: boolean;
  /** Wrap the real fixture provider (test/wrappers.ts) before the engine sees it. */
  transformFixture?: (fixture: FlightProvider) => FlightProvider;
  /** Additional providers (test/wrappers.ts freeStubProvider) registered beside the fixture. */
  extraProviders?: (tools: { clock: Clock; log: Logger; http: HttpKit }) => FlightProvider[];
}

export interface Harness {
  deps: EngineDeps;
  options: EngineOptions;
  config: EngineDeps['config'];
  clock: ReturnType<typeof fixedClock>;
  db: Db;
  repos: Repos;
  server: SetupServerApi;
  /** The unwrapped fixture provider (the engine may see a wrapped one). */
  fixture: FlightProvider;
  logs: LogLine[];
  notifications: Array<OperatorMessage | AlertDigest>;
  requests: FixtureRequest[];
  scenario(s: Scenario): void;
  releaseHolds(): void;
  /** Runs after the n-th successful CellsRepo.writeTile of the harness (n counts from 1). */
  onTileCommit(fn: (n: number, executionId: string) => void): void;
  /** Runs before every CellsRepo.writeTile; throw to make the write fail (Review Focus 5). */
  beforeTileWrite(fn: (attempt: number, executionId: string) => void): void;
  /** Runs inside setStatus when the engine moves an execution into `stage`. */
  onStageStart(stage: Stage, fn: (executionId: string) => void): void;
  clearHooks(): void;
  createDefinition(patch?: Partial<DefinitionInput>): SearchDefinition;
  waitForSettled(executionId: string): Promise<Execution>;
  runToCompletion(engine: { start(id: string, o: { trigger: 'manual' | 'schedule'; confirmCostPence?: number }): Promise<StartResult> }, definitionId: string, opts?: { trigger: 'manual' | 'schedule'; confirmCostPence?: number }): Promise<Execution>;
  outcomes(executionId: string, filter?: { stage?: Stage; providerId?: ProviderId; status?: CellOutcomeStatus }): CellOutcome[];
  ledgerRows(executionId: string): LedgerRow[];
  /** Distinct tile requests as spec §8.1 parity counts them: first-attempt discovery rows plus cache hits. */
  tileRequests(executionId: string): number;
  /** Writes ledger rows directly, as another process's spend would appear (endpoint '/test-spend'). */
  spendLedger(p: { providerId: ProviderId; rows: number; costMicroGbpEach: number; executionId?: string | null }): void;
  close(): void;
}

/** Expected tile count for a definition: the fixture's own plan per pair over that pair's cells. */
export function expectedTiles(h: Harness, def: SearchDefinition): number {
  if (def.window.kind !== 'absolute') throw new Error('expectedTiles needs an absolute window');
  const d = discoveryOf(h.fixture);
  let n = 0;
  for (const origin of def.origins) {
    for (const destination of def.destinations) {
      const cells: CellKey[] = generateCells({ origins: [origin], destinations: [destination], departureFrom: def.window.from, departureTo: def.window.to, minNights: def.minNights, maxNights: def.maxNights });
      n += d.plan({ origin, destination, departureFrom: def.window.from, departureTo: def.window.to, minNights: def.minNights, maxNights: def.maxNights, cabin: def.cabin, currency: 'GBP', cells }).length;
    }
  }
  return n;
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  const parsed = parseConfig(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      // why: the fixture provider is billed at FIXTURE_COST_MICRO_GBP, so the global and execution
      // cost caps must allow it; with no billed provider configured the presets would set 0.
      MONTHLY_SPEND_CAP_PENCE: '100000',
      EXECUTION_MAX_CALLS: '1000',
      EXECUTION_MAX_COST_PENCE: '100000',
      REQUEST_TIMEOUT_SECONDS: '10',
      ...opts.env,
    },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(`harness config invalid: ${JSON.stringify(parsed.errors)}`);
  const config = parsed.config;
  const clock = fixedClock(opts.now ?? T0);
  const logs: LogLine[] = [];
  const log = capturingLogger(logs);
  const notifications: Array<OperatorMessage | AlertDigest> = [];

  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const repos: Repos = {
    airports: new AirportsRepo(db, clock),
    fx: new FxRepo(db, clock),
    definitions: new DefinitionsRepo(db, clock),
    executions: new ExecutionsRepo(db, clock),
    cells: new CellsRepo(db, clock),
    calendarPrices: new CalendarPricesRepo(db, clock),
    itineraries: new ItinerariesRepo(db, clock),
    ledger: new LedgerRepo(db, clock),
    alerts: new AlertsRepo(db, clock),
    notifications: new NotificationsRepo(db, clock),
    routeHistory: new RoutePriceHistoryRepo(db, clock),
  };
  repos.airports.upsertAll(TEST_AIRPORTS, 'engine-layer-a-1');

  const concurrency = opts.fixtureConcurrency ?? 4;
  const fixtureLimits: ProviderLimits = {
    monthlyCallCap: opts.fixtureMonthlyCallCap ?? 50_000,
    window: 'month',
    billingDay: 1,
    ratePerMinute: 10_000,
    ratePerHour: 100_000,
    concurrency,
    cacheTtlHours: 1,
    costPerCallMicroGbp: FIXTURE_COST_MICRO_GBP,
    planFixedMicroGbp: 0,
    excludedFromSchedule: opts.fixtureExcludedFromSchedule ?? false,
  };
  // why: §4.9 assumed shape of WP3's BudgetConfig; the fixture is billed at the test cost (spec §5.3 "fixture iff HTTP 200 at the configured test cost").
  const budgetConfig: BudgetConfig = {
    spend: config.spend,
    providers: { fixture: { limits: fixtureLimits, billable: true }, travelpayouts: { limits: TRAVELPAYOUTS_DEFAULTS, billable: false } },
  };
  const budget = new SqliteBudgetGuard(db, budgetConfig, clock);
  const cache = new SqliteResponseCache(db, clock);
  const httpLimit = (hosts: string[], billable: 'http-200' | 'never', cost: number, c: number): ProviderHttpLimits => ({
    hosts, ratePerMinute: 10_000, ratePerHour: 100_000, concurrency: c, billable, costPerCallMicroGbp: cost, maxWaitSeconds: config.maxWaitSeconds, requestTimeoutSeconds: config.requestTimeoutSeconds,
  });
  const limits: Record<ProviderId | 'fx', ProviderHttpLimits> = {
    fixture: httpLimit(['fixture.local'], 'http-200', FIXTURE_COST_MICRO_GBP, concurrency),
    fx: httpLimit(['api.frankfurter.dev'], 'never', 0, 1),
    // why: the free stub (test/wrappers.ts) is registered as travelpayouts and calls stub.local, so its
    // calls are ledgered as free-provider rows and parity holds; searchapi is unused in layer A.
    travelpayouts: httpLimit(['stub.local'], 'never', 0, 4),
    searchapi: httpLimit([], 'http-200', 0, 1),
  };
  const http = createHttpKit({ budget, cache, limits, clock, log, secrets: [] });
  const fixture = fixtureProvider({ http, log, clock, config, costMicroGbp: FIXTURE_COST_MICRO_GBP });
  const providers = [opts.transformFixture ? opts.transformFixture(fixture) : fixture, ...(opts.extraProviders?.({ clock, log, http }) ?? [])];

  // --- msw: counting / holding / injecting handler in front of the WP4 fixture handlers ---
  const requests: FixtureRequest[] = [];
  const scenarios: Array<Scenario & { used: number }> = [];
  const ordinals: Record<FixtureRequest['kind'], number> = { calendar: 0, itinerary: 0, other: 0 };
  let holds = deferred();
  const front = mswHttp.all('http://fixture.local/*', async ({ request }) => {
    const key = fixtureRequestKey(new URL(request.url));
    ordinals[key.kind] += 1;
    const r: FixtureRequest = { ...key, ordinal: ordinals[key.kind] };
    requests.push(r);
    const sc = scenarios.find((s) => s.used < (s.times ?? 1) && s.match(r));
    if (sc === undefined) return undefined; // why: falls through to the WP4 fixture handler
    sc.used += 1;
    if (sc.respond === 'hold') {
      const aborted = await Promise.race([holds.promise.then(() => false), abortedOf(request.signal)]);
      return aborted ? HttpResponse.error() : undefined;
    }
    if (sc.respond === 'network-error') return HttpResponse.error();
    const init = { status: sc.respond.status, headers: sc.respond.headers ?? {} };
    return sc.respond.text !== undefined ? HttpResponse.text(sc.respond.text, init) : HttpResponse.json(sc.respond.json ?? {}, init);
  });
  // why: the free stub's endpoint answers an empty object; the stub turns every call into no_data
  const stub = mswHttp.get('http://stub.local/*', () => HttpResponse.json({}));
  const server = setupServer(front, stub, ...fixtureHandlers(FIXTURE_ROOT));
  server.listen({ onUnhandledRequest: 'error' });

  // --- write hooks ---
  let before: Array<(n: number, executionId: string) => void> = [];
  let after: Array<(n: number, executionId: string) => void> = [];
  let stageHooks: Array<{ stage: Stage; fn: (executionId: string) => void }> = [];
  let attempts = 0;
  let commits = 0;
  const writeTile = repos.cells.writeTile.bind(repos.cells);
  repos.cells.writeTile = (...args: Parameters<CellsRepo['writeTile']>) => {
    attempts += 1;
    for (const f of before) f(attempts, args[0]);
    writeTile(...args);
    commits += 1;
    for (const f of after) f(commits, args[0]);
  };
  const setStatus = repos.executions.setStatus.bind(repos.executions);
  repos.executions.setStatus = (...args: Parameters<ExecutionsRepo['setStatus']>) => {
    setStatus(...args);
    const stage = args[2]?.stage;
    for (const h of stageHooks) if (stage === h.stage) h.fn(args[0]);
  };

  const deps: EngineDeps = { config, db, repos, budget, cache, http, providers, notifiers: [capturingNotifier(notifications)], clock, log };
  const options: EngineOptions = {
    providerLimits: { fixture: runLimits(fixtureLimits), travelpayouts: runLimits(TRAVELPAYOUTS_DEFAULTS) },
  };

  const waitForSettled = (executionId: string): Promise<Execution> =>
    vi.waitFor(
      () => {
        const e = repos.executions.get(executionId);
        if (e === null) throw new Error(`no execution ${executionId}`);
        if (e.status === 'pending' || e.status === 'running') throw new Error(`still ${e.status}`);
        return e;
      },
      { timeout: 25_000, interval: 5 },
    );

  return {
    deps, options, config, clock, db, repos, server, fixture, logs, notifications, requests,
    scenario: (s) => {
      scenarios.push({ ...s, used: 0 });
    },
    releaseHolds: () => {
      holds.resolve();
      holds = deferred();
    },
    onTileCommit: (fn) => {
      after.push(fn);
    },
    beforeTileWrite: (fn) => {
      before.push(fn);
    },
    onStageStart: (stage, fn) => {
      stageHooks.push({ stage, fn });
    },
    clearHooks: () => {
      before = [];
      after = [];
      stageHooks = [];
      attempts = 0;
      commits = 0;
    },
    createDefinition: (patch = {}) => repos.definitions.create({ ...baseDefinition(), ...patch }),
    waitForSettled,
    runToCompletion: async (engine, definitionId, o = { trigger: 'manual' }) => {
      const r = await engine.start(definitionId, o);
      if (!r.ok) throw new Error(`start refused: ${r.code}: ${r.message}`);
      return waitForSettled(r.executionId);
    },
    outcomes: (executionId, filter) => repos.cells.outcomes(executionId, filter),
    ledgerRows: (executionId) =>
      db.raw
        .prepare(
          `SELECT provider_id AS providerId, execution_id AS executionId, endpoint_path AS endpointPath, tile_index AS tileIndex,
                  outcome, billable, http_attempt AS httpAttempt, cost_micro_gbp AS costMicroGbp
             FROM provider_requests WHERE execution_id = ? ORDER BY id`,
        )
        .all(executionId) as LedgerRow[],
    tileRequests: (executionId) =>
      (
        db.raw
          .prepare(
            `SELECT count(*) AS n FROM provider_requests
              WHERE execution_id = ? AND endpoint_path <> '/test-spend'
                AND (outcome = 'cache_hit' OR (http_attempt = 1 AND tile_index IS NOT NULL))`,
          )
          .get(executionId) as { n: number }
      ).n,
    spendLedger: ({ providerId, rows, costMicroGbpEach, executionId = null }) => {
      const now = clock.now();
      const insert = db.raw.prepare(
        `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms,
                                        http_status, outcome, billable, cost_micro_gbp, http_attempt)
         VALUES (?, ?, '/test-spend', NULL, ?, ?, 0, 200, 'ok', 1, ?, 1)`,
      );
      db.transaction(() => {
        for (let i = 0; i < rows; i += 1) insert.run(providerId, executionId, now, now, costMicroGbpEach);
      });
    },
    close: () => {
      holds.resolve();
      server.close();
      db.close();
    },
  };
}
```

`packages/engine/test/resume-k-of-n.test.ts`:

```ts
import { cellKeyString } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, JFK, LGW, LHR, createHarness, discoveryOf, expectedTiles, noVerification } from './harness.js';

let h: Harness;
afterEach(() => h.close());

describe('resume after k of n tiles issues n−k (spec §9 item 4; WP7 first failing test)', () => {
  it('re-plans over the resumable cells only and the ledger shows exactly n first-attempt tile requests across both passes', async () => {
    // why: one tile in flight at a time, so the interrupt lands exactly between tile k and tile k+1
    h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], providers: noVerification() });
    const n = expectedTiles(h, def);
    expect(n).toBeGreaterThanOrEqual(3);
    const k = 2;

    const first = createOrchestrator(buildContext(h.deps, h.options));
    h.onTileCommit((count) => {
      if (count === k) void first.shutdown(); // SIGTERM semantics: abort, cells in flight → not_run, status interrupted
    });
    const started = await first.start(def.id, { trigger: 'manual' });
    if (!started.ok) throw new Error(started.message);
    const id = started.executionId;
    const interrupted = await h.waitForSettled(id);
    expect(interrupted.status).toBe('interrupted');
    expect(h.tileRequests(id)).toBe(k);
    const resumable = h.outcomes(id, { stage: 'discovery', status: 'not_run' }).map(cellKeyString).sort();
    expect(resumable.length).toBeGreaterThan(0);

    h.clearHooks();
    const plan = vi.spyOn(discoveryOf(h.fixture), 'plan');
    const second = createOrchestrator(buildContext(h.deps, h.options)); // a fresh process: no in-memory state survives
    expect(await second.resume(id, { manual: false })).toEqual({ ok: true, executionId: id });
    const done = await h.waitForSettled(id);

    expect(done.status).toBe('completed');
    expect(h.tileRequests(id)).toBe(n); // k in pass one + (n − k) in pass two
    const planned = plan.mock.calls.flatMap(([q]) => (q.cells ?? []).map(cellKeyString)).sort();
    expect(planned).toEqual(resumable); // plan() saw exactly the resumable cells, nothing already committed
    expect(h.outcomes(id, { stage: 'discovery', status: 'not_run' })).toHaveLength(0);
  });
});
```

`packages/engine/test/pool.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runPool } from '../src/pool.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe('runPool (spec §8.1 bounded pool = provider CONCURRENCY)', () => {
  it('never runs more than `concurrency` workers at once and visits every item', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, new AbortController().signal, async (x) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      seen.push(x);
      inFlight -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('stops taking items once the signal aborts and waits for the workers already running', async () => {
    const c = new AbortController();
    const started: number[] = [];
    let finished = 0;
    await runPool([1, 2, 3, 4, 5], 2, c.signal, async (x) => {
      started.push(x);
      if (x === 2) c.abort();
      await tick();
      finished += 1;
    });
    expect(started).toEqual([1, 2]);
    expect(finished).toBe(2);
  });
  it('rethrows the first error that escapes a worker after draining', async () => {
    await expect(
      runPool([1, 2, 3], 1, new AbortController().signal, async (x) => {
        if (x === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
  it('rejects a concurrency below 1 and resolves at once for no items', async () => {
    await expect(runPool([1], 0, new AbortController().signal, async () => undefined)).rejects.toThrow(RangeError);
    await expect(runPool([], 2, new AbortController().signal, async () => undefined)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine test -- resume-k-of-n pool`
Expected: FAIL, `Error: Cannot find module '../src/context.js'` (and `'../src/pool.js'`).

- [ ] **Step 3: Implement**

`src/types.ts`:

```ts
import type {
  BudgetGuard, CellKey, Clock, Config, FlightProvider, Iata, IsoDate, IsoDateTime, IsoMonth, Logger, Notifier,
  ProviderId, ResponseCache, SearchDefinition, Stage, WindowSpec,
} from '@gmt/core';
import type {
  AirportsRepo, AlertsRepo, CalendarPricesRepo, CellsRepo, Db, DefinitionsRepo, ExecutionsRepo, FxRepo,
  ItinerariesRepo, LedgerRepo, NotificationsRepo, RoutePriceHistoryRepo,
} from '@gmt/db';
import type { HttpKit } from '@gmt/providers';

/** Every repository the engine reads or writes. Plan contract "Engine"; spec §7. */
export interface Repos {
  airports: AirportsRepo; fx: FxRepo; definitions: DefinitionsRepo; executions: ExecutionsRepo; cells: CellsRepo;
  calendarPrices: CalendarPricesRepo; itineraries: ItinerariesRepo; ledger: LedgerRepo; alerts: AlertsRepo;
  notifications: NotificationsRepo; routeHistory: RoutePriceHistoryRepo;
}

/** Ports the engine is built on; constructed by the api bootstraps (WP4b/WP8) or the layer-A harness. */
export interface EngineDeps {
  config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit;
  providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger;
}

/** Spec §8.1 pre-start outcomes; WP8 maps `active`/`cap` to 409, `confirm` to 409 needsConfirmation, `window` to 422. */
export type StartResult =
  | { ok: true; executionId: string }
  | { ok: false; code: 'active' | 'cap' | 'confirm' | 'window'; message: string; details: unknown };

/** Mirrors api-contract `estimateResponseSchema` plus two engine fields the schema strips (see Open questions). Spec §8.1 "Estimate". */
export interface Estimate {
  cells: number;
  perProvider: Array<{ providerId: ProviderId; stage: Stage; calls: number; costMicroGbp: number; costPence: number; seconds: number }>;
  totalCostMicroGbp: number;
  totalCostPence: number;
  seconds: number;
  assumptions: string[];
  windowClamped: boolean;
  /** Calls before ESTIMATE_RETRY_FACTOR: the overrun baseline (spec §8.1 "pre-factor plan"). */
  prefactor: Array<{ providerId: ProviderId; stage: Stage; calls: number }>;
  /** Providers the pre-start check seeded skipped:budget (spec §8.1 pre-start). */
  blocked: ProviderId[];
}

/** Mirrors api-contract `budgetFitSchema`. Spec §8.2 "budgetFit at save time". */
export interface BudgetFit { fits: boolean; runsPerMonth: number; perScope: Array<{ scope: string; estimated: number; cap: number | null; fits: boolean }> }
/** Mirrors api-contract `coverageCheckRequestSchema` / `coverageCheckResponseSchema`. Spec §10. */
export interface CoverageCheckRequest { origins: Iata[]; destinations: Iata[]; window: WindowSpec; minNights: number; maxNights: number }
export interface CoverageCheckResponse { pairs: Array<{ origin: Iata; destination: Iata; months: Array<{ month: IsoMonth; cachedRows: number }> }>; calls: number; notes: string[] }
/** One registered croner job. Spec §10 `GET /scheduler/jobs`. */
export interface SchedulerJob { id: string; kind: 'definition' | 'resume' | 'system'; definitionId: string | null; executionId: string | null; nextRun: IsoDateTime | null }

/** Limits the engine needs per provider: pool size, per-call cost, schedule exclusion. Spec §12 presets. */
export interface ProviderRunLimits {
  concurrency: number; costPerCallMicroGbp: number; ratePerMinute: number; monthlyCallCap: number;
  window: 'month' | 'lifetime'; planFixedMicroGbp: number; excludedFromSchedule: boolean;
}
/** Optional construction options. `providerLimits` supplies limits Config does not carry (the fixture provider). */
export interface EngineOptions { providerLimits?: Partial<Record<ProviderId, ProviderRunLimits>> }

/** The plan's "Engine" contract. */
export interface Engine {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  start(definitionId: string, opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number }): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  cancel(executionId: string): Promise<boolean>;
  verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;
  estimate(definition: SearchDefinition, todayLondon: IsoDate): Estimate;
  estimateRemaining(executionId: string): Estimate;
  budgetFit(definition: SearchDefinition): BudgetFit;
  coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>;
  scheduler: { register(def: SearchDefinition): void; unregister(definitionId: string): void; jobs(): SchedulerJob[]; tick(definitionId: string): Promise<void> };
  status(): { running: string[]; degraded: boolean; nextRun: IsoDateTime | null; lastExecutionAt: IsoDateTime | null };
}
```

`src/context.ts`:

```ts
import type { BudgetGuard, Clock, Config, FlightProvider, IsoDateTime, Logger, Notifier, PointOfSale, ProviderId } from '@gmt/core';
import type { Db } from '@gmt/db';
import type { HttpKit } from '@gmt/providers';
import type { EngineDeps, EngineOptions, ProviderRunLimits, Repos } from './types.js';

/** Callbacks the scheduler installs once it exists (createEngine); no-ops until then. Spec §8.1 one-shot jobs. */
export interface EngineHooks {
  scheduleResume(executionId: string, at: IsoDateTime): void;
  cancelResume(executionId: string): void;
}

/** What every engine module receives. Built once per engine by buildContext. */
export interface EngineContext {
  readonly config: Config;
  readonly db: Db;
  readonly repos: Repos;
  readonly budget: BudgetGuard;
  readonly http: HttpKit;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifiers: readonly Notifier[];
  readonly providers: ReadonlyMap<ProviderId, FlightProvider>;
  limitsOf(id: ProviderId): ProviderRunLimits & { billed: boolean };
  pointOfSaleOf(id: ProviderId): PointOfSale;
  readonly hooks: EngineHooks;
}

// why: spec §5.3 billable rule. searchapi and fixture calls count against the billed-vendor scopes
// (execution-calls, execution-cost, global-month); travelpayouts calls never do.
const BILLED: Readonly<Record<ProviderId, boolean>> = { searchapi: true, fixture: true, travelpayouts: false };

/** Builds the engine context and fails fast when a registered provider has no limits. */
export function buildContext(deps: EngineDeps, options: EngineOptions = {}): EngineContext {
  const providers = new Map<ProviderId, FlightProvider>(deps.providers.map((p) => [p.id, p]));
  const limitsOf = (id: ProviderId): ProviderRunLimits & { billed: boolean } => {
    const override = options.providerLimits?.[id];
    if (override !== undefined) return { ...override, billed: BILLED[id] };
    const l = id === 'travelpayouts' ? deps.config.providers.travelpayouts?.limits : id === 'searchapi' ? deps.config.providers.searchapi?.limits : undefined;
    if (l === undefined) throw new Error(`no limits configured for provider ${id}`);
    return {
      concurrency: l.concurrency, costPerCallMicroGbp: l.costPerCallMicroGbp, ratePerMinute: l.ratePerMinute, monthlyCallCap: l.monthlyCallCap,
      window: l.window, planFixedMicroGbp: l.planFixedMicroGbp, excludedFromSchedule: l.excludedFromSchedule, billed: BILLED[id],
    };
  };
  for (const id of providers.keys()) limitsOf(id); // why: a missing limit is a wiring bug; fail at construction, not mid-run
  return {
    config: deps.config, db: deps.db, repos: deps.repos, budget: deps.budget, http: deps.http, clock: deps.clock, log: deps.log,
    notifiers: deps.notifiers, providers, limitsOf,
    // why: spec §5.1 raw shapes carry no point of sale, so it is derived per provider (spec §2, §5.2):
    // Travelpayouts ignores `market` → 'unknown'; SearchApi echoes gl = POINT_OF_SALE; the fixture states none.
    pointOfSaleOf: (id) => (id === 'searchapi' && deps.config.pointOfSale === 'GB' ? 'GB' : 'unknown'),
    hooks: { scheduleResume: () => undefined, cancelResume: () => undefined },
  };
}
```

`src/pool.ts`:

```ts
/**
 * Bounded worker pool. Spec §8.1: "for each tile (bounded pool = provider CONCURRENCY)" and
 * "bounded pool of cells (provider CONCURRENCY)".
 *
 * Starts at most `concurrency` lanes; a lane stops taking items once `signal` aborts or a worker
 * has thrown; the pool always waits for workers already running, so no tile write races whatever
 * the caller does next (status writes, sibling marking). Workers own their error handling; an
 * error that escapes one is rethrown after the pool drains.
 */
export async function runPool<T>(items: readonly T[], concurrency: number, signal: AbortSignal, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  let next = 0;
  const failures: unknown[] = [];
  const lane = async (): Promise<void> => {
    while (!signal.aborted && failures.length === 0) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index] as T; // why: index < length, so the element exists (noUncheckedIndexedAccess)
      try {
        await worker(item, index);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()));
  if (failures.length > 0) throw failures[0];
}
```

`src/run.ts`:

```ts
import {
  AbortedError, type BudgetExceeded, type CellKey, type DefinitionSnapshot, type IsoDateTime, type Logger, type OperatorMessage,
  type ProviderId, type SkipReason, type Stage, cellKeyString, stripUrlsInText,
} from '@gmt/core';
import type { Execution } from '@gmt/db';
import type { EngineContext } from './context.js';

export type OperatorKind = OperatorMessage['kind'];

/** Why a pass stopped early. Each maps to one execution status in execute.ts `finalStatus` (spec §8.1 error table). */
export type StopReason =
  | { kind: 'sigterm' }
  | { kind: 'cancel' }
  | { kind: 'limiter-timeout'; resumeAfter: IsoDateTime }
  | { kind: 'budget'; error: BudgetExceeded; resumeAfter: IsoDateTime | null }
  | { kind: 'all-disabled'; stage: Stage }
  | { kind: 'fatal'; message: string };

/** One (stage, provider) lane: its own abort switch, joined with the execution's (spec §8.1 sibling aborts). */
export interface Lane {
  readonly controller: AbortController;
  /** AbortSignal.any([execution, lane]); every tile or cell call of the lane gets this signal. */
  readonly signal: AbortSignal;
  /** Cell keys whose call is in flight, so a budget breach leaves them `not_run` rather than skipped. */
  readonly inFlight: Set<string>;
  budgetOut: boolean;
}

/** In-memory state of one pass over one execution. Nothing here survives a restart; the DB does. */
export interface RunState {
  readonly executionId: string;
  readonly definitionId: string;
  readonly isChild: boolean;
  readonly childCell: CellKey | null;
  /** Read once from the execution row; a later PUT to the definition never reaches a running pass (Review Focus 4). */
  readonly snapshot: DefinitionSnapshot;
  /** Manual resume semantics (spec §7 resume query). */
  readonly manual: boolean;
  /** True for the first pass started by start()/verifyCell(); parity is judged only on such passes. */
  readonly fresh: boolean;
  /** Providers the pre-start (or resume) budget check excluded from this pass. */
  readonly blocked: ReadonlySet<ProviderId>;
  readonly controller: AbortController;
  stop: StopReason | null;
  readonly disabled: Set<ProviderId>;
  readonly parseStreak: Map<ProviderId, number>;
  readonly lanes: Map<string, Lane>;
  plannedTiles: number;
  progressed: boolean;
  readonly notices: Array<{ kind: OperatorKind; detail: string }>;
  readonly log: Logger;
}

/** Fresh pass state for an execution row. */
export function newRun(ctx: EngineContext, exec: Execution, opts: { manual: boolean; fresh: boolean; blocked: ReadonlySet<ProviderId> }): RunState {
  return {
    executionId: exec.id, definitionId: exec.definitionId, isChild: exec.isChild, childCell: exec.childCell, snapshot: exec.snapshot,
    manual: opts.manual, fresh: opts.fresh, blocked: opts.blocked, controller: new AbortController(), stop: null,
    disabled: new Set(), parseStreak: new Map(), lanes: new Map(), plannedTiles: 0, progressed: false, notices: [],
    log: ctx.log.child({ executionId: exec.id, definitionId: exec.definitionId }),
  };
}

/** Records the first stop reason and aborts every lane of the pass (spec §8.1 "abort sibling cells"). */
export function stopRun(run: RunState, reason: StopReason): void {
  if (run.stop === null) run.stop = reason;
  run.controller.abort();
}

/** The lane for (stage, provider), created on first use. */
export function laneFor(run: RunState, stage: Stage, providerId: ProviderId): Lane {
  const key = `${stage}|${providerId}`;
  const existing = run.lanes.get(key);
  if (existing !== undefined) return existing;
  const controller = new AbortController();
  const lane: Lane = { controller, signal: AbortSignal.any([run.controller.signal, controller.signal]), inFlight: new Set(), budgetOut: false };
  run.lanes.set(key, lane);
  return lane;
}

/** Marks every `not_run` outcome of (stage, provider), except `exclude`, as skipped with `reason`, in one transaction. */
export function markRemaining(ctx: EngineContext, run: Pick<RunState, 'executionId'>, stage: Stage, providerId: ProviderId, reason: SkipReason, exclude: ReadonlySet<string> = new Set()): number {
  const rows = ctx.repos.cells.outcomes(run.executionId, { stage, providerId, status: 'not_run' }).filter((o) => !exclude.has(cellKeyString(o)));
  if (rows.length === 0) return 0;
  ctx.db.transaction(() => {
    for (const o of rows) ctx.repos.cells.setOutcome(run.executionId, o, stage, providerId, { status: 'skipped', reason });
  });
  return rows.length;
}

/** Spec §7: "auto_resume_count … reset when a tile or cell commits". Once per pass is enough. */
export function markProgress(ctx: EngineContext, run: RunState): void {
  if (run.progressed) return;
  run.progressed = true;
  ctx.repos.executions.setStatus(run.executionId, 'running', { autoResumeCount: 0 });
}

/** Cells of (stage, provider) this pass should fetch: the spec §7 resume query. */
export function runnableCells(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId): CellKey[] {
  if (run.disabled.has(providerId)) return [];
  return ctx.repos.cells.resumable(run.executionId, stage, providerId, run.manual);
}

/** Message text for any thrown value, URL-free (spec §5.3 secret scrubbing). */
export function errorText(err: unknown): string {
  return stripUrlsInText(err instanceof Error ? err.message : String(err));
}

/**
 * Handles a failed tile or cell call. Task 7.1: an abort leaves the cells `not_run` (nothing was
 * written); anything else stops the pass as fatal. Task 7.4 replaces this with the full error table.
 */
export function onFailure(ctx: EngineContext, run: RunState, providerId: ProviderId, stage: Stage, cells: readonly CellKey[], err: unknown, signal: AbortSignal): void {
  if (err instanceof AbortedError || signal.aborted) return;
  run.log.warn({ providerId, stage, cells: cells.length, err: errorText(err) }, 'call failed; stopping the pass');
  stopRun(run, { kind: 'fatal', message: errorText(err) });
}
```

`src/registry.ts`:

```ts
import type { Logger } from '@gmt/core';
import { type RunState, errorText } from './run.js';

/** The passes running in this process, so cancel/shutdown can reach them and resume can refuse duplicates. */
export interface RunRegistry {
  launch(run: RunState, body: () => Promise<void>): void;
  get(executionId: string): RunState | undefined;
  done(executionId: string): Promise<void> | undefined;
  all(): RunState[];
  settleAll(): Promise<void>;
}

export function createRegistry(log: Logger): RunRegistry {
  const runs = new Map<string, { run: RunState; done: Promise<void> }>();
  return {
    launch(run, body) {
      const done = body()
        .catch((err: unknown) => {
          // why: execute() catches every stage error itself; reaching here means finish() threw, which is a bug worth a loud line
          log.error({ executionId: run.executionId, err: errorText(err) }, 'execution body threw outside the error table');
        })
        .finally(() => {
          runs.delete(run.executionId);
        });
      runs.set(run.executionId, { run, done });
    },
    get: (id) => runs.get(id)?.run,
    done: (id) => runs.get(id)?.done,
    all: () => [...runs.values()].map((r) => r.run),
    settleAll: async () => {
      await Promise.all([...runs.values()].map((r) => r.done));
    },
  };
}
```

`src/snapshot.ts` (Task 7.3 extends it):

```ts
import { type Cell, type DefinitionSnapshot, type ResolvedSpace, type SearchDefinition, generateCells, resolveWindow } from '@gmt/core';
import type { EngineContext } from './context.js';

export interface BuiltSnapshot { snapshot: DefinitionSnapshot; cells: Cell[]; notes: string[] }

/** Resolves the window in Europe/London and freezes the definition into an execution snapshot. Spec §6.1, §8.1 "start: snapshot". */
export function buildSnapshot(ctx: EngineContext, def: SearchDefinition): BuiltSnapshot {
  const w = resolveWindow(def.window, ctx.clock.todayLondon());
  const resolved: ResolvedSpace = { origins: def.origins, destinations: def.destinations, departureFrom: w.departureFrom, departureTo: w.departureTo, minNights: def.minNights, maxNights: def.maxNights };
  const cells = w.departureFrom > w.departureTo ? [] : generateCells(resolved);
  const usable = (id: SearchDefinition['providers']['discovery'][number], capability: 'discovery' | 'verification'): boolean => ctx.providers.get(id)?.[capability] !== undefined;
  const snapshot: DefinitionSnapshot = {
    ...def,
    providers: {
      ...def.providers,
      discovery: def.providers.discovery.filter((id) => usable(id, 'discovery')),
      verification: def.providers.verification.filter((id) => usable(id, 'verification')),
    },
    resolved,
    resolvedAt: ctx.clock.now(),
    windowClamped: w.clamped,
  };
  return { snapshot, cells, notes: [] };
}
```

`src/normalise.ts` (Task 7.5 widens money to non-GBP; Task 7.8 adds offers):

```ts
import {
  type Cabin, type CapabilityInfo, type Clock, type FxInfo, NormalisationError, type PointOfSale, type ProviderId,
  type RawCalendarPrice, cellKeyString, validateVendorUrl,
} from '@gmt/core';
import type { AirportsRepo, CalendarPriceInsert, FxRepo } from '@gmt/db';

/** Spec §5.2 "Vendor links": the host allowlist per provider. The fixture links to nothing. */
export const LINK_ALLOWLIST: Readonly<Record<ProviderId, readonly string[]>> = { travelpayouts: ['aviasales.com'], searchapi: ['google.com'], fixture: [] };

export interface NormaliseDeps { airports: AirportsRepo; fx: FxRepo; clock: Clock; fxMaxRateAgeDays: number }
export interface Money { pricePence: number; priceNativeMinor: number; currencyNative: string; fx: FxInfo }

/** Spec §5.6 money. Task 7.1: GBP only; any other currency is `currency-unsupported` until Task 7.5. */
export function toMoney(_deps: NormaliseDeps, amountMinor: number, currency: string): Money | NormalisationError {
  const c = currency.toUpperCase();
  if (c === 'GBP') return { pricePence: amountMinor, priceNativeMinor: amountMinor, currencyNative: 'GBP', fx: { converted: false } };
  return new NormalisationError('currency-unsupported', c);
}

export type ReducedTile = { kind: 'ok'; perCell: Map<string, RawCalendarPrice>; discarded: number };

/** Spec §5.6: one calendar price per (provider, cell) per tile — the minimum amountMinor, ties to vendor order; discards counted. */
export function reduceTile(prices: readonly RawCalendarPrice[]): ReducedTile {
  const perCell = new Map<string, RawCalendarPrice>();
  let discarded = 0;
  for (const p of prices) {
    const key = cellKeyString(p);
    const kept = perCell.get(key);
    if (kept === undefined) perCell.set(key, p);
    else {
      discarded += 1;
      if (p.amountMinor < kept.amountMinor) perCell.set(key, p); // strict: an equal later price loses to the earlier one
    }
  }
  return { kind: 'ok', perCell, discarded };
}

/** A validated `https:` vendor link on the provider's allowlist, else null (spec §5.2). */
export function vendorLinkOf(url: string | undefined, providerId: ProviderId): string | null {
  if (url === undefined) return null;
  const b = validateVendorUrl(url, LINK_ALLOWLIST[providerId]);
  return b.kind === 'get' ? b.url : null;
}

export interface CalendarContext { executionId: string; providerId: ProviderId; info: CapabilityInfo; cabin: Cabin; pointOfSale: PointOfSale; fetchedAt: CalendarPriceInsert['fetchedAt'] }

/** One raw calendar price → one calendar_prices row with full provenance, or the reason it cannot be stored. Spec §5.6, §7. */
export function normaliseCalendarPrice(raw: RawCalendarPrice, c: CalendarContext, deps: NormaliseDeps): CalendarPriceInsert | NormalisationError {
  const m = toMoney(deps, raw.amountMinor, raw.currency);
  if (m instanceof NormalisationError) return m;
  const fx = m.fx;
  return {
    executionId: c.executionId, providerId: c.providerId, sourceKind: c.info.sourceKind, cabin: c.cabin,
    origin: raw.origin, destination: raw.destination, departureDate: raw.departureDate, returnDate: raw.returnDate,
    pricePence: m.pricePence, priceNativeMinor: m.priceNativeMinor, currencyNative: m.currencyNative,
    fxRateNano: fx.converted ? fx.rateNano : null, fxRateDate: fx.converted ? fx.rateDate : null, fxSource: fx.converted ? fx.source : null, fxConverted: fx.converted,
    pointOfSale: c.pointOfSale, fetchedAt: c.fetchedAt, providerObservedAt: raw.providerObservedAt ?? null,
    // why: spec §7 "max_age_hours NULL means unknown and is written explicitly"
    maxAgeHours: c.info.maxAgeHours === 'unknown' ? null : c.info.maxAgeHours,
    vendorLink: vendorLinkOf(raw.vendorLink, c.providerId),
    reusedFromExecutionId: null,
  };
}
```

`src/stages/discovery.ts` (Task 7.7 adds the reuse call):

```ts
import {
  type CapabilityInfo, type CellKey, type DefinitionSnapshot, type DiscoveryCapability, type DiscoveryQuery, type DiscoveryTileResult,
  type Iata, NormalisationError, type ProviderId, type TilePlan, cellKeyString,
} from '@gmt/core';
import type { TileWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { type NormaliseDeps, normaliseCalendarPrice, reduceTile } from '../normalise.js';
import { runPool } from '../pool.js';
import { type RunState, laneFor, markProgress, markRemaining, onFailure, runnableCells, stopRun } from '../run.js';

export interface PlannedTile { plan: TilePlan; query: DiscoveryQuery }

/** Normalisation dependencies drawn from the context. */
export function normaliseDeps(ctx: EngineContext): NormaliseDeps {
  return { airports: ctx.repos.airports, fx: ctx.repos.fx, clock: ctx.clock, fxMaxRateAgeDays: ctx.config.fxMaxRateAgeDays };
}

/** The discovery query for one pair, re-planned over exactly `cells` (spec §5.1 `cells`, §8.1). */
export function discoveryQuery(snapshot: DefinitionSnapshot, origin: Iata, destination: Iata, cells: readonly CellKey[]): DiscoveryQuery {
  const r = snapshot.resolved;
  return { origin, destination, departureFrom: r.departureFrom, departureTo: r.departureTo, minNights: r.minNights, maxNights: r.maxNights, cabin: snapshot.cabin, currency: 'GBP', cells: [...cells] };
}

/** Groups cells by pair in snapshot order and plans each pair over its cells; tile indexes are made unique across pairs. */
export function planTiles(cap: DiscoveryCapability, snapshot: DefinitionSnapshot, cells: readonly CellKey[]): PlannedTile[] {
  const byPair = new Map<string, CellKey[]>();
  for (const c of cells) {
    const key = `${c.origin}|${c.destination}`;
    const list = byPair.get(key);
    if (list === undefined) byPair.set(key, [c]);
    else list.push(c);
  }
  const out: PlannedTile[] = [];
  let offset = 0;
  for (const origin of snapshot.resolved.origins) {
    for (const destination of snapshot.resolved.destinations) {
      const pairCells = byPair.get(`${origin}|${destination}`);
      if (pairCells === undefined) continue;
      const query = discoveryQuery(snapshot, origin, destination, pairCells);
      const plans = cap.plan(query);
      // why: plan() numbers tiles from 0 per pair; the ledger's tile_index must be unique within one
      // pass of one provider so parity can count distinct tiles (spec §8.1 "Parity").
      for (const p of plans) out.push({ plan: { ...p, index: offset + p.index }, query });
      offset += plans.length;
    }
  }
  return out;
}

/** Spec §8.1 "discovery, per discovery provider, per (origin, destination) pair". */
export async function runDiscovery(ctx: EngineContext, run: RunState): Promise<void> {
  const ids = run.snapshot.providers.discovery.filter((id) => ctx.providers.get(id)?.discovery !== undefined);
  if (ids.length === 0) return;
  ctx.repos.executions.setStatus(run.executionId, 'running', { stage: 'discovery' });
  await Promise.all(ids.map((id) => runDiscoveryProvider(ctx, run, id)));
  // why: spec §8.1 error table "if none remain, paused_error + notify"
  if (run.stop === null && ids.every((id) => run.disabled.has(id))) stopRun(run, { kind: 'all-disabled', stage: 'discovery' });
}

async function runDiscoveryProvider(ctx: EngineContext, run: RunState, providerId: ProviderId): Promise<void> {
  const cap = ctx.providers.get(providerId)?.discovery;
  if (cap === undefined) return;
  const log = run.log.child({ providerId });
  const cells = runnableCells(ctx, run, 'discovery', providerId);
  if (cells.length > 0) {
    const tiles = planTiles(cap, run.snapshot, cells);
    run.plannedTiles += tiles.length;
    log.info({ stage: 'discovery', cells: cells.length, tiles: tiles.length }, 'discovery: planned tiles');
    const lane = laneFor(run, 'discovery', providerId);
    await runPool(tiles, ctx.limitsOf(providerId).concurrency, lane.signal, async (tile) => {
      const keys = tile.plan.coveredCells.map(cellKeyString);
      for (const k of keys) lane.inFlight.add(k);
      try {
        const result = await cap.fetchTile(tile.plan, tile.query, { executionId: run.executionId, signal: lane.signal, recordFixtures: false });
        if (lane.signal.aborted) return; // why: a response landing after the stop is not written; its cells stay not_run (spec §3)
        if (result.kind === 'tile-error') onFailure(ctx, run, providerId, 'discovery', result.coveredCells, result.error, lane.signal);
        else commitTile(ctx, run, providerId, cap.info, result);
      } catch (err) {
        onFailure(ctx, run, providerId, 'discovery', tile.plan.coveredCells, err, lane.signal);
      } finally {
        for (const k of keys) lane.inFlight.delete(k);
      }
    });
  }
  if (run.disabled.has(providerId)) markRemaining(ctx, run, 'discovery', providerId, 'provider_disabled');
}

/**
 * Writes one tile atomically: one price per cell, one outcome per covered cell, roll-ups (spec §7
 * "each tile's prices, outcomes and roll-ups"). Covered cells with a price → priced (or error with
 * the normalisation reason); in noFares → empty; otherwise → no_data (not evidence of no flights).
 */
export function commitTile(ctx: EngineContext, run: RunState, providerId: ProviderId, info: CapabilityInfo, result: Extract<DiscoveryTileResult, { kind: 'tile' }>): void {
  const reduced = reduceTile(result.prices);
  const pointOfSale = ctx.pointOfSaleOf(providerId);
  const noFares = new Set(result.noFares.map(cellKeyString));
  const write: TileWrite = { tileIndex: result.index, fetchedAt: result.fetchedAt, prices: [], outcomes: [] };
  for (const cell of result.coveredCells) {
    const key = cellKeyString(cell);
    const base = { cell, fetchedAt: result.fetchedAt, cabin: run.snapshot.cabin, pointOfSale, sourceKind: info.sourceKind };
    const raw = reduced.perCell.get(key);
    if (raw !== undefined) {
      const price = normaliseCalendarPrice(raw, { executionId: run.executionId, providerId, info, cabin: run.snapshot.cabin, pointOfSale, fetchedAt: result.fetchedAt }, normaliseDeps(ctx));
      if (price instanceof NormalisationError) write.outcomes.push({ ...base, status: 'error', reason: price.reason, lastError: price.message, minPence: null });
      else {
        write.prices.push(price);
        write.outcomes.push({ ...base, status: 'priced', reason: null, lastError: null, minPence: price.pricePence });
      }
    } else if (noFares.has(key)) write.outcomes.push({ ...base, status: 'empty', reason: null, lastError: null, minPence: null });
    else write.outcomes.push({ ...base, status: 'no_data', reason: null, lastError: null, minPence: null });
  }
  ctx.db.transaction(() => {
    // why: spec §7 "a fresh price superseding a reused row deletes that row in the same transaction"
    for (const p of write.prices) ctx.repos.calendarPrices.supersedeReused(run.executionId, providerId, p);
    ctx.repos.cells.writeTile(run.executionId, providerId, write);
  });
  run.parseStreak.set(providerId, 0);
  markProgress(ctx, run);
  if (reduced.discarded > 0 || result.notes.length > 0) {
    run.log.child({ providerId }).debug({ tileIndex: result.index, discarded: reduced.discarded, notes: result.notes }, 'discovery: tile reduced');
  }
}
```

`src/execute.ts` (Task 7.2 adds notifications to `finish`; Task 7.8 adds verification; Task 7.11 adds post-run checks):

```ts
import type { ExecutionStatus, IsoDateTime } from '@gmt/core';
import type { StatusPatch } from '@gmt/db';
import type { EngineContext } from './context.js';
import { type OperatorKind, type RunState, type StopReason, errorText, stopRun } from './run.js';
import { runDiscovery } from './stages/discovery.js';

/** Runs one pass: discovery, then finish. Any error a stage lets escape stops the pass as fatal. */
export async function execute(ctx: EngineContext, run: RunState): Promise<void> {
  try {
    await runDiscovery(ctx, run);
  } catch (err) {
    stopRun(run, { kind: 'fatal', message: errorText(err) });
  }
  await finish(ctx, run);
}

/** Maps a stop reason to the execution status, patch and operator notice of spec §8.1. Pure. */
export function finalStatus(stop: StopReason | null, now: IsoDateTime): { status: ExecutionStatus; patch: StatusPatch; notice: { kind: OperatorKind; detail: string } | null } {
  if (stop === null) return { status: 'completed', patch: { finishedAt: now, resumeAfter: null, errorText: null }, notice: null };
  switch (stop.kind) {
    case 'sigterm':
      // why: spec §8.1 "SIGTERM: … status interrupted without incrementing the counter"
      return { status: 'interrupted', patch: {}, notice: { kind: 'interrupted', detail: 'The app stopped during this run; cells that were in flight went back to not searched.' } };
    case 'cancel':
      return { status: 'cancelled', patch: { finishedAt: now, resumeAfter: null }, notice: null };
    case 'limiter-timeout':
      return { status: 'paused_error', patch: { resumeAfter: stop.resumeAfter }, notice: { kind: 'paused_error', detail: `A provider rate window is full; the run resumes automatically at ${stop.resumeAfter}.` } };
    case 'budget': {
      const e = stop.error;
      const when = stop.resumeAfter === null ? 'It needs a cap change, or a resume after editing the definition.' : `It resumes automatically at ${stop.resumeAfter}.`;
      return { status: 'paused_budget', patch: { resumeAfter: stop.resumeAfter }, notice: { kind: 'paused_budget', detail: `The ${e.scope} cap was reached (cap ${e.cap}, used ${e.current}, next call ${e.requested}). ${when}` } };
    }
    case 'all-disabled':
      return { status: 'paused_error', patch: { resumeAfter: null }, notice: { kind: 'paused_error', detail: `Every ${stop.stage} provider was disabled after errors; resume manually once the cause is fixed.` } };
    case 'fatal':
      return { status: 'paused_error', patch: { resumeAfter: null, errorText: stop.message }, notice: { kind: 'paused_error', detail: `The run stopped on an internal error: ${stop.message}` } };
  }
}

/** Writes the pass's final status. The status write is the last act (Task 7.2 puts notifications before it). */
export async function finish(ctx: EngineContext, run: RunState): Promise<void> {
  const { status, patch } = finalStatus(run.stop, ctx.clock.now());
  ctx.repos.executions.setStatus(run.executionId, status, patch);
  if (patch.resumeAfter !== undefined && patch.resumeAfter !== null) ctx.hooks.scheduleResume(run.executionId, patch.resumeAfter);
  run.log.info({ status }, 'execution: pass finished');
}
```

`src/start.ts` (Task 7.3 and Task 7.12 extend it):

```ts
import type { StartResult } from './types.js';
import type { Execution } from '@gmt/db';
import type { EngineContext } from './context.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { buildSnapshot } from './snapshot.js';

/** A refused StartResult. */
export function refused(code: 'active' | 'cap' | 'confirm' | 'window', message: string, details: unknown): StartResult {
  return { ok: false, code, message, details };
}

/** better-sqlite3 reports partial-unique-index clashes as SQLITE_CONSTRAINT_UNIQUE (spec §7 parent/child partial unique indexes). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT');
}

/** Spec §8.1 "start: snapshot; seed search_cells + cell_outcomes(not_run) …; status=running". */
export async function startExecution(ctx: EngineContext, reg: RunRegistry, definitionId: string, opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number }): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null) throw new Error(`definition ${definitionId} not found`); // why: WP8 answers 404 before calling start
  if (ctx.repos.executions.activeParent(def.id) !== null) return refused('active', 'another execution of this definition is active', { definitionId });
  const built = buildSnapshot(ctx, def);
  const discovery = built.snapshot.providers.discovery;
  let exec: Execution;
  try {
    exec = ctx.repos.executions.create({ definitionId: def.id, snapshot: built.snapshot, status: 'pending', estimate: null });
  } catch (err) {
    if (isUniqueViolation(err)) return refused('active', 'another execution of this definition is active', { definitionId });
    throw err;
  }
  // why: spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start"
  ctx.db.transaction(() => {
    ctx.repos.cells.seed(exec.id, built.cells, discovery);
    ctx.repos.executions.setStatus(exec.id, 'running', { stage: discovery.length > 0 ? 'discovery' : 'verification' });
  });
  const run = newRun(ctx, { ...exec, status: 'running' }, { manual: false, fresh: true, blocked: new Set() });
  run.log.info({ trigger: opts.trigger, cells: built.cells.length }, 'execution: started');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
```

`src/resume.ts` (Task 7.13 extends it):

```ts
import { RESUMABLE_STATUSES } from '@gmt/core';
import type { EngineContext } from './context.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { refused } from './start.js';
import type { StartResult } from './types.js';

/**
 * Spec §8.1 "Resume is a compare-and-set": only one claimer of an execution proceeds; the one-shot
 * job is cancelled in the same step; the new pass re-plans over the resume query only (spec §7).
 */
export async function resumeExecution(ctx: EngineContext, reg: RunRegistry, executionId: string, opts: { manual: boolean }): Promise<StartResult> {
  const exec = ctx.repos.executions.get(executionId);
  if (exec === null) return refused('active', `execution ${executionId} not found`, { executionId });
  if (reg.get(executionId) !== undefined || !RESUMABLE_STATUSES.includes(exec.status)) {
    return refused('active', `execution is ${exec.status} and cannot be resumed`, { status: exec.status });
  }
  if (!ctx.repos.executions.claimResume(executionId)) return refused('active', 'another resume claimed this execution first', { executionId });
  ctx.hooks.cancelResume(executionId);
  const run = newRun(ctx, { ...exec, status: 'running' }, { manual: opts.manual, fresh: false, blocked: new Set() });
  run.log.info({ manual: opts.manual, autoResumeCount: exec.autoResumeCount }, 'execution: resumed');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId };
}
```

`src/orchestrator.ts`:

```ts
import type { EngineContext } from './context.js';
import { createRegistry } from './registry.js';
import { resumeExecution } from './resume.js';
import { stopRun } from './run.js';
import { startExecution } from './start.js';
import type { StartResult } from './types.js';

/** The execution half of the Engine; createEngine (Task 7.18) adds estimates, scheduler, boot and status. */
export interface Orchestrator {
  start(definitionId: string, opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number }): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  /** Aborts every pass as SIGTERM (cells in flight → not_run, status interrupted) and waits for them. */
  shutdown(): Promise<void>;
  running(): string[];
}

export function createOrchestrator(ctx: EngineContext): Orchestrator {
  const reg = createRegistry(ctx.log);
  return {
    start: (id, opts) => startExecution(ctx, reg, id, opts),
    resume: (id, opts) => resumeExecution(ctx, reg, id, opts),
    shutdown: async () => {
      for (const run of reg.all()) stopRun(run, { kind: 'sigterm' });
      await reg.settleAll();
    },
    running: () => reg.all().map((r) => r.executionId),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine test -- resume-k-of-n pool`
Expected: PASS, 5 tests (1 in `resume-k-of-n.test.ts`, 4 in `pool.test.ts`). Coverage thresholds are not enforced on a filtered run.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: layer-A harness, pool and discovery pass; resume after k of n tiles issues n-k

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.2: Operator notifications, `LogNotifier`, deduplication per execution and kind

**Files:**
- Create: `packages/engine/src/notifiers/messages.ts`, `src/notify.ts`, `src/notifiers/log.ts`, `test/notifications.test.ts`
- Modify: `packages/engine/src/execute.ts` (`finish`)

**Interfaces:**
- Consumes: `Notifier`, `OperatorMessage`, `AlertDigest`, `NotificationsRepo.wasSent/record`, `findBannedWords`, `stripUrlsInText`.
- Produces: `operatorMessage(kind, params)`, `cleanLine(s)`, `cleanText(s)`, `notifyOperator(ctx, kind, params): Promise<boolean>`, `LogNotifier`, `containsSynthetic(value)`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/notifications.test.ts`:

```ts
import { type OperatorMessage, findBannedWords } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { notifyOperator } from '../src/notify.js';
import { LogNotifier, containsSynthetic } from '../src/notifiers/log.js';
import { OPERATOR_KINDS, operatorMessage } from '../src/notifiers/messages.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, type LogLine, capturingLogger, createHarness } from './harness.js';

let h: Harness;
afterEach(() => h.close());

async function anExecution(): Promise<{ id: string; definitionId: string }> {
  const def = h.createDefinition();
  const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), def.id);
  return { id: e.id, definitionId: def.id };
}

describe('operator notifications (spec §8.1 "deduplicated per execution and kind")', () => {
  it('sends one message per (kind, execution) however often it is asked', async () => {
    h = createHarness();
    const { id, definitionId } = await anExecution();
    const ctx = buildContext(h.deps, h.options);
    const p = { executionId: id, definitionId, definitionName: 'x', detail: 'cap reached' };
    expect(await notifyOperator(ctx, 'paused_budget', p)).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p)).toBe(false);
    expect(await notifyOperator(ctx, 'provider_disabled', p)).toBe(true);
    const kinds = h.notifications.filter((m): m is OperatorMessage => 'kind' in m).map((m) => m.kind);
    expect(kinds).toEqual(['paused_budget', 'provider_disabled']);
    expect(h.repos.notifications.wasSent('paused_budget', id)).toBe(true);
  });

  it('records a refused or throwing notifier as failed and logs a warning, without throwing', async () => {
    h = createHarness();
    const { id, definitionId } = await anExecution();
    const ctx = { ...buildContext(h.deps, h.options), notifiers: [{ id: 'boom', send: async () => { throw new Error('smtp down at https://user:pw@mail.example/x?k=1'); } }] };
    expect(await notifyOperator(ctx, 'paused_error', { executionId: id, definitionId, definitionName: 'x', detail: 'd' })).toBe(true);
    const warn = h.logs.find((l) => l.msg === 'operator notification failed');
    expect(warn?.fields.err).toBe('smtp down at https://mail.example/x');
  });

  it('a SIGTERM pass emits exactly one `interrupted` notification', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition();
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    h.onTileCommit((n) => {
      if (n === 1) void orch.shutdown();
    });
    const r = await orch.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await h.waitForSettled(r.executionId);
    const msgs = h.notifications.filter((m): m is OperatorMessage => 'kind' in m && m.kind === 'interrupted');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.executionId).toBe(r.executionId);
    expect(msgs[0]?.subject).toBe('[get-me-there] London to New York (layer A): run interrupted');
  });
});

describe('operatorMessage', () => {
  it('every kind has a prefixed subject, a body, no banned word and no URL query (spec §11, §5.3)', () => {
    for (const kind of OPERATOR_KINDS) {
      const m = operatorMessage(kind, { definitionName: 'London to New York', executionId: 'e1', detail: 'see https://x.example/p?token=abc' });
      expect(m.subject.startsWith('[get-me-there] London to New York: ')).toBe(true);
      expect(m.body.length).toBeGreaterThan(0);
      expect(findBannedWords(`${m.subject}\n${m.body}`)).toEqual([]);
      expect(`${m.subject}${m.body}`).not.toMatch(/\?token=/);
    }
  });
  it('strips control characters from provider-supplied text (spec §8.3)', () => {
    const m = operatorMessage('provider_disabled', { definitionName: 'a\u0007b', executionId: null, detail: 'x\u001b[31my' });
    expect(m.subject).toBe('[get-me-there] a b: a provider was disabled for this run');
    expect(m.body.startsWith('x [31my')).toBe(true);
  });
});

describe('LogNotifier (spec §8.3)', () => {
  it('logs subject and body as plain text and reports ok', async () => {
    const lines: LogLine[] = [];
    const n = new LogNotifier(capturingLogger(lines));
    const msg: OperatorMessage = { kind: 'parity_break', executionId: 'e1', definitionId: 'd1', subject: 's\u0000', body: 'b1\nb2' };
    expect(await n.send(msg)).toEqual({ ok: true });
    expect(lines[0]).toMatchObject({ level: 'info', bindings: { notifier: 'log' }, fields: { kind: 'parity_break', executionId: 'e1', definitionId: 'd1', subject: 's' }, msg: 'b1\nb2' });
  });
  it('refuses anything carrying a synthetic price (spec §5.5 "Alerts and notifiers refuse synthetic rows")', async () => {
    const lines: LogLine[] = [];
    const n = new LogNotifier(capturingLogger(lines));
    const digest = { ruleId: 'r', definitionId: 'd', executionId: 'e', basis: 'calendar' as const, subject: 's', body: 'b', items: [{ provenance: { sourceKind: 'synthetic' } }], restCount: 0 };
    const r = await n.send(digest as unknown as Parameters<LogNotifier['send']>[0]);
    expect(r.ok).toBe(false);
    expect(lines).toHaveLength(0);
    expect(containsSynthetic({ a: [{ b: { sourceKind: 'authorised-cached' } }] })).toBe(false);
    expect(containsSynthetic({ a: [{ b: { sourceKind: 'synthetic' } }] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine test -- notifications`
Expected: FAIL, `Cannot find module '../src/notify.js'`.

- [ ] **Step 3: Implement**

`src/notifiers/messages.ts`:

```ts
import { stripUrlsInText } from '@gmt/core';
import type { OperatorKind } from '../run.js';

/** Every operator-notification kind of spec §8.1 "Operator notifications". */
export const OPERATOR_KINDS: readonly OperatorKind[] = [
  'paused_budget', 'paused_error', 'skipped_budget', 'skipped_confirm', 'skipped_window', 'skipped_missed',
  'interrupted', 'provider_disabled', 'parity_break', 'alerts_calendar_only',
];

// why: spec §11 banned words apply to engine templates; every string here is covered by the
// banned-word test in notifications.test.ts and the sweep in Task 7.20.
const SUBJECTS: Readonly<Record<OperatorKind, string>> = {
  paused_budget: 'run paused: a spend cap was reached',
  paused_error: 'run paused after errors',
  skipped_budget: 'scheduled run skipped: it would exceed a spend cap',
  skipped_confirm: 'scheduled run skipped: the cost estimate needs your confirmation',
  skipped_window: 'scheduled run skipped: the window has no departure dates left, schedule disabled',
  skipped_missed: 'scheduled run missed while the app was stopped',
  interrupted: 'run interrupted',
  provider_disabled: 'a provider was disabled for this run',
  parity_break: 'request count differs from the plan',
  alerts_calendar_only: 'alerts running on calendar basis only',
};
const GUIDANCE: Readonly<Record<OperatorKind, string>> = {
  paused_budget: 'Raise the cap, or wait for the window to reopen; Resume is on the status bar.',
  paused_error: 'Check the provider, then resume from the status bar once the cause is fixed.',
  skipped_budget: 'Lower maxCells, run less often, or raise the cap.',
  skipped_confirm: 'Open the definition and confirm the new estimate.',
  skipped_window: 'Edit the window, then enable the definition again.',
  skipped_missed: 'The next scheduled run goes ahead as normal; start one now if you need newer prices.',
  interrupted: 'It resumes on the next start unless it has restarted too often without progress.',
  provider_disabled: 'The other providers carried on; a manual resume retries this one.',
  parity_break: 'The plan and the ledger disagree; Coverage shows both counts.',
  alerts_calendar_only: 'Verified-basis alert rules did not run; calendar-basis rules ran, constraints not checked.',
};

/** One line of provider- or operator-supplied text: URL query and userinfo stripped, control characters → spaces (spec §5.3, §8.3). */
export function cleanLine(s: string): string {
  const noUrls = stripUrlsInText(s);
  let out = '';
  for (const ch of noUrls) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 32 || c === 127 ? ' ' : ch;
  }
  return out.replace(/ {2,}/g, ' ').trim();
}
/** Multi-line text: each line cleaned, line breaks kept. */
export function cleanText(s: string): string {
  return s.split('\n').map(cleanLine).join('\n');
}

export interface MessageParams { definitionName: string; executionId: string | null; detail: string }

/** Plain-text subject and body for an operator notification (spec §8.3 "Plain text only"). */
export function operatorMessage(kind: OperatorKind, p: MessageParams): { subject: string; body: string } {
  const subject = `[get-me-there] ${cleanLine(p.definitionName)}: ${SUBJECTS[kind]}`;
  const lines = [cleanText(p.detail), GUIDANCE[kind]];
  if (p.executionId !== null) lines.push(`Execution: ${p.executionId}`);
  return { subject, body: lines.join('\n') };
}
```

`src/notify.ts`:

```ts
import type { OperatorMessage } from '@gmt/core';
import type { EngineContext } from './context.js';
import { operatorMessage } from './notifiers/messages.js';
import { type OperatorKind, errorText } from './run.js';

export interface NotifyParams { executionId: string | null; definitionId: string; definitionName: string; detail: string }

/**
 * Sends one operator notification to every notifier, at most once per (kind, execution) (spec §8.1
 * "deduplicated per execution and kind"). Returns false when deduplicated. Never throws: a failing
 * notifier is logged and recorded as failed, because a notification must not stop a run.
 */
export async function notifyOperator(ctx: Pick<EngineContext, 'repos' | 'notifiers' | 'log'>, kind: OperatorKind, p: NotifyParams): Promise<boolean> {
  if (p.executionId !== null && ctx.repos.notifications.wasSent(kind, p.executionId)) return false;
  const { subject, body } = operatorMessage(kind, p);
  const msg: OperatorMessage = { kind, executionId: p.executionId, definitionId: p.definitionId, subject, body };
  let ok = ctx.notifiers.length > 0;
  for (const n of ctx.notifiers) {
    try {
      const r = await n.send(msg);
      if (!r.ok) {
        ok = false;
        ctx.log.warn({ notifier: n.id, kind, executionId: p.executionId, detail: r.detail ?? null }, 'operator notification refused');
      }
    } catch (err) {
      ok = false;
      ctx.log.warn({ notifier: n.id, kind, executionId: p.executionId, err: errorText(err) }, 'operator notification failed');
    }
  }
  if (p.executionId !== null) ctx.repos.notifications.record(kind, p.executionId, ok ? 'sent' : 'failed');
  return true;
}
```

`src/notifiers/log.ts`:

```ts
import type { AlertDigest, Logger, Notifier, OperatorMessage } from '@gmt/core';
import { cleanLine, cleanText } from './messages.js';

/** True when any nested object carries `sourceKind: 'synthetic'` (spec §5.5: notifiers refuse synthetic rows). */
export function containsSynthetic(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSynthetic);
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'sourceKind' && v === 'synthetic') return true;
      if (containsSynthetic(v)) return true;
    }
  }
  return false;
}

/**
 * The always-available notifier: writes each message to the log as plain text (spec §8.3
 * "EmailNotifier … and LogNotifier"). EmailNotifier is WP11.
 */
export class LogNotifier implements Notifier {
  readonly id = 'log' as const;
  readonly #log: Logger;
  constructor(log: Logger) {
    this.#log = log.child({ notifier: 'log' });
  }
  async send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> {
    if (containsSynthetic(msg)) return { ok: false, detail: 'synthetic data is never delivered by a notifier' };
    const kind = 'kind' in msg ? msg.kind : 'alert_digest';
    this.#log.info({ kind, executionId: msg.executionId, definitionId: msg.definitionId, subject: cleanLine(msg.subject) }, cleanText(msg.body));
    return { ok: true };
  }
}
```

`src/execute.ts`: replace `finish` with:

```ts
/**
 * Writes the pass's final status after sending its notices. The status write is the last act, so
 * anyone who observes a final status also observes every write and notification of the pass.
 */
export async function finish(ctx: EngineContext, run: RunState): Promise<void> {
  const { status, patch, notice } = finalStatus(run.stop, ctx.clock.now());
  const notices = notice === null ? [...run.notices] : [...run.notices, notice];
  const name = ctx.repos.definitions.get(run.definitionId)?.name ?? run.snapshot.name;
  for (const n of notices) {
    await notifyOperator(ctx, n.kind, { executionId: run.executionId, definitionId: run.definitionId, definitionName: name, detail: n.detail });
  }
  ctx.repos.executions.setStatus(run.executionId, status, patch);
  if (patch.resumeAfter !== undefined && patch.resumeAfter !== null) ctx.hooks.scheduleResume(run.executionId, patch.resumeAfter);
  run.log.info({ status, notices: notices.map((n) => n.kind) }, 'execution: pass finished');
}
```

and add `import { notifyOperator } from './notify.js';` to its imports.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine test -- notifications resume-k-of-n`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: operator notifications with per-execution dedup, LogNotifier

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.3: Seeding and the frozen snapshot (Review Focus 4)

**Files:**
- Create: `packages/engine/test/wrappers.ts`, `packages/engine/test/seeding.test.ts`
- Modify: `packages/engine/src/snapshot.ts`, `packages/engine/src/start.ts`

**Interfaces:**
- Consumes: `CellsRepo.seed/outcomes/rollUps`, `DefinitionsRepo.update`, `generateCells`, `cellKeyString`.
- Produces: `buildSnapshot(ctx, def, trigger)` (adds the trigger), test helpers `freeStubProvider`, `mapPrices`, `mapOffers`, `throwOnSearch`, `doubleFetch` in `test/wrappers.ts`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/wrappers.ts` (complete; used by later tasks):

```ts
/**
 * Provider decorators for layer-A tests. Each wraps a real provider (normally the fixture provider,
 * so every call still goes through http-kit, the ledger and the cache) and changes one thing the
 * test needs. `freeStubProvider` is a free discovery provider that answers `no_data` for every
 * cell, so multi-provider rules ("continue other providers", "free providers continue") are
 * testable without inventing a single price.
 */
import {
  AbortedError, type CellKey, type Clock, type DiscoveryTileResult, type FlightProvider, type ItinerarySearchResult,
  type RawCalendarPrice, type RawOffer, generateCells,
} from '@gmt/core';
import type { HttpKit } from '@gmt/providers';

function shell(p: FlightProvider, parts: Partial<Pick<FlightProvider, 'discovery' | 'verification'>>): FlightProvider {
  const discovery = 'discovery' in parts ? parts.discovery : p.discovery;
  const verification = 'verification' in parts ? parts.verification : p.verification;
  return {
    id: p.id,
    displayName: p.displayName,
    suppliedFields: p.suppliedFields,
    cabins: p.cabins,
    ...(discovery !== undefined ? { discovery } : {}),
    ...(verification !== undefined ? { verification } : {}),
    healthcheck: (ctx) => p.healthcheck(ctx),
  };
}

/** Rewrites every raw calendar price of every tile (e.g. a different currency). */
export function mapPrices(p: FlightProvider, f: (price: RawCalendarPrice, i: number) => RawCalendarPrice): FlightProvider {
  const d = p.discovery;
  if (d === undefined) throw new Error('mapPrices needs discovery');
  return shell(p, {
    discovery: {
      info: d.info,
      plan: (q) => d.plan(q),
      fetchTile: async (plan, q, ctx): Promise<DiscoveryTileResult> => {
        const r = await d.fetchTile(plan, q, ctx);
        return r.kind === 'tile' ? { ...r, prices: r.prices.map(f) } : r;
      },
    },
  });
}

/** Rewrites every raw offer of every itinerary search. */
export function mapOffers(p: FlightProvider, f: (offer: RawOffer, i: number) => RawOffer): FlightProvider {
  const v = p.verification;
  if (v === undefined) throw new Error('mapOffers needs verification');
  return shell(p, {
    verification: {
      info: v.info,
      estimate: (q) => v.estimate(q),
      search: async (q, ctx): Promise<ItinerarySearchResult> => {
        const r = await v.search(q, ctx);
        return { ...r, offers: r.offers.map(f) };
      },
    },
  });
}

/** Makes itinerary search throw `err` for cells matching `when`, without calling the vendor. */
export function throwOnSearch(p: FlightProvider, err: Error, when: (cell: CellKey) => boolean): FlightProvider {
  const v = p.verification;
  if (v === undefined) throw new Error('throwOnSearch needs verification');
  return shell(p, {
    verification: {
      info: v.info,
      estimate: (q) => v.estimate(q),
      search: async (q, ctx) => {
        if (when(q)) throw err;
        return v.search(q, ctx);
      },
    },
  });
}

/** Fetches every tile twice (the second is an http-kit cache hit), breaking parity on purpose. */
export function doubleFetch(p: FlightProvider): FlightProvider {
  const d = p.discovery;
  if (d === undefined) throw new Error('doubleFetch needs discovery');
  return shell(p, {
    discovery: {
      info: d.info,
      plan: (q) => d.plan(q),
      fetchTile: async (plan, q, ctx) => {
        await d.fetchTile(plan, q, ctx);
        return d.fetchTile(plan, q, ctx);
      },
    },
  });
}

/**
 * A free discovery provider registered as `travelpayouts`: one tile per pair, one call per tile to
 * the harness's `http://stub.local` endpoint through the real http-kit (so it is ledgered as a free
 * call and parity holds), every covered cell `no_data`. No price is produced, so nothing is fabricated.
 */
export function freeStubProvider(tools: { clock: Clock; http: HttpKit }): FlightProvider {
  return {
    id: 'travelpayouts',
    displayName: 'free stub (layer A)',
    suppliedFields: [],
    cabins: ['economy'],
    discovery: {
      info: { sourceKind: 'authorised-cached', provenanceNote: 'layer-A stub: answers no cached data for every cell', maxAgeHours: 48 },
      plan: (q) => {
        const cells: CellKey[] = q.cells ?? generateCells({ origins: [q.origin], destinations: [q.destination], departureFrom: q.departureFrom, departureTo: q.departureTo, minNights: q.minNights, maxNights: q.maxNights });
        return [{ index: 0, coveredCells: cells, request: { kind: 'rectangle', departFrom: q.departureFrom, departTo: q.departureTo, returnFrom: q.departureFrom, returnTo: q.departureTo } }];
      },
      fetchTile: async (plan, q, ctx) => {
        if (ctx.signal.aborted) throw new AbortedError();
        const res = await tools.http.request({
          providerId: 'travelpayouts', executionId: ctx.executionId, tileIndex: plan.index, endpointPath: '/stub-tile', method: 'GET',
          url: new URL(`http://stub.local/stub-tile?origin=${q.origin}&destination=${q.destination}`), headers: {}, cache: 'never', signal: ctx.signal, recordFixtures: false,
        });
        return { kind: 'tile', index: plan.index, coveredCells: plan.coveredCells, fetchedAt: res.fetchedAt, prices: [], noFares: [], notes: ['layer-A stub'] };
      },
    },
    healthcheck: async () => ({ ok: true, detail: 'stub' }),
  };
}
```

`packages/engine/test/seeding.test.ts`:

```ts
import { asIsoDate, cellKeyString, generateCells, resolveWindow } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, JFK, LGW, LHR, RESPONSES, createHarness, discoveryOf } from './harness.js';
import { freeStubProvider } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const orch = () => createOrchestrator(buildContext(h.deps, h.options));

describe('seeding (spec §3, §7 atomic unit "seeding search_cells + discovery cell_outcomes at start")', () => {
  it('seeds not_run for every cell × discovery provider and nothing for a stage without a provider', async () => {
    h = createHarness({ extraProviders: (t) => [freeStubProvider(t)] });
    h.scenario({ match: (r) => r.kind === 'calendar', respond: RESPONSES.hold, times: 100 });
    const def = h.createDefinition({ providers: { discovery: ['fixture', 'travelpayouts'], verification: [], discoveryRefreshHours: {} } });
    const r = await orch().start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const cells = generateCells({ origins: [LHR], destinations: [JFK], departureFrom: asIsoDate('2026-11-02'), departureTo: asIsoDate('2026-11-04'), minNights: 7, maxNights: 8 });
    await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(0));
    const fixtureRows = h.outcomes(r.executionId, { stage: 'discovery', providerId: 'fixture' });
    expect(fixtureRows.map(cellKeyString).sort()).toEqual(cells.map(cellKeyString).sort());
    expect(fixtureRows.every((o) => o.status === 'not_run' && o.attempts === 0)).toBe(true);
    expect(h.outcomes(r.executionId, { stage: 'verification' })).toHaveLength(0);
    h.releaseHolds();
    await h.waitForSettled(r.executionId);
    const rollUps = h.repos.cells.rollUps(r.executionId);
    expect(rollUps.size).toBe(6);
    for (const v of rollUps.values()) expect(v.verification.status).toBeNull(); // spec §6.6 row 0: NULL / not_applicable
    expect(h.outcomes(r.executionId, { stage: 'discovery', providerId: 'travelpayouts' }).every((o) => o.status === 'no_data')).toBe(true);
  });

  it('freezes a relative window at start in Europe/London', async () => {
    h = createHarness();
    const def = h.createDefinition({ window: { kind: 'relative', startOffsetDays: 7, lengthDays: 2 } });
    const e = await h.runToCompletion(orch(), def.id);
    const w = resolveWindow(def.window, h.clock.todayLondon()); // WP1 owns the inclusive-end rule; compare with it
    expect(e.snapshot.resolved).toMatchObject({ departureFrom: w.departureFrom, departureTo: w.departureTo });
    expect(e.snapshot.resolved.departureFrom).toBe('2026-10-21'); // 2026-10-14 + 7 days
    expect(e.snapshot.resolvedAt).toBe(h.clock.now());
    h.clock.advance(3 * 86_400_000);
    h.repos.definitions.update(def.id, { window: { kind: 'relative', startOffsetDays: 30, lengthDays: 5 } });
    expect(h.repos.executions.get(e.id)?.snapshot.resolved).toEqual(e.snapshot.resolved); // frozen
  });

  it('drops alwaysInclude cells that slid out of a relative window, with a note, not an error (spec §6.1)', async () => {
    h = createHarness();
    const inside = { origin: LHR, destination: JFK, departureDate: asIsoDate('2026-10-21'), returnDate: asIsoDate('2026-10-28') };
    const slid = { origin: LHR, destination: JFK, departureDate: asIsoDate('2026-10-20'), returnDate: asIsoDate('2026-10-27') };
    const def = h.createDefinition({ window: { kind: 'relative', startOffsetDays: 7, lengthDays: 2 }, verification: { maxCells: 2, topN: 2, alwaysInclude: [inside, slid], expandTop: 1, bookingLinks: true } });
    const e = await h.runToCompletion(orch(), def.id);
    expect(e.snapshot.verification.alwaysInclude).toEqual([inside]);
    expect(h.logs.some((l) => l.msg === 'execution: started' && (l.fields.notes as string[]).includes('alwaysInclude: 1 cell left the window and was dropped'))).toBe(true);
  });

  it('a scheduled start leaves out providers excluded from the schedule (the SearchApi trial rule, spec §8.2)', async () => {
    h = createHarness({ fixtureExcludedFromSchedule: true, extraProviders: (t) => [freeStubProvider(t)] });
    const def = h.createDefinition({ providers: { discovery: ['fixture', 'travelpayouts'], verification: [], discoveryRefreshHours: {} } });
    const e = await h.runToCompletion(orch(), def.id, { trigger: 'schedule' });
    expect(e.snapshot.providers.discovery).toEqual(['travelpayouts']);
    expect(h.outcomes(e.id, { providerId: 'fixture' })).toHaveLength(0);
  });
});

describe('Review Focus 4: a PUT during a run does not change the running execution', () => {
  it('keeps the snapshot and the plan of the running execution after the definition is edited', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal === 1, respond: RESPONSES.hold });
    const plan = vi.spyOn(discoveryOf(h.fixture), 'plan');
    const def = h.createDefinition();
    const r = await orch().start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.length).toBe(1));
    h.repos.definitions.update(def.id, { origins: [LGW], minNights: 9, maxNights: 9, cabin: 'business' });
    h.releaseHolds();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('completed');
    expect(e.snapshot.origins).toEqual([LHR]);
    expect(e.snapshot.cabin).toBe('economy');
    const all = h.outcomes(r.executionId);
    expect(all.every((o) => o.origin === LHR)).toBe(true);
    expect(new Set(all.map((o) => o.returnDate)).size).toBeGreaterThan(1); // still the 7–8 night band
    expect(plan.mock.calls.every(([q]) => q.origin === LHR && q.minNights === 7 && q.maxNights === 8 && q.cabin === 'economy')).toBe(true);
    expect(h.repos.definitions.get(def.id)?.origins).toEqual([LGW]); // the edit itself was stored
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine test -- seeding`
Expected: FAIL. "drops alwaysInclude cells…" fails (`alwaysInclude` still holds both cells) and "a scheduled start leaves out providers…" fails (`['fixture', 'travelpayouts']`); the other three pass, which is expected: Task 7.1 already seeds and snapshots, and they pin that behaviour.

- [ ] **Step 3: Implement**

`src/snapshot.ts` — replace the file:

```ts
import { type Cell, type DefinitionSnapshot, type ProviderId, type ResolvedSpace, type SearchDefinition, cellKeyString, generateCells, resolveWindow } from '@gmt/core';
import type { EngineContext } from './context.js';

export interface BuiltSnapshot { snapshot: DefinitionSnapshot; cells: Cell[]; notes: string[] }
export type Trigger = 'manual' | 'schedule';

/**
 * Resolves the window in Europe/London and freezes the definition into an execution snapshot
 * (spec §6.1 "frozen into the execution snapshot", §8.1 "start: snapshot"). The snapshot is read
 * once; nothing a later PUT does reaches a running pass (Review Focus 4).
 *
 * - providers: only those registered with the capability; a scheduled run also leaves out a
 *   provider marked excludedFromSchedule (spec §8.2 "scheduled runs exclude SearchApi on trial");
 * - alwaysInclude: members that slid out of a relative window are dropped with a note (spec §6.1).
 */
export function buildSnapshot(ctx: EngineContext, def: SearchDefinition, trigger: Trigger = 'manual'): BuiltSnapshot {
  const notes: string[] = [];
  const w = resolveWindow(def.window, ctx.clock.todayLondon());
  if (w.clamped) notes.push('window clamped to start tomorrow');
  const resolved: ResolvedSpace = { origins: def.origins, destinations: def.destinations, departureFrom: w.departureFrom, departureTo: w.departureTo, minNights: def.minNights, maxNights: def.maxNights };
  const cells = w.departureFrom > w.departureTo ? [] : generateCells(resolved);
  const inSpace = new Set(cells.map(cellKeyString));
  const kept = def.verification.alwaysInclude.filter((c) => inSpace.has(cellKeyString(c)));
  const dropped = def.verification.alwaysInclude.length - kept.length;
  if (dropped > 0) notes.push(`alwaysInclude: ${dropped} ${dropped === 1 ? 'cell left the window and was dropped' : 'cells left the window and were dropped'}`);
  const usable = (id: ProviderId, capability: 'discovery' | 'verification'): boolean => {
    if (ctx.providers.get(id)?.[capability] === undefined) {
      notes.push(`${id} is not configured; left out of ${capability}`);
      return false;
    }
    if (trigger === 'schedule' && ctx.limitsOf(id).excludedFromSchedule) {
      notes.push(`${id} is excluded from scheduled runs on its plan`);
      return false;
    }
    return true;
  };
  const snapshot: DefinitionSnapshot = {
    ...def,
    verification: { ...def.verification, alwaysInclude: kept },
    providers: {
      ...def.providers,
      discovery: def.providers.discovery.filter((id) => usable(id, 'discovery')),
      verification: def.providers.verification.filter((id) => usable(id, 'verification')),
    },
    resolved,
    resolvedAt: ctx.clock.now(),
    windowClamped: w.clamped,
  };
  return { snapshot, cells, notes };
}
```

`src/start.ts` — in `startExecution`, replace `const built = buildSnapshot(ctx, def);` with `const built = buildSnapshot(ctx, def, opts.trigger);` and the start log line with:

```ts
  run.log.info({ trigger: opts.trigger, cells: built.cells.length, notes: built.notes }, 'execution: started');
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine test -- seeding resume-k-of-n`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: frozen snapshot with schedule exclusion and alwaysInclude drop; seeding tests; review focus 4

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.4: The §8.1 error table in the discovery stage, and cancel

**Files:**
- Create: `packages/engine/src/errors.ts`, `test/errors.test.ts`, `test/error-table-discovery.test.ts`
- Modify: `packages/engine/src/run.ts` (`onFailure`, new `disableProvider`), `src/orchestrator.ts` (`cancel`)

**Interfaces:**
- Consumes: `ProviderError`, `BudgetExceeded`, `AbortedError`, `CellsRepo.setOutcome`.
- Produces: `classifyFailure(err, aborted, now): FailureDecision`, `addSeconds(at, s)`, `disableProvider(run, providerId, why)`, `Orchestrator.cancel(executionId): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/errors.test.ts`:

```ts
import { AbortedError, BudgetExceeded, ProviderError, asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { classifyFailure } from '../src/errors.js';

const now = asIsoDateTime('2026-10-14T09:00:00.000Z');
const pe = (kind: ProviderError['kind'], extra: { reason?: string; retryAfterSeconds?: number } = {}) => new ProviderError({ kind, retryable: false, message: `${kind} at https://u:p@fixture.local/calendar?origin=LHR`, ...extra });
const budget = new BudgetExceeded({ scope: 'execution-calls', cap: 10, current: 10, requested: 1 });

describe('classifyFailure (spec §8.1 error table, both stages)', () => {
  it.each([
    ['AbortedError → abort', new AbortedError(), false, { kind: 'abort' }],
    ['anything after the signal aborted → abort', pe('network'), true, { kind: 'abort' }],
    ['BudgetExceeded → budget, never a cell error', budget, false, { kind: 'budget', error: budget }],
    ['limiter-timeout with Retry-After → resume at now + Retry-After', pe('limiter-timeout', { retryAfterSeconds: 4000 }), false, { kind: 'limiter-timeout', resumeAfter: '2026-10-14T10:06:40.000Z' }],
    ['limiter-timeout without Retry-After → resume after an hourly window', pe('limiter-timeout'), false, { kind: 'limiter-timeout', resumeAfter: '2026-10-14T10:00:00.000Z' }],
    ['auth → error, disables the provider', pe('auth'), false, { kind: 'cell-error', reason: 'auth', parse: false, disableProvider: true }],
    ['quota → error, disables the provider', pe('quota'), false, { kind: 'cell-error', reason: 'quota', parse: false, disableProvider: true }],
    ['parse keeps reason "parse" and moves the vendor message to lastError', pe('parse', { reason: 'Requested more than 200 combinations.' }), false, { kind: 'cell-error', reason: 'parse', lastError: 'Requested more than 200 combinations.', parse: true, disableProvider: false }],
    ['upstream no-return-legs keeps its reason', pe('upstream', { reason: 'no-return-legs' }), false, { kind: 'cell-error', reason: 'no-return-legs', parse: false, disableProvider: false }],
    ['rate-limit → error', pe('rate-limit'), false, { kind: 'cell-error', reason: 'rate-limit', lastError: 'rate-limit at https://fixture.local/calendar' }],
    ['network → error', pe('network'), false, { kind: 'cell-error', reason: 'network' }],
    ['upstream → error', pe('upstream'), false, { kind: 'cell-error', reason: 'upstream' }],
    ['an Error from a repository → fatal with a URL-free message', new Error('database or disk is full near https://x.example/a?b=c'), false, { kind: 'fatal', message: 'database or disk is full near https://x.example/a' }],
    ['a thrown non-Error → fatal', 'weird', false, { kind: 'fatal', message: 'weird' }],
  ] as const)('%s', (_name, err, aborted, expected) => {
    expect(classifyFailure(err, aborted, now)).toMatchObject(expected);
  });
});
```

`packages/engine/test/error-table-discovery.test.ts`:

```ts
import { type CellKey, type OperatorMessage, asIsoDate, cellKeyString, generateCells } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { addSeconds } from '../src/errors.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, type InjectedResponse, JFK, LGW, LHR, RESPONSES, T0, createHarness, discoveryOf } from './harness.js';
import { freeStubProvider } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const twoPairs = () => h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] });
const kinds = () => h.notifications.filter((m): m is OperatorMessage => 'kind' in m).map((m) => m.kind);

/** The fixture's own tiles for the first pair (LHR → JFK), in plan order: what the 1st, 2nd … calendar request covers at concurrency 1. */
function firstPairTiles(): CellKey[][] {
  const departureFrom = asIsoDate('2026-11-02');
  const departureTo = asIsoDate('2026-11-04');
  const cells = generateCells({ origins: [LHR], destinations: [JFK], departureFrom, departureTo, minNights: 7, maxNights: 8 });
  return discoveryOf(h.fixture).plan({ origin: LHR, destination: JFK, departureFrom, departureTo, minNights: 7, maxNights: 8, cabin: 'economy', currency: 'GBP', cells }).map((t) => t.coveredCells);
}
const keys = (cells: readonly CellKey[]) => cells.map(cellKeyString).sort();

async function run(scenarios: Array<{ match: (r: { kind: string; ordinal: number }) => boolean; respond: InjectedResponse; times?: number }>, opts: Parameters<typeof createHarness>[0] = {}) {
  h = createHarness({ fixtureConcurrency: 1, ...opts });
  for (const s of scenarios) h.scenario(s);
  const ctx = buildContext(h.deps, h.options);
  const scheduleResume = vi.fn();
  ctx.hooks.scheduleResume = scheduleResume;
  const def = opts.extraProviders ? h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], providers: { discovery: ['fixture', 'travelpayouts'], verification: [], discoveryRefreshHours: {} } }) : twoPairs();
  const e = await h.runToCompletion(createOrchestrator(ctx), def.id);
  return { e, scheduleResume };
}
const calendar = (from: number, to = from) => (r: { kind: string; ordinal: number }) => r.kind === 'calendar' && r.ordinal >= from && r.ordinal <= to;

describe('error table, discovery stage: retryable kinds after retries (cell error, attempts+1, continue)', () => {
  it.each([
    ['rate-limit', RESPONSES.rateLimit, 3],
    ['upstream', RESPONSES.upstream, 3],
    ['network', RESPONSES.network, 3],
  ] as const)('%s', async (reason, respond, times) => {
    const { e } = await run([{ match: calendar(1, 3), respond, times }]);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { stage: 'discovery', status: 'error' });
    expect(keys(errors)).toEqual(keys(firstPairTiles()[0] ?? []));
    expect(errors.every((o) => o.reason === reason && o.attempts === 1 && o.lastError !== null && !o.lastError.includes('?'))).toBe(true);
    expect(h.outcomes(e.id, { stage: 'discovery', status: 'not_run' })).toHaveLength(0);
  });
});

describe('error table, discovery stage: non-retryable kinds', () => {
  it.each([
    ['parse (HTTP 400 with the vendor message)', RESPONSES.badRequest, 'parse'],
    ['parse (malformed 200 body)', RESPONSES.malformed, 'parse'],
    ['upstream (HTTP 404)', { status: 404, json: { error: 'Not found.' } } as const, 'upstream'],
  ] as const)('%s → error once, the run continues', async (_n, respond, reason) => {
    const { e } = await run([{ match: calendar(1), respond }]);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { stage: 'discovery', status: 'error' });
    expect(keys(errors)).toEqual(keys(firstPairTiles()[0] ?? []));
    expect(errors.every((o) => o.reason === reason && o.attempts === 1)).toBe(true);
  });

  it('tile-error marks exactly its own cells (the second tile)', async () => {
    const { e } = await run([{ match: calendar(2, 4), respond: RESPONSES.upstream, times: 3 }]);
    expect(keys(h.outcomes(e.id, { stage: 'discovery', status: 'error' }))).toEqual(keys(firstPairTiles()[1] ?? []));
  });

  it('two consecutive parse errors disable the provider: remaining cells skipped:provider_disabled, paused_error, notified', async () => {
    const { e } = await run([{ match: calendar(1, 2), respond: RESPONSES.badRequest, times: 2 }]);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBeNull();
    expect(h.outcomes(e.id, { status: 'error' }).every((o) => o.reason === 'parse')).toBe(true);
    const skipped = h.outcomes(e.id, { status: 'skipped' });
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((o) => o.reason === 'provider_disabled')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    expect(kinds()).toEqual(['provider_disabled', 'paused_error']);
  });

  it('a parse error, a success, then a parse error is not "two consecutive"', async () => {
    const { e } = await run([{ match: (r) => r.kind === 'calendar' && (r.ordinal === 1 || r.ordinal === 3), respond: RESPONSES.badRequest, times: 2 }]);
    expect(e.status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it.each([
    ['auth', RESPONSES.auth],
    ['quota', RESPONSES.quota],
  ] as const)('%s on any call disables the provider for the run; none remain → paused_error + notify', async (reason, respond) => {
    const { e } = await run([{ match: calendar(1), respond }]);
    expect(e.status).toBe('paused_error');
    expect(keys(h.outcomes(e.id, { status: 'error' }))).toEqual(keys(firstPairTiles()[0] ?? []));
    expect(h.outcomes(e.id, { status: 'error' }).every((o) => o.reason === reason)).toBe(true);
    expect(h.outcomes(e.id, { status: 'skipped' }).every((o) => o.reason === 'provider_disabled')).toBe(true);
    expect(kinds()).toEqual(['provider_disabled', 'paused_error']);
  });

  it('auth with another provider remaining: that provider continues and the run completes', async () => {
    const { e } = await run([{ match: calendar(1), respond: RESPONSES.auth }], { extraProviders: (t) => [freeStubProvider(t)] });
    expect(e.status).toBe('completed');
    expect(h.outcomes(e.id, { providerId: 'travelpayouts' }).every((o) => o.status === 'no_data')).toBe(true);
    expect(h.outcomes(e.id, { providerId: 'fixture', status: 'skipped' }).every((o) => o.reason === 'provider_disabled')).toBe(true);
    expect(kinds()).toEqual(['provider_disabled']);
  });

  it('limiter-timeout: the cells return to not_run; paused_error with resume_after; a one-shot job is requested', async () => {
    const { e, scheduleResume } = await run([{ match: calendar(1, 3), respond: RESPONSES.limiterTimeout, times: 3 }]);
    expect(e.status).toBe('paused_error');
    const at = addSeconds(T0, 4000);
    expect(e.resumeAfter).toBe(at);
    expect(scheduleResume).toHaveBeenCalledWith(e.id, at);
    expect(keys(h.outcomes(e.id, { status: 'not_run' }))).toEqual(expect.arrayContaining(keys(firstPairTiles()[0] ?? [])));
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(kinds()).toEqual(['paused_error']);
  });
});

describe('error table: AbortedError (cancel / SIGTERM) → not_run', () => {
  it('cancel mid-run: the held tile goes back to not_run and the execution is cancelled', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: calendar(2), respond: RESPONSES.hold });
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const def = twoPairs();
    const r = await orch.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.filter((q) => q.kind === 'calendar')).toHaveLength(2));
    const cancelling = orch.cancel(r.executionId);
    h.releaseHolds();
    expect(await cancelling).toBe(true);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('cancelled');
    const notRun = keys(h.outcomes(e.id, { status: 'not_run' }));
    expect(notRun).toEqual(expect.arrayContaining(keys(firstPairTiles()[1] ?? [])));
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(kinds()).toEqual([]);
  });

  it('cancel of an execution that is not running in this process marks it cancelled; of a finished one returns false', async () => {
    h = createHarness();
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const done = await h.runToCompletion(orch, h.createDefinition().id);
    expect(await orch.cancel(done.id)).toBe(false);
    h.repos.executions.setStatus(done.id, 'paused_error', { resumeAfter: null });
    expect(await orch.cancel(done.id)).toBe(true);
    expect(h.repos.executions.get(done.id)?.status).toBe('cancelled');
  });

  it('SIGTERM with a tile in flight: every cell stays not_run, status interrupted', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: calendar(1), respond: RESPONSES.hold });
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const r = await orch.start(h.createDefinition().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    const stopping = orch.shutdown();
    h.releaseHolds();
    await stopping;
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('interrupted');
    expect(h.outcomes(e.id).every((o) => o.status === 'not_run')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine test -- errors error-table-discovery`
Expected: FAIL, `Cannot find module '../src/errors.js'`.

- [ ] **Step 3: Implement**

`src/errors.ts`:

```ts
import { AbortedError, BudgetExceeded, type IsoDateTime, ProviderError, stripUrlsInText } from '@gmt/core';

/** What the engine does with one failed tile or cell call (spec §8.1 error table, both stages). */
export type FailureDecision =
  | { kind: 'abort' }
  | { kind: 'cell-error'; reason: string; lastError: string; parse: boolean; disableProvider: boolean }
  | { kind: 'limiter-timeout'; resumeAfter: IsoDateTime }
  | { kind: 'budget'; error: BudgetExceeded }
  | { kind: 'fatal'; message: string };

/** When a limiter-timeout carries no Retry-After, the window is assumed to reopen within the hourly reservoir. */
export const DEFAULT_REOPEN_SECONDS = 3600;

export function addSeconds(at: IsoDateTime, seconds: number): IsoDateTime {
  return new Date(Date.parse(at) + seconds * 1000).toISOString() as IsoDateTime;
}

/**
 * Pure classification. Order matters: an abort wins over whatever error it caused; a budget breach
 * is never a cell error (spec §8.1 "BudgetExceeded is never recorded as error").
 *
 * The stored `reason` is the error kind, except `no-return-legs`, so the spec §7 resume query can
 * exclude `parse` and friends by reason; the vendor's message (e.g. a 400's text) goes to
 * `last_error`, URL-free.
 */
export function classifyFailure(err: unknown, aborted: boolean, now: IsoDateTime): FailureDecision {
  if (err instanceof AbortedError || aborted) return { kind: 'abort' };
  if (err instanceof BudgetExceeded) return { kind: 'budget', error: err };
  if (err instanceof ProviderError) {
    if (err.kind === 'limiter-timeout') return { kind: 'limiter-timeout', resumeAfter: addSeconds(now, err.retryAfterSeconds ?? DEFAULT_REOPEN_SECONDS) };
    const reason = err.kind === 'upstream' && err.reason === 'no-return-legs' ? 'no-return-legs' : err.kind;
    return {
      kind: 'cell-error',
      reason,
      lastError: stripUrlsInText(err.reason ?? err.message),
      parse: err.kind === 'parse',
      disableProvider: err.kind === 'auth' || err.kind === 'quota',
    };
  }
  return { kind: 'fatal', message: stripUrlsInText(err instanceof Error ? err.message : String(err)) };
}
```

`src/run.ts`: replace `onFailure` with the following, add `disableProvider`, and import `classifyFailure` from `./errors.js` (drop the now-unused `AbortedError` import):

```ts
/**
 * Applies the spec §8.1 error table to one failed tile (discovery) or cell (verification) call.
 * The cells of the call are `cells`; nothing has been written for them yet.
 */
export function onFailure(ctx: EngineContext, run: RunState, providerId: ProviderId, stage: Stage, cells: readonly CellKey[], err: unknown, signal: AbortSignal): void {
  const d = classifyFailure(err, signal.aborted, ctx.clock.now());
  const log = run.log.child({ providerId });
  switch (d.kind) {
    case 'abort':
      return; // why: spec §3 "a cell interrupted mid-flight returns to not_run" — nothing was written, so it still is
    case 'cell-error': {
      ctx.db.transaction(() => {
        for (const cell of cells) ctx.repos.cells.setOutcome(run.executionId, cell, stage, providerId, { status: 'error', reason: d.reason, lastError: d.lastError, attemptsDelta: 1 });
      });
      // why: spec §8.1 "2 consecutive [parse errors] for one provider (counted in ledger finalisation order)";
      // calls settle in finalisation order, and any other outcome breaks the streak
      const streak = d.parse ? (run.parseStreak.get(providerId) ?? 0) + 1 : 0;
      run.parseStreak.set(providerId, streak);
      log.warn({ stage, reason: d.reason, cells: cells.length, parseStreak: streak }, 'cells marked error');
      if (d.disableProvider) disableProvider(run, providerId, `an ${d.reason} error`);
      else if (streak >= 2) disableProvider(run, providerId, 'two consecutive parse errors');
      return;
    }
    case 'limiter-timeout':
      log.warn({ stage, resumeAfter: d.resumeAfter }, 'limiter deadline passed; pausing');
      stopRun(run, { kind: 'limiter-timeout', resumeAfter: d.resumeAfter });
      return;
    case 'budget':
      // Task 7.10 replaces this case with applyBudgetBreach (per-scope rows of the table).
      stopRun(run, { kind: 'budget', error: d.error, resumeAfter: null });
      return;
    case 'fatal':
      log.error({ stage, err: d.message }, 'unexpected failure; pausing');
      stopRun(run, { kind: 'fatal', message: d.message });
      return;
  }
}

/** Spec §8.1: "provider disabled for the run" — its lanes abort; stage runners mark its remaining cells skipped:provider_disabled. */
export function disableProvider(run: RunState, providerId: ProviderId, why: string): void {
  if (run.disabled.has(providerId)) return;
  run.disabled.add(providerId);
  for (const [key, lane] of run.lanes) if (key.endsWith(`|${providerId}`)) lane.controller.abort();
  run.notices.push({ kind: 'provider_disabled', detail: `${providerId} was disabled for this run after ${why}; its remaining cells are skipped (provider disabled).` });
  run.log.warn({ providerId, why }, 'provider disabled for the run');
}
```

`src/orchestrator.ts`: add to the interface

```ts
  /** Spec §8.1 AbortedError row: cells in flight → not_run, status cancelled. False when there is nothing to cancel. */
  cancel(executionId: string): Promise<boolean>;
```

and to the returned object (importing `ACTIVE_STATUSES` from `@gmt/core`):

```ts
    cancel: async (id) => {
      const live = reg.get(id);
      if (live !== undefined) {
        stopRun(live, { kind: 'cancel' });
        await reg.done(id);
        return true;
      }
      const exec = ctx.repos.executions.get(id);
      if (exec === null || !ACTIVE_STATUSES.includes(exec.status)) return false;
      ctx.hooks.cancelResume(id); // why: spec §8.1 one-shot job "cancelled on cancel"
      ctx.repos.executions.setStatus(id, 'cancelled', { finishedAt: ctx.clock.now(), resumeAfter: null });
      return true;
    },
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine test -- errors error-table-discovery`
Expected: PASS, 30 tests (14 in `errors.test.ts`, 16 in `error-table-discovery.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: discovery-stage error table, provider disable, limiter pause, cancel

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.5: Calendar normalisation — FX, ECB currencies, one price per cell

**Files:**
- Create: `packages/engine/test/normalise-calendar.test.ts`
- Modify: `packages/engine/src/normalise.ts` (`toMoney`, `reduceTile`, `FX_SOURCE`), `src/stages/discovery.ts` (`commitTile` mixed-currency guard)

**Interfaces:**
- Consumes: `FxRepo.latest/upsert`, `toGbp`, `ECB_CURRENCIES`, `MINOR_EXPONENT`, `validateVendorUrl`.
- Produces: `toMoney` for every ECB currency, `ReducedTile` with `'mixed-currency'`, `FX_SOURCE`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/normalise-calendar.test.ts`:

```ts
import { NormalisationError, type RawCalendarPrice, asIsoDate, cellKeyString, toGbp } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { FX_SOURCE, LINK_ALLOWLIST, reduceTile, toMoney, vendorLinkOf } from '../src/normalise.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { newRun } from '../src/run.js';
import { commitTile, normaliseDeps } from '../src/stages/discovery.js';
import { type Harness, JFK, LHR, createHarness, discoveryOf } from './harness.js';
import { mapPrices } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const USD_NANO = 787_401_575; // 1 / 1.27 GBP per USD × 1e9
const cell = { origin: LHR, destination: JFK, departureDate: asIsoDate('2026-11-02'), returnDate: asIsoDate('2026-11-09') };
const price = (amountMinor: number, currency = 'GBP'): RawCalendarPrice => ({ ...cell, amountMinor, currency });

describe('toMoney (spec §5.6 money, §6.3)', () => {
  it('GBP passes through unconverted', () => {
    h = createHarness();
    expect(toMoney(normaliseDeps(buildContext(h.deps, h.options)), 41_200, 'gbp')).toEqual({ pricePence: 41_200, priceNativeMinor: 41_200, currencyNative: 'GBP', fx: { converted: false } });
  });
  it('an ECB currency with a fresh rate converts with toGbp and records rate, date and source together', () => {
    h = createHarness();
    h.repos.fx.upsert([{ date: h.clock.todayLondon(), currency: 'USD', rateNano: USD_NANO }]);
    expect(toMoney(normaliseDeps(buildContext(h.deps, h.options)), 52_000, 'USD')).toEqual({
      pricePence: toGbp(52_000, 'USD', USD_NANO), priceNativeMinor: 52_000, currencyNative: 'USD',
      fx: { converted: true, rateNano: USD_NANO, rateDate: h.clock.todayLondon(), source: FX_SOURCE },
    });
  });
  it('no rate within FX_MAX_RATE_AGE_DAYS → fx-unavailable', () => {
    h = createHarness();
    h.repos.fx.upsert([{ date: asIsoDate('2026-10-10'), currency: 'USD', rateNano: USD_NANO }]); // 4 days old, limit 3
    const r = toMoney(normaliseDeps(buildContext(h.deps, h.options)), 52_000, 'USD');
    expect(r).toBeInstanceOf(NormalisationError);
    expect((r as NormalisationError).reason).toBe('fx-unavailable');
  });
  it('a currency outside the ECB list → currency-unsupported', () => {
    h = createHarness();
    const r = toMoney(normaliseDeps(buildContext(h.deps, h.options)), 52_000, 'ARS');
    expect((r as NormalisationError).reason).toBe('currency-unsupported');
  });
});

describe('reduceTile (spec §5.6 "one calendar price per tile … minimum amountMinor, tie-break on vendor order")', () => {
  it('keeps the minimum, keeps the earlier of equal prices, and counts discards', () => {
    const a = price(500);
    const b = price(400);
    const c = { ...price(400), vendorLink: 'later' };
    const r = reduceTile([a, b, c]);
    expect(r).toMatchObject({ kind: 'ok', discarded: 2 });
    if (r.kind === 'ok') expect(r.perCell.get(cellKeyString(cell))).toBe(b);
  });
  it('two currencies in one tile is reported, not reduced', () => {
    expect(reduceTile([price(500, 'GBP'), price(600, 'usd')])).toEqual({ kind: 'mixed-currency', currencies: ['GBP', 'USD'] });
  });
});

describe('vendorLinkOf (spec §5.2 vendor links)', () => {
  it('keeps only https links on the provider allowlist', () => {
    expect(LINK_ALLOWLIST.fixture).toEqual([]);
    expect(vendorLinkOf('https://www.aviasales.com/search/LHR0211JFK09111', 'travelpayouts')).toBe('https://www.aviasales.com/search/LHR0211JFK09111');
    expect(vendorLinkOf('http://www.aviasales.com/x', 'travelpayouts')).toBeNull();
    expect(vendorLinkOf('https://evil.example/x', 'travelpayouts')).toBeNull();
    expect(vendorLinkOf('https://www.google.com/travel/flights', 'fixture')).toBeNull();
    expect(vendorLinkOf(undefined, 'searchapi')).toBeNull();
  });
});

describe('discovery normalisation through the engine', () => {
  it('every price in USD with no rate → each priced cell becomes error fx-unavailable; no price row is written', async () => {
    h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), h.createDefinition().id);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((o) => o.reason === 'fx-unavailable')).toBe(true);
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(0);
    expect((h.db.raw.prepare('SELECT count(*) AS n FROM calendar_prices WHERE execution_id = ?').get(e.id) as { n: number }).n).toBe(0);
  });

  it('with a fresh USD rate the same prices are stored converted, with fx columns set together', async () => {
    h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    h.repos.fx.upsert([{ date: h.clock.todayLondon(), currency: 'USD', rateNano: USD_NANO }]);
    const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), h.createDefinition().id);
    const rows = h.db.raw.prepare('SELECT price_pence AS p, price_native_minor AS n, currency_native AS c, fx_converted AS fc, fx_rate_nano AS r, fx_rate_date AS d, fx_source AS s FROM calendar_prices WHERE execution_id = ?').all(e.id) as Array<{ p: number; n: number; c: string; fc: number; r: number; d: string; s: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toEqual({ p: toGbp(row.n, 'USD', USD_NANO), n: row.n, c: 'USD', fc: 1, r: USD_NANO, d: h.clock.todayLondon(), s: FX_SOURCE });
    expect(h.outcomes(e.id, { status: 'priced' }).every((o) => o.minPence !== null)).toBe(true);
  });

  it('a currency outside the ECB list → error currency-unsupported', async () => {
    h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'ARS' })) });
    const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), h.createDefinition().id);
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((o) => o.reason === 'currency-unsupported')).toBe(true);
  });

  it('a tile mixing two currencies is a parse error for its cells', async () => {
    h = createHarness();
    const done = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), h.createDefinition().id);
    const ctx = buildContext(h.deps, h.options);
    const run = newRun(ctx, done, { manual: true, fresh: false, blocked: new Set() });
    commitTile(ctx, run, 'fixture', discoveryOf(h.fixture).info, {
      kind: 'tile', index: 0, coveredCells: [cell], fetchedAt: h.clock.now(), prices: [price(500, 'GBP'), price(600, 'USD')], noFares: [], notes: [],
    });
    const o = h.outcomes(done.id, { stage: 'discovery', providerId: 'fixture' }).find((x) => cellKeyString(x) === cellKeyString(cell));
    expect(o).toMatchObject({ status: 'error', reason: 'parse' });
    expect(o?.lastError).toContain('mixed currencies: GBP, USD');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine test -- normalise-calendar`
Expected: FAIL: `FX_SOURCE` is not exported; the USD conversion and mixed-currency tests fail.

- [ ] **Step 3: Implement**

`src/normalise.ts`: replace `toMoney` and `reduceTile`, add `FX_SOURCE`, and import `ECB_CURRENCIES`, `MINOR_EXPONENT`, `toGbp` from `@gmt/core`:

```ts
/** Stored in fx_source; the rate itself comes from FxRepo, refreshed daily by src/fx/refresh.ts. */
export const FX_SOURCE = 'frankfurter.dev (ECB reference rates)';

/**
 * Spec §5.6 money: GBP passes through; any other currency must be ECB-covered (spec §5.6
 * "ECB-covered currencies only") and have a rate no older than FX_MAX_RATE_AGE_DAYS, else the
 * price cannot be stored. Conversion is core's toGbp (integer nano rate, half-up to the penny).
 */
export function toMoney(deps: NormaliseDeps, amountMinor: number, currency: string): Money | NormalisationError {
  const c = currency.toUpperCase();
  if (c === 'GBP') return { pricePence: amountMinor, priceNativeMinor: amountMinor, currencyNative: 'GBP', fx: { converted: false } };
  // why: without an ISO 4217 exponent the native minor units cannot be interpreted, so the currency is unsupported as well
  if (!ECB_CURRENCIES.includes(c) || MINOR_EXPONENT[c] === undefined) return new NormalisationError('currency-unsupported', c);
  const rate = deps.fx.latest(c, deps.fxMaxRateAgeDays, deps.clock.todayLondon());
  if (rate === null) return new NormalisationError('fx-unavailable', `${c}: no ECB rate in the last ${deps.fxMaxRateAgeDays} days`);
  const fx: FxInfo = { converted: true, rateNano: rate.rateNano, rateDate: rate.date, source: FX_SOURCE };
  return { pricePence: toGbp(amountMinor, c, rate.rateNano), priceNativeMinor: amountMinor, currencyNative: c, fx };
}

export type ReducedTile = { kind: 'ok'; perCell: Map<string, RawCalendarPrice>; discarded: number } | { kind: 'mixed-currency'; currencies: string[] };

/**
 * Spec §5.6: one calendar price per (provider, cell) per tile — the minimum amountMinor, ties to
 * vendor order; discards counted. amountMinor is only comparable within one currency, and a vendor
 * answers one request in one currency (spec §2), so a tile with two currencies is reported instead.
 */
export function reduceTile(prices: readonly RawCalendarPrice[]): ReducedTile {
  const currencies = [...new Set(prices.map((p) => p.currency.toUpperCase()))].sort();
  if (currencies.length > 1) return { kind: 'mixed-currency', currencies };
  const perCell = new Map<string, RawCalendarPrice>();
  let discarded = 0;
  for (const p of prices) {
    const key = cellKeyString(p);
    const kept = perCell.get(key);
    if (kept === undefined) perCell.set(key, p);
    else {
      discarded += 1;
      if (p.amountMinor < kept.amountMinor) perCell.set(key, p); // strict: an equal later price loses to the earlier one
    }
  }
  return { kind: 'ok', perCell, discarded };
}
```

and drop the `_deps` underscore (the parameter is now `deps`).

`src/stages/discovery.ts`: at the top of `commitTile`, after `const reduced = reduceTile(result.prices);`, insert (importing `ProviderError` from `@gmt/core`):

```ts
  if (reduced.kind === 'mixed-currency') {
    // why: two currencies in one response means it was misread; treat it as the vendor-shape error it is
    const err = new ProviderError({ kind: 'parse', retryable: false, providerId, message: `tile ${result.index} mixed currencies: ${reduced.currencies.join(', ')}` });
    onFailure(ctx, run, providerId, 'discovery', result.coveredCells, err, laneFor(run, 'discovery', providerId).signal);
    return;
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine test -- normalise-calendar`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: calendar normalisation with ECB FX, currency checks, one price per cell

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.6: FX refresh through http-kit (`fx`, never billable)

**Files:**
- Create: `packages/engine/src/fx/refresh.ts`, `test/fx-refresh.test.ts`

**Interfaces:**
- Consumes: `HttpKit.request` with `providerId: 'fx'`, `FxRepo.upsert`, `ECB_CURRENCIES`, `asIsoDate`.
- Produces: `FRANKFURTER_LATEST_URL`, `parseFrankfurter(body)`, `refreshFx(ctx, signal): Promise<{ date: IsoDate; stored: number }>`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/fx-refresh.test.ts`:

```ts
import { ProviderError, asIsoDate } from '@gmt/core';
import { HttpResponse, http as mswHttp } from 'msw/http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { FRANKFURTER_LATEST_URL, parseFrankfurter, refreshFx } from '../src/fx/refresh.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, createHarness } from './harness.js';
import { mapPrices } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const body = { amount: 1, base: 'GBP', date: '2026-10-14', rates: { USD: 1.27, JPY: 190.5, XAU: 0.0004 } };

describe('FX refresh (spec §5.3 "FX refresh goes through http-kit under the id fx", §5.6)', () => {
  it('fetches the latest GBP rates, stores GBP-per-unit × 1e9 for ECB currencies only, ledgered never-billable', async () => {
    h = createHarness();
    let seenUrl = '';
    h.server.use(
      mswHttp.get('https://api.frankfurter.dev/v1/latest', ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(body);
      }),
    );
    const r = await refreshFx(buildContext(h.deps, h.options), new AbortController().signal);
    expect(r).toEqual({ date: '2026-10-14', stored: 2 });
    expect(seenUrl).toBe(FRANKFURTER_LATEST_URL);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'USD')).toBe(787_401_575);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'JPY')).toBe(5_249_344);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'XAU')).toBeNull();
    const ledger = h.db.raw.prepare(`SELECT endpoint_path AS p, billable AS b, outcome AS o, cost_micro_gbp AS c FROM provider_requests WHERE provider_id = 'fx'`).all();
    expect(ledger).toEqual([{ p: '/v1/latest', b: 0, o: 'ok', c: 0 }]);
  });

  it.each([
    ['another base', { ...body, base: 'EUR' }],
    ['no rates', { amount: 1, base: 'GBP', date: '2026-10-14' }],
    ['a bad date', { ...body, date: '14/10/2026' }],
    ['a non-positive rate', { ...body, rates: { USD: 0 } }],
  ])('rejects %s as a parse error and stores nothing', async (_n, bad) => {
    expect(parseFrankfurter(bad)).toBeInstanceOf(ProviderError);
    h = createHarness();
    h.server.use(mswHttp.get('https://api.frankfurter.dev/v1/latest', () => HttpResponse.json(bad)));
    await expect(refreshFx(buildContext(h.deps, h.options), new AbortController().signal)).rejects.toMatchObject({ kind: 'parse' });
    expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())).toBeNull();
  });

  it('after a refresh, USD calendar prices convert instead of failing fx-unavailable', async () => {
    h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    h.server.use(mswHttp.get('https://api.frankfurter.dev/v1/latest', () => HttpResponse.json(body)));
    await refreshFx(buildContext(h.deps, h.options), new AbortController().signal);
    const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), h.createDefinition().id);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'priced' }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- fx-refresh`
Expected: FAIL, `Cannot find module '../src/fx/refresh.js'`.

- [ ] **Step 3: Implement**

`src/fx/refresh.ts`:

```ts
import { ECB_CURRENCIES, type IsoDate, ProviderError, asIsoDate } from '@gmt/core';
import type { EngineContext } from '../context.js';

/**
 * frankfurter's latest ECB reference rates against GBP. Verified 2026-10-14: the `.app` host answers
 * 301 to this URL, and http-kit sends `redirect: 'error'`, so the engine calls `.dev/v1` directly
 * and the `fx` host allowlist is `api.frankfurter.dev`. Body: `{ amount, base, date, rates }` where
 * `rates[C]` is units of C per 1 GBP.
 */
export const FRANKFURTER_LATEST_URL = 'https://api.frankfurter.dev/v1/latest?from=GBP';

/** Validates the frankfurter body; anything else is a `parse` error (no rates stored). */
export function parseFrankfurter(body: unknown): { date: IsoDate; rates: Record<string, number> } | ProviderError {
  const bad = (why: string) => new ProviderError({ kind: 'parse', retryable: false, providerId: 'fx', message: `frankfurter: ${why}` });
  if (body === null || typeof body !== 'object') return bad('body is not an object');
  const b = body as { base?: unknown; date?: unknown; rates?: unknown };
  if (b.base !== 'GBP') return bad(`base is ${String(b.base)}, expected GBP`);
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return bad('date is not YYYY-MM-DD');
  if (b.rates === null || typeof b.rates !== 'object') return bad('rates missing');
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.rates)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return bad(`rate for ${k} is not a positive number`);
    rates[k] = v;
  }
  return { date: asIsoDate(b.date), rates };
}

/**
 * Daily FX refresh (spec §5.6 "refreshed daily"). Goes through http-kit under the never-billable id
 * `fx` (spec §5.3), so it is ledgered, host-allowlisted and redirect-refusing like every call.
 * Stores `fx_rate_nano` = GBP per 1 native unit × 1e9 for ECB currencies only (spec §6.3).
 */
export async function refreshFx(ctx: Pick<EngineContext, 'http' | 'repos' | 'log'>, signal: AbortSignal): Promise<{ date: IsoDate; stored: number }> {
  const res = await ctx.http.request({
    providerId: 'fx', executionId: null, tileIndex: null, endpointPath: '/v1/latest', method: 'GET',
    url: new URL(FRANKFURTER_LATEST_URL), headers: { accept: 'application/json' }, cache: 'never', signal, recordFixtures: false,
  });
  const parsed = parseFrankfurter(res.body);
  if (parsed instanceof ProviderError) throw parsed;
  const rows = ECB_CURRENCIES.filter((c) => c !== 'GBP' && parsed.rates[c] !== undefined).map((c) => ({
    date: parsed.date,
    currency: c,
    // why: the vendor gives units of C per GBP; the store wants GBP per unit of C, as an integer nano (spec §6.3)
    rateNano: Math.round(1e9 / (parsed.rates[c] as number)),
  }));
  ctx.repos.fx.upsert(rows);
  ctx.log.info({ fxDate: parsed.date, stored: rows.length }, 'fx: rates refreshed');
  return { date: parsed.date, stored: rows.length };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- fx-refresh`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: FX refresh from frankfurter through http-kit id fx

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.7: Reuse per cell with the 0.9 tolerance; supersede in the same transaction

**Files:**
- Create: `packages/engine/src/stages/reuse.ts`, `test/reuse.test.ts`
- Modify: `packages/engine/src/stages/discovery.ts` (`runDiscoveryProvider` calls `applyReuse`)

**Interfaces:**
- Consumes: `CalendarPricesRepo.reuseCandidates/copyReused/supersedeReused`, `ReusedCopy`, `CalendarPriceRow`.
- Produces: `DEFAULT_REFRESH_HOURS`, `REUSE_TOLERANCE`, `refreshHoursOf(snapshot, providerId)`, `reuseCutoff(now, hours)`, `reusableFor(ctx, definitionId, snapshot, providerId, info, cells)`, `applyReuse(ctx, run, providerId, info): number`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/reuse.test.ts`:

```ts
import { asIsoDate, asIsoDateTime, cellKeyString } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { newRun } from '../src/run.js';
import { commitTile, discoveryQuery } from '../src/stages/discovery.js';
import { reuseCutoff } from '../src/stages/reuse.js';
import { type Harness, JFK, LHR, RESPONSES, createHarness, discoveryOf, expectedTiles } from './harness.js';

let h: Harness;
afterEach(() => h.close());
const HOUR = 3_600_000;
const orch = () => createOrchestrator(buildContext(h.deps, h.options));
const priceRows = (executionId: string) =>
  h.db.raw
    .prepare('SELECT origin, destination, departure_date AS d, return_date AS r, fetched_at AS f, reused_from_execution_id AS ru FROM calendar_prices WHERE execution_id = ? ORDER BY d, r')
    .all(executionId) as Array<{ origin: string; destination: string; d: string; r: string; f: string; ru: string | null }>;

describe('reuseCutoff (spec §8.2 "reuse iff age < 0.9 × refresh")', () => {
  it('is now minus 0.9 × refresh hours', () => {
    expect(reuseCutoff(asIsoDateTime('2026-10-14T09:00:00.000Z'), 168)).toBe('2026-10-08T01:48:00.000Z'); // 151.2 h earlier
  });
});

describe('reuse per cell (spec §8.1 "reuse, per cell")', () => {
  it('at 151 h every searched cell is copied with its original fetchedAt and the fetching execution; no tile is requested', async () => {
    h = createHarness();
    const def = h.createDefinition();
    const one = await h.runToCompletion(orch(), def.id);
    h.clock.advance(151 * HOUR);
    const two = await h.runToCompletion(orch(), def.id);
    expect(h.tileRequests(two.id)).toBe(0);
    const o2 = h.outcomes(two.id, { stage: 'discovery' });
    expect(o2.every((o) => o.reusedFromExecutionId === one.id)).toBe(true);
    const byCell = new Map(h.outcomes(one.id, { stage: 'discovery' }).map((o) => [cellKeyString(o), o]));
    for (const o of o2) {
      const first = byCell.get(cellKeyString(o));
      expect(o.status).toBe(first?.status);
      expect(o.fetchedAt).toBe(first?.fetchedAt);
      expect(o.minPence).toBe(first?.minPence);
    }
    const p1 = priceRows(one.id);
    const p2 = priceRows(two.id);
    expect(p2.map(({ ru: _ru, ...rest }) => rest)).toEqual(p1.map(({ ru: _ru, ...rest }) => rest)); // same cells, same fetched_at
    expect(p2.every((r) => r.ru === one.id)).toBe(true);
  });

  it('at 152 h nothing is reused and every tile is requested again', async () => {
    h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(orch(), def.id);
    h.clock.advance(152 * HOUR);
    const two = await h.runToCompletion(orch(), def.id);
    expect(h.tileRequests(two.id)).toBe(expectedTiles(h, def));
    expect(h.outcomes(two.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
  });

  it('a DST-shortened weekly interval (167 h, 22 → 29 March 2027 at 05:00 London) still refreshes', async () => {
    h = createHarness({ now: asIsoDateTime('2027-03-22T05:00:00.000Z') }); // Monday 05:00 GMT
    const def = h.createDefinition({ window: { kind: 'absolute', from: asIsoDate('2027-05-03'), to: asIsoDate('2027-05-05') } });
    await h.runToCompletion(orch(), def.id);
    h.clock.set(asIsoDateTime('2027-03-29T04:00:00.000Z')); // Monday 05:00 BST: 167 h later, under the nominal 168
    const two = await h.runToCompletion(orch(), def.id);
    expect(h.outcomes(two.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
    expect(h.tileRequests(two.id)).toBe(expectedTiles(h, def));
  });

  it('never copies error outcomes: those cells are fetched again, the rest are reused', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal <= 3, respond: RESPONSES.upstream, times: 3 });
    const def = h.createDefinition();
    const one = await h.runToCompletion(orch(), def.id);
    const errored = new Set(h.outcomes(one.id, { status: 'error' }).map(cellKeyString));
    expect(errored.size).toBeGreaterThan(0);
    h.clock.advance(2 * HOUR);
    const two = await h.runToCompletion(orch(), def.id);
    for (const o of h.outcomes(two.id, { stage: 'discovery' })) {
      expect(o.reusedFromExecutionId).toBe(errored.has(cellKeyString(o)) ? null : one.id);
    }
  });

  it('never copies not_run outcomes of an interrupted run', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition();
    const first = orch();
    h.onTileCommit((n) => {
      if (n === 1) void first.shutdown();
    });
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await h.waitForSettled(r.executionId);
    h.clearHooks();
    const notRun = new Set(h.outcomes(r.executionId, { status: 'not_run' }).map(cellKeyString));
    const second = orch();
    expect(await second.cancel(r.executionId)).toBe(true); // frees the definition for a new run
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(second, def.id);
    for (const o of h.outcomes(two.id)) expect(o.reusedFromExecutionId).toBe(notRun.has(cellKeyString(o)) ? null : r.executionId);
  });

  it('refuses on a cabin change', async () => {
    h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(orch(), def.id);
    h.repos.definitions.update(def.id, { cabin: 'premium_economy' });
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(orch(), def.id);
    expect(h.outcomes(two.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
  });

  it('a copy of a copy still names the execution that fetched the price', async () => {
    h = createHarness();
    const def = h.createDefinition();
    const one = await h.runToCompletion(orch(), def.id);
    h.clock.advance(HOUR);
    await h.runToCompletion(orch(), def.id);
    h.clock.advance(HOUR);
    const three = await h.runToCompletion(orch(), def.id);
    expect(h.outcomes(three.id).every((o) => o.reusedFromExecutionId === one.id)).toBe(true);
    expect(priceRows(three.id).every((r) => r.ru === one.id && r.f === priceRows(one.id).find((x) => x.d === r.d && x.r === r.r)?.f)).toBe(true);
  });

  it('a fresh price supersedes a reused row in the same transaction (spec §7)', async () => {
    h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(orch(), def.id);
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(orch(), def.id);
    const ctx = buildContext(h.deps, h.options);
    const cap = discoveryOf(h.fixture);
    const q = discoveryQuery(two.snapshot, LHR, JFK, h.outcomes(two.id, { stage: 'discovery' }));
    const tile = cap.plan(q)[0];
    if (tile === undefined) throw new Error('fixture planned no tile');
    const result = await cap.fetchTile(tile, q, { executionId: two.id, signal: new AbortController().signal, recordFixtures: false });
    if (result.kind !== 'tile') throw new Error('expected a tile');
    commitTile(ctx, newRun(ctx, two, { manual: true, fresh: false, blocked: new Set() }), 'fixture', cap.info, result);
    const pricedNow = new Set(result.prices.map(cellKeyString));
    const rows = priceRows(two.id).filter((r) => pricedNow.has(`${r.origin}|${r.destination}|${r.d}|${r.r}`));
    expect(rows.length).toBe(pricedNow.size); // one row per cell: the reused row is gone, not duplicated
    expect(rows.every((r) => r.ru === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- reuse`
Expected: FAIL, `Cannot find module '../src/stages/reuse.js'`.

- [ ] **Step 3: Implement**

`src/stages/reuse.ts`:

```ts
import type { CapabilityInfo, CellKey, DefinitionSnapshot, IsoDateTime, ProviderId } from '@gmt/core';
import type { CalendarPriceInsert, CalendarPriceRow, ReusedCopy } from '@gmt/db';
import type { EngineContext } from '../context.js';
import type { RunState } from '../run.js';

/** Spec §7 providers_json "discoveryRefreshHours{} (default 168 per provider)". */
export const DEFAULT_REFRESH_HOURS = 168;
/** Spec §8.2: "reuse iff age < 0.9 × refresh, so a weekly cron refreshes weekly" (tested at 151 h, 152 h and a DST interval). */
export const REUSE_TOLERANCE = 0.9;

export function refreshHoursOf(snapshot: Pick<DefinitionSnapshot, 'providers'>, providerId: ProviderId): number {
  return snapshot.providers.discoveryRefreshHours[providerId] ?? DEFAULT_REFRESH_HOURS;
}

/** The oldest original fetched_at still reusable: now − 0.9 × refresh hours (age measured from the original fetch). */
export function reuseCutoff(now: IsoDateTime, refreshHours: number): IsoDateTime {
  return new Date(Date.parse(now) - Math.round(refreshHours * REUSE_TOLERANCE * 3_600_000)).toISOString() as IsoDateTime;
}

/**
 * Spec §8.1 reuse predicate: the newest priced | empty | no_data outcome for the same cell,
 * provider, definition, cabin, point of sale and source kind, from a non-child execution, whose
 * original fetched_at is newer than the cutoff. The same query feeds the estimate (spec §8.1).
 */
export function reusableFor(ctx: EngineContext, definitionId: string, snapshot: DefinitionSnapshot, providerId: ProviderId, info: CapabilityInfo, cells: readonly CellKey[]): ReturnType<EngineContext['repos']['calendarPrices']['reuseCandidates']> {
  if (cells.length === 0) return new Map();
  const cutoff = reuseCutoff(ctx.clock.now(), refreshHoursOf(snapshot, providerId));
  return ctx.repos.calendarPrices.reuseCandidates(definitionId, providerId, snapshot.cabin, ctx.pointOfSaleOf(providerId), info.sourceKind, [...cells], cutoff);
}

function copyOfPrice(executionId: string, row: CalendarPriceRow, fetchedBy: string): CalendarPriceInsert {
  const { id: _id, ...rest } = row;
  return { ...rest, executionId, reusedFromExecutionId: fetchedBy };
}

/**
 * Copies every reusable outcome (and its price row) into this execution for the provider's `not_run`
 * discovery cells. Each copy keeps the original fetched_at and provenance and names the execution that
 * fetched the price, never an intermediate copier (spec §3 "always the execution that fetched the price").
 * error and not_run outcomes are never copied. Returns the number of cells reused.
 */
export function applyReuse(ctx: EngineContext, run: RunState, providerId: ProviderId, info: CapabilityInfo): number {
  if (run.isChild) return 0; // why: spec §6.7 child executions have no discovery
  const notRun = ctx.repos.cells.outcomes(run.executionId, { stage: 'discovery', providerId, status: 'not_run' });
  const candidates = reusableFor(ctx, run.definitionId, run.snapshot, providerId, info, notRun);
  const copies: ReusedCopy[] = [];
  for (const { outcome, price } of candidates.values()) {
    if (outcome.status !== 'priced' && outcome.status !== 'empty' && outcome.status !== 'no_data') continue; // why: belt and braces on the repository's predicate
    const fetchedBy = outcome.reusedFromExecutionId ?? outcome.executionId;
    copies.push({
      cell: { origin: outcome.origin, destination: outcome.destination, departureDate: outcome.departureDate, returnDate: outcome.returnDate },
      providerId, status: outcome.status, reason: outcome.reason, fetchedAt: outcome.fetchedAt, minPence: outcome.minPence,
      cabin: run.snapshot.cabin, pointOfSale: ctx.pointOfSaleOf(providerId), sourceKind: info.sourceKind,
      reusedFromExecutionId: fetchedBy,
      price: price === null ? null : copyOfPrice(run.executionId, price, fetchedBy),
    });
  }
  // why: spec §7 atomic unit "each reused cell's outcome + copied prices + roll-up" — copyReused commits per cell
  if (copies.length > 0) ctx.repos.calendarPrices.copyReused(run.executionId, copies);
  return copies.length;
}
```

`src/stages/discovery.ts`: in `runDiscoveryProvider`, before `const cells = runnableCells(…)`, insert (importing `applyReuse` from `./reuse.js`):

```ts
  if (!run.disabled.has(providerId)) {
    const reused = applyReuse(ctx, run, providerId, cap.info);
    if (reused > 0) log.info({ stage: 'discovery', reused }, 'discovery: reused cells from earlier runs');
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- reuse`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: per-cell reuse with 0.9 tolerance, original fetchedAt, supersede

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.8: Verification stage — selection once, offer normalisation, the verified-cell write

**Files:**
- Create: `packages/engine/src/stages/verification.ts`, `test/verification.test.ts`
- Modify: `packages/engine/src/normalise.ts` (offers), `src/execute.ts` (run verification after discovery)

**Interfaces:**
- Consumes: `selectCandidates`, `generateCells`, `normaliseOffer`, `validateVendorUrl`, `CellsRepo.seedVerification/writeVerifiedCell/rollUps/selected`, `ObservationWrite`, `VerifiedCellWrite`.
- Produces: `runVerification(ctx, run)`, `itineraryQuery(snapshot, cell)`, `commitVerifiedCell(ctx, run, provider, info, cell, result)`, `bestIndexOf(offers, cabin)`, `normaliseOfferForCell(raw, ctx, deps)`, `bookingOf(raw, providerId)`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/verification.test.ts`:

```ts
import { type FlightProvider, type ItinerarySearchResult, cellKeyString } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, RESPONSES, createHarness, verificationOf, withVerification } from './harness.js';
import { mapOffers } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const orch = () => createOrchestrator(buildContext(h.deps, h.options));
const def = () => h.createDefinition({ providers: withVerification() });

describe('verification stage (spec §8.1 "verification", §6.7, §7 atomic units)', () => {
  it('persists selection with verification seeding: selected cells searched, the rest skipped:not_selected', async () => {
    h = createHarness();
    const e = await h.runToCompletion(orch(), def().id);
    expect(e.status).toBe('completed');
    const selected = h.repos.cells.selected(e.id);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(2); // maxCells
    const chosen = new Set(selected.map(cellKeyString));
    const v = h.outcomes(e.id, { stage: 'verification' });
    expect(v).toHaveLength(6); // every cell × the one verification provider
    for (const o of v) {
      if (chosen.has(cellKeyString(o))) expect(['priced', 'empty']).toContain(o.status);
      else expect(o).toMatchObject({ status: 'skipped', reason: 'not_selected' });
    }
  });

  it('a priced cell stores best_observation_id = its cheapest observation in the definition cabin, and min_pence matches', async () => {
    h = createHarness();
    const e = await h.runToCompletion(orch(), def().id);
    const rows = h.db.raw
      .prepare(
        `SELECT sc.best_observation_id AS best,
                (SELECT price_pence FROM price_observations WHERE id = sc.best_observation_id) AS bestPence,
                (SELECT min(po.price_pence) FROM price_observations po
                   JOIN fare_offers fo ON fo.id = po.offer_id JOIN itineraries i ON i.hash = fo.itinerary_hash
                  WHERE po.execution_id = sc.execution_id AND i.origin = sc.origin AND i.destination = sc.destination
                    AND i.departure_date = sc.departure_date AND i.return_date = sc.return_date AND fo.cabin = 'economy') AS minPence
           FROM search_cells sc WHERE sc.execution_id = ? AND sc.verification_status = 'priced'`,
      )
      .all(e.id) as Array<{ best: number | null; bestPence: number; minPence: number }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.best).not.toBeNull();
      expect(r.bestPence).toBe(r.minPence);
    }
    for (const o of h.outcomes(e.id, { stage: 'verification', status: 'priced' })) expect(o.minPence).not.toBeNull();
  });

  it('observations carry full provenance, the provider suppliedFields, and a booking validated against the allowlist', async () => {
    h = createHarness();
    const e = await h.runToCompletion(orch(), def().id);
    const obs = h.db.raw
      .prepare('SELECT source_kind AS k, fetched_at AS f, max_age_hours AS m, point_of_sale AS pos, supplied_fields_json AS sf, booking_json AS b, fx_converted AS fx FROM price_observations WHERE execution_id = ?')
      .all(e.id) as Array<{ k: string; f: string; m: number | null; pos: string; sf: string; b: string | null; fx: number }>;
    expect(obs.length).toBeGreaterThan(0);
    const info = verificationOf(h.fixture).info;
    for (const o of obs) {
      expect(o.k).toBe('synthetic');
      expect(o.f).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(o.m).toBe(info.maxAgeHours === 'unknown' ? null : info.maxAgeHours);
      expect(o.pos).toBe('unknown');
      expect(JSON.parse(o.sf)).toEqual([...h.fixture.suppliedFields]);
      expect(o.b === null ? { kind: 'none' } : JSON.parse(o.b)).toMatchObject({ kind: 'none' }); // the fixture's allowlist is empty
    }
  });

  it('selection runs once: an interrupt during verification and a resume keep the same selection', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: (r) => r.kind === 'itinerary' && r.ordinal === 1, respond: RESPONSES.hold });
    const d = def();
    const first = orch();
    const r = await first.start(d.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    const before = h.repos.cells.selected(r.executionId).map(cellKeyString).sort();
    const stopping = first.shutdown();
    h.releaseHolds();
    await stopping;
    expect((await h.waitForSettled(r.executionId)).status).toBe('interrupted');
    expect(await orch().resume(r.executionId, { manual: false })).toEqual({ ok: true, executionId: r.executionId });
    expect((await h.waitForSettled(r.executionId)).status).toBe('completed');
    expect(h.repos.cells.selected(r.executionId).map(cellKeyString).sort()).toEqual(before);
    expect(h.logs.filter((l) => l.msg === 'verification: selection persisted')).toHaveLength(1);
  });
});

describe('offer normalisation (spec §5.6, §9 item 4 "fx-unavailable, currency-unsupported, unknown-airport-tz, offers-dropped")', () => {
  const run = async (f: Parameters<typeof mapOffers>[1]) => {
    h = createHarness({ transformFixture: (p) => mapOffers(p, f) });
    return h.runToCompletion(orch(), def().id);
  };

  it('one bad offer among several is dropped and counted: priced with offers-dropped:1', async () => {
    const e = await run((o, i) => (i === 0 ? { ...o, currency: 'ARS' } : o));
    const priced = h.outcomes(e.id, { stage: 'verification', status: 'priced' });
    expect(priced.some((o) => o.reason?.split(',').includes('offers-dropped:1'))).toBe(true);
  });

  it.each([
    ['currency-unsupported', (o: Parameters<Parameters<typeof mapOffers>[1]>[0]) => ({ ...o, currency: 'ARS' })],
    ['fx-unavailable', (o: Parameters<Parameters<typeof mapOffers>[1]>[0]) => ({ ...o, currency: 'USD' })],
    ['unknown-airport-tz', (o: Parameters<Parameters<typeof mapOffers>[1]>[0]) => ({ ...o, outbound: o.outbound.map((s, i) => (i === 0 ? { ...s, to: 'AAA' } : s)) })],
    ['unmappable-carrier', (o: Parameters<Parameters<typeof mapOffers>[1]>[0]) => ({ ...o, outbound: o.outbound.map((s) => ({ ...s, marketingCarrier: '!!' })) })],
  ] as const)('every offer failing with %s → error with that reason, no itinerary written', async (reason, f) => {
    const e = await run(f);
    expect(e.status).toBe('completed');
    const v = h.outcomes(e.id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((o) => o.status === 'error' && o.reason === reason)).toBe(true);
    expect((h.db.raw.prepare('SELECT count(*) AS n FROM price_observations WHERE execution_id = ?').get(e.id) as { n: number }).n).toBe(0);
  });

  it('a partial expansion is noted on the priced outcome', async () => {
    h = createHarness({
      transformFixture: (p: FlightProvider): FlightProvider => {
        const v = verificationOf(p);
        return { ...p, healthcheck: (c) => p.healthcheck(c), verification: { info: v.info, estimate: (q) => v.estimate(q), search: async (q, c): Promise<ItinerarySearchResult> => ({ ...(await v.search(q, c)), partial: true, failedExpansions: 1 }) } };
      },
    });
    const e = await h.runToCompletion(orch(), def().id);
    const priced = h.outcomes(e.id, { stage: 'verification', status: 'priced' });
    expect(priced.length).toBeGreaterThan(0);
    expect(priced.every((o) => o.reason?.split(',').includes('partial-expansion'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- verification`
Expected: FAIL: `h.repos.cells.selected(e.id)` is empty and there are no verification outcomes (the engine has no verification stage yet).

- [ ] **Step 3: Implement**

`src/normalise.ts`: add (importing `type Booking`, `type IsoDateTime`, `type RawOffer`, `type SuppliedField`, `normaliseOffer` from `@gmt/core` and `type ObservationWrite` from `@gmt/db`):

```ts
/** ECB rate lookup in the shape core's normaliseOffer asks for. */
function rateOf(deps: NormaliseDeps, currency: string): { rateNano: number; rateDate: IsoDate; source: string } | null {
  const r = deps.fx.latest(currency.toUpperCase(), deps.fxMaxRateAgeDays, deps.clock.todayLondon());
  return r === null ? null : { rateNano: r.rateNano, rateDate: r.date, source: FX_SOURCE };
}

/** Spec §5.2 vendor links: GET and POST bookings keep only allowlisted https URLs; POST data is kept for the browser form. */
export function bookingOf(raw: RawOffer['booking'], providerId: ProviderId): Booking {
  if (raw.kind === 'none') return { kind: 'none' };
  const v = validateVendorUrl(raw.url, LINK_ALLOWLIST[providerId]);
  if (v.kind !== 'get') return { kind: 'none' };
  return raw.kind === 'post' ? { kind: 'post', url: v.url, postData: raw.postData, host: v.host } : v;
}

export interface OfferContext {
  executionId: string; providerId: ProviderId; info: CapabilityInfo; pointOfSale: PointOfSale; fetchedAt: IsoDateTime;
  suppliedFields: readonly SuppliedField[]; partialExpansion: boolean;
}

/**
 * One raw offer → one observation write (itinerary, segments, offer, observation), or the reason it
 * is dropped. Spec §5.6: every segment airport must have a tz in the airports table
 * (unknown-airport-tz, never hash UTC); money through toMoney; hashing and local times are core's
 * normaliseOffer; evidenced cabins only when every segment states one (else the cabin verdict is
 * unverified at read time); the booking link is validated here.
 */
export function normaliseOfferForCell(raw: RawOffer, c: OfferContext, deps: NormaliseDeps): ObservationWrite | NormalisationError {
  const segments = [...raw.outbound, ...raw.inbound];
  for (const s of segments) {
    for (const iata of [s.from, s.to]) if (deps.airports.get(iata) === null) return new NormalisationError('unknown-airport-tz', iata);
  }
  const money = toMoney(deps, raw.amountMinor, raw.currency);
  if (money instanceof NormalisationError) return money;
  const n = normaliseOffer(raw, { tzOf: (iata) => deps.airports.get(iata)?.tz ?? null, rateFor: (cur) => rateOf(deps, cur), cabin: raw.requestedCabin });
  if (n instanceof NormalisationError) return n;
  const stated = segments.map((s) => s.cabin);
  const segmentCabins = stated.every((x): x is Cabin => x !== undefined) ? stated : null;
  return {
    itinerary: n.itinerary,
    offer: { itineraryHash: n.itinerary.hash, providerId: c.providerId, seller: raw.seller, cabin: raw.requestedCabin },
    provenance: { providerId: c.providerId, sourceKind: c.info.sourceKind, fetchedAt: c.fetchedAt, maxAgeHours: c.info.maxAgeHours, fx: money.fx, pointOfSale: c.pointOfSale, cabin: raw.requestedCabin },
    pricePence: money.pricePence, priceNativeMinor: money.priceNativeMinor, currencyNative: money.currencyNative,
    taxesIncluded: raw.taxesIncluded ?? null, selfTransfer: raw.selfTransfer ?? null, segmentCabins,
    baggage: raw.baggage ?? null, fareConditions: raw.fareConditions ?? null,
    booking: bookingOf(raw.booking, c.providerId), bookingExpiresAt: raw.bookingExpiresAt ?? null,
    suppliedFields: [...c.suppliedFields], partialExpansion: c.partialExpansion,
  };
}
```

(also add `type IsoDate` to the `@gmt/core` import for `rateOf`).

`src/stages/verification.ts`:

```ts
import {
  type CapabilityInfo, type CellKey, type DefinitionSnapshot, type FlightProvider, type ItineraryQuery, type ItinerarySearchResult,
  NormalisationError, type ProviderId, type RollUp, cellKeyString, generateCells, selectCandidates,
} from '@gmt/core';
import type { ObservationWrite, VerifiedCellWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { normaliseOfferForCell } from '../normalise.js';
import { runPool } from '../pool.js';
import { type RunState, laneFor, markProgress, markRemaining, onFailure, runnableCells, stopRun } from '../run.js';
import { normaliseDeps } from './discovery.js';

/** The itinerary query for one cell from the frozen snapshot (spec §5.1 ItineraryQuery). */
export function itineraryQuery(snapshot: DefinitionSnapshot, cell: CellKey): ItineraryQuery {
  const p = snapshot.verification;
  return {
    origin: cell.origin, destination: cell.destination, departureDate: cell.departureDate, returnDate: cell.returnDate,
    cabin: snapshot.cabin, adults: 1, currency: 'GBP', expandTop: p.expandTop, bookingLinks: p.bookingLinks,
    ...(p.maxStops !== undefined ? { maxStops: p.maxStops } : {}),
  };
}

/** Index of the cheapest offer in the definition's cabin; the cheapest overall when none is in it; null for none. */
export function bestIndexOf(offers: readonly ObservationWrite[], cabin: DefinitionSnapshot['cabin']): number | null {
  let best: number | null = null;
  let bestInCabin = false;
  for (let i = 0; i < offers.length; i += 1) {
    const o = offers[i];
    if (o === undefined) continue;
    const inCabin = o.offer.cabin === cabin;
    const cur = best === null ? undefined : offers[best];
    if (cur === undefined || (inCabin && !bestInCabin) || (inCabin === bestInCabin && o.pricePence < cur.pricePence)) {
      best = i;
      bestInCabin = inCabin;
    }
  }
  return best;
}

function discoveryRollUps(ctx: EngineContext, executionId: string): Map<string, RollUp> {
  return new Map([...ctx.repos.cells.rollUps(executionId)].map(([k, v]) => [k, v.discovery]));
}

/** Spec §6.7: selection once, persisted with verification seeding in one transaction (spec §7). A child bypasses selection. */
function persistSelection(ctx: EngineContext, run: RunState, ids: readonly ProviderId[]): void {
  const selection =
    run.isChild && run.childCell !== null
      ? [{ cell: run.childCell, reason: 'always_include' as const }]
      : selectCandidates(run.snapshot.verification, generateCells(run.snapshot.resolved), discoveryRollUps(ctx, run.executionId), run.snapshot.providers.discovery.length > 0);
  ctx.db.transaction(() => {
    ctx.repos.cells.seedVerification(run.executionId, selection, [...ids]);
    for (const id of ids) {
      if (run.blocked.has(id)) markRemaining(ctx, run, 'verification', id, 'budget');
      else if (run.disabled.has(id)) markRemaining(ctx, run, 'verification', id, 'provider_disabled');
    }
  });
  const reasons: Record<string, number> = {};
  for (const s of selection) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  run.log.info({ stage: 'verification', selected: selection.length, reasons }, 'verification: selection persisted');
}

/** Spec §8.1 "verification": selection, then a bounded pool of cells per provider. */
export async function runVerification(ctx: EngineContext, run: RunState): Promise<void> {
  const ids = run.snapshot.providers.verification.filter((id) => ctx.providers.get(id)?.verification !== undefined);
  if (ids.length === 0) return; // why: spec §3 "a stage with no provider configured has no outcome rows and a NULL roll-up"
  ctx.repos.executions.setStatus(run.executionId, 'running', { stage: 'verification' });
  // why: spec §6.7 "never recomputed on resume"; spec §7 "resume re-runs selection only when no verification outcomes exist"
  if (ctx.repos.cells.outcomes(run.executionId, { stage: 'verification' }).length === 0) persistSelection(ctx, run, ids);
  await Promise.all(ids.map((id) => runVerificationProvider(ctx, run, id)));
  if (run.stop === null && ids.every((id) => run.disabled.has(id))) stopRun(run, { kind: 'all-disabled', stage: 'verification' });
}

async function runVerificationProvider(ctx: EngineContext, run: RunState, providerId: ProviderId): Promise<void> {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined) return;
  const cells = runnableCells(ctx, run, 'verification', providerId);
  if (cells.length > 0) {
    const lane = laneFor(run, 'verification', providerId);
    run.log.child({ providerId }).info({ stage: 'verification', cells: cells.length }, 'verification: searching cells');
    await runPool(cells, ctx.limitsOf(providerId).concurrency, lane.signal, async (cell) => {
      const key = cellKeyString(cell);
      lane.inFlight.add(key);
      try {
        const result = await cap.search(itineraryQuery(run.snapshot, cell), { executionId: run.executionId, signal: lane.signal, recordFixtures: false });
        if (lane.signal.aborted) return; // why: spec §9 item 4 "cancel mid expansion → not_run, no itinerary"
        commitVerifiedCell(ctx, run, provider, cap.info, cell, result);
      } catch (err) {
        onFailure(ctx, run, providerId, 'verification', [cell], err, lane.signal);
      } finally {
        lane.inFlight.delete(key);
      }
    });
  }
  if (run.disabled.has(providerId)) markRemaining(ctx, run, 'verification', providerId, 'provider_disabled');
}

/**
 * Writes one verified cell atomically (spec §7: itinerary, segments, offer, observation, outcome,
 * best_observation_id, roll-up). priced iff ≥ 1 offer survives normalisation, with notes
 * `partial-expansion` and `offers-dropped:n`; error with the first normalisation reason when offers
 * existed but none survived; empty otherwise (spec §3, §5.4, §5.6).
 */
export function commitVerifiedCell(ctx: EngineContext, run: RunState, provider: FlightProvider, info: CapabilityInfo, cell: CellKey, result: ItinerarySearchResult): void {
  const pointOfSale = ctx.pointOfSaleOf(provider.id);
  const oc = { executionId: run.executionId, providerId: provider.id, info, pointOfSale, fetchedAt: result.fetchedAt, suppliedFields: provider.suppliedFields, partialExpansion: result.partial };
  const deps = normaliseDeps(ctx);
  const offers: ObservationWrite[] = [];
  let dropped = 0;
  let firstFailure: NormalisationError | null = null;
  for (const raw of result.offers) {
    const w = normaliseOfferForCell(raw, oc, deps);
    if (w instanceof NormalisationError) {
      dropped += 1;
      firstFailure ??= w;
    } else offers.push(w);
  }
  const base = { fetchedAt: result.fetchedAt, cabin: run.snapshot.cabin, pointOfSale, sourceKind: info.sourceKind };
  let write: VerifiedCellWrite;
  if (offers.length > 0) {
    const notes = [...(result.partial ? ['partial-expansion'] : []), ...(dropped > 0 ? [`offers-dropped:${dropped}`] : [])];
    write = { ...base, status: 'priced', reason: notes.length > 0 ? notes.join(',') : null, lastError: firstFailure?.message ?? null, offers, bestIndex: bestIndexOf(offers, run.snapshot.cabin) };
  } else if (firstFailure !== null) {
    write = { ...base, status: 'error', reason: firstFailure.reason, lastError: firstFailure.message, offers: [], bestIndex: null };
  } else {
    write = { ...base, status: 'empty', reason: null, lastError: null, offers: [], bestIndex: null };
  }
  ctx.repos.cells.writeVerifiedCell(run.executionId, provider.id, cell, write);
  run.parseStreak.set(provider.id, 0);
  markProgress(ctx, run);
  if (dropped > 0) run.log.child({ providerId: provider.id }).warn({ stage: 'verification', dropped, reason: firstFailure?.reason ?? null }, 'verification: offers dropped in normalisation');
}
```

`src/execute.ts`: replace `execute` with (importing `runVerification` from `./stages/verification.js`):

```ts
/** Runs one pass: discovery, then verification (spec §8.1 order), then finish. A stage error that escapes stops the pass as fatal. */
export async function execute(ctx: EngineContext, run: RunState): Promise<void> {
  try {
    await runDiscovery(ctx, run);
    if (run.stop === null) await runVerification(ctx, run);
  } catch (err) {
    stopRun(run, { kind: 'fatal', message: errorText(err) });
  }
  await finish(ctx, run);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- verification`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: verification stage with once-only selection, offer normalisation, verified-cell write

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.9: The §8.1 error table in the verification stage; cancel mid-expansion; `no-return-legs`

**Files:**
- Create: `packages/engine/test/error-table-verification.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 7.4 and 7.8 (no new production code is expected; this task proves the table holds in the second stage).
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

`packages/engine/test/error-table-verification.test.ts`:

```ts
import { type OperatorMessage, ProviderError } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { addSeconds } from '../src/errors.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, type InjectedResponse, RESPONSES, T0, createHarness, withVerification } from './harness.js';
import { throwOnSearch } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const kinds = () => h.notifications.filter((m): m is OperatorMessage => 'kind' in m).map((m) => m.kind);
const itinerary = (from: number, to = from) => (r: { kind: string; ordinal: number }) => r.kind === 'itinerary' && r.ordinal >= from && r.ordinal <= to;
const verifying = () => h.createDefinition({ providers: withVerification(), verification: { maxCells: 4, topN: 4, alwaysInclude: [], expandTop: 1, bookingLinks: true } });
const searched = (id: string) => h.outcomes(id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');

async function run(respond: InjectedResponse, match: (r: { kind: string; ordinal: number }) => boolean, times = 1) {
  h = createHarness({ fixtureConcurrency: 1 });
  h.scenario({ match, respond, times });
  const ctx = buildContext(h.deps, h.options);
  const scheduleResume = vi.fn();
  ctx.hooks.scheduleResume = scheduleResume;
  const e = await h.runToCompletion(createOrchestrator(ctx), verifying().id);
  return { e, scheduleResume };
}

describe('error table, verification stage', () => {
  it.each([
    ['rate-limit', RESPONSES.rateLimit, 3],
    ['upstream', RESPONSES.upstream, 3],
    ['network', RESPONSES.network, 3],
    ['parse', RESPONSES.badRequest, 1],
  ] as const)('%s on the first searched cell → that cell error, attempts 1; the run continues', async (reason, respond, times) => {
    const { e } = await run(respond, itinerary(1, times), times);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { stage: 'verification', status: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ reason, attempts: 1 });
    expect(searched(e.id).filter((o) => o.status === 'not_run')).toHaveLength(0);
  });

  it('two consecutive parse errors disable the provider; remaining selected cells skipped:provider_disabled; paused_error', async () => {
    const { e } = await run(RESPONSES.badRequest, itinerary(1, 2), 2);
    expect(e.status).toBe('paused_error');
    const s = searched(e.id);
    expect(s.filter((o) => o.status === 'error' && o.reason === 'parse')).toHaveLength(2);
    expect(s.filter((o) => o.status === 'skipped').every((o) => o.reason === 'provider_disabled')).toBe(true);
    expect(kinds()).toEqual(['provider_disabled', 'paused_error']);
  });

  it.each([
    ['auth', RESPONSES.auth],
    ['quota', RESPONSES.quota],
  ] as const)('%s disables the provider; none remain → paused_error', async (reason, respond) => {
    const { e } = await run(respond, itinerary(1));
    expect(e.status).toBe('paused_error');
    const s = searched(e.id);
    expect(s.filter((o) => o.status === 'error')).toEqual([expect.objectContaining({ reason })]);
    expect(s.filter((o) => o.status !== 'error').every((o) => o.status === 'skipped' && o.reason === 'provider_disabled')).toBe(true);
  });

  it('limiter-timeout → the cell returns to not_run; paused_error with resume_after; one-shot job requested', async () => {
    const { e, scheduleResume } = await run(RESPONSES.limiterTimeout, itinerary(1, 3), 3);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBe(addSeconds(T0, 4000));
    expect(scheduleResume).toHaveBeenCalledWith(e.id, addSeconds(T0, 4000));
    expect(searched(e.id).filter((o) => o.status === 'error')).toHaveLength(0);
    expect(searched(e.id).some((o) => o.status === 'not_run')).toBe(true);
  });

  it('upstream with reason no-return-legs → error no-return-legs, not retried by a later resume (spec §5.4, §7)', async () => {
    const when = vi.fn(() => true);
    h = createHarness({ transformFixture: (p) => throwOnSearch(p, new ProviderError({ kind: 'upstream', reason: 'no-return-legs', retryable: false, message: 'every step-2 expansion failed' }), when) });
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const e = await h.runToCompletion(orch, verifying().id);
    expect(e.status).toBe('completed');
    expect(searched(e.id).every((o) => o.status === 'error' && o.reason === 'no-return-legs')).toBe(true);
    const calls = when.mock.calls.length;
    const resumed = await orch.resume(e.id, { manual: true });
    if (resumed.ok) await h.waitForSettled(e.id);
    expect(when.mock.calls.length).toBe(calls);
    expect(searched(e.id).every((o) => o.reason === 'no-return-legs')).toBe(true);
  });
});

describe('cancel mid expansion → not_run, no itinerary (spec §9 item 4)', () => {
  it('a held itinerary call that is cancelled writes nothing for its cell', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: itinerary(1), respond: RESPONSES.hold });
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const r = await orch.start(verifying().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    const cancelling = orch.cancel(r.executionId);
    h.releaseHolds();
    expect(await cancelling).toBe(true);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('cancelled');
    expect(searched(e.id).every((o) => o.status === 'not_run')).toBe(true);
    expect((h.db.raw.prepare('SELECT count(*) AS n FROM price_observations WHERE execution_id = ?').get(e.id) as { n: number }).n).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @gmt/engine test -- error-table-verification`
Expected: PASS, 10 tests. If any fails, the fault is in Task 7.4 or 7.8 code (the stage runners share `onFailure`); fix it there, re-run Tasks 7.4 and 7.8's tests, then continue.

- [ ] **Step 3: Commit**

```bash
git add packages/engine && git commit -m "wp07: verification-stage error table, cancel mid-expansion, no-return-legs

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.10: Budget breaches mid-run, per scope; "alerts running on calendar basis only"

**Files:**
- Create: `packages/engine/test/budget-breach.test.ts`
- Modify: `packages/engine/src/run.ts` (`Lane.budgetOut`, `onFailure` budget case, new `applyBudgetBreach`, `budgetOut`, `settleLane`), `src/stages/discovery.ts` and `src/stages/verification.ts` (call `settleLane`), `src/execute.ts` (`finish` adds the calendar-only notice)

**Interfaces:**
- Consumes: `BudgetExceeded` (`scope`, `cap`, `current`, `requested`), `BudgetGuard.usage(scope).windowEnd`.
- Produces: `applyBudgetBreach(ctx, run, providerId, stage, err)`, `budgetOut(ctx, run, stage, providerId, mode)`, `settleLane(ctx, run, stage, providerId)`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/budget-breach.test.ts`:

```ts
import { type OperatorMessage, cellKeyString, generateCells } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { planTiles } from '../src/stages/discovery.js';
import { type Harness, FIXTURE_COST_MICRO_GBP, JFK, LGW, LHR, RESPONSES, createHarness, discoveryOf, withVerification } from './harness.js';
import { freeStubProvider } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const kinds = () => h.notifications.filter((m): m is OperatorMessage => 'kind' in m).map((m) => m.kind);
const spent = (id: string) => h.ledgerRows(id).filter((r) => r.endpointPath !== '/test-spend');
const twoPairs = (patch = {}) => h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });

describe('BudgetExceeded execution-* (spec §8.1)', () => {
  it('concurrency 4 with 1 call left → exactly 1 billable call; siblings aborted → not_run; paused_budget; never an error', async () => {
    h = createHarness({ fixtureConcurrency: 4 });
    const def = twoPairs({ budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    // why: spend arrives after the pre-start check, inside the seeding transaction, as a concurrent child's spend would
    h.onStageStart('discovery', (id) => h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }));
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const e = await h.runToCompletion(createOrchestrator(ctx), def.id);
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBeNull();
    expect(scheduleResume).not.toHaveBeenCalled();
    expect(spent(e.id)).toHaveLength(1);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
    expect(kinds()).toEqual(['paused_budget']);
    expect(h.notifications[0]?.body).toContain('execution-calls cap was reached');
  });
});

describe('BudgetExceeded provider-month (spec §8.1)', () => {
  it('another provider remains: the capped provider’s remaining cells skipped:budget, the run continues, one notice', async () => {
    h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20, extraProviders: (t) => [freeStubProvider(t)] });
    const def = twoPairs({ providers: { discovery: ['fixture', 'travelpayouts'], verification: [], discoveryRefreshHours: {} } });
    h.onStageStart('discovery', () => h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }));
    const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), def.id);
    expect(e.status).toBe('completed');
    const fixture = h.outcomes(e.id, { providerId: 'fixture' });
    expect(fixture.filter((o) => o.status === 'skipped').every((o) => o.reason === 'budget')).toBe(true);
    expect(fixture.filter((o) => o.status === 'skipped').length).toBeGreaterThan(0);
    expect(fixture.filter((o) => o.status === 'not_run' || o.status === 'error')).toHaveLength(0);
    expect(h.outcomes(e.id, { providerId: 'travelpayouts' }).every((o) => o.status === 'no_data')).toBe(true);
    expect(kinds()).toEqual(['provider_disabled']);
  });

  it('no other provider remains: remaining cells skipped:budget; paused_budget with resume_after = next window start; one-shot job', async () => {
    h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () => h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }));
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const e = await h.runToCompletion(createOrchestrator(ctx), twoPairs().id);
    const windowEnd = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd;
    expect(windowEnd).not.toBeNull();
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBe(windowEnd);
    expect(scheduleResume).toHaveBeenCalledWith(e.id, windowEnd);
    expect(h.outcomes(e.id, { status: 'skipped' }).every((o) => o.reason === 'budget')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    expect(kinds()).toEqual(['paused_budget']);
  });
});

describe('BudgetExceeded global-month: a stopping breach aborts siblings → not_run (spec §8.1)', () => {
  it('in-flight billed siblings return to not_run, idle cells skipped:budget, paused_budget at the global window start', async () => {
    h = createHarness({ fixtureConcurrency: 2 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal === 2, respond: RESPONSES.hold });
    // why: after the first commit, another process spends the whole global cap (100000p = 1e9 µGBP)
    h.onTileCommit((n) => {
      if (n === 1) h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 1_000_000_000 });
    });
    const def = twoPairs();
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const r = await orch.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.outcomes(r.executionId, { status: 'skipped' }).length).toBeGreaterThan(0));
    h.releaseHolds();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBe(h.deps.budget.usage({ kind: 'global-month' }).windowEnd);
    const cells = generateCells(e.snapshot.resolved);
    const tiles = planTiles(discoveryOf(h.fixture), e.snapshot, cells).map((t) => t.plan.coveredCells.map(cellKeyString));
    const inFlightAtBreach = new Set([...(tiles[1] ?? []), ...(tiles[2] ?? [])]);
    const committed = new Set(tiles[0] ?? []);
    for (const o of h.outcomes(e.id, { stage: 'discovery' })) {
      const k = cellKeyString(o);
      if (committed.has(k)) expect(['priced', 'empty', 'no_data']).toContain(o.status);
      else if (inFlightAtBreach.has(k)) expect(o.status).toBe('not_run');
      else expect(o).toMatchObject({ status: 'skipped', reason: 'budget' });
    }
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
  });
});

describe('"alerts running on calendar basis only" when verification is budget-skipped (spec §6.8, §8.1)', () => {
  it('a provider-month breach in verification skips its cells for budget and tells the operator once', async () => {
    h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), h.createDefinition({ providers: withVerification() }).id);
    expect(e.status).toBe('paused_budget');
    const v = h.outcomes(e.id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((o) => o.status === 'skipped' && o.reason === 'budget')).toBe(true);
    expect(kinds()).toEqual(['paused_budget', 'alerts_calendar_only']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- budget-breach`
Expected: FAIL: the provider-month and global-month tests see no `skipped:budget` outcomes (every breach currently stops the run without marking cells), and the calendar-only notice is never sent.

- [ ] **Step 3: Implement**

`src/run.ts`:

1. Change `Lane.budgetOut` to `budgetOut: 'none' | 'skip-all' | 'skip-idle';` (doc comment: "how the lane's remaining cells are marked after a provider-month or global-month breach") and initialise it to `'none'` in `laneFor`.
2. Replace the `case 'budget':` branch of `onFailure` with:

```ts
    case 'budget':
      applyBudgetBreach(ctx, run, providerId, stage, d.error);
      return;
```

3. Add (importing `type BudgetScope` from `@gmt/core`):

```ts
function stageProviders(run: RunState, stage: Stage): readonly ProviderId[] {
  return stage === 'discovery' ? run.snapshot.providers.discovery : run.snapshot.providers.verification;
}

/**
 * Takes one provider out of a stage for budget: idle not_run cells → skipped:budget now; in-flight
 * calls aborted. `skip-all` also marks the aborted in-flight cells once the pool drains (settleLane);
 * `skip-idle` leaves them not_run, as the global-month row requires.
 */
export function budgetOut(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId, mode: 'skip-all' | 'skip-idle'): void {
  const lane = laneFor(run, stage, providerId);
  if (lane.budgetOut !== 'none') return;
  lane.budgetOut = mode;
  markRemaining(ctx, run, stage, providerId, 'budget', lane.inFlight);
  lane.controller.abort();
}

/**
 * Spec §8.1 error table, BudgetExceeded rows:
 * - execution-*: in-flight siblings aborted → not_run; paused_budget, no one-shot job.
 * - provider-month / provider-lifetime: that provider's remaining cells in the stage skipped:budget;
 *   others remain → continue and notify once; none remain → paused_budget, resume_after = the
 *   provider's next window start (a lifetime window has none, so no one-shot job).
 * - global-month: billed providers' remaining cells skipped:budget, in-flight billed siblings
 *   aborted → not_run; a free provider remains → continue; else paused_budget at the global window start.
 * BudgetExceeded is never recorded as a cell error.
 */
export function applyBudgetBreach(ctx: EngineContext, run: RunState, providerId: ProviderId, stage: Stage, err: BudgetExceeded): void {
  run.log.child({ providerId }).warn({ stage, scope: err.scope, cap: err.cap, current: err.current, requested: err.requested }, 'budget cap reached');
  if (err.scope === 'execution-calls' || err.scope === 'execution-free-calls' || err.scope === 'execution-cost') {
    stopRun(run, { kind: 'budget', error: err, resumeAfter: null });
    return;
  }
  const ids = stageProviders(run, stage);
  const global = err.scope === 'global-month';
  const affected = global ? ids.filter((id) => ctx.limitsOf(id).billed) : [providerId];
  for (const id of affected) budgetOut(ctx, run, stage, id, global ? 'skip-idle' : 'skip-all');
  const remaining = ids.filter((id) => !run.disabled.has(id) && laneFor(run, stage, id).budgetOut === 'none');
  if (remaining.length === 0) {
    const scope: BudgetScope = global ? { kind: 'global-month' } : { kind: err.scope, providerId };
    stopRun(run, { kind: 'budget', error: err, resumeAfter: ctx.budget.usage(scope).windowEnd });
    return;
  }
  run.notices.push({ kind: 'provider_disabled', detail: `${affected.join(', ')} reached the ${err.scope} cap; remaining ${stage} cells are skipped (budget) and the other providers continue.` });
}

/** After a lane's pool drains: finish budget and disable marking (spec §8.1 "remaining cells …"). */
export function settleLane(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId): void {
  if (laneFor(run, stage, providerId).budgetOut === 'skip-all') markRemaining(ctx, run, stage, providerId, 'budget');
  if (run.disabled.has(providerId)) markRemaining(ctx, run, stage, providerId, 'provider_disabled');
}
```

`src/stages/discovery.ts` and `src/stages/verification.ts`: replace the last line of `runDiscoveryProvider` / `runVerificationProvider` (`if (run.disabled.has(providerId)) markRemaining(…)`) with `settleLane(ctx, run, 'discovery', providerId);` / `settleLane(ctx, run, 'verification', providerId);`, and import `settleLane` from `../run.js` (drop `markRemaining` from the discovery import if unused).

`src/execute.ts`: in `finish`, replace the `notices` line with:

```ts
  const notices = notice === null ? [...run.notices] : [...run.notices, notice];
  // why: spec §6.8/§8.1 "When verification is budget-skipped the operator is told 'alerts running on calendar basis only'"
  if (ctx.repos.cells.outcomes(run.executionId, { stage: 'verification', status: 'skipped' }).some((o) => o.reason === 'budget')) {
    notices.push({ kind: 'alerts_calendar_only', detail: 'Verification was skipped for budget in this run, so only calendar prices were checked against alert rules.' });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- budget-breach error-table-discovery error-table-verification`
Expected: PASS, 31 tests (5 + 16 + 10).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: per-scope budget breaches, sibling aborts, calendar-only alert notice

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.11: `parseCron` — the single croner wrapper

**Files:**
- Create: `packages/engine/src/scheduler/parseCron.ts`, `test/parse-cron.test.ts`

**Interfaces:**
- Consumes: `croner` 10 (`Cron`, `nextRun`, `previousRuns`), `Intl.DateTimeFormat`.
- Produces: `parseCron(expr, tz)` exactly as the contract; `isValidTimeZone(tz)`; `previousFiring(expr, tz, before)`; `runsPerMonth(expr, tz, from)`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/parse-cron.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isValidTimeZone, parseCron, previousFiring, runsPerMonth } from '../src/scheduler/parseCron.js';

const next = (expr: string, tz: string, from: string) => {
  const p = parseCron(expr, tz);
  if (!p.ok) throw new Error(p.reason);
  return p.next(new Date(from))?.toISOString() ?? null;
};
const reason = (expr: string, tz = 'Europe/London') => {
  const p = parseCron(expr, tz);
  return p.ok ? null : p.reason;
};

describe('parseCron (spec §8.2: the sole semantic validator; sub-hourly rejected; tz validated)', () => {
  it('evaluates in the schedule tz across both UK DST changes', () => {
    expect(next('0 5 * * 1', 'Europe/London', '2027-03-28T12:00:00.000Z')).toBe('2027-03-29T04:00:00.000Z'); // 05:00 BST
    expect(next('0 5 * * 1', 'Europe/London', '2026-10-24T12:00:00.000Z')).toBe('2026-10-26T05:00:00.000Z'); // 05:00 GMT
    expect(next('0 5 * * 1', 'America/New_York', '2026-10-14T09:00:00.000Z')).toBe('2026-10-19T09:00:00.000Z'); // 05:00 EDT
  });
  it('accepts hourly and slower', () => {
    expect(reason('15 * * * *')).toBeNull();
    expect(reason('0 5 1 * *')).toBeNull();
  });
  it.each([
    ['*/15 * * * *', 'at most once an hour'],
    ['0,30 5 * * *', 'at most once an hour'],
    ['* 5 * * *', 'at most once an hour'],
    ['61 5 * * *', 'at most once an hour'],
    ['0 5 * *', 'five fields'],
    ['0 0 5 * * 1', 'five fields'],
    ['0 25 * * *', 'not a valid schedule'],
  ])('rejects %s', (expr, why) => {
    expect(reason(expr)).toContain(why);
  });
  it('rejects an unknown time zone', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(reason('0 5 * * 1', 'Mars/Olympus')).toBe('unknown time zone "Mars/Olympus"');
  });
});

describe('previousFiring and runsPerMonth', () => {
  it('finds the last scheduled firing before an instant (spec §8.2 skipped_missed)', () => {
    expect(previousFiring('0 5 * * 1', 'Europe/London', new Date('2026-10-14T09:00:00.000Z'))?.toISOString()).toBe('2026-10-12T04:00:00.000Z');
  });
  it('counts firings over the next year, per month, rounded up (spec §8.2 budgetFit)', () => {
    const from = new Date('2026-10-14T09:00:00.000Z');
    expect(runsPerMonth('0 5 * * 1', 'Europe/London', from)).toBe(5);
    expect(runsPerMonth('0 6 * * *', 'Europe/London', from)).toBe(31);
    expect(runsPerMonth(null, 'Europe/London', from)).toBe(0);
    expect(runsPerMonth('*/5 * * * *', 'Europe/London', from)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- parse-cron`
Expected: FAIL, `Cannot find module '../src/scheduler/parseCron.js'`.

- [ ] **Step 3: Implement**

`src/scheduler/parseCron.ts`:

```ts
import { Cron } from 'croner';

/** True when `tz` is an IANA zone this runtime knows (spec §8.2 "tz validated"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type ParsedCron = { ok: true; next: (from: Date) => Date | null } | { ok: false; reason: string };

function validated(expr: string, tz: string): { ok: true; job: Cron } | { ok: false; reason: string } {
  if (!isValidTimeZone(tz)) return { ok: false, reason: `unknown time zone "${tz}"` };
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return { ok: false, reason: 'a schedule has five fields: minute hour day-of-month month day-of-week' };
  const minute = fields[0] ?? '';
  // why: spec §8.2 "sub-hourly rejected". With one fixed minute a pattern fires at most once an hour,
  // whatever the other fields say; every list, range or step in the minute field could fire more often.
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59) return { ok: false, reason: 'schedules may run at most once an hour: the minute field must be a single number 0–59' };
  try {
    // why: no callback, so croner schedules nothing; paused for clarity; mode '5-part' refuses seconds and years
    return { ok: true, job: new Cron(fields.join(' '), { timezone: tz, paused: true, mode: '5-part' }) };
  } catch (err) {
    return { ok: false, reason: `not a valid schedule: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * The single croner wrapper (spec §4, §8.2). `api` imports it to validate a definition's cron and
 * tz; `core` has no cron parser. `next(from)` is the first firing strictly after `from`.
 */
export function parseCron(expr: string, tz: string): ParsedCron {
  const v = validated(expr, tz);
  if (!v.ok) return v;
  const job = v.job;
  return { ok: true, next: (from) => job.nextRun(from) };
}

/** The last scheduled firing strictly before `before`, or null (spec §8.2 "the last scheduled firing was missed"). */
export function previousFiring(expr: string, tz: string, before: Date): Date | null {
  const v = validated(expr, tz);
  if (!v.ok) return null;
  return v.job.previousRuns(1, before)[0] ?? null;
}

/** Firings over the next 365 days divided by 12, rounded up; 0 with no or an invalid schedule (spec §8.2 budgetFit). */
export function runsPerMonth(expr: string | null, tz: string, from: Date): number {
  if (expr === null) return 0;
  const p = parseCron(expr, tz);
  if (!p.ok) return 0;
  const end = from.getTime() + 365 * 86_400_000;
  let count = 0;
  let cursor = p.next(from);
  while (cursor !== null && cursor.getTime() <= end) {
    count += 1;
    cursor = p.next(new Date(cursor.getTime() + 1000)); // why: step past the firing so an inclusive nextRun cannot loop
  }
  return Math.ceil(count / 12);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- parse-cron`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: parseCron over croner 10 with sub-hourly and tz rejection

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.12: Estimate, `estimateRemaining`, `budgetFit`; parity and the overrun baseline

**Files:**
- Create: `packages/engine/src/estimate.ts`, `test/estimate.test.ts`
- Modify: `packages/engine/src/snapshot.ts` (`today` parameter), `src/start.ts` (store the estimate), `src/execute.ts` (parity check in `finish`)

**Interfaces:**
- Consumes: `planTiles`, `reusableFor`, `itineraryQuery`, `VerificationCapability.estimate`, `runsPerMonth`, `LedgerRepo.countsFor/overrun`, `apiContract.estimateResponseSchema`, `apiContract.budgetFitSchema`.
- Produces: `estimateStart(ctx, snapshot, cells, definitionId)`, `estimateRemainingFor(ctx, exec, manual)`, `budgetFitFor(ctx, def)`, `SECONDS_PER_CALL`; `buildSnapshot(ctx, def, trigger?, today?)`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/estimate.test.ts`:

```ts
import { type OperatorMessage, apiContract } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { budgetFitFor, estimateRemainingFor, estimateStart } from '../src/estimate.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { buildSnapshot } from '../src/snapshot.js';
import { itineraryQuery } from '../src/stages/verification.js';
import type { Estimate } from '../src/types.js';
import { type Harness, FIXTURE_COST_MICRO_GBP, JFK, LGW, LHR, createHarness, expectedTiles, verificationOf, withVerification } from './harness.js';
import { doubleFetch } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const HOUR = 3_600_000;
const orch = () => createOrchestrator(buildContext(h.deps, h.options));
const estimateOf = (defId: string) => {
  const ctx = buildContext(h.deps, h.options);
  const def = h.repos.definitions.get(defId);
  if (def === null) throw new Error('no definition');
  const b = buildSnapshot(ctx, def);
  return { est: estimateStart(ctx, b.snapshot, b.cells, def.id), snapshot: b.snapshot, cells: b.cells };
};

describe('estimate (spec §8.1 "Estimate")', () => {
  it('= Σ discovery plan length + maxCells × verification.estimate, all × ESTIMATE_RETRY_FACTOR; pre-factor plan kept', () => {
    h = createHarness();
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], providers: withVerification() });
    const { est, snapshot, cells } = estimateOf(def.id);
    const n = expectedTiles(h, def);
    const first = cells[0];
    if (first === undefined) throw new Error('the definition resolved to no cells');
    const per = verificationOf(h.fixture).estimate(itineraryQuery(snapshot, first));
    expect(est.prefactor).toEqual([
      { providerId: 'fixture', stage: 'discovery', calls: n },
      { providerId: 'fixture', stage: 'verification', calls: 2 * per.calls },
    ]);
    expect(est.perProvider[0]).toMatchObject({ calls: Math.ceil(n * 1.2), costMicroGbp: Math.ceil(n * FIXTURE_COST_MICRO_GBP * 1.2) });
    expect(est.perProvider[1]).toMatchObject({ calls: Math.ceil(2 * per.calls * 1.2), costMicroGbp: Math.ceil(2 * per.costMicroGbp * 1.2) });
    expect(est.totalCostMicroGbp).toBe((est.perProvider[0]?.costMicroGbp ?? 0) + (est.perProvider[1]?.costMicroGbp ?? 0));
    expect(est.totalCostPence).toBe(Math.ceil(est.totalCostMicroGbp / 10_000));
    expect(est.cells).toBe(cells.length);
    expect(est.assumptions[0]).toBe('every call count includes the retry factor 1.2');
    expect(apiContract.estimateResponseSchema.safeParse(est).success).toBe(true);
  });

  it('uses the same reuse query as the run: reusable cells are not planned', async () => {
    h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(orch(), def.id);
    h.clock.advance(HOUR);
    const soon = estimateOf(def.id).est;
    expect(soon.prefactor[0]?.calls).toBe(0);
    expect(soon.assumptions.some((a) => a.startsWith('fixture: 6 cells reuse earlier prices'))).toBe(true);
    h.clock.advance(151 * HOUR);
    expect(estimateOf(def.id).est.prefactor[0]?.calls).toBe(expectedTiles(h, def));
  });

  it('is stored on the execution at start', async () => {
    h = createHarness();
    const def = h.createDefinition();
    const e = await h.runToCompletion(orch(), def.id);
    expect((e.estimate as Estimate).prefactor).toEqual([{ providerId: 'fixture', stage: 'discovery', calls: expectedTiles(h, def) }]);
  });
});

describe('estimateRemaining (spec §8.1 "resumable tiles + remaining selected cells × estimate × factor")', () => {
  it('after an interrupt at k of n tiles, plans n − k', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] });
    const first = orch();
    h.onTileCommit((c) => {
      if (c === 2) void first.shutdown();
    });
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    const rem = estimateRemainingFor(buildContext(h.deps, h.options), e, true);
    expect(rem.prefactor).toEqual([{ providerId: 'fixture', stage: 'discovery', calls: expectedTiles(h, def) - 2 }]);
  });
});

describe('budgetFit (spec §8.2 "compares runsPerMonth × estimate with every cap and warns")', () => {
  it('weekly: five runs a month; fits under generous caps and parses as the api contract', () => {
    h = createHarness();
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const fit = budgetFitFor(buildContext(h.deps, h.options), def);
    expect(fit.runsPerMonth).toBe(5);
    expect(fit.fits).toBe(true);
    expect(fit.perScope.map((s) => s.scope)).toEqual(['execution-calls', 'execution-free-calls', 'execution-cost', 'provider-month:fixture', 'global-month']);
    expect(apiContract.budgetFitSchema.safeParse(fit).success).toBe(true);
  });
  it('warns when the monthly calls of a provider exceed its cap', () => {
    h = createHarness({ fixtureMonthlyCallCap: 3 });
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const fit = budgetFitFor(buildContext(h.deps, h.options), def);
    expect(fit.fits).toBe(false);
    expect(fit.perScope.find((s) => s.scope === 'provider-month:fixture')).toMatchObject({ cap: 3, fits: false });
  });
});

describe('parity and overrun (spec §8.1)', () => {
  it('an uninterrupted pass whose distinct tile requests equal the plan raises no parity notice', async () => {
    h = createHarness();
    await h.runToCompletion(orch(), h.createDefinition().id);
    expect(h.notifications).toHaveLength(0);
  });
  it('a pass that requests more distinct tiles than planned raises one parity_break notification', async () => {
    h = createHarness({ transformFixture: doubleFetch });
    const e = await h.runToCompletion(orch(), h.createDefinition().id);
    const parity = h.notifications.filter((m): m is OperatorMessage => 'kind' in m && m.kind === 'parity_break');
    expect(parity).toHaveLength(1);
    expect(parity[0]?.body).toContain(`Planned ${h.tileRequests(e.id) / 2} tile requests`);
  });
  it('the overrun flag compares ledger calls with the pre-factor plan, not the stored estimate', async () => {
    h = createHarness();
    const def = h.createDefinition();
    const e = await h.runToCompletion(orch(), def.id);
    const planned = (e.estimate as Estimate).prefactor.reduce((a, p) => a + p.calls, 0);
    expect(h.repos.ledger.overrun(e.id, planned)).toBe(false);
    h.spendLedger({ providerId: 'fixture', rows: Math.floor(planned * 0.1) + 1, costMicroGbpEach: 0, executionId: e.id });
    expect(h.repos.ledger.overrun(e.id, planned)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- estimate`
Expected: FAIL, `Cannot find module '../src/estimate.js'`.

- [ ] **Step 3: Implement**

`src/snapshot.ts`: change the signature to `export function buildSnapshot(ctx: EngineContext, def: SearchDefinition, trigger: Trigger = 'manual', today: IsoDate = ctx.clock.todayLondon()): BuiltSnapshot` and resolve with `resolveWindow(def.window, today)` (import `type IsoDate`).

`src/estimate.ts`:

```ts
import { type Cell, type CellKey, type DefinitionSnapshot, type ProviderId, type SearchDefinition, type SourceKind, type Stage, cellKeyString } from '@gmt/core';
import type { Execution } from '@gmt/db';
import type { EngineContext } from './context.js';
import { runsPerMonth } from './scheduler/parseCron.js';
import { buildSnapshot } from './snapshot.js';
import { planTiles } from './stages/discovery.js';
import { reusableFor } from './stages/reuse.js';
import { itineraryQuery } from './stages/verification.js';
import type { BudgetFit, Estimate } from './types.js';

/** Typical wall time per call by source kind (spec §2: SearchApi calendar 9–29 s; Travelpayouts about 1 s; the fixture is local). */
export const SECONDS_PER_CALL: Readonly<Record<SourceKind, number>> = { 'authorised-cached': 1, 'scraped-aggregate': 20, 'scraped-search': 15, synthetic: 0 };

interface Line { providerId: ProviderId; stage: Stage; rawCalls: number; rawCostMicroGbp: number; rawSeconds: number }

function assemble(ctx: EngineContext, lines: readonly Line[], cells: number, windowClamped: boolean, assumptions: readonly string[]): Estimate {
  const f = ctx.config.estimateRetryFactor;
  const perProvider = lines.map((l) => {
    const costMicroGbp = Math.ceil(l.rawCostMicroGbp * f);
    return { providerId: l.providerId, stage: l.stage, calls: Math.ceil(l.rawCalls * f), costMicroGbp, costPence: Math.ceil(costMicroGbp / 10_000), seconds: Math.ceil(l.rawSeconds * f) };
  });
  const totalCostMicroGbp = perProvider.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    cells, perProvider, totalCostMicroGbp, totalCostPence: Math.ceil(totalCostMicroGbp / 10_000),
    seconds: perProvider.reduce((a, p) => a + p.seconds, 0),
    assumptions: [`every call count includes the retry factor ${f}`, ...assumptions],
    windowClamped,
    prefactor: lines.map((l) => ({ providerId: l.providerId, stage: l.stage, calls: l.rawCalls })),
    blocked: [],
  };
}

function discoveryLine(ctx: EngineContext, snapshot: DefinitionSnapshot, providerId: ProviderId, cells: readonly CellKey[], definitionId: string | null, notes: string[]): Line | null {
  const cap = ctx.providers.get(providerId)?.discovery;
  if (cap === undefined) return null;
  const reused = definitionId === null ? new Map() : reusableFor(ctx, definitionId, snapshot, providerId, cap.info, cells);
  if (reused.size > 0) notes.push(`${providerId}: ${reused.size} cells reuse earlier prices and are not planned`);
  const fresh = cells.filter((c) => !reused.has(cellKeyString(c)));
  const tiles = fresh.length === 0 ? 0 : planTiles(cap, snapshot, fresh).length;
  const l = ctx.limitsOf(providerId);
  // why: spec §8.1 "seconds including limiter waits": the slower of the rate limit and the pool
  const seconds = Math.max(Math.ceil((tiles * 60) / l.ratePerMinute), Math.ceil((tiles * SECONDS_PER_CALL[cap.info.sourceKind]) / l.concurrency));
  return { providerId, stage: 'discovery', rawCalls: tiles, rawCostMicroGbp: tiles * l.costPerCallMicroGbp, rawSeconds: seconds };
}

function verificationLine(ctx: EngineContext, snapshot: DefinitionSnapshot, providerId: ProviderId, cellCount: number, sample: CellKey | undefined, notes: string[]): Line | null {
  const cap = ctx.providers.get(providerId)?.verification;
  if (cap === undefined || sample === undefined || cellCount === 0) return null;
  const per = cap.estimate(itineraryQuery(snapshot, sample));
  notes.push(`${providerId}: verification of up to ${cellCount} cells at ${per.calls} calls each${per.notes.length > 0 ? ` (${per.notes.join('; ')})` : ''}`);
  return { providerId, stage: 'verification', rawCalls: cellCount * per.calls, rawCostMicroGbp: cellCount * per.costMicroGbp, rawSeconds: Math.ceil((cellCount * per.seconds) / ctx.limitsOf(providerId).concurrency) };
}

/**
 * Spec §8.1 "Estimate = Σ discovery plan(q with cells = non-reused cells).length per pair, using the
 * same reuse query as the run, + maxCells × verification.estimate, all × ESTIMATE_RETRY_FACTOR".
 * A child execution plans one cell of verification and no discovery.
 */
export function estimateStart(ctx: EngineContext, snapshot: DefinitionSnapshot, cells: readonly Cell[], definitionId: string | null): Estimate {
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    const l = discoveryLine(ctx, snapshot, id, cells, definitionId, notes);
    if (l !== null) lines.push(l);
  }
  const verifyCount = Math.min(snapshot.verification.maxCells, cells.length);
  for (const id of snapshot.providers.verification) {
    const l = verificationLine(ctx, snapshot, id, verifyCount, cells[0], notes);
    if (l !== null) lines.push(l);
  }
  if (snapshot.windowClamped) notes.push('window clamped to start tomorrow');
  return assemble(ctx, lines, cells.length, snapshot.windowClamped, notes);
}

/** Spec §8.1 "estimateRemaining (resumable tiles + remaining selected cells × estimate × factor)". */
export function estimateRemainingFor(ctx: EngineContext, exec: Execution, manual: boolean): Estimate {
  const snapshot = exec.snapshot;
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    const cells = ctx.repos.cells.resumable(exec.id, 'discovery', id, manual);
    const l = discoveryLine(ctx, snapshot, id, cells, null, notes);
    if (l !== null) lines.push(l);
  }
  const seeded = ctx.repos.cells.outcomes(exec.id, { stage: 'verification' }).length > 0;
  const total = ctx.repos.cells.rollUps(exec.id).size;
  for (const id of snapshot.providers.verification) {
    const cells = seeded ? ctx.repos.cells.resumable(exec.id, 'verification', id, manual) : [];
    const count = seeded ? cells.length : Math.min(snapshot.verification.maxCells, total);
    const sample = cells[0] ?? exec.childCell ?? snapshot.verification.alwaysInclude[0] ?? firstCellOf(ctx, exec.id);
    const l = verificationLine(ctx, snapshot, id, count, sample, notes);
    if (l !== null) lines.push(l);
  }
  return assemble(ctx, lines, total, snapshot.windowClamped, notes);
}

function firstCellOf(ctx: EngineContext, executionId: string): CellKey | undefined {
  const first = ctx.repos.cells.outcomes(executionId)[0];
  return first === undefined ? undefined : { origin: first.origin, destination: first.destination, departureDate: first.departureDate, returnDate: first.returnDate };
}

/**
 * Spec §8.2 "budgetFit at save time compares runsPerMonth × estimate with every cap and warns".
 * Execution scopes compare one run; monthly scopes compare runsPerMonth runs (global adds each
 * enabled subscription's fixed fee once, spec §5.3).
 */
export function budgetFitFor(ctx: EngineContext, def: SearchDefinition): BudgetFit {
  const built = buildSnapshot(ctx, def, 'schedule');
  const est = estimateStart(ctx, built.snapshot, built.cells, def.id);
  const runs = runsPerMonth(def.scheduleCron, def.scheduleTz, new Date(ctx.clock.now()));
  const billed = est.perProvider.filter((p) => ctx.limitsOf(p.providerId).billed);
  const free = est.perProvider.filter((p) => !ctx.limitsOf(p.providerId).billed);
  const sum = (xs: typeof est.perProvider, f: (p: (typeof est.perProvider)[number]) => number) => xs.reduce((a, p) => a + f(p), 0);
  const perScope: BudgetFit['perScope'] = [];
  const scope = (name: string, estimated: number, cap: number | null) => perScope.push({ scope: name, estimated, cap, fits: cap === null || estimated <= cap });
  scope('execution-calls', sum(billed, (p) => p.calls), def.budget.maxCalls);
  scope('execution-free-calls', sum(free, (p) => p.calls), def.budget.maxFreeCalls);
  scope('execution-cost', sum(billed, (p) => p.costMicroGbp), def.budget.maxCostMicroGbp);
  for (const id of new Set(est.perProvider.map((p) => p.providerId))) {
    const l = ctx.limitsOf(id);
    scope(`${l.window === 'lifetime' ? 'provider-lifetime' : 'provider-month'}:${id}`, runs * sum(est.perProvider.filter((p) => p.providerId === id), (p) => p.calls), l.monthlyCallCap);
  }
  const fixed = [...ctx.providers.keys()].filter((id) => ctx.limitsOf(id).billed).reduce((a, id) => a + ctx.limitsOf(id).planFixedMicroGbp, 0);
  scope('global-month', fixed + runs * sum(billed, (p) => p.costMicroGbp), ctx.config.spend.monthlyCapMicroGbp);
  return { fits: perScope.every((s) => s.fits), runsPerMonth: runs, perScope };
}
```

`src/start.ts`: compute and store the estimate (import `estimateStart` from `./estimate.js`):

```ts
  const estimate = estimateStart(ctx, built.snapshot, built.cells, def.id);
```

placed after `buildSnapshot`, and pass `estimate` instead of `null` to `executions.create`.

`src/execute.ts`: add the parity check and call it from `finish` when the pass completed (`stop === null`), pushing its notice before the calendar-only check:

```ts
/**
 * Spec §8.1 "Parity = distinct tile requests (first-attempt ledger rows + cache hits) for one
 * uninterrupted pass = plan length; a parity break raises an operator notification".
 */
export function parityNotice(ctx: EngineContext, run: RunState): { kind: OperatorKind; detail: string } | null {
  // why: parity is defined for one uninterrupted pass; a disabled or budget-capped provider stops
  // requesting its planned tiles by design, which is not a parity break
  const curtailed = run.disabled.size > 0 || [...run.lanes.values()].some((l) => l.budgetOut !== 'none');
  if (!run.fresh || run.stop !== null || run.plannedTiles === 0 || curtailed) return null;
  const c = ctx.repos.ledger.countsFor(run.executionId);
  const distinct = c.tiles + c.cacheHits;
  if (distinct === run.plannedTiles) return null;
  run.log.warn({ planned: run.plannedTiles, distinct }, 'parity break');
  return { kind: 'parity_break', detail: `Planned ${run.plannedTiles} tile requests; the ledger shows ${distinct} (first attempts plus cache hits).` };
}
```

and in `finish`, directly after the `notices` array is built:

```ts
  const parity = parityNotice(ctx, run);
  if (parity !== null) notices.push(parity);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- estimate`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: estimate with reuse and retry factor, estimateRemaining, budgetFit, parity notice

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.13: Pre-start checks per scope, `SOFT_CONFIRM`, `confirmed_cost_pence`, `skipped_*`

**Files:**
- Create: `packages/engine/src/budgetCheck.ts`, `test/prestart.test.ts`
- Modify: `packages/engine/src/start.ts` (replace `startExecution`, add `recordSkipped`, `formatPence`), `src/context.ts` (`EngineHooks.unregisterSchedule`)

**Interfaces:**
- Consumes: `BudgetGuard.usage(scope)`, `estimateStart`, `markRemaining`, `notifyOperator`, `DefinitionsRepo.update/setConfirmedCost`.
- Produces: `checkBudget(ctx, spend, budget, executionId)`, `spendOf(estimate)`, `breachMessage(breaches)`, `recordSkipped(ctx, def, snapshot, estimate, status, detail)`, `formatPence(p)`; `EngineHooks.unregisterSchedule(definitionId)`; the `StartResult` codes `active`, `cap`, `confirm`, `window`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/prestart.test.ts`:

```ts
import { type OperatorMessage, asIsoDate } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import type { Estimate } from '../src/types.js';
import { type Harness, JFK, LHR, RESPONSES, createHarness } from './harness.js';
import { freeStubProvider } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const kinds = () => h.notifications.filter((m): m is OperatorMessage => 'kind' in m).map((m) => m.kind);
const executions = (defId: string) => h.repos.executions.listForDefinition(defId, {});
const both = { discovery: ['fixture', 'travelpayouts'] as const, verification: ['fixture'] as const, discoveryRefreshHours: {} };

describe('pre-start checks (spec §8.1 "for every scope check usage(scope) + estimate(scope) ≤ cap")', () => {
  it('active: a second start while one is active → code active', async () => {
    h = createHarness();
    h.scenario({ match: (r) => r.kind === 'calendar', respond: RESPONSES.hold, times: 100 });
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const def = h.createDefinition();
    const first = await orch.start(def.id, { trigger: 'manual' });
    expect(first.ok).toBe(true);
    expect(await orch.start(def.id, { trigger: 'manual' })).toMatchObject({ ok: false, code: 'active' });
    h.releaseHolds();
    if (first.ok) await h.waitForSettled(first.executionId);
  });

  it('cap: nothing can run → code cap naming the cap and the numbers; no execution is created', async () => {
    h = createHarness();
    const def = h.createDefinition({ budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    const r = await createOrchestrator(buildContext(h.deps, h.options)).start(def.id, { trigger: 'manual' });
    expect(r).toMatchObject({ ok: false, code: 'cap' });
    if (!r.ok) expect(r.message).toMatch(/^spend cap: execution-calls cap 0, used 0, this run needs \d+$/);
    expect(executions(def.id)).toHaveLength(0);
  });

  it('cap on a scheduled run → skipped_budget recorded and notified', async () => {
    h = createHarness();
    const def = h.createDefinition({ budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    expect(await createOrchestrator(buildContext(h.deps, h.options)).start(def.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'cap' });
    const [e] = executions(def.id);
    expect(e).toMatchObject({ status: 'skipped_budget' });
    expect(e?.finishedAt).toBe(h.clock.now());
    expect(kinds()).toEqual(['skipped_budget']);
  });

  it('a breach on a billed scope seeds that provider skipped:budget and the run proceeds with the free provider', async () => {
    h = createHarness({ extraProviders: (t) => [freeStubProvider(t)] });
    const always = { origin: LHR, destination: JFK, departureDate: asIsoDate('2026-11-02'), returnDate: asIsoDate('2026-11-09') };
    const def = h.createDefinition({ providers: { ...both, discovery: [...both.discovery], verification: [...both.verification] }, budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 }, verification: { maxCells: 2, topN: 2, alwaysInclude: [always], expandTop: 1, bookingLinks: true } });
    const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), def.id);
    expect(e.status).toBe('completed');
    expect((e.estimate as Estimate).blocked).toEqual(['fixture']);
    expect(h.outcomes(e.id, { stage: 'discovery', providerId: 'fixture' }).every((o) => o.status === 'skipped' && o.reason === 'budget')).toBe(true);
    expect(h.outcomes(e.id, { providerId: 'travelpayouts' }).every((o) => o.status === 'no_data')).toBe(true);
    const selectedV = h.outcomes(e.id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');
    expect(selectedV).toEqual([expect.objectContaining({ status: 'skipped', reason: 'budget' })]);
    expect(h.ledgerRows(e.id).filter((r) => r.providerId === 'fixture')).toHaveLength(0);
    expect(kinds()).toEqual(['alerts_calendar_only']);
  });

  it('free providers always run: a zero global cap blocks only the billed provider', async () => {
    h = createHarness({ env: { MONTHLY_SPEND_CAP_PENCE: '0' }, extraProviders: (t) => [freeStubProvider(t)] });
    const def = h.createDefinition({ providers: { discovery: ['fixture', 'travelpayouts'], verification: [], discoveryRefreshHours: {} } });
    const e = await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), def.id);
    expect(e.status).toBe('completed');
    expect((e.estimate as Estimate).blocked).toEqual(['fixture']);
  });
});

describe('SOFT_CONFIRM and confirmed_cost_pence (spec §8.1, §7)', () => {
  it('a manual start above SOFT_CONFIRM needs confirmCostPence × 10 000 ≥ the estimate', async () => {
    h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const def = h.createDefinition();
    const r = await orch.start(def.id, { trigger: 'manual' });
    expect(r).toMatchObject({ ok: false, code: 'confirm' });
    const details = (r.ok ? null : r.details) as { estimateMicroGbp: number; estimatePence: number };
    expect(details.estimatePence).toBe(Math.ceil(details.estimateMicroGbp / 10_000));
    expect(await orch.start(def.id, { trigger: 'manual', confirmCostPence: details.estimatePence - 1 })).toMatchObject({ ok: false, code: 'confirm' });
    const ok = await orch.start(def.id, { trigger: 'manual', confirmCostPence: details.estimatePence });
    expect(ok.ok).toBe(true);
    if (ok.ok) await h.waitForSettled(ok.executionId);
  });

  it('a scheduled start uses only the stored confirmation; without it → skipped_confirm + notify', async () => {
    h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const def = h.createDefinition();
    const r = await orch.start(def.id, { trigger: 'schedule' });
    expect(r).toMatchObject({ ok: false, code: 'confirm' });
    expect(executions(def.id)[0]).toMatchObject({ status: 'skipped_confirm' });
    expect(kinds()).toEqual(['skipped_confirm']);
    const pence = ((r.ok ? null : r.details) as { estimatePence: number }).estimatePence;
    h.repos.definitions.setConfirmedCost(def.id, pence);
    const again = await orch.start(def.id, { trigger: 'schedule' });
    expect(again.ok).toBe(true);
    if (again.ok) await h.waitForSettled(again.executionId);
    expect(h.repos.definitions.get(def.id)?.confirmedCostPence).toBe(pence); // never recomputed by the engine
  });
});

describe('zero-cell window (spec §6.1)', () => {
  it('manual → code window; scheduled → skipped_window, notified, schedule disabled and unregistered', async () => {
    h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    const unregister = vi.fn();
    ctx.hooks.unregisterSchedule = unregister;
    const orch = createOrchestrator(ctx);
    const def = h.createDefinition({ window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-03') }, scheduleCron: '0 5 * * 1' });
    expect(await orch.start(def.id, { trigger: 'manual' })).toMatchObject({ ok: false, code: 'window' });
    expect(executions(def.id)).toHaveLength(0);
    expect(await orch.start(def.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'window' });
    expect(executions(def.id)[0]).toMatchObject({ status: 'skipped_window' });
    expect(kinds()).toEqual(['skipped_window']);
    expect(h.repos.definitions.get(def.id)?.enabled).toBe(false);
    expect(unregister).toHaveBeenCalledWith(def.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- prestart`
Expected: FAIL: the `cap`, `confirm` and `window` cases start an execution (or seed zero cells) instead of refusing, and `unregister` is never called.

- [ ] **Step 3: Implement**

`src/context.ts`: add to `EngineHooks`

```ts
  /** Removes a definition's cron job; called when the engine itself disables a schedule (spec §6.1 zero-cell window). */
  unregisterSchedule(definitionId: string): void;
```

and `unregisterSchedule: () => undefined` to the default `hooks` object in `buildContext`.

`src/budgetCheck.ts`:

```ts
import type { BudgetScope, ExecutionBudget, ProviderId, Stage } from '@gmt/core';
import type { EngineContext } from './context.js';
import type { Estimate } from './types.js';

export interface PlannedSpend { providerId: ProviderId; stage: Stage; calls: number; costMicroGbp: number }
export interface Breach { scope: string; providerId: ProviderId | null; cap: number; current: number; estimated: number }
export interface BudgetCheck { blocked: Set<ProviderId>; breaches: Breach[] }

export function spendOf(e: Pick<Estimate, 'perProvider'>): PlannedSpend[] {
  return e.perProvider.map((p) => ({ providerId: p.providerId, stage: p.stage, calls: p.calls, costMicroGbp: p.costMicroGbp }));
}

/**
 * Spec §8.1 pre-start: for every scope, usage(scope) + estimate(scope) ≤ cap. A breach on a billed
 * scope (execution-calls, execution-cost, global-month) blocks every billed provider; a breach on
 * execution-free-calls blocks the free providers; a provider-month/lifetime breach blocks that
 * provider. A cap of 0 refuses any non-zero need; zero-cost needs pass (spec §5.3). With
 * `executionId` the execution scopes include what this execution already spent (resume).
 */
export function checkBudget(ctx: EngineContext, spend: readonly PlannedSpend[], budget: ExecutionBudget, executionId: string | null): BudgetCheck {
  const blocked = new Set<ProviderId>();
  const breaches: Breach[] = [];
  const billed = spend.filter((s) => ctx.limitsOf(s.providerId).billed);
  const free = spend.filter((s) => !ctx.limitsOf(s.providerId).billed);
  const ids = (xs: readonly PlannedSpend[]) => [...new Set(xs.map((s) => s.providerId))];
  const total = (xs: readonly PlannedSpend[], f: (s: PlannedSpend) => number) => xs.reduce((a, s) => a + f(s), 0);
  const check = (scope: string, providerId: ProviderId | null, cap: number | null, current: number, estimated: number, affected: readonly ProviderId[]) => {
    if (cap === null || estimated === 0) return;
    if (current + estimated > cap) {
      breaches.push({ scope, providerId, cap, current, estimated });
      for (const id of affected) blocked.add(id);
    }
  };
  const execUsage = (kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost') =>
    executionId === null ? { calls: 0, costMicroGbp: 0 } : ctx.budget.usage({ kind, executionId });
  check('execution-calls', null, budget.maxCalls, execUsage('execution-calls').calls, total(billed, (s) => s.calls), ids(billed));
  check('execution-free-calls', null, budget.maxFreeCalls, execUsage('execution-free-calls').calls, total(free, (s) => s.calls), ids(free));
  check('execution-cost', null, budget.maxCostMicroGbp, execUsage('execution-cost').costMicroGbp, total(billed, (s) => s.costMicroGbp), ids(billed));
  for (const id of ids(spend)) {
    const kind = ctx.limitsOf(id).window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
    const scope: BudgetScope = { kind, providerId: id };
    const u = ctx.budget.usage(scope);
    check(kind, id, u.cap, u.calls, total(spend.filter((s) => s.providerId === id), (s) => s.calls), [id]);
  }
  const g = ctx.budget.usage({ kind: 'global-month' });
  check('global-month', null, g.cap, g.costMicroGbp, total(billed, (s) => s.costMicroGbp), ids(billed));
  return { blocked, breaches };
}

/** "execution-calls cap 0, used 0, this run needs 7; …" — the 409 message names the cap and the numbers (spec §8.1). */
export function breachMessage(breaches: readonly Breach[]): string {
  return breaches.map((b) => `${b.scope}${b.providerId === null ? '' : ` (${b.providerId})`} cap ${b.cap}, used ${b.current}, this run needs ${b.estimated}`).join('; ');
}
```

`src/start.ts` — replace `startExecution` and add the helpers (imports: `checkBudget`, `spendOf`, `breachMessage` from `./budgetCheck.js`; `notifyOperator` from `./notify.js`; `markRemaining` from `./run.js`; `type DefinitionSnapshot`, `type SearchDefinition` from `@gmt/core`; `type Estimate` from `./types.js`):

```ts
/** Pence as pounds for operator text, integer arithmetic only. */
export function formatPence(p: number): string {
  return `£${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
}

/** Records a scheduled run that did not start (spec §7 statuses skipped_*), then notifies (spec §8.1). */
export async function recordSkipped(ctx: EngineContext, def: SearchDefinition, snapshot: DefinitionSnapshot, estimate: Estimate | null, status: 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed', detail: string): Promise<string> {
  const exec = ctx.repos.executions.create({ definitionId: def.id, snapshot, status, estimate });
  ctx.repos.executions.setStatus(exec.id, status, { finishedAt: ctx.clock.now() });
  await notifyOperator(ctx, status, { executionId: exec.id, definitionId: def.id, definitionName: def.name, detail });
  ctx.log.info({ executionId: exec.id, definitionId: def.id, status }, 'execution: scheduled run not started');
  return exec.id;
}

/**
 * Spec §8.1 pre-start (scheduler tick and POST) then start. Order: active → window → per-scope
 * budget (a provider-specific or billed breach seeds that provider skipped:budget; only when nothing
 * can run is the start refused) → SOFT_CONFIRM against what will run → snapshot, seed, run.
 */
export async function startExecution(ctx: EngineContext, reg: RunRegistry, definitionId: string, opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number }): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null) throw new Error(`definition ${definitionId} not found`); // why: WP8 answers 404 before calling start
  if (ctx.repos.executions.activeParent(def.id) !== null) return refused('active', 'another execution of this definition is active', { definitionId });
  const scheduled = opts.trigger === 'schedule';
  const built = buildSnapshot(ctx, def, opts.trigger);
  const { snapshot, cells } = built;

  if (cells.length === 0) {
    const message = `the window resolves to no departure dates (${snapshot.resolved.departureFrom} to ${snapshot.resolved.departureTo})`;
    if (scheduled) {
      await recordSkipped(ctx, def, snapshot, null, 'skipped_window', `The ${message}; the schedule is disabled.`);
      ctx.repos.definitions.update(def.id, { enabled: false }); // why: spec §6.1 "record skipped_window … and disable the schedule"
      ctx.hooks.unregisterSchedule(def.id);
    }
    return refused('window', message, { departureFrom: snapshot.resolved.departureFrom, departureTo: snapshot.resolved.departureTo });
  }

  const estimate = estimateStart(ctx, snapshot, cells, def.id);
  const check = checkBudget(ctx, spendOf(estimate), snapshot.budget, null);
  const all = [...new Set([...snapshot.providers.discovery, ...snapshot.providers.verification])];
  estimate.blocked = all.filter((id) => check.blocked.has(id));
  if (all.length === 0 || all.every((id) => check.blocked.has(id))) {
    const message = all.length === 0 ? 'no configured provider can run this definition' : `spend cap: ${breachMessage(check.breaches)}`;
    if (scheduled) await recordSkipped(ctx, def, snapshot, estimate, 'skipped_budget', message);
    return refused('cap', message, { breaches: check.breaches });
  }

  // why: confirmation is about what will actually be spent, so blocked providers do not count
  const runnableCost = estimate.perProvider.filter((p) => !check.blocked.has(p.providerId)).reduce((a, p) => a + p.costMicroGbp, 0);
  if (runnableCost > ctx.config.spend.softConfirmMicroGbp) {
    const confirmed = scheduled ? (def.confirmedCostPence ?? undefined) : opts.confirmCostPence;
    if (confirmed === undefined || confirmed * 10_000 < runnableCost) {
      const estimatePence = Math.ceil(runnableCost / 10_000);
      const message = `the estimate of ${formatPence(estimatePence)} is above the confirmation threshold and has not been confirmed`;
      if (scheduled) await recordSkipped(ctx, def, snapshot, estimate, 'skipped_confirm', `The ${message}.`);
      return refused('confirm', message, { estimateMicroGbp: runnableCost, estimatePence });
    }
  }

  let exec: Execution;
  try {
    exec = ctx.repos.executions.create({ definitionId: def.id, snapshot, status: 'pending', estimate });
  } catch (err) {
    if (isUniqueViolation(err)) return refused('active', 'another execution of this definition is active', { definitionId });
    throw err;
  }
  const discovery = snapshot.providers.discovery;
  // why: spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start"; blocked providers are seeded skipped:budget in it
  ctx.db.transaction(() => {
    ctx.repos.cells.seed(exec.id, cells, discovery);
    for (const id of discovery) if (check.blocked.has(id)) markRemaining(ctx, { executionId: exec.id }, 'discovery', id, 'budget');
    ctx.repos.executions.setStatus(exec.id, 'running', { stage: discovery.length > 0 ? 'discovery' : 'verification' });
  });
  const run = newRun(ctx, { ...exec, status: 'running' }, { manual: false, fresh: true, blocked: new Set(estimate.blocked) });
  run.log.info({ trigger: opts.trigger, cells: cells.length, notes: built.notes, blocked: estimate.blocked }, 'execution: started');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
```

`src/run.ts` `runnableCells`: a pass whose `blocked` holds the provider must not fetch its `skipped:budget` cells; replace it with:

```ts
/**
 * Cells of (stage, provider) this pass should fetch: the spec §7 resume query, with skipped:budget
 * cells only when the provider is not blocked for this pass and has headroom now (spec §7
 * "skipped:budget when headroom exists").
 */
export function runnableCells(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId): CellKey[] {
  if (run.disabled.has(providerId)) return [];
  const cells = ctx.repos.cells.resumable(run.executionId, stage, providerId, run.manual);
  const budgetSkipped = new Set(ctx.repos.cells.outcomes(run.executionId, { stage, providerId, status: 'skipped' }).filter((o) => o.reason === 'budget').map(cellKeyString));
  if (budgetSkipped.size === 0) return cells;
  const headroom = !run.blocked.has(providerId) && !checkBudget(ctx, [{ providerId, stage, calls: 1, costMicroGbp: ctx.limitsOf(providerId).costPerCallMicroGbp }], run.snapshot.budget, run.executionId).blocked.has(providerId);
  return headroom ? cells : cells.filter((c) => !budgetSkipped.has(cellKeyString(c)));
}
```

(importing `checkBudget` from `./budgetCheck.js`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- prestart estimate budget-breach seeding`
Expected: PASS, 32 tests (8 + 9 + 5 + 5; note the seeding file's `alwaysInclude` and schedule tests start with a manual or schedule trigger and still pass).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: pre-start checks per scope with StartResult codes, SOFT_CONFIRM, skipped_* records

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.14: Resume semantics — compare-and-set, cap check on what remains, `departed`, manual re-enable, retry-errors

**Files:**
- Create: `packages/engine/test/resume.test.ts`
- Modify: `packages/engine/src/resume.ts` (replace `resumeExecution`)

**Interfaces:**
- Consumes: `ExecutionsRepo.claimResume/activeParent/activeChild`, `CellsRepo.markDeparted/resumable`, `estimateRemainingFor`, `checkBudget`.
- Produces: the final `resumeExecution(ctx, reg, executionId, { manual })`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/resume.test.ts`:

```ts
import { asIsoDateTime, cellKeyString } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, FIXTURE_COST_MICRO_GBP, JFK, LGW, LHR, RESPONSES, createHarness } from './harness.js';

let h: Harness;
afterEach(() => h.close());
const orch = () => createOrchestrator(buildContext(h.deps, h.options));
const twoPairs = (patch = {}) => h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });

async function interruptedAfter(k: number, def = twoPairs()): Promise<string> {
  const first = orch();
  h.onTileCommit((n) => {
    if (n === k) void first.shutdown();
  });
  const r = await first.start(def.id, { trigger: 'manual' });
  if (!r.ok) throw new Error(r.message);
  await h.waitForSettled(r.executionId);
  h.clearHooks();
  return r.executionId;
}

describe('resume (spec §8.1 "Resume", §7 resume query)', () => {
  it('is a compare-and-set: of two concurrent resumes exactly one proceeds; the loser gets code active', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(1);
    const results = await Promise.all([orch().resume(id, { manual: false }), orch().resume(id, { manual: false })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([expect.objectContaining({ ok: false, code: 'active' })]);
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('refuses while another execution of the definition is active', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs();
    const id = await interruptedAfter(1, def);
    const o = orch();
    expect(await o.cancel(id)).toBe(true); // cancelled: resumable, no longer active
    h.scenario({ match: (r) => r.kind === 'calendar', respond: RESPONSES.hold, times: 100 });
    const other = await o.start(def.id, { trigger: 'manual' });
    expect(other.ok).toBe(true);
    expect(await o.resume(id, { manual: true })).toMatchObject({ ok: false, code: 'active' });
    h.releaseHolds();
    if (other.ok) await h.waitForSettled(other.executionId);
  });

  it('marks not_run cells whose departure date has arrived as skipped:departed and leaves searched cells alone', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(1);
    const searched = new Map(h.outcomes(id).filter((o) => o.status !== 'not_run').map((o) => [cellKeyString(o), o.status]));
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // today (London) = 2026-11-03
    expect(await orch().resume(id, { manual: false })).toEqual({ ok: true, executionId: id });
    await h.waitForSettled(id);
    for (const o of h.outcomes(id)) {
      const before = searched.get(cellKeyString(o));
      if (before !== undefined) expect(o.status).toBe(before);
      else if (o.departureDate <= '2026-11-03') expect(o).toMatchObject({ status: 'skipped', reason: 'departed' });
      else expect(['priced', 'empty', 'no_data']).toContain(o.status);
    }
  });

  it('manual resume re-enables a provider disabled for auth; automatic resume does not', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal === 1, respond: RESPONSES.auth });
    const e = await h.runToCompletion(orch(), twoPairs().id);
    expect(e.status).toBe('paused_error');
    const before = h.requests.length;
    const auto = await orch().resume(e.id, { manual: false });
    if (auto.ok) await h.waitForSettled(e.id);
    expect(h.requests.length).toBe(before); // nothing auth/quota/parse or provider_disabled is retried automatically
    if (auto.ok) h.repos.executions.setStatus(e.id, 'paused_error', { resumeAfter: null });
    expect(await orch().resume(e.id, { manual: true })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it('a completed execution with retryable errors resumes (retry-errors); without any it is refused', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal <= 3, respond: RESPONSES.upstream, times: 3 });
    const e = await h.runToCompletion(orch(), twoPairs().id);
    expect(e.status).toBe('completed');
    const errored = h.outcomes(e.id, { status: 'error' });
    expect(errored.length).toBeGreaterThan(0);
    expect(await orch().resume(e.id, { manual: false })).toEqual({ ok: true, executionId: e.id });
    await h.waitForSettled(e.id);
    for (const o of h.outcomes(e.id).filter((x) => errored.some((y) => cellKeyString(y) === cellKeyString(x)))) {
      expect(['priced', 'empty', 'no_data']).toContain(o.status);
      expect(o.attempts).toBe(2);
    }
    expect(await orch().resume(e.id, { manual: false })).toMatchObject({ ok: false, code: 'active', message: 'nothing left to retry on this execution' });
  });

  it('checks every scope against estimateRemaining: an exhausted execution cap refuses with code cap', async () => {
    h = createHarness({ fixtureConcurrency: 4 });
    const def = twoPairs({ budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) => h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }));
    const e = await h.runToCompletion(orch(), def.id);
    expect(e.status).toBe('paused_budget');
    const r = await orch().resume(e.id, { manual: true });
    expect(r).toMatchObject({ ok: false, code: 'cap' });
    if (!r.ok) expect(r.message).toContain('execution-calls');
  });

  it('skipped:budget cells are fetched once the window has headroom (paused_budget resumed at window start)', async () => {
    h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () => h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }));
    const e = await h.runToCompletion(orch(), twoPairs().id);
    expect(e.status).toBe('paused_budget');
    expect(await orch().resume(e.id, { manual: false })).toMatchObject({ ok: false, code: 'cap' });
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    h.clearHooks();
    expect(await orch().resume(e.id, { manual: false })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it('resume never rewrites priced, empty or no_data outcomes', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(2);
    const done = h.outcomes(id).filter((o) => o.status !== 'not_run').map((o) => ({ k: cellKeyString(o), fetchedAt: o.fetchedAt, attempts: o.attempts }));
    const write = vi.spyOn(h.repos.cells, 'writeTile');
    await orch().resume(id, { manual: true });
    await h.waitForSettled(id);
    const touched = new Set(write.mock.calls.flatMap(([, , w]) => w.outcomes.map((o) => cellKeyString(o.cell))));
    for (const d of done) expect(touched.has(d.k)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- resume.test`
Expected: FAIL: "refuses while another execution … is active", "marks … skipped:departed", "a completed execution … without any it is refused", "an exhausted execution cap refuses with code cap" and the window-headroom test fail against Task 7.1's `resumeExecution`.

- [ ] **Step 3: Implement**

`src/resume.ts` — replace `resumeExecution` (imports: `checkBudget`, `spendOf`, `breachMessage` from `./budgetCheck.js`; `estimateRemainingFor` from `./estimate.js`):

```ts
/**
 * Spec §8.1 "Resume": allowed on interrupted | paused_* | cancelled, and on completed when retryable
 * errors remain (retry-errors). It is a compare-and-set — the tick, the one-shot job, boot
 * auto-resume and /resume all go through it, so losers get code `active` (409). /resume is also
 * refused while another execution of the definition is active. The per-scope cap check uses
 * estimateRemaining. Before planning, not_run/skipped cells whose departure date has arrived become
 * skipped:departed (the repository leaves priced/empty/no_data untouched). A manual resume uses the
 * manual resume query, which re-enables providers disabled in the previous pass.
 */
export async function resumeExecution(ctx: EngineContext, reg: RunRegistry, executionId: string, opts: { manual: boolean }): Promise<StartResult> {
  const exec = ctx.repos.executions.get(executionId);
  if (exec === null) return refused('active', `execution ${executionId} not found`, { executionId });
  if (reg.get(executionId) !== undefined || !RESUMABLE_STATUSES.includes(exec.status)) {
    return refused('active', `execution is ${exec.status} and cannot be resumed`, { status: exec.status });
  }
  const other = exec.isChild && exec.childCell !== null ? ctx.repos.executions.activeChild(exec.definitionId, exec.childCell) : ctx.repos.executions.activeParent(exec.definitionId);
  if (other !== null && other.id !== exec.id) return refused('active', 'another execution of this definition is active', { activeExecutionId: other.id });
  const remaining = estimateRemainingFor(ctx, exec, opts.manual);
  const needed = remaining.perProvider.filter((p) => p.calls > 0);
  if (exec.status === 'completed' && needed.length === 0) return refused('active', 'nothing left to retry on this execution', { executionId });
  const check = checkBudget(ctx, spendOf(remaining), exec.snapshot.budget, exec.id);
  if (needed.length > 0 && needed.every((p) => check.blocked.has(p.providerId))) {
    return refused('cap', `spend cap: ${breachMessage(check.breaches)}`, { breaches: check.breaches });
  }
  if (!ctx.repos.executions.claimResume(executionId)) return refused('active', 'another resume claimed this execution first', { executionId });
  ctx.hooks.cancelResume(executionId); // why: spec §8.1 "cancelling the one-shot job in the same step"
  const departed = ctx.repos.cells.markDeparted(executionId, ctx.clock.todayLondon());
  const run = newRun(ctx, { ...exec, status: 'running' }, { manual: opts.manual, fresh: false, blocked: check.blocked });
  run.log.info({ manual: opts.manual, autoResumeCount: exec.autoResumeCount, departed, blocked: [...check.blocked] }, 'execution: resumed');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- resume`
Expected: PASS, 9 tests (8 in `resume.test.ts`, 1 in `resume-k-of-n.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: resume with compare-and-set, remaining-cap check, departed, manual re-enable, retry-errors

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.15: Single-cell verification — child executions and their place in results

**Files:**
- Create: `packages/engine/src/child.ts`, `test/child.test.ts`
- Modify: `packages/engine/src/snapshot.ts` (`childSnapshot`), `src/orchestrator.ts` (`verifyCell`)

**Interfaces:**
- Consumes: `ExecutionsRepo.create({ isChild, childCell })/activeChild/latestCompleted`, `ItinerariesRepo.observationsForDefinition/latestVerificationOutcomeForCell`, `AirportsRepo.exists`.
- Produces: `verifyCellExecution(ctx, reg, definitionId, cell)`, `childSnapshot(ctx, parent, cell)`, `Orchestrator.verifyCell`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/child.test.ts`:

```ts
import { asIsoDate, cellKeyString } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, JFK, LHR, RESPONSES, createHarness, noVerification, withVerification } from './harness.js';

let h: Harness;
afterEach(() => h.close());
const orch = () => createOrchestrator(buildContext(h.deps, h.options));
const cell = { origin: LHR, destination: JFK, departureDate: asIsoDate('2026-11-03'), returnDate: asIsoDate('2026-11-10') };

describe('single-cell verification (spec §8.1 "Single-cell verification", §6.7)', () => {
  it('needs no parent; creates a child that skips discovery with alwaysInclude = [cell], maxCells = 1 and CHILD_MAX_CALLS', async () => {
    h = createHarness();
    const def = h.createDefinition({ providers: withVerification() });
    const r = await orch().verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    expect(e).toMatchObject({ isChild: true, childCell: cell, status: 'completed' });
    expect(e.snapshot.providers.discovery).toEqual([]);
    expect(e.snapshot.verification).toMatchObject({ alwaysInclude: [cell], maxCells: 1, topN: 1 });
    expect(e.snapshot.budget.maxCalls).toBe(h.config.spend.childMaxCalls);
    expect(h.outcomes(e.id, { stage: 'discovery' })).toHaveLength(0);
    const v = h.outcomes(e.id, { stage: 'verification' });
    expect(v.map(cellKeyString)).toEqual([cellKeyString(cell)]);
    expect(['priced', 'empty']).toContain(v[0]?.status);
    expect(h.repos.cells.selected(e.id)).toEqual([{ ...cell, reason: 'always_include' }]);
  });

  it('allows at most one active child per cell', async () => {
    h = createHarness();
    h.scenario({ match: (r) => r.kind === 'itinerary', respond: RESPONSES.hold, times: 100 });
    const def = h.createDefinition({ providers: withVerification() });
    const o = orch();
    const first = await o.verifyCell(def.id, cell);
    expect(first.ok).toBe(true);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    expect(await o.verifyCell(def.id, cell)).toMatchObject({ ok: false, code: 'active' });
    const other = await o.verifyCell(def.id, { ...cell, returnDate: asIsoDate('2026-11-11') });
    expect(other.ok).toBe(true);
    h.releaseHolds();
    for (const r of [first, other]) if (r.ok) await h.waitForSettled(r.executionId);
  });

  it('refuses a cell outside the current space, and a definition without a verification provider, with code window', async () => {
    h = createHarness();
    const def = h.createDefinition({ providers: withVerification() });
    expect(await orch().verifyCell(def.id, { ...cell, departureDate: asIsoDate('2026-12-01'), returnDate: asIsoDate('2026-12-08') })).toMatchObject({ ok: false, code: 'window' });
    const plain = h.createDefinition({ providers: noVerification() });
    expect(await orch().verifyCell(plain.id, cell)).toMatchObject({ ok: false, code: 'window', message: 'this definition has no verification provider' });
  });

  it('its own execution cap: CHILD_MAX_CALLS = 0 refuses with code cap', async () => {
    h = createHarness({ env: { CHILD_MAX_CALLS: '0' } });
    const def = h.createDefinition({ providers: withVerification() });
    expect(await orch().verifyCell(def.id, cell)).toMatchObject({ ok: false, code: 'cap' });
  });

  it('is included in results inputs and newest-outcome reads; excluded from latest execution', async () => {
    h = createHarness();
    const def = h.createDefinition({ providers: withVerification() });
    const parent = await h.runToCompletion(orch(), def.id);
    h.clock.advance(3_600_000);
    const r = await orch().verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    const child = await h.waitForSettled(r.executionId);
    expect(h.repos.executions.latestCompleted(def.id)?.id).toBe(parent.id);
    const obs = h.repos.itineraries.observationsForDefinition(def.id, [child.id], child.snapshot.resolved, 'economy');
    expect(obs.length).toBeGreaterThan(0);
    expect(h.repos.itineraries.latestVerificationOutcomeForCell(def.id, cell)?.executionId).toBe(child.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- child`
Expected: FAIL, `o.verifyCell is not a function`.

- [ ] **Step 3: Implement**

`src/snapshot.ts` — add:

```ts
/**
 * Spec §8.1 single-cell verification: a child skips discovery, `alwaysInclude = [cell]`,
 * `maxCells = 1`, its own execution caps (CHILD_MAX_CALLS); provider and global caps are shared.
 */
export function childSnapshot(ctx: EngineContext, parent: DefinitionSnapshot, cell: CellKey): DefinitionSnapshot {
  const key = { origin: cell.origin, destination: cell.destination, departureDate: cell.departureDate, returnDate: cell.returnDate };
  return {
    ...parent,
    providers: { ...parent.providers, discovery: [] },
    verification: { ...parent.verification, alwaysInclude: [key], maxCells: 1, topN: 1 },
    budget: { maxCalls: ctx.config.spend.childMaxCalls, maxFreeCalls: ctx.config.spend.childMaxCalls, maxCostMicroGbp: parent.budget.maxCostMicroGbp },
  };
}
```

(import `type CellKey`).

`src/child.ts`:

```ts
import { type CellKey, cellKeyString } from '@gmt/core';
import type { Execution } from '@gmt/db';
import { breachMessage, checkBudget, spendOf } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { estimateStart } from './estimate.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { buildSnapshot, childSnapshot } from './snapshot.js';
import { isUniqueViolation, refused } from './start.js';
import type { StartResult } from './types.js';

/**
 * Spec §8.1 `POST /cells/verify`: validates that the cell is in generateCells(current resolved
 * space) and its airports exist, then creates a child execution (is_child = 1, cell columns set).
 * At most one active child per cell (the child partial unique index backs this up).
 */
export async function verifyCellExecution(ctx: EngineContext, reg: RunRegistry, definitionId: string, cell: CellKey): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null) throw new Error(`definition ${definitionId} not found`);
  const built = buildSnapshot(ctx, def, 'manual');
  if (built.snapshot.providers.verification.length === 0) return refused('window', 'this definition has no verification provider', { definitionId });
  const key = cellKeyString(cell);
  const match = built.cells.find((c) => cellKeyString(c) === key);
  if (match === undefined || !ctx.repos.airports.exists(cell.origin) || !ctx.repos.airports.exists(cell.destination)) {
    return refused('window', 'the cell is not in the current search space', { cell });
  }
  if (ctx.repos.executions.activeChild(def.id, cell) !== null) return refused('active', 'this cell is already being verified', { cell });
  const snapshot = childSnapshot(ctx, built.snapshot, match);
  const estimate = estimateStart(ctx, snapshot, [match], null);
  const check = checkBudget(ctx, spendOf(estimate), snapshot.budget, null);
  estimate.blocked = snapshot.providers.verification.filter((id) => check.blocked.has(id));
  if (snapshot.providers.verification.every((id) => check.blocked.has(id))) return refused('cap', `spend cap: ${breachMessage(check.breaches)}`, { breaches: check.breaches });
  let exec: Execution;
  try {
    exec = ctx.repos.executions.create({ definitionId: def.id, snapshot, status: 'pending', estimate, isChild: true, childCell: cell });
  } catch (err) {
    if (isUniqueViolation(err)) return refused('active', 'this cell is already being verified', { cell });
    throw err;
  }
  ctx.db.transaction(() => {
    ctx.repos.cells.seed(exec.id, [match], []);
    ctx.repos.executions.setStatus(exec.id, 'running', { stage: 'verification' });
  });
  const run = newRun(ctx, { ...exec, status: 'running' }, { manual: false, fresh: true, blocked: new Set(estimate.blocked) });
  run.log.info({ cell: key }, 'execution: child started');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
```

`src/orchestrator.ts`: add `verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;` to the interface (doc comment: "Spec §8.1 single-cell verification") and `verifyCell: (id, cell) => verifyCellExecution(ctx, reg, id, cell),` to the returned object.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- child verification`
Expected: PASS, 15 tests (5 + 10).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: single-cell verification as child executions

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.16: Review Focus 5 — a repository write that throws `SqliteError` during a tile

**Files:**
- Create: `packages/engine/test/sqlite-failure.test.ts`

**Interfaces:**
- Consumes: Task 7.4's `classifyFailure` (`fatal`) and Task 7.2's notifications; `Database.SqliteError` from `better-sqlite3` (test only).
- Produces: nothing new; this pins Review Focus 5.

- [ ] **Step 1: Write the test**

`packages/engine/test/sqlite-failure.test.ts`:

```ts
import type { OperatorMessage } from '@gmt/core';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, JFK, LGW, LHR, RESPONSES, createHarness } from './harness.js';

let h: Harness;
afterEach(() => h.close());

describe('Review Focus 5: SQLite busy or full during a tile write', () => {
  it('→ paused_error with the SQLite message, URL-free, in error_text; siblings → not_run; operator notified; no crash loop', async () => {
    h = createHarness({ fixtureConcurrency: 2 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal === 2, respond: RESPONSES.hold });
    h.beforeTileWrite((attempt) => {
      if (attempt === 1) throw new Database.SqliteError('database or disk is full (see https://user:pw@sqlite.example/full?db=/data/x.db)', 'SQLITE_FULL');
    });
    const orch = createOrchestrator(buildContext(h.deps, h.options));
    const r = await orch.start(h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] }).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.logs.some((l) => l.msg === 'unexpected failure; pausing')).toBe(true));
    h.releaseHolds();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBeNull();
    expect(e.errorText).toBe('database or disk is full (see https://sqlite.example/full)');
    expect(h.outcomes(e.id).every((o) => o.status === 'not_run')).toBe(true); // the failed write committed nothing; the sibling was aborted
    const msgs = h.notifications.filter((m): m is OperatorMessage => 'kind' in m);
    expect(msgs.map((m) => m.kind)).toEqual(['paused_error']);
    expect(msgs[0]?.body).toContain('database or disk is full');
    expect(msgs[0]?.body).not.toContain('pw@');
    expect(e.autoResumeCount).toBe(0); // a graceful pause, not a crash: boot will not count it as a restart
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @gmt/engine test -- sqlite-failure`
Expected: PASS, 1 test. A failure here means `commitTile`'s error escaped the worker's `try` or `classifyFailure` did not treat a non-provider error as `fatal`; fix in `src/stages/discovery.ts` or `src/errors.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/engine && git commit -m "wp07: review focus 5 - SqliteError during a tile write pauses with a URL-free error_text

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.17: Scheduler — croner jobs, re-registration, one-shot resume jobs, and the tick

**Files:**
- Create: `packages/engine/src/scheduler/scheduler.ts`, `src/tick.ts`, `test/scheduler.test.ts`, `test/tick.test.ts`
- Modify: `packages/engine/src/resume.ts` (`isStalePaused`), `src/orchestrator.ts` (`tick`)

**Interfaces:**
- Consumes: `croner` (`new Cron(pattern|Date, options, fn)`, `nextRun`, `stop`), `parseCron`, `refreshHoursOf`, `DEFAULT_REFRESH_HOURS`.
- Produces: `createScheduler(hooks, log): Scheduler` with `register`, `unregister`, `registerResume`, `cancelResume`, `registerSystem`, `jobs`, `definitionJobCount`, `stopAll`; `tickDefinition(ctx, orch, definitionId)`; `isStalePaused(exec, now)`; `Orchestrator.tick`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/scheduler.test.ts`:

```ts
import { type SearchDefinition, asIsoDateTime } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../src/scheduler/scheduler.js';
import { type LogLine, T0, baseDefinition, capturingLogger } from './harness.js';

const def = (patch: Partial<SearchDefinition> = {}): SearchDefinition => ({ ...baseDefinition(), id: 'def-1', createdAt: T0, updatedAt: T0, deletedAt: null, scheduleCron: '0 5 * * 1', ...patch });

let lines: LogLine[];
const hooks = { onTick: vi.fn(async () => undefined), onResumeDue: vi.fn(async () => undefined), onSystem: vi.fn(async () => undefined) };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2027-03-28T12:00:00.000Z')); // Sunday, the day of the UK spring change
  lines = [];
  for (const f of Object.values(hooks)) f.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('scheduler (spec §8.2: croner with timezone; re-registered on create, PUT, disable, enable and delete)', () => {
  it('registers with the definition tz and fires at the next local firing', async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def());
    expect(s.jobs()).toEqual([{ id: 'definition:def-1', kind: 'definition', definitionId: 'def-1', executionId: null, nextRun: '2027-03-29T04:00:00.000Z' }]);
    await vi.advanceTimersByTimeAsync(16 * 3_600_000 - 1000);
    expect(hooks.onTick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(hooks.onTick).toHaveBeenCalledExactlyOnceWith('def-1');
    s.stopAll();
  });

  it('re-registers on edit, removes on disable and delete, restores on enable', () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def());
    s.register(def({ scheduleCron: '0 6 * * 1' })); // PUT
    expect(s.jobs().map((j) => j.nextRun)).toEqual(['2027-03-29T05:00:00.000Z']);
    s.register(def({ enabled: false })); // disable
    expect(s.jobs()).toEqual([]);
    s.register(def()); // enable
    expect(s.definitionJobCount()).toBe(1);
    s.register(def({ deletedAt: asIsoDateTime('2027-03-28T12:00:00.000Z') })); // soft delete
    expect(s.jobs()).toEqual([]);
    s.register(def());
    s.unregister('def-1'); // DELETE
    expect(s.jobs()).toEqual([]);
  });

  it('never registers an invalid schedule and says why', () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def({ scheduleCron: '*/10 * * * *' }));
    expect(s.jobs()).toEqual([]);
    expect(lines.some((l) => l.msg === 'scheduler: invalid schedule not registered' && String(l.fields.reason).includes('at most once an hour'))).toBe(true);
  });

  it('one-shot resume jobs fire once at resume_after and can be cancelled (spec §8.1 limiter-timeout row)', async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.registerResume('exec-1', asIsoDateTime('2027-03-28T13:00:00.000Z'));
    s.registerResume('exec-2', asIsoDateTime('2027-03-28T13:00:00.000Z'));
    expect(s.jobs().filter((j) => j.kind === 'resume').map((j) => j.executionId)).toEqual(['exec-1', 'exec-2']);
    s.cancelResume('exec-2');
    await vi.advanceTimersByTimeAsync(3_600_000 + 1000);
    expect(hooks.onResumeDue).toHaveBeenCalledExactlyOnceWith('exec-1');
    expect(s.jobs()).toEqual([]);
  });

  it('a resume_after already in the past fires on the next turn of the event loop', async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.registerResume('exec-3', asIsoDateTime('2027-03-28T11:00:00.000Z'));
    await vi.advanceTimersByTimeAsync(1);
    expect(hooks.onResumeDue).toHaveBeenCalledExactlyOnceWith('exec-3');
  });

  it('system jobs are listed; stopAll stops everything', async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def());
    s.registerSystem('fx-refresh', '0 6 * * *', 'Europe/London');
    expect(s.jobs().map((j) => j.kind).sort()).toEqual(['definition', 'system']);
    s.stopAll();
    await vi.advanceTimersByTimeAsync(7 * 24 * 3_600_000);
    expect(hooks.onTick).not.toHaveBeenCalled();
    expect(hooks.onSystem).not.toHaveBeenCalled();
    expect(s.jobs()).toEqual([]);
  });

  it('a job whose hook rejects is logged and keeps its schedule', async () => {
    hooks.onTick.mockRejectedValueOnce(new Error('tick failed at https://x.example/a?b=c'));
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def());
    await vi.advanceTimersByTimeAsync(16 * 3_600_000 + 1000);
    expect(lines.find((l) => l.msg === 'scheduler: job failed')?.fields.err).toBe('tick failed at https://x.example/a');
    expect(s.jobs()[0]?.nextRun).toBe('2027-04-05T04:00:00.000Z');
    s.stopAll();
  });
});
```

`packages/engine/test/tick.test.ts`:

```ts
import { asIsoDateTime } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { type Harness, FIXTURE_COST_MICRO_GBP, JFK, LGW, LHR, RESPONSES, createHarness } from './harness.js';

let h: Harness;
afterEach(() => h.close());
const HOUR = 3_600_000;
const orch = () => createOrchestrator(buildContext(h.deps, h.options));
const twoPairs = () => h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], scheduleCron: '0 5 * * 1' });
const executions = (defId: string) => h.repos.executions.listForDefinition(defId, {});

describe('tick (spec §8.2 "A tick, in order")', () => {
  it('with nothing active, runs the pre-start checks and starts a scheduled run', async () => {
    h = createHarness();
    const def = twoPairs();
    await orch().tick(def.id);
    const [e] = executions(def.id);
    if (e === undefined) throw new Error('no execution');
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
  });

  it('with an execution active, records nothing and logs "schedule blocked since"', async () => {
    h = createHarness();
    h.scenario({ match: (r) => r.kind === 'calendar', respond: RESPONSES.hold, times: 100 });
    const def = twoPairs();
    const o = orch();
    const r = await o.start(def.id, { trigger: 'manual' });
    await o.tick(def.id);
    expect(executions(def.id)).toHaveLength(1);
    expect(h.logs.find((l) => l.msg === 'tick: schedule blocked by an active execution')?.fields).toMatchObject({ since: h.clock.now() });
    h.releaseHolds();
    if (r.ok) await h.waitForSettled(r.executionId);
  });

  it('resumes a paused_error once resume_after has passed, and not before', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal <= 3, respond: RESPONSES.limiterTimeout, times: 3 });
    const def = twoPairs();
    const e = await h.runToCompletion(orch(), def.id);
    expect(e.status).toBe('paused_error');
    await orch().tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_error');
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    await orch().tick(def.id);
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(executions(def.id)).toHaveLength(1);
  });

  it('resumes a paused_budget only when estimateRemaining passes the cap check (at the window start)', async () => {
    // why: start near the month end so the window start comes before the pause is older than
    // discoveryRefreshHours; an older pause is superseded by step (1) of the tick instead
    h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20, now: asIsoDateTime('2026-10-28T09:00:00.000Z') });
    h.onStageStart('discovery', () => h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }));
    const def = twoPairs();
    const e = await h.runToCompletion(orch(), def.id);
    h.clearHooks();
    expect(e.status).toBe('paused_budget');
    await orch().tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_budget');
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    await orch().tick(def.id);
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
  });

  it('cancels and supersedes a paused run older than discoveryRefreshHours whose resume_after is not in the future', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal === 1, respond: RESPONSES.auth });
    const def = twoPairs();
    const old = await h.runToCompletion(orch(), def.id);
    expect(old.status).toBe('paused_error');
    h.clock.advance(169 * HOUR);
    await orch().tick(def.id);
    expect(h.repos.executions.get(old.id)?.status).toBe('cancelled');
    const fresh = executions(def.id).find((x) => x.id !== old.id);
    if (fresh === undefined) throw new Error('no fresh execution');
    expect((await h.waitForSettled(fresh.id)).status).toBe('completed');
  });

  it('exempts a paused_budget whose resume_after is still in the future from the supersede', async () => {
    h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () => h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }));
    const def = twoPairs();
    const e = await h.runToCompletion(orch(), def.id);
    h.clearHooks();
    h.clock.advance(169 * HOUR); // 2026-10-21, before the 1 November window start
    await orch().tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_budget');
    expect(executions(def.id)).toHaveLength(1);
  });

  it('a disabled or deleted definition does nothing', async () => {
    h = createHarness();
    const def = twoPairs();
    h.repos.definitions.update(def.id, { enabled: false });
    await orch().tick(def.id);
    expect(executions(def.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine test -- scheduler tick`
Expected: FAIL, `Cannot find module '../src/scheduler/scheduler.js'` and `o.tick is not a function`.

- [ ] **Step 3: Implement**

`src/scheduler/scheduler.ts`:

```ts
import type { IsoDateTime, Logger, SearchDefinition } from '@gmt/core';
import { Cron } from 'croner';
import { errorText } from '../run.js';
import type { SchedulerJob } from '../types.js';
import { parseCron } from './parseCron.js';

export type SystemJob = 'fx-refresh' | 'maintenance';
export interface SchedulerHooks {
  onTick(definitionId: string): Promise<void>;
  onResumeDue(executionId: string): Promise<void>;
  onSystem(name: SystemJob): Promise<void>;
}
export interface Scheduler {
  /** (Re)registers a definition's cron job; removes it when disabled, deleted or unscheduled (spec §8.2). */
  register(def: SearchDefinition): void;
  unregister(definitionId: string): void;
  /** One-shot job at resume_after (spec §8.1); replaces any earlier one for the execution. */
  registerResume(executionId: string, at: IsoDateTime): void;
  cancelResume(executionId: string): void;
  registerSystem(name: SystemJob, cron: string, tz: string): void;
  jobs(): SchedulerJob[];
  definitionJobCount(): number;
  stopAll(): void;
}

/**
 * The croner scheduler (spec §8.2). Jobs call back into the engine through `hooks`; a rejected
 * hook is logged and the job keeps its schedule. `protect: true` stops a slow tick overlapping the
 * next one. Time is croner's (the process clock), which is what a schedule means.
 */
export function createScheduler(hooks: SchedulerHooks, log: Logger): Scheduler {
  const defs = new Map<string, Cron>();
  const resumes = new Map<string, { at: IsoDateTime; job: Cron | null; timer: ReturnType<typeof setTimeout> | null }>();
  const systems = new Map<SystemJob, Cron>();
  const fire = (job: string, fn: () => Promise<void>): void => {
    fn().catch((err: unknown) => log.error({ job, err: errorText(err) }, 'scheduler: job failed'));
  };
  const onCronError = (job: string) => (err: unknown) => log.error({ job, err: errorText(err) }, 'scheduler: job failed');

  const unregister = (definitionId: string): void => {
    defs.get(definitionId)?.stop();
    defs.delete(definitionId);
  };
  const cancelResume = (executionId: string): void => {
    const r = resumes.get(executionId);
    if (r === undefined) return;
    r.job?.stop();
    if (r.timer !== null) clearTimeout(r.timer);
    resumes.delete(executionId);
  };

  return {
    register(def) {
      unregister(def.id);
      if (!def.enabled || def.deletedAt !== null || def.scheduleCron === null) return;
      const p = parseCron(def.scheduleCron, def.scheduleTz);
      if (!p.ok) {
        log.warn({ definitionId: def.id, reason: p.reason }, 'scheduler: invalid schedule not registered');
        return;
      }
      const name = `definition:${def.id}`;
      const job = new Cron(def.scheduleCron, { timezone: def.scheduleTz, mode: '5-part', protect: true, catch: onCronError(name) }, () => fire(name, () => hooks.onTick(def.id)));
      defs.set(def.id, job);
      log.info({ definitionId: def.id, nextRun: job.nextRun()?.toISOString() ?? null }, 'scheduler: registered');
    },
    unregister,
    registerResume(executionId, at) {
      cancelResume(executionId);
      const name = `resume:${executionId}`;
      const due = () => {
        resumes.delete(executionId);
        fire(name, () => hooks.onResumeDue(executionId));
      };
      if (Date.parse(at) <= Date.now()) {
        // why: a resume_after already passed (e.g. found at boot) is due now; croner will not fire a past Date
        resumes.set(executionId, { at, job: null, timer: setTimeout(due, 0) });
        return;
      }
      resumes.set(executionId, { at, job: new Cron(new Date(at), { maxRuns: 1, catch: onCronError(name) }, due), timer: null });
    },
    cancelResume,
    registerSystem(name, cron, tz) {
      systems.get(name)?.stop();
      systems.set(name, new Cron(cron, { timezone: tz, mode: '5-part', protect: true, catch: onCronError(`system:${name}`) }, () => fire(`system:${name}`, () => hooks.onSystem(name))));
    },
    jobs() {
      const out: SchedulerJob[] = [];
      for (const [id, job] of defs) out.push({ id: `definition:${id}`, kind: 'definition', definitionId: id, executionId: null, nextRun: (job.nextRun()?.toISOString() ?? null) as IsoDateTime | null });
      for (const [id, r] of resumes) out.push({ id: `resume:${id}`, kind: 'resume', definitionId: null, executionId: id, nextRun: r.at });
      for (const [name, job] of systems) out.push({ id: `system:${name}`, kind: 'system', definitionId: null, executionId: null, nextRun: (job.nextRun()?.toISOString() ?? null) as IsoDateTime | null });
      return out;
    },
    definitionJobCount: () => defs.size,
    stopAll() {
      for (const id of [...defs.keys()]) unregister(id);
      for (const id of [...resumes.keys()]) cancelResume(id);
      for (const job of systems.values()) job.stop();
      systems.clear();
    },
  };
}
```

`src/resume.ts` — add (importing `type ExecutionStatus`, `type IsoDateTime` from `@gmt/core`, `type Execution` from `@gmt/db`, and `DEFAULT_REFRESH_HOURS`, `refreshHoursOf` from `./stages/reuse.js`):

```ts
const PAUSED: readonly ExecutionStatus[] = ['paused_budget', 'paused_error'];

/**
 * Spec §8.1/§8.2: "Any paused run older than discoveryRefreshHours whose resume_after is not in the
 * future is cancelled and a fresh run started". Age is from started_at; the refresh is the shortest
 * across the snapshot's discovery providers (168 h by default).
 */
export function isStalePaused(exec: Pick<Execution, 'status' | 'resumeAfter' | 'startedAt' | 'snapshot'>, now: IsoDateTime): boolean {
  if (!PAUSED.includes(exec.status)) return false;
  if (exec.resumeAfter !== null && exec.resumeAfter > now) return false;
  const ids = exec.snapshot.providers.discovery;
  const hours = ids.length === 0 ? DEFAULT_REFRESH_HOURS : Math.min(...ids.map((id) => refreshHoursOf(exec.snapshot, id)));
  return Date.parse(now) - Date.parse(exec.startedAt) > hours * 3_600_000;
}
```

`src/tick.ts`:

```ts
import type { EngineContext } from './context.js';
import type { Orchestrator } from './orchestrator.js';
import { isStalePaused } from './resume.js';

/**
 * Spec §8.2 tick, in order: (1) cancel and supersede a stale paused run; (2) resume a paused_error
 * whose resume_after has passed, or a paused_budget whose remaining estimate now passes the cap
 * check (both through the compare-and-set); (3) any other active execution blocks the schedule
 * ("schedule blocked since <date>"; a paused_error with no resume_after blocks until a manual
 * resume or the supersede); (4) otherwise pre-start checks and start.
 */
export async function tickDefinition(ctx: EngineContext, orch: Pick<Orchestrator, 'start' | 'resume' | 'cancel'>, definitionId: string): Promise<void> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null || !def.enabled) return;
  const log = ctx.log.child({ definitionId });
  const now = ctx.clock.now();
  const active = ctx.repos.executions.activeParent(def.id);
  if (active !== null) {
    if (isStalePaused(active, now)) {
      await orch.cancel(active.id);
      log.info({ executionId: active.id, startedAt: active.startedAt }, 'tick: superseded a stale paused run');
    } else if ((active.status === 'paused_error' && active.resumeAfter !== null && active.resumeAfter <= now) || active.status === 'paused_budget') {
      const r = await orch.resume(active.id, { manual: false });
      log.info({ executionId: active.id, status: active.status, result: r.ok ? 'resumed' : r.code }, 'tick: resume attempted');
      return;
    } else {
      log.info({ executionId: active.id, status: active.status, since: active.startedAt }, 'tick: schedule blocked by an active execution');
      return;
    }
  }
  const r = await orch.start(def.id, { trigger: 'schedule' });
  log.info({ result: r.ok ? 'started' : r.code, executionId: r.ok ? r.executionId : null }, 'tick: start');
}
```

`src/orchestrator.ts`: add `tick(definitionId: string): Promise<void>;` to the interface (doc: "Spec §8.2 tick") and build the object in two steps so the tick can call the orchestrator itself:

```ts
export function createOrchestrator(ctx: EngineContext): Orchestrator {
  const reg = createRegistry(ctx.log);
  const self: Orchestrator = {
    start: (id, opts) => startExecution(ctx, reg, id, opts),
    resume: (id, opts) => resumeExecution(ctx, reg, id, opts),
    verifyCell: (id, cell) => verifyCellExecution(ctx, reg, id, cell),
    cancel: async (id) => {
      const live = reg.get(id);
      if (live !== undefined) {
        stopRun(live, { kind: 'cancel' });
        await reg.done(id);
        return true;
      }
      const exec = ctx.repos.executions.get(id);
      if (exec === null || !ACTIVE_STATUSES.includes(exec.status)) return false;
      ctx.hooks.cancelResume(id); // why: spec §8.1 one-shot job "cancelled on cancel"
      ctx.repos.executions.setStatus(id, 'cancelled', { finishedAt: ctx.clock.now(), resumeAfter: null });
      return true;
    },
    tick: (id) => tickDefinition(ctx, self, id),
    shutdown: async () => {
      for (const run of reg.all()) stopRun(run, { kind: 'sigterm' });
      await reg.settleAll();
    },
    running: () => reg.all().map((r) => r.executionId),
  };
  return self;
}
```

(imports: `ACTIVE_STATUSES` from `@gmt/core`; `verifyCellExecution` from `./child.js`; `tickDefinition` from `./tick.js`.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine test -- scheduler tick`
Expected: PASS, 14 tests (7 + 7).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: croner scheduler with one-shot resume jobs; tick with supersede, resume and blocking

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.18: Coverage check, maintenance job, daily system jobs

**Files:**
- Create: `packages/engine/src/coverageCheck.ts`, `src/maintenance.ts`, `test/coverage-check.test.ts`

**Interfaces:**
- Consumes: the Travelpayouts provider when registered (`DiscoveryCapability.plan/fetchTile` with `executionId: null`), `resolveWindow`, `generateCells`, `monthOf`, `monthsSpanned`, `runMaintenance`, `refreshFx`.
- Produces: `coverageCheckFor(ctx, req)`, `countCachedRows(prices, months)`, `runMaintenanceJob(ctx)`, `runSystemJob(ctx, name)`, `FX_REFRESH_CRON`, `MAINTENANCE_CRON`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/coverage-check.test.ts`:

```ts
import { apiContract, asIsoDate, asIsoMonth } from '@gmt/core';
import { HttpResponse, http as mswHttp } from 'msw/http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { coverageCheckFor, countCachedRows } from '../src/coverageCheck.js';
import { runMaintenanceJob, runSystemJob } from '../src/maintenance.js';
import { type Harness, JFK, LGW, LHR, createHarness } from './harness.js';
import { freeStubProvider } from './wrappers.js';

let h: Harness;
afterEach(() => h.close());
const req = { origins: [LHR, LGW], destinations: [JFK], window: { kind: 'absolute' as const, from: asIsoDate('2026-11-02'), to: asIsoDate('2026-12-03') }, minNights: 7, maxNights: 8 };

describe('countCachedRows', () => {
  it('counts rows per departure month and lists every month of the window, zero included', () => {
    const months = [asIsoMonth('2026-11'), asIsoMonth('2026-12')];
    expect(countCachedRows([{ departureDate: asIsoDate('2026-11-05') }, { departureDate: asIsoDate('2026-11-30') }], months)).toEqual([
      { month: '2026-11', cachedRows: 2 },
      { month: '2026-12', cachedRows: 0 },
    ]);
  });
});

describe('coverage check (spec §10 "runs Travelpayouts month tiles (free, ledgered, subject to the free-call caps); never calls a billed provider")', () => {
  it('without Travelpayouts it calls nothing and says why', async () => {
    h = createHarness();
    const r = await coverageCheckFor(buildContext(h.deps, h.options), req);
    expect(r).toEqual({ pairs: [], calls: 0, notes: ['Travelpayouts is not configured; the coverage check reads its free cached data only.'] });
    expect(h.requests).toHaveLength(0);
    expect(apiContract.coverageCheckResponseSchema.safeParse(r).success).toBe(true);
  });

  it('with Travelpayouts it runs one pass of its tiles per pair, ledgered as free calls with no execution, and never touches the billed fixture', async () => {
    h = createHarness({ extraProviders: (t) => [freeStubProvider(t)] });
    const r = await coverageCheckFor(buildContext(h.deps, h.options), req);
    expect(r.pairs.map((p) => `${p.origin}-${p.destination}`)).toEqual(['LHR-JFK', 'LGW-JFK']);
    expect(r.pairs[0]?.months).toEqual([{ month: '2026-11', cachedRows: 0 }, { month: '2026-12', cachedRows: 0 }]);
    expect(r.calls).toBe(2);
    expect(h.requests).toHaveLength(0); // no fixture.local request
    const rows = h.db.raw.prepare(`SELECT provider_id AS p, execution_id AS e FROM provider_requests`).all();
    expect(rows).toEqual([{ p: 'travelpayouts', e: null }, { p: 'travelpayouts', e: null }]);
  });
});

describe('daily system jobs', () => {
  it('maintenance calls runMaintenance with the lifetime-window providers and logs the result', () => {
    h = createHarness();
    const r = runMaintenanceJob(buildContext(h.deps, h.options));
    expect(r).toMatchObject({ cacheRowsDeleted: expect.any(Number), ledgerRowsPruned: expect.any(Number), dbBytes: expect.any(Number) });
    expect(h.logs.some((l) => l.msg === 'maintenance: done')).toBe(true);
  });
  it('fx-refresh as a system job refreshes rates; a failure is logged, not thrown', async () => {
    h = createHarness();
    h.server.use(mswHttp.get('https://api.frankfurter.dev/v1/latest', () => HttpResponse.json({ amount: 1, base: 'GBP', date: '2026-10-14', rates: { USD: 1.27 } })));
    await runSystemJob(buildContext(h.deps, h.options), 'fx-refresh');
    expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())).not.toBeNull();
    h.server.use(mswHttp.get('https://api.frankfurter.dev/v1/latest', () => HttpResponse.json({ base: 'EUR' })));
    await expect(runSystemJob(buildContext(h.deps, h.options), 'fx-refresh')).resolves.toBeUndefined();
    expect(h.logs.some((l) => l.msg === 'system job failed' && l.fields.job === 'fx-refresh')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- coverage-check`
Expected: FAIL, `Cannot find module '../src/coverageCheck.js'`.

- [ ] **Step 3: Implement**

`src/coverageCheck.ts`:

```ts
import { type CellKey, type IsoDate, type IsoMonth, generateCells, monthOf, monthsSpanned, resolveWindow } from '@gmt/core';
import type { EngineContext } from './context.js';
import { errorText } from './run.js';
import type { CoverageCheckRequest, CoverageCheckResponse } from './types.js';

/** Rows per departure month, listing every month of the window (zero months included). */
export function countCachedRows(prices: ReadonlyArray<{ departureDate: IsoDate }>, months: readonly IsoMonth[]): Array<{ month: IsoMonth; cachedRows: number }> {
  const counts = new Map<IsoMonth, number>(months.map((m) => [m, 0]));
  for (const p of prices) {
    const m = monthOf(p.departureDate);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return months.map((month) => ({ month, cachedRows: counts.get(month) ?? 0 }));
}

/**
 * Spec §10 `POST /definitions/coverage-check` and §1 "the Definitions form's coverage check (free)
 * reports cached rows per pair before anything is saved". Uses only the Travelpayouts provider, so
 * it can never call a billed provider; its calls are ledgered (execution_id NULL) and capped by the
 * provider's free-call limits through http-kit.
 */
export async function coverageCheckFor(ctx: EngineContext, req: CoverageCheckRequest): Promise<CoverageCheckResponse> {
  const cap = ctx.providers.get('travelpayouts')?.discovery;
  if (cap === undefined) return { pairs: [], calls: 0, notes: ['Travelpayouts is not configured; the coverage check reads its free cached data only.'] };
  const w = resolveWindow(req.window, ctx.clock.todayLondon());
  const months = monthsSpanned(w.departureFrom, w.departureTo);
  const notes: string[] = [];
  const pairs: CoverageCheckResponse['pairs'] = [];
  let calls = 0;
  const signal = new AbortController().signal;
  for (const origin of req.origins) {
    for (const destination of req.destinations) {
      const cells: CellKey[] = generateCells({ origins: [origin], destinations: [destination], departureFrom: w.departureFrom, departureTo: w.departureTo, minNights: req.minNights, maxNights: req.maxNights });
      const q = { origin, destination, departureFrom: w.departureFrom, departureTo: w.departureTo, minNights: req.minNights, maxNights: req.maxNights, cabin: 'economy' as const, currency: 'GBP' as const, cells };
      const found: Array<{ departureDate: IsoDate }> = [];
      for (const tile of cap.plan(q)) {
        calls += 1;
        try {
          const r = await cap.fetchTile(tile, q, { executionId: null, signal, recordFixtures: false });
          if (r.kind === 'tile') found.push(...r.prices);
          else notes.push(`${origin}→${destination}: a tile failed (${r.error.kind})`);
        } catch (err) {
          notes.push(`${origin}→${destination}: ${errorText(err)}`);
        }
      }
      pairs.push({ origin, destination, months: countCachedRows(found, months) });
    }
  }
  if (w.clamped) notes.push('window clamped to start tomorrow');
  return { pairs, calls, notes };
}
```

`src/maintenance.ts`:

```ts
import { runMaintenance } from '@gmt/db';
import type { EngineContext } from './context.js';
import { refreshFx } from './fx/refresh.js';
import { errorText } from './run.js';
import type { SystemJob } from './scheduler/scheduler.js';

/** Daily at 06:00 in SCHEDULER_TIMEZONE (spec §5.6 "refreshed daily"). */
export const FX_REFRESH_CRON = '0 6 * * *';
/** Daily at 03:30 in SCHEDULER_TIMEZONE (spec §7 "Retention. A daily maintenance job"). */
export const MAINTENANCE_CRON = '30 3 * * *';

/** Spec §7 retention: expired cache rows, cache-hit ledger rows of monthly-window providers older than 90 days; DB size logged. */
export function runMaintenanceJob(ctx: EngineContext): ReturnType<typeof runMaintenance> {
  const lifetimeProviders = [...ctx.providers.keys()].filter((id) => ctx.limitsOf(id).window === 'lifetime');
  const r = runMaintenance(ctx.db, ctx.clock, ctx.log, { lifetimeProviders });
  ctx.log.info({ ...r }, 'maintenance: done');
  return r;
}

/** Runs a daily system job; failures are logged so a bad day never stops the scheduler. */
export async function runSystemJob(ctx: EngineContext, name: SystemJob): Promise<void> {
  try {
    if (name === 'fx-refresh') await refreshFx(ctx, new AbortController().signal);
    else runMaintenanceJob(ctx);
  } catch (err) {
    ctx.log.error({ job: name, err: errorText(err) }, 'system job failed');
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- coverage-check`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: coverage check over Travelpayouts only, maintenance and FX system jobs

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.19: `createEngine`, boot order, SIGTERM, crash-loop cap, pending sweep, `skipped_missed`, `status`

**Files:**
- Create: `packages/engine/src/boot.ts`, `src/engine.ts`, `test/boot.test.ts`
- Modify: `packages/engine/src/index.ts` (barrel)

**Interfaces:**
- Consumes: `ExecutionsRepo.bootSweep/listByStatus/listForDefinition`, `LedgerRepo.sweepPending`, `previousFiring`, `recordSkipped`, every earlier module.
- Produces: `createEngine(deps, options?)` exactly as the contract; `bootEngine(ctx, orch, sched)`; `statusOf(ctx, orch, sched)`; the package barrel.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/boot.test.ts`:

```ts
import { type OperatorMessage, type SearchDefinition, asIsoDate, asIsoDateTime } from '@gmt/core';
import { HttpResponse, http as mswHttp } from 'msw/http';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from '../src/index.js';
import type { Engine } from '../src/types.js';
import { type Harness, JFK, LGW, LHR, RESPONSES, createHarness } from './harness.js';

let h: Harness;
const engines: Engine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.shutdown();
  h.close();
});
const engine = () => {
  const e = createEngine(h.deps, h.options);
  engines.push(e);
  return e;
};
const frankfurter = () => h.server.use(mswHttp.get('https://api.frankfurter.dev/v1/latest', () => HttpResponse.json({ amount: 1, base: 'GBP', date: '2026-10-14', rates: { USD: 1.27 } })));
const twoPairs = (patch = {}) => h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });
const kinds = () => h.notifications.filter((m): m is OperatorMessage => 'kind' in m).map((m) => m.kind);

/** An execution row written directly, as a process that died right after creating it would leave it (status pending, nothing seeded). */
function ghost(def: SearchDefinition): string {
  const resolved = { origins: def.origins, destinations: def.destinations, departureFrom: asIsoDate('2026-11-02'), departureTo: asIsoDate('2026-11-04'), minNights: 7, maxNights: 8 };
  return h.repos.executions.create({ definitionId: def.id, snapshot: { ...def, resolved, resolvedAt: h.clock.now(), windowClamped: false }, status: 'pending', estimate: null }).id;
}

async function interrupted(): Promise<string> {
  const first = engine();
  h.onTileCommit((n) => {
    if (n === 1) void first.shutdown();
  });
  const r = await first.start(twoPairs().id, { trigger: 'manual' });
  if (!r.ok) throw new Error(r.message);
  await h.waitForSettled(r.executionId);
  h.clearHooks();
  return r.executionId;
}

describe('boot (spec §8.1 "Boot order")', () => {
  it('runs sweep → auto-resume → one-shot jobs → cron, in that order', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    frankfurter();
    const id = await interrupted();
    const base = h.requests.filter((r) => r.kind === 'calendar').length;
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal > base && r.ordinal <= base + 3, respond: RESPONSES.limiterTimeout, times: 3 });
    const paused = await h.runToCompletion(engine(), h.createDefinition().id);
    expect(paused.status).toBe('paused_error');
    const scheduled = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    h.logs.length = 0;
    const e2 = engine();
    await e2.boot();
    const phases = ['boot: sweep', 'boot: auto-resume', 'boot: one-shot jobs', 'boot: cron'];
    expect(h.logs.map((l) => l.msg).filter((m): m is string => m !== undefined && phases.includes(m))).toEqual(phases);
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({ executionId: id, result: 'resumed' });
    expect(h.logs.find((l) => l.msg === 'boot: one-shot jobs')?.fields).toEqual({ oneShots: 1 });
    // why: croner runs on the process clock, so a resume_after in the real past may already have fired; the log line is the deterministic check
    const jobs = e2.scheduler.jobs();
    expect(jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'definition', definitionId: scheduled.id }),
      expect.objectContaining({ kind: 'system', id: 'system:fx-refresh' }),
      expect.objectContaining({ kind: 'system', id: 'system:maintenance' }),
    ]));
    await h.waitForSettled(id);
  });

  it('SIGTERM then reboot resumes without incrementing auto_resume_count', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    frankfurter();
    const id = await interrupted();
    expect(h.repos.executions.get(id)?.autoResumeCount).toBe(0);
    await engine().boot();
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({ executionId: id, autoResumeCount: 0, result: 'resumed' });
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('a row left running by a dead process is crash-marked (count + 1) and resumed', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    frankfurter();
    const id = await interrupted();
    h.repos.executions.setStatus(id, 'running'); // what a crash leaves behind
    await engine().boot();
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({ executionId: id, autoResumeCount: 1, result: 'resumed' });
    expect((await h.waitForSettled(id)).status).toBe('completed');
    expect(h.repos.executions.get(id)?.autoResumeCount).toBe(0); // reset by the first commit of the resumed pass
  });

  it('crash-loop cap: auto_resume_count > MAX_AUTO_RESUMES stops auto-resume and tells the operator', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    frankfurter();
    const id = ghost(h.createDefinition()); // never notified before, so the per-execution dedup does not hide the message
    h.repos.executions.setStatus(id, 'running', { autoResumeCount: h.config.maxAutoResumes });
    await engine().boot();
    expect(h.repos.executions.get(id)).toMatchObject({ status: 'interrupted', autoResumeCount: h.config.maxAutoResumes + 1 });
    const msg = h.notifications.find((m): m is OperatorMessage => 'kind' in m && m.kind === 'interrupted' && m.executionId === id);
    expect(msg?.body).toContain('Automatic resume stopped after 4 restarts without progress');
  });

  it('pending sweep: a pending execution older than the boot becomes interrupted; ledger rows pending > 10 min become unknown', async () => {
    h = createHarness({ env: { AUTO_RESUME: 'false' } });
    frankfurter();
    const def = h.createDefinition();
    const pending = ghost(def);
    h.clock.advance(60_000); // the boot comes after the pending row was written
    const insert = h.db.raw.prepare(`INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('fixture', NULL, '/x', NULL, ?, 'pending', 3200, 1)`);
    insert.run('2026-10-14T08:46:00.000Z'); // 15 min before the boot at 09:01
    insert.run('2026-10-14T08:56:00.000Z'); // 5 min before the boot
    await engine().boot();
    expect(h.repos.executions.get(pending)).toMatchObject({ status: 'interrupted', autoResumeCount: 1 });
    const outcomes = h.db.raw.prepare(`SELECT outcome FROM provider_requests WHERE endpoint_path = '/x' ORDER BY started_at`).all();
    expect(outcomes).toEqual([{ outcome: 'unknown' }, { outcome: 'pending' }]);
  });

  it('records skipped_missed once when the last scheduled firing was missed (spec §8.2)', async () => {
    h = createHarness();
    frankfurter();
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' }); // created Wednesday 14 Oct
    h.clock.set(asIsoDateTime('2026-10-20T09:00:00.000Z')); // Tuesday: Monday 05:00 BST passed with the app down
    await engine().boot();
    const missed = h.repos.executions.listForDefinition(def.id, {}).filter((x) => x.status === 'skipped_missed');
    expect(missed).toHaveLength(1);
    expect(kinds()).toEqual(['skipped_missed']);
    await engine().boot();
    expect(h.repos.executions.listForDefinition(def.id, {}).filter((x) => x.status === 'skipped_missed')).toHaveLength(1);
  });
});

describe('shutdown and status', () => {
  it('shutdown stops the scheduler, interrupts in-flight cells, and leaves auto_resume_count alone', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    frankfurter();
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal === 1, respond: RESPONSES.hold });
    const e = engine();
    await e.boot();
    e.scheduler.register(h.createDefinition({ scheduleCron: '0 5 * * 1' }));
    const r = await e.start(twoPairs().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    expect(e.status().running).toEqual([r.executionId]);
    const stopping = e.shutdown();
    h.releaseHolds();
    await stopping;
    expect(e.scheduler.jobs()).toEqual([]);
    expect(h.repos.executions.get(r.executionId)).toMatchObject({ status: 'interrupted', autoResumeCount: 0 });
    expect(h.outcomes(r.executionId).every((o) => o.status === 'not_run')).toBe(true);
  });

  it('status reports jobs, the next run, the last execution, and degraded when a run is stuck', async () => {
    h = createHarness();
    frankfurter();
    h.scenario({ match: (r) => r.kind === 'calendar', respond: RESPONSES.hold, times: 100 });
    h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const e = engine();
    await e.boot();
    // why: croner computes next runs on the process clock, so only the local time of the firing is fixed
    expect(e.status()).toMatchObject({ running: [], degraded: false, nextRun: expect.stringMatching(/T0[45]:00:00\.000Z$/), lastExecutionAt: null });
    const r = await e.start(twoPairs().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    h.clock.advance((h.config.stuckAfterHours + 1) * 3_600_000);
    expect(e.status()).toMatchObject({ degraded: true, lastExecutionAt: '2026-10-14T09:00:00.000Z' });
    const stopping = e.shutdown();
    h.releaseHolds();
    await stopping;
  });

  it('wires estimate, estimateRemaining, budgetFit and coverageCheck', async () => {
    h = createHarness();
    const e = engine();
    const def = twoPairs({ scheduleCron: '0 5 * * 1' });
    expect(e.estimate(def, h.clock.todayLondon()).cells).toBe(12);
    expect(e.budgetFit(def).runsPerMonth).toBe(5);
    expect((await e.coverageCheck({ origins: [LHR], destinations: [JFK], window: def.window, minNights: 7, maxNights: 8 })).calls).toBe(0);
    const done = await h.runToCompletion(e, def.id);
    expect(e.estimateRemaining(done.id).prefactor.every((p) => p.calls === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine test -- boot`
Expected: FAIL, `createEngine` is not exported from `../src/index.js`.

- [ ] **Step 3: Implement**

`src/boot.ts`:

```ts
import type { IsoDateTime, SearchDefinition } from '@gmt/core';
import type { EngineContext } from './context.js';
import { FX_REFRESH_CRON, MAINTENANCE_CRON, runSystemJob } from './maintenance.js';
import { notifyOperator } from './notify.js';
import type { Orchestrator } from './orchestrator.js';
import { previousFiring } from './scheduler/parseCron.js';
import type { Scheduler } from './scheduler/scheduler.js';
import { buildSnapshot } from './snapshot.js';
import { recordSkipped } from './start.js';

/** Spec §5.3 "boot sweep marks pending older than 10 minutes unknown (still counted)". */
export const PENDING_LEDGER_MAX_AGE_MS = 10 * 60_000;

function minusMs(at: IsoDateTime, ms: number): IsoDateTime {
  return new Date(Date.parse(at) - ms).toISOString() as IsoDateTime;
}

/** Spec §8.2: "a boot that finds the last scheduled firing was missed records skipped_missed and notifies". Once per firing. */
async function detectMissed(ctx: EngineContext, def: SearchDefinition, bootAt: IsoDateTime): Promise<void> {
  if (def.scheduleCron === null) return;
  const prev = previousFiring(def.scheduleCron, def.scheduleTz, new Date(bootAt));
  if (prev === null) return;
  const prevAt = prev.toISOString();
  if (prevAt <= def.createdAt) return; // why: the schedule did not exist at that firing
  const last = ctx.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false })[0];
  if (last !== undefined && last.startedAt >= prevAt) return;
  const built = buildSnapshot(ctx, def, 'schedule');
  await recordSkipped(ctx, def, built.snapshot, null, 'skipped_missed', `The run scheduled for ${prevAt} did not happen because the app was not running.`);
}

/**
 * Spec §8.1 "Boot order": (1) sweep — pending ledger rows older than 10 minutes → unknown; pending
 * executions older than the boot and running executions → interrupted with auto_resume_count + 1;
 * (2) if AUTO_RESUME, every interrupted execution with count ≤ MAX_AUTO_RESUMES resumes (graceful
 * SIGTERM rows were not incremented); above the cap, the operator is told; (3) one-shot jobs for
 * resume_after are re-registered; (4) then cron (after recording any missed firing) and the daily
 * system jobs. FX rates are fetched at boot only when none is fresh.
 */
export async function bootEngine(ctx: EngineContext, orch: Orchestrator, sched: Scheduler): Promise<void> {
  const bootAt = ctx.clock.now();
  const log = ctx.log.child({ phase: 'boot' });

  const pendingLedgerRows = ctx.repos.ledger.sweepPending(minusMs(bootAt, PENDING_LEDGER_MAX_AGE_MS));
  const { interrupted } = ctx.repos.executions.bootSweep(bootAt);
  const crashMarked = new Set(interrupted);
  log.info({ crashMarked: interrupted.length, pendingLedgerRows }, 'boot: sweep');

  const name = (definitionId: string) => ctx.repos.definitions.get(definitionId)?.name ?? definitionId;
  let resumed = 0;
  let capped = 0;
  for (const exec of ctx.repos.executions.listByStatus(['interrupted'])) {
    const p = { executionId: exec.id, definitionId: exec.definitionId, definitionName: name(exec.definitionId) };
    if (exec.autoResumeCount > ctx.config.maxAutoResumes) {
      capped += 1;
      log.warn({ executionId: exec.id, autoResumeCount: exec.autoResumeCount }, 'boot: auto-resume stopped by the crash-loop cap');
      await notifyOperator(ctx, 'interrupted', { ...p, detail: `Automatic resume stopped after ${exec.autoResumeCount} restarts without progress; resume it manually once the cause is fixed.` });
      continue;
    }
    if (crashMarked.has(exec.id)) await notifyOperator(ctx, 'interrupted', { ...p, detail: 'The app stopped without a clean shutdown during this run.' });
    if (!ctx.config.autoResume) continue;
    const r = await orch.resume(exec.id, { manual: false });
    if (r.ok) resumed += 1;
    log.info({ executionId: exec.id, autoResumeCount: exec.autoResumeCount, result: r.ok ? 'resumed' : r.code }, 'boot: auto-resume execution');
  }
  log.info({ autoResume: ctx.config.autoResume, resumed, capped }, 'boot: auto-resume');

  let oneShots = 0;
  for (const exec of ctx.repos.executions.listByStatus(['paused_error', 'paused_budget'])) {
    if (exec.resumeAfter === null) continue;
    sched.registerResume(exec.id, exec.resumeAfter);
    oneShots += 1;
  }
  log.info({ oneShots }, 'boot: one-shot jobs');

  for (const def of ctx.repos.definitions.list()) {
    if (!def.enabled || def.deletedAt !== null || def.scheduleCron === null) continue;
    await detectMissed(ctx, def, bootAt);
    sched.register(def);
  }
  sched.registerSystem('fx-refresh', FX_REFRESH_CRON, ctx.config.schedulerTimezone);
  sched.registerSystem('maintenance', MAINTENANCE_CRON, ctx.config.schedulerTimezone);
  log.info({ definitionJobs: sched.definitionJobCount() }, 'boot: cron');

  if (ctx.repos.fx.latest('EUR', ctx.config.fxMaxRateAgeDays, ctx.clock.todayLondon()) === null) void runSystemJob(ctx, 'fx-refresh');
}
```

`src/engine.ts`:

```ts
import { parseCron } from './scheduler/parseCron.js';
import { bootEngine } from './boot.js';
import { buildContext, type EngineContext } from './context.js';
import { coverageCheckFor } from './coverageCheck.js';
import { budgetFitFor, estimateRemainingFor, estimateStart } from './estimate.js';
import { runSystemJob } from './maintenance.js';
import { type Orchestrator, createOrchestrator } from './orchestrator.js';
import { type Scheduler, createScheduler } from './scheduler/scheduler.js';
import { buildSnapshot } from './snapshot.js';
import type { Engine, EngineDeps, EngineOptions } from './types.js';

/** Spec §10 `/health` degraded: job count ≠ enabled scheduled definitions, or an execution running past STUCK_AFTER_HOURS. */
export function statusOf(ctx: EngineContext, orch: Orchestrator, sched: Scheduler): ReturnType<Engine['status']> {
  const now = Date.parse(ctx.clock.now());
  const defs = ctx.repos.definitions.list().filter((d) => d.enabled && d.deletedAt === null && d.scheduleCron !== null && parseCron(d.scheduleCron, d.scheduleTz).ok);
  const running = orch.running();
  const stuck = running.some((id) => {
    const e = ctx.repos.executions.get(id);
    return e !== null && now - Date.parse(e.startedAt) > ctx.config.stuckAfterHours * 3_600_000;
  });
  const nextRuns = sched.jobs().filter((j) => j.kind === 'definition' && j.nextRun !== null).map((j) => j.nextRun as string).sort();
  const latest = ctx.repos.definitions.list().map((d) => ctx.repos.executions.listForDefinition(d.id, { limit: 1, includeChildren: true })[0]?.startedAt).filter((x): x is NonNullable<typeof x> => x !== undefined).sort();
  return {
    running,
    degraded: sched.definitionJobCount() !== defs.length || stuck,
    nextRun: (nextRuns[0] ?? null) as ReturnType<Engine['status']>['nextRun'],
    lastExecutionAt: latest[latest.length - 1] ?? null,
  };
}

/** The plan's "Engine" contract over the modules of this package. Spec §8. */
export function createEngine(deps: EngineDeps, options: EngineOptions = {}): Engine {
  const ctx = buildContext(deps, options);
  const orch = createOrchestrator(ctx);
  const sched = createScheduler(
    {
      onTick: (id) => orch.tick(id),
      onResumeDue: async (id) => {
        const r = await orch.resume(id, { manual: false });
        ctx.log.info({ executionId: id, result: r.ok ? 'resumed' : r.code }, 'one-shot resume');
      },
      onSystem: (name) => runSystemJob(ctx, name),
    },
    ctx.log,
  );
  ctx.hooks.scheduleResume = (id, at) => sched.registerResume(id, at);
  ctx.hooks.cancelResume = (id) => sched.cancelResume(id);
  ctx.hooks.unregisterSchedule = (id) => sched.unregister(id);
  return {
    boot: () => bootEngine(ctx, orch, sched),
    shutdown: async () => {
      // why: spec §8.1 "SIGTERM: stop scheduler, abort in-flight (cells → not_run), status interrupted without incrementing the counter, checkpoint"
      sched.stopAll();
      await orch.shutdown();
      ctx.db.raw.pragma('wal_checkpoint(TRUNCATE)');
      ctx.log.info({}, 'engine: shut down');
    },
    start: (id, opts) => orch.start(id, opts),
    resume: (id, opts) => orch.resume(id, opts),
    cancel: (id) => orch.cancel(id),
    verifyCell: (id, cell) => orch.verifyCell(id, cell),
    estimate: (def, today) => {
      const b = buildSnapshot(ctx, def, 'manual', today);
      return estimateStart(ctx, b.snapshot, b.cells, def.id);
    },
    estimateRemaining: (id) => {
      const e = ctx.repos.executions.get(id);
      if (e === null) throw new Error(`execution ${id} not found`);
      return estimateRemainingFor(ctx, e, true); // why: the contract takes no `manual`; the manual query is the upper bound
    },
    budgetFit: (def) => budgetFitFor(ctx, def),
    coverageCheck: (req) => coverageCheckFor(ctx, req),
    scheduler: {
      register: (def) => sched.register(def),
      unregister: (id) => sched.unregister(id),
      jobs: () => sched.jobs(),
      tick: (id) => orch.tick(id),
    },
    status: () => statusOf(ctx, orch, sched),
  };
}
```

`src/index.ts`:

```ts
// Barrel for @gmt/engine (plan contract "Engine"). EmailNotifier and the alert runner are added by WP11.
export { createEngine } from './engine.js';
export { parseCron } from './scheduler/parseCron.js';
export { LogNotifier } from './notifiers/log.js';
export type {
  BudgetFit, CoverageCheckRequest, CoverageCheckResponse, Engine, EngineDeps, EngineOptions, Estimate, ProviderRunLimits, Repos, SchedulerJob, StartResult,
} from './types.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine test -- boot`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: createEngine with boot order, SIGTERM, crash-loop cap, pending sweep, skipped_missed, status

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.20: §14 log fields, and the banned-word sweep over every engine-emitted string

**Files:**
- Create: `packages/engine/test/logs-and-words.test.ts`

**Interfaces:**
- Consumes: `findBannedWords`, `finalStatus`, `operatorMessage`, `OPERATOR_KINDS`, `breachMessage`, every `StartResult` refusal, estimate assumptions, coverage-check notes.
- Produces: nothing new; it fails if any later edit adds a banned word or drops a log binding.

- [ ] **Step 1: Write the test**

`packages/engine/test/logs-and-words.test.ts`:

```ts
import { AbortedError, BudgetExceeded, type NormalisationReason, type OperatorMessage, asIsoDate, asIsoDateTime, findBannedWords } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { breachMessage } from '../src/budgetCheck.js';
import { buildContext } from '../src/context.js';
import { coverageCheckFor } from '../src/coverageCheck.js';
import { estimateStart } from '../src/estimate.js';
import { finalStatus } from '../src/execute.js';
import { OPERATOR_KINDS, operatorMessage } from '../src/notifiers/messages.js';
import { createOrchestrator } from '../src/orchestrator.js';
import type { StopReason } from '../src/run.js';
import { buildSnapshot } from '../src/snapshot.js';
import { type Harness, JFK, LGW, LHR, RESPONSES, createHarness, withVerification } from './harness.js';

let h: Harness;
afterEach(() => h.close());
const clean = (label: string, text: string) => expect(findBannedWords(text), `${label}: "${text}"`).toEqual([]);

describe('spec §14: executionId, definitionId and providerId on engine lines; no full URLs', () => {
  it('holds over a run with errors in both stages', async () => {
    h = createHarness({ fixtureConcurrency: 1 });
    h.scenario({ match: (r) => r.kind === 'calendar' && r.ordinal <= 3, respond: RESPONSES.upstream, times: 3 });
    h.scenario({ match: (r) => r.kind === 'itinerary' && r.ordinal === 1, respond: RESPONSES.badRequest });
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], providers: withVerification() });
    await h.runToCompletion(createOrchestrator(buildContext(h.deps, h.options)), def.id);
    const engineLines = h.logs.filter((l) => l.bindings.executionId !== undefined);
    expect(engineLines.length).toBeGreaterThan(5);
    for (const l of engineLines) expect(l.bindings.definitionId).toBe(def.id);
    const providerMsgs = ['discovery: planned tiles', 'cells marked error', 'verification: searching cells', 'discovery: tile reduced', 'verification: offers dropped in normalisation'];
    for (const l of engineLines.filter((x) => x.msg !== undefined && providerMsgs.includes(x.msg))) expect(l.bindings.providerId).toBe('fixture');
    const all = JSON.stringify(h.logs);
    expect(all).not.toMatch(/https?:\/\/[^\s"]*\?/); // no query strings
    expect(all).not.toMatch(/https?:\/\/[^\s"/]*@/); // no userinfo
  });
});

describe('spec §11: no banned word in any reason string, notification subject or body the engine emits', () => {
  const stops: StopReason[] = [
    { kind: 'sigterm' },
    { kind: 'cancel' },
    { kind: 'limiter-timeout', resumeAfter: asIsoDateTime('2026-10-14T10:00:00.000Z') },
    { kind: 'budget', error: new BudgetExceeded({ scope: 'global-month', cap: 35_000_000, current: 35_000_000, requested: 3200 }), resumeAfter: asIsoDateTime('2026-11-01T00:00:00.000Z') },
    { kind: 'budget', error: new BudgetExceeded({ scope: 'execution-calls', cap: 2000, current: 2000, requested: 1 }), resumeAfter: null },
    { kind: 'all-disabled', stage: 'verification' },
    { kind: 'fatal', message: 'database or disk is full' },
  ];

  it('notices for every stop reason, rendered for every kind', () => {
    const details = stops.map((s) => finalStatus(s, asIsoDateTime('2026-10-14T09:00:00.000Z')).notice?.detail ?? '');
    details.push('fixture was disabled for this run after an auth error; its remaining cells are skipped (provider disabled).');
    details.push('fixture reached the provider-month cap; remaining discovery cells are skipped (budget) and the other providers continue.');
    details.push('Planned 14 tile requests; the ledger shows 15 (first attempts plus cache hits).');
    details.push('Verification was skipped for budget in this run, so only calendar prices were checked against alert rules.');
    details.push('Automatic resume stopped after 4 restarts without progress; resume it manually once the cause is fixed.');
    details.push('The run scheduled for 2026-10-19T04:00:00.000Z did not happen because the app was not running.');
    for (const kind of OPERATOR_KINDS) {
      for (const detail of details) {
        const m = operatorMessage(kind, { definitionName: 'London to New York', executionId: 'e1', detail });
        clean(`${kind} subject`, m.subject);
        clean(`${kind} body`, m.body);
      }
    }
  });

  it('cell reasons, skip reasons and budget messages', () => {
    const reasons: Array<NormalisationReason | string> = [
      'fx-unavailable', 'currency-unsupported', 'unknown-airport-tz', 'no-return-legs', 'unmappable-carrier', 'bad-local-time',
      'partial-expansion', 'offers-dropped:3', 'partial-expansion,offers-dropped:1',
      'auth', 'rate-limit', 'quota', 'upstream', 'parse', 'network', 'limiter-timeout',
      'not_selected', 'budget', 'provider_disabled', 'departed',
    ];
    for (const r of reasons) clean('reason', r);
    clean('breach', breachMessage([{ scope: 'execution-calls', providerId: null, cap: 0, current: 0, estimated: 7 }, { scope: 'provider-month', providerId: 'fixture', cap: 20, current: 20, estimated: 3 }]));
    clean('aborted', new AbortedError().message);
  });

  it('every StartResult message, estimate assumption and coverage-check note', async () => {
    h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const o = createOrchestrator(buildContext(h.deps, h.options));
    const messages: string[] = [];
    const def = h.createDefinition({ providers: withVerification() });
    const confirm = await o.start(def.id, { trigger: 'manual' });
    if (!confirm.ok) messages.push(confirm.message);
    const past = h.createDefinition({ window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-02') } });
    const window = await o.start(past.id, { trigger: 'schedule' });
    if (!window.ok) messages.push(window.message);
    const capped = h.createDefinition({ budget: { maxCalls: 0, maxFreeCalls: 0, maxCostMicroGbp: 0 } });
    const cap = await o.start(capped.id, { trigger: 'manual' });
    if (!cap.ok) messages.push(cap.message);
    const outside = await o.verifyCell(def.id, { origin: LHR, destination: JFK, departureDate: asIsoDate('2027-01-01'), returnDate: asIsoDate('2027-01-08') });
    if (!outside.ok) messages.push(outside.message);
    const resumeMissing = await o.resume('no-such-execution', { manual: true });
    if (!resumeMissing.ok) messages.push(resumeMissing.message);
    expect(messages).toHaveLength(5);
    for (const m of messages) clean('start result', m);
    for (const n of h.notifications.filter((x): x is OperatorMessage => 'kind' in x)) {
      clean('notification subject', n.subject);
      clean('notification body', n.body);
    }
    const ctx = buildContext(h.deps, h.options);
    const cc = await coverageCheckFor(ctx, { origins: [LHR], destinations: [JFK], window: def.window, minNights: 7, maxNights: 8 });
    for (const n of cc.notes) clean('coverage note', n);
    const b = buildSnapshot(ctx, def);
    for (const a of estimateStart(ctx, b.snapshot, b.cells, def.id).assumptions) clean('assumption', a);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @gmt/engine test -- logs-and-words`
Expected: PASS, 4 tests. A banned word found here is fixed in the string's source module, not in an allowlist.

- [ ] **Step 3: Run the whole package with coverage**

Run: `pnpm --filter @gmt/engine test`
Expected: every test file passes; the coverage summary meets lines ≥ 85, branches ≥ 70, functions ≥ 85, statements ≥ 85 for `src/**` (excluding `src/index.ts`). If a threshold fails, add a test for the uncovered branch named in the report (most likely in `src/errors.ts`, `src/budgetCheck.ts` or `src/estimate.ts`), never lower the threshold.

- [ ] **Step 4: Commit**

```bash
git add packages/engine && git commit -m "wp07: log binding and banned-word sweeps over engine output

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

## 9. Pinned review-focus tests

| Plan Review Focus line | Test | Task |
|---|---|---|
| 4 — the definition is edited while an execution is running: the running execution keeps its snapshot and plan | `test/seeding.test.ts` › "Review Focus 4: a PUT during a run does not change the running execution" (edits origins, nights and cabin while the first tile is held; asserts the snapshot, every outcome and every `plan()` call still use the original values, and that the edit itself was stored) | 7.3 |
| 5 — a repository write that throws `SqliteError` during a tile → `paused_error` with the SQLite message, URL-free, in `error_text`; siblings → `not_run`; operator notification | `test/sqlite-failure.test.ts` › "Review Focus 5: SQLite busy or full during a tile write" (throws `new Database.SqliteError(…, 'SQLITE_FULL')` from `writeTile` with a sibling held in flight) | 7.16 |

The `excludedByCurrentSpace` count of Review Focus 4 belongs to WP8 (`/results`).

## 10. Definition of done

Run from the repository root on the WP7 branch:

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/engine test` | every file under `packages/engine/test/` passes (23 test files, about 170 tests); coverage for `packages/engine/src/**` (excluding `src/index.ts`, `src/notifiers/email.ts`, `src/alerts/**`) at lines ≥ 85 %, branches ≥ 70 %, functions ≥ 85 %, statements ≥ 85 %; Vitest exits 0 |
| `pnpm lint` | `biome check .` reports no errors |
| `pnpm -r typecheck` | exit 0 for every package |
| `node scripts/check-boundaries.mjs` | exit 0 (engine imports only `@gmt/core`, `@gmt/db`, `@gmt/providers`) |
| `grep -rn "process\.env" packages/engine/src` | no output |
| `grep -rnwE "LHR\|LGW\|JFK\|EWR\|LON\|NYC" packages/engine/src` | no output (airport codes appear only in `packages/engine/test/`) |
| `grep -rn "api.frankfurter.app" packages/engine/src` | no output (the `.dev/v1` URL is used; see Open questions) |
| `pnpm test` (root) | every package green, so WP7 broke nothing it consumes |

Every task's checkboxes are ticked; every commit message starts `wp07:`.

## 11. Open questions

None requires the operator's judgment except item 1. The rest are contract or spec gaps for Fable to close in the plan (and, where noted, the spec) **before dispatch**; each is written so the fix is a one-line contract edit, and this brief already codes against the stated shape.

1. `requires_human_judgment` — **execution-cap pauses and the frozen snapshot.** Spec §8.1 says a `BudgetExceeded execution-*` pause "needs a manual cap change or `/resume` after editing the definition", but the execution reads its budget from its snapshot, which a `PUT` never changes (Review Focus 4). This brief makes `/resume` re-check the snapshot's caps (Task 7.14 test "an exhausted execution cap refuses with code cap"), so such a run can only be cancelled and re-run. Decide whether a manual resume should refresh `snapshot.budget` from the current definition (and only that field).
2. **`ExecutionsRepo.listByStatus(statuses)`** is missing from the plan's Database contract; `boot()` needs it (auto-resume every `interrupted` row, re-register every `paused_*` row with `resume_after`).
3. **Undefined db shapes** the plan names but does not define: `Execution`, the `create` input, the `setStatus` patch, `listForDefinition` options (`{ limit?, includeChildren? }`, newest first), `TileWrite`, `VerifiedCellWrite`, `ReusedCopy`, `CalendarPriceInsert`/`CalendarPriceRow`, `OutcomePatch` (`attemptsDelta`), `BudgetConfig`, `Airport`, the `FxRepo.upsert` row. §4.9 states each shape this brief relies on.
4. **Per-execution caps in `reserve`.** `SqliteBudgetGuard` receives no per-execution caps; it must read them from the execution's snapshot (`budget`), or child executions cannot have `CHILD_MAX_CALLS` and definitions cannot have their own `budget_json`. Confirm in the WP3 brief.
5. **Parity counting.** `BudgetGuard.recordCacheHit` carries no `tileIndex`, although spec §5.3 says every ledger row carries `tile_index`, and `LedgerRepo.countsFor` has no per-provider or per-stage split. This brief compares the run's planned tiles (all discovery providers) with `countsFor().tiles + cacheHits` and needs `cacheHits` to count discovery cache hits only. Add `tileIndex` to `recordCacheHit` and a `providerId` filter to `countsFor`.
6. **Engine type names.** The plan's Engine contract uses `Estimate`, `BudgetFit`, `CoverageCheckRequest`, `CoverageCheckResponse`, `SchedulerJob` without saying where they are exported; the api-contract exports schemas, not these names. This brief defines them in `src/types.ts` and tests each value against the api-contract schema. `Estimate` gains `prefactor` (the overrun baseline of spec §8.1, which the contract's estimate shape cannot carry) and `blocked`.
7. **`EngineOptions`** (optional second argument of `createEngine`) is an addition: `Config` holds no limits for the fixture provider (concurrency, per-call test cost), so the layer-A harness passes them. Production passes nothing.
8. **`EngineHooks.unregisterSchedule`** is internal, but it exists because spec §6.1 makes the engine disable a schedule itself on a zero-cell window.
9. **Spec self-contradiction on FX transport.** Spec §5.6 ends "FX rates come from frankfurter via plain `fetch` + `p-retry` (host-allowlisted, not ledgered)"; spec §4, §5.3 and the plan say "through http-kit under the never-billable id `fx`". This brief follows §5.3; §5.6's last sentence should be corrected.
10. **frankfurter URL.** `https://api.frankfurter.app/latest?from=GBP` answers `301` to `https://api.frankfurter.dev/v1/latest?from=GBP` (checked 2026-10-14). http-kit uses `redirect: 'error'`, so the engine calls the `.dev/v1` URL and the WP4b wiring must set the `fx` host allowlist to `api.frankfurter.dev`.
11. **Spec self-contradiction on supersede.** Spec §6.6 says "there is no supersede case", while §7 and §9 item 4 require "a fresh price supersedes a reused row in the same transaction". This brief implements and tests the supersede (Task 7.7) as a safety net; one of the two sentences should change.
12. **Reason for `parse` errors.** Spec §5.2 maps a 400 to `parse` "with the vendor's message as `reason`", and §8.1 sets the cell reason to `error.reason ?? kind`; but §7's resume query excludes reason `parse`, which a vendor message never equals. This brief stores the kind (`parse`) as the reason and the vendor message in `last_error` (only `no-return-legs` keeps its specific reason).
13. **`route_price_history` has no producer.** `ItinerarySearchResult` (spec §5.1) has no field for SearchApi's `price_insights.price_history`, so the engine cannot upsert it; WP5 or the contract must add one (for example `priceHistory?: Array<{ date: IsoDate; lowestMinor: number; currency: string }>`), with an engine task added then.
14. **Point of sale is not in the raw shapes.** Spec §5.1 raw prices and offers carry no point of sale; this brief derives it per provider (`searchapi` → `POINT_OF_SALE` when `GB`; others `'unknown'`). If SearchApi's echoed `gl` must be stored, add it to `ItinerarySearchResult`/`DiscoveryTileResult`.
15. **Link allowlists and `observationFields`.** `normaliseOffer`'s deps carry no provider link allowlist and its `observationFields` shape is undefined; the engine owns `LINK_ALLOWLIST` and builds observations from the raw offer, using only `itinerary` from WP2.
16. **limiter-timeout `resume_after`.** The engine uses `ProviderError.retryAfterSeconds` from the `limiter-timeout` http-kit raises, defaulting to one hour; WP4 should set `retryAfterSeconds` on that error.
17. **Fixture provider request shape and error injection.** The WP4 brief did not exist when this was written; the harness assumes `/calendar…` and `/itinerary…` paths with `origin`/`destination` query parameters (one function, `fixtureRequestKey`, to adapt) and injects error statuses itself rather than through `x-fixture-scenario`.
18. **Notification kinds.** `OperatorMessage.kind` has no kind for "a provider reached its cap, the others continue" (spec §8.1 "notify once"); this brief uses `provider_disabled`. Deduplication per (kind, execution) also means a crash-loop notice is suppressed when the same execution was already notified as `interrupted`; a `crash_loop` kind would avoid that.
19. **`StartResult` has no `not_found`.** `start`/`verifyCell` throw for a missing definition and `resume` returns `active` for a missing execution; WP8 checks existence first and answers 404.
