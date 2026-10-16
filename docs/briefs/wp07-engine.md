---
wp: 7
title: engine with layer-A tests
owner: opus
depends_on: [1, 2, 3, 4, 5, 6]
spec_sections: ["§3 (cell outcome seeding)", "§5.3 (budget stops, rev 18)", "§5.6", "§6.2 (verdict classes)", "§6.7 (selection once, child executions, rev 18)", "§6.9 (results basis inputs)", "§7 (transactions, resume query, boot order, migrations)", "§8.1", "§8.2", "§8.3 (LogNotifier only)", "§9 item 4 layer A", "§14"]
reviewers: [code-architect, test-strategy-reviewer, search-strategy-reviewer, cost-and-budget-reviewer, provenance-auditor, data-model-reviewer, product-owner]
status: draft
---

# WP7 — `@gmt/engine` with layer-A tests

## 1. Goal

Build the execution engine of spec §8 (orchestrator, discovery and verification stage runners, the §5.6 normalisation step over the db repositories, reuse, estimates, pre-start checks, resume, boot and shutdown, the croner scheduler with `parseCron`, FX refresh, the maintenance job wiring and `LogNotifier`) and prove every vendor-agnostic rule of spec §9 item 4 layer A against the fixture provider through the real http-kit, the real `SqliteBudgetGuard` and an in-memory database.

## 2. Scope

**In**

- `createEngine(deps, opts?)` producing the plan's "Engine" contract: `boot`, `shutdown`, `start`, `resume`, `cancel`, `verifyCell`, `estimate`, `estimateRemaining`, `budgetFit`, `coverageCheck`, `scheduler { register, unregister, jobs, tick, blockedSince }`, `status`; the `AlertsStepHook` seam with the `noAlerts` default (WP11 passes `runAlerts`).
- `parseCron(expr, tz)`, the single croner wrapper (spec §8.2), which `api` imports for validation.
- `LogNotifier`, `renderOperatorMessage` (`src/notifiers/operatorTemplates.ts`) and the operator-notification path: per-execution-and-kind deduplication, money and call caps in plain words, the banned-word test over every subject and body.
- The §5.6 normalisation step: airport tz from `AirportsRepo`, one FX lookup (`rateFor`, `FX_MAX_RATE_AGE_DAYS`) feeding core's `normaliseOffer` for offers and core's `priceInGbp` (its money step, exported here) for calendar prices, one calendar price per cell per tile, `offers-dropped:n`, the adapters' `cellIssues` and `truncated` (decisions 28, 30), `RawOffer.verified` (decisions 27, 29), `cabin-not-offered` seeding (`CellsRepo.markNoData`), `route_price_history` upserts of GBP points from `ItinerarySearchResult.routeHistory` (none when the vendor supplies none, decision 40).
- Bounded pools per provider `CONCURRENCY` (an in-package helper), one intake switch per pass and per (stage, provider) lane, and one abort signal per pass that only cancel, SIGTERM and a fatal database error raise (decision 25: a reservation that passed every cap is honoured).
- FX refresh through http-kit under the id `fx` (never ledgered), a daily system job plus a one-shot a minute after boot when no rate is a day fresh, and a daily maintenance job that calls WP3's `runMaintenance`. `boot()` makes no network call.
- The core, db and api changes decisions 25, 32 and 37 give this package, each with its own tests: in `@gmt/core`, `no-priced-options` joins the closed `ErrorReason` list (Task 7.4), `TRUNCATED_NOTE` and the money step `priceInGbp` are exported (Task 7.5), `evaluateConstraints` judges `priceConfirmed` on every offer whose `price` is not a supplied field (Task 7.8), `SearchDefinition.confirmedCalls` and the api-contract fields for confirmed calls (Task 7.13), and `coverageCheckResponseSchema`'s `cachedRows` becomes nullable with `calls` documented as tiles (Task 7.18); in `@gmt/db`, `ERROR_REASONS` and the resume query's non-retryable list gain `no-priced-options` (Task 7.4), and migration `0001_confirmed_calls` with the schema column, the row mapping and `DefinitionsRepo.setConfirmed` (Task 7.13); in `apps/api`, `httpLimitsFor` takes `fx` from the engine's `fxHttpLimits` (Task 7.19, once the barrel exports it; decision 32) and the tool test counts two migrations (Task 7.13); the root `vitest.aliases.ts` loses the `@gmt/engine/testing` alias that pointed at a file that never exists (Task 7.1).
- Layer-A tests under `packages/engine/test/` with the harness in `test/support/` (never `src/`): WP4's fixture router reached through http-kit's `inProcessHosts`, WP4's scenario rules through `scenarioRequest`/`releaseRequest`, real http-kit, real `SqliteBudgetGuard` from `budgetConfigFromConfig(config)`, `openDatabase(':memory:')` + `applyMigrations(MIGRATIONS_DIR)` + `createRepos`, `fixedClock`, fake timers where http-kit backs off, capturing `Logger` and `Notifier`, and the network guards of `@gmt/providers/testing` from the vitest setup file. One test per §8.1 error-table row in both stages plus every §9 item 4 layer-A item.

**Out**

- `EmailNotifier`, the alert runner (`runAlerts`, an `AlertsStepHook`), digest templates and delivery, and the one-digest-per-rule-per-execution rule: WP11 (`src/notifiers/email.ts`, `src/alerts/*`). This package calls the hook when a pass completes or pauses for a cap window and emits only the "alerts running on calendar basis only" operator notification.
- Routes, the 409/422 HTTP mapping of `StartResult`, `needsConfirmation` on `PUT`, refusing a schedule whose provider-month scope does not fit (decision 25, from the `budgetFit` this package returns), the `app_lock` heartbeat, the WAL checkpoint and lock release at shutdown, pino construction and `redact` paths: WP8 (`apps/api`).
- Repositories, schema, migrations, the cap predicates inside `reserve`, the compare-and-set SQL, the boot-sweep SQL, `runMaintenance`: WP3 (`@gmt/db`).
- http-kit, the fixture provider and its fixture tree, error classification by status: WP4 (`@gmt/providers`).
- `RawOffer.verified` (WP5 Task 5.0): a type-only core addition this package consumes; `CellIssue`, `cellIssues` and `truncated` are on main with WP6. Discovery queries are per airport pair (decision 34: no definition-wide origins on the query; Travelpayouts costs `O × D × M` free calls a scan, 28 for the worked example, with no cache-dedup saving assumed).
- The pure domain functions (`resolveWindow`, `generateCells`, `selectCandidates`, `rollUp`, `normaliseOffer`, `toGbp`, `validateVendorUrl`, `formatPence`, `stripControlChars`, …): WP1 and WP2 (`@gmt/core`).
- Layer-B tests (the real adapters replaying recorded fixtures, with their own harness) and estimate-versus-actual parity per real adapter: WP13; per-adapter `plan()` and `estimate()` parity against msw hits: WP5 and WP6.

## 3. Spec sections

| Section | What it requires of this package |
|---|---|
| §3 Cell outcome | Seed `not_run` for every cell × discovery provider at start and for every selected cell × verification provider at selection (`skipped:not_selected` otherwise); a stage with no provider has no rows and a `NULL` roll-up; an interrupted cell returns to `not_run`; a reported shortfall is never `no_data`. |
| §5.3 (rev 18) | A reservation that passed every cap is honoured and its result written; a budget stop refuses only new reservations (decision 25). |
| §5.4 | `no-return-legs` and `no-priced-options` are never retried by a resume, each stored as its own reason (decision 37); a chain stopped by budget or cancel returns the offers it paid for, and they are written (decision 27). |
| §5.6 | Normalise every raw price and offer: tz from the airports repository, one money step (`priceInGbp`) with `FX_MAX_RATE_AGE_DAYS`, ECB currencies only, one calendar price per (provider, cell) per tile, `offers-dropped:n`, cabin evidence on the observation; FX refreshed daily by a job that runs after boot. |
| §6.2 | An offer whose price no seller listing confirmed is never classed verified: `priceConfirmed` reads `unverified` whatever the constraints (decision 37). |
| §6.7 (rev 18) | Selection runs once per execution, guarded by the existence of verification outcomes, never choosing a departed cell; a child execution bypasses it (`alwaysInclude = [cell]`, `maxCells = 1`, no discovery), its call cap derives from its cell's estimate and the parent's headroom with `CHILD_MAX_CALLS` as the floor, and it never pauses. |
| §6.9 | The engine writes what results need: `best_observation_id` (the cheapest observation written, verdict-independent), child observations reachable through `observationsForDefinition`, verification outcomes that `latestVerificationOutcomeForCell` reads, reused calendar rows carrying the original `fetched_at`. |
| §7 (rev 10) | `route_price_history` upserted from each verification's `routeHistory`; atomic units (seeding with the execution row; each tile; selection + verification seeding; each reused cell; each verified cell; a resume's claim with its departed marking); the resume query per (stage, provider); the boot `running → interrupted` update; synchronous transaction callbacks; committed migrations (0001 adds `search_definitions.confirmed_calls`, decision 37). |
| §8.1 | Lifecycle, pre-start checks per scope, `SOFT_CONFIRM`, reuse with the 0.9 tolerance, the error table, estimate and parity, resume compare-and-set, `departed`, supersede, boot order, SIGTERM, notifications, single-cell verification. |
| §8.2 | croner with `timezone`, re-registration on create/PUT/disable/enable/delete, the tick order, one-shot resume jobs, `skipped_missed`, `parseCron` as the sole validator (sub-hourly rejected, tz validated), `budgetFit` with the cadence arithmetic of the §8.2 table (weekly ≈ 4.33 runs a month). |
| §8.3 | `LogNotifier`: plain text, provider strings control-stripped (C0 and C1), synthetic refused. |
| §9 item 4 | Layer A: every listed behaviour as a test through the fixture provider at `fixture.local`. |
| §14 | `executionId`, `definitionId`, `providerId` on engine log lines; no full URLs. |

The brief follows plan decisions 1–41 and the spec at revision 20. Spec revision 18 folded decision 25 into §5.3 and §6.7; where the spec's text still differs from a decision (the §8.1 error-table rows that abort in-flight siblings on a budget stop; §3's error-reason list without `no-priced-options`), this brief follows the decision and §11 lists the text that needs the matching revision.

## 4. Interfaces consumed

Copied verbatim from the plan's "Cross-package contracts" at its current head (decisions 1–41), then the places where the merged code on main is narrower or wider than that text, then the contract addition of decisions 27 and 29 this package consumes before WP5 merges. Every signature the tasks use matches main.

#### Identifiers and dates (`@gmt/core` `types/ids.ts`, WP0)

```ts
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$ after upper-casing
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata, string>;  // trims, upper-cases, then requires ^[A-Z]{3}$ (so 'lhr' → 'LHR'; 'LHRX' rejected)
export const isoDateSchema: z.ZodType<IsoDate, string>;    // regex + real calendar date check (rejects 2027-02-29)
export const isoMonthSchema: z.ZodType<IsoMonth, string>;
export const isoDateTimeSchema: z.ZodType<IsoDateTime, string>; // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ and Date.parse round-trips
export function isRealDate(y: number, m: number, d: number): boolean;
export function asIata(s: string): Iata;           // throws on mismatch. The as* helpers are the ONLY brand mint sites in the repository (production and tests); no `as <Brand>` anywhere else
export function asIsoDate(s: string): IsoDate;
export function asIsoMonth(s: string): IsoMonth;
export function asIsoDateTime(s: string): IsoDateTime;
export function isoDateTimeOfEpochMs(ms: number): IsoDateTime;   // new Date(ms).toISOString(), minted
```

#### Provenance and shared enums (`types/provenance.ts`, WP0)

```ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'fixture';   // defined here; ports/provider.ts re-exports it
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PointOfSale = string | 'unknown';   // ISO 3166-1 alpha-2 upper-case (POINT_OF_SALE echoes), or 'unknown'; pointOfSaleSchema = z.string().regex(/^[A-Z]{2}$/).or(z.literal('unknown'))
export type FxInfo = { converted: false } | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export interface Provenance {
  providerId: ProviderId; sourceKind: SourceKind; fetchedAt: IsoDateTime; providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown'; fx: FxInfo; pointOfSale: PointOfSale; cabin: Cabin;
}
export const providerIdSchema, sourceKindSchema, cabinSchema, pointOfSaleSchema, fxInfoSchema, provenanceSchema;
// provenanceSchema uses z.object({...}).strict() with providerObservedAt: isoDateTimeSchema.exactOptional()  (zod 4; needed under exactOptionalPropertyTypes)
```

#### Definition types (`types/definition.ts`, WP0)

```ts
export type WindowSpec = { kind: 'absolute'; from: IsoDate; to: IsoDate } | { kind: 'relative'; startOffsetDays: number; lengthDays: number };
export interface ResolvedSpace { origins: Iata[]; destinations: Iata[]; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }   // the ONLY definition; ports/provider.ts imports it
export interface Cell extends CellKey { nights: number }
export function cellKeyString(c: CellKey): string;        // `${origin}|${destination}|${departureDate}|${returnDate}` — lives here (WP0) so WP1, WP2, WP3 all share it
export function parseCellKeyString(s: string): CellKey;   // inverse; throws on malformed input
export type LocalTimeWindow = { from: string; to: string };   // HH:mm, inclusive, local to the airport
export interface Constraints {
  maxStops?: number; maxJourneyMinutes?: number; minLayoverMinutes?: number; maxLayoverMinutes?: number;
  noOvernightLayover?: boolean; departureWindowLocal?: LocalTimeWindow; arrivalWindowLocal?: LocalTimeWindow;
  noSelfTransfer?: boolean; noAirportChange?: boolean; includeAirlines?: string[]; excludeAirlines?: string[];
  cabinBagRequired?: boolean; checkedBagRequired?: boolean; minCheckedBags?: number; maxPricePence?: number;
}
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
export type DefinitionInput = Omit<SearchDefinition, 'id' | 'confirmedCostPence' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean; droppedAlwaysInclude: CellKey[] };
```

#### Execution types (`types/execution.ts`, WP0)

```ts
export type ExecutionStatus = 'pending' | 'running' | 'paused_budget' | 'paused_error' | 'interrupted' | 'cancelled' | 'completed'
  | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed';
export const ACTIVE_STATUSES: readonly ExecutionStatus[] = ['pending', 'running', 'paused_budget', 'paused_error', 'interrupted'];
export const RESUMABLE_STATUSES: readonly ExecutionStatus[] = ['interrupted', 'paused_budget', 'paused_error', 'cancelled', 'completed'];
export type Stage = 'discovery' | 'verification';
export type CellOutcomeStatus = 'not_run' | 'priced' | 'empty' | 'no_data' | 'error' | 'skipped';
export type SkipReason = 'not_selected' | 'budget' | 'provider_disabled' | 'departed';
export type NoDataReason = 'cabin-not-offered';          // a provider whose `cabins` excludes the definition's cabin: every cell no_data, no call
export type ErrorReason = ProviderErrorKind | NormalisationReason;   // the vendor message goes to lastError, never to reason
export interface CellOutcome extends CellKey {
  executionId: string; stage: Stage; providerId: ProviderId; status: CellOutcomeStatus; reason: string | null;
  attempts: number; lastError: string | null; fetchedAt: IsoDateTime | null; minPence: number | null;
  cabin: Cabin | null; pointOfSale: PointOfSale | null; sourceKind: SourceKind | null; reusedFromExecutionId: string | null;
}
export interface RollUp { status: CellOutcomeStatus | null; reason: string | null; minPence: number | null }   // null status ↔ API 'not_applicable'
export type SelectionReason = 'always_include' | 'top_n' | 'ceiling' | 'stride';
export interface Execution {
  id: string; definitionId: string; isChild: boolean; cell: CellKey | null; snapshot: DefinitionSnapshot; status: ExecutionStatus; stage: Stage | null;
  estimate: Estimate | null; cancelRequested: boolean; resumeAfter: IsoDateTime | null; autoResumeCount: number;
  startedAt: IsoDateTime | null; finishedAt: IsoDateTime | null; errorText: string | null; createdAt: IsoDateTime; trigger: 'manual' | 'schedule' | 'tool';
}
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }   // bucketsSchema in api-contract/common.ts is z.ZodType<Buckets>
```

#### Itinerary types (`types/itinerary.ts`, WP0)

```ts
export type SuppliedField = 'segments' | 'segmentTimes' | 'segmentCabins' | 'selfTransfer' | 'baggage' | 'fareConditions' | 'seller' | 'price';
export interface BaggageSnapshot { cabinBag?: 'included' | 'not-included'; checkedBags?: number; notes?: string[] }
export interface FareConditions { refundable?: boolean; changeable?: boolean; notes?: string[] }
export type Booking = { kind: 'get'; url: string; host: string } | { kind: 'post'; url: string; postData: string; host: string } | { kind: 'none' };
export interface Segment { marketingCarrier: string; operatingCarrier?: string; flightNumber: number; from: Iata; to: Iata; departLocal: string; arriveLocal: string; departUtc?: IsoDateTime; arriveUtc?: IsoDateTime; durationMinutes?: number; aircraft?: string }
export interface Layover { at: Iata; minutes: number; overnight: boolean; airportChange: boolean }
export interface NormalisedItinerary { hash: string; origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate; nights: number; outbound: Segment[]; inbound: Segment[]; outboundMinutes?: number; inboundMinutes?: number; stopsOut: number; stopsIn: number; layovers: Layover[]; airportChange?: boolean; marketingCarriers: string[] }
export interface Offer { itineraryHash: string; providerId: ProviderId; seller: string; cabin: Cabin }
export interface ObservationFields {   // what normalisation yields for one raw offer, before the db assigns ids
  pricePence: number; priceNativeMinor: number; currencyNative: string; fx: FxInfo; taxesIncluded: boolean | null; selfTransfer: boolean | null;
  segmentCabins: Cabin[] | null; baggage: BaggageSnapshot | null; fareConditions: FareConditions | null; booking: Booking; bookingExpiresAt: IsoDateTime | null;
}
export interface Observation extends ObservationFields { id: number; offerId: number; executionId: string; provenance: Provenance; suppliedFields: SuppliedField[]; partialExpansion: boolean }
export type Verdict = 'pass' | 'fail' | 'unverified';
export type ConstraintName = keyof Constraints | 'cabin';
export type Verdicts = Partial<Record<ConstraintName, Verdict>>;
export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
export type ResultBasis = 'verified' | 'calendar';   // API values; the UI labels them "itinerary-search basis" and "calendar basis"
```

#### Provider port (`ports/provider.ts`, WP0)

Spec §5.1 (revision 10) verbatim, with these settled details:

```ts
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }                                   // Travelpayouts month tiles (added in spec rev 10)
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
  recentCalls(providerId: ProviderId, since: IsoDateTime): number;   // upstream attempts since `since`; http-kit seeds its hourly reservoir from it after a restart
}
// DiscoveryQuery stays per (origin, destination) pair. Travelpayouts queries by airport code only (decision 34: a metro query returns one cheapest row per date pair across the metro and hides the definition's own fares), rows filtered to the pair by origin_airport; a scan costs O × D × M upstream free calls.
// A provider whose `cabins` excludes the definition's cabin is not called at all: the engine marks every cell for that provider and stage no_data with reason 'cabin-not-offered' (spec rev 10).
```

#### Budget port (`ports/budget.ts`, WP0)

```ts
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };
export interface Usage { calls: number; costMicroGbp: number; cap: number | null; windowStart: IsoDateTime | null; windowEnd: IsoDateTime | null }
// cap is null for a window the plan does not use (a month scope on a lifetime plan, and vice versa) and for a scope with no cap configured.
// Per-execution caps come from the execution's snapshot budget (search_executions.definition_snapshot_json → budget), never from config at reserve time; child executions carry { maxCalls: ceil(perCellEstimate × ESTIMATE_RETRY_FACTOR) bounded by the parent's remaining headroom (decision 25; CHILD_MAX_CALLS is the floor), maxFreeCalls: 0, maxCostMicroGbp: 0 } in their snapshot. Config EXECUTION_MAX_* are the defaults a new definition is created with.
```

#### Logger and clock (`ports/logger.ts`, `ports/clock.ts`, WP0)

```ts
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
export const systemClock: Clock;
export function fixedClock(at: IsoDateTime): Clock & { advance(ms: number): void; set(at: IsoDateTime): void };
export function londonDateOf(instant: IsoDateTime): IsoDate;
```

#### Notifier port (`ports/notifier.ts`, WP0)

```ts
export interface DigestItem { pricePence: number; provenance: Provenance; cell: Cell; verdictClass: VerdictClass | 'unchecked'; itineraryHash: string | null; seller: string | null; unverified: ConstraintName[]; previousPricePence: number | null; fetchGapHours: number | 'unknown' | null; isNew: boolean; firingReason: string; booking: Booking; bookingExpiresAt: IsoDateTime | null; outbound: Segment[] | null; inbound: Segment[] | null; searchLink: { url: string; host: string; label: string } | null /* null for synthetic rows */; rowKey: string /* resultRowKey, for the app link */ }
export interface AlertDigest { ruleId: string; definitionId: string; executionId: string; basis: ResultBasis; items: DigestItem[]; restCount: number /* firings beyond the top 10 */; newItems: DigestItem[]; newRestCount: number /* new cells beyond the top 10 */; coverageCaveat: { itinerarySearched: number; selected: number; expandTop: number } | null; rule: AlertRule }
export type OperatorMessageKind = 'paused_budget' | 'paused_error' | 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed' | 'interrupted' | 'provider_disabled' | 'provider_capped' | 'parity_break' | 'alerts_calendar_only' | 'crash_loop';
export interface OperatorMessage { kind: OperatorMessageKind; executionId: string | null; definitionId: string; subject: string; body: string }
export interface Notifier { id: string; send(msg: { kind: 'digest'; digest: AlertDigest; subject: string; body: string } | { kind: 'operator'; message: OperatorMessage }): Promise<{ ok: boolean; detail?: string }> }
// Rendering subject and body is the engine's job (WP7 for operator messages, WP11 for digests); core's buildDigest returns the structured AlertDigest only.
```

#### Alert types (`types/alerts.ts`, WP0)

```ts
export type AlertRuleType = 'absolute' | 'dropPct' | 'dropAbs';
export interface AlertRule { id: string; definitionId: string; type: AlertRuleType; thresholdPence: number | null; pct: number | null; basis: ResultBasis; requireAllVerified: boolean | null; cooldownHours: number; enabled: boolean }
export type AlertRuleInput = Omit<AlertRule, 'id'>;
export interface AlertEvent { id: number; ruleId: string; identityKey: string; observationId: number | null; calendarPriceId: number | null; dedupKey: string; firedAt: IsoDateTime; status: 'sent' | 'failed' | 'suppressed'; reason: string | null; payload: unknown }
export type VerifiedCandidate = { basis: 'verified'; observation: Observation; itinerary: NormalisedItinerary; verdictClass: VerdictClass; unverified: ConstraintName[]; seller: string; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };
export type CalendarCandidate = { basis: 'calendar'; calendarPriceId: number; fetchedByExecutionId: string; cell: Cell; pricePence: number; provenance: Provenance; previous: { pricePence: number; fetchedAt: IsoDateTime } | null };   // evaluateAlertRules refuses candidates whose fetchedByExecutionId ≠ ctx.executionId (reused rows)
export type AlertCandidate = VerifiedCandidate | CalendarCandidate;
export interface Firing { rule: AlertRule; candidate: AlertCandidate; identityKey: string; dedupKey: string; reason: string; isNew: boolean; suppressed: { reason: string } | null }   // evaluateAlertRules returns suppressed firings too; the runner records them with status 'suppressed' and the digest excludes them
export interface PriorFiring { identityKey: string; dedupKey: string; firedAt: IsoDateTime; pricePence: number }
// identityKey formats: verified `${ruleId}|${itineraryHash}`; calendar `${ruleId}|${providerId}|${cabin}|${cellKeyString(cell)}`. dedupKey = `${identityKey}|${Math.floor(pricePence / 100)}`.
```

#### Errors (`errors.ts`, WP0)

As in the WP0 tasks: `ProviderError`, `BudgetExceeded`, `AbortedError`, `NormalisationError`, `stripUrlsInText`. `ProviderErrorKind` and `NormalisationReason` are exported here. The outcome `reason` column holds the kind or normalisation reason only; the vendor message (URL-stripped) goes to `lastError`.

#### Config (`config/*.ts`, WP0)

As in the WP0 tasks, plus:

```ts
appBaseUrl: string | null;        // APP_BASE_URL, optional https URL; used by email templates to link to a results row; null → relative path
providers.fixture: { costMicroGbp: number } | null;   // only under syntheticAllowed; FIXTURE_COST_MICRO_GBP (default 0) read by the test/dev config, so engine tests can bill the fixture provider
```

#### Banned words (`text/bannedWords.ts`, WP0)

As in Task 0.6, plus `export const BANNED_WORD_ALLOWLIST: readonly string[] = ['smoke:live', 'lives in']` — the single allowlist every package's banned-word test passes. Vocabulary (spec §11): the SearchApi calendar source reads "Google date grid via SearchApi", the SearchApi itinerary source "Google Flights via SearchApi", Travelpayouts "Aviasales cache", the verified basis "itinerary-search basis".

#### Database (`@gmt/db`, WP0 skeleton, WP3 everything else)

```ts
// client.ts (WP0)
export interface Db { raw: BetterSqlite3.Database; drizzle: BetterSQLite3Database; transaction<T>(fn: () => T extends Promise<unknown> ? never : T): T; immediateTransaction<T>(fn: () => T extends Promise<unknown> ? never : T): T /* BEGIN IMMEDIATE, same Promise guard */; close(): void }
export function openDatabase(path: string): Db;
export function pendingMigrations(db: Db, migrationsDir: string): string[];      // migrate.ts (WP0): names of unapplied migration files
export function applyMigrations(db: Db, migrationsDir: string): { applied: string[] };
// repositories (WP3)
export interface RepoOptions { allowSynthetic: boolean }    // from syntheticAllowed(config); repositories throw on synthetic rows when false
export interface Repos { airports: AirportsRepo; fx: FxRepo; definitions: DefinitionsRepo; executions: ExecutionsRepo; cells: CellsRepo; calendarPrices: CalendarPricesRepo; itineraries: ItinerariesRepo; ledger: LedgerRepo; alerts: AlertsRepo; notifications: NotificationsRepo; routeHistory: RoutePriceHistoryRepo }
export function createRepos(db: Db, clock: Clock, opts: RepoOptions): Repos;   // Repos lives HERE, not in engine
export interface Airport { iata: Iata; icao: string | null; name: string; city: string; country: string; tz: string; lat: number; lon: number; metro: string | null; source: string; datasetVersion: string }
export interface AirportsDataset { version: string; airports: Array<Omit<Airport, 'source' | 'datasetVersion'>>; metros: Record<string, string[]> /* metro → airports, from the vendored attributed list */ }
export class AirportsRepo { exists(iata): boolean; get(iata): Airport | null; search(q: string, limit: number): Airport[]; metroOf(iata): string | null; airportsOfMetro(code: string): Iata[]; sharedMetro(iatas: Iata[]): string | null; count(): number; upsertAll(dataset: AirportsDataset): void; datasetVersion(): string | null; tzOf(iata): string | null }
export class FxRepo { rateNano(date: IsoDate, currency: string): number | null; latest(currency: string, maxAgeDays: number, today: IsoDate): { rateNano: number; date: IsoDate; source: string } | null; upsert(rows: Array<{ date: IsoDate; currency: string; rateNano: number; source: string }>): void }
export class DefinitionsRepo { create(input: DefinitionInput & { confirmedCostPence?: number }): SearchDefinition; update(id, patch: Partial<DefinitionInput>): SearchDefinition; get(id): SearchDefinition | null; list(opts?: { includeDeleted?: boolean }): SearchDefinition[]; softDelete(id): void; setConfirmedCost(id, pence: number | null): void }
export type ExecutionCreateInput = { definitionId: string; isChild: boolean; cell: CellKey | null; snapshot: DefinitionSnapshot; estimate: Estimate | null; trigger: Execution['trigger']; status: 'pending' | 'running' | ExecutionStatus & `skipped_${string}` }
export type ExecutionPatch = Partial<Pick<Execution, 'stage' | 'resumeAfter' | 'errorText' | 'startedAt' | 'finishedAt' | 'cancelRequested' | 'estimate' | 'snapshot'>>
export class ExecutionsRepo { create(input: ExecutionCreateInput): Execution; get(id): Execution | null; listForDefinition(definitionId, opts: { limit: number; includeChildren: boolean }): Execution[]; listByStatus(statuses: ExecutionStatus[]): Execution[]; activeParent(definitionId): Execution | null; activeChild(definitionId, cell: CellKey): Execution | null; latestCompleted(definitionId): Execution | null; claimResume(id): boolean; setStatus(id, status: ExecutionStatus, patch?: ExecutionPatch): void; patch(id, patch: ExecutionPatch): void; requestCancel(id): void; bootSweep(bootAt: IsoDateTime): { interrupted: string[] }; incrementAutoResume(id): number; resetAutoResume(id): void; lastScheduledFiring(definitionId): IsoDateTime | null }
export interface TileWrite { tileIndex: number; cells: CellKey[]; prices: CalendarPriceInsert[]; outcomes: Array<Pick<CellOutcome, 'origin' | 'destination' | 'departureDate' | 'returnDate' | 'status' | 'reason' | 'lastError' | 'fetchedAt' | 'minPence' | 'cabin' | 'pointOfSale' | 'sourceKind'>>; discards: number }
export interface CalendarPriceInsert { providerId; sourceKind; cabin; cell: CellKey; pricePence; priceNativeMinor; currencyNative; fx: FxInfo; pointOfSale; fetchedAt; providerObservedAt: IsoDateTime | null; maxAgeHours: number | null; vendorLink: string | null; reusedFromExecutionId: string | null }
export interface CalendarPriceRow extends CalendarPriceInsert { id: number; executionId: string; provenance: Provenance }
export interface VerifiedCellWrite { cell: CellKey; outcome: TileWrite['outcomes'][number]; itineraries: Array<{ itinerary: NormalisedItinerary; offers: Array<{ offer: Offer; observation: ObservationFields & { provenance: Provenance; suppliedFields: SuppliedField[]; partialExpansion: boolean } }> }> }   // best_observation_id = the cheapest observation written; the write applies the §6.6 monotone merge and never downgrades priced to empty
export interface ReusedCopy { cell: CellKey; outcome: CellOutcome; price: CalendarPriceRow | null }
export class CellsRepo { seed(executionId, cells: Cell[], discoveryProviders: ProviderId[]): void; seedVerification(executionId, selected: Array<{ cell: CellKey; reason: SelectionReason }>, allCells: CellKey[], verificationProviders: ProviderId[]): void; outcomes(executionId, filter?: { stage?: Stage; providerId?: ProviderId; cells?: CellKey[] }): CellOutcome[]; resumable(executionId, stage, providerId, manual: boolean): CellKey[]; markDeparted(executionId, today: IsoDate): number; markNoData(executionId, stage, providerId, reason: NoDataReason): number; writeTile(executionId, providerId, w: TileWrite): void; writeTileError(executionId, providerId, cells: CellKey[], reason: string, lastError: string | null): void; writeVerifiedCell(executionId, providerId, w: VerifiedCellWrite): void; setOutcome(executionId, cell, stage, providerId, patch: Partial<CellOutcome> & { incrementAttempts?: boolean }): void; setOutcomesForProvider(executionId, stage, providerId, from: CellOutcomeStatus[], to: { status; reason }): number; copyReused(executionId, providerId, copies: ReusedCopy[], criteria: ReuseCriteria): void; rollUps(executionId): Map<string, { discovery: RollUp; verification: RollUp }>; buckets(executionId, stage, providerId): Buckets; bucketsPerDay(executionId): Map<IsoDate, Array<{ stage; providerId; buckets: Buckets; total }>>; selected(executionId): Array<{ cell: CellKey; reason: SelectionReason }>; hasVerificationOutcomes(executionId): boolean }
export class CalendarPricesRepo { insert(executionId, rows: CalendarPriceInsert[]): number[]; latestPerCell(definitionId, cabin, space: ResolvedSpace | null): CalendarPriceRow[]; fetchedBy(executionId): CalendarPriceRow[] /* reused excluded */; previousFor(definitionId, providerId, cabin, cell, before: IsoDateTime, notOlderThan: IsoDateTime): CalendarPriceRow | null; reuseCandidates(definitionId, providerId, cabin, pointOfSale, sourceKind, cells: CellKey[], newerThan: IsoDateTime): ReusedCopy[]; history(origin, destination, cabin, opts?: { definitionId?: string }): Array<{ providerId; points: Array<HistoryPoint & { cell: Cell; executionId: string }> }> /* per provider, one point per execution fetch: the minimum across the pair's cells (within the definition's resolved space when given); reused rows excluded */; belowVerified(definitionId, cabin, space, thresholdPence): CalendarPriceRow[] }
export interface ObservationRow extends Observation { offer: Offer & { id: number }; itinerary: NormalisedItinerary; cell: Cell; seller: string }
export class ItinerariesRepo { upsertItinerary(it: NormalisedItinerary): void; recordObservation(offer: Offer, obs: Omit<Observation, 'id' | 'offerId'>): { offerId: number; observationId: number }; get(hash): (NormalisedItinerary & { firstSeenAt }) | null; observationsForDefinition(definitionId, opts: { executionIds: string[] | 'all'; space: ResolvedSpace | null; cabin: Cabin; includeChildren: boolean }): ObservationRow[]; writtenBy(executionId): ObservationRow[]; previousObservation(offerId: number, before: IsoDateTime): Observation | null; offerHistory(hash): Array<{ providerId; seller; cabin; points: HistoryPoint[] }>; latestVerificationOutcomeForCell(definitionId, cell, cabin: Cabin): CellOutcome | null; bestObservationForCell(executionId, cell): number | null }
export class LedgerRepo { countsFor(executionId): { calls: number /* upstream attempts, not cap usage */; costMicroGbp: number; tiles: number /* first-attempt upstream rows only; parity = tiles + cacheHits */; cacheHits: number; perProvider: Array<{ providerId; stage: Stage | null; calls; costMicroGbp; tiles; cacheHits }> }; firstAttemptTiles(executionId, providerId): number; sweepPending(olderThan: IsoDateTime): number; pruneCacheHits(olderThan: IsoDateTime, providerIds: ProviderId[]): number }
export class AlertsRepo { rules(definitionId?: string): AlertRule[]; get(id): AlertRule | null; create(input: AlertRuleInput): AlertRule; update(id, patch: Partial<AlertRuleInput>): AlertRule; softDelete(id): void /* alert_rules.deleted_at; events are kept */; events(filter: { ruleId?: string; definitionId?: string; limit: number }): AlertEvent[]; priorFirings(ruleId, identityKeys: string[], since: IsoDateTime): PriorFiring[]; insertEvent(e: Omit<AlertEvent, 'id'>): number }
export class NotificationsRepo { wasSent(kind: OperatorMessageKind, executionId: string | null, definitionId: string): boolean; record(kind, executionId, definitionId, status: 'sent' | 'failed'): void }
export class RoutePriceHistoryRepo { upsert(rows: Array<{ origin; destination; cabin: Cabin | 'unknown'; providerId; date: IsoDate; lowestPricePence: number; fetchedAt: IsoDateTime }>): void; series(origin, destination, providerId, cabin: Cabin | 'unknown'): RouteSeriesPoint[] }
export interface BudgetConfig { providers: Partial<Record<ProviderId, ProviderLimits & { billable: boolean; trialUsed: number }>>; spend: Config['spend'] }   // trialUsed seeds a lifetime window: effective cap = monthlyCallCap − trialUsed; the fixture cost is providers.fixture.costPerCallMicroGbp
export function budgetConfigFromConfig(c: Config): BudgetConfig;
export class SqliteBudgetGuard implements BudgetGuard { constructor(db: Db, config: BudgetConfig, clock: Clock) }   // execution caps read from the execution's snapshot budget; reserve refuses a costMicroGbp that differs from the provider's configured per-call rate (rule 'cost'); predicates and the pending insert run inside Db.immediateTransaction
export class SqliteResponseCache implements ResponseCache { constructor(db: Db, clock: Clock) }
export class AppLock { constructor(db: Db, holder: 'app' | 'tool', clock: Clock, log: Logger); acquire(opts: { waitMs: number }): 'acquired' | 'refused'; heartbeat(): void; release(): void; static inspect(db: Db): { holder; heartbeatAt; acquiredAt } | null }
export function seedAirports(db: Db, dataset: AirportsDataset): { inserted: number; datasetVersion: string };
export function sanityCheckAirports(db: Db, referenced: Iata[]): { ok: true } | { ok: false; reason: string };
export function runMaintenance(db: Db, clock: Clock, log: Logger, opts: { lifetimeProviders: ProviderId[] }): { cacheRowsDeleted: number; ledgerRowsPruned: number; dbBytes: number };
export function loadAirportsDataset(dir: string): AirportsDataset;   // reads airports.<version>.json + metros.json (CC BY-SA attributed list of IATA metropolitan codes) from packages/db/data
export function backupDatabase(dbPath: string, backupsDir: string, opts: { keep: number; clock: Clock }): { file: string };   // src/backup.ts (WP3): VACUUM INTO a timestamped file, PRAGMA integrity_check on the output, refuse an existing target, prune to `keep`; throws on any failure. scripts/backup.mjs (WP12) is a CLI wrapper; both bootstraps call it before buildPorts when pendingMigrations() is non-empty and the DB file exists.
```

Schema additions over spec §7 (rev 10 records them): `search_definitions.destination_notes_json`, `search_cells.discovery_reason`, `search_cells.verification_reason`, `search_cells.verification_min_pence`, `search_executions.trigger`, `search_executions.created_at`, `itineraries.layovers_json`, `fx_rates.source`, `operator_notifications.definition_id`, `provider_cache.provider_id NULL`, `route_price_history.cabin` allows `'unknown'`, `alert_rules.deleted_at`; the `providers` table is removed (spec rev 11; provider state comes from config); `cell_outcomes` carries the provider⇔kind CHECK and the provenance CHECK for priced/empty rows. `search_cells.best_observation_id` is the cheapest observation written for the cell (verdicts are computed at read time, so "cheapest verified" is a read-time query, never this column).

#### http-kit (`@gmt/providers` `http/httpKit.ts`, WP4)

```ts
export interface ResponseFacts { status: number; body: unknown /* scrubbed */; headers: Headers; providerId: ProviderId | 'fx'; endpointPath: string }
export interface ProviderHttpLimits { hosts: string[]; ratePerMinute: number; ratePerHour: number; concurrency: number; billable: 'http-200' | 'never' /* in http-kit: governs timeout retryability only; the ledger's billable flag is WP3's */; costPerCallMicroGbp: number; maxWaitSeconds: number; requestTimeoutSeconds: number; rateLimitFallbackWaitSeconds?: number /* wait for a 429 without Retry-After; absent → the first such 429 is non-retryable rate-limit with retryAfterSeconds = seconds to the hourly refresh */; classifyError?: (f: ResponseFacts) => ProviderError | undefined /* undefined → the default spec §5.2 table; http-kit applies Retry-After, limiter-timeout and scrubbing to whichever error results */ }
export interface HttpKitDeps { budget: BudgetGuard; cache: ResponseCache; limits: Partial<Record<ProviderId | 'fx', ProviderHttpLimits>>; clock: Clock; log: Logger; secrets: Secret[] /* non-empty whenever a real provider is configured */; syntheticAllowed: boolean /* required true for inProcessHosts or limits.fixture */; recorder?: FixtureRecorder; inProcessHosts?: Record<string, (req: Request) => Promise<Response>> }
// inProcessHosts: wiring passes { 'fixture.local': fixtureRouter(root).fetch } only under syntheticAllowed; http-kit dispatches requests whose hostname is a key here to that function instead of globalThis.fetch. Every other step of the pipeline (limiter, reserve, finalise, cache, recorder) still runs. This is the only transport seam and it is gated by the synthetic rule.
export interface HttpKitRequest { providerId: ProviderId | 'fx'; executionId: string | null; tileIndex: number | null; endpointPath: string; method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body?: string; cache: { ttlSeconds: number; accept?: (body: unknown) => boolean } | 'never' /* accept vetoes caching a body the adapter cannot parse; null or empty bodies are never cached */; signal: AbortSignal; recordFixtures: boolean }
// In-flight dedup: a joiner records its own recordCacheHit row (own executionId/tileIndex; not for fx), is raced against its own signal, and re-issues the request when the shared call ends in the leader's AbortedError or a BudgetExceeded on another execution's scope.
export interface HttpKitResponse { status: number; body: unknown; fetchedAt: IsoDateTime; fromCache: boolean; cacheKey: string }
export interface HttpKit { request(r: HttpKitRequest): Promise<HttpKitResponse>; stats(): { inFlight: number } }
export function createHttpKit(deps: HttpKitDeps): HttpKit;
// 'fx' requests skip budget.reserve/recordCacheHit entirely (never ledgered) but keep the limiter, allowlist, timeout and retry.
// Per-request timeout: setTimeout + AbortController (fakeable), non-retryable when billable === 'http-200'.
export interface RecordedFixture { recordedAt: IsoDateTime /* the response's fetchedAt, passed through the hook */; recordedBy: string; session: string /* the recorder's creation instant plus a random suffix; placeholders carry it and replay filters by it */; providerId: string; endpointPath: string; request: { method: string; url: string /* credential-free, query kept */; headers: Record<string, string> /* scrubbed */; body: string | null }; status: number; body: unknown; placeholders: Record<string, string>; contentSha256: string }
export interface FixtureRecorder { record(r: { providerId: ProviderId | 'fx'; endpointPath: string; request: HttpKitRequest; status: number; body: unknown; fetchedAt: IsoDateTime }): Promise<string /* path written */> }
export function createRecorder(opts: { root: string; secrets: Secret[]; clock: Clock; recordedBy: string }): FixtureRecorder;   // files: <root>/<providerId>/<endpointPath with / → _>/<yyyy-mm-dd>-<sha12>.json; raw bodies to *.raw.json beside them (gitignored)
export function contentHash(f: Omit<RecordedFixture, 'contentSha256'>): string;
export function withContentHash<T extends object>(file: T): T & { contentSha256: string };   // main barrel (WP4b): the allowlist writer hashes with WP4's own code
export function assertRecordedRoot(root: string): string;   // main barrel (WP4b): the real root, refused unless it exists and ends in fixtures/recorded; shared by the recorder, the readers and WP4b's allowlist writer
export function secretForms(value: string): string[];   // main barrel (WP4b): the one list of a secret's textual forms, from the leaf src/http/secretForms.ts that scripts/secret-scan.mjs also imports
export function scrubSecrets<T>(value: T, secrets: Secret[]): T;
export function stripUrl(url: string): string;
export function canonicalCacheKey(r: HttpKitRequest, secrets: Secret[]): string;   // sha256 over method + credential-free URL (query kept) + scrubbed headers + body only; never executionId or tileIndex, so an identical request from another execution inside the TTL is a cache hit
export interface ParamsAllowlist { provider: ProviderId; recordedAt: IsoDate; endpoints: Record<string /* '<path>' or '<path>?engine=<value>' for vendors that multiplex engines on one path */, { names: string[] /* ascending */; values: Record<string, string[] | 'any'> }>; contentSha256: string }   // src/params/allowlist.ts (WP4): the type, loadParamsAllowlist(path), assertRequestAllowed(allowlist, endpointPath, url) picks the most specific matching key
// RecordedFixture.request.headers DROPS credential headers entirely (Authorization, X-Access-Token) rather than scrubbing their values, so the secret scan's header-name rule passes.
export function fixtureProvider(opts: { http: HttpKit; log: Logger; clock: Clock; config: SyntheticGateInput; costMicroGbp: number }): FlightProvider;
export function fixtureRouter(root: string, gate: SyntheticGateInput): Hono;   // '@gmt/providers/fixture' subpath (not the main barrel); throws unless syntheticAllowed(gate); scenario control via POST /__fixture/scenario, the x-fixture-scenario header, and hold/release (POST /__fixture/release) so WP7 needs no second request layer; paged-calendar and chained-verification options exist for layer-A parity tests
// '@gmt/providers/testing' subpath export (src/testing/index.ts): fixtureHandlers(root, gate): RequestHandler[]; replayHandlers(recordedRoot, opts?: { session?: string }): { handlers: RequestHandler[]; misses(): string[] } (serves fixtures/recorded by matching method, path and credential-free query with placeholders as recorded; a miss is logged and answered with HttpResponse.error(), never passed through to the network; a match key served by more than one session is refused at construction unless `session` picks one; every consumer asserts misses() is empty in afterEach); loadRecorded(root, providerId, endpointPath): RecordedFixture[]; withContentHash (also on the main barrel, below). msw is a dependency of the package (not dev) because this subpath imports it; production code never imports the subpath (boundary script asserts).
```

#### Core domain functions (WP1, WP2)

```ts
// WP1 (dates/, space/, coverage/, selection/)
export function toEpochDay(d: IsoDate): number; export function fromEpochDay(n: number): IsoDate; export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number /* b − a */; export function monthOf(d: IsoDate): IsoMonth; export function monthsSpanned(from: IsoDate, to: IsoDate): IsoMonth[]; export function isLeapYear(y: number): boolean;
export function resolveWindow(w: WindowSpec, todayLondon: IsoDate): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean };
export function generateCells(space: ResolvedSpace): Cell[]; export function countCells(space: ResolvedSpace): number;
export interface AirportLookup { exists(iata: Iata): boolean; metroOf(iata: Iata): string | null; airportsOfMetro(code: string): Iata[] }
export type ValidationResult = { ok: true; resolved: ResolvedSpace; clamped: boolean; notes: string[] } | { ok: false; errors: Array<{ field: string; message: string }> };
export function validateSearchSpace(def: Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights' | 'verification'>, todayLondon: IsoDate, lookup: AirportLookup, maxCells: number): ValidationResult;
export function rollUp(outcomes: CellOutcome[]): RollUp; export function mergeWithinProvider(a: CellOutcome, b: CellOutcome): CellOutcome;
export function sixBuckets(outcomes: CellOutcome[]): Buckets /* one stage, one provider, one execution; the reference oracle WP3's SQL counts are asserted against */; export function selectedNotReached(selected: CellKey[], outcomes: CellOutcome[]): Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }>;   // throws when a selected cell has no verification rows
export function selectCandidates(policy: VerificationPolicy, cells: Cell[], discovery: Map<string, RollUp>, hasDiscoveryProvider: boolean): Array<{ cell: CellKey; reason: SelectionReason }>;   // throws RangeError unless maxCells/topN/perDepartureDateBest are non-negative integers and deduplicated in-space alwaysInclude ≤ maxCells; the stride walks only cells not already chosen
// rollUp rules settled: a priced roll-up carries 'partial-expansion' when any priced input has it; no_data outcomes with reason 'cabin-not-offered' are ignored whenever any other outcome exists and the roll-up is no_data:cabin-not-offered only when all are; error carries the reason when all agree, else 'mixed'; mergeWithinProvider keeps every field with the input that supplies the minimum price, replaces a reused outcome outright with a fresh priced, empty or no_data one (no min-merge against a reused copy, spec §6.6 rev 11; a fresh error never displaces a reused or fresh stronger result, it only counts an attempt) and throws on a priced input without minPence; WP3's write transactions call rollUp and mergeWithinProvider (no SQL copy)
// WP2 (normalise/, constraints/, results/, alerts/)
export function canonicalCarrier(s: string): string; export function canonicalFlightNumber(s: string | number, carrier?: string): number;
export function departLocal(input: string, timeKind: 'local' | 'utc' | 'offset', tz: string): string; export function toIsoDateTime(input: string, timeKind: 'local' | 'utc' | 'offset', tz: string): IsoDateTime;
export function itineraryHash(outbound: Segment[], inbound: Segment[]): string;
export const MINOR_EXPONENT: Record<string, number>; export const ECB_CURRENCIES: readonly string[]; export function toGbp(amountMinor: number, currency: string, rateNano: number): number;
export const LINK_ALLOWLIST: Record<ProviderId, string[]>; export const SEARCH_LINK_LABEL = 'search link, not a fare link'; export function validateVendorUrl(url: string, allowlist: string[]): Booking /* https only, no userinfo, no port, host equal to or subdomain of an entry, ≤ 2048 chars; POST postData ≤ 4096 */; export function searchLinkFor(providerId: ProviderId, cell: CellKey, cabin: Cabin): { url: string; host: string; label: string } | null /* null for 'fixture' */;
export function hasControlChars(s: string): boolean; export function stripControlChars(s: string, replacement = ''): string;   // src/text/control.ts: Unicode Cc set, code-point scan, no regex; WP11 wraps it for email headers
export const DEFAULT_DISCOVERY_REFRESH_HOURS = 168;   // spec §7 providers_json default; WP7 imports it, no local copy
export function formatPence(pence: number): string;   // src/text/money.ts: en-GB grouping, whole pounds when exact ('£412', '£1,234'), two decimals otherwise ('£412.50'); throws on non-integer or negative; the single money formatter (web and email import it)
export const CONSTRAINT_LABELS: Record<ConstraintName, string>;   // src/constraints/labels.ts: plain-English labels; completeness test
export interface NormaliseDeps { providerId: ProviderId; cabin: Cabin; tzOf(iata: Iata): string | null; rateFor(currency: string): { rateNano: number; rateDate: IsoDate; source: string } | null }
export function normaliseOffer(raw: RawOffer, cell: CellKey, deps: NormaliseDeps): { ok: true; itinerary: NormalisedItinerary; offer: Offer; observation: ObservationFields } | { ok: false; error: NormalisationError };
export function evaluateConstraints(it: NormalisedItinerary, obs: ObservationFields & { segmentCabins: Cabin[] | null }, c: Constraints, requestedCabin: Cabin, supplied: readonly SuppliedField[]): Verdicts; export function verdictClass(v: Verdicts): VerdictClass; export function unverifiedNames(v: Verdicts): ConstraintName[];
export type ResultRow = z.infer<typeof resultRowSchema>; export type SortKey = 'price' | 'totalTime' | 'departure' | 'return' | 'nights' | 'stops' | 'adjusted'; export interface ResultFilters { verdictClass?: Array<VerdictClass | 'unchecked'>; unverified?: ConstraintName[]; providerId?: ProviderId[]; maxStops?: number; carriers?: string[]; destination?: Iata[]; maxPricePence?: number; nights?: { min: number; max: number }; hideStale?: boolean }
export function resultRowKey(row: Pick<ResultRow, 'itineraryHash' | 'calendarPriceId'>): string;   // itineraryHash, or `calendar:${calendarPriceId}`; the web's `?row=` parameter and email links use it
export function dedupByItinerary(rows: ResultRow[], now: IsoDateTime): ResultRow[] /* primary offer by class, then seen-in-latest, then price, then fresher age, then seller (code-unit compare) */; export function rankRows(rows: ResultRow[], now: IsoDateTime): ResultRow[] /* class, seen-in-latest, price, age, seller; stale rows are labelled, never demoted */; export function sortRows(rows: ResultRow[], key: SortKey, dir: 'asc' | 'desc'): ResultRow[]; export function filterRows(rows: ResultRow[], f: ResultFilters): ResultRow[]; export function bandCheapest(rows: ResultRow[], bandHours: number): Set<string /* resultRowKey */> /* skips failed and notSeenInLatest rows; unchecked rows are eligible */;
export function evaluateAlertRules(rules: AlertRule[], candidates: AlertCandidate[], prior: PriorFiring[], ctx: { now: IsoDateTime; executionId: string; cabin: Cabin; discoveryRefreshHours: Partial<Record<ProviderId, number>> }): Firing[];   // settles each identity on its cheapest eligible candidate before judging; returns suppressed firings with `suppressed` set; within the cooldown the same identity fires again only when the new price is at least max(£10, 5%) below the last fired price (spec §6.8 rev 11)
export function identityKey(rule: AlertRule, c: AlertCandidate): string; export function dedupKey(identityKey: string, pricePence: number): string; export function isSuppressed(f: Pick<Firing, 'identityKey' | 'dedupKey' | 'candidate'>, prior: PriorFiring[], cooldownHours: number, now: IsoDateTime): { suppressed: boolean; reason: string | null };
export function buildDigest(rule: AlertRule, firings: Firing[], ctx: { executionId: string; definitionId: string; coverageCaveat: AlertDigest['coverageCaveat'] }): AlertDigest | null;   // null when no firing; top 10 + restCount
```

#### API contract shapes the engine produces values of (`api-contract/definitions.ts`, `system.ts`, WP0)

- `definitions.ts`: `definitionCreateRequestSchema` (DefinitionInput plus `confirmedCostPence?: number`, the explicit confirmation from the create click; `bookingLinks` forced true when verification includes `searchapi`; origins/destinations disjoint; `topN ≤ maxCells`; `alwaysInclude.length ≤ maxCells`); `definitionUpdateRequestSchema` (partial); `definitionResponseSchema` `SearchDefinition & { budgetFit: BudgetFit; estimate: Estimate | null; needsConfirmation: { estimateMicroGbp: number; confirmedCostPence: number | null } | null; notices: string[] }`; `budgetFitSchema` `{ fits: boolean; runsPerMonth: number; perScope: Array<{ scope: string; estimated: number; cap: number | null; fits: boolean }> }`; `estimateSchema` (= `Estimate`) `{ cells: number; perProvider: Array<{ providerId; stage: Stage; calls: number; planCalls: number; costMicroGbp: number; costPence: number; seconds: number; blocked: string | null }>; totalCalls: number; totalPlanCalls: number; totalCostMicroGbp: number; totalCostPence: number; seconds: number; assumptions: string[]; windowClamped: boolean; retryFactor: number }` (`planCalls` is pre-factor, for the overrun check); `POST /api/definitions/estimate` (body: `definitionCreateRequestSchema`, unsaved) and `POST /api/definitions/:id/estimate` both → `estimateResponseSchema` `{ estimate: Estimate; budgetFit: BudgetFit }` (so the form shows both before the create click); `coverageCheckRequestSchema` `{ origins, destinations, window, minNights, maxNights }`; `coverageCheckResponseSchema` `{ pairs: Array<{ origin, destination, months: Array<{ month: IsoMonth; cachedRows: number; cellsInBand: number }> }>; calls: number; notes: string[] }`.
- `system.ts`: `healthResponseSchema = z.union([healthPublicSchema, healthDetailSchema])` where public is `{ ok: boolean; degraded: boolean }` and detail `{ ok; degraded; db: { ok; path: never /* no path leaks */; sizeBytes }; providers: Array<{ providerId; configured; healthy: boolean | null }>; scheduler: { jobCount; nextRun; lastExecutionAt; degraded; blockedSince: IsoDateTime | null } }`; `providersResponseSchema` `{ providers: Array<{ providerId; displayName; enabled; capabilities: { discovery: CapabilityInfo | null; verification: CapabilityInfo | null }; plan: PlanId | 'free' | 'synthetic'; usage: Usage[]; excludedFromSchedule: boolean; notices: string[] }>; synthetic: boolean; presets: { policy: Pick<VerificationPolicy, 'maxCells' | 'topN' | 'expandTop' | 'bookingLinks'>; providers: ProvidersConfig; budget: ExecutionBudget; discoveryRefreshHours: number; schedulerTimezone: string }; pointOfSale: string }`; `budgetResponseSchema` `{ scopes: Usage[]; monthlyCapMicroGbp; monthlyCapPence; fixedFeesMicroGbp; ceilingNote: string }`; `schedulerJobsResponseSchema` `{ jobs: Array<SchedulerJob> }` with `schedulerJobSchema` exported and `SchedulerJob = { id: string; kind: 'definition' | 'resume'; definitionId: string; executionId: string | null; cron: string | null; tz: string; nextRun: IsoDateTime | null }`; `toolRecordRequestSchema` `{ budget: number; origins: Iata[]; destinations: Iata[]; month: IsoMonth }`; `toolSmokeRequestSchema` `{ origin: Iata; destination: Iata }`; `toolRunResponseSchema` `{ exitCode: number; summary: string; lines: string[]; fixturesWritten: string[] }`.

#### Decisions taken at reconciliation (plan, verbatim, in number order: 1–41)

1. `iataSchema` upper-cases input; `PointOfSale` is any ISO alpha-2 code or `'unknown'`; `CellKey` is defined once; `cellKeyString` moves to WP0; `Buckets`, `Estimate`, `BudgetFit`, `SchedulerJob`, `DigestItem`, `Firing`, `AlertCandidate`, `PriorFiring` are defined above.
2. `BudgetGuard.reserve` and `recordCacheHit` carry `tileIndex` (spec rev 10). `'fx'` is never ledgered and goes through http-kit (spec §5.6 corrected). Frankfurter's host is `api.frankfurter.dev` (`/v1/latest?from=GBP`); the old `.app` host redirects, and http-kit refuses redirects.
3. `TileRequest` gains `{ kind: 'month' }`. Travelpayouts queries per airport pair (metro queries withdrawn by decision 34). Cabin-not-offered is an engine rule, not an adapter rule. SearchApi rectangles are 8 × 19 for a 12-night band (tile count unchanged).
4. The API lives under `/api`; `GET /api/airports` and `POST /api/definitions/estimate` are added; `/api/tools/smoke` is mounted by WP13; health is a union schema.
5. Per-execution caps come from the snapshot; manual resume refreshes only the snapshot's budget. The record tool runs under a hidden soft-deleted definition's execution; deleted definitions are never resumed or scheduled.
6. The recorded-fixture file format and hash field (`contentSha256`) are pinned above; parameter allowlists carry the same hash; the runtime allowlist is a code constant asserted equal to the recorded file.
7. The fixture host is reached through http-kit's gated `inProcessHosts`; `@gmt/providers/testing` is the only module that imports msw.
8. Stryker runs with its command runner (`"testRunner": "command"`, `"commandRunner": { "command": "pnpm exec vitest run --coverage.enabled=false" }`) because `@stryker-mutator/vitest-runner` 10 executes no tests under Vitest 5; `ignorePatterns` uses `"/coverage"` so `src/coverage/` is mutated. Per-task test runs use `pnpm --filter @gmt/<pkg> exec vitest run <file>` (no coverage threshold on a partial run).
9. The `.gitignore` gains `backups/` and `*.db*`. The boundary script's `process.env` rule applies to `src/` trees only; only `apps/api/src/bootstrap/` reads `process.env`; `apps/api/src/wiring.ts` (`loadConfigFromEnv(env)`) and `apps/api/src/logger.ts` take the environment or config as an argument (tightened by WP4b, whose boundary script enforces it).
10. `AlertDigest` is structured; subject and body are rendered by WP11's templates. A digest with only "new" items and no firing is not sent. Validated booking and search links keep their query strings in API bodies and emails; every other URL sink is stripped.
11. The airports dataset ships with a separate attributed metro-code list (`packages/db/data/metros.json`, from Wikipedia's list of IATA metropolitan area codes, CC BY-SA 4.0, attribution file beside it). `SEARCHAPI_PLAN` `trial` keeps the lifetime window.
12. React is 19 (spec §4 updated). `APP_BASE_URL` is added to config. Smoke and record are invoked from the host with curl against the loopback port; the image has no curl.
13. Dispatch dependencies: WP6 depends on 1, 2, 4, 4b and WP5 on 1, 2, 4, 4b, 6 (WP5 consumes WP6's shared modules); WP12 depends on 8 and 9 (its docs-equals-constant test); WP4b depends on 3 and 4.
14. (Round 2) `backupDatabase` lives in `@gmt/db` (WP3) so both bootstraps can call it before WP12 exists; `ParamsAllowlist` lives in `@gmt/providers` (WP4); the cache key never includes execution or tile ids; recorded headers drop credentials entirely; one exit-code table for every CLI; `DigestItem` carries segments, expiry and the row key; `Firing.suppressed`; `resultRowKey`; `cell-mismatch`; `confirmedCostPence` on create/update; estimate responses carry `budgetFit`; calendar-gap carries the verified price with provenance; alert events filter by definition; child budget inherits all but `maxCalls`; `provider_capped` and `crash_loop` notification kinds; `EngineOptions.providerConcurrency`; four schema columns and `best_observation_id` semantics; spec §6.1 signature and §5.4 silent cases settled (rev 10).
15. (Round 3, from the wave-1 brief reviews) `classifyError` returns `ProviderError | undefined` over `ResponseFacts`; the ledger-at-cap arm of the 429 rule is dropped (quota only via a recognised body); joiners of in-flight requests record cache-hit rows and own their abort; cache `accept` hook; `HttpKitDeps.syntheticAllowed`; `fixtureRouter(root, gate)` on the `@gmt/providers/fixture` subpath; `rateLimitFallbackWaitSeconds`; `BudgetGuard.recentCalls`; allowlist keys with an engine discriminator; `replayHandlers` with a miss log; the `@gmt/source` export condition; `tsconfig.test.json` everywhere; `test:tz` in core; WP3 depends on WP1 and calls core's roll-up (no SQL copy); `reserve` refuses a mismatched cost; `Db.immediateTransaction`; `bestObservationSelector` and `BudgetConfig.fixtureCostMicroGbp` removed; `history` is one point per execution fetch; `latestVerificationOutcomeForCell` and `series` take a cabin; alert rules soft-delete; the `providers` table is removed; `selectCandidates` throws above `maxCells`; the cabin-not-offered precedence and roll-up reason rules; `dedupByItinerary(rows, now)` by class first; stale rows never demoted; the minimum drop step inside the cooldown; `verdictClass` throws without a cabin; `CalendarCandidate.fetchedByExecutionId`; `newRestCount`; nullable search links for synthetic rows; `formatPence` and `CONSTRAINT_LABELS` in core; `otherOffers` carry class and unverified names; the as* helpers are the only brand mint sites; the per-provider secret binding and a CI commit-trailer rule are declined.
16. (WP0 implementation, 2026-10-14) Settled while building WP0: `Estimate` is an interface in `types/execution.ts` and `estimateSchema` is `z.ZodType<Estimate>` (types never depend on the contract); `alertRuleUpdateRequestSchema` (an unrefined partial) is the PUT body because zod 4 refuses `.partial()` on a refined object; `isRealDate`, `asIsoMonth` and `isoDateTimeOfEpochMs` are exported from `types/ids.ts`; `parseCellKeyString` validates through a zod tuple; pnpm 12 declares build scripts as `allowBuilds: { better-sqlite3: true, esbuild: true }` in `pnpm-workspace.yaml` (the `onlyBuiltDependencies` key of Task 0.1 is the pnpm 10 form); the `Db.immediateTransaction` lock test asserts `code: 'SQLITE_BUSY'`; `pendingMigrations` reads `meta/_journal.json` and `__drizzle_migrations.created_at`.
17. (Round 4, from the wave-1 second-pass reviews) `RecordedFixture.session` and `fetchedAt` on the recorder hook; replay misses answered with an error response, never passed through; `replayHandlers` filters by `session`; the limiter is specified per fixed bottleneck window with `minTime = ceil(60000 / ratePerMinute)` smoothing; in a chained verification, `auth`, `quota`, `rate-limit` and `limiter-timeout` from any step propagate (only `upstream`, `network` and `parse` count as a failed expansion; spec §5.2 rev 12 says so); a fresh error never displaces a reused result; child snapshots carry `topN: 1`; `definitionShapeSchema` (unrefined) is the read-side schema for stored definitions and snapshots; the contract's inferred types (`ResultRow`, `HistoryPoint`, `RouteSeriesPoint`, `BudgetFit`, `SchedulerJob`, `CalendarDay`, `CoverageCheckRequest/Response`, `DefinitionResponse`) are exported from core's barrel; every package has a cross-package source-resolution smoke test; `DefinitionsRepo.create` accepts `confirmedCostPence`.
18. (From WP4's scratch run) msw 3 can reach the real network in three cases: it follows a mocked 3xx itself, it rejects a fetch whose mocked body stream errors, and it passes a socket through when the client aborts first. Every package's msw test setup therefore installs a catch-all handler that fails the test on any unmatched request, uses handlers that settle when the client aborts, and blocks DNS lookups for the run; the WP4 brief's `test/setup.ts` is the reference and WP5–WP13 reuse it through `@gmt/providers/testing`.
19. (From the WP3 branch reviews) Priced outcome reasons form a closed set: null, `partial-expansion`, `offers-dropped:n` and the combined `partial-expansion;offers-dropped:n`; core detects partial expansion by splitting on `;`, and roll-ups still carry only `partial-expansion`. `CalendarPricesRepo.supersedeReused` is removed: writeTile supersedes reused rows inline. `CalendarPricesRepo.insert` keeps the priced ⇔ price invariant by behaving as a prices-only tile write (outcome merged, roll-up recomputed, same transaction). writeTile merges fresh-on-fresh priced overlap through core's mergeWithinProvider, keeping the cheaper price row. `ItinerariesRepo.upsertOffer`/`insertObservation` are replaced by one transactional `recordObservation(offer, observation)`.
20. (From the WP4b brief review) The recording run makes no 429 burst; WP5 maps rate limits from a synthetic labelled fixture and `rateLimitFallbackWaitSeconds`, Retry-After behaviour unverified against the vendor. `RecordedFixture.responseHeaders` carries an allowlisted scrubbed subset (`retry-after`, `content-type`, `x-ratelimit-*`, `ratelimit-*`). `@gmt/providers/testing` exports `verifyRecordedTree`/`verifyRecordedFile` and `installNetworkGuards()`; no other package imports msw. Tools run against the operator's configured DATABASE_PATH (the production ledger), inspect app_lock read-only before any backup or migration, refuse when `syntheticAllowed(config)` is true, seed airports when the table is empty or the dataset version changed, and refuse a live recording whose planned calls plus credits already ledgered to tool executions in the lifetime window exceed `--budget` unless `--confirm-rerun` is passed. The recorded fixture tree is for this private repository; publishing the repository requires removing or re-recording vendor bodies. Every SearchApi request carries `travel_class`.
21. (From the WP2 branch review) `DigestItem.previousAgeHours` is renamed `fetchGapHours` (it is the gap between the two fetches, not the previous price's age); the calendar comparison window compares the gap in whole minutes; core exports `DEFAULT_DISCOVERY_REFRESH_HOURS` (168) and `stripControlChars(s, replacement = '')`, and WP7/WP11 use them instead of local copies.
22. (From the WP3 fix round) `CellsRepo.copyReused` takes a fourth argument `criteria: ReuseCriteria` (`{ pointOfSale, sourceKind, newerThan }`, exported by @gmt/db) and refuses any copy whose source misses it; core exports `isPartialExpansion(reason)`; the error-reason list includes `cell-mismatch`.
23. (From the WP4b brief revision) `createLogger(config, opts?: { fd?, secrets? })` scrubs secret values from every line; `runTool(name, argv, opts?)` takes test-injectable runners; `recordFixtures` ctx carries `recordedRoot`, `recordedBy` and `plan`; `RecordArgs` has no `metro`; `RecordSummary` gains `session` and `chain`; `RecordedCall.status` adds `'aborted' | 'no-response'` with `files` and `detail`. The SearchApi 401 probe runs before any billed call because the guard counts a pending reservation (WP13's smoke orders probes the same way). The hidden recording execution ends `completed` even when the guard refused calls (count in errorText), never `paused_budget`. @gmt/db exports `readOnlyLockState(dbPath, clock)` for the pre-migration lock probe; apps/api never imports better-sqlite3.
24. (From the WP5 and WP6 brief reviews) Shared adapter helpers live once in @gmt/providers: `shared/money.ts` `majorToMinor(major, currency)` (exact decimal-string arithmetic over core's MINOR_EXPONENT; null for excess precision or a non-positive amount, and the row is dropped and counted `offers-dropped:n`); `shared/errors.ts` `parseError(cause, detail)` whose `reason` is the closed-list kind-level reason and whose URL-free message carries the machine cause. A covered cell whose every row was dropped becomes `error` with the normalisation reason (spec §8.1). The ledger's unit is the tile: a sibling pair records one cache-hit row per tile, never per page. Healthchecks are stateless and probe nothing: `ok: true` with detail 'not probed' (`recentCalls` returns only a count, so no derivation is possible). Travelpayouts is queried per airport pair only (decision 34). SearchApi itinerary results carry `maxAgeHours: 'unknown'`. A chain stopped by budget or abort persists the step-2 offers it already paid for as unverified with reason `partial-expansion`. The recorded SearchApi allowlist (WP4b) equals WP5's SEARCHAPI_PARAMS: `adults=1` and `travel_class` on both engines, the documented price-sort and separate-ticket-exclusion parameters on google_flights, no `stops`; `DiscoveryQuery.maxStops` is a recorded Phase 4 gap. `clock` stays in every adapter constructor. Never invent a seller: null and `suppliedFields` without 'seller' when the vendor states none.
25. (From the WP7 brief review) A reservation that passed every cap is honoured: in-flight calls finish and write; only new reservations are refused on a budget stop; aborts happen only on operator cancel. Enabling or changing a schedule is refused when the summed monthly estimate of all enabled definitions would exceed the provider-month cap; the pre-start check uses remaining headroom. Soft confirmation triggers on runnable calls above 20% of the provider-month call cap as well as on pence. A child's maxCalls is ceil(per-cell estimate × ESTIMATE_RETRY_FACTOR) bounded by the parent's headroom; a child never pauses (cap breach → `cancelled`, cell stays unverified). The alerts step runs on completion and on paused_budget. confirmed_cost_pence records the worst-case estimate without reuse. `no-priced-options` is non-retryable automatically like `no-return-legs`; boot re-registration applies the stale-paused check; a paused run with no resume_after is superseded once older than 0.9 × discoveryRefreshHours. Coverage check counts distinct in-band cells and reports null for failed tiles. runsPerMonth = firings per 365-day year ÷ 12. Route price history keeps only vendor-supplied GBP points. Engine test harnesses live under packages/engine/test and stub only the 'fixture' provider.
26. (From the WP4b brief revision, round 2) `recordFixtures` ctx `recordedBy` is required (no fallback signature); `RunToolOptions.recording` carries root and signature together; `RecordSummary.chain` is `{ currency: 'GBP'; step1PricePence; step2PricePence; step3Options: [{ bookWith; pricePence }] }`. The committed recorded tree takes only the worked example's route; any other route needs `--out DIR` outside the repository (exit 64 otherwise). `apps/api/src/tools/workedExample.ts` joins `apps/web/src/example.ts` as the application files allowed to name the worked example's airports. Travelpayouts paging is capped at 3 pages per tile (`TP_MAX_PAGES_PER_TILE`). Tools run as the app's user (WP12 setup docs) because the read-only lock probe can leave -wal/-shm side files. A recording run that threw ends `cancelled` with errorText `record:fixtures failed: …`; one whose required calls were not as planned ends `completed` with errorText naming them. `separate_tickets=1` is the inferred excluding value; the first live run's recorded file is the authority.
27. (From the WP5 brief revision) `RawOffer` gains `verified: boolean`, true only when step 3 confirmed the price; WP7 writes unverified step-2 offers with `unverified` set and never as verified fares. Offers whose seller the vendor does not state are dropped and counted (`RawOffer.seller` is part of the fare-offer identity). A chain stopped by budget or cancel returns the step-2 offers it already paid for as a partial result, and WP7 writes a result that arrives after the stop signal (decision 25). `searchApiProvider` takes `costPerCallMicroGbp` (the configured rate), not a plan id. SearchApi tiling uses the largest outbound block b with b × (b + maxNights − minNights) ≤ 200 (worked band: 9 days, 21 tiles per pair, 84 discovery calls for four pairs; spec rev 15). `ItineraryQuery` has no self-transfer field: allowing self-transfer is a recorded Phase 4 gap. WP13 smoke rows: compare one recorded fare with the vendor's own page; try a 9-day rectangle; confirm `separate_tickets=1` excludes separate tickets. Dispatch order: WP6 merges before WP5 (WP5 consumes WP6's shared modules). `readOnlyLockState` returns a discriminated union.
28. (From the WP6 brief revision) (`DiscoveryQuery.definitionOrigins?` was added here and withdrawn by decision 34.) The tile result gains `cellIssues?: CellIssue[]` so a dropped row or an unread cell is reported per cell and never becomes `no_data`. `HttpKitRequest.ledgerCacheHit?` lets a multi-page cached tile ledger one cache-hit row per tile. `parseError(cause, detail, where?)`. Every Travelpayouts page must state its currency (the empty envelope too); a repeated page or an unreadable row is a parse error for the tile; `Z` or offset-less vendor times are refused; a bad vendor price is reason `parse`. `MAX_PAGES` is 3 (decision 26). WP6 implements these core and http-kit additions in its own tasks.
29. (From the WP5 round-2 review) WP5 adds `RawOffer.verified: boolean` to core's provider port (true only when step 3 confirmed the price). A currency whose minor-unit exponent core does not know is the normalisation reason `currency-unsupported` in both adapters: rows dropped and counted, never a tile-level parse error. `separate_tickets=1` is sent on both SearchApi engines (documented for both), and WP4b records it on both; the recorded in-limit rectangle uses the production tiling shape (9 × 20 for the worked band). The shared `NoteCounter` (add/get/list), `parseError(cause, detail, where)` with `where` always given, and `parseVendor` are the only parse and note helpers in the adapters. WP5 depends on WP6.
30. (From the WP6 round-2 revision) The discovery tile result gains `truncated?: boolean`, set when the pagination cap stopped a tile before its last page; WP7 labels prices from a truncated tile "cheapest of the rows read" and leaves unread covered cells as `error`/`upstream` via `cellIssues`. `parseError` and `parseVendor` require `where`. The fixture provider uses the shared `parseError` and `NoteCounter` (its drop note is `dropped-outside-tile`). The providers main barrel exports only each adapter's provider, limits and params constants plus `withContentHash` and `assertRecordedRoot` (for WP4b's tool); shared helpers stay internal except through the named `@gmt/providers/recording` subpath, which exposes `majorToMinor`, `buildRequestUrl`, `PAGE_LIMIT`, the page cap and `TileParams` to apps/api's recording tool only (decision 39); the tool takes the adapter's limits from the main barrel's `travelpayoutsHttpLimits`. Root scripts run tools with `pnpm -C apps/api run tool …` so the tool's exit code reaches the operator. The logger scrubs through pino's `hooks.streamWrite` and writes through `pino.destination({ dest, sync: true })`. Spec §5.1 is to list `definitionOrigins?`, `cellIssues?`, `truncated?` and `RawOffer.verified` at its next revision.
31. (From the WP6 round-3 review) WP4b records one extra free Travelpayouts call, TP-21, the reverse-direction month tile JFK → LON, so WP6's replay test asserts that every row's local departure month matches the tile month for a westward origin (UTC bucketing at month boundaries). A SearchApi chain that ends with zero usable offers throws (`parse` or `upstream` by cause) rather than returning a priced result with no offers, so WP7 never writes `empty` for a cell the vendor priced. The fixture provider's synthetic offers carry `verified: true` (they stand in for confirmed prices under the synthetic gate). Per-directory coverage floors for adapters live in the providers vitest config.
32. (From the WP4b fix round) Follow-ups owned by later packages: WP6 replaces the recording tool's hand-written pence conversion with the shared `majorToMinor`; WP5 and WP6 replace the tool's `recordingLimits` with their adapters' limit functions; WP7 moves `fxHttpLimits` beside the fx client; a db repository query for credits spent by tool executions replaces the tool's inline SQL when WP7 touches the ledger repo. The pre-migration preflight helpers live in `apps/api/src/bootstrap/preflight.ts` for WP8's app bootstrap to reuse.
33. (From the WP6 implementation against the live recordings) Travelpayouts writes a zero offset as `Z`: the adapter accepts `Z` as `+00:00` (time kind 'offset'); offset-less times stay refused. Rows carry undocumented keys `gate` (selling agency), `duration_to` and `duration_back`: the row schema allows unknown keys while validating the known ones; nothing reads them in Phases 1–3 and `suppliedFields` is unchanged (calendar prices carry no seller).
34. (From the WP6 replay tests against the live recordings) A Travelpayouts metro query returns one cheapest row per date pair across every airport in the metro, so a cheaper non-definition airport hides the definition's own fare (LON→JFK 2027-03-29/04-10 returned only an LTN row while LHR→JFK priced it). Travelpayouts is queried per (origin airport, destination airport, month) only; no metro queries, no cache-dedup saving (worked example 28 upstream free calls per scan); `DiscoveryQuery.definitionOrigins` is removed from core's provider port; the recorded metro tiles stay as evidence and one WP6 test documents the behaviour. Spec revision 17.
35. (From the WP6 branch review) Each Travelpayouts row's `link` carries `search_date=DDMMYYYY`, the day an Aviasales user found the fare; the recordings show rows 4–7 days old against the vendor's declared 48 h horizon. The adapter parses it into `RawCalendarPrice.providerObservedAt` (that day at 00:00 UTC, the oldest reading) and the age label uses it; the 48 h declaration is the fallback only when a link lacks the field, and the provenance note says so. The recording tool's plan moves to airport-pair tiles before any re-recording (WP13 or the next WP4b touch). Spec revision 19.
36. (From the WP9 brief review) Every price in the DOM renders through one PriceCell (FX marker, provider badge, source, age); the headline derives from the filtered set. Contract parsing runs in production too. `scripts/check-boundaries.mjs` checks airport literals over apps/web/src and apps/api/src, allowlisting only apps/web/src/example.ts and apps/api/src/tools/workedExample.ts; all example copy lives in example.ts. Core's ResultFilters gains a departure-date range filter (WP9 adds it); a max-travel-time filter and a Google Flights deep link are Phase 4. Confirmation copy shows calls as well as pence. The shell shows an error state when GET /api/providers fails. The coverage view adds a "with a price" share beside the spec's "searched"; stage totals count only searched outcomes. The api-contract gains `truncated: boolean` on calendar-basis rows and price cells, derived by WP8 from an outcome's last_error starting with core's exported `TRUNCATED_NOTE` (decision 30), rendered as "cheapest of the rows read".
37. (From the WP7 round-2 review) Core's closed error-reason list gains `no-priced-options` (stored honestly, excluded from resume estimates, never retried automatically). Core exports `TRUNCATED_NOTE`. A provider-month cap breach pauses the run with resume_after at the window reopening, as spec §7 says, and the guidance copy matches. Core's results classing treats an offer whose `price` is not a supplied field as `unverified` ("price not confirmed by the final step") regardless of constraints. The coverage check counts cells a page cap left unread as not checked, and its `calls` figure is labelled as tiles. Definitions gain `confirmed_calls` beside `confirmed_cost_pence` (WP7 adds migration 0001) and the pre-start comparison covers both. The child cap honours spec rev 18's `CHILD_MAX_CALLS` floor.
38. (From the WP10 brief review) One date-formatting module in the web app (WP9's), extended by WP10. The heatmap's default colour basis is the calendar basis unless verified days are a majority; every priced day carries a visible non-colour coverage cue; a day whose cells are all skipped shows a "skipped" state; a verified day that hides a cheaper cached fare says so; with fewer than ten priced days or a price spread under 10% the scale is flat and says so; day cells show price, compact badge, stay (nights or return date) and the coverage cue, details in the panel; phone width shows one month at a time. The route-level history series gets its own chart (price by travel date) labelled indicative; fetch-time series connect only consecutive scheduled runs; unverified offers plot dashed and labelled. Contract additions (core api-contract, WP10 adds with tests; WP8 fills): per-series `searched` flags in the duration analysis, the `cell` of each per-nights minimum, `stale` on history points. With a destination filter, day glyphs and buckets derive from that destination's cells only. The per-cell verify button shows the child's call cap and remaining headroom. Cross-execution views carry a ViewHeader variant. Duration table rows link to Results filtered by nights. A bucket total that disagrees with its sum renders "counts inconsistent". Legends define n.
39. (From the WP6 branch review) The recorded metro tiles also show rows whose return leg lands at a different airport of the metro (the link's `t=` token encodes the itinerary), so attributing a metro row by `origin_airport` produced the wrong cell, a second reason for decision 34. The adapter parses the return airport from the token and drops any row that is not a closed round trip for the pair as a per-cell issue (`parse`, detail `return-airport-mismatch`); a replay test pins that every airport-tile row is closed. TP-21 (JFK→LON) is metro evidence, not an airport tile. The recording tool uses the adapter's limits, URL builder and the shared money helper (decision 32 done).
40. (From the WP5 implementation against the live recordings) SearchApi's `price_insights` route-level series is best-effort: the recorded step-1 response (`sort_by=price`, `separate_tickets=1`) carries none, so the adapter returns an empty route history with an informational note and no error; WP10's route-level chart shows "no history supplied by the vendor" when empty. The recordings also put flight options under `other_flights` only; the adapter reads both `best_flights` and `other_flights`.
41. (From the WP5 branch review) A rate-limit or limiter-timeout in the middle of an itinerary chain propagates as decision 17 requires, so the step-2 offers already paid for are discarded and the cell is re-billed on resume; accepted as a rare residual (the alternative, carrying offers on a ProviderError, would blur the error contract). A step-2 fare dropped for a missing airline marks the result partial when returns were priced. A calendar row carrying both `has_no_flights` and a price is a conflicting entry, never "no fares".

#### Where main differs from the text above (the code wins)

- `@gmt/core` also exports, and this package uses: `isoDateTimeOfEpochMs` (every derived instant; no `as IsoDateTime`), `PARTIAL_EXPANSION` and `isPartialExpansion` (decisions 19, 22), `stripControlChars` and `DEFAULT_DISCOVERY_REFRESH_HOURS` (decision 21, from `alerts/evaluate.js`), `formatPence` (the only money formatter), `PENCE_TO_MICRO` (the one micro-GBP-to-pence factor), `BudgetScopeKind` (the scope union of `BudgetExceeded`), `ErrorReason`, `syntheticAllowed`, `parseConfig`, and the inferred contract types `BudgetFit`, `CoverageCheckRequest`, `CoverageCheckResponse`, `SchedulerJob` plus the interface `Estimate` (decisions 16, 17). The engine re-exports these types from core and declares none of its own.
- `DigestItem.fetchGapHours` is `number | null` on main.
- `CellsRepo.outcomes(executionId, filter?)` filters by `stage`, `providerId` and `cells` only; a status filter is applied by the caller. `writeTile` takes only `priced | empty | no_data` outcomes (one per covered cell, `RowRejected` otherwise); errors go through `writeTileError`, which counts a failed attempt and never displaces a stronger outcome. Every tile, verified-cell (non-error) and reuse write resets `auto_resume_count` in its own transaction, so the engine has no reset of its own. `markDeparted` turns `not_run` and non-departed `skipped` outcomes of both stages into `skipped:departed`. `seedVerification` refuses a second selection (`selection-once`).
- `CellsRepo.copyReused(executionId, providerId, copies, criteria: ReuseCriteria)` (decision 22) with `ReuseCriteria = { pointOfSale, sourceKind, newerThan }`, exported by `@gmt/db`. `ItinerariesRepo.recordObservation` replaces `upsertOffer`/`insertObservation` (decision 19); the engine writes observations only through `writeVerifiedCell`.
- `ExecutionsRepo.create` sets `started_at` when created `running`; `claimResume` also clears `resume_after`, `cancel_requested` and `finished_at`, and returns false (never throws) on a unique-index clash; `ExecutionPatch` has no `autoResumeCount` (tests use `incrementAutoResume`).
- `LedgerRepo.countsFor(...).tiles` counts DISTINCT first-attempt `provider:tile_index`; `perProvider[].stage` is `discovery` when `tile_index` is set, else `verification`.
- `@gmt/db` also exports `budgetConfigFromConfig(config)` (the fixture entry only under `syntheticAllowed`, `costPerCallMicroGbp` = `FIXTURE_COST_MICRO_GBP`, a fixed `monthlyCallCap` of 100 000), `effectiveCallCap` and `MIGRATIONS_DIR`. `NotificationsRepo.wasSent` counts `sent` rows only, so a failed send is retried at the next occurrence. `SqliteResponseCache.set` requires a 64-hex key.
- `@gmt/providers/fixture` exports `fixtureRouter(root, gate)`, `defaultFixtureRoot()`, `FIXTURE_TILE_DAYS`, `FixtureRule`, `FixtureResponse`, `scenarioRequest(rules)` and `releaseRequest(id, respond?)`; the fixture's tile results report `ProviderError`s as `tile-error` and let `AbortedError` and `BudgetExceeded` propagate. The `partial` rule removes the failed options from the answer. `@gmt/providers/testing` exports `installNetworkGuards`, `guardedServer`, `takeStrays`, `hangUntilAborted`, `respondAfter`; it is the only module that imports msw (decision 20). `HttpKitDeps.inProcessHosts` may name only `fixture.local`; `fx` goes to global fetch.
- `coverageCheckResponseSchema` declares `cachedRows: positiveInt`; Task 7.18 makes it `positiveInt.nullable()` (decisions 25, 37) and documents `calls` as the tiles requested.
- `DefinitionsRepo.setConfirmedCost(id, pence)` is the only confirmation writer on main and `search_definitions` has no calls column; Task 7.13 adds migration 0001 and replaces the method with `setConfirmed(id, { pence, calls } | null)`, which writes both in one statement (decision 37).
- `ErrorReason` is `ProviderErrorKind | NormalisationReason`, and db's `ERROR_REASONS` and the resume query's non-retryable list mirror it; Task 7.4 adds `no-priced-options` to all three (decision 37). `ProviderError.reason` is a free string the adapters set (`no-return-legs`, `no-priced-options`).
- WP6's Travelpayouts adapter is on main: one query per airport pair (decision 34); a tile stopped at the page cap reports `truncated: true` and each unread covered cell as a `cellIssues` entry (`upstream`, detail `pagination truncated at 3 pages`); a row that is not a closed round trip for the pair is a `parse` cell issue with detail `return-airport-mismatch` (decision 39); each row's `providerObservedAt` is the day its link's `search_date` names (decision 35), which the calendar write stores unchanged. SearchApi's route-level series may be empty (decision 40), which upserts nothing.

#### Contract addition consumed before WP5 merges (plan decisions 27, 29; WP5 Task 5.0 adds it to `packages/core/src/ports/provider.ts`)

```ts
export interface RawOffer { /* … as above … */ verified: boolean }   // true only when a seller listing confirmed the price; the fixture provider states true (decision 31)
```

`CellIssue`, `DiscoveryTileResult.cellIssues` and `truncated` (decisions 28, 30) are on main with WP6. The engine's reading of all three: a `cellIssues` entry makes its cell `priced` with `offers-dropped:n` when the tile also priced it, else `error` with the issue's reason and its detail in `last_error`, never `no_data`; a `truncated` tile's priced cells carry core's `TRUNCATED_NOTE` ("cheapest of the rows read") leading `last_error`, which WP8 maps to `truncated: true` on calendar-basis rows and price cells (decisions 36, 37); an offer with `verified: false` is written without `price` and `segmentCabins` in its supplied fields and without cabin evidence, so core's `evaluateConstraints` reads `priceConfirmed: 'unverified'` ("price not confirmed by the final step") and `cabin: 'unverified'` whatever the constraints, and the row can never class as verified (decision 37).

## 5. Interfaces produced

The plan's "Engine" contract, with the places decisions 25 and 37 change it (EngineOptions carries no cost; a child's `maxCalls` is computed with the `CHILD_MAX_CALLS` floor; a start confirms calls as well as pence):

```ts
export interface EngineDeps { config: Config; db: Db; repos: Repos; budget: BudgetGuard; cache: ResponseCache; http: HttpKit; providers: FlightProvider[]; notifiers: Notifier[]; clock: Clock; log: Logger }
export interface EngineOptions { alerts?: AlertsStepHook; providerConcurrency?: Partial<Record<ProviderId, number>> /* tests; production reads config limits */ }
export type AlertsStepHook = (deps: EngineDeps, executionId: string) => Promise<{ digests: number; events: number }>;   // WP11 provides runAlerts; default noAlerts
export type StartResult = { ok: true; executionId: string } | { ok: false; code: 'active' | 'cap' | 'confirm' | 'window' | 'not_found' | 'disabled'; message: string; details: unknown };
export type { Estimate, BudgetFit, SchedulerJob, CoverageCheckRequest, CoverageCheckResponse } from '@gmt/core';
export interface Engine { boot(): Promise<void>; shutdown(): Promise<void>; start(definitionId, opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number }): Promise<StartResult>; resume(executionId, opts: { manual: boolean }): Promise<StartResult>; cancel(executionId): Promise<boolean>; verifyCell(definitionId, cell: CellKey): Promise<StartResult>; estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate; estimateRemaining(executionId): Estimate; budgetFit(definition: DefinitionInput | SearchDefinition): BudgetFit; coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>; scheduler: { register(def: SearchDefinition): void; unregister(definitionId): void; jobs(): SchedulerJob[]; tick(definitionId): Promise<void>; blockedSince(): IsoDateTime | null }; status(): { running: string[]; degraded: boolean; nextRun: IsoDateTime | null; lastExecutionAt: IsoDateTime | null } }
export function createEngine(deps: EngineDeps, opts?: EngineOptions): Engine;   // boot() makes no network call (the FX refresh is a scheduled job that runs after boot)
export function parseCron(expr: string, tz: string): { ok: true; next: (from: Date) => Date | null } | { ok: false; reason: string };
export class LogNotifier implements Notifier { constructor(log: Logger) }
export function renderOperatorMessage(kind: OperatorMessageKind, ctx: { definitionName: string; executionId: string | null; detail: string; variant?: 'no-runnable-provider' }): { subject: string; body: string };   // engine/src/notifiers/operatorTemplates.ts
export const noAlerts: AlertsStepHook;
export function fxHttpLimits(cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>): ProviderHttpLimits;   // decision 32: the FX client's http-kit policy, beside the client; WP4b's httpLimitsFor imports it
// A child execution's snapshot budget is the definition's budget with only maxCalls replaced by max(CHILD_MAX_CALLS, min(its per-cell billed estimate × ESTIMATE_RETRY_FACTOR, headroom)), where headroom is the active parent's remaining execution-calls (else the definition's maxCalls) less what the definition's other active children may still spend; a cell needing more than that cap is refused with code cap. Its policy is { maxCells: 1, topN: 1, alwaysInclude: [cell] } with discovery []. A child never pauses: a cap breach ends it `cancelled` with errorText 'child cap reached' and its cell skipped:budget. The floor can pass the parent's headroom by at most CHILD_MAX_CALLS a child; provider-month and global caps still bound every call.
// A refused confirm carries details { estimateMicroGbp, estimatePence, calls: per provider, totalCalls }: a confirmation covers a run only when confirmCostPence × PENCE_TO_MICRO ≥ the runnable cost AND confirmCalls ≥ totalCalls (decision 37).
// Rules settled: manual resume of a paused_budget parent checks the definition's CURRENT budget (only `budget`) and writes it into the snapshot in the claim transaction. Executions whose definition is soft-deleted are never auto-resumed and never scheduled.
```

What the API reads from these values: `Engine.estimate` is the worst case without reuse (ruling 9: its `totalCostPence` and `totalCalls` are what `confirmed_cost_pence` and `confirmed_calls` record, through `DefinitionsRepo.setConfirmed`) with `perProvider[].blocked` filled from the pre-start check and the totals summed over the lines that would run (cost-r1-014); the estimate a start stores applies reuse and is compared against the stored confirmation, pence and calls. The coverage check's `cachedRows` is null for a month it could not fully check, and its `calls` counts tiles requested. `budgetFit` is without reuse, counts discovery at most once per refresh window, adds every other enabled scheduled definition to the `provider-month:<id>`/`provider-lifetime:<id>` and `global-month` scopes, and reports `runsPerMonth` unrounded; WP8 refuses enabling or changing a schedule while a provider-month scope does not fit (decision 25). `scheduler.blockedSince()` is the oldest "schedule blocked since" among definitions whose last tick was blocked (by an active execution or a refused resume), cleared by a tick that starts or resumes. A scheduled start that no configured provider can run is refused with code `disabled` (a configuration problem, not a cap) and notifies once per definition. A start whose every discovery provider is blocked for budget, with no cell always included, is refused with code `cap` (it would search nothing). `scheduler.tick` does nothing for a definition without a schedule; a stale paused run is cancelled with error_text `SUPERSEDED` and never replaced off the cron. Internal helpers (`createOrchestrator`, `buildContext`, `runPool`, …) are not exported from the barrel.

## 6. Library notes

Verified on 2026-10-14 against the sources named; what the table marks as exercised was confirmed on 2026-10-15 by assembling this brief on main and running it green, including the fake-timer behaviour of the whole stack (croner, bottleneck, p-retry under `vi.useFakeTimers`).

| Library | Version | API used here | Verified against |
|---|---|---|---|
| `croner` | 10.0.1 | `new Cron(pattern, { timezone, paused: true, mode: '5-part' })` with **no function** for validation (no timer is scheduled without a function; an invalid pattern throws); `new Cron(pattern, { timezone, catch, protect: true }, fn)` for definition and system jobs; `new Cron(date, { maxRuns: 1, catch }, fn)` for one-shot resume jobs (a `Date` pattern fires once; `nextRun()` is `null` when it will not fire); `job.nextRun(from?)`, `job.previousRuns(n, ref?)`, `job.stop()` (permanent). 10.x is strict about ranges (`/10`, `0/10` invalid unless `sloppyRanges`) and treats `?` as `*`; `mode: '5-part'` rejects seconds and year fields. DST: a wall time inside a spring-forward gap fires once at the later instant; a fall-back overlap fires once, at the first occurrence (pinned in Task 7.11). Timers are `setTimeout`, so `vi.useFakeTimers` + `vi.setSystemTime` drive them. | context7 `/hexagon/croner`: README "new Cron(pattern, options?, function?)", "job.previousRuns", `docs/src/usage/basics.md`, `docs/src/usage/examples.md` ("Fire on a specific date/time"), `docs/src/migration.md` ("Upgrading from 9.x to 10.x") |
| `pino` | — | Not a dependency of this package (removed from `package.json` here): `src/` uses only the `Logger` port, whose `child(bindings)` WP8 backs with pino's `logger.child`. The engine binds `executionId`, `definitionId` and `providerId` through `child`. | context7 `/pinojs/pino` `docs/api.md` "logger.child(bindings, [options])" |
| `zod` | 4.6.7 | `z.object`, `z.literal`, `z.record(z.string(), z.number().positive().finite())`, `safeParse` and `error.issues` for the frankfurter body; core's `isoDateSchema` inside it. Tests parse `StartResult.details` with a zod schema instead of a cast. | the same zod 4 calls WP0's api-contract schemas use; exercised by this revision's assembly run (typecheck and tests green) |
| `better-sqlite3` | 13.0.3 (dev only) | Tests construct `new Database.SqliteError(message, code)` to simulate `SQLITE_FULL` (Review Focus 5) and type reads with `db.raw.prepare<Params, Row>(sql)` (WP3's pattern; no `as`). `src/` never imports it; it detects a unique-index clash by `err.code === 'SQLITE_CONSTRAINT_UNIQUE'`. | WP3 pins the version; README "class SqliteError", `@types/better-sqlite3` `Statement<BindParameters, Result>` |
| `vitest` | 5.0.4 | `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })`, `vi.setSystemTime`, `vi.advanceTimersByTimeAsync`, `vi.isFakeTimers`, `vi.useRealTimers`, `vi.waitFor` (advances fake timers by its interval), `vi.stubGlobal('fetch', …)` / `vi.unstubAllGlobals`, `vi.spyOn`, `vi.fn`; `setupFiles`; after-hooks run in reverse registration order, so the setup file's harness cleanup runs before the network guard's stray check. | context7 `/vitest-dev/vitest` `docs/api/vi.md` ("vi.waitFor", "toFake") and `docs/guide/mocking/timers.md` as cited by the first draft; `vi.stubGlobal`, `vi.isFakeTimers`, `setupFiles` and the after-hook order exercised by this revision's assembly run |
| `drizzle-kit` | 0.31.11 (db dev) | `pnpm --filter @gmt/db exec drizzle-kit generate --name confirmed_calls` writes `drizzle/0001_confirmed_calls.sql`, `drizzle/meta/0001_snapshot.json` (the schema after the change) and the journal entry. For a new column with a table-level `check()`, the generated SQL rebuilds the table (`__new_search_definitions`) and its `INSERT … SELECT` names the new column in the old table, which has none, so the migration would fail; Task 7.13 keeps the generated snapshot and journal and replaces the SQL with one `ALTER TABLE … ADD … CONSTRAINT … CHECK(…)` (SQLite accepts a CHECK on an added column, and no foreign key is touched). | run on 2026-10-15 in this revision's assembly; the migration test applies 0001 to a database made at 0000 |
| `typescript` | 5.9.3 (root dev) | The definition-of-done cast check parses every touched file with `ts.createSourceFile` and reports each `AsExpression` or `TypeAssertionExpression` whose type is not `const`, so prose, strings and renamed imports never match and every type spelling does. | run in this revision's assembly, including a planted `as string`, `<number>` and `as readonly string[]` |
| frankfurter | HTTP API | `GET https://api.frankfurter.dev/v1/latest?from=GBP` returns `{ amount: number (1), base: string ("GBP"), date: string ("YYYY-MM-DD"), rates: Record<string, number> }`, where `rates[C]` is units of `C` per 1 GBP. **`https://api.frankfurter.app/latest?from=GBP` answers `301 Moved Permanently` to the `.dev/v1` URL**, and http-kit sends `redirect: 'error'`, so the engine calls the `.dev/v1` URL and the `fx` host allowlist is `api.frankfurter.dev` (decision 2). `fx` requests are never ledgered. Tests answer it with `vi.stubGlobal('fetch')` (test/support/fx.ts), because decision 20 keeps msw inside `@gmt/providers/testing` and http-kit's in-process seam names `fixture.local` only. | WebFetch of both URLs, 2026-10-14 |

## 7. Files

**Create** (all under `packages/engine/`)

- `src/types.ts` — `EngineDeps`, `EngineOptions`, `AlertsStepHook`, `StartResult`, `Engine`; re-exports core's `Estimate`, `BudgetFit`, `SchedulerJob`, `CoverageCheckRequest`, `CoverageCheckResponse`.
- `src/engine.ts` — `createEngine`, `statusOf`. `src/alertsStep.ts` — `noAlerts`. `src/context.ts` — `EngineContext`, `EngineHooks`, `ProviderRunLimits`, `buildContext`. `src/pool.ts` — `runPool`. `src/registry.ts` — passes running in this process. `src/text.ts` — `scopeName`, `scopeAmount`, `breachText`, `formatInstant`.
- `src/run.ts` — `RunState`, `StopReason`, `Lane`, `newRun`, `stopRun`, `laneFor`, `markRemaining`, `runnableCells`, `errorText`, `onFailure`, `disableProvider`, `budgetOut`, `applyBudgetBreach`, `settleLane`.
- `src/snapshot.ts` — `buildSnapshot`, `childSnapshot`. `src/orchestrator.ts` — `createOrchestrator`. `src/execute.ts` — `execute`, `alertsStep`, `finalStatus`, `parityNotice`, `calendarOnlyNotice`, `finish`, `CHILD_CAP_REACHED`.
- `src/start.ts` — `startExecution`, `recordSkipped`, `confirmationNeeded`, `Confirmation`, `nothingToSearch`, `SOFT_CONFIRM_CALL_SHARE`, `refused`, `isUniqueViolation`. `src/child.ts` — `verifyCellExecution`, `childMaxCalls`. `src/resume.ts` — `resumeExecution`, `olderThanRefresh`, `isStalePaused`, `supersede`, `SUPERSEDED`, `NEVER_STARTED`. `src/tick.ts` — `tickDefinition`.
- `src/stages/discovery.ts` (`runDiscovery`, `planTiles`, `discoveryQuery`, `commitTile`, `normaliseDeps`), `src/stages/verification.ts` (`runVerification`, `itineraryQuery`, `pricedReason`, `commitVerifiedCell`, `routeHistoryRows`), `src/stages/reuse.ts` (`applyReuse`, `reusableFor`, `reuseCriteriaFor`, `reuseCutoff`, `refreshHoursOf`, `REUSE_TOLERANCE`).
- `src/normalise.ts` — `rateFor`, `calendarPriceInGbp`, `PriceRefusal`, `reduceTile`, `vendorLinkOf`, `normaliseCalendarPrice`, `offerWrite`, `FX_SOURCE`.
- `src/estimate.ts` — `estimateStart`, `estimateRemainingFor`, `scheduleLoad`, `monthlyLoad`, `otherSchedules`, `budgetFitFor`, `addPass`, `withBlocked`, `SECONDS_PER_CALL`. `src/budgetCheck.ts` — `checkBudget`, `reservedForSchedules`, `spendOf`, `breachMessage`. `src/errors.ts` — `classifyFailure`, `addSeconds`.
- `src/notify.ts` — `notifyOperator`. `src/notifiers/operatorTemplates.ts` — `renderOperatorMessage`, `OPERATOR_KINDS`, `cleanLine`, `cleanText`. `src/notifiers/log.ts` — `LogNotifier`, `containsSynthetic`.
- `src/fx/limits.ts` — `fxHttpLimits` (decision 32).
- `src/scheduler/parseCron.ts` — `parseCron`, `isValidTimeZone`, `previousFiring`, `firingsBetween`, `runsPerMonth`. `src/scheduler/scheduler.ts` — `createScheduler`. `src/boot.ts` — `bootEngine`. `src/coverageCheck.ts` — `countCachedCells`, `coverageCheckWith`, `coverageCheckFor`. `src/fx/refresh.ts` — `refreshFx`, `parseFrankfurter`, `FRANKFURTER_LATEST_URL`. `src/maintenance.ts` — `runMaintenanceJob`, `runSystemJob`, `FX_REFRESH_CRON`, `MAINTENANCE_CRON`.
- `test/support/setup.ts` (network guards, harness cleanup), `test/support/harness.ts` (the layer-A harness, the worked example and `refusedWith`), `test/support/wrappers.ts` (fixture decorators, id `fixture`), `test/support/fx.ts` (frankfurter on stubbed fetch); 24 `test/*.test.ts` files, one or two per task as named there.

**Create** (outside the engine)

- `packages/core/src/labels/truncated.ts` — `TRUNCATED_NOTE` (Task 7.5). Tests: `packages/core/test/types/errorReason.test.ts` (7.4), `test/labels/truncated.test.ts` and `test/normalise/priceInGbp.test.ts` (7.5), `test/constraints/priceConfirmed.test.ts` (7.8), `test/api-contract/confirmedCalls.test.ts` (7.13), `test/api-contract/coverageCheck.test.ts` (7.18).
- `packages/db/drizzle/0001_confirmed_calls.sql` with the generated `drizzle/meta/0001_snapshot.json` and journal entry (7.13). Tests: `packages/db/test/cells.noPricedOptions.test.ts` (7.4), `test/migration0001.test.ts` (7.13).

**Modify**

- `packages/engine/package.json` — remove `pino` (unused by `src/`); add dev dependencies `better-sqlite3@13.0.3` and `@types/better-sqlite3@9.6.0` (tests only); `nodemailer` and `@types/nodemailer` stay for WP11 untouched; no `./testing` export (the harness is test-only). Run `pnpm install` so the lockfile follows.
- `packages/engine/vitest.config.ts` — `setupFiles: ['test/support/setup.ts']`; coverage over `src/**` minus barrels at 85/70/85/85.
- `packages/engine/src/index.ts` — the barrel (Task 7.19).
- `packages/core/src/types/execution.ts` (`NoPricedOptionsReason` in `ErrorReason`, 7.4); `src/index.ts` (exports `TRUNCATED_NOTE`, `priceInGbp`, `RateLookup`, 7.5); `src/normalise/money.ts` (`priceInGbp`) and `src/normalise/itinerary.ts` (uses it, 7.5); `src/types/itinerary.ts`, `src/constraints/labels.ts`, `src/constraints/evaluate.ts`, `src/api-contract/common.ts` (`priceConfirmed`, 7.8); `src/types/definition.ts`, `src/api-contract/definitions.ts`, `src/api-contract/executions.ts` (confirmed calls, 7.13; `cachedRows` nullable and `calls` as tiles, 7.18).
- `packages/db/src/internal/enums.ts` and `src/repositories/cells.ts` (`no-priced-options`, 7.4); `src/schema/searchDefinitions.ts`, `src/internal/definitionRow.ts`, `src/repositories/definitions.ts` (`confirmed_calls`, `setConfirmed`, 7.13); `test/definitions.test.ts`, `test/barrel.test.ts`, `test/client.test.ts` (7.13).
- `apps/api/src/wiring.ts` (`fx: fxHttpLimits(timing)`, 7.19, when the barrel exports it); `apps/api/test/bootstrap/tool.test.ts` (two migrations, 7.13).
- `vitest.aliases.ts` (the `@gmt/engine/testing` alias removed, 7.1).

Blocks for files outside the engine are unified diffs against main (`— apply this patch`, `git apply` from the repository root), so each shows exactly the lines it changes; engine files are given whole or as declarations.

**Test** — `pnpm --filter @gmt/engine test` runs every file under `packages/engine/test/`.

## 8. Tasks

Conventions for every task:

- **Preconditions.** WP7 is dispatched once WP5 and WP6 are on main (front matter `depends_on`). Before Task 7.1, `grep -n "verified: boolean" packages/core/src/ports/provider.ts` (WP5 Task 5.0, decisions 27 and 29) and `grep -nE "cellIssues\?|truncated\?" packages/core/src/ports/provider.ts` (WP6, merged) each print a match, and `grep -n definitionOrigins packages/core/src/ports/provider.ts` prints nothing (decision 34: queries are per airport pair). If one does not, stop and report: the engine reads those fields.
- **Code blocks.** Every block is complete and formatted as Biome leaves it, labelled by the line above it: `(new file)`; `— replace the file`; `— the import block becomes` (replace every import line at the top of the file with the block); `— replace or add these declarations` (each top-level declaration in the block, with its doc comment, replaces the declaration of the same name; one the file does not have yet goes directly after the declaration before it in the block, else at the end of the file); `— apply this patch` (a unified diff against the file as main or the previous task left it, for files outside the engine: save it and run `git apply <file>` from the repository root). Engine test files are always shown whole.
- **Runs.** Per-task runs use `pnpm --filter @gmt/engine exec vitest run <files>` (no coverage threshold on a partial run, decision 8), and `pnpm --filter <package> exec vitest run <files>` for the core, db and api tests a task names. Run `pnpm lint:fix` and `pnpm -r typecheck` before each commit. Every commit message starts `wp07:` and ends with the attribution line `MrReasonable <4990954+MrReasonable@users.noreply.github.com>`.
- **Rules the code keeps.** No `as` except `as const` and `satisfies` (instants through `isoDateTimeOfEpochMs`, SQL rows through `prepare<Params, Row>`, unknown values through zod or narrowing); no non-null assertions; `import type` for types; relative imports with `.js`. The only provider a test registers is the fixture provider under its own id `fixture` (sourceKind `synthetic`, behind the synthetic gate); a test that needs another behaviour wraps it (`test/support/wrappers.ts`) and keeps that id. A test never hides an assertion behind `if (!r.ok)` or a branch: refusals go through the harness's `refusedWith(r, code)`, which throws when the start went ahead (test-strategy-reviewer-029). Engine tests never import msw: the setup file installs `@gmt/providers/testing`'s guards and frankfurter is answered on stubbed fetch.

### Task 7.1: Resume after k of n tiles issues n−k (first failing test), with the layer-A harness and the pool

**Files:**
- Modify: `packages/engine/package.json`, `packages/engine/vitest.config.ts`, `vitest.aliases.ts` (the root alias for `@gmt/engine/testing`, a path that never exists, is removed: the harness is test-only; arch-r2-011)
- Create: `packages/engine/test/support/setup.ts`, `test/support/harness.ts`, `test/resume-k-of-n.test.ts`, `test/pool.test.ts`, `test/context.test.ts`
- Create: `packages/engine/src/types.ts`, `src/alertsStep.ts`, `src/context.ts`, `src/fx/limits.ts`, `src/pool.ts`, `src/text.ts`, `src/run.ts`, `src/registry.ts`, `src/snapshot.ts`, `src/normalise.ts`, `src/stages/discovery.ts`, `src/execute.ts`, `src/start.ts`, `src/resume.ts`, `src/orchestrator.ts`

**Interfaces:**
- Consumes: §4 (core types and ports, `budgetConfigFromConfig`, `MIGRATIONS_DIR`, `fixtureRouter`, `scenarioRequest`, `releaseRequest`, `installNetworkGuards`).
- Produces: `src/types.ts` as §5; `buildContext(deps, options?)` with limits read from `budgetConfigFromConfig(config)` (arch-014, ruling 3) and a refusal of the fixture provider without the synthetic gate (prov-wp07-012); `runPool(items, concurrency, intake, worker)`; the pass state with an intake switch and an abort signal that only cancel, SIGTERM and fatal raise (decision 25); `planTiles` asserting that tiles partition the cells (ssr-06); `commitTile` sending normalisation errors through `writeTileError` in the tile's transaction (po-009, prov-wp07-001); start creating, seeding and running the execution in one `BEGIN IMMEDIATE` (ssr-07); `createOrchestrator(ctx)` with `start`, `resume`, `shutdown`, `running`; `fxHttpLimits(config)`, the FX client's http-kit policy, which decision 32 moves into this package beside the client (the harness uses it here; `apps/api`'s `httpLimitsFor` switches to it in Task 7.19, once the barrel exports it); the harness API every later task uses, with `refusedWith`.

The harness is complete here; later tasks only call it. It lives under `test/support/` so `src/` holds production code only (ruling 1): the worked-example airports, `vi` and the providers' testing subpath never enter `src/`, and the src greps of §10 hold. It builds the guard from `budgetConfigFromConfig(config)` and overrides only the fixture's call cap, which no config field sets; it registers the fixture provider alone. `fakeTimers: true` fakes timers at the harness's `now` so http-kit's backoff and limiter, croner and the fixed clock agree; `waitForSettled` and `drive` advance them. `close()` releases holds, shuts every tracked orchestrator or engine down and closes the database; the setup file closes every open harness after each test, so a test that fails half-way never leaves a pass writing to a closed database. `tileRequests` reads `LedgerRepo.countsFor` (distinct tiles plus cache hits, the parity count); `count(table)` is a typed row count. Its `fixtureBillable` and `fixtureWindow` options change only the guard's view of the fixture, standing in for a free provider (Task 7.10) and a lifetime plan (Task 7.13), since no stub may take a real provider id.

`test/context.test.ts` pins the engine-level synthetic gate (prov-wp07-012, test-strategy-reviewer-023): a production-shaped config (no `ALLOW_FIXTURE_PROVIDER`) with the fixture provider registered makes `buildContext` throw the spec §5.5 message, with no request, ledger row, price or execution afterwards (Task 7.19 asserts the same of `createEngine`). Seen failing first: delete the eager `for (const id of providers.keys()) limitsOf(id);` line from `buildContext` and the test fails with "expected [Function] to throw an error"; restore it.

- [ ] **Step 1: Write the failing tests**

`packages/engine/package.json` — replace the file:

```json
{
  "name": "@gmt/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "@gmt/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json",
    "test": "vitest run --coverage"
  },
  "dependencies": {
    "@gmt/core": "workspace:*",
    "@gmt/db": "workspace:*",
    "@gmt/providers": "workspace:*",
    "croner": "10.0.1",
    "nodemailer": "10.1.1",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/better-sqlite3": "9.6.0",
    "@types/nodemailer": "8.0.2",
    "better-sqlite3": "13.0.3"
  }
}
```

`packages/engine/test/context.test.ts` (new file):

```ts
import { parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { createHarness } from './support/harness.js';

describe('buildContext: the engine-level synthetic gate (spec §5.5; prov-wp07-012)', () => {
  it('a production config with the fixture provider registered is refused at construction, before any request or write', () => {
    const h = createHarness();
    const parsed = parseConfig(
      {
        NODE_ENV: 'production',
        DATABASE_PATH: '/data/app.db',
        BIND_ADDRESS: '127.0.0.1',
        MONTHLY_SPEND_CAP_PENCE: '100000',
        EXECUTION_MAX_CALLS: '1000',
        EXECUTION_MAX_COST_PENCE: '100000',
        FIXTURE_COST_MICRO_GBP: '3200',
      },
      { realpath: (p) => p },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    // why: the production gate is closed (no ALLOW_FIXTURE_PROVIDER), yet the deps still register the fixture provider
    const deps = { ...h.deps, config: parsed.config };
    const message = 'the fixture provider is registered but syntheticAllowed(config) is false (spec §5.5)';
    expect(() => buildContext(deps, h.options)).toThrow(message);
    expect(h.requests).toEqual([]);
    expect(h.count('provider_requests')).toBe(0);
    expect(h.count('calendar_prices')).toBe(0);
    expect(h.repos.executions.listByStatus(['pending', 'running'])).toEqual([]);
  });
});
```

`packages/engine/test/pool.test.ts` (new file):

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
  it('stops taking items once intake aborts and lets the workers already running finish (decision 25)', async () => {
    const c = new AbortController();
    const started: number[] = [];
    const finished: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, c.signal, async (x) => {
      started.push(x);
      if (x === 2) c.abort();
      await tick();
      finished.push(x);
    });
    expect(started).toEqual([1, 2]);
    expect(finished.sort()).toEqual([1, 2]);
  });
  it('rethrows the first error that escapes a worker after draining', async () => {
    await expect(
      runPool([1, 2, 3], 1, new AbortController().signal, async (x) => {
        if (x === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
  it('rejects a concurrency below 1 and resolves at once for no items', async () => {
    await expect(runPool([1], 0, new AbortController().signal, async () => undefined)).rejects.toThrow(
      RangeError,
    );
    await expect(
      runPool([], 2, new AbortController().signal, async () => undefined),
    ).resolves.toBeUndefined();
  });
});
```

`packages/engine/test/resume-k-of-n.test.ts` (new file):

```ts
import { cellKeyString } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  discoveryOf,
  expectedTiles,
  JFK,
  LGW,
  LHR,
  noVerification,
} from './support/harness.js';

describe('resume after k of n tiles issues n−k (spec §9 item 4; WP7 first failing test)', () => {
  it('re-plans over the resumable cells only and the ledger shows exactly n first-attempt tile requests across both passes', async () => {
    // why: one tile in flight at a time (EngineOptions.providerConcurrency), so the interrupt lands exactly between tile k and k+1
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], providers: noVerification() });
    const n = expectedTiles(h, def);
    expect(n).toBe(4);
    const k = 2;

    const first = h.orch();
    h.onTileCommit((count) => {
      if (count === k) void first.shutdown(); // SIGTERM semantics: abort, cells in flight → not_run, status interrupted
    });
    const started = await first.start(def.id, { trigger: 'manual' });
    if (!started.ok) throw new Error(started.message);
    const id = started.executionId;
    expect((await h.waitForSettled(id)).status).toBe('interrupted');
    expect(h.tileRequests(id)).toBe(k);
    const resumable = h.outcomes(id, { stage: 'discovery', status: 'not_run' }).map(cellKeyString).sort();
    expect(resumable.length).toBeGreaterThan(0);

    h.clearHooks();
    const plan = vi.spyOn(discoveryOf(h.fixture), 'plan');
    const second = h.orch(); // a fresh process: no in-memory state survives
    expect(await second.resume(id, { manual: false })).toEqual({ ok: true, executionId: id });
    expect((await h.waitForSettled(id)).status).toBe('completed');

    // why: tile indexes number the tiles of one pass (spec §8.1 parity is per uninterrupted pass), so across two passes
    // the oracle is the first-attempt upstream rows: k in pass one + (n − k) in pass two
    const firstAttempts = h
      .ledgerRows(id)
      .filter((r) => r.tileIndex !== null && r.httpAttempt === 1 && r.outcome !== 'cache_hit');
    expect(firstAttempts).toHaveLength(n);
    // why: the resume's cap check plans the same cells once more (estimateRemaining), so compare distinct cells
    const planned = [...new Set(plan.mock.calls.flatMap(([q]) => (q.cells ?? []).map(cellKeyString)))].sort();
    expect(planned).toEqual(resumable); // plan() saw exactly the resumable cells, nothing already committed
    expect(h.outcomes(id, { stage: 'discovery', status: 'not_run' })).toHaveLength(0);
  });
});
```

`packages/engine/test/support/harness.ts` (new file):

```ts
/**
 * Layer-A engine test harness (spec §9 item 4): "the fixture provider as an HTTP adapter at fixture.local … through
 * the real http-kit and the real db BudgetGuard with the fixture cost rule, in-memory DB".
 *
 * It lives under test/ (never src/), so engine src stays free of airport codes and test libraries. Transport (plan
 * decisions 7 and 15): http-kit (`syntheticAllowed: true`) reaches `fixture.local` through its gated `inProcessHosts`
 * seam, answered by WP4's `fixtureRouter(defaultFixtureRoot(), config)`. Every control is WP4's: scenario rules
 * (`scenarioRequest`), `hold` rules and `releaseRequest`. The harness only logs what reaches the router
 * (`h.requests`). The only provider registered is the fixture provider, under its own id `fixture` with sourceKind
 * `synthetic` (ruling 1); a test that changes its behaviour wraps it (test/support/wrappers.ts) under that same id.
 */
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  type CellKey,
  type CellOutcome,
  type CellOutcomeStatus,
  type DefinitionInput,
  type Execution,
  type FlightProvider,
  fixedClock,
  generateCells,
  type IsoDateTime,
  type Logger,
  type Notifier,
  type OperatorMessage,
  type ProviderId,
  type ProvidersConfig,
  parseConfig,
  type SearchDefinition,
  type Stage,
  syntheticAllowed,
} from '@gmt/core';
import {
  type AirportsDataset,
  applyMigrations,
  budgetConfigFromConfig,
  type CellsRepo,
  createRepos,
  type Db,
  type ExecutionsRepo,
  MIGRATIONS_DIR,
  openDatabase,
  type Repos,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import { createHttpKit, fixtureHttpLimits, fixtureProvider, type ProviderHttpLimits } from '@gmt/providers';
import {
  defaultFixtureRoot,
  type FixtureRule,
  fixtureRouter,
  releaseRequest,
  scenarioRequest,
} from '@gmt/providers/fixture';
import { expect, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import { fxHttpLimits } from '../../src/fx/limits.js';
import { createOrchestrator, type Orchestrator } from '../../src/orchestrator.js';
import type { EngineDeps, EngineOptions, StartResult } from '../../src/types.js';

// --- the worked example (docs/briefs/README.md: London → New York only) ---
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');
/** Default "now" for every harness: a Wednesday morning, BST. */
export const T0 = asIsoDateTime('2026-10-14T09:00:00.000Z');
/** The base definition's window: 14 departure days, i.e. two 7-day fixture tiles per pair (WP4 FIXTURE_TILE_DAYS). */
export const WINDOW = { from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-15') } as const;
/** Per-call test cost of the fixture provider (the SearchApi per-call figure of spec §6.3, 0.32p). */
export const FIXTURE_COST_MICRO_GBP = 3200;
export const HOUR = 3_600_000;

/** Tiny synthetic airports dataset: the four worked-example airports with their real IANA zones and metros. */
export const TEST_AIRPORTS: AirportsDataset = {
  version: 'engine-layer-a-1',
  airports: [
    {
      iata: LHR,
      icao: 'EGLL',
      name: 'London Heathrow',
      city: 'London',
      country: 'GB',
      tz: 'Europe/London',
      lat: 51.47,
      lon: -0.4543,
      metro: 'LON',
    },
    {
      iata: LGW,
      icao: 'EGKK',
      name: 'London Gatwick',
      city: 'London',
      country: 'GB',
      tz: 'Europe/London',
      lat: 51.1481,
      lon: -0.1903,
      metro: 'LON',
    },
    {
      iata: JFK,
      icao: 'KJFK',
      name: 'John F. Kennedy International',
      city: 'New York',
      country: 'US',
      tz: 'America/New_York',
      lat: 40.6398,
      lon: -73.7789,
      metro: 'NYC',
    },
    {
      iata: EWR,
      icao: 'KEWR',
      name: 'Newark Liberty International',
      city: 'New York',
      country: 'US',
      tz: 'America/New_York',
      lat: 40.6925,
      lon: -74.1687,
      metro: 'NYC',
    },
  ],
  metros: { LON: [LHR, LGW], NYC: [JFK, EWR] },
};

// --- capturing logger and notifier ---
export interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  bindings: Record<string, unknown>;
  fields: Record<string, unknown>;
  msg: string | undefined;
}

/** A pino-shaped Logger that records every line with its accumulated child bindings. */
export function capturingLogger(lines: LogLine[], bindings: Record<string, unknown> = {}): Logger {
  const at =
    (level: LogLine['level']) =>
    (fields: object, msg?: string): void => {
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

/** A Notifier (plan "Notifier port") that records operator messages and digests and always succeeds. */
export function capturingNotifier(operator: OperatorMessage[], digests: unknown[]): Notifier {
  return {
    id: 'capture',
    send: async (m) => {
      if (m.kind === 'operator') operator.push(m.message);
      else digests.push(m);
      return { ok: true };
    },
  };
}

// --- request log (observation only: every control is WP4's scenario rules, hold and release) ---
export interface FixtureRequest {
  kind: 'calendar' | 'itinerary' | 'other';
  pair: string;
  ordinal: number;
  path: string;
  params: Record<string, string>;
}

/** The one hold id the layer-A tests use; `h.releaseHolds()` releases it. */
export const HOLD_ID = 'layer-a';

/** WP4 scenario rules for every §8.1 row (WP4 brief, "Which rule drives which spec §8.1 row"); `times` counts http-kit attempts. */
export const FIXTURE_RULES = {
  rateLimit: { kind: 'status', status: 429 },
  upstream: { kind: 'status', status: 503 },
  network: { kind: 'network' },
  badRequest: { kind: 'status', status: 400, body: { error: 'synthetic bad request' } },
  malformed: { kind: 'malformed' },
  notFound: { kind: 'status', status: 404 },
  auth: { kind: 'status', status: 401 },
  quota: { kind: 'status', status: 402 },
  limiterTimeout: { kind: 'status', status: 429, headers: { 'retry-after': '4000' } },
  noReturnLegs: { kind: 'no-return-legs' },
  partial: { kind: 'partial', failedExpansions: 1 },
  empty: { kind: 'empty' },
  // why: WP4 hold rule — a held request waits for releaseRequest(id) or its own abort
  hold: { kind: 'hold', id: HOLD_ID },
} as const satisfies Record<string, FixtureRule['respond']>;

/** One discovery tile of the base window: WP4 tiles start every 7 departure days from WINDOW.from. */
export function tileRule(
  origin: string,
  departFrom: string,
  respond: FixtureRule['respond'],
  times?: number,
): FixtureRule {
  return {
    match: { path: '/calendar', params: { origin, departFrom } },
    respond,
    ...(times !== undefined ? { times } : {}),
  };
}
/** The next `times` itinerary requests, whichever cells they are for. */
export function itineraryRule(respond: FixtureRule['respond'], times?: number): FixtureRule {
  return { match: { path: '/itinerary' }, respond, ...(times !== undefined ? { times } : {}) };
}

/** WP4 routes: `/calendar` (discovery tile) and `/itinerary` (verification); anything else is `other`. */
export function fixtureRequestKey(url: URL): Omit<FixtureRequest, 'ordinal'> {
  const kind =
    url.pathname === '/calendar' ? 'calendar' : url.pathname === '/itinerary' ? 'itinerary' : 'other';
  return {
    kind,
    pair: `${url.searchParams.get('origin') ?? '?'}-${url.searchParams.get('destination') ?? '?'}`,
    path: url.pathname,
    params: Object.fromEntries(url.searchParams),
  };
}

// --- definitions ---
/** Discovery by the fixture provider only. */
export function noVerification(): ProvidersConfig {
  return { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 168 } };
}
/** Discovery and verification by the fixture provider. */
export function withVerification(): ProvidersConfig {
  return { discovery: ['fixture'], verification: ['fixture'], discoveryRefreshHours: { fixture: 168 } };
}
/** Verification only (no discovery provider): every cell is a selection candidate by stride (spec §6.7). */
export function verificationOnly(): ProvidersConfig {
  return { discovery: [], verification: ['fixture'], discoveryRefreshHours: {} };
}
/** LHR → JFK over WINDOW, 7–8 nights: 28 cells, two fixture tiles. */
export function baseDefinition(): DefinitionInput {
  return {
    name: 'London to New York (layer A)',
    origins: [LHR],
    destinations: [JFK],
    window: { kind: 'absolute', from: WINDOW.from, to: WINDOW.to },
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
    enabled: true,
  };
}

/**
 * The refusal's message after checking its code; throws when the start went ahead, so a test never skips an assertion
 * behind `if (!r.ok)` (test-strategy-reviewer-029).
 */
export function refusedWith(r: StartResult, code: Extract<StartResult, { ok: false }>['code']): string {
  if (r.ok) throw new Error(`expected a refusal with code ${code}; it started ${r.executionId}`);
  expect(r.code).toBe(code);
  return r.message;
}
export function discoveryOf(p: FlightProvider): NonNullable<FlightProvider['discovery']> {
  if (p.discovery === undefined) throw new Error(`${p.id} has no discovery capability`);
  return p.discovery;
}
export function verificationOf(p: FlightProvider): NonNullable<FlightProvider['verification']> {
  if (p.verification === undefined) throw new Error(`${p.id} has no verification capability`);
  return p.verification;
}

export interface LedgerRow {
  providerId: string;
  executionId: string | null;
  endpointPath: string;
  tileIndex: number | null;
  outcome: string;
  billable: number | null;
  httpAttempt: number;
  costMicroGbp: number;
}

/** Tables a test may count rows of, per execution or in total. */
export type CountedTable =
  | 'calendar_prices'
  | 'price_observations'
  | 'provider_requests'
  | 'route_price_history';

export interface HarnessOptions {
  /** Extra or overriding environment for parseConfig (strings, as in .env). */
  env?: Record<string, string>;
  now?: IsoDateTime;
  /** Pool size for the fixture, both in the engine (EngineOptions.providerConcurrency) and in http-kit. */
  fixtureConcurrency?: number;
  /** The guard's fixture call cap (budgetConfigFromConfig fixes 100 000; no config field exists for it). */
  fixtureMonthlyCallCap?: number;
  /**
   * The guard's billable flag for the fixture (default true). False makes the guard count its calls against
   * execution-free-calls, as it does Travelpayouts' (test-strategy-reviewer-027); the engine's own limits still say billed.
   */
  fixtureBillable?: boolean;
  /** The guard's cap window for the fixture (default 'month'); 'lifetime' stands in for the SearchApi trial (cost-r2-004). */
  fixtureWindow?: 'month' | 'lifetime';
  /** Per-call cost of the fixture, passed as FIXTURE_COST_MICRO_GBP (default FIXTURE_COST_MICRO_GBP). */
  fixtureCostMicroGbp?: number;
  /** Wraps the fixture provider (still id `fixture`, still synthetic): test/support/wrappers.ts. */
  transformFixture?: (fixture: FlightProvider) => FlightProvider;
  /**
   * Fake setTimeout/setInterval/Date at `now` so http-kit's backoff, the limiter and croner run on the same time as
   * the fixed clock; `waitForSettled` advances them (test-strategy-reviewer-003, -004).
   */
  fakeTimers?: boolean;
}

/** Anything with a shutdown the harness must await before it closes the database. */
export interface Stoppable {
  shutdown(): Promise<void>;
}

export interface Harness {
  deps: EngineDeps;
  options: EngineOptions;
  config: EngineDeps['config'];
  clock: ReturnType<typeof fixedClock>;
  db: Db;
  repos: Repos;
  fixture: FlightProvider;
  logs: LogLine[];
  notifications: OperatorMessage[];
  digests: unknown[];
  requests: FixtureRequest[];
  /** WP4 scenario control: scenarioRequest(rules) (replaces the rules). */
  fixtureScenario(rules: FixtureRule[]): Promise<void>;
  /** WP4 hold control: releaseRequest(id) answers every request held under that id normally. */
  releaseHolds(id?: string): Promise<void>;
  onTileCommit(fn: (n: number, executionId: string) => void): void;
  beforeTileWrite(fn: (attempt: number, executionId: string) => void): void;
  onStageStart(stage: Stage, fn: (executionId: string) => void): void;
  clearHooks(): void;
  createDefinition(patch?: Partial<DefinitionInput>): SearchDefinition;
  /** A fresh orchestrator over this harness (a "fresh process": no in-memory state survives); shut down by close(). */
  orch(options?: EngineOptions): Orchestrator;
  /** Registers anything with a shutdown (an Engine) so close() stops it first. */
  track<T extends Stoppable>(s: T): T;
  waitForSettled(executionId: string): Promise<Execution>;
  /** Awaits `p`, advancing fake timers meanwhile (http-kit's limiter and backoff run on them); plain await otherwise. */
  drive<T>(p: Promise<T>): Promise<T>;
  runToCompletion(
    engine: {
      start(
        id: string,
        o: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number },
      ): Promise<StartResult>;
    },
    definitionId: string,
    opts?: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number },
  ): Promise<Execution>;
  /** CellsRepo.outcomes with a status filter applied here (the repository filters by stage, provider and cells only). */
  outcomes(
    executionId: string,
    filter?: { stage?: Stage; providerId?: ProviderId; status?: CellOutcomeStatus },
  ): CellOutcome[];
  ledgerRows(executionId: string): LedgerRow[];
  /** Spec §8.1 parity count for the fixture's discovery: distinct first-attempt tiles + cache hits (LedgerRepo.countsFor). */
  tileRequests(executionId: string): number;
  count(table: CountedTable, executionId?: string): number;
  spendLedger(p: {
    providerId: ProviderId;
    rows: number;
    costMicroGbpEach: number;
    executionId?: string | null;
  }): void;
  /** Idempotent: shuts down every tracked orchestrator and engine, releases holds, closes the database. */
  close(): Promise<void>;
}

const open = new Set<Harness>();

/** Closes every harness still open (the vitest setup file calls it after each test). */
export async function closeHarnesses(): Promise<void> {
  for (const h of [...open]) await h.close();
}

/** Expected tile count for a definition: the fixture's own plan per pair over that pair's cells. */
export function expectedTiles(
  h: Harness,
  def: Pick<SearchDefinition, 'window' | 'origins' | 'destinations' | 'minNights' | 'maxNights' | 'cabin'>,
): number {
  if (def.window.kind !== 'absolute') throw new Error('expectedTiles needs an absolute window');
  const d = discoveryOf(h.fixture);
  let n = 0;
  for (const origin of def.origins) {
    for (const destination of def.destinations) {
      const cells: CellKey[] = generateCells({
        origins: [origin],
        destinations: [destination],
        departureFrom: def.window.from,
        departureTo: def.window.to,
        minNights: def.minNights,
        maxNights: def.maxNights,
      });
      n += d.plan({
        origin,
        destination,
        departureFrom: def.window.from,
        departureTo: def.window.to,
        minNights: def.minNights,
        maxNights: def.maxNights,
        cabin: def.cabin,
        currency: 'GBP',
        cells,
      }).length;
    }
  }
  return n;
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  const now = opts.now ?? T0;
  if (opts.fakeTimers === true) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(now));
  }
  const parsed = parseConfig(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      // why: the fixture provider is billed at FIXTURE_COST_MICRO_GBP, so the global and execution cost caps must allow it
      MONTHLY_SPEND_CAP_PENCE: '100000',
      EXECUTION_MAX_CALLS: '1000',
      EXECUTION_MAX_COST_PENCE: '100000',
      REQUEST_TIMEOUT_SECONDS: '10',
      FIXTURE_COST_MICRO_GBP: String(opts.fixtureCostMicroGbp ?? FIXTURE_COST_MICRO_GBP),
      ...opts.env,
    },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(`harness config invalid: ${JSON.stringify(parsed.errors)}`);
  const config = parsed.config;
  // why: the production gate, never a hard-coded true (prov-wp07-012); the harness config must open it
  if (!syntheticAllowed(config)) throw new Error('harness config must satisfy syntheticAllowed');
  const fixtureCfg = config.providers.fixture;
  if (fixtureCfg === null) throw new Error('harness config has no fixture provider');
  const clock = fixedClock(now);
  const logs: LogLine[] = [];
  const log = capturingLogger(logs);
  const notifications: OperatorMessage[] = [];
  const digests: unknown[] = [];

  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const repos = createRepos(db, clock, { allowSynthetic: syntheticAllowed(config) });
  repos.airports.upsertAll(TEST_AIRPORTS);

  // why: the production wiring (arch-014); only the fixture's call cap, which no config field sets, is overridden
  const fromConfig = budgetConfigFromConfig(config);
  const fixtureBudget = fromConfig.providers.fixture;
  if (fixtureBudget === undefined) throw new Error('budgetConfigFromConfig left out the fixture provider');
  const budgetConfig = {
    ...fromConfig,
    providers: {
      ...fromConfig.providers,
      fixture: {
        ...fixtureBudget,
        monthlyCallCap: opts.fixtureMonthlyCallCap ?? fixtureBudget.monthlyCallCap,
        billable: opts.fixtureBillable ?? fixtureBudget.billable,
        window: opts.fixtureWindow ?? fixtureBudget.window,
      },
    },
  };
  const budget = new SqliteBudgetGuard(db, budgetConfig, clock);
  const cache = new SqliteResponseCache(db, clock);
  const fixtureHttp: ProviderHttpLimits = {
    ...fixtureHttpLimits({
      costPerCallMicroGbp: fixtureCfg.costMicroGbp,
      maxWaitSeconds: config.maxWaitSeconds,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
    }),
    concurrency: opts.fixtureConcurrency ?? 4,
  };
  const fxHttp = fxHttpLimits(config);

  // --- WP4's fixture router, in process; the log only observes (no second request layer) ---
  const router = fixtureRouter(defaultFixtureRoot(), config);
  const requests: FixtureRequest[] = [];
  const ordinals: Record<FixtureRequest['kind'], number> = { calendar: 0, itinerary: 0, other: 0 };
  const observed = async (req: Request): Promise<Response> => {
    const key = fixtureRequestKey(new URL(req.url));
    ordinals[key.kind] += 1;
    requests.push({ ...key, ordinal: ordinals[key.kind] });
    return router.fetch(req);
  };
  const http = createHttpKit({
    budget,
    cache,
    clock,
    log,
    secrets: [],
    syntheticAllowed: syntheticAllowed(config),
    limits: { fixture: fixtureHttp, fx: fxHttp },
    // why: plan decision 7 — the only transport seam; frankfurter goes to global fetch (stubbed per test, test/support/fx.ts)
    inProcessHosts: { 'fixture.local': observed },
  });
  const fixture = fixtureProvider({ http, log, clock, config, costMicroGbp: fixtureCfg.costMicroGbp });
  const providers = [opts.transformFixture ? opts.transformFixture(fixture) : fixture];

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
    for (const hk of stageHooks) if (stage === hk.stage) hk.fn(args[0]);
  };

  const deps: EngineDeps = {
    config,
    db,
    repos,
    budget,
    cache,
    http,
    providers,
    notifiers: [capturingNotifier(notifications, digests)],
    clock,
    log,
  };
  const options: EngineOptions =
    opts.fixtureConcurrency !== undefined
      ? { providerConcurrency: { fixture: opts.fixtureConcurrency } }
      : {};
  const tracked: Stoppable[] = [];
  let closed = false;

  // why: real or fake timers alike — under fake timers each step advances them, so backoff, the limiter and croner move
  const step = (): Promise<unknown> =>
    vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(25) : new Promise((r) => setTimeout(r, 5));
  const waitForSettled = async (executionId: string): Promise<Execution> => {
    for (let i = 0; i < 4000; i += 1) {
      const e = repos.executions.get(executionId);
      if (e === null) throw new Error(`no execution ${executionId}`);
      if (e.status !== 'pending' && e.status !== 'running') return e;
      await step();
    }
    throw new Error(`execution ${executionId} did not settle`);
  };
  const drive = async <T>(p: Promise<T>): Promise<T> => {
    let settled = false;
    const mark = (): void => {
      settled = true;
    };
    p.then(mark, mark);
    for (let i = 0; i < 4000 && !settled; i += 1) await step();
    return p;
  };
  const tableCount = (table: CountedTable, executionId?: string): number => {
    const row =
      executionId === undefined
        ? db.raw.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()
        : db.raw
            .prepare<[string], { n: number }>(`SELECT count(*) AS n FROM ${table} WHERE execution_id = ?`)
            .get(executionId);
    return row?.n ?? 0;
  };

  const h: Harness = {
    deps,
    options,
    config,
    clock,
    db,
    repos,
    fixture: providers[0] ?? fixture,
    logs,
    notifications,
    digests,
    requests,
    fixtureScenario: async (rules) => {
      const res = await router.fetch(scenarioRequest(rules));
      if (!res.ok) throw new Error(`fixture scenario refused: ${res.status} ${await res.text()}`);
    },
    releaseHolds: async (id = HOLD_ID) => {
      const res = await router.fetch(releaseRequest(id));
      if (!res.ok) throw new Error(`fixture release refused: ${res.status}`);
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
    orch: (o = options) => h.track(createOrchestrator(buildContext(deps, o))),
    track: (s) => {
      tracked.push(s);
      return s;
    },
    waitForSettled,
    drive,
    runToCompletion: async (engine, definitionId, o = { trigger: 'manual' }) => {
      const r = await engine.start(definitionId, o);
      if (!r.ok) throw new Error(`start refused: ${r.code}: ${r.message}`);
      return waitForSettled(r.executionId);
    },
    outcomes: (executionId, filter = {}) => {
      const { status, ...repoFilter } = filter;
      const rows = repos.cells.outcomes(executionId, repoFilter);
      return status === undefined ? rows : rows.filter((o) => o.status === status);
    },
    ledgerRows: (executionId) =>
      db.raw
        .prepare<[string], LedgerRow>(
          `SELECT provider_id AS providerId, execution_id AS executionId, endpoint_path AS endpointPath, tile_index AS tileIndex,
                  outcome, billable, http_attempt AS httpAttempt, cost_micro_gbp AS costMicroGbp
             FROM provider_requests WHERE execution_id = ? ORDER BY id`,
        )
        .all(executionId),
    tileRequests: (executionId) => {
      const row = repos.ledger
        .countsFor(executionId)
        .perProvider.find((p) => p.providerId === 'fixture' && p.stage === 'discovery');
      return (row?.tiles ?? 0) + (row?.cacheHits ?? 0);
    },
    count: tableCount,
    spendLedger: ({ providerId, rows, costMicroGbpEach, executionId = null }) => {
      const at = clock.now();
      const insert = db.raw.prepare(
        `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms,
                                        http_status, outcome, billable, cost_micro_gbp, http_attempt)
         VALUES (?, ?, '/test-spend', NULL, ?, ?, 0, 200, 'ok', 1, ?, 1)`,
      );
      db.transaction(() => {
        for (let i = 0; i < rows; i += 1) insert.run(providerId, executionId, at, at, costMicroGbpEach);
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      open.delete(h);
      // why: release first so a held request cannot keep a shutdown waiting, then stop every pass before the DB closes
      await h.releaseHolds().catch(() => undefined);
      for (const s of tracked.splice(0)) await s.shutdown();
      db.close();
    },
  };
  open.add(h);
  return h;
}
```

`packages/engine/test/support/setup.ts` (new file):

```ts
import { installNetworkGuards } from '@gmt/providers/testing';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { closeHarnesses } from './harness.js';

// why: plan decisions 18 and 20 — the guards every package installs (DNS refused, a catch-all that fails the test on
// any request no handler answered), reused from @gmt/providers/testing so this package never imports msw itself.
installNetworkGuards({ beforeAll, afterEach, afterAll });

afterEach(async () => {
  // why: a harness is closed even when its test failed, after its passes are shut down, so a secondary error
  // never masks the real failure (test-strategy-reviewer-013).
  await closeHarnesses();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
```

`packages/engine/vitest.config.ts` — replace the file:

```ts
import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
// why: the layer-A harness lives under test/support, so src/ holds production code only.
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'engine',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
```

`vitest.aliases.ts` — replace the file:

```ts
import { resolve } from 'node:path';

/**
 * Workspace packages resolve from source under Vitest. Vite externalises workspace packages and
 * hands them to Node's resolver, which reads the `default` (dist) export, so the `@gmt/source`
 * condition alone is not enough; tsc honours it through `customConditions`, the test runner uses
 * these aliases instead. Subpath exports (`@gmt/providers/testing`, `@gmt/providers/fixture`,
 * `@gmt/providers/recording`) map to their own index files.
 */
export function gmtAliases(repoRoot: string): Array<{ find: RegExp; replacement: string }> {
  const r = (p: string) => resolve(repoRoot, p);
  return [
    {
      find: /^@gmt\/providers\/(testing|fixture|recording)$/,
      replacement: r('packages/providers/src/$1/index.ts'),
    },
    { find: /^@gmt\/(core|db|providers|engine)$/, replacement: r('packages/$1/src/index.ts') },
    { find: /^@gmt\/api$/, replacement: r('apps/api/src/index.ts') },
  ];
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm install && pnpm --filter @gmt/engine exec vitest run resume-k-of-n pool context`
Expected: FAIL, `Cannot find module '../../src/context.js'` imported from the harness, `Cannot find module '../src/pool.js'`, and `Cannot find module '../src/context.js'` from `context.test.ts`.

- [ ] **Step 3: Implement**

`packages/engine/src/alertsStep.ts` (new file):

```ts
import type { AlertsStepHook } from './types.js';

/** The default alerts step: no rules evaluated, nothing sent. WP11's runAlerts replaces it through createEngine(deps, { alerts }). */
export const noAlerts: AlertsStepHook = async () => ({ digests: 0, events: 0 });
```

`packages/engine/src/context.ts` (new file):

```ts
import {
  type BudgetGuard,
  type Clock,
  type Config,
  type FlightProvider,
  type IsoDateTime,
  type Logger,
  type Notifier,
  type PointOfSale,
  type ProviderId,
  syntheticAllowed,
} from '@gmt/core';
import { budgetConfigFromConfig, type Db, type Repos } from '@gmt/db';
import type { HttpKit } from '@gmt/providers';
import { noAlerts } from './alertsStep.js';
import type { AlertsStepHook, EngineDeps, EngineOptions } from './types.js';

/** Callbacks the scheduler installs once it exists (createEngine); no-ops until then. Spec §8.1 one-shot jobs. */
export interface EngineHooks {
  scheduleResume(executionId: string, definitionId: string, at: IsoDateTime): void;
  cancelResume(executionId: string): void;
}

/**
 * What the engine needs per provider, read from the same `budgetConfigFromConfig(config)` entry the guard enforces
 * (arch-014): pool size, per-call cost, rates, window, fixed fee, schedule exclusion, and whether its calls are billed.
 */
export interface ProviderRunLimits {
  concurrency: number;
  costPerCallMicroGbp: number;
  ratePerMinute: number;
  ratePerHour: number;
  window: 'month' | 'lifetime';
  planFixedMicroGbp: number;
  excludedFromSchedule: boolean;
  billed: boolean;
}

/** What every engine module receives. Built once per engine by buildContext. */
export interface EngineContext {
  readonly deps: EngineDeps;
  readonly config: Config;
  readonly db: Db;
  readonly repos: Repos;
  readonly budget: BudgetGuard;
  readonly http: HttpKit;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifiers: readonly Notifier[];
  readonly providers: ReadonlyMap<ProviderId, FlightProvider>;
  readonly alertsStep: AlertsStepHook;
  limitsOf(id: ProviderId): ProviderRunLimits;
  /** The point of sale a provider's rows will carry, known before any call (reuse matching); written rows use the result's own pointOfSale. */
  pointOfSaleOf(id: ProviderId): PointOfSale;
  readonly hooks: EngineHooks;
}

/**
 * Builds the engine context. Fails fast when a registered provider has no budget entry: the fixture provider without
 * the synthetic gate (budgetConfigFromConfig leaves it out, spec §5.5), or a real provider whose key is not configured.
 */
export function buildContext(deps: EngineDeps, options: EngineOptions = {}): EngineContext {
  const providers = new Map<ProviderId, FlightProvider>(deps.providers.map((p) => [p.id, p]));
  const config = deps.config;
  const budgets = budgetConfigFromConfig(config);
  const limitsOf = (id: ProviderId): ProviderRunLimits => {
    const b = budgets.providers[id];
    if (b === undefined) {
      throw new Error(
        id === 'fixture' && !syntheticAllowed(config)
          ? 'the fixture provider is registered but syntheticAllowed(config) is false (spec §5.5)'
          : `no limits configured for provider ${id}`,
      );
    }
    return {
      // why: plan EngineOptions — tests pin the pool size per provider; production reads config limits
      concurrency: options.providerConcurrency?.[id] ?? b.concurrency,
      costPerCallMicroGbp: b.costPerCallMicroGbp,
      ratePerMinute: b.ratePerMinute,
      ratePerHour: b.ratePerHour,
      window: b.window,
      planFixedMicroGbp: b.planFixedMicroGbp,
      excludedFromSchedule: b.excludedFromSchedule,
      billed: b.billable,
    };
  };
  for (const id of providers.keys()) limitsOf(id); // why: a missing limit is a wiring bug; fail at construction, not mid-run
  return {
    deps,
    config,
    db: deps.db,
    repos: deps.repos,
    budget: deps.budget,
    http: deps.http,
    clock: deps.clock,
    log: deps.log,
    notifiers: deps.notifiers,
    providers,
    limitsOf,
    alertsStep: options.alerts ?? noAlerts,
    // why: spec §2/§5.2 — SearchApi echoes gl = POINT_OF_SALE; Travelpayouts and the fixture state none. A deliberate
    // engine rule known before any call (reuse matching); reuse.test.ts pins it against the fixture's echo, and WP5's
    // adapter test pins SearchApi's echo (arch-r2-013)
    pointOfSaleOf: (id) => (id === 'searchapi' ? config.pointOfSale : 'unknown'),
    hooks: { scheduleResume: () => undefined, cancelResume: () => undefined },
  };
}
```

`packages/engine/src/execute.ts` (new file):

```ts
import type { ExecutionStatus, IsoDateTime, OperatorMessageKind } from '@gmt/core';
import type { ExecutionPatch } from '@gmt/db';
import type { EngineContext } from './context.js';
import { errorText, type RunState, type StopReason, stopRun } from './run.js';
import { runDiscovery } from './stages/discovery.js';
import { breachText, formatInstant } from './text.js';

/** Runs one pass: discovery, then finish. Any error a stage lets escape stops the pass as fatal. */
export async function execute(ctx: EngineContext, run: RunState): Promise<void> {
  try {
    await runDiscovery(ctx, run);
  } catch (err) {
    stopRun(run, { kind: 'fatal', message: errorText(err) });
  }
  await finish(ctx, run);
}

export interface Notice {
  kind: OperatorMessageKind;
  detail: string;
}

/** Maps a stop reason to the execution status, patch and operator notice of spec §8.1. Pure; `tz` renders instants. */
export function finalStatus(
  stop: StopReason | null,
  now: IsoDateTime,
  tz: string,
): { status: ExecutionStatus; patch: ExecutionPatch; notice: Notice | null } {
  if (stop === null)
    return {
      status: 'completed',
      patch: { finishedAt: now, resumeAfter: null, errorText: null },
      notice: null,
    };
  switch (stop.kind) {
    case 'sigterm':
      // why: spec §8.1 "SIGTERM: … status interrupted without incrementing the counter"
      return {
        status: 'interrupted',
        patch: {},
        notice: {
          kind: 'interrupted',
          detail: 'The app stopped during this run; cells that were in flight went back to not searched.',
        },
      };
    case 'cancel':
      return { status: 'cancelled', patch: { finishedAt: now, resumeAfter: null }, notice: null };
    case 'limiter-timeout':
      return {
        status: 'paused_error',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_error',
          detail:
            stop.resumeAfter === null
              ? 'A provider rate window is full and its reopening time is not known; resume the run manually.'
              : `A provider rate window is full; the run resumes automatically on ${formatInstant(stop.resumeAfter, tz)}.`,
        },
      };
    case 'budget': {
      const e = stop.error;
      const when =
        stop.resumeAfter === null
          ? 'It needs a cap change, or a manual resume after editing the definition.'
          : `It resumes automatically on ${formatInstant(stop.resumeAfter, tz)}, when the cap window reopens.`;
      return {
        status: 'paused_budget',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_budget',
          detail: `The cap was reached: ${breachText(e.scope, e.providerId ?? null, e.cap, e.current, e.requested, 'the next call needed')}. ${when}`,
        },
      };
    }
    case 'all-disabled':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null },
        notice: {
          kind: 'paused_error',
          detail: `Every ${stop.stage} provider was disabled after errors; resume manually once the cause is fixed.`,
        },
      };
    case 'fatal':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null, errorText: stop.message },
        notice: { kind: 'paused_error', detail: `The run stopped on an internal error: ${stop.message}` },
      };
  }
}

/** Writes the pass's final status. The status write is the last act (Task 7.2 puts notifications before it). */
export async function finish(ctx: EngineContext, run: RunState): Promise<void> {
  const { status, patch } = finalStatus(run.stop, ctx.clock.now(), run.snapshot.scheduleTz);
  ctx.repos.executions.setStatus(run.executionId, status, patch);
  if (patch.resumeAfter !== undefined && patch.resumeAfter !== null)
    ctx.hooks.scheduleResume(run.executionId, run.definitionId, patch.resumeAfter);
  run.log.info({ status }, 'execution: pass finished');
}
```

`packages/engine/src/fx/limits.ts` (new file):

```ts
import type { Config } from '@gmt/core';
import type { ProviderHttpLimits } from '@gmt/providers';

/**
 * The http-kit policy of the FX client (decision 32: it lives beside the client; WP4b's httpLimitsFor imports it):
 * frankfurter's host only (decision 2: the `.app` host redirects and http-kit refuses redirects), a polite rate,
 * never billable, never ledgered (spec §5.3).
 */
export function fxHttpLimits(
  cfg: Pick<Config, 'maxWaitSeconds' | 'requestTimeoutSeconds'>,
): ProviderHttpLimits {
  return {
    hosts: ['api.frankfurter.dev'],
    ratePerMinute: 10,
    ratePerHour: 100,
    concurrency: 1,
    billable: 'never',
    costPerCallMicroGbp: 0,
    maxWaitSeconds: cfg.maxWaitSeconds,
    requestTimeoutSeconds: cfg.requestTimeoutSeconds,
  };
}
```

`packages/engine/src/normalise.ts` (new file):

```ts
import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  cellKeyString,
  type FxInfo,
  type IsoDateTime,
  LINK_ALLOWLIST,
  NormalisationError,
  type PointOfSale,
  type ProviderId,
  type RawCalendarPrice,
  validateVendorUrl,
} from '@gmt/core';
import type { AirportsRepo, CalendarPriceInsert, FxRepo } from '@gmt/db';

/** The repositories and settings normalisation reads (core's own NormaliseDeps is the pure function's input). */
export interface RepoDeps {
  airports: AirportsRepo;
  fx: FxRepo;
  clock: Clock;
  fxMaxRateAgeDays: number;
}

/** Spec §5.6 money for one calendar price. Task 7.1: GBP only; Task 7.5 adds ECB currencies. */
export function calendarPriceInGbp(
  _deps: RepoDeps,
  amountMinor: number,
  currency: string,
): { pricePence: number; fx: FxInfo } | NormalisationError {
  if (currency.toUpperCase() === 'GBP') return { pricePence: amountMinor, fx: { converted: false } };
  return new NormalisationError('currency-unsupported', currency.toUpperCase());
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

/** A validated `https:` vendor link on the provider's allowlist (core LINK_ALLOWLIST), else null (spec §5.2). Validated links keep their query (spec rev 10). */
export function vendorLinkOf(url: string | undefined, providerId: ProviderId): string | null {
  if (url === undefined) return null;
  const b = validateVendorUrl(url, LINK_ALLOWLIST[providerId]);
  return b.kind === 'get' ? b.url : null;
}

export interface CalendarContext {
  providerId: ProviderId;
  info: CapabilityInfo;
  cabin: Cabin;
  pointOfSale: PointOfSale;
  fetchedAt: IsoDateTime;
}

/** One raw calendar price → one calendar_prices insert with full provenance, or the reason it cannot be stored. Spec §5.6, §7. */
export function normaliseCalendarPrice(
  raw: RawCalendarPrice,
  c: CalendarContext,
  deps: RepoDeps,
): CalendarPriceInsert | NormalisationError {
  const m = calendarPriceInGbp(deps, raw.amountMinor, raw.currency);
  if (m instanceof NormalisationError) return m;
  return {
    providerId: c.providerId,
    sourceKind: c.info.sourceKind,
    cabin: c.cabin,
    cell: {
      origin: raw.origin,
      destination: raw.destination,
      departureDate: raw.departureDate,
      returnDate: raw.returnDate,
    },
    pricePence: m.pricePence,
    priceNativeMinor: raw.amountMinor,
    currencyNative: raw.currency.toUpperCase(),
    fx: m.fx,
    pointOfSale: c.pointOfSale,
    fetchedAt: c.fetchedAt,
    providerObservedAt: raw.providerObservedAt ?? null,
    // why: spec §7 "max_age_hours NULL means unknown and is written explicitly"
    maxAgeHours: c.info.maxAgeHours === 'unknown' ? null : c.info.maxAgeHours,
    vendorLink: vendorLinkOf(raw.vendorLink, c.providerId),
    reusedFromExecutionId: null,
  };
}
```

`packages/engine/src/orchestrator.ts` (new file):

```ts
import type { EngineContext } from './context.js';
import { createRegistry } from './registry.js';
import { resumeExecution } from './resume.js';
import { stopRun } from './run.js';
import { startExecution } from './start.js';
import type { StartResult } from './types.js';

/** The execution half of the Engine; createEngine (Task 7.19) adds estimates, scheduler, boot and status. */
export interface Orchestrator {
  start(
    definitionId: string,
    opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number },
  ): Promise<StartResult>;
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

`packages/engine/src/pool.ts` (new file):

```ts
/**
 * Bounded worker pool. Spec §8.1: "for each tile (bounded pool = provider CONCURRENCY)" and "bounded pool of cells
 * (provider CONCURRENCY)".
 *
 * Starts at most `concurrency` lanes; a lane stops taking items once `intake` aborts or a worker has thrown. `intake`
 * only stops new work: a worker already running finishes (decision 25, a reservation that passed every cap is
 * honoured), and the pool always waits for it, so no write races whatever the caller does next. Workers own their
 * error handling; an error that escapes one is rethrown after the pool drains.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  intake: AbortSignal,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  let next = 0;
  const failures: unknown[] = [];
  const lane = async (): Promise<void> => {
    while (!intake.aborted && failures.length === 0) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
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

`packages/engine/src/registry.ts` (new file):

```ts
import type { Logger } from '@gmt/core';
import { errorText, type RunState } from './run.js';

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
          log.error(
            { executionId: run.executionId, err: errorText(err) },
            'execution body threw outside the error table',
          );
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

`packages/engine/src/resume.ts` (new file):

```ts
import { RESUMABLE_STATUSES } from '@gmt/core';
import type { EngineContext } from './context.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { refused } from './start.js';
import type { StartResult } from './types.js';

/**
 * Spec §8.1 "Resume is a compare-and-set": only one claimer of an execution proceeds; the one-shot job is cancelled in
 * the same step; the new pass re-plans over the resume query only (spec §7).
 */
export async function resumeExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  executionId: string,
  opts: { manual: boolean },
): Promise<StartResult> {
  const exec = ctx.repos.executions.get(executionId);
  if (exec === null) return refused('not_found', `execution ${executionId} not found`, { executionId });
  if (reg.get(executionId) !== undefined || !RESUMABLE_STATUSES.includes(exec.status))
    return refused('active', `execution is ${exec.status} and cannot be resumed`, { status: exec.status });
  if (!ctx.repos.executions.claimResume(executionId))
    return refused('active', 'another resume claimed this execution first', { executionId });
  ctx.hooks.cancelResume(executionId);
  const run = newRun(
    ctx,
    { ...exec, status: 'running' },
    { manual: opts.manual, fresh: false, blocked: new Set() },
  );
  run.log.info({ manual: opts.manual, autoResumeCount: exec.autoResumeCount }, 'execution: resumed');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId };
}
```

`packages/engine/src/run.ts` (new file):

```ts
import {
  AbortedError,
  type BudgetExceeded,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  type IsoDateTime,
  type Logger,
  type OperatorMessageKind,
  type ProviderId,
  type SkipReason,
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { EngineContext } from './context.js';

/** Why a pass stopped early. Each maps to one execution status in execute.ts `finalStatus` (spec §8.1 error table). */
export type StopReason =
  | { kind: 'sigterm' }
  | { kind: 'cancel' }
  | { kind: 'limiter-timeout'; resumeAfter: IsoDateTime | null }
  | { kind: 'budget'; error: BudgetExceeded; resumeAfter: IsoDateTime | null }
  | { kind: 'all-disabled'; stage: Stage }
  | { kind: 'fatal'; message: string };

/**
 * Stops that abort calls already in flight. Every other stop only refuses new work: a call whose reservation passed
 * every cap finishes and its result is written (decision 25). SIGTERM and cancel abort (spec §8.1 AbortedError row);
 * a fatal stop means the database itself failed, so nothing more can be written (Review Focus 5).
 */
const ABORTING: ReadonlySet<StopReason['kind']> = new Set(['sigterm', 'cancel', 'fatal']);

/** One (stage, provider) lane: its own intake switch, joined with the pass's (spec §8.1 per-provider rows). */
export interface Lane {
  readonly intake: AbortController;
  /** AbortSignal.any([pass intake, lane intake]); the lane's pool stops taking cells once it aborts. */
  readonly intakeSignal: AbortSignal;
  /** Cell keys whose call is in flight, so a budget breach marks only the idle ones skipped at once. */
  readonly inFlight: Set<string>;
  /** Set once a provider-month, provider-lifetime or global-month breach took the provider out of the stage. */
  budgetOut: boolean;
}

/** In-memory state of one pass over one execution. Nothing here survives a restart; the DB does. */
export interface RunState {
  readonly executionId: string;
  readonly definitionId: string;
  readonly isChild: boolean;
  readonly cell: CellKey | null;
  /** Read once from the execution row; a later PUT to the definition never reaches a running pass (Review Focus 4). */
  readonly snapshot: DefinitionSnapshot;
  /** Manual resume semantics (spec §7 resume query). */
  readonly manual: boolean;
  /** True for the first pass started by start()/verifyCell(); parity is judged only on such passes. */
  readonly fresh: boolean;
  /** Providers the pre-start (or resume) budget check excluded from this pass. */
  readonly blocked: ReadonlySet<ProviderId>;
  /** Aborts calls in flight (cancel, SIGTERM, fatal); every provider call of the pass gets its signal. */
  readonly controller: AbortController;
  /** Stops new work for the whole pass (every stop). */
  readonly intake: AbortController;
  stop: StopReason | null;
  readonly disabled: Set<ProviderId>;
  readonly parseStreak: Map<ProviderId, number>;
  readonly lanes: Map<string, Lane>;
  /** Discovery tiles planned in this pass, per provider (parity, spec §8.1). */
  readonly plannedTiles: Map<ProviderId, number>;
  readonly notices: Array<{ kind: OperatorMessageKind; detail: string }>;
  readonly log: Logger;
}

/** Fresh pass state for an execution row. */
export function newRun(
  ctx: EngineContext,
  exec: Execution,
  opts: { manual: boolean; fresh: boolean; blocked: ReadonlySet<ProviderId> },
): RunState {
  return {
    executionId: exec.id,
    definitionId: exec.definitionId,
    isChild: exec.isChild,
    cell: exec.cell,
    snapshot: exec.snapshot,
    manual: opts.manual,
    fresh: opts.fresh,
    blocked: opts.blocked,
    controller: new AbortController(),
    intake: new AbortController(),
    stop: null,
    disabled: new Set(),
    parseStreak: new Map(),
    lanes: new Map(),
    plannedTiles: new Map(),
    notices: [],
    log: ctx.log.child({ executionId: exec.id, definitionId: exec.definitionId }),
  };
}

/** Records the first stop reason; stops new work, and aborts calls in flight only for cancel, SIGTERM and fatal. */
export function stopRun(run: RunState, reason: StopReason): void {
  if (run.stop === null) run.stop = reason;
  run.intake.abort();
  if (ABORTING.has(reason.kind)) run.controller.abort();
}

/** The lane for (stage, provider), created on first use. */
export function laneFor(run: RunState, stage: Stage, providerId: ProviderId): Lane {
  const key = `${stage}|${providerId}`;
  const existing = run.lanes.get(key);
  if (existing !== undefined) return existing;
  const intake = new AbortController();
  const lane: Lane = {
    intake,
    intakeSignal: AbortSignal.any([run.intake.signal, intake.signal]),
    inFlight: new Set(),
    budgetOut: false,
  };
  run.lanes.set(key, lane);
  return lane;
}

/**
 * Marks every `not_run` outcome of (stage, provider), except `exclude`, as skipped with `reason`.
 * Without exclusions this is one repository statement; with them, one transaction of per-cell updates.
 */
export function markRemaining(
  ctx: EngineContext,
  run: Pick<RunState, 'executionId'>,
  stage: Stage,
  providerId: ProviderId,
  reason: SkipReason,
  exclude: ReadonlySet<string> = new Set(),
): number {
  if (exclude.size === 0)
    return ctx.repos.cells.setOutcomesForProvider(run.executionId, stage, providerId, ['not_run'], {
      status: 'skipped',
      reason,
    });
  const rows = ctx.repos.cells
    .outcomes(run.executionId, { stage, providerId })
    .filter((o) => o.status === 'not_run' && !exclude.has(cellKeyString(o)));
  if (rows.length === 0) return 0;
  ctx.db.transaction(() => {
    for (const o of rows)
      ctx.repos.cells.setOutcome(run.executionId, o, stage, providerId, { status: 'skipped', reason });
  });
  return rows.length;
}

/** Cells of (stage, provider) this pass should fetch: the spec §7 resume query. */
export function runnableCells(
  ctx: EngineContext,
  run: RunState,
  stage: Stage,
  providerId: ProviderId,
): CellKey[] {
  if (run.disabled.has(providerId)) return [];
  return ctx.repos.cells.resumable(run.executionId, stage, providerId, run.manual);
}

/** Message text for any thrown value, URL-free (spec §5.3 secret scrubbing). */
export function errorText(err: unknown): string {
  return stripUrlsInText(err instanceof Error ? err.message : String(err));
}

/**
 * Handles a failed tile or cell call. Task 7.1: an abort leaves the cells `not_run` (nothing was written); anything
 * else stops the pass as fatal. Task 7.4 replaces this with the full error table.
 */
export function onFailure(
  _ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  stage: Stage,
  cells: readonly CellKey[],
  err: unknown,
): void {
  if (err instanceof AbortedError || run.controller.signal.aborted) return;
  run.log.warn(
    { providerId, stage, cells: cells.length, err: errorText(err) },
    'call failed; stopping the pass',
  );
  stopRun(run, { kind: 'fatal', message: errorText(err) });
}
```

`packages/engine/src/snapshot.ts` (new file):

```ts
import {
  type Cell,
  type DefinitionSnapshot,
  generateCells,
  type ProviderId,
  type ResolvedSpace,
  resolveWindow,
  type SearchDefinition,
} from '@gmt/core';
import type { EngineContext } from './context.js';

export interface BuiltSnapshot {
  snapshot: DefinitionSnapshot;
  cells: Cell[];
  notes: string[];
}

/** Resolves the window in Europe/London and freezes the definition into an execution snapshot. Spec §6.1, §8.1 "start: snapshot". */
export function buildSnapshot(ctx: EngineContext, def: SearchDefinition): BuiltSnapshot {
  const w = resolveWindow(def.window, ctx.clock.todayLondon());
  const resolved: ResolvedSpace = {
    origins: def.origins,
    destinations: def.destinations,
    departureFrom: w.departureFrom,
    departureTo: w.departureTo,
    minNights: def.minNights,
    maxNights: def.maxNights,
  };
  const cells = w.departureFrom > w.departureTo ? [] : generateCells(resolved);
  const usable = (id: ProviderId, capability: 'discovery' | 'verification'): boolean =>
    ctx.providers.get(id)?.[capability] !== undefined;
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
    droppedAlwaysInclude: [],
  };
  return { snapshot, cells, notes: [] };
}
```

`packages/engine/src/stages/discovery.ts` (new file):

```ts
import {
  type CapabilityInfo,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type Iata,
  NormalisationError,
  ProviderError,
  type ProviderId,
  type TilePlan,
} from '@gmt/core';
import type { TileWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { normaliseCalendarPrice, type RepoDeps, reduceTile } from '../normalise.js';
import { runPool } from '../pool.js';
import { laneFor, onFailure, type RunState, runnableCells, stopRun } from '../run.js';

export interface PlannedTile {
  plan: TilePlan;
  query: DiscoveryQuery;
}

/** Normalisation dependencies drawn from the context. */
export function normaliseDeps(ctx: EngineContext): RepoDeps {
  return {
    airports: ctx.repos.airports,
    fx: ctx.repos.fx,
    clock: ctx.clock,
    fxMaxRateAgeDays: ctx.config.fxMaxRateAgeDays,
  };
}

/** The discovery query for one pair, re-planned over exactly `cells` (spec §5.1 `cells`, §8.1). */
export function discoveryQuery(
  snapshot: DefinitionSnapshot,
  origin: Iata,
  destination: Iata,
  cells: readonly CellKey[],
): DiscoveryQuery {
  const r = snapshot.resolved;
  return {
    origin,
    destination,
    departureFrom: r.departureFrom,
    departureTo: r.departureTo,
    minNights: r.minNights,
    maxNights: r.maxNights,
    cabin: snapshot.cabin,
    currency: 'GBP',
    cells: [...cells],
  };
}

const sameCells = (a: readonly CellKey[], b: readonly CellKey[]): boolean => {
  const ka = a.map(cellKeyString).sort();
  const kb = b.map(cellKeyString).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
};

/**
 * Groups cells by pair in snapshot order and plans each pair over its cells; tile indexes are made unique across
 * pairs. Spec §5.2 "tiles partition the query's cells", asserted here, at the point that decides coverage
 * (ssr-06): a plan that leaves out, repeats or adds a cell is a wiring error, so the pass stops instead of finishing
 * `completed` with cells silently left `not_run`.
 */
export function planTiles(
  providerId: ProviderId,
  cap: DiscoveryCapability,
  snapshot: DefinitionSnapshot,
  cells: readonly CellKey[],
): PlannedTile[] {
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
      if (
        !sameCells(
          plans.flatMap((p) => p.coveredCells),
          pairCells,
        )
      )
        throw new Error(
          `discovery plan for ${providerId} ${origin}-${destination} does not partition its ${pairCells.length} cells`,
        );
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
  if (run.stop === null && ids.every((id) => run.disabled.has(id)))
    stopRun(run, { kind: 'all-disabled', stage: 'discovery' });
}

async function runDiscoveryProvider(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
): Promise<void> {
  const cap = ctx.providers.get(providerId)?.discovery;
  if (cap === undefined) return;
  const cells = runnableCells(ctx, run, 'discovery', providerId);
  if (cells.length > 0) await fetchTiles(ctx, run, providerId, cap, cells);
}

async function fetchTiles(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  cap: DiscoveryCapability,
  cells: readonly CellKey[],
): Promise<void> {
  const log = run.log.child({ providerId });
  const tiles = planTiles(providerId, cap, run.snapshot, cells);
  run.plannedTiles.set(providerId, (run.plannedTiles.get(providerId) ?? 0) + tiles.length);
  log.info({ stage: 'discovery', cells: cells.length, tiles: tiles.length }, 'discovery: planned tiles');
  const lane = laneFor(run, 'discovery', providerId);
  await runPool(tiles, ctx.limitsOf(providerId).concurrency, lane.intakeSignal, async (tile) => {
    const keys = tile.plan.coveredCells.map(cellKeyString);
    for (const k of keys) lane.inFlight.add(k);
    try {
      const result = await cap.fetchTile(tile.plan, tile.query, {
        executionId: run.executionId,
        signal: run.controller.signal,
        recordFixtures: false,
      });
      // why: decisions 25 and 27 — a result that resolves after a stop is written (its calls were paid for); only a
      // fatal stop, where the database itself failed, writes nothing more
      if (run.stop?.kind === 'fatal') return;
      if (result.kind === 'tile-error')
        onFailure(ctx, run, providerId, 'discovery', tile.plan.coveredCells, result.error);
      else if (!sameCells(result.coveredCells, tile.plan.coveredCells)) {
        // why: the engine owns which cells a tile covers (ssr-06); an adapter echoing others breached the contract
        const err = new ProviderError({
          kind: 'parse',
          retryable: false,
          providerId,
          message: `tile ${tile.plan.index} answered for cells other than the ones planned`,
        });
        onFailure(ctx, run, providerId, 'discovery', tile.plan.coveredCells, err);
      } else commitTile(ctx, run, providerId, cap.info, result);
    } catch (err) {
      onFailure(ctx, run, providerId, 'discovery', tile.plan.coveredCells, err);
    } finally {
      for (const k of keys) lane.inFlight.delete(k);
    }
  });
}

/**
 * Writes one tile atomically (spec §7 "each tile's prices, outcomes and roll-ups"): covered cells with a price that
 * normalises → priced; in noFares → empty; otherwise → no_data (not evidence of no flights). Cells whose price cannot
 * be normalised become `error` with the normalisation reason through writeTileError, in the same transaction
 * (WP3's writeTile takes only priced, empty and no_data; po-009). The repository resets auto_resume_count in it.
 */
export function commitTile(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  info: CapabilityInfo,
  result: Extract<DiscoveryTileResult, { kind: 'tile' }>,
): void {
  const reduced = reduceTile(result.prices);
  const pointOfSale = result.pointOfSale; // why: spec rev 10 — the adapter states the point of sale of what it fetched
  const noFares = new Set(result.noFares.map(cellKeyString));
  const write: TileWrite = {
    tileIndex: result.index,
    cells: [],
    prices: [],
    outcomes: [],
    discards: reduced.discarded,
  };
  const failed = new Map<string, { cells: CellKey[]; message: string }>();
  for (const cell of result.coveredCells) {
    const key = cellKeyString(cell);
    const base = {
      origin: cell.origin,
      destination: cell.destination,
      departureDate: cell.departureDate,
      returnDate: cell.returnDate,
      fetchedAt: result.fetchedAt,
      cabin: run.snapshot.cabin,
      pointOfSale,
      sourceKind: info.sourceKind,
    };
    const raw = reduced.perCell.get(key);
    if (raw !== undefined) {
      const price = normaliseCalendarPrice(
        raw,
        { providerId, info, cabin: run.snapshot.cabin, pointOfSale, fetchedAt: result.fetchedAt },
        normaliseDeps(ctx),
      );
      if (price instanceof NormalisationError) {
        const group = failed.get(price.reason) ?? { cells: [], message: price.message };
        group.cells.push(cell);
        failed.set(price.reason, group);
        continue;
      }
      write.prices.push(price);
      write.outcomes.push({
        ...base,
        status: 'priced',
        reason: null,
        lastError: null,
        minPence: price.pricePence,
      });
    } else if (noFares.has(key))
      write.outcomes.push({ ...base, status: 'empty', reason: null, lastError: null, minPence: null });
    else write.outcomes.push({ ...base, status: 'no_data', reason: null, lastError: null, minPence: null });
    write.cells.push(cell);
  }
  ctx.db.transaction(() => {
    if (write.cells.length > 0) ctx.repos.cells.writeTile(run.executionId, providerId, write);
    for (const [reason, g] of failed)
      ctx.repos.cells.writeTileError(run.executionId, providerId, g.cells, reason, g.message);
  });
  run.parseStreak.set(providerId, 0);
  if (reduced.discarded > 0 || result.notes.length > 0 || failed.size > 0) {
    run.log.child({ providerId }).debug(
      {
        tileIndex: result.index,
        discarded: reduced.discarded,
        notes: result.notes,
        normalisationErrors: [...failed.keys()],
      },
      'discovery: tile reduced',
    );
  }
}
```

`packages/engine/src/start.ts` (new file):

```ts
import type { Execution } from '@gmt/core';
import type { EngineContext } from './context.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { buildSnapshot } from './snapshot.js';
import type { StartResult } from './types.js';

/** A refused StartResult. */
export function refused(
  code: Extract<StartResult, { ok: false }>['code'],
  message: string,
  details: unknown,
): StartResult {
  return { ok: false, code, message, details };
}

/** better-sqlite3 reports a partial-unique-index clash (spec §7 one active parent, one active child per cell) as SQLITE_CONSTRAINT_UNIQUE. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/** Spec §8.1 "start: snapshot; seed search_cells + cell_outcomes(not_run) …; status=running". */
export async function startExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  definitionId: string,
  opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number },
): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', `definition ${definitionId} not found`, { definitionId });
  if (ctx.repos.executions.activeParent(def.id) !== null)
    return refused('active', 'another execution of this definition is active', { definitionId });
  const built = buildSnapshot(ctx, def);
  const discovery = built.snapshot.providers.discovery;
  let exec: Execution;
  try {
    // why: spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start" — the row is created running and
    // seeded in one BEGIN IMMEDIATE, so a crash can never leave an execution without its cells (ssr-07)
    exec = ctx.db.immediateTransaction(() => {
      const e = ctx.repos.executions.create({
        definitionId: def.id,
        isChild: false,
        cell: null,
        snapshot: built.snapshot,
        estimate: null,
        trigger: opts.trigger,
        status: 'running',
      });
      ctx.repos.cells.seed(e.id, built.cells, discovery);
      return e;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      return refused('active', 'another execution of this definition is active', { definitionId });
    throw err;
  }
  const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: new Set() });
  run.log.info({ trigger: opts.trigger, cells: built.cells.length }, 'execution: started');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
```

`packages/engine/src/text.ts` (new file):

```ts
import {
  type BudgetScopeKind,
  formatPence,
  type IsoDateTime,
  PENCE_TO_MICRO,
  type ProviderId,
} from '@gmt/core';

// Operator-facing wording shared by notices and refusal messages (spec §8.1 "409 naming the cap and numbers"):
// money through core's formatPence, call scopes as counts, scopes in plain English, instants in local time.

/** True for the scopes whose figures are micro-GBP; the others count calls. */
export function isCostScope(scope: BudgetScopeKind): boolean {
  return scope === 'execution-cost' || scope === 'global-month';
}

/** Plain-English name of a cap scope (po-012). */
export function scopeName(scope: BudgetScopeKind, providerId: ProviderId | null): string {
  const p = providerId ?? 'the provider';
  switch (scope) {
    case 'execution-calls':
      return "this run's billed-call cap";
    case 'execution-free-calls':
      return "this run's free-call cap";
    case 'execution-cost':
      return "this run's spend cap";
    case 'provider-month':
      return `${p}'s monthly call cap`;
    case 'provider-lifetime':
      return `${p}'s lifetime call cap`;
    case 'global-month':
      return 'the monthly spend cap';
  }
}

/** A cap figure with its unit: pounds for cost scopes (micro-GBP rounded up to the penny), "N calls" otherwise (arch-018). */
export function scopeAmount(scope: BudgetScopeKind, n: number): string {
  if (isCostScope(scope)) return formatPence(Math.ceil(n / PENCE_TO_MICRO));
  return `${n} ${n === 1 ? 'call' : 'calls'}`;
}

/** "this run's billed-call cap is 50 calls; 50 calls used; the next call needs 1 call" in one sentence. */
export function breachText(
  scope: BudgetScopeKind,
  providerId: ProviderId | null,
  cap: number,
  used: number,
  needs: number,
  needsLabel: string,
): string {
  return `${scopeName(scope, providerId)} is ${scopeAmount(scope, cap)}; ${scopeAmount(scope, used)} used; ${needsLabel} ${scopeAmount(scope, needs)}`;
}

/** An instant as a readable local date and time in `tz`, e.g. "Mon 19 Oct 2026, 05:00 (Europe/London)" (po-015). */
export function formatInstant(at: IsoDateTime, tz: string): string {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${f.format(new Date(at))} (${tz})`;
}
```

`packages/engine/src/types.ts` (new file):

```ts
import type {
  BudgetFit,
  BudgetGuard,
  CellKey,
  Clock,
  Config,
  CoverageCheckRequest,
  CoverageCheckResponse,
  DefinitionInput,
  Estimate,
  FlightProvider,
  IsoDate,
  IsoDateTime,
  Logger,
  Notifier,
  ProviderId,
  ResponseCache,
  SchedulerJob,
  SearchDefinition,
} from '@gmt/core';
import type { Db, Repos } from '@gmt/db';
import type { HttpKit } from '@gmt/providers';

// why: core already exports these five as types (plan decisions 16 and 17); the engine re-exports core's, never its own copies
export type {
  BudgetFit,
  CoverageCheckRequest,
  CoverageCheckResponse,
  Estimate,
  SchedulerJob,
} from '@gmt/core';

/** Ports the engine is built on; constructed by the api bootstraps (WP4b/WP8) or the layer-A harness. Plan contract "Engine". */
export interface EngineDeps {
  config: Config;
  db: Db;
  repos: Repos;
  budget: BudgetGuard;
  cache: ResponseCache;
  http: HttpKit;
  providers: FlightProvider[];
  notifiers: Notifier[];
  clock: Clock;
  log: Logger;
}
/** The alerts step of spec §8.1 ("alerts: evaluateAlertRules → persist events → notify digests"); WP11 provides runAlerts. */
export type AlertsStepHook = (
  deps: EngineDeps,
  executionId: string,
) => Promise<{ digests: number; events: number }>;
/**
 * Engine options. Every cost and limit comes from `config` (ruling 3); `providerConcurrency` overrides the pool size per
 * provider and is passed only by tests.
 */
export interface EngineOptions {
  alerts?: AlertsStepHook;
  providerConcurrency?: Partial<Record<ProviderId, number>>;
}

/** Spec §8.1 pre-start outcomes; WP8 maps them to HTTP (409, 409 needsConfirmation, 422, 404, 409). */
export type StartResult =
  | { ok: true; executionId: string }
  | {
      ok: false;
      code: 'active' | 'cap' | 'confirm' | 'window' | 'not_found' | 'disabled';
      message: string;
      details: unknown;
    };

/** The plan's "Engine" contract. */
export interface Engine {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  start(
    definitionId: string,
    opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number },
  ): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  cancel(executionId: string): Promise<boolean>;
  verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;
  estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate;
  estimateRemaining(executionId: string): Estimate;
  budgetFit(definition: DefinitionInput | SearchDefinition): BudgetFit;
  coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>;
  scheduler: {
    register(def: SearchDefinition): void;
    unregister(definitionId: string): void;
    jobs(): SchedulerJob[];
    tick(definitionId: string): Promise<void>;
    blockedSince(): IsoDateTime | null;
  };
  status(): {
    running: string[];
    degraded: boolean;
    nextRun: IsoDateTime | null;
    lastExecutionAt: IsoDateTime | null;
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine exec vitest run resume-k-of-n pool context`
Expected: PASS, 6 tests (1 in `resume-k-of-n.test.ts`, 4 in `pool.test.ts`, 1 in `context.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/engine pnpm-lock.yaml vitest.aliases.ts && git commit -m "wp07: layer-A harness, pool and discovery pass; resume after k of n tiles issues n-k; synthetic gate pinned

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.2: Operator notifications, `LogNotifier`, deduplication per execution and kind

**Files:**
- Create: `packages/engine/src/notifiers/operatorTemplates.ts`, `src/notify.ts`, `src/notifiers/log.ts`, `test/notifications.test.ts`
- Modify: `packages/engine/src/execute.ts` (`finish`)

**Interfaces:**
- Consumes: `Notifier`, `OperatorMessage`, `OperatorMessageKind`, `AlertDigest`, `NotificationsRepo.wasSent/record`, `findBannedWords`, `stripUrlsInText`, `stripControlChars` (decision 21).
- Produces: `renderOperatorMessage(kind, ctx)` (plan contract name and file; `ctx.variant` selects the no-runnable-provider wording of Task 7.13), `OPERATOR_KINDS`, `cleanLine(s)`, `cleanText(s)`, `notifyOperator(ctx, kind, params): Promise<boolean>`, `LogNotifier`, `containsSynthetic(value)`.

Subjects say "budget cap" (a call cap or a spend cap); the detail line names which and its figures with units (po-015, arch-018). The interrupted guidance holds whether `AUTO_RESUME` is on or off and says a run too old to resume is cancelled (Task 7.19). The `paused_budget` guidance is scope-neutral, because an `execution-*` pause has no window to reopen; the `provider_capped` guidance says what happens: the capped provider's cells stay skipped in this run, for a manual resume or the next scheduled run (prov-wp07-r2-003, Task 7.10). Deduplication is keyed on (kind, execution), and on (kind, definition) when there is no execution; the tests send the same kind for a second execution and a second definition and see it delivered (test-strategy-reviewer-025). `cleanLine` is core's `stripControlChars` over `stripUrlsInText`, so C1 controls such as U+009B are stripped too (arch-008).

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/notifications.test.ts` (new file):

```ts
import { type AlertDigest, asIsoDate, findBannedWords, type OperatorMessage } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { containsSynthetic, LogNotifier } from '../src/notifiers/log.js';
import { OPERATOR_KINDS, renderOperatorMessage } from '../src/notifiers/operatorTemplates.js';
import { notifyOperator } from '../src/notify.js';
import {
  capturingLogger,
  createHarness,
  type Harness,
  JFK,
  LHR,
  type LogLine,
  T0,
} from './support/harness.js';

async function anExecution(h: Harness): Promise<{ id: string; definitionId: string }> {
  const def = h.createDefinition();
  const e = await h.runToCompletion(h.orch(), def.id);
  return { id: e.id, definitionId: def.id };
}

/** A complete digest (plan "Notifier port") whose one item carries a synthetic price. */
function syntheticDigest(): AlertDigest {
  const rule = {
    id: 'r1',
    definitionId: 'd1',
    type: 'absolute',
    thresholdPence: 50_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  } as const;
  return {
    ruleId: 'r1',
    definitionId: 'd1',
    executionId: 'e1',
    basis: 'calendar',
    items: [
      {
        pricePence: 41_200,
        provenance: {
          providerId: 'fixture',
          sourceKind: 'synthetic',
          fetchedAt: T0,
          maxAgeHours: 0,
          fx: { converted: false },
          pointOfSale: 'unknown',
          cabin: 'economy',
        },
        cell: {
          origin: LHR,
          destination: JFK,
          departureDate: asIsoDate('2026-11-02'),
          returnDate: asIsoDate('2026-11-09'),
          nights: 7,
        },
        verdictClass: 'unchecked',
        itineraryHash: null,
        seller: null,
        unverified: [],
        previousPricePence: null,
        fetchGapHours: null,
        isNew: true,
        firingReason: 'below £500',
        booking: { kind: 'none' },
        bookingExpiresAt: null,
        outbound: null,
        inbound: null,
        searchLink: null,
        rowKey: 'calendar:1',
      },
    ],
    restCount: 0,
    newItems: [],
    newRestCount: 0,
    coverageCaveat: null,
    rule,
  };
}

describe('operator notifications (spec §8.1 "deduplicated per execution and kind")', () => {
  it('sends one message per (kind, execution) however often it is asked', async () => {
    const h = createHarness();
    const { id, definitionId } = await anExecution(h);
    const ctx = buildContext(h.deps, h.options);
    const p = { executionId: id, definitionId, definitionName: 'x', detail: 'cap reached' };
    expect(await notifyOperator(ctx, 'paused_budget', p)).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p)).toBe(false);
    expect(await notifyOperator(ctx, 'provider_disabled', p)).toBe(true);
    expect(h.notifications.map((m) => m.kind)).toEqual(['paused_budget', 'provider_disabled']);
    expect(h.repos.notifications.wasSent('paused_budget', id, definitionId)).toBe(true);
  });

  it('a second execution of the same definition is told again: the key is (kind, execution), not kind alone (test-strategy-reviewer-025)', async () => {
    const h = createHarness();
    const first = await anExecution(h);
    const def = h.repos.definitions.get(first.definitionId);
    if (def === null) throw new Error('no definition');
    const second = await h.runToCompletion(h.orch(), def.id);
    const ctx = buildContext(h.deps, h.options);
    const p = (executionId: string) => ({
      executionId,
      definitionId: def.id,
      definitionName: 'x',
      detail: 'cap',
    });
    expect(await notifyOperator(ctx, 'paused_budget', p(first.id))).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p(second.id))).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p(second.id))).toBe(false);
    expect(h.notifications.map((m) => m.body.split('\n').at(-1))).toEqual([
      `Execution: ${first.id}`,
      `Execution: ${second.id}`,
    ]);
  });

  it('with no execution the key is (kind, definition): once per definition, again for another definition', async () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    const a = h.createDefinition();
    const b = h.createDefinition({ name: 'second' });
    const p = (definitionId: string) => ({
      executionId: null,
      definitionId,
      definitionName: 'x',
      detail: 'no configured provider can run it',
      variant: 'no-runnable-provider' as const,
    });
    expect(await notifyOperator(ctx, 'skipped_budget', p(a.id))).toBe(true);
    expect(await notifyOperator(ctx, 'skipped_budget', p(a.id))).toBe(false);
    expect(await notifyOperator(ctx, 'skipped_budget', p(b.id))).toBe(true);
    expect(h.notifications.map((m) => m.kind)).toEqual(['skipped_budget', 'skipped_budget']);
  });

  it('records a refused or throwing notifier as failed and logs a warning, without throwing', async () => {
    const h = createHarness();
    const { id, definitionId } = await anExecution(h);
    const boom = {
      id: 'boom',
      send: async (): Promise<{ ok: boolean }> => {
        throw new Error('smtp down at https://user:pw@mail.example/x?k=1');
      },
    };
    const ctx = { ...buildContext(h.deps, h.options), notifiers: [boom] };
    expect(
      await notifyOperator(ctx, 'paused_error', {
        executionId: id,
        definitionId,
        definitionName: 'x',
        detail: 'd',
      }),
    ).toBe(true);
    const warn = h.logs.find((l) => l.msg === 'operator notification failed');
    expect(warn?.fields.err).toBe('smtp down at https://mail.example/x');
    // why: a failed send is recorded as failed, so the next occurrence tries again (wasSent counts only sent rows)
    expect(h.repos.notifications.wasSent('paused_error', id, definitionId)).toBe(false);
  });

  it('a SIGTERM pass emits exactly one `interrupted` notification', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition();
    const orch = h.orch();
    h.onTileCommit((n) => {
      if (n === 1) void orch.shutdown();
    });
    const r = await orch.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await h.waitForSettled(r.executionId);
    const msgs = h.notifications.filter((m) => m.kind === 'interrupted');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.executionId).toBe(r.executionId);
    expect(msgs[0]?.subject).toBe('[get-me-there] London to New York (layer A): run interrupted');
  });
});

describe('renderOperatorMessage', () => {
  it('every kind has a prefixed subject, a body, no banned word and no URL query (spec §11, §5.3)', () => {
    for (const kind of OPERATOR_KINDS) {
      const m = renderOperatorMessage(kind, {
        definitionName: 'London to New York',
        executionId: 'e1',
        detail: 'see https://x.example/p?token=abc',
      });
      expect(m.subject.startsWith('[get-me-there] London to New York: ')).toBe(true);
      expect(m.body.length).toBeGreaterThan(0);
      expect(findBannedWords(`${m.subject}\n${m.body}`)).toEqual([]);
      expect(`${m.subject}${m.body}`).not.toMatch(/\?token=/);
    }
  });
  it('strips C0 and C1 control characters from provider-supplied text (spec §8.3, decision 21)', () => {
    const m = renderOperatorMessage('provider_disabled', {
      definitionName: 'a\u0007b',
      executionId: null,
      detail: 'x\u001b[31my\u009bz',
    });
    expect(m.subject).toBe('[get-me-there] a b: a provider was disabled for this run');
    expect(m.body.startsWith('x [31my z')).toBe(true);
  });
  it('a scheduled run no provider can run has its own subject and guidance (po-003)', () => {
    const m = renderOperatorMessage('skipped_budget', {
      definitionName: 'd',
      executionId: null,
      detail: 'searchapi is excluded from scheduled runs on its plan',
      variant: 'no-runnable-provider',
    });
    expect(m.subject).toBe('[get-me-there] d: scheduled run skipped: no configured provider can run it');
    expect(m.body).not.toContain('raise the cap');
  });
});

describe('LogNotifier (spec §8.3)', () => {
  it('logs subject and body as plain text and reports ok', async () => {
    const lines: LogLine[] = [];
    const n = new LogNotifier(capturingLogger(lines));
    const msg: OperatorMessage = {
      kind: 'parity_break',
      executionId: 'e1',
      definitionId: 'd1',
      subject: 's\u0000',
      body: 'b1\nb2',
    };
    expect(await n.send({ kind: 'operator', message: msg })).toEqual({ ok: true });
    expect(lines[0]).toMatchObject({
      level: 'info',
      bindings: { notifier: 'log' },
      fields: { kind: 'parity_break', executionId: 'e1', definitionId: 'd1', subject: 's' },
      msg: 'b1\nb2',
    });
  });
  it('refuses anything carrying a synthetic price (spec §5.5 "Alerts and notifiers refuse synthetic rows")', async () => {
    const lines: LogLine[] = [];
    const n = new LogNotifier(capturingLogger(lines));
    const r = await n.send({ kind: 'digest', digest: syntheticDigest(), subject: 's', body: 'b' });
    expect(r.ok).toBe(false);
    expect(lines).toHaveLength(0);
    expect(containsSynthetic({ a: [{ b: { sourceKind: 'authorised-cached' } }] })).toBe(false);
    expect(containsSynthetic({ a: [{ b: { sourceKind: 'synthetic' } }] })).toBe(true);
  });
  it('logs a digest without synthetic rows', async () => {
    const lines: LogLine[] = [];
    const n = new LogNotifier(capturingLogger(lines));
    const d = syntheticDigest();
    const real = { ...d, items: [] };
    expect(await n.send({ kind: 'digest', digest: real, subject: 'digest\u0007', body: 'one\ntwo' })).toEqual(
      { ok: true },
    );
    expect(lines[0]).toMatchObject({
      fields: { kind: 'alert_digest', ruleId: 'r1', subject: 'digest' },
      msg: 'one\ntwo',
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine exec vitest run notifications`
Expected: FAIL, `Cannot find module '../src/notify.js'`.

- [ ] **Step 3: Implement**

`packages/engine/src/execute.ts` — the import block becomes:

```ts
import type { ExecutionStatus, IsoDateTime, OperatorMessageKind } from '@gmt/core';
import type { ExecutionPatch } from '@gmt/db';
import type { EngineContext } from './context.js';
import { notifyOperator } from './notify.js';
import { errorText, type RunState, type StopReason, stopRun } from './run.js';
import { runDiscovery } from './stages/discovery.js';
import { breachText, formatInstant } from './text.js';
```

`packages/engine/src/execute.ts` — replace or add these declarations:

```ts
/**
 * Writes the pass's final status after sending its notices. The status write is the last act, so anyone who observes a
 * final status also observes every write and notification of the pass.
 */
export async function finish(ctx: EngineContext, run: RunState): Promise<void> {
  const { status, patch, notice } = finalStatus(run.stop, ctx.clock.now(), run.snapshot.scheduleTz);
  const notices = notice === null ? [...run.notices] : [...run.notices, notice];
  const name = ctx.repos.definitions.get(run.definitionId)?.name ?? run.snapshot.name;
  for (const n of notices) {
    await notifyOperator(ctx, n.kind, {
      executionId: run.executionId,
      definitionId: run.definitionId,
      definitionName: name,
      detail: n.detail,
    });
  }
  ctx.repos.executions.setStatus(run.executionId, status, patch);
  if (patch.resumeAfter !== undefined && patch.resumeAfter !== null)
    ctx.hooks.scheduleResume(run.executionId, run.definitionId, patch.resumeAfter);
  run.log.info({ status, notices: notices.map((n) => n.kind) }, 'execution: pass finished');
}
```

`packages/engine/src/notifiers/log.ts` (new file):

```ts
import type { Logger, Notifier } from '@gmt/core';
import { cleanLine, cleanText } from './operatorTemplates.js';

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
 * The always-available notifier: writes each message to the log as plain text (spec §8.3 "EmailNotifier … and
 * LogNotifier"). EmailNotifier is WP11.
 */
export class LogNotifier implements Notifier {
  readonly id = 'log';
  readonly #log: Logger;
  constructor(log: Logger) {
    this.#log = log.child({ notifier: 'log' });
  }
  async send(msg: Parameters<Notifier['send']>[0]): Promise<{ ok: boolean; detail?: string }> {
    if (containsSynthetic(msg))
      return { ok: false, detail: 'synthetic data is never delivered by a notifier' };
    if (msg.kind === 'operator') {
      const m = msg.message;
      this.#log.info(
        {
          kind: m.kind,
          executionId: m.executionId,
          definitionId: m.definitionId,
          subject: cleanLine(m.subject),
        },
        cleanText(m.body),
      );
    } else {
      const d = msg.digest;
      this.#log.info(
        {
          kind: 'alert_digest',
          executionId: d.executionId,
          definitionId: d.definitionId,
          ruleId: d.ruleId,
          subject: cleanLine(msg.subject),
        },
        cleanText(msg.body),
      );
    }
    return { ok: true };
  }
}
```

`packages/engine/src/notifiers/operatorTemplates.ts` (new file):

```ts
import { type OperatorMessageKind, stripControlChars, stripUrlsInText } from '@gmt/core';

/** Every operator-notification kind of spec §8.1 "Operator notifications" (core's OperatorMessageKind). */
export const OPERATOR_KINDS: readonly OperatorMessageKind[] = [
  'paused_budget',
  'paused_error',
  'skipped_budget',
  'skipped_confirm',
  'skipped_window',
  'skipped_missed',
  'interrupted',
  'provider_disabled',
  'provider_capped',
  'parity_break',
  'alerts_calendar_only',
  'crash_loop',
];

// why: spec §11 banned words apply to engine templates; every string here is covered by the banned-word test in
// notifications.test.ts and the runtime sweep of Task 7.20. "Budget cap" covers call caps and spend caps alike; the
// detail line names which one and its figures (po-015).
const SUBJECTS: Readonly<Record<OperatorMessageKind, string>> = {
  paused_budget: 'run paused: a budget cap was reached',
  paused_error: 'run paused after errors',
  skipped_budget: 'scheduled run skipped: it would exceed a budget cap',
  skipped_confirm: 'scheduled run skipped: the cost estimate needs your confirmation',
  skipped_window: 'scheduled run skipped: the window has no departure dates left, schedule disabled',
  skipped_missed: 'scheduled run missed while the app was stopped',
  interrupted: 'run interrupted',
  provider_disabled: 'a provider was disabled for this run',
  provider_capped: 'a provider reached a budget cap; the others carried on',
  crash_loop: 'automatic resume stopped after repeated restarts',
  parity_break: 'request count differs from the plan',
  alerts_calendar_only: 'alerts running on calendar basis only',
};
const GUIDANCE: Readonly<Record<OperatorMessageKind, string>> = {
  paused_budget:
    'Raise the cap, or wait for the automatic resume if the line above names one; Resume is on the status bar.',
  paused_error: 'Check the provider, then resume from the status bar once the cause is fixed.',
  skipped_budget: 'Lower maxCells, run less often, or raise the cap.',
  skipped_confirm: 'Open the definition and confirm the new estimate.',
  skipped_window: 'Edit the window, then enable the definition again.',
  skipped_missed: 'The next scheduled run goes ahead as normal; start one now if you need newer prices.',
  interrupted:
    'With AUTO_RESUME on it resumes on the next start unless it has restarted too often without progress, or is older than its discovery refresh allows (then it is cancelled and the next run starts with fresh prices); otherwise resume it from the status bar.',
  provider_disabled: 'The other providers carried on; a manual resume retries this one.',
  provider_capped:
    'Its cells stay skipped (budget) in this run: resume the run by hand once the cap window reopens or the cap is raised, or the next scheduled run searches them.',
  crash_loop: 'Check the logs for the cause, then resume it manually from the status bar.',
  parity_break: 'The plan and the ledger disagree; Coverage shows both counts.',
  alerts_calendar_only:
    'Cells skipped for budget had no itinerary search, so verified-basis rules could not judge them; calendar-basis rules ran, constraints not checked.',
};
/** A scheduled run no configured provider can run is a configuration problem, not a spend one (po-003). */
const NO_RUNNABLE_PROVIDER = {
  subject: 'scheduled run skipped: no configured provider can run it',
  guidance: 'Configure a provider for this definition, or move it to a plan that allows scheduled runs.',
} as const;

/**
 * One line of provider- or operator-supplied text: URL query and userinfo stripped, every control character (C0 and
 * C1, core's stripControlChars, decision 21) → a space, runs of spaces collapsed (spec §5.3, §8.3).
 */
export function cleanLine(s: string): string {
  return stripControlChars(stripUrlsInText(s), ' ').replace(/ {2,}/g, ' ').trim();
}
/** Multi-line text: each line cleaned, line breaks kept. */
export function cleanText(s: string): string {
  return s.split('\n').map(cleanLine).join('\n');
}

/** What a template needs; `variant` picks the no-runnable-provider wording of skipped_budget. */
export interface MessageParams {
  definitionName: string;
  executionId: string | null;
  detail: string;
  variant?: 'no-runnable-provider';
}

/** Plain-text subject and body for an operator notification (spec §8.3 "Plain text only"). */
export function renderOperatorMessage(
  kind: OperatorMessageKind,
  p: MessageParams,
): { subject: string; body: string } {
  const noProvider = kind === 'skipped_budget' && p.variant === 'no-runnable-provider';
  const subject = `[get-me-there] ${cleanLine(p.definitionName)}: ${noProvider ? NO_RUNNABLE_PROVIDER.subject : SUBJECTS[kind]}`;
  const lines = [cleanText(p.detail), noProvider ? NO_RUNNABLE_PROVIDER.guidance : GUIDANCE[kind]];
  if (p.executionId !== null) lines.push(`Execution: ${p.executionId}`);
  return { subject, body: lines.join('\n') };
}
```

`packages/engine/src/notify.ts` (new file):

```ts
import type { OperatorMessage, OperatorMessageKind } from '@gmt/core';
import type { EngineContext } from './context.js';
import { type MessageParams, renderOperatorMessage } from './notifiers/operatorTemplates.js';
import { errorText } from './run.js';

export interface NotifyParams extends MessageParams {
  definitionId: string;
}

/**
 * Sends one operator notification to every notifier, at most once per (kind, execution) — per (kind, definition) when
 * there is no execution (spec §8.1 "deduplicated per execution and kind"). Returns false when deduplicated. Never
 * throws: a failing notifier is logged and recorded as failed, because a notification must not stop a run.
 */
export async function notifyOperator(
  ctx: Pick<EngineContext, 'repos' | 'notifiers' | 'log'>,
  kind: OperatorMessageKind,
  p: NotifyParams,
): Promise<boolean> {
  if (ctx.repos.notifications.wasSent(kind, p.executionId, p.definitionId)) return false;
  const { subject, body } = renderOperatorMessage(kind, p);
  const message: OperatorMessage = {
    kind,
    executionId: p.executionId,
    definitionId: p.definitionId,
    subject,
    body,
  };
  let ok = ctx.notifiers.length > 0;
  for (const n of ctx.notifiers) {
    try {
      const r = await n.send({ kind: 'operator', message });
      if (!r.ok) {
        ok = false;
        ctx.log.warn(
          {
            notifier: n.id,
            kind,
            executionId: p.executionId,
            definitionId: p.definitionId,
            detail: r.detail ?? null,
          },
          'operator notification refused',
        );
      }
    } catch (err) {
      ok = false;
      ctx.log.warn(
        {
          notifier: n.id,
          kind,
          executionId: p.executionId,
          definitionId: p.definitionId,
          err: errorText(err),
        },
        'operator notification failed',
      );
    }
  }
  ctx.repos.notifications.record(kind, p.executionId, p.definitionId, ok ? 'sent' : 'failed');
  return true;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine exec vitest run notifications resume-k-of-n`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: operator notifications with per-execution dedup, LogNotifier

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.3: Seeding and the frozen snapshot (Review Focus 4)

**Files:**
- Create: `packages/engine/test/support/wrappers.ts`, `packages/engine/test/seeding.test.ts`
- Modify: `packages/engine/src/snapshot.ts`, `packages/engine/src/start.ts`

**Interfaces:**
- Consumes: `CellsRepo.seed/outcomes/rollUps/markNoData`, `DefinitionsRepo.update`, `generateCells`, `cellKeyString`, `FlightProvider.cabins`.
- Produces: `buildSnapshot(ctx, def, trigger)` (scheduled runs leave out `excludedFromSchedule` providers; `alwaysInclude` members outside the window dropped with a note); the cabin-not-offered rule in the seeding transaction; the test decorators of `test/support/wrappers.ts` (`withCabins`, `mapTiles`, `mapPrices`, `mapResult`, `mapOffers`, `throwOnSearch`, `extraTile`, `dropPlanCell`), each keeping the id `fixture` and taking `discoveryOf`/`verificationOf` from the harness (arch-r2-012).

The schedule-exclusion rule is tested on `buildSnapshot` with the fixture's limits marked `excludedFromSchedule`, because a layer-A test may not register a stub under a real provider id (ruling 1); Task 7.13 pins what a start does when that leaves no provider.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/seeding.test.ts` (new file):

```ts
import { asIsoDate, cellKeyString, generateCells, resolveWindow } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { buildSnapshot } from '../src/snapshot.js';
import { createHarness, discoveryOf, FIXTURE_RULES, JFK, LGW, LHR, WINDOW } from './support/harness.js';
import { withCabins } from './support/wrappers.js';

describe('seeding (spec §3, §7 atomic unit "seeding search_cells + discovery cell_outcomes at start")', () => {
  it('seeds not_run for every cell × discovery provider and nothing for a stage without a provider', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const def = h.createDefinition();
    const r = await h.orch().start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const cells = generateCells({
      origins: [LHR],
      destinations: [JFK],
      departureFrom: WINDOW.from,
      departureTo: WINDOW.to,
      minNights: 7,
      maxNights: 8,
    });
    // why: both tiles must be held before the release, or a tile requested after it would wait forever
    await vi.waitFor(() => expect(h.requests.filter((q) => q.kind === 'calendar')).toHaveLength(2));
    const rows = h.outcomes(r.executionId, { stage: 'discovery', providerId: 'fixture' });
    expect(rows.map(cellKeyString).sort()).toEqual(cells.map(cellKeyString).sort());
    expect(rows.every((o) => o.status === 'not_run' && o.attempts === 0)).toBe(true);
    expect(h.outcomes(r.executionId, { stage: 'verification' })).toHaveLength(0);
    await h.releaseHolds();
    await h.waitForSettled(r.executionId);
    const rollUps = h.repos.cells.rollUps(r.executionId);
    expect(rollUps.size).toBe(cells.length);
    for (const v of rollUps.values()) expect(v.verification.status).toBeNull(); // spec §6.6 row 0: NULL / not_applicable
  });

  it('freezes a relative window at start in Europe/London', async () => {
    const h = createHarness();
    const def = h.createDefinition({ window: { kind: 'relative', startOffsetDays: 7, lengthDays: 2 } });
    const e = await h.runToCompletion(h.orch(), def.id);
    const w = resolveWindow(def.window, h.clock.todayLondon()); // WP1 owns the inclusive-end rule; compare with it
    expect(e.snapshot.resolved).toMatchObject({ departureFrom: w.departureFrom, departureTo: w.departureTo });
    expect(e.snapshot.resolved.departureFrom).toBe('2026-10-21'); // 2026-10-14 + 7 days
    expect(e.snapshot.resolvedAt).toBe(h.clock.now());
    h.clock.advance(3 * 86_400_000);
    h.repos.definitions.update(def.id, { window: { kind: 'relative', startOffsetDays: 30, lengthDays: 5 } });
    expect(h.repos.executions.get(e.id)?.snapshot.resolved).toEqual(e.snapshot.resolved); // frozen
  });

  it('drops alwaysInclude cells that slid out of a relative window, with a note, not an error (spec §6.1)', async () => {
    const h = createHarness();
    const inside = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-10-21'),
      returnDate: asIsoDate('2026-10-28'),
    };
    const slid = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-10-20'),
      returnDate: asIsoDate('2026-10-27'),
    };
    const def = h.createDefinition({
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 2 },
      verification: { maxCells: 2, topN: 2, alwaysInclude: [inside, slid], expandTop: 1, bookingLinks: true },
    });
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.snapshot.verification.alwaysInclude).toEqual([inside]);
    expect(e.snapshot.droppedAlwaysInclude).toEqual([slid]);
    const started = h.logs.find((l) => l.msg === 'execution: started');
    const notes = started?.fields.notes;
    expect(
      Array.isArray(notes) && notes.includes('alwaysInclude: 1 cell left the window and was dropped'),
    ).toBe(true);
  });

  it('a scheduled snapshot leaves out a provider excluded from scheduled runs (the SearchApi trial rule, spec §8.2)', () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    // why: the fixture is the only provider a layer-A test may register (ruling 1), so the plan flag is set on its limits here
    const excluded = {
      ...ctx,
      limitsOf: (id: Parameters<typeof ctx.limitsOf>[0]) => ({
        ...ctx.limitsOf(id),
        excludedFromSchedule: true,
      }),
    };
    const def = h.createDefinition();
    const scheduled = buildSnapshot(excluded, def, 'schedule');
    expect(scheduled.snapshot.providers.discovery).toEqual([]);
    expect(scheduled.notes).toContain('fixture is excluded from scheduled runs on its plan');
    expect(buildSnapshot(excluded, def, 'manual').snapshot.providers.discovery).toEqual(['fixture']);
  });

  it('a provider whose cabins exclude the definition cabin is never called: every cell no_data, reason cabin-not-offered (spec rev 10)', async () => {
    const h = createHarness({ transformFixture: (p) => withCabins(p, ['business']) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ cabin: 'economy' }).id);
    expect(e.status).toBe('completed');
    const rows = h.outcomes(e.id, { providerId: 'fixture' });
    expect(rows.length).toBe(28);
    expect(rows.every((o) => o.status === 'no_data' && o.reason === 'cabin-not-offered')).toBe(true);
    expect(h.ledgerRows(e.id)).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
  });
});

describe('Review Focus 4: a PUT during a run does not change the running execution', () => {
  it('keeps the snapshot and the plan of the running execution after the definition is edited', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold, times: 1 }]);
    const plan = vi.spyOn(discoveryOf(h.fixture), 'plan');
    const def = h.createDefinition();
    const r = await h.orch().start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.length).toBe(1));
    h.repos.definitions.update(def.id, { origins: [LGW], minNights: 9, maxNights: 9, cabin: 'business' });
    await h.releaseHolds();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('completed');
    expect(e.snapshot.origins).toEqual([LHR]);
    expect(e.snapshot.cabin).toBe('economy');
    const all = h.outcomes(r.executionId);
    expect(all.length).toBe(28);
    expect(all.every((o) => o.origin === LHR)).toBe(true);
    expect(new Set(all.map((o) => o.returnDate)).size).toBeGreaterThan(1); // still the 7–8 night band
    expect(plan.mock.calls.length).toBeGreaterThan(0);
    expect(
      plan.mock.calls.every(
        ([q]) => q.origin === LHR && q.minNights === 7 && q.maxNights === 8 && q.cabin === 'economy',
      ),
    ).toBe(true);
    expect(h.repos.definitions.get(def.id)?.origins).toEqual([LGW]); // the edit itself was stored
  });
});
```

`packages/engine/test/support/wrappers.ts` (new file):

```ts
/**
 * Provider decorators for layer-A tests. Each wraps the fixture provider and changes one thing the test needs; the
 * result keeps the id `fixture` and sourceKind `synthetic` (ruling 1), and every call it makes still goes through
 * http-kit, the ledger and the cache. No wrapper invents a price: it rewrites, drops or re-requests what the fixture
 * server answered.
 */
import type {
  Cabin,
  CellKey,
  DiscoveryCapability,
  DiscoveryTileResult,
  FlightProvider,
  ItinerarySearchResult,
  RawCalendarPrice,
  RawOffer,
  VerificationCapability,
} from '@gmt/core';
import { discoveryOf, verificationOf } from './harness.js';

function shell(
  p: FlightProvider,
  parts: {
    discovery?: DiscoveryCapability;
    verification?: VerificationCapability;
    cabins?: readonly Cabin[];
  },
): FlightProvider {
  const discovery = parts.discovery ?? p.discovery;
  const verification = parts.verification ?? p.verification;
  return {
    id: p.id,
    displayName: p.displayName,
    suppliedFields: p.suppliedFields,
    cabins: parts.cabins ?? p.cabins,
    ...(discovery !== undefined ? { discovery } : {}),
    ...(verification !== undefined ? { verification } : {}),
    healthcheck: (ctx) => p.healthcheck(ctx),
  };
}

/** Declares only `cabins` (the provider sells nothing else; spec rev 10 cabin-not-offered). */
export function withCabins(p: FlightProvider, cabins: readonly Cabin[]): FlightProvider {
  return shell(p, { cabins });
}

/** Rewrites every tile result (e.g. covered cells the engine did not plan). */
export function mapTiles(
  p: FlightProvider,
  f: (r: DiscoveryTileResult) => DiscoveryTileResult,
): FlightProvider {
  const d = discoveryOf(p);
  return shell(p, {
    discovery: {
      info: d.info,
      plan: (q) => d.plan(q),
      fetchTile: async (plan, q, ctx) => f(await d.fetchTile(plan, q, ctx)),
    },
  });
}

/** Rewrites every raw calendar price of every tile (e.g. a different currency). */
export function mapPrices(
  p: FlightProvider,
  f: (price: RawCalendarPrice, i: number) => RawCalendarPrice,
): FlightProvider {
  return mapTiles(p, (r) => (r.kind === 'tile' ? { ...r, prices: r.prices.map(f) } : r));
}

/** Rewrites the whole result of every itinerary search (offers, coverage, partial, route history). */
export function mapResult(
  p: FlightProvider,
  f: (r: ItinerarySearchResult) => ItinerarySearchResult,
): FlightProvider {
  const v = verificationOf(p);
  return shell(p, {
    verification: {
      info: v.info,
      estimate: (q) => v.estimate(q),
      search: async (q, ctx) => f(await v.search(q, ctx)),
    },
  });
}

/** Rewrites every raw offer of every itinerary search. */
export function mapOffers(p: FlightProvider, f: (offer: RawOffer, i: number) => RawOffer): FlightProvider {
  return mapResult(p, (r) => ({ ...r, offers: r.offers.map(f) }));
}

/** Makes itinerary search throw `err` for cells matching `when`, without calling the fixture server. */
export function throwOnSearch(
  p: FlightProvider,
  err: Error,
  when: (cell: CellKey) => boolean,
): FlightProvider {
  const v = verificationOf(p);
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

/** Re-requests every tile under a second tile index, breaking parity on purpose (distinct tile requests = 2 × plan). */
export function extraTile(p: FlightProvider): FlightProvider {
  const d = discoveryOf(p);
  return shell(p, {
    discovery: {
      info: d.info,
      plan: (q) => d.plan(q),
      fetchTile: async (plan, q, ctx) => {
        await d.fetchTile({ ...plan, index: plan.index + 1000 }, q, ctx);
        return d.fetchTile(plan, q, ctx);
      },
    },
  });
}

/** A plan that leaves out the first cell of every pair: tiles no longer partition the cells (ssr-06). */
export function dropPlanCell(p: FlightProvider): FlightProvider {
  const d = discoveryOf(p);
  return shell(p, {
    discovery: {
      info: d.info,
      plan: (q) => d.plan(q).map((t, i) => (i === 0 ? { ...t, coveredCells: t.coveredCells.slice(1) } : t)),
      fetchTile: (plan, q, ctx) => d.fetchTile(plan, q, ctx),
    },
  });
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine exec vitest run seeding`
Expected: FAIL in three tests: "drops alwaysInclude cells…" (the snapshot keeps both cells), "a scheduled snapshot leaves out…" (the trigger is ignored) and "a provider whose cabins exclude…" (the fixture is called). The other three pass: Task 7.1 already seeds and snapshots, and they pin that behaviour.

- [ ] **Step 3: Implement**

`packages/engine/src/snapshot.ts` — replace the file:

```ts
import {
  type Cell,
  cellKeyString,
  type DefinitionSnapshot,
  generateCells,
  type ProviderId,
  type ResolvedSpace,
  resolveWindow,
  type SearchDefinition,
} from '@gmt/core';
import type { EngineContext } from './context.js';

export interface BuiltSnapshot {
  snapshot: DefinitionSnapshot;
  cells: Cell[];
  notes: string[];
}
export type Trigger = 'manual' | 'schedule';

/**
 * Resolves the window in Europe/London and freezes the definition into an execution snapshot (spec §6.1 "frozen into
 * the execution snapshot", §8.1 "start: snapshot"). The snapshot is read once; nothing a later PUT does reaches a
 * running pass (Review Focus 4).
 *
 * - providers: only those registered with the capability; a scheduled run also leaves out a provider marked
 *   excludedFromSchedule (spec §8.2 "scheduled runs exclude SearchApi on trial");
 * - alwaysInclude: members that slid out of a relative window are dropped with a note (spec §6.1).
 */
export function buildSnapshot(
  ctx: EngineContext,
  def: SearchDefinition,
  trigger: Trigger = 'manual',
): BuiltSnapshot {
  const notes: string[] = [];
  const w = resolveWindow(def.window, ctx.clock.todayLondon());
  if (w.clamped) notes.push('window clamped to start tomorrow');
  const resolved: ResolvedSpace = {
    origins: def.origins,
    destinations: def.destinations,
    departureFrom: w.departureFrom,
    departureTo: w.departureTo,
    minNights: def.minNights,
    maxNights: def.maxNights,
  };
  const cells = w.departureFrom > w.departureTo ? [] : generateCells(resolved);
  const inSpace = new Set(cells.map(cellKeyString));
  const kept = def.verification.alwaysInclude.filter((c) => inSpace.has(cellKeyString(c)));
  const dropped = def.verification.alwaysInclude.length - kept.length;
  if (dropped > 0)
    notes.push(
      `alwaysInclude: ${dropped} ${dropped === 1 ? 'cell left the window and was dropped' : 'cells left the window and were dropped'}`,
    );
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
    droppedAlwaysInclude: def.verification.alwaysInclude.filter((c) => !inSpace.has(cellKeyString(c))),
  };
  return { snapshot, cells, notes };
}
```

`packages/engine/src/start.ts` — replace or add these declarations:

```ts
/** Spec §8.1 "start: snapshot; seed search_cells + cell_outcomes(not_run) …; status=running". */
export async function startExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  definitionId: string,
  opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number },
): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', `definition ${definitionId} not found`, { definitionId });
  if (ctx.repos.executions.activeParent(def.id) !== null)
    return refused('active', 'another execution of this definition is active', { definitionId });
  const built = buildSnapshot(ctx, def, opts.trigger);
  const discovery = built.snapshot.providers.discovery;
  let exec: Execution;
  try {
    // why: spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start" — the row is created running and
    // seeded in one BEGIN IMMEDIATE, so a crash can never leave an execution without its cells (ssr-07)
    exec = ctx.db.immediateTransaction(() => {
      const e = ctx.repos.executions.create({
        definitionId: def.id,
        isChild: false,
        cell: null,
        snapshot: built.snapshot,
        estimate: null,
        trigger: opts.trigger,
        status: 'running',
      });
      ctx.repos.cells.seed(e.id, built.cells, discovery);
      // why: spec rev 10 — a provider that does not sell the snapshot's cabin is never called; its cells are no_data
      for (const id of discovery)
        if (!(ctx.providers.get(id)?.cabins ?? []).includes(built.snapshot.cabin))
          ctx.repos.cells.markNoData(e.id, 'discovery', id, 'cabin-not-offered');
      return e;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      return refused('active', 'another execution of this definition is active', { definitionId });
    throw err;
  }
  const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: new Set() });
  run.log.info(
    { trigger: opts.trigger, cells: built.cells.length, notes: built.notes },
    'execution: started',
  );
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine exec vitest run seeding resume-k-of-n`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: frozen snapshot with schedule exclusion and alwaysInclude drop; seeding tests; review focus 4

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.4: The §8.1 error table in the discovery stage, and cancel

**Files:**
- Create: `packages/engine/src/errors.ts`, `test/errors.test.ts`, `test/error-table-discovery.test.ts`; `packages/core/test/types/errorReason.test.ts`; `packages/db/test/cells.noPricedOptions.test.ts`
- Modify: `packages/engine/src/run.ts` (`onFailure`, `disableProvider`, `settleLane`), `src/stages/discovery.ts` (settle the lane), `src/orchestrator.ts` (`cancel`); `packages/core/src/types/execution.ts` (`NoPricedOptionsReason`); `packages/db/src/internal/enums.ts` (`ERROR_REASONS`), `src/repositories/cells.ts` (`NON_RETRYABLE`)

**Interfaces:**
- Consumes: `ProviderError`, `BudgetExceeded`, `AbortedError`, `ErrorReason`, `CellsRepo.writeTileError/setOutcome`, WP4's scenario rules (`FIXTURE_RULES`, `tileRule`).
- Produces: `classifyFailure(err, aborted, now): FailureDecision`, `addSeconds(at, s)` (through `isoDateTimeOfEpochMs`), `disableProvider(run, providerId, why)`, `settleLane`, `Orchestrator.cancel(executionId): Promise<boolean>`; core's `ErrorReason` with `no-priced-options` and db's lists that follow it.

The stored reason is the error kind, except an `upstream` error whose `reason` is `no-return-legs` or `no-priced-options`: each is its own reason in core's closed `ErrorReason` list (decision 37), and db's `ERROR_REASONS` (an `exhaustive<ErrorReason>()` list, so it fails to compile without it) and the resume query's `NON_RETRYABLE` list gain it, so neither an automatic nor a manual resume selects it and every reason-keyed reader (roll-ups, the coverage buckets, View D, WP8's filters) sees it for what it is (prov-wp07-006, arch-r2-005). The URL-free vendor message goes to `last_error` (decision 24's machine cause). A disabled provider stops taking tiles and a tile already in flight finishes and is written (decision 25). The streak test asserts that both parse errors happened, on the first LHR and the first LGW tile, and the limiter test asserts the exact not_run set (all 56 cells, one tile at a time), so a rule that matched nothing cannot pass (test-strategy-reviewer-028). The error-table files run under fake timers, so http-kit's 1–6 s backoff costs no wall time (test-strategy-reviewer-003).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/types/errorReason.test.ts` (new file):

```ts
import { describe, expectTypeOf, it } from 'vitest';
import type { ErrorReason, NoPricedOptionsReason } from '../../src/types/execution.js';

describe('ErrorReason (spec §3, §5.4; decision 37)', () => {
  it('the closed list names no-priced-options as a reason of its own', () => {
    expectTypeOf<NoPricedOptionsReason>().toEqualTypeOf<'no-priced-options'>();
    expectTypeOf<'no-priced-options'>().toExtend<ErrorReason>();
    expectTypeOf<'upstream'>().toExtend<ErrorReason>();
    expectTypeOf<'no-return-legs'>().toExtend<ErrorReason>();
    expectTypeOf<'offers-dropped'>().not.toExtend<ErrorReason>();
  });
});
```

`packages/db/test/cells.noPricedOptions.test.ts` (new file):

```ts
import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ERROR_REASONS } from '../src/internal/enums.js';
import { CellsRepo } from '../src/repositories/cells.js';
import { freshDb, T0 } from './helpers/db.js';
import { cell, newExecution, withNights } from './helpers/factories.js';

const day = (n: number) => cell(undefined, undefined, `2027-05-0${n}`, `2027-06-0${n}`);

describe('no-priced-options (spec §5.4, decision 37)', () => {
  it('is an error reason of its own, and neither an automatic nor a manual resume selects it', () => {
    expect(ERROR_REASONS).toContain('no-priced-options');
    const db = freshDb();
    const clock = fixedClock(T0);
    const { execution } = newExecution(db, clock);
    const repo = new CellsRepo(db, clock, { allowSynthetic: false });
    repo.seed(execution.id, [day(1), day(2)].map(withNights), []);
    repo.seedVerification(
      execution.id,
      [
        { cell: day(1), reason: 'top_n' },
        { cell: day(2), reason: 'top_n' },
      ],
      [day(1), day(2)],
      ['searchapi'],
    );
    for (const [c, reason] of [
      [day(1), 'no-priced-options'],
      [day(2), 'upstream'],
    ] as const)
      repo.setOutcome(execution.id, c, 'verification', 'searchapi', {
        status: 'error',
        reason,
        lastError: 'step 1 returned options and none was priced',
        incrementAttempts: true,
      });
    expect(repo.outcomes(execution.id, { cells: [day(1)], stage: 'verification' })[0]?.reason).toBe(
      'no-priced-options',
    );
    for (const manual of [false, true])
      expect(repo.resumable(execution.id, 'verification', 'searchapi', manual)).toEqual([day(2)]);
  });
});
```

`packages/engine/test/error-table-discovery.test.ts` (new file):

```ts
import { type CellKey, cellKeyString, generateCells } from '@gmt/core';
import type { FixtureRule } from '@gmt/providers/fixture';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { addSeconds } from '../src/errors.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { buildSnapshot } from '../src/snapshot.js';
import { planTiles } from '../src/stages/discovery.js';
import {
  createHarness,
  discoveryOf,
  FIXTURE_RULES,
  type Harness,
  type HarnessOptions,
  JFK,
  LGW,
  LHR,
  T0,
  tileRule,
  WINDOW,
} from './support/harness.js';
import { dropPlanCell, mapTiles } from './support/wrappers.js';

const FIRST = '2026-11-02'; // WP4 tiles: 7 departure days from WINDOW.from
const SECOND = '2026-11-09';
const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const keys = (cells: readonly CellKey[]) => cells.map(cellKeyString).sort();

/** The fixture's own tile for `origin` → JFK over WINDOW that starts on `departFrom`: its covered cells. */
function tileCells(h: Harness, origin: typeof LHR, departFrom: string): CellKey[] {
  const cells = generateCells({
    origins: [origin],
    destinations: [JFK],
    departureFrom: WINDOW.from,
    departureTo: WINDOW.to,
    minNights: 7,
    maxNights: 8,
  });
  const tiles = discoveryOf(h.fixture).plan({
    origin,
    destination: JFK,
    departureFrom: WINDOW.from,
    departureTo: WINDOW.to,
    minNights: 7,
    maxNights: 8,
    cabin: 'economy',
    currency: 'GBP',
    cells,
  });
  const t = tiles.find((x) => x.request.kind === 'rectangle' && x.request.departFrom === departFrom);
  if (t === undefined) throw new Error(`no fixture tile starts ${departFrom}`);
  return t.coveredCells;
}
const lhrTile = (h: Harness, departFrom: string) => tileCells(h, LHR, departFrom);

/** LHR and LGW → JFK under WP4 rules; fake timers drive http-kit's backoff; one tile at a time unless `opts` says otherwise. */
async function run(rules: FixtureRule[], opts: HarnessOptions = {}) {
  // why: http-kit serialises fixture calls, so "consecutive" is deterministic for the parse-streak rows
  const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true, ...opts });
  await h.fixtureScenario(rules);
  const ctx = buildContext(h.deps, h.options);
  const scheduleResume = vi.fn();
  ctx.hooks.scheduleResume = scheduleResume;
  const e = await h.runToCompletion(
    h.track(createOrchestrator(ctx)),
    h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] }).id,
  );
  return { h, e, scheduleResume };
}

describe('error table, discovery stage: retryable kinds after retries (cell error, attempts+1, continue)', () => {
  it.each([
    ['rate-limit', FIXTURE_RULES.rateLimit],
    ['upstream', FIXTURE_RULES.upstream],
    ['network', FIXTURE_RULES.network],
  ] as const)('%s', async (reason, respond) => {
    const { h, e } = await run([tileRule('LHR', FIRST, respond, 3)]);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { stage: 'discovery', status: 'error' });
    expect(keys(errors)).toEqual(keys(lhrTile(h, FIRST)));
    expect(
      errors.every(
        (o) => o.reason === reason && o.attempts === 1 && o.lastError !== null && !o.lastError.includes('?'),
      ),
    ).toBe(true);
    expect(h.outcomes(e.id, { stage: 'discovery', status: 'not_run' })).toHaveLength(0);
  });
});

describe('error table, discovery stage: non-retryable kinds', () => {
  it.each([
    ['parse (HTTP 400 with the vendor message)', FIXTURE_RULES.badRequest, 'parse'],
    ['parse (malformed 200 body)', FIXTURE_RULES.malformed, 'parse'],
    ['upstream (HTTP 404)', FIXTURE_RULES.notFound, 'upstream'],
  ] as const)('%s → error once, the run continues', async (_n, respond, reason) => {
    const { h, e } = await run([tileRule('LHR', FIRST, respond, 1)]);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { stage: 'discovery', status: 'error' });
    expect(keys(errors)).toEqual(keys(lhrTile(h, FIRST)));
    expect(errors.every((o) => o.reason === reason && o.attempts === 1)).toBe(true);
  });

  it('tile-error marks exactly its own cells (the second LHR tile)', async () => {
    const { h, e } = await run([tileRule('LHR', SECOND, FIXTURE_RULES.upstream, 3)]);
    expect(keys(h.outcomes(e.id, { stage: 'discovery', status: 'error' }))).toEqual(keys(lhrTile(h, SECOND)));
  });

  it('two consecutive parse errors disable the provider: remaining cells skipped:provider_disabled, paused_error, notified', async () => {
    const { h, e } = await run([
      tileRule('LHR', FIRST, FIXTURE_RULES.badRequest, 1),
      tileRule('LHR', SECOND, FIXTURE_RULES.badRequest, 1),
    ]);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBeNull();
    expect(h.outcomes(e.id, { status: 'error' }).every((o) => o.reason === 'parse')).toBe(true);
    const skipped = h.outcomes(e.id, { status: 'skipped' });
    expect(skipped.length).toBe(28); // both LGW tiles (14 cells each)
    expect(skipped.every((o) => o.reason === 'provider_disabled')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['provider_disabled', 'paused_error']);
  });

  it('a parse error, a success, then a parse error is not "two consecutive"', async () => {
    const { h, e } = await run([
      tileRule('LHR', FIRST, FIXTURE_RULES.badRequest, 1),
      tileRule('LGW', FIRST, FIXTURE_RULES.badRequest, 1),
    ]);
    expect(e.status).toBe('completed');
    // why: both rules matched (test-strategy-reviewer-028): the two parse errors happened, with a success between them
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(keys(errors)).toEqual(keys([...lhrTile(h, FIRST), ...tileCells(h, LGW, FIRST)]));
    expect(errors.every((o) => o.reason === 'parse')).toBe(true);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it.each([
    ['auth', FIXTURE_RULES.auth],
    ['quota', FIXTURE_RULES.quota],
  ] as const)(
    '%s on any call disables the provider for the run; none remain → paused_error + notify',
    async (reason, respond) => {
      const { h, e } = await run([tileRule('LHR', FIRST, respond, 1)]);
      expect(e.status).toBe('paused_error');
      expect(keys(h.outcomes(e.id, { status: 'error' }))).toEqual(keys(lhrTile(h, FIRST)));
      expect(h.outcomes(e.id, { status: 'error' }).every((o) => o.reason === reason)).toBe(true);
      const skipped = h.outcomes(e.id, { status: 'skipped' });
      expect(skipped.length).toBe(42);
      expect(skipped.every((o) => o.reason === 'provider_disabled')).toBe(true);
      expect(kinds(h)).toEqual(['provider_disabled', 'paused_error']);
    },
  );

  it('a disabled provider stops taking tiles, but a tile already in flight finishes and is written (decision 25)', async () => {
    const h = createHarness({ fixtureConcurrency: 2, fakeTimers: true });
    await h.fixtureScenario([
      tileRule('LGW', FIRST, FIXTURE_RULES.hold, 1),
      tileRule('LHR', FIRST, FIXTURE_RULES.auth, 1),
    ]);
    const orch = h.orch();
    const r = await orch.start(h.createDefinition({ origins: [LGW, LHR], destinations: [JFK] }).id, {
      trigger: 'manual',
    });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.outcomes(r.executionId, { status: 'error' }).length).toBeGreaterThan(0));
    await h.releaseHolds();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('paused_error');
    const lgwFirst = h.outcomes(e.id).filter((o) => o.origin === LGW && o.departureDate < SECOND);
    expect(lgwFirst.length).toBe(14);
    expect(lgwFirst.every((o) => o.status === 'priced')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
  });

  it('limiter-timeout: the cells return to not_run; paused_error with resume_after; a one-shot job is requested', async () => {
    const { h, e, scheduleResume } = await run([tileRule('LHR', FIRST, FIXTURE_RULES.limiterTimeout, 3)]);
    expect(e.status).toBe('paused_error');
    const at = addSeconds(T0, 4000);
    expect(e.resumeAfter).toBe(at);
    expect(scheduleResume).toHaveBeenCalledWith(e.id, e.definitionId, at);
    // why: one tile at a time, so the held tile's cells and every tile after it are exactly the not_run set
    const notRun = h.outcomes(e.id, { status: 'not_run' });
    expect(notRun).toHaveLength(56);
    expect(keys(notRun)).toEqual(keys(h.outcomes(e.id)));
    expect(keys(notRun)).toEqual(expect.arrayContaining(keys(lhrTile(h, FIRST))));
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['paused_error']);
  });

  it('a plan that does not partition the cells is a wiring error, refused before any call (spec §5.2, ssr-06)', () => {
    const h = createHarness();
    const def = h.createDefinition();
    const ctx = buildContext(h.deps, h.options);
    const b = buildSnapshot(ctx, def);
    expect(() => planTiles('fixture', discoveryOf(dropPlanCell(h.fixture)), b.snapshot, b.cells)).toThrow(
      'does not partition',
    );
    expect(planTiles('fixture', discoveryOf(h.fixture), b.snapshot, b.cells)).toHaveLength(2);
  });

  it('a tile answered for other cells than planned marks the planned cells parse (the engine owns coverage)', async () => {
    const { h, e } = await run([], {
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind === 'tile' && r.index === 0 ? { ...r, coveredCells: r.coveredCells.slice(1) } : r,
        ),
    });
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(keys(errors)).toEqual(keys(lhrTile(h, FIRST)));
    expect(errors.every((o) => o.reason === 'parse')).toBe(true);
  });
});

describe('error table: AbortedError (cancel / SIGTERM) → not_run', () => {
  const second = (r: { kind: string; params: Record<string, string> }) =>
    r.kind === 'calendar' && r.params.origin === 'LHR' && r.params.departFrom === SECOND;

  it('cancel mid-run: the held tile and every later tile stay not_run, nothing is written for them, the execution is cancelled', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([tileRule('LHR', SECOND, FIXTURE_RULES.hold, 1)]);
    const orch = h.orch();
    const r = await orch.start(h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] }).id, {
      trigger: 'manual',
    });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some(second)).toBe(true));
    expect(await orch.cancel(r.executionId)).toBe(true);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('cancelled');
    const notRun = h.outcomes(e.id, { status: 'not_run' });
    // why: exact set — the held tile plus both LGW tiles (one tile in flight at a time, LHR before LGW)
    expect(keys(notRun)).toEqual(
      keys(h.outcomes(e.id).filter((o) => o.origin === LGW || o.departureDate >= SECOND)),
    );
    expect(notRun.length).toBe(42);
    expect(
      h.repos.calendarPrices
        .fetchedBy(e.id)
        .filter((p) => p.cell.origin === LHR && p.cell.departureDate >= SECOND),
    ).toHaveLength(0);
    // why: the aborted call was reserved, so its ledger row is finalised unknown and still counted (spec §5.3)
    expect(h.ledgerRows(e.id).filter((l) => l.tileIndex === 1)).toEqual([
      expect.objectContaining({ outcome: 'unknown' }),
    ]);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(kinds(h)).toEqual([]);
  });

  it('cancel of an execution that is not running in this process marks it cancelled; of a finished one returns false', async () => {
    const h = createHarness();
    const orch = h.orch();
    const done = await h.runToCompletion(orch, h.createDefinition().id);
    expect(await orch.cancel(done.id)).toBe(false);
    h.repos.executions.setStatus(done.id, 'paused_error', { resumeAfter: null });
    expect(await orch.cancel(done.id)).toBe(true);
    expect(h.repos.executions.get(done.id)?.status).toBe('cancelled');
  });

  it('SIGTERM with a tile in flight: every cell stays not_run, status interrupted', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const orch = h.orch();
    const r = await orch.start(h.createDefinition().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    await orch.shutdown();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('interrupted');
    const all = h.outcomes(e.id);
    expect(all.length).toBe(28);
    expect(all.every((o) => o.status === 'not_run')).toBe(true);
  });
});
```

`packages/engine/test/errors.test.ts` (new file):

```ts
import { AbortedError, asIsoDateTime, BudgetExceeded, ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { addSeconds, classifyFailure } from '../src/errors.js';

const now = asIsoDateTime('2026-10-14T09:00:00.000Z');
const pe = (kind: ProviderError['kind'], extra: { reason?: string; retryAfterSeconds?: number } = {}) =>
  new ProviderError({
    kind,
    retryable: false,
    message: `${kind} at https://u:p@fixture.local/calendar?origin=LHR`,
    ...extra,
  });
const budget = new BudgetExceeded({ scope: 'execution-calls', cap: 10, current: 10, requested: 1 });

describe('classifyFailure (spec §8.1 error table, both stages)', () => {
  it.each([
    ['AbortedError → abort', new AbortedError(), false, { kind: 'abort' }],
    ['anything after the signal aborted → abort', pe('network'), true, { kind: 'abort' }],
    ['BudgetExceeded → budget, never a cell error', budget, false, { kind: 'budget', error: budget }],
    [
      'limiter-timeout → resume at now + retryAfterSeconds (the exhausted reservoir refresh)',
      pe('limiter-timeout', { retryAfterSeconds: 4000 }),
      false,
      { kind: 'limiter-timeout', resumeAfter: '2026-10-14T10:06:40.000Z' },
    ],
    [
      'limiter-timeout without retryAfterSeconds → no reopen time, no guess',
      pe('limiter-timeout'),
      false,
      { kind: 'limiter-timeout', resumeAfter: null },
    ],
    [
      'auth → error, disables the provider',
      pe('auth'),
      false,
      { kind: 'cell-error', reason: 'auth', parse: false, disableProvider: true },
    ],
    [
      'quota → error, disables the provider',
      pe('quota'),
      false,
      { kind: 'cell-error', reason: 'quota', parse: false, disableProvider: true },
    ],
    [
      'parse keeps reason "parse"; the URL-free message goes to lastError',
      pe('parse', { reason: 'parse' }),
      false,
      {
        kind: 'cell-error',
        reason: 'parse',
        lastError: 'parse at https://fixture.local/calendar',
        parse: true,
        disableProvider: false,
      },
    ],
    [
      'upstream no-return-legs keeps its reason',
      pe('upstream', { reason: 'no-return-legs' }),
      false,
      { kind: 'cell-error', reason: 'no-return-legs', parse: false, disableProvider: false },
    ],
    [
      'upstream no-priced-options keeps its reason (spec §5.4, decision 37)',
      pe('upstream', { reason: 'no-priced-options' }),
      false,
      {
        kind: 'cell-error',
        reason: 'no-priced-options',
        lastError: 'upstream at https://fixture.local/calendar',
      },
    ],
    [
      'rate-limit → error',
      pe('rate-limit'),
      false,
      { kind: 'cell-error', reason: 'rate-limit', lastError: 'rate-limit at https://fixture.local/calendar' },
    ],
    ['network → error', pe('network'), false, { kind: 'cell-error', reason: 'network' }],
    ['upstream → error', pe('upstream'), false, { kind: 'cell-error', reason: 'upstream' }],
    [
      'an Error from a repository → fatal with a URL-free message',
      new Error('database or disk is full near https://x.example/a?b=c'),
      false,
      { kind: 'fatal', message: 'database or disk is full near https://x.example/a' },
    ],
    ['a thrown non-Error → fatal', 'weird', false, { kind: 'fatal', message: 'weird' }],
  ] as const)('%s', (_name, err, aborted, expected) => {
    expect(classifyFailure(err, aborted, now)).toMatchObject(expected);
  });
  it('addSeconds mints an IsoDateTime through core', () => {
    expect(addSeconds(now, 90)).toBe('2026-10-14T09:01:30.000Z');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine exec vitest run errors error-table-discovery && pnpm --filter @gmt/db exec vitest run cells.noPricedOptions`
Expected: FAIL, `Cannot find module '../src/errors.js'`; the db test fails with `RowRejected` for the reason `no-priced-options`. (The core type test is a compile-time check: `pnpm --filter @gmt/core typecheck` fails until the type changes.)

- [ ] **Step 3: Implement**

`packages/core/src/types/execution.ts` — apply this patch:

```diff
--- a/packages/core/src/types/execution.ts
+++ b/packages/core/src/types/execution.ts
@@ -36,8 +36,13 @@
 export type SkipReason = 'not_selected' | 'budget' | 'provider_disabled' | 'departed';
 /** A provider whose `cabins` excludes the definition's cabin: every cell no_data, no call. Spec §3. */
 export type NoDataReason = 'cabin-not-offered';
+/**
+ * Spec §5.4: step 1 returned options and none was priced. Its own reason (decision 37), so every reason-keyed reader sees
+ * it; never retried by a resume, automatic or manual (only a single-cell verification searches the cell again).
+ */
+export type NoPricedOptionsReason = 'no-priced-options';
 /** The vendor message goes to lastError, never to reason. Spec §3. */
-export type ErrorReason = ProviderErrorKind | NormalisationReason;
+export type ErrorReason = ProviderErrorKind | NormalisationReason | NoPricedOptionsReason;
 
 /** Spec §7 `cell_outcomes`: per (execution, cell, stage, provider). */
 export interface CellOutcome extends CellKey {
```

`packages/db/src/internal/enums.ts` — apply this patch:

```diff
--- a/packages/db/src/internal/enums.ts
+++ b/packages/db/src/internal/enums.ts
@@ -95,6 +95,7 @@
   'unmappable-carrier',
   'bad-local-time',
   'cell-mismatch',
+  'no-priced-options',
 ] as const);
 /** Spec §3: the reasons a no_data outcome written without a fetch may carry (markNoData). */
 export const NO_DATA_REASONS = exhaustive<NoDataReason>()(['cabin-not-offered'] as const);
```

`packages/db/src/repositories/cells.ts` — apply this patch:

```diff
--- a/packages/db/src/repositories/cells.ts
+++ b/packages/db/src/repositories/cells.ts
@@ -108,12 +108,16 @@
     throw new RowRejected('outcome-reason', `a not_run outcome carries no reason, got ${reason}`);
 }
 
-/** Spec §7 "Resume": reasons never retried automatically; a manual resume re-admits auth, quota, parse. */
+/**
+ * Spec §7 "Resume": reasons never retried automatically; a manual resume re-admits auth, quota, parse. `no-priced-options`
+ * (spec §5.4, decision 37) is never retried by either.
+ */
 const NON_RETRYABLE = [
   'auth',
   'quota',
   'parse',
   'no-return-legs',
+  'no-priced-options',
   'fx-unavailable',
   'currency-unsupported',
   'unknown-airport-tz',
```

`packages/engine/src/errors.ts` (new file):

```ts
import {
  AbortedError,
  BudgetExceeded,
  type ErrorReason,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  ProviderError,
  stripUrlsInText,
} from '@gmt/core';

/** Upstream errors whose `reason` names a non-retryable outcome of its own (spec §5.4, §7; decision 37). */
const KEPT_REASONS = ['no-return-legs', 'no-priced-options'] as const satisfies readonly ErrorReason[];

/** What the engine does with one failed tile or cell call (spec §8.1 error table, both stages). */
export type FailureDecision =
  | { kind: 'abort' }
  | { kind: 'cell-error'; reason: ErrorReason; lastError: string; parse: boolean; disableProvider: boolean }
  | { kind: 'limiter-timeout'; resumeAfter: IsoDateTime | null }
  | { kind: 'budget'; error: BudgetExceeded }
  | { kind: 'fatal'; message: string };

/** `at` plus `seconds`, minted through core's helper (the as* helpers are the only brand mint sites). */
export function addSeconds(at: IsoDateTime, seconds: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(at) + seconds * 1000);
}

/**
 * Pure classification. Order matters: an abort wins over whatever error it caused; a budget breach is never a cell
 * error (spec §8.1 "BudgetExceeded is never recorded as error").
 *
 * The stored `reason` is the error kind, except `no-return-legs` and `no-priced-options` (spec §5.4), each its own reason
 * in core's closed list (decision 37), which spec §7's resume query excludes by reason. The vendor's message goes to
 * `last_error`, URL-free (spec §3).
 */
export function classifyFailure(err: unknown, aborted: boolean, now: IsoDateTime): FailureDecision {
  if (err instanceof AbortedError || aborted) return { kind: 'abort' };
  if (err instanceof BudgetExceeded) return { kind: 'budget', error: err };
  if (err instanceof ProviderError) {
    // why: decision 15 — http-kit sets retryAfterSeconds on every limiter-timeout to the exhausted reservoir's refresh
    // (or the vendor's Retry-After); without it there is no known reopen time, so no one-shot job
    if (err.kind === 'limiter-timeout')
      return {
        kind: 'limiter-timeout',
        resumeAfter: err.retryAfterSeconds === undefined ? null : addSeconds(now, err.retryAfterSeconds),
      };
    const kept = err.kind === 'upstream' ? KEPT_REASONS.find((r) => r === err.reason) : undefined;
    return {
      kind: 'cell-error',
      reason: kept ?? err.kind,
      lastError: stripUrlsInText(err.message),
      parse: err.kind === 'parse',
      disableProvider: err.kind === 'auth' || err.kind === 'quota',
    };
  }
  return { kind: 'fatal', message: stripUrlsInText(err instanceof Error ? err.message : String(err)) };
}
```

`packages/engine/src/orchestrator.ts` — replace the file:

```ts
import { ACTIVE_STATUSES } from '@gmt/core';
import type { EngineContext } from './context.js';
import { createRegistry } from './registry.js';
import { resumeExecution } from './resume.js';
import { stopRun } from './run.js';
import { startExecution } from './start.js';
import type { StartResult } from './types.js';

/** The execution half of the Engine; createEngine (Task 7.19) adds estimates, scheduler, boot and status. */
export interface Orchestrator {
  start(
    definitionId: string,
    opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number },
  ): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  /** Spec §8.1 AbortedError row: cells in flight → not_run, status cancelled. False when there is nothing to cancel. */
  cancel(executionId: string): Promise<boolean>;
  /** Aborts every pass as SIGTERM (cells in flight → not_run, status interrupted) and waits for them. */
  shutdown(): Promise<void>;
  running(): string[];
}

export function createOrchestrator(ctx: EngineContext): Orchestrator {
  const reg = createRegistry(ctx.log);
  return {
    start: (id, opts) => startExecution(ctx, reg, id, opts),
    resume: (id, opts) => resumeExecution(ctx, reg, id, opts),
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
    shutdown: async () => {
      for (const run of reg.all()) stopRun(run, { kind: 'sigterm' });
      await reg.settleAll();
    },
    running: () => reg.all().map((r) => r.executionId),
  };
}
```

`packages/engine/src/run.ts` — the import block becomes:

```ts
import {
  type BudgetExceeded,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  type IsoDateTime,
  type Logger,
  type OperatorMessageKind,
  type ProviderId,
  type SkipReason,
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { classifyFailure } from './errors.js';
```

`packages/engine/src/run.ts` — replace or add these declarations:

```ts
/**
 * Cells of (stage, provider) this pass should fetch: the spec §7 resume query (which never returns `no-return-legs` or
 * `no-priced-options` errors, decision 37).
 */
export function runnableCells(
  ctx: EngineContext,
  run: RunState,
  stage: Stage,
  providerId: ProviderId,
): CellKey[] {
  if (run.disabled.has(providerId)) return [];
  return ctx.repos.cells.resumable(run.executionId, stage, providerId, run.manual);
}

/**
 * Applies the spec §8.1 error table to one failed tile (discovery) or cell (verification) call. The cells of the call
 * are `cells`; nothing has been written for them yet.
 */
export function onFailure(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  stage: Stage,
  cells: readonly CellKey[],
  err: unknown,
): void {
  const d = classifyFailure(err, run.controller.signal.aborted, ctx.clock.now());
  const log = run.log.child({ providerId });
  switch (d.kind) {
    case 'abort':
      return; // why: spec §3 "a cell interrupted mid-flight returns to not_run" — nothing was written, so it still is
    case 'cell-error': {
      if (stage === 'discovery')
        ctx.repos.cells.writeTileError(run.executionId, providerId, [...cells], d.reason, d.lastError);
      else {
        ctx.db.transaction(() => {
          for (const cell of cells)
            ctx.repos.cells.setOutcome(run.executionId, cell, stage, providerId, {
              status: 'error',
              reason: d.reason,
              lastError: d.lastError,
              incrementAttempts: true,
            });
        });
      }
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
      // Task 7.10 replaces this case with applyBudgetBreach (the per-scope rows of the table).
      stopRun(run, { kind: 'budget', error: d.error, resumeAfter: null });
      return;
    case 'fatal':
      log.error({ stage, err: d.message }, 'unexpected failure; pausing');
      stopRun(run, { kind: 'fatal', message: d.message });
      return;
  }
}

/**
 * Spec §8.1 "provider disabled for the run": its lanes stop taking cells; calls already in flight finish and are
 * written (decision 25); settleLane marks what is left skipped:provider_disabled once the pool drains.
 */
export function disableProvider(run: RunState, providerId: ProviderId, why: string): void {
  if (run.disabled.has(providerId)) return;
  run.disabled.add(providerId);
  for (const [key, lane] of run.lanes) if (key.endsWith(`|${providerId}`)) lane.intake.abort();
  run.notices.push({
    kind: 'provider_disabled',
    detail: `${providerId} was disabled for this run after ${why}; its remaining cells are skipped (provider disabled).`,
  });
  run.log.warn({ providerId, why }, 'provider disabled for the run');
}

/** After a lane's pool drains: a disabled provider's remaining cells become skipped:provider_disabled (spec §8.1). */
export function settleLane(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId): void {
  if (run.disabled.has(providerId)) markRemaining(ctx, run, stage, providerId, 'provider_disabled');
}
```

`packages/engine/src/stages/discovery.ts` — the import block becomes:

```ts
import {
  type CapabilityInfo,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type Iata,
  NormalisationError,
  ProviderError,
  type ProviderId,
  type TilePlan,
} from '@gmt/core';
import type { TileWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { normaliseCalendarPrice, type RepoDeps, reduceTile } from '../normalise.js';
import { runPool } from '../pool.js';
import { laneFor, onFailure, type RunState, runnableCells, settleLane, stopRun } from '../run.js';
```

`packages/engine/src/stages/discovery.ts` — replace or add these declarations:

```ts
async function runDiscoveryProvider(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
): Promise<void> {
  const cap = ctx.providers.get(providerId)?.discovery;
  if (cap === undefined) return;
  const cells = runnableCells(ctx, run, 'discovery', providerId);
  if (cells.length > 0) await fetchTiles(ctx, run, providerId, cap, cells);
  settleLane(ctx, run, 'discovery', providerId);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine exec vitest run errors error-table-discovery && pnpm --filter @gmt/db exec vitest run cells.noPricedOptions enums && pnpm --filter @gmt/core exec vitest run types/errorReason`
Expected: PASS, 34 engine tests (16 in `errors.test.ts`, 18 in `error-table-discovery.test.ts`), the db tests and the core type test.

- [ ] **Step 5: Commit**

```bash
git add packages/engine packages/core packages/db && git commit -m "wp07: discovery-stage error table, provider disable, limiter pause, cancel; no-priced-options is its own error reason

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.5: Calendar normalisation — FX, ECB currencies, one price per cell, `cellIssues`, `truncated`

**Files:**
- Create: `packages/engine/test/normalise-calendar.test.ts`; `packages/core/src/labels/truncated.ts`, `packages/core/test/labels/truncated.test.ts`, `packages/core/test/normalise/priceInGbp.test.ts`
- Modify: `packages/engine/src/normalise.ts` (`rateFor`, `calendarPriceInGbp`, `PriceRefusal`, `reduceTile`, `FX_SOURCE`), `src/stages/discovery.ts` (`commitTile`); `packages/core/src/normalise/money.ts` (`priceInGbp`, `RateLookup`), `src/normalise/itinerary.ts` (its money step calls `priceInGbp`), `src/index.ts`

**Interfaces:**
- Consumes: `FxRepo.latest/upsert`, `validateVendorUrl`, `CellIssue`, `DiscoveryTileResult.cellIssues/truncated` (decisions 28, 30), `RawCalendarPrice.providerObservedAt` (decision 35).
- Produces: `rateFor(deps, currency)` (the one FX lookup, also core's `NormaliseDeps.rateFor` in Task 7.8), `calendarPriceInGbp` returning the price or a `PriceRefusal`, `ReducedTile` with `'mixed-currency'`, `FX_SOURCE`, `commitTile` honouring `cellIssues` and `truncated`; core's `priceInGbp(amount, rateFor)` and `TRUNCATED_NOTE` (decision 37).

There is one money pipeline (arch-013, ruling 2, arch-r2-002): core's money step, exported here as `priceInGbp`, is what `normaliseOffer` runs for offers (Task 7.8) and what `calendarPriceInGbp` runs for a calendar price's bare amount, over the same `rateFor`: GBP passes through, an amount that is not a non-negative integer is a `RangeError`, outside the ECB list → `currency-unsupported`, no rate within `FX_MAX_RATE_AGE_DAYS` → `fx-unavailable`. The engine turns a `NormalisationError` into that cell's error and a `RangeError` into that cell's `parse` error, so one malformed vendor amount never stops the run as fatal. A row's `providerObservedAt` (for Travelpayouts, the day its link's `search_date` names; decision 35) is stored unchanged. A truncated tile's priced cells carry core's `TRUNCATED_NOTE` leading `last_error`, read back through `CellsRepo.outcomes`, the path WP8 maps to `truncated: true` (decisions 36, 37; prov-wp07-r2-002). A tile answers in one currency, so a tile's cells all convert or all fail; two currencies in one tile are a parse error for its cells. The mixed-currency test runs `commitTile` over cells still `not_run` (a held tile), because an error never displaces a priced cell; over a priced cell it only counts an attempt (ssr-02).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/labels/truncated.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';
import { TRUNCATED_NOTE } from '../../src/labels/truncated.js';

describe('TRUNCATED_NOTE (decisions 30, 36, 37)', () => {
  it('is the exact label the engine writes and WP8 matches, exported from the barrel', () => {
    expect(TRUNCATED_NOTE).toBe('cheapest of the rows read');
    expect(core.TRUNCATED_NOTE).toBe(TRUNCATED_NOTE);
  });
});
```

`packages/core/test/normalise/priceInGbp.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { priceInGbp, type RateLookup } from '../../src/normalise/money.js';
import { asIsoDate } from '../../src/types/ids.js';

const USD_NANO = 787_401_575; // 1 / 1.27 GBP per USD × 1e9
const rateDate = asIsoDate('2026-10-14');
const usdOnly: RateLookup = (c) => (c === 'USD' ? { rateNano: USD_NANO, rateDate, source: 'ecb' } : null);
const reasonOf = (f: () => unknown): string => {
  try {
    f();
  } catch (err) {
    if (err instanceof NormalisationError) return err.reason;
    throw err;
  }
  throw new Error('expected a NormalisationError');
};

describe('priceInGbp (spec §5.6, §6.3; arch-r2-002)', () => {
  it('GBP passes through unconverted, whatever its case, and never asks for a rate', () => {
    const asked: string[] = [];
    const rateFor: RateLookup = (c) => {
      asked.push(c);
      return null;
    };
    expect(priceInGbp({ amountMinor: 41_200, currency: 'gbp' }, rateFor)).toEqual({
      pricePence: 41_200,
      fx: { converted: false },
    });
    expect(asked).toEqual([]);
  });
  it('an ECB currency with a rate converts half-up and records rate, date and source together', () => {
    expect(priceInGbp({ amountMinor: 52_000, currency: 'usd' }, usdOnly)).toEqual({
      pricePence: 40_945,
      fx: { converted: true, rateNano: USD_NANO, rateDate, source: 'ecb' },
    });
  });
  it('asks for the rate by the upper-cased code; no rate → fx-unavailable; outside the ECB list → currency-unsupported', () => {
    const asked: string[] = [];
    const none: RateLookup = (c) => {
      asked.push(c);
      return null;
    };
    expect(reasonOf(() => priceInGbp({ amountMinor: 1, currency: 'eur' }, none))).toBe('fx-unavailable');
    expect(asked).toEqual(['EUR']);
    expect(reasonOf(() => priceInGbp({ amountMinor: 1, currency: 'ARS' }, usdOnly))).toBe(
      'currency-unsupported',
    );
  });
  it('an amount that is not a non-negative integer is a RangeError, in GBP as in any other currency', () => {
    expect(() => priceInGbp({ amountMinor: -1, currency: 'GBP' }, usdOnly)).toThrow(RangeError);
    expect(() => priceInGbp({ amountMinor: 12.5, currency: 'GBP' }, usdOnly)).toThrow(RangeError);
    expect(() => priceInGbp({ amountMinor: -1, currency: 'USD' }, usdOnly)).toThrow(RangeError);
  });
});
```

`packages/engine/test/normalise-calendar.test.ts` (new file):

```ts
import { asIsoDate, asIsoDateTime, cellKeyString, type RawCalendarPrice, TRUNCATED_NOTE } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { calendarPriceInGbp, FX_SOURCE, reduceTile, vendorLinkOf } from '../src/normalise.js';
import { newRun } from '../src/run.js';
import { commitTile, normaliseDeps } from '../src/stages/discovery.js';
import { createHarness, discoveryOf, FIXTURE_RULES, type Harness, JFK, LHR } from './support/harness.js';
import { mapPrices, mapTiles } from './support/wrappers.js';

const USD_NANO = 787_401_575; // 1 / 1.27 GBP per USD × 1e9
const cell = {
  origin: LHR,
  destination: JFK,
  departureDate: asIsoDate('2026-11-02'),
  returnDate: asIsoDate('2026-11-09'),
};
const price = (amountMinor: number, currency = 'GBP'): RawCalendarPrice => ({
  ...cell,
  amountMinor,
  currency,
});
const deps = (h: Harness) => normaliseDeps(buildContext(h.deps, h.options));
const reasonOf = (r: ReturnType<typeof calendarPriceInGbp>): string => {
  if (!('reason' in r)) throw new Error('expected a refusal');
  return r.reason;
};

describe('calendarPriceInGbp (spec §5.6 money, §6.3)', () => {
  it('GBP passes through unconverted', () => {
    const h = createHarness();
    expect(calendarPriceInGbp(deps(h), 41_200, 'gbp')).toEqual({
      pricePence: 41_200,
      fx: { converted: false },
    });
  });
  it('an ECB currency with a fresh rate converts and records rate, date and source together (52 000 US cents → 40 945 pence)', () => {
    const h = createHarness();
    h.repos.fx.upsert([
      { date: h.clock.todayLondon(), currency: 'USD', rateNano: USD_NANO, source: FX_SOURCE },
    ]);
    expect(calendarPriceInGbp(deps(h), 52_000, 'USD')).toEqual({
      pricePence: 40_945,
      fx: { converted: true, rateNano: USD_NANO, rateDate: h.clock.todayLondon(), source: FX_SOURCE },
    });
  });
  it('FX_MAX_RATE_AGE_DAYS 3: a 3-day-old rate converts; a 4-day-old or a future-dated one is fx-unavailable', () => {
    const h = createHarness(); // today (London) 2026-10-14
    h.repos.fx.upsert([
      { date: asIsoDate('2026-10-11'), currency: 'USD', rateNano: USD_NANO, source: FX_SOURCE },
    ]);
    expect(calendarPriceInGbp(deps(h), 52_000, 'USD')).toMatchObject({ pricePence: 40_945 });
    h.repos.fx.upsert([
      { date: asIsoDate('2026-10-10'), currency: 'EUR', rateNano: 860_000_000, source: FX_SOURCE },
      { date: asIsoDate('2026-10-15'), currency: 'CAD', rateNano: 540_000_000, source: FX_SOURCE },
    ]);
    expect(reasonOf(calendarPriceInGbp(deps(h), 52_000, 'EUR'))).toBe('fx-unavailable');
    expect(reasonOf(calendarPriceInGbp(deps(h), 52_000, 'CAD'))).toBe('fx-unavailable');
  });
  it('a currency outside the ECB list → currency-unsupported', () => {
    const h = createHarness();
    expect(reasonOf(calendarPriceInGbp(deps(h), 52_000, 'ARS'))).toBe('currency-unsupported');
  });
  it('an amount that is not a non-negative integer → parse, in GBP too; never a stored price (arch-r2-002)', () => {
    const h = createHarness();
    expect(reasonOf(calendarPriceInGbp(deps(h), -100, 'GBP'))).toBe('parse');
    expect(reasonOf(calendarPriceInGbp(deps(h), 99.5, 'GBP'))).toBe('parse');
  });
});

describe('reduceTile (spec §5.6 "one calendar price per tile … minimum amountMinor, tie-break on vendor order")', () => {
  it('keeps the minimum, keeps the earlier of equal prices, and counts discards', () => {
    const a = price(500);
    const b = price(400);
    const c = { ...price(400), vendorLink: 'later' };
    const r = reduceTile([a, b, c]);
    if (r.kind !== 'ok') throw new Error('expected one currency');
    expect(r.discarded).toBe(2);
    expect(r.perCell.get(cellKeyString(cell))).toBe(b);
  });
  it('two currencies in one tile is reported, not reduced', () => {
    expect(reduceTile([price(500, 'GBP'), price(600, 'usd')])).toEqual({
      kind: 'mixed-currency',
      currencies: ['GBP', 'USD'],
    });
  });
});

describe('vendorLinkOf (spec §5.2 vendor links)', () => {
  it('keeps only https links on the provider allowlist (core LINK_ALLOWLIST)', () => {
    expect(vendorLinkOf('https://www.aviasales.com/search/LHR0211JFK09111', 'travelpayouts')).toBe(
      'https://www.aviasales.com/search/LHR0211JFK09111',
    );
    expect(vendorLinkOf('http://www.aviasales.com/x', 'travelpayouts')).toBeNull();
    expect(vendorLinkOf('https://evil.example/x', 'travelpayouts')).toBeNull();
    expect(vendorLinkOf('https://www.aviasales.com/x', 'fixture')).toBeNull(); // the fixture's allowlist is empty
    expect(vendorLinkOf(undefined, 'searchapi')).toBeNull();
  });
});

describe('discovery normalisation through the engine', () => {
  it('every price in USD with no rate → each priced cell becomes error fx-unavailable through writeTileError; no price row; the run completes, never paused (po-009)', async () => {
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(errors).toHaveLength(28);
    expect(errors.every((o) => o.reason === 'fx-unavailable' && o.attempts === 1)).toBe(true);
    expect(h.count('calendar_prices', e.id)).toBe(0);
  });

  it('with a fresh USD rate the same prices are stored converted, with fx columns set together', async () => {
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    h.repos.fx.upsert([
      { date: h.clock.todayLondon(), currency: 'USD', rateNano: USD_NANO, source: FX_SOURCE },
    ]);
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    const rows = h.repos.calendarPrices.fetchedBy(e.id);
    expect(rows).toHaveLength(28);
    // why: an independent figure — the fixture formula (base 41 200 + 7 nights × 900) makes the cheapest cell 47 500 cents
    expect(Math.min(...rows.map((r) => r.priceNativeMinor))).toBe(47_500);
    expect(Math.min(...rows.map((r) => r.pricePence))).toBe(37_402);
    for (const row of rows) {
      expect(row).toMatchObject({
        currencyNative: 'USD',
        fx: { converted: true, rateNano: USD_NANO, rateDate: h.clock.todayLondon(), source: FX_SOURCE },
      });
    }
    expect(h.outcomes(e.id, { status: 'priced' }).every((o) => o.minPence !== null)).toBe(true);
  });

  it('a negative amount fails only its own cell (parse), never pauses the run (arch-r2-002)', async () => {
    const h = createHarness({
      transformFixture: (p) =>
        mapPrices(p, (x) => (cellKeyString(x) === cellKeyString(cell) ? { ...x, amountMinor: -1 } : x)),
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    expect(e.status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'error' })).toEqual([
      expect.objectContaining({ ...cell, reason: 'parse', attempts: 1 }),
    ]);
    expect(h.count('calendar_prices', e.id)).toBe(27);
  });

  it("a row's providerObservedAt (decision 35: the day Aviasales found the fare) reaches calendar_prices unchanged", async () => {
    const found = asIsoDateTime('2026-10-09T00:00:00.000Z');
    const h = createHarness({
      transformFixture: (p) => mapPrices(p, (x) => ({ ...x, providerObservedAt: found })),
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    const rows = h.repos.calendarPrices.fetchedBy(e.id);
    expect(rows).toHaveLength(28);
    expect(
      rows.every((r) => r.providerObservedAt === found && r.provenance.providerObservedAt === found),
    ).toBe(true);
  });

  it('a currency outside the ECB list → error currency-unsupported', async () => {
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'ARS' })) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(errors).toHaveLength(28);
    expect(errors.every((o) => o.reason === 'currency-unsupported')).toBe(true);
  });

  it('a tile mixing two currencies is a parse error for its cells; over an already-priced cell it only counts an attempt (ssr-02)', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const ctx = buildContext(h.deps, h.options);
    const r = await h.orch().start(h.createDefinition().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    // why: both tiles must be held before the release, or a tile requested after it would wait forever
    await vi.waitFor(() => expect(h.requests.filter((q) => q.kind === 'calendar')).toHaveLength(2));
    const exec = h.repos.executions.get(r.executionId);
    if (exec === null) throw new Error('missing execution');
    const mixed = {
      kind: 'tile' as const,
      index: 0,
      coveredCells: [cell],
      fetchedAt: h.clock.now(),
      pointOfSale: 'unknown',
      prices: [price(500, 'GBP'), price(600, 'USD')],
      noFares: [],
      notes: [],
    };
    commitTile(
      ctx,
      newRun(ctx, exec, { manual: true, fresh: false, blocked: new Set() }),
      'fixture',
      discoveryOf(h.fixture).info,
      mixed,
    );
    const before = h
      .outcomes(r.executionId, { stage: 'discovery' })
      .find((x) => cellKeyString(x) === cellKeyString(cell));
    expect(before).toMatchObject({ status: 'error', reason: 'parse', attempts: 1 });
    expect(before?.lastError).toContain('mixed currencies: GBP, USD');
    await h.releaseHolds();
    const done = await h.waitForSettled(r.executionId);
    expect(h.outcomes(done.id).find((x) => cellKeyString(x) === cellKeyString(cell))).toMatchObject({
      status: 'priced',
      attempts: 1,
    });
    commitTile(
      ctx,
      newRun(ctx, done, { manual: true, fresh: false, blocked: new Set() }),
      'fixture',
      discoveryOf(h.fixture).info,
      mixed,
    );
    // why: an error never displaces a stronger outcome; it only counts a failed attempt (decision 17, WP3 merge)
    expect(h.outcomes(done.id).find((x) => cellKeyString(x) === cellKeyString(cell))).toMatchObject({
      status: 'priced',
      attempts: 2,
    });
  });

  it('cellIssues (decision 28): dropped rows beside a price stay priced with offers-dropped:n; a cell with no price is an error, never no_data', async () => {
    const days = {
      window: { kind: 'absolute' as const, from: cell.departureDate, to: cell.departureDate },
      minNights: 7,
      maxNights: 9,
    };
    const nine = { ...cell, returnDate: asIsoDate('2026-11-11') };
    const eight = { ...cell, returnDate: asIsoDate('2026-11-10') };
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind !== 'tile'
            ? r
            : {
                ...r,
                // why: the adapter dropped the 8-night row and never read the 9-night one; it kept the 7-night price
                prices: r.prices.filter((x) => cellKeyString(x) === cellKeyString(cell)),
                cellIssues: [
                  { cell, reason: 'parse', offersDropped: 2, detail: 'two rows without a price' },
                  { cell: eight, reason: 'parse', offersDropped: 1, detail: 'a row without a price' },
                  { cell: nine, reason: 'upstream', offersDropped: 0, detail: 'left unread by the page cap' },
                ],
              },
        ),
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition(days).id);
    expect(e.status).toBe('completed');
    const byCell = new Map(h.outcomes(e.id).map((o) => [cellKeyString(o), o]));
    expect(byCell.get(cellKeyString(cell))).toMatchObject({ status: 'priced', reason: 'offers-dropped:2' });
    expect(byCell.get(cellKeyString(eight))).toMatchObject({
      status: 'error',
      reason: 'parse',
      lastError: 'a row without a price',
    });
    expect(byCell.get(cellKeyString(nine))).toMatchObject({
      status: 'error',
      reason: 'upstream',
      lastError: 'left unread by the page cap',
    });
    expect(h.count('calendar_prices', e.id)).toBe(1);
  });

  it('a truncated tile (decision 30): its prices are labelled "cheapest of the rows read"; its unread cells are upstream errors', async () => {
    const eight = { ...cell, returnDate: asIsoDate('2026-11-10') };
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind !== 'tile'
            ? r
            : {
                ...r,
                truncated: true,
                prices: r.prices.filter((x) => cellKeyString(x) === cellKeyString(cell)),
                cellIssues: [
                  {
                    cell: eight,
                    reason: 'upstream',
                    offersDropped: 0,
                    detail: 'left unread by the page cap',
                  },
                ],
              },
        ),
    });
    const e = await h.runToCompletion(
      h.orch(),
      h.createDefinition({ window: { kind: 'absolute', from: cell.departureDate, to: cell.departureDate } })
        .id,
    );
    const byCell = new Map(h.outcomes(e.id).map((o) => [cellKeyString(o), o]));
    expect(byCell.get(cellKeyString(cell))).toMatchObject({
      status: 'priced',
      reason: null,
      lastError: 'cheapest of the rows read',
    });
    // why: WP8 reads outcomes through this repository and maps a last_error starting with core's TRUNCATED_NOTE to
    // `truncated` (decisions 36, 37), so the label must lead the column read back there
    const read = h.repos.cells.outcomes(e.id, { stage: 'discovery', cells: [cell] });
    expect(read).toHaveLength(1);
    expect(read[0]?.lastError?.startsWith(TRUNCATED_NOTE)).toBe(true);
    expect(byCell.get(cellKeyString(eight))).toMatchObject({
      status: 'error',
      reason: 'upstream',
      lastError: 'left unread by the page cap',
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine exec vitest run normalise-calendar && pnpm --filter @gmt/core exec vitest run labels/truncated normalise/priceInGbp`
Expected: FAIL: the core tests fail with `priceInGbp is not a function` (4) and `Cannot find module '../../src/labels/truncated.js'`; in the engine 10 of 16 fail: the ECB-currency tests with `Cannot read properties of undefined (reading 'length')` (`rateFor` and `FX_SOURCE` are not exported yet), the mixed-currency test with `expected { kind: 'ok', … } to deeply equal { kind: 'mixed-currency', … }`, the negative-amount run with `expected 'paused_error' to be 'completed'` (a `RangeError` escapes as fatal), and the `cellIssues` and truncated tests with `reason: null` and `lastError: null` where `offers-dropped:2` and the label are expected.

- [ ] **Step 3: Implement**

`packages/core/src/index.ts` — apply this patch:

```diff
--- a/packages/core/src/index.ts
+++ b/packages/core/src/index.ts
@@ -29,11 +29,12 @@
 export * from './dates/epochDay.js';
 export * from './errors.js';
 export * from './labels/age.js';
+export { TRUNCATED_NOTE } from './labels/truncated.js';
 export { canonicalCarrier, canonicalFlightNumber } from './normalise/carrier.js';
 export { itineraryHash } from './normalise/hashing.js';
 export { type NormaliseDeps, normaliseOffer } from './normalise/itinerary.js';
 export { departLocal } from './normalise/localTime.js';
-export { ECB_CURRENCIES, MINOR_EXPONENT, toGbp } from './normalise/money.js';
+export { ECB_CURRENCIES, MINOR_EXPONENT, priceInGbp, type RateLookup, toGbp } from './normalise/money.js';
 export { toIsoDateTime } from './normalise/timestamps.js';
 export { LINK_ALLOWLIST, validateVendorUrl } from './normalise/vendorUrl.js';
 export * from './ports/budget.js';
```

`packages/core/src/labels/truncated.ts` (new file):

```ts
/**
 * Decision 30, 37: the label on a price from a discovery tile the pagination cap stopped before its last page. The
 * engine writes it leading the priced cell outcome's `last_error`; WP8 maps an outcome whose `last_error` starts with
 * it to `truncated: true` (decision 36), which the UI renders with this text.
 */
export const TRUNCATED_NOTE = 'cheapest of the rows read';
```

`packages/core/src/normalise/itinerary.ts` — apply this patch:

```diff
--- a/packages/core/src/normalise/itinerary.ts
+++ b/packages/core/src/normalise/itinerary.ts
@@ -16,7 +16,7 @@
 import { canonicalCarrier, canonicalFlightNumber } from './carrier.js';
 import { itineraryHash } from './hashing.js';
 import { localMinute, requireZone, vendorInstant, wallToInstant } from './localTime.js';
-import { ECB_CURRENCIES, toGbp } from './money.js';
+import { priceInGbp } from './money.js';
 import { LINK_ALLOWLIST, validateVendorUrl } from './vendorUrl.js';
 
 /** What the pure normaliser needs from the engine (which reads the airports and FX repositories). */
@@ -133,16 +133,9 @@
   return Math.round((lastOf(direction).arriveMs - direction[0].departMs) / MINUTE_MS);
 }
 
+// why: arch-r2-002 — the money step is priceInGbp, shared with the engine's calendar prices, so the two cannot diverge
 function money(raw: RawOffer, deps: NormaliseDeps): { pricePence: number; fx: FxInfo } {
-  const currency = raw.currency.toUpperCase();
-  if (currency === 'GBP') return { pricePence: toGbp(raw.amountMinor, 'GBP', 1), fx: { converted: false } };
-  if (!ECB_CURRENCIES.includes(currency)) throw new NormalisationError('currency-unsupported', currency);
-  const rate = deps.rateFor(currency);
-  if (rate === null) throw new NormalisationError('fx-unavailable', currency);
-  return {
-    pricePence: toGbp(raw.amountMinor, currency, rate.rateNano),
-    fx: { converted: true, rateNano: rate.rateNano, rateDate: rate.rateDate, source: rate.source },
-  };
+  return priceInGbp(raw, (currency) => deps.rateFor(currency));
 }
 
 /**
```

`packages/core/src/normalise/money.ts` — apply this patch:

```diff
--- a/packages/core/src/normalise/money.ts
+++ b/packages/core/src/normalise/money.ts
@@ -1,4 +1,6 @@
 import { NormalisationError } from '../errors.js';
+import type { IsoDate } from '../types/ids.js';
+import type { FxInfo } from '../types/provenance.js';
 
 /**
  * The currencies frankfurter (ECB reference rates) publishes, read from
@@ -74,3 +76,29 @@
   if (pence > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`converted amount too large: ${pence}`);
   return Number(pence);
 }
+
+/** A rate already checked against `FX_MAX_RATE_AGE_DAYS` by the caller, or null (spec §5.6). */
+export type RateLookup = (currency: string) => { rateNano: number; rateDate: IsoDate; source: string } | null;
+
+/**
+ * Spec §5.6 money, the one step shared by offers (normaliseOffer) and calendar prices (the engine): GBP passes through
+ * unconverted; any other currency must be ECB-covered and have a rate from `rateFor`, converted by toGbp with rate,
+ * date and source recorded together. Currency codes are compared upper-cased. Throws NormalisationError
+ * (`currency-unsupported`, `fx-unavailable`) or, from toGbp, RangeError for an amount that is not a non-negative
+ * integer — never a guessed price.
+ */
+export function priceInGbp(
+  amount: { amountMinor: number; currency: string },
+  rateFor: RateLookup,
+): { pricePence: number; fx: FxInfo } {
+  const currency = amount.currency.toUpperCase();
+  if (currency === 'GBP')
+    return { pricePence: toGbp(amount.amountMinor, 'GBP', 1), fx: { converted: false } };
+  if (!ECB_CURRENCIES.includes(currency)) throw new NormalisationError('currency-unsupported', currency);
+  const rate = rateFor(currency);
+  if (rate === null) throw new NormalisationError('fx-unavailable', currency);
+  return {
+    pricePence: toGbp(amount.amountMinor, currency, rate.rateNano),
+    fx: { converted: true, rateNano: rate.rateNano, rateDate: rate.rateDate, source: rate.source },
+  };
+}
```

`packages/engine/src/normalise.ts` — replace the file:

```ts
import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  cellKeyString,
  type ErrorReason,
  type FxInfo,
  type IsoDate,
  type IsoDateTime,
  LINK_ALLOWLIST,
  NormalisationError,
  type PointOfSale,
  type ProviderId,
  priceInGbp,
  type RawCalendarPrice,
  stripUrlsInText,
  validateVendorUrl,
} from '@gmt/core';
import type { AirportsRepo, CalendarPriceInsert, FxRepo } from '@gmt/db';

/** The repositories and settings normalisation reads (core's own NormaliseDeps is the pure function's input). */
export interface RepoDeps {
  airports: AirportsRepo;
  fx: FxRepo;
  clock: Clock;
  fxMaxRateAgeDays: number;
}

/** The source name src/fx/refresh.ts stores with every rate; prices carry the source of the rate they used. */
export const FX_SOURCE = 'frankfurter.dev (ECB reference rates)';

/**
 * The newest ECB rate no older than FX_MAX_RATE_AGE_DAYS, in the shape core's NormaliseDeps.rateFor asks for: the one
 * FX lookup shared by calendar prices and offers (spec §5.6).
 */
export function rateFor(
  deps: RepoDeps,
  currency: string,
): { rateNano: number; rateDate: IsoDate; source: string } | null {
  const r = deps.fx.latest(currency.toUpperCase(), deps.fxMaxRateAgeDays, deps.clock.todayLondon());
  return r === null ? null : { rateNano: r.rateNano, rateDate: r.date, source: r.source };
}

/** Why one calendar price is not stored: a normalisation reason, or `parse` for a malformed amount. */
export interface PriceRefusal {
  reason: ErrorReason;
  message: string;
}

/**
 * Spec §5.6 money for one calendar price: core's priceInGbp (the same step normaliseOffer uses) over the shared
 * rateFor, so calendar prices and offers cannot diverge (arch-r2-002). A NormalisationError is that cell's error; a
 * RangeError (an amount that is not a non-negative integer) is one malformed vendor row, so that cell's `parse` error,
 * never a fatal stop of the run.
 */
export function calendarPriceInGbp(
  deps: RepoDeps,
  amountMinor: number,
  currency: string,
): { pricePence: number; fx: FxInfo } | PriceRefusal {
  try {
    return priceInGbp({ amountMinor, currency }, (c) => rateFor(deps, c));
  } catch (err) {
    if (err instanceof NormalisationError)
      return {
        reason: err.reason,
        message:
          err.reason === 'fx-unavailable'
            ? `${err.message}: no ECB rate in the last ${deps.fxMaxRateAgeDays} days`
            : err.message,
      };
    if (err instanceof RangeError) return { reason: 'parse', message: stripUrlsInText(err.message) };
    throw err;
  }
}

export type ReducedTile =
  | { kind: 'ok'; perCell: Map<string, RawCalendarPrice>; discarded: number }
  | { kind: 'mixed-currency'; currencies: string[] };

/**
 * Spec §5.6: one calendar price per (provider, cell) per tile — the minimum amountMinor, ties to vendor order; discards
 * counted. amountMinor is only comparable within one currency, and a vendor answers one request in one currency
 * (spec §2), so a tile with two currencies is reported instead.
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

/** A validated `https:` vendor link on the provider's allowlist (core LINK_ALLOWLIST), else null (spec §5.2). Validated links keep their query (spec rev 10). */
export function vendorLinkOf(url: string | undefined, providerId: ProviderId): string | null {
  if (url === undefined) return null;
  const b = validateVendorUrl(url, LINK_ALLOWLIST[providerId]);
  return b.kind === 'get' ? b.url : null;
}

export interface CalendarContext {
  providerId: ProviderId;
  info: CapabilityInfo;
  cabin: Cabin;
  pointOfSale: PointOfSale;
  fetchedAt: IsoDateTime;
}

/** One raw calendar price → one calendar_prices insert with full provenance, or the reason it cannot be stored. Spec §5.6, §7. */
export function normaliseCalendarPrice(
  raw: RawCalendarPrice,
  c: CalendarContext,
  deps: RepoDeps,
): CalendarPriceInsert | PriceRefusal {
  const m = calendarPriceInGbp(deps, raw.amountMinor, raw.currency);
  if ('reason' in m) return m;
  return {
    providerId: c.providerId,
    sourceKind: c.info.sourceKind,
    cabin: c.cabin,
    cell: {
      origin: raw.origin,
      destination: raw.destination,
      departureDate: raw.departureDate,
      returnDate: raw.returnDate,
    },
    pricePence: m.pricePence,
    priceNativeMinor: raw.amountMinor,
    currencyNative: raw.currency.toUpperCase(),
    fx: m.fx,
    pointOfSale: c.pointOfSale,
    fetchedAt: c.fetchedAt,
    providerObservedAt: raw.providerObservedAt ?? null,
    // why: spec §7 "max_age_hours NULL means unknown and is written explicitly"
    maxAgeHours: c.info.maxAgeHours === 'unknown' ? null : c.info.maxAgeHours,
    vendorLink: vendorLinkOf(raw.vendorLink, c.providerId),
    reusedFromExecutionId: null,
  };
}
```

`packages/engine/src/stages/discovery.ts` — the import block becomes:

```ts
import {
  type CapabilityInfo,
  type CellIssue,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type Iata,
  ProviderError,
  type ProviderId,
  type TilePlan,
  TRUNCATED_NOTE,
} from '@gmt/core';
import type { TileWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { normaliseCalendarPrice, type RepoDeps, reduceTile } from '../normalise.js';
import { runPool } from '../pool.js';
import { laneFor, onFailure, type RunState, runnableCells, settleLane, stopRun } from '../run.js';
```

`packages/engine/src/stages/discovery.ts` — replace or add these declarations:

```ts
/**
 * Writes one tile atomically (spec §7 "each tile's prices, outcomes and roll-ups"). Per covered cell:
 * - a price that normalises → `priced` (reason `offers-dropped:n` when the adapter also reported rows it dropped for
 *   that cell in `cellIssues`, decision 28; last_error "cheapest of the rows read" when the tile is `truncated`,
 *   decision 30);
 * - a price that cannot be normalised → `error` with the normalisation reason;
 * - no price but a `cellIssues` entry (rows dropped or a cell left unread) → `error` with the issue's reason and detail,
 *   never `no_data` (spec §8.1);
 * - in noFares → `empty`; otherwise → `no_data` (not evidence of no flights).
 * Errors go through writeTileError in the same transaction (WP3's writeTile takes only priced, empty and no_data;
 * po-009). The repository resets auto_resume_count in it.
 */
export function commitTile(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  info: CapabilityInfo,
  result: Extract<DiscoveryTileResult, { kind: 'tile' }>,
): void {
  const reduced = reduceTile(result.prices);
  if (reduced.kind === 'mixed-currency') {
    // why: two currencies in one response means it was misread; treat it as the vendor-shape error it is
    const err = new ProviderError({
      kind: 'parse',
      retryable: false,
      providerId,
      message: `tile ${result.index} mixed currencies: ${reduced.currencies.join(', ')}`,
    });
    onFailure(ctx, run, providerId, 'discovery', result.coveredCells, err);
    return;
  }
  const pointOfSale = result.pointOfSale; // why: spec rev 10 — the adapter states the point of sale of what it fetched
  const noFares = new Set(result.noFares.map(cellKeyString));
  const issues = new Map<string, CellIssue>();
  for (const i of result.cellIssues ?? []) {
    const key = cellKeyString(i.cell);
    const seen = issues.get(key);
    issues.set(
      key,
      seen === undefined ? i : { ...seen, offersDropped: seen.offersDropped + i.offersDropped },
    );
  }
  const write: TileWrite = {
    tileIndex: result.index,
    cells: [],
    prices: [],
    outcomes: [],
    discards: reduced.discarded,
  };
  const failed = new Map<string, { reason: string; lastError: string; cells: CellKey[] }>();
  const fail = (cell: CellKey, reason: string, lastError: string): void => {
    const group = failed.get(`${reason}\n${lastError}`) ?? { reason, lastError, cells: [] };
    group.cells.push(cell);
    failed.set(`${reason}\n${lastError}`, group);
  };
  for (const cell of result.coveredCells) {
    const key = cellKeyString(cell);
    const base = {
      origin: cell.origin,
      destination: cell.destination,
      departureDate: cell.departureDate,
      returnDate: cell.returnDate,
      fetchedAt: result.fetchedAt,
      cabin: run.snapshot.cabin,
      pointOfSale,
      sourceKind: info.sourceKind,
    };
    const raw = reduced.perCell.get(key);
    const issue = issues.get(key);
    if (raw !== undefined) {
      const price = normaliseCalendarPrice(
        raw,
        { providerId, info, cabin: run.snapshot.cabin, pointOfSale, fetchedAt: result.fetchedAt },
        normaliseDeps(ctx),
      );
      if ('reason' in price) {
        fail(cell, price.reason, price.message);
        continue;
      }
      const dropped = issue?.offersDropped ?? 0;
      // why: decision 30 — a truncated tile's price is the cheapest of the rows read, said on the cell (no new reason)
      const notes = [
        ...(result.truncated === true ? [TRUNCATED_NOTE] : []),
        ...(issue === undefined ? [] : [issue.detail]),
      ];
      write.prices.push(price);
      write.outcomes.push({
        ...base,
        status: 'priced',
        reason: dropped > 0 ? `offers-dropped:${dropped}` : null,
        lastError: notes.length > 0 ? notes.join('; ') : null,
        minPence: price.pricePence,
      });
    } else if (issue !== undefined) {
      fail(cell, issue.reason, issue.detail);
      continue;
    } else if (noFares.has(key))
      write.outcomes.push({ ...base, status: 'empty', reason: null, lastError: null, minPence: null });
    else write.outcomes.push({ ...base, status: 'no_data', reason: null, lastError: null, minPence: null });
    write.cells.push(cell);
  }
  ctx.db.transaction(() => {
    if (write.cells.length > 0) ctx.repos.cells.writeTile(run.executionId, providerId, write);
    for (const g of failed.values())
      ctx.repos.cells.writeTileError(run.executionId, providerId, g.cells, g.reason, g.lastError);
  });
  run.parseStreak.set(providerId, 0);
  if (reduced.discarded > 0 || result.notes.length > 0 || failed.size > 0) {
    run.log.child({ providerId }).debug(
      {
        tileIndex: result.index,
        discarded: reduced.discarded,
        notes: result.notes,
        cellErrors: [...failed.values()].map((g) => g.reason),
      },
      'discovery: tile reduced',
    );
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine exec vitest run normalise-calendar && pnpm --filter @gmt/core test`
Expected: PASS, 16 engine tests; core's suite green at its 100% thresholds (the money step's old tests in `normalise/itinerary.test.ts` pass unchanged through `priceInGbp`).

- [ ] **Step 5: Commit**

```bash
git add packages/engine packages/core && git commit -m "wp07: calendar normalisation through core's priceInGbp, cellIssues and truncated tiles labelled with TRUNCATED_NOTE, one price per cell

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.6: FX refresh through http-kit (`fx`, never ledgered)

**Files:**
- Create: `packages/engine/src/fx/refresh.ts`, `test/fx-refresh.test.ts`, `test/support/fx.ts`

**Interfaces:**
- Consumes: `HttpKit.request` with `providerId: 'fx'` (never ledgered), `FxRepo.upsert`, `ECB_CURRENCIES`, `isoDateSchema`, zod.
- Produces: `FRANKFURTER_LATEST_URL`, `parseFrankfurter(body)` (a zod schema, no casts), `refreshFx(ctx, signal): Promise<{ date: IsoDate; stored: number }>`; the test helper `stubFrankfurter`.

The failure tests answer 301, 429, 503 and a network error and assert a `ProviderError`, the old rates untouched and nothing ledgered; the URL is pinned as a literal (test-strategy-reviewer-018).

- [ ] **Step 1: Write the failing test**

`packages/engine/test/fx-refresh.test.ts` (new file):

```ts
import { asIsoDate, ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { fxHttpLimits } from '../src/fx/limits.js';
import { FRANKFURTER_LATEST_URL, parseFrankfurter, refreshFx } from '../src/fx/refresh.js';
import { FX_SOURCE } from '../src/normalise.js';
import { frankfurterBody, stubFrankfurter } from './support/fx.js';
import { createHarness } from './support/harness.js';
import { mapPrices } from './support/wrappers.js';

const body = frankfurterBody({ USD: 1.27, JPY: 190.5, XAU: 0.0004 });

describe('FX refresh (spec §5.3 "FX refresh goes through http-kit under the id fx", §5.6)', () => {
  it('calls the .dev/v1 URL on the only host the fx limits allow (plan decisions 2, 32)', () => {
    expect(FRANKFURTER_LATEST_URL).toBe('https://api.frankfurter.dev/v1/latest?from=GBP');
    expect(fxHttpLimits({ maxWaitSeconds: 60, requestTimeoutSeconds: 10 })).toMatchObject({
      hosts: ['api.frankfurter.dev'],
      billable: 'never',
      costPerCallMicroGbp: 0,
    });
  });

  it('fetches the latest GBP rates through http-kit, stores GBP-per-unit × 1e9 for ECB currencies only, never ledgered', async () => {
    const h = createHarness();
    const stub = stubFrankfurter(() => Response.json(body));
    const r = await refreshFx(buildContext(h.deps, h.options), new AbortController().signal);
    expect(r).toEqual({ date: '2026-10-14', stored: 2 });
    expect(stub.urls).toEqual(['https://api.frankfurter.dev/v1/latest?from=GBP']);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'USD')).toBe(787_401_575);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'JPY')).toBe(5_249_344);
    expect(h.repos.fx.rateNano(asIsoDate('2026-10-14'), 'XAU')).toBeNull();
    expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())?.source).toBe(FX_SOURCE);
    // why: plan decision 2 — 'fx' goes through http-kit but is never ledgered
    expect(h.count('provider_requests')).toBe(0);
  });

  it.each([
    ['another base', { ...body, base: 'EUR' }],
    ['no rates', { amount: 1, base: 'GBP', date: '2026-10-14' }],
    ['a bad date', { ...body, date: '14/10/2026' }],
    ['a non-positive rate', { ...body, rates: { USD: 0 } }],
  ])('rejects %s as a parse error and stores nothing', async (_n, bad) => {
    expect(parseFrankfurter(bad)).toBeInstanceOf(ProviderError);
    const h = createHarness();
    stubFrankfurter(() => Response.json(bad));
    await expect(
      refreshFx(buildContext(h.deps, h.options), new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'parse' });
    expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())).toBeNull();
  });

  it.each([
    [
      'a 301 to another URL (http-kit refuses redirects)',
      () => new Response(null, { status: 301, headers: { location: 'https://api.frankfurter.app/latest' } }),
      1,
    ],
    [
      '429 after retries',
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }),
      3,
    ],
    ['503 after retries', () => new Response('down', { status: 503 }), 3],
    ['a network error after retries', () => Response.error(), 3],
  ])(
    '%s → a ProviderError; the stored rates are untouched; nothing is ledgered',
    async (_n, answer, attempts) => {
      const h = createHarness({ fakeTimers: true });
      h.repos.fx.upsert([
        { date: asIsoDate('2026-10-13'), currency: 'USD', rateNano: 790_000_000, source: FX_SOURCE },
      ]);
      const stub = stubFrankfurter(answer);
      await expect(
        h.drive(refreshFx(buildContext(h.deps, h.options), new AbortController().signal)),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(stub.urls).toHaveLength(attempts);
      expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())).toMatchObject({
        rateNano: 790_000_000,
        date: '2026-10-13',
      });
      expect(h.count('provider_requests')).toBe(0);
    },
  );

  it('after a refresh, USD calendar prices convert instead of failing fx-unavailable', async () => {
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    stubFrankfurter(() => Response.json(body));
    await refreshFx(buildContext(h.deps, h.options), new AbortController().signal);
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(28);
  });
});
```

`packages/engine/test/support/fx.ts` (new file):

```ts
import { vi } from 'vitest';

/**
 * Answers requests to api.frankfurter.dev on global fetch with `respond`; every other host goes on to the fetch the
 * network guards installed, so a stray request still fails the test. why: decision 20 — only @gmt/providers/testing
 * imports msw, and http-kit's in-process seam is fixture.local only; the setup file unstubs globals after each test.
 */
export function stubFrankfurter(respond: (url: URL) => Response | Promise<Response>): { urls: string[] } {
  const urls: string[] = [];
  const guarded = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'api.frankfurter.dev') return guarded(input, init);
    urls.push(url.toString());
    return respond(url);
  });
  return { urls };
}

/** A frankfurter `latest` body: units of each currency per 1 GBP. */
export function frankfurterBody(rates: Record<string, number>, date = '2026-10-14'): Record<string, unknown> {
  return { amount: 1, base: 'GBP', date, rates };
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run fx-refresh`
Expected: FAIL, `Cannot find module '../src/fx/refresh.js'`.

- [ ] **Step 3: Implement**

`packages/engine/src/fx/refresh.ts` (new file):

```ts
import { ECB_CURRENCIES, type IsoDate, isoDateSchema, ProviderError } from '@gmt/core';
import { z } from 'zod';
import type { EngineContext } from '../context.js';
import { FX_SOURCE } from '../normalise.js';

/**
 * frankfurter's latest ECB reference rates against GBP. Verified 2026-10-14: the `.app` host answers 301 to this URL,
 * and http-kit sends `redirect: 'error'`, so the engine calls `.dev/v1` directly and the `fx` host allowlist is
 * `api.frankfurter.dev` (plan decision 2). Body: `{ amount, base, date, rates }` where `rates[C]` is units of C per 1 GBP.
 */
export const FRANKFURTER_LATEST_URL = 'https://api.frankfurter.dev/v1/latest?from=GBP';

const frankfurterSchema = z.object({
  amount: z.number(),
  base: z.literal('GBP'),
  date: isoDateSchema,
  rates: z.record(z.string(), z.number().positive().finite()),
});

/** Validates the frankfurter body with zod; anything else is a `parse` error (no rates stored). */
export function parseFrankfurter(
  body: unknown,
): { date: IsoDate; rates: Record<string, number> } | ProviderError {
  const r = frankfurterSchema.safeParse(body);
  if (!r.success) {
    const where = r.error.issues.map((i) => i.path.join('.') || 'body').join(', ');
    return new ProviderError({
      kind: 'parse',
      retryable: false,
      providerId: 'fx',
      message: `frankfurter: unexpected body at ${where}`,
    });
  }
  return { date: r.data.date, rates: r.data.rates };
}

/**
 * Daily FX refresh (spec §5.6 "refreshed daily"). Goes through http-kit under the id `fx` (spec §5.3 rev 10): limiter,
 * host allowlist, timeout and retry apply; it is never ledgered and never reserved. Stores `fx_rate_nano` = GBP per 1
 * native unit × 1e9 for ECB currencies only (spec §6.3). A failure throws the ProviderError and stores nothing.
 */
export async function refreshFx(
  ctx: Pick<EngineContext, 'http' | 'repos' | 'log'>,
  signal: AbortSignal,
): Promise<{ date: IsoDate; stored: number }> {
  const res = await ctx.http.request({
    providerId: 'fx',
    executionId: null,
    tileIndex: null,
    endpointPath: '/v1/latest',
    method: 'GET',
    url: new URL(FRANKFURTER_LATEST_URL),
    headers: { accept: 'application/json' },
    cache: 'never',
    signal,
    recordFixtures: false,
  });
  const parsed = parseFrankfurter(res.body);
  if (parsed instanceof ProviderError) throw parsed;
  const rows: Array<{ date: IsoDate; currency: string; rateNano: number; source: string }> = [];
  for (const c of ECB_CURRENCIES) {
    const perGbp = parsed.rates[c];
    // why: the vendor gives units of C per GBP; the store wants GBP per unit of C, as an integer nano (spec §6.3)
    if (c !== 'GBP' && perGbp !== undefined)
      rows.push({ date: parsed.date, currency: c, rateNano: Math.round(1e9 / perGbp), source: FX_SOURCE });
  }
  ctx.repos.fx.upsert(rows);
  ctx.log.info({ fxDate: parsed.date, stored: rows.length }, 'fx: rates refreshed');
  return { date: parsed.date, stored: rows.length };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run fx-refresh`
Expected: PASS, 11 tests.

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
- Consumes: `CalendarPricesRepo.reuseCandidates`, `CellsRepo.copyReused(executionId, providerId, copies, criteria)`, `ReuseCriteria`, `DEFAULT_DISCOVERY_REFRESH_HOURS` (decisions 21, 22).
- Produces: `REUSE_TOLERANCE`, `refreshHoursOf(snapshot, providerId)`, `reuseCutoff(now, hours)`, `reuseCriteriaFor(ctx, snapshot, providerId, info)`, `reusableFor(ctx, definitionId, snapshot, providerId, criteria, cells)`, `applyReuse(ctx, run, providerId, info): number`.

`applyReuse` computes the criteria once and hands the same object to the query and to the repository's re-check (arch-024). The DST test sits where wall-clock arithmetic would change the answer: across the spring change, 150.5 elapsed hours must reuse and 151.5 must not (test-strategy-reviewer-007); one refusal test per criterion the engine controls (cabin, definition, point of sale, source kind). The point of sale reuse matches on is an engine rule known before any call (`ctx.pointOfSaleOf`: SearchApi's configured `POINT_OF_SALE`, `unknown` for the others); a test pins it against what the fixture echoes on every row, so a mismatch can never make reuse refuse every copy unnoticed (arch-r2-013; WP5's adapter test pins SearchApi's echo).

- [ ] **Step 1: Write the failing test**

`packages/engine/test/reuse.test.ts` (new file):

```ts
import { asIsoDate, asIsoDateTime, cellKeyString } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { newRun } from '../src/run.js';
import { commitTile, discoveryQuery } from '../src/stages/discovery.js';
import { applyReuse, reuseCriteriaFor, reuseCutoff } from '../src/stages/reuse.js';
import {
  createHarness,
  discoveryOf,
  expectedTiles,
  FIXTURE_RULES,
  type Harness,
  HOUR,
  JFK,
  LHR,
  tileRule,
} from './support/harness.js';

/** Every price row of an execution, reused copies included, as (cell, fetched_at, reused_from). */
const allPriceRows = (h: Harness, executionId: string) =>
  h.db.raw
    .prepare<[string], { cell: string; f: string; ru: string | null }>(
      `SELECT origin || '|' || destination || '|' || departure_date || '|' || return_date AS cell, fetched_at AS f, reused_from_execution_id AS ru
         FROM calendar_prices WHERE execution_id = ? ORDER BY cell`,
    )
    .all(executionId);

describe('reuseCutoff (spec §8.2 "reuse iff age < 0.9 × refresh")', () => {
  it('is now minus 0.9 × refresh hours', () => {
    expect(reuseCutoff(asIsoDateTime('2026-10-14T09:00:00.000Z'), 168)).toBe('2026-10-08T01:48:00.000Z'); // 151.2 h earlier
  });
});

describe('reuse per cell (spec §8.1 "reuse, per cell")', () => {
  it('at 151 h every searched cell is copied with its original fetchedAt and the fetching execution; no tile is requested', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(151 * HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    expect(h.tileRequests(two.id)).toBe(0);
    const o2 = h.outcomes(two.id, { stage: 'discovery' });
    expect(o2).toHaveLength(28);
    expect(o2.every((o) => o.reusedFromExecutionId === one.id)).toBe(true);
    const byCell = new Map(h.outcomes(one.id, { stage: 'discovery' }).map((o) => [cellKeyString(o), o]));
    for (const o of o2) {
      const first = byCell.get(cellKeyString(o));
      expect(o.status).toBe(first?.status);
      expect(o.fetchedAt).toBe(first?.fetchedAt);
      expect(o.minPence).toBe(first?.minPence);
    }
    const p1 = allPriceRows(h, one.id);
    const p2 = allPriceRows(h, two.id);
    expect(p2.map(({ cell, f }) => ({ cell, f }))).toEqual(p1.map(({ cell, f }) => ({ cell, f }))); // same cells, same fetched_at
    expect(p2.every((r) => r.ru === one.id)).toBe(true);
    expect(h.repos.calendarPrices.fetchedBy(two.id)).toEqual([]); // fetchedBy excludes reused rows
  });

  it('at 152 h nothing is reused and every tile is requested again', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(152 * HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    expect(h.tileRequests(two.id)).toBe(expectedTiles(h, def));
    expect(h.outcomes(two.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
  });

  it('age is elapsed time, not wall-clock days: across the spring change 150.5 h reuses and 151.5 h does not (test-strategy-007)', async () => {
    // why: 22 → 28 March 2027 crosses the UK spring change; a cutoff taken in London wall-clock time would sit at 150.2
    // elapsed hours and refuse the 150.5 h case, so only millisecond arithmetic passes both
    const start = asIsoDateTime('2027-03-22T05:00:00.000Z');
    for (const [hours, reused] of [
      [150.5, true],
      [151.5, false],
    ] as const) {
      const h = createHarness({ now: start });
      const def = h.createDefinition({
        window: { kind: 'absolute', from: asIsoDate('2027-05-03'), to: asIsoDate('2027-05-05') },
      });
      await h.runToCompletion(h.orch(), def.id);
      h.clock.advance(hours * HOUR);
      const two = await h.runToCompletion(h.orch(), def.id);
      expect(h.outcomes(two.id).every((o) => (o.reusedFromExecutionId !== null) === reused)).toBe(true);
      await h.close();
    }
  });

  it('never copies error outcomes: those cells are fetched again, the rest are reused', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.upstream, 3)]);
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    const errored = new Set(h.outcomes(one.id, { status: 'error' }).map(cellKeyString));
    expect(errored.size).toBe(14);
    h.clock.advance(2 * HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    for (const o of h.outcomes(two.id, { stage: 'discovery' }))
      expect(o.reusedFromExecutionId).toBe(errored.has(cellKeyString(o)) ? null : one.id);
  });

  it('never copies not_run outcomes of an interrupted run', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition();
    const first = h.orch();
    h.onTileCommit((n) => {
      if (n === 1) void first.shutdown();
    });
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await h.waitForSettled(r.executionId);
    h.clearHooks();
    const notRun = new Set(h.outcomes(r.executionId, { status: 'not_run' }).map(cellKeyString));
    expect(notRun.size).toBe(14);
    const second = h.orch();
    expect(await second.cancel(r.executionId)).toBe(true); // frees the definition for a new run
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(second, def.id);
    for (const o of h.outcomes(two.id))
      expect(o.reusedFromExecutionId).toBe(notRun.has(cellKeyString(o)) ? null : r.executionId);
  });

  it('refuses on a cabin change', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(h.orch(), def.id);
    h.repos.definitions.update(def.id, { cabin: 'premium_economy' });
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    expect(h.outcomes(two.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
  });

  it('refuses another definition’s prices for the same cells', async () => {
    const h = createHarness();
    await h.runToCompletion(h.orch(), h.createDefinition().id);
    h.clock.advance(HOUR);
    const other = await h.runToCompletion(h.orch(), h.createDefinition({ name: 'another' }).id);
    expect(h.outcomes(other.id).every((o) => o.reusedFromExecutionId === null)).toBe(true);
  });

  it('refuses on a point of sale or source kind other than the stored rows’ (the criteria reach the repository)', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const r = await h.orch().start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const ctx = buildContext(h.deps, h.options);
    const exec = h.repos.executions.get(r.executionId);
    if (exec === null) throw new Error('missing execution');
    const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: new Set() });
    const info = discoveryOf(h.fixture).info;
    expect(reuseCriteriaFor(ctx, exec.snapshot, 'fixture', info)).toEqual({
      pointOfSale: 'unknown',
      sourceKind: 'synthetic',
      newerThan: reuseCutoff(h.clock.now(), 168),
    });
    expect(applyReuse({ ...ctx, pointOfSaleOf: () => 'GB' }, run, 'fixture', info)).toBe(0);
    expect(applyReuse(ctx, run, 'fixture', { ...info, sourceKind: 'authorised-cached' })).toBe(0);
    expect(h.outcomes(one.id).length).toBe(28);
    await h.releaseHolds();
  });

  it('a copy of a copy still names the execution that fetched the price', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const one = await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    const three = await h.runToCompletion(h.orch(), def.id);
    expect(h.outcomes(three.id).every((o) => o.reusedFromExecutionId === one.id)).toBe(true);
    const firstFetch = new Map(allPriceRows(h, one.id).map((r) => [r.cell, r.f]));
    expect(allPriceRows(h, three.id).every((r) => r.ru === one.id && r.f === firstFetch.get(r.cell))).toBe(
      true,
    );
  });

  it('a fresh price supersedes a reused row in the same transaction (spec §7)', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    const two = await h.runToCompletion(h.orch(), def.id);
    const ctx = buildContext(h.deps, h.options);
    const cap = discoveryOf(h.fixture);
    const q = discoveryQuery(two.snapshot, LHR, JFK, h.outcomes(two.id, { stage: 'discovery' }));
    const tile = cap.plan(q)[0];
    if (tile === undefined) throw new Error('fixture planned no tile');
    const result = await cap.fetchTile(tile, q, {
      executionId: two.id,
      signal: new AbortController().signal,
      recordFixtures: false,
    });
    if (result.kind !== 'tile') throw new Error('expected a tile');
    commitTile(
      ctx,
      newRun(ctx, two, { manual: true, fresh: false, blocked: new Set() }),
      'fixture',
      cap.info,
      result,
    );
    const pricedNow = new Set(result.prices.map(cellKeyString));
    expect(pricedNow.size).toBe(14);
    const rows = allPriceRows(h, two.id).filter((r) => pricedNow.has(r.cell));
    expect(rows.length).toBe(pricedNow.size); // one row per cell: the reused row is gone, not duplicated
    expect(rows.every((r) => r.ru === null)).toBe(true);
  });
});

describe('the point of sale reuse matches on (arch-r2-013)', () => {
  it('is the one the provider echoes on what it fetched, so a reuse match is never refused for it', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    const expected = buildContext(h.deps, h.options).pointOfSaleOf('fixture');
    const priced = h.outcomes(e.id, { status: 'priced' });
    expect(priced).toHaveLength(28);
    expect(priced.every((o) => o.pointOfSale === expected)).toBe(true);
    expect(h.repos.calendarPrices.fetchedBy(e.id).every((r) => r.pointOfSale === expected)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run reuse`
Expected: FAIL, `Cannot find module '../src/stages/reuse.js'`.

- [ ] **Step 3: Implement**

`packages/engine/src/stages/discovery.ts` — the import block becomes:

```ts
import {
  type CapabilityInfo,
  type CellIssue,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type Iata,
  ProviderError,
  type ProviderId,
  type TilePlan,
  TRUNCATED_NOTE,
} from '@gmt/core';
import type { TileWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { normaliseCalendarPrice, type RepoDeps, reduceTile } from '../normalise.js';
import { runPool } from '../pool.js';
import { laneFor, onFailure, type RunState, runnableCells, settleLane, stopRun } from '../run.js';
import { applyReuse } from './reuse.js';
```

`packages/engine/src/stages/discovery.ts` — replace or add these declarations:

```ts
async function runDiscoveryProvider(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
): Promise<void> {
  const cap = ctx.providers.get(providerId)?.discovery;
  if (cap === undefined) return;
  if (!run.disabled.has(providerId)) {
    const reused = applyReuse(ctx, run, providerId, cap.info);
    if (reused > 0)
      run.log
        .child({ providerId })
        .info({ stage: 'discovery', reused }, 'discovery: reused cells from earlier runs');
  }
  const cells = runnableCells(ctx, run, 'discovery', providerId);
  if (cells.length > 0) await fetchTiles(ctx, run, providerId, cap, cells);
  settleLane(ctx, run, 'discovery', providerId);
}
```

`packages/engine/src/stages/reuse.ts` (new file):

```ts
import {
  type CapabilityInfo,
  type CellKey,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type DefinitionSnapshot,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  type ProviderId,
} from '@gmt/core';
import type { ReuseCriteria, ReusedCopy } from '@gmt/db';
import type { EngineContext } from '../context.js';
import type { RunState } from '../run.js';

/** Spec §8.2: "reuse iff age < 0.9 × refresh, so a weekly cron refreshes weekly" (tested at 151 h, 152 h and a DST interval). */
export const REUSE_TOLERANCE = 0.9;
const HOUR_MS = 3_600_000;

/** The definition's discoveryRefreshHours for a provider; core's DEFAULT_DISCOVERY_REFRESH_HOURS (168) otherwise (decision 21). */
export function refreshHoursOf(
  snapshot: Pick<DefinitionSnapshot, 'providers'>,
  providerId: ProviderId,
): number {
  return snapshot.providers.discoveryRefreshHours[providerId] ?? DEFAULT_DISCOVERY_REFRESH_HOURS;
}

/** The oldest original fetched_at still reusable: now − 0.9 × refresh hours, in elapsed milliseconds (never wall-clock days). */
export function reuseCutoff(now: IsoDateTime, refreshHours: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(now) - Math.round(refreshHours * REUSE_TOLERANCE * HOUR_MS));
}

/**
 * The spec §8.1 reuse predicate as data (decision 22): the point of sale and source kind the provider's rows will
 * carry, and the cutoff. The query and the repository's re-check use the same object (arch-024).
 */
export function reuseCriteriaFor(
  ctx: EngineContext,
  snapshot: Pick<DefinitionSnapshot, 'providers'>,
  providerId: ProviderId,
  info: CapabilityInfo,
): ReuseCriteria {
  return {
    pointOfSale: ctx.pointOfSaleOf(providerId),
    sourceKind: info.sourceKind,
    newerThan: reuseCutoff(ctx.clock.now(), refreshHoursOf(snapshot, providerId)),
  };
}

/**
 * Spec §8.1 reuse, per cell: the newest priced | empty | no_data outcome for the same cell, provider, definition,
 * cabin, point of sale and source kind, from a non-child execution, whose original fetched_at is newer than the
 * cutoff. The same query feeds the run-time estimate. Only priced | empty | no_data copies are returned, whatever the
 * repository hands back.
 */
export function reusableFor(
  ctx: EngineContext,
  definitionId: string,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  criteria: ReuseCriteria,
  cells: readonly CellKey[],
): ReusedCopy[] {
  if (cells.length === 0) return [];
  const candidates = ctx.repos.calendarPrices.reuseCandidates(
    definitionId,
    providerId,
    snapshot.cabin,
    criteria.pointOfSale,
    criteria.sourceKind,
    [...cells],
    criteria.newerThan,
  );
  // why: belt and braces on the repository's predicate — error and not_run are never copied (spec §9 item 4)
  return candidates.filter(
    (c) => c.outcome.status === 'priced' || c.outcome.status === 'empty' || c.outcome.status === 'no_data',
  );
}

/**
 * Copies every reusable outcome (and its price row) into this execution for the provider's `not_run` discovery cells.
 * The repository re-checks each copy against the same criteria, keeps the original fetched_at and provenance and names
 * the execution that fetched the price, never an intermediate copier (spec §3, decision 22). Returns the cells reused.
 */
export function applyReuse(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  info: CapabilityInfo,
): number {
  if (run.isChild) return 0; // why: spec §6.7 child executions have no discovery
  const notRun = ctx.repos.cells
    .outcomes(run.executionId, { stage: 'discovery', providerId })
    .filter((o) => o.status === 'not_run');
  const criteria = reuseCriteriaFor(ctx, run.snapshot, providerId, info);
  const copies = reusableFor(ctx, run.definitionId, run.snapshot, providerId, criteria, notRun);
  if (copies.length > 0) ctx.repos.cells.copyReused(run.executionId, providerId, copies, criteria);
  return copies.length;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run reuse`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: per-cell reuse with 0.9 tolerance, original fetchedAt, supersede

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.8: Verification stage — selection once, offer normalisation, the verified-cell write, route history

**Files:**
- Create: `packages/engine/src/stages/verification.ts`, `test/verification.test.ts`; `packages/core/test/constraints/priceConfirmed.test.ts`
- Modify: `packages/engine/src/normalise.ts` (`offerWrite`), `src/execute.ts` (run verification after discovery); `packages/core/src/types/itinerary.ts` (`ConstraintName` gains `priceConfirmed`), `src/constraints/evaluate.ts`, `src/constraints/labels.ts`, `src/api-contract/common.ts` (`constraintNameSchema`)

**Interfaces:**
- Consumes: `selectCandidates`, `generateCells`, `normaliseOffer(raw, cell, deps)`, `PARTIAL_EXPANSION`, `isPartialExpansion`, `CellsRepo.seedVerification/hasVerificationOutcomes/markNoData/markDeparted/writeVerifiedCell/rollUps/selected`, `VerifiedCellWrite`, `RoutePriceHistoryRepo.upsert`, `ItinerarySearchResult.routeHistory/pointOfSale/coverage/partial`, `RawOffer.verified`, WP4 rules `partial` and `empty`.
- Produces: `runVerification(ctx, run)`, `itineraryQuery(snapshot, cell)`, `pricedReason(partial, dropped)`, `commitVerifiedCell(ctx, run, provider, info, cell, result)`, `routeHistoryRows(providerId, cell, result)`, `offerWrite(raw, cell, ctx, deps)`.

Rules this task pins, each with its test:
- The priced reason is decision 19's closed set, joined with `;` from core's `PARTIAL_EXPANSION` (arch-006, po-008, prov-wp07-002, ssr-01); a partial expansion that drops one offer stores `partial-expansion;offers-dropped:1` and its roll-up keeps `partial-expansion`.
- Offers go through core's `normaliseOffer` alone, fed `AirportsRepo.tzOf` and `rateFor` (no pre-checks, no second money step, arch-013).
- `empty` only for coverage `empty` with no offer and no failed expansion; coverage `priced` or a partial expansion without an offer is an `upstream` error naming the contradiction (prov-wp07-005).
- An offer with `verified: false` is written without `price` and `segmentCabins` in its supplied fields and without cabin evidence (decisions 27, 29). Decision 37 makes that visible: core's `evaluateConstraints` judges `priceConfirmed` on every offer, present only as `'unverified'` when `price` is not a supplied field, labelled "price not confirmed by the final step", so such a row is at best `partially-verified` whatever the definition's constraints (prov-wp07-r2-004). Verdicts are computed at read time (WP8, WP11), so the test reads the rows back through `ItinerariesRepo.writtenBy` and evaluates them as they will. The classing lives in core's `constraints/` (where `verdictClass` and `evaluateConstraints` are), which `results/` reads.
- A result that resolves after a stop is written; only a fatal stop writes nothing more (decisions 25, 27): a chain stopped by cancel returns the step-2 offers it paid for.
- Route history stores only the points the vendor gave in GBP; the others are dropped, counted and logged (ruling 2, prov-wp07-007).
- Selection never chooses a cell whose departure date has arrived, `alwaysInclude` members included, and marks them `skipped:departed` in the selection transaction (ssr-05).
- The "one bad offer" test uses `expandTop 2`, so the fixture answers two offers and one survives (ssr-04).

- [ ] **Step 1: Write the failing test**

`packages/core/test/constraints/priceConfirmed.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import { constraintNameSchema, verdictsSchema } from '../../src/api-contract/common.js';
import { evaluateConstraints } from '../../src/constraints/evaluate.js';
import { CONSTRAINT_LABELS, CONSTRAINT_NAMES } from '../../src/constraints/labels.js';
import { unverifiedNames, verdictClass } from '../../src/constraints/verdictClass.js';
import { normaliseOffer } from '../../src/normalise/itinerary.js';
import type { SuppliedField } from '../../src/types/itinerary.js';
import { cellOf, deps, offer } from '../helpers/offers.js';

// why: every segment states its cabin, so `cabin` passes and only priceConfirmed decides the class
const raw = offer();
const stated = {
  ...raw,
  outbound: raw.outbound.map((s) => ({ ...s, cabin: 'economy' as const })),
  inbound: raw.inbound.map((s) => ({ ...s, cabin: 'economy' as const })),
};
const normalised = normaliseOffer(stated, cellOf(stated), deps());
if (!normalised.ok) throw normalised.error;
const { itinerary, observation } = normalised;
const judge = (supplied: readonly SuppliedField[], constraints = {}) =>
  evaluateConstraints(itinerary, observation, constraints, 'economy', supplied);
const ALL: SuppliedField[] = ['price', 'segments', 'segmentTimes', 'segmentCabins'];

describe('priceConfirmed (decision 37: a price no seller listing confirmed)', () => {
  it("without 'price' among the supplied fields the offer is unverified on priceConfirmed whatever the constraints", () => {
    const v = judge(ALL.filter((f) => f !== 'price'));
    expect(v).toEqual({ cabin: 'pass', priceConfirmed: 'unverified' });
    expect(verdictClass(v)).toBe('partially-verified');
    expect(unverifiedNames(v)).toEqual(['priceConfirmed']);
    expect(CONSTRAINT_LABELS.priceConfirmed).toBe('price not confirmed by the final step');
    // a failed constraint still classes the row failed
    expect(
      verdictClass(
        judge(
          ALL.filter((f) => f !== 'price'),
          { maxStops: -1 },
        ),
      ),
    ).toBe('failed');
  });
  it("with 'price' supplied nothing is added, so a fully evidenced offer still classes verified", () => {
    const v = judge(ALL);
    expect(v).toEqual({ cabin: 'pass' });
    expect(verdictClass(v)).toBe('verified');
  });
  it('is a constraint name of the api contract, last in the fixed order', () => {
    expect(CONSTRAINT_NAMES[CONSTRAINT_NAMES.length - 1]).toBe('priceConfirmed');
    expect(constraintNameSchema.options).toEqual([...CONSTRAINT_NAMES]);
    expect(verdictsSchema.parse({ cabin: 'pass', priceConfirmed: 'unverified' })).toEqual({
      cabin: 'pass',
      priceConfirmed: 'unverified',
    });
  });
});
```

`packages/engine/test/verification.test.ts` (new file):

```ts
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  cellKeyString,
  evaluateConstraints,
  type ItinerarySearchResult,
  isPartialExpansion,
  type RawSegment,
  unverifiedNames,
  verdictClass,
} from '@gmt/core';
import type { FixtureRule } from '@gmt/providers/fixture';
import { describe, expect, it, vi } from 'vitest';
import { pricedReason } from '../src/stages/verification.js';
import {
  createHarness,
  FIXTURE_RULES,
  type Harness,
  type HarnessOptions,
  itineraryRule,
  JFK,
  LGW,
  LHR,
  verificationOf,
  withVerification,
} from './support/harness.js';
import { mapOffers, mapResult } from './support/wrappers.js';

const def = (h: Harness, patch = {}) => h.createDefinition({ providers: withVerification(), ...patch });
const searched = (h: Harness, id: string) =>
  h.outcomes(id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');
interface ObsRow {
  k: string;
  f: string;
  m: number | null;
  pos: string;
  sf: string;
  sc: string | null;
  b: string | null;
}
const observations = (h: Harness, id: string) =>
  h.db.raw
    .prepare<[string], ObsRow>(
      'SELECT source_kind AS k, fetched_at AS f, max_age_hours AS m, point_of_sale AS pos, supplied_fields_json AS sf, segment_cabins_json AS sc, booking_json AS b FROM price_observations WHERE execution_id = ?',
    )
    .all(id);

describe('verification stage (spec §8.1 "verification", §6.7, §7 atomic units)', () => {
  it('persists selection with verification seeding: selected cells searched, the rest skipped:not_selected', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(h.orch(), def(h).id);
    expect(e.status).toBe('completed');
    const selected = h.repos.cells.selected(e.id);
    expect(selected).toHaveLength(2); // maxCells
    const chosen = new Set(selected.map((x) => cellKeyString(x.cell)));
    const v = h.outcomes(e.id, { stage: 'verification' });
    expect(v).toHaveLength(28); // every cell × the one verification provider
    const picked = v.filter((o) => chosen.has(cellKeyString(o)));
    const rest = v.filter((o) => !chosen.has(cellKeyString(o)));
    expect(picked).toHaveLength(2);
    expect(picked.every((o) => o.status === 'priced')).toBe(true);
    expect(rest).toHaveLength(26);
    expect(rest.every((o) => o.status === 'skipped' && o.reason === 'not_selected')).toBe(true);
  });

  it('a priced cell stores best_observation_id = the cheapest observation written for it (verdict-independent), and min_pence matches', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(
      h.orch(),
      def(h, { verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 2, bookingLinks: true } })
        .id,
    );
    const rows = h.db.raw
      .prepare<[string], { best: number | null; bestPence: number; minPence: number; outcomeMin: number }>(
        `SELECT sc.best_observation_id AS best,
                (SELECT price_pence FROM price_observations WHERE id = sc.best_observation_id) AS bestPence,
                (SELECT min(po.price_pence) FROM price_observations po
                   JOIN fare_offers fo ON fo.id = po.offer_id JOIN itineraries i ON i.hash = fo.itinerary_hash
                  WHERE po.execution_id = sc.execution_id AND i.origin = sc.origin AND i.destination = sc.destination
                    AND i.departure_date = sc.departure_date AND i.return_date = sc.return_date) AS minPence,
                sc.verification_min_pence AS outcomeMin
           FROM search_cells sc WHERE sc.execution_id = ? AND sc.verification_status = 'priced'`,
      )
      .all(e.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.best).not.toBeNull();
      expect(r.bestPence).toBe(r.minPence);
      expect(r.outcomeMin).toBe(r.minPence);
    }
  });

  it('observations carry full provenance, the provider suppliedFields, and no booking for the fixture', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(h.orch(), def(h).id);
    const obs = observations(h, e.id);
    expect(obs).toHaveLength(2);
    const info = verificationOf(h.fixture).info;
    for (const o of obs) {
      expect(o.k).toBe('synthetic');
      expect(o.f).toBe(h.clock.now());
      expect(o.m).toBe(info.maxAgeHours === 'unknown' ? null : info.maxAgeHours);
      expect(o.pos).toBe('unknown');
      expect(JSON.parse(o.sf)).toEqual([...h.fixture.suppliedFields]);
      expect(o.b).toBe('{"kind":"none"}'); // the fixture's allowlist is empty, so no booking is ever stored
    }
  });

  it('selection runs once: an interrupt during verification and a resume keep the same selection', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold, 1)]);
    const d = def(h);
    const first = h.orch();
    const r = await first.start(d.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    const before = h.repos.cells
      .selected(r.executionId)
      .map((x) => cellKeyString(x.cell))
      .sort();
    expect(before).toHaveLength(2);
    await first.shutdown();
    expect((await h.waitForSettled(r.executionId)).status).toBe('interrupted');
    expect(await h.orch().resume(r.executionId, { manual: false })).toEqual({
      ok: true,
      executionId: r.executionId,
    });
    expect((await h.waitForSettled(r.executionId)).status).toBe('completed');
    expect(
      h.repos.cells
        .selected(r.executionId)
        .map((x) => cellKeyString(x.cell))
        .sort(),
    ).toEqual(before);
    expect(h.logs.filter((l) => l.msg === 'verification: selection persisted')).toHaveLength(1);
  });

  it('never selects a cell whose departure date has arrived (spec §8.1 departed, ssr-05)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const d = def(h, {
      origins: [LHR, LGW],
      destinations: [JFK],
      verification: {
        maxCells: 6,
        topN: 6,
        alwaysInclude: [
          {
            origin: LHR,
            destination: JFK,
            departureDate: asIsoDate('2026-11-02'),
            returnDate: asIsoDate('2026-11-09'),
          },
        ],
        expandTop: 1,
        bookingLinks: true,
      },
    });
    const first = h.orch();
    h.onTileCommit((n) => {
      if (n === 1) void first.shutdown();
    });
    const r = await first.start(d.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await h.waitForSettled(r.executionId);
    h.clearHooks();
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // today (London) = 2026-11-03
    expect(await h.orch().resume(r.executionId, { manual: false })).toEqual({
      ok: true,
      executionId: r.executionId,
    });
    await h.waitForSettled(r.executionId);
    const selected = h.repos.cells.selected(r.executionId);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((s) => s.cell.departureDate > '2026-11-03')).toBe(true);
    expect(
      h.requests.filter((q) => q.kind === 'itinerary' && (q.params.departureDate ?? '') <= '2026-11-03'),
    ).toHaveLength(0);
    const alwaysInclude = h
      .outcomes(r.executionId, { stage: 'verification' })
      .find((o) => o.departureDate === '2026-11-02' && o.returnDate === '2026-11-09' && o.origin === LHR);
    expect(alwaysInclude).toMatchObject({ status: 'skipped', reason: 'departed' });
  });
});

describe('offer normalisation (spec §5.6, §9 item 4 "fx-unavailable, currency-unsupported, unknown-airport-tz, offers-dropped")', () => {
  const two = { verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 2, bookingLinks: true } };
  const run = async (opts: HarnessOptions, rules: FixtureRule[] = []) => {
    const h = createHarness(opts);
    await h.fixtureScenario(rules);
    return { h, e: await h.runToCompletion(h.orch(), def(h, two).id) };
  };

  it('pricedReason is the closed set of decision 19', () => {
    expect([
      pricedReason(false, 0),
      pricedReason(true, 0),
      pricedReason(false, 2),
      pricedReason(true, 1),
    ]).toEqual([null, 'partial-expansion', 'offers-dropped:2', 'partial-expansion;offers-dropped:1']);
  });

  it('one bad offer among several is dropped and counted: priced with offers-dropped:1 (expandTop 2: the fixture answers two offers)', async () => {
    const { h, e } = await run({
      transformFixture: (p) => mapOffers(p, (o, i) => (i === 0 ? { ...o, currency: 'ARS' } : o)),
    });
    const priced = searched(h, e.id);
    expect(priced).toHaveLength(2);
    expect(priced.every((o) => o.status === 'priced' && o.reason === 'offers-dropped:1')).toBe(true);
  });

  it.each([
    ['currency-unsupported', { currency: 'ARS' }],
    ['fx-unavailable', { currency: 'USD' }],
  ] as const)(
    'every offer failing with %s → error with that reason, no observation written',
    async (reason, patch) => {
      const { h, e } = await run({ transformFixture: (p) => mapOffers(p, (o) => ({ ...o, ...patch })) });
      expect(e.status).toBe('completed');
      const v = searched(h, e.id);
      expect(v).toHaveLength(2);
      expect(v.every((o) => o.status === 'error' && o.reason === reason)).toBe(true);
      expect(h.count('price_observations', e.id)).toBe(0);
    },
  );

  it.each([
    ['unknown-airport-tz', (s: RawSegment): RawSegment => ({ ...s, to: asIata('AAA') })],
    ['unmappable-carrier', (s: RawSegment): RawSegment => ({ ...s, marketingCarrier: '!!' })],
  ] as const)('every offer failing with %s → error with that reason', async (reason, seg) => {
    const { h, e } = await run({
      transformFixture: (p) =>
        mapOffers(p, (o) => ({ ...o, outbound: o.outbound.map((s, i) => (i === 0 ? seg(s) : s)) })),
    });
    const v = searched(h, e.id);
    expect(v).toHaveLength(2);
    expect(v.every((o) => o.status === 'error' && o.reason === reason)).toBe(true);
    expect(h.count('price_observations', e.id)).toBe(0);
  });

  it('a partial expansion is noted on the priced outcome (WP4 rule `partial`)', async () => {
    const { h, e } = await run({}, [itineraryRule(FIXTURE_RULES.partial)]);
    const priced = searched(h, e.id);
    expect(priced).toHaveLength(2);
    expect(priced.every((o) => o.status === 'priced' && isPartialExpansion(o.reason))).toBe(true);
  });

  it('a partial expansion that also drops an offer stores partial-expansion;offers-dropped:1; the roll-up keeps partial-expansion', async () => {
    // why: the fixture's `partial` rule removes the failed option, so the partial result is shaped here to keep two offers
    const partialWithBadFirst = (r: ItinerarySearchResult): ItinerarySearchResult => ({
      ...r,
      partial: true,
      failedExpansions: 1,
      offers: r.offers.map((o, i) => (i === 0 ? { ...o, currency: 'ARS' } : o)),
    });
    const { h, e } = await run({ transformFixture: (p) => mapResult(p, partialWithBadFirst) });
    const priced = searched(h, e.id);
    expect(priced.map((o) => o.reason)).toEqual([
      'partial-expansion;offers-dropped:1',
      'partial-expansion;offers-dropped:1',
    ]);
    for (const o of priced)
      expect(h.repos.cells.rollUps(e.id).get(cellKeyString(o))?.verification).toMatchObject({
        status: 'priced',
        reason: 'partial-expansion',
      });
  });

  it('empty is written only for an empty answer; a result claiming offers it does not carry is an upstream error (prov-wp07-005)', async () => {
    const empty = await run({}, [itineraryRule(FIXTURE_RULES.empty)]);
    expect(searched(empty.h, empty.e.id).every((o) => o.status === 'empty')).toBe(true);
    const { h, e } = await run({
      transformFixture: (p) =>
        mapResult(p, (r) => ({ ...r, coverage: 'priced', offers: [], partial: true, failedExpansions: 1 })),
    });
    const v = searched(h, e.id);
    expect(v).toHaveLength(2);
    expect(
      v.every(
        (o) =>
          o.status === 'error' &&
          o.reason === 'upstream' &&
          (o.lastError ?? '').includes('returned no offer'),
      ),
    ).toBe(true);
  });

  it('an offer no seller listing confirmed (RawOffer.verified false, decision 27) is written without price and cabin evidence', async () => {
    const { h, e } = await run({ transformFixture: (p) => mapOffers(p, (o) => ({ ...o, verified: false })) });
    const obs = observations(h, e.id);
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      const supplied: unknown = JSON.parse(o.sf);
      expect(
        Array.isArray(supplied) && !supplied.includes('price') && !supplied.includes('segmentCabins'),
      ).toBe(true);
      expect(o.sc).toBeNull();
    }
    // why: decision 37 — what WP8 and WP11 read back (this repository, core's evaluateConstraints over the stored supplied
    // fields) shows the price as not confirmed, with no constraint set, so the row can never class as verified
    const rows = h.repos.itineraries.writtenBy(e.id);
    expect(rows).toHaveLength(obs.length);
    for (const row of rows) {
      const v = evaluateConstraints(row.itinerary, row, {}, 'economy', row.suppliedFields);
      expect(v.priceConfirmed).toBe('unverified');
      expect(verdictClass(v)).toBe('partially-verified');
      expect(unverifiedNames(v)).toContain('priceConfirmed');
    }
  });

  it('a chain stopped by cancel resolves with the offers it already paid for, and they are written (decisions 25, 27)', async () => {
    const h = createHarness({
      fixtureConcurrency: 1,
      transformFixture: (p) => {
        const v = verificationOf(p);
        return {
          ...p,
          healthcheck: (c) => p.healthcheck(c),
          verification: {
            info: v.info,
            estimate: (q) => v.estimate(q),
            search: async (q, c) => {
              const step2 = await v.search(q, c);
              // why: a SearchApi chain waiting on step 3 when the run is cancelled returns what step 2 paid for
              await new Promise<void>((resolve) =>
                c.signal.addEventListener('abort', () => resolve(), { once: true }),
              );
              return {
                ...step2,
                partial: true,
                failedExpansions: 1,
                offers: step2.offers.map((o) => ({ ...o, verified: false })),
              };
            },
          },
        };
      },
    });
    const orch = h.orch();
    const r = await orch.start(def(h).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    expect(await orch.cancel(r.executionId)).toBe(true);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('cancelled');
    const v = searched(h, e.id);
    expect(v.filter((o) => o.status === 'priced')).toEqual([
      expect.objectContaining({ reason: 'partial-expansion' }),
    ]);
    expect(v.filter((o) => o.status === 'not_run')).toHaveLength(1);
    expect(h.count('price_observations', e.id)).toBeGreaterThan(0);
  });
});

describe('route price history (spec §7 rev 10)', () => {
  it('upserts only the points the vendor gave in GBP, cabin unknown; other currencies are dropped and counted (prov-wp07-007)', async () => {
    const routeHistory = [
      { date: asIsoDate('2026-10-12'), lowestPriceMinor: 41_200, currency: 'GBP' },
      { date: asIsoDate('2026-10-13'), lowestPriceMinor: 40_900, currency: 'GBP' },
      { date: asIsoDate('2026-10-11'), lowestPriceMinor: 52_000, currency: 'USD' },
    ];
    const h = createHarness({ transformFixture: (p) => mapResult(p, (r) => ({ ...r, routeHistory })) });
    await h.runToCompletion(h.orch(), def(h).id);
    const rows = h.db.raw
      .prepare<
        [],
        { origin: string; destination: string; cabin: string; p: string; date: string; pence: number }
      >(
        'SELECT origin, destination, cabin, provider_id AS p, date, lowest_price_pence AS pence FROM route_price_history ORDER BY date',
      )
      .all();
    expect(rows).toEqual([
      {
        origin: 'LHR',
        destination: 'JFK',
        cabin: 'unknown',
        p: 'fixture',
        date: '2026-10-12',
        pence: 41_200,
      },
      {
        origin: 'LHR',
        destination: 'JFK',
        cabin: 'unknown',
        p: 'fixture',
        date: '2026-10-13',
        pence: 40_900,
      },
    ]);
    expect(
      h.logs.some(
        (l) => l.msg === 'verification: route history points not in GBP dropped' && l.fields.dropped === 1,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run verification && pnpm --filter @gmt/core exec vitest run constraints/priceConfirmed`
Expected: FAIL, `Cannot find module '../src/stages/verification.js'`; the core test fails with `expected { cabin: 'pass' } to deeply equal { cabin: 'pass', priceConfirmed: 'unverified' }`.

- [ ] **Step 3: Implement**

`packages/core/src/api-contract/common.ts` — apply this patch:

```diff
--- a/packages/core/src/api-contract/common.ts
+++ b/packages/core/src/api-contract/common.ts
@@ -126,6 +126,7 @@
   'checkedBagRequired',
   'minCheckedBags',
   'maxPricePence',
+  'priceConfirmed',
 ]);
 export const verdictSchema = z.enum(['pass', 'fail', 'unverified']);
 export const verdictsSchema = z.partialRecord(constraintNameSchema, verdictSchema);
```

`packages/core/src/constraints/evaluate.ts` — apply this patch:

```diff
--- a/packages/core/src/constraints/evaluate.ts
+++ b/packages/core/src/constraints/evaluate.ts
@@ -34,7 +34,9 @@
  * observation's stored `supplied_fields_json`, so an edited constraint re-judges old rows.
  * Only constraints the definition sets are judged (a `false` boolean or an empty airline list is
  * "not set"); `cabin` is always judged against `requestedCabin` (the offer's cabin, never
- * evidence itself). Absent input is `unverified`, never `pass`.
+ * evidence itself). Absent input is `unverified`, never `pass`. Whatever the definition sets, an
+ * offer whose `price` is not a supplied field (no seller listing confirmed it, decision 27) carries
+ * `priceConfirmed: 'unverified'`, so it can never class as verified (decision 37).
  */
 export function evaluateConstraints(
   it: NormalisedItinerary,
@@ -56,6 +58,7 @@
     cabins === null || cabins.length !== all.length
       ? 'unverified'
       : verdict(cabins.every((k) => CABIN_RANK[k] >= CABIN_RANK[requestedCabin]));
+  if (!has('price')) v.priceConfirmed = 'unverified';
 
   if (c.maxStops !== undefined) {
     const max = c.maxStops;
```

`packages/core/src/constraints/labels.ts` — apply this patch:

```diff
--- a/packages/core/src/constraints/labels.ts
+++ b/packages/core/src/constraints/labels.ts
@@ -22,9 +22,10 @@
   checkedBagRequired: 'checked bag',
   minCheckedBags: 'min checked bags',
   maxPricePence: 'max price',
+  priceConfirmed: 'price not confirmed by the final step',
 };
 
-/** Every ConstraintName in a fixed order (cabin, then the spec §6.2 table order). */
+/** Every ConstraintName in a fixed order (cabin, then the spec §6.2 table order, then priceConfirmed). */
 export const CONSTRAINT_NAMES = [
   'cabin',
   'maxStops',
@@ -42,4 +43,5 @@
   'checkedBagRequired',
   'minCheckedBags',
   'maxPricePence',
+  'priceConfirmed',
 ] as const satisfies readonly ConstraintName[];
```

`packages/core/src/types/itinerary.ts` — apply this patch:

```diff
--- a/packages/core/src/types/itinerary.ts
+++ b/packages/core/src/types/itinerary.ts
@@ -97,7 +97,11 @@
   partialExpansion: boolean;
 }
 export type Verdict = 'pass' | 'fail' | 'unverified';
-export type ConstraintName = keyof Constraints | 'cabin';
+/**
+ * `cabin` and `priceConfirmed` are judged on every offer whatever the definition sets; `priceConfirmed` is present only
+ * as `unverified`, for an offer whose price no seller listing confirmed (decision 37).
+ */
+export type ConstraintName = keyof Constraints | 'cabin' | 'priceConfirmed';
 export type Verdicts = Partial<Record<ConstraintName, Verdict>>;
 export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
 /** API values; the UI labels them "itinerary-search basis" and "calendar basis". Spec §6.9. */
```

`packages/engine/src/execute.ts` — the import block becomes:

```ts
import type { ExecutionStatus, IsoDateTime, OperatorMessageKind } from '@gmt/core';
import type { ExecutionPatch } from '@gmt/db';
import type { EngineContext } from './context.js';
import { notifyOperator } from './notify.js';
import { errorText, type RunState, type StopReason, stopRun } from './run.js';
import { runDiscovery } from './stages/discovery.js';
import { runVerification } from './stages/verification.js';
import { breachText, formatInstant } from './text.js';
```

`packages/engine/src/execute.ts` — replace or add these declarations:

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

`packages/engine/src/normalise.ts` — the import block becomes:

```ts
import {
  type Cabin,
  type CapabilityInfo,
  type CellKey,
  type Clock,
  cellKeyString,
  type ErrorReason,
  type FxInfo,
  type IsoDate,
  type IsoDateTime,
  LINK_ALLOWLIST,
  NormalisationError,
  type NormalisedItinerary,
  normaliseOffer,
  type ObservationFields,
  type Offer,
  type PointOfSale,
  type Provenance,
  type ProviderId,
  priceInGbp,
  type RawCalendarPrice,
  type RawOffer,
  type SuppliedField,
  stripUrlsInText,
  validateVendorUrl,
} from '@gmt/core';
import type { AirportsRepo, CalendarPriceInsert, FxRepo } from '@gmt/db';
```

`packages/engine/src/normalise.ts` — replace or add these declarations:

```ts
export interface OfferContext {
  providerId: ProviderId;
  info: CapabilityInfo;
  cabin: Cabin;
  pointOfSale: PointOfSale;
  fetchedAt: IsoDateTime;
  suppliedFields: readonly SuppliedField[];
  partialExpansion: boolean;
}
export interface OfferWrite {
  itinerary: NormalisedItinerary;
  offer: Offer;
  observation: ObservationFields & {
    provenance: Provenance;
    suppliedFields: SuppliedField[];
    partialExpansion: boolean;
  };
}

/**
 * One raw offer → one observation write, or the reason it is dropped (spec §5.6). Everything is core's normaliseOffer
 * — airport zones, local times, hashing, the cell match, money with the FX flag, evidenced cabins, the validated
 * booking — fed the airports repository and the shared rateFor (one money pipeline, arch-013); only the provenance is
 * stamped here.
 */
export function offerWrite(
  raw: RawOffer,
  cell: CellKey,
  c: OfferContext,
  deps: RepoDeps,
): OfferWrite | NormalisationError {
  const r = normaliseOffer(raw, cell, {
    providerId: c.providerId,
    cabin: c.cabin,
    tzOf: (iata) => deps.airports.tzOf(iata),
    rateFor: (cur) => rateFor(deps, cur),
  });
  if (!r.ok) return r.error;
  // why: decision 27 — a price no seller listing confirmed is stored as unverified: without 'price' and 'segmentCabins'
  // in its supplied fields (and no cabin evidence), so the cabin verdict and any price constraint read unverified and
  // the row is never a verified fare
  const suppliedFields = raw.verified
    ? [...c.suppliedFields]
    : c.suppliedFields.filter((f) => f !== 'price' && f !== 'segmentCabins');
  const observation = raw.verified ? r.observation : { ...r.observation, segmentCabins: null };
  const provenance: Provenance = {
    providerId: c.providerId,
    sourceKind: c.info.sourceKind,
    fetchedAt: c.fetchedAt,
    maxAgeHours: c.info.maxAgeHours,
    fx: r.observation.fx,
    pointOfSale: c.pointOfSale,
    cabin: r.offer.cabin,
  };
  return {
    itinerary: r.itinerary,
    offer: r.offer,
    observation: {
      ...observation,
      provenance,
      suppliedFields,
      partialExpansion: c.partialExpansion,
    },
  };
}
```

`packages/engine/src/stages/verification.ts` (new file):

```ts
import {
  type CapabilityInfo,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type FlightProvider,
  generateCells,
  type ItineraryQuery,
  type ItinerarySearchResult,
  NormalisationError,
  PARTIAL_EXPANSION,
  type ProviderId,
  type RollUp,
  selectCandidates,
} from '@gmt/core';
import type { VerifiedCellWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { offerWrite } from '../normalise.js';
import { runPool } from '../pool.js';
import {
  laneFor,
  markRemaining,
  onFailure,
  type RunState,
  runnableCells,
  settleLane,
  stopRun,
} from '../run.js';
import { normaliseDeps } from './discovery.js';

/** The itinerary query for one cell from the frozen snapshot (spec §5.1 ItineraryQuery). */
export function itineraryQuery(snapshot: DefinitionSnapshot, cell: CellKey): ItineraryQuery {
  const p = snapshot.verification;
  return {
    origin: cell.origin,
    destination: cell.destination,
    departureDate: cell.departureDate,
    returnDate: cell.returnDate,
    cabin: snapshot.cabin,
    adults: 1,
    currency: 'GBP',
    expandTop: p.expandTop,
    bookingLinks: p.bookingLinks,
    ...(p.maxStops !== undefined ? { maxStops: p.maxStops } : {}),
  };
}

/**
 * The priced-outcome reason of decision 19's closed set: null, `partial-expansion`, `offers-dropped:n` or
 * `partial-expansion;offers-dropped:n` (core's PARTIAL_EXPANSION, `;` as the separator).
 */
export function pricedReason(partial: boolean, dropped: number): string | null {
  const parts = [
    ...(partial ? [PARTIAL_EXPANSION] : []),
    ...(dropped > 0 ? [`offers-dropped:${dropped}`] : []),
  ];
  return parts.length === 0 ? null : parts.join(';');
}

function discoveryRollUps(ctx: EngineContext, executionId: string): Map<string, RollUp> {
  return new Map([...ctx.repos.cells.rollUps(executionId)].map(([k, v]) => [k, v.discovery]));
}

/**
 * Spec §6.7: selection once, persisted with verification seeding in one transaction (spec §7); cells whose departure
 * date has arrived are never candidates (spec §8.1 departed, ssr-05) and are marked skipped:departed in the same
 * transaction; providers that do not sell the cabin, or are blocked for budget or disabled, are marked too. A child
 * bypasses selection.
 */
function persistSelection(ctx: EngineContext, run: RunState, ids: readonly ProviderId[]): void {
  const today = ctx.clock.todayLondon();
  const allCells = run.isChild && run.cell !== null ? [run.cell] : generateCells(run.snapshot.resolved);
  const live = (c: CellKey) => c.departureDate > today;
  const policy = {
    ...run.snapshot.verification,
    alwaysInclude: run.snapshot.verification.alwaysInclude.filter(live),
  };
  const selection =
    run.isChild && run.cell !== null
      ? live(run.cell)
        ? [{ cell: run.cell, reason: 'always_include' as const }]
        : []
      : selectCandidates(
          policy,
          generateCells(run.snapshot.resolved).filter(live),
          discoveryRollUps(ctx, run.executionId),
          run.snapshot.providers.discovery.length > 0,
        );
  ctx.db.transaction(() => {
    ctx.repos.cells.seedVerification(run.executionId, selection, allCells, [...ids]);
    ctx.repos.cells.markDeparted(run.executionId, today);
    for (const id of ids) {
      if (!(ctx.providers.get(id)?.cabins ?? []).includes(run.snapshot.cabin))
        ctx.repos.cells.markNoData(run.executionId, 'verification', id, 'cabin-not-offered');
      else if (run.blocked.has(id)) markRemaining(ctx, run, 'verification', id, 'budget');
      else if (run.disabled.has(id)) markRemaining(ctx, run, 'verification', id, 'provider_disabled');
    }
  });
  const reasons: Record<string, number> = {};
  for (const x of selection) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
  run.log.info(
    { stage: 'verification', selected: selection.length, reasons },
    'verification: selection persisted',
  );
}

/** Spec §8.1 "verification": selection, then a bounded pool of cells per provider. */
export async function runVerification(ctx: EngineContext, run: RunState): Promise<void> {
  const ids = run.snapshot.providers.verification.filter(
    (id) => ctx.providers.get(id)?.verification !== undefined,
  );
  if (ids.length === 0) return; // why: spec §3 "a stage with no provider configured has no outcome rows and a NULL roll-up"
  ctx.repos.executions.setStatus(run.executionId, 'running', { stage: 'verification' });
  // why: spec §6.7 "never recomputed on resume"; spec §7 "resume re-runs selection only when no verification outcomes exist"
  if (!ctx.repos.cells.hasVerificationOutcomes(run.executionId)) persistSelection(ctx, run, ids);
  await Promise.all(ids.map((id) => runVerificationProvider(ctx, run, id)));
  if (run.stop === null && ids.every((id) => run.disabled.has(id)))
    stopRun(run, { kind: 'all-disabled', stage: 'verification' });
}

async function runVerificationProvider(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
): Promise<void> {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined) return;
  const cells = runnableCells(ctx, run, 'verification', providerId);
  if (cells.length > 0) {
    const lane = laneFor(run, 'verification', providerId);
    run.log
      .child({ providerId })
      .info({ stage: 'verification', cells: cells.length }, 'verification: searching cells');
    await runPool(cells, ctx.limitsOf(providerId).concurrency, lane.intakeSignal, async (cell) => {
      const key = cellKeyString(cell);
      lane.inFlight.add(key);
      try {
        const result = await cap.search(itineraryQuery(run.snapshot, cell), {
          executionId: run.executionId,
          signal: run.controller.signal,
          recordFixtures: false,
        });
        // why: decisions 25 and 27 — a chain stopped by budget or cancel resolves with the offers it already paid for,
        // and they are written; only a fatal stop writes nothing more. A cancelled call that throws stays not_run (spec §9 item 4)
        if (run.stop?.kind === 'fatal') return;
        commitVerifiedCell(ctx, run, provider, cap.info, cell, result);
      } catch (err) {
        onFailure(ctx, run, providerId, 'verification', [cell], err);
      } finally {
        lane.inFlight.delete(key);
      }
    });
  }
  settleLane(ctx, run, 'verification', providerId);
}

type RouteHistoryRow = Parameters<EngineContext['repos']['routeHistory']['upsert']>[0][number];

/**
 * Spec §7 route_price_history (rev 10): the vendor's route-level lowest-price series, cabin unknown. Only points the
 * vendor states in GBP are stored: the table has no FX columns, and a past date converted at today's rate would be a
 * figure the vendor never gave (prov-wp07-007). Other points are dropped and counted.
 */
export function routeHistoryRows(
  providerId: ProviderId,
  cell: CellKey,
  result: ItinerarySearchResult,
): { rows: RouteHistoryRow[]; dropped: number } {
  const rows: RouteHistoryRow[] = [];
  let dropped = 0;
  for (const p of result.routeHistory ?? []) {
    if (p.currency.toUpperCase() !== 'GBP') {
      dropped += 1;
      continue;
    }
    rows.push({
      origin: cell.origin,
      destination: cell.destination,
      cabin: 'unknown',
      providerId,
      date: p.date,
      lowestPricePence: p.lowestPriceMinor,
      fetchedAt: result.fetchedAt,
    });
  }
  return { rows, dropped };
}

/**
 * Writes one verified cell atomically (spec §7: itinerary, segments, offer, observation, outcome, best_observation_id,
 * roll-up; the repository sets best_observation_id to the cheapest observation written and never downgrades priced to
 * empty; verdicts are read-time). Spec §3, §5.4, §5.6: `priced` iff ≥ 1 offer survives normalisation, reason from
 * `pricedReason`; `error` with the first normalisation reason when offers existed but none survived; `empty` only when
 * the provider answered coverage `empty` with no offers and no failed expansion. A result claiming priced coverage or
 * a partial expansion with no offer is a contract breach, recorded as `error` upstream, never as positive evidence of
 * no fares (prov-wp07-005).
 */
export function commitVerifiedCell(
  ctx: EngineContext,
  run: RunState,
  provider: FlightProvider,
  info: CapabilityInfo,
  cell: CellKey,
  result: ItinerarySearchResult,
): void {
  const pointOfSale = result.pointOfSale;
  const oc = {
    providerId: provider.id,
    info,
    cabin: run.snapshot.cabin,
    pointOfSale,
    fetchedAt: result.fetchedAt,
    suppliedFields: provider.suppliedFields,
    partialExpansion: result.partial,
  };
  const deps = normaliseDeps(ctx);
  const groups = new Map<string, VerifiedCellWrite['itineraries'][number]>();
  let written = 0;
  let minPence: number | null = null;
  let dropped = 0;
  let firstFailure: NormalisationError | null = null;
  for (const raw of result.offers) {
    const w = offerWrite(raw, cell, oc, deps);
    if (w instanceof NormalisationError) {
      dropped += 1;
      firstFailure ??= w;
      continue;
    }
    const g = groups.get(w.itinerary.hash) ?? { itinerary: w.itinerary, offers: [] };
    g.offers.push({ offer: w.offer, observation: w.observation });
    groups.set(w.itinerary.hash, g);
    written += 1;
    minPence = minPence === null ? w.observation.pricePence : Math.min(minPence, w.observation.pricePence);
  }
  const base = {
    origin: cell.origin,
    destination: cell.destination,
    departureDate: cell.departureDate,
    returnDate: cell.returnDate,
    fetchedAt: result.fetchedAt,
    cabin: run.snapshot.cabin,
    pointOfSale,
    sourceKind: info.sourceKind,
  };
  let outcome: VerifiedCellWrite['outcome'];
  if (written > 0)
    outcome = {
      ...base,
      status: 'priced',
      reason: pricedReason(result.partial, dropped),
      lastError: firstFailure?.message ?? null,
      minPence,
    };
  else if (firstFailure !== null)
    outcome = {
      ...base,
      status: 'error',
      reason: firstFailure.reason,
      lastError: firstFailure.message,
      minPence: null,
    };
  else if (result.coverage === 'empty' && !result.partial)
    outcome = { ...base, status: 'empty', reason: null, lastError: null, minPence: null };
  else {
    const breach = `the provider answered coverage ${result.coverage}${result.partial ? ` with ${result.failedExpansions} failed expansions` : ''} but returned no offer`;
    run.log
      .child({ providerId: provider.id })
      .warn(
        { stage: 'verification', coverage: result.coverage, partial: result.partial },
        'verification: result contradicts itself; cell marked error',
      );
    outcome = { ...base, status: 'error', reason: 'upstream', lastError: breach, minPence: null };
  }
  const history = routeHistoryRows(provider.id, cell, result);
  ctx.db.transaction(() => {
    ctx.repos.cells.writeVerifiedCell(run.executionId, provider.id, {
      cell,
      outcome,
      itineraries: [...groups.values()],
    });
    if (history.rows.length > 0) ctx.repos.routeHistory.upsert(history.rows);
  });
  run.parseStreak.set(provider.id, 0);
  const log = run.log.child({ providerId: provider.id });
  if (dropped > 0)
    log.warn(
      { stage: 'verification', dropped, reason: firstFailure?.reason ?? null },
      'verification: offers dropped in normalisation',
    );
  if (history.dropped > 0)
    log.debug(
      { stage: 'verification', dropped: history.dropped },
      'verification: route history points not in GBP dropped',
    );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run verification && pnpm --filter @gmt/core test`
Expected: PASS, 17 engine tests; core's suite green at its 100% thresholds.

- [ ] **Step 5: Commit**

```bash
git add packages/engine packages/core && git commit -m "wp07: verification stage with once-only selection, offer normalisation, verified-cell write, GBP route history; priceConfirmed verdict

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.9: The §8.1 error table in the verification stage; cancel mid-expansion; `no-return-legs` and `no-priced-options`

**Files:**
- Create: `packages/engine/test/error-table-verification.test.ts`

**Interfaces:**
- Consumes: Tasks 7.4 and 7.8 (the stage runners share `onFailure`), WP4's `/itinerary` rules, `throwOnSearch`.
- Produces: nothing new; it pins the verification stage's error handling. `no-return-legs` and `no-priced-options` errors are stored under their own reasons (Task 7.4, decision 37), which the resume query never returns, so `runnableCells` needs no filter of its own and a resume estimate never counts them (Tasks 7.12, 7.14).

The stage runner applies the error table through its own catch, which calls the shared `onFailure`; the rows are seen failing first by removing that call (Step 2), so a regression in the runner's catch path or its lane wiring is caught here and not only in discovery (test-strategy-reviewer-015). The no-return-legs and no-priced-options tests assert the exact runnable set for both automatic and manual passes, with no conditional; the cancel test asserts the searched rows exist before it asserts their status.

- [ ] **Step 1: Write the tests**

`packages/engine/test/error-table-verification.test.ts` (new file):

```ts
import { ProviderError } from '@gmt/core';
import type { FixtureRule } from '@gmt/providers/fixture';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { addSeconds } from '../src/errors.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { newRun, runnableCells } from '../src/run.js';
import {
  createHarness,
  FIXTURE_RULES,
  type Harness,
  type HarnessOptions,
  itineraryRule,
  T0,
  withVerification,
} from './support/harness.js';
import { throwOnSearch } from './support/wrappers.js';

const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const verifying = (h: Harness, maxCells: number) =>
  h.createDefinition({
    providers: withVerification(),
    verification: { maxCells, topN: maxCells, alwaysInclude: [], expandTop: 1, bookingLinks: true },
  });
const searched = (h: Harness, id: string) =>
  h.outcomes(id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');

/** Runs a definition with `maxCells` selected cells under WP4 rules on /itinerary; fake timers drive the backoff; one call at a time. */
async function run(rules: FixtureRule[], maxCells: number, opts: HarnessOptions = {}) {
  const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true, ...opts });
  await h.fixtureScenario(rules);
  const ctx = buildContext(h.deps, h.options);
  const scheduleResume = vi.fn();
  ctx.hooks.scheduleResume = scheduleResume;
  const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), verifying(h, maxCells).id);
  return { h, ctx, e, scheduleResume };
}

describe('error table, verification stage (spec §8.1; the rows share onFailure with discovery, Task 7.4)', () => {
  // why: one selected cell, so every attempt the rule answers (three for a retryable kind) belongs to that cell
  it.each([
    ['rate-limit', FIXTURE_RULES.rateLimit, 3],
    ['upstream', FIXTURE_RULES.upstream, 3],
    ['network', FIXTURE_RULES.network, 3],
    ['parse', FIXTURE_RULES.badRequest, 1],
  ] as const)(
    '%s on the searched cell → that cell error, attempts 1; the run completes',
    async (reason, respond, times) => {
      const { h, e } = await run([itineraryRule(respond, times)], 1);
      expect(e.status).toBe('completed');
      expect(searched(h, e.id)).toEqual([expect.objectContaining({ status: 'error', reason, attempts: 1 })]);
    },
  );

  it('two consecutive parse errors disable the provider; remaining selected cells skipped:provider_disabled; paused_error', async () => {
    const { h, e } = await run([itineraryRule(FIXTURE_RULES.badRequest, 2)], 4);
    expect(e.status).toBe('paused_error');
    const s = searched(h, e.id);
    expect(s.filter((o) => o.status === 'error' && o.reason === 'parse')).toHaveLength(2);
    expect(s.filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')).toHaveLength(2);
    expect(kinds(h)).toEqual(['provider_disabled', 'paused_error']);
  });

  it.each([
    ['auth', FIXTURE_RULES.auth],
    ['quota', FIXTURE_RULES.quota],
  ] as const)('%s disables the provider; none remain → paused_error', async (reason, respond) => {
    const { h, e } = await run([itineraryRule(respond, 1)], 4);
    expect(e.status).toBe('paused_error');
    const s = searched(h, e.id);
    expect(s.filter((o) => o.status === 'error')).toEqual([expect.objectContaining({ reason })]);
    expect(s.filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')).toHaveLength(3);
  });

  it('limiter-timeout → the cell returns to not_run; paused_error with resume_after; one-shot job requested', async () => {
    const { h, e, scheduleResume } = await run([itineraryRule(FIXTURE_RULES.limiterTimeout, 3)], 1);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBe(addSeconds(T0, 4000));
    expect(scheduleResume).toHaveBeenCalledWith(e.id, e.definitionId, addSeconds(T0, 4000));
    expect(searched(h, e.id)).toEqual([expect.objectContaining({ status: 'not_run' })]);
  });

  it('upstream with reason no-return-legs (WP4 rule) → error no-return-legs, which no resume query returns (spec §5.4, §7)', async () => {
    const { h, ctx, e } = await run([itineraryRule(FIXTURE_RULES.noReturnLegs)], 2);
    expect(e.status).toBe('completed');
    const s = searched(h, e.id);
    expect(s).toHaveLength(2);
    expect(s.every((o) => o.status === 'error' && o.reason === 'no-return-legs')).toBe(true);
    for (const manual of [false, true])
      expect(
        runnableCells(
          ctx,
          newRun(ctx, e, { manual, fresh: false, blocked: new Set() }),
          'verification',
          'fixture',
        ),
      ).toEqual([]);
  });

  it('upstream with reason no-priced-options → error no-priced-options; never retried, automatically or manually (spec §5.4, decision 37)', async () => {
    const err = new ProviderError({
      kind: 'upstream',
      retryable: false,
      reason: 'no-priced-options',
      providerId: 'fixture',
      message: 'step 1 returned options and none was priced',
    });
    const { h, ctx, e } = await run([], 2, { transformFixture: (p) => throwOnSearch(p, err, () => true) });
    expect(e.status).toBe('completed');
    const s = searched(h, e.id);
    expect(s).toHaveLength(2);
    expect(
      s.every(
        (o) =>
          o.status === 'error' &&
          o.reason === 'no-priced-options' &&
          o.lastError === 'step 1 returned options and none was priced',
      ),
    ).toBe(true);
    // why: the reason itself keeps them out of the repository's resume query (db NON_RETRYABLE), so no engine filter exists
    expect(h.repos.cells.resumable(e.id, 'verification', 'fixture', true)).toEqual([]);
    for (const manual of [false, true])
      expect(
        runnableCells(
          ctx,
          newRun(ctx, e, { manual, fresh: false, blocked: new Set() }),
          'verification',
          'fixture',
        ),
      ).toEqual([]);
  });
});

describe('cancel mid expansion → not_run, no itinerary (spec §9 item 4)', () => {
  it('a held itinerary call that is cancelled writes nothing for its cell', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold)]);
    const orch = h.orch();
    const r = await orch.start(verifying(h, 4).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    expect(await orch.cancel(r.executionId)).toBe(true);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('cancelled');
    const s = searched(h, e.id);
    expect(s).toHaveLength(4);
    expect(s.every((o) => o.status === 'not_run')).toBe(true);
    expect(h.count('price_observations', e.id)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, then see the rows fail**

Run: `pnpm --filter @gmt/engine exec vitest run error-table-verification`
Expected: PASS, 11 tests, against Tasks 7.4 and 7.8. To see the rows fail, replace the runner's `onFailure(ctx, run, providerId, 'verification', [cell], err);` in `runVerificationProvider` (`src/stages/verification.ts`) with `void err;` and run it again: 10 of the 11 fail (every error-table row, `no-return-legs` and `no-priced-options`; the cancel test passes, since a cancelled call writes nothing either way). Restore the line.

- [ ] **Step 3: Implement**

Nothing to add: the tests pin Tasks 7.4 and 7.8.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run error-table-verification`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: verification-stage error table, cancel mid-expansion, no-return-legs and no-priced-options never retried

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.10: Budget breaches mid-run, per scope; the alerts step; "alerts running on calendar basis only"

**Files:**
- Create: `packages/engine/test/budget-breach.test.ts`
- Modify: `packages/engine/src/run.ts` (`applyBudgetBreach`, `budgetOut`, `settleLane`), `src/execute.ts` (`execute`, `alertsStep`, `calendarOnlyNotice`, `finish`), `src/text.ts`

**Interfaces:**
- Consumes: `BudgetExceeded` (`scope`, `cap`, `current`, `requested`, `providerId`), `BudgetGuard.usage(scope).windowEnd`, `AlertsRepo.rules`, `formatPence`.
- Produces: `applyBudgetBreach(ctx, run, providerId, stage, err)`, `budgetOut(ctx, run, stage, providerId)`, `settleLane`; `alertsStep(ctx, run)` and `calendarOnlyNotice(ctx, run, alertsRan)`; the harness options `fixtureBillable` and `fixtureWindow` are used from here on.

Decision 25 governs every row: a reservation that passed every cap is honoured, so nothing in flight is aborted on a budget stop; the pass or the lane only stops taking new work, the call that reserved finishes and its result is written, and only the next reservation is refused (cost-r1-002). The tests pin that the one call that passed is written (14 priced cells) while the rest stay `not_run` (execution-*) or become `skipped:budget` (provider and global scopes), and that the ledger shows no call after the breach (test-strategy-reviewer-006). Two executions started together never exceed a shared cap (cost-r1-012). Every scope has a mid-run test: execution-calls, execution-cost (the spend cap, in pounds), execution-free-calls (the guard told the fixture is free), provider-month and global-month, each asserting the ledger holds no call after the pre-spent rows (test-strategy-reviewer-027).

A provider-month breach follows spec §7's two rows (decision 37): when another provider of the stage can still run, the capped provider's remaining cells become `skipped:budget` in this run and the pass goes on, with a `provider_capped` notice that says so and how they get searched (a manual resume once the window reopens or the cap is raised, or the next scheduled run; prov-wp07-r2-003); when none can, the run pauses `paused_budget` with `resume_after` at the window reopening and a one-shot job. A provider the pre-start or resume check blocked does not count as remaining (ssr2-02). Layer A registers only the fixture, so these two cases run `applyBudgetBreach` on a pass whose snapshot names a second discovery provider.

The alerts step runs when a pass completes and when it pauses for a cap (`paused_budget`), never after a pause for errors, a cancel or a SIGTERM (decision 25, po-002, test-strategy-reviewer-026); WP11's runner keeps one digest per rule per execution. The `paused_budget` notice says when the run resumes by itself and that a run too old by then is cancelled instead (Task 7.17). The calendar-only notice is sent only by a pass whose alerts step ran, whose verification has `skipped:budget` cells, for a definition with an alert rule (po-001, prov-wp07-003). Budget notices state cost scopes in pounds through core's `formatPence` and call scopes as calls (arch-018, po-012, prov-wp07-009); instants read in the schedule's time zone (po-015).

The tests with a small call cap start with a confirmation (`confirmCostPence: 100`, and from Task 7.13 `confirmCalls: 1000` beside it), because Task 7.13's confirmation rule asks before a run that needs more than 20% of the monthly call cap.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/budget-breach.test.ts` (new file):

```ts
import { asIsoDateTime, BudgetExceeded, type Execution, type ProviderId } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { finalStatus } from '../src/execute.js';
import { renderOperatorMessage } from '../src/notifiers/operatorTemplates.js';
import { createOrchestrator, type Orchestrator } from '../src/orchestrator.js';
import { applyBudgetBreach, newRun } from '../src/run.js';
import {
  createHarness,
  EWR,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  JFK,
  LGW,
  LHR,
  tileRule,
  withVerification,
} from './support/harness.js';

const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const spent = (h: Harness, id: string) =>
  h.ledgerRows(id).filter((r) => r.endpointPath !== '/test-spend' && r.outcome !== 'cache_hit');
// why: a small call cap makes the run ask for confirmation (ruling 6, Task 7.13); every start here confirms up front
const confirmed = { trigger: 'manual', confirmCostPence: 100 } as const;
const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });
const rule = (h: Harness, definitionId: string) =>
  h.repos.alerts.create({
    definitionId,
    type: 'absolute',
    thresholdPence: 100_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });

describe('BudgetExceeded execution-* (spec §8.1, decision 25)', () => {
  it('concurrency 4 with 1 call left → exactly 1 billable call, and its tile is written; the others stay not_run; paused_budget; never an error', async () => {
    const h = createHarness({ fixtureConcurrency: 4 });
    const def = twoPairs(h, { budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    // why: spend arrives after the pre-start check, as a concurrent pass of the same execution would leave it
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }),
    );
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), def.id);
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBeNull();
    expect(scheduleResume).not.toHaveBeenCalled();
    expect(spent(h, e.id)).toHaveLength(1);
    // why: the reservation that passed is honoured (decision 25): its 14 cells are priced, the other three tiles never reserved
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(42);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['paused_budget']);
    expect(h.notifications[0]?.body).toContain("this run's billed-call cap is 50 calls; 50 calls used");
  });

  it('execution-cost: the spend cap stops the pass before the call that would pass it (test-strategy-reviewer-027)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h, { budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 100_000 } });
    // why: after the pre-start check the execution has spent all but 3 199 µGBP, less than one 3 200 µGBP call
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 100_000 - 3_199, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e).toMatchObject({ status: 'paused_budget', resumeAfter: null });
    expect(spent(h, e.id)).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(56);
    expect(h.notifications[0]?.body).toContain(
      "this run's spend cap is £0.10; £0.10 used; the next call needed £0.01",
    );
  });

  it('execution-free-calls: a free provider stops at the free-call cap before its next call', async () => {
    // why: the guard counts the fixture as free here, as it does Travelpayouts
    const h = createHarness({ fixtureConcurrency: 1, fixtureBillable: false });
    const def = twoPairs(h, { budget: { maxCalls: 1000, maxFreeCalls: 1, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 0, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e).toMatchObject({ status: 'paused_budget', resumeAfter: null });
    expect(spent(h, e.id)).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(56);
    expect(h.notifications[0]?.body).toContain(
      "this run's free-call cap is 1 call; 1 call used; the next call needed 1 call",
    );
  });
});

describe('BudgetExceeded provider-month with another provider in the stage (spec §8.1; ssr2-02, prov-wp07-r2-003)', () => {
  /**
   * A running execution whose snapshot lists a second discovery provider. Layer A registers only the fixture, so the
   * second provider exists in the snapshot alone: blocked by the pre-start check, or still able to run.
   */
  async function breachWithSecondProvider(blocked: ProviderId[]) {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const ctx = buildContext(h.deps, h.options);
    const r = await h.orch().start(h.createDefinition().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const exec = h.repos.executions.get(r.executionId);
    if (exec === null) throw new Error('missing execution');
    const two: Execution = {
      ...exec,
      snapshot: {
        ...exec.snapshot,
        providers: { ...exec.snapshot.providers, discovery: ['fixture', 'travelpayouts'] },
      },
    };
    const run = newRun(ctx, two, { manual: false, fresh: false, blocked: new Set(blocked) });
    const err = new BudgetExceeded({
      scope: 'provider-month',
      providerId: 'fixture',
      cap: 20,
      current: 20,
      requested: 1,
    });
    applyBudgetBreach(ctx, run, 'fixture', 'discovery', err);
    return { h, run };
  }

  it('a provider the pre-start check blocked does not remain: the pass pauses until the window reopens (ssr2-02)', async () => {
    const { h, run } = await breachWithSecondProvider(['travelpayouts']);
    expect(run.stop).toMatchObject({
      kind: 'budget',
      resumeAfter: h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd,
    });
    expect(run.notices).toEqual([]);
  });

  it('a provider that can still run remains: the pass goes on, and the notice says the capped cells stay skipped in this run', async () => {
    const { run } = await breachWithSecondProvider([]);
    expect(run.stop).toBeNull();
    expect(run.notices.map((n) => n.kind)).toEqual(['provider_capped']);
    const { body } = renderOperatorMessage('provider_capped', {
      definitionName: 'x',
      executionId: null,
      detail: run.notices[0]?.detail ?? '',
    });
    expect(body).toContain('Its remaining discovery cells are skipped (budget) in this run');
    expect(body).toContain(
      'resume the run by hand once the cap window reopens or the cap is raised, or the next scheduled run searches them',
    );
  });
});

describe('BudgetExceeded provider-month (spec §8.1)', () => {
  it('no other provider remains: remaining cells skipped:budget; paused_budget with resume_after = next window start; one-shot job; no call after the breach', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), twoPairs(h).id, confirmed);
    const windowEnd = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd;
    expect(windowEnd).toBe('2026-11-01T00:00:00.000Z');
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBe(windowEnd);
    expect(scheduleResume).toHaveBeenCalledWith(e.id, e.definitionId, windowEnd);
    expect(spent(h, e.id)).toHaveLength(1); // 19 pre-spent + 1 = the cap; nothing reserved after the breach
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(42);
    expect(h.outcomes(e.id, { status: 'skipped' }).every((o) => o.reason === 'budget')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['paused_budget']);
  });

  it('two executions sharing the cap never exceed it together; the one that hits it pauses at the window start (cost-r1-012)', async () => {
    // why: each needs 5 calls (4 tiles × 1.2) and both pass the pre-start check against an empty ledger; together they need 8 > 7
    const h = createHarness({ fixtureConcurrency: 2, fixtureMonthlyCallCap: 7 });
    const orch = h.orch();
    // why: other pairs than the first definition's, so http-kit never joins one request to the other's (in-flight dedup)
    const [a, b] = await Promise.all([
      orch.start(twoPairs(h).id, confirmed),
      orch.start(twoPairs(h, { name: 'second', destinations: [EWR] }).id, confirmed),
    ]);
    if (!a.ok || !b.ok) throw new Error('start refused');
    const both = [await h.waitForSettled(a.executionId), await h.waitForSettled(b.executionId)];
    expect(both.reduce((n, e) => n + spent(h, e.id).length, 0)).toBe(7);
    expect(h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls).toBe(7);
    const paused = both.filter((e) => e.status === 'paused_budget');
    expect(paused.length).toBeGreaterThan(0);
    for (const e of paused) expect(e.resumeAfter).toBe('2026-11-01T00:00:00.000Z');
    for (const e of both) {
      expect(['paused_budget', 'completed']).toContain(e.status);
      expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
      expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    }
  });
});

describe('BudgetExceeded global-month (spec §8.1 with decision 25)', () => {
  it('the in-flight call that reserved is written; the sibling refused at reserve and every idle cell become skipped:budget; paused_budget at the global window start', async () => {
    const h = createHarness({ fixtureConcurrency: 2 });
    // why: after the pre-start check, another process leaves room for exactly one fixture call under the £1,000 global cap
    h.onStageStart('discovery', () =>
      h.spendLedger({
        providerId: 'fixture',
        rows: 1,
        costMicroGbpEach: 1_000_000_000 - FIXTURE_COST_MICRO_GBP,
      }),
    );
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK, EWR] }); // 4 pairs × 2 tiles; the fixture pool holds 2
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBe(h.deps.budget.usage({ kind: 'global-month' }).windowEnd);
    expect(spent(h, e.id)).toHaveLength(1);
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(98);
    expect(h.outcomes(e.id, { status: 'skipped' }).every((o) => o.reason === 'budget')).toBe(true);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.notifications[0]?.body).toContain('the monthly spend cap is £1,000');
  });

  it('cost scopes read as money, call scopes as calls; never a bare micro-GBP figure (arch-018)', () => {
    const notice = finalStatus(
      {
        kind: 'budget',
        error: new BudgetExceeded({
          scope: 'global-month',
          cap: 350_000_000,
          current: 350_000_000,
          requested: 3200,
        }),
        resumeAfter: asIsoDateTime('2026-11-01T00:00:00.000Z'),
      },
      asIsoDateTime('2026-10-14T09:00:00.000Z'),
      'Europe/London',
    ).notice;
    expect(notice?.detail).toContain('the monthly spend cap is £350; £350 used; the next call needed £0.01');
    expect(notice?.detail).toContain('Sun, 1 Nov 2026, 00:00 (Europe/London)');
    expect(notice?.detail).not.toMatch(/350000000|3200/);
  });
});

describe('the alerts step and "alerts running on calendar basis only" (spec §6.8, §8.1, decision 25)', () => {
  it('runs once after a completed pass with (deps, executionId); a failing hook is logged, not fatal', async () => {
    const h = createHarness();
    const alerts = vi.fn(async () => ({ digests: 1, events: 2 }));
    const orch = h.orch({ ...h.options, alerts });
    const done = await h.runToCompletion(orch, h.createDefinition().id);
    expect(done.status).toBe('completed');
    expect(alerts).toHaveBeenCalledExactlyOnceWith(h.deps, done.id);
    alerts.mockRejectedValueOnce(new Error('digest render failed'));
    const second = await h.runToCompletion(orch, h.createDefinition().id);
    expect(second.status).toBe('completed');
    expect(h.logs.some((l) => l.msg === 'alerts: step failed')).toBe(true);
  });

  it('never runs after a pass that paused for errors', async () => {
    const h = createHarness({ fakeTimers: true });
    const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const paused = await h.runToCompletion(h.orch({ ...h.options, alerts }), h.createDefinition().id);
    expect(paused.status).toBe('paused_error');
    expect(alerts).not.toHaveBeenCalled();
  });

  it.each([
    ['cancel', (o: Orchestrator, id: string) => o.cancel(id), 'cancelled'],
    ['SIGTERM', (o: Orchestrator) => o.shutdown(), 'interrupted'],
  ] as const)(
    'never runs after a pass stopped by %s (decision 25, test-strategy-reviewer-026)',
    async (_name, stop, status) => {
      const h = createHarness();
      const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
      await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
      const orch = h.orch({ ...h.options, alerts });
      const r = await orch.start(h.createDefinition().id, { trigger: 'manual' });
      if (!r.ok) throw new Error(r.message);
      await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(0));
      await stop(orch, r.executionId);
      expect((await h.waitForSettled(r.executionId)).status).toBe(status);
      expect(alerts).not.toHaveBeenCalled();
    },
  );

  it('a provider-month breach in verification pauses for the window, runs the alerts step over what was written, and tells the operator once', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const def = h.createDefinition({ providers: withVerification() });
    rule(h, def.id);
    const e = await h.runToCompletion(h.orch({ ...h.options, alerts }), def.id);
    expect(e.status).toBe('paused_budget');
    expect(alerts).toHaveBeenCalledExactlyOnceWith(h.deps, e.id);
    const v = h.outcomes(e.id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');
    expect(v).toHaveLength(2);
    expect(v.every((o) => o.status === 'skipped' && o.reason === 'budget')).toBe(true);
    expect(kinds(h)).toEqual(['paused_budget', 'alerts_calendar_only']);
  });

  it('no calendar-only notice when the definition has no alert rule', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ providers: withVerification() }).id);
    expect(e.status).toBe('paused_budget');
    expect(kinds(h)).toEqual(['paused_budget']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run budget-breach`
Expected: FAIL: 7 of 15 fail: `applyBudgetBreach is not a function` (the two second-provider tests), `expected null to be '2026-11-01T00:00:00.000Z'` (the provider-month and global-month pauses get no `resume_after`), and `expected "vi.fn()" to be called once with arguments` (the alerts hook never runs).

- [ ] **Step 3: Implement**

`packages/engine/src/execute.ts` — replace the file:

```ts
import type { ExecutionStatus, IsoDateTime, OperatorMessageKind } from '@gmt/core';
import type { ExecutionPatch } from '@gmt/db';
import type { EngineContext } from './context.js';
import { notifyOperator } from './notify.js';
import { errorText, type RunState, type StopReason, stopRun } from './run.js';
import { runDiscovery } from './stages/discovery.js';
import { runVerification } from './stages/verification.js';
import { breachText, formatInstant } from './text.js';

/**
 * Runs one pass: discovery, verification (spec §8.1 order), the alerts step, then finish. A stage error that escapes
 * stops the pass as fatal.
 */
export async function execute(ctx: EngineContext, run: RunState): Promise<void> {
  try {
    await runDiscovery(ctx, run);
    if (run.stop === null) await runVerification(ctx, run);
  } catch (err) {
    stopRun(run, { kind: 'fatal', message: errorText(err) });
  }
  const alertsRan = await alertsStep(ctx, run);
  await finish(ctx, run, alertsRan);
}

/**
 * Spec §8.1 "alerts: evaluateAlertRules → persist events → notify digests", through the AlertsStepHook (WP11's
 * runAlerts). Decision 25: it runs when the pass completed and when it paused for a cap window (paused_budget), over
 * what the execution has written; WP11 keeps one digest per rule per execution, so a later pass of the same execution
 * never repeats one. A failing hook is logged and never pauses a finished search. Returns whether the step ran.
 */
export async function alertsStep(ctx: EngineContext, run: RunState): Promise<boolean> {
  if (run.stop !== null && run.stop.kind !== 'budget') return false;
  try {
    const r = await ctx.alertsStep(ctx.deps, run.executionId);
    run.log.info({ digests: r.digests, events: r.events }, 'alerts: step done');
    return true;
  } catch (err) {
    run.log.error({ err: errorText(err) }, 'alerts: step failed');
    return false;
  }
}

/**
 * Spec §6.8/§8.1 "When verification is budget-skipped the operator is told 'alerts running on calendar basis only'":
 * only from a pass whose alerts step actually ran (po-001), whose verification has skipped:budget cells, for a
 * definition with an alert rule.
 */
export function calendarOnlyNotice(ctx: EngineContext, run: RunState, alertsRan: boolean): Notice | null {
  if (!alertsRan) return null;
  if (!ctx.repos.alerts.rules(run.definitionId).some((r) => r.enabled)) return null;
  const skipped = ctx.repos.cells
    .outcomes(run.executionId, { stage: 'verification' })
    .filter((o) => o.status === 'skipped' && o.reason === 'budget').length;
  if (skipped === 0) return null;
  return {
    kind: 'alerts_calendar_only',
    detail: `${skipped} selected ${skipped === 1 ? 'cell was' : 'cells were'} skipped for budget, so the alert rules judged their calendar prices only.`,
  };
}

export interface Notice {
  kind: OperatorMessageKind;
  detail: string;
}

/** Maps a stop reason to the execution status, patch and operator notice of spec §8.1. Pure; `tz` renders instants. */
export function finalStatus(
  stop: StopReason | null,
  now: IsoDateTime,
  tz: string,
): { status: ExecutionStatus; patch: ExecutionPatch; notice: Notice | null } {
  if (stop === null)
    return {
      status: 'completed',
      patch: { finishedAt: now, resumeAfter: null, errorText: null },
      notice: null,
    };
  switch (stop.kind) {
    case 'sigterm':
      // why: spec §8.1 "SIGTERM: … status interrupted without incrementing the counter"
      return {
        status: 'interrupted',
        patch: {},
        notice: {
          kind: 'interrupted',
          detail: 'The app stopped during this run; cells that were in flight went back to not searched.',
        },
      };
    case 'cancel':
      return { status: 'cancelled', patch: { finishedAt: now, resumeAfter: null }, notice: null };
    case 'limiter-timeout':
      return {
        status: 'paused_error',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_error',
          detail:
            stop.resumeAfter === null
              ? 'A provider rate window is full and its reopening time is not known; resume the run manually.'
              : `A provider rate window is full; the run resumes automatically on ${formatInstant(stop.resumeAfter, tz)}.`,
        },
      };
    case 'budget': {
      const e = stop.error;
      const when =
        stop.resumeAfter === null
          ? 'It needs a cap change, or a manual resume after editing the definition.'
          : `It resumes automatically on ${formatInstant(stop.resumeAfter, tz)}, when the cap window reopens; if by then it is older than its discovery refresh allows, it is cancelled instead and the next run starts with fresh prices.`;
      return {
        status: 'paused_budget',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_budget',
          detail: `The cap was reached: ${breachText(e.scope, e.providerId ?? null, e.cap, e.current, e.requested, 'the next call needed')}. ${when}`,
        },
      };
    }
    case 'all-disabled':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null },
        notice: {
          kind: 'paused_error',
          detail: `Every ${stop.stage} provider was disabled after errors; resume manually once the cause is fixed.`,
        },
      };
    case 'fatal':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null, errorText: stop.message },
        notice: { kind: 'paused_error', detail: `The run stopped on an internal error: ${stop.message}` },
      };
  }
}

/**
 * Writes the pass's final status after sending its notices. The status write is the last act, so anyone who observes a
 * final status also observes every write and notification of the pass.
 */
export async function finish(ctx: EngineContext, run: RunState, alertsRan: boolean): Promise<void> {
  const { status, patch, notice } = finalStatus(run.stop, ctx.clock.now(), run.snapshot.scheduleTz);
  const notices = notice === null ? [...run.notices] : [...run.notices, notice];
  const calendarOnly = calendarOnlyNotice(ctx, run, alertsRan);
  if (calendarOnly !== null) notices.push(calendarOnly);
  const name = ctx.repos.definitions.get(run.definitionId)?.name ?? run.snapshot.name;
  for (const n of notices) {
    await notifyOperator(ctx, n.kind, {
      executionId: run.executionId,
      definitionId: run.definitionId,
      definitionName: name,
      detail: n.detail,
    });
  }
  ctx.repos.executions.setStatus(run.executionId, status, patch);
  if (patch.resumeAfter !== undefined && patch.resumeAfter !== null)
    ctx.hooks.scheduleResume(run.executionId, run.definitionId, patch.resumeAfter);
  run.log.info({ status, notices: notices.map((n) => n.kind) }, 'execution: pass finished');
}
```

`packages/engine/src/run.ts` — the import block becomes:

```ts
import {
  type BudgetExceeded,
  type BudgetScope,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  type IsoDateTime,
  type Logger,
  type OperatorMessageKind,
  type ProviderId,
  type SkipReason,
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { classifyFailure } from './errors.js';
import { breachText } from './text.js';
```

`packages/engine/src/run.ts` — replace or add these declarations:

```ts
/**
 * Applies the spec §8.1 error table to one failed tile (discovery) or cell (verification) call. The cells of the call
 * are `cells`; nothing has been written for them yet.
 */
export function onFailure(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  stage: Stage,
  cells: readonly CellKey[],
  err: unknown,
): void {
  const d = classifyFailure(err, run.controller.signal.aborted, ctx.clock.now());
  const log = run.log.child({ providerId });
  switch (d.kind) {
    case 'abort':
      return; // why: spec §3 "a cell interrupted mid-flight returns to not_run" — nothing was written, so it still is
    case 'cell-error': {
      if (stage === 'discovery')
        ctx.repos.cells.writeTileError(run.executionId, providerId, [...cells], d.reason, d.lastError);
      else {
        ctx.db.transaction(() => {
          for (const cell of cells)
            ctx.repos.cells.setOutcome(run.executionId, cell, stage, providerId, {
              status: 'error',
              reason: d.reason,
              lastError: d.lastError,
              incrementAttempts: true,
            });
        });
      }
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
      applyBudgetBreach(ctx, run, providerId, stage, d.error);
      return;
    case 'fatal':
      log.error({ stage, err: d.message }, 'unexpected failure; pausing');
      stopRun(run, { kind: 'fatal', message: d.message });
      return;
  }
}

function stageProviders(run: RunState, stage: Stage): readonly ProviderId[] {
  return stage === 'discovery' ? run.snapshot.providers.discovery : run.snapshot.providers.verification;
}

/**
 * Takes one provider out of a stage for budget: its lane stops taking cells and its idle `not_run` cells become
 * skipped:budget now; calls already in flight passed every cap when they reserved, so they finish and are written
 * (decision 25); settleLane marks what is still not_run once the pool drains.
 */
export function budgetOut(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId): void {
  const lane = laneFor(run, stage, providerId);
  if (lane.budgetOut) return;
  lane.budgetOut = true;
  lane.intake.abort();
  markRemaining(ctx, run, stage, providerId, 'budget', lane.inFlight);
}

/**
 * Spec §8.1 error table, BudgetExceeded rows, with decision 25 (a reservation that passed every cap is honoured; only
 * new reservations are refused; nothing in flight is aborted):
 * - execution-*: the pass takes no new work; cells not started stay not_run; paused_budget, no one-shot job.
 * - provider-month / provider-lifetime: that provider's remaining cells in the stage skipped:budget; others remain →
 *   continue and notify once; none remain → paused_budget, resume_after = the provider's next window start (a
 *   lifetime window has none, so no one-shot job).
 * - global-month: billed providers' remaining cells skipped:budget; a free provider remains → continue; else
 *   paused_budget at the global window start.
 * BudgetExceeded is never recorded as a cell error.
 */
export function applyBudgetBreach(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  stage: Stage,
  err: BudgetExceeded,
): void {
  run.log
    .child({ providerId })
    .warn(
      { stage, scope: err.scope, cap: err.cap, current: err.current, requested: err.requested },
      'budget cap reached',
    );
  if (
    err.scope === 'execution-calls' ||
    err.scope === 'execution-free-calls' ||
    err.scope === 'execution-cost'
  ) {
    stopRun(run, { kind: 'budget', error: err, resumeAfter: null });
    return;
  }
  const ids = stageProviders(run, stage);
  const global = err.scope === 'global-month';
  const affected = global ? ids.filter((id) => ctx.limitsOf(id).billed) : [providerId];
  for (const id of affected) budgetOut(ctx, run, stage, id);
  // why: ssr2-02 — a provider the pre-start or resume check blocked for budget does not remain in the stage either
  const remaining = ids.filter(
    (id) => !run.disabled.has(id) && !run.blocked.has(id) && !laneFor(run, stage, id).budgetOut,
  );
  if (remaining.length === 0) {
    const scope: BudgetScope = global ? { kind: 'global-month' } : { kind: err.scope, providerId };
    stopRun(run, { kind: 'budget', error: err, resumeAfter: ctx.budget.usage(scope).windowEnd });
    return;
  }
  run.notices.push({
    kind: 'provider_capped',
    detail: `${affected.join(', ')}: ${breachText(err.scope, providerId, err.cap, err.current, err.requested, 'the next call needed')}. Its remaining ${stage} cells are skipped (budget) in this run and the other providers continue.`,
  });
}

/** After a lane's pool drains: budget and disable marking of whatever is still not_run (spec §8.1 "remaining cells …"). */
export function settleLane(ctx: EngineContext, run: RunState, stage: Stage, providerId: ProviderId): void {
  if (laneFor(run, stage, providerId).budgetOut) markRemaining(ctx, run, stage, providerId, 'budget');
  if (run.disabled.has(providerId)) markRemaining(ctx, run, stage, providerId, 'provider_disabled');
}
```

`packages/engine/src/text.ts` — replace the file:

```ts
import {
  type BudgetScopeKind,
  formatPence,
  type IsoDateTime,
  PENCE_TO_MICRO,
  type ProviderId,
} from '@gmt/core';

// Operator-facing wording shared by notices and refusal messages (spec §8.1 "409 naming the cap and numbers"):
// money through core's formatPence, call scopes as counts, scopes in plain English, instants in local time.

/** True for the scopes whose figures are micro-GBP; the others count calls. */
export function isCostScope(scope: BudgetScopeKind): boolean {
  return scope === 'execution-cost' || scope === 'global-month';
}

/** Plain-English name of a cap scope (po-012). */
export function scopeName(scope: BudgetScopeKind, providerId: ProviderId | null): string {
  const p = providerId ?? 'the provider';
  switch (scope) {
    case 'execution-calls':
      return "this run's billed-call cap";
    case 'execution-free-calls':
      return "this run's free-call cap";
    case 'execution-cost':
      return "this run's spend cap";
    case 'provider-month':
      return `${p}'s monthly call cap`;
    case 'provider-lifetime':
      return `${p}'s lifetime call cap`;
    case 'global-month':
      return 'the monthly spend cap';
  }
}

/** A cap figure with its unit: pounds for cost scopes (micro-GBP rounded up to the penny), "N calls" otherwise (arch-018). */
export function scopeAmount(scope: BudgetScopeKind, n: number): string {
  if (isCostScope(scope)) return formatPence(Math.ceil(n / PENCE_TO_MICRO));
  return `${n} ${n === 1 ? 'call' : 'calls'}`;
}

/** "this run's billed-call cap is 50 calls; 50 calls used; the next call needs 1 call" in one sentence. */
export function breachText(
  scope: BudgetScopeKind,
  providerId: ProviderId | null,
  cap: number,
  used: number,
  needs: number,
  needsLabel: string,
): string {
  return `${scopeName(scope, providerId)} is ${scopeAmount(scope, cap)}; ${scopeAmount(scope, used)} used; ${needsLabel} ${scopeAmount(scope, needs)}`;
}

/** An instant as a readable local date and time in `tz`, e.g. "Mon, 19 Oct 2026, 05:00 (Europe/London)" (po-015). */
export function formatInstant(at: IsoDateTime, tz: string): string {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${f.format(new Date(at))} (${tz})`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run budget-breach error-table-discovery error-table-verification`
Expected: PASS, 44 tests (15 + 18 + 11).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: per-scope budget breaches that honour reserved calls, alerts step on completion and cap pauses, calendar-only notice

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.11: `parseCron` — the single croner wrapper

**Files:**
- Create: `packages/engine/src/scheduler/parseCron.ts`, `test/parse-cron.test.ts`

**Interfaces:**
- Consumes: `croner` 10 (`Cron`, `nextRun`, `previousRuns`), `Intl.DateTimeFormat`.
- Produces: `parseCron(expr, tz)` exactly as the contract; `isValidTimeZone(tz)`; `previousFiring(expr, tz, before)`; `firingsBetween(expr, tz, from, to)`; `runsPerMonth(expr, tz, from)` = firings over the next 365 days ÷ 12, unrounded (ruling 12: weekly 52/12 ≈ 4.33, the spec §8.2 cadence table's figure; ssr-17).

The DST gap and overlap cases of the library note are pinned with fixed instants (test-strategy-reviewer-021).

- [ ] **Step 1: Write the failing test**

`packages/engine/test/parse-cron.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import {
  firingsBetween,
  isValidTimeZone,
  parseCron,
  previousFiring,
  runsPerMonth,
} from '../src/scheduler/parseCron.js';

const next = (expr: string, tz: string, from: string) => {
  const p = parseCron(expr, tz);
  if (!p.ok) throw new Error(p.reason);
  return p.next(new Date(from))?.toISOString() ?? null;
};
const reason = (expr: string, tz = 'Europe/London') => {
  const p = parseCron(expr, tz);
  return p.ok ? null : p.reason;
};
const iso = (ds: Date[]) => ds.map((d) => d.toISOString());

describe('parseCron (spec §8.2: the sole semantic validator; sub-hourly rejected; tz validated)', () => {
  it('evaluates in the schedule tz across both UK DST changes', () => {
    expect(next('0 5 * * 1', 'Europe/London', '2027-03-28T12:00:00.000Z')).toBe('2027-03-29T04:00:00.000Z'); // 05:00 BST
    expect(next('0 5 * * 1', 'Europe/London', '2026-10-24T12:00:00.000Z')).toBe('2026-10-26T05:00:00.000Z'); // 05:00 GMT
    expect(next('0 5 * * 1', 'America/New_York', '2026-10-14T09:00:00.000Z')).toBe(
      '2026-10-19T09:00:00.000Z',
    ); // 05:00 EDT
  });
  it('a wall time inside the spring-forward gap fires once, at the later instant; a fall-back overlap fires once (library note)', () => {
    expect(
      iso(
        firingsBetween(
          '30 1 * * *',
          'Europe/London',
          new Date('2027-03-27T00:00:00.000Z'),
          new Date('2027-03-29T23:59:00.000Z'),
        ),
      ),
    ).toEqual([
      '2027-03-27T01:30:00.000Z', // 01:30 GMT
      '2027-03-28T01:30:00.000Z', // 01:30 does not exist; 02:30 BST
      '2027-03-29T00:30:00.000Z', // 01:30 BST
    ]);
    expect(
      iso(
        firingsBetween(
          '30 1 * * *',
          'Europe/London',
          new Date('2026-10-24T00:00:00.000Z'),
          new Date('2026-10-26T23:59:00.000Z'),
        ),
      ),
    ).toEqual([
      '2026-10-24T00:30:00.000Z', // 01:30 BST
      '2026-10-25T00:30:00.000Z', // 01:30 happens twice; the first (BST) only
      '2026-10-26T01:30:00.000Z', // 01:30 GMT
    ]);
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
    expect(
      previousFiring('0 5 * * 1', 'Europe/London', new Date('2026-10-14T09:00:00.000Z'))?.toISOString(),
    ).toBe('2026-10-12T04:00:00.000Z');
    expect(previousFiring('*/5 * * * *', 'Europe/London', new Date('2026-10-14T09:00:00.000Z'))).toBeNull();
  });
  it('is firings over the next 365 days ÷ 12, unrounded (ruling 12: weekly ≈ 4.33, as the spec §8.2 cadence table)', () => {
    const from = new Date('2026-10-14T09:00:00.000Z');
    expect(runsPerMonth('0 5 * * 1', 'Europe/London', from)).toBe(52 / 12);
    expect(runsPerMonth('0 6 * * *', 'Europe/London', from)).toBe(365 / 12);
    expect(runsPerMonth(null, 'Europe/London', from)).toBe(0);
    expect(runsPerMonth('*/5 * * * *', 'Europe/London', from)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run parse-cron`
Expected: FAIL, `Cannot find module '../src/scheduler/parseCron.js'`.

- [ ] **Step 3: Implement**

`packages/engine/src/scheduler/parseCron.ts` (new file):

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
  if (fields.length !== 5)
    return { ok: false, reason: 'a schedule has five fields: minute hour day-of-month month day-of-week' };
  const minute = fields[0] ?? '';
  // why: spec §8.2 "sub-hourly rejected". With one fixed minute a pattern fires at most once an hour, whatever the
  // other fields say; every list, range or step in the minute field could fire more often.
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59)
    return {
      ok: false,
      reason: 'schedules may run at most once an hour: the minute field must be a single number 0–59',
    };
  try {
    // why: no callback, so croner schedules nothing; paused for clarity; mode '5-part' refuses seconds and years
    return { ok: true, job: new Cron(fields.join(' '), { timezone: tz, paused: true, mode: '5-part' }) };
  } catch (err) {
    return { ok: false, reason: `not a valid schedule: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * The single croner wrapper (spec §4, §8.2). `api` imports it to validate a definition's cron and tz; `core` has no
 * cron parser. `next(from)` is the first firing strictly after `from`.
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

/** The firings in [from, to], in order (bounded by the caller's window). */
export function firingsBetween(expr: string, tz: string, from: Date, to: Date): Date[] {
  const p = parseCron(expr, tz);
  if (!p.ok) return [];
  const out: Date[] = [];
  let cursor = p.next(new Date(from.getTime() - 1));
  while (cursor !== null && cursor.getTime() <= to.getTime()) {
    out.push(cursor);
    cursor = p.next(new Date(cursor.getTime() + 1000)); // why: step past the firing so an inclusive nextRun cannot loop
  }
  return out;
}

/**
 * Firings over the next 365 days divided by 12, unrounded (a weekly schedule is about 4.33), so the spec §8.2 cadence
 * table and budgetFit come from the same function (ruling 12); 0 with no or an invalid schedule.
 */
export function runsPerMonth(expr: string | null, tz: string, from: Date): number {
  if (expr === null) return 0;
  return (
    firingsBetween(expr, tz, new Date(from.getTime() + 1), new Date(from.getTime() + 365 * 86_400_000))
      .length / 12
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run parse-cron`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: parseCron over croner 10 with sub-hourly and tz rejection; runsPerMonth unrounded

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.12: Estimate (`planCalls`), `estimateRemaining`, `budgetFit`; parity per provider

**Files:**
- Create: `packages/engine/src/estimate.ts`, `test/estimate.test.ts`
- Modify: `packages/engine/src/snapshot.ts` (`today` parameter), `src/start.ts` (store the estimate), `src/execute.ts` (`parityNotice` in `finish`)

**Interfaces:**
- Consumes: `planTiles`, `reusableFor`, `reuseCriteriaFor`, `itineraryQuery`, `VerificationCapability.estimate`, `runsPerMonth`, `BudgetGuard.usage(...).cap`, `LedgerRepo.countsFor(...).perProvider`.
- Produces: `estimateStart(ctx, snapshot, cells, definitionId | null)` (null: every cell planned, the worst case without reuse), `estimateRemainingFor(ctx, exec, manual)`, `scheduleLoad(ctx, perRun, snapshot, firings, hours)`, `monthlyLoad(ctx, def)`, `otherSchedules(ctx, definitionId)`, `budgetFitFor(ctx, def, definitionId | null)`, `SECONDS_PER_CALL`; `buildSnapshot(ctx, def, trigger?, today?)`; `parityNotice(ctx, run)`.

Estimates: one literal small definition is pinned (2 tiles + 2 cells × 3 calls, × 1.2, at 3200 µGBP; test-strategy-reviewer-022); `seconds` is the slowest of the minute window, the hour window (named in the assumptions when it binds) and the pool (cost-r1-011). A start stores the reuse-aware estimate; the save-time estimate is the worst case (ruling 9, Task 7.19). `budgetFit` assumes no reuse (po-004, ssr-08), counts discovery at most once per refresh window (min(runsPerMonth, 730 h ÷ (0.9 × refresh hours)), cost-r1-003), and adds every other enabled scheduled definition to the shared monthly scopes (ruling 5, cost-r1-004). Parity reads the ledger's distinct tile indexes; a paged tile keeps parity while costing a call per page, and a chained verification spends no more than its estimate per cell (cost-r1-007). `planCalls` counts discovery tiles, so the overrun baseline for discovery is the distinct tiles (`LedgerRepo.countsFor(...).perProvider[].tiles`), never the calls; the estimate's assumptions say a tile that pages spends one call a page, and §11 records WP8's matching rule. `estimateRemaining` reads the same cells a resumed pass fetches: the resume query (which never returns `no-return-legs` or `no-priced-options` errors) less the cells whose departure date has arrived (prov-wp07-r2-001, ssr2-04, arch-r2-006). Money units go through core's `PENCE_TO_MICRO` (arch-r2-007). `scheduleLoad` is the one model of a schedule's load, used by `budgetFit` here and by Task 7.13's reservation. A plan that does not partition its cells now fails the start itself, before anything is created. Discovery is queried per airport pair (decision 34), so the estimate counts every pair's own tiles and assumes no cache-dedup saving (Travelpayouts: `O × D × M` free calls a scan).

- [ ] **Step 1: Write the failing test**

`packages/engine/test/estimate.test.ts` (new file):

```ts
import { apiContract, type Estimate, ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { budgetFitFor, estimateRemainingFor, estimateStart } from '../src/estimate.js';
import { buildSnapshot } from '../src/snapshot.js';
import {
  createHarness,
  EWR,
  expectedTiles,
  type Harness,
  HOUR,
  JFK,
  LGW,
  LHR,
  verificationOf,
  withVerification,
} from './support/harness.js';
import { dropPlanCell, extraTile, throwOnSearch } from './support/wrappers.js';

const plan = (e: Estimate) =>
  e.perProvider.map((p) => ({ providerId: p.providerId, stage: p.stage, calls: p.planCalls }));
const estimateOf = (h: Harness, defId: string, reuse: boolean) => {
  const ctx = buildContext(h.deps, h.options);
  const def = h.repos.definitions.get(defId);
  if (def === null) throw new Error('no definition');
  const b = buildSnapshot(ctx, def);
  return { est: estimateStart(ctx, b.snapshot, b.cells, reuse ? def.id : null), cells: b.cells };
};
const fitOf = (h: Harness, defId: string) => {
  const def = h.repos.definitions.get(defId);
  if (def === null) throw new Error('no definition');
  return budgetFitFor(buildContext(h.deps, h.options), def, def.id);
};

describe('estimate (spec §8.1 "Estimate")', () => {
  it('pins one small definition: 2 tiles + 2 cells × 3 calls, × 1.2, at 3200 µGBP a call (test-strategy-022)', () => {
    const h = createHarness();
    const { est } = estimateOf(h, h.createDefinition({ providers: withVerification() }).id, false);
    expect(est.perProvider).toEqual([
      {
        providerId: 'fixture',
        stage: 'discovery',
        calls: 3,
        planCalls: 2,
        costMicroGbp: 7680,
        costPence: 1,
        seconds: 2,
        blocked: null,
      },
      {
        providerId: 'fixture',
        stage: 'verification',
        calls: 8,
        planCalls: 6,
        costMicroGbp: 23_040,
        costPence: 3,
        seconds: 3,
        blocked: null,
      },
    ]);
    expect(est).toMatchObject({
      cells: 28,
      totalCalls: 11,
      totalPlanCalls: 8,
      totalCostMicroGbp: 30_720,
      totalCostPence: 4,
      retryFactor: 1.2,
    });
    expect(est.assumptions[0]).toBe('every call count includes the retry factor 1.2');
    expect(apiContract.estimateSchema.safeParse(est).success).toBe(true);
  });

  it('= Σ discovery plan length + maxCells × verification.estimate per provider and stage', () => {
    const h = createHarness();
    const def = h.createDefinition({
      origins: [LHR, LGW],
      destinations: [JFK],
      providers: withVerification(),
    });
    const { est, cells } = estimateOf(h, def.id, false);
    const first = cells[0];
    if (first === undefined) throw new Error('the definition resolved to no cells');
    const per = verificationOf(h.fixture).estimate({
      ...first,
      cabin: 'economy',
      adults: 1,
      currency: 'GBP',
      expandTop: 1,
      bookingLinks: true,
    });
    expect(plan(est)).toEqual([
      { providerId: 'fixture', stage: 'discovery', calls: expectedTiles(h, def) },
      { providerId: 'fixture', stage: 'verification', calls: 2 * per.calls },
    ]);
  });

  it('the run-time estimate uses the same reuse query as the run; the worst case (no definition id) plans every cell (ruling 9)', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    const soon = estimateOf(h, def.id, true);
    expect(soon.est.perProvider[0]?.planCalls).toBe(0);
    expect(soon.est.assumptions).toContain(
      `fixture: ${soon.cells.length} cells reuse earlier prices and are not planned`,
    );
    expect(estimateOf(h, def.id, false).est.perProvider[0]?.planCalls).toBe(2);
    h.clock.advance(151 * HOUR);
    expect(estimateOf(h, def.id, true).est.perProvider[0]?.planCalls).toBe(expectedTiles(h, def));
  });

  it('a plan that does not partition the cells fails the start before anything is created (ssr-06)', async () => {
    const h = createHarness({ transformFixture: dropPlanCell });
    const def = h.createDefinition();
    await expect(h.orch().start(def.id, { trigger: 'manual' })).rejects.toThrow('does not partition');
    expect(h.repos.executions.listForDefinition(def.id, { limit: 10, includeChildren: true })).toEqual([]);
  });

  it('is stored on the execution at start', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const e = await h.runToCompletion(h.orch(), def.id);
    if (e.estimate === null) throw new Error('no estimate stored');
    expect(plan(e.estimate)).toEqual([
      { providerId: 'fixture', stage: 'discovery', calls: expectedTiles(h, def) },
    ]);
  });
});

describe('estimateRemaining (spec §8.1 "resumable tiles + remaining selected cells × estimate × factor")', () => {
  it('after an interrupt at k of n tiles, plans n − k', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] });
    const first = h.orch();
    h.onTileCommit((c) => {
      if (c === 2) void first.shutdown();
    });
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    const rem = estimateRemainingFor(buildContext(h.deps, h.options), e, true);
    expect(plan(rem)).toEqual([
      { providerId: 'fixture', stage: 'discovery', calls: expectedTiles(h, def) - 2 },
    ]);
  });

  it('leaves out no-priced-options errors, which no resume fetches (decision 37, prov-wp07-r2-001)', async () => {
    const err = new ProviderError({
      kind: 'upstream',
      retryable: false,
      reason: 'no-priced-options',
      providerId: 'fixture',
      message: 'step 1 returned options and none was priced',
    });
    const h = createHarness({ transformFixture: (p) => throwOnSearch(p, err, () => true) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ providers: withVerification() }).id);
    expect(h.outcomes(e.id, { stage: 'verification', status: 'error' })).toHaveLength(2);
    const ctx = buildContext(h.deps, h.options);
    for (const manual of [false, true]) expect(estimateRemainingFor(ctx, e, manual).totalCalls).toBe(0);
  });
});

describe('budgetFit (spec §8.2 "compares runsPerMonth × estimate with every cap and warns")', () => {
  it('weekly: 52/12 runs a month; fits under generous caps and parses as the api contract', () => {
    const h = createHarness();
    const fit = fitOf(h, h.createDefinition({ scheduleCron: '0 5 * * 1' }).id);
    expect(fit.runsPerMonth).toBe(52 / 12);
    expect(fit.fits).toBe(true);
    expect(fit.perScope).toEqual([
      { scope: 'execution-calls', estimated: 3, cap: 1000, fits: true },
      { scope: 'execution-free-calls', estimated: 0, cap: 1000, fits: true },
      { scope: 'execution-cost', estimated: 7680, cap: 1_000_000_000, fits: true },
      { scope: 'provider-month:fixture', estimated: 13, cap: 100_000, fits: true }, // 3 × 4.33
      { scope: 'global-month', estimated: 33_280, cap: 1_000_000_000, fits: true },
    ]);
    expect(apiContract.budgetFitSchema.safeParse(fit).success).toBe(true);
  });

  it('gives the same answer just after a run as with no run (no reuse is assumed, po-004)', async () => {
    const h = createHarness();
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const before = fitOf(h, def.id);
    await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(HOUR);
    expect(fitOf(h, def.id)).toEqual(before);
  });

  it('a daily schedule pays discovery once per refresh window, not daily (cost-r1-003)', () => {
    const h = createHarness();
    const fit = fitOf(h, h.createDefinition({ scheduleCron: '0 5 * * *' }).id);
    // why: 3 factored calls × min(365/12, 730 / (0.9 × 168)) = 3 × 4.83 → 15, against 3 × 30.4 = 92 if every firing re-fetched
    expect(fit.perScope.find((x) => x.scope === 'provider-month:fixture')?.estimated).toBe(15);
  });

  it('adds every other enabled scheduled definition to the shared monthly scopes (ruling 5)', () => {
    const h = createHarness({ fixtureMonthlyCallCap: 20 });
    h.createDefinition({ scheduleCron: '0 5 * * 1', destinations: [EWR] });
    h.createDefinition({ scheduleCron: '0 6 * * 1', enabled: false }); // disabled: not counted
    const fit = fitOf(h, h.createDefinition({ scheduleCron: '0 5 * * 1' }).id);
    expect(fit.perScope.find((x) => x.scope === 'provider-month:fixture')).toEqual({
      scope: 'provider-month:fixture',
      estimated: 26,
      cap: 20,
      fits: false,
    });
    expect(fit.fits).toBe(false);
  });
});

describe('parity and the overrun baseline (spec §8.1)', () => {
  it('an uninterrupted pass whose distinct tile requests equal the plan raises no parity notice', async () => {
    const h = createHarness();
    await h.runToCompletion(h.orch(), h.createDefinition().id);
    expect(h.notifications).toHaveLength(0);
  });
  it('a pass that requests more distinct tiles than planned raises one parity_break notification', async () => {
    const h = createHarness({ transformFixture: extraTile });
    await h.runToCompletion(h.orch(), h.createDefinition().id);
    const parity = h.notifications.filter((m) => m.kind === 'parity_break');
    expect(parity).toHaveLength(1);
    expect(parity[0]?.body).toContain('fixture: planned 2 tile requests; the ledger shows 4');
  });
  it('planCalls, not the factored calls, is the overrun baseline: an uninterrupted single-page pass spends exactly planCalls', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    if (e.estimate === null) throw new Error('no estimate stored');
    const discovery = h.repos.ledger
      .countsFor(e.id)
      .perProvider.find((p) => p.providerId === 'fixture' && p.stage === 'discovery');
    expect(discovery?.calls).toBe(e.estimate.perProvider[0]?.planCalls);
    expect(e.estimate.perProvider[0]?.calls).toBeGreaterThan(discovery?.calls ?? 0);
  });
  it('a paged tile keeps parity (one tile index) but spends a call per page beyond planCalls; discovery overrun is judged on tiles (cost-r1-007)', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(
      h.orch(),
      h.createDefinition({ origins: [LGW], destinations: [EWR] }).id,
    );
    expect(e.status).toBe('completed');
    expect(h.notifications.filter((m) => m.kind === 'parity_break')).toHaveLength(0);
    const counts = h.repos.ledger.countsFor(e.id).perProvider.find((p) => p.stage === 'discovery');
    // why: planCalls counts tiles, so the overrun baseline for discovery is the distinct tiles (WP8's rule, §11): equal
    // here, while the calls exceed it by the extra pages
    expect(counts?.tiles).toBe(e.estimate?.perProvider[0]?.planCalls);
    expect(counts?.calls ?? 0).toBeGreaterThan(counts?.tiles ?? 0);
    expect(e.estimate?.assumptions).toContain(
      `fixture: ${counts?.tiles} discovery tiles planned; a tile that pages spends one call a page`,
    );
  });
  it('a chained verification spends no more calls per cell than verification.estimate (cost-r1-007)', async () => {
    const h = createHarness();
    const def = h.createDefinition({
      origins: [LGW],
      destinations: [JFK],
      providers: withVerification(),
      verification: { maxCells: 1, topN: 1, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    });
    const e = await h.runToCompletion(h.orch(), def.id);
    const verification = h.repos.ledger.countsFor(e.id).perProvider.find((p) => p.stage === 'verification');
    expect(verification?.calls).toBeGreaterThan(1);
    expect(verification?.calls ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      e.estimate?.perProvider[1]?.planCalls ?? 0,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run estimate`
Expected: FAIL, `Cannot find module '../src/estimate.js'`.

- [ ] **Step 3: Implement**

`packages/engine/src/estimate.ts` (new file):

```ts
import {
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  PENCE_TO_MICRO,
  type ProviderId,
  type SearchDefinition,
  type SourceKind,
  type Stage,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { runsPerMonth } from './scheduler/parseCron.js';
import { buildSnapshot } from './snapshot.js';
import { planTiles } from './stages/discovery.js';
import { REUSE_TOLERANCE, refreshHoursOf, reusableFor, reuseCriteriaFor } from './stages/reuse.js';
import { itineraryQuery } from './stages/verification.js';
import type { BudgetFit, Estimate } from './types.js';

/** Typical wall time per call by source kind (spec §2: SearchApi calendar 9–29 s; Travelpayouts about 1 s; the fixture is local). */
export const SECONDS_PER_CALL: Readonly<Record<SourceKind, number>> = {
  'authorised-cached': 1,
  'scraped-aggregate': 20,
  'scraped-search': 15,
  synthetic: 0,
};
/** Hours in an average month (365 × 24 / 12), for discovery refreshes per month. */
const HOURS_PER_MONTH = 730;

interface Line {
  providerId: ProviderId;
  stage: Stage;
  rawCalls: number;
  rawCostMicroGbp: number;
  rawSeconds: number;
}

function assemble(
  ctx: EngineContext,
  lines: readonly Line[],
  cells: number,
  windowClamped: boolean,
  assumptions: readonly string[],
): Estimate {
  const f = ctx.config.estimateRetryFactor;
  const perProvider = lines.map((l) => {
    const costMicroGbp = Math.ceil(l.rawCostMicroGbp * f);
    return {
      providerId: l.providerId,
      stage: l.stage,
      calls: Math.ceil(l.rawCalls * f),
      planCalls: l.rawCalls,
      costMicroGbp,
      costPence: Math.ceil(costMicroGbp / PENCE_TO_MICRO),
      seconds: Math.ceil(l.rawSeconds * f),
      blocked: null,
    };
  });
  const totalCostMicroGbp = perProvider.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    cells,
    perProvider,
    totalCalls: perProvider.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: perProvider.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: Math.ceil(totalCostMicroGbp / PENCE_TO_MICRO),
    seconds: perProvider.reduce((a, p) => a + p.seconds, 0),
    assumptions: [`every call count includes the retry factor ${f}`, ...assumptions],
    windowClamped,
    retryFactor: f,
  };
}

/**
 * Spec §8.1 "seconds including limiter waits": the slowest of the minute window, the hour window and the pool
 * (cost-r1-011); the hour window is named in the assumptions when it binds.
 */
function waitSeconds(
  ctx: EngineContext,
  providerId: ProviderId,
  calls: number,
  secondsPerCall: number,
  notes: string[],
): number {
  const l = ctx.limitsOf(providerId);
  const minute = Math.ceil((calls * 60) / l.ratePerMinute);
  const hour = calls > l.ratePerHour ? Math.floor((calls - 1) / l.ratePerHour) * 3600 : 0;
  const pool = Math.ceil((calls * secondsPerCall) / l.concurrency);
  if (hour > Math.max(minute, pool))
    notes.push(
      `${providerId}: ${calls} calls exceed its ${l.ratePerHour} an hour, so the hourly window sets the time`,
    );
  return Math.max(minute, hour, pool);
}

function discoveryLine(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cells: readonly CellKey[],
  definitionId: string | null,
  notes: string[],
): Line | null {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.discovery;
  if (provider === undefined || cap === undefined) return null;
  if (!provider.cabins.includes(snapshot.cabin)) {
    notes.push(`${providerId}: does not offer ${snapshot.cabin}; no calls (cabin-not-offered)`);
    return { providerId, stage: 'discovery', rawCalls: 0, rawCostMicroGbp: 0, rawSeconds: 0 };
  }
  const reused =
    definitionId === null
      ? []
      : reusableFor(
          ctx,
          definitionId,
          snapshot,
          providerId,
          reuseCriteriaFor(ctx, snapshot, providerId, cap.info),
          cells,
        );
  if (reused.length > 0)
    notes.push(`${providerId}: ${reused.length} cells reuse earlier prices and are not planned`);
  const reusedKeys = new Set(reused.map((r) => cellKeyString(r.cell)));
  const fresh = cells.filter((c) => !reusedKeys.has(cellKeyString(c)));
  const tiles = fresh.length === 0 ? 0 : planTiles(providerId, cap, snapshot, fresh).length;
  // why: cost-r1-007 — planCalls counts tiles; a tile that pages spends a call a page, so discovery overrun is judged on
  // distinct tiles (LedgerRepo.countsFor tiles), never on calls
  if (tiles > 0)
    notes.push(`${providerId}: ${tiles} discovery tiles planned; a tile that pages spends one call a page`);
  const l = ctx.limitsOf(providerId);
  return {
    providerId,
    stage: 'discovery',
    rawCalls: tiles,
    rawCostMicroGbp: tiles * l.costPerCallMicroGbp,
    rawSeconds: waitSeconds(ctx, providerId, tiles, SECONDS_PER_CALL[cap.info.sourceKind], notes),
  };
}

function verificationLine(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cellCount: number,
  sample: CellKey | undefined,
  notes: string[],
): Line | null {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined || sample === undefined || cellCount === 0) return null;
  if (!provider.cabins.includes(snapshot.cabin))
    return { providerId, stage: 'verification', rawCalls: 0, rawCostMicroGbp: 0, rawSeconds: 0 };
  const per = cap.estimate(itineraryQuery(snapshot, sample));
  notes.push(
    `${providerId}: verification of up to ${cellCount} cells at ${per.calls} calls each${per.notes.length > 0 ? ` (${per.notes.join('; ')})` : ''}`,
  );
  const calls = cellCount * per.calls;
  return {
    providerId,
    stage: 'verification',
    rawCalls: calls,
    rawCostMicroGbp: cellCount * per.costMicroGbp,
    rawSeconds: Math.max(
      waitSeconds(ctx, providerId, calls, 0, notes),
      Math.ceil((cellCount * per.seconds) / ctx.limitsOf(providerId).concurrency),
    ),
  };
}

/**
 * Spec §8.1 "Estimate = Σ discovery plan(q with cells = non-reused cells).length per pair, using the same reuse query
 * as the run, + maxCells × verification.estimate, all × ESTIMATE_RETRY_FACTOR". `planCalls` keep the pre-factor plan
 * (the overrun baseline). `definitionId` null plans every cell: the save-time worst case without reuse (ruling 9),
 * which is what `confirmed_cost_pence` records; a start passes its definition so the run-time estimate applies reuse.
 */
export function estimateStart(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  cells: readonly Cell[],
  definitionId: string | null,
): Estimate {
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
  if (definitionId === null) notes.push('every cell is planned: no reuse of earlier prices is assumed');
  if (snapshot.windowClamped) notes.push('window clamped to start tomorrow');
  return assemble(ctx, lines, cells.length, snapshot.windowClamped, notes);
}

function firstCellOf(ctx: EngineContext, executionId: string): CellKey | undefined {
  const first = ctx.repos.cells.outcomes(executionId)[0];
  return first === undefined
    ? undefined
    : {
        origin: first.origin,
        destination: first.destination,
        departureDate: first.departureDate,
        returnDate: first.returnDate,
      };
}

/**
 * Spec §8.1 "estimateRemaining (resumable tiles + remaining selected cells × estimate × factor)", over the cells the
 * resumed pass will fetch: the spec §7 resume query (which never returns `no-return-legs` or `no-priced-options` errors,
 * decision 37) less the cells whose departure date has arrived, which a resume marks skipped:departed before its pass
 * (po-016), so this read needs no write first (arch-r2-006).
 */
export function estimateRemainingFor(ctx: EngineContext, exec: Execution, manual: boolean): Estimate {
  const snapshot = exec.snapshot;
  const today = ctx.clock.todayLondon();
  const remaining = (stage: Stage, id: ProviderId) =>
    ctx.repos.cells.resumable(exec.id, stage, id, manual).filter((c) => c.departureDate > today);
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    const l = discoveryLine(ctx, snapshot, id, remaining('discovery', id), null, notes);
    if (l !== null) lines.push(l);
  }
  const seeded = ctx.repos.cells.hasVerificationOutcomes(exec.id);
  const total = ctx.repos.cells.rollUps(exec.id).size;
  for (const id of snapshot.providers.verification) {
    const cells = seeded ? remaining('verification', id) : [];
    const count = seeded ? cells.length : Math.min(snapshot.verification.maxCells, total);
    const sample =
      cells[0] ?? exec.cell ?? snapshot.verification.alwaysInclude[0] ?? firstCellOf(ctx, exec.id);
    const l = verificationLine(ctx, snapshot, id, count, sample, notes);
    if (l !== null) lines.push(l);
  }
  return assemble(ctx, lines, total, snapshot.windowClamped, notes);
}

/** One scheduled definition's monthly load per provider: calls and billed cost. */
export interface MonthlyLoad {
  runsPerMonth: number;
  perRun: Estimate;
  /** The schedule's snapshot, as a scheduled run would freeze it now (its providers and refresh hours). */
  snapshot: DefinitionSnapshot;
  perProvider: Map<ProviderId, { calls: number; costMicroGbp: number }>;
}

/**
 * Spec §8.2 load of `firings` scheduled runs spread over `hours`, without reuse (po-004): verification runs on every
 * firing; discovery at most once per refresh (reuse iff age < 0.9 × refresh), so a daily cron with a weekly refresh
 * pays weekly discovery (cost-r1-003): discovery runs = min(firings, hours / (0.9 × refresh hours)). The one model
 * budgetFit (a month) and the pre-start reservation (the rest of a cap window) share (cost-r2-002).
 */
export function scheduleLoad(
  ctx: EngineContext,
  perRun: Estimate,
  snapshot: DefinitionSnapshot,
  firings: number,
  hours: number,
): Map<ProviderId, { calls: number; costMicroGbp: number }> {
  const load = new Map<ProviderId, { calls: number; costMicroGbp: number }>();
  for (const p of perRun.perProvider) {
    const factor =
      p.stage === 'discovery'
        ? Math.min(firings, hours / (REUSE_TOLERANCE * refreshHoursOf(snapshot, p.providerId)))
        : firings;
    const acc = load.get(p.providerId) ?? { calls: 0, costMicroGbp: 0 };
    load.set(p.providerId, {
      calls: acc.calls + p.calls * factor,
      costMicroGbp: acc.costMicroGbp + (ctx.limitsOf(p.providerId).billed ? p.costMicroGbp * factor : 0),
    });
  }
  return load;
}

/** Spec §8.2 monthly load of a schedule: scheduleLoad over runsPerMonth firings in an average month (730 h). */
export function monthlyLoad(ctx: EngineContext, def: SearchDefinition): MonthlyLoad {
  const built = buildSnapshot(ctx, def, 'schedule');
  const perRun = estimateStart(ctx, built.snapshot, built.cells, null);
  const runs = runsPerMonth(def.scheduleCron, def.scheduleTz, new Date(ctx.clock.now()));
  return {
    runsPerMonth: runs,
    perRun,
    snapshot: built.snapshot,
    perProvider: scheduleLoad(ctx, perRun, built.snapshot, runs, HOURS_PER_MONTH),
  };
}

/** The other enabled, scheduled, live definitions (ruling 5: they share the provider-month and global caps). */
export function otherSchedules(ctx: EngineContext, definitionId: string | null): SearchDefinition[] {
  return ctx.repos.definitions
    .list()
    .filter((d) => d.id !== definitionId && d.enabled && d.deletedAt === null && d.scheduleCron !== null);
}

/**
 * Spec §8.2 "budgetFit at save time compares runsPerMonth × estimate with every cap and warns", worst case without
 * reuse (po-004). Execution scopes compare one run with the definition's budget. Monthly scopes add the monthly load
 * of every other enabled scheduled definition, because they share the caps (ruling 5: the API refuses enabling or
 * changing a schedule whose provider-month scope does not fit); global adds each billed provider's fixed fee once
 * (spec §5.3). `definitionId` is null for an unsaved definition.
 */
export function budgetFitFor(
  ctx: EngineContext,
  def: SearchDefinition,
  definitionId: string | null,
): BudgetFit {
  const own = monthlyLoad(ctx, def);
  const others = otherSchedules(ctx, definitionId).map((d) => monthlyLoad(ctx, d));
  const billed = own.perRun.perProvider.filter((p) => ctx.limitsOf(p.providerId).billed);
  const free = own.perRun.perProvider.filter((p) => !ctx.limitsOf(p.providerId).billed);
  const sum = (xs: Estimate['perProvider'], f: (p: Estimate['perProvider'][number]) => number) =>
    xs.reduce((a, p) => a + f(p), 0);
  const perScope: BudgetFit['perScope'] = [];
  const scope = (name: string, estimated: number, cap: number | null) => {
    const e = Math.ceil(estimated);
    perScope.push({ scope: name, estimated: e, cap, fits: cap === null || e <= cap });
  };
  scope(
    'execution-calls',
    sum(billed, (p) => p.calls),
    def.budget.maxCalls,
  );
  scope(
    'execution-free-calls',
    sum(free, (p) => p.calls),
    def.budget.maxFreeCalls,
  );
  scope(
    'execution-cost',
    sum(billed, (p) => p.costMicroGbp),
    def.budget.maxCostMicroGbp,
  );
  const ids = new Set([...own.perProvider.keys(), ...others.flatMap((o) => [...o.perProvider.keys()])]);
  for (const id of ids) {
    const kind = ctx.limitsOf(id).window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
    const calls = [own, ...others].reduce((a, l) => a + (l.perProvider.get(id)?.calls ?? 0), 0);
    scope(`${kind}:${id}`, calls, ctx.budget.usage({ kind, providerId: id }).cap);
  }
  const fixed = [...ctx.providers.keys()]
    .filter((id) => ctx.limitsOf(id).billed)
    .reduce((a, id) => a + ctx.limitsOf(id).planFixedMicroGbp, 0);
  const cost = [own, ...others].reduce(
    (a, l) => a + [...l.perProvider.values()].reduce((b, v) => b + v.costMicroGbp, 0),
    0,
  );
  scope('global-month', fixed + cost, ctx.config.spend.monthlyCapMicroGbp);
  return { fits: perScope.every((x) => x.fits), runsPerMonth: own.runsPerMonth, perScope };
}
```

`packages/engine/src/execute.ts` — replace or add these declarations:

```ts
/**
 * Spec §8.1 "Parity = distinct tile requests (first-attempt ledger rows + cache hits) for one uninterrupted pass = plan
 * length; a parity break raises an operator notification". Judged per discovery provider on the first pass only, from
 * the ledger's per-provider, per-stage counts (LedgerRepo.countsFor, distinct tile indexes).
 */
export function parityNotice(ctx: EngineContext, run: RunState): Notice | null {
  if (!run.fresh || run.stop !== null) return null;
  const counts = ctx.repos.ledger.countsFor(run.executionId).perProvider;
  const breaks: string[] = [];
  for (const [providerId, planned] of run.plannedTiles) {
    // why: a disabled or budget-capped provider stops requesting its planned tiles by design, which is not a parity break
    if (
      planned === 0 ||
      run.disabled.has(providerId) ||
      run.lanes.get(`discovery|${providerId}`)?.budgetOut === true
    )
      continue;
    const row = counts.find((c) => c.providerId === providerId && c.stage === 'discovery');
    const distinct = (row?.tiles ?? 0) + (row?.cacheHits ?? 0);
    if (distinct !== planned)
      breaks.push(
        `${providerId}: planned ${planned} tile requests; the ledger shows ${distinct} (first attempts plus cache hits)`,
      );
  }
  if (breaks.length === 0) return null;
  run.log.warn({ breaks }, 'parity break');
  return { kind: 'parity_break', detail: `${breaks.join('. ')}.` };
}

/**
 * Writes the pass's final status after sending its notices. The status write is the last act, so anyone who observes a
 * final status also observes every write and notification of the pass.
 */
export async function finish(ctx: EngineContext, run: RunState, alertsRan: boolean): Promise<void> {
  const { status, patch, notice } = finalStatus(run.stop, ctx.clock.now(), run.snapshot.scheduleTz);
  const notices = notice === null ? [...run.notices] : [...run.notices, notice];
  const parity = parityNotice(ctx, run);
  if (parity !== null) notices.push(parity);
  const calendarOnly = calendarOnlyNotice(ctx, run, alertsRan);
  if (calendarOnly !== null) notices.push(calendarOnly);
  const name = ctx.repos.definitions.get(run.definitionId)?.name ?? run.snapshot.name;
  for (const n of notices) {
    await notifyOperator(ctx, n.kind, {
      executionId: run.executionId,
      definitionId: run.definitionId,
      definitionName: name,
      detail: n.detail,
    });
  }
  ctx.repos.executions.setStatus(run.executionId, status, patch);
  if (patch.resumeAfter !== undefined && patch.resumeAfter !== null)
    ctx.hooks.scheduleResume(run.executionId, run.definitionId, patch.resumeAfter);
  run.log.info({ status, notices: notices.map((n) => n.kind) }, 'execution: pass finished');
}
```

`packages/engine/src/snapshot.ts` — the import block becomes:

```ts
import {
  type Cell,
  cellKeyString,
  type DefinitionSnapshot,
  generateCells,
  type IsoDate,
  type ProviderId,
  type ResolvedSpace,
  resolveWindow,
  type SearchDefinition,
} from '@gmt/core';
import type { EngineContext } from './context.js';
```

`packages/engine/src/snapshot.ts` — replace or add these declarations:

```ts
/**
 * Resolves the window in Europe/London and freezes the definition into an execution snapshot (spec §6.1 "frozen into
 * the execution snapshot", §8.1 "start: snapshot"). The snapshot is read once; nothing a later PUT does reaches a
 * running pass (Review Focus 4).
 *
 * - providers: only those registered with the capability; a scheduled run also leaves out a provider marked
 *   excludedFromSchedule (spec §8.2 "scheduled runs exclude SearchApi on trial");
 * - alwaysInclude: members that slid out of a relative window are dropped with a note (spec §6.1).
 * `today` defaults to the clock's London date; `Engine.estimate` passes the form's date.
 */
export function buildSnapshot(
  ctx: EngineContext,
  def: SearchDefinition,
  trigger: Trigger = 'manual',
  today: IsoDate = ctx.clock.todayLondon(),
): BuiltSnapshot {
  const notes: string[] = [];
  const w = resolveWindow(def.window, today);
  if (w.clamped) notes.push('window clamped to start tomorrow');
  const resolved: ResolvedSpace = {
    origins: def.origins,
    destinations: def.destinations,
    departureFrom: w.departureFrom,
    departureTo: w.departureTo,
    minNights: def.minNights,
    maxNights: def.maxNights,
  };
  const cells = w.departureFrom > w.departureTo ? [] : generateCells(resolved);
  const inSpace = new Set(cells.map(cellKeyString));
  const kept = def.verification.alwaysInclude.filter((c) => inSpace.has(cellKeyString(c)));
  const dropped = def.verification.alwaysInclude.length - kept.length;
  if (dropped > 0)
    notes.push(
      `alwaysInclude: ${dropped} ${dropped === 1 ? 'cell left the window and was dropped' : 'cells left the window and were dropped'}`,
    );
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
    droppedAlwaysInclude: def.verification.alwaysInclude.filter((c) => !inSpace.has(cellKeyString(c))),
  };
  return { snapshot, cells, notes };
}
```

`packages/engine/src/start.ts` — the import block becomes:

```ts
import type { Execution } from '@gmt/core';
import type { EngineContext } from './context.js';
import { estimateStart } from './estimate.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { buildSnapshot } from './snapshot.js';
import type { StartResult } from './types.js';
```

`packages/engine/src/start.ts` — replace or add these declarations:

```ts
/** Spec §8.1 "start: snapshot; seed search_cells + cell_outcomes(not_run) …; status=running". */
export async function startExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  definitionId: string,
  opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number },
): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', `definition ${definitionId} not found`, { definitionId });
  if (ctx.repos.executions.activeParent(def.id) !== null)
    return refused('active', 'another execution of this definition is active', { definitionId });
  const built = buildSnapshot(ctx, def, opts.trigger);
  const discovery = built.snapshot.providers.discovery;
  // why: the run-time estimate applies the same reuse query as the run (spec §8.1); it is the overrun baseline
  const estimate = estimateStart(ctx, built.snapshot, built.cells, def.id);
  let exec: Execution;
  try {
    // why: spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start" — the row is created running and
    // seeded in one BEGIN IMMEDIATE, so a crash can never leave an execution without its cells (ssr-07)
    exec = ctx.db.immediateTransaction(() => {
      const e = ctx.repos.executions.create({
        definitionId: def.id,
        isChild: false,
        cell: null,
        snapshot: built.snapshot,
        estimate,
        trigger: opts.trigger,
        status: 'running',
      });
      ctx.repos.cells.seed(e.id, built.cells, discovery);
      // why: spec rev 10 — a provider that does not sell the snapshot's cabin is never called; its cells are no_data
      for (const id of discovery)
        if (!(ctx.providers.get(id)?.cabins ?? []).includes(built.snapshot.cabin))
          ctx.repos.cells.markNoData(e.id, 'discovery', id, 'cabin-not-offered');
      return e;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      return refused('active', 'another execution of this definition is active', { definitionId });
    throw err;
  }
  const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: new Set() });
  run.log.info(
    { trigger: opts.trigger, cells: built.cells.length, notes: built.notes },
    'execution: started',
  );
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run estimate`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: estimate with reuse and retry factor, estimateRemaining, budgetFit without reuse across schedules, parity notice

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.13: Pre-start checks per scope, `SOFT_CONFIRM` in pence and calls, `confirmed_cost_pence` and `confirmed_calls`, `skipped_*`

**Files:**
- Create: `packages/engine/src/budgetCheck.ts`, `test/prestart.test.ts`; `packages/db/drizzle/0001_confirmed_calls.sql` (with the generated `drizzle/meta/0001_snapshot.json` and journal entry), `packages/db/test/migration0001.test.ts`; `packages/core/test/api-contract/confirmedCalls.test.ts`
- Modify: `packages/engine/src/start.ts` (`startExecution`, `recordSkipped`, `confirmationNeeded`, `nothingToSearch`), `src/estimate.ts` (`withBlocked`), `src/context.ts` (`EngineHooks.unregisterSchedule`), `src/run.ts` (`runnableCells` skips a blocked provider), `src/orchestrator.ts` and `src/types.ts` (`confirmCalls`); `packages/core/src/types/definition.ts` (`confirmedCalls`), `src/api-contract/definitions.ts`, `src/api-contract/executions.ts`; `packages/db/src/schema/searchDefinitions.ts`, `src/internal/definitionRow.ts`, `src/repositories/definitions.ts` (`setConfirmed`), `test/definitions.test.ts`, `test/barrel.test.ts`, `test/client.test.ts`; `apps/api/test/bootstrap/tool.test.ts`; `packages/engine/test/budget-breach.test.ts` (the confirmation carries calls)

**Interfaces:**
- Consumes: `BudgetGuard.usage(scope)`, `estimateStart`, `scheduleLoad`, `monthlyLoad`, `otherSchedules`, `firingsBetween`, `markRemaining`, `notifyOperator`, `DefinitionsRepo.update`, `formatPence`, `PENCE_TO_MICRO`, drizzle-kit (§6).
- Produces: the `not_found`, `disabled`, `active`, `window`, `cap` and `confirm` refusals; `checkBudget(ctx, spend, budget, executionId, definitionId)` (with `blockedBy`), `reservedForSchedules(ctx, providerId, definitionId, windowEnd)`, `spendOf(estimate)`, `breachMessage(breaches)`, `recordSkipped(...)`, `confirmationNeeded(ctx, estimate, blocked, confirmed: Confirmation)`, `Confirmation`, `nothingToSearch(snapshot, estimate, blocked)`, `withBlocked(estimate, blockedBy)`, `SOFT_CONFIRM_CALL_SHARE`; `EngineHooks.unregisterSchedule(definitionId)`; `Engine.start`'s `confirmCalls`; core's `SearchDefinition.confirmedCalls` and the api-contract fields `confirmedCalls` (create/update request, response, `needsConfirmation`) and `confirmCalls` (start request); db's migration 0001 and `DefinitionsRepo.setConfirmed(id, { pence, calls } | null)`, which replaces `setConfirmedCost`.

Rules: the provider-month check counts the calls other enabled schedules need from the provider before its window closes, with `budgetFit`'s model (`scheduleLoad`: verification on every firing until the window end, discovery at most once per reuse window), so one run cannot take the headroom the schedules were sized against (ruling 5) and a daily schedule does not hold six times the discovery it will make (cost-r2-002, ssr2-05). Confirmation is needed when the runnable cost is above `SOFT_CONFIRM` or a provider's runnable calls exceed 20% of its call cap, the monthly one or a lifetime plan's (ruling 6, cost-r2-004), so a plan whose calls cost nothing still asks before a large run. A confirmation is the pence and the calls the operator saw (decision 37, cost-r1-005): it covers the run only when pence × `PENCE_TO_MICRO` ≥ the runnable cost and calls ≥ the runnable calls in total, so 0p alone never covers a run of any size, and a stored confirmation never covers a later edit that needs more calls. A manual start confirms with `confirmCostPence` and `confirmCalls`; a scheduled start uses only the stored `confirmed_cost_pence` and `confirmed_calls` (the worst case, ruling 9), which WP8 writes through `setConfirmed`. The refusal's details carry `totalCalls` and `estimatePence` for a client to echo back. Migration 0001 adds `search_definitions.confirmed_calls` (a nullable non-negative integer under a CHECK): run `pnpm --filter @gmt/db exec drizzle-kit generate --name confirmed_calls` after the schema change, keep the generated snapshot and journal entry, and replace the generated SQL with the block below (§6: the generated table rebuild would fail). A start whose every discovery provider is blocked, with no cell always included, would search nothing and end `completed`, so it is refused with `cap` (scheduled: `skipped_budget`) like a start nothing can run (ssr2-03). The estimate a start stores has its totals summed over the providers that will run (`withBlocked`, cost-r1-014). Every scope has a pre-start refusal test, each with the ledger unchanged: execution-calls, execution-cost, execution-free-calls (the fixture's limits read as free), provider-month with the schedules' reservation, and global-month (test-strategy-reviewer-027). A scheduled start no configured provider can run (all excluded from schedules, or none configured) is refused with `disabled` and its own notice, never recorded `skipped_budget` (po-003). Refusal messages name each cap in plain English with units (arch-018). Core's `formatPence` is the only money formatter (arch-007). A provider the check blocked makes no call in the pass (cost-r1-001).

- [ ] **Step 1: Write the failing test**

`apps/api/test/bootstrap/tool.test.ts` — apply this patch:

```diff
--- a/apps/api/test/bootstrap/tool.test.ts
+++ b/apps/api/test/bootstrap/tool.test.ts
@@ -244,7 +244,7 @@
     const h = harness();
     openDatabase(h.dbPath).close();
     expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
-    expect(h.text()).toContain('backup before 1 migration(s)');
+    expect(h.text()).toContain('backup before 2 migration(s)'); // 0000 and WP7's 0001 (decision 37)
     const [backup] = readdirSync(backupsDirFor(h.dbPath));
     if (backup === undefined) throw new Error('no backup');
     expect(
```

`packages/core/test/api-contract/confirmedCalls.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import {
  definitionResponseSchema,
  definitionShapeSchema,
  definitionUpdateRequestSchema,
} from '../../src/api-contract/definitions.js';
import { startExecutionRequestSchema } from '../../src/api-contract/executions.js';

describe('confirmed calls beside confirmed pence (decision 37)', () => {
  it('a start request confirms pence and calls, each a non-negative integer', () => {
    expect(startExecutionRequestSchema.parse({ confirmCostPence: 0, confirmCalls: 3 })).toEqual({
      confirmCostPence: 0,
      confirmCalls: 3,
    });
    expect(startExecutionRequestSchema.safeParse({ confirmCalls: -1 }).success).toBe(false);
    expect(startExecutionRequestSchema.safeParse({ confirmCalls: 2.5 }).success).toBe(false);
  });
  it('a definition update may carry confirmedCalls; a stored row is read without it; a response states it, null when none', () => {
    expect(definitionUpdateRequestSchema.parse({ confirmedCalls: 40 })).toEqual({ confirmedCalls: 40 });
    expect(definitionUpdateRequestSchema.safeParse({ confirmedCalls: -2 }).success).toBe(false);
    expect(Object.keys(definitionShapeSchema.shape)).not.toContain('confirmedCalls');
    expect(definitionResponseSchema.shape.confirmedCalls.safeParse(null).success).toBe(true);
    expect(definitionResponseSchema.shape.confirmedCalls.safeParse(12).success).toBe(true);
    expect(definitionResponseSchema.shape.confirmedCalls.safeParse(-1).success).toBe(false);
  });
});
```

`packages/db/test/barrel.test.ts` — apply this patch:

```diff
--- a/packages/db/test/barrel.test.ts
+++ b/packages/db/test/barrel.test.ts
@@ -130,7 +130,7 @@
     expect(repos.routeHistory).toBeInstanceOf(db.RoutePriceHistoryRepo);
   });
 
-  it('the one migration creates exactly the spec §7 tables', () => {
+  it('the migrations create exactly the spec §7 tables (0000, plus 0001 adding a column, decision 37)', () => {
     const d = freshDb();
     const tables = d.raw
       .prepare<[], { name: string }>(
@@ -139,7 +139,7 @@
       .all()
       .map((r) => r.name);
     expect(tables).toEqual([...SPEC_TABLES].sort());
-    expect(d.raw.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 1 });
+    expect(d.raw.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 2 });
   });
 
   it('foreign keys are declared and enforced', () => {
```

`packages/db/test/client.test.ts` — apply this patch:

```diff
--- a/packages/db/test/client.test.ts
+++ b/packages/db/test/client.test.ts
@@ -105,13 +105,15 @@
 describe('migrations against the first real migration (spec §7 "Migrations", §9 item 3)', () => {
   it('apply twice: the second run applies nothing and changes nothing', () => {
     const db = openTracked(tmpDbPath());
-    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual(['0000_initial']);
-    expect(applyMigrations(db, MIGRATIONS_DIR)).toEqual({ applied: ['0000_initial'] });
+    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual(['0000_initial', '0001_confirmed_calls']);
+    expect(applyMigrations(db, MIGRATIONS_DIR)).toEqual({
+      applied: ['0000_initial', '0001_confirmed_calls'],
+    });
     const before = schemaOf(db);
     expect(applyMigrations(db, MIGRATIONS_DIR)).toEqual({ applied: [] });
     expect(schemaOf(db)).toEqual(before);
     expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([]);
-    expect(count(db, '__drizzle_migrations')).toBe(1);
+    expect(count(db, '__drizzle_migrations')).toBe(2);
   });
 
   it('a missing migrations directory fails naming the directory', () => {
```

`packages/db/test/definitions.test.ts` — apply this patch:

```diff
--- a/packages/db/test/definitions.test.ts
+++ b/packages/db/test/definitions.test.ts
@@ -18,6 +18,7 @@
       ...input,
       id: created.id,
       confirmedCostPence: null,
+      confirmedCalls: null,
       createdAt: T0,
       updatedAt: T0,
       deletedAt: null,
@@ -74,15 +75,20 @@
     expect(repo.get(keep.id)?.deletedAt).toBeNull();
   });
 
-  it('setConfirmedCost stores integer pence only, and update never touches it', () => {
+  it('setConfirmed stores integer pence and calls together, and update never touches them (decision 37)', () => {
     const repo = new DefinitionsRepo(freshDb(), fixedClock(T0));
     const d = repo.create(exampleDefinitionInput());
-    repo.setConfirmedCost(d.id, 412);
+    repo.setConfirmed(d.id, { pence: 412, calls: 30 });
     repo.update(d.id, { name: 'renamed' });
-    expect(repo.get(d.id)?.confirmedCostPence).toBe(412);
-    repo.setConfirmedCost(d.id, null);
-    expect(repo.get(d.id)?.confirmedCostPence).toBeNull();
-    expect(() => repo.setConfirmedCost(d.id, 4.5)).toThrow(RowRejected);
+    expect(repo.get(d.id)).toMatchObject({ confirmedCostPence: 412, confirmedCalls: 30 });
+    repo.setConfirmed(d.id, null);
+    expect(repo.get(d.id)).toMatchObject({ confirmedCostPence: null, confirmedCalls: null });
+    expect(() => repo.setConfirmed(d.id, { pence: 4.5, calls: 1 })).toThrow(RowRejected);
+    expect(() => repo.setConfirmed(d.id, { pence: 1, calls: 1.5 })).toThrow(RowRejected);
+    expect(() => repo.setConfirmed('missing', { pence: 1, calls: 1 })).toThrow(/missing/);
+    expect(repo.get(d.id)).toMatchObject({ confirmedCostPence: null, confirmedCalls: null });
+    const created = repo.create({ ...exampleDefinitionInput(), confirmedCostPence: 5, confirmedCalls: 7 });
+    expect(repo.get(created.id)).toMatchObject({ confirmedCostPence: 5, confirmedCalls: 7 });
   });
 
   it('rejects non-integer nights, budgets and onward costs', () => {
```

`packages/db/test/migration0001.test.ts` (new file):

```ts
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { applyMigrations, pendingMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { freshDb, openTracked, T0, tmpDbPath, tmpDir } from './helpers/db.js';
import { exampleDefinitionInput } from './helpers/factories.js';

const sqliteCode = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (err) {
    return err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : null;
  }
};

/** A copy of the migrations folder that stops at 0000, as an install made before this migration has it. */
function onlyInitial(): string {
  const dir = join(tmpDir(), 'drizzle');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  rmSync(join(dir, '0001_confirmed_calls.sql'));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => e.tag === '0000_initial');
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0001: search_definitions.confirmed_calls (decision 37)', () => {
  it('upgrades a database made at 0000: existing definitions keep every field and read confirmed_calls as null', () => {
    const source = freshDb();
    const created = new DefinitionsRepo(source, fixedClock(T0)).create({
      ...exampleDefinitionInput(),
      confirmedCostPence: 120,
    });
    const row: Record<string, unknown> =
      source.raw
        .prepare<[string], Record<string, unknown>>('SELECT * FROM search_definitions WHERE id = ?')
        .get(created.id) ?? {};
    const { confirmed_calls: _absentAtInitial, ...initialRow } = row;
    const db = openTracked(tmpDbPath());
    applyMigrations(db, onlyInitial());
    const columns = Object.keys(initialRow);
    db.raw
      .prepare(
        `INSERT INTO search_definitions (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`,
      )
      .run(initialRow);
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual(['0001_confirmed_calls']);
    expect(applyMigrations(db, MIGRATIONS_DIR)).toEqual({ applied: ['0001_confirmed_calls'] });
    expect(new DefinitionsRepo(db, fixedClock(T0)).get(created.id)).toEqual({
      ...created,
      confirmedCalls: null,
    });
  });

  it('the column holds only a non-negative integer or null (CHECK, spec §6.3)', () => {
    const db = freshDb();
    const d = new DefinitionsRepo(db, fixedClock(T0)).create(exampleDefinitionInput());
    const set = (v: unknown) =>
      sqliteCode(() =>
        db.raw.prepare('UPDATE search_definitions SET confirmed_calls = ? WHERE id = ?').run(v, d.id),
      );
    expect(set(30)).toBeNull();
    expect(set(null)).toBeNull();
    expect(set(2.5)).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(set(-1)).toBe('SQLITE_CONSTRAINT_CHECK');
  });
});
```

`packages/engine/test/budget-breach.test.ts` — replace the file:

```ts
import { asIsoDateTime, BudgetExceeded, type Execution, type ProviderId } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { finalStatus } from '../src/execute.js';
import { renderOperatorMessage } from '../src/notifiers/operatorTemplates.js';
import { createOrchestrator, type Orchestrator } from '../src/orchestrator.js';
import { applyBudgetBreach, newRun } from '../src/run.js';
import {
  createHarness,
  EWR,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  JFK,
  LGW,
  LHR,
  tileRule,
  withVerification,
} from './support/harness.js';

const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const spent = (h: Harness, id: string) =>
  h.ledgerRows(id).filter((r) => r.endpointPath !== '/test-spend' && r.outcome !== 'cache_hit');
// why: a small call cap makes the run ask for confirmation (ruling 6, Task 7.13); every start here confirms its pence and
// calls up front (decision 37)
const confirmed = { trigger: 'manual', confirmCostPence: 100, confirmCalls: 1000 } as const;
const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });
const rule = (h: Harness, definitionId: string) =>
  h.repos.alerts.create({
    definitionId,
    type: 'absolute',
    thresholdPence: 100_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });

describe('BudgetExceeded execution-* (spec §8.1, decision 25)', () => {
  it('concurrency 4 with 1 call left → exactly 1 billable call, and its tile is written; the others stay not_run; paused_budget; never an error', async () => {
    const h = createHarness({ fixtureConcurrency: 4 });
    const def = twoPairs(h, { budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    // why: spend arrives after the pre-start check, as a concurrent pass of the same execution would leave it
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }),
    );
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), def.id);
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBeNull();
    expect(scheduleResume).not.toHaveBeenCalled();
    expect(spent(h, e.id)).toHaveLength(1);
    // why: the reservation that passed is honoured (decision 25): its 14 cells are priced, the other three tiles never reserved
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(42);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['paused_budget']);
    expect(h.notifications[0]?.body).toContain("this run's billed-call cap is 50 calls; 50 calls used");
  });

  it('execution-cost: the spend cap stops the pass before the call that would pass it (test-strategy-reviewer-027)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h, { budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 100_000 } });
    // why: after the pre-start check the execution has spent all but 3 199 µGBP, less than one 3 200 µGBP call
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 100_000 - 3_199, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e).toMatchObject({ status: 'paused_budget', resumeAfter: null });
    expect(spent(h, e.id)).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(56);
    expect(h.notifications[0]?.body).toContain(
      "this run's spend cap is £0.10; £0.10 used; the next call needed £0.01",
    );
  });

  it('execution-free-calls: a free provider stops at the free-call cap before its next call', async () => {
    // why: the guard counts the fixture as free here, as it does Travelpayouts
    const h = createHarness({ fixtureConcurrency: 1, fixtureBillable: false });
    const def = twoPairs(h, { budget: { maxCalls: 1000, maxFreeCalls: 1, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 0, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e).toMatchObject({ status: 'paused_budget', resumeAfter: null });
    expect(spent(h, e.id)).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(56);
    expect(h.notifications[0]?.body).toContain(
      "this run's free-call cap is 1 call; 1 call used; the next call needed 1 call",
    );
  });
});

describe('BudgetExceeded provider-month with another provider in the stage (spec §8.1; ssr2-02, prov-wp07-r2-003)', () => {
  /**
   * A running execution whose snapshot lists a second discovery provider. Layer A registers only the fixture, so the
   * second provider exists in the snapshot alone: blocked by the pre-start check, or still able to run.
   */
  async function breachWithSecondProvider(blocked: ProviderId[]) {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const ctx = buildContext(h.deps, h.options);
    const r = await h.orch().start(h.createDefinition().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const exec = h.repos.executions.get(r.executionId);
    if (exec === null) throw new Error('missing execution');
    const two: Execution = {
      ...exec,
      snapshot: {
        ...exec.snapshot,
        providers: { ...exec.snapshot.providers, discovery: ['fixture', 'travelpayouts'] },
      },
    };
    const run = newRun(ctx, two, { manual: false, fresh: false, blocked: new Set(blocked) });
    const err = new BudgetExceeded({
      scope: 'provider-month',
      providerId: 'fixture',
      cap: 20,
      current: 20,
      requested: 1,
    });
    applyBudgetBreach(ctx, run, 'fixture', 'discovery', err);
    return { h, run };
  }

  it('a provider the pre-start check blocked does not remain: the pass pauses until the window reopens (ssr2-02)', async () => {
    const { h, run } = await breachWithSecondProvider(['travelpayouts']);
    expect(run.stop).toMatchObject({
      kind: 'budget',
      resumeAfter: h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd,
    });
    expect(run.notices).toEqual([]);
  });

  it('a provider that can still run remains: the pass goes on, and the notice says the capped cells stay skipped in this run', async () => {
    const { run } = await breachWithSecondProvider([]);
    expect(run.stop).toBeNull();
    expect(run.notices.map((n) => n.kind)).toEqual(['provider_capped']);
    const { body } = renderOperatorMessage('provider_capped', {
      definitionName: 'x',
      executionId: null,
      detail: run.notices[0]?.detail ?? '',
    });
    expect(body).toContain('Its remaining discovery cells are skipped (budget) in this run');
    expect(body).toContain(
      'resume the run by hand once the cap window reopens or the cap is raised, or the next scheduled run searches them',
    );
  });
});

describe('BudgetExceeded provider-month (spec §8.1)', () => {
  it('no other provider remains: remaining cells skipped:budget; paused_budget with resume_after = next window start; one-shot job; no call after the breach', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), twoPairs(h).id, confirmed);
    const windowEnd = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd;
    expect(windowEnd).toBe('2026-11-01T00:00:00.000Z');
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBe(windowEnd);
    expect(scheduleResume).toHaveBeenCalledWith(e.id, e.definitionId, windowEnd);
    expect(spent(h, e.id)).toHaveLength(1); // 19 pre-spent + 1 = the cap; nothing reserved after the breach
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(42);
    expect(h.outcomes(e.id, { status: 'skipped' }).every((o) => o.reason === 'budget')).toBe(true);
    expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    expect(kinds(h)).toEqual(['paused_budget']);
  });

  it('two executions sharing the cap never exceed it together; the one that hits it pauses at the window start (cost-r1-012)', async () => {
    // why: each needs 5 calls (4 tiles × 1.2) and both pass the pre-start check against an empty ledger; together they need 8 > 7
    const h = createHarness({ fixtureConcurrency: 2, fixtureMonthlyCallCap: 7 });
    const orch = h.orch();
    // why: other pairs than the first definition's, so http-kit never joins one request to the other's (in-flight dedup)
    const [a, b] = await Promise.all([
      orch.start(twoPairs(h).id, confirmed),
      orch.start(twoPairs(h, { name: 'second', destinations: [EWR] }).id, confirmed),
    ]);
    if (!a.ok || !b.ok) throw new Error('start refused');
    const both = [await h.waitForSettled(a.executionId), await h.waitForSettled(b.executionId)];
    expect(both.reduce((n, e) => n + spent(h, e.id).length, 0)).toBe(7);
    expect(h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls).toBe(7);
    const paused = both.filter((e) => e.status === 'paused_budget');
    expect(paused.length).toBeGreaterThan(0);
    for (const e of paused) expect(e.resumeAfter).toBe('2026-11-01T00:00:00.000Z');
    for (const e of both) {
      expect(['paused_budget', 'completed']).toContain(e.status);
      expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
      expect(h.outcomes(e.id, { status: 'not_run' })).toHaveLength(0);
    }
  });
});

describe('BudgetExceeded global-month (spec §8.1 with decision 25)', () => {
  it('the in-flight call that reserved is written; the sibling refused at reserve and every idle cell become skipped:budget; paused_budget at the global window start', async () => {
    const h = createHarness({ fixtureConcurrency: 2 });
    // why: after the pre-start check, another process leaves room for exactly one fixture call under the £1,000 global cap
    h.onStageStart('discovery', () =>
      h.spendLedger({
        providerId: 'fixture',
        rows: 1,
        costMicroGbpEach: 1_000_000_000 - FIXTURE_COST_MICRO_GBP,
      }),
    );
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK, EWR] }); // 4 pairs × 2 tiles; the fixture pool holds 2
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.status).toBe('paused_budget');
    expect(e.resumeAfter).toBe(h.deps.budget.usage({ kind: 'global-month' }).windowEnd);
    expect(spent(h, e.id)).toHaveLength(1);
    expect(h.outcomes(e.id, { status: 'priced' })).toHaveLength(14);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(98);
    expect(h.outcomes(e.id, { status: 'skipped' }).every((o) => o.reason === 'budget')).toBe(true);
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.notifications[0]?.body).toContain('the monthly spend cap is £1,000');
  });

  it('cost scopes read as money, call scopes as calls; never a bare micro-GBP figure (arch-018)', () => {
    const notice = finalStatus(
      {
        kind: 'budget',
        error: new BudgetExceeded({
          scope: 'global-month',
          cap: 350_000_000,
          current: 350_000_000,
          requested: 3200,
        }),
        resumeAfter: asIsoDateTime('2026-11-01T00:00:00.000Z'),
      },
      asIsoDateTime('2026-10-14T09:00:00.000Z'),
      'Europe/London',
    ).notice;
    expect(notice?.detail).toContain('the monthly spend cap is £350; £350 used; the next call needed £0.01');
    expect(notice?.detail).toContain('Sun, 1 Nov 2026, 00:00 (Europe/London)');
    expect(notice?.detail).not.toMatch(/350000000|3200/);
  });
});

describe('the alerts step and "alerts running on calendar basis only" (spec §6.8, §8.1, decision 25)', () => {
  it('runs once after a completed pass with (deps, executionId); a failing hook is logged, not fatal', async () => {
    const h = createHarness();
    const alerts = vi.fn(async () => ({ digests: 1, events: 2 }));
    const orch = h.orch({ ...h.options, alerts });
    const done = await h.runToCompletion(orch, h.createDefinition().id);
    expect(done.status).toBe('completed');
    expect(alerts).toHaveBeenCalledExactlyOnceWith(h.deps, done.id);
    alerts.mockRejectedValueOnce(new Error('digest render failed'));
    const second = await h.runToCompletion(orch, h.createDefinition().id);
    expect(second.status).toBe('completed');
    expect(h.logs.some((l) => l.msg === 'alerts: step failed')).toBe(true);
  });

  it('never runs after a pass that paused for errors', async () => {
    const h = createHarness({ fakeTimers: true });
    const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const paused = await h.runToCompletion(h.orch({ ...h.options, alerts }), h.createDefinition().id);
    expect(paused.status).toBe('paused_error');
    expect(alerts).not.toHaveBeenCalled();
  });

  it.each([
    ['cancel', (o: Orchestrator, id: string) => o.cancel(id), 'cancelled'],
    ['SIGTERM', (o: Orchestrator) => o.shutdown(), 'interrupted'],
  ] as const)(
    'never runs after a pass stopped by %s (decision 25, test-strategy-reviewer-026)',
    async (_name, stop, status) => {
      const h = createHarness();
      const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
      await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
      const orch = h.orch({ ...h.options, alerts });
      const r = await orch.start(h.createDefinition().id, { trigger: 'manual' });
      if (!r.ok) throw new Error(r.message);
      await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(0));
      await stop(orch, r.executionId);
      expect((await h.waitForSettled(r.executionId)).status).toBe(status);
      expect(alerts).not.toHaveBeenCalled();
    },
  );

  it('a provider-month breach in verification pauses for the window, runs the alerts step over what was written, and tells the operator once', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    const alerts = vi.fn(async () => ({ digests: 0, events: 0 }));
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const def = h.createDefinition({ providers: withVerification() });
    rule(h, def.id);
    const e = await h.runToCompletion(h.orch({ ...h.options, alerts }), def.id);
    expect(e.status).toBe('paused_budget');
    expect(alerts).toHaveBeenCalledExactlyOnceWith(h.deps, e.id);
    const v = h.outcomes(e.id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');
    expect(v).toHaveLength(2);
    expect(v.every((o) => o.status === 'skipped' && o.reason === 'budget')).toBe(true);
    expect(kinds(h)).toEqual(['paused_budget', 'alerts_calendar_only']);
  });

  it('no calendar-only notice when the definition has no alert rule', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ providers: withVerification() }).id);
    expect(e.status).toBe('paused_budget');
    expect(kinds(h)).toEqual(['paused_budget']);
  });
});
```

`packages/engine/test/prestart.test.ts` (new file):

```ts
import { asIsoDate, type Estimate, type ProviderId } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { reservedForSchedules } from '../src/budgetCheck.js';
import { buildContext } from '../src/context.js';
import { withBlocked } from '../src/estimate.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { nothingToSearch } from '../src/start.js';
import {
  createHarness,
  EWR,
  FIXTURE_RULES,
  type Harness,
  JFK,
  LGW,
  LHR,
  refusedWith,
  withVerification,
} from './support/harness.js';

const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });
const confirmDetails = z.object({
  estimateMicroGbp: z.number(),
  estimatePence: z.number(),
  calls: z.record(z.string(), z.number()),
  totalCalls: z.number(),
});
const noCalls = { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 };

describe('pre-start checks (spec §8.1 "for every scope check usage(scope) + estimate(scope) ≤ cap")', () => {
  it('active: a second start while one is active → code active', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const orch = h.orch();
    const def = h.createDefinition();
    const first = await orch.start(def.id, { trigger: 'manual' });
    expect(first.ok).toBe(true);
    expect(await orch.start(def.id, { trigger: 'manual' })).toMatchObject({ ok: false, code: 'active' });
  });

  it('cap: nothing can run → code cap naming the cap and the figures with units; no execution is created', async () => {
    const h = createHarness();
    const def = h.createDefinition({ budget: noCalls });
    expect(refusedWith(await h.orch().start(def.id, { trigger: 'manual' }), 'cap')).toBe(
      "budget cap: this run's billed-call cap is 0 calls; 0 calls used; this run needs 3 calls",
    );
    expect(executions(h, def.id)).toHaveLength(0);
  });

  it('execution-cost: an estimate above the spend cap is refused before any call (test-strategy-reviewer-027)', async () => {
    const h = createHarness();
    const def = h.createDefinition({
      budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 5_000 },
    });
    expect(refusedWith(await h.orch().start(def.id, { trigger: 'manual' }), 'cap')).toBe(
      "budget cap: this run's spend cap is £0.01; £0 used; this run needs £0.01",
    );
    expect(h.count('provider_requests')).toBe(0);
  });

  it('execution-free-calls: a free provider needing more than the free-call cap is refused before any call', async () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    // why: the fixture is billed; its limits read as a free provider's here stand in for Travelpayouts
    const free = { ...ctx, limitsOf: (id: ProviderId) => ({ ...ctx.limitsOf(id), billed: false }) };
    const def = h.createDefinition({
      budget: { maxCalls: 1000, maxFreeCalls: 0, maxCostMicroGbp: 1_000_000_000 },
    });
    expect(
      refusedWith(await h.track(createOrchestrator(free)).start(def.id, { trigger: 'manual' }), 'cap'),
    ).toBe("budget cap: this run's free-call cap is 0 calls; 0 calls used; this run needs 3 calls");
    expect(h.count('provider_requests')).toBe(0);
  });

  it('global-month: spend already in the month plus the estimate above the global cap is refused; the ledger keeps only the pre-spent row', async () => {
    const h = createHarness({ env: { MONTHLY_SPEND_CAP_PENCE: '1' } });
    h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 5_000 });
    expect(refusedWith(await h.orch().start(h.createDefinition().id, { trigger: 'manual' }), 'cap')).toBe(
      'budget cap: the monthly spend cap is £0.01; £0.01 used; this run needs £0.01',
    );
    expect(h.count('provider_requests')).toBe(1);
  });

  it('cap on a scheduled run → skipped_budget recorded and notified', async () => {
    const h = createHarness();
    const def = h.createDefinition({ budget: noCalls });
    expect(await h.orch().start(def.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'cap' });
    const [e] = executions(h, def.id);
    expect(e).toMatchObject({ status: 'skipped_budget', finishedAt: h.clock.now(), trigger: 'schedule' });
    expect(kinds(h)).toEqual(['skipped_budget']);
  });

  it('a blocked provider makes no call: with nothing else to run the start is refused and the ledger stays empty', async () => {
    const h = createHarness();
    const def = h.createDefinition({ providers: withVerification(), budget: noCalls });
    expect(await h.orch().start(def.id, { trigger: 'manual' })).toMatchObject({ ok: false, code: 'cap' });
    expect(h.count('provider_requests')).toBe(0);
  });

  it('the provider-month check keeps the headroom other enabled schedules need this window (ruling 5)', async () => {
    const h = createHarness({ fixtureMonthlyCallCap: 20 });
    h.spendLedger({ providerId: 'fixture', rows: 12, costMicroGbpEach: 0 });
    const def = h.createDefinition();
    // why: a weekly schedule fires on 19 and 26 October before the 1 November window start: 2 × 3 calls reserved; 12 + 6 + 3 > 20
    h.createDefinition({ destinations: [EWR], scheduleCron: '0 5 * * 1' });
    expect(refusedWith(await h.orch().start(def.id, { trigger: 'manual' }), 'cap')).toContain(
      '(6 more reserved for other scheduled runs this window)',
    );
    const lone = createHarness({ fixtureMonthlyCallCap: 20 });
    lone.spendLedger({ providerId: 'fixture', rows: 12, costMicroGbpEach: 0 });
    expect((await lone.orch().start(lone.createDefinition().id, { trigger: 'manual' })).ok).toBe(true);
  });

  it("the reservation uses budgetFit's model: a daily schedule holds its discovery once per reuse window, not once a firing (cost-r2-002)", async () => {
    const h = createHarness({ fixtureMonthlyCallCap: 30 });
    h.spendLedger({ providerId: 'fixture', rows: 12, costMicroGbpEach: 0 });
    const def = h.createDefinition();
    h.createDefinition({ destinations: [EWR], scheduleCron: '0 5 * * *' });
    const ctx = buildContext(h.deps, h.options);
    const windowEnd = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).windowEnd;
    expect(windowEnd).toBe('2026-11-01T00:00:00.000Z');
    // why: 17 daily firings (15–31 October) of 3 factored discovery calls, but discovery at most once per 0.9 × 168 h
    // over the 423 h to the window end: ceil(3 × min(17, 423 / 151.2)) = 9, where one per firing would hold 51
    expect(reservedForSchedules(ctx, 'fixture', def.id, windowEnd)).toBe(Math.ceil(3 * (423 / 151.2)));
    expect(reservedForSchedules(ctx, 'fixture', def.id, windowEnd)).toBe(9);
    expect((await h.orch().start(def.id, { trigger: 'manual' })).ok).toBe(true); // 12 + 9 + 3 ≤ 30
  });

  it('every discovery provider blocked and nothing always included → nothing would be searched, so the start is refused (ssr2-03)', () => {
    const verification = { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 1, bookingLinks: true };
    const line = (providerId: ProviderId, stage: 'discovery' | 'verification', calls: number) => ({
      providerId,
      stage,
      calls,
      planCalls: calls,
      costMicroGbp: 0,
      costPence: 0,
      seconds: 0,
      blocked: null,
    });
    const lines = [line('travelpayouts', 'discovery', 28), line('fixture', 'verification', 8)];
    const cell = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-11-03'),
      returnDate: asIsoDate('2026-11-10'),
    };
    expect(nothingToSearch({ verification }, { perProvider: lines }, new Set(['travelpayouts']))).toBe(true);
    expect(
      nothingToSearch(
        { verification: { ...verification, alwaysInclude: [cell] } },
        { perProvider: lines },
        new Set(['travelpayouts']),
      ),
    ).toBe(false);
    expect(nothingToSearch({ verification }, { perProvider: lines }, new Set())).toBe(false);
    expect(
      nothingToSearch({ verification }, { perProvider: lines }, new Set(['travelpayouts', 'fixture'])),
    ).toBe(true);
    // a discovery line needing no call (every cell reused) is never blocked, so reused prices still feed selection
    const reused = [line('travelpayouts', 'discovery', 0), line('fixture', 'verification', 8)];
    expect(nothingToSearch({ verification }, { perProvider: reused }, new Set())).toBe(false);
  });

  it("totals leave out a blocked provider's lines, which keep their own figures (cost-r1-014)", () => {
    const fixture = {
      providerId: 'fixture' as const,
      stage: 'discovery' as const,
      calls: 3,
      planCalls: 2,
      costMicroGbp: 7680,
      costPence: 1,
      seconds: 2,
      blocked: null,
    };
    const est: Estimate = {
      cells: 28,
      perProvider: [fixture, { ...fixture, providerId: 'searchapi', calls: 60, planCalls: 50, seconds: 900 }],
      totalCalls: 63,
      totalPlanCalls: 52,
      totalCostMicroGbp: 15_360,
      totalCostPence: 2,
      seconds: 902,
      assumptions: ['every call count includes the retry factor 1.2'],
      windowClamped: false,
      retryFactor: 1.2,
    };
    const shown = withBlocked(est, new Map([['searchapi', 'provider-month']]));
    expect(shown.perProvider.map((p) => [p.providerId, p.blocked, p.calls])).toEqual([
      ['fixture', null, 3],
      ['searchapi', 'provider-month', 60],
    ]);
    expect(shown).toMatchObject({
      totalCalls: 3,
      totalPlanCalls: 2,
      totalCostMicroGbp: 7680,
      totalCostPence: 1,
      seconds: 2,
    });
    expect(shown.assumptions).toContain('totals leave out the providers a budget cap blocks');
    expect(withBlocked(est, new Map())).toEqual(est);
  });
});

describe('not_found, disabled and no runnable provider (plan contract StartResult codes, po-003)', () => {
  it('a missing or soft-deleted definition → not_found; a disabled one → disabled; nothing is created', async () => {
    const h = createHarness();
    const o = h.orch();
    expect(await o.start('no-such-definition', { trigger: 'manual' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    const gone = h.createDefinition();
    h.repos.definitions.softDelete(gone.id);
    expect(await o.start(gone.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'not_found' });
    const off = h.createDefinition({ enabled: false });
    expect(await o.start(off.id, { trigger: 'manual' })).toMatchObject({
      ok: false,
      code: 'disabled',
      message: 'this definition is disabled',
    });
    expect(executions(h, gone.id)).toHaveLength(0);
    expect(executions(h, off.id)).toHaveLength(0);
  });

  it('a scheduled run no configured provider can run is refused as a configuration problem, not a budget one', async () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    // why: the plan flag (the SearchApi trial rule, spec §8.2) set on the fixture's limits; the only provider a layer-A test may register
    const trialLike = {
      ...ctx,
      limitsOf: (id: ProviderId) => ({ ...ctx.limitsOf(id), excludedFromSchedule: true }),
    };
    const orch = h.track(createOrchestrator(trialLike));
    const def = h.createDefinition();
    expect(refusedWith(await orch.start(def.id, { trigger: 'schedule' }), 'disabled')).toBe(
      'no configured provider can run this definition on a schedule: fixture is excluded from scheduled runs on its plan',
    );
    expect(executions(h, def.id)).toHaveLength(0);
    expect(h.notifications.map((m) => m.subject)).toEqual([
      '[get-me-there] London to New York (layer A): scheduled run skipped: no configured provider can run it',
    ]);
    expect((await orch.start(def.id, { trigger: 'manual' })).ok).toBe(true);
  });
});

describe('SOFT_CONFIRM in pence and calls; confirmed_cost_pence and confirmed_calls (spec §8.1, §7; ruling 6, decision 37)', () => {
  it('a manual start above SOFT_CONFIRM needs a confirmation naming at least the runnable pence and calls', async () => {
    const h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const orch = h.orch();
    const def = h.createDefinition();
    const r = await orch.start(def.id, { trigger: 'manual' });
    expect(r).toMatchObject({ ok: false, code: 'confirm' });
    expect(confirmDetails.parse(r.ok ? null : r.details)).toEqual({
      estimateMicroGbp: 7680,
      estimatePence: 1,
      calls: { fixture: 3 },
      totalCalls: 3,
    });
    for (const short of [
      { confirmCostPence: 1 },
      { confirmCostPence: 0, confirmCalls: 3 },
      { confirmCostPence: 1, confirmCalls: 2 },
    ])
      refusedWith(await orch.start(def.id, { trigger: 'manual', ...short }), 'confirm');
    expect((await orch.start(def.id, { trigger: 'manual', confirmCostPence: 1, confirmCalls: 3 })).ok).toBe(
      true,
    );
  });

  it('calls trigger the confirmation too, and 0p alone never covers them (ruling 6, cost-r1-005)', async () => {
    const h = createHarness({ fixtureCostMicroGbp: 0, fixtureMonthlyCallCap: 10 });
    const orch = h.orch();
    const def = h.createDefinition(); // 3 calls > 20% of 10
    expect(refusedWith(await orch.start(def.id, { trigger: 'manual' }), 'confirm')).toBe(
      'this run needs 3 fixture calls, more than 20% of its monthly call cap and has not been confirmed',
    );
    refusedWith(await orch.start(def.id, { trigger: 'manual', confirmCostPence: 0 }), 'confirm');
    expect((await orch.start(def.id, { trigger: 'manual', confirmCostPence: 0, confirmCalls: 3 })).ok).toBe(
      true,
    );
  });

  it('a lifetime plan (the SearchApi trial) asks above 20% of its lifetime cap (cost-r2-004)', async () => {
    const h = createHarness({ fixtureCostMicroGbp: 0, fixtureMonthlyCallCap: 10, fixtureWindow: 'lifetime' });
    const ctx = buildContext(h.deps, h.options);
    // why: the guard and the engine both read the fixture's window as lifetime here, as they read the trial's
    const lifetime = {
      ...ctx,
      limitsOf: (id: ProviderId) => ({ ...ctx.limitsOf(id), window: 'lifetime' as const }),
    };
    const orch = h.track(createOrchestrator(lifetime));
    const def = h.createDefinition();
    expect(refusedWith(await orch.start(def.id, { trigger: 'manual' }), 'confirm')).toBe(
      'this run needs 3 fixture calls, more than 20% of its lifetime call cap and has not been confirmed',
    );
    expect((await orch.start(def.id, { trigger: 'manual', confirmCostPence: 0, confirmCalls: 3 })).ok).toBe(
      true,
    );
  });

  it('a scheduled start uses only the stored confirmation; without it, or after an edit that needs more calls → skipped_confirm + notify', async () => {
    const h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const orch = h.orch();
    const def = h.createDefinition();
    const r = await orch.start(def.id, { trigger: 'schedule' });
    expect(r).toMatchObject({ ok: false, code: 'confirm' });
    expect(executions(h, def.id)[0]).toMatchObject({ status: 'skipped_confirm' });
    expect(kinds(h)).toEqual(['skipped_confirm']);
    const details = confirmDetails.parse(r.ok ? null : r.details);
    h.repos.definitions.setConfirmed(def.id, { pence: details.estimatePence, calls: details.totalCalls });
    const again = await orch.start(def.id, { trigger: 'schedule' });
    if (!again.ok) throw new Error(again.message);
    await h.waitForSettled(again.executionId);
    expect(h.repos.definitions.get(def.id)).toMatchObject({ confirmedCostPence: 1, confirmedCalls: 3 }); // never recomputed
    // why: cost-r1-005 — a stored confirmation covers no later edit that needs more calls (two pairs not searched yet,
    // so nothing is reused: 5 calls against the 3 confirmed)
    h.repos.definitions.update(def.id, { origins: [LGW], destinations: [JFK, EWR] });
    refusedWith(await orch.start(def.id, { trigger: 'schedule' }), 'confirm');
    expect(executions(h, def.id).filter((e) => e.status === 'skipped_confirm')).toHaveLength(2);
  });
});

describe('zero-cell window (spec §6.1)', () => {
  it('manual → code window; scheduled → skipped_window, notified, schedule disabled and unregistered', async () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    const unregister = vi.fn();
    ctx.hooks.unregisterSchedule = unregister;
    const orch = h.track(createOrchestrator(ctx));
    const def = h.createDefinition({
      window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-03') },
      scheduleCron: '0 5 * * 1',
    });
    expect(await orch.start(def.id, { trigger: 'manual' })).toMatchObject({ ok: false, code: 'window' });
    expect(executions(h, def.id)).toHaveLength(0);
    expect(await orch.start(def.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'window' });
    expect(executions(h, def.id)[0]).toMatchObject({ status: 'skipped_window' });
    expect(kinds(h)).toEqual(['skipped_window']);
    expect(h.repos.definitions.get(def.id)?.enabled).toBe(false);
    expect(unregister).toHaveBeenCalledWith(def.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run prestart; pnpm --filter @gmt/core exec vitest run api-contract/confirmedCalls; pnpm --filter @gmt/db exec vitest run migration0001 definitions barrel client; pnpm --filter @gmt/api exec vitest run bootstrap/tool`
Expected: FAIL: the engine fails with `Cannot find module '../src/budgetCheck.js'` from `prestart.test.ts`; core with `expected { confirmCostPence: +0 } to deeply equal { confirmCostPence: +0, confirmCalls: 3 }`; db in 6 tests, among them `repo.setConfirmed is not a function` and `expected [ '0000_initial' ] to deeply equal [ '0000_initial', '0001_confirmed_calls' ]`; api with `expected 'backup before 1 migration(s)…' to contain 'backup before 2 migration(s)'`.

- [ ] **Step 3: Implement**

`packages/core/src/api-contract/definitions.ts` — apply this patch:

```diff
--- a/packages/core/src/api-contract/definitions.ts
+++ b/packages/core/src/api-contract/definitions.ts
@@ -95,6 +95,8 @@
   enabled: z.boolean(),
   /** the explicit confirmation from the create click; stored only when it covers the current estimate */
   confirmedCostPence: moneyPenceSchema.optional(),
+  /** decision 37: the calls of that same confirmation; a confirmation covers a run only with both */
+  confirmedCalls: positiveInt.optional(),
 };
 const refineDefinition = (
   d: {
@@ -126,7 +128,9 @@
   }
 };
 /** The unrefined field shape: used to read stored rows back, where the save-time policy refinements must not run. */
-export const definitionShapeSchema = z.object(definitionFields).omit({ confirmedCostPence: true });
+export const definitionShapeSchema = z
+  .object(definitionFields)
+  .omit({ confirmedCostPence: true, confirmedCalls: true });
 export const definitionCreateRequestSchema = z.object(definitionFields).superRefine(refineDefinition);
 export const definitionUpdateRequestSchema = z.object(definitionFields).partial();
 
@@ -170,6 +174,7 @@
 export const definitionResponseSchema = z.object({
   ...definitionFields,
   confirmedCostPence: moneyPenceSchema.nullable(),
+  confirmedCalls: positiveInt.nullable(),
   id: z.string(),
   createdAt: isoDateTimeSchema,
   updatedAt: isoDateTimeSchema,
@@ -177,7 +182,12 @@
   budgetFit: budgetFitSchema,
   estimate: estimateSchema.nullable(),
   needsConfirmation: z
-    .object({ estimateMicroGbp: microGbpSchema, confirmedCostPence: moneyPenceSchema.nullable() })
+    .object({
+      estimateMicroGbp: microGbpSchema,
+      totalCalls: positiveInt,
+      confirmedCostPence: moneyPenceSchema.nullable(),
+      confirmedCalls: positiveInt.nullable(),
+    })
     .nullable(),
   notices: z.array(z.string()),
 });
```

`packages/core/src/api-contract/executions.ts` — apply this patch:

```diff
--- a/packages/core/src/api-contract/executions.ts
+++ b/packages/core/src/api-contract/executions.ts
@@ -50,6 +50,10 @@
   overrun: z.boolean(),
   disabledProviders: z.array(providerIdSchema),
 });
-export const startExecutionRequestSchema = z.object({ confirmCostPence: moneyPenceSchema.optional() });
+/** Decision 37: a manual start confirms the pence and the calls the operator saw; one without the other covers nothing. */
+export const startExecutionRequestSchema = z.object({
+  confirmCostPence: moneyPenceSchema.optional(),
+  confirmCalls: z.number().int().min(0).optional(),
+});
 export const startExecutionResponseSchema = z.object({ executionId: z.string() });
 export const verifyCellRequestSchema = z.object({ definitionId: z.string(), cell: cellKeySchema });
```

`packages/core/src/types/definition.ts` — apply this patch:

```diff
--- a/packages/core/src/types/definition.ts
+++ b/packages/core/src/types/definition.ts
@@ -109,6 +109,8 @@
   scheduleCron: string | null;
   scheduleTz: string;
   confirmedCostPence: number | null;
+  /** Decision 37: the calls of the confirmed estimate, beside its pence; set only from an explicit confirmation. */
+  confirmedCalls: number | null;
   enabled: boolean;
   createdAt: IsoDateTime;
   updatedAt: IsoDateTime;
@@ -117,7 +119,7 @@
 
 export type DefinitionInput = Omit<
   SearchDefinition,
-  'id' | 'confirmedCostPence' | 'createdAt' | 'updatedAt' | 'deletedAt'
+  'id' | 'confirmedCostPence' | 'confirmedCalls' | 'createdAt' | 'updatedAt' | 'deletedAt'
 >;
 
 /** The definition as frozen at execution start, with the resolved window. Spec §8.1. */
```

`packages/db/drizzle/0001_confirmed_calls.sql` (new file):

```sql
ALTER TABLE `search_definitions` ADD `confirmed_calls` integer CONSTRAINT "search_definitions_confirmed_calls_ck" CHECK(confirmed_calls IS NULL OR (typeof(confirmed_calls) = 'integer' AND confirmed_calls >= 0));
```

`packages/db/src/internal/definitionRow.ts` — apply this patch:

```diff
--- a/packages/db/src/internal/definitionRow.ts
+++ b/packages/db/src/internal/definitionRow.ts
@@ -50,6 +50,7 @@
   schedule_cron: string | null;
   schedule_tz: string;
   confirmed_cost_pence: number | null;
+  confirmed_calls: number | null;
   enabled: number;
   deleted_at: string | null;
   created_at: string;
@@ -83,6 +84,7 @@
     ...input,
     id: r.id,
     confirmedCostPence: r.confirmed_cost_pence,
+    confirmedCalls: r.confirmed_calls,
     createdAt: readTime(`${c}.created_at`, r.created_at),
     updatedAt: readTime(`${c}.updated_at`, r.updated_at),
     deletedAt: readNullableTime(`${c}.deleted_at`, r.deleted_at),
@@ -98,6 +100,7 @@
   const {
     id,
     confirmedCostPence: confirmed,
+    confirmedCalls,
     createdAt,
     updatedAt,
     deletedAt,
@@ -114,6 +117,9 @@
     ...input,
     id: readString(column, id),
     confirmedCostPence: confirmed === null || confirmed === undefined ? null : readInt(column, confirmed),
+    // why: snapshots frozen before migration 0001 have no confirmedCalls (decision 37)
+    confirmedCalls:
+      confirmedCalls === null || confirmedCalls === undefined ? null : readInt(column, confirmedCalls),
     createdAt: readTime(column, readString(column, createdAt)),
     updatedAt: readTime(column, readString(column, updatedAt)),
     deletedAt:
```

`packages/db/src/repositories/definitions.ts` — apply this patch:

```diff
--- a/packages/db/src/repositories/definitions.ts
+++ b/packages/db/src/repositories/definitions.ts
@@ -37,7 +37,10 @@
   updatedAt,
 });
 
-/** Spec §7 `search_definitions`, soft-deleted. `confirmed_cost_pence` is set by `create` or `setConfirmedCost`, never by `update`. */
+/**
+ * Spec §7 `search_definitions`, soft-deleted. `confirmed_cost_pence` and `confirmed_calls` (decision 37) are set together
+ * by `create` or `setConfirmed`, never by `update`.
+ */
 export class DefinitionsRepo {
   constructor(
     private readonly db: Db,
@@ -45,24 +48,28 @@
   ) {}
 
   /** Decision 14: the create click's confirmation is stored in the same INSERT, so it can never be lost between two writes. */
-  create(input: DefinitionInput & { confirmedCostPence?: number }): SearchDefinition {
-    const { confirmedCostPence, ...definition } = input;
+  create(
+    input: DefinitionInput & { confirmedCostPence?: number; confirmedCalls?: number },
+  ): SearchDefinition {
+    const { confirmedCostPence, confirmedCalls, ...definition } = input;
     validate(definition);
     assertNullableInt('confirmed_cost_pence', confirmedCostPence ?? null);
+    assertNullableInt('confirmed_calls', confirmedCalls ?? null);
     const id = randomUUID();
     const now = this.clock.now();
     this.db.raw
       .prepare(
         `INSERT INTO search_definitions (id, created_at, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
-          verification_policy_json, budget_json, providers_json, destination_notes_json, onward_cost_json, schedule_cron, schedule_tz, confirmed_cost_pence, enabled, updated_at)
+          verification_policy_json, budget_json, providers_json, destination_notes_json, onward_cost_json, schedule_cron, schedule_tz, confirmed_cost_pence, confirmed_calls, enabled, updated_at)
          VALUES (@id, @createdAt, @name, @origins, @destinations, @window, @minNights, @maxNights, @cabin, @constraints, @verification, @budget, @providers,
-          @destinationNotes, @onwardCost, @scheduleCron, @scheduleTz, @confirmedCostPence, @enabled, @updatedAt)`,
+          @destinationNotes, @onwardCost, @scheduleCron, @scheduleTz, @confirmedCostPence, @confirmedCalls, @enabled, @updatedAt)`,
       )
       .run({
         id,
         createdAt: now,
         ...params(definition, now),
         confirmedCostPence: confirmedCostPence ?? null,
+        confirmedCalls: confirmedCalls ?? null,
       });
     return this.mustGet(id);
   }
@@ -71,6 +78,7 @@
     const {
       id: _id,
       confirmedCostPence: _c,
+      confirmedCalls: _cc,
       createdAt: _ca,
       updatedAt: _u,
       deletedAt,
@@ -119,13 +127,19 @@
       throw new RowRejected('missing', `definition ${id} does not exist`);
   }
 
-  /** Spec §7: set only from an explicit operator confirmation, never recomputed automatically. */
-  setConfirmedCost(id: string, pence: number | null): void {
-    assertNullableInt('confirmed_cost_pence', pence);
+  /**
+   * Spec §7, decision 37: the pence and the calls of one explicit operator confirmation, written together in one
+   * statement and never recomputed automatically; null clears both.
+   */
+  setConfirmed(id: string, confirmed: { pence: number; calls: number } | null): void {
+    assertNullableInt('confirmed_cost_pence', confirmed?.pence ?? null);
+    assertNullableInt('confirmed_calls', confirmed?.calls ?? null);
     if (
       this.db.raw
-        .prepare('UPDATE search_definitions SET confirmed_cost_pence = ?, updated_at = ? WHERE id = ?')
-        .run(pence, this.clock.now(), id).changes === 0
+        .prepare(
+          'UPDATE search_definitions SET confirmed_cost_pence = ?, confirmed_calls = ?, updated_at = ? WHERE id = ?',
+        )
+        .run(confirmed?.pence ?? null, confirmed?.calls ?? null, this.clock.now(), id).changes === 0
     ) {
       throw new RowRejected('missing', `definition ${id} does not exist`);
     }
```

`packages/db/src/schema/searchDefinitions.ts` — apply this patch:

```diff
--- a/packages/db/src/schema/searchDefinitions.ts
+++ b/packages/db/src/schema/searchDefinitions.ts
@@ -23,6 +23,7 @@
     scheduleCron: text('schedule_cron'),
     scheduleTz: text('schedule_tz').notNull(),
     confirmedCostPence: integer('confirmed_cost_pence'),
+    confirmedCalls: integer('confirmed_calls'),
     enabled: integer('enabled').notNull(),
     deletedAt: text('deleted_at'),
     createdAt: text('created_at').notNull(),
@@ -33,6 +34,7 @@
     check('search_definitions_min_nights_ck', isInteger('min_nights')),
     check('search_definitions_max_nights_ck', isInteger('max_nights')),
     check('search_definitions_confirmed_ck', isNullOrInteger('confirmed_cost_pence')),
+    check('search_definitions_confirmed_calls_ck', isNullOrInteger('confirmed_calls')),
     check('search_definitions_enabled_ck', isBool('enabled')),
     check('search_definitions_created_ck', isIsoTimestamp('created_at')),
     check('search_definitions_updated_ck', isIsoTimestamp('updated_at')),
```

`packages/engine/src/budgetCheck.ts` (new file):

```ts
import type { BudgetScopeKind, ExecutionBudget, ProviderId, Stage } from '@gmt/core';
import type { EngineContext } from './context.js';
import { monthlyLoad, otherSchedules, scheduleLoad } from './estimate.js';
import { firingsBetween } from './scheduler/parseCron.js';
import { breachText } from './text.js';
import type { Estimate } from './types.js';

export interface PlannedSpend {
  providerId: ProviderId;
  stage: Stage;
  calls: number;
  costMicroGbp: number;
}
/** One scope a planned run would breach; `reserved` is what other scheduled runs hold in this window (ruling 5). */
export interface Breach {
  scope: BudgetScopeKind;
  providerId: ProviderId | null;
  cap: number;
  current: number;
  reserved: number;
  estimated: number;
}
/** `blockedBy` names the first scope that blocked each provider (Estimate.perProvider[].blocked). */
export interface BudgetCheck {
  blocked: Set<ProviderId>;
  blockedBy: Map<ProviderId, string>;
  breaches: Breach[];
}

export function spendOf(e: Pick<Estimate, 'perProvider'>): PlannedSpend[] {
  return e.perProvider.map((p) => ({
    providerId: p.providerId,
    stage: p.stage,
    calls: p.calls,
    costMicroGbp: p.costMicroGbp,
  }));
}

/**
 * Ruling 5: the calls the other enabled scheduled definitions will need from `providerId` before the cap window
 * closes, so one run cannot take the headroom the schedules were sized against. Each schedule's need is budgetFit's
 * model over the rest of the window (scheduleLoad, cost-r2-002): verification on each firing until `windowEnd`,
 * discovery at most once per reuse window; rounded up to whole calls.
 */
export function reservedForSchedules(
  ctx: EngineContext,
  providerId: ProviderId,
  definitionId: string | null,
  windowEnd: string | null,
): number {
  if (windowEnd === null) return 0;
  const now = ctx.clock.now();
  const hours = (Date.parse(windowEnd) - Date.parse(now)) / 3_600_000;
  let reserved = 0;
  for (const d of otherSchedules(ctx, definitionId)) {
    if (d.scheduleCron === null) continue;
    const firings = firingsBetween(
      d.scheduleCron,
      d.scheduleTz,
      new Date(now),
      new Date(Date.parse(windowEnd) - 1),
    ).length;
    if (firings === 0) continue;
    const m = monthlyLoad(ctx, d);
    reserved += scheduleLoad(ctx, m.perRun, m.snapshot, firings, hours).get(providerId)?.calls ?? 0;
  }
  return Math.ceil(reserved);
}

/**
 * Spec §8.1 pre-start: for every scope, usage(scope) + estimate(scope) ≤ cap. A breach on a billed scope
 * (execution-calls, execution-cost, global-month) blocks every billed provider; a breach on execution-free-calls
 * blocks the free providers; a provider-month/lifetime breach blocks that provider. A cap of 0 refuses any non-zero
 * need; zero-cost needs pass (spec §5.3). With `executionId` the execution scopes include what this execution already
 * spent (resume). Provider-month scopes count the headroom other scheduled runs hold in this window (ruling 5).
 */
export function checkBudget(
  ctx: EngineContext,
  spend: readonly PlannedSpend[],
  budget: ExecutionBudget,
  executionId: string | null,
  definitionId: string | null,
): BudgetCheck {
  const blocked = new Set<ProviderId>();
  const blockedBy = new Map<ProviderId, string>();
  const breaches: Breach[] = [];
  const billed = spend.filter((s) => ctx.limitsOf(s.providerId).billed);
  const free = spend.filter((s) => !ctx.limitsOf(s.providerId).billed);
  const ids = (xs: readonly PlannedSpend[]) => [...new Set(xs.map((s) => s.providerId))];
  const total = (xs: readonly PlannedSpend[], f: (s: PlannedSpend) => number) =>
    xs.reduce((a, s) => a + f(s), 0);
  const check = (
    scope: BudgetScopeKind,
    providerId: ProviderId | null,
    cap: number | null,
    current: number,
    reserved: number,
    estimated: number,
    affected: readonly ProviderId[],
  ) => {
    if (cap === null || estimated === 0) return;
    if (current + reserved + estimated <= cap) return;
    breaches.push({ scope, providerId, cap, current, reserved, estimated });
    for (const id of affected) {
      blocked.add(id);
      if (!blockedBy.has(id)) blockedBy.set(id, scope);
    }
  };
  const execUsage = (kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost') =>
    executionId === null ? { calls: 0, costMicroGbp: 0 } : ctx.budget.usage({ kind, executionId });
  check(
    'execution-calls',
    null,
    budget.maxCalls,
    execUsage('execution-calls').calls,
    0,
    total(billed, (s) => s.calls),
    ids(billed),
  );
  check(
    'execution-free-calls',
    null,
    budget.maxFreeCalls,
    execUsage('execution-free-calls').calls,
    0,
    total(free, (s) => s.calls),
    ids(free),
  );
  check(
    'execution-cost',
    null,
    budget.maxCostMicroGbp,
    execUsage('execution-cost').costMicroGbp,
    0,
    total(billed, (s) => s.costMicroGbp),
    ids(billed),
  );
  for (const id of ids(spend)) {
    const kind = ctx.limitsOf(id).window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
    const u = ctx.budget.usage({ kind, providerId: id });
    const reserved = kind === 'provider-month' ? reservedForSchedules(ctx, id, definitionId, u.windowEnd) : 0;
    check(
      kind,
      id,
      u.cap,
      u.calls,
      reserved,
      total(
        spend.filter((s) => s.providerId === id),
        (s) => s.calls,
      ),
      [id],
    );
  }
  const g = ctx.budget.usage({ kind: 'global-month' });
  check(
    'global-month',
    null,
    g.cap,
    g.costMicroGbp,
    0,
    total(billed, (s) => s.costMicroGbp),
    ids(billed),
  );
  return { blocked, blockedBy, breaches };
}

/** The 409 message: every breached cap in plain English with its figures and units (spec §8.1, arch-018). */
export function breachMessage(breaches: readonly Breach[]): string {
  return breaches
    .map((b) => {
      const reserved =
        b.reserved > 0 ? ` (${b.reserved} more reserved for other scheduled runs this window)` : '';
      return `${breachText(b.scope, b.providerId, b.cap, b.current, b.estimated, 'this run needs')}${reserved}`;
    })
    .join('; ');
}
```

`packages/engine/src/context.ts` — replace or add these declarations:

```ts
/** Callbacks the scheduler installs once it exists (createEngine); no-ops until then. Spec §8.1 one-shot jobs. */
export interface EngineHooks {
  scheduleResume(executionId: string, definitionId: string, at: IsoDateTime): void;
  cancelResume(executionId: string): void;
  /** Removes a definition's cron job; called when the engine itself disables a schedule (spec §6.1 zero-cell window). */
  unregisterSchedule(definitionId: string): void;
}

/**
 * Builds the engine context. Fails fast when a registered provider has no budget entry: the fixture provider without
 * the synthetic gate (budgetConfigFromConfig leaves it out, spec §5.5), or a real provider whose key is not configured.
 */
export function buildContext(deps: EngineDeps, options: EngineOptions = {}): EngineContext {
  const providers = new Map<ProviderId, FlightProvider>(deps.providers.map((p) => [p.id, p]));
  const config = deps.config;
  const budgets = budgetConfigFromConfig(config);
  const limitsOf = (id: ProviderId): ProviderRunLimits => {
    const b = budgets.providers[id];
    if (b === undefined) {
      throw new Error(
        id === 'fixture' && !syntheticAllowed(config)
          ? 'the fixture provider is registered but syntheticAllowed(config) is false (spec §5.5)'
          : `no limits configured for provider ${id}`,
      );
    }
    return {
      // why: plan EngineOptions — tests pin the pool size per provider; production reads config limits
      concurrency: options.providerConcurrency?.[id] ?? b.concurrency,
      costPerCallMicroGbp: b.costPerCallMicroGbp,
      ratePerMinute: b.ratePerMinute,
      ratePerHour: b.ratePerHour,
      window: b.window,
      planFixedMicroGbp: b.planFixedMicroGbp,
      excludedFromSchedule: b.excludedFromSchedule,
      billed: b.billable,
    };
  };
  for (const id of providers.keys()) limitsOf(id); // why: a missing limit is a wiring bug; fail at construction, not mid-run
  return {
    deps,
    config,
    db: deps.db,
    repos: deps.repos,
    budget: deps.budget,
    http: deps.http,
    clock: deps.clock,
    log: deps.log,
    notifiers: deps.notifiers,
    providers,
    limitsOf,
    alertsStep: options.alerts ?? noAlerts,
    // why: spec §2/§5.2 — SearchApi echoes gl = POINT_OF_SALE; Travelpayouts and the fixture state none. A deliberate
    // engine rule known before any call (reuse matching); reuse.test.ts pins it against the fixture's echo, and WP5's
    // adapter test pins SearchApi's echo (arch-r2-013)
    pointOfSaleOf: (id) => (id === 'searchapi' ? config.pointOfSale : 'unknown'),
    hooks: {
      scheduleResume: () => undefined,
      cancelResume: () => undefined,
      unregisterSchedule: () => undefined,
    },
  };
}
```

`packages/engine/src/estimate.ts` — replace or add these declarations:

```ts
/**
 * The estimate with each line's `blocked` scope set from a budget check, and the totals summed over the lines that will
 * run, so the figure shown, stored and confirmed is the runnable one and a blocked provider's plan never inflates the
 * overrun baseline (cost-r1-014). Blocked lines keep their figures, so the form still shows what they would need.
 */
export function withBlocked(e: Estimate, blockedBy: ReadonlyMap<ProviderId, string>): Estimate {
  const perProvider = e.perProvider.map((p) => ({ ...p, blocked: blockedBy.get(p.providerId) ?? null }));
  const runs = perProvider.filter((p) => p.blocked === null);
  const totalCostMicroGbp = runs.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    ...e,
    perProvider,
    totalCalls: runs.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: runs.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: Math.ceil(totalCostMicroGbp / PENCE_TO_MICRO),
    seconds: runs.reduce((a, p) => a + p.seconds, 0),
    assumptions:
      runs.length === perProvider.length
        ? e.assumptions
        : [...e.assumptions, 'totals leave out the providers a budget cap blocks'],
  };
}
```

`packages/engine/src/orchestrator.ts` — replace or add these declarations:

```ts
/** The execution half of the Engine; createEngine (Task 7.19) adds estimates, scheduler, boot and status. */
export interface Orchestrator {
  start(
    definitionId: string,
    opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number },
  ): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  /** Spec §8.1 AbortedError row: cells in flight → not_run, status cancelled. False when there is nothing to cancel. */
  cancel(executionId: string): Promise<boolean>;
  /** Aborts every pass as SIGTERM (cells in flight → not_run, status interrupted) and waits for them. */
  shutdown(): Promise<void>;
  running(): string[];
}
```

`packages/engine/src/run.ts` — replace or add these declarations:

```ts
/**
 * Cells of (stage, provider) this pass should fetch: none for a provider disabled or blocked for budget in this pass;
 * otherwise the spec §7 resume query (which never returns `no-return-legs` or `no-priced-options` errors, decision 37).
 */
export function runnableCells(
  ctx: EngineContext,
  run: RunState,
  stage: Stage,
  providerId: ProviderId,
): CellKey[] {
  // why: a provider the pre-start or resume check blocked for budget makes no call in this pass (cost-r1-001)
  if (run.disabled.has(providerId) || run.blocked.has(providerId)) return [];
  return ctx.repos.cells.resumable(run.executionId, stage, providerId, run.manual);
}
```

`packages/engine/src/start.ts` — replace the file:

```ts
import {
  type DefinitionSnapshot,
  type Execution,
  formatPence,
  PENCE_TO_MICRO,
  type ProviderId,
  type SearchDefinition,
} from '@gmt/core';
import { breachMessage, checkBudget, spendOf } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { estimateStart, withBlocked } from './estimate.js';
import { execute } from './execute.js';
import { notifyOperator } from './notify.js';
import type { RunRegistry } from './registry.js';
import { markRemaining, newRun } from './run.js';
import { buildSnapshot } from './snapshot.js';
import type { Estimate, StartResult } from './types.js';

/** A refused StartResult. */
export function refused(
  code: Extract<StartResult, { ok: false }>['code'],
  message: string,
  details: unknown,
): StartResult {
  return { ok: false, code, message, details };
}

/** better-sqlite3 reports a partial-unique-index clash (spec §7 one active parent, one active child per cell) as SQLITE_CONSTRAINT_UNIQUE. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Spec §8.1 SOFT_CONFIRM, calls as well as pence (ruling 6): runnable calls of a provider above this share of its call
 * cap (monthly, or lifetime for a lifetime plan) need confirming.
 */
export const SOFT_CONFIRM_CALL_SHARE = 0.2;

/** What the operator confirmed: the pence and the calls of the estimate they saw (decision 37, cost-r1-005). */
export interface Confirmation {
  pence: number | null;
  calls: number | null;
}

/** Records a scheduled run that did not start (spec §7 statuses skipped_*), then notifies (spec §8.1). */
export async function recordSkipped(
  ctx: EngineContext,
  def: SearchDefinition,
  snapshot: DefinitionSnapshot,
  estimate: Estimate | null,
  status: 'skipped_budget' | 'skipped_confirm' | 'skipped_window' | 'skipped_missed',
  detail: string,
): Promise<string> {
  const exec = ctx.repos.executions.create({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot,
    estimate,
    trigger: 'schedule',
    status,
  });
  await notifyOperator(ctx, status, {
    executionId: exec.id,
    definitionId: def.id,
    definitionName: def.name,
    detail,
  });
  ctx.log.info(
    { executionId: exec.id, definitionId: def.id, status },
    'execution: scheduled run not started',
  );
  return exec.id;
}

/**
 * Spec §8.1 SOFT_CONFIRM: the runnable (not blocked) part of the estimate needs confirming when its cost is above the
 * pence threshold, or when a provider's runnable calls exceed SOFT_CONFIRM_CALL_SHARE of its call cap — the monthly
 * cap, or the lifetime cap of a lifetime plan such as the SearchApi trial (ruling 6, cost-r2-004) — so a plan whose
 * calls cost 0 still asks before a large run. A confirmation covers the run only when it names at least the runnable
 * cost (pence × PENCE_TO_MICRO ≥ cost) and at least the runnable calls in total (decision 37): a confirmation of 0p
 * alone never covers a run of any size. Null when no confirmation is needed, else the refusal details, whose
 * `totalCalls` and `estimatePence` are what a client confirms.
 */
export function confirmationNeeded(
  ctx: EngineContext,
  estimate: Estimate,
  blocked: ReadonlySet<ProviderId>,
  confirmed: Confirmation,
): {
  estimateMicroGbp: number;
  estimatePence: number;
  calls: Partial<Record<ProviderId, number>>;
  totalCalls: number;
  reason: string;
} | null {
  const runnable = estimate.perProvider.filter((p) => !blocked.has(p.providerId));
  const cost = runnable.reduce((a, p) => a + p.costMicroGbp, 0);
  const totalCalls = runnable.reduce((a, p) => a + p.calls, 0);
  const calls = new Map<ProviderId, number>();
  for (const p of runnable) calls.set(p.providerId, (calls.get(p.providerId) ?? 0) + p.calls);
  const heavy = [...calls].flatMap(([id, n]) => {
    const window = ctx.limitsOf(id).window;
    const kind = window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
    const cap = ctx.budget.usage({ kind, providerId: id }).cap;
    return cap !== null && n > SOFT_CONFIRM_CALL_SHARE * cap
      ? [
          `${n} ${id} calls, more than ${SOFT_CONFIRM_CALL_SHARE * 100}% of its ${window === 'lifetime' ? 'lifetime' : 'monthly'} call cap`,
        ]
      : [];
  });
  const overPence = cost > ctx.config.spend.softConfirmMicroGbp;
  if (!overPence && heavy.length === 0) return null;
  if (
    confirmed.pence !== null &&
    confirmed.calls !== null &&
    confirmed.pence * PENCE_TO_MICRO >= cost &&
    confirmed.calls >= totalCalls
  )
    return null;
  const estimatePence = Math.ceil(cost / PENCE_TO_MICRO);
  const reason = overPence
    ? `the estimate of ${formatPence(estimatePence)} is above the confirmation threshold`
    : `this run needs ${heavy.join(' and ')}`;
  return { estimateMicroGbp: cost, estimatePence, calls: Object.fromEntries(calls), totalCalls, reason };
}

/**
 * ssr2-03: a run whose every discovery line is blocked for budget would select only `alwaysInclude` cells, so with
 * none it would search nothing and end `completed`. A line that needs no call (every cell reused, or a cabin the
 * provider does not sell) is never blocked, so reused prices still feed selection.
 */
export function nothingToSearch(
  snapshot: Pick<DefinitionSnapshot, 'verification'>,
  estimate: Pick<Estimate, 'perProvider'>,
  blocked: ReadonlySet<ProviderId>,
): boolean {
  const all = estimate.perProvider;
  if (all.length > 0 && all.every((p) => blocked.has(p.providerId))) return true;
  const discovery = all.filter((p) => p.stage === 'discovery');
  return (
    snapshot.verification.alwaysInclude.length === 0 &&
    discovery.length > 0 &&
    discovery.every((p) => blocked.has(p.providerId))
  );
}

/**
 * Spec §8.1 pre-start (scheduler tick and POST) then start. Order: not found → disabled → active → window → no
 * runnable provider → per-scope budget (a provider-specific or billed breach seeds that provider skipped:budget; the
 * start is refused when nothing can run, or when every discovery provider is blocked and no cell is always included)
 * → SOFT_CONFIRM against what will run, in pence and calls → snapshot, seed, run. The stored estimate's totals are the
 * runnable ones (withBlocked).
 */
export async function startExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  definitionId: string,
  opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number },
): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', `definition ${definitionId} not found`, { definitionId });
  // why: a disabled definition is neither scheduled nor started by hand until it is enabled again
  if (!def.enabled) return refused('disabled', 'this definition is disabled', { definitionId });
  if (ctx.repos.executions.activeParent(def.id) !== null)
    return refused('active', 'another execution of this definition is active', { definitionId });
  const scheduled = opts.trigger === 'schedule';
  const built = buildSnapshot(ctx, def, opts.trigger);
  const { snapshot, cells } = built;

  if (cells.length === 0) {
    const message = `the window resolves to no departure dates (${snapshot.resolved.departureFrom} to ${snapshot.resolved.departureTo})`;
    if (scheduled) {
      await recordSkipped(
        ctx,
        def,
        snapshot,
        null,
        'skipped_window',
        `The ${message}; the schedule is disabled.`,
      );
      ctx.repos.definitions.update(def.id, { enabled: false }); // why: spec §6.1 "record skipped_window … and disable the schedule"
      ctx.hooks.unregisterSchedule(def.id);
    }
    return refused('window', message, {
      departureFrom: snapshot.resolved.departureFrom,
      departureTo: snapshot.resolved.departureTo,
    });
  }

  const all = [...new Set([...snapshot.providers.discovery, ...snapshot.providers.verification])];
  if (all.length === 0) {
    // why: a configuration problem, not a spend one (po-003): no skipped_budget row, its own wording, named providers
    const why =
      built.notes.filter((n) => n.includes('left out') || n.includes('excluded')).join('; ') ||
      'the definition names no provider';
    const message = `no configured provider can run this definition${scheduled ? ' on a schedule' : ''}: ${why}`;
    if (scheduled)
      await notifyOperator(ctx, 'skipped_budget', {
        executionId: null,
        definitionId: def.id,
        definitionName: def.name,
        detail: message,
        variant: 'no-runnable-provider',
      });
    return refused('disabled', message, { definitionId, notes: built.notes });
  }

  const planned = estimateStart(ctx, snapshot, cells, def.id);
  const check = checkBudget(ctx, spendOf(planned), snapshot.budget, null, def.id);
  const estimate = withBlocked(planned, check.blockedBy);
  if (nothingToSearch(snapshot, planned, check.blocked)) {
    const starved = all.some((id) => !check.blocked.has(id));
    const message = `budget cap: ${breachMessage(check.breaches)}${starved ? '; every discovery provider is blocked, so nothing would be searched' : ''}`;
    if (scheduled) await recordSkipped(ctx, def, snapshot, estimate, 'skipped_budget', `The ${message}.`);
    return refused('cap', message, { breaches: check.breaches });
  }

  const confirmed: Confirmation = scheduled
    ? { pence: def.confirmedCostPence, calls: def.confirmedCalls }
    : { pence: opts.confirmCostPence ?? null, calls: opts.confirmCalls ?? null };
  const confirm = confirmationNeeded(ctx, estimate, check.blocked, confirmed);
  if (confirm !== null) {
    const message = `${confirm.reason} and has not been confirmed`;
    if (scheduled)
      await recordSkipped(ctx, def, snapshot, estimate, 'skipped_confirm', `This run ${message}.`);
    return refused('confirm', message, {
      estimateMicroGbp: confirm.estimateMicroGbp,
      estimatePence: confirm.estimatePence,
      calls: confirm.calls,
      totalCalls: confirm.totalCalls,
    });
  }

  const discovery = snapshot.providers.discovery;
  let exec: Execution;
  try {
    // why: spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start" — the row is created running and
    // seeded in one BEGIN IMMEDIATE, so a crash can never leave an execution without its cells (ssr-07); blocked
    // providers are seeded skipped:budget in it
    exec = ctx.db.immediateTransaction(() => {
      const e = ctx.repos.executions.create({
        definitionId: def.id,
        isChild: false,
        cell: null,
        snapshot,
        estimate,
        trigger: opts.trigger,
        status: 'running',
      });
      ctx.repos.cells.seed(e.id, cells, discovery);
      for (const id of discovery) {
        // why: spec rev 10 — a provider that does not sell the snapshot's cabin is never called; its cells are no_data
        if (!(ctx.providers.get(id)?.cabins ?? []).includes(snapshot.cabin))
          ctx.repos.cells.markNoData(e.id, 'discovery', id, 'cabin-not-offered');
        else if (check.blocked.has(id)) markRemaining(ctx, { executionId: e.id }, 'discovery', id, 'budget');
      }
      return e;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      return refused('active', 'another execution of this definition is active', { definitionId });
    throw err;
  }
  const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: check.blocked });
  run.log.info(
    { trigger: opts.trigger, cells: cells.length, notes: built.notes, blocked: [...check.blocked] },
    'execution: started',
  );
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
```

`packages/engine/src/types.ts` — replace the file:

```ts
import type {
  BudgetFit,
  BudgetGuard,
  CellKey,
  Clock,
  Config,
  CoverageCheckRequest,
  CoverageCheckResponse,
  DefinitionInput,
  Estimate,
  FlightProvider,
  IsoDate,
  IsoDateTime,
  Logger,
  Notifier,
  ProviderId,
  ResponseCache,
  SchedulerJob,
  SearchDefinition,
} from '@gmt/core';
import type { Db, Repos } from '@gmt/db';
import type { HttpKit } from '@gmt/providers';

// why: core already exports these five as types (plan decisions 16 and 17); the engine re-exports core's, never its own copies
export type {
  BudgetFit,
  CoverageCheckRequest,
  CoverageCheckResponse,
  Estimate,
  SchedulerJob,
} from '@gmt/core';

/** Ports the engine is built on; constructed by the api bootstraps (WP4b/WP8) or the layer-A harness. Plan contract "Engine". */
export interface EngineDeps {
  config: Config;
  db: Db;
  repos: Repos;
  budget: BudgetGuard;
  cache: ResponseCache;
  http: HttpKit;
  providers: FlightProvider[];
  notifiers: Notifier[];
  clock: Clock;
  log: Logger;
}
/** The alerts step of spec §8.1 ("alerts: evaluateAlertRules → persist events → notify digests"); WP11 provides runAlerts. */
export type AlertsStepHook = (
  deps: EngineDeps,
  executionId: string,
) => Promise<{ digests: number; events: number }>;
/**
 * Engine options. Every cost and limit comes from `config` (ruling 3); `providerConcurrency` overrides the pool size per
 * provider and is passed only by tests.
 */
export interface EngineOptions {
  alerts?: AlertsStepHook;
  providerConcurrency?: Partial<Record<ProviderId, number>>;
}

/** Spec §8.1 pre-start outcomes; WP8 maps them to HTTP (409, 409 needsConfirmation, 422, 404, 409). */
export type StartResult =
  | { ok: true; executionId: string }
  | {
      ok: false;
      code: 'active' | 'cap' | 'confirm' | 'window' | 'not_found' | 'disabled';
      message: string;
      details: unknown;
    };

/** The plan's "Engine" contract. */
export interface Engine {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  start(
    definitionId: string,
    opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number },
  ): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  cancel(executionId: string): Promise<boolean>;
  verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;
  estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate;
  estimateRemaining(executionId: string): Estimate;
  budgetFit(definition: DefinitionInput | SearchDefinition): BudgetFit;
  coverageCheck(req: CoverageCheckRequest): Promise<CoverageCheckResponse>;
  scheduler: {
    register(def: SearchDefinition): void;
    unregister(definitionId: string): void;
    jobs(): SchedulerJob[];
    tick(definitionId: string): Promise<void>;
    blockedSince(): IsoDateTime | null;
  };
  status(): {
    running: string[];
    degraded: boolean;
    nextRun: IsoDateTime | null;
    lastExecutionAt: IsoDateTime | null;
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/db exec drizzle-kit generate --name confirmed_calls`, then write the SQL block above over the generated `packages/db/drizzle/0001_confirmed_calls.sql`, then `pnpm --filter @gmt/engine exec vitest run prestart estimate budget-breach seeding && pnpm --filter @gmt/db test && pnpm --filter @gmt/core test && pnpm --filter @gmt/api test`
Expected: PASS, 55 engine tests; db, core (100%) and api suites green.

- [ ] **Step 5: Commit**

```bash
git add packages/engine packages/core packages/db apps/api && git commit -m "wp07: pre-start checks per scope with schedule headroom, SOFT_CONFIRM in pence and calls, confirmed_calls (migration 0001), skipped_* records

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.14: Resume semantics — compare-and-set, departed left out of the cap check and marked in the claim, manual re-enable, retry-errors

**Files:**
- Create: `packages/engine/test/resume.test.ts`
- Modify: `packages/engine/src/resume.ts` (`resumeExecution`), `src/estimate.ts` (`addPass`)

**Interfaces:**
- Consumes: `ExecutionsRepo.claimResume/activeParent/activeChild/patch`, `DefinitionsRepo.get`, `CellsRepo.markDeparted/resumable`, `estimateRemainingFor`, `checkBudget`, `confirmationNeeded`, `Db.immediateTransaction`.
- Produces: the final `resumeExecution(ctx, reg, executionId, { manual })`; `addPass(stored, pass)`.

Order and rules: the cap check prices only what can still run, because `estimateRemaining` leaves out the cells whose departure date has arrived (po-016); nothing is written until the claim succeeds, so a refused or lost resume leaves every outcome row as it was (arch-r2-006), and the departed cells are marked `skipped:departed` inside the claim transaction; a manual resume of a paused_budget parent checks the definition's current budget and writes it into the snapshot only inside the claim transaction (ssr-09, cost-r1-013), and a raised budget needs the stored confirmation, pence and calls, when the remaining run needs one (cost-r1-005, decision 37); a resume before any selection whose remaining discovery is all blocked, with no price yet and no cell always included, is refused like such a start (ssr2-03); the claim transaction also marks the blocked providers' cells `skipped:budget` and adds the pass's runnable plan (`withBlocked`) to the stored estimate (cost-r1-001, cost-r1-009, cost-r1-014); a completed execution whose only errors are `no-priced-options` has nothing to retry and its stored estimate is unchanged (ssr2-04); an automatic resume of a paused_error with nothing resumable is refused and leaves the execution as it is, unclaimed (ruling 10, ssr-18); a completed execution resumes only with retryable errors left. A successful retry leaves `attempts` at 1 (attempts count failed passes, ssr-03). Every test asserts the exact result, with no conditional branch (test-strategy-reviewer-008).

- [ ] **Step 1: Write the failing test**

`packages/engine/test/resume.test.ts` (new file):

```ts
import { asIsoDateTime, cellKeyString, ProviderError } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  JFK,
  LGW,
  LHR,
  refusedWith,
  tileRule,
  withVerification,
} from './support/harness.js';
import { throwOnSearch } from './support/wrappers.js';

const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });
const confirmed = { trigger: 'manual', confirmCostPence: 100, confirmCalls: 1000 } as const;

async function interruptedAfter(h: Harness, k: number, defId = twoPairs(h).id): Promise<string> {
  const first = h.orch();
  h.onTileCommit((n) => {
    if (n === k) void first.shutdown();
  });
  const r = await first.start(defId, { trigger: 'manual' });
  if (!r.ok) throw new Error(r.message);
  await h.waitForSettled(r.executionId);
  h.clearHooks();
  return r.executionId;
}

describe('resume (spec §8.1 "Resume", §7 resume query)', () => {
  it('is a compare-and-set: of two concurrent resumes exactly one proceeds; the loser gets code active', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(h, 1);
    const results = await Promise.all([
      h.orch().resume(id, { manual: false }),
      h.orch().resume(id, { manual: false }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([expect.objectContaining({ ok: false, code: 'active' })]);
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('refuses while another execution of the definition is active', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h);
    const id = await interruptedAfter(h, 1, def.id);
    const o = h.orch();
    expect(await o.cancel(id)).toBe(true); // cancelled: resumable, no longer active
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const other = await o.start(def.id, { trigger: 'manual' });
    expect(other.ok).toBe(true);
    expect(await o.resume(id, { manual: true })).toMatchObject({
      ok: false,
      code: 'active',
      message: 'another execution of this definition is active',
    });
  });

  it('marks not_run cells whose departure date has arrived as skipped:departed and leaves searched cells alone', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(h, 1);
    const searched = new Map(
      h
        .outcomes(id)
        .filter((o) => o.status !== 'not_run')
        .map((o) => [cellKeyString(o), o.status]),
    );
    expect(searched.size).toBe(14);
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // today (London) = 2026-11-03
    expect(await h.orch().resume(id, { manual: false })).toEqual({ ok: true, executionId: id });
    await h.waitForSettled(id);
    const departed = h
      .outcomes(id)
      .filter((o) => !searched.has(cellKeyString(o)) && o.departureDate <= '2026-11-03');
    expect(departed.length).toBe(4); // LGW, 2 and 3 November × 7–8 nights
    expect(departed.every((o) => o.status === 'skipped' && o.reason === 'departed')).toBe(true);
    const after = h.outcomes(id);
    const kept = after.filter((o) => searched.has(cellKeyString(o)));
    expect(kept).toHaveLength(14);
    expect(kept.every((o) => o.status === searched.get(cellKeyString(o)))).toBe(true);
    const later = after.filter((o) => !searched.has(cellKeyString(o)) && o.departureDate > '2026-11-03');
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((o) => o.status === 'priced')).toBe(true);
  });

  it('a refused resume writes nothing: departed cells stay as they were until a resume is claimed (arch-r2-006)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h, { budget: { maxCalls: 6, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 2, costMicroGbpEach: 0, executionId: id }),
    );
    const id = await interruptedAfter(h, 1, def.id);
    h.clearHooks();
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // some not_run cells have departed
    const before = h.outcomes(id);
    expect(
      before.filter((o) => o.status === 'not_run' && o.departureDate <= '2026-11-03').length,
    ).toBeGreaterThan(0);
    refusedWith(await h.orch().resume(id, { manual: false }), 'cap');
    expect(h.outcomes(id)).toEqual(before);
    expect(h.repos.executions.get(id)?.status).toBe('interrupted');
  });

  it('departed cells are left out of the cap check, so they never count against it (po-016)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    // why: the start needs 5 of 6 calls; pass one uses 3 (2 spent by a concurrent pass + 1 tile); 3 tiles left need
    // ceil(3 × 1.2) = 4 > 3, but with the first week departed only 2 tiles (3 calls) remain
    const def = twoPairs(h, { budget: { maxCalls: 6, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 2, costMicroGbpEach: 0, executionId: id }),
    );
    const id = await interruptedAfter(h, 1, def.id);
    expect(await h.orch().resume(id, { manual: false })).toMatchObject({ ok: false, code: 'cap' });
    h.clock.set(asIsoDateTime('2026-11-09T10:00:00.000Z'));
    expect(await h.orch().resume(id, { manual: false })).toEqual({ ok: true, executionId: id });
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('automatic resume of an auth-paused run is refused and leaves it paused_error; a manual resume re-enables the provider (ruling 10)', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const e = await h.runToCompletion(h.orch(), twoPairs(h).id);
    expect(e.status).toBe('paused_error');
    const before = h.requests.length;
    expect(await h.orch().resume(e.id, { manual: false })).toMatchObject({
      ok: false,
      code: 'active',
      message: 'nothing can resume automatically; a manual resume retries the providers that were disabled',
    });
    expect(h.repos.executions.get(e.id)).toMatchObject({ status: 'paused_error' });
    expect(h.requests.length).toBe(before);
    expect(await h.orch().resume(e.id, { manual: true })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'error' })).toHaveLength(0);
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it('a completed execution with retryable errors resumes (retry-errors); the plan is added to the stored estimate; without any left it is refused', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.upstream, 3)]);
    const e = await h.runToCompletion(h.orch(), twoPairs(h).id);
    expect(e.status).toBe('completed');
    expect(e.estimate?.totalPlanCalls).toBe(4);
    const errored = new Set(h.outcomes(e.id, { status: 'error' }).map(cellKeyString));
    expect(errored.size).toBe(14);
    expect(await h.orch().resume(e.id, { manual: false })).toEqual({ ok: true, executionId: e.id });
    const after = await h.waitForSettled(e.id);
    for (const o of h.outcomes(e.id).filter((x) => errored.has(cellKeyString(x)))) {
      expect(o.status).toBe('priced');
      expect(o.attempts).toBe(1); // spec §7: attempts count failed passes; the successful retry adds none (ssr-03)
    }
    // why: cost-r1-009 — the retried tile is in the stored plan, so the 1 + 3 + 1 ledger calls are no overrun
    expect(after.estimate?.totalPlanCalls).toBe(5);
    const calls = h.repos.ledger.countsFor(e.id).calls;
    expect(calls).toBeLessThanOrEqual(Math.ceil((after.estimate?.totalPlanCalls ?? 0) * 1.1) + 2);
    expect(await h.orch().resume(e.id, { manual: false })).toMatchObject({
      ok: false,
      code: 'active',
      message: 'nothing left to retry on this execution',
    });
  });

  it('checks every scope against estimateRemaining; a manual resume checks the current definition budget (only that) and writes it only once claimed', async () => {
    const h = createHarness({ fixtureConcurrency: 4 });
    const def = twoPairs(h, { budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.status).toBe('paused_budget');
    h.clearHooks();
    // the definition still says 50
    expect(refusedWith(await h.orch().resume(e.id, { manual: true }), 'cap')).toContain(
      "this run's billed-call cap is 50 calls",
    );
    h.repos.definitions.update(def.id, {
      budget: { maxCalls: 500, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
      origins: [LHR],
    });
    expect(h.repos.executions.get(e.id)?.snapshot.budget.maxCalls).toBe(50); // a refused resume changed nothing (ssr-09)
    expect(await h.orch().resume(e.id, { manual: false })).toMatchObject({ ok: false, code: 'cap' }); // automatic resume never refreshes
    expect(await h.orch().resume(e.id, { manual: true })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    const after = h.repos.executions.get(e.id);
    expect(after?.snapshot.budget.maxCalls).toBe(500);
    expect(after?.snapshot.origins).toEqual([LHR, LGW]); // nothing but the budget was copied
  });

  it('a manual resume that raises the budget needs the definition’s stored confirmation when the remaining run needs one (cost-r1-005)', async () => {
    const h = createHarness({ fixtureConcurrency: 4, env: { SOFT_CONFIRM_PENCE: '0' } });
    const def = twoPairs(h, { budget: { maxCalls: 50, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 } });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 49, costMicroGbpEach: 0, executionId: id }),
    );
    const e = await h.runToCompletion(h.orch(), def.id, confirmed);
    expect(e.status).toBe('paused_budget');
    h.clearHooks();
    h.repos.definitions.update(def.id, {
      budget: { maxCalls: 500, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    expect(await h.orch().resume(e.id, { manual: true })).toMatchObject({ ok: false, code: 'confirm' });
    h.repos.definitions.setConfirmed(def.id, { pence: 100, calls: 1000 });
    expect(await h.orch().resume(e.id, { manual: true })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
  });

  it('a completed execution whose only errors are no-priced-options has nothing to retry; its stored estimate is unchanged (decision 37, ssr2-04)', async () => {
    const err = new ProviderError({
      kind: 'upstream',
      retryable: false,
      reason: 'no-priced-options',
      providerId: 'fixture',
      message: 'step 1 returned options and none was priced',
    });
    const h = createHarness({ transformFixture: (p) => throwOnSearch(p, err, () => true) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ providers: withVerification() }).id);
    expect(e.status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'error' }).map((o) => o.reason)).toEqual([
      'no-priced-options',
      'no-priced-options',
    ]);
    for (const manual of [false, true])
      expect(refusedWith(await h.orch().resume(e.id, { manual }), 'active')).toBe(
        'nothing left to retry on this execution',
      );
    expect(h.repos.executions.get(e.id)?.estimate).toEqual(e.estimate);
  });

  it('never resumes an execution whose definition was soft-deleted (plan decision 5)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = twoPairs(h);
    const id = await interruptedAfter(h, 1, def.id);
    h.repos.definitions.softDelete(def.id);
    expect(await h.orch().resume(id, { manual: true })).toMatchObject({ ok: false, code: 'not_found' });
    expect(h.repos.executions.get(id)?.status).toBe('interrupted');
  });

  it('skipped:budget cells are fetched once the window has headroom (paused_budget resumed at window start)', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const e = await h.runToCompletion(h.orch(), twoPairs(h).id, confirmed);
    expect(e.status).toBe('paused_budget');
    expect(await h.orch().resume(e.id, { manual: false })).toMatchObject({ ok: false, code: 'cap' });
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    h.clearHooks();
    expect(await h.orch().resume(e.id, { manual: false })).toEqual({ ok: true, executionId: e.id });
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'skipped' })).toHaveLength(0);
  });

  it('resume never rewrites priced, empty or no_data outcomes', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const id = await interruptedAfter(h, 2);
    const done = new Set(
      h
        .outcomes(id)
        .filter((o) => o.status !== 'not_run')
        .map(cellKeyString),
    );
    expect(done.size).toBe(28);
    const write = vi.spyOn(h.repos.cells, 'writeTile');
    await h.orch().resume(id, { manual: true });
    await h.waitForSettled(id);
    const touched = write.mock.calls.flatMap(([, , w]) => w.outcomes.map((o) => cellKeyString(o)));
    expect(touched.length).toBe(28);
    for (const k of touched) expect(done.has(k)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run resume.test`
Expected: FAIL: 11 of 13 fail against Task 7.1's `resumeExecution`: the refusals come back `{ ok: true, … }` (`expected a refusal with code cap; it started …`, and the `confirm`, `not_found` and `active` cases), the stored plan reads `expected 4 to be 5`, and the departed cells are never marked.

- [ ] **Step 3: Implement**

`packages/engine/src/estimate.ts` — replace the file:

```ts
import {
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type Execution,
  PENCE_TO_MICRO,
  type ProviderId,
  type SearchDefinition,
  type SourceKind,
  type Stage,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { runsPerMonth } from './scheduler/parseCron.js';
import { buildSnapshot } from './snapshot.js';
import { planTiles } from './stages/discovery.js';
import { REUSE_TOLERANCE, refreshHoursOf, reusableFor, reuseCriteriaFor } from './stages/reuse.js';
import { itineraryQuery } from './stages/verification.js';
import type { BudgetFit, Estimate } from './types.js';

/** Typical wall time per call by source kind (spec §2: SearchApi calendar 9–29 s; Travelpayouts about 1 s; the fixture is local). */
export const SECONDS_PER_CALL: Readonly<Record<SourceKind, number>> = {
  'authorised-cached': 1,
  'scraped-aggregate': 20,
  'scraped-search': 15,
  synthetic: 0,
};
/** Hours in an average month (365 × 24 / 12), for discovery refreshes per month. */
const HOURS_PER_MONTH = 730;

interface Line {
  providerId: ProviderId;
  stage: Stage;
  rawCalls: number;
  rawCostMicroGbp: number;
  rawSeconds: number;
}

function assemble(
  ctx: EngineContext,
  lines: readonly Line[],
  cells: number,
  windowClamped: boolean,
  assumptions: readonly string[],
): Estimate {
  const f = ctx.config.estimateRetryFactor;
  const perProvider = lines.map((l) => {
    const costMicroGbp = Math.ceil(l.rawCostMicroGbp * f);
    return {
      providerId: l.providerId,
      stage: l.stage,
      calls: Math.ceil(l.rawCalls * f),
      planCalls: l.rawCalls,
      costMicroGbp,
      costPence: Math.ceil(costMicroGbp / PENCE_TO_MICRO),
      seconds: Math.ceil(l.rawSeconds * f),
      blocked: null,
    };
  });
  const totalCostMicroGbp = perProvider.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    cells,
    perProvider,
    totalCalls: perProvider.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: perProvider.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: Math.ceil(totalCostMicroGbp / PENCE_TO_MICRO),
    seconds: perProvider.reduce((a, p) => a + p.seconds, 0),
    assumptions: [`every call count includes the retry factor ${f}`, ...assumptions],
    windowClamped,
    retryFactor: f,
  };
}

/**
 * Spec §8.1 "seconds including limiter waits": the slowest of the minute window, the hour window and the pool
 * (cost-r1-011); the hour window is named in the assumptions when it binds.
 */
function waitSeconds(
  ctx: EngineContext,
  providerId: ProviderId,
  calls: number,
  secondsPerCall: number,
  notes: string[],
): number {
  const l = ctx.limitsOf(providerId);
  const minute = Math.ceil((calls * 60) / l.ratePerMinute);
  const hour = calls > l.ratePerHour ? Math.floor((calls - 1) / l.ratePerHour) * 3600 : 0;
  const pool = Math.ceil((calls * secondsPerCall) / l.concurrency);
  if (hour > Math.max(minute, pool))
    notes.push(
      `${providerId}: ${calls} calls exceed its ${l.ratePerHour} an hour, so the hourly window sets the time`,
    );
  return Math.max(minute, hour, pool);
}

function discoveryLine(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cells: readonly CellKey[],
  definitionId: string | null,
  notes: string[],
): Line | null {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.discovery;
  if (provider === undefined || cap === undefined) return null;
  if (!provider.cabins.includes(snapshot.cabin)) {
    notes.push(`${providerId}: does not offer ${snapshot.cabin}; no calls (cabin-not-offered)`);
    return { providerId, stage: 'discovery', rawCalls: 0, rawCostMicroGbp: 0, rawSeconds: 0 };
  }
  const reused =
    definitionId === null
      ? []
      : reusableFor(
          ctx,
          definitionId,
          snapshot,
          providerId,
          reuseCriteriaFor(ctx, snapshot, providerId, cap.info),
          cells,
        );
  if (reused.length > 0)
    notes.push(`${providerId}: ${reused.length} cells reuse earlier prices and are not planned`);
  const reusedKeys = new Set(reused.map((r) => cellKeyString(r.cell)));
  const fresh = cells.filter((c) => !reusedKeys.has(cellKeyString(c)));
  const tiles = fresh.length === 0 ? 0 : planTiles(providerId, cap, snapshot, fresh).length;
  // why: cost-r1-007 — planCalls counts tiles; a tile that pages spends a call a page, so discovery overrun is judged on
  // distinct tiles (LedgerRepo.countsFor tiles), never on calls
  if (tiles > 0)
    notes.push(`${providerId}: ${tiles} discovery tiles planned; a tile that pages spends one call a page`);
  const l = ctx.limitsOf(providerId);
  return {
    providerId,
    stage: 'discovery',
    rawCalls: tiles,
    rawCostMicroGbp: tiles * l.costPerCallMicroGbp,
    rawSeconds: waitSeconds(ctx, providerId, tiles, SECONDS_PER_CALL[cap.info.sourceKind], notes),
  };
}

function verificationLine(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  providerId: ProviderId,
  cellCount: number,
  sample: CellKey | undefined,
  notes: string[],
): Line | null {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined || sample === undefined || cellCount === 0) return null;
  if (!provider.cabins.includes(snapshot.cabin))
    return { providerId, stage: 'verification', rawCalls: 0, rawCostMicroGbp: 0, rawSeconds: 0 };
  const per = cap.estimate(itineraryQuery(snapshot, sample));
  notes.push(
    `${providerId}: verification of up to ${cellCount} cells at ${per.calls} calls each${per.notes.length > 0 ? ` (${per.notes.join('; ')})` : ''}`,
  );
  const calls = cellCount * per.calls;
  return {
    providerId,
    stage: 'verification',
    rawCalls: calls,
    rawCostMicroGbp: cellCount * per.costMicroGbp,
    rawSeconds: Math.max(
      waitSeconds(ctx, providerId, calls, 0, notes),
      Math.ceil((cellCount * per.seconds) / ctx.limitsOf(providerId).concurrency),
    ),
  };
}

/**
 * Spec §8.1 "Estimate = Σ discovery plan(q with cells = non-reused cells).length per pair, using the same reuse query
 * as the run, + maxCells × verification.estimate, all × ESTIMATE_RETRY_FACTOR". `planCalls` keep the pre-factor plan
 * (the overrun baseline). `definitionId` null plans every cell: the save-time worst case without reuse (ruling 9),
 * which is what `confirmed_cost_pence` records; a start passes its definition so the run-time estimate applies reuse.
 */
export function estimateStart(
  ctx: EngineContext,
  snapshot: DefinitionSnapshot,
  cells: readonly Cell[],
  definitionId: string | null,
): Estimate {
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
  if (definitionId === null) notes.push('every cell is planned: no reuse of earlier prices is assumed');
  if (snapshot.windowClamped) notes.push('window clamped to start tomorrow');
  return assemble(ctx, lines, cells.length, snapshot.windowClamped, notes);
}

function firstCellOf(ctx: EngineContext, executionId: string): CellKey | undefined {
  const first = ctx.repos.cells.outcomes(executionId)[0];
  return first === undefined
    ? undefined
    : {
        origin: first.origin,
        destination: first.destination,
        departureDate: first.departureDate,
        returnDate: first.returnDate,
      };
}

/**
 * Spec §8.1 "estimateRemaining (resumable tiles + remaining selected cells × estimate × factor)", over the cells the
 * resumed pass will fetch: the spec §7 resume query (which never returns `no-return-legs` or `no-priced-options` errors,
 * decision 37) less the cells whose departure date has arrived, which a resume marks skipped:departed before its pass
 * (po-016), so this read needs no write first (arch-r2-006).
 */
export function estimateRemainingFor(ctx: EngineContext, exec: Execution, manual: boolean): Estimate {
  const snapshot = exec.snapshot;
  const today = ctx.clock.todayLondon();
  const remaining = (stage: Stage, id: ProviderId) =>
    ctx.repos.cells.resumable(exec.id, stage, id, manual).filter((c) => c.departureDate > today);
  const notes: string[] = [];
  const lines: Line[] = [];
  for (const id of snapshot.providers.discovery) {
    const l = discoveryLine(ctx, snapshot, id, remaining('discovery', id), null, notes);
    if (l !== null) lines.push(l);
  }
  const seeded = ctx.repos.cells.hasVerificationOutcomes(exec.id);
  const total = ctx.repos.cells.rollUps(exec.id).size;
  for (const id of snapshot.providers.verification) {
    const cells = seeded ? remaining('verification', id) : [];
    const count = seeded ? cells.length : Math.min(snapshot.verification.maxCells, total);
    const sample =
      cells[0] ?? exec.cell ?? snapshot.verification.alwaysInclude[0] ?? firstCellOf(ctx, exec.id);
    const l = verificationLine(ctx, snapshot, id, count, sample, notes);
    if (l !== null) lines.push(l);
  }
  return assemble(ctx, lines, total, snapshot.windowClamped, notes);
}

/** One scheduled definition's monthly load per provider: calls and billed cost. */
export interface MonthlyLoad {
  runsPerMonth: number;
  perRun: Estimate;
  /** The schedule's snapshot, as a scheduled run would freeze it now (its providers and refresh hours). */
  snapshot: DefinitionSnapshot;
  perProvider: Map<ProviderId, { calls: number; costMicroGbp: number }>;
}

/**
 * Spec §8.2 load of `firings` scheduled runs spread over `hours`, without reuse (po-004): verification runs on every
 * firing; discovery at most once per refresh (reuse iff age < 0.9 × refresh), so a daily cron with a weekly refresh
 * pays weekly discovery (cost-r1-003): discovery runs = min(firings, hours / (0.9 × refresh hours)). The one model
 * budgetFit (a month) and the pre-start reservation (the rest of a cap window) share (cost-r2-002).
 */
export function scheduleLoad(
  ctx: EngineContext,
  perRun: Estimate,
  snapshot: DefinitionSnapshot,
  firings: number,
  hours: number,
): Map<ProviderId, { calls: number; costMicroGbp: number }> {
  const load = new Map<ProviderId, { calls: number; costMicroGbp: number }>();
  for (const p of perRun.perProvider) {
    const factor =
      p.stage === 'discovery'
        ? Math.min(firings, hours / (REUSE_TOLERANCE * refreshHoursOf(snapshot, p.providerId)))
        : firings;
    const acc = load.get(p.providerId) ?? { calls: 0, costMicroGbp: 0 };
    load.set(p.providerId, {
      calls: acc.calls + p.calls * factor,
      costMicroGbp: acc.costMicroGbp + (ctx.limitsOf(p.providerId).billed ? p.costMicroGbp * factor : 0),
    });
  }
  return load;
}

/** Spec §8.2 monthly load of a schedule: scheduleLoad over runsPerMonth firings in an average month (730 h). */
export function monthlyLoad(ctx: EngineContext, def: SearchDefinition): MonthlyLoad {
  const built = buildSnapshot(ctx, def, 'schedule');
  const perRun = estimateStart(ctx, built.snapshot, built.cells, null);
  const runs = runsPerMonth(def.scheduleCron, def.scheduleTz, new Date(ctx.clock.now()));
  return {
    runsPerMonth: runs,
    perRun,
    snapshot: built.snapshot,
    perProvider: scheduleLoad(ctx, perRun, built.snapshot, runs, HOURS_PER_MONTH),
  };
}

/** The other enabled, scheduled, live definitions (ruling 5: they share the provider-month and global caps). */
export function otherSchedules(ctx: EngineContext, definitionId: string | null): SearchDefinition[] {
  return ctx.repos.definitions
    .list()
    .filter((d) => d.id !== definitionId && d.enabled && d.deletedAt === null && d.scheduleCron !== null);
}

/**
 * Spec §8.2 "budgetFit at save time compares runsPerMonth × estimate with every cap and warns", worst case without
 * reuse (po-004). Execution scopes compare one run with the definition's budget. Monthly scopes add the monthly load
 * of every other enabled scheduled definition, because they share the caps (ruling 5: the API refuses enabling or
 * changing a schedule whose provider-month scope does not fit); global adds each billed provider's fixed fee once
 * (spec §5.3). `definitionId` is null for an unsaved definition.
 */
export function budgetFitFor(
  ctx: EngineContext,
  def: SearchDefinition,
  definitionId: string | null,
): BudgetFit {
  const own = monthlyLoad(ctx, def);
  const others = otherSchedules(ctx, definitionId).map((d) => monthlyLoad(ctx, d));
  const billed = own.perRun.perProvider.filter((p) => ctx.limitsOf(p.providerId).billed);
  const free = own.perRun.perProvider.filter((p) => !ctx.limitsOf(p.providerId).billed);
  const sum = (xs: Estimate['perProvider'], f: (p: Estimate['perProvider'][number]) => number) =>
    xs.reduce((a, p) => a + f(p), 0);
  const perScope: BudgetFit['perScope'] = [];
  const scope = (name: string, estimated: number, cap: number | null) => {
    const e = Math.ceil(estimated);
    perScope.push({ scope: name, estimated: e, cap, fits: cap === null || e <= cap });
  };
  scope(
    'execution-calls',
    sum(billed, (p) => p.calls),
    def.budget.maxCalls,
  );
  scope(
    'execution-free-calls',
    sum(free, (p) => p.calls),
    def.budget.maxFreeCalls,
  );
  scope(
    'execution-cost',
    sum(billed, (p) => p.costMicroGbp),
    def.budget.maxCostMicroGbp,
  );
  const ids = new Set([...own.perProvider.keys(), ...others.flatMap((o) => [...o.perProvider.keys()])]);
  for (const id of ids) {
    const kind = ctx.limitsOf(id).window === 'lifetime' ? 'provider-lifetime' : 'provider-month';
    const calls = [own, ...others].reduce((a, l) => a + (l.perProvider.get(id)?.calls ?? 0), 0);
    scope(`${kind}:${id}`, calls, ctx.budget.usage({ kind, providerId: id }).cap);
  }
  const fixed = [...ctx.providers.keys()]
    .filter((id) => ctx.limitsOf(id).billed)
    .reduce((a, id) => a + ctx.limitsOf(id).planFixedMicroGbp, 0);
  const cost = [own, ...others].reduce(
    (a, l) => a + [...l.perProvider.values()].reduce((b, v) => b + v.costMicroGbp, 0),
    0,
  );
  scope('global-month', fixed + cost, ctx.config.spend.monthlyCapMicroGbp);
  return { fits: perScope.every((x) => x.fits), runsPerMonth: own.runsPerMonth, perScope };
}

/**
 * The stored estimate after a resumed pass: its plan added line by line (cost-r1-009), so View D's overrun rule
 * (ledger calls > pre-factor plan + 10%) judges every pass the execution made, retries included.
 */
export function addPass(stored: Estimate | null, pass: Estimate): Estimate {
  if (stored === null) return pass;
  const lines = stored.perProvider.map((l) => ({ ...l }));
  for (const p of pass.perProvider) {
    const l = lines.find((x) => x.providerId === p.providerId && x.stage === p.stage);
    if (l === undefined) lines.push({ ...p });
    else {
      l.calls += p.calls;
      l.planCalls += p.planCalls;
      l.costMicroGbp += p.costMicroGbp;
      l.costPence = Math.ceil(l.costMicroGbp / PENCE_TO_MICRO);
      l.seconds += p.seconds;
    }
  }
  const totalCostMicroGbp = lines.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    ...stored,
    perProvider: lines,
    totalCalls: lines.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: lines.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: Math.ceil(totalCostMicroGbp / PENCE_TO_MICRO),
    seconds: lines.reduce((a, p) => a + p.seconds, 0),
    assumptions: [...stored.assumptions, `a resumed pass planned ${pass.totalPlanCalls} more calls`],
  };
}
/**
 * The estimate with each line's `blocked` scope set from a budget check, and the totals summed over the lines that will
 * run, so the figure shown, stored and confirmed is the runnable one and a blocked provider's plan never inflates the
 * overrun baseline (cost-r1-014). Blocked lines keep their figures, so the form still shows what they would need.
 */
export function withBlocked(e: Estimate, blockedBy: ReadonlyMap<ProviderId, string>): Estimate {
  const perProvider = e.perProvider.map((p) => ({ ...p, blocked: blockedBy.get(p.providerId) ?? null }));
  const runs = perProvider.filter((p) => p.blocked === null);
  const totalCostMicroGbp = runs.reduce((a, p) => a + p.costMicroGbp, 0);
  return {
    ...e,
    perProvider,
    totalCalls: runs.reduce((a, p) => a + p.calls, 0),
    totalPlanCalls: runs.reduce((a, p) => a + p.planCalls, 0),
    totalCostMicroGbp,
    totalCostPence: Math.ceil(totalCostMicroGbp / PENCE_TO_MICRO),
    seconds: runs.reduce((a, p) => a + p.seconds, 0),
    assumptions:
      runs.length === perProvider.length
        ? e.assumptions
        : [...e.assumptions, 'totals leave out the providers a budget cap blocks'],
  };
}
```

`packages/engine/src/resume.ts` — replace the file:

```ts
import { RESUMABLE_STATUSES } from '@gmt/core';
import { breachMessage, checkBudget, spendOf } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { addPass, estimateRemainingFor, withBlocked } from './estimate.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { markRemaining, newRun } from './run.js';
import { confirmationNeeded, nothingToSearch, refused } from './start.js';
import type { StartResult } from './types.js';

/**
 * Spec §8.1 "Resume": allowed on interrupted | paused_* | cancelled, and on completed when retryable errors remain
 * (retry-errors). It is a compare-and-set — the tick, the one-shot job, boot auto-resume and /resume all go through it,
 * so losers get code `active` (409). /resume is also refused while another execution of the definition is active, and
 * an execution whose definition was soft-deleted is never resumed (plan decision 5).
 *
 * Order: the per-scope cap check uses estimateRemaining, which leaves out the cells whose departure date has arrived
 * (po-016); a manual resume of a paused_budget parent checks against the definition's current `budget` (and nothing
 * else), which needs the stored confirmation, pence and calls, when it raises the spend (cost-r1-005, decision 37); a
 * resume whose remaining discovery is all blocked, before any selection and with no price yet, is refused like a
 * start (ssr2-03). Nothing is written to the execution until the claim succeeds (ssr-09, arch-r2-006): marking the
 * departed cells skipped:departed, the refreshed budget, the blocked providers' cells (skipped:budget, cost-r1-001) and
 * the pass's runnable plan added to the stored estimate (cost-r1-009, cost-r1-014) all go into the same transaction as
 * the compare-and-set. An automatic resume of a paused_error with nothing resumable leaves it as it is, unclaimed
 * (ruling 10); a manual resume re-admits the providers disabled in the previous pass.
 */
export async function resumeExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  executionId: string,
  opts: { manual: boolean },
): Promise<StartResult> {
  const exec = ctx.repos.executions.get(executionId);
  if (exec === null) return refused('not_found', `execution ${executionId} not found`, { executionId });
  const def = ctx.repos.definitions.get(exec.definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', 'the definition of this execution was deleted', {
      executionId,
      definitionId: exec.definitionId,
    });
  if (reg.get(executionId) !== undefined || !RESUMABLE_STATUSES.includes(exec.status))
    return refused('active', `execution is ${exec.status} and cannot be resumed`, { status: exec.status });
  const other =
    exec.isChild && exec.cell !== null
      ? ctx.repos.executions.activeChild(exec.definitionId, exec.cell)
      : ctx.repos.executions.activeParent(exec.definitionId);
  if (other !== null && other.id !== exec.id)
    return refused('active', 'another execution of this definition is active', {
      activeExecutionId: other.id,
    });

  const refresh = opts.manual && exec.status === 'paused_budget' && !exec.isChild;
  const current = refresh ? { ...exec, snapshot: { ...exec.snapshot, budget: def.budget } } : exec;
  const remaining = estimateRemainingFor(ctx, current, opts.manual);
  const needed = remaining.perProvider.filter((p) => p.calls > 0);
  if (needed.length === 0 && current.status === 'completed')
    return refused('active', 'nothing left to retry on this execution', { executionId });
  if (needed.length === 0 && !opts.manual && current.status === 'paused_error')
    return refused(
      'active',
      'nothing can resume automatically; a manual resume retries the providers that were disabled',
      { executionId },
    );
  const check = checkBudget(
    ctx,
    spendOf(remaining),
    current.snapshot.budget,
    current.id,
    current.definitionId,
  );
  const pass = withBlocked(remaining, check.blockedBy);
  const starved =
    !ctx.repos.cells.hasVerificationOutcomes(executionId) &&
    !ctx.repos.cells.outcomes(executionId, { stage: 'discovery' }).some((o) => o.status === 'priced') &&
    nothingToSearch(current.snapshot, { perProvider: needed }, check.blocked);
  if ((needed.length > 0 && needed.every((p) => check.blocked.has(p.providerId))) || starved)
    return refused('cap', `budget cap: ${breachMessage(check.breaches)}`, { breaches: check.breaches });
  const raised = refresh && JSON.stringify(def.budget) !== JSON.stringify(exec.snapshot.budget);
  if (raised) {
    const confirm = confirmationNeeded(ctx, pass, check.blocked, {
      pence: def.confirmedCostPence,
      calls: def.confirmedCalls,
    });
    if (confirm !== null)
      return refused(
        'confirm',
        `${confirm.reason} under the raised budget and the definition's confirmation does not cover it`,
        {
          estimateMicroGbp: confirm.estimateMicroGbp,
          estimatePence: confirm.estimatePence,
          calls: confirm.calls,
          totalCalls: confirm.totalCalls,
        },
      );
  }
  let departed = 0;
  const claimed = ctx.db.immediateTransaction(() => {
    if (!ctx.repos.executions.claimResume(executionId)) return false;
    departed = ctx.repos.cells.markDeparted(executionId, ctx.clock.todayLondon());
    ctx.repos.executions.patch(executionId, {
      estimate: addPass(current.estimate, pass),
      ...(refresh ? { snapshot: current.snapshot } : {}),
    });
    for (const id of check.blocked) {
      if (current.snapshot.providers.discovery.includes(id))
        markRemaining(ctx, { executionId }, 'discovery', id, 'budget');
      if (
        current.snapshot.providers.verification.includes(id) &&
        ctx.repos.cells.hasVerificationOutcomes(executionId)
      )
        markRemaining(ctx, { executionId }, 'verification', id, 'budget');
    }
    return true;
  });
  if (!claimed) return refused('active', 'another resume claimed this execution first', { executionId });
  ctx.hooks.cancelResume(executionId); // why: spec §8.1 "cancelling the one-shot job in the same step"
  const run = newRun(
    ctx,
    { ...current, status: 'running' },
    { manual: opts.manual, fresh: false, blocked: check.blocked },
  );
  run.log.info(
    { manual: opts.manual, autoResumeCount: current.autoResumeCount, departed, blocked: [...check.blocked] },
    'execution: resumed',
  );
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run resume`
Expected: PASS, 14 tests (13 in `resume.test.ts`, 1 in `resume-k-of-n.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: resume with compare-and-set, departed left out of the cap check, every write in the claim, retry-errors

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.15: Single-cell verification — child executions, their cap and their place in results

**Files:**
- Create: `packages/engine/src/child.ts`, `test/child.test.ts`
- Modify: `packages/engine/src/snapshot.ts` (`childSnapshot`), `src/run.ts` (the child branch of `applyBudgetBreach`, `StopReason` `child-cap`), `src/execute.ts` (`finalStatus` for `child-cap`, `CHILD_CAP_REACHED`), `src/orchestrator.ts` (`verifyCell`)

**Interfaces:**
- Consumes: `ExecutionsRepo.create({ isChild: true, cell, trigger })/activeChild/activeParent/latestCompleted`, `BudgetGuard.usage({ kind: 'execution-calls', executionId })`, `ItinerariesRepo.observationsForDefinition/latestVerificationOutcomeForCell`, `AirportsRepo.exists`.
- Produces: `verifyCellExecution(ctx, reg, definitionId, cell)`, `childMaxCalls(ctx, definitionId, definitionMaxCalls, perCellBilledCalls)`, `childSnapshot(parent, cell, maxCalls)`, `Orchestrator.verifyCell`.

Ruling 7 and spec rev 18 (cost-r1-006, ssr-10, ssr2-01, decision 37): a child's `maxCalls` is `max(CHILD_MAX_CALLS, min(per-cell estimate × ESTIMATE_RETRY_FACTOR, headroom))`. The fixture, like SearchApi, estimates 1 + 2 × expandTop calls: 4 at expandTop 1, raised to the floor of 6; 9 at expandTop 3. The headroom is the active parent's remaining execution calls (else the definition's `maxCalls`) less what the definition's other active children may still spend, so two children never size themselves against the same calls (cost-r2-001); a cell that needs more than its cap is refused with code `cap`, naming the room left. The floor can pass the parent's headroom by at most `CHILD_MAX_CALLS` a child, so `CHILD_MAX_CALLS` is the per-child bound on that excess (cost-r2-003), and provider-month and global caps bound every call. The rest of the budget is inherited (decision 14). A child never pauses: any cap breach ends it `cancelled` with errorText `child cap reached` and its cell `skipped:budget` (the closed skip reason that says why it was not searched); the parent's cell stays unverified, no operator notice is sent (the operator started it), and a new child of the same cell can start at once. A departed cell is refused like one outside the space. The never-pauses test asserts the breach came before any fixture call: the child's ledger holds only the six pre-spent rows and no itinerary request was made (test-strategy-reviewer-030).

- [ ] **Step 1: Write the failing test**

`packages/engine/test/child.test.ts` (new file):

```ts
import { asIsoDate, asIsoDateTime, cellKeyString } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import {
  baseDefinition,
  createHarness,
  FIXTURE_RULES,
  type Harness,
  itineraryRule,
  JFK,
  LHR,
  noVerification,
  withVerification,
} from './support/harness.js';

const cell = {
  origin: LHR,
  destination: JFK,
  departureDate: asIsoDate('2026-11-03'),
  returnDate: asIsoDate('2026-11-10'),
};
const verifying = (h: Harness, patch = {}) => h.createDefinition({ providers: withVerification(), ...patch });

describe('single-cell verification (spec §8.1 "Single-cell verification", §6.7; ruling 7)', () => {
  it('needs no parent; creates a child that skips discovery with alwaysInclude = [cell], maxCells = topN = 1', async () => {
    const h = createHarness();
    const def = verifying(h);
    const r = await h.orch().verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    expect(e).toMatchObject({ isChild: true, cell, status: 'completed', trigger: 'manual' });
    expect(e.snapshot.providers.discovery).toEqual([]);
    expect(e.snapshot.verification).toMatchObject({ alwaysInclude: [cell], maxCells: 1, topN: 1 });
    expect(h.outcomes(e.id, { stage: 'discovery' })).toHaveLength(0);
    const v = h.outcomes(e.id, { stage: 'verification' });
    expect(v.map(cellKeyString)).toEqual([cellKeyString(cell)]);
    expect(v[0]?.status).toBe('priced');
    expect(h.repos.cells.selected(e.id)).toEqual([{ cell, reason: 'always_include' }]);
  });

  it('its call cap is the per-cell estimate × the retry factor, never below CHILD_MAX_CALLS; the rest of the budget inherited (spec rev 18, decision 14)', async () => {
    const h = createHarness();
    expect(h.config.spend.childMaxCalls).toBe(6);
    for (const [expandTop, maxCalls] of [
      [1, 6],
      [3, 9],
    ] as const) {
      // why: the fixture estimates 1 + 2 × expandTop calls a cell (SearchApi's shape): ceil(3 × 1.2) = 4, raised to the
      // floor of 6; ceil(7 × 1.2) = 9
      const def = verifying(h, {
        verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop, bookingLinks: true },
      });
      const r = await h.orch().verifyCell(def.id, cell);
      if (!r.ok) throw new Error(r.message);
      const e = await h.waitForSettled(r.executionId);
      expect(e.snapshot.budget).toEqual({ ...def.budget, maxCalls });
      expect(e.status).toBe('completed');
    }
  });

  it('is bounded by the parent’s headroom above the floor: a 4-call cell with 2 calls left gets the floor of 6 and runs; a 9-call cell with 7 left is refused', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const o = h.orch();
    const small = verifying(h);
    const big = verifying(h, {
      verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 3, bookingLinks: true },
    });
    for (const [def, spent] of [
      [small, 998],
      [big, 993],
    ] as const) {
      const parent = await o.start(def.id, { trigger: 'manual' });
      if (!parent.ok) throw new Error(parent.message);
      h.spendLedger({
        providerId: 'fixture',
        rows: spent,
        costMicroGbpEach: 0,
        executionId: parent.executionId,
      });
    }
    const floor = await o.verifyCell(small.id, cell);
    if (!floor.ok) throw new Error(floor.message);
    expect(h.repos.executions.get(floor.executionId)?.snapshot.budget.maxCalls).toBe(6);
    expect((await h.waitForSettled(floor.executionId)).status).toBe('completed');
    const refused = await o.verifyCell(big.id, cell);
    expect(refused).toMatchObject({ ok: false, code: 'cap', details: { headroom: 7, need: 9 } });
    expect(refused.ok ? '' : refused.message).toContain('has room for 7 of the 9 calls this cell needs');
  });

  it("counts what the definition's other active children may still spend against the headroom (cost-r2-001)", async () => {
    const h = createHarness();
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold)]);
    const def = verifying(h, {
      verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 3, bookingLinks: true },
      budget: { ...baseDefinition().budget, maxCalls: 16 },
    });
    const o = h.orch();
    // why: no active parent, so the headroom is the definition's maxCalls (16) less what held children may still spend
    const first = await o.verifyCell(def.id, cell);
    if (!first.ok) throw new Error(first.message);
    expect(h.repos.executions.get(first.executionId)?.snapshot.budget.maxCalls).toBe(9);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    const used = h.deps.budget.usage({ kind: 'execution-calls', executionId: first.executionId }).calls;
    const second = await o.verifyCell(def.id, { ...cell, returnDate: asIsoDate('2026-11-11') });
    // without the subtraction the second child would get 9 of 16 and start; with it the headroom is below its need
    expect(second).toMatchObject({ ok: false, code: 'cap', details: { headroom: 16 - (9 - used), need: 9 } });
    await h.releaseHolds();
    expect((await h.waitForSettled(first.executionId)).status).toBe('completed');
  });

  it('never pauses: a cap breach ends the child cancelled with "child cap reached", its cell skipped:budget, and a new child can start', async () => {
    const h = createHarness();
    const def = verifying(h);
    // why: the child's cap is the floor of 6; spending all 6 before its first call makes that call breach
    h.onStageStart('verification', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 6, costMicroGbpEach: 0, executionId: id }),
    );
    const r = await h.orch().verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    expect(e).toMatchObject({ status: 'cancelled', errorText: 'child cap reached', resumeAfter: null });
    expect(h.outcomes(e.id, { stage: 'verification' })).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'budget' }),
    ]);
    // the breach came before any fixture call (test-strategy-reviewer-030)
    expect(h.ledgerRows(e.id)).toHaveLength(6);
    expect(h.requests.filter((q) => q.kind === 'itinerary')).toEqual([]);
    expect(h.notifications).toHaveLength(0);
    h.clearHooks();
    const again = await h.orch().verifyCell(def.id, cell);
    if (!again.ok) throw new Error(again.message);
    expect((await h.waitForSettled(again.executionId)).status).toBe('completed');
  });

  it('allows at most one active child per cell', async () => {
    const h = createHarness();
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold)]);
    const def = verifying(h);
    const o = h.orch();
    const first = await o.verifyCell(def.id, cell);
    expect(first.ok).toBe(true);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    expect(await o.verifyCell(def.id, cell)).toMatchObject({ ok: false, code: 'active' });
    const other = await o.verifyCell(def.id, { ...cell, returnDate: asIsoDate('2026-11-11') });
    expect(other.ok).toBe(true);
  });

  it('refuses a cell outside the current space or already departed, and a definition without a verification provider, with code window', async () => {
    const h = createHarness();
    const def = verifying(h);
    expect(
      await h.orch().verifyCell(def.id, {
        ...cell,
        departureDate: asIsoDate('2026-12-01'),
        returnDate: asIsoDate('2026-12-08'),
      }),
    ).toMatchObject({ ok: false, code: 'window' });
    const plain = h.createDefinition({ providers: noVerification() });
    expect(await h.orch().verifyCell(plain.id, cell)).toMatchObject({
      ok: false,
      code: 'window',
      message: 'this definition has no verification provider',
    });
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // the cell departs today
    expect(await h.orch().verifyCell(def.id, cell)).toMatchObject({ ok: false, code: 'window' });
  });

  it('is included in results inputs and newest-outcome reads; excluded from latest execution', async () => {
    const h = createHarness();
    const def = verifying(h);
    const parent = await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(3_600_000);
    const r = await h.orch().verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    const child = await h.waitForSettled(r.executionId);
    expect(h.repos.executions.latestCompleted(def.id)?.id).toBe(parent.id);
    const obs = h.repos.itineraries.observationsForDefinition(def.id, {
      executionIds: [child.id],
      space: child.snapshot.resolved,
      cabin: 'economy',
      includeChildren: true,
    });
    expect(obs.length).toBeGreaterThan(0);
    expect(h.repos.itineraries.latestVerificationOutcomeForCell(def.id, cell, 'economy')?.executionId).toBe(
      child.id,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run child`
Expected: FAIL, `o.verifyCell is not a function` (and `h.orch().verifyCell` in every test).

- [ ] **Step 3: Implement**

`packages/engine/src/child.ts` (new file):

```ts
import { ACTIVE_STATUSES, type CellKey, cellKeyString, type Execution } from '@gmt/core';
import { breachMessage, checkBudget, spendOf } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { estimateStart, withBlocked } from './estimate.js';
import { execute } from './execute.js';
import type { RunRegistry } from './registry.js';
import { newRun } from './run.js';
import { buildSnapshot, childSnapshot } from './snapshot.js';
import { isUniqueViolation, refused } from './start.js';
import type { StartResult } from './types.js';

/** Billed calls an execution may still make under its own snapshot cap. */
function callsLeft(ctx: EngineContext, e: Execution): number {
  return Math.max(
    0,
    e.snapshot.budget.maxCalls - ctx.budget.usage({ kind: 'execution-calls', executionId: e.id }).calls,
  );
}

/**
 * Spec rev 18 §6.7 and ruling 7: a child's call cap is its per-cell estimate (already × ESTIMATE_RETRY_FACTOR) for the
 * billed providers, bounded by the parent's headroom, never below CHILD_MAX_CALLS. The headroom is the active parent's
 * execution-calls left (else the definition's maxCalls) less what the definition's other active children may still
 * spend, so concurrent children do not each size themselves against the same calls (cost-r2-001). The floor can go
 * past that headroom by at most CHILD_MAX_CALLS a child; the provider-month and global caps still bound every call.
 */
export function childMaxCalls(
  ctx: EngineContext,
  definitionId: string,
  definitionMaxCalls: number,
  perCellBilledCalls: number,
): { maxCalls: number; headroom: number } {
  const parent = ctx.repos.executions.activeParent(definitionId);
  const parentLeft = parent === null ? definitionMaxCalls : callsLeft(ctx, parent);
  const held = ctx.repos.executions
    .listByStatus([...ACTIVE_STATUSES])
    .filter((e) => e.isChild && e.definitionId === definitionId)
    .reduce((a, e) => a + callsLeft(ctx, e), 0);
  const headroom = Math.max(0, parentLeft - held);
  return {
    maxCalls: Math.max(ctx.config.spend.childMaxCalls, Math.min(perCellBilledCalls, headroom)),
    headroom,
  };
}

/**
 * Spec §8.1 `POST /cells/verify`: validates that the cell is in generateCells(current resolved space), has not departed
 * and its airports exist, then creates a child execution (is_child = 1, cell columns set), seeded and running in one
 * transaction. At most one active child per cell (the child partial unique index backs this up). A child never pauses
 * (ruling 7, run.ts applyBudgetBreach).
 */
export async function verifyCellExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  definitionId: string,
  cell: CellKey,
): Promise<StartResult> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', `definition ${definitionId} not found`, { definitionId });
  const built = buildSnapshot(ctx, def, 'manual');
  if (built.snapshot.providers.verification.length === 0)
    return refused('window', 'this definition has no verification provider', { definitionId });
  const key = cellKeyString(cell);
  const match = built.cells.find((c) => cellKeyString(c) === key);
  if (
    match === undefined ||
    match.departureDate <= ctx.clock.todayLondon() ||
    !ctx.repos.airports.exists(cell.origin) ||
    !ctx.repos.airports.exists(cell.destination)
  )
    return refused('window', 'the cell is not in the current search space', { cell });
  if (ctx.repos.executions.activeChild(def.id, cell) !== null)
    return refused('active', 'this cell is already being verified', { cell });
  const sized = estimateStart(ctx, childSnapshot(built.snapshot, match, def.budget.maxCalls), [match], null);
  const need = sized.perProvider
    .filter((p) => ctx.limitsOf(p.providerId).billed)
    .reduce((a, p) => a + p.calls, 0);
  const { maxCalls, headroom } = childMaxCalls(ctx, def.id, def.budget.maxCalls, need);
  const snapshot = childSnapshot(built.snapshot, match, maxCalls);
  const planned = estimateStart(ctx, snapshot, [match], null);
  const check = checkBudget(ctx, spendOf(planned), snapshot.budget, null, def.id);
  const estimate = withBlocked(planned, check.blockedBy);
  if (snapshot.providers.verification.every((id) => check.blocked.has(id))) {
    const room =
      headroom < need
        ? `; the budget left for verifying single cells has room for ${headroom} of the ${need} calls this cell needs`
        : '';
    return refused('cap', `budget cap: ${breachMessage(check.breaches)}${room}`, {
      breaches: check.breaches,
      headroom,
      need,
    });
  }
  let exec: Execution;
  try {
    exec = ctx.db.immediateTransaction(() => {
      const e = ctx.repos.executions.create({
        definitionId: def.id,
        isChild: true,
        cell,
        snapshot,
        estimate,
        trigger: 'manual',
        status: 'running',
      });
      ctx.repos.cells.seed(e.id, [match], []);
      return e;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return refused('active', 'this cell is already being verified', { cell });
    throw err;
  }
  const run = newRun(ctx, exec, { manual: false, fresh: true, blocked: check.blocked });
  run.log.info({ cell: key, maxCalls }, 'execution: child started');
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId: exec.id };
}
```

`packages/engine/src/execute.ts` — replace or add these declarations:

```ts
/** The error_text of a child execution that reached a cap (ruling 7). */
export const CHILD_CAP_REACHED = 'child cap reached';

/** Maps a stop reason to the execution status, patch and operator notice of spec §8.1. Pure; `tz` renders instants. */
export function finalStatus(
  stop: StopReason | null,
  now: IsoDateTime,
  tz: string,
): { status: ExecutionStatus; patch: ExecutionPatch; notice: Notice | null } {
  if (stop === null)
    return {
      status: 'completed',
      patch: { finishedAt: now, resumeAfter: null, errorText: null },
      notice: null,
    };
  switch (stop.kind) {
    case 'sigterm':
      // why: spec §8.1 "SIGTERM: … status interrupted without incrementing the counter"
      return {
        status: 'interrupted',
        patch: {},
        notice: {
          kind: 'interrupted',
          detail: 'The app stopped during this run; cells that were in flight went back to not searched.',
        },
      };
    case 'cancel':
      return { status: 'cancelled', patch: { finishedAt: now, resumeAfter: null }, notice: null };
    case 'limiter-timeout':
      return {
        status: 'paused_error',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_error',
          detail:
            stop.resumeAfter === null
              ? 'A provider rate window is full and its reopening time is not known; resume the run manually.'
              : `A provider rate window is full; the run resumes automatically on ${formatInstant(stop.resumeAfter, tz)}.`,
        },
      };
    case 'budget': {
      const e = stop.error;
      const when =
        stop.resumeAfter === null
          ? 'It needs a cap change, or a manual resume after editing the definition.'
          : `It resumes automatically on ${formatInstant(stop.resumeAfter, tz)}, when the cap window reopens; if by then it is older than its discovery refresh allows, it is cancelled instead and the next run starts with fresh prices.`;
      return {
        status: 'paused_budget',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_budget',
          detail: `The cap was reached: ${breachText(e.scope, e.providerId ?? null, e.cap, e.current, e.requested, 'the next call needed')}. ${when}`,
        },
      };
    }
    case 'child-cap':
      // why: ruling 7 — a child never pauses on a cap; it ends, with the scope in the log and this text on the row
      return {
        status: 'cancelled',
        patch: { finishedAt: now, resumeAfter: null, errorText: CHILD_CAP_REACHED },
        notice: null,
      };
    case 'all-disabled':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null },
        notice: {
          kind: 'paused_error',
          detail: `Every ${stop.stage} provider was disabled after errors; resume manually once the cause is fixed.`,
        },
      };
    case 'fatal':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null, errorText: stop.message },
        notice: { kind: 'paused_error', detail: `The run stopped on an internal error: ${stop.message}` },
      };
  }
}
```

`packages/engine/src/orchestrator.ts` — replace the file:

```ts
import { ACTIVE_STATUSES, type CellKey } from '@gmt/core';
import { verifyCellExecution } from './child.js';
import type { EngineContext } from './context.js';
import { createRegistry } from './registry.js';
import { resumeExecution } from './resume.js';
import { stopRun } from './run.js';
import { startExecution } from './start.js';
import type { StartResult } from './types.js';

/** The execution half of the Engine; createEngine (Task 7.19) adds estimates, scheduler, boot and status. */
export interface Orchestrator {
  start(
    definitionId: string,
    opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number },
  ): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  /** Spec §8.1 single-cell verification (POST /cells/verify): a child execution for one cell. */
  verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;
  /** Spec §8.1 AbortedError row: cells in flight → not_run, status cancelled. False when there is nothing to cancel. */
  cancel(executionId: string): Promise<boolean>;
  /** Aborts every pass as SIGTERM (cells in flight → not_run, status interrupted) and waits for them. */
  shutdown(): Promise<void>;
  running(): string[];
}

export function createOrchestrator(ctx: EngineContext): Orchestrator {
  const reg = createRegistry(ctx.log);
  return {
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
    shutdown: async () => {
      for (const run of reg.all()) stopRun(run, { kind: 'sigterm' });
      await reg.settleAll();
    },
    running: () => reg.all().map((r) => r.executionId),
  };
}
```

`packages/engine/src/run.ts` — replace or add these declarations:

```ts
/** Why a pass stopped early. Each maps to one execution status in execute.ts `finalStatus` (spec §8.1 error table). */
export type StopReason =
  | { kind: 'sigterm' }
  | { kind: 'cancel' }
  | { kind: 'limiter-timeout'; resumeAfter: IsoDateTime | null }
  | { kind: 'budget'; error: BudgetExceeded; resumeAfter: IsoDateTime | null }
  | { kind: 'all-disabled'; stage: Stage }
  | { kind: 'child-cap'; error: BudgetExceeded }
  | { kind: 'fatal'; message: string };

/**
 * Spec §8.1 error table, BudgetExceeded rows, with decision 25 (a reservation that passed every cap is honoured; only
 * new reservations are refused; nothing in flight is aborted):
 * - execution-*: the pass takes no new work; cells not started stay not_run; paused_budget, no one-shot job.
 * - provider-month / provider-lifetime: that provider's remaining cells in the stage skipped:budget; others remain →
 *   continue and notify once; none remain → paused_budget, resume_after = the provider's next window start (a
 *   lifetime window has none, so no one-shot job).
 * - global-month: billed providers' remaining cells skipped:budget; a free provider remains → continue; else
 *   paused_budget at the global window start.
 * BudgetExceeded is never recorded as a cell error.
 */
export function applyBudgetBreach(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  stage: Stage,
  err: BudgetExceeded,
): void {
  run.log
    .child({ providerId })
    .warn(
      { stage, scope: err.scope, cap: err.cap, current: err.current, requested: err.requested },
      'budget cap reached',
    );
  if (run.isChild) {
    // why: ruling 7 — a child never pauses: its cell is skipped for budget, the child ends cancelled, the parent's cell
    // stays unverified and a new child can be started by hand
    for (const id of stageProviders(run, stage)) budgetOut(ctx, run, stage, id);
    stopRun(run, { kind: 'child-cap', error: err });
    return;
  }
  if (
    err.scope === 'execution-calls' ||
    err.scope === 'execution-free-calls' ||
    err.scope === 'execution-cost'
  ) {
    stopRun(run, { kind: 'budget', error: err, resumeAfter: null });
    return;
  }
  const ids = stageProviders(run, stage);
  const global = err.scope === 'global-month';
  const affected = global ? ids.filter((id) => ctx.limitsOf(id).billed) : [providerId];
  for (const id of affected) budgetOut(ctx, run, stage, id);
  // why: ssr2-02 — a provider the pre-start or resume check blocked for budget does not remain in the stage either
  const remaining = ids.filter(
    (id) => !run.disabled.has(id) && !run.blocked.has(id) && !laneFor(run, stage, id).budgetOut,
  );
  if (remaining.length === 0) {
    const scope: BudgetScope = global ? { kind: 'global-month' } : { kind: err.scope, providerId };
    stopRun(run, { kind: 'budget', error: err, resumeAfter: ctx.budget.usage(scope).windowEnd });
    return;
  }
  run.notices.push({
    kind: 'provider_capped',
    detail: `${affected.join(', ')}: ${breachText(err.scope, providerId, err.cap, err.current, err.requested, 'the next call needed')}. Its remaining ${stage} cells are skipped (budget) in this run and the other providers continue.`,
  });
}
```

`packages/engine/src/snapshot.ts` — the import block becomes:

```ts
import {
  type Cell,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  generateCells,
  type IsoDate,
  type ProviderId,
  type ResolvedSpace,
  resolveWindow,
  type SearchDefinition,
} from '@gmt/core';
import type { EngineContext } from './context.js';
```

`packages/engine/src/snapshot.ts` — replace or add these declarations:

```ts
/**
 * Spec §8.1 single-cell verification: a child skips discovery, `alwaysInclude = [cell]`, `maxCells = 1`, `topN = 1`
 * (decision 17), and its own call cap `maxCalls` (ruling 7: the per-cell estimate × ESTIMATE_RETRY_FACTOR, bounded by
 * the parent's headroom); the rest of the definition's budget is inherited (decision 14); provider and global caps are
 * shared.
 */
export function childSnapshot(
  parent: DefinitionSnapshot,
  cell: CellKey,
  maxCalls: number,
): DefinitionSnapshot {
  const key = {
    origin: cell.origin,
    destination: cell.destination,
    departureDate: cell.departureDate,
    returnDate: cell.returnDate,
  };
  return {
    ...parent,
    providers: { ...parent.providers, discovery: [] },
    verification: { ...parent.verification, alwaysInclude: [key], maxCells: 1, topN: 1 },
    budget: { ...parent.budget, maxCalls },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run child verification budget-breach`
Expected: PASS, 51 tests (8 + 17 + 15, and the 11 of `error-table-verification.test.ts`, which the `verification` filter also matches).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: single-cell verification as child executions with an estimate-sized cap that never pauses

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.16: Review Focus 5 — a repository write that throws `SqliteError` during a tile

**Files:**
- Create: `packages/engine/test/sqlite-failure.test.ts`

**Interfaces:**
- Consumes: Task 7.4's `classifyFailure` (`fatal`), the pass's abort on a fatal stop (Task 7.1), Task 7.2's notifications; `Database.SqliteError` from `better-sqlite3` (test only).
- Produces: nothing new; this pins Review Focus 5.

A fatal stop is the one non-operator stop that aborts calls in flight: the database itself failed, so nothing more can be written (Task 7.1 `stopRun`). The test pins the engine's handling (classify fatal, pause, abort the held sibling, a URL-free `error_text`); the error is thrown before `writeTile` runs, so the failed write wrote nothing by construction, and rollback inside a transaction is WP3's own test (test-strategy-reviewer-031). It asserts the outcome rows exist (56) before it asserts they are all `not_run` (test-strategy-reviewer-010).

- [ ] **Step 1: Write the test**

`packages/engine/test/sqlite-failure.test.ts` (new file):

```ts
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createHarness, FIXTURE_RULES, JFK, LGW, LHR, tileRule } from './support/harness.js';

describe('Review Focus 5: SQLite busy or full during a tile write', () => {
  it('→ paused_error with the SQLite message, URL-free, in error_text; the sibling in flight → not_run; operator notified; no crash loop', async () => {
    const h = createHarness({ fixtureConcurrency: 2 });
    await h.fixtureScenario([tileRule('LHR', '2026-11-09', FIXTURE_RULES.hold, 1)]);
    h.beforeTileWrite((attempt) => {
      if (attempt === 1)
        throw new Database.SqliteError(
          'database or disk is full (see https://user:pw@sqlite.example/full?db=/data/x.db)',
          'SQLITE_FULL',
        );
    });
    const orch = h.orch();
    const r = await orch.start(h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] }).id, {
      trigger: 'manual',
    });
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBeNull();
    expect(e.errorText).toBe('database or disk is full (see https://sqlite.example/full)');
    const all = h.outcomes(e.id);
    expect(all).toHaveLength(56);
    // why: this pins the engine's handling (classify fatal, pause, abort the held sibling, URL-free error_text); the error
    // is thrown before writeTile runs, so nothing was written by construction; rollback inside the transaction is WP3's
    // own test (test-strategy-reviewer-031)
    expect(all.every((o) => o.status === 'not_run')).toBe(true);
    expect(h.logs.some((l) => l.msg === 'unexpected failure; pausing')).toBe(true);
    expect(h.notifications.map((m) => m.kind)).toEqual(['paused_error']);
    expect(h.notifications[0]?.body).toContain('database or disk is full');
    expect(h.notifications[0]?.body).not.toContain('pw@');
    expect(e.autoResumeCount).toBe(0); // a graceful pause, not a crash: boot will not count it as a restart
  });
});
```

- [ ] **Step 2: Run the test, then see it fail**

Run: `pnpm --filter @gmt/engine exec vitest run sqlite-failure`
Expected: PASS, 1 test. To see it fail, change the last line of `classifyFailure` in `src/errors.ts` to `return { kind: 'abort' };` and run it again: the run ends `completed` with the first tile's cells `not_run` and no notification (expected `paused_error`). Restore the line.

- [ ] **Step 3: Commit**

```bash
git add packages/engine && git commit -m "wp07: review focus 5 - SqliteError during a tile write pauses with a URL-free error_text

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.17: Scheduler — croner jobs, re-registration, one-shot resume jobs, and the tick

**Files:**
- Create: `packages/engine/src/scheduler/scheduler.ts`, `src/tick.ts`, `test/scheduler.test.ts`, `test/tick.test.ts`
- Modify: `packages/engine/src/resume.ts` (`olderThanRefresh`, `isStalePaused`, `supersede`, `SUPERSEDED`), `src/orchestrator.ts` (`tick`, `blockedSince`)

**Interfaces:**
- Consumes: `croner` (`new Cron(pattern|Date, options, fn)`, `nextRun`, `stop`), `parseCron`, `refreshHoursOf`, `REUSE_TOLERANCE`, `DEFAULT_DISCOVERY_REFRESH_HOURS`, `isoDateTimeOfEpochMs`.
- Produces: `createScheduler(hooks, log): Scheduler` with `register`, `unregister`, `registerResume(executionId, definitionId, at)`, `cancelResume`, `registerSystem`, `runSystemSoon(name, delayMs)`, `jobs` (api-contract `SchedulerJob`, `nextRun` minted through core), `definitionJobCount`, `stopAll`; `tickDefinition(ctx, orch, definitionId, blocked)`; `olderThanRefresh(exec, now)`, `isStalePaused(exec, now)`, `supersede(ctx, orch, exec)`, `SUPERSEDED`; `Orchestrator.tick`, `Orchestrator.blockedSince`.

Ruling 10 (po-010): a paused run whose `resume_after` is not in the future is stale once older than 0.9 × its shortest `discoveryRefreshHours`, the reuse tolerance, so the weekly tick supersedes a run that paused seconds after the previous firing, DST-shortened weeks included; pinned at 151 h, 152 h, 167 h and 168 h less 30 s. Superseding cancels the stale run with error_text `SUPERSEDED` and never starts a run itself: the tick starts the fresh one at a scheduled firing, and a definition without a schedule is never ticked, so a stale run's one-shot job (Task 7.19) cancels it without starting a run nobody scheduled (ssr2-06). A resume the tick attempts and that is refused blocks the schedule like an active execution (ssr-19); `blockedSince` keeps the first instant per definition and the oldest across definitions, and a tick that starts or resumes clears its definition (test-strategy-reviewer-012). Scheduler tests run on fake timers at a fixed instant.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/scheduler.test.ts` (new file):

```ts
import { asIsoDateTime, type SearchDefinition } from '@gmt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../src/scheduler/scheduler.js';
import { baseDefinition, capturingLogger, type LogLine, T0 } from './support/harness.js';

const def = (patch: Partial<SearchDefinition> = {}): SearchDefinition => ({
  ...baseDefinition(),
  id: 'def-1',
  confirmedCostPence: null,
  confirmedCalls: null,
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  scheduleCron: '0 5 * * 1',
  ...patch,
});

let lines: LogLine[];
const hooks = {
  onTick: vi.fn(async () => undefined),
  onResumeDue: vi.fn(async () => undefined),
  onSystem: vi.fn(async () => undefined),
};
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
    expect(s.jobs()).toEqual([
      {
        id: 'definition:def-1',
        kind: 'definition',
        definitionId: 'def-1',
        executionId: null,
        cron: '0 5 * * 1',
        tz: 'Europe/London',
        nextRun: '2027-03-29T04:00:00.000Z',
      },
    ]);
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
    expect(
      lines.some(
        (l) =>
          l.msg === 'scheduler: invalid schedule not registered' &&
          String(l.fields.reason).includes('at most once an hour'),
      ),
    ).toBe(true);
  });

  it('one-shot resume jobs fire once at resume_after and can be cancelled (spec §8.1 limiter-timeout row)', async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.registerResume('exec-1', 'def-1', asIsoDateTime('2027-03-28T13:00:00.000Z'));
    s.registerResume('exec-2', 'def-1', asIsoDateTime('2027-03-28T13:00:00.000Z'));
    expect(s.jobs()).toEqual([
      {
        id: 'resume:exec-1',
        kind: 'resume',
        definitionId: 'def-1',
        executionId: 'exec-1',
        cron: null,
        tz: 'UTC',
        nextRun: '2027-03-28T13:00:00.000Z',
      },
      {
        id: 'resume:exec-2',
        kind: 'resume',
        definitionId: 'def-1',
        executionId: 'exec-2',
        cron: null,
        tz: 'UTC',
        nextRun: '2027-03-28T13:00:00.000Z',
      },
    ]);
    s.cancelResume('exec-2');
    await vi.advanceTimersByTimeAsync(3_600_000 + 1000);
    expect(hooks.onResumeDue).toHaveBeenCalledExactlyOnceWith('exec-1');
    expect(s.jobs()).toEqual([]);
  });

  it('a resume_after already in the past fires on the next turn of the event loop', async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.registerResume('exec-3', 'def-1', asIsoDateTime('2027-03-28T11:00:00.000Z'));
    await vi.advanceTimersByTimeAsync(1);
    expect(hooks.onResumeDue).toHaveBeenCalledExactlyOnceWith('exec-3');
  });

  it('system jobs run but are not listed (SchedulerJob kinds are definition and resume); stopAll stops everything', async () => {
    const s = createScheduler(hooks, capturingLogger(lines));
    s.register(def());
    s.registerSystem('fx-refresh', '0 6 * * *', 'Europe/London');
    s.runSystemSoon('maintenance', 60_000);
    expect(s.jobs().map((j) => j.kind)).toEqual(['definition']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hooks.onSystem).toHaveBeenCalledWith('maintenance');
    await vi.advanceTimersByTimeAsync(18 * 3_600_000 + 1000); // past 06:00 BST Monday
    expect(hooks.onSystem).toHaveBeenCalledWith('fx-refresh');
    s.runSystemSoon('fx-refresh', 60_000);
    s.stopAll();
    hooks.onSystem.mockClear();
    hooks.onTick.mockClear();
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
    expect(lines.find((l) => l.msg === 'scheduler: job failed')?.fields.err).toBe(
      'tick failed at https://x.example/a',
    );
    expect(s.jobs()[0]?.nextRun).toBe('2027-04-05T04:00:00.000Z');
    s.stopAll();
  });
});
```

`packages/engine/test/tick.test.ts` (new file):

```ts
import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { isStalePaused, SUPERSEDED } from '../src/resume.js';
import {
  createHarness,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  HOUR,
  JFK,
  LGW,
  LHR,
  tileRule,
} from './support/harness.js';

const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], scheduleCron: '0 5 * * 1', ...patch });
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });

describe('isStalePaused (spec §8.1/§8.2 supersede, ruling 10: 0.9 × discoveryRefreshHours)', () => {
  it('a paused run with no resume_after is stale once older than 151.2 h, so a weekly tick supersedes one that paused just after the last firing', async () => {
    const h = createHarness({ fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const e = await h.runToCompletion(h.orch(), twoPairs(h).id);
    expect(e).toMatchObject({
      status: 'paused_error',
      resumeAfter: null,
      startedAt: '2026-10-14T09:00:00.000Z',
    });
    const at = (hours: number) =>
      asIsoDateTime(new Date(Date.parse(e.startedAt ?? '') + hours * HOUR).toISOString());
    expect(isStalePaused(e, at(151))).toBe(false);
    expect(isStalePaused(e, at(152))).toBe(true);
    expect(isStalePaused(e, at(167))).toBe(true); // a DST-shortened week
    expect(isStalePaused(e, at(168 - 1 / 120))).toBe(true); // the next weekly firing, 30 s short of 168 h
    expect(isStalePaused({ ...e, resumeAfter: at(200) }, at(169))).toBe(false); // resume_after still in the future
    expect(isStalePaused({ ...e, status: 'interrupted' }, at(400))).toBe(false);
  });
});

describe('tick (spec §8.2 "A tick, in order")', () => {
  it('with nothing active, runs the pre-start checks and starts a scheduled run', async () => {
    const h = createHarness();
    const def = twoPairs(h);
    await h.orch().tick(def.id);
    const [e] = executions(h, def.id);
    if (e === undefined) throw new Error('no execution');
    expect(e.trigger).toBe('schedule');
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
  });

  it('with an execution active, records nothing and keeps the oldest "schedule blocked since" across definitions until a tick starts', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const a = twoPairs(h);
    const b = twoPairs(h, { name: 'second' });
    const o = h.orch();
    const ra = await o.start(a.id, { trigger: 'manual' });
    const rb = await o.start(b.id, { trigger: 'manual' });
    if (!ra.ok || !rb.ok) throw new Error('start refused');
    const first = h.clock.now();
    await o.tick(a.id);
    h.clock.advance(HOUR);
    await o.tick(b.id);
    await o.tick(a.id); // blocked again: the first instant is kept
    expect(executions(h, a.id)).toHaveLength(1);
    expect(
      h.logs
        .filter((l) => l.msg === 'tick: schedule blocked by an active execution')
        .map((l) => l.fields.since),
    ).toEqual([first, h.clock.now(), first]);
    expect(o.blockedSince()).toBe(first);
    await o.cancel(ra.executionId);
    await o.tick(a.id); // starts: a's entry is cleared, b's remains
    expect(o.blockedSince()).toBe(h.clock.now());
  });

  it('resumes a paused_error once resume_after has passed, and not before', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.limiterTimeout, 1)]); // why: a Retry-After beyond MAX_WAIT_SECONDS fails at once, one attempt
    const def = twoPairs(h);
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.status).toBe('paused_error');
    await h.orch().tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_error');
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    await h.orch().tick(def.id);
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
    expect(executions(h, def.id)).toHaveLength(1);
  });

  it('resumes a paused_budget only when estimateRemaining passes the cap check (at the window start); a refused resume blocks the schedule (ssr-19)', async () => {
    // why: start near the month end so the window start comes before the pause is stale (0.9 × 168 h)
    const h = createHarness({
      fixtureConcurrency: 1,
      fixtureMonthlyCallCap: 20,
      now: asIsoDateTime('2026-10-28T09:00:00.000Z'),
    });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const def = twoPairs(h);
    const e = await h.runToCompletion(h.orch(), def.id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 1000,
    });
    h.clearHooks();
    expect(e.status).toBe('paused_budget');
    const o = h.orch();
    await o.tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_budget');
    expect(o.blockedSince()).toBe(h.clock.now());
    if (e.resumeAfter === null) throw new Error('expected resume_after');
    h.clock.set(e.resumeAfter);
    await o.tick(def.id);
    expect(o.blockedSince()).toBeNull();
    expect((await h.waitForSettled(e.id)).status).toBe('completed');
  });

  it('cancels and supersedes a paused run older than 0.9 × discoveryRefreshHours whose resume_after is not in the future', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
    const def = twoPairs(h);
    const old = await h.runToCompletion(h.orch(), def.id);
    expect(old.status).toBe('paused_error');
    h.clock.advance(168 * HOUR - 30_000); // the next weekly firing
    await h.orch().tick(def.id);
    expect(h.repos.executions.get(old.id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED });
    const fresh = executions(h, def.id).find((x) => x.id !== old.id);
    if (fresh === undefined) throw new Error('no fresh execution');
    expect((await h.waitForSettled(fresh.id)).status).toBe('completed');
  });

  it('exempts a paused_budget whose resume_after is still in the future from the supersede', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const def = twoPairs(h);
    const e = await h.runToCompletion(h.orch(), def.id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 1000,
    });
    h.clearHooks();
    h.clock.advance(169 * HOUR); // 2026-10-21, before the 1 November window start
    await h.orch().tick(def.id);
    expect(h.repos.executions.get(e.id)?.status).toBe('paused_budget');
    expect(executions(h, def.id)).toHaveLength(1);
  });

  it('a disabled, deleted or unscheduled definition does nothing (plan decision 5, ssr2-06)', async () => {
    const h = createHarness();
    const def = twoPairs(h);
    h.repos.definitions.update(def.id, { enabled: false });
    await h.orch().tick(def.id);
    const gone = twoPairs(h);
    h.repos.definitions.softDelete(gone.id);
    await h.orch().tick(gone.id);
    const manual = twoPairs(h, { scheduleCron: null });
    await h.orch().tick(manual.id);
    expect(executions(h, def.id)).toHaveLength(0);
    expect(executions(h, gone.id)).toHaveLength(0);
    expect(executions(h, manual.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gmt/engine exec vitest run scheduler tick`
Expected: FAIL, `Cannot find module '../src/scheduler/scheduler.js'`, and `isStalePaused` is not exported from `../src/resume.js`.

- [ ] **Step 3: Implement**

`packages/engine/src/orchestrator.ts` — replace the file:

```ts
import { ACTIVE_STATUSES, type CellKey, type IsoDateTime } from '@gmt/core';
import { verifyCellExecution } from './child.js';
import type { EngineContext } from './context.js';
import { createRegistry } from './registry.js';
import { resumeExecution } from './resume.js';
import { stopRun } from './run.js';
import { startExecution } from './start.js';
import { tickDefinition } from './tick.js';
import type { StartResult } from './types.js';

/** The execution half of the Engine; createEngine (Task 7.19) adds estimates, scheduler, boot and status. */
export interface Orchestrator {
  start(
    definitionId: string,
    opts: { trigger: 'manual' | 'schedule'; confirmCostPence?: number; confirmCalls?: number },
  ): Promise<StartResult>;
  resume(executionId: string, opts: { manual: boolean }): Promise<StartResult>;
  /** Spec §8.1 single-cell verification (POST /cells/verify): a child execution for one cell. */
  verifyCell(definitionId: string, cell: CellKey): Promise<StartResult>;
  /** Spec §8.1 AbortedError row: cells in flight → not_run, status cancelled. False when there is nothing to cancel. */
  cancel(executionId: string): Promise<boolean>;
  /** Spec §8.2 tick for one definition. */
  tick(definitionId: string): Promise<void>;
  /** The oldest "schedule blocked since" among blocked definitions (cleared by a tick that starts or resumes), or null. */
  blockedSince(): IsoDateTime | null;
  /** Aborts every pass as SIGTERM (cells in flight → not_run, status interrupted) and waits for them. */
  shutdown(): Promise<void>;
  running(): string[];
}

export function createOrchestrator(ctx: EngineContext): Orchestrator {
  const reg = createRegistry(ctx.log);
  const blocked = new Map<string, IsoDateTime>();
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
    tick: (id) => tickDefinition(ctx, self, id, blocked),
    blockedSince: () => [...blocked.values()].sort()[0] ?? null,
    shutdown: async () => {
      for (const run of reg.all()) stopRun(run, { kind: 'sigterm' });
      await reg.settleAll();
    },
    running: () => reg.all().map((r) => r.executionId),
  };
  return self;
}
```

`packages/engine/src/resume.ts` — replace the file:

```ts
import {
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type Execution,
  type ExecutionStatus,
  type IsoDateTime,
  RESUMABLE_STATUSES,
} from '@gmt/core';
import { breachMessage, checkBudget, spendOf } from './budgetCheck.js';
import type { EngineContext } from './context.js';
import { addPass, estimateRemainingFor, withBlocked } from './estimate.js';
import { execute } from './execute.js';
import type { Orchestrator } from './orchestrator.js';
import type { RunRegistry } from './registry.js';
import { markRemaining, newRun } from './run.js';
import { REUSE_TOLERANCE, refreshHoursOf } from './stages/reuse.js';
import { confirmationNeeded, nothingToSearch, refused } from './start.js';
import type { StartResult } from './types.js';

/**
 * Spec §8.1 "Resume": allowed on interrupted | paused_* | cancelled, and on completed when retryable errors remain
 * (retry-errors). It is a compare-and-set — the tick, the one-shot job, boot auto-resume and /resume all go through it,
 * so losers get code `active` (409). /resume is also refused while another execution of the definition is active, and
 * an execution whose definition was soft-deleted is never resumed (plan decision 5).
 *
 * Order: the per-scope cap check uses estimateRemaining, which leaves out the cells whose departure date has arrived
 * (po-016); a manual resume of a paused_budget parent checks against the definition's current `budget` (and nothing
 * else), which needs the stored confirmation, pence and calls, when it raises the spend (cost-r1-005, decision 37); a
 * resume whose remaining discovery is all blocked, before any selection and with no price yet, is refused like a
 * start (ssr2-03). Nothing is written to the execution until the claim succeeds (ssr-09, arch-r2-006): marking the
 * departed cells skipped:departed, the refreshed budget, the blocked providers' cells (skipped:budget, cost-r1-001) and
 * the pass's runnable plan added to the stored estimate (cost-r1-009, cost-r1-014) all go into the same transaction as
 * the compare-and-set. An automatic resume of a paused_error with nothing resumable leaves it as it is, unclaimed
 * (ruling 10); a manual resume re-admits the providers disabled in the previous pass.
 */
export async function resumeExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  executionId: string,
  opts: { manual: boolean },
): Promise<StartResult> {
  const exec = ctx.repos.executions.get(executionId);
  if (exec === null) return refused('not_found', `execution ${executionId} not found`, { executionId });
  const def = ctx.repos.definitions.get(exec.definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', 'the definition of this execution was deleted', {
      executionId,
      definitionId: exec.definitionId,
    });
  if (reg.get(executionId) !== undefined || !RESUMABLE_STATUSES.includes(exec.status))
    return refused('active', `execution is ${exec.status} and cannot be resumed`, { status: exec.status });
  const other =
    exec.isChild && exec.cell !== null
      ? ctx.repos.executions.activeChild(exec.definitionId, exec.cell)
      : ctx.repos.executions.activeParent(exec.definitionId);
  if (other !== null && other.id !== exec.id)
    return refused('active', 'another execution of this definition is active', {
      activeExecutionId: other.id,
    });

  const refresh = opts.manual && exec.status === 'paused_budget' && !exec.isChild;
  const current = refresh ? { ...exec, snapshot: { ...exec.snapshot, budget: def.budget } } : exec;
  const remaining = estimateRemainingFor(ctx, current, opts.manual);
  const needed = remaining.perProvider.filter((p) => p.calls > 0);
  if (needed.length === 0 && current.status === 'completed')
    return refused('active', 'nothing left to retry on this execution', { executionId });
  if (needed.length === 0 && !opts.manual && current.status === 'paused_error')
    return refused(
      'active',
      'nothing can resume automatically; a manual resume retries the providers that were disabled',
      { executionId },
    );
  const check = checkBudget(
    ctx,
    spendOf(remaining),
    current.snapshot.budget,
    current.id,
    current.definitionId,
  );
  const pass = withBlocked(remaining, check.blockedBy);
  const starved =
    !ctx.repos.cells.hasVerificationOutcomes(executionId) &&
    !ctx.repos.cells.outcomes(executionId, { stage: 'discovery' }).some((o) => o.status === 'priced') &&
    nothingToSearch(current.snapshot, { perProvider: needed }, check.blocked);
  if ((needed.length > 0 && needed.every((p) => check.blocked.has(p.providerId))) || starved)
    return refused('cap', `budget cap: ${breachMessage(check.breaches)}`, { breaches: check.breaches });
  const raised = refresh && JSON.stringify(def.budget) !== JSON.stringify(exec.snapshot.budget);
  if (raised) {
    const confirm = confirmationNeeded(ctx, pass, check.blocked, {
      pence: def.confirmedCostPence,
      calls: def.confirmedCalls,
    });
    if (confirm !== null)
      return refused(
        'confirm',
        `${confirm.reason} under the raised budget and the definition's confirmation does not cover it`,
        {
          estimateMicroGbp: confirm.estimateMicroGbp,
          estimatePence: confirm.estimatePence,
          calls: confirm.calls,
          totalCalls: confirm.totalCalls,
        },
      );
  }
  let departed = 0;
  const claimed = ctx.db.immediateTransaction(() => {
    if (!ctx.repos.executions.claimResume(executionId)) return false;
    departed = ctx.repos.cells.markDeparted(executionId, ctx.clock.todayLondon());
    ctx.repos.executions.patch(executionId, {
      estimate: addPass(current.estimate, pass),
      ...(refresh ? { snapshot: current.snapshot } : {}),
    });
    for (const id of check.blocked) {
      if (current.snapshot.providers.discovery.includes(id))
        markRemaining(ctx, { executionId }, 'discovery', id, 'budget');
      if (
        current.snapshot.providers.verification.includes(id) &&
        ctx.repos.cells.hasVerificationOutcomes(executionId)
      )
        markRemaining(ctx, { executionId }, 'verification', id, 'budget');
    }
    return true;
  });
  if (!claimed) return refused('active', 'another resume claimed this execution first', { executionId });
  ctx.hooks.cancelResume(executionId); // why: spec §8.1 "cancelling the one-shot job in the same step"
  const run = newRun(
    ctx,
    { ...current, status: 'running' },
    { manual: opts.manual, fresh: false, blocked: check.blocked },
  );
  run.log.info(
    { manual: opts.manual, autoResumeCount: current.autoResumeCount, departed, blocked: [...check.blocked] },
    'execution: resumed',
  );
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId };
}

const PAUSED: readonly ExecutionStatus[] = ['paused_budget', 'paused_error'];

/**
 * Ruling 10: older than 0.9 × the shortest discoveryRefreshHours of the snapshot's discovery providers (168 h by
 * default), so the weekly tick supersedes a run that paused seconds after the previous firing, DST-shortened weeks
 * included. Age is elapsed time from started_at.
 */
export function olderThanRefresh(
  exec: Pick<Execution, 'startedAt' | 'createdAt' | 'snapshot'>,
  now: IsoDateTime,
): boolean {
  const ids = exec.snapshot.providers.discovery;
  const hours =
    ids.length === 0
      ? DEFAULT_DISCOVERY_REFRESH_HOURS
      : Math.min(...ids.map((id) => refreshHoursOf(exec.snapshot, id)));
  return Date.parse(now) - Date.parse(exec.startedAt ?? exec.createdAt) > REUSE_TOLERANCE * hours * 3_600_000;
}

/**
 * Spec §8.1/§8.2: "any paused run older than discoveryRefreshHours whose resume_after is not in the future is cancelled
 * and a fresh run started" (olderThanRefresh, ruling 10).
 */
export function isStalePaused(
  exec: Pick<Execution, 'status' | 'resumeAfter' | 'startedAt' | 'createdAt' | 'snapshot'>,
  now: IsoDateTime,
): boolean {
  if (!PAUSED.includes(exec.status)) return false;
  if (exec.resumeAfter !== null && exec.resumeAfter > now) return false;
  return olderThanRefresh(exec, now);
}

/** error_text of a run cancelled because it went stale (spec §8.2 supersede; ssr2-06, ssr2-09). */
export const SUPERSEDED =
  'superseded: older than its discovery refresh allows; the next run starts with fresh prices';

/**
 * Cancels a stale run (its one-shot job with it) and records why. It never starts a run: the tick starts the fresh one
 * at a scheduled firing, and for a definition without a schedule the next run is the operator's (ssr2-06). False when
 * the run was no longer active.
 */
export async function supersede(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'cancel'>,
  exec: Pick<Execution, 'id' | 'definitionId' | 'startedAt'>,
): Promise<boolean> {
  if (!(await orch.cancel(exec.id))) return false;
  ctx.repos.executions.patch(exec.id, { errorText: SUPERSEDED });
  ctx.log.info(
    { executionId: exec.id, definitionId: exec.definitionId, startedAt: exec.startedAt },
    'execution: superseded a stale run',
  );
  return true;
}
```

`packages/engine/src/scheduler/scheduler.ts` (new file):

```ts
import { type IsoDateTime, isoDateTimeOfEpochMs, type Logger, type SearchDefinition } from '@gmt/core';
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
  registerResume(executionId: string, definitionId: string, at: IsoDateTime): void;
  cancelResume(executionId: string): void;
  registerSystem(name: SystemJob, cron: string, tz: string): void;
  /** A one-shot system job (the FX refresh after boot); not listed by jobs(). */
  runSystemSoon(name: SystemJob, delayMs: number): void;
  jobs(): SchedulerJob[];
  definitionJobCount(): number;
  stopAll(): void;
}

const instant = (d: Date | null): IsoDateTime | null =>
  d === null ? null : isoDateTimeOfEpochMs(d.getTime());

/**
 * The croner scheduler (spec §8.2). Jobs call back into the engine through `hooks`; a rejected hook is logged and the
 * job keeps its schedule. `protect: true` stops a slow tick overlapping the next one. Time is croner's (the process
 * clock), which is what a schedule means; tests fake it (vi.useFakeTimers + setSystemTime).
 */
export function createScheduler(hooks: SchedulerHooks, log: Logger): Scheduler {
  const defs = new Map<string, { job: Cron; cron: string; tz: string }>();
  const resumes = new Map<
    string,
    { definitionId: string; at: IsoDateTime; job: Cron | null; timer: ReturnType<typeof setTimeout> | null }
  >();
  const systems = new Map<SystemJob, Cron>();
  const soon = new Set<ReturnType<typeof setTimeout>>();
  const fire = (job: string, fn: () => Promise<void>): void => {
    fn().catch((err: unknown) => log.error({ job, err: errorText(err) }, 'scheduler: job failed'));
  };
  const onCronError = (job: string) => (err: unknown) =>
    log.error({ job, err: errorText(err) }, 'scheduler: job failed');

  const unregister = (definitionId: string): void => {
    defs.get(definitionId)?.job.stop();
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
      const job = new Cron(
        def.scheduleCron,
        { timezone: def.scheduleTz, mode: '5-part', protect: true, catch: onCronError(name) },
        () => fire(name, () => hooks.onTick(def.id)),
      );
      defs.set(def.id, { job, cron: def.scheduleCron, tz: def.scheduleTz });
      log.info({ definitionId: def.id, nextRun: instant(job.nextRun()) }, 'scheduler: registered');
    },
    unregister,
    registerResume(executionId, definitionId, at) {
      cancelResume(executionId);
      const name = `resume:${executionId}`;
      const due = () => {
        resumes.delete(executionId);
        fire(name, () => hooks.onResumeDue(executionId));
      };
      if (Date.parse(at) <= Date.now()) {
        // why: a resume_after already passed (e.g. found at boot) is due now; croner will not fire a past Date
        resumes.set(executionId, { definitionId, at, job: null, timer: setTimeout(due, 0) });
        return;
      }
      resumes.set(executionId, {
        definitionId,
        at,
        job: new Cron(new Date(at), { maxRuns: 1, catch: onCronError(name) }, due),
        timer: null,
      });
    },
    cancelResume,
    registerSystem(name, cron, tz) {
      systems.get(name)?.stop();
      systems.set(
        name,
        new Cron(
          cron,
          { timezone: tz, mode: '5-part', protect: true, catch: onCronError(`system:${name}`) },
          () => fire(`system:${name}`, () => hooks.onSystem(name)),
        ),
      );
    },
    runSystemSoon(name, delayMs) {
      const timer = setTimeout(() => {
        soon.delete(timer);
        fire(`system:${name}`, () => hooks.onSystem(name));
      }, delayMs);
      soon.add(timer);
    },
    jobs() {
      const out: SchedulerJob[] = [];
      for (const [id, d] of defs)
        out.push({
          id: `definition:${id}`,
          kind: 'definition',
          definitionId: id,
          executionId: null,
          cron: d.cron,
          tz: d.tz,
          nextRun: instant(d.job.nextRun()),
        });
      // why: a one-shot job fires at an instant, so its tz is UTC and it has no cron
      for (const [id, r] of resumes)
        out.push({
          id: `resume:${id}`,
          kind: 'resume',
          definitionId: r.definitionId,
          executionId: id,
          cron: null,
          tz: 'UTC',
          nextRun: r.at,
        });
      // why: SchedulerJob (api-contract) lists definition and resume jobs only; the daily system jobs are internal
      return out;
    },
    definitionJobCount: () => defs.size,
    stopAll() {
      for (const id of [...defs.keys()]) unregister(id);
      for (const id of [...resumes.keys()]) cancelResume(id);
      for (const job of systems.values()) job.stop();
      systems.clear();
      for (const t of soon) clearTimeout(t);
      soon.clear();
    },
  };
}
```

`packages/engine/src/tick.ts` (new file):

```ts
import type { IsoDateTime } from '@gmt/core';
import type { EngineContext } from './context.js';
import type { Orchestrator } from './orchestrator.js';
import { isStalePaused, supersede } from './resume.js';

/**
 * Spec §8.2 tick, in order: (1) cancel and supersede a stale paused run (isStalePaused); (2) resume a paused_error
 * whose resume_after has passed, or a paused_budget whose remaining estimate now passes the cap check (both through
 * the compare-and-set); (3) any other active execution, or a resume that was refused, blocks the schedule — recorded
 * in `blocked` as "schedule blocked since <date>" (ssr-19); (4) otherwise pre-start checks and start. A tick that
 * starts or resumes clears the definition's entry. A deleted or disabled definition is never scheduled (decision 5),
 * and a definition without a schedule is never ticked: a stale run's one-shot job supersedes it without a tick
 * (ssr2-06, createEngine).
 */
export async function tickDefinition(
  ctx: EngineContext,
  orch: Pick<Orchestrator, 'start' | 'resume' | 'cancel'>,
  definitionId: string,
  blocked: Map<string, IsoDateTime>,
): Promise<void> {
  const def = ctx.repos.definitions.get(definitionId);
  if (def === null || def.deletedAt !== null || !def.enabled || def.scheduleCron === null) {
    blocked.delete(definitionId);
    return;
  }
  const log = ctx.log.child({ definitionId });
  const now = ctx.clock.now();
  const block = (executionId: string, status: string, since: IsoDateTime): void => {
    const first = blocked.get(def.id) ?? since;
    blocked.set(def.id, first);
    log.info({ executionId, status, since: first }, 'tick: schedule blocked by an active execution');
  };
  const active = ctx.repos.executions.activeParent(def.id);
  if (active !== null) {
    if (isStalePaused(active, now)) {
      await supersede(ctx, orch, active);
    } else if (
      (active.status === 'paused_error' && active.resumeAfter !== null && active.resumeAfter <= now) ||
      active.status === 'paused_budget'
    ) {
      const r = await orch.resume(active.id, { manual: false });
      log.info(
        { executionId: active.id, status: active.status, result: r.ok ? 'resumed' : r.code },
        'tick: resume attempted',
      );
      if (r.ok) blocked.delete(def.id);
      else block(active.id, active.status, now);
      return;
    } else {
      block(active.id, active.status, now);
      return;
    }
  }
  const r = await orch.start(def.id, { trigger: 'schedule' });
  if (r.ok) blocked.delete(def.id);
  log.info({ result: r.ok ? 'started' : r.code, executionId: r.ok ? r.executionId : null }, 'tick: start');
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @gmt/engine exec vitest run scheduler tick`
Expected: PASS, 15 tests (7 + 8).

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "wp07: croner scheduler with one-shot resume jobs; tick with supersede at 0.9 x refresh, resume and blocking

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.18: Coverage check, maintenance job, daily system jobs

**Files:**
- Create: `packages/engine/src/coverageCheck.ts`, `src/maintenance.ts`, `test/coverage-check.test.ts`
- Create: `packages/core/test/api-contract/coverageCheck.test.ts`
- Modify: `packages/core/src/api-contract/definitions.ts` (`cachedRows` nullable; `calls` documented as tiles)

**Interfaces:**
- Consumes: the Travelpayouts provider when registered (`DiscoveryCapability.plan/fetchTile` with `executionId: null`), `resolveWindow`, `generateCells`, `monthOf`, `monthsSpanned`, `runMaintenance`, `refreshFx`.
- Produces: `countCachedCells(priced, failed, months, cells)`, `coverageCheckWith(ctx, providerId, cap, req)`, `coverageCheckFor(ctx, req)`, `runMaintenanceJob(ctx)`, `runSystemJob(ctx, name)`, `FX_REFRESH_CRON`, `MAINTENANCE_CRON`; `coverageCheckResponseSchema` with `cachedRows: number | null`.

Ruling 11 (prov-wp07-008, po-006, po-007): `cachedRows` counts distinct in-band cells with a cached price per departure month (duplicates and out-of-band rows never inflate it), and a month the check could not fully check reports `null`, never a number below the real coverage: every covered cell of a failed tile, every cell a tile names in `cellIssues` without a price (an unread page, dropped rows), and every unpriced covered cell of a tile the page cap stopped (`truncated`) counts as not checked, with a note naming the pair (decisions 25, 30, 37; arch-r2-001, prov-wp07-r2-005, ssr2-07). `calls` counts the tiles requested, which a contract comment says (prov-wp07-r2-006, ssr2-12): a cached tile spends no upstream call and a tile may page. The request carries no cabin, so the check counts economy prices and says so in a note. `coverageCheckFor` uses the Travelpayouts provider only, so it never calls a billed provider; `coverageCheckWith` takes the provider and is tested with the fixture (ruling 1). The maintenance job relies on `runMaintenance`'s own log line (arch-024); its test seeds an expired cache row and an old cache-hit row and checks the exact counts, with the rows of a lifetime-window provider kept (test-strategy-reviewer-020). The schema change is the one decisions 25 and 37 record, with a core test that `null` parses and a negative count does not; WP9 renders `null` as "not checked" (§11).

- [ ] **Step 1: Write the failing test**

`packages/core/test/api-contract/coverageCheck.test.ts` (new file):

```ts
import { describe, expect, it } from 'vitest';
import { coverageCheckResponseSchema } from '../../src/api-contract/definitions.js';

const month = (cachedRows: number | null) => ({
  pairs: [{ origin: 'LHR', destination: 'JFK', months: [{ month: '2026-11', cachedRows, cellsInBand: 16 }] }],
  calls: 2,
  notes: [],
});

describe('coverageCheckResponseSchema (decisions 25, 37)', () => {
  it('a month not fully checked is null, never a number; counts are non-negative integers', () => {
    expect(coverageCheckResponseSchema.safeParse(month(null)).success).toBe(true);
    expect(coverageCheckResponseSchema.safeParse(month(0)).success).toBe(true);
    expect(coverageCheckResponseSchema.safeParse(month(-1)).success).toBe(false);
    expect(coverageCheckResponseSchema.safeParse(month(1.5)).success).toBe(false);
    expect(coverageCheckResponseSchema.safeParse({ ...month(3), calls: -1 }).success).toBe(false);
  });
});
```

`packages/engine/test/coverage-check.test.ts` (new file):

```ts
import { apiContract, asIsoDate, asIsoDateTime, asIsoMonth, cellKeyString, type ProviderId } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { countCachedCells, coverageCheckFor, coverageCheckWith } from '../src/coverageCheck.js';
import { runMaintenanceJob, runSystemJob } from '../src/maintenance.js';
import { frankfurterBody, stubFrankfurter } from './support/fx.js';
import {
  createHarness,
  discoveryOf,
  FIXTURE_RULES,
  HOUR,
  JFK,
  LGW,
  LHR,
  tileRule,
} from './support/harness.js';
import { mapPrices, mapTiles } from './support/wrappers.js';

const req = {
  origins: [LHR, LGW],
  destinations: [JFK],
  window: { kind: 'absolute' as const, from: asIsoDate('2026-11-23'), to: asIsoDate('2026-12-06') },
  minNights: 7,
  maxNights: 8,
};
const c = (departureDate: string, returnDate: string) => ({
  origin: LHR,
  destination: JFK,
  departureDate: asIsoDate(departureDate),
  returnDate: asIsoDate(returnDate),
});

describe('countCachedCells (prov-wp07-008, po-007)', () => {
  it('counts distinct in-band cells with a price per departure month; duplicates and out-of-band rows do not count; failed months are null', () => {
    const months = [asIsoMonth('2026-11'), asIsoMonth('2026-12'), asIsoMonth('2027-01')];
    const cells = [
      c('2026-11-05', '2026-11-12'),
      c('2026-11-30', '2026-12-07'),
      c('2026-12-01', '2026-12-08'),
      c('2027-01-02', '2027-01-09'),
    ];
    const priced = [
      c('2026-11-05', '2026-11-12'),
      c('2026-11-05', '2026-11-12'),
      c('2026-11-05', '2026-11-30'),
      c('2026-12-01', '2026-12-08'),
    ];
    expect(countCachedCells(priced, [c('2027-01-02', '2027-01-09')], months, cells)).toEqual([
      { month: '2026-11', cachedRows: 1, cellsInBand: 2 },
      { month: '2026-12', cachedRows: 1, cellsInBand: 1 },
      { month: '2027-01', cachedRows: null, cellsInBand: 1 },
    ]);
  });
});

describe('coverage check (spec §10 "runs Travelpayouts month tiles (free, ledgered, subject to the free-call caps); never calls a billed provider")', () => {
  it('without Travelpayouts it calls nothing and says why', async () => {
    const h = createHarness();
    const r = await coverageCheckFor(buildContext(h.deps, h.options), req);
    expect(r).toEqual({
      pairs: [],
      calls: 0,
      notes: ['Travelpayouts is not configured; the coverage check reads its free cached data only.'],
    });
    expect(h.requests).toHaveLength(0);
    expect(h.count('provider_requests')).toBe(0);
    expect(apiContract.coverageCheckResponseSchema.safeParse(r).success).toBe(true);
  });

  it('runs one pass of a provider’s tiles per pair outside any execution and counts distinct cached cells per month', async () => {
    // why: the provider used by the check is passed in; the fixture stands in for Travelpayouts (ruling 1)
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => x) });
    const r = await coverageCheckWith(
      buildContext(h.deps, h.options),
      'fixture',
      discoveryOf(h.fixture),
      req,
    );
    expect(r.pairs.map((p) => `${p.origin}-${p.destination}`)).toEqual(['LHR-JFK', 'LGW-JFK']);
    expect(r.pairs[0]?.months).toEqual([
      { month: '2026-11', cachedRows: 16, cellsInBand: 16 }, // 23–30 November × 2 nights
      { month: '2026-12', cachedRows: 12, cellsInBand: 12 },
    ]);
    expect(r.calls).toBe(4);
    expect(r.notes).toEqual([
      'cached prices are counted for economy; the check does not look at other cabins',
    ]);
    expect(
      h.db.raw
        .prepare<[], { e: string | null }>('SELECT DISTINCT execution_id AS e FROM provider_requests')
        .all(),
    ).toEqual([{ e: null }]);
    expect(apiContract.coverageCheckResponseSchema.safeParse(r).success).toBe(true);
  });

  it('a failed tile reports its months as null (not checked), never as 0, and names the failure (decision 25)', async () => {
    const h = createHarness({ fakeTimers: true });
    await h.fixtureScenario([tileRule('LHR', '2026-11-23', FIXTURE_RULES.upstream, 3)]);
    const r = await h.drive(
      coverageCheckWith(buildContext(h.deps, h.options), 'fixture', discoveryOf(h.fixture), req),
    );
    expect(r.pairs[0]?.months).toEqual([
      { month: '2026-11', cachedRows: null, cellsInBand: 16 },
      { month: '2026-12', cachedRows: 12, cellsInBand: 12 },
    ]);
    expect(r.notes).toContain('LHR→JFK: a fixture tile failed (upstream); its months are not checked');
  });

  it('cells a page cap left unread are not checked: their months are null with a note, never a low count (arch-r2-001)', async () => {
    // why: the November LHR tile stops at its page cap after reading one row; the adapter reports the rest as unread
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) => {
          if (
            r.kind !== 'tile' ||
            r.coveredCells[0]?.origin !== LHR ||
            r.coveredCells[0].departureDate !== '2026-11-23'
          )
            return r;
          const [kept] = r.prices;
          const read = new Set(kept === undefined ? [] : [cellKeyString(kept)]);
          return {
            ...r,
            truncated: true,
            prices: kept === undefined ? [] : [kept],
            cellIssues: r.coveredCells
              .filter((cell) => !read.has(cellKeyString(cell)))
              .map((cell) => ({
                cell,
                reason: 'upstream' as const,
                offersDropped: 0,
                detail: 'pagination truncated at 3 pages',
              })),
          };
        }),
    });
    const r = await coverageCheckWith(
      buildContext(h.deps, h.options),
      'fixture',
      discoveryOf(h.fixture),
      req,
    );
    expect(r.pairs[0]?.months).toEqual([
      { month: '2026-11', cachedRows: null, cellsInBand: 16 },
      { month: '2026-12', cachedRows: 12, cellsInBand: 12 },
    ]);
    expect(r.pairs[1]?.months.map((m) => m.cachedRows)).toEqual([16, 12]);
    expect(r.notes).toContain(
      'LHR→JFK: a fixture tile stopped at its page cap; its months are not fully checked',
    );
    expect(r.calls).toBe(4); // tiles requested
  });

  it('a cell named in cellIssues without a price is not checked even when the tile was read to the end', async () => {
    const dropped = c('2026-12-01', '2026-12-08');
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind !== 'tile' || !r.coveredCells.some((x) => cellKeyString(x) === cellKeyString(dropped))
            ? r
            : {
                ...r,
                prices: r.prices.filter((x) => cellKeyString(x) !== cellKeyString(dropped)),
                cellIssues: [
                  { cell: dropped, reason: 'parse', offersDropped: 1, detail: 'a row without a price' },
                ],
              },
        ),
    });
    const r = await coverageCheckWith(
      buildContext(h.deps, h.options),
      'fixture',
      discoveryOf(h.fixture),
      req,
    );
    expect(r.pairs[0]?.months.find((m) => m.month === '2026-12')?.cachedRows).toBeNull();
    expect(r.notes).toContain(
      'LHR→JFK: a fixture tile could not read every row; its months are not fully checked',
    );
  });
});

describe('daily system jobs', () => {
  it('maintenance deletes expired cache rows and old cache-hit rows of monthly providers, keeps a lifetime provider’s rows (test-strategy-020)', () => {
    const h = createHarness();
    h.deps.cache.set('a'.repeat(64), { a: 1 }, 60, h.clock.now()); // a 60-second entry, expired an hour later
    const now = h.clock.now();
    h.clock.set(asIsoDateTime('2026-06-01T00:00:00.000Z'));
    h.deps.budget.recordCacheHit({
      providerId: 'fixture',
      executionId: null,
      tileIndex: null,
      endpointPath: '/old',
    });
    h.clock.set(now);
    h.clock.advance(HOUR);
    const ctx = buildContext(h.deps, h.options);
    // why: the fixture is the only provider; a lifetime window is set on its limits to show those rows are kept
    const lifetime = {
      ...ctx,
      limitsOf: (id: ProviderId) => ({ ...ctx.limitsOf(id), window: 'lifetime' as const }),
    };
    expect(runMaintenanceJob(lifetime)).toMatchObject({ cacheRowsDeleted: 1, ledgerRowsPruned: 0 });
    expect(h.count('provider_requests')).toBe(1);
    const r = runMaintenanceJob(ctx);
    expect(r).toMatchObject({ cacheRowsDeleted: 0, ledgerRowsPruned: 1 });
    expect(r.dbBytes).toBeGreaterThan(0);
    expect(h.count('provider_requests')).toBe(0);
    expect(h.logs.filter((l) => l.msg === 'maintenance')).toHaveLength(2); // db's own line; the engine adds none (arch-024)
  });

  it('fx-refresh as a system job refreshes rates; a failure is logged, not thrown', async () => {
    // why: the fx limits allow one call every 6 s (10 a minute); fake timers keep the two refreshes instant
    const h = createHarness({ fakeTimers: true });
    let body: unknown = frankfurterBody({ USD: 1.27 });
    stubFrankfurter(() => Response.json(body));
    await h.drive(runSystemJob(buildContext(h.deps, h.options), 'fx-refresh'));
    expect(h.repos.fx.latest('USD', 3, h.clock.todayLondon())).not.toBeNull();
    body = { base: 'EUR' };
    await expect(
      h.drive(runSystemJob(buildContext(h.deps, h.options), 'fx-refresh')),
    ).resolves.toBeUndefined();
    expect(h.logs.some((l) => l.msg === 'system job failed' && l.fields.job === 'fx-refresh')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run coverage-check`
Expected: FAIL, `Cannot find module '../src/coverageCheck.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/api-contract/definitions.ts` — apply this patch:

```diff
--- a/packages/core/src/api-contract/definitions.ts
+++ b/packages/core/src/api-contract/definitions.ts
@@ -203,9 +203,14 @@
     z.object({
       origin: iataSchema,
       destination: iataSchema,
-      months: z.array(z.object({ month: isoMonthSchema, cachedRows: positiveInt, cellsInBand: positiveInt })),
+      // cachedRows: distinct in-band cells with a cached price; null when the month was not fully checked: a tile covering
+      // it failed, or left cells unread (decisions 25, 37)
+      months: z.array(
+        z.object({ month: isoMonthSchema, cachedRows: positiveInt.nullable(), cellsInBand: positiveInt }),
+      ),
     }),
   ),
+  // calls: the tiles the check requested (decision 37); a cached tile costs no upstream call and a tile may page
   calls: positiveInt,
   notes: z.array(z.string()),
 });
```

`packages/engine/src/coverageCheck.ts` (new file):

```ts
import {
  type CellKey,
  cellKeyString,
  type DiscoveryCapability,
  generateCells,
  type IsoMonth,
  monthOf,
  monthsSpanned,
  type ProviderId,
  resolveWindow,
} from '@gmt/core';
import type { EngineContext } from './context.js';
import { errorText } from './run.js';
import type { CoverageCheckRequest, CoverageCheckResponse } from './types.js';

type MonthRow = CoverageCheckResponse['pairs'][number]['months'][number];

/**
 * Per departure month of the window (every month listed, zero months included): `cachedRows` = distinct in-band cells
 * with a cached price (duplicates and out-of-band rows never inflate it, po-007), or null when a tile covering the
 * month failed, so "not checked" never reads as "nothing cached" (decision 25); `cellsInBand` = the band's cells.
 */
export function countCachedCells(
  priced: readonly CellKey[],
  failed: readonly CellKey[],
  months: readonly IsoMonth[],
  cells: readonly CellKey[],
): MonthRow[] {
  const inBand = new Set(cells.map(cellKeyString));
  const cached = new Map<IsoMonth, Set<string>>(months.map((m) => [m, new Set()]));
  for (const p of priced) {
    const key = cellKeyString(p);
    if (inBand.has(key)) cached.get(monthOf(p.departureDate))?.add(key);
  }
  const unknown = new Set(failed.map((c) => monthOf(c.departureDate)));
  const band = new Map<IsoMonth, number>(months.map((m) => [m, 0]));
  for (const c of cells) band.set(monthOf(c.departureDate), (band.get(monthOf(c.departureDate)) ?? 0) + 1);
  return months.map((month) => ({
    month,
    cachedRows: unknown.has(month) ? null : (cached.get(month)?.size ?? 0),
    cellsInBand: band.get(month) ?? 0,
  }));
}

/**
 * One pass of a provider's own tiles per pair, outside any execution (ledgered with execution_id NULL). Not checked
 * (its month null, never a number below the real coverage): every covered cell of a failed tile, every cell a tile
 * named in `cellIssues` without a price (a page cap left it unread, or its rows were dropped), and every covered cell
 * without a price of a tile the page cap stopped (`truncated`; decisions 25, 30, 37). `calls` counts the tiles
 * requested: a cached tile costs no upstream call and a tile may page, so it is not the ledger's call count.
 */
export async function coverageCheckWith(
  ctx: EngineContext,
  providerId: ProviderId,
  cap: DiscoveryCapability,
  req: CoverageCheckRequest,
): Promise<CoverageCheckResponse> {
  const w = resolveWindow(req.window, ctx.clock.todayLondon());
  const months = monthsSpanned(w.departureFrom, w.departureTo);
  // why: the request carries no cabin, so the check counts economy prices and says so (prov-wp07-008)
  const notes: string[] = ['cached prices are counted for economy; the check does not look at other cabins'];
  const pairs: CoverageCheckResponse['pairs'] = [];
  let tiles = 0;
  const signal = new AbortController().signal;
  for (const origin of req.origins) {
    for (const destination of req.destinations) {
      const cells = generateCells({
        origins: [origin],
        destinations: [destination],
        departureFrom: w.departureFrom,
        departureTo: w.departureTo,
        minNights: req.minNights,
        maxNights: req.maxNights,
      });
      const q = {
        origin,
        destination,
        departureFrom: w.departureFrom,
        departureTo: w.departureTo,
        minNights: req.minNights,
        maxNights: req.maxNights,
        cabin: 'economy' as const,
        currency: 'GBP' as const,
        cells,
      };
      const priced: CellKey[] = [];
      const failed: CellKey[] = [];
      for (const tile of cap.plan(q)) {
        tiles += 1;
        try {
          const r = await cap.fetchTile(tile, q, { executionId: null, signal, recordFixtures: false });
          if (r.kind === 'tile') {
            priced.push(...r.prices);
            const read = new Set(r.prices.map(cellKeyString));
            const unread = [
              ...(r.cellIssues ?? []).map((i) => i.cell),
              ...(r.truncated === true ? tile.coveredCells : []),
            ].filter((cell) => !read.has(cellKeyString(cell)));
            failed.push(...unread);
            if (r.truncated === true)
              notes.push(
                `${origin}→${destination}: a ${providerId} tile stopped at its page cap; its months are not fully checked`,
              );
            else if (unread.length > 0)
              notes.push(
                `${origin}→${destination}: a ${providerId} tile could not read every row; its months are not fully checked`,
              );
          } else {
            failed.push(...tile.coveredCells);
            notes.push(
              `${origin}→${destination}: a ${providerId} tile failed (${r.error.kind}); its months are not checked`,
            );
          }
        } catch (err) {
          failed.push(...tile.coveredCells);
          notes.push(`${origin}→${destination}: ${errorText(err)}; its months are not checked`);
        }
      }
      pairs.push({ origin, destination, months: countCachedCells(priced, failed, months, cells) });
    }
  }
  if (w.clamped) notes.push('window clamped to start tomorrow');
  return { pairs, calls: tiles, notes };
}

/**
 * Spec §10 `POST /definitions/coverage-check` and §1 "the Definitions form's coverage check (free) reports cached rows
 * per pair before anything is saved". Uses only the Travelpayouts provider, so it can never call a billed provider;
 * its calls are ledgered (execution_id NULL) and capped by the provider's free-call limits through http-kit.
 */
export async function coverageCheckFor(
  ctx: EngineContext,
  req: CoverageCheckRequest,
): Promise<CoverageCheckResponse> {
  const cap = ctx.providers.get('travelpayouts')?.discovery;
  if (cap === undefined)
    return {
      pairs: [],
      calls: 0,
      notes: ['Travelpayouts is not configured; the coverage check reads its free cached data only.'],
    };
  return coverageCheckWith(ctx, 'travelpayouts', cap, req);
}
```

`packages/engine/src/maintenance.ts` (new file):

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

/**
 * Spec §7 retention through WP3's runMaintenance (which logs its own `maintenance` line): expired cache rows, and
 * cache-hit ledger rows older than 90 days of providers on monthly windows; providers on lifetime windows keep every
 * row, because their cap counts them.
 */
export function runMaintenanceJob(ctx: EngineContext): ReturnType<typeof runMaintenance> {
  const lifetimeProviders = [...ctx.providers.keys()].filter((id) => ctx.limitsOf(id).window === 'lifetime');
  return runMaintenance(ctx.db, ctx.clock, ctx.log, { lifetimeProviders });
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

Run: `pnpm --filter @gmt/engine exec vitest run coverage-check && pnpm --filter @gmt/core test`
Expected: PASS, 8 tests; core's suite stays green at 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/engine packages/core && git commit -m "wp07: coverage check counting distinct cached cells, unread cells not checked, maintenance and FX system jobs

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.19: `createEngine`, boot order, SIGTERM, crash-loop cap, pending sweep, `skipped_missed`, `status`

**Files:**
- Create: `packages/engine/src/boot.ts`, `src/engine.ts`, `test/boot.test.ts`
- Modify: `packages/engine/src/index.ts` (barrel), `src/resume.ts` (an execution never seeded); `apps/api/src/wiring.ts` (`fx: fxHttpLimits(timing)` from the barrel, decision 32)

**Interfaces:**
- Consumes: `ExecutionsRepo.bootSweep/listByStatus/listForDefinition/lastScheduledFiring/incrementAutoResume`, `LedgerRepo.sweepPending`, `FxRepo.latest`, `previousFiring`, `recordSkipped`, `isStalePaused`, `formatInstant`, every earlier module.
- Produces: `createEngine(deps, options?)` exactly as §5; `bootEngine(ctx, orch, sched)`; `statusOf(ctx, orch, sched)`; `NEVER_STARTED`; the package barrel, with `fxHttpLimits`, which `apps/api`'s `httpLimitsFor` now uses in place of its inline `fx` entry, so one copy of the FX http policy is live (decision 32, arch-r2-004).

Boot (spec §8.1, fake timers throughout so croner never runs on the real clock, test-strategy-reviewer-004): a stale paused run is superseded at boot instead of re-registering its one-shot, whether or not its definition has a schedule, and a one-shot that fires for a run gone stale supersedes it and starts nothing (ruling 10, ssr-11, ssr2-06); with `AUTO_RESUME` on, an interrupted run older than its discovery refresh allows is superseded rather than resumed from weeks-old prices, the same age rule as a paused one (ssr2-09); `skipped_missed` is recorded only when no tick ran at the firing — a scheduled execution created at or after it, or one active at that instant, means the tick ran (ssr-16) — and only for a firing after the definition was last changed, since the schedule may not have existed at an earlier one (ssr2-11), and names the firing in the schedule's time zone (po-015); when no FX rate is a day fresh, the refresh runs a minute after boot, never inside it (po-011); the no-network test checks the router's requests of every kind, the ledger, the frankfurter stub and the strays (test-strategy-reviewer-011). An execution row that was never seeded (left by a version that created it before seeding) is cancelled on resume with `NEVER_STARTED`, never completed empty (ssr-07). `Engine.estimate` is the worst case without reuse with `blocked` filled and the totals over what would run (ruling 9, cost-r1-014); `createEngine` refuses the fixture provider under a production config, as `buildContext` does (prov-wp07-012); an unsaved definition gets placeholder metadata and is estimated with no definition id (arch-021). Shutdown leaves the WAL checkpoint to WP8's shutdown, which owns the process and the driver (arch-020).

- [ ] **Step 1: Write the failing test**

`packages/engine/test/boot.test.ts` (new file):

```ts
import { asIsoDateTime, parseConfig, type SearchDefinition } from '@gmt/core';
import { takeStrays } from '@gmt/providers/testing';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createEngine } from '../src/index.js';
import { NEVER_STARTED, SUPERSEDED } from '../src/resume.js';
import { buildSnapshot } from '../src/snapshot.js';
import type { Engine } from '../src/types.js';
import { frankfurterBody, stubFrankfurter } from './support/fx.js';
import {
  createHarness,
  EWR,
  FIXTURE_RULES,
  type Harness,
  HOUR,
  JFK,
  LGW,
  LHR,
  T0,
  tileRule,
} from './support/harness.js';

// why: every test here runs croner, http-kit and the engine on faked timers set to T0, so the process clock and the
// engine clock agree and no job fires on the real clock (test-strategy-reviewer-004)
const fake = { fakeTimers: true } as const;
const engine = (h: Harness, opts = h.options): Engine => h.track(createEngine(h.deps, opts));
const twoPairs = (h: Harness, patch = {}) =>
  h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], ...patch });
const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });

/** An execution row written directly, as a process that died right after creating it would leave it (pending, nothing seeded). */
function ghost(h: Harness, def: SearchDefinition): string {
  const b = buildSnapshot(buildContext(h.deps, h.options), def);
  return h.repos.executions.create({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot: b.snapshot,
    estimate: null,
    trigger: 'manual',
    status: 'pending',
  }).id;
}

async function interrupted(h: Harness): Promise<string> {
  const first = engine(h);
  h.onTileCommit((n) => {
    if (n === 1) void first.shutdown();
  });
  const r = await first.start(twoPairs(h).id, { trigger: 'manual' });
  if (!r.ok) throw new Error(r.message);
  await h.waitForSettled(r.executionId);
  h.clearHooks();
  return r.executionId;
}

describe('createEngine', () => {
  it('refuses the fixture provider under a production config, as buildContext does (spec §5.5; prov-wp07-012)', () => {
    const h = createHarness();
    const parsed = parseConfig(
      { NODE_ENV: 'production', DATABASE_PATH: '/data/app.db', BIND_ADDRESS: '127.0.0.1' },
      { realpath: (p) => p },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(() => createEngine({ ...h.deps, config: parsed.config }, h.options)).toThrow(
      'the fixture provider is registered but syntheticAllowed(config) is false (spec §5.5)',
    );
    expect(h.count('provider_requests')).toBe(0);
  });
});

describe('boot (spec §8.1 "Boot order")', () => {
  it('runs sweep → auto-resume → one-shot jobs → cron, in that order', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    // why: a pair the interrupted definition does not have, so the rule cannot touch its resumed pass
    await h.fixtureScenario([
      {
        match: { path: '/calendar', params: { origin: 'LGW', destination: 'EWR', departFrom: '2026-11-02' } },
        respond: FIXTURE_RULES.limiterTimeout,
        times: 1,
      },
    ]);
    const paused = await h.runToCompletion(
      engine(h),
      h.createDefinition({ origins: [LGW], destinations: [EWR] }).id,
    );
    expect(paused.status).toBe('paused_error');
    const scheduled = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    h.logs.length = 0;
    const e2 = engine(h);
    await e2.boot();
    const phases = ['boot: sweep', 'boot: auto-resume', 'boot: one-shot jobs', 'boot: cron'];
    expect(
      h.logs.map((l) => l.msg).filter((m): m is string => m !== undefined && phases.includes(m)),
    ).toEqual(phases);
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: id,
      result: 'resumed',
    });
    expect(h.logs.find((l) => l.msg === 'boot: one-shot jobs')?.fields).toEqual({
      oneShots: 1,
      superseded: 0,
    });
    expect(e2.scheduler.jobs()).toEqual([
      expect.objectContaining({
        kind: 'definition',
        definitionId: scheduled.id,
        cron: '0 5 * * 1',
        tz: 'Europe/London',
        nextRun: '2026-10-19T04:00:00.000Z',
      }),
      expect.objectContaining({ kind: 'resume', executionId: paused.id, nextRun: paused.resumeAfter }),
    ]);
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('SIGTERM then reboot resumes without incrementing auto_resume_count', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    expect(h.repos.executions.get(id)?.autoResumeCount).toBe(0);
    await engine(h).boot();
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: id,
      autoResumeCount: 0,
      result: 'resumed',
    });
    expect((await h.waitForSettled(id)).status).toBe('completed');
  });

  it('a row left running by a dead process is crash-marked (count + 1), notified once and resumed', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    h.repos.executions.setStatus(id, 'running'); // what a crash leaves behind
    await engine(h).boot();
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: id,
      autoResumeCount: 1,
      result: 'resumed',
    });
    expect((await h.waitForSettled(id)).status).toBe('completed');
    expect(h.repos.executions.get(id)?.autoResumeCount).toBe(0); // reset by the first commit of the resumed pass
    expect(kinds(h).filter((k) => k === 'interrupted')).toHaveLength(1); // the SIGTERM notice; the crash notice deduplicates
  });

  it('crash-loop cap: auto_resume_count > MAX_AUTO_RESUMES stops auto-resume and sends crash_loop', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    for (let i = 0; i < h.config.maxAutoResumes; i += 1) h.repos.executions.incrementAutoResume(id);
    h.repos.executions.setStatus(id, 'running');
    await engine(h).boot();
    expect(h.repos.executions.get(id)).toMatchObject({
      status: 'interrupted',
      autoResumeCount: h.config.maxAutoResumes + 1,
    });
    const msg = h.notifications.find((m) => m.kind === 'crash_loop' && m.executionId === id);
    expect(msg?.body).toContain(
      `Automatic resume stopped after ${h.config.maxAutoResumes + 1} restarts without progress`,
    );
  });

  it('pending sweep: a pending execution older than the boot becomes interrupted; ledger rows pending > 10 min become unknown', async () => {
    const h = createHarness({ ...fake, env: { AUTO_RESUME: 'false' } });
    const pending = ghost(h, h.createDefinition());
    h.clock.advance(60_000); // the boot comes after the pending row was written
    const insert = h.db.raw.prepare<[string]>(
      `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, outcome, cost_micro_gbp, http_attempt) VALUES ('fixture', NULL, '/x', NULL, ?, 'pending', 3200, 1)`,
    );
    insert.run('2026-10-14T08:46:00.000Z'); // 15 min before the boot at 09:01
    insert.run('2026-10-14T08:56:00.000Z'); // 5 min before the boot
    await engine(h).boot();
    expect(h.repos.executions.get(pending)).toMatchObject({ status: 'interrupted', autoResumeCount: 1 });
    const outcomes = h.db.raw
      .prepare<[], { outcome: string }>(
        `SELECT outcome FROM provider_requests WHERE endpoint_path = '/x' ORDER BY started_at`,
      )
      .all();
    expect(outcomes).toEqual([{ outcome: 'unknown' }, { outcome: 'pending' }]);
  });

  it('an execution that was never seeded is cancelled on resume, never completed empty (ssr-07)', async () => {
    const h = createHarness(fake);
    const pending = ghost(h, h.createDefinition());
    h.clock.advance(60_000);
    await engine(h).boot();
    expect(h.repos.executions.get(pending)).toMatchObject({ status: 'cancelled', errorText: NEVER_STARTED });
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume execution')?.fields).toMatchObject({
      executionId: pending,
      result: 'not_found',
    });
  });

  it('makes no network call; when no FX rate is a day fresh, the refresh runs a minute after boot (spec §5.6, po-011)', async () => {
    const h = createHarness(fake);
    const fx = stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    await engine(h).boot();
    expect(fx.urls).toEqual([]);
    expect(h.requests).toHaveLength(0);
    expect(h.count('provider_requests')).toBe(0);
    expect(takeStrays()).toEqual([]);
    await vi.advanceTimersByTimeAsync(61_000);
    await h.drive(vi.waitFor(() => expect(fx.urls).toHaveLength(1)));
    await vi.waitFor(() => expect(h.repos.fx.latest('EUR', 1, h.clock.todayLondon())).not.toBeNull());
  });

  it('never auto-resumes an execution of a soft-deleted definition, nor re-registers its one-shot job (plan decision 5)', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    const exec = h.repos.executions.get(id);
    if (exec === null) throw new Error('missing execution');
    h.repos.definitions.softDelete(exec.definitionId);
    const e = engine(h);
    await e.boot();
    expect(h.repos.executions.get(id)?.status).toBe('interrupted');
    expect(h.logs.some((l) => l.msg === 'boot: auto-resume execution' && l.fields.executionId === id)).toBe(
      false,
    );
    expect(e.scheduler.jobs().filter((j) => j.executionId === id)).toEqual([]);
  });

  it.each([
    ['scheduled', '0 5 * * 1'],
    ['manual-only', null],
  ] as const)(
    'a %s definition’s paused run gone stale while the app was down is superseded at boot, never resumed from its old snapshot and never replaced off the cron (ssr-11, ssr2-06)',
    async (_kind, scheduleCron) => {
      const h = createHarness({ ...fake, fixtureConcurrency: 1 });
      await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.limiterTimeout, 1)]);
      const def = twoPairs(h, { scheduleCron });
      const old = await h.runToCompletion(engine(h), def.id);
      expect(old.status).toBe('paused_error');
      h.clock.advance(160 * HOUR); // resume_after (T0 + 4000 s) long past; older than 0.9 × 168 h
      const e = engine(h);
      await e.boot();
      expect(h.logs.find((l) => l.msg === 'boot: one-shot jobs')?.fields).toEqual({
        oneShots: 0,
        superseded: 1,
      });
      expect(e.scheduler.jobs().filter((j) => j.kind === 'resume')).toEqual([]);
      expect(h.repos.executions.get(old.id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED });
      expect(executions(h, def.id)).toHaveLength(1); // the fresh run is the next firing's, or the operator's
      await e.scheduler.tick(def.id);
      expect(executions(h, def.id)).toHaveLength(scheduleCron === null ? 1 : 2);
    },
  );

  it('an interrupted run older than its discovery refresh allows is superseded at boot, not resumed (ssr2-09)', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    const id = await interrupted(h);
    h.clock.advance(160 * HOUR);
    const requests = h.requests.length;
    await engine(h).boot();
    expect(h.repos.executions.get(id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED });
    expect(h.logs.find((l) => l.msg === 'boot: auto-resume')?.fields).toMatchObject({
      resumed: 0,
      superseded: 1,
    });
    expect(h.requests.length).toBe(requests);
  });

  it('a one-shot job that fires for a run gone stale supersedes it and starts nothing (ssr2-06)', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: 0 }),
    );
    const def = twoPairs(h); // no schedule
    const first = engine(h);
    const old = await h.runToCompletion(first, def.id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 1000,
    });
    h.clearHooks();
    await first.shutdown();
    expect(old).toMatchObject({ status: 'paused_budget', resumeAfter: '2026-11-01T00:00:00.000Z' });
    // why: boot a minute before the window reopens, so the job is registered (resume_after still ahead) and fires on
    // 1 November, 423 h after the run started: older than 0.9 × 168 h
    const eve = asIsoDateTime('2026-10-31T23:59:00.000Z');
    h.clock.set(eve);
    vi.setSystemTime(new Date(eve));
    const e = engine(h);
    await e.boot();
    expect(e.scheduler.jobs().filter((j) => j.kind === 'resume')).toEqual([
      expect.objectContaining({ executionId: old.id, nextRun: '2026-11-01T00:00:00.000Z' }),
    ]);
    h.clock.set(asIsoDateTime('2026-11-01T00:00:00.000Z'));
    // why: boot found no FX rate a day fresh, so the refresh runs a minute after it; it is answered, never the network
    stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.waitFor(() =>
      expect(h.repos.executions.get(old.id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED }),
    );
    expect(executions(h, def.id)).toHaveLength(1);
  });

  it('records skipped_missed once, in local time, when the last scheduled firing was missed (spec §8.2)', async () => {
    const h = createHarness(fake);
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' }); // created Wednesday 14 Oct
    h.clock.set(asIsoDateTime('2026-10-20T09:00:00.000Z')); // Tuesday: Monday 05:00 BST passed with the app down
    await engine(h).boot();
    const missed = executions(h, def.id).filter((x) => x.status === 'skipped_missed');
    expect(missed).toHaveLength(1);
    expect(kinds(h)).toEqual(['skipped_missed']);
    expect(h.notifications[0]?.body).toContain(
      'The run scheduled for Mon, 19 Oct 2026, 05:00 (Europe/London) did not happen',
    );
    await engine(h).boot();
    expect(executions(h, def.id).filter((x) => x.status === 'skipped_missed')).toHaveLength(1);
  });

  it('does not record skipped_missed for a firing before the schedule took effect (ssr2-11)', async () => {
    const h = createHarness(fake);
    const def = h.createDefinition(); // created Wednesday 14 Oct, no schedule
    h.clock.set(asIsoDateTime('2026-10-20T08:00:00.000Z')); // Tuesday: Monday 05:00 BST has passed
    h.repos.definitions.update(def.id, { scheduleCron: '0 5 * * 1' });
    h.clock.set(asIsoDateTime('2026-10-20T09:00:00.000Z'));
    await engine(h).boot();
    expect(executions(h, def.id)).toHaveLength(0);
    expect(kinds(h)).toEqual([]);
  });

  it('does not record skipped_missed when the firing found an execution active (the tick ran and was blocked, ssr-16)', async () => {
    const h = createHarness(fake);
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const first = engine(h);
    const r = await first.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await first.shutdown(); // the execution stays interrupted (active) across Monday's firing
    h.clock.set(asIsoDateTime('2026-10-20T09:00:00.000Z'));
    await engine(h, { ...h.options }).boot();
    expect(executions(h, def.id).filter((x) => x.status === 'skipped_missed')).toHaveLength(0);
  });
});

describe('shutdown and status', () => {
  it('shutdown stops the scheduler, interrupts in-flight cells, and leaves auto_resume_count alone', async () => {
    const h = createHarness({ ...fake, fixtureConcurrency: 1 });
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold, times: 1 }]);
    const e = engine(h);
    await e.boot();
    e.scheduler.register(h.createDefinition({ scheduleCron: '0 5 * * 1' }));
    const r = await e.start(twoPairs(h).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    expect(e.status().running).toEqual([r.executionId]);
    await e.shutdown();
    expect(e.scheduler.jobs()).toEqual([]);
    expect(h.repos.executions.get(r.executionId)).toMatchObject({
      status: 'interrupted',
      autoResumeCount: 0,
    });
    const all = h.outcomes(r.executionId);
    expect(all).toHaveLength(56);
    expect(all.every((o) => o.status === 'not_run')).toBe(true);
  });

  it('status reports the next run, the last execution, and degraded when a run is stuck', async () => {
    const h = createHarness(fake);
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    h.createDefinition({ scheduleCron: '0 5 * * 1' });
    const e = engine(h);
    await e.boot();
    expect(e.status()).toEqual({
      running: [],
      degraded: false,
      nextRun: '2026-10-19T04:00:00.000Z',
      lastExecutionAt: null,
    });
    const r = await e.start(twoPairs(h).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    h.clock.advance((h.config.stuckAfterHours + 1) * HOUR);
    expect(e.status()).toMatchObject({ degraded: true, lastExecutionAt: T0 });
  });

  it('wires estimate (worst case, blocked filled), estimateRemaining, budgetFit and coverageCheck', async () => {
    const h = createHarness(fake);
    const e = engine(h);
    const def = twoPairs(h, { scheduleCron: '0 5 * * 1' });
    expect(e.estimate(def, h.clock.todayLondon()).cells).toBe(56); // 2 pairs × 14 days × 2 nights
    const {
      id: _id,
      confirmedCostPence: _c,
      confirmedCalls: _cc,
      createdAt: _a,
      updatedAt: _u,
      deletedAt: _d,
      ...unsaved
    } = def;
    expect(e.estimate(unsaved, h.clock.todayLondon()).totalPlanCalls).toBe(4); // POST /api/definitions/estimate: an unsaved DefinitionInput
    expect(e.budgetFit(def).runsPerMonth).toBe(52 / 12);
    expect(
      (
        await e.coverageCheck({
          origins: [LHR],
          destinations: [JFK],
          window: def.window,
          minNights: 7,
          maxNights: 8,
        })
      ).calls,
    ).toBe(0);
    const done = await h.runToCompletion(e, def.id);
    const remaining = e.estimateRemaining(done.id);
    expect(remaining.perProvider).toHaveLength(1);
    expect(remaining.perProvider.every((p) => p.planCalls === 0)).toBe(true);
    // why: ruling 9 — right after a run the save-time estimate still plans every tile (no reuse assumed)
    expect(e.estimate(def, h.clock.todayLondon()).totalPlanCalls).toBe(4);
    const capped = twoPairs(h, {
      budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    const blocked = e.estimate(capped, h.clock.todayLondon());
    expect(blocked.perProvider.map((p) => [p.blocked, p.planCalls])).toEqual([['execution-calls', 4]]);
    // cost-r1-014: the totals shown are what would run, here nothing
    expect(blocked).toMatchObject({
      totalCalls: 0,
      totalPlanCalls: 0,
      totalCostMicroGbp: 0,
      totalCostPence: 0,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/engine exec vitest run boot`
Expected: FAIL, `createEngine` is not exported from `../src/index.js`.

- [ ] **Step 3: Implement**

`apps/api/src/wiring.ts` — apply this patch:

```diff
--- a/apps/api/src/wiring.ts
+++ b/apps/api/src/wiring.ts
@@ -30,6 +30,7 @@
   SqliteBudgetGuard,
   SqliteResponseCache,
 } from '@gmt/db';
+import { fxHttpLimits } from '@gmt/engine';
 import {
   createHttpKit,
   type FixtureRecorder,
@@ -154,17 +155,8 @@
     ...(config.providers.travelpayouts === null
       ? {}
       : { travelpayouts: travelpayoutsHttpLimits(config.providers.travelpayouts.limits, config) }),
-    // why: plan decision 2 — frankfurter lives at api.frankfurter.dev; the .app host redirects and http-kit refuses redirects.
-    // Owner: WP7's fx/refresh.ts holds the fx client; this entry moves beside it as `fxHttpLimits` (arch M-7).
-    fx: {
-      hosts: ['api.frankfurter.dev'],
-      ratePerMinute: 10,
-      ratePerHour: 100,
-      concurrency: 1,
-      billable: 'never',
-      costPerCallMicroGbp: 0,
-      ...timing,
-    },
+    // why: decision 32 — the FX client's http policy lives beside it in the engine (fx/limits.ts), one copy
+    fx: fxHttpLimits(timing),
   };
 }
 
```

`packages/engine/src/boot.ts` (new file):

```ts
import { type IsoDateTime, isoDateTimeOfEpochMs, type SearchDefinition } from '@gmt/core';
import type { EngineContext } from './context.js';
import { FX_REFRESH_CRON, MAINTENANCE_CRON } from './maintenance.js';
import { notifyOperator } from './notify.js';
import type { Orchestrator } from './orchestrator.js';
import { isStalePaused, olderThanRefresh, supersede } from './resume.js';
import { previousFiring } from './scheduler/parseCron.js';
import type { Scheduler } from './scheduler/scheduler.js';
import { buildSnapshot } from './snapshot.js';
import { recordSkipped } from './start.js';
import { formatInstant } from './text.js';

/** Spec §5.3 "boot sweep marks pending older than 10 minutes unknown (still counted)". */
export const PENDING_LEDGER_MAX_AGE_MS = 10 * 60_000;
/** po-011: when no rate is a day fresh, the FX refresh runs this long after boot (never inside boot). */
export const FX_AFTER_BOOT_MS = 60_000;

/**
 * Spec §8.2: "a boot that finds the last scheduled firing was missed records skipped_missed and notifies", once per
 * firing. A firing is not missed when the definition was last changed at or after it (the schedule may not have
 * existed then, ssr2-11), when a scheduled execution was created at or after it, or when an execution of the definition
 * was active at that instant: the tick ran and was blocked, which records nothing by design (ssr-16).
 */
async function detectMissed(ctx: EngineContext, def: SearchDefinition, bootAt: IsoDateTime): Promise<void> {
  if (def.scheduleCron === null) return;
  const prev = previousFiring(def.scheduleCron, def.scheduleTz, new Date(bootAt));
  if (prev === null) return;
  const prevAt = isoDateTimeOfEpochMs(prev.getTime());
  // why: ssr2-11 — the schedule as it is now may not have existed at that firing; updated_at bounds when it took effect
  if (prevAt <= def.updatedAt) return;
  const lastFiring = ctx.repos.executions.lastScheduledFiring(def.id);
  if (lastFiring !== null && lastFiring >= prevAt) return;
  const activeThen = ctx.repos.executions
    .listForDefinition(def.id, { limit: 50, includeChildren: false })
    .some((e) => (e.startedAt ?? e.createdAt) <= prevAt && (e.finishedAt === null || e.finishedAt >= prevAt));
  if (activeThen) return;
  const built = buildSnapshot(ctx, def, 'schedule');
  await recordSkipped(
    ctx,
    def,
    built.snapshot,
    null,
    'skipped_missed',
    `The run scheduled for ${formatInstant(prevAt, def.scheduleTz)} did not happen because the app was not running.`,
  );
}

/**
 * Spec §8.1 "Boot order": (1) sweep — pending ledger rows older than 10 minutes → unknown; pending executions older than
 * the boot and running executions → interrupted with auto_resume_count + 1; (2) if AUTO_RESUME, every interrupted
 * execution with count ≤ MAX_AUTO_RESUMES resumes (graceful SIGTERM rows were not incremented); above the cap, the
 * operator is told, and a run older than its discovery refresh allows is superseded instead of resumed from its old
 * snapshot (ssr2-09); (3) one-shot jobs for resume_after are re-registered, except for a stale paused run, which is
 * superseded (ssr-11, ssr2-06: whether or not the definition has a schedule, so none waits forever); (4) then cron
 * (after recording any missed firing) and the daily system jobs, plus an FX refresh a minute after boot when no rate
 * is a day fresh (po-011).
 * Boot makes no network call.
 */
export async function bootEngine(ctx: EngineContext, orch: Orchestrator, sched: Scheduler): Promise<void> {
  const bootAt = ctx.clock.now();
  const log = ctx.log.child({ phase: 'boot' });

  const pendingLedgerRows = ctx.repos.ledger.sweepPending(
    isoDateTimeOfEpochMs(Date.parse(bootAt) - PENDING_LEDGER_MAX_AGE_MS),
  );
  const { interrupted } = ctx.repos.executions.bootSweep(bootAt);
  const crashMarked = new Set(interrupted);
  log.info({ crashMarked: interrupted.length, pendingLedgerRows }, 'boot: sweep');

  const name = (definitionId: string) => ctx.repos.definitions.get(definitionId)?.name ?? definitionId;
  // why: plan decision 5 — executions of a soft-deleted definition are never resumed or scheduled
  const live = (definitionId: string): boolean => {
    const d = ctx.repos.definitions.get(definitionId);
    return d !== null && d.deletedAt === null;
  };
  let resumed = 0;
  let capped = 0;
  let superseded = 0;
  for (const exec of ctx.repos.executions.listByStatus(['interrupted'])) {
    if (!live(exec.definitionId)) continue;
    const p = {
      executionId: exec.id,
      definitionId: exec.definitionId,
      definitionName: name(exec.definitionId),
    };
    if (exec.autoResumeCount > ctx.config.maxAutoResumes) {
      capped += 1;
      log.warn(
        { executionId: exec.id, autoResumeCount: exec.autoResumeCount },
        'boot: auto-resume stopped by the crash-loop cap',
      );
      await notifyOperator(ctx, 'crash_loop', {
        ...p,
        detail: `Automatic resume stopped after ${exec.autoResumeCount} restarts without progress; resume it manually once the cause is fixed.`,
      });
      continue;
    }
    if (crashMarked.has(exec.id))
      await notifyOperator(ctx, 'interrupted', {
        ...p,
        detail: 'The app stopped without a clean shutdown during this run.',
      });
    if (!ctx.config.autoResume) continue;
    if (olderThanRefresh(exec, bootAt)) {
      if (await supersede(ctx, orch, exec)) superseded += 1;
      continue;
    }
    const r = await orch.resume(exec.id, { manual: false });
    if (r.ok) resumed += 1;
    log.info(
      { executionId: exec.id, autoResumeCount: exec.autoResumeCount, result: r.ok ? 'resumed' : r.code },
      'boot: auto-resume execution',
    );
  }
  log.info({ autoResume: ctx.config.autoResume, resumed, capped, superseded }, 'boot: auto-resume');

  let oneShots = 0;
  let stale = 0;
  for (const exec of ctx.repos.executions.listByStatus(['paused_error', 'paused_budget'])) {
    if (exec.resumeAfter === null || !live(exec.definitionId)) continue;
    if (isStalePaused(exec, bootAt)) {
      if (await supersede(ctx, orch, exec)) stale += 1;
      continue;
    }
    sched.registerResume(exec.id, exec.definitionId, exec.resumeAfter);
    oneShots += 1;
  }
  log.info({ oneShots, superseded: stale }, 'boot: one-shot jobs');

  for (const def of ctx.repos.definitions.list()) {
    if (!def.enabled || def.deletedAt !== null || def.scheduleCron === null) continue;
    await detectMissed(ctx, def, bootAt);
    sched.register(def);
  }
  sched.registerSystem('fx-refresh', FX_REFRESH_CRON, ctx.config.schedulerTimezone);
  sched.registerSystem('maintenance', MAINTENANCE_CRON, ctx.config.schedulerTimezone);
  // why: spec §5.6 the refresh "runs after boot"; boot itself stays network-free, so it is a one-shot a minute later
  const fxStale = ctx.repos.fx.latest('EUR', 1, ctx.clock.todayLondon()) === null;
  if (fxStale) sched.runSystemSoon('fx-refresh', FX_AFTER_BOOT_MS);
  log.info({ definitionJobs: sched.definitionJobCount(), fxRefreshAfterBoot: fxStale }, 'boot: cron');
}
```

`packages/engine/src/engine.ts` (new file):

```ts
import type { DefinitionInput, SearchDefinition } from '@gmt/core';
import { bootEngine } from './boot.js';
import { checkBudget, spendOf } from './budgetCheck.js';
import { buildContext, type EngineContext } from './context.js';
import { coverageCheckFor } from './coverageCheck.js';
import { budgetFitFor, estimateRemainingFor, estimateStart, withBlocked } from './estimate.js';
import { runSystemJob } from './maintenance.js';
import { createOrchestrator, type Orchestrator } from './orchestrator.js';
import { isStalePaused, supersede } from './resume.js';
import { parseCron } from './scheduler/parseCron.js';
import { createScheduler, type Scheduler } from './scheduler/scheduler.js';
import { buildSnapshot } from './snapshot.js';
import type { Engine, EngineDeps, EngineOptions } from './types.js';

/** Spec §10 `/health` degraded: job count ≠ enabled scheduled definitions, or an execution running past STUCK_AFTER_HOURS. */
export function statusOf(
  ctx: EngineContext,
  orch: Orchestrator,
  sched: Scheduler,
): ReturnType<Engine['status']> {
  const now = Date.parse(ctx.clock.now());
  const defs = ctx.repos.definitions
    .list()
    .filter(
      (d) =>
        d.enabled &&
        d.deletedAt === null &&
        d.scheduleCron !== null &&
        parseCron(d.scheduleCron, d.scheduleTz).ok,
    );
  const running = orch.running();
  const stuck = running.some((id) => {
    const e = ctx.repos.executions.get(id);
    return (
      e !== null && now - Date.parse(e.startedAt ?? e.createdAt) > ctx.config.stuckAfterHours * 3_600_000
    );
  });
  const nextRuns = sched
    .jobs()
    .flatMap((j) => (j.kind === 'definition' && j.nextRun !== null ? [j.nextRun] : []))
    .sort();
  const latest = ctx.repos.definitions
    .list({ includeDeleted: true })
    .flatMap((d) => {
      const at = ctx.repos.executions.listForDefinition(d.id, { limit: 1, includeChildren: true })[0]
        ?.startedAt;
      return at === undefined || at === null ? [] : [at];
    })
    .sort();
  return {
    running,
    degraded: sched.definitionJobCount() !== defs.length || stuck,
    nextRun: nextRuns[0] ?? null,
    lastExecutionAt: latest[latest.length - 1] ?? null,
  };
}

/**
 * The definition the engine works on, with its id when it is saved. An unsaved DefinitionInput (POST
 * /api/definitions/estimate) gets placeholder metadata only so a snapshot can be built; nothing keys off its id, the
 * callers pass `definitionId` null instead (arch-021).
 */
function asDefinition(
  ctx: EngineContext,
  def: DefinitionInput | SearchDefinition,
): { def: SearchDefinition; definitionId: string | null } {
  if ('id' in def) return { def, definitionId: def.id };
  const now = ctx.clock.now();
  return {
    def: {
      ...def,
      id: 'unsaved',
      confirmedCostPence: null,
      confirmedCalls: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    definitionId: null,
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
        const e = ctx.repos.executions.get(id);
        // why: ssr-11, ssr2-06 — a one-shot that fires for a run gone stale cancels it instead of resuming an old
        // snapshot; it never starts a run off the cron (a scheduled definition's next firing starts the fresh one)
        if (e !== null && isStalePaused(e, ctx.clock.now())) {
          await supersede(ctx, orch, e);
          return;
        }
        const r = await orch.resume(id, { manual: false });
        ctx.log.info({ executionId: id, result: r.ok ? 'resumed' : r.code }, 'one-shot resume');
      },
      onSystem: (name) => runSystemJob(ctx, name),
    },
    ctx.log,
  );
  ctx.hooks.scheduleResume = (id, definitionId, at) => sched.registerResume(id, definitionId, at);
  ctx.hooks.cancelResume = (id) => sched.cancelResume(id);
  ctx.hooks.unregisterSchedule = (id) => sched.unregister(id);
  return {
    boot: () => bootEngine(ctx, orch, sched),
    shutdown: async () => {
      // why: spec §8.1 "SIGTERM: stop scheduler, abort in-flight (cells → not_run), status interrupted without
      // incrementing the counter"; the WAL checkpoint and the lock release follow in WP8's shutdown (arch-020)
      sched.stopAll();
      await orch.shutdown();
      ctx.log.info({}, 'engine: shut down');
    },
    start: (id, opts) => orch.start(id, opts),
    resume: (id, opts) => orch.resume(id, opts),
    cancel: (id) => orch.cancel(id),
    verifyCell: (id, cell) => orch.verifyCell(id, cell),
    estimate: (input, today) => {
      // why: ruling 9 — the save-time estimate is the worst case without reuse; it is what confirmed_cost_pence records
      const { def } = asDefinition(ctx, input);
      const b = buildSnapshot(ctx, def, 'manual', today);
      const est = estimateStart(ctx, b.snapshot, b.cells, null);
      // why: cost-r1-014 — the form shows beforehand which provider the caps would leave out
      const check = checkBudget(ctx, spendOf(est), b.snapshot.budget, null, 'id' in input ? input.id : null);
      return withBlocked(est, check.blockedBy);
    },
    estimateRemaining: (id) => {
      const e = ctx.repos.executions.get(id);
      if (e === null) throw new Error(`execution ${id} not found`);
      return estimateRemainingFor(ctx, e, true); // why: the contract takes no `manual`; the manual query is the upper bound
    },
    budgetFit: (input) => {
      const { def, definitionId } = asDefinition(ctx, input);
      return budgetFitFor(ctx, def, definitionId);
    },
    coverageCheck: (req) => coverageCheckFor(ctx, req),
    scheduler: {
      register: (def) => sched.register(def),
      unregister: (id) => sched.unregister(id),
      jobs: () => sched.jobs(),
      tick: (id) => orch.tick(id),
      blockedSince: () => orch.blockedSince(),
    },
    status: () => statusOf(ctx, orch, sched),
  };
}
```

`packages/engine/src/index.ts` — replace the file:

```ts
// Barrel for @gmt/engine (plan contract "Engine"). EmailNotifier and runAlerts are added by WP11.
export { noAlerts } from './alertsStep.js';
export { createEngine } from './engine.js';
export { fxHttpLimits } from './fx/limits.js';
export { LogNotifier } from './notifiers/log.js';
export { renderOperatorMessage } from './notifiers/operatorTemplates.js';
export { parseCron } from './scheduler/parseCron.js';
export type {
  AlertsStepHook,
  BudgetFit,
  CoverageCheckRequest,
  CoverageCheckResponse,
  Engine,
  EngineDeps,
  EngineOptions,
  Estimate,
  SchedulerJob,
  StartResult,
} from './types.js';
```

`packages/engine/src/resume.ts` — replace or add these declarations:

```ts
/**
 * Spec §8.1 "Resume": allowed on interrupted | paused_* | cancelled, and on completed when retryable errors remain
 * (retry-errors). It is a compare-and-set — the tick, the one-shot job, boot auto-resume and /resume all go through it,
 * so losers get code `active` (409). /resume is also refused while another execution of the definition is active, and
 * an execution whose definition was soft-deleted is never resumed (plan decision 5).
 *
 * Order: the per-scope cap check uses estimateRemaining, which leaves out the cells whose departure date has arrived
 * (po-016); a manual resume of a paused_budget parent checks against the definition's current `budget` (and nothing
 * else), which needs the stored confirmation, pence and calls, when it raises the spend (cost-r1-005, decision 37); a
 * resume whose remaining discovery is all blocked, before any selection and with no price yet, is refused like a
 * start (ssr2-03). Nothing is written to the execution until the claim succeeds (ssr-09, arch-r2-006): marking the
 * departed cells skipped:departed, the refreshed budget, the blocked providers' cells (skipped:budget, cost-r1-001) and
 * the pass's runnable plan added to the stored estimate (cost-r1-009, cost-r1-014) all go into the same transaction as
 * the compare-and-set. An automatic resume of a paused_error with nothing resumable leaves it as it is, unclaimed
 * (ruling 10); a manual resume re-admits the providers disabled in the previous pass.
 */
export async function resumeExecution(
  ctx: EngineContext,
  reg: RunRegistry,
  executionId: string,
  opts: { manual: boolean },
): Promise<StartResult> {
  const exec = ctx.repos.executions.get(executionId);
  if (exec === null) return refused('not_found', `execution ${executionId} not found`, { executionId });
  const def = ctx.repos.definitions.get(exec.definitionId);
  if (def === null || def.deletedAt !== null)
    return refused('not_found', 'the definition of this execution was deleted', {
      executionId,
      definitionId: exec.definitionId,
    });
  if (reg.get(executionId) !== undefined || !RESUMABLE_STATUSES.includes(exec.status))
    return refused('active', `execution is ${exec.status} and cannot be resumed`, { status: exec.status });
  const other =
    exec.isChild && exec.cell !== null
      ? ctx.repos.executions.activeChild(exec.definitionId, exec.cell)
      : ctx.repos.executions.activeParent(exec.definitionId);
  if (other !== null && other.id !== exec.id)
    return refused('active', 'another execution of this definition is active', {
      activeExecutionId: other.id,
    });

  // why: ssr-07 — a row left by a version that created it before seeding has no cells; resuming it would end
  // completed with nothing searched, so it is cancelled instead
  if (!exec.isChild && ctx.repos.cells.rollUps(executionId).size === 0) {
    ctx.repos.executions.setStatus(executionId, 'cancelled', {
      finishedAt: ctx.clock.now(),
      resumeAfter: null,
      errorText: NEVER_STARTED,
    });
    return refused('not_found', `this execution ${NEVER_STARTED}; start a new run`, { executionId });
  }
  const refresh = opts.manual && exec.status === 'paused_budget' && !exec.isChild;
  const current = refresh ? { ...exec, snapshot: { ...exec.snapshot, budget: def.budget } } : exec;
  const remaining = estimateRemainingFor(ctx, current, opts.manual);
  const needed = remaining.perProvider.filter((p) => p.calls > 0);
  if (needed.length === 0 && current.status === 'completed')
    return refused('active', 'nothing left to retry on this execution', { executionId });
  if (needed.length === 0 && !opts.manual && current.status === 'paused_error')
    return refused(
      'active',
      'nothing can resume automatically; a manual resume retries the providers that were disabled',
      { executionId },
    );
  const check = checkBudget(
    ctx,
    spendOf(remaining),
    current.snapshot.budget,
    current.id,
    current.definitionId,
  );
  const pass = withBlocked(remaining, check.blockedBy);
  const starved =
    !ctx.repos.cells.hasVerificationOutcomes(executionId) &&
    !ctx.repos.cells.outcomes(executionId, { stage: 'discovery' }).some((o) => o.status === 'priced') &&
    nothingToSearch(current.snapshot, { perProvider: needed }, check.blocked);
  if ((needed.length > 0 && needed.every((p) => check.blocked.has(p.providerId))) || starved)
    return refused('cap', `budget cap: ${breachMessage(check.breaches)}`, { breaches: check.breaches });
  const raised = refresh && JSON.stringify(def.budget) !== JSON.stringify(exec.snapshot.budget);
  if (raised) {
    const confirm = confirmationNeeded(ctx, pass, check.blocked, {
      pence: def.confirmedCostPence,
      calls: def.confirmedCalls,
    });
    if (confirm !== null)
      return refused(
        'confirm',
        `${confirm.reason} under the raised budget and the definition's confirmation does not cover it`,
        {
          estimateMicroGbp: confirm.estimateMicroGbp,
          estimatePence: confirm.estimatePence,
          calls: confirm.calls,
          totalCalls: confirm.totalCalls,
        },
      );
  }
  let departed = 0;
  const claimed = ctx.db.immediateTransaction(() => {
    if (!ctx.repos.executions.claimResume(executionId)) return false;
    departed = ctx.repos.cells.markDeparted(executionId, ctx.clock.todayLondon());
    ctx.repos.executions.patch(executionId, {
      estimate: addPass(current.estimate, pass),
      ...(refresh ? { snapshot: current.snapshot } : {}),
    });
    for (const id of check.blocked) {
      if (current.snapshot.providers.discovery.includes(id))
        markRemaining(ctx, { executionId }, 'discovery', id, 'budget');
      if (
        current.snapshot.providers.verification.includes(id) &&
        ctx.repos.cells.hasVerificationOutcomes(executionId)
      )
        markRemaining(ctx, { executionId }, 'verification', id, 'budget');
    }
    return true;
  });
  if (!claimed) return refused('active', 'another resume claimed this execution first', { executionId });
  ctx.hooks.cancelResume(executionId); // why: spec §8.1 "cancelling the one-shot job in the same step"
  const run = newRun(
    ctx,
    { ...current, status: 'running' },
    { manual: opts.manual, fresh: false, blocked: check.blocked },
  );
  run.log.info(
    { manual: opts.manual, autoResumeCount: current.autoResumeCount, departed, blocked: [...check.blocked] },
    'execution: resumed',
  );
  reg.launch(run, () => execute(ctx, run));
  return { ok: true, executionId };
}

/** error_text of an execution cancelled because it was never seeded (ssr-07). */
export const NEVER_STARTED = 'never finished starting and was cancelled';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/engine exec vitest run boot`
Expected: PASS, 19 tests; then `pnpm --filter @gmt/api test` passes with `httpLimitsFor` on the engine's `fxHttpLimits`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine apps/api && git commit -m "wp07: createEngine with boot order, stale runs superseded, crash-loop cap, pending sweep, skipped_missed, status; api wiring takes fxHttpLimits

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

### Task 7.20: §14 log fields, and the banned-word sweep over every string the engine emits

**Files:**
- Create: `packages/engine/test/logs-and-words.test.ts`

**Interfaces:**
- Consumes: `findBannedWords`, `BANNED_WORD_ALLOWLIST`, `renderOperatorMessage`, `OPERATOR_KINDS`, `coverageCheckWith`, `estimateStart`, every `StartResult` refusal.
- Produces: nothing new; it fails if a later edit adds a banned word or drops a log binding.

The sweep collects what the engine emitted at runtime — notification subjects and bodies, log messages and their string fields, cell reasons and last errors, refusal messages, coverage notes and estimate assumptions — from runs that error in both stages, disable a provider, pause for a cap with the calendar-only notice, break parity and refuse; it asserts each expected notice kind was emitted and that the sweep saw more than 100 strings, so a renamed message cannot pass it vacuously (test-strategy-reviewer-017). The binding check asserts every listed provider message occurred at least once.

- [ ] **Step 1: Write the test**

`packages/engine/test/logs-and-words.test.ts` (new file):

```ts
import { asIsoDate, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { coverageCheckWith } from '../src/coverageCheck.js';
import { estimateStart } from '../src/estimate.js';
import { OPERATOR_KINDS, renderOperatorMessage } from '../src/notifiers/operatorTemplates.js';
import { buildSnapshot } from '../src/snapshot.js';
import {
  createHarness,
  discoveryOf,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  itineraryRule,
  JFK,
  LGW,
  LHR,
  tileRule,
  withVerification,
} from './support/harness.js';
import { extraTile } from './support/wrappers.js';

const clean = (label: string, text: string) =>
  expect(findBannedWords(text, BANNED_WORD_ALLOWLIST), `${label}: "${text}"`).toEqual([]);

/** Every string the engine emitted in a harness: notification subjects and bodies, log messages and string fields, cell reasons and last errors. */
function emitted(h: Harness, executionIds: string[]): string[] {
  const out: string[] = [];
  for (const n of h.notifications) out.push(n.subject, n.body);
  for (const l of h.logs) {
    if (l.msg !== undefined) out.push(l.msg);
    for (const v of Object.values(l.fields)) if (typeof v === 'string') out.push(v);
  }
  for (const id of executionIds)
    for (const o of h.outcomes(id))
      out.push(...[o.reason, o.lastError].filter((x): x is string => x !== null));
  return out;
}

describe('spec §14: executionId, definitionId and providerId on engine lines; no full URLs', () => {
  it('holds over a run with errors in both stages', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([
      tileRule('LHR', '2026-11-02', FIXTURE_RULES.upstream, 3),
      itineraryRule(FIXTURE_RULES.badRequest, 1),
    ]);
    const def = h.createDefinition({
      origins: [LHR, LGW],
      destinations: [JFK],
      providers: withVerification(),
    });
    await h.runToCompletion(h.orch(), def.id);
    const engineLines = h.logs.filter((l) => l.bindings.executionId !== undefined);
    expect(engineLines.length).toBeGreaterThan(5);
    for (const l of engineLines) expect(l.bindings.definitionId).toBe(def.id);
    const providerMsgs = ['discovery: planned tiles', 'cells marked error', 'verification: searching cells'];
    for (const msg of providerMsgs) {
      const lines = engineLines.filter((x) => x.msg === msg);
      expect(lines.length, msg).toBeGreaterThan(0);
      for (const l of lines) expect(l.bindings.providerId).toBe('fixture');
    }
    const all = JSON.stringify(h.logs);
    expect(all).not.toMatch(/https?:\/\/[^\s"]*\?/); // no query strings
    expect(all).not.toMatch(/https?:\/\/[^\s"/]*@/); // no userinfo
  });
});

describe('spec §11: no banned word in any string the engine emits, swept at runtime (test-strategy-017)', () => {
  it('every template, for every kind', () => {
    for (const kind of OPERATOR_KINDS) {
      for (const variant of [undefined, 'no-runnable-provider'] as const) {
        const m = renderOperatorMessage(kind, {
          definitionName: 'London to New York',
          executionId: 'e1',
          detail: 'detail',
          ...(variant === undefined ? {} : { variant }),
        });
        clean(`${kind} subject`, m.subject);
        clean(`${kind} body`, m.body);
      }
    }
  });

  it('notifications, logs, cell reasons and refusal messages from runs that pause, disable, cap, break parity and refuse', async () => {
    const strings: string[] = [];
    const messages: string[] = [];
    // errors in both stages, a disabled provider, paused_error
    const a = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await a.fixtureScenario([
      tileRule('LHR', '2026-11-02', FIXTURE_RULES.upstream, 3),
      itineraryRule(FIXTURE_RULES.auth, 1),
    ]);
    const ea = await a.runToCompletion(
      a.orch(),
      a.createDefinition({ origins: [LHR, LGW], destinations: [JFK], providers: withVerification() }).id,
    );
    strings.push(...emitted(a, [ea.id]));
    // a budget pause with the calendar-only notice
    const b = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200, fakeTimers: true });
    b.onStageStart('verification', () =>
      b.spendLedger({
        providerId: 'fixture',
        rows: 200 - b.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls,
        costMicroGbpEach: FIXTURE_COST_MICRO_GBP,
      }),
    );
    const bdef = b.createDefinition({ providers: withVerification() });
    b.repos.alerts.create({
      definitionId: bdef.id,
      type: 'absolute',
      thresholdPence: 100_000,
      pct: null,
      basis: 'calendar',
      requireAllVerified: null,
      cooldownHours: 336,
      enabled: true,
    });
    const eb = await b.runToCompletion(b.orch(), bdef.id);
    strings.push(...emitted(b, [eb.id]));
    // a parity break
    const d = createHarness({ transformFixture: extraTile, fakeTimers: true });
    const ed = await d.runToCompletion(d.orch(), d.createDefinition().id);
    strings.push(...emitted(d, [ed.id]));
    // refusals: confirm, window, cap, outside the space, missing execution
    const c = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' }, fakeTimers: true });
    const o = c.orch();
    const def = c.createDefinition({ providers: withVerification() });
    for (const r of [
      await o.start(def.id, { trigger: 'manual' }),
      await o.start(
        c.createDefinition({
          window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-02') },
        }).id,
        { trigger: 'schedule' },
      ),
      await o.start(c.createDefinition({ budget: { maxCalls: 0, maxFreeCalls: 0, maxCostMicroGbp: 0 } }).id, {
        trigger: 'manual',
      }),
      await o.verifyCell(def.id, {
        origin: LHR,
        destination: JFK,
        departureDate: asIsoDate('2027-01-01'),
        returnDate: asIsoDate('2027-01-08'),
      }),
      await o.resume('no-such-execution', { manual: true }),
    ])
      if (!r.ok) messages.push(r.message);
    expect(messages).toHaveLength(5);
    strings.push(...messages, ...emitted(c, []));
    const ctx = buildContext(c.deps, c.options);
    strings.push(
      ...(
        await c.drive(
          coverageCheckWith(ctx, 'fixture', discoveryOf(c.fixture), {
            origins: [LHR],
            destinations: [JFK],
            window: def.window,
            minNights: 7,
            maxNights: 8,
          }),
        )
      ).notes,
    );
    const snap = buildSnapshot(ctx, def);
    strings.push(...estimateStart(ctx, snap.snapshot, snap.cells, null).assumptions);
    // why: the sweep is only as good as what it saw; each of these must have been emitted
    const kinds = [...a.notifications, ...b.notifications, ...c.notifications, ...d.notifications].map(
      (n) => n.kind,
    );
    for (const k of [
      'provider_disabled',
      'paused_error',
      'paused_budget',
      'alerts_calendar_only',
      'parity_break',
      'skipped_window',
    ] as const)
      expect(kinds, k).toContain(k);
    expect(strings.length).toBeGreaterThan(100);
    for (const s of strings) clean('engine string', s);
  });
});
```

- [ ] **Step 2: Run the test, then see it fail**

Run: `pnpm --filter @gmt/engine exec vitest run logs-and-words`
Expected: PASS, 3 tests. To see it fail, change `SUBJECTS.interrupted` in `src/notifiers/operatorTemplates.ts` to `'live run interrupted'` and run it again: the template test fails naming `interrupted subject`. Restore it. A banned word found here is fixed in the string's source module, never in an allowlist.

- [ ] **Step 3: Run the whole package with coverage**

Run: `pnpm --filter @gmt/engine test`
Expected: every test file passes (25 files, 255 tests); the coverage summary meets lines ≥ 85, branches ≥ 70, functions ≥ 85, statements ≥ 85 for `src/**` (barrels excluded). If a threshold fails, add a test for the uncovered branch named in the report; never lower the threshold.

- [ ] **Step 4: Commit**

```bash
git add packages/engine && git commit -m "wp07: log binding and banned-word sweeps over engine output collected at runtime

MrReasonable <4990954+MrReasonable@users.noreply.github.com>"
```

## 9. Pinned review-focus tests

| Plan Review Focus line | Test | Task |
|---|---|---|
| 4 — the definition is edited while an execution is running: the running execution keeps its snapshot and plan | `test/seeding.test.ts` › "Review Focus 4: a PUT during a run does not change the running execution" (edits origins, nights and cabin while the first tile is held; asserts the snapshot, all 28 outcomes and every `plan()` call still use the original values, and that the edit itself was stored) | 7.3 |
| 5 — a repository write that throws `SqliteError` during a tile → `paused_error` with the SQLite message, URL-free, in `error_text`; siblings → `not_run`; operator notification | `test/sqlite-failure.test.ts` › "Review Focus 5: SQLite busy or full during a tile write" (throws `new Database.SqliteError(…, 'SQLITE_FULL')` from `writeTile` with a sibling held in flight; 56 outcome rows, all `not_run`) | 7.16 |

The `excludedByCurrentSpace` count of Review Focus 4 belongs to WP8 (`/results`).

## 10. Definition of done

Run from the repository root on the WP7 branch:

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/engine test` | every file under `packages/engine/test/` passes (25 files, 255 tests); coverage for `packages/engine/src/**` (barrels excluded) at lines ≥ 85 %, branches ≥ 70 %, functions ≥ 85 %, statements ≥ 85 %, enforced by `packages/engine/vitest.config.ts`; Vitest exits 0. Every engine test is layer A (layer B is WP13's), so this is also the layer-A suite |
| `for i in 1 2 3; do pnpm --filter @gmt/engine exec vitest run --coverage.enabled=false \|\| exit 1; done` | three consecutive green runs (the hold/release, fake-timer and concurrency tests are deterministic) |
| `TZ=America/Los_Angeles pnpm --filter @gmt/engine exec vitest run --coverage.enabled=false` and the same with `TZ=Asia/Tokyo` | 255 passed each: no engine test depends on the machine's zone (London dates come from instants through core, test-strategy-reviewer-033) |
| `pnpm lint` | `biome check .` reports no errors |
| `pnpm -r typecheck` | exit 0 for every package (src and test, each package's `tsconfig.test.json`) |
| `pnpm boundaries` | exit 0 (engine imports only `@gmt/core`, `@gmt/db`, `@gmt/providers`; no msw outside providers' testing subpath) |
| `pnpm --filter @gmt/core test`, `pnpm --filter @gmt/db test`, `pnpm --filter @gmt/api test` | green, core at its 100% thresholds, after this package's changes to each |
| `grep -rn "process\.env" packages/engine/src` | no output |
| `grep -rnwE "LHR\|LGW\|JFK\|EWR\|LON\|NYC" packages/engine/src` | no output (airport codes appear only in `packages/engine/test/`) |
| `grep -rnE "from '(msw\|vitest)\|@gmt/providers/(testing\|fixture)" packages/engine/src` | no output (the harness and every test library stay in `test/`) |
| the cast check below | exit 0, no output: no `as` but `as const` and no `<T>x` in the engine, core, db or api sources and tests (core's brand mint helpers in `types/ids.ts` excepted, as the project rule allows). It parses with the TypeScript compiler instead of a grep, so prose, strings and renamed imports never match and every type spelling does, lower-case ones included (test-strategy-reviewer-024, arch-r2-010) |
| `grep -rn "api.frankfurter.app" packages/engine/src` | no output (the `.dev/v1` URL is used; decision 2) |
| `pnpm test` (root) | every package green, so WP7 broke nothing it consumes |

The cast check:

```sh
node -e '
const ts = require("typescript");
const fs = require("fs");
let bad = 0;
for (const f of process.argv.slice(1)) {
  const src = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const walk = (n) => {
    if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && n.type.getText(src) !== "const") {
      bad += 1;
      console.log(`${f}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}: ${n.getText(src).slice(0, 100)}`);
    }
    ts.forEachChild(n, walk);
  };
  walk(src);
}
process.exit(bad === 0 ? 0 : 1);
' $(git ls-files --cached --others --exclude-standard -- 'packages/engine/*.ts' 'packages/core/*.ts' 'packages/db/*.ts' 'apps/api/*.ts' ':!packages/core/src/types/ids.ts')
```

Every task's checkboxes are ticked; every commit message starts `wp07:`.

## 11. Open questions

None requires the operator's judgment: plan decisions 25 and 37 settle every design question the reviews raised. Recorded for the plan, which has not yet recorded them:

1. **Spec text.** Spec §8.1's error-table rows for `global-month` and `execution-*` ("in-flight … siblings aborted → not_run") and §9 item 4's "stopping breach aborts siblings → not_run" still need decision 25's wording (revision 18 changed §5.3 and §6.7 only). §3's error-reason list and §7's never-resumed list need `no-priced-options` (decision 37). §5.6 can name core's `priceInGbp` as the one money step for offers and calendar prices, and §6.2 the `priceConfirmed` verdict.
2. **Plan contract text.** The Budget port comment gives a child `maxFreeCalls: 0, maxCostMicroGbp: 0`, while the Engine contract (line 630) and this brief inherit the definition's budget with only `maxCalls` replaced (decision 14); §5 shows what this package produces. The Engine contract's `start` options need `confirmCalls`.
3. **Consumers of the contract changes.** WP8 stores a confirmation with `DefinitionsRepo.setConfirmed(id, { pence, calls })` (the estimate's `totalCostPence` and `totalCalls`), asks again when an edit raises either, passes `confirmCalls` on a manual start, and judges discovery overrun on distinct tiles (`countsFor(...).perProvider[].tiles` against the discovery `planCalls`), never on calls, since a paging provider spends a call a page (cost-r1-007); its `truncated` flag comes from `TRUNCATED_NOTE` (decision 36). WP9 renders a null `cachedRows` as "not checked" (not `?? 0`) and labels the coverage check's `calls` as tiles, and shows confirmation calls (decision 36). WP11's digests carry the `truncated` caveat and the `priceConfirmed` label. WP5's adapter test pins that SearchApi echoes the configured point of sale, which reuse matching assumes (`ctx.pointOfSaleOf`).
4. **Dispatch.** The front matter keeps `depends_on: [1, 2, 3, 4, 5, 6]`: WP6 is on main; of WP5 the engine reads only `RawOffer.verified` (Task 5.0). WP13 builds its own layer-B harness: this package exports no `./testing` subpath, and Task 7.1 removes the alias that named one.
5. **Decision 32 follow-up.** WP7 adds no ledger repository method, so the tool-credit query decision 32 assigns "when WP7 touches the ledger repo" stays with WP4b's inline SQL.
